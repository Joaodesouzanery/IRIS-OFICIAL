"""ANEEL: auditoria MANUAL por amostra. Sorteia 40 itens estratificados (semente fixa) de aneel.json e imprime, lado a lado, o texto da ata
(decisao_texto) e o que o parser extraiu (relator, resultado, partes, vencidos, voto de cada diretor) para conferencia humana.
Uso: python3 -I scripts/aneel_auditoria.py [aneel.json] [inicio] [fim]     -> o veredito (ok/erro por campo) fica em aneel_auditoria.json (preenchido por quem le)"""
import json, sys, random, re, collections
arq = sys.argv[1] if len(sys.argv) > 1 else 'aneel.json'
a, b = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (0, 40)
d = json.load(open(arq))
SEMENTE = int(sys.argv[4]) if len(sys.argv) > 4 else 2026
rnd = random.Random(SEMENTE)
D = d['deliberacoes']
V = collections.defaultdict(list)
for v in d['votos']: V[v['deliberacao']].append(v)
def pick(f, n, ja):
    c = [x for x in D if f(x) and x['deliberacao'] not in ja]; rnd.shuffle(c); return c[:n]
amostra, ja = [], set()
for nome, f, n in (('composta (>=2 partes)', lambda x: len(x['partes']) >= 2, 10), ('maioria', lambda x: any(p['modo'] == 'maioria' for p in x['partes']), 8),
                   ('vista', lambda x: x['tipo_item'] == 'Vista', 6), ('retirada/destaque', lambda x: x['tipo_item'] == 'Retirada de pauta', 3),
                   ('nao deliberado', lambda x: x['situacao_ata'] == 'Não Deliberado', 2),
                   ('impedimento/suspeicao', lambda x: any(v['voto'].startswith('IMPEDIDO') for v in V[x['deliberacao']]), 2),
                   ('ausente', lambda x: any(v['voto'].startswith('AUSENTE') for v in V[x['deliberacao']]), 3),
                   ('unanimidade simples', lambda x: len(x['partes']) == 1 and x['partes'][0]['modo'] == 'unanimidade', 6)):
    for x in pick(f, n, ja): amostra.append((nome, x)); ja.add(x['deliberacao'])
for i, (nome, x) in enumerate(amostra[a:b], a + 1):
    print(f"\n===== [{i}] {x['deliberacao']} ({nome}) | col.relator: {x['relator']} | ata: {x['situacao_ata']}")
    print('TEXTO:', re.sub(r'\s+', ' ', x['decisao_texto'])[:620])
    print('PARSER resultado:', x['resultado'][:500])
    for p in x['partes']: print('   parte', p['parte'], '|', p['modo'], '| vencidos:', [n.split()[0] for n in p['vencidos']], '|', p['acao'][:70])
    for v in V[x['deliberacao']]: print('   voto', v['diretor'].split()[0], '|', v['voto'], '|', v['proveniencia'], '|', v['voto_por_parte'][:110])
