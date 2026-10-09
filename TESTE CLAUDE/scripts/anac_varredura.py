"""ANAC: varredura 100% independente (NAO importa o parser): relê as paginas salvas em fonte/anac e confere contra anac.json.
uso: python3 -I scripts/anac_varredura.py anac.json anac_inventario.json [fonte/anac]"""
import sys, json, re, os
d = json.load(open(sys.argv[1])); inv = json.load(open(sys.argv[2])); DIR = sys.argv[3] if len(sys.argv) > 3 else 'fonte/anac'
bad = 0; n_pag = 0; n_proc = 0
for r in inv['reunioes_2026_gov_br']:
    h = open(os.path.join(DIR, r['arquivo']), errors='replace').read(); n_pag += 1
    esperado = len(re.findall(r'>\s*Processo\s*<', h))
    achado = sum(1 for x in d['deliberacoes'] if x['origem'] == r['url']); n_proc += esperado
    if esperado != achado: bad += 1; print('DIVERGE', r['url'], esperado, achado)
vp = {(v['reuniao'], v['processo'], v['deliberacao']) for v in d['votos']}
sem = [x for x in d['deliberacoes'] if (x['reuniao'], x['processo'], x['item_n']) not in vp]
print(f'varredura: paginas={n_pag} itens esperados={n_proc} itens no JSON={len(d["deliberacoes"])} itens sem voto={len(sem)} divergencias={bad}')
sys.exit(1 if bad or sem else 0)
