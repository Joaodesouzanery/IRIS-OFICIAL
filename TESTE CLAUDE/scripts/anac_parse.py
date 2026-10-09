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
         'retirada_por': None, 'relator_vencido': False, 'relator_votou': '', 'nao_resolvidos': [], 'ad_referendum': 'ad referendum' in lo or 'ad referendum' in pt.lower()}
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

# ---------------- votos de um item ----------------
def votos_item(rid, data, proc, nitem, tipo, an, relator, presentes, partes, extra=None):
    """uma linha por presente. Devolve lista de dicts de voto."""
    extra = extra or {}; out = []
    por_parte = ''
    if len(partes) > 1:
        por_parte = '; '.join(f"{p['parte']}: " + ('divergentes ' + ', '.join(p['vencidos']) if p['vencidos'] else (p['modo'] or '?')) for p in partes)
    for dn in presentes:
        v, pv, mt = None, None, None
        if dn in an['impedidos']: v, pv, mt = 'IMPEDIDO', 'nominal', 'texto da decisão nomeia o impedimento'
        elif dn in an['ausentes']: v, pv, mt = 'AUSENTE', 'nominal', 'texto da decisão nomeia a ausência'
        elif tipo == 'Retirada de pauta':
            if dn == relator or dn == an['retirada_por']: v, pv, mt = 'RELATOR (retirou o item de pauta; sem voto de mérito)', 'nominal', 'página: "Retirado de pauta pelo Relator"' if dn == relator else 'texto nomeia quem retirou'
            else: v, pv, mt = 'SEM VOTO (retirado de pauta)', 'inferido', 'item retirado de pauta: não houve votação do mérito'
        elif tipo == 'Vista':
            req = an['vista_por'] or extra.get('vista_por')
            if dn == req: v, pv, mt = 'PEDIU VISTA', extra.get('vista_prov', 'nominal'), extra.get('vista_motivo', 'texto nomeia quem pediu vista')
            elif dn == relator: v, pv, mt = 'RELATOR (vista concedida; sem voto de mérito proferido)', 'nominal', 'relator nomeado na página; item retirado de pauta por pedido de vista'
            else: v, pv, mt = 'SEM VOTO AINDA (vista pendente)', 'inferido', 'deliberação suspensa por pedido de vista; os demais não votaram na reunião'
            if req is None and dn != relator:
                pv, mt = 'REVISAR', 'pedido de vista sem o nome de quem pediu na página (certidão/ata em SEI bloqueada)'
        elif dn == an['voto_vista_de'] and extra.get('voto_vista_item'):
            v, pv, mt = 'VOTOU (apresentou voto-vista; sentido do voto não lido)', 'nominal', 'a página nomeia o autor do Voto-Vista; o sentido do voto está no documento SEI (bloqueado)'
        elif dn == relator:
            v, pv, mt = 'RELATOR', 'nominal', 'relator nomeado na página da reunião'
        elif dn in an['vencidos']: v, pv, mt = 'DIVERGIU', 'nominal', 'texto da decisão nomeia o voto vencido'
        elif dn in an['abstencoes']: v, pv, mt = 'SEM VOTO (abstenção)', 'nominal', 'texto da decisão nomeia a abstenção'
        elif dn in an['ressalvas']: v, pv, mt = 'ACOMPANHOU (com ressalva)', 'nominal', 'texto da decisão nomeia a ressalva'
        elif an['modo'] == 'unanimidade': v, pv, mt = 'ACOMPANHOU', 'inferido', 'unanimidade declarada na página: todo presente acompanhou (presença inferida pelo colegiado em exercício; ata em SEI bloqueada)' + ('; item ad referendum (referendo da Diretoria)' if an['ad_referendum'] else '')
        elif an['modo'] == 'maioria' and an['vencidos']: v, pv, mt = 'ACOMPANHOU', 'inferido', 'maioria com vencidos nomeados: os demais presentes acompanharam'
        elif an['modo'] == 'maioria': v, pv, mt = 'SEM VOTO (maioria sem vencidos nomeados)', 'REVISAR', 'página diz "por maioria" sem nomear os vencidos; só a certidão de deliberação (SEI, bloqueada) nomeia'
        else: v, pv, mt = 'SEM VOTO (decisão sem modo de votação)', 'REVISAR', 'texto da decisão não diz unanimidade nem maioria'
        out.append({'reuniao': rid, 'data': data, 'processo': proc, 'deliberacao': nitem, 'diretor': dn, 'voto': v, 'proveniencia': pv, 'voto_por_parte': por_parte, 'motivo': mt})
    return out

