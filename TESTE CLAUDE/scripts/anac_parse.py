"""ANAC: parser das paginas de reuniao (APEX P139) -> anac.json (formato identico a ancine.json/ana.json).
uso: python3 -I scripts/anac_parse.py manifesto_anac.json anac_inventario.json anac.json [texto_anac]
     python3 -I scripts/anac_parse.py --pagina fonte/anac/reu/4830.html      (imprime os itens lidos)
     python3 -I scripts/anac_parse.py --autoteste                            (casos SINTETICOS do analisador de texto de ata/certidao)

O que a PAGINA publica por item: Processo, Assunto, Relator, Deliberacao (ex.: "Aprovado por unanimidade"), Documentos (links SEI).
Voto individual, presenca e 'voto vencido' ficam na ata/certidao (SEI, bloqueado no egress). Entao:
 - relator = RELATOR (nominal: a pagina o nomeia);
 - "por unanimidade" -> 1 ACOMPANHOU por presente (inferido); a presenca e INFERIDA pelo colegiado em exercicio na data (JANELAS) enquanto a ata nao for lida;
 - "por maioria" sem nomear vencidos -> REVISAR (so a certidao nomeia);
 - "voto vencido do Diretor X" / "vencido o Diretor X" / "voto contrario" no texto (pagina, ata ou certidao) -> DIVERGIU nominal (analisa_decisao);
 - vista / impedimento / ausencia / retirada / abstencao / ressalva: ver analisa_decisao;
 - ex-membros so entram na presenca dentro da janela de exercicio (fora dela ficam fora dos totais)."""
import sys, os, json, re, html, datetime, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anac_lib as L

# ---------------- colegiado 2026 ----------------
# Composicao CONFIRMADA PELAS ATAS (34 atas lidas em 09/10/2026): ver JANELAS (evidencia de cada limite).
ATUAIS = ['Tiago Faierstein', 'Rui Mesquita', 'Antônio Mathias Moreira', 'Roberto Honorato', 'Cláudio Ianelli']
EX = ['Luiz Ricardo Nascimento', 'Mariana Altoé', 'Tiago Sousa Pereira']
ALIAS = {'tiago faierstein': 'Tiago Faierstein', 'tiago chagas faierstein': 'Tiago Faierstein', 'faierstein': 'Tiago Faierstein',
         'rui mesquita': 'Rui Mesquita', 'rui chagas mesquita': 'Rui Mesquita', 'mesquita': 'Rui Mesquita',
         'mathias moreira': 'Antônio Mathias Moreira', 'antonio mathias moreira': 'Antônio Mathias Moreira', 'antonio mathias nogueira moreira': 'Antônio Mathias Moreira', 'mathias': 'Antônio Mathias Moreira',
         'roberto honorato': 'Roberto Honorato', 'roberto jose silveira honorato': 'Roberto Honorato', 'honorato': 'Roberto Honorato',
         'claudio ianelli': 'Cláudio Ianelli', 'claudio beschizza ianelli': 'Cláudio Ianelli', 'ianelli': 'Cláudio Ianelli',
         'luiz ricardo nascimento': 'Luiz Ricardo Nascimento', 'luiz ricardo': 'Luiz Ricardo Nascimento', 'luiz ricardo de souza nascimento': 'Luiz Ricardo Nascimento',
         'mariana altoe': 'Mariana Altoé', 'altoe': 'Mariana Altoé', 'mariana olivieri caixeta altoe': 'Mariana Altoé',
         'tiago sousa pereira': 'Tiago Sousa Pereira', 'tiago pereira': 'Tiago Sousa Pereira'}
def _nz(s):
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', s.lower()) if unicodedata.category(c) != 'Mn').strip()
def canon(nome):
    """nome da fonte -> nome canonico, ou None se nao for membro conhecido do colegiado 2026."""
    n = re.sub(r'^(?:o|a)\s+', '', nome.strip(), flags=re.I)
    return ALIAS.get(_nz(re.sub(r'^(Diretor[a]?(?:-Presidente)?,?\s*|Presidente\s+)', '', n, flags=re.I)))
D = datetime.date.fromisoformat
# janela de exercicio (inclusiva) e a EVIDENCIA de cada limite, calibrada pelas atas. Usada SO para reunioes sem ata publicada (presenca inferida);
# nas demais a presenca e a REAL da ata. Tiago Sousa Pereira nao tem janela de presenca: so aparece como ausente justificado nas atas de janeiro.
JANELAS = {
 'Tiago Faierstein': (D('2026-01-01'), D('2026-12-31'), 'Diretor-Presidente: presidiu as 34 atas (RE1 06/01 .. RE29 15/09); mandato ate 19/03/2030 (gov.br)'),
 'Rui Mesquita': (D('2026-01-01'), D('2026-12-31'), 'presente nas 34 atas (06/01 .. 15/09); mandato ate 07/08/2029 (gov.br)'),
 'Antônio Mathias Moreira': (D('2026-01-01'), D('2026-12-31'), 'presente em 32 das 34 atas (ausente justificado nas RE24 e RE25, ago/2026); mandato ate 19/03/2030 (gov.br)'),
 'Luiz Ricardo Nascimento': (D('2026-01-01'), D('2026-03-22'), 'presente de RE1 (06/01) a RE9 (11-13/03) e RD2 (06/03); nao consta da RE10 (24/03) em diante; fim 22/03 INFERIDO pela posse de Roberto Honorato (23/03/2026) — nenhuma reuniao entre 14 e 23/03'),
 'Mariana Altoé': (D('2026-02-12'), D('2026-04-24'), 'primeira presenca atestada na RE6 ("nos dias 12 e 13 de fevereiro"); ausente das atas RE1-RE5 (ate 03/02); ultima presenca atestada na REX1 (06/04); fim 24/04 INFERIDO pela entrada de Claudio Ianelli (25/04/2026)'),
 'Roberto Honorato': (D('2026-03-23'), D('2026-12-31'), 'substituto desde 23/03/2026 (gov.br/diretoria-colegiada); primeira presenca atestada na RE10 (24/03/2026)'),
 'Cláudio Ianelli': (D('2026-04-25'), D('2026-12-31'), 'substituto desde 25/04/2026 (gov.br/diretoria-colegiada); primeira presenca atestada na RE11 (29/04/2026)')}
def presentes_em(datas):
    ds = [D(x) for x in datas]
    return [n for n, (a, b, _) in JANELAS.items() if any(a <= d <= b for d in ds)]

# ---------------- analisador de texto de decisao (pagina, ata ou certidao) ----------------
_N1 = r"[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ']+(?:\s+(?:(?:de|da|do|dos|das)\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ']+){0,5}"
_NOMES = r'(' + _N1 + r'(?:\s*(?:,|\se)\s+(?:(?:o|a|os|as)\s+)?(?:Diretor(?:a|es|as)?\s+)?' + _N1 + r')*)'
def _lista(trecho):
    """'Rui Mesquita e Roberto Honorato' / 'Rui, Mathias' -> nomes canonicos + trechos nao reconhecidos."""
    ok, nao = [], []
    for p in re.split(r',|\se\s|;', trecho):
        p = re.sub(r'^(?:o|a|os|as)\s+', '', p.strip(' .'))
        if not p: continue
        c = canon(p)
        if c: ok.append(c)
        elif re.match(r'[A-ZÁÉÍÓÚÂÊÔÃÕÇ]', p): nao.append(p)
    return ok, nao
def _achar(padroes, t):
    ok, nao = [], []
    for p in padroes:
        for m in re.finditer(p, t, flags=re.I):
            a, b = _lista(m.group(m.lastindex or 1)); ok += a; nao += b
    return list(dict.fromkeys(ok)), nao
