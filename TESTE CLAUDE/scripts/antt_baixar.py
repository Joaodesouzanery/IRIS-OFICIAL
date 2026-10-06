#!/usr/bin/env python3
"""ANTT: para cada reuniao deliberativa de 2026 baixa pagina + PDFs (pauta/ata/voto). Manifesto com sha256.
Uso: python3 -I antt_baixar.py antt_inventario.json manifesto_antt.json fonte/antt"""
import re, sys, json, subprocess, hashlib, os, html, urllib.parse
from concurrent.futures import ThreadPoolExecutor
inv, man, dest = sys.argv[1:4]
L = [c for c in json.load(open(inv)) if c['data'].endswith('2026') and 'Administrativa' not in c['tipo']]
def curl(u, out=None):
    for _ in range(3):
        r = subprocess.run(['curl', '-sS', '-m', '120', '-L', '-o', out or '-', u], capture_output=True)
        if r.returncode == 0: return r.stdout if not out else True
    return None
def reuniao(c):
    num = re.match(r'(\d+)', c['titulo'])[1]; tag = ('ROD' if 'Ordin' in c['tipo'] else 'REX' if 'Extra' in c['tipo'] else 'RDE') + num
    os.makedirs(f'{dest}/{tag}', exist_ok=True)
    pg = curl(c['url']); res = {'tag': tag, **c, 'docs': [], 'erro': None}
    if not pg: res['erro'] = 'pagina nao baixada'; return res
    t = pg.decode('utf8', 'replace'); open(f'{dest}/{tag}/pagina.html', 'w').write(t)
    vistos = set()
    for m in re.finditer(r'href="(/documents/[^"]+)"[^>]*>(.*?)</a>', t, re.S):
        href, rot = html.unescape(m[1]), re.sub(r'\s+', ' ', re.sub('<[^>]+>', '', m[2])).strip()
        base = href.split('?')[0]
        if base in vistos: continue
        vistos.add(base)
        nome = urllib.parse.unquote(base.split('/')[4]) if base.count('/') >= 4 else rot
        tipo = 'pauta' if re.match(r'pauta', rot, re.I) else 'ata' if re.match(r'ata', rot, re.I) else 'voto' if re.match(r'voto', rot, re.I) else 'outro'
        fn = re.sub(r'[^\w.\-]+', '_', nome)[:90]
        path = f'{dest}/{tag}/{tipo}_{fn}'
        ok = os.path.exists(path) and os.path.getsize(path) > 0 or curl('https://portal.antt.gov.br' + href, path)
        d = {'tipo': tipo, 'rotulo': rot[:100], 'arquivo': path, 'url': 'https://portal.antt.gov.br' + base}
        if ok and os.path.exists(path):
            b = open(path, 'rb').read(); d.update(bytes=len(b), sha256=hashlib.sha256(b).hexdigest(), pdf=b[:5] == b'%PDF-')
        else: d['erro'] = 'download falhou'
        res['docs'].append(d)
    return res
with ThreadPoolExecutor(6) as ex: R = list(ex.map(reuniao, L))
json.dump(R, open(man, 'w'), ensure_ascii=False, indent=1)
docs = [d for r in R for d in r['docs']]
print('reunioes', len(R), 'docs', len(docs), 'falhas', sum(1 for d in docs if d.get('erro') or not d.get('pdf')), 'paginas com erro', [r['tag'] for r in R if r['erro']])
