"""ANEEL: auditoria MANUAL por amostra. Sorteia 40 itens estratificados (semente fixa) de aneel.json e imprime, lado a lado, o texto da ata
(decisao_texto) e o que o parser extraiu (relator, resultado, partes, vencidos, voto de cada diretor) para conferencia humana.
Uso: python3 -I scripts/aneel_auditoria.py [aneel.json] [inicio] [fim] [semente] [excluir_sementes] [60]
     excluir_sementes: lista 'a,b,c' de sementes JA auditadas (40 itens cada, cotas originais) cujos itens NAO podem reaparecer (itens NOVOS); o 6o argumento '60' usa as cotas de 60 itens.
     -> o veredito (ok/erro por campo) fica em aneel_auditoria.json (preenchido por quem le)"""
import json, sys, random, re, collections
arq = sys.argv[1] if len(sys.argv) > 1 else 'aneel.json'
a, b = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (0, 40)
d = json.load(open(arq))
SEMENTE = int(sys.argv[4]) if len(sys.argv) > 4 else 2026
EXCLUIR = [(int(x.split(':')[0]), len(x.split(':')) > 1) for x in sys.argv[5].split(',') if x] if len(sys.argv) > 5 else []      # 'semente' (40 itens) ou 'semente:60' (60 itens)
N60 = len(sys.argv) > 6 and sys.argv[6] == '60'
D = d['deliberacoes']
V = collections.defaultdict(list)
for v in d['votos']: V[v['deliberacao']].append(v)
ESTRATOS = (('composta (>=2 partes)', lambda x: len(x['partes']) >= 2, 10, 14), ('maioria', lambda x: any(p['modo'] == 'maioria' for p in x['partes']), 8, 11),
            ('vista', lambda x: x['tipo_item'] == 'Vista', 6, 9), ('retirada/destaque', lambda x: x['tipo_item'] == 'Retirada de pauta', 3, 4),
            ('nao deliberado', lambda x: x['situacao_ata'] == 'Não Deliberado', 2, 4),
            ('impedimento/suspeicao', lambda x: any(v['voto'].startswith('IMPEDIDO') for v in V[x['deliberacao']]), 2, 3),
            ('ausente', lambda x: any(v['voto'].startswith('AUSENTE') for v in V[x['deliberacao']]), 3, 5),
            ('unanimidade simples', lambda x: len(x['partes']) == 1 and x['partes'][0]['modo'] == 'unanimidade', 6, 10))
def sortear(semente, n60, ja0=()):
    rnd = random.Random(semente); ja = set(ja0); out = []
    for nome, f, n40, n60_ in ESTRATOS:
        c = [x for x in D if f(x) and x['deliberacao'] not in ja]; rnd.shuffle(c)
        for x in c[:(n60_ if n60 else n40)]: out.append((nome, x)); ja.add(x['deliberacao'])
    alvo = 60 if n60 else 40
    if n60 and len(out) < alvo:      # estratos esgotados (itens ja auditados excluidos): completa com itens aleatorios ainda nao lidos
        c = [x for x in D if x['deliberacao'] not in ja]; rnd.shuffle(c)
        for x in c[:alvo - len(out)]: out.append(('complemento aleatorio', x))
    return out
ja_aud = set()
for sem_, e60_ in EXCLUIR: ja_aud |= {x['deliberacao'] for _, x in sortear(sem_, e60_, ja_aud if e60_ else ())}      # 'semente:60' = amostra de 60 sorteada JA excluindo as anteriores da lista (ordem importa)
amostra = sortear(SEMENTE, N60, ja_aud)
for i, (nome, x) in enumerate(amostra[a:b], a + 1):
    print(f"\n===== [{i}] {x['deliberacao']} ({nome}) | col.relator: {x['relator']} | ata: {x['situacao_ata']}")
    print('TEXTO:', re.sub(r'\s+', ' ', x['decisao_texto'])[:620])
    print('PARSER resultado:', x['resultado'][:500])
    for p in x['partes']: print('   parte', p['parte'], '|', p['modo'], '| vencidos:', [n.split()[0] for n in p['vencidos']], '|', p['acao'][:70])
    for v in V[x['deliberacao']]: print('   voto', v['diretor'].split()[0], '|', v['voto'], '|', v['proveniencia'], '|', v['voto_por_parte'][:110])
