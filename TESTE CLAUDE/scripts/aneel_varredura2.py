"""ANEEL: varredura 100% INDEPENDENTE do parser (nao importa aneel_parse.py nem reusa regexes/funcoes dele; tambem difere de aneel_varredura.py: aqui a leitura e' por
CLAUSULA com o sujeito mais proximo, corte por infinitivo, e comparacao por CLASSE de voto). Le o texto de decisao do CSV (fonte/aneel/pautas_atas.csv) e, por item e por
diretor, deriva do TEXTO a classe esperada; compara com aneel.json e imprime TODA diferenca, por categoria.
Categorias: relator · vencido (decisao) · lider vencedor (voto-vista/divergencia) · impedido/suspeito · ausente (+consignou) · nao participou · pedinte de vista ·
votou/divergiu ANTES da vista · voto subsistente (inclusive ex-diretor) · ex-diretor com linha · n. de partes (marcadores romanos).
Uso: python3 -I scripts/aneel_varredura2.py [aneel.json]      (nao escreve nada)"""
import csv, re, sys, json, unicodedata, collections
arq = sys.argv[1] if len(sys.argv) > 1 else 'aneel.json'
J = json.load(open(arq))
def asc(s): return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower()
NOMES = [('sandoval', 'Sandoval'), ('agnes', 'Agnes'), ('gentil', 'Gentil'), ('willamy', 'Willamy'), ('fernando luiz', 'Fernando'), ('mosna', 'Fernando'), ('ludimila', 'Ludimila'),
         ('daniel cardoso', 'Daniel'), ('danna', 'Daniel'), ('ricardo lavorato', 'Ricardo'), ('lavorato', 'Ricardo'), ('jurhosa', 'Jurhosa'), ('reive', 'Reive'), ('helvio', 'Helvio')]
PAT = re.compile('|'.join(re.escape(a) for a, _ in sorted(NOMES, key=lambda x: -len(x[0]))))
DE = dict(NOMES)
ATUAIS = {'Sandoval', 'Agnes', 'Gentil', 'Willamy', 'Fernando', 'Ludimila'}
def nm(s):
    out = []
    for m in PAT.finditer(asc(s)):
        d = DE[m[0]]
        if d not in out: out.append(d)
    return out
def curto(diretor): return (nm(diretor) or [diretor])[0]
def sentencas(t):
    t = re.sub(r'[\xa0​]', ' ', t); out = []
    for p in re.split(r'\n+', t):
        for s in re.split(r'(?<=[a-z0-9\)”"º»])(?<!\bSr)(?<!\bSra)(?<!\bDr)(?<!\bDra)\.\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕ])', p):
            s = re.sub(r'\s+', ' ', s).strip()
            if s: out.append(s)
    return out
INF = r',\s+(?:e\s+)?[a-zà-ú]{3,}(?:ar|er|ir|or)\b'          # corte por infinitivo: ', aprovar', ', recomendar'
def ate_verbo(seg):
    a = asc(seg); c = re.search(r'\bdecidiu|\bdecidiram|' + INF + r'|:', a)
    return seg[:c.start()] if c else seg[:300]
def eh_dec(s): return bool(re.match(r'(?:(?:por fim|ainda|tambem)[, ]+)*(?:a )?diretoria\b', asc(s)))
NARRATIVA = r'(?:O Diretor|A Diretora|Os Diretores|As Diretoras|Houve |Para este ponto|Em rela[çc][ãa]o a este|O processo acima)'
rows = {}
for r in csv.DictReader(open('fonte/aneel/pautas_atas.csv', encoding='utf8'), delimiter=';'):
    if r['DatReuniao'].startswith('2026'):
        m = re.match(r'(\d+)/2026 - (\w+)', r['IdeReuniao']); rows[f'{m[2]}{int(m[1])}-{r["NumOrdem"]}'] = r
