#!/usr/bin/env python3
"""ANTT: pdftotext de todos os docs do manifesto (acrescenta 'texto' e 'chars'). Uso: python3 -I antt_extrair.py manifesto_antt.json texto_antt"""
import json, subprocess, os, sys
m, pasta = sys.argv[1:3]; R = json.load(open(m)); os.makedirs(pasta, exist_ok=True)
for r in R:
    for d in r['docs']:
        out = f"{pasta}/{r['tag']}__{os.path.basename(d['arquivo'])}.txt"
        if not os.path.exists(out) or os.path.getsize(out) == 0: subprocess.run(['pdftotext', '-layout', d['arquivo'], out])
        d['texto'] = out; d['chars'] = os.path.getsize(out)
json.dump(R, open(m, 'w'), ensure_ascii=False, indent=1); print('docs', sum(len(r['docs']) for r in R))
