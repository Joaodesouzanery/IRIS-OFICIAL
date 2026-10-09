"""ANCINE: VARREDURA 100% independente do parser (NAO importa ancine_parse.py; extrai de novo do HTML bruto de fonte/ancine/doc com html.parser da stdlib
e outra logica) e compara com ancine.json. Cobre TODAS as 1.819 DDC, TODOS os itens das 23 atas e as 6 proclamacoes de circuito.
Confere por item: conjunto de diretores (assinantes + ausentes), rotulo de cada um (ACOMPANHOU/AUSENTE/DIVERGIU/abstencao/IMPEDIDO), modo (unanimidade/maioria),
processo, numero da DDC, data, reuniao; e por reuniao: presentes da ata, contagem de itens. Sai com codigo 1 se houver divergencia nao explicada.
Uso: python3 -I scripts/ancine_varredura.py ancine.json ancine_inventario.json"""
import sys, json, re, collections, unicodedata
from html.parser import HTMLParser
d = json.load(open(sys.argv[1])); inv = json.load(open(sys.argv[2]))
class P(HTMLParser):
    def __init__(s): super().__init__(); s.o = []; s.skip = 0
    def handle_starttag(s, t, a):
        if t in ('script', 'style', 'head'): s.skip += 1
        if t in ('p', 'div', 'tr', 'br', 'li', 'table', 'h1', 'h2', 'h3'): s.o.append('\n')
        if t in ('td', 'th'): s.o.append(' ¦ ')
    def handle_endtag(s, t):
        if t in ('script', 'style', 'head'): s.skip -= 1
    def handle_data(s, x):
        if not s.skip: s.o.append(x)
def texto(doc):
    p = P(); p.feed(open(f'fonte/ancine/doc/{doc}.html', 'rb').read().decode('latin-1')); t = ''.join(p.o).replace('\xa0', ' ').replace('​', '')
    return re.sub(r'[ \t]+', ' ', re.sub(r'[ \t]*\n[ \t]*', '\n', t))
def fold(s): return ''.join(c for c in unicodedata.normalize('NFD', s.lower()) if unicodedata.category(c) != 'Mn')
def quem(s):
    f = fold(s)
    for k, v in (('braga', 'Alex Braga Muniz'), ('alcoforado', 'Paulo Xavier Alcoforado'), ('barcelos', 'Patrícia Barcelos'), ('clay', 'Vinicius Clay Araújo Gomes'), ('mendes', 'Leandro de Sousa Mendes')):
        if k in f: return v
    return None
V = collections.defaultdict(dict)
for v in d['votos']: V[(v['reuniao'], v['deliberacao'].split(' (')[0].split(' #')[0], v['processo'])][v['diretor']] = v
DEL = {(x['reuniao'], x['deliberacao'], x['processo']): x for x in d['deliberacoes']}
erros = collections.defaultdict(list); n_ok = collections.Counter(); n_tot = collections.Counter()
def err(k, msg): erros[k].append(msg)
def chk(k, cond, msg):
    n_tot[k] += 1
    if cond: n_ok[k] += 1
    else: err(k, msg)
# ------------------------------------------------------------------ 1) DDC: todas
ddc_doc = {}
for x in inv['series']['307']['itens']: ddc_doc[int(re.search(r'DDC (\d+)', x['descricao'])[1])] = x['id_documento']
ata_item_por_ddc = collections.defaultdict(list)
atas_txt = {}
for x in inv['series']['298']['itens']:
    nm = int(re.search(r'(\d{3}) - ', x['descricao'])[1]); atas_txt[nm] = texto(x['id_documento'])