def autoteste():
    """casos SINTETICOS (nao ha ata/certidao legivel no ambiente): garante que o analisador le os padroes pedidos."""
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
    print('autoteste (sintético):', len(c) + 3, 'casos,', 'FALHAS:' if bad else 'todos ok', bad if bad else ''); return 1 if bad else 0

if len(sys.argv) > 1 and sys.argv[1] == '--autoteste': sys.exit(autoteste())
if len(sys.argv) > 2 and sys.argv[1] == '--pagina':
    h = open(sys.argv[2], errors='replace').read(); print(L.cabecalho(h)['titulo'], '|', L.cabecalho(h)['data_txt'])
    for i in L.itens(h): print(i['n'], i['processo'], '|', i['campos'].get('Relator'), '|', i['campos'].get('Deliberação'))
    sys.exit(0)

# ======================= pipeline =======================
MAN, INV, OUT = sys.argv[1:4]; DIRF = 'fonte/anac'
inv = json.load(open(INV)); man = json.load(open(MAN)); HOJE = inv['calendario']['hoje']
URL_BUSCA = 'https://www.gov.br/anac/pt-br/search?SearchableText=Mariana+Alto%C3%A9'
reun, delib, votos, pend = [], [], [], []
docs_bloq = collections.defaultdict(list); atas_bloq = []
N_FUT = N_SEMRES = 0
visto_por_proc = {}   # processo -> (rid, item) de 'pedido de vista' sem nome, para cruzar com 'Voto-Vista do Diretor X' em reuniao posterior
todos = []
for r in sorted(inv['reunioes_2026'], key=lambda x: (x['datas'][0], x['reuniao'])):
    h = open(os.path.join(DIRF, r['arquivo']), errors='replace').read(); cb = L.cabecalho(h); its = L.itens(h)
    todos.append((r, cb, its))
# voto-vista posterior: processo -> diretor (cruzamento entre reunioes)
vv_por_proc = {}
for r, cb, its in todos:
    for it in its:
        a = analisa_decisao(it['campos'].get('Deliberação', ''), it['processo_txt'])
        if a['voto_vista_de']: vv_por_proc.setdefault(it['processo'], (a['voto_vista_de'], r['reuniao'], r['datas'][0]))
