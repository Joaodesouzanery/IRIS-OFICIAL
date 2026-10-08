"""ANPD: inventario dos circuitos deliberativos 2026 + download (ata e votos) com manifesto sha256 e retry (proxy reseta)."""
import re, sys, json, hashlib, subprocess, time, os
BASE = 'https://www.gov.br'
PAG = BASE + '/anpd/pt-br/assuntos/deliberacoes-do-conselho-diretor/circuito-deliberativo'
inv_out, man_out, dest = sys.argv[1:4]
os.makedirs(dest, exist_ok=True)
def get(url, out=None, tries=6):
    for i in range(tries):
        a = ['curl', '-sS', '-m', '90', '-A', 'Mozilla/5.0', '-L', '-w', '%{http_code}']
        a += ['-o', out or '-', url]
        r = subprocess.run(a, capture_output=True)
        code = r.stdout[-3:].decode() if out else None
        if out and code == '200': return True
        if not out and r.returncode == 0: return r.stdout.decode('utf-8', 'ignore')
        time.sleep(2 * (i + 1))
    return False if out else ''
html = get(PAG)
links = sorted(set(re.findall(r'href="(/anpd/[^"]*?/cd-(\d+)-2026-(ata|votos|pauta)\.pdf)/@@display-file/file"', html)))
inv = {}
for href, n, tipo in links: inv.setdefault(int(n), {})[tipo] = href
json.dump({str(k): v for k, v in sorted(inv.items())}, open(inv_out, 'w'), indent=1)
man = {}
for n, d in sorted(inv.items()):
    for tipo, href in d.items():
        f = f'{dest}/cd-{n:02d}-2026-{tipo}.pdf'
        ok = os.path.exists(f) and os.path.getsize(f) > 1000 and open(f, 'rb').read(4) == b'%PDF'
        if not ok:
            ok = get(BASE + href + '/@@download/file', f) and open(f, 'rb').read(4) == b'%PDF'
        sha = hashlib.sha256(open(f, 'rb').read()).hexdigest() if ok else None
        man[f'cd-{n:02d}-{tipo}'] = {'cd': n, 'tipo': tipo, 'url': BASE + href, 'arquivo': f if ok else None, 'sha256': sha, 'ok': bool(ok)}
json.dump(man, open(man_out, 'w'), indent=1)
print('circuitos', len(inv), 'docs', len(man), 'ok', sum(v['ok'] for v in man.values()))