_DIR = r'Diretor(?:a|es|as)?\s+'
def analisa_decisao(txt, processo_txt=''):
    """texto da deliberacao (+ texto bruto do campo Processo) -> dict(modo, tipo_item, vencidos, abstencoes, impedidos, ausentes,
    ressalvas, vista_por, voto_vista_de, retirada_por, nao_resolvidos, ad_referendum). So reconhece nomes do colegiado 2026."""
    t = re.sub(r'\s+', ' ', (txt or '')).strip(); lo = t.lower(); pt = re.sub(r'\s+', ' ', processo_txt or '')
    r = {'modo': '', 'vencidos': [], 'abstencoes': [], 'impedidos': [], 'ausentes': [], 'ressalvas': [], 'vista_por': None, 'voto_vista_de': None,
         'retirada_por': None, 'relator_vencido': False, 'relator_votou': '', 'propostas': [], 'nao_resolvidos': [], 'ad_referendum': 'ad referendum' in lo or 'ad referendum' in pt.lower()}
    if 'unanimidade' in lo: r['modo'] = 'unanimidade'
    if re.search(r'por maioria|\d+\s*\(?\w*\)?\s*votos? (?:a|contra) \d+', lo): r['modo'] = 'maioria'
    venc = [r'votos? vencidos? d[oa]s? ' + _DIR + _NOMES, r'vencid[oa]s? (?:o|a|os|as) ' + _DIR + _NOMES, r'com votos? contr[aá]rios? d[oa]s? ' + _DIR + _NOMES,
            r'diverg[eê]ncia d[oa]s? ' + _DIR + _NOMES, r'divergiu (?:o|a) ' + _DIR + _NOMES, _DIR + _NOMES + r'\s+(?:divergiu|votou contra|foi vencid[oa])']
    r['vencidos'], n1 = _achar(venc, t)
    r['relator_vencido'] = bool(re.search(r'vencid[oa] (?:o|a) Relator', t, flags=re.I))
    r['abstencoes'], n2 = _achar([r'absten[cç][aã]o d[oa]s? ' + _DIR + _NOMES, r'absteve-se (?:o|a) ' + _DIR + _NOMES, _DIR + _NOMES + r'\s+(?:se absteve|absteve-se)'], t)
    r['impedidos'], n3 = _achar([r'impedid[oa]s? (?:o|a|os|as) ' + _DIR + _NOMES, r'impedimento d[oa]s? ' + _DIR + _NOMES, _DIR + _NOMES + r'\s+(?:declarou-se|declarou se|esteve|estava|ficou) impedid'], t)
    r['ausentes'], n4 = _achar([r'ausen(?:te|tes|cia),? (?:d[oa]s?|o|a|os|as) ' + _DIR + _NOMES, _DIR + _NOMES + r'\s+(?:ausente|n[aã]o participou)', r'sem a participa[cç][aã]o d[oa]s? ' + _DIR + _NOMES], t)
    r['ressalvas'], n5 = _achar([r'com ressalvas? d[oa]s? ' + _DIR + _NOMES, r'ressalva d[oa]s? ' + _DIR + _NOMES], t)
    v1, n6 = _achar([r'pedido de vista d[oa]s? ' + _DIR + _NOMES, r'vista (?:concedida|requerida|solicitada) (?:a|ao|pela|pelo) ' + _DIR + _NOMES, r'pediu vista (?:o|a) ' + _DIR + _NOMES, r'pedido de vista formulado pel[oa] ' + _DIR + _NOMES, r'em virtude de pedido de vista (?:do|da|de) ' + _DIR + _NOMES, _DIR + _NOMES + r'\s+pediu vista'], t)
    r['vista_por'] = v1[0] if v1 else None
    vv, n7 = _achar([r'Voto-?Vista d[oa]s? ' + _DIR + _NOMES], t + ' ' + pt)
    r['voto_vista_de'] = vv[0] if vv else None
    rp, n8 = _achar([r'retirad[oa] (?:de pauta )?(?:pel[oa] )?' + _DIR + _NOMES], t)
    r['retirada_por'] = rp[0] if rp else None
    r['propostas'] = [c for c in dict.fromkeys(canon(m.group(1)) for m in re.finditer(r'Diretor[a]? (' + _N1 + r') (?:recomendou|propôs|sugeriu)', t)) if c]
    mrv = re.search(r'o Relator votou (?:pel[oa]s?|contra|a favor)\s+(.+?)(?:\.|;|$)', t)
    if mrv: r['relator_votou'] = mrv.group(0).strip()
    r['nao_resolvidos'] = list(dict.fromkeys(n1 + n2 + n3 + n4 + n5 + n6 + n7 + n8))
    return r
def classifica(delib, assunto=''):
    d = (delib or '').lower(); a = (assunto or '').lower()
    if 'vista' in d: return 'Vista'
    if 'retirad' in d or 'adiad' in d or 'sobrest' in d: return 'Retirada de pauta'
    if ('ata' in d.split() or 'aprovação da ata' in d or 'aprovacao da ata' in d or 'aprovação da ata' in a) and 'aprova' in d + a: return 'Aprovação de ata'
    if 'cancel' in d: return 'Cancelada'
    return 'Deliberação'
def partes_de(txt, modo, an):
    """'quanto ao item X, por maioria; quanto ao item Y, por unanimidade' -> varias partes; senao 1 parte (I)."""
    seg = [s.strip() for s in re.split(r';|\.\s+(?=Quanto|No que)', txt or '') if s.strip()]
    cab = [s for s in seg if re.match(r'(?:quanto|no que se refere) (?:ao|à|aos|às)\b', s, flags=re.I)]
    rom = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']
    if len(cab) >= 2:
        ps = []
        for i, s in enumerate(cab[:8]):
            a = analisa_decisao(s)
            ps.append({'parte': rom[i], 'acao': s, 'modo': a['modo'], 'vencidos': a['vencidos'], 'abstencoes': a['abstencoes'], 'impedidos': a['impedidos'], 'ressalvas': a['ressalvas']})
        return ps
    return [{'parte': 'I', 'acao': txt or '', 'modo': modo, 'vencidos': an['vencidos'], 'abstencoes': an['abstencoes'], 'impedidos': an['impedidos'], 'ressalvas': an['ressalvas']}]

# ---------------- leitura de documentos SEI (ata, certidao de deliberacao, voto) ----------------
def norm(t): return re.sub(r'\s+,', ',', re.sub(r'\s+', ' ', (t or '').replace('\u200b', ''))).replace('V erificado', 'Verificado').strip()
def _nomes(seg):
    ok, nao = [], []
    for p in re.split(r',\s*|\s+e\s+', seg):
        p = p.strip(' .')
        if not p: continue
        c = canon(p)
        if c: ok.append(c)
        else: nao.append(p)
    return ok, nao
def le_presenca(t):
    """preambulo da ata -> presidente, presentes, ausentes (justificados), parcial {nome: 'nos dias ...'}, nao_resolvidos."""
    t = norm(t); i = t.find('teve início'); j = t.find('Verificado', i if i >= 0 else 0)
    pre = t[i:j] if i >= 0 and j > 0 else t[max(i, 0):max(i, 0) + 2500]
    out = {'presidente': None, 'presentes': [], 'ausentes': [], 'parcial': {}, 'nao_resolvidos': []}
    m = re.search(r'presidida pel[oa] Diretor[a]?-Presidente,\s*(.+?)\s*,', pre)
    if m: out['presidente'] = canon(m.group(1))
    m = re.search(r'dos Diretores\s+(.*?)(?:,\s*(?:foi\s+)?secretariada|,?\s+e\s+d[aoe]s?\s+(?:[Pp]rocurador|representante))', pre)
    if m:
        seg = re.sub(r',?\s*por meio de videoconfer[eê]ncia', '', m.group(1))
        mp = re.search(r',?\s*(nos dias [^,]*? de \d{4})\s*$', seg)
        if mp: seg = seg[:mp.start()]
        ok, nao = _nomes(seg); out['presentes'] = ok; out['nao_resolvidos'] += nao
        if mp and ok: out['parcial'][ok[-1]] = mp.group(1)
    for m in re.finditer(r'ausentes?\s+justificadamente\s+(?:o|a|os|as)\s+Diretor(?:a|es|as)?\s+([^.]+?)\s*\.', pre):
        ok, nao = _nomes(m.group(1)); out['ausentes'] += ok; out['nao_resolvidos'] += nao
    if out['presidente'] and out['presidente'] not in out['presentes']: out['presentes'].insert(0, out['presidente'])
    return out
_REL = re.compile(r'Relatoria d[oa]s?\s+(?:Diretor[a]?(?:-Presidente)?,?\s*)?(.+?)(?:,\s*apresentação de Voto-Vista d[oa] Diretor[a]?\s+(.+?))?:\s')
_ITEM = re.compile(r'(\d+)\s*\)\s*Processo:\s*(\d{5}\.\d{6}/\d{4}-\d{2})')
_FIM = re.compile(r'A reunião encerrou-se|Nada mais havendo|Em \d+ de \w+ de \d{4}, foi submetido|Na sequência, procedeu-se')
def le_ata(t):
    """texto da ata -> dict(presenca=le_presenca, itens=[{n, processo, relator, voto_vista_de, extrapauta, ad_referendum, chunk, decisao}])."""
    t = norm(t); k = t.find('Verificado'); corpo = t[k:] if k >= 0 else t
    e = corpo.find('Documento assinado eletronicamente'); corpo = corpo[:e] if e > 0 else corpo
    ims = list(_ITEM.finditer(corpo)); rms = list(_REL.finditer(corpo)); itens = []
    for n, m in enumerate(ims):
        ant = ims[n - 1].end() if n else 0
        rm = [r for r in rms if r.end() <= m.start() + 1]   # o marcador 'Relatoria do Diretor X:' vale ate o proximo marcador
        nxt = ims[n + 1].start() if n + 1 < len(ims) else len(corpo)
        corte = [x.start() for x in rms if x.start() > m.end() and x.start() <= nxt] + [x.start() + m.end() for x in _FIM.finditer(corpo[m.end():nxt])]
        fim = min(corte + [nxt])
        chunk = corpo[m.start():fim].strip(); dm = re.search(r'Decisão:\s*(.*)', chunk)
        adr = 'ad referendum' in corpo[ant:m.start()]   # confirmacao de decisao ad referendum: o relator e o Diretor-Presidente (so a certidao o nomeia)
        itens.append({'n': m.group(1), 'processo': m.group(2), 'relator': None if adr else (canon(rm[-1].group(1)) if rm else None),
                      'voto_vista_de': canon(rm[-1].group(2)) if rm and rm[-1].group(2) else None,
                      'extrapauta': 'extrapauta' in corpo[ant:m.start()], 'ad_referendum': 'ad referendum' in corpo[ant:m.start()],
                      'chunk': chunk, 'decisao': dm.group(1).strip() if dm else re.sub(r'^.*?Assunto:[^;]*;\s*', '', chunk)})
    return {'presenca': le_presenca(t), 'itens': itens}
