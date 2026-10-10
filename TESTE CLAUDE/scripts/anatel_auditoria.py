"""ANATEL: amostra estratificada (semente fixa) de itens de anatel.json com o TEXTO-FONTE ao lado, para auditoria manual campo a campo.
Uso: python3 -I scripts/anatel_auditoria.py anatel.json [N=40] [inicio=0] [fim=N]   (imprime os cartoes; o veredito humano vai em anatel_auditoria.json)"""
import sys, json, random, re, collections, glob
d = json.load(open(sys.argv[1])); N = int(sys.argv[2]) if len(sys.argv) > 2 else 40
a0 = int(sys.argv[3]) if len(sys.argv) > 3 else 0; a1 = int(sys.argv[4]) if len(sys.argv) > 4 else N
man = json.load(open('manifesto_anatel.json'))
D = d['deliberacoes']; V = d['votos']
vb = collections.defaultdict(list)
for v in V: vb[(v['reuniao'], v['deliberacao'], v['processo'])].append(v)
def estrato(x):
    r = x['reuniao']
    if r.startswith('CD'):
        ps = x['partes']
        if any('AUSENTE' in v['voto'] for v in vb[(r, x['deliberacao'], x['processo'])]): return 'circ_ausente'
        if len(ps) > 1 or any(p['vencidos'] for p in ps): return 'circ_dissenso'
        return 'circ_unanime'
    if x['tipo_item'] == 'Aprovação de ata': return 'ata_aprov'
    if x['tipo_item'] == 'Retirada de pauta': return 'retirada'
    if x['tipo_item'] == 'Vista': return 'vista'
    if 'sem ata' in x['secao'] or 'ainda não publicada' in x['secao']: return 'ac_sem_ata'
    if not x['deliberacao'].startswith('Acórdão'): return 'prorrog_dilig'
    if any(p['vencidos'] for p in x['partes']) or len(x['partes']) > 1: return 'ata_dissenso'
    return 'ata_acordao'
PESO = {'ata_acordao': 9, 'vista': 5, 'retirada': 3, 'prorrog_dilig': 3, 'ata_aprov': 2, 'ac_sem_ata': 3, 'circ_unanime': 8, 'circ_dissenso': 4, 'circ_ausente': 2, 'ata_dissenso': 1}
SEMENTE = int(sys.argv[5]) if len(sys.argv) > 5 else 2026
EXCLUIR = [int(x) for x in sys.argv[6].split(',')] if len(sys.argv) > 6 and sys.argv[6] else []   # sementes de amostras ANTERIORES: itens delas ficam fora ("itens novos")
def sorteia(sem, excl=frozenset()):
    random.seed(sem); grupos = collections.defaultdict(list)
    for x in D: grupos[estrato(x)].append(x)
    am = []
    for k, n in PESO.items():
        L = sorted(grupos[k], key=lambda x: (x['reuniao'], x['item_n'], x['deliberacao'])); random.shuffle(L); am += [(k, x) for x in [y for y in L if (y['reuniao'], y['deliberacao']) not in excl][:n]]
    return am
_ex = set()
for sem_ in EXCLUIR: _ex |= {(x['reuniao'], x['deliberacao']) for _, x in sorteia(sem_)}
amostra = sorteia(SEMENTE, _ex)
if len(amostra) < N:   # estratos pequenos esgotados pelas amostras anteriores: completa com itens de ata_acordao/circ_unanime ainda nao sorteados (mesma semente)
    random.seed(SEMENTE + 1); usados = {(x['reuniao'], x['deliberacao']) for _, x in amostra} | _ex
    for est_ in ('ata_acordao', 'circ_unanime', 'ata_acordao', 'circ_unanime'):
        L = sorted([y for y in D if estrato(y) == est_ and (y['reuniao'], y['deliberacao']) not in usados], key=lambda x: (x['reuniao'], x['item_n'], x['deliberacao'])); random.shuffle(L)
        if L and len(amostra) < N: amostra.append((est_, L[0])); usados.add((L[0]['reuniao'], L[0]['deliberacao']))
amostra = amostra[:N]
def trecho_ata(x):
    m = [v for v in man.values() if v['serie'] == '229' and f'RCD {re.sub(chr(92)+"D","",x["reuniao"])} ' in v['resumo']]
    if not m: return ''
    t = open(f'texto_anatel/s229_{m[0]["id_documento"]}.txt', encoding='utf8').read()
    i = t.find(x['processo']); j = t.find('\n0', i + 40)
    nxt = re.search(r'\n\d{5} - Processo', t[i + 40:]); j = i + 40 + nxt.start() if nxt else i + 2500
    return t[max(0, i - 10):j]
def trecho_ac(num):
    for v in man.values():
        if v['serie'] == '8':
            t = open(f'texto_anatel/s8_{v["id_documento"]}.txt', encoding='utf8').read()
            if re.search(rf'^Acórdão nº {num}, de', t, re.M) and '\nACÓRDÃO\n' in t:
                hd = '\n'.join(l for l in t.split('\n')[:12] if re.match(r'(Acórdão|Processo|Recorrente|Conselheiro|Fórum)', l))
                dp = t.split('\nACÓRDÃO\n', 1)[1].split('Documento assinado')[0]
                return hd + '\n--DISPOSITIVO--\n' + '\n'.join(l for l in dp.split('\n') if not re.match(r'^[a-z](\.\d+)*\) ', l))[:2200]
    return ''
def trecho_circ(x):
    n = int(x['reuniao'][2:])
    for v in man.values():
        if v['serie'] == '187':
            t = open(f'texto_anatel/s187_{v["id_documento"]}.txt', encoding='utf8').read()
            if re.search(rf'Nº {n}/2026', t):
                t = re.sub(r'\n ?\| ?(?=\n)', '', t); t = re.sub(r'^ ?\| ?', '', t, flags=re.M)
                i = t.find('Votos proferidos'); return t[:600] + '\n...\n' + t[i:i + 1800]
    return ''
for k, (est, x) in enumerate(amostra):
    if not (a0 <= k < a1): continue
    print('=' * 100); print(f'#{k + 1} [{est}] {x["reuniao"]} {x["data"]} {x["processo"]} {x["deliberacao"]} item {x["item_n"]} | tipo={x["tipo_item"]} | relator={x["relator"]} | interessado={x["interessado"][:60]}')
    print('  resultado:', x['resultado'][:300]); print('  partes:', [(p['parte'], p['modo'], [n.split()[0] for n in p['vencidos']]) for p in x['partes']])
    print('  votos:', [(v['diretor'].split()[0], v['voto'][:30], v['proveniencia'][:3]) for v in vb[(x['reuniao'], x['deliberacao'], x['processo'])]])
    print('--- FONTE ---')
    if x['reuniao'].startswith('CD'): print(trecho_circ(x))
    else:
        if x['deliberacao'].startswith('Acórdão'): print(trecho_ac(int(re.search(r'\d+', x['deliberacao'])[0])))
        if x['reuniao'] in ('RCD957', 'RCDE32') or x['tipo_item'] == 'Aprovação de ata':
            if x['tipo_item'] == 'Aprovação de ata':
                t = open(f'texto_anatel/s229_{[v for v in man.values() if v["serie"]=="229" and ("RCD " + x["reuniao"][3:] + " ") in v["resumo"]][0]["id_documento"]}.txt', encoding='utf8').read(); i = t.find('O Presidente'); print(t[i:i + 700])
        else: print(trecho_ata(x))
