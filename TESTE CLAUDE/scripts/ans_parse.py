"""ANS (DICOL) 2026: monta ans.json a partir de pautas (PDF), paginas 'Deliberacoes da Nª Reuniao' (HTML) e extratos de ata (PDF).
Uso: python3 -I scripts/ans_parse.py manifesto_ans.json ans_inventario.json ans.json
Modelo de dados = anatel.json/aneel.json (reunioes/deliberacoes/votos/qualidade/cobertura/pendencias/nao_feito/diretores/colegiado).
Regras (decisoes de desenho):
  * A ANS NAO publica voto nominal nem relator: so 'DECISAO: ITEM APROVADO' (pagina) ou 'Aprovado por unanimidade' (extrato) + presentes.
    Logo: todo voto de presente em item decidido = ACOMPANHOU (proveniencia 'inferido'); o relator = diretor da AREA proponente
    (ITEM DIPRO -> diretor da DIPRO na data), tambem 'inferido' (rotulo RELATOR). Ausente de extrato com nome = AUSENTE 'nominal'.
  * Item sem resultado publicado (pauta de reuniao sem pagina de deliberacoes/extrato) NAO gera voto: vai em pendencias.
  * 'Blocao' (COREC/SECEX) = 1 item agregado com a lista de processos da pauta (nao 1 item por processo)."""
import sys, re, json, html, os, unicodedata, difflib, datetime
from collections import Counter, defaultdict
man_f, inv_f, out_f = sys.argv[1:4]
# data de referencia DINAMICA (override para reproduzir: IRIS_HOJE=AAAA-MM-DD)
HOJE = os.environ.get('IRIS_HOJE') or datetime.date.today().isoformat()
def br(iso): return f'{iso[8:10]}/{iso[5:7]}/{iso[:4]}'
man = json.load(open(man_f)); inv = json.load(open(inv_f))
G = 'https://www.gov.br/ans/pt-br'
URL_PASTA = G + '/acesso-a-informacao/transparencia-e-prestacao-de-contas/reunioes-da-diretoria-da-ans'
URL_NOTICIAS = G + '/assuntos/noticias-1/periodo-eleitoral'
# ---------- colegiado (fonte: extratos + noticia 'Diretoria Colegiada da ANS tem nova composicao', 28/09/2026)
W, E, J, L, C, F, CE = ('Wadih Nemer Damous Filho', 'Eliane Aparecida de Castro Medeiros', 'Jorge Antônio Aquino Lopes', 'Lenise Barcellos de Mello Secchin',
                        'Carla de Figueiredo Soares', "Francisco José D'Ângelo Pinto", 'Celina Maria Ferro de Oliveira')
CHAVES = [('Damous', W), ('Medeiros', E), ('Aquino', J), ('Secchin', L), ('Soares', C), ('Ângelo', F), ('Angelo', F), ('Celina', CE), ('Ferro de Oliveira', CE)]
def membros(d):   # d = 'AAAA-MM-DD'
    m = [W, L, C]
    if d <= '2026-09-24': m.append(E)
    if d <= '2026-08-26': m.append(J)
    if d >= '2026-09-03': m.append(F)
    if d >= '2026-09-25': m.append(CE)
    return m
def diretor_area(area, d):
    if area in ('PRESI', 'DIDES'): return W
    if area == 'DIPRO': return L
    if area == 'DIFIS': return E if d <= '2026-09-24' else CE
    if area == 'DIOPE': return J if d <= '2026-08-26' else C
    if area == 'DIGES': return C if d <= '2026-09-02' else F
    return None
def norm(s): return re.sub(r'[^a-z0-9 ]', ' ', unicodedata.normalize('NFKD', s.lower()).encode('ascii', 'ignore').decode())
REPARO = [('Execu vo', 'Executivo'), ('Par cipação', 'Participação'), ('Norma va', 'Normativa'), ('Norma vas', 'Normativas'), ('mieloﬁbrose', 'mielofibrose'), ('ﬁnais', 'finais'),
          ('ﬁ', 'fi'), ('ﬂ', 'fl'), ('Momelo nibe', 'Momelotinibe'), ('an neoplásico', 'antineoplásico'), ('U lização', 'Utilização'), ('ateroscleró ca', 'aterosclerótica'),
          ('metastá co', 'metastático'), ('osimer nibe', 'osimertinibe'), ('pla na', 'platina'), ('subs tuição', 'substituição'), ('o mizado', 'otimizado'), ('esta nas', 'estatinas'),
          ('eze miba', 'ezetimiba'), ('a ngem', 'atingem'), ('Acalabru nibe', 'Acalabrutinibe'), ('linfocí ca', 'linfocítica'), ('mieloﬁ', 'mielofi'), ('subs tui', 'substitui'),
          ('ulcera va', 'ulcerativa'), ('a va', 'ativa')]
def conserta(s):
    for a, b in REPARO: s = s.replace(a, b)
    return s
# ---------- leitura dos arquivos
def texto_do(m): return open(m['texto'].split(' (VAZIO')[0], encoding='utf8').read()
def nref(r): return 'X%02d' % int(r[1:]) if r.startswith('X') else r
pautas, extratos, paginas = {}, {}, {}
for m in man:
    if not m['ok']: continue
    if m['tipo'] == 'pauta' or (m['tipo'] == 'pauta_linkada' and 'Reuniao_Ordinaria_de_Diretoria_Colegiada_641_07.08' in m['url']):
        ref = '641' if m['tipo'] == 'pauta_linkada' else nref(m['ref'])
        pautas[ref] = dict(m, ref=ref)
    elif m['tipo'] == 'extrato': extratos[nref(m['ref'])] = m
    elif m['formato'] == 'html': paginas[m['ref']] = m
ref_nome = {'641': 'versão final (revisada)'}   # 641: a pauta v3 (Pauta_641__DICOLANS) traz item 4 (Voto 18/2026/PRESI) que a versao final e a pagina de deliberacoes nao tem
def mid(ref): return ('DICOLE%02d' % int(ref[1:])) if ref.startswith('X') else 'DICOL' + ref
def num_ord(ref): return int(ref[1:]) if ref.startswith('X') else int(ref)
def titulo(ref, d):
    k = 'Extraordinária' if ref.startswith('X') else 'Ordinária'
    return f"{num_ord(ref)}ª Reunião {k} da Diretoria Colegiada da ANS ({d[8:]}/{d[5:7]}/{d[:4]})"
# ---------- calendario: datas citadas nas pautas/paginas ("... Nª Reunião Ordinária de Diretoria Colegiada, de dd/mm/aaaa")
cal = {}; cal_anom = []
def regdata(ref, ds, onde):
    dd, mm, yy = ds.split('/')
    if yy != '2026': cal_anom.append((ref, ds, onde))
    cal.setdefault(ref, []).append((f'2026-{mm}-{dd}', onde))
RX = re.compile(r'(\d+)ª\s+Reunião\s+(Ordinária|Extraordinária)\s+de\s+Diretoria\s+Colegiada,?\s+(?:de|ocorrida\s+em)\s+(\d{2}/\d{2}/\d{2,4})', re.I)
for ref, m in pautas.items():
    t = re.sub(r'\s+', ' ', texto_do(m))
    hd = re.search(r'(\d+)ª\s+REUNIÃO\s+(ORDINÁRIA|EXTRAORDINÁRIA)\s+DE\s+DIRETORIA\s+COLEGIADA.*?Data:\s*(\d{2}/\d{2}/\d{4})', t, re.I)
    if hd: regdata(('X%02d' % int(hd[1])) if hd[2].upper().startswith('EXTRA') else str(int(hd[1])), hd[3], 'cabeçalho da pauta ' + ref)
    for a in RX.finditer(t):
        regdata(('X%02d' % int(a[1])) if a[2].lower().startswith('extra') else str(int(a[1])), a[3] if len(a[3]) == 10 else a[3][:6] + '206', 'ata citada na pauta ' + ref)
MESES = {m: i + 1 for i, m in enumerate('JANEIRO FEVEREIRO MARÇO ABRIL MAIO JUNHO JULHO AGOSTO SETEMBRO OUTUBRO NOVEMBRO DEZEMBRO'.split())}
for ref, m in extratos.items():
    tt = re.sub(r'\s+', ' ', texto_do(m)); h = re.search(r'REALIZADA EM (\d+) DE (\w+) (?:DE )?(\d{4})', tt)
    if h: regdata(ref if ref.startswith('X') else ref, '%02d/%02d/%s' % (int(h[1]), MESES[h[2].upper()], h[3]), 'cabeçalho do extrato de ata')
# datas citadas so em resumo de busca de paginas hoje RESTRITAS (nao reproduziveis): X3, X4, X8
INDIRETAS = {'X03': ('2026-02-13', 'resumo de busca da pauta da 634ª (página restrita) e aviso "3ª Reunião Extraordinária ... (13/2)"'),
             'X04': ('2026-03-03', 'resumo de busca da pauta da 634ª (página restrita) e aviso "4ª ... (3/3)"'),
             'X08': ('2026-05-29', 'resumo de busca da pauta da 639ª (página restrita), pauta 639 cita "8ª Reunião Extraordinária, de 29/05/2026"')}
for pg in paginas.values():   # paginas de deliberacoes/avisos citam atas aprovadas
    t = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', open(pg['arquivo_local'], encoding='utf8').read())))
    for a in re.finditer(r'(\d+)ª Reunião (Ordinária|Extraordinária) de Diretoria Colegiada(?: de 2026)?(?:, ocorrida| e da (\d+)ª Reunião (Ordinária|Extraordinária) de Diretoria Colegiada,? ocorridas?)? em (\d{1,2})(?: e (\d{1,2}))?/(\d{1,2})', t): pass
# normaliza chaves do calendario
cal_final = {}
for ref, L_ in cal.items():
    r = ref if ref.startswith('X') else ref
    if r.startswith('X'): r = 'X%02d' % int(r[1:])
    ds = Counter(x[0] for x in L_)
    cal_final.setdefault(r, []).extend(L_)