def le_certidao(t):
    """certidao de deliberacao -> dict(processo, relator, deliberacao, codigos_voto, ad_referendum, reuniao_txt) ou None."""
    t = norm(t); proc = L.PROC_RE.search(t); r = {'processo': proc.group(0) if proc else '', 'relator': None, 'deliberacao': '', 'codigos_voto': [], 'ad_referendum': False}
    mr = re.search(r'apreciação da matéria abaixo na (.+?), realizada', t) or re.search(r'pela Diretoria Colegiada na (.+?), realizada', t)
    r['reuniao_txt'] = mr.group(1) if mr else ''
    m = re.search(r'Relator (.+?) Deliberação (.*?)(?: Ato decorrente| À | Ao | Documento assinado|$)', t)
    if m: r['relator'] = canon(m.group(1)); r['deliberacao'] = m.group(2).strip()
    else:
        m = re.search(r'Certifico que (.*?)(?: À | Ao | Documento assinado|$)', t)
        if not m: return None
        r['deliberacao'] = m.group(1).strip(); r['ad_referendum'] = 'ad referendum' in t
        mp = re.search(r'ad referendum do Diretor-Presidente, ([\wÀ-ÿ ]+?) \(', t); r['relator'] = canon(mp.group(1)) if mp else None
    r['codigos_voto'] = list(dict.fromkeys(re.findall(r'DIR-[A-Z]+', r['deliberacao'])))
    return r
def assina_voto(t):
    """Voto/Voto-vista -> nome canonico de quem assina (1o 'Documento assinado eletronicamente por')."""
    m = re.search(r'Documento assinado eletronicamente por (.+?)\s*,', norm(t)); return canon(m.group(1)) if m else None

# ---------------- votos de um item ----------------
def votos_item(rid, data, proc, nitem, tipo, an, relator, presentes, partes, extra=None, ausentes=()):
    """uma linha por presente (+ AUSENTE nominal para ausentes justificados). Devolve lista de dicts de voto."""
    extra = extra or {}; out = []; real = extra.get('presenca_real'); fonte = extra.get('fonte', 'página'); ad = ('; item ad referendum (confirmação pela Diretoria)' if an['ad_referendum'] else '')
    por_parte = ''
    if len(partes) > 1:
        por_parte = '; '.join(f"{p['parte']}: " + ('divergentes ' + ', '.join(p['vencidos']) if p['vencidos'] else (p['modo'] or '?')) for p in partes)
    pres_txt = 'presença nominal da ata' if real else 'presença inferida pelo colegiado em exercício; ata não publicada'
    for dn in ausentes:
        out.append({'reuniao': rid, 'data': data, 'processo': proc, 'deliberacao': nitem, 'diretor': dn, 'voto': 'AUSENTE (ausente justificadamente)', 'proveniencia': 'nominal', 'voto_por_parte': por_parte, 'motivo': 'ata: "ausente justificadamente o Diretor ' + dn + '"'})
    for dn in presentes:
        v, pv, mt = None, None, None
        if dn in an['impedidos']: v, pv, mt = 'IMPEDIDO', 'nominal', 'texto da decisão nomeia o impedimento' + (' (ata: ' + extra['impedimento_motivo'] + ')' if extra.get('impedimento_motivo') else '')
        elif dn in an['ausentes']: v, pv, mt = 'AUSENTE', 'nominal', 'texto da decisão nomeia a ausência'
        elif tipo == 'Retirada de pauta':
            if dn == relator or dn == an['retirada_por']: v, pv, mt = 'RELATOR (retirou o item de pauta; sem voto de mérito)', 'nominal', 'ata/página: "Retirado de pauta pelo Relator"' if dn == relator else 'texto nomeia quem retirou'
            else: v, pv, mt = 'SEM VOTO (retirado de pauta)', 'inferido', 'item retirado de pauta: não houve votação do mérito'
        elif tipo == 'Vista':
            req = an['vista_por'] or extra.get('vista_por')
            if dn == req: v, pv, mt = 'PEDIU VISTA', extra.get('vista_prov', 'nominal'), extra.get('vista_motivo', 'ata: "em virtude de pedido de vista formulado pelo Diretor ' + dn + '"')
            elif dn == relator:
                if an['relator_votou']: v, pv, mt = 'RELATOR (votou antes da vista)', 'nominal', 'ata: "' + an['relator_votou'][:200] + '"; item retirado de pauta por pedido de vista'
                else: v, pv, mt = 'RELATOR (vista concedida; sem voto de mérito proferido)', 'nominal', 'relator nomeado; item retirado de pauta por pedido de vista'
            else: v, pv, mt = 'SEM VOTO AINDA (vista pendente)', 'inferido', 'deliberação suspensa por pedido de vista; os demais não votaram na reunião'
            if req is None and dn != relator:
                pv, mt = 'REVISAR', 'pedido de vista sem o nome de quem pediu (ata/certidão não lida)'
        elif dn == an['voto_vista_de'] and extra.get('voto_vista_item'):
            if extra.get('vv_prevaleceu'): v, pv, mt = 'VOTOU (autor do Voto-Vista, que prevaleceu por maioria)', 'nominal', 'certidão/ata: "por maioria - vencido o Relator, nos termos do Voto-Vista"; Voto-Vista assinado por ' + dn + ' (SEI)'
            else: v, pv, mt = 'VOTOU (apresentou voto-vista; sentido do voto não lido)', 'nominal', 'a página nomeia o autor do Voto-Vista; o sentido do voto está no documento SEI'
        elif dn == relator and an['relator_vencido']: v, pv, mt = 'DIVERGIU (Relator vencido)', 'nominal', 'ata/certidão: "por maioria - vencido o Relator, nos termos do Voto-Vista"' + ('; ' + an['relator_votou'] if an['relator_votou'] else '')
        elif dn == relator: v, pv, mt = 'RELATOR', 'nominal', 'relator nomeado na ata/certidão/página'
        elif dn in an['vencidos']: v, pv, mt = 'DIVERGIU', 'nominal', 'texto da decisão nomeia o voto vencido'
        elif dn in an['abstencoes']: v, pv, mt = 'SEM VOTO (abstenção)', 'nominal', 'texto da decisão nomeia a abstenção'
        elif dn in an['ressalvas']: v, pv, mt = 'ACOMPANHOU (com ressalva)', 'nominal', 'texto da decisão nomeia a ressalva'
        elif dn in extra.get('voto_proprio', {}): v, pv, mt = 'ACOMPANHOU (voto escrito próprio, acompanhando o Relator)', 'nominal', extra['voto_proprio'][dn]
        elif dn in an.get('propostas', []): v, pv, mt = 'ACOMPANHOU (com recomendação/proposta própria registrada em ata)', 'nominal', 'ata: "o Diretor ' + dn + ' recomendou/propôs ..." além da decisão por unanimidade'
        elif an['modo'] == 'unanimidade': v, pv, mt = 'ACOMPANHOU', 'inferido', f'unanimidade declarada ({fonte}): todo presente acompanhou ({pres_txt})' + ad
        elif an['modo'] == 'maioria' and (an['vencidos'] or an['relator_vencido']): v, pv, mt = 'ACOMPANHOU', 'inferido', 'maioria com vencido(s) nomeado(s) (' + ('o Relator' if an['relator_vencido'] else ', '.join(an['vencidos'])) + '): os demais presentes acompanharam'
        elif an['modo'] == 'maioria': v, pv, mt = 'SEM VOTO (maioria sem vencidos nomeados)', 'REVISAR', 'a decisão diz "por maioria" sem nomear os vencidos'
        else: v, pv, mt = 'SEM VOTO (decisão sem modo de votação)', 'REVISAR', 'texto da decisão não diz unanimidade nem maioria'
        out.append({'reuniao': rid, 'data': data, 'processo': proc, 'deliberacao': nitem, 'diretor': dn, 'voto': v, 'proveniencia': pv, 'voto_por_parte': por_parte, 'motivo': mt})
    return out

# trechos REAIS (copiados das atas/certidoes SEI de 2026) usados no autoteste; o corpus completo e testado em --autoteste quando texto_anac/ existe
REAL_PRESENCA = ('Aos seis dias do mês de janeiro de dois mil e vinte e seis, às doze horas, teve início a 1ª Reunião Deliberativa Eletrônica da Diretoria Colegiada da Agência Nacional de Aviação Civil - ANAC. '
    'A sessão foi presidida pelo Diretor-Presidente, Tiago Chagas Faierstein , contou com a participação dos Diretores Luiz Ricardo de Souza Nascimento , Rui Chagas Mesquita e Antonio Mathias Nogueira Moreira , '
    'foi secretariada pela Chefe da Assessoria Técnica, Ana Carolina Motta Rezende , e acompanhada pela Procuradora, Renata Cordeio Uchoa Florencio , ausente justificadamente o Diretor Tiago Sousa Pereira . Verificado o quórum')
REAL_PARCIAL = ('teve início a 6ª Reunião Deliberativa Eletrônica. A sessão foi presidida pelo Diretor-Presidente, Tiago Chagas Faierstein , contou com a participação dos Diretores Luiz Ricardo de Souza Nascimento , Rui Chagas Mesquita , '
    'Antonio Mathias Nogueira Moreira e Mariana Olivieri Caixeta Altoé , nos dias 12 e 13 de fevereiro de 2026, foi secretariada pela Chefe da Assessoria Técnica, Ana Carolina Motta Rezende , e acompanhada pelo Procurador-Geral, Diogo Souza Moraes . Verificado o quórum')
REAL_VIDEO = ('teve início a 3ª Reunião Deliberativa. A sessão foi presidida pelo Diretor-Presidente, Tiago Chagas Faierstein , secretariada pela Chefe da Assessoria Técnica, Ana Carolina Motta Rezende , e contou com a presença dos Diretores '
    'Rui Chagas Mesquita , Antonio Mathias Nogueira Moreira , por meio de videoconferência, Mariana Olivieri Caixeta Altoé e Roberto José Silveira Honorato , e do Procuradora-Geral, Diogo Souza Moraes , por meio de videoconferência. Verificado o quórum')