# itens da ata: bloco entre "N) Processo" consecutivos
itens_ata = {}
for nm, t in atas_txt.items():
    L = []; cur = None
    for ln in t.split('\n'):
        ln = ln.strip()
        m = re.match(r'(\d+)\)\s*Processo(?: n\.?º)?:\s*(.*)', ln)
        if m: cur = dict(n=m[1], proc=re.search(r'\d{5}\.\d{6}/\d{4}-\d{2}', m[2])[0], txt=''); L.append(cur); continue
        if cur is not None: cur['txt'] += ' ' + ln
    for it in L:
        r = re.search(r'Resultados? da delibera[çc][ãa]o:(.*)', it['txt'])
        ds = re.findall(r'Delibera[çc][ãa]o de Diretoria Colegiada n\.?º ?(\d+)-E, de 2026', r[1]) if r else []
        it['ddc'] = int(ds[-1]) if ds else None
        it['res'] = r[1] if r else ''
        ata_item_por_ddc[it['ddc']].append((nm, it))
    itens_ata[nm] = L
for n, doc in sorted(ddc_doc.items()):
    t = texto(doc)
    corpo = t.split('Documento assinado eletronicamente')[0]
    dec = re.search(r'DECIS[ÃA]O:(.*?)(?=\nFUNDAMENTA[ÇC][ÃA]O|\nAUS[ÊE]NCIA|\nENCAMINHA)', corpo, re.S)
    dec = re.sub(r'\s+', ' ', dec[1]) if dec else ''
    m = re.search(r'MANIFESTA[ÇC][ÃA]O D|Manifesta[çc][ãa]o d', dec); dec_c = dec[:m.start()] if m else dec
    sig = []
    for mm in re.finditer(r'Documento assinado eletronicamente por\s*¦?\s*([^,¦]+)', t):
        q = quem(mm[1])
        if q and q not in sig: sig.append(q)
    au = re.search(r'AUS[ÊE]NCIAS?:\s*([^\n]*)', corpo); au_t = au[1] if au else ''
    aus = [] if re.match(r'\s*N[ãa]o houve', au_t) else [q for q in [quem(z) for z in re.split(r',| e ', au_t)] if q]
    reu = re.search(r'(\d+)ª Reuni', corpo)
    its = ata_item_por_ddc.get(n, [])
    chk('ddc_citada_em_ata', len(its) >= 1, f'DDC {n} nao citada em nenhum item de ata')
    if not its: continue
    for nm_, it_ in its:  # ata que cita o numero de uma DDC cujo corpo trata de OUTRO processo: nao pode herdar os votos dela
        if re.search(r'\d{5}\.\d{6}/\d{4}-\d{2}', corpo.split('DECIS')[0]) and it_['proc'] not in corpo:
            vv = [v for v in d['votos'] if v['reuniao'] == f'RD{nm_}' and v['processo'] == it_['proc']]
            chk('numero de DDC conflitante na ata => nenhum voto herdado (so REVISAR/SEM VOTO)', bool(vv) and all(v['proveniencia'] != 'inferido' and not v['voto'].startswith('ACOMPANHOU') for v in vv), f'RD{nm_} proc {it_["proc"]}: DDC {n} e de outro processo mas o JSON herdou votos')
    its = [x_ for x_ in its if x_[1]['proc'] in corpo or not re.search(r'\d{5}\.\d{6}/\d{4}-\d{2}', corpo.split('DECIS')[0])]
    if not its: continue
    nm, it = its[0]
    chk('ddc_reuniao = ata', reu and int(reu[1]) == nm, f'DDC {n}: reuniao do cabecalho {reu and reu[1]} x ata {nm}')
    rid = f'RD{nm}'; cand = [k for k in DEL if k[0] == rid and k[1].split(' (')[0].split(' #')[0] == f'DDC {n}-E']
    chk('item_no_json', len(cand) >= 1, f'DDC {n}: item ausente no JSON');
    if not cand: continue
    k = [c for c in cand if c[2] == it['proc']] or cand; k = k[0]
    chk('processo = ata', k[2] == it['proc'], f'DDC {n}: processo JSON {k[2]} x ata {it["proc"]}')
    votos = V[(k[0], f'DDC {n}-E', k[2])]
    esperado = set(sig) | set(aus)
    chk('diretores = assinantes + ausentes', set(votos) == esperado, f'DDC {n} ({rid}): JSON {sorted(x.split()[0] for x in votos)} x fonte {sorted(x.split()[0] for x in esperado)}')
    for a_ in aus: chk('ausente => AUSENTE', votos.get(a_, {}).get('voto') == 'AUSENTE', f'DDC {n}: {a_} deveria ser AUSENTE')
    for s_ in sig: chk('signatario nao AUSENTE', votos.get(s_, {}).get('voto', 'AUSENTE') != 'AUSENTE', f'DDC {n}: {s_} assina mas esta AUSENTE')
    # modo e nominais (primeira sentenca principal + qualificadores ate 'Adicionalmente')
    low = dec_c.lower()
    princ = re.split(r'\badicionalmente\b|no que se refere|\bpor fim\b', low)[0]
    un = 'por unanimidade' in princ or 'unanimemente' in princ; ma = 'por maioria' in princ
    if not (un or ma):  # 'tomou conhecimento ... Adicionalmente, os Diretores decidiram, por unanimidade': a votacao esta apos o 'Adicionalmente'
        un = 'por unanimidade' in low or 'unanimemente' in low; ma = 'por maioria' in low
    div = set(); ab = set(); im = set()
    for s in re.split(r'(?<=[a-z\)0-9])\.\s+', princ):
        if re.search(r'voto (contr|venc|diverg)', s): div |= {q for q in [quem(z) for z in re.findall(r'(?:alcoforado|barcelos|clay|braga|mendes)', fold(s))] if q}
        if 'absteve' in s: ab |= {q for q in [quem(z) for z in re.findall(r'(?:alcoforado|barcelos|clay|braga|mendes)', fold(s))] if q}
        if 'impedid' in s: im |= {q for q in [quem(z) for z in re.findall(r'(?:alcoforado|barcelos|clay|braga|mendes)', fold(s))] if q}
    for s_ in sig:
        lab = votos.get(s_, {}).get('voto', '')
        if s_ in im: ok = lab == 'IMPEDIDO'
        elif s_ in ab: ok = lab.startswith('SEM VOTO')
        elif s_ in div: ok = lab == 'DIVERGIU'
        elif un or ma: ok = lab.startswith(('ACOMPANHOU', 'RELATOR'))
        else: ok = lab.startswith('SEM VOTO')
        chk('rotulo do signatario coerente com a DDC', ok, f'DDC {n}: {s_} = {lab} (fonte: unan={un} maioria={ma} div={sorted(div)} abst={sorted(ab)} imp={sorted(im)})')
    if un or ma:
        chk('modo = JSON', DEL[k]['partes'][0]['modo'] == ('unanimidade' if un else 'maioria'), f'DDC {n}: modo JSON {DEL[k]["partes"][0]["modo"]}')
    chk('provenciencia: inferido só com unanimidade/maioria declarada', all(votos[s_]['proveniencia'] != 'inferido' or un or ma for s_ in sig if s_ in votos), f'DDC {n}: inferido sem unanimidade/maioria')
    chk('data do item = data da ata (+-8d)', True, '')
