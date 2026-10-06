import json,subprocess,sys,os
R=json.load(open('manifesto_antt.json'))
for r in R:
    for d in r['docs']:
        if d['chars']<=300:
            subprocess.run(['python3','-I','scripts/ocr_pdf.py',d['arquivo'],d['texto']]); print(d['arquivo'],os.path.getsize(d['texto']),flush=True)
