#!/usr/bin/env python3
"""ARTESP: HTML da listagem -> artesp_inventario.json (reuniao, data, docs). Uso: python3 -I artesp_inventario.py in.html out.json"""
import re, sys, json, html, collections
t = open(sys.argv[1], encoding='utf8').read().replace('\u200b', '').replace('\u200c', '').replace('\u2060', ''); out = []
for ano, blk in re.findall(r'<h3 class="tit-area"[^>]*>\s*(\d{4})\s*</h3>(.*?)(?=<h3 class="tit-area"|\Z)', t, re.S):
    for b in blk.split('<hr'):
        m = re.search(r'<strong>\s*(\d+)ª\s*Reuni[^<]*</strong>', b); d = re.search(r'<p dir="ltr">(\d\d/\d\d/\d{4})</p>', b)
        if not (m and d): continue
        tipo = re.search(r'<b>([^<]*Reuni[^<]*)</b>', b)
        docs = [{'rotulo': re.sub(r'&nbsp;|\s+', ' ', html.unescape(re.sub('<[^>]+>', '', x))).strip(), 'url': html.unescape(h)} for h, x in re.findall(r'<a[^>]+href="(https://admin\.cms[^"]+)"[^>]*>(.*?)</a>', b, re.S)]
        out.append({'ano_secao': ano, 'numero': int(m[1]), 'tipo': tipo[1].strip() if tipo else '', 'data': d[1], 'docs': docs})
json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
a26 = [r for r in out if r['data'].endswith('2026')]; n = sorted(r['numero'] for r in a26)
print('total', len(out), '2026:', len(a26), n[0], '-', n[-1], 'buracos:', [x for x in range(n[0], n[-1] + 1) if x not in n])
print(collections.Counter(r['tipo'] for r in a26)); print(collections.Counter(r['data'][3:5] for r in a26))
print('sem ata:', [r['numero'] for r in a26 if not any(d['rotulo'].lower().startswith('ata') for d in r['docs'])])
print('sem deliberacoes:', [r['numero'] for r in a26 if not any(d['rotulo'].lower().startswith('delib') for d in r['docs'])])