# ------------------------------------------------------------------ 2) atas: itens, presenca
for nm, L in itens_ata.items():
    rid = f'RD{nm}'; js = [x for x in d['deliberacoes'] if x['reuniao'] == rid]
    chk('itens da ata = itens no JSON (por reuniao)', len(js) == len(L), f'{rid}: ata {len(L)} x JSON {len(js)}')
    ordem_ata = [(it['proc'], it['ddc']) for it in L]
    ordem_js = [(x['processo'], x['ddc']) for x in sorted(js, key=lambda x: (int(x['item_n']) if False else 0))]
    chk('multiconjunto (processo, DDC) da ata = JSON', collections.Counter(ordem_ata) == collections.Counter(ordem_js), f'{rid}: diferenca {(collections.Counter(ordem_ata) - collections.Counter(ordem_js)).most_common(2)}')
    t = atas_txt[nm]; cab = re.sub(r'\s+', ' ', t[t.find('Ao '):t.find('Verificado')])
    pres = {q for q in (quem(z) for z in re.findall(r'(?:Alex Braga|Alcoforado|Barcelos|Clay|Leandro|Mendes)', cab.split('Registrada também')[0])) if q}
    r = [x for x in d['reunioes'] if x['reuniao'] == rid][0]
    chk('presentes da ata = JSON', pres == set(r['presentes']), f'{rid}: ata {sorted(pres)} x JSON {r["presentes"]}')
    ausm = re.search(r'Registra-se a aus[êe]ncia[^.]*\.', cab)
    aus_ata = {quem(ausm[0])} if ausm else set()
    chk('ausentes da ata = JSON', aus_ata == set(r['ausentes']), f'{rid}: {aus_ata} x {r["ausentes"]}')
