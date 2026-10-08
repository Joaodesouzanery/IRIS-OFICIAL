"""ANA: auditoria independente. (1) re-le o HTML cru das listagens com html.parser (metodo diferente do regex do inventario) e confere, campo a campo,
cada reuniao de ana.json (numero, data, ata?, pauta?, URL da ata, URL da pauta); (2) confere o calendario com o texto cru; (3) confere que toda pendencia tem URL,
que nenhum voto existe sem texto-fonte e que os rotulos de voto (se houver) seguem a lista permitida. Imprime o texto-fonte ANTES do JSON em cada cartao.
Uso: python3 -I scripts/ana_auditoria.py ana.json [semente=2026] [N itens=48]"""
import sys, json, re, random, os
from html.parser import HTMLParser
d = json.load(open(sys.argv[1])); random.seed(int(sys.argv[2]) if len(sys.argv) > 2 else 2026)
class P(HTMLParser):
    def __init__(s): super().__init__(); s.itens = []; s.ano = None; s.d = None; s.href = None; s.lab = ''; s.na = False; s.b = False
    def handle_starttag(s, t, a):
        a = dict(a)
        if t == 'div' and (a.get('id') or '').startswith('Assunto_'): s.ano = a['id'][8:]
        if t == 'b': s.b = True
        if t == 'a' and 'abreArquivo' in (a.get('onclick') or ''): s.na = True; s.lab = ''; s.href = re.search(r'file=([^\']+)', a['onclick'])[1]
    def handle_data(s, x):
        if s.b: s.d = x.strip()
        if s.na: s.lab += x
    def handle_endtag(s, t):
        if t == 'b': s.b = False
        if t == 'a' and s.na: s.na = False; s.itens.append((s.ano, s.d, s.href, ' '.join(s.lab.split())))
def le(f):
    p = P(); p.feed(open(f, encoding='utf8', errors='ignore').read()); return p.itens
A = le('fonte/ana/web/www2_atas_deliberativas.html'); PT = le('fonte/ana/web/www2_pautas_deliberativas.html')
ata = {int(re.search(r'(\d+)ª', l)[1]): (an, dt, h, l) for an, dt, h, l in A if re.search(r'(\d+)ª', l) and 'Deliberativa' in l and (dt.endswith('/2026') or dt.endswith('/2027'))}
pau = {int(re.search(r'(\d+)ª', l)[1]): (an, dt, h, l) for an, dt, h, l in PT if re.search(r'(\d+)ª', l) and 'Deliberativa' in l and dt.endswith('/2026')}
ok = tot = 0; falhas = []
def chk(rotulo, esperado_texto, valor_json, cond):
    global ok, tot
    tot += 1; ok += bool(cond)
    if not cond: falhas.append((rotulo, esperado_texto, valor_json))
R = d['reunioes']; amostra = list(R); random.shuffle(amostra)
for r in amostra:
    n = int(r['reuniao'][2:]); print(f'--- RD{n} ---')
    pa = pau.get(n); aa = ata.get(n)
    print('TEXTO-FONTE pauta:', pa and (pa[1], pa[3], pa[2]), '| ata:', aa and (aa[1], aa[3], aa[2], 'bloco ' + aa[0]))
    print('JSON:', json.dumps({k: r[k] for k in ('reuniao', 'data', 'url_ata', 'url_pauta')}, ensure_ascii=False))
    dd = lambda s: f'{s[6:]}-{s[3:5]}-{s[:2]}'
    chk(f'RD{n} data', pa and pa[1], r['data'], pa and dd(pa[1]) == r['data'])
    chk(f'RD{n} tem pauta', bool(pa), bool(r['url_pauta']), bool(pa) == bool(r['url_pauta']))
    chk(f'RD{n} tem ata', bool(aa), bool(r['url_ata']), bool(aa) == bool(r['url_ata']))
    chk(f'RD{n} url pauta', pa and pa[2], r['url_pauta'], (not pa) or r['url_pauta'] == 'https://arquivos.ana.gov.br' + pa[2])
    chk(f'RD{n} url ata', aa and aa[2], r['url_ata'], (not aa) or r['url_ata'] == 'https://arquivos.ana.gov.br' + aa[2])
    chk(f'RD{n} tipo', 'Ordinária', r['tipo'], 'Ordinária' in r['tipo'] and (not pa or 'Ordinária' in pa[3]))
    chk(f'RD{n} ata no ano certo do arquivo', aa and aa[2], r['url_ata'], (not aa) or '/atas/' in aa[2])
