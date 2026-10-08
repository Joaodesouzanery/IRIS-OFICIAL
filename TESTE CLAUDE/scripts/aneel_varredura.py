"""ANEEL: varredura 100% INDEPENDENTE do parser (nao importa aneel_parse.py nem reusa suas regexes). Le o texto de decisao do CSV (fonte/aneel/pautas_atas.csv)
e extrai, por item, os FATOS NOMINAIS (relator, vencidos, perdedores que acompanharam o relator, impedidos/suspeitos, ausentes, ausentes que consignaram voto,
pedinte de vista, votos antes da vista, n. de partes, voto-vista condutor, ex-diretores/votos subsistentes); compara com aneel.json e lista TODA diferenca.
Uso: python3 -I scripts/aneel_varredura.py [aneel.json]     (nao escreve nada; imprime as diferencas por categoria)"""
import csv, re, sys, json, unicodedata, collections
arq = sys.argv[1] if len(sys.argv) > 1 else 'aneel.json'
J = json.load(open(arq))
ALIAS = {'sandoval': 'Sandoval', 'agnes': 'Agnes', 'gentil': 'Gentil', 'willamy': 'Willamy', 'mosna': 'Fernando', 'fernando luiz': 'Fernando', 'ludimila': 'Ludimila',
         'danna': 'Daniel', 'daniel cardoso': 'Daniel', 'lavorato': 'Ricardo', 'ricardo lavorato': 'Ricardo', 'jurhosa': 'Jurhosa', 'jose jurhosa': 'Jurhosa', 'reive': 'Reive', 'hélvio': 'Helvio', 'helvio': 'Helvio'}
def asc(s): return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower()
ALPAT = re.compile('|'.join(sorted(map(re.escape, ALIAS), key=len, reverse=True)))
def nm(s):
    out = []
    for m in ALPAT.finditer(asc(s)):
        d = ALIAS[m[0]]
        if d not in out: out.append(d)
    return out
def nm_pos(s): return [(m.start(), ALIAS[m[0]]) for m in ALPAT.finditer(asc(s))]
def curto_de(diretor): return nm(diretor)[0] if nm(diretor) else diretor
rows = [r for r in csv.DictReader(open('fonte/aneel/pautas_atas.csv', encoding='utf8'), delimiter=';') if r['DatReuniao'].startswith('2026')]
def tag(r):
    m = re.match(r'(\d+)/2026 - (\w+)', r['IdeReuniao']); return f'{m[2]}{int(m[1])}-{r["NumOrdem"]}'
FEITO = {d['deliberacao']: d for d in J['deliberacoes']}
V = collections.defaultdict(dict)
for v in J['votos']: V[v['deliberacao']][curto_de(v['diretor'])] = v
sent_split = re.compile(r'(?<=[a-z0-9\)”"º»])\.\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕ])')
def sents(t):
    t = re.sub(r'[\xa0​]', ' ', t); out = []
    for p in re.split(r'\n+', t):
        for s in sent_split.split(p):
            s = re.sub(r'\s+', ' ', s).strip()
            if s: out.append(s)
    return out