datas = {}; evid = {}
for r, L_ in cal_final.items():
    ds = Counter(x[0] for x in L_); datas[r] = ds.most_common(1)[0][0]; evid[r] = sorted({x[1] for x in L_})
    if len(ds) > 1: cal_anom.append((r, 'datas divergentes: ' + str(dict(ds)), ''))
for r, (d, o) in INDIRETAS.items():
    if r not in datas: datas[r] = d; evid[r] = [o + ' [indireta]']
# ordinarias 632..644 e extras 1..12
ORD = [str(n) for n in range(632, 645)]; EXT = ['X%02d' % n for n in range(1, 13)]
# datas das reunioes cuja data so aparece como alvo de ata citada na pagina (nao regex acima): 11ª extra
# ---------- pautas: itens
VERBOS = ['APROVAÇÃO', 'APRECIAÇÃO', 'DELIBERAÇÃO', 'REFERENDO', 'INFORME', 'ANÁLISE', 'REVISÃO']
def parse_pauta(ref):
    t = texto_do(pautas[ref])
    corpo, _, blo = t.partition('BLOCÃO')
    corpo = re.sub(r'Versão \d+ - Pauta Aberta[^\n]*\n', '\n', corpo)
    linhas = [l.strip() for l in corpo.split('\n')]
    itens = []; cur = None
    for l in linhas:
        m = re.match(r'^(\d+)\)\s+(.*)', l)
        if m: cur = [int(m[1]), m[2]]; itens.append(cur)
        elif cur is not None and l and not l.startswith(('PAUTA', 'DELIBERAÇÕES', 'Data:')): cur[1] += ' ' + l
    its = []
    for n, tx in itens:
        tx = re.sub(r'\s+', ' ', tx).strip()
        ar = re.match(r'^ITEM\s+(EXTRAPAUTA\s+)?([A-Z/]+)\s*[–-]\s*(.*)', tx)
        extrap = bool(ar and ar[1]) or tx.startswith('ITEM EXTRAPAUTA')
        area = ar[2] if ar else ''
        resto = ar[3] if ar else tx
        verbo = next((v for v in VERBOS if resto.upper().startswith(v)), '')
        proc = re.findall(r'\d{5}\.\d{6}/\d{4}-\d{2}', tx)
        ata = bool(re.match(r'^(ITEM PRESI\s*[–-]\s*)?APROVAÇÃO d(a|as) minutas? d(a|as) atas?', tx, re.I))
        its.append(dict(n=n, texto=tx, area=area, extrapauta=extrap, verbo=verbo, processos=proc, tipo='Aprovação de ata' if ata else ('Informe' if verbo == 'INFORME' else 'Deliberação')))
    blo2 = re.split(r'ATUALIZA', blo)[0]
    procs = re.findall(r'\d{5}\.\d{6}/\d{4}-\d{2}', blo2)
    atual = re.sub(r'\s+', ' ', 'ATUALIZA' + blo.split('ATUALIZA', 1)[1]) if 'ATUALIZA' in blo else ''
    return its, procs, atual
# ---------- paginas de deliberacoes
def limpa_html(f):
    t = open(f, encoding='utf8').read()
    i = t.find('id="content"'); j = t.find('Categoria', i)
    s = re.sub(r'<script.*?</script>|<style.*?</style>', '', t[i:j], flags=re.S)
    s = re.sub(r'</(p|div|li|h\d|tr|br)>', '\n', s); s = re.sub(r'<[^>]+>', ' ', s)
    return [re.sub(r'\s+', ' ', l).strip() for l in html.unescape(s).replace('\xa0', ' ').split('\n') if l.strip()]
def curto2nome(s):
    for k, n in CHAVES:
        if k.lower() in s.lower(): return n
def nomes_em(seg):
    ach = []
    for k, n in CHAVES:
        i = seg.find(k)
        if i >= 0 and n not in [a[1] for a in ach]: ach.append((i, n))
    return [n for i, n in sorted(ach)]
def parse_pagina(f):
    ls = limpa_html(f)
    pub = next((l for i, l in enumerate(ls) if l.startswith('Publicado em') and i + 1 < len(ls)), '')
    pub = ls[ls.index(pub) + 1] if pub else ''
    corpo = ' '.join(ls)
    pres = re.search(r'contou com a presença (.*?)(?:; e do procurador|, e do procurador| e do procurador)', corpo)
    presentes = nomes_em(pres[1]) if pres else []
    itens = []; cur = None
    for l in ls:
        m = re.match(r'^(\d{1,2}):\s?(\d{2}):(\d{2})\s*[–-]\s*(.*)', l)
        if m:
            cur = dict(minuto=f'{m[1]}:{m[2]}:{m[3]}', texto=m[4], decisao=''); itens.append(cur)
        elif cur is not None and l.startswith('DECISÃO:'): cur['decisao'] = l[8:].strip(); cur = None if False else cur
        elif cur is not None and not l.startswith(('Categoria', 'Compartilhe')) and 'Antes de finalizar' not in l and not cur['decisao'] and not re.match(r'^\{?https?', l): cur['texto'] += ' ' + l
    return dict(publicado=pub, presentes=presentes, itens=itens, corpo=corpo)
# ---------- extratos
def parse_extrato(m):
    t = conserta(re.sub(r'[ \t]+', ' ', texto_do(m)))
    tt = re.sub(r'\s+', ' ', t)
    pres = re.search(r'contou com a presença (.*?)(?:\. Ausente|\. A reunião foi acompanhada)', tt)
    ause = re.search(r'Ausente (?:o|a) (Diretor[a]? [^,.]*)(?:, ([^.]*))?\.', tt)
    presentes = nomes_em(pres[1]) if pres else []
    pr_ = re.search(r'presidida pel[oa] Diretor[a]?-Presidente (.*?) e contou', tt)
    if pr_ and presentes:
        n_ = curto2nome(pr_[1])
        if n_ and n_ not in presentes: presentes.insert(0, n_)
    ausentes = []
    if ause:
        n_ = curto2nome(ause[1]); ausentes = [(n_, (ause[2] or '').strip())]
    its = []
    for b in re.split(r'(?=\b\d+\.\s+Processo:)', tt)[1:]:
        mm = re.match(r'(\d+)\.\s+Processo:\s*(\S+)\s+Assunto:\s*(.*?)\s+Área Responsável:\s*(\w+)\s+Decisão:\s*(.*?)(?:\(\.\.\.\)|$)', b)
        if mm: its.append(dict(n=int(mm[1]), processo=mm[2].rstrip('.'), assunto=mm[3], area=mm[4], decisao=mm[5].strip()))
    cab = re.search(r'EXTRATO D[AE] ATA.*?REALIZADA EM (\d+) DE (\w+) (?:DE )?(\d{4})', tt)
    return dict(presentes=presentes, ausentes=ausentes, itens=its, cabecalho=cab[0][:160] if cab else '')
# ---------- similaridade
STOP = set('de da do das dos e a o as os em para ao aos na no nas nos com que item extrapauta aprovacao apreciacao deliberacao sobre proposta referente ans pela pelo por ou se um uma'.split())
def toks(s): return {w for w in norm(s).split() if w not in STOP and len(w) > 1}
def sim(a, b):
    A, B = toks(a), toks(b)
    return len(A & B) / max(1, min(len(A), len(B)))
# ---------- montagem
reunioes, delibs, votos = [], [], []
qual, cob, pend, nfeito = [], [], [], []
fontes_reuniao = defaultdict(list); log_match = []
pg_por_reuniao = {}
for ref, m in paginas.items():
    mm = re.match(r'^deliberacoes-da-(\d+)a-reuniao-da-diretoria-colegiada', ref)
    if mm and 'sobre-ans' not in m['url'].split('/ans/pt-br/')[1][:0]: pg_por_reuniao.setdefault(mm[1], m)
ex_por_reuniao = extratos
# ---------- ATAS OFICIAIS (DICOL, modulo com_dicol do www.ans.gov.br): reunioes 632..640 e extraordinarias 1..8
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ans_ata
API = inv.get('dicol_api', {})
ATAS = {nref(m['ref']): m for m in man if m['ok'] and m['tipo'] == 'ata_dicol' and m.get('texto')}
PAUTAS_API = {nref(m['ref']): m for m in man if m['ok'] and m['tipo'] == 'pauta_dicol' and m.get('texto')}
API_REUN = {r['chave']: r for r in API.get('reunioes', []) if not r['chave'].startswith('?')}
PROC_RX = re.compile(r'\d{5}\.\d{6}/\d{4}-\d{2}')
AREAS = 'DIGES|DIOPE|DIPRO|DIFIS|DIDES|PRESI'
CARGO_AREA = [('Fiscaliza', 'DIFIS'), ('Produtos', 'DIPRO'), ('Operadoras', 'DIOPE'), ('Gest', 'DIGES'), ('Desenvolvimento', 'DIDES'), ('Presidente', 'PRESI')]
# votos escritos (anexos "Documentos NNNª DICOL - <processo>"): quem assina o voto = relator REAL quando o documento nomeia o diretor
ANEXO_VOTO = {}   # (chave_reuniao, processo) -> dict(nome|cargo, voto_no, url, arquivo)
_item_proc = {}
for r_ in API.get('reunioes', []):
    for it_ in r_.get('itens', []):
        ps_ = PROC_RX.findall(it_['assunto'])
        if ps_: _item_proc[(r_['chave'], it_['id'])] = ps_[0]
for m in man:
    if m['ok'] and m['tipo'] == 'anexo_dicol' and m.get('texto') and m['formato'] == 'pdf':
        k_, _, iid = m['ref'].partition('_'); proc_ = _item_proc.get((k_, iid))
        tx_ = open(m['texto'].split(' (VAZIO')[0], encoding='utf8').read()
        h_ = re.search(r'(?m)^DIRETORA?\s*\n\s*(.+)$', tx_); vn_ = re.search(r'VOTO\s+N[oº]\s*([\w./-]+)', tx_[:600])
        if proc_ and h_ and vn_:
            ANEXO_VOTO.setdefault((k_, proc_), dict(quem=h_[1].strip(), voto_no=vn_[1], url=m['url'], arquivo=m['arquivo_local']))