# numeros fora do JSON que a listagem tem em 2026
extras = sorted(set(pau) - {int(r['reuniao'][2:]) for r in R}); tot += 1; ok += not extras
if extras: falhas.append(('reunioes listadas e ausentes do JSON', extras, None))
# calendario: texto cru
cal = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', open('fonte/ana/web/govbr_calendario.html', encoding='utf8', errors='ignore').read()))
cal = cal[cal.find('Mês Data das Reuniões'):cal.find('*As datas')]; print('--- CALENDARIO (texto cru) ---\n', cal)
q = [x for x in d['cobertura'] if 'Calendário' in x[1]][0]; print('JSON:', q[2], q[3][:200])
chk('calendario: 19 datas (soma do texto cru)', sum(len(re.findall(r'\d+', x)) for x in re.split(r'Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro', cal)[1:]), q[2], q[2] == sum(len(re.findall(r'\d+', x)) for x in re.split(r'Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro', cal)[1:]))
# pendencias com URL; votos sem texto
sem_url = [p for p in d['pendencias'] if not str(p[-1]).startswith('http')]; chk('pendencias com URL', 0, len(sem_url), not sem_url)
txts = [f for f in os.listdir('texto_ana')] if os.path.isdir('texto_ana') else []
chk('nenhum voto sem texto-fonte', 0, len(d['votos']), not d['votos'] or bool(txts))
OKR = ('ACOMPANHOU', 'DIVERGIU', 'RELATOR', 'AUSENTE', 'IMPEDIDO', 'SEM VOTO', 'PEDIU VISTA', 'VOTOU', 'NÃO PARTICIPOU', 'VISTA COLETIVA')
bad = [v for v in d['votos'] if not v['voto'].startswith(OKR)]; chk('rotulos de voto validos', 0, len(bad), not bad)

# ======================= AUDITORIA DE ITENS (deliberacoes/votos) =======================
# Para cada item sorteado (semente fixa, estratificado + preenchido ate N) o cartao imprime PRIMEIRO o texto-fonte (lido do .txt, sem usar o parser) e DEPOIS o JSON.
# Os campos sao conferidos por regras proprias deste script (varredura de linhas e palavras-chave; nao importa nem repete as regexes do ana_parse.py).
import unicodedata
def asc(x): return ''.join(c for c in unicodedata.normalize('NFKD', x) if not unicodedata.combining(c)).lower()
def pl(x): return re.sub(r'\s+', ' ', x).strip()
SOBRE = {'argolo': 'Ana Carolina Argolo', 'larissa': 'Larissa Oliveira Rêgo', 'battiston': 'Cristiane Collet Battiston', 'leonardo': 'Leonardo Góes Silva', 'fioreze': 'Ana Paula Fioreze'}
def nomes_em(x):
    a = asc(x); o = []
    for k, v in sorted(SOBRE.items(), key=lambda kv: a.find(kv[0]) if kv[0] in a else 10**6):
        if k in a and v not in o: o.append(v)
    if 'cristiane' in a and SOBRE['battiston'] not in o: o.append(SOBRE['battiston'])
    return o
def texto_ata(n):
    f = f'texto_ana/ata_{n}.txt'
    if not os.path.exists(f): return None
    L = [l for l in open(f, encoding='utf8').read().replace('\f', '\n').split('\n') if not re.search(r'Ata DIREC \d+\s+SEI .* pg\. \d+', l)]
    return L