D = {d['deliberacao']: d for d in J['deliberacoes']}
V = collections.defaultdict(dict)
for v in J['votos']: V[v['deliberacao']][curto(v['diretor'])] = v
def classe(v):
    x = v['voto']
    for pre, c in (('RELATOR', 'REL'), ('PEDIU VISTA', 'VISTA'), ('VISTA COLETIVA', 'VISTAC'), ('IMPEDIDO', 'IMP'), ('AUSENTE', 'AUS'), ('NÃO PARTICIPOU', 'NP'), ('DIVERGIU', 'DIV'),
                   ('ACOMPANHOU', 'ACO'), ('VOTOU', 'VOT'), ('SEM VOTO', 'SV')):
        if x.startswith(pre): return c
    return '?'
def marcadores_romanos(t):
    """maior sequencia i,ii,iii.. NAO-aspeada, nas frases decisorias (+continuacoes ate a primeira frase narrativa)"""
    reg = []; ativo = False
    for s in sentencas(t):
        if eh_dec(s): ativo = True
        elif re.match(NARRATIVA, s): ativo = False
        if ativo: reg.append(s)
    x = ' '.join(reg); x = re.sub(r'“[^”]*”', ' ', x); x = re.sub(r'“[^”]*$', ' ', x)       # aspas fechadas ou abertas-sem-fechar
    ROM = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx']
    prox = 0
    for m in re.finditer(r'(?<![\w.])\(?(' + '|'.join(sorted(ROM, key=len, reverse=True)) + r')\)', x):
        if m[1] == ROM[prox] and not re.search(r'(?:item|itens|inciso|incisos|alinea|alineas|subitem|art|artigo)\s*$', asc(x[max(0, m.start() - 12):m.start()])): prox += 1
    return prox