def fatos(r):
    t = r['TxtDecisaoJulgamento']; S = sents(t); F = collections.defaultdict(set); info = {}
    rel = nm(r['NomDiretorRelator'].title()); F['relator'] = set(rel)
    for s in S:
        a = asc(s)
        dec = bool(re.match(r'(?:(?:por fim|ainda|tambem)[, ]+)*(?:a )?diretoria\b', a))
        # vencidos: nomes nos 300 car. apos 'vencid', ate a 1a ocorrencia de ' decidiu' / verbo de acao
        for m in re.finditer(r'vencid[oa]s?', a):
            if re.search(r'\bnao vencid|insubsist', a[max(0, m.start() - 12):m.start()]): continue
            seg = s[m.start():m.start() + 350]; cut = re.search(r'\bdecidiu|\bdecidiram|,\s+(?:conhecer|dar|negar|aprovar|determinar|deferir|indeferir|homologar|autorizar|manter|reconhecer|arquivar|declarar|revogar|prorrogar|rejeitar|acolher|aplicar)\b', asc(seg))
            seg = seg[:cut.start()] if cut else seg
            F['venc'] |= set(nm(seg))
            if re.search(r'restou vencid|ficou vencid|vencida a diretora|vencido o diretor', a) and not dec:
                pass
        if re.search(r'(?:restou|restaram|ficou|ficaram) vencid', a):
            m = re.search(r'(?:restou|restaram|ficou|ficaram) vencid', a); F['venc_narr'] |= set(nm(s[:m.start()])[-2:])
        if re.search(r'suspei[cç]|impedi', a) and re.search(r'declar|manifest|registr|apresent', a) and not re.search(r'impedimento de\b.{0,30}recurso', a):
            m = re.search(r'suspei|impedi', a); F['imp'] |= set(nm(s[:m.start()]))
        if re.search(r'\bausente|\bausentes|ausencia d[oa] diretor', a) and not re.search(r'ausencia de (?:3|tres)', a):
            m = re.search(r'ausente|ausentes|ausencia', a)
            ns = nm(s[:m.start()]) or nm(s)
            F['aus'] |= set(ns)
            if re.search(r'consign', a): F['aus_cons'] |= set(ns)
            if re.search(r'acompanhar o voto d\w+ diretor\w*-relator|acompanhar o relator', a): F['aus_rel'] |= set(ns)
            if re.search(r'acompanhar a diverg|acompanhar o voto (?:divergente|d[oa] diretor\w* (?!-relator))', a) and not re.search(r'acompanhar o voto d\w+ diretor\w*-relator', a): F['aus_div'] |= set(ns)
        if re.search(r'(?:pediu|solicitou|requereu) vista|pedido de vista', a) and not re.search(r'a pedido d', a[:a.find('vista') if 'vista' in a else 0]):
            m = re.search(r'(?:pediu|solicitou|requereu) vista|pedido de vista', a)
            F['vista'] |= set(nm(s[:m.start()])[-1:]); 
            if 'coletiva' in a: F['coletiva'] = {'x'}
        if re.search(r'nao participa', a): F['nao_part'] |= set(nm(s[:re.search(r'nao participa', a).start()]))
        if re.search(r'votos? subsistentes?', a) and not re.search(r'insubsist', a):
            F['subs'] |= set(nm(s[:re.search(r'votos? subsistentes?', a).start()]))
        # votos antes da vista / posicoes nominais: 'O Diretor X, acompanhado por Y, votou no sentido de ...'
        if re.search(r'\bvotou\b|\bvotaram\b|proferiu (?:seu )?voto|apresentou (?:seu )?voto|apresentaram votos|apresentou diverg|manteve (?:o )?seu voto', a) and not dec:
            m = re.search(r'\bvotou\b|\bvotaram\b|proferiu|apresentou|apresentaram|manteve', a); head = s[:m.start()]
            ns = nm(head)
            if ns:
                F['posicao'] |= set(ns[:1]); F['pos_seg'] |= set(ns[1:])
                if re.search(r'diverg', a): F['pos_div'] |= set(ns[:1])
                if re.search(r'diverg', a) and ns[:1] != F['relator']: F['pos_div_nao_rel'] |= set(ns[:1])
        if re.search(r'fundamentacao diversa', a): F['ressalva'] |= set(nm(s))
        if dec:
            F['dec_n'] = F['dec_n'] | {len(F['dec_n']) + 1}
            m = re.search(r'acompanhand[oa]', a)
            if m:
                seg = s[m.start():]; f = re.search(r'vencid|decidiu', asc(seg)); seg = seg[:f.start()] if f else seg[:300]
                ns = nm(seg)
                if re.search(r'voto[- ]vista', asc(seg)) and ns: F['vistaCond'] |= {ns[0]}
                if re.search(r'diverg', asc(seg)) and ns: F['divVenc'] |= {ns[0]}
    # partes: marcadores romanos (i)..(xx) distintos fora de aspas, nos paragrafos que comecam por 'A Diretoria'
    parts = set()
    for s in S:
        if not re.match(r'(?:(?:por fim|ainda|tambem)[, ]+)*(?:a )?diretoria\b', asc(s)): continue
        x = re.sub(r'“[^”]*”', ' ', s)
        for m in re.finditer(r'(?:\(|(?<![\w(]))(iiii|xviii|xvii|xiii|viii|xix|xvi|xiv|vii|xii|iii|xi|vi|iv|ix|ii|xv|i|v|x)\)', x):
            if re.search(r'\b(?:item|itens|inciso|incisos|alinea|alineas|subitem|art|artigo|artigos)\s*$', asc(x[max(0, m.start() - 14):m.start()])): continue
            parts.add(m[1])
    info['n_partes_txt'] = len(parts)
    info['venc_dec'] = set()
    return F, info