for r, cb, its in todos:
    rid = r['reuniao']; data = r['datas'][0]; futura = data > HOJE
    decididos = [i for i in its if i['campos'].get('Deliberação')]
    pres = presentes_em(r['datas']) if decididos else []
    rel_extra = [c for c in (canon(i['campos'].get('Relator', '')) for i in its) if c and c not in pres and decididos]
    pres += rel_extra
    pres = [n for n in (ATUAIS + EX) if n in pres]   # ordem estavel: atuais primeiro
    ata_url = cb['links'].get('Ata'); situ = ('Futura (pauta publicada)' if futura else ('Realizada (deliberações publicadas)' if decididos else 'Realizada, resultado ainda não publicado'))
    obs = ('presença INFERIDA pelo colegiado em exercício na data (a ata, em SEI, está bloqueada no egress; ausências/impedimentos só aparecem na ata)' if decididos else
           'reunião futura: pauta publicada, sem presença nem votos' if futura else 'sem deliberações publicadas na página ("Ata em breve"): presença e votos ainda inexistentes na fonte')
    fontes = [{'tipo': 'página da reunião (APEX)', 'url': r['url']}, {'tipo': 'pauta (APEX)', 'url': r['url_pauta']}]
    if ata_url: fontes.append({'tipo': 'ata (SEI) — bloqueada no egress', 'url': ata_url})
    if cb['links'].get('Vídeo'): fontes.append({'tipo': 'vídeo (YouTube) — fora de escopo', 'url': cb['links']['Vídeo']})
    reun.append({'reuniao': rid, 'titulo': f"{cb['titulo']} ({r['realizacao']})", 'tipo': ('Extraordinária eletrônica' if r['extraordinaria'] else ('Eletrônica' if r['tipo'] == 'eletronica' else 'Presencial')), 'data': data, 'datas': r['datas'],
                 'presentes': pres, 'ausentes': [], 'obs': obs, 'situacao': situ, 'presenca': 'inferida' if decididos else 'inexistente', 'id_apex': r['id_apex'], 'url_ata': ata_url or '', 'fontes': fontes,
                 'evidencia_data': ['índice APEX: ' + r['realizacao'], 'cabeçalho da página: ' + cb['data_txt']]})
    for it in its:
        c = it['campos']; proc = it['processo']; txt = c.get('Deliberação', ''); rel_raw = c.get('Relator', ''); rel = canon(rel_raw) or rel_raw
        urls = {rot: u for rot, u in it['docs']}; voto_doc = next((u for rot, u in it['docs'] if rot == 'Voto'), '')
        base = {'reuniao': rid, 'data': data, 'processo': proc, 'deliberacao': it['n'], 'item_n': it['n'], 'relator': rel, 'interessado': '', 'assunto': c.get('Assunto', ''), 'voto_doc': voto_doc,
                'secao': 'Processos deliberados', 'unidade': '', 'origem': r['url'], 'documentos': [{'rotulo': rot, 'url': u} for rot, u in it['docs']], 'id_apex': r['id_apex']}
        if it['processo_txt'] != proc: base['processo_txt'] = it['processo_txt']
        if rel_raw and not canon(rel_raw): pend.append(['ANAC', f'{rid} item {it["n"]} — relator fora do colegiado 2026 conhecido', data, 'REVISAR', f'relator "{rel_raw}" não consta da composição', 'nome não mapeado em ALIAS', 'incluir o nome/janela em anac_parse.py', r['url']])
        for rot, u in it['docs']: docs_bloq[(rid, rot)].append(u)
        if not txt:   # sem desfecho publicado
            res = (f'REUNIÃO AINDA NÃO REALIZADA (pauta publicada para {r["realizacao"]})' if futura else f'RESULTADO NÃO PUBLICADO (reunião de {r["realizacao"]}; a página não traz "Deliberação"; "Ata em breve")')
            delib.append(dict(base, resultado=res, decisao_texto='', tipo_item='Deliberação', partes=[], ad_referendum=False, voto_individual='não existe ainda'))
            N_FUT += futura; N_SEMRES += (not futura); continue
        an = analisa_decisao(txt, it['processo_txt']); tipo = classifica(txt, c.get('Assunto', ''))
        extra = {}
        if tipo == 'Vista':
            nm = vv_por_proc.get(proc)
            if nm and nm[2] > data: extra = {'vista_por': nm[0], 'vista_prov': 'inferido', 'vista_motivo': f'quem pediu vista é identificado pelo Voto-Vista do mesmo processo apresentado na {nm[1]} (página da reunião posterior)'}
            else: pend.append(['ANAC', f'{rid} item {it["n"]} (proc. {proc}) — quem pediu vista', data, 'dado não publicado na página', f'"{txt}" sem o nome do diretor; nenhum item posterior com Voto-Vista do mesmo processo', 'o nome está só na ata/certidão (SEI bloqueado no egress)', 'ler a ata/certidão em SEI quando o host for liberado', r['url']])
        if an['voto_vista_de'] and tipo == 'Deliberação': extra['voto_vista_item'] = True
        ps = partes_de(txt, an['modo'], an)
        if an['nao_resolvidos']: pend.append(['ANAC', f'{rid} item {it["n"]} — nome não reconhecido na decisão', data, 'REVISAR', '; '.join(an['nao_resolvidos']), 'nome fora do colegiado 2026', 'mapear o nome', r['url']])
        delib.append(dict(base, resultado=txt + (' [ad referendum]' if an['ad_referendum'] else ''), decisao_texto=txt, tipo_item=tipo, partes=ps, ad_referendum=an['ad_referendum']))
        votos += votos_item(rid, data, proc, it['n'], tipo, an, rel, pres, ps, extra)
        if an['modo'] == 'maioria' and not an['vencidos']:
            pend.append(['ANAC', f'{rid} item {it["n"]} (proc. {proc}) — quem divergiu ("{txt}")', data, 'dado não publicado na página', f'votos individuais REVISAR ({len(pres) - 2} presentes sem voto atribuível)', 'a página diz "por maioria" sem nomear os vencidos; a certidão de deliberação (SEI) nomeia', 'ler a certidão em SEI quando o host for liberado: ' + (urls.get('Certidão de deliberação') or ''), urls.get('Certidão de deliberação') or r['url']])
    # pendencias por reuniao
    if ata_url: atas_bloq.append((rid, r['realizacao'], ata_url))
    else: pend.append(['ANAC', f'{rid} — ata', data, 'documento não publicado', f'página da reunião diz "{ "Ata em breve" if "Ata" in cb["em_breve"] else "sem link de ata"}"', 'a ANAC publica a ata após a reunião', 'reexecutar scripts/anac_rodar.sh depois da publicação', r['url']])
    if not decididos and its: pend.append(['ANAC', f'{rid} — deliberações ({len(its)} item(ns) na pauta)', data, 'documento não publicado' if not futura else 'reunião futura', f'pauta publicada com {len(its)} processo(s); sem "Deliberação"', 'resultado só aparece depois da reunião' if not futura else 'reunião marcada para ' + r['realizacao'], 'reexecutar scripts/anac_rodar.sh depois da reunião', r['url']])