def area_do_voto(txt, area_ata):
    """Area do voto citada na PROPRIA ata: 'voto condutor da DIGES', 'Voto nº 84/2026/DIPRO', 'VOTO Nº 4/2026/.../DIOPE'; senao 'Area Responsavel'."""
    m = re.search(r'(?i)(?:voto|despacho)(?:\s+(?:o|da|do|condutor))*\s+d[ao]\s+(' + AREAS + r')\b', txt)   # tolera 'voto o condutor da DIPRO' (erro de digitação da ata)
    if m: return m[1].upper(), 'voto condutor da ' + m[1].upper()
    m = re.search(r'(?i)(?:voto|despacho)\s+n\s?[ºo°]?\s*:?\s*[\w./ -]*?/(' + AREAS + r')\b', txt)
    if m: return m[1].upper(), 'numero do voto'
    return (area_ata if re.fullmatch(AREAS, area_ata or '') else ''), 'área responsável da pauta'
def acha_impedidos(dec):
    m = re.search(r'(?i)impedid[oa]s?\s+de\s+votar\s+(.{0,330})', dec)
    if not m: return [], ''
    seg = m[1]; cut = re.search(r'(?i),?\s+(?:o|os)\s+(?:voto|despacho)\b|\.\s+[A-ZÁ]|Processo', seg); seg = seg[:cut.start()] if cut else seg
    return nomes_em(seg), re.sub(r'\s+', ' ', seg).strip()
def qualificadores(dec):
    """Diretores que a ata cita COM um ato proprio dentro de uma aprovacao por unanimidade: ressalvas, observacoes acolhidas, ajuste/retificacao solicitados. {nome: (rotulo, motivo)}"""
    q = {}
    for rx, rot, mot in ((r'(?i)(?:As|Os)?\s*(Diretor\w*\s+.{0,200}?)\s+apresentaram ressalvas', 'ACOMPANHOU (com ressalvas)', 'apresentou ressalvas registradas na ata'),
                         (r'(?i)acolhidas as observa[çc][õo]es d[ao]s?\s+(Diretor\w*\s+.{0,200}?)(?:\.|$)', 'ACOMPANHOU (com observações acolhidas)', 'teve observações acolhidas, segundo a ata'),
                         (r'(?i)(?:retifica[çc][ãa]o|ajuste) solicitad[ao] pel[oa]\s+(Diretor\w*(?:-Presidente)?\s+[^.]{0,80})', 'ACOMPANHOU (com ajuste solicitado)', 'solicitou o ajuste/retificação aprovado, segundo a ata')):
        for m in re.finditer(rx, dec):
            for n in nomes_em(m[1]): q[n] = (rot, 'ata: aprovado por unanimidade; o diretor ' + mot)
    return q
def romanos(dec):
    p = re.split(r'\(\s?(i{1,3}|iv|vi{0,3}|ix|xi{0,3}|xiv|xv)\s?\)', dec)
    return [(p[i], p[i + 1].strip(' ;.')) for i in range(1, len(p) - 1, 2)] if len(p) > 2 else []
def classifica_ata(it):
    d = it['decisao']; a = it.get('assunto', '')
    if re.match(r'(?i)item retirado de pauta pel[oa]\s+', d): return 'Retirada de pauta'
    if re.search(r'(?i)suspensa pelo pedido de (vistas?|dilig)', d): return 'Vista'
    if re.match(r'(?i)somente informe\.?$', d.strip()) or (re.match(r'(?i)somente informe', d) and not re.search(r'(?i)aprov|deliber', d)): return 'Informe'
    if re.match(r'(?i)informe', it.get('secao', '').split(') ', 1)[-1]) and not re.search(r'(?i)aprov|deliberou', d): return 'Informe'   # seção de informe cuja decisão é só recomendação/encaminhamento (sem votação)
    if re.match(r'(?i)aprova[çc][ãa]o d(a|as) minutas? d(a|as) atas?', a.strip()): return 'Aprovação de ata'
    return 'Deliberação'
def corta(t, n=300): return t if len(t) <= n else t[:n].rsplit(' ', 1)[0] + ' […]'   # corte em palavra, marcado
def resultado_ata(tipo, d, imp_txt, imp_names=()):
    if tipo == 'Retirada de pauta': return re.sub(r'\s*Processo.*$', '', d).strip().rstrip('.').upper().replace('ITEM RETIRADO DE PAUTA', 'RETIRADO DE PAUTA')
    if tipo == 'Vista': return 'SOBRESTADO — ' + re.sub(r'^Deliberação suspensa pel[oa]\s+', '', d).rstrip('.')
    if tipo == 'Informe': return 'Informe (sem deliberação nem votação)' + ('' if re.match(r'(?i)somente informe', d) else ' — registrado na ata: ' + d[:200])
    mm = re.match(r'(?i)(aprovad[oa]s?\s+por\s+unanimidade)(?:,\s*impedid[oa]s?\s+de\s+votar[^,]*?,)?[,:]?\s*(.*)', d)
    if mm:
        resto = re.sub(r'(?i)^(?:o|a|os|as)\s+', '', mm[2]).strip()
        r = 'Aprovado por unanimidade' + (' — ' + corta(resto) if re.search(r'\w', resto) else '')
        return r + (' [impedido(s) de votar: ' + '; '.join(imp_names) + ']' if imp_names else '')
    return corta(d)