DIFS = collections.defaultdict(list)
def dif(c, did, msg): DIFS[c].append((did, msg))
n = 0
for did, r in rows.items():
    if did not in D: continue
    n += 1; d = D[did]; t = r['TxtDecisaoJulgamento']; S = sentencas(t); col = r['DscResultadoJulgamento']; at = V[did]
    rel = (nm(r['NomDiretorRelator'].title()) or [None])[0]
    C = {k: classe(v) for k, v in at.items()}
    # 1 relator
    rels = [k for k, c in C.items() if c == 'REL']
    if rel and rels != [rel] and not (set(C.values()) == {'SV'}) and not (col in ('Retirado da Pauta', 'Destacado no Circuito Deliberativo') and rel not in at): dif('relator', did, f'coluna={rel} json={rels}')      # retirada/destaque: todos 'SEM VOTO' por desenho
    # 2 vencidos / lideres na frase decisoria
    venc, lid, venc_narr = set(), set(), set()
    for s in S:
        a = asc(s)
        if eh_dec(s):
            for m in re.finditer(r'vencid[oa]s?', a):
                if re.search(r'insubsist|nao vencid', a[max(0, m.start() - 12):m.start()]): continue
                venc |= set(nm(ate_verbo(s[m.start():])))
            m = re.search(r'acompanhand[oa]', a)
            if m:
                seg = s[m.start():]; f = re.search(r'\bvencid|\bdecidiu|' + INF, asc(seg)); seg = seg[:f.start()] if f else seg[:260]
                if re.search(r'diverg|voto[- ]vista', asc(seg)): lid |= set(nm(seg)[:1])
        elif re.search(r'(?:restou|restaram|ficou|ficaram) vencid', a):
            m = re.search(r'(?:apresentou|apresentaram) (?:voto )?diverg', a)
            if m: venc_narr |= set(nm(s[:m.start()])[-1:])
    cols_dec = col in ('Deliberado', 'Parcialmente Deliberado') or (col == 'Pedido de Vista + Prorrogação' and d['tipo_item'] == 'Vista') or (col == 'Retirado da Pauta' and d['partes'])
    if cols_dec:
        for x in venc | venc_narr:
            if x in ATUAIS or x in at:
                if x not in at: dif('vencido_sem_linha', did, x); continue
                v = at[x]['voto']
                if not (C[x] == 'DIV' or 'vencido' in v.lower()): dif('vencido_texto_json_acompanhou', did, f'{x}: {v}')
        for x, c in C.items():
            if x in venc | venc_narr or x in lid: continue
            v = at[x]['voto']
            if c == 'DIV' and 'divergência vencedora' not in v and 'antes da vista' not in v: dif('divergiu_json_sem_vencido_texto', did, f'{x}: {v}')
            if c == 'REL' and 'vencido' in v and x != rel: dif('relator_vencido_incoerente', did, f'{x}: {v}')
        for x in lid:
            if x in at and not (C[x] in ('DIV', 'REL') or 'voto-vista' in at[x]['voto'] or 'autor' in at[x]['voto'] or 'vencedor' in at[x]['voto']): dif('lider_vencedor', did, f'{x}: {at[x]["voto"]}')
    # 3 impedidos / suspeitos
    imp = set()
    for s in S:
        a = asc(s)
        if re.search(r'suspei[cç]|impedi', a) and re.search(r'declar|manifest|registr|apresent', a) and not re.search(r'impedimento de\b.{0,30}recurso|insuspei', a):
            m = re.search(r'suspei|impedi', a); imp |= set(nm(s[:m.start()])[-2:] if re.search(r'\b(?:e|,)\s*$', asc(s[max(0, m.start() - 60):m.start()])) else nm(s[:m.start()])[-1:])
    ji = {x for x, c in C.items() if c == 'IMP'}
    if imp != ji: dif('impedidos', did, f'texto={sorted(imp)} json={sorted(ji)}')
    # 4 ausentes (+consignou)
    aus, cons = set(), {}
    for s in S:
        a = asc(s)
        m = re.search(r'estava ausente|estavam ausentes|ausente no momento|ausentes no momento', a)
        if m:
            pre = s[:m.start()]; ns = nm(pre)
            aus |= set(ns[-2:] if 'estavam' in a and len(ns) > 1 else ns[-1:])
        m = re.search(r'apesar de ausente|consign(?:ou|aram) seu', a)
        if m:
            who = nm(s[:m.start() + 1]) or nm(s[:m.end() + 80])
            tipo = 'rel' if re.search(r'acompanhar (?:o voto d\w+ )?diretor\w*-relator|acompanhar o relator|acompanhar o voto d\w+ diretor\w*-relator', a) else ('div' if re.search(r'acompanhar a diverg|acompanhar o voto (?:divergente|vencedor)|diverg', a) else 'cons')
            if who: cons[who[-1]] = tipo
    ja = {x for x, c in C.items() if c == 'AUS'}
    if aus != ja: dif('ausentes', did, f'texto={sorted(aus)} json={sorted(ja)}')
    for x, tp in cons.items():
        if x in at:
            v = at[x]['voto']
            ok = ('acompanhou o relator' in v) if tp == 'rel' else (('acompanhou a diverg' in v or 'divergência' in v) if tp == 'div' else ('consign' in v or 'acompanhou' in v))
            if not ok: dif('ausente_consignado', did, f'{x} tipo={tp} json={v}')
    # 5 nao participou / subsistente
    npart, subs = set(), set()
    for s in S:
        a = asc(s)
        m = re.search(r'nao participa(?:ram|u)', a)
        if m: npart |= set(nm(s[:m.start()]))
        m = re.search(r'(?<!in)votos? subsistentes?', a)
        if m and not re.search(r'insubsist', a):
            k = a.find('tendo em vista que'); seg = s[k:m.start()] if 0 <= k < m.start() else s[:m.start()]
            subs |= set(nm(seg))
    jn = {x for x, c in C.items() if c == 'NP'}
    if npart != jn: dif('nao_participou', did, f'texto={sorted(npart)} json={sorted(jn)}')
    for x in subs:
        if x not in at: dif('subsistente_sem_linha', did, x)
        elif 'subsistente' not in (at[x]['voto'] + at[x]['voto_por_parte']).lower() and C[x] != 'REL': dif('subsistente_sem_rotulo', did, f'{x}: {at[x]["voto"]}')
    # 6 pedinte de vista
    vista = set()
    for s in S:
        a = asc(s); m = re.search(r'(?:pediu|solicitou|requereu) vista|pedido de vista', a)
        if m and not re.search(r'a pedido d|prorrog', a[:m.start()]): vista |= set(nm(s[:m.start()])[-1:])
    jv = {x for x, c in C.items() if c in ('VISTA', 'VISTAC') and 'aderiu' not in at[x]['voto']}
    if col == 'Pedido de Vista':
        if vista != jv: dif('pedinte_vista', did, f'texto={sorted(vista)} json={sorted(jv)} col={col}')
    elif col.startswith('Pedido de Vista') and (vista or jv) and vista != jv: dif('pedinte_vista_misto', did, f'texto={sorted(vista)} json={sorted(jv)} col={col}')
    # 7 votos ANTES da vista (itens 'Pedido de Vista')
    if col == 'Pedido de Vista':
        pos, divp = set(), set()
        for s in S:
            a = asc(s)
            if eh_dec(s) or re.search(r'pediu vista|continuam validos|vista coletiva', a): continue
            m = re.search(r'\bvotou\b|\bvotaram\b|proferiu (?:seu )?voto|apresentou (?:seu |o )?voto|apresentou diverg|apresentaram votos|manteve (?:o )?seu voto|em voto proferido|em voto-vista', a)
            if not m: continue
            ns = nm(s[:m.start()])
            k = re.search(r'acompanhad[oa]s? pel', a)
            if k: ns = nm(s[:k.start()])[:1] + nm(ate_verbo(s[k.start():]) if k.start() > m.start() else s[k.start():m.start()])
            if not ns: ns = nm(s[:m.end() + 60])[:1]
            pos |= set(ns)
            if re.search(r'diverg', a): divp |= set(ns[:1])
        pos -= vista
        for x in pos | divp:
            if x not in at: dif('voto_antes_vista_sem_linha', did, x); continue
            if not (C[x] in ('VOT', 'DIV', 'REL', 'ACO') or (C[x] == 'AUS' and 'acompanhou' in at[x]['voto'])): dif('voto_antes_vista', did, f'{x} citado no texto; json={at[x]["voto"]}')
        for x, c in C.items():
            if c == 'VOT' and x not in pos: dif('voto_antes_vista_json_sem_texto', did, f'{x}: {at[x]["voto"]}')
            if c == 'DIV' and x not in divp and x != rel: dif('divergiu_antes_vista_json_sem_texto', did, f'{x}: {at[x]["voto"]}')
            if x in divp and c != 'DIV' and x != rel: dif('divergiu_antes_vista_texto_json_nao', did, f'{x}: {at[x]["voto"]}')
    # 8 ex-diretores (nao-atuais) com linha
    exj = {x for x in at if x not in ATUAIS}
    ext = {x for x in nm(t) if x not in ATUAIS and (x == rel or x in venc or x in subs or x in lid or x in vista)}
    if exj != ext and not (exj and not ext and rel in exj): dif('ex_diretores', did, f'texto={sorted(ext)} json={sorted(exj)} relator_col={rel}')
    # 9 partes
    npj = len(d['partes']); nt = marcadores_romanos(t)
    if d['tipo_item'] == 'Deliberação' and col != 'Não Deliberado' and npj and nt != npj and not (nt <= 1 and npj == 1): dif('partes', did, f'marcadores sequenciais no texto={nt} x partes json={npj}')
print('itens varridos:', n)
tot = 0
for c in sorted(DIFS):
    print(f'\n=== {c}: {len(DIFS[c])}'); tot += len(DIFS[c])
    for did, msg in DIFS[c]: print('  ', did, '|', msg)
print('\nTOTAL de diferencas:', tot)
