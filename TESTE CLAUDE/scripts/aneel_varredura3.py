"""ANEEL: varredura 100% (3a, fase 13) INDEPENDENTE do parser: nao importa aneel_parse.py. Parte do CSV bruto (fonte/aneel/pautas_atas.csv) e do aneel.json e confere,
para TODOS os itens de reuniao com resultado: (1) 1 linha do CSV <-> 1 deliberacao (relator da coluna, resultado da coluna, nº de itens por reuniao);
(2) 1 voto por diretor do colegiado (+ ex-diretor so' se citado), sem duplicata; (3) fatos nominais do texto (vencido, impedido, ausente, ausente que consignou voto,
pedido de vista, nao participou) <-> rotulo do voto; (4) proveniencia coerente com o rotulo (inferido so' para ACOMPANHOU/SEM VOTO AINDA; nominal para o resto);
(5) unanimidade sem vencido nao pode ter DIVERGIU. Normaliza espacos (\\xa0 + espaco) antes de procurar frases (bug RPO20-12: 'consignaram\\xa0 seus votos').
Uso: python3 -I scripts/aneel_varredura3.py [aneel.json]  -> imprime divergencias por categoria e o percentual de acerto por campo (nao escreve nada)."""
import csv, re, sys, json, unicodedata, collections
J = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'aneel.json'))
def asc(s): return re.sub(r'\s+', ' ', ''.join(c for c in unicodedata.normalize('NFKD', s.replace('\xa0', ' ')) if not unicodedata.combining(c)).lower())
CURTO = {'sandoval': 'Sandoval', 'agnes': 'Agnes', 'gentil': 'Gentil', 'willamy': 'Willamy', 'fernando': 'Fernando', 'ludimila': 'Ludimila', 'danna': 'Daniel', 'lavorato': 'Ricardo'}
PAT = re.compile(r'sandoval|agnes|gentil|willamy|fernando luiz|ludimila|danna|lavorato')
def nm(s):
    o = []
    for m in PAT.finditer(asc(s)):
        k = CURTO[m[0].split()[0]]
        if k not in o: o.append(k)
    return o
def curto(d): return nm(d)[0]
rows = [r for r in csv.DictReader(open('fonte/aneel/pautas_atas.csv', encoding='utf8'), delimiter=';') if r['DatReuniao'].startswith('2026') and r['DscResultadoJulgamento']]
def tag(r):
    m = re.match(r'(\d+)/2026 - (\w+)', r['IdeReuniao']); return f'{m[2]}{int(m[1])}-{r["NumOrdem"]}'
D = {d['deliberacao']: d for d in J['deliberacoes']}
V = collections.defaultdict(list)
for v in J['votos']: V[v['deliberacao']].append(v)
falhas = collections.defaultdict(list); tot = collections.Counter(); ok = collections.Counter()
def chk(campo, cond, msg):
    tot[campo] += 1
    if cond: ok[campo] += 1
    else: falhas[campo].append(msg)
