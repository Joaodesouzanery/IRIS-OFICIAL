"""ANVISA: inventario das atas de ROP/REP 2026 (JSON embutido na listagem Volto) + download com manifesto sha256."""
import re, sys, json, hashlib, subprocess, time, os
BASE = 'https://www.gov.br/anvisa/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria'
inv_out, man_out, dest = sys.argv[1:4]; os.makedirs(dest, exist_ok=True)
def get(url, out=None, tries=6):
    for i in range(tries):
        a = ['curl', '-sS', '-m', '90', '-A', 'Mozilla/5.0', '-L', '-w', '%{http_code}'] + (['-o', out] if out else []) + [url]
        r = subprocess.run(a, capture_output=True)
        if out and r.stdout[-3:] == b'200': return True
        if not out and r.returncode == 0: return r.stdout.decode('utf-8', 'ignore')
        time.sleep(2 * (i + 1))
    return False if out else ''
def itens(pasta):
    h = get(f'{BASE}/{pasta}').replace('\\u002F', '/')
    seen = {}
    for u, t, d in re.findall(r'\{"@id":"(https://www\.gov\.br/anvisa[^"]+)","@type":"(\w+)","description":"([^"]*)"', h):
        seen[u] = (t, d)
    return seen
inv = {}
for u, (t, d) in itens('atas/2026').items():
    m = re.search(r'(Ordin[áa]ria|Extraordin[áa]ria) P[úu]blica n[ºo] (\d+), de (\d+)[º]? de (\w+) de 2026', d)
    if t != 'File' or not m: continue
    mes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'].index(m[4].lower()) + 1
    tag = ('ROP' if m[1].startswith('Ordin') else 'REP') + m[2]
    inv[tag] = {'titulo': d, 'data': f'2026-{mes:02d}-{int(m[3]):02d}', 'url': u, 'tipo': 'Ordinária (ROP)' if tag.startswith('ROP') else 'Extraordinária (REP)'}
# votos: pastas por reuniao (rop-N.2026, rextra)
vot = {}
for u, (t, d) in itens('votos/2026').items():
    k = u.rstrip('/').split('/')[-1]
    if t == 'Document' and k not in ('votos',): vot[k] = u
pauta = {}
for u, (t, d) in itens('pautas/2026').items():
    m = re.search(r'pauta-da-(\d+|1o)[a-z]*-reuniao-(ordinaria|extraordinaria)', u.split('/')[-1])
    if m: pauta[('ROP' if m[2] == 'ordinaria' else 'REP') + ('1' if m[1] == '1o' else m[1])] = u
json.dump({'atas': inv, 'votos_pastas': vot, 'pautas': pauta}, open(inv_out, 'w'), indent=1, ensure_ascii=False)
man = {}
for tag, x in sorted(inv.items()):
    f = f'{dest}/{tag}_ata.pdf'
    ok = os.path.exists(f) and open(f, 'rb').read(4) == b'%PDF'
    if not ok: ok = get(x['url'] + '/@@display-file/file', f) and open(f, 'rb').read(4) == b'%PDF'
    man[tag] = dict(x, arquivo=f if ok else None, sha256=hashlib.sha256(open(f, 'rb').read()).hexdigest() if ok else None, ok=bool(ok))
json.dump(man, open(man_out, 'w'), indent=1, ensure_ascii=False)
print('atas', len(inv), 'ok', sum(v['ok'] for v in man.values()), '| pastas de votos', len(vot), '| pautas', len(pauta))