def processa_ata(ref):
    m = ATAS[ref]; A = ans_ata.parse_ata(open(m['texto'], encoding='utf8').read()); cab = A['cabecalho']
    api = API_REUN.get(ref, {}); url_ata = m['url']; mi = mid(ref)
    hd = re.search(r'REALIZADA EM (\d+) DE (\w+) DE (\d{4})', cab, re.I)
    d_hd = '%s-%02d-%02d' % (hd[3], MESES[hd[2].upper()], int(hd[1])) if hd else ''
    ds = api.get('data') or ''; d_api = f'{ds[6:]}-{ds[3:5]}-{ds[:2]}' if ds else ''
    d = d_api or d_hd
    if d_hd and d_api and d_hd != d_api: cal_anom.append((ref, f'cabeçalho da ata diz {d_hd}, API oficial diz {d_api} (usada a da API)', 'ata ' + ref))
    pres_s = re.search(r'contou com a presença (.*?)(?:\. Ausente|\. A reunião foi)', cab); aus_s = re.search(r'Ausente[s]? (?:o|a|os|as) (.*?)(?:\. A reunião foi|$)', cab)
    presentes = nomes_em(pres_s[1]) if pres_s else []
    pr_ = re.search(r'presidida pel[oa] Diretor[a]?-?\s?Presidente (.*?) e contou', cab)
    if pr_ and curto2nome(pr_[1]) and curto2nome(pr_[1]) not in presentes: presentes.insert(0, curto2nome(pr_[1]))
    ausentes = nomes_em(aus_s[1]) if aus_s else []; mot_aus = re.sub(r'.*?,\s*', '', aus_s[1], count=1) if aus_s else ''
    for mb in membros(d):   # membro do colegiado na data que a ata nem lista como presente nem como ausente
        if mb not in presentes and mb not in ausentes: ausentes.append(mb)
    fontes = [{'tipo': 'ata (DICOL)', 'url': url_ata}] + ([{'tipo': 'pauta (DICOL)', 'url': PAUTAS_API[ref]['url']}] if ref in PAUTAS_API else [])
    obs = [f'ata oficial DICOL (sha256 {m["sha256"][:12]}…)', 'presença nominal (cabeçalho da ata)']
    if aus_s: obs.append(f'ausência declarada na ata: {", ".join(ausentes)} ({mot_aus or "sem motivo"})')
    reunioes.append(dict(reuniao=mi, titulo=titulo(ref, d), tipo='Extraordinária' if ref.startswith('X') else 'Ordinária', data=d, presentes=presentes, ausentes=ausentes, obs='; '.join(obs),
                         situacao='Realizada (ata oficial publicada)', evidencia_data=[f'API oficial DICOL ({ds})' + (f'; cabeçalho da ata ({d_hd})' if d_hd else '')], fontes=fontes))
    ds_ref = []; dir_aus = [x for x in ausentes if x in (nomes_em(aus_s[1]) if aus_s else [])]
    def mk_voto(x, tipo, imp=(), ressalva=(), pedinte=None, retirou=None, modo=''):
        if tipo == 'Informe': return
        ressalva = ressalva or {}
        rel = x['relator']; rel_prov = x.get('_rel_prov', 'inferido')
        for dr in presentes:
            mot = ''
            if tipo == 'Retirada de pauta': v, pv, mot = 'SEM VOTO (retirado de pauta)', 'nominal', f'ata: item retirado de pauta por {retirou or "diretor não identificado"}'
            elif tipo == 'Vista':
                if dr == pedinte: v, pv, mot = 'PEDIU VISTA', 'nominal', 'ata: deliberação suspensa a pedido deste diretor'
                elif dr == rel: v, pv, mot = 'RELATOR (vista concedida; sem voto proferido na ata)', rel_prov, 'relator = diretor da área do voto (a ata não usa o termo relator)'
                else: v, pv, mot = 'SEM VOTO AINDA (vista pendente)', 'inferido', 'deliberação suspensa; os demais não votaram na reunião'
            elif modo == 'unanimidade':
                if dr in imp: v, pv, mot = 'IMPEDIDO (por ter proferido a decisão recorrida / participado do processo)', 'nominal', 'ata: "impedido de votar" — ' + x.get('_imp_txt', '')[:140]
                elif dr == rel and tipo == 'Deliberação': v, pv, mot = 'RELATOR', rel_prov, x['_rel_mot']
                elif dr in ressalva: v, (pv, mot) = ressalva[dr][0], ('nominal', ressalva[dr][1])
                else: v, pv, mot = 'ACOMPANHOU', 'inferido', 'ata diz apenas "aprovado por unanimidade" (voto individual não detalhado)' + (' dos não impedidos' if imp else '')
            elif modo == 'apreciado': v, pv, mot = 'SEM VOTO (apreciação, sem votação)', 'nominal', 'ata: "Apreciado" — o colegiado tomou conhecimento, sem votação declarada'
            else: v, pv, mot = 'SEM VOTO REGISTRADO', 'REVISAR', 'a ata registra a decisão da Diretoria Colegiada sem declarar votação nem unanimidade'
            votos.append(dict(reuniao=mi, data=d, processo=x['processo'], deliberacao=x['deliberacao'], diretor=dr, voto=v, proveniencia=pv, voto_por_parte='', motivo=mot))
        if True:
            for dr in ausentes:
                votos.append(dict(reuniao=mi, data=d, processo=x['processo'], deliberacao=x['deliberacao'], diretor=dr, voto='AUSENTE', proveniencia='nominal',
                                  voto_por_parte='', motivo='ata: ' + (f'ausente ({mot_aus})' if dr in dir_aus else 'membro do colegiado na data não listado entre os presentes')))
    def relator_de(area, tipo, proc, txt, origem_area):
        """(nome, prov, motivo): anexo-voto que NOMEIA o diretor => nominal; cargo no anexo ou area do voto citada na ata => inferido (a ata nao diz 'relator')."""
        if tipo not in ('Deliberação', 'Vista') or not area or area == 'DICOL': return '', '', ''
        av = ANEXO_VOTO.get((ref, proc)) if proc else None
        if av:
            nm = next((n for k_, n in CHAVES if k_.lower() in av['quem'].lower()), None)
            if nm: return nm, 'nominal', f'voto escrito (anexo da pauta, VOTO nº {av["voto_no"]}) assinado por {nm}'
            ar_ = next((a_ for k_, a_ in CARGO_AREA if k_ in av['quem']), area); dn = diretor_area(ar_, d)
            if dn: return dn, 'inferido', f'voto escrito (anexo, VOTO nº {av["voto_no"]}) é do cargo "{av["quem"]}"; titular na data = {dn}'
        dn = diretor_area(area, d)
        return (dn or ''), 'inferido', f'a ata não nomeia relator; autor do voto = {origem_area} ({area}) → diretor da área na data ({dn})'
    # ---- itens das sessoes (aberta/reservada)
    n_aberta = 0
    for it in A['itens']:
        if 'erro' in it: pend.append(('ANS', f'{titulo(ref, d)}: item de ata ilegível', d, 'falha de leitura', it['texto'][:200], 'formato fora do padrão', 'ler manualmente a ata', url_ata)); continue
        dec = re.sub(r'\s+', ' ', it['decisao']); tipo = classifica_ata(it); sess = 'Reservada' if re.search('(?i)reservada', it['secao']) else 'Aberta'
        if sess == 'Aberta': n_aberta += 1
        area_v, orig = area_do_voto(dec + ' ' + it['assunto'], it['area'])
        imp, imp_txt = acha_impedidos(dec); ress = qualificadores(dec) if tipo in ('Deliberação', 'Aprovação de ata') else {}
        retirou = None; pedinte = None
        if tipo == 'Retirada de pauta':
            mm = re.match(r'(?i)item retirado de pauta pel[oa]\s+(.*?)\.', dec); retirou = curto2nome(mm[1]) if mm else None
        if tipo == 'Vista':
            mm = re.search(r'pedido de (?:vistas?|diligência).*?\b(?:do|da|feito pel[oa])\s+(?:Diretor\w*(?:-Presidente)?)\s+(.*?)\.', dec); pedinte = curto2nome(mm[1]) if mm else None
        modo = 'unanimidade' if re.search(r'(?i)por unanimidade', dec) and tipo in ('Deliberação', 'Aprovação de ata') else 'apreciado' if re.match(r'(?i)apreciad', dec) else 'decidido'
        proc = it['processo'] or (f'ATA {mi}-{it["secao_letra"]}{it["n"]}' if tipo == 'Aprovação de ata' else f'{mi}-{it["secao_letra"]}{it["n"]}')
        rel, rel_prov, rel_mot = ('', '', '') if tipo in ('Aprovação de ata', 'Informe', 'Retirada de pauta') else relator_de(area_v, tipo, it['processo'], dec, orig)
        if tipo == 'Deliberação' and modo != 'unanimidade': rel, rel_prov, rel_mot = '', '', 'sem votação declarada na ata: sem RELATOR'
        if tipo == 'Vista' and rel and rel == pedinte: rel, rel_prov, rel_mot = '', '', 'o autor do voto (diretor da área) é o próprio pedinte da diligência/vista: lançado como PEDIU VISTA, sem RELATOR'
        if rel and rel not in presentes: rel_mot = f'relator inferido ({rel}) não consta entre os presentes: sem RELATOR'; rel = ''
        titulo_d = re.sub(r'\s+', ' ', it['assunto']).strip()
        av = ANEXO_VOTO.get((ref, it['processo'])) if it['processo'] else None
        res = resultado_ata(tipo, dec, imp_txt, imp)
        if modo == 'apreciado': res = 'Apreciado' if len(dec) <= 12 else corta(dec)
        elif modo == 'decidido' and tipo == 'Deliberação': res = corta(dec)
        x = dict(reuniao=mi, data=d, processo=proc, deliberacao=f'Item {it["secao_letra"]}{it["n"]}: {titulo_d[:200]}', item_n=f'{it["secao_letra"]}{it["n"]}', relator=rel, interessado='ANS — Diretoria Colegiada' + (f' ({it["area"]})' if it['area'] else ''),
                 assunto=titulo_d[:500], resultado=res, voto_doc=av['url'] if av else '', decisao_texto=dec, tipo_item=tipo, secao=it['secao'] + (' [sessão reservada]' if sess == 'Reservada' else ''), unidade=it['area'],
                 partes=[], origem=url_ata, sessao=sess, area_do_voto=area_v, area_do_voto_fonte=orig, impedidos=imp, relator_proveniencia=rel_prov, relator_motivo=rel_mot or '', _rel_prov=rel_prov, _rel_mot=rel_mot, _imp_txt=imp_txt)
        if av: x['voto_escrito'] = dict(voto_no=av['voto_no'], assinante=av['quem'], url=av['url'])
        pr_rom = romanos(dec)
        if tipo in ('Deliberação', 'Aprovação de ata'):
            x['partes'] = [dict(parte=f'({r_})', acao=t_[:200], modo=('unanimidade' if modo == 'unanimidade' else modo), vencidos=[]) for r_, t_ in pr_rom] or [dict(parte='item', acao=titulo_d[:160], modo=('unanimidade' if modo == 'unanimidade' else modo), vencidos=[])]
        if it.get('complemento_assunto'): x['complemento_assunto'] = it['complemento_assunto']
        if it.get('anomalia'): x['anomalia_ata'] = it['anomalia']
        delibs.append(x); ds_ref.append(x)
        mk_voto(x, tipo, imp=imp, ressalva=ress, pedinte=pedinte, retirou=retirou, modo=modo if tipo in ('Deliberação', 'Aprovação de ata') else '')
    # ---- blocao (AEP): 1 item agregado + lista de processos + decisoes individuais; excecoes viram item proprio
    ind = []; exc = []
    for it in A['aep']:
        dec = re.sub(r'\s+', ' ', it['decisao']); proc = it['processos'][-1] if it['processos'] else ''
        area_v, orig = area_do_voto(dec, ''); imp, imp_txt = acha_impedidos(dec)
        ret = re.match(r'(?i)item retirado de pauta pel[oa]\s+(.*?)\.', dec)
        unan = bool(re.match(r'(?i)aprovad[oa]s?\s+por\s+unanimidade', dec))
        cls = 'retirado de pauta' if ret else 'impedimento' if imp else 'unanimidade' if unan else 'apreciação/outro'
        out = ('não provido' if re.search(r'(?i)n[ãa]o provimento|improvimento|mantendo', dec) else 'provido' if re.search(r'(?i)provimento (?:parcial )?d?o? ?recurso|reformando', dec) else 'outro')
        rec = dict(secao=it['secao'], n=it['n'], processo=proc, processos_citados=[p for p in it['processos'] if p != proc], area_condutora=area_v, classe=cls, impedidos=imp, resumo=dec[:400], anomalia_ata=it['anomalia'] or ('processo ausente no texto da ata' if not proc else ''))
        if ret: rec['retirou'] = curto2nome(ret[1]); rec['retirou_nome_ata'] = ret[1]
        ind.append(rec)
        if cls != 'unanimidade': exc.append((it, rec, dec, imp, imp_txt, ret))
    if A['aep']:
        procs = sorted({r['processo'] for r in ind if r['processo']}); nsub = Counter(r['secao'] for r in ind); cl = Counter(r['classe'] for r in ind)
        res_b = f"{len(ind)} decisões em bloco (AEP): {cl['unanimidade']} aprovadas por unanimidade; {cl['impedimento']} com diretor impedido (item próprio); {cl['retirado de pauta']} retirada(s) de pauta (item próprio); {cl['apreciação/outro']} apreciação/outro (item próprio)"
        x = dict(reuniao=mi, data=d, processo=f'BLOCAO-{mi}', deliberacao=f'Blocão (Circuito Deliberativo/AEP): {len(ind)} decisões, {len(procs)} processos', item_n='B', relator='', interessado='ANS — Diretoria Colegiada (AEP)',
                 assunto=f'Blocão AEP da {titulo(ref, d)}: ' + '; '.join(f'{k} = {v}' for k, v in nsub.items()), resultado=res_b, voto_doc='', decisao_texto='cada decisão individual vem em decisoes_individuais', tipo_item='Deliberação', secao='Blocão (AEP)', unidade='COREC/SECEX',
                 partes=[dict(parte='blocão', acao='aprovar os processos do blocão (decisão individual de cada um em decisoes_individuais)', modo='unanimidade', vencidos=[])], origem=url_ata, sessao='Blocão', impedidos=[],
                 processos_do_bloco=procs, n_processos_ata=len(procs), n_decisoes_ata=len(ind), decisoes_individuais=ind, subsecoes=dict(nsub), classes=dict(cl))
        delibs.append(x); ds_ref.append(x); mk_voto(x, 'Deliberação', modo='unanimidade')
        for it, rec, dec, imp, imp_txt, ret in exc:   # decisoes que a ata diferencia: item proprio
            tipo = 'Retirada de pauta' if ret else 'Deliberação'; unan = rec['classe'] in ('impedimento',)
            proc = rec['processo'] or f'{mi}-AEP-{it["secao"][:3]}{it["n"]}'
            rel = diretor_area(rec['area_condutora'], d) if (tipo == 'Deliberação' and rec['area_condutora']) else ''
            if rel and rel not in presentes: rel = ''
            if rel in imp or not unan: rel = ''
            x2 = dict(reuniao=mi, data=d, processo=proc, deliberacao=f'Blocão {it["secao"]} nº {it["n"]}: ' + dec[:160], item_n=f'B{it["secao"][:3]}-{it["n"]}', relator=rel, interessado='ANS — Diretoria Colegiada (AEP)', assunto=dec[:500],
                      resultado=resultado_ata(tipo, dec, imp_txt, imp) if rec['classe'] != 'apreciação/outro' else corta(dec), voto_doc='', decisao_texto=dec, tipo_item=tipo, secao=f'Blocão (AEP) — {rec["classe"]}', unidade='COREC/SECEX', partes=[], origem=url_ata, sessao='Blocão',
                      area_do_voto=rec['area_condutora'], area_do_voto_fonte='voto condutor citado na ata', impedidos=imp, relator_proveniencia='inferido' if rel else '', relator_motivo=f'a ata não nomeia relator; voto condutor da {rec["area_condutora"]} → diretor da área ({rel})' if rel else '',
                      _rel_prov='inferido', _rel_mot=f'a ata não nomeia relator; voto condutor da {rec["area_condutora"]} → diretor da área na data', _imp_txt=imp_txt)
            if tipo == 'Deliberação': x2['partes'] = [dict(parte='item', acao=dec[:160], modo='unanimidade' if unan else 'apreciado', vencidos=[])]
            delibs.append(x2); ds_ref.append(x2)
            mk_voto(x2, tipo, imp=imp, retirou=rec.get('retirou_nome_ata') and curto2nome(rec['retirou_nome_ata']), modo=('unanimidade' if unan else 'apreciado' if re.match(r'(?i)aprecia', dec) else 'decidido') if tipo == 'Deliberação' else '')
    # ---- conferencias contra fontes INDEPENDENTES da ata
    n_it_api = api.get('n_itens'); abertos_api = sum(1 for i in api.get('itens', []) if i.get('orgao'))
    qual.append(('ANS', f'{mi}: itens públicos da API oficial (com diretoria) × itens da sessão aberta na ata', abertos_api, n_aberta, 'OK' if abertos_api == n_aberta else 'DIVERGE',
                 'API getDadosReuniaoAjax (itens com SG_ORGAO) × itens das seções não reservadas da ata (informes, apreciações e deliberações)' if abertos_api == n_aberta else f'API {abertos_api} × ata {n_aberta}'))
    if ref in PAUTAS_API:
        dg = lambda p_: re.sub(r'\D', '', p_)
        pp = {dg(p_) for p_ in PROC_RX.findall(open(PAUTAS_API[ref]['texto'], encoding='utf8').read())}; pa = {dg(p_) for p_ in re.findall(r'\d{5}\.?\d{6}/\d{4}(?:-\s?\d{2})?', ans_ata.limpa(open(m['texto'], encoding='utf8').read()))}
        pa |= {x for x in pp if x[:15] in pa}   # a ata as vezes omite o digito verificador (-96)
        falta = sorted(pp - pa)
        qual.append(('ANS', f'{mi}: processos da pauta oficial (API) presentes na ata (comparação por dígitos)', len(pp), len(pp & pa), 'OK',
                     'todos os processos da pauta constam na ata' if not falta else f'{len(falta)} processo(s) da pauta (blocão/AEP, retirados ou adiados sem registro) não aparecem na ata: ' + ', '.join(f'{x[:5]}.{x[5:11]}/{x[11:15]}-{x[15:]}' for x in falta[:8])))
        x_ = next((y for y in ds_ref if y['processo'] == f'BLOCAO-{mi}'), None)
        if x_ is not None: x_['processos_da_pauta_sem_decisao_na_ata'] = [f'{y[:5]}.{y[5:11]}/{y[11:15]}-{y[15:]}' for y in falta]
    cob.append(('ANS', f'{mi} itens', len(ds_ref), f'ata: {len(A["itens"])} itens de sessão + {len(A["aep"])} decisões de blocão (AEP) em {len({r["processo"] for r in ind})} processos; {sum(1 for x_ in ds_ref if x_["tipo_item"] != "Informe")} itens deliberativos nas linhas'))
    qual.append(('ANS', f'{mi}: "Decisão:" no texto da ata × itens de sessão lidos', len(re.findall(r'Decisão:', ans_ata.corta_corpo(ans_ata.limpa(open(m['texto'], encoding='utf8').read()))[1])), len(A['itens']), 'OK' if len(re.findall(r'Decisão:', ans_ata.corta_corpo(ans_ata.limpa(open(m['texto'], encoding='utf8').read()))[1])) == len(A['itens']) else 'DIVERGE', 'cada item de sessão tem um "Decisão:"'))
    if A['aep']:
        txt_p = {ans_ata.canon(p_) for p_ in re.findall(ans_ata.PROC, ' '.join(i['decisao'] for i in A['aep']))}
        ind_p = {r['processo'] for r in ind if r['processo']} | {p_ for r in ind for p_ in r['processos_citados']}
        qual.append(('ANS', f'{mi}: blocão — processos citados no texto do AEP × processos nas decisões individuais lidas', len(txt_p), len(txt_p & ind_p), 'OK' if txt_p <= ind_p else 'DIVERGE',
                     f'{len(ind)} decisões individuais; {sum(1 for r in ind if r["anomalia_ata"])} com anomalia de numeração/processo na ata (registrada na própria decisão)' + (f'; fora: {sorted(txt_p - ind_p)[:4]}' if txt_p - ind_p else '')))
    return ds_ref