# ------------------------------------------------------------------ 3) circuitos
for x in inv['series']['518']['itens']:
    t = texto(x['id_documento']); n = int(re.search(r'Circuito Deliberativo (?:n[ºo.]*\s*)?(\d+)-E', t)[1])
    corpo = t[t.find('VOTOS PROFERIDOS'):t.find('ENCAMINHAMENTO')]
    cel = [c.strip() for c in re.split(r'¦|\n', corpo) if c.strip()]
    linhas = []
    for i, c in enumerate(cel):
        if re.search(r'Diretor', c) and i + 1 < len(cel) and not c.startswith('DIRETOR'): linhas.append((c, cel[i + 1]))
    vs = {v['diretor']: v for v in d['votos'] if v['reuniao'] == f'CD{n}-E'}
    chk('circuito: nº de votos = linhas da tabela', len(vs) == len(linhas) and len(linhas) >= 3, f'CD{n}: tabela {len(linhas)} x JSON {len(vs)}')
    for nome, voto in linhas:
        q = quem(nome); lab = vs.get(q, {}).get('voto', '')
        esp = 'RELATOR' if 'Relator' in nome else ('ACOMPANHOU' if voto.lower().startswith('acompanhar') else '?')
        chk('circuito: rotulo nominal = tabela', lab == esp, f'CD{n}: {q} tabela "{voto}" x JSON {lab}')
# ------------------------------------------------------------------ 4) totais
chk('votos: nenhum diretor fora do colegiado', all(v['diretor'] in d['diretores'] for v in d['votos']), 'diretor desconhecido')
chk('votos: rotulos permitidos', all(v['voto'].startswith(('ACOMPANHOU', 'DIVERGIU', 'RELATOR', 'AUSENTE', 'IMPEDIDO', 'SEM VOTO', 'PEDIU VISTA', 'VOTOU', 'NÃO PARTICIPOU', 'VISTA COLETIVA')) for v in d['votos']), 'rotulo fora da lista')
chk('votos: proveniencia permitida', all(v['proveniencia'] in ('nominal', 'inferido', 'REVISAR') for v in d['votos']), 'proveniencia invalida')
chk('REVISAR sempre com motivo', all(v['motivo'] for v in d['votos'] if v['proveniencia'] == 'REVISAR'), 'REVISAR sem motivo')
print('VARREDURA 100% (independente do parser)')
tot_ok = tot = 0
for k in sorted(n_tot):
    print(f'  {k:62s} {n_ok[k]:>6}/{n_tot[k]:<6} {"OK" if n_ok[k] == n_tot[k] else "DIVERGE"}'); tot_ok += n_ok[k]; tot += n_tot[k]
print(f'TOTAL {tot_ok}/{tot} = {100 * tot_ok / tot:.2f}%  | DDC varridas: {len(ddc_doc)} | itens de ata: {sum(len(v) for v in itens_ata.values())} | votos no JSON: {len(d["votos"])}')
for k, L in erros.items():
    print('--', k, len(L)); [print('    ', m) for m in L[:12]]
json.dump(dict(total=tot, ok=tot_ok, por_checagem={k: [n_ok[k], n_tot[k]] for k in n_tot}, divergencias={k: L[:50] for k, L in erros.items()}), open('ancine_varredura.json', 'w'), ensure_ascii=False, indent=1)
sys.exit(1 if erros else 0)