chk('itens: CSV com resultado = deliberacoes do JSON', len(rows) == len(D), f'{len(rows)} x {len(D)}')
for r in rows:
    t = tag(r); d = D.get(t)
    if not d: chk('item existe no JSON', False, t); continue
    chk('item existe no JSON', True, t)
    vs = V[t]; d = D[t]; txt = asc(r['TxtDecisaoJulgamento']); rel = nm(r['NomDiretorRelator'])
    chk('relator = coluna NomDiretorRelator', bool(rel) and curto(d['relator']) == rel[0], f'{t} json={d["relator"]} csv={r["NomDiretorRelator"]}')
    cd = collections.Counter(curto(v['diretor']) for v in vs)
    chk('1 voto por diretor (sem duplicata)', max(cd.values()) == 1 and 5 <= len(cd) <= 7, f'{t} {dict(cd)}')
    chk('relator tem linha de voto', rel[0] in cd, t)
    rot = {curto(v['diretor']): v for v in vs}
    # prov x rotulo
    for k, v in rot.items():
        inf = v['proveniencia'] == 'inferido'; lb = v['voto']
        esperado_inf = lb.startswith('ACOMPANHOU') and 'por exclusão' in lb or lb in ('ACOMPANHOU', 'ACOMPANHOU todas as partes') or lb.startswith('SEM VOTO AINDA')
        if lb.startswith(('RELATOR', 'AUSENTE', 'IMPEDIDO', 'PEDIU', 'DIVERGIU', 'NÃO PARTICIPOU', 'VOTOU', 'VISTA COLETIVA', 'SEM VOTO (retirado')): esperado_inf = False
        if v['proveniencia'] == 'REVISAR' or d['situacao_ata'] == 'Não Deliberado': continue      # Nao Deliberado: posicoes nominais do texto (inclusive ACOMPANHOU) sao nominais
        chk('proveniencia coerente com o rotulo', inf == esperado_inf or (lb.startswith('ACOMPANHOU') and inf), f'{t} {k}: {lb} / {v["proveniencia"]}')
    # vencidos
    venc = []
    for m in re.finditer(r'vencid[oa]s?\s+(?:o |a |os |as )?(?:diretor(?:-geral|a|es|as)?\s*,?\s*)?', txt):
        seg = txt[m.start():m.start() + 260]
        seg = re.split(r'acompanhando|, decidiu|decidiu|, e decidiu', seg)[0]
        for x in nm(seg):
            if x not in venc: venc.append(x)
    divs = [k for k, v in rot.items() if v['voto'].startswith(('DIVERGIU (voto vencido)', 'DIVERGIU (sem maioria)')) or 'voto vencido' in v['voto'] or 'vencido' in v['voto'] or v['voto'].startswith(('DIVERGIU na parte', 'DIVERGIU nas partes', 'RELATOR (voto vencido'))]
    maioria = 'por maioria' in txt
    if r['DscResultadoJulgamento'] in ('Deliberado', 'Parcialmente Deliberado') and maioria and venc:
        chk('vencido do texto tem rotulo de voto vencido', all(x in divs for x in venc if x in rot), f'{t} texto={venc} json={divs}')
    if r['DscResultadoJulgamento'] == 'Deliberado' and 'por unanimidade' in txt and not maioria and 'vencid' not in txt:
        chk('unanimidade sem vencido: ninguem DIVERGIU', not any(v['voto'].startswith('DIVERGIU') for v in vs), f'{t} {[v["voto"] for v in vs if v["voto"].startswith("DIVERGIU")]}')
    # impedido / ausente / consignado / nao participou / vista
    for x in nm(' '.join(re.findall(r'[^.]*?declar\w+ (?:sua|seu) (?:suspei|impedi)[^.]*', txt))):
        if x in rot: chk('impedido do texto -> IMPEDIDO', rot[x]['voto'].startswith('IMPEDIDO'), f'{t} {x}: {rot[x]["voto"]}')
    for fr in re.findall(r'[^.]*(?:estava|estavam) ausentes?[^.]*', txt):
        for x in nm(fr.split('ausente')[0]):
            if x in rot: chk('ausente do texto -> AUSENTE', rot[x]['voto'].startswith('AUSENTE'), f'{t} {x}: {rot[x]["voto"]}')
    if re.search(r'(?:apesar de ausentes?|ausentes?,)[^.]*consign\w+\s+seus?\s+votos?', txt):
        fr = re.search(r'(?:apesar de ausentes?|ausentes?,)[^.]*consign\w+\s+seus?\s+votos?', txt)[0]
        for x in nm(fr):
            if x in rot: chk('ausente que consignou voto: rotulo registra o acompanhamento', rot[x]['voto'].startswith('AUSENTE') and ('acompanhou' in rot[x]['voto'] or 'consignado' in rot[x]['voto']), f'{t} {x}: {rot[x]["voto"]}')
    for fr in re.findall(r'[^.]*?(?:nao participou|nao participaram) da deliberacao[^.]*', txt):
        for x in nm(fr.split('nao partic')[0]):
            if x in rot: chk('nao participou -> NÃO PARTICIPOU', rot[x]['voto'].startswith('NÃO PARTICIPOU'), f'{t} {x}: {rot[x]["voto"]}')
    for fr in re.findall(r'[^.]*?(?:pediu|solicitou) vista[^.]*', txt):
        ns = nm(fr.split('vista')[0])
        if ns and ns[-1] in rot and 'a pedido' not in fr: chk('pedinte de vista -> PEDIU VISTA', rot[ns[-1]]['voto'].startswith('PEDIU VISTA'), f'{t} {ns[-1]}: {rot[ns[-1]]["voto"]}')
    # resultado da coluna x tipo_item
    col = r['DscResultadoJulgamento']
    esp = {'Retirado da Pauta': 'Retirada de pauta', 'Pedido de Vista': 'Vista', 'Deliberado': 'Deliberação'}.get(col)
    if esp and d['situacao_ata'] != 'Não Deliberado': chk('coluna resultado -> tipo_item', d['tipo_item'] == esp, f'{t} {col} -> {d["tipo_item"]}')
print('=== VARREDURA 3 (fase 13): itens do CSV com resultado', len(rows), '| votos', len(J['votos']))
for c in sorted(tot): print(f'  {c}: {ok[c]}/{tot[c]} = {100 * ok[c] / tot[c]:.1f}%')
nt, no = sum(tot.values()), sum(ok.values()); print(f'  TOTAL de checagens: {no}/{nt} = {100 * no / nt:.2f}%')
for c, L in falhas.items():
    print(f'--- FALHAS {c}: {len(L)}'); [print('   ', x[:230]) for x in L[:25]]