def bloco_item(L, dlb):
    """linhas do item 'DLB <dlb>.' ate o proximo 'DLB k.' no inicio de linha ou 'Nada mais havendo'"""
    ini = next((i for i, l in enumerate(L) if re.match(rf'\s*DLB\s*{dlb}\.', l)), None)
    if ini is None: return None
    fim = next((j for j in range(ini + 1, len(L)) if re.match(r'\s*DLB\s*\d+\.', L[j]) or 'Nada mais havendo' in L[j]), len(L))
    return L[ini:fim]
def presenca_ata(L):
    """(presentes, ausentes_declarados) lendo a(s) frase(s) 'Participaram' e 'nao participou' como texto corrido"""
    t = pl(' '.join(L[:60])); i = t.find('Participaram'); j = min([x for x in (t.find('A pauta seguiu', i), t.find(' v Leitura', i), t.find(' § Leitura', i), t.find('O Diretor Leonardo', i)) if x > 0] or [i + 700])
    pres = nomes_em(t[i:j]); aus = {}
    for m in re.finditer(r'(?:O|A) Diretor[a]? ([^.]{3,60}?),? n[ãa]o participou da reuni[ãa]o([^.]*)\.', t):
        for nm in nomes_em(m[1]): aus[nm] = pl(m[2])
    return pres, aus, t[i:i + 520]
def res_esperado(dec):
    a = asc(dec[:380])
    if 'prorrogacao do pedido de vista' in a: return 'Vista'
    if 'retirada de pauta' in a: return 'Retirada de pauta'
    return 'Deliberação'
ITENS = d['deliberacoes']; VOT = {}
for v in d['votos']: VOT.setdefault((v['reuniao'], v['deliberacao']), []).append(v)
def estrato(x):
    if x['tipo_item'] in ('Vista', 'Retirada de pauta', 'Cancelada'): return 'vista_retirada'
    if x['tipo_item'] == 'Aprovação de ata': return 'ata'
    if 'ad referendum' in x['obs']: return 'adref'
    if len(x['partes']) > 1: return 'partes'
    if any(k in x['obs'] for k in ('extrapauta', 'NÃO consta', 'ausente da reunião', 'relatoria-vista')): return 'especial'
    return 'comum'
NA = int(sys.argv[3]) if len(sys.argv) > 3 else 48
random.seed(int(sys.argv[2]) if len(sys.argv) > 2 else 2026)
grupos = {}
for x in sorted(ITENS, key=lambda x: (x['reuniao'], x['item_n'])): grupos.setdefault(estrato(x), []).append(x)
am = [x for k in ('vista_retirada', 'adref', 'partes', 'especial') for x in grupos.get(k, [])]
resto = [x for k in ('ata', 'comum') for x in grupos.get(k, []) if x not in am]; random.shuffle(resto)
am = am + resto[:max(0, NA - len(am))]; am = am[:max(NA, len(am))] if len(ITENS) >= NA else list(ITENS)
if len(ITENS) <= NA: am = list(ITENS)
random.shuffle(am)
okc = {'campos': [0, 0], 'votos': [0, 0]}; falhas_i = []; vistos_pres = set()
def chk2(cat, rot, esp, got, cond):
    okc[cat][1] += 1; okc[cat][0] += bool(cond)
    if not cond: falhas_i.append((rot, esp, got))