REAL_ATA_RE7 = ('Verificado o quórum para a instalação da reunião eletrônica, procedeu-se à deliberação dos seguintes processos: Relatoria do Diretor Rui Mesquita: 1) Processo: 00058.018087/2019-24 ; Interessado: Concessionária do Aeroporto de Salvador S.A.; '
    'Assunto: pedido de isenção de cumprimento do requisito; Retirado de pauta , em virtude de pedido de vista formulado pelo Diretor Luiz Ricardo Nascimento. Na ocasião, o Relator votou pelo deferimento parcial do pedido de isenção, concedendo isenção temporária do requisito pelo prazo de 24 (vinte e quatro) meses; '
    'Relatoria do Diretor Mathias Moreira: 2) Processo: 00065.051404/2025-73 ; Interessado: Renan Machado Melo; Assunto: recurso administrativo; Decisão: negado provimento , por unanimidade, mantendo-se a decisão. '
    'Na ocasião, a Diretora Mariana Altoé declarou-se impedida de votar em razão dos atos processuais praticados na qualidade de Superintendente de Pessoal da Aviação Civil, conforme documento nº SEI 12875466 . A reunião encerrou-se às vinte e três horas')
REAL_ATA_RE9 = ('Verificado o quórum para instalação da reunião eletrônica, procedeu-se à deliberação do seguinte processo: Relatoria do Diretor Rui Mesquita, apresentação de Voto-Vista do Diretor Luiz Ricardo Nascimento: 1) Processo: 00058.018087/2019-24; '
    'Interessado: Concessionária do Aeroporto de Salvador S.A.; Assunto: pedido de isenção; Decisão: deferido parcialmente, por maioria - vencido o Relator, nos termos do Voto-Vista, o pedido, na forma de isenção temporária, pelo período de sessenta meses. '
    'Na ocasião, o Relator manteve o voto proferido na 7ª Reunião Deliberativa Eletrônica, propondo o deferimento da isenção do requisito pelo prazo de vinte e quatro meses. Em 11 de março de 2026, foi submetido e admitido, extrapauta, o seguinte processo: '
    'Relatoria do Diretor Rui Mesquita: 2) Processo: 00058.024978/2025-68; Assunto: prorrogação; Decisão: aprovada, por unanimidade, a prorrogação. A reunião encerrou-se')
REAL_ATA_RE6 = ('Verificado o quórum: Relatoria do Diretor Luiz Ricardo Nascimento: 1) Processo: 00058.078676/2024-29 ; Interessado: VOAR; Assunto: pedido de revisão; Retirado de pauta , em virtude de pedido de vista formulado pelo Diretor Rui Mesquita. '
    'Na ocasião, o Relator votou pelo deferimento do pedido de revisão, alterando-se a decisão. Em 13 de fevereiro de 2026, foi submetido e admitido, extrapauta , o seguinte processo: Relatoria do Diretor Rui Mesquita: 2) Processo: 00066.001958/2022-77 ; '
    'Assunto: alteração; Decisão: aprovada , por unanimidade, nos termos propostos pela SPO. A reunião encerrou-se')
REAL_CERT_MAIORIA = ('SEI/ANAC - 13000835 - Certidão de Deliberação Certidão de Deliberação Certifico o resultado da apreciação da matéria abaixo na 9ª Reunião Deliberativa Eletrônica da Diretoria Colegiada, realizada nos dias 11 a 13.03.2026: '
    'Processo 00058.018087/2019-24 Interessado Concessionária do Aeroporto de Salvador S.A. Assunto Pedido de isenção Relator Diretor Rui Mesquita Deliberação Deferido parcialmente, por maioria - vencido o Relator, nos termos do Voto-Vista DIR-LRI ( 12909887 ) '
    'Ato decorrente Decisão nº 741, de 16 de março de 2026 ( 12995709 ) À Superintendência')
REAL_CERT_ADREF = ('Certidão de Deliberação Referência: Processo nº 00058.112066/2025-42. Assunto: Proposta de alteração do Edital. Certifico que a decisão ad referendum do Diretor-Presidente, Tiago Faierstein ( 12544570 e 12545326 ), foi confirmada , por unanimidade, '
    'pela Diretoria Colegiada na 1ª Reunião Deliberativa Eletrônica, realizada nos dias 6 a 7 de janeiro de 2026. À Superintendência de Regulação Econômica de Aeroportos, em restituição.')
REAL_ATA_RE3 = ('Verificado: Relatoria do Diretor Rui Mesquita: 1) Processo: 00058.024978/2025-68 ; Assunto: proposta; Decisão: aprovada , por unanimidade, nos termos propostos. Na ocasião, o Diretor Luiz Ricardo Nascimento recomendou à Superintendência de Pessoal da Aviação Civil - SPL '
    'que, após a etapa de Consulta Pública, deverão ser envidados esforços para a proposição de solução regulatória. A reunião encerrou-se')

def autoteste():
    """casos SINTETICOS do analisador + trechos REAIS de ata/certidao (copiados do SEI) + varredura do corpus real (texto_anac/) quando existe."""
    c = [("Aprovado por maioria, com voto vencido do Diretor Rui Mesquita", lambda a: a['modo'] == 'maioria' and a['vencidos'] == ['Rui Mesquita']),
         ("Deferido por maioria, vencidos o Diretor Roberto Honorato e o Diretor Cláudio Ianelli", lambda a: a['vencidos'] == ['Roberto Honorato', 'Cláudio Ianelli']),
         ("Aprovado por unanimidade", lambda a: a['modo'] == 'unanimidade' and not a['vencidos']),
         ("Aprovado por unanimidade, com ressalva do Diretor Tiago Faierstein", lambda a: a['ressalvas'] == ['Tiago Faierstein']),
         ("Aprovado. Impedido o Diretor Mathias Moreira", lambda a: a['impedidos'] == ['Antônio Mathias Moreira']),
         ("Diretor Rui Mesquita declarou-se impedido", lambda a: a['impedidos'] == ['Rui Mesquita']),
         ("Retirado de pauta - pedido de vista do Diretor Luiz Ricardo Nascimento", lambda a: a['vista_por'] == 'Luiz Ricardo Nascimento'),
         ("Retirado de pauta pelo Relator", lambda a: classifica("Retirado de pauta pelo Relator") == 'Retirada de pauta'),
         ("Aprovado por unanimidade, ausente o Diretor Cláudio Ianelli", lambda a: a['ausentes'] == ['Cláudio Ianelli']),
         ("Aprovado por maioria, com abstenção do Diretor Rui Mesquita", lambda a: a['abstencoes'] == ['Rui Mesquita']),
         ("Aprovado por maioria, voto vencido do Diretor Fulano de Tal", lambda a: a['vencidos'] == [] and a['nao_resolvidos'] == ['Fulano de Tal'])]
    bad = [t for t, f in c if not f(analisa_decisao(t))]
    c2 = analisa_decisao('Aprovado por unanimidade', '00058.018087/2019-24 (Apresentação de Voto-Vista do Diretor Luiz Ricardo Nascimento)')
    if c2['voto_vista_de'] != 'Luiz Ricardo Nascimento': bad.append('voto-vista no campo Processo')
    assert classifica('Aprovação da ata da reunião anterior') == 'Aprovação de ata' and classifica('Cancelada') == 'Cancelada' and classifica('Retirado de pauta - pedido de vista') == 'Vista'
    ps = partes_de('Quanto ao item 1, por maioria, vencido o Diretor Rui Mesquita; quanto ao item 2, por unanimidade', 'maioria', analisa_decisao('x'))
    if len(ps) != 2 or ps[0]['vencidos'] != ['Rui Mesquita'] or ps[1]['modo'] != 'unanimidade': bad.append('partes')
    n_real = 0
    def ck(nome, cond):
        nonlocal n_real; n_real += 1
        if not cond: bad.append('REAL: ' + nome)
    p = le_presenca(REAL_PRESENCA); ck('presença RE1 (4 presentes + Tiago Pereira ausente)', p['presidente'] == 'Tiago Faierstein' and p['presentes'] == ['Tiago Faierstein', 'Luiz Ricardo Nascimento', 'Rui Mesquita', 'Antônio Mathias Moreira'] and p['ausentes'] == ['Tiago Sousa Pereira'] and not p['nao_resolvidos'])
    p = le_presenca(REAL_PARCIAL); ck('presença parcial RE6 (Mariana só em 12 e 13/02)', 'Mariana Altoé' in p['presentes'] and p['parcial'] == {'Mariana Altoé': 'nos dias 12 e 13 de fevereiro de 2026'} and len(p['presentes']) == 5)
    p = le_presenca(REAL_VIDEO); ck('presença RD3 com "por meio de videoconferência"', p['presentes'] == ['Tiago Faierstein', 'Rui Mesquita', 'Antônio Mathias Moreira', 'Mariana Altoé', 'Roberto Honorato'])
    a = le_ata(REAL_ATA_RE7); i1, i2 = a['itens']; an1 = analisa_decisao(i1['chunk'])
    ck('RE7 item 1: vista pedida por Luiz Ricardo, relator votou antes', i1['relator'] == 'Rui Mesquita' and an1['vista_por'] == 'Luiz Ricardo Nascimento' and 'deferimento parcial' in an1['relator_votou'] and classifica(i1['decisao']) == 'Vista')
    an2 = analisa_decisao(i2['chunk']); ck('RE7 item 2: impedimento de Mariana + unanimidade', i2['relator'] == 'Antônio Mathias Moreira' and an2['impedidos'] == ['Mariana Altoé'] and an2['modo'] == 'unanimidade')
    a = le_ata(REAL_ATA_RE9); i1, i2 = a['itens']; an = analisa_decisao(i1['chunk']); ck('RE9 item 1: maioria, relator vencido, voto-vista de Luiz Ricardo', an['modo'] == 'maioria' and an['relator_vencido'] and i1['voto_vista_de'] == 'Luiz Ricardo Nascimento' and not an['vencidos'])
    ck('RE9 item 2: extrapauta, unanimidade, sem herdar o vencido do item 1', i2['extrapauta'] and analisa_decisao(i2['chunk'])['modo'] == 'unanimidade' and not analisa_decisao(i2['chunk'])['relator_vencido'])
    a = le_ata(REAL_ATA_RE6); i1, i2 = a['itens']; an = analisa_decisao(i1['chunk']); ck('RE6 item 1: vista pedida por Rui Mesquita (não pelo relator Luiz Ricardo)', an['vista_por'] == 'Rui Mesquita' and i1['relator'] == 'Luiz Ricardo Nascimento' and 'deferimento' in an['relator_votou'])
    ck('RE6 item 2: extrapauta, relator Rui, unanimidade', i2['extrapauta'] and i2['relator'] == 'Rui Mesquita' and analisa_decisao(i2['chunk'])['modo'] == 'unanimidade' and not analisa_decisao(i2['chunk'])['vista_por'])
    ce = le_certidao(REAL_CERT_MAIORIA); ck('certidão RE9 (maioria, vencido o Relator, Voto-Vista DIR-LRI)', ce['relator'] == 'Rui Mesquita' and ce['codigos_voto'] == ['DIR-LRI'] and analisa_decisao(ce['deliberacao'])['relator_vencido'])
    ce = le_certidao(REAL_CERT_ADREF); ck('certidão ad referendum (relator = Diretor-Presidente)', ce['ad_referendum'] and ce['relator'] == 'Tiago Faierstein' and analisa_decisao(ce['deliberacao'])['modo'] == 'unanimidade')
    a = le_ata(REAL_ATA_RE3); ck('RE3: recomendação própria de Luiz Ricardo registrada na ata', analisa_decisao(a['itens'][0]['chunk'])['propostas'] == ['Luiz Ricardo Nascimento'])
    # corpus real completo (se baixado): toda ata deve fechar a presenca e cada item deve ter processo; nenhuma certidao pode ficar sem relator
    if os.path.exists('manifesto_anac.json') and os.path.isdir('texto_anac'):
        mf = json.load(open('manifesto_anac.json')); na = nc = 0
        for x in mf:
            f = os.path.join('texto_anac', str(x.get('id')) + '.txt')
            if not (x.get('texto') and os.path.exists(f)): continue
            tx = open(f, errors='replace').read()
            if x['tipo'] == 'documento (Ata)':
                a = le_ata(tx); na += 1; pr = a['presenca']
                ck('ata ' + x['reuniao'] + ': presidente + >=2 diretores, nomes todos resolvidos, itens com relator', pr['presidente'] == 'Tiago Faierstein' and len(pr['presentes']) >= 3 and not pr['nao_resolvidos'] and a['itens'] and all(i['relator'] or i['ad_referendum'] for i in a['itens']))
            elif x['tipo'] == 'documento (Certidão de deliberação)':
                ce = le_certidao(tx); nc += 1
                ck('certidão ' + str(x['reuniao']) + ' item ' + str(x['item']), ce is not None and ce['deliberacao'] and ce['relator'])
        print(f'  corpus real: {na} atas e {nc} certidões lidas')
    print('autoteste (sintético + real):', len(c) + 3 + n_real, 'casos,', 'FALHAS:' if bad else 'todos ok', bad if bad else ''); return 1 if bad else 0