# ---- derivar do aneel.json (lado "parser") por item
def lado_parser(did):
    G = collections.defaultdict(set)
    for dnome, v in V[did].items():
        x = v['voto']; pp = v['voto_por_parte']
        if 'DIVERGIU' in x: G['div'].add(dnome)
        if 'vencido' in x or ('vencido' in x.lower()): G['venc'].add(dnome)
        if x.startswith('IMPEDIDO'): G['imp'].add(dnome)
        if x.startswith('AUSENTE'): G['aus'].add(dnome)
        if x.startswith('PEDIU VISTA'): G['vista'].add(dnome)
        if x.startswith('NÃO PARTICIPOU'): G['nao_part'].add(dnome)
        if x.startswith('VOTOU'): G['votou'].add(dnome)
        if 'subsistente' in x or 'subsistente' in pp: G['subs'].add(dnome)
        if 'autor do voto-vista' in x or 'voto-vista de' in x: G['vistaCond'].add(dnome)
    return G
DIFS = collections.defaultdict(list)
def dif(cat, did, msg): DIFS[cat].append((did, msg))
n = 0
for r in rows:
    did = tag(r)
    if did not in FEITO: continue
    n += 1; d = FEITO[did]; F, info = fatos(r); G = lado_parser(did); col = r['DscResultadoJulgamento']
    t = r['TxtDecisaoJulgamento']
    # 1 relator
    if F['relator'] and set(curto_de(d['relator'] or '') and [curto_de(d['relator'])]) != F['relator']: dif('relator', did, f"coluna {F['relator']} x json {d['relator']}")
    rl = next(iter(F['relator']), None)
    # 2 vencidos nomeados no texto  x  parser (DIVERGIU / vencido) - so itens decididos
    decidido = d['tipo_item'] != 'Vista' and col not in ('Não Deliberado', 'Retirado da Pauta', 'Destacado no Circuito Deliberativo')
    texto_venc = set(F['venc'])
    if col in ('Deliberado', 'Parcialmente Deliberado', 'Pedido de Vista + Prorrogação') or (col == 'Retirado da Pauta' and d['partes']):
        parser_venc = G['div'] | G['venc'] | {x for x in G['aus'] if 'vencido' in V[did][x]['voto']}
        for x in texto_venc - parser_venc: dif('vencido_texto_sem_voto', did, f'{x} vencido no texto, voto no json = {V[did].get(x, {}).get("voto")}')
        # perdedores que acompanharam o relator vencido
        for x in parser_venc - texto_venc:
            v = V[did][x]['voto']
            dif('vencido_json_sem_texto', did, f'{x}: {v[:90]} | prov {V[did][x]["proveniencia"]}')
    # 3 impedidos
    pi = G['imp']
    if F['imp'] != pi: dif('impedidos', did, f"texto {sorted(F['imp'])} x json {sorted(pi)}")
    # 4 ausentes
    if F['aus'] != G['aus']: dif('ausentes', did, f"texto {sorted(F['aus'])} x json {sorted(G['aus'])}")
    for x in F['aus_cons']:
        if x in V[did]:
            j = V[did][x]['voto']
            esperado = 'acompanhou o relator' if x in F['aus_rel'] else ('acompanhou a divergência' if x in F['aus_div'] else 'consignado')
            if ('acompanhou o relator' in j) != (x in F['aus_rel']) or (('acompanhou a diverg' in j) != (x in F['aus_div'])): dif('ausente_consignado', did, f'{x}: texto={esperado} json={j}')
            if 'voto consignado' not in j and 'acompanhou' not in j: dif('ausente_consignado', did, f'{x}: texto consigna voto, json={j}')
    # 5 pedinte de vista
    if col.startswith('Pedido de Vista'):
        if F['vista'] != G['vista']: dif('pedinte_vista', did, f"texto {sorted(F['vista'])} x json {sorted(G['vista'])} (col={col})")
    elif F['vista'] or G['vista']:
        dif('pedinte_vista_em_nao_vista', did, f"texto {sorted(F['vista'])} json {sorted(G['vista'])} col={col}")
    # 6 votou antes da vista: posicoes nominais
    if col.startswith('Pedido de Vista'):
        quem = F['posicao'] | F['pos_seg']
        for x in quem:
            if x in F['vista']: continue
            j = V[did].get(x, {}).get('voto', '')
            if not (j.startswith(('VOTOU', 'DIVERGIU', 'RELATOR', 'PEDIU', 'IMPEDIDO', 'AUSENTE'))): dif('voto_antes_vista', did, f'{x} citado como votante no texto; json={j}')
        for x, v in V[did].items():
            if v['voto'].startswith(('VOTOU', 'DIVERGIU (antes')) and x not in quem: dif('voto_antes_vista', did, f'{x} json={v["voto"]} mas nao citado como votante no texto')
        # divergencia antes da vista
        for x in F['pos_div_nao_rel']:
            j = V[did].get(x, {}).get('voto', '')
            if not j.startswith('DIVERGIU'): dif('vista_divergencia', did, f'{x} apresentou divergencia no texto; json={j}')
        for x, v in V[did].items():
            if v['voto'].startswith('DIVERGIU') and x not in F['pos_div_nao_rel']: dif('vista_divergencia_json_sem_texto', did, f'{x}: {v["voto"]}')
    # 7 nao participou
    if F['nao_part'] != G['nao_part']: dif('nao_participou', did, f"texto {sorted(F['nao_part'])} x json {sorted(G['nao_part'])}")
    # 8 partes
    if d['tipo_item'] == 'Deliberação' and col != 'Não Deliberado' or d['partes']:
        npj = len(d['partes'])
        if npj and info['n_partes_txt'] != npj and not (info['n_partes_txt'] <= 1 and npj == 1): dif('partes', did, f"marcadores romanos distintos no texto={info['n_partes_txt']} x partes json={npj}")
    # 9 voto-vista condutor
    if F['vistaCond'] != G['vistaCond'] and col in ('Deliberado', 'Parcialmente Deliberado'): dif('vista_condutor', did, f"texto {sorted(F['vistaCond'])} x json {sorted(G['vistaCond'])}")
    # 10 ex-diretores / subsistentes
    exd = {x for x in V[did] if x not in ('Sandoval', 'Agnes', 'Gentil', 'Willamy', 'Fernando', 'Ludimila')}
    exd_txt = {x for x in (set(F['relator']) | F['subs'] | F['venc'] | F['vista'] | F['imp'] | F['aus']) if x not in ('Sandoval', 'Agnes', 'Gentil', 'Willamy', 'Fernando', 'Ludimila')}
    if exd != exd_txt: dif('ex_diretores', did, f"texto {sorted(exd_txt)} x json {sorted(exd)}")
    if F['subs'] != G['subs'] and F['subs'] - set(['Sandoval', 'Agnes', 'Gentil', 'Willamy', 'Fernando', 'Ludimila']) != G['subs']: dif('subsistente', did, f"texto {sorted(F['subs'])} x json {sorted(G['subs'])}")
    # 11 todo diretor do json tem linha / sem duplicata
    # 12 'DIVERGIU' sem base textual: precisa 'diverg' ou vencido no texto
    for x in G['div']:
        v = V[did][x]['voto']
        if not re.search(r'diverg|vencid', asc(t)) and 'VISTA_DIV' not in V[did][x]['voto_por_parte']: dif('div_sem_base', did, f'{x}: {v}')
print('itens varridos:', n)
for cat in sorted(DIFS):
    print(f'\n=== {cat}: {len(DIFS[cat])}')
    for did, msg in DIFS[cat]: print('  ', did, '|', msg)
