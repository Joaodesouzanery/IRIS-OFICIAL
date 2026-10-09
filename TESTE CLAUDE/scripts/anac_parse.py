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
_N1 = r"[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ.']+(?:\s+(?:(?:de|da|do|dos|das)\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ.']+){0,5}"
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
        rm = [r for r in rms if ant <= r.start() and r.end() <= m.start() + 1]
        nxt = ims[n + 1].start() if n + 1 < len(ims) else len(corpo)
        corte = [x.start() for x in rms if x.start() > m.end() and x.start() <= nxt] + [x.start() + m.end() for x in _FIM.finditer(corpo[m.end():nxt])]
        fim = min(corte + [nxt])
        chunk = corpo[m.start():fim].strip(); dm = re.search(r'Decisão:\s*(.*)', chunk)
        itens.append({'n': m.group(1), 'processo': m.group(2), 'relator': canon(rm[-1].group(1)) if rm else None,
                      'voto_vista_de': canon(rm[-1].group(2)) if rm and rm[-1].group(2) else None,
                      'extrapauta': 'extrapauta' in corpo[ant:m.start()], 'ad_referendum': (n == 0 and 'ad referendum' in corpo[:m.start()]),
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