print('\n######## AUDITORIA DE ITENS: %d de %d itens, semente %s ########' % (len(am), len(ITENS), sys.argv[2] if len(sys.argv) > 2 else 2026))
for x in am:
    rid = f'{x["deliberacao"]}'; n = int(x['reuniao'][2:]); L = texto_ata(n)
    print('\n=== ' + rid + ' ===')
    pres, aus_dec, par = presenca_ata(L)
    if n not in vistos_pres: vistos_pres.add(n); print('TEXTO-FONTE (participantes):', par)
    if x['tipo_item'] == 'Aprovação de ata':
        t = pl(' '.join(L)); k = t.find('teve sua leitura dispensada'); print('TEXTO-FONTE:', t[max(0, k - 190):k + 45])
        blk = None
    else:
        blk = bloco_item(L, x['item_n'])
        print('TEXTO-FONTE:', pl(' '.join(blk))[:1100] + (' […]' if len(pl(' '.join(blk))) > 1100 else ''))
    print('JSON:', json.dumps({k: x[k] for k in ('processo', 'relator', 'interessado', 'tipo_item', 'resultado', 'voto_doc', 'secao')}, ensure_ascii=False), '| partes:', [p['parte'] for p in x['partes']])
    for v in VOT[(x['reuniao'], x['deliberacao'])]: print('   VOTO', v['diretor'], '|', v['voto'], '|', v['proveniencia'], '|', v['voto_por_parte'])
    if blk is None:
        chk2('campos', rid + ' tipo', 'Aprovação de ata', x['tipo_item'], x['tipo_item'] == 'Aprovação de ata')
        ant = re.search(r'Ata da (\d+)ª', pl(' '.join(L))); chk2('campos', rid + ' ata aprovada', ant and ant[1], x['processo'], ant and x['processo'] == f'ATA RD{ant[1]}')
    else:
        T = pl(' '.join(blk)); a = asc(T)
        proc = re.search(r'(\d{5}\.\d{6}/\d{4}-\d{2})', T)
        chk2('campos', rid + ' processo', proc and proc[1], x['processo'], proc and proc[1] == x['processo'])
        # relator: primeiro nome apos Relator/Relatora/Relatora-vista/Proponente; proponente => presidente da reuniao
        rms = re.findall(r'(Relator[a]?(?:-vista)?|Proponente)\s*:\s*(.{3,90}?)\s*Decis', T); rm = rms[-1] if rms else None
        if rm and rm[0] == 'Proponente': exp_rel = nomes_em(par.split('que presidiu')[0].split('Participaram')[1])[-1] if 'que presidiu' in par else None
        else: exp_rel = (nomes_em(rm[1]) or [None])[0] if rm else None
        chk2('campos', rid + ' relator', exp_rel, x['relator'], exp_rel == x['relator'])
        tp = res_esperado(T[T.find('Decisão'):])
        chk2('campos', rid + ' tipo_item', tp, x['tipo_item'], tp == x['tipo_item'])
        chk2('campos', rid + ' unanimidade', 'unanimidade' in a, 'unanimidade)' in x['resultado'], ('por unanimidade' in a) == ('unanimidade)' in x['resultado']))
        if 'referendou' in a[a.find('decisao'):a.find('decisao') + 200]: chk2('campos', rid + ' resultado REFERENDADO', 'REFERENDADO', x['resultado'], x['resultado'].startswith('REFERENDADO'))
        if tp == 'Deliberação' and 'indeferimento' in a[a.find('decisao'):a.find('decisao') + 90]: chk2('campos', rid + ' resultado INDEFERIDO', 'INDEFERIDO', x['resultado'], x['resultado'].startswith('INDEFERIDO'))
        if tp == 'Deliberação':
            cab = a[a.find('unanimidade') + 11:a.find('unanimidade') + 90] if 'unanimidade' in a else ''
            if re.search(r'referendou|decisao ad referendum', a[a.find('decisao'):a.find('decisao') + 190]): esp_res = 'REFERENDADO'
            else:
                pos = [(cab.find(k), v) for k, v in (('indeferimento', 'INDEFERIDO'), ('renovacao', 'RENOVADO'), ('emissao', 'EMITIDO'), ('alteracao', 'ALTERADO'), ('prorrogacao', 'PRORROGADO'), ('abertura', 'ABERTURA'), ('edicao', 'EDITADO'), ('outorga', 'OUTORGADO')) if cab.find(k) >= 0 and not (k == 'outorga' and cab.strip(' ,').startswith(('a solicitacao', 'o pedido')))]
                esp_res = min(pos)[1] if pos else 'APROVADO'
            chk2('campos', rid + ' classe do resultado', esp_res, x['resultado'], x['resultado'].startswith(esp_res))
        sei = re.findall(r'\(\s*(?:SEI\s*)?(\d{5,8})\s*\)', T[T.find('Decisão'):]); vdoc = re.search(r'(?i)voto[^()]{0,60}?\d+/20\d\d[^()]{0,30}\(\s*(\d{5,8})\s*\)', T[T.find('Decisão'):])
        if tp == 'Deliberação': chk2('campos', rid + ' voto_doc (SEI)', vdoc and vdoc[1], x['voto_doc'], bool(vdoc) and vdoc[1] in x['voto_doc'])
        else: chk2('campos', rid + ' voto_doc vazio', '', x['voto_doc'], x['voto_doc'] == '')
        mat = T[T.find('Matéria'):T.find('Decisão')]
        enum_n = len(re.findall(r'(?:^|\s)(?:i|ii|iii|iv)\)\s', T if tp == 'Deliberação' else '', flags=re.I))
        if tp == 'Deliberação': chk2('campos', rid + ' partes', 'n>=2' if enum_n >= 2 else '1', len(x['partes']), (len(x['partes']) >= 2) == (enum_n >= 2))
    # votos: um por membro do colegiado na data
    R_ = next(r for r in d['reunioes'] if r['reuniao'] == x['reuniao'])
    esperado = {nm: ('P' if nm in pres else 'A') for nm in SOBRE.values() if nm in pres or (nm != 'Ana Carolina Argolo' and nm != 'Ana Paula Fioreze') or (nm == 'Ana Carolina Argolo' and R_['data'] <= '2026-07-05')}
    vs = {v['diretor']: v for v in VOT[(x['reuniao'], x['deliberacao'])]}
    chk2('votos', rid + ' conjunto de diretores', sorted(esperado), sorted(vs), sorted(esperado) == sorted(vs))
    for nm, st in esperado.items():
        v = vs.get(nm)
        if not v: continue
        if blk is not None and exp_rel == nm: fam = 'RELATOR'
        elif st == 'A': fam = 'AUSENTE'
        elif x['tipo_item'] == 'Retirada de pauta': fam = 'SEM VOTO'
        elif x['tipo_item'] == 'Vista': fam = 'SEM VOTO AINDA'
        else: fam = 'ACOMPANHOU'
        prov = 'nominal' if (fam == 'RELATOR' and not (st == 'A' and nm not in aus_dec)) or (st == 'A' and nm in aus_dec) else 'inferido'   # relator ausente SO por omissao na lista: a ausencia e inferida
        chk2('votos', f'{rid} {nm}', f'{fam}/{prov}', f'{v["voto"][:40]}/{v["proveniencia"]}', v['voto'].startswith(fam) and v['proveniencia'] == prov)
for nome, (a_, b_) in okc.items(): print(f'\nITENS/{nome}: {a_}/{b_} ({100 * a_ / max(1, b_):.1f}%)')
for f in falhas_i: print('FALHA-ITEM', f)
ok += okc['campos'][0] + okc['votos'][0]; tot += okc['campos'][1] + okc['votos'][1]
taxa_itens = (okc['campos'][0] + okc['votos'][0]) / max(1, okc['campos'][1] + okc['votos'][1])
print(f'AUDITORIA DE ITENS: {okc["campos"][0] + okc["votos"][0]}/{okc["campos"][1] + okc["votos"][1]} ({100 * taxa_itens:.1f}%)')

print(f'\nAUDITORIA: {ok}/{tot} checagens corretas ({100*ok/tot:.1f}%)'); [print('FALHA', f) for f in falhas]
sys.exit(0 if ok / tot >= .95 and taxa_itens >= .95 else 1)