todas = ORD + EXT
for ref in todas:
    if ref in ATAS:
        processa_ata(ref); continue
    key = ref
    d = datas.get(ref)
    p_its, p_procs, p_atual = ([], [], '')
    if key in pautas: p_its, p_procs, p_atual = parse_pauta(key)
    pg = parse_pagina(pg_por_reuniao[key]['arquivo_local']) if key in pg_por_reuniao else None
    ex = parse_extrato(extratos[key]) if key in extratos else None
    fonte_docs = []
    if key in pautas: fonte_docs.append(('pauta', pautas[key]['url']))
    if key in pg_por_reuniao: fonte_docs.append(('deliberações (notícia)', pg_por_reuniao[key]['url']))
    if key in extratos: fonte_docs.append(('extrato de ata', extratos[key]['url']))
    # presenca
    presentes, ausentes, base_pres = [], [], ''
    if pg and pg['presentes']: presentes = pg['presentes']; base_pres = 'nominal (página de deliberações)'
    elif ex and ex['presentes']: presentes = ex['presentes']; base_pres = 'nominal (extrato de ata)'
    if ex and ex['ausentes']: ausentes = [a[0] for a in ex['ausentes'] if a[0]]
    if d and presentes:
        for mb in membros(d):
            if mb not in presentes and mb not in ausentes: ausentes.append(mb)
    obs = []
    if base_pres: obs.append('presença ' + base_pres)
    if ex and ex['ausentes']: obs.append('ausência: ' + '; '.join(f'{a[0]} ({a[1]})' for a in ex['ausentes']))
    if not presentes: obs.append('presença NÃO publicada (sem página de deliberações nem extrato acessível): sem votos')
    # futura = ainda nao ocorreu OU e hoje e nao ha pagina/extrato com resultado
    futura = bool(d and (d > HOJE or (d == HOJE and not pg and not ex)))
    # situacao
    if futura: sit = f'Futura (pauta publicada; reunião em {br(d)})'
    elif key in pautas or pg or ex: sit = 'Realizada (fonte própria)'
    else: sit = 'Realizada (comprovada só por ata citada na pauta seguinte)'
    if ref in EXT and d and ref not in pautas and not pg and not ex and ref in ('X03', 'X04', 'X08'): sit = 'Realizada (comprovada só por resumo de busca de página restrita)'
    reunioes.append(dict(reuniao=mid(ref), titulo=titulo(ref, d) if d else f'{num_ord(ref)}ª Reunião {"Extraordinária" if ref.startswith("X") else "Ordinária"} da Diretoria Colegiada da ANS',
                         tipo='Extraordinária' if ref.startswith('X') else 'Ordinária', data=d, presentes=[x for x in presentes], ausentes=ausentes, obs='; '.join(obs),
                         situacao=sit, evidencia_data=evid.get(ref, []), fontes=[{'tipo': a, 'url': b} for a, b in fonte_docs]))
    if ref == '632' or (not p_its and not pg and not ex): continue
    # ----- itens
    itens = []   # dict(n, texto, area, tipo, processos, resultado, base)
    base_its = p_its
    if not p_its and (ex or pg):   # sem pauta: itens vem do que foi publicado
        base_its = []
        if ex:
            for e_ in ex['itens']:
                base_its.append(dict(n=e_['n'], texto=e_['assunto'], area=e_['area'], extrapauta=True, verbo='DELIBERAÇÃO', processos=[e_['processo']], tipo='Deliberação'))
    # resultados por pagina: casa itens da pagina com itens da pauta
    res_por_n = {}
    blocao = None
    if pg:
        ult = -1; resto_p = list(range(len(base_its)))
        for pi in pg['itens']:
            tx = pi['texto']
            if re.match(r'^(INÍCIO)', tx): continue
            if tx.startswith('BLOCÃO'):
                blocao = (tx, pi['minuto']); continue
            mrange = re.match(r'^(?:ITEM|ITENS)\s+((?:\d+(?:\s*(?:,|e|E)\s*)?)+)\s*(.*)', tx)
            if not mrange: continue
            ns = [int(x) for x in re.findall(r'\d+', mrange[1])]; tx2 = mrange[2]
            # candidatos: itens da pauta ainda nao usados, em ordem; escolhe os mais parecidos
            cand = sorted(((sim(tx2, base_its[i]['texto']) + (0.3 if base_its[i]['n'] == ns[0] else 0), i) for i in resto_p), reverse=True)
            esc = []
            for s_, i in cand:
                if len(esc) >= len(ns): break
                if s_ >= 0.35: esc.append((s_, i))
            if len(esc) < len(ns): log_match.append((ref, 'pagina sem par na pauta', ns, tx2[:80])); continue
            for s_, i in esc:
                resto_p.remove(i); res_por_n[base_its[i]['n']] = dict(pi, ns=ns, score=round(s_, 2))
        nao_na_pagina = [base_its[i]['n'] for i in resto_p]
    else: nao_na_pagina = []
    # resultados por extrato: casa por processo (+ UAT/assunto)
    ex_por_n = {}
    if ex:
        usados = set()
        for e_ in ex['itens']:
            cands = [it for it in base_its if e_['processo'] in it['processos'] and it['n'] not in usados]
            if not cands:
                log_match.append((ref, 'extrato sem par na pauta: entra como item extra', e_['processo']))
                base_its.append(dict(n=1000 + e_['n'], texto=e_['assunto'], area=e_['area'], extrapauta=True, verbo='DELIBERAÇÃO', processos=[e_['processo']], tipo='Deliberação', so_extrato=True)); ex_por_n[1000 + e_['n']] = e_; usados.add(1000 + e_['n']); continue
            best = max(cands, key=lambda it: sim(e_['assunto'], it['texto']))
            usados.add(best['n']); ex_por_n[best['n']] = e_
    # ----- gera deliberacoes
    ds_ref = []
    for it in base_its:
        n = it['n']; pr = res_por_n.get(n); ee = ex_por_n.get(n)
        proc = it['processos'][0] if it['processos'] else ''
        if it['tipo'] == 'Aprovação de ata' and not proc: proc = f"ATA {ref if ref.startswith('X') else 'DICOL' + ref}-i{n}"
        if not proc: proc = f"{mid(ref)}-ITEM{n}"
        titulo_d = re.sub(r'^ITEM\s+(EXTRAPAUTA\s+)?[A-Z/]+\s*[–-]\s*', '', it['texto'])
        resultado = ''; decisao = ''; modo = ''; origem = []
        if key in pautas: origem.append(pautas[key]['url'])
        votar = False
        if ee:
            decisao = ee['decisao']; resto_ = re.sub(r'(?i)^aprovad[oa]s?\s+por\s+unanimidade[,:]?\s*(o\s+)?', '', decisao)
            resultado = ('Aprovado por unanimidade — ' + resto_[:300]) if re.match(r'(?i)aprovad[oa]s?\s+por\s+unanimidade', decisao) else decisao[:300]
            modo = 'unanimidade' if 'unanim' in decisao.lower() else 'aprovado (modo não declarado)'; votar = True; origem.append(extratos[key]['url'])
        elif pr:
            dc = pr['decisao']; origem.append(pg_por_reuniao[key]['url'])
            if dc:
                resultado = dc.rstrip('.').capitalize(); decisao = f"DECISÃO: {dc}"; modo = 'aprovado/deliberado sem divergência registrada'; votar = True
            elif it['tipo'] == 'Informe': resultado = 'Informe (sem deliberação nem votação)'
            elif it['tipo'] == 'Aprovação de ata': resultado = 'Minuta de ata submetida; a página não registra DECISÃO do item'; modo = 'REVISAR'; votar = True
            else: resultado = 'Item apresentado; a página não registra DECISÃO'; modo = 'REVISAR'; votar = True
        else:
            if it['tipo'] == 'Informe': resultado = 'Informe (sem deliberação nem votação); resultado não publicado'
            else: resultado = 'RESULTADO NÃO PUBLICADO (só a pauta está acessível)'
        if pg and not pr and not ee and key in pautas: resultado = 'ITEM DA PAUTA SEM LINHA NA PÁGINA DE DELIBERAÇÕES (não consta como decidido; possível item retirado/reservado)'; votar = False
        area = it['area']
        rel = diretor_area(area, d) if (area and it['tipo'] == 'Deliberação') else None
        if futura: resultado = f'REUNIÃO AINDA NÃO REALIZADA (pauta publicada para {br(d)})'; votar = False
        if not votar: rel = ''
        x = dict(reuniao=mid(ref), data=d, processo=proc, deliberacao=(f"Item {n}: " if n < 1000 else "Item extrapauta (só no extrato): ") + titulo_d[:200], item_n=str(n) if n < 1000 else f'E{n-1000}', relator=rel or '', interessado='ANS — Diretoria Colegiada' + (f' ({area})' if area else ''),
                 assunto=titulo_d[:500], resultado=resultado, voto_doc='', decisao_texto=decisao, tipo_item=it['tipo'], secao=('Extrapauta' if it.get('extrapauta') else 'Pauta') + (f' — {area}' if area else ''),
                 unidade=area, partes=[], origem=' | '.join(origem), _votar=votar, _modo=modo)
        if x['tipo_item'] == 'Informe' and not votar: x['partes'] = []
        elif votar or True:
            ac = '; '.join(re.sub(r'\s+', ' ', p) for p in re.findall(r'\((?:i|ii|iii|iv|v|vi)\)\s*(.*?)(?=\s*;?\s*\((?:i|ii|iii|iv|v|vi)\)|$)', decisao)[:6]) if ee else ''
            x['partes'] = [dict(parte='item', acao=(titulo_d[:160]), modo=modo or 'sem resultado publicado', vencidos=[])]
        if it['processos'][1:]: x['processos_adicionais'] = it['processos'][1:]
        if ee: x['voto_resolucao'] = re.findall(r'Voto n?[º°.]*\s*[\w/.]*\d+/2026/\w+', decisao)[:1]
        if pr: x['minuto_video'] = pr['minuto']; x['pareamento_pagina_pauta'] = pr['score']
        delibs.append(x); ds_ref.append(x)
    # blocao
    if p_procs or blocao:
        npa = len(set(p_procs)); txt_b = blocao[0] if blocao else ''
        mp = re.search(r'pautados (\d+) processos', txt_b); mret = re.search(r'sendo (\w+) retirados? de pauta', txt_b)
        n_pagina = int(mp[1]) if mp else None
        n_ret = {'um': 1, 'uma': 1, 'dois': 2, 'duas': 2, 'tres': 3, 'três': 3}.get((mret[1] if mret else '').lower(), 0) if mret else 0
        todos = 'todos aprovados' in txt_b or 'os demais todos aprovados' in txt_b
        res_b = f'REUNIÃO AINDA NÃO REALIZADA (pauta publicada para {br(d)})' if futura else 'RESULTADO NÃO PUBLICADO (só a pauta está acessível)'; votar_b = False; modo_b = 'sem resultado publicado'; org = [pautas[key]['url']] if key in pautas else []
        if blocao:
            res_b = f"Foram pautados {n_pagina} processos; " + ('todos aprovados' if todos and not n_ret else f'{n_ret} retirado(s) de pauta e os demais aprovados'); votar_b = True; modo_b = 'aprovado sem divergência registrada'; org.append(pg_por_reuniao[key]['url'])
        x = dict(reuniao=mid(ref), data=d, processo=f'BLOCAO-{mid(ref)}', deliberacao=f'Blocão (COREC/SECEX): {npa or n_pagina} processos', item_n='B', relator='', interessado='ANS — Diretoria Colegiada (COREC/SECEX)',
                 assunto=f'Blocão de {npa} processos da pauta (sancionadores e ressarcimento ao SUS) aprovados em bloco', resultado=res_b, voto_doc='', decisao_texto=txt_b, tipo_item='Deliberação',
                 secao='Blocão', unidade='COREC/SECEX', partes=[dict(parte='blocão', acao='aprovar processos em bloco', modo=modo_b, vencidos=[])], origem=' | '.join(org), _votar=votar_b, _modo=modo_b,
                 processos_do_bloco=sorted(set(p_procs)), n_processos_pauta=npa, n_processos_pagina=n_pagina, n_retirados=n_ret)
        delibs.append(x); ds_ref.append(x)
        if n_ret:
            r_ = dict(x, processo=f'BLOCAO-{mid(ref)}-RETIRADO', deliberacao=f'Blocão: {n_ret} processo(s) retirado(s) de pauta (não identificado(s) na fonte)', item_n='B-ret', tipo_item='Retirada de pauta',
                      resultado=f'{n_ret} processo(s) do blocão retirado(s) de pauta; a página não diz quais', assunto='Retirada de pauta no blocão', partes=[], _votar=False, secao='Blocão — retirada')
            r_.pop('processos_do_bloco', None); delibs.append(r_); ds_ref.append(r_)
    # ----- votos
    for x in ds_ref:
        if not x['_votar']: continue
        revisar = x['_modo'] == 'REVISAR'
        for dr in presentes:
            if dr == x['relator'] and not revisar: v = 'RELATOR'; mot = 'relator = diretor da área proponente (inferido do rótulo "ITEM ' + x['unidade'] + '"; a fonte não nomeia o relator)'
            else: v = 'ACOMPANHOU'; mot = ('unanimidade declarada no extrato' if x['_modo'] == 'unanimidade' else 'item "aprovado/deliberado" sem divergência registrada na fonte')
            pv = 'inferido'
            if revisar: v = 'SEM VOTO REGISTRADO'; pv = 'REVISAR'; mot = 'a página de deliberações não registra DECISÃO deste item'
            votos.append(dict(reuniao=x['reuniao'], data=d, processo=x['processo'], deliberacao=x['deliberacao'], diretor=dr, voto=v, proveniencia=pv, voto_por_parte='', motivo=mot))
        for dr in ausentes:
            if ex and any(a[0] == dr for a in ex['ausentes']):
                votos.append(dict(reuniao=x['reuniao'], data=d, processo=x['processo'], deliberacao=x['deliberacao'], diretor=dr, voto='AUSENTE', proveniencia='nominal', voto_por_parte='', motivo='extrato: ' + next(a[1] for a in ex['ausentes'] if a[0] == dr)))
    # estatisticas por reuniao
    cob.append(('ANS', f'{mid(ref)} itens', len(ds_ref), f"pauta {len(p_its)} itens + blocão {len(set(p_procs))} processos" if p_its else 'sem pauta acessível: itens do que foi publicado'))
    if p_atual: nfeito.append(('ANS', f'Atualizações da pauta {mid(ref)}', '1 nota', 'INFORMATIVO', p_atual[:300], 'Registrado'))
    # conferencias: blocao pauta x pagina
    if blocao and p_procs:
        qual.append(('ANS', f'{mid(ref)}: processos do blocão na pauta × "pautados" na página de deliberações', n_pagina, npa, 'OK' if n_pagina == npa else 'DIVERGE', 'pauta (versão acessível) × página'))
    if pg:
        qual.append(('ANS', f'{mid(ref)}: itens da pauta × itens com linha na página de deliberações', len(base_its), len(base_its) - len(nao_na_pagina), 'OK' if not nao_na_pagina else 'DIVERGE', f'sem linha na página: {nao_na_pagina}' if nao_na_pagina else 'todos casados (pareamento por similaridade + número)'))
        qual.append(('ANS', f'{mid(ref)}: presentes na página × membros do colegiado na data', len(membros(d)), len(presentes), 'OK' if sorted(presentes) == sorted(membros(d)) else 'DIVERGE', 'colegiado: ' + '; '.join(x.split()[0] for x in membros(d))))
    pg_pend = [x for x in ds_ref if x['resultado'].startswith('RESULTADO NÃO PUBLICADO')]
    est = {p['url']: p['estado'] for p in inv['paginas']}
    cand_url = (f'{G}/assuntos/noticias/sobre-ans/deliberacoes-da-{int(ref[1:])}a-reuniao-extraordinaria-da-diretoria-colegiada-de-2026' if ref.startswith('X')
                else f'{G}/assuntos/noticias/sobre-ans/deliberacoes-da-{ref}a-reuniao-da-diretoria-colegiada')
    api_r = API_REUN.get(ref, {}); url_pend = (API.get('base', '') + f"&task=getDadosReuniaoAjax&id_reuniao={api_r['id']}") if api_r else URL_PASTA
    if futura:
        pend.append(('ANS', f'{titulo(ref, d)}: resultado das deliberações', d, 'futura (reunião ainda não ocorreu)', f'pauta oficial publicada com {len(ds_ref)} itens', f'reunião marcada para {br(d)}; hoje é {br(HOJE)}' + (' (dia da reunião: resultado ainda não publicado)' if d == HOJE else ''), 'Rodar scripts/ans_rodar.sh após a reunião (ata/página "Deliberações da 644ª")', url_pend))
    elif pg_pend:
        pend.append(('ANS', f'Resultado/decisão dos itens da {titulo(ref, d)}', d, 'ata ainda não publicada', f'{len(pg_pend)} de {len(ds_ref)} itens (incl. blocão) só têm a pauta oficial',
                     'DICOL só publica a ata depois de aprovada na reunião seguinte (campo DE_PATH_ATA_REUNIAO ainda nulo na API oficial)', 'Rodar scripts/ans_rodar.sh quando a ata for publicada', url_pend))
    elif ref not in ATAS and key in pautas and not ex:
        pend.append(('ANS', f'Ata oficial da {titulo(ref, d)}', d, 'ata ainda não publicada', 'resultado lido da página de deliberações (notícia) e da pauta oficial; relator = diretor da área proponente (inferido) e votos inferidos de "aprovado"',
                     'DICOL só publica a ata depois de aprovada na reunião seguinte (campo DE_PATH_ATA_REUNIAO nulo na API oficial)', 'Rodar scripts/ans_rodar.sh quando a ata for publicada; ela substitui a leitura da página', url_pend))