if len(sys.argv) > 1 and sys.argv[1] == '--autoteste': sys.exit(autoteste())
if len(sys.argv) > 2 and sys.argv[1] == '--pagina':
    h = open(sys.argv[2], errors='replace').read(); print(L.cabecalho(h)['titulo'], '|', L.cabecalho(h)['data_txt'])
    for i in L.itens(h): print(i['n'], i['processo'], '|', i['campos'].get('Relator'), '|', i['campos'].get('Deliberação'))
    sys.exit(0)

# ======================= pipeline =======================
MAN, INV, OUT = sys.argv[1:4]; DIRF = 'fonte/anac'; TXTD = 'texto_anac'
inv = json.load(open(INV)); man = json.load(open(MAN)); HOJE = inv['calendario']['hoje']
URL_GOV = 'https://www.gov.br/anac/pt-br/acesso-a-informacao/institucional/diretoria-colegiada'
def le_doc(e):
    f = os.path.join(TXTD, str(e.get('id')) + '.txt')
    return open(f, errors='replace').read() if e.get('texto') and os.path.exists(f) else ''
DOCS = {e['url']: e for e in man if e['tipo'].startswith('documento')}
ATAS = {e['reuniao']: e for e in man if e['tipo'] == 'documento (Ata)' and e.get('texto')}
CERTS = {(e['reuniao'], e['item']): e for e in man if e['tipo'] == 'documento (Certidão de deliberação)' and e.get('texto')}
VOTOS_DOC = collections.defaultdict(list)
for e in man:
    if e['tipo'] in ('documento (Voto)', 'documento (Voto-vista)') and e.get('texto'): VOTOS_DOC[(e['reuniao'], e['item'])].append(e)
reun, delib, votos, pend, conflitos = [], [], [], [], []
docs_nao_lidos = []
N_FUT = N_SEMRES = 0
todos = []
for r in sorted(inv['reunioes_2026'], key=lambda x: (x['datas'][0], x['reuniao'])):
    h = open(os.path.join(DIRF, r['arquivo']), errors='replace').read(); cb = L.cabecalho(h); its = L.itens(h)
    todos.append((r, cb, its))
# voto-vista posterior (pagina): processo -> diretor (cruzamento entre reunioes)
vv_por_proc = {}
for r, cb, its in todos:
    for it in its:
        a = analisa_decisao(it['campos'].get('Deliberação', ''), it['processo_txt'])
        if a['voto_vista_de']: vv_por_proc.setdefault(it['processo'], (a['voto_vista_de'], r['reuniao'], r['datas'][0]))