for rid, real, u in atas_bloq:
    pend.append(['ANAC', f'{rid} — ata (presença, votos nominais, vencidos)', real, 'bloqueado pelo egress (sei.anac.gov.br)', 'a página da reunião publica o link da ata; o host SEI recusa o CONNECT (403) no proxy', 'sem a ata a presença é inferida e a unanimidade vira ACOMPANHOU inferido', 'liberar sei.anac.gov.br no egress (ou enviar os PDFs) e reexecutar scripts/anac_rodar.sh', u])
por_reuniao = collections.defaultdict(lambda: collections.Counter())
for (rid, rot), us in docs_bloq.items(): por_reuniao[rid][rot] += len(us)
rm = {x['reuniao']: x for x in reun}
for rid, cnt in sorted(por_reuniao.items(), key=lambda kv: rm[kv[0]]['data']):
    ex = next(u for (r2, rot), us in docs_bloq.items() if r2 == rid for u in us[:1])
    pend.append(['ANAC', f'{rid} — votos, relatórios e certidões de deliberação (SEI)', rm[rid]['data'], 'bloqueado pelo egress (sei.anac.gov.br / pergamum.anac.gov.br)', f'{sum(cnt.values())} link(s) na página: ' + '; '.join(f'{k} {v}' for k, v in cnt.most_common()), 'documentos publicados pela ANAC, mas o host é recusado no proxy (403 CONNECT); nenhum CAPTCHA foi apresentado', 'liberar os hosts SEI/pergamum e reexecutar scripts/anac_rodar.sh', ex])
pend.append(['ANAC', 'Composição do colegiado em jan-fev/2026 e fim exato dos mandatos de Luiz Ricardo Nascimento e Mariana Altoé', '2026', 'bloqueado pela fonte (CAPTCHA no gov.br/search; nunca resolvido)', 'o gov.br/anac só lista a composição atual (22/05/2026): 3 titulares + 2 substitutos', 'datas de entrada/saída de ex-membros só por busca no portal; usadas janelas por evidência (relatorias) e pela entrada dos substitutos', 'confirmar com a ANAC (LAI) ou liberar a busca sem captcha', URL_BUSCA])
pend.append(['ANAC', 'Votos em vídeo (YouTube) das reuniões presenciais', '2026', 'fora de escopo', 'link "Vídeo" nas páginas das reuniões presenciais', 'só o vídeo mostraria cada voto em unanimidades', 'não coletado', 'https://santosdumont.anac.gov.br/menu/f?p=107101:137'])