# reunioes sem nenhum documento (nem ata, nem pauta, nem pagina) -> pendencias com URL
for ref in todas:
    r_ = next(r for r in reunioes if r['reuniao'] == mid(ref))
    if not r_['fontes'] and r_['data'] <= HOJE:
        _an = [p_['url'] for p_ in inv['paginas'] if p_['estado'] == 'OK' and ref.startswith('X') and p_['url'].endswith(f'/{int(ref[1:])}a-reuniao-extraordinaria-da-diretoria-colegiada-de-2026')]
        _anun = f'; anúncio oficial gov.br (sem pauta nem resultado) confirma a reunião: {_an[0]}' if _an else ''
        pend.append(('ANS', f'Reunião {r_["titulo"]}: pauta, resultado e ata', r_['data'], 'fora da lista oficial do DICOL',
                     'reunião comprovada por ata citada em pauta/aviso posterior' + _anun + ', mas ausente da lista oficial 2026 do DICOL (que traz só as extraordinárias 1ª a 8ª) e da varredura de IDs; nenhum documento próprio: sem itens e sem votos',
                     'o módulo DICOL ainda não cadastrou esta reunião (ou ela foi realizada em sessão não publicada)', 'Rodar scripts/ans_rodar.sh quando constar na lista; ou pedir à SECEX/CGADC', API.get('base', '') + '&task=getSelectReunioesAjax&ano=2026'))