n_modo_ok = n_modo_tot = 0
for r, cb, its in todos:
    rid = r['reuniao']; data = r['datas'][0]; futura = data > HOJE
    decididos = [i for i in its if i['campos'].get('Deliberação')]
    ata_e = ATAS.get(rid); ata = le_ata(le_doc(ata_e)) if ata_e else None
    if ata and decididos:
        pa = ata['presenca']; pres = [n for n in (ATUAIS + EX) if n in pa['presentes']]; aus = [n for n in (ATUAIS + EX) if n in pa['ausentes']]
        for nm in pa['nao_resolvidos']: pend.append(['ANAC', f'{rid} — nome na presença da ata não mapeado', data, 'REVISAR', nm, 'nome fora do colegiado conhecido', 'mapear em ALIAS', ata_e['url']])
        presenca = 'real (ata)'
    else:
        pres = presentes_em(r['datas']) if decididos else []; aus = []; presenca = 'inferida' if decididos else 'inexistente'
        rel_extra = [c for c in (canon(i['campos'].get('Relator', '')) for i in its) if c and c not in pres and decididos]
        pres += rel_extra; pres = [n for n in (ATUAIS + EX) if n in pres]
    ata_url = cb['links'].get('Ata'); situ = ('Futura (pauta publicada)' if futura else ('Realizada (deliberações publicadas)' if decididos else 'Realizada, resultado ainda não publicado'))
    if ata and decididos:
        par = ata['presenca']['parcial']
        obs = 'presença REAL lida na ata (SEI ' + ata_e['url'].split('id_documento=')[1].split('&')[0] + '): ' + str(len(pres)) + ' presentes' + (f', ausente(s) justificado(s): {", ".join(aus)}' if aus else '') + ('; participação parcial: ' + '; '.join(f'{k} {v}' for k, v in par.items()) if par else '')
    elif decididos: obs = 'presença INFERIDA pelo colegiado em exercício na data (ata ainda não publicada: página diz "Ata em breve"; ausências/impedimentos só aparecem na ata)'
    else: obs = 'reunião futura: pauta publicada, sem presença nem votos' if futura else 'sem deliberações publicadas na página ("Ata em breve"): presença e votos ainda inexistentes na fonte'
    fontes = [{'tipo': 'página da reunião (APEX)', 'url': r['url']}, {'tipo': 'pauta (APEX)', 'url': r['url_pauta']}]
    if ata_url: fontes.append({'tipo': 'ata (SEI) — lida' if ata_e else 'ata (SEI)', 'url': ata_url})
    if cb['links'].get('Vídeo'): fontes.append({'tipo': 'vídeo (YouTube) — fora de escopo', 'url': cb['links']['Vídeo']})
    reun.append({'reuniao': rid, 'titulo': f"{cb['titulo']} ({r['realizacao']})", 'tipo': ('Extraordinária eletrônica' if r['extraordinaria'] else ('Eletrônica' if r['tipo'] == 'eletronica' else 'Presencial')), 'data': data, 'datas': r['datas'],
                 'presentes': pres, 'ausentes': aus, 'obs': obs, 'situacao': situ, 'presenca': presenca, 'id_apex': r['id_apex'], 'url_ata': ata_url or '', 'fontes': fontes,
                 'presenca_parcial': ata['presenca']['parcial'] if ata else {}, 'evidencia_data': ['índice APEX: ' + r['realizacao'], 'cabeçalho da página: ' + cb['data_txt']]})
    usados = set()
    for it in its:
        c = it['campos']; proc = it['processo']; txt = c.get('Deliberação', ''); rel_raw = c.get('Relator', ''); rel = canon(rel_raw) or rel_raw
        urls = {rot: u for rot, u in it['docs']}; voto_doc = next((u for rot, u in it['docs'] if rot == 'Voto'), '')
        docs_item = []
        for rot, u in it['docs']:
            e = DOCS.get(u, {}); docs_item.append({'rotulo': rot, 'url': u, 'sha256': e.get('sha256', ''), 'lido': bool(e.get('texto'))})
            if u in DOCS and not e.get('texto') and not any(x['url'] == u for x in docs_nao_lidos):
                docs_nao_lidos.append({'url': u, 'rotulo': rot, 'reuniao': rid, 'item': it['n'], 'motivo': e.get('motivo_texto') or 'conteúdo não extraído', 'sha256': e.get('sha256', '')})
        base = {'reuniao': rid, 'data': data, 'processo': proc, 'deliberacao': it['n'], 'item_n': it['n'], 'relator': rel, 'interessado': '', 'assunto': c.get('Assunto', ''), 'voto_doc': voto_doc,
                'secao': 'Processos deliberados', 'unidade': '', 'origem': r['url'], 'documentos': docs_item, 'id_apex': r['id_apex']}
        if it['processo_txt'] != proc: base['processo_txt'] = it['processo_txt']
        if rel_raw and not canon(rel_raw): pend.append(['ANAC', f'{rid} item {it["n"]} — relator fora do colegiado 2026 conhecido', data, 'REVISAR', f'relator "{rel_raw}" não consta da composição', 'nome não mapeado em ALIAS', 'incluir o nome/janela em anac_parse.py', r['url']])
        if not txt:   # sem desfecho publicado
            res = (f'REUNIÃO AINDA NÃO REALIZADA (pauta publicada para {r["realizacao"]})' if futura else f'RESULTADO NÃO PUBLICADO (reunião de {r["realizacao"]}; a página não traz "Deliberação"; "Ata em breve")')
            delib.append(dict(base, resultado=res, decisao_texto='', tipo_item='Deliberação', partes=[], ad_referendum=False, voto_individual='não existe ainda'))
            N_FUT += futura; N_SEMRES += (not futura); continue
        # ---- fontes do item: pagina + ata + certidao + votos ----
        ai = None
        if ata:
            for k, x in enumerate(ata['itens']):
                if k not in usados and x['processo'] == proc: ai = x; usados.add(k); break
            if ai is None: conflitos.append(f'{rid} item {it["n"]} (proc. {proc}): não encontrado na ata')
        ce_e = next((DOCS[u] for rot, u in it['docs'] if rot == 'Certidão de deliberação' and u in DOCS and DOCS[u].get('texto')), None); ce = le_certidao(le_doc(ce_e)) if ce_e else None   # por LINK do item (o mesmo documento pode servir a 2 reunioes)
        if ce:   # a certidao tem de ser DESTA reuniao (a pagina da RE16 reaponta o item 3 para a certidao da RE14)
            nr_c = re.match(r'(\d+)', ce['reuniao_txt']); eh_ele = 'Eletrônica' in ce['reuniao_txt']
            if not nr_c or nr_c.group(1) != re.sub(r'\D', '', rid) or eh_ele != rid.startswith('RE'):
                conflitos.append(f'{rid} item {it["n"]}: o link "Certidão de deliberação" aponta para a certidão da {ce["reuniao_txt"][:40]} (outra reunião); não usada')
                pend.append(['ANAC', f'{rid} item {it["n"]} (proc. {proc}) — certidão desta reunião', data, 'link incorreto na fonte', f'o link da página aponta para a certidão da {ce["reuniao_txt"][:45]}; a certidão da {rid} não está ligada', 'erro da página da ANAC (documentos repetidos de uma reunião anterior)', 'aguardar correção da ANAC; a ata da reunião cobre a decisão', ce_e['url']])
                ce = None
        if ce and ce['processo'] and ce['processo'] != proc: conflitos.append(f'{rid} item {it["n"]}: processo da certidão {ce["processo"]} ≠ página {proc}'); ce = None
        t_ata = ai['chunk'] if ai else ''; t_ce = ce['deliberacao'] if ce else ''
        an = analisa_decisao(' '.join(x for x in (txt, t_ata, t_ce) if x), it['processo_txt'])
        tipo = classifica(txt, c.get('Assunto', ''))
        # coerencia entre fontes: modo de votacao pagina x ata x certidao
        modos = {k: analisa_decisao(v)['modo'] for k, v in (('página', txt), ('ata', ai['decisao'] if ai else ''), ('certidão', t_ce)) if v}
        if tipo == 'Deliberação' and len(modos) > 1:
            n_modo_tot += 1
            if len({m for m in modos.values() if m}) <= 1: n_modo_ok += 1
            else: conflitos.append(f'{rid} item {it["n"]}: modo de votação diverge entre fontes {modos}')
        rels = {k: v for k, v in (('página', canon(rel_raw)), ('ata', ai['relator'] if ai else None), ('certidão', ce['relator'] if ce else None)) if v}
        if len(set(rels.values())) > 1: conflitos.append(f'{rid} item {it["n"]}: relator diverge {rels}')
        if ai and ai['ad_referendum']: an['ad_referendum'] = True
        if ce and ce['ad_referendum']: an['ad_referendum'] = True
        if ai and ai['voto_vista_de']: an['voto_vista_de'] = an['voto_vista_de'] or ai['voto_vista_de']
        extra = {'presenca_real': presenca.startswith('real'), 'fonte': 'ata' + (' e certidão' if ce else '') if ata else ('certidão' if ce else 'página')}
        if tipo == 'Vista':
            if an['vista_por']: extra.update(vista_prov='nominal', vista_motivo='ata (SEI): "em virtude de pedido de vista formulado pelo Diretor ' + an['vista_por'] + '"')
            else:
                nm = vv_por_proc.get(proc)
                if nm and nm[2] > data: extra.update(vista_por=nm[0], vista_prov='inferido', vista_motivo=f'quem pediu vista é identificado pelo Voto-Vista do mesmo processo apresentado na {nm[1]} (página da reunião posterior)')
                else: pend.append(['ANAC', f'{rid} item {it["n"]} (proc. {proc}) — quem pediu vista', data, 'dado não publicado', f'"{txt}" sem o nome do diretor; ata não publicada', 'o nome está só na ata/certidão', 'reexecutar scripts/anac_rodar.sh quando a ata sair', r['url']])
        if an['voto_vista_de'] and tipo == 'Deliberação':
            extra['voto_vista_item'] = True
            extra['vv_prevaleceu'] = an['relator_vencido']
        if an['impedidos'] and ai:
            mi = re.search(r'em razão d[^.]+?(?=\s*\.\s)', ai['chunk']); extra['impedimento_motivo'] = mi.group(0)[:160] if mi else ''
        # votos escritos proprios de nao-relator (assinatura do documento Voto lido)
        autores = []
        votos_it = [DOCS[u] for rot, u in it['docs'] if rot in ('Voto', 'Voto-vista') and u in DOCS and DOCS[u].get('texto')]
        for ve in votos_it:
            au = assina_voto(le_doc(ve))
            if au: autores.append(au)
            if au and au != canon(rel_raw) and au in pres and au != an['voto_vista_de']:
                extra.setdefault('voto_proprio', {})[au] = f'Voto SEI {ve["url"].split("id_documento=")[1].split("&")[0]} assinado por {au} (documento lido): acompanha o voto do Relator e a decisão por unanimidade'
        ps = partes_de(txt, an['modo'], an)
        if an['nao_resolvidos']: pend.append(['ANAC', f'{rid} item {it["n"]} — nome não reconhecido na decisão', data, 'REVISAR', '; '.join(an['nao_resolvidos']), 'nome fora do colegiado 2026', 'mapear o nome', r['url']])
        res_txt = txt + (' [ad referendum]' if an['ad_referendum'] else '')
        delib.append(dict(base, resultado=res_txt, decisao_texto=txt, tipo_item=tipo, partes=ps, ad_referendum=an['ad_referendum'],
                          decisao_ata=ai['decisao'] if ai else '', decisao_certidao=t_ce, codigos_voto=ce['codigos_voto'] if ce else [], autores_voto=autores,
                          leitura={'ata': bool(ai), 'certidao': bool(ce), 'votos_lidos': len(votos_it)}))
        votos += votos_item(rid, data, proc, it['n'], tipo, an, rel, pres, ps, extra, aus)
        if an['modo'] == 'maioria' and not an['vencidos'] and not an['relator_vencido']:
            pend.append(['ANAC', f'{rid} item {it["n"]} (proc. {proc}) — quem divergiu ("{txt}")', data, 'dado não publicado', 'votos individuais REVISAR', 'decisão "por maioria" sem nomear os vencidos', 'ler a certidão: ' + (urls.get('Certidão de deliberação') or ''), urls.get('Certidão de deliberação') or r['url']])
    # pendencias por reuniao
    if not ata_e:
        pend.append(['ANAC', f'{rid} — ata (presença, votos nominais, vencidos)', data, 'documento não publicado', f'página da reunião diz "{ "Ata em breve" if "Ata" in cb["em_breve"] else "sem link de ata"}"; a presença está ' + ('inferida' if decididos else 'inexistente'), 'a ANAC publica a ata após a reunião', 'reexecutar scripts/anac_rodar.sh depois da publicação', r['url']])
    if not decididos and its: pend.append(['ANAC', f'{rid} — deliberações ({len(its)} item(ns) na pauta)', data, 'documento não publicado' if not futura else 'reunião futura', f'pauta publicada com {len(its)} processo(s); sem "Deliberação"', 'resultado só aparece depois da reunião' if not futura else 'reunião marcada para ' + r['realizacao'], 'reexecutar scripts/anac_rodar.sh depois da reunião', r['url']])
