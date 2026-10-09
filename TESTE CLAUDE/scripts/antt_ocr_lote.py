#!/usr/bin/env python3
"""ANTT: OCR dos PDFs de voto/voto vista que são IMAGEM (texto do PDF <= 300 caracteres), só os que ainda não têm OCR em texto_antt_ocr/.
Uso: python3 -I scripts/antt_ocr_lote.py manifesto_antt.json [paralelo=3] [dpi=150]   (saída: texto_antt_ocr/<reuniao>__<arquivo>.pdf.txt)
Incremental: rodar de novo só processa o que falta. Custo medido: ~1-2 min por PDF de 4 páginas num núcleo."""
import json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
man = sys.argv[1]; par = int(sys.argv[2]) if len(sys.argv) > 2 else 3; dpi = sys.argv[3] if len(sys.argv) > 3 else '150'
aqui = os.path.dirname(os.path.abspath(__file__)); os.makedirs('texto_antt_ocr', exist_ok=True)
fila = []
for r in json.load(open(man)):
    for d in r['docs']:
        if d['tipo'] in ('voto', 'outro') and d.get('chars', 0) <= 300 and d.get('pdf'):
            out = f"texto_antt_ocr/{r['tag']}__{os.path.basename(d['arquivo'])}.txt"
            if not (os.path.exists(out) and os.path.getsize(out) > 0): fila.append((d['arquivo'], out))
def um(x):
    a, o = x
    r = subprocess.run(['python3', '-I', os.path.join(aqui, 'antt_ocr.py'), a, o + '.tmp', dpi], capture_output=True, text=True)
    if r.returncode == 0: os.replace(o + '.tmp', o); return (a, 'ok')
    return (a, 'ERRO ' + r.stderr[-200:])
with ThreadPoolExecutor(par) as ex:
    for a, st in ex.map(um, fila): print(st, a, flush=True)
print('OCR feito em', sum(1 for _ in fila), 'PDFs (fila inicial)')