# ---------------- qualidade / cobertura ----------------
nv = collections.Counter(v['proveniencia'] for v in votos); nitens = len(delib)
dec = [d for d in delib if d['decisao_texto']]
cont = inv['contadores']; num = inv['numeracao']; cal = inv['calendario']
ok_ = lambda c: 'OK' if c else 'DIVERGE'
nr_ = {k: sum(1 for x in reun if x['reuniao'].startswith(k)) for k in ('RD', 'RE')}
VC = collections.Counter((v['reuniao'], v['processo'], v['deliberacao']) for v in votos)
OKV = sum(1 for d in dec if VC[(d['reuniao'], d['processo'], d['deliberacao'])] == len(rm[d['reuniao']]['presentes']))
qual = [
 ['ANAC', 'Índice APEX presenciais 2026: reuniões listadas (uma região HTML sem paginador) × páginas de reunião baixadas', cont['listadas_apex_presenciais'], sum(1 for r in inv['reunioes_2026'] if r['tipo'] == 'presencial' and r['status'] in ('ok', 'cache')), 'OK' if cont['listadas_apex_presenciais'] == sum(1 for r in inv['reunioes_2026'] if r['tipo'] == 'presencial' and r['status'] in ('ok', 'cache')) else 'DIVERGE', 'sem paginador (marcadores: nenhum); controle: o mesmo índice com ano 2025 devolve %d reuniões na mesma página' % inv['paginacao']['controle_lista_inteira_do_ano']['pres_2025']],
 ['ANAC', 'Índice APEX eletrônicas 2026: reuniões listadas × páginas de reunião baixadas', cont['listadas_apex_eletronicas'], sum(1 for r in inv['reunioes_2026'] if r['tipo'] == 'eletronica' and r['status'] in ('ok', 'cache')), 'OK' if cont['listadas_apex_eletronicas'] == sum(1 for r in inv['reunioes_2026'] if r['tipo'] == 'eletronica' and r['status'] in ('ok', 'cache')) else 'DIVERGE', 'sem paginador; controle 2025: %d reuniões na mesma página' % inv['paginacao']['controle_lista_inteira_do_ano']['ele_2025']],
 ['ANAC', 'Numeração das reuniões sem buraco (presenciais 1..N, eletrônicas 1..N, extraordinárias eletrônicas 1..N)', 0, len(num['buracos_presenciais']) + len(num['buracos_eletronicas']) + len(num['buracos_extra']), 'OK' if not (num['buracos_presenciais'] or num['buracos_eletronicas'] or num['buracos_extra']) else 'DIVERGE', f"presenciais 1..{max(num['presenciais'])}; eletrônicas 1..{max(num['eletronicas'])}; extraordinárias eletrônicas {num['extraordinarias_eletronicas']}"],
 ['ANAC', 'Pautas (P141) baixadas × reuniões listadas', cont['listadas_apex_total'], cont['pautas_baixadas'], ok_(cont['listadas_apex_total'] == cont['pautas_baixadas']), 'sha256 no manifesto_anac.json'],
 ['ANAC', 'Calendário (Portaria 18.366): datas previstas até %s × reuniões presenciais realizadas NA data prevista' % HOJE, cont['calendario_ate_hoje'], cont['calendario_ate_hoje_com_reuniao_na_data'], 'EXCEÇÃO',
  f"calendário = datas 'previstas'; {nr_['RD']} presenciais realizadas (datas {sorted({d for r in inv['reunioes_2026'] if r['tipo']=='presencial' for d in r['datas']})}); realizadas fora do calendário: {cont['presenciais_realizadas_fora_do_calendario']}; previstas sem reunião: {len(cal['sem_reuniao_na_data'])} (a ANAC não explica; a lista oficial é o índice APEX)"],
 ['ANAC', 'Itens: soma dos processos das páginas (tabelas <table class=\"c\">) × deliberações no JSON', sum(len(i) for _, _, i in todos), nitens, ok_(sum(len(i) for _, _, i in todos) == nitens), 'inclui itens sem desfecho publicado (RD7, RE31, RE32)'],
 ['ANAC', 'Cada deliberação decidida tem 1 voto por presente', len(dec), OKV, ok_(OKV == len(dec)), 'presentes = colegiado em exercício na data (inferido)'],
 ['ANAC', 'Documentos SEI/pergamum ligados nas páginas (únicos) × baixados', json.load(open(os.path.join(DIRF, '_tentativas_documentos.json')))['total'], json.load(open(os.path.join(DIRF, '_tentativas_documentos.json')))['baixados'], 'EXCEÇÃO', 'todos recusados no proxy (CONNECT 403: sei.anac.gov.br e pergamum.anac.gov.br fora da allowlist); nenhum CAPTCHA; PDFs lidos = 0, OCR = 0 (nada baixado; tesseract ausente)'],
]
decididas = sum(1 for x in reun if x['presentes'])
cob = [
 ['ANAC', 'Reuniões deliberativas 2026 (índice APEX)', len(reun), f"{cont['listadas_apex_presenciais']} presenciais (1ª..{max(num['presenciais'])}ª) + {cont['listadas_apex_eletronicas']} eletrônicas ({max(num['eletronicas'])} ordinárias + {len(num['extraordinarias_eletronicas'])} extraordinárias); {decididas} com deliberações publicadas, {sum(1 for x in reun if x['situacao'].startswith('Realizada, '))} realizada(s) sem resultado publicado, {sum(1 for x in reun if x['situacao'].startswith('Futura'))} futura(s)"],
 ['ANAC', 'Calendário 2026 (Portaria 18.366) = denominador independente', cont['calendario_portaria_18366_ano'], f"{cont['calendario_ate_hoje']} datas até {HOJE}; {cont['calendario_ate_hoje_com_reuniao_na_data']} coincidem com reunião presencial realizada; as demais foram remarcadas/não realizadas (presenciais fora do calendário: {cont['presenciais_realizadas_fora_do_calendario']})"],
 ['ANAC', 'Documentos (atas/votos/certidões) listados × baixados × lidos', json.load(open(os.path.join(DIRF, '_tentativas_documentos.json')))['total'], '0 baixados, 0 lidos: sei.anac.gov.br e pergamum.anac.gov.br bloqueados no egress; lidos = 41 páginas de reunião + 41 pautas + 3 índices/calendário (sha256 no manifesto_anac.json)'],
 ['ANAC', 'Deliberações / votos extraídos', nitens, f"{nitens} itens ({sum(1 for d in delib if d['tipo_item']=='Deliberação' and d['decisao_texto'])} deliberações decididas, {sum(1 for d in delib if d['tipo_item']=='Retirada de pauta')} retiradas de pauta, {sum(1 for d in delib if d['tipo_item']=='Vista')} vistas, {sum(1 for d in delib if not d['decisao_texto'])} sem desfecho publicado) e {len(votos)} votos ({nv['nominal']} nominais, {nv['inferido']} inferidos, {nv['REVISAR']} REVISAR)"],
 ['ANAC', 'Itens da ata por tipo (todos têm 1 linha de voto por diretor, exceto Cancelada)', nitens, '; '.join(f'{k}: {v}' for k, v in collections.Counter(d['tipo_item'] for d in delib).most_common())],
]
nao_feito = [
 ['ANAC', 'Voto individual nominal em decisões unânimes', f"{nv['inferido']} votos inferidos", 'LIMITE ESTRUTURAL DA FONTE', 'A página só diz "por unanimidade"; vira 1 ACOMPANHOU por presente (inferido). Presença também inferida (ata em SEI).', 'Só ata/certidão (SEI, bloqueado) e vídeo mostrariam cada voto/presença'],
 ['ANAC', 'Atas, votos, relatórios e certidões de deliberação (SEI)', f"{json.load(open(os.path.join(DIRF, '_tentativas_documentos.json')))['total']} documentos", 'BLOQUEADO NO EGRESS', 'sei.anac.gov.br e pergamum.anac.gov.br recusam CONNECT (403 no proxy; Chromium: ERR_TUNNEL_CONNECTION_FAILED). Não é CAPTCHA.', 'liberar os hosts ou enviar os PDFs'],
 ['ANAC', 'Vencidos nomeados (maioria), quem pediu vista, impedimentos e ausências', 'itens "por maioria"/"pedido de vista"', 'DEPENDE DA ATA', 'Parser pronto (analisa_decisao: voto vencido, vista, impedido, ausente, abstenção, ressalva, partes) mas sem ata legível para alimentá-lo; testado só com casos sintéticos', 'ler as atas quando liberadas'],
 ['ANAC', 'Itens sem desfecho publicado', f'{N_SEMRES} itens (realizadas) + {N_FUT} (futuras)', 'AGUARDANDO A FONTE', 'RD7 (06/10), RE31 (06 e 09/10) e RE32 (13 e 16/10): sem "Deliberação" na página', 'reexecutar scripts/anac_rodar.sh depois da publicação'],
]
out = {'reunioes': reun, 'deliberacoes': delib, 'votos': votos, 'qualidade': qual, 'cobertura': cob, 'pendencias': pend, 'nao_feito': nao_feito,
       'diretores': ATUAIS, 'colegiado': 'Diretoria Colegiada (ANAC)',
       'ex_diretores': {'Luiz Ricardo Nascimento': 'relator até 13/03/2026; presente só até 22/03/2026 (fim inferido pela entrada de Roberto Honorato em 23/03/2026); fora dos totais depois', 'Mariana Altoé': 'relatora de 03/03 a 02/04/2026; presente só de 03/03 a 24/04/2026 (fim inferido pela entrada de Cláudio Ianelli em 25/04/2026; início anterior a 03/03 sem evidência); fora dos totais fora da janela'},
       'papeis': {'Tiago Faierstein': 'Diretor-Presidente', 'Rui Mesquita': 'Diretor', 'Antônio Mathias Moreira': 'Diretor', 'Roberto Honorato': 'Diretor Substituto (desde 23/03/2026)', 'Cláudio Ianelli': 'Diretor Substituto (desde 25/04/2026)', 'Luiz Ricardo Nascimento': 'Ex-diretor', 'Mariana Altoé': 'Ex-diretora'},
       'janelas_presenca': {n: {'de': a.isoformat(), 'ate': b.isoformat(), 'evidencia': e} for n, (a, b, e) in JANELAS.items()},
       '_fonte': {'apex_presenciais': 'https://departamental.anac.gov.br/menu/f?p=107101:137', 'apex_eletronicas': 'https://santosdumont.anac.gov.br/menu/f?p=107101:138:0:::138:P138_ANO:2026', 'calendario': 'https://www.anac.gov.br/assuntos/legislacao/legislacao-1/portarias/2025/portaria-18366', 'inventario': INV, 'gerado_em': datetime.datetime.now().strftime('%Y-%m-%d %H:%M')},
       'composicao_nota': 'Pág. gov.br/diretoria-colegiada (22/05/2026): Tiago Faierstein (Presidente), Rui Mesquita, Antônio Mathias Moreira, Roberto Honorato (substituto desde 23/03/2026), Cláudio Ianelli (substituto desde 25/04/2026). Relatorias de Luiz Ricardo Nascimento (até 13/03) e Mariana Altoé (03/03 a 02/04) mostram que foram membros no início de 2026; entram na presença só dentro da janela de exercício.'}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
print('reunioes', len(reun), 'itens', nitens, 'votos', len(votos), dict(nv), 'pendencias', len(pend))