# desfecho da vista de RE6 item 1 (voto-vista de Rui Mesquita ainda nao deliberado em nenhuma reuniao publicada)
for d in delib:
    if d['tipo_item'] == 'Vista' and not any(x['processo'] == d['processo'] and x['tipo_item'] == 'Deliberação' and x['decisao_texto'] for x in delib):
        pend.append(['ANAC', f'{d["reuniao"]} item {d["item_n"]} (proc. {d["processo"]}) — desfecho após a vista', d['data'], 'ainda não deliberado', 'nenhuma reunião publicada até ' + HOJE + ' traz o processo de volta à pauta com resultado', 'o voto-vista ainda não foi a deliberação (ou não foi publicada)', 'reexecutar scripts/anac_rodar.sh', next(r['url'] for r, _, _ in todos if r['reuniao'] == d['reuniao'])])
# documentos baixados mas sem conteudo extraido: uma linha por reuniao e classe, com URL de exemplo (lista completa em 'documentos_nao_lidos')
grp = collections.defaultdict(list)
for d in docs_nao_lidos: grp[(d['reuniao'], 'pergamum' if 'pergamum' in d['url'] else 'SEI')].append(d)
rmap = {x['reuniao']: x for x in reun}
for (rid, cls), ds in sorted(grp.items(), key=lambda kv: (rmap[kv[0][0]]['data'], kv[0][1])):
    if cls == 'pergamum': pend.append(['ANAC', f'{rid} — ementas SimplificaJuris (pergamum.anac.gov.br)', rmap[rid]['data'], 'conteúdo não lido', f'{len(ds)} link(s): a página é uma SPA React (casca de 3,7 KB) cujo texto vem de API autenticada; baixada com sha256, sem conteúdo', 'ementa é resumo da decisão, não voto; a API exige credencial do aplicativo (não usada)', 'sem ação: a decisão já está na página da reunião e na certidão', ds[0]['url']])
    else: pend.append(['ANAC', f'{rid} — pesquisa pública SEI do processo', rmap[rid]['data'], 'documento indisponível na fonte', f'{len(ds)} link(s) devolvem "Processo não encontrado." (hash do link expirado)', 'a consulta pública do processo não abre; os documentos de interesse (relatório, voto, certidão) vieram pelos links diretos', 'sem ação (o link é da página da ANAC)', ds[0]['url']])
pend.append(['ANAC', 'Início exato do exercício de Mariana Altoé e fim dos mandatos de Luiz Ricardo Nascimento e Tiago Sousa Pereira', '2026', 'dado não publicado', 'as atas só provam presença/ausência por reunião: Mariana presente de 12/02 (RE6) a 06/04 (REX1), ausente de RE1-RE5; Luiz Ricardo presente até 11-13/03 (RE9), ausente a partir de 24/03; Tiago Sousa Pereira ausente justificado em RD1, RE1-RE4 (jan/2026) e não citado depois', 'datas de posse/fim de mandato só no DOU/portal; as janelas usadas nas reuniões sem ata são inferidas (Honorato 23/03, Ianelli 25/04: gov.br)', 'confirmar com a ANAC (LAI) ou DOU', URL_GOV])
pend.append(['ANAC', 'Votos em vídeo (YouTube) das reuniões presenciais', '2026', 'fora de escopo', 'link "Vídeo" nas páginas das reuniões presenciais', 'só o vídeo mostraria cada voto em unanimidades', 'não coletado', 'https://santosdumont.anac.gov.br/menu/f?p=107101:137'])