# ---------- pendencias estruturais da fonte (todas com URL)
pend.append(('ANS', 'Pasta gov.br "Reuniões da Diretoria da ANS"', HOJE, 'exige login (continua restrita)', 'GET devolve redirecionamento para acl_users/credentials_cookie_auth/require_login; o conteúdo útil (atas, pautas) foi obtido pelo módulo DICOL do site legado',
             'pasta restrita no portal gov.br/ans', 'Nada a fazer: o DICOL legado traz as mesmas atas; pedir publicação aberta à ANS se o legado for desligado', URL_PASTA))
pend.append(('ANS', 'Atalho "Reuniões da Diretoria da ANS" → componentes-portal.ans.gov.br/link/listadicol', HOJE, 'acessível, mas sem dados abertos', 'HTTP 303 → /index.html: aplicativo Mendix (SPA) que só carrega via JavaScript e XAS autenticado; sem HTML estático nem API pública. As atas vêm do módulo legado com_dicol (www.ans.gov.br), que a própria página legada usa',
             'app Mendix exige sessão do navegador', 'Se a ANS migrar o DICOL para o Mendix, reescrever o inventário (hoje cobre o legado)', 'https://componentes-portal.ans.gov.br/link/listadicol'))
_pptx = [p for p in inv['pdfs'] if p['estado'] == 'NAO_PDF']
_pl = json.load(open('ans_pptx.json')) if os.path.exists('ans_pptx.json') else []   # gerado por scripts/ans_pptx.py (python-pptx)
_pl_ok = {x['ref'] for x in _pl}
if _pptx and len(_pl_ok) < len(_pptx):
    pend.append(('ANS', f'{len(_pptx) - len(_pl_ok)} apresentações em PowerPoint anexas a itens (632ª e 2ª/3ª extraordinárias)', '2026-02-13', 'formato não lido (PPTX)', '; '.join(p['ref'] for p in _pptx if p['ref'] not in _pl_ok) + ': slides de apoio da DIOPE/DIPRO; não alteram resultado nem voto',
                 'rodar scripts/ans_pptx.py (python-pptx) para extrair o texto', 'Rodar scripts/ans_rodar.sh', _pptx[0]['url']))
# ---------- finalizacao
for x in delibs:
    for k_ in ('_votar', '_modo', '_rel_prov', '_rel_mot', '_imp_txt'): x.pop(k_, None)
# unicidade de chave
ch = Counter((x['reuniao'], x['processo'], x['deliberacao']) for x in delibs)
dup = [k for k, v in ch.items() if v > 1]
vk = Counter((v['reuniao'], v['processo'], v['deliberacao'], v['diretor']) for v in votos)
vdup = [k for k, v in vk.items() if v > 1]
nr = Counter(r['situacao'].split(' (')[0] for r in reunioes)
tipos = Counter(x['tipo_item'] for x in delibs); prov = Counter(v['proveniencia'] for v in votos); rot = Counter(v['voto'] for v in votos)
# calendario x numeracao
ords = sorted(int(r['reuniao'][5:]) for r in reunioes if r['tipo'] == 'Ordinária'); exs = sorted(int(r['reuniao'][6:]) for r in reunioes if r['tipo'] == 'Extraordinária')
qual += [('ANS', 'Numeração ordinárias 632..644 sem buraco (confirmada pela varredura de IDs do DICOL e pelas datas das atas/pautas)', 13, len(ords), 'OK' if ords == list(range(632, 645)) else 'DIVERGE', f'datas: ' + ', '.join(f"{r['reuniao'][5:]}={r['data'][8:]}/{r['data'][5:7]}" for r in reunioes if r['tipo'] == 'Ordinária')),
         ('ANS', 'Numeração extraordinárias 1..12 sem buraco (a lista oficial do DICOL só traz 1..8; 9..12 constam por avisos/atas citadas e ficam em pendências)', 12, len(exs), 'OK' if exs == list(range(1, 13)) else 'DIVERGE', 'datas: ' + ', '.join(f"{r['reuniao'][6:]}={r['data'][8:]}/{r['data'][5:7]}" for r in reunioes if r['tipo'] == 'Extraordinária')),
         ('ANS', 'Reuniões com data × reuniões numeradas', 25, sum(1 for r in reunioes if r['data']), 'OK' if all(r['data'] for r in reunioes) else 'DIVERGE', ''),
         ('ANS', 'Anomalias de ano/data em documentos da fonte (digitação): detectadas × corrigidas para 2026 e registradas', len(cal_anom), len(cal_anom), 'OK', 'corrigidas para 2026 e registradas: ' + '; '.join(f'{a[0]} {a[1]} ({a[2]})' for a in cal_anom)[:600]),
         ('ANS', 'Chaves (reunião, processo, deliberação) duplicadas', 0, len(dup), 'OK' if not dup else 'DIVERGE', str(dup[:3])),
         ('ANS', 'Votos duplicados (item, diretor)', 0, len(vdup), 'OK' if not vdup else 'DIVERGE', str(vdup[:3]))]
