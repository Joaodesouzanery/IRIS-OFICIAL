"""ANVISA: extratos dos Circuitos Deliberativos de 2026 (cada um traz a tabela nominal 'INFORMACOES DA VOTACAO').
A listagem do site e paginada no front (25 por vez); a API Volto devolve tudo com b_size grande e confere com items_total.
Uso: python3 -I scripts/anvisa_cd_baixar.py anvisa_cd_inventario.json manifesto_anvisa_cd.json fonte/anvisa_cd"""
import sys, json, re, os, time, hashlib, subprocess
from concurrent.futures import ThreadPoolExecutor
inv_out, man_out, dest = sys.argv[1:4]; os.makedirs(dest, exist_ok=True)
API = 'https://www.gov.br/anvisa/++api++/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria'
def curl(args, tries=7):
    for i in range(tries):
        r = subprocess.run(['curl', '-sS', '-m', '120', '-A', 'Mozilla/5.0', '-L', *args], capture_output=True)
        if r.returncode == 0: return r.stdout
        time.sleep(1.5 * (i + 1))
    return b''
def lista(pasta):
    d = json.loads(curl(['-H', 'Accept: application/json', f'{API}/{pasta}?b_start=0&b_size=3000']) or b'{}')
    its = [i for i in d.get('items', []) if i.get('@type') == 'File']
    return its, d.get('items_total')
ex, ex_tot = lista('extratos-dos-circuitos-deliberativos-1/2026'); vo, vo_tot = lista('votos-dos-circuitos-deliberativos-1/2026-1')
assert ex_tot == len(ex) and vo_tot == len(vo), ('listagem incompleta', ex_tot, len(ex), vo_tot, len(vo))
def cdnum(nome):
    m = re.search(r'cd-0*(\d+)-(\d{4})', nome); return (int(m[1]), int(m[2])) if m else (None, None)
inv = {'extratos': [{'arquivo': i['@id'].split('/')[-1], 'url': i['@id'], 'cd': cdnum(i['@id'].split('/')[-1])[0], 'ano_no_nome': cdnum(i['@id'].split('/')[-1])[1], 'modificado': i.get('modified') or i.get('effective')} for i in ex],
       'votos': [{'arquivo': i['@id'].split('/')[-1], 'url': i['@id'], 'cd': cdnum(i['@id'].split('/')[-1])[0]} for i in vo], 'items_total': {'extratos': ex_tot, 'votos': vo_tot}}
json.dump(inv, open(inv_out, 'w'), ensure_ascii=False, indent=1)
def baixa(x):
    f = f"{dest}/{x['arquivo']}"
    if not (os.path.exists(f) and os.path.getsize(f) > 500 and open(f, 'rb').read(4) == b'%PDF'):
        b = curl([x['url'] + '/@@download/file'])
        if b[:4] == b'%PDF': open(f, 'wb').write(b)
    ok = os.path.exists(f) and open(f, 'rb').read(4) == b'%PDF'
    return dict(x, arquivo_local=f if ok else None, sha256=hashlib.sha256(open(f, 'rb').read()).hexdigest() if ok else None, ok=ok)
with ThreadPoolExecutor(8) as ex_: man = list(ex_.map(baixa, inv['extratos']))
json.dump(man, open(man_out, 'w'), ensure_ascii=False, indent=1)
print('extratos', len(man), 'ok', sum(m['ok'] for m in man), '| votos listados', len(vo))