# ---------------- qualidade / cobertura ----------------
nv = collections.Counter(v['proveniencia'] for v in votos); nitens = len(delib)
dec = [d for d in delib if d['decisao_texto']]
cont = inv['contadores']; num = inv['numeracao']; cal = inv['calendario']
ok_ = lambda c: 'OK' if c else 'DIVERGE'
nr_ = {k: sum(1 for x in reun if x['reuniao'].startswith(k)) for k in ('RD', 'RE')}
rm = {x['reuniao']: x for x in reun}
VC = collections.Counter((v['reuniao'], v['processo'], v['deliberacao']) for v in votos)
OKV = sum(1 for d in dec if VC[(d['reuniao'], d['processo'], d['deliberacao'])] == len(rm[d['reuniao']]['presentes']) + len(rm[d['reuniao']]['ausentes']))
TD = json.load(open(os.path.join(DIRF, '_tentativas_documentos.json')))
sei = TD['por_host'].get('sei.anac.gov.br', {}); perg = TD['por_host'].get('pergamum.anac.gov.br', {})
n_dec_reun = sum(1 for x in reun if x['presentes']); n_ata = sum(1 for x in reun if x['presenca'].startswith('real'))
n_cert = sum(1 for d in dec if d['leitura']['certidao']); n_ata_it = sum(1 for d in dec if d['leitura']['ata'])
n_voto_d = sum(1 for d in dec if d['leitura']['votos_lidos'])
qual = [
 ['ANAC', 'Índice APEX presenciais 2026: reuniões listadas (uma região HTML sem paginador) × páginas de reunião baixadas', cont['listadas_apex_presenciais'], sum(1 for r in inv['reunioes_2026'] if r['tipo'] == 'presencial' and r['status'] in ('ok', 'cache')), 'OK' if cont['listadas_apex_presenciais'] == sum(1 for r in inv['reunioes_2026'] if r['tipo'] == 'presencial' and r['status'] in ('ok', 'cache')) else 'DIVERGE', 'sem paginador (marcadores: nenhum); controle: o mesmo índice com ano 2025 devolve %d reuniões na mesma página' % inv['paginacao']['controle_lista_inteira_do_ano']['pres_2025']],
 ['ANAC', 'Índice APEX eletrônicas 2026: reuniões listadas × páginas de reunião baixadas', cont['listadas_apex_eletronicas'], sum(1 for r in inv['reunioes_2026'] if r['tipo'] == 'eletronica' and r['status'] in ('ok', 'cache')), 'OK' if cont['listadas_apex_eletronicas'] == sum(1 for r in inv['reunioes_2026'] if r['tipo'] == 'eletronica' and r['status'] in ('ok', 'cache')) else 'DIVERGE', 'sem paginador; controle 2025: %d reuniões na mesma página' % inv['paginacao']['controle_lista_inteira_do_ano']['ele_2025']],
 ['ANAC', 'Numeração das reuniões sem buraco (presenciais 1..N, eletrônicas 1..N, extraordinárias eletrônicas 1..N)', 0, len(num['buracos_presenciais']) + len(num['buracos_eletronicas']) + len(num['buracos_extra']), 'OK' if not (num['buracos_presenciais'] or num['buracos_eletronicas'] or num['buracos_extra']) else 'DIVERGE', f"presenciais 1..{max(num['presenciais'])}; eletrônicas 1..{max(num['eletronicas'])}; extraordinárias eletrônicas {num['extraordinarias_eletronicas']}"],
 ['ANAC', 'Pautas (P141) baixadas × reuniões listadas', cont['listadas_apex_total'], cont['pautas_baixadas'], ok_(cont['listadas_apex_total'] == cont['pautas_baixadas']), 'sha256 no manifesto_anac.json'],
 ['ANAC', 'Calendário (Portaria 18.366): datas previstas até %s × reuniões presenciais realizadas NA data prevista' % HOJE, cont['calendario_ate_hoje'], cont['calendario_ate_hoje_com_reuniao_na_data'], 'EXCEÇÃO',
  f"calendário = datas 'previstas'; {nr_['RD']} presenciais realizadas (datas {sorted({d for r in inv['reunioes_2026'] if r['tipo']=='presencial' for d in r['datas']})}); realizadas fora do calendário: {cont['presenciais_realizadas_fora_do_calendario']}; previstas sem reunião: {len(cal['sem_reuniao_na_data'])} (a ANAC não explica; a lista oficial é o índice APEX)"],
 ['ANAC', 'Itens: soma dos processos das páginas (tabelas <table class=\"c\">) × deliberações no JSON', sum(len(i) for _, _, i in todos), nitens, ok_(sum(len(i) for _, _, i in todos) == nitens), 'inclui itens sem desfecho publicado (RD7, RE31, RE32)'],
 ['ANAC', 'Cada deliberação decidida tem 1 voto por presente + 1 AUSENTE por ausente justificado', len(dec), OKV, ok_(OKV == len(dec)), f'presença REAL (ata) em {n_ata} reuniões; INFERIDA em {n_dec_reun - n_ata} (sem ata publicada)'],
 ['ANAC', 'Reuniões com deliberações publicadas × atas lidas (presença real)', n_dec_reun, n_ata, 'EXCEÇÃO' if n_ata < n_dec_reun else 'OK', 'faltam as atas de ' + ', '.join(x['reuniao'] for x in reun if x['presentes'] and not x['presenca'].startswith('real')) + ' (página: "Ata em breve"); presença inferida nelas'],
 ['ANAC', 'Itens decididos × itens localizados na ata lida (por nº do processo)', sum(1 for d in dec if rm[d['reuniao']]['presenca'].startswith('real')), n_ata_it, ok_(n_ata_it == sum(1 for d in dec if rm[d['reuniao']]['presenca'].startswith('real'))), 'todo item de reunião com ata foi localizado na ata'],
 ['ANAC', 'Itens decididos × certidões de deliberação lidas (a ANAC só emite certidão para item decidido; vista/retirada não têm)', sum(1 for d in dec if d['tipo_item'] == 'Deliberação'), n_cert, 'OK' if n_cert == sum(1 for d in dec if d['tipo_item'] == 'Deliberação') else 'EXCEÇÃO', 'relator e modo da certidão conferidos com a página e a ata' + ('; ' + '; '.join(c_ for c_ in conflitos if 'outra reunião' in c_) if any('outra reunião' in c_ for c_ in conflitos) else '')],
 ['ANAC', 'Modo de votação (unanimidade/maioria) igual entre página, ata e certidão', n_modo_tot, n_modo_ok, ok_(n_modo_ok == n_modo_tot), 'itens com 2+ fontes comparáveis; divergências em `conflitos` do log'],
 ['ANAC', 'Documentos SEI/pergamum ligados nas páginas (únicos) × baixados', TD['total'], TD['baixados'], ok_(TD['baixados'] == TD['total']), f"sei.anac.gov.br {sei.get('baixados')}/{sei.get('tentados')}, pergamum.anac.gov.br {perg.get('baixados')}/{perg.get('tentados')}; sha256 de todos no manifesto_anac.json"],
 ['ANAC', 'Documentos baixados × lidos (texto extraído; PDF imagem por OCR RapidOCR)', TD['baixados'], TD['com_texto_lido'], 'EXCEÇÃO' if TD['com_texto_lido'] < TD['baixados'] else 'OK', f"{len(docs_nao_lidos)} não lidos: {sum(1 for d in docs_nao_lidos if 'pergamum' in d['url'])} ementas pergamum (SPA/API autenticada) e {sum(1 for d in docs_nao_lidos if 'pergamum' not in d['url'])} pesquisas públicas SEI que devolvem 'Processo não encontrado.'; lidos = {sei.get('lidos')} de {sei.get('tentados')} do SEI"],
]
decididas = sum(1 for x in reun if x['presentes'])
cob = [
 ['ANAC', 'Reuniões deliberativas 2026 (índice APEX)', len(reun), f"{cont['listadas_apex_presenciais']} presenciais (1ª..{max(num['presenciais'])}ª) + {cont['listadas_apex_eletronicas']} eletrônicas ({max(num['eletronicas'])} ordinárias + {len(num['extraordinarias_eletronicas'])} extraordinárias); {decididas} com deliberações publicadas ({n_ata} com ata lida), {sum(1 for x in reun if x['situacao'].startswith('Realizada, '))} realizada(s) sem resultado publicado, {sum(1 for x in reun if x['situacao'].startswith('Futura'))} futura(s)"],
 ['ANAC', 'Calendário 2026 (Portaria 18.366) = denominador independente', cont['calendario_portaria_18366_ano'], f"{cont['calendario_ate_hoje']} datas até {HOJE}; {cont['calendario_ate_hoje_com_reuniao_na_data']} coincidem com reunião presencial realizada; as demais foram remarcadas/não realizadas (presenciais fora do calendário: {cont['presenciais_realizadas_fora_do_calendario']})"],
 ['ANAC', 'Documentos (atas/votos/certidões) listados × baixados × lidos', TD['total'], f"{TD['baixados']} baixados, {TD['com_texto_lido']} lidos (SEI {sei.get('lidos')}/{sei.get('tentados')}: {sum(1 for e in man if e['tipo']=='documento (Ata)' and e.get('texto'))} atas, {len({x['url'] for d in delib for x in d['documentos'] if x['rotulo'] == 'Certidão de deliberação' and x['lido']})} certidões, {len({u for d in delib for x in d['documentos'] for u in [x['url']] if x['rotulo'] in ('Voto', 'Voto-vista') and x['lido']})} votos); 2 PDFs imagem lidos por OCR; sha256 de todos no manifesto_anac.json"],
 ['ANAC', 'Deliberações / votos extraídos', nitens, f"{nitens} itens ({sum(1 for d in delib if d['tipo_item']=='Deliberação' and d['decisao_texto'])} deliberações decididas, {sum(1 for d in delib if d['tipo_item']=='Retirada de pauta')} retiradas de pauta, {sum(1 for d in delib if d['tipo_item']=='Vista')} vistas, {sum(1 for d in delib if not d['decisao_texto'])} sem desfecho publicado) e {len(votos)} votos ({nv['nominal']} nominais, {nv['inferido']} inferidos, {nv['REVISAR']} REVISAR)"],
 ['ANAC', 'Itens da ata por tipo (todos têm 1 linha de voto por diretor, exceto Cancelada)', nitens, '; '.join(f'{k}: {v}' for k, v in collections.Counter(d['tipo_item'] for d in delib).most_common())],
]
nao_feito = [
 ['ANAC', 'Voto individual nominal em decisões unânimes', f"{nv['inferido']} votos inferidos", 'LIMITE ESTRUTURAL DA FONTE', 'A ata/certidão diz só "por unanimidade" (nunca lista voto a voto); vira 1 ACOMPANHOU por presente (inferido), agora sobre a presença REAL da ata onde ela existe.', 'Só o vídeo mostraria cada voto'],
 ['ANAC', 'Atas das reuniões ainda sem publicação', f"{n_dec_reun - n_ata} reunião(ões) decidida(s) + {sum(1 for x in reun if not x['presentes'])} sem resultado", 'AGUARDANDO A FONTE', 'RD5, RD6, REX2 e RE30 têm certidões (modo/relator reais) mas presença inferida; RD7, RE31, RE32 sem desfecho', 'reexecutar scripts/anac_rodar.sh depois da publicação'],
 ['ANAC', 'Itens sem desfecho publicado', f'{N_SEMRES} itens (realizadas) + {N_FUT} (futuras)', 'AGUARDANDO A FONTE', 'RD7 (06/10), RE31 (06 e 09/10) e RE32 (13 e 16/10): sem "Deliberação" na página nem ata', 'reexecutar scripts/anac_rodar.sh depois da publicação'],
 ['ANAC', 'Decisões por partes (voto diferente por parte do item)', f"{sum(1 for d in delib if len(d['partes']) > 1)} itens", 'NÃO OCORRE NO CORPUS 2026', 'nenhuma ata/certidão de 2026 vota por partes (as decisões com I/II enumeram providências, todas por unanimidade); o parser trata "quanto ao item X" se aparecer', 'nenhuma'],
]
out = {'reunioes': reun, 'deliberacoes': delib, 'votos': votos, 'qualidade': qual, 'cobertura': cob, 'pendencias': pend, 'nao_feito': nao_feito, 'conflitos_entre_fontes': conflitos, 'documentos_nao_lidos': docs_nao_lidos,
       'diretores': ATUAIS, 'colegiado': 'Diretoria Colegiada (ANAC)',
       'ex_diretores': {'Luiz Ricardo Nascimento': 'presente de 06/01 (RE1) a 11-13/03/2026 (RE9) e RD2 (06/03); ausente a partir da RE10 (24/03); fim 22/03 inferido pela posse de Roberto Honorato (23/03/2026)',
                        'Mariana Altoé': 'Diretora Substituta; presente de 12/02 (RE6, "nos dias 12 e 13") a 06/04/2026 (REX1); ausente de RE1-RE5; fim 24/04 inferido pela entrada de Cláudio Ianelli (25/04/2026); impedida na RE7 item 2',
                        'Tiago Sousa Pereira': 'Diretor titular ausente justificadamente em RD1 (20/01) e RE1-RE4 (06 a 30/01/2026); não citado nas atas seguintes; sem votos nem presença em 2026'},
       'papeis': {'Tiago Faierstein': 'Diretor-Presidente', 'Rui Mesquita': 'Diretor', 'Antônio Mathias Moreira': 'Diretor (Diretor-Presidente Substituto na assinatura da RD1)', 'Roberto Honorato': 'Diretor Substituto (desde 23/03/2026; 1ª presença atestada em 24/03)', 'Cláudio Ianelli': 'Diretor Substituto (desde 25/04/2026; 1ª presença atestada em 29/04)', 'Luiz Ricardo Nascimento': 'Ex-diretor', 'Mariana Altoé': 'Ex-diretora (Diretora Substituta)', 'Tiago Sousa Pereira': 'Ex-diretor (ausente em jan/2026)'},
       'janelas_presenca': {n: {'de': a.isoformat(), 'ate': b.isoformat(), 'evidencia': e} for n, (a, b, e) in JANELAS.items()},
       '_fonte': {'apex_presenciais': 'https://departamental.anac.gov.br/menu/f?p=107101:137', 'apex_eletronicas': 'https://santosdumont.anac.gov.br/menu/f?p=107101:138:0:::138:P138_ANO:2026', 'calendario': 'https://www.anac.gov.br/assuntos/legislacao/legislacao-1/portarias/2025/portaria-18366', 'inventario': INV, 'gerado_em': datetime.datetime.now().strftime('%Y-%m-%d %H:%M')},
       'composicao_nota': 'Presença REAL lida em 34 atas SEI (jan-set/2026): Faierstein (Presidente), Rui Mesquita, Mathias Moreira (ausente em RE24 e RE25), Luiz Ricardo Nascimento (até RE9, 11-13/03), Mariana Altoé (RE6, 12/02, a REX1, 06/04), Roberto Honorato (a partir da RE10, 24/03; ausente em RE19 e RE20), Cláudio Ianelli (a partir da RE11, 29/04; ausente em RE29); Tiago Sousa Pereira ausente justificado nas atas de janeiro. gov.br/diretoria-colegiada (22/05/2026): Honorato substituto desde 23/03, Ianelli desde 25/04. Reuniões sem ata (RD5, RD6, REX2, RE30): presença inferida pelas janelas.'}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
print('reunioes', len(reun), 'itens', nitens, 'votos', len(votos), dict(nv), 'pendencias', len(pend), '| conflitos entre fontes', len(conflitos))
for c_ in conflitos: print('  CONFLITO:', c_)