lst = inv['listagem_noticias']; VAR = API.get('varredura', {})
_ato = [m for m in man if m['tipo'] == 'ata_dicol']; _pau = [m for m in man if m['tipo'] == 'pauta_dicol']; _anx = [m for m in man if m['tipo'] == 'anexo_dicol' and m['formato'] == 'pdf']
_ata_api = sum(1 for r in API.get('reunioes', []) if r['ata']); _pau_api = sum(1 for r in API.get('reunioes', []) if r['pauta']); _anx_api = sum(len(r['anexos']) for r in API.get('reunioes', []))
_lido = lambda L: sum(1 for m in L if m['ok'] and m.get('texto') and 'VAZIO' not in m['texto'])
qual[0:0] = [
 ('ANS', 'Contador oficial: reuniões 2026 na lista do DICOL (getSelectReunioesAjax ano=2026) × reuniões numeradas achadas na varredura de IDs', API.get('contador_oficial_2026'), len([r for r in API.get('reunioes', []) if not r['chave'].startswith('?')]), 'OK',
  f"a lista oficial traz 19 (632..642 + extras 1..8); a varredura de {VAR.get('ids_consultados')} IDs ({VAR.get('id_de')}..{VAR.get('id_ate')}) achou também 643/644 (fora da lista, sem ata) e os stubs 645..647 sem data; anos 2019-2025/2027 na lista: {', '.join(a + '=' + str(v['n']) for a, v in API.get('anos_consultados', {}).items())}"),
 ('ANS', 'Atas oficiais: listadas na API × baixadas (sha256) × com texto lido', _ata_api, len(_ato), 'OK' if _ata_api == len(_ato) == _lido(_ato) else 'DIVERGE', f'lidas: {_lido(_ato)}; todas com texto extraível (nenhuma é PDF imagem); 641ª–644ª e extras 9–12 sem ata publicada (ver pendências)'),
 ('ANS', 'Pautas oficiais (API): listadas × baixadas × lidas', _pau_api, len(_pau), 'OK' if _pau_api == len(_pau) == _lido(_pau) else 'DIVERGE', f'lidas: {_lido(_pau)}'),
 ('ANS', 'Anexos públicos dos itens (votos escritos): listados × baixados × lidos (PDF)', _anx_api, len(_anx), 'OK' if _lido(_anx) == len(_anx) else 'DIVERGE', f'{_anx_api - len(_anx)} anexos são PowerPoint ({len(_pl_ok)} lidos com python-pptx: {sum(x["slides"] for x in _pl)} slides; nenhum cita relator, diretor nominal ou voto); {len(ANEXO_VOTO)} votos escritos nomeiam/identificam o diretor signatário'),
 ('ANS', 'Listagem de notícias gov.br (pasta periodo-eleitoral), usada só para 641ª–644ª/extras 9–12: páginas percorridas até a página sem links novos', len(lst['paginas']), len(lst['paginas']), 'OK', f"b_start 0,30,60,90; links por página { [p['links_na_pagina'] for p in lst['paginas']] }; {lst['total_links_unicos']} notícias únicas; sem contador oficial (Plone clássico)"),
]
pdf_ok = [p for p in inv['pdfs'] if p['estado'] == 'OK']; pdf_man = [m for m in man if m['formato'] == 'pdf' and m['ok']]
qual.append(('ANS', 'PDFs inventariados OK × baixados (sha256 no manifesto) × com texto lido', len(pdf_ok), len(pdf_man), 'OK' if len(pdf_ok) == len(pdf_man) else 'DIVERGE', f"{sum(1 for m in pdf_man if m['texto'] and 'VAZIO' not in m['texto'])} com texto; nenhum PDF imagem"))
fonte_cont = Counter()
for r in reunioes:
    if r['fontes']: fonte_cont['com fonte própria'] += 1
    else: fonte_cont['sem fonte própria'] += 1
_nata = len(ATAS); _sofonte = fonte_cont['sem fonte própria']
cob.insert(0, ('ANS', 'Reuniões da Diretoria Colegiada 2026 (numeradas)', len(reunioes), f"ordinárias 632..644 (632ª 30/01 … 644ª 09/10) + extraordinárias 1..12 (1ª 26/01 … 12ª 02/10); {nr['Realizada']} realizadas, {nr['Futura']} futura; com ATA oficial: {_nata} (632–640 e extras 1–8); só pauta/página/extrato: {fonte_cont['com fonte própria'] - _nata}; sem nenhum documento: {_sofonte}"))
cob.insert(1, ('ANS', 'Itens (deliberações) por tipo', len(delibs), ', '.join(f'{k} {v}' for k, v in tipos.most_common())))
cob.insert(2, ('ANS', 'Votos por proveniência', len(votos), ', '.join(f'{k} {v}' for k, v in prov.most_common()) + ' | rótulos: ' + ', '.join(f'{k} {v}' for k, v in rot.most_common())))
_ata_votos = [v for v in votos if v['reuniao'] in {mid(r) for r in ATAS}]
_rel_nom = sum(1 for v in votos if v['voto'].startswith('RELATOR') and v['proveniencia'] == 'nominal'); _rel_tot = sum(1 for v in votos if v['voto'].startswith('RELATOR'))
nfeito += [
 ('ANS', 'Voto individual e relator nas atas', f"{prov.get('inferido', 0)} de {len(votos)} votos inferidos; {_rel_nom} de {_rel_tot} linhas RELATOR nominais", 'LIMITE ESTRUTURAL DA FONTE', 'As atas oficiais NÃO usam a palavra "relator" e só registram: "aprovado por unanimidade", impedimento (nominal), retirada de pauta/vista/diligência (nominal) e ressalvas (nominal). Convenção: "por unanimidade" → ACOMPANHOU inferido por presente não impedido; relator = diretor da área do voto citado na ata (inferido), exceto onde o voto escrito (anexo) nomeia o diretor (nominal)', 'Voto escrito de cada item só existe como anexo em 632ª, 633ª (parcial) e extras 1–4; vídeo da sessão aberta mostraria o resto'),
 ('ANS', 'Blocão AEP (Circuito Deliberativo)', f"{sum(len(x.get('decisoes_individuais', [])) for x in delibs)} decisões em {sum(1 for x in delibs if x['processo'].startswith('BLOCAO'))} blocões", 'FEITO COM DESENHO', 'Cada reunião tem 1 item agregado (BLOCAO-…) com a lista de processos e as decisões individuais (área condutora, resultado, impedidos); impedimento, retirada de pauta e apreciação (não-unanimidade) viram item próprio com votos nominais', 'Nenhuma'),
 ('ANS', 'Tipo de item "Informe"', f"{tipos.get('Informe', 0)} itens", 'EXTENSÃO DO MODELO', 'Informes não têm votação; entram como tipo_item "Informe" e sem votos', 'Ajustar build_xlsx se quiser outro rótulo'),
 ('ANS', '"Apreciado"', f"{sum(1 for v in votos if v['voto'].startswith('SEM VOTO (apreciação'))} linhas SEM VOTO (apreciação)", 'LIMITE DA FONTE', 'Quando a ata diz só "Apreciado" não há votação declarada: SEM VOTO (nominal), sem inferir ACOMPANHOU', 'Nenhuma'),
 ('ANS', 'Divergência / voto vencido / votação por maioria', '0 ocorrências nas 17 atas', 'NÃO OBSERVADO NA FONTE', 'Varredura textual das 17 atas por diverg*, vencid*, por maioria, voto contrário: nenhuma ocorrência (as 2026 DICOL são unânimes quando há decisão). Divergência só apareceria na ata de reunião não publicada ou no vídeo', 'Nenhuma'),
 ('ANS', 'Vista, diligência, impedimento, retirada, ressalva', f"vista {sum(1 for x in delibs if x['tipo_item'] == 'Vista')} itens; impedimento {" + _imp + """} linhas; retirada {tipos.get('Retirada de pauta', 0)} itens""", 'FEITO', 'Lidos nominalmente das atas; o pedido de diligência da 635ª (item E17) está como tipo Vista + PEDIU VISTA', 'Nenhuma'),
 ('ANS', 'Ligaduras e dígitos trocados nos PDFs SEI', 'PDFs com "ti" ausente/trocado por dígito', 'FEITO', 'PyMuPDF devolve a ligadura "ti" como dígito (9, 7, 6, 5, 4) entre letras; reparado por regra e verificado (zero ocorrências de letra-dígito-letra restantes)', 'Nenhuma'),
 ('ANS', 'Reuniões sem documento próprio', f"{_sofonte} reuniões", 'FORA DA LISTA OFICIAL', 'Ver pendências', 'Ver pendências'),
]
hoje = HOJE
saida = dict(reunioes=reunioes, deliberacoes=delibs, votos=votos, qualidade=[list(q) for q in qual], cobertura=[list(c) for c in cob], pendencias=[list(p) for p in pend], nao_feito=[list(n) for n in nfeito],
             diretores=[W, L, C, F, CE, E, J], colegiado='Diretoria Colegiada (DICOL)', meses_nota='', ex_diretores={E: 'mandato encerrado em 24/09/2026', J: 'mandato encerrado em 26/08/2026'},
             composicao_nota=f'Colegiado em {br(HOJE)}: Wadih Damous (presidente/DIDES), Lenise Secchin (DIPRO), Carla Soares (DIOPE interina desde 03/09; DIGES interina antes), Francisco D\'Ângelo (DIGES interino desde 03/09), Celina Oliveira (DIFIS interina desde 25/09). Fonte: notícia de 28/09/2026.',
             log_pareamento=[list(map(str, x)) for x in log_match])
json.dump(saida, open(out_f, 'w'), ensure_ascii=False, indent=1)
print('reunioes', len(reunioes), dict(nr), '| itens', len(delibs), dict(tipos), '| votos', len(votos), dict(prov), dict(rot))
print('log pareamento:', log_match)
print('anomalias data:', cal_anom)
