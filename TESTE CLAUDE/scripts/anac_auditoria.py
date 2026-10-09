"""ANAC: auditoria independente por amostragem (semente fixa). Texto dos cartoes ANTES do JSON.
uso: python3 -I scripts/anac_auditoria.py anac.json [N=40] [semente=2026]"""
import sys, json, random
d = json.load(open(sys.argv[1])); N = int(sys.argv[2]) if len(sys.argv) > 2 else 40; S = int(sys.argv[3]) if len(sys.argv) > 3 else 2026
V = d['votos']; D = d['deliberacoes']
if not V:
    print('AUDITORIA: 0 votos no anac.json, nada a amostrar (itens:', len(D), ')'); print(json.dumps({'amostra': 0, 'acerto': None, 'nota': 'sem dados 2026 acessíveis'})); sys.exit(0)
random.seed(S); am = random.sample(V, min(N, len(V)))
for i, v in enumerate(am, 1): print(f"CARTAO {i}: {v['reuniao']} proc {v['processo']} item {v['deliberacao']} diretor={v['diretor']!r} voto={v['voto']} prov={v['proveniencia']}")
print(json.dumps({'amostra': len(am), 'semente': S}))
