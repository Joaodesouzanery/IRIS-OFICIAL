"""ANAC: baixa os PDFs (so /@@download/file ou link direto .pdf) das paginas de reuniao 2026; manifesto sha256.
uso: python3 -I scripts/anac_baixar.py anac_inventario.json manifesto_anac.json fonte/anac texto_anac"""
import sys, os, json, re, hashlib, subprocess
INV, MAN, DIR, TXT = sys.argv[1:5]
inv = json.load(open(INV)); os.makedirs(TXT, exist_ok=True)
urls = []
for r in inv['reunioes_2026_gov_br']:
    h = open(os.path.join(DIR, r['arquivo']), errors='replace').read()
    for u in set(re.findall(r'href="([^"]+\.pdf[^"]*|[^"]+/@@download/file[^"]*)"', h)):
        if '/anac/' in u: urls.append((u if u.startswith('http') else 'https://www.gov.br' + u))
pdf = os.path.join(DIR, 'pdf'); os.makedirs(pdf, exist_ok=True)
if urls:
    lf = os.path.join(DIR, '_pdfs.tsv')
    open(lf, 'w').write('\n'.join(f'{u}\t{hashlib.sha1(u.encode()).hexdigest()[:16]}.pdf' for u in urls) + '\n')
    subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'anac_fetch.cjs'), pdf, lf], stdout=subprocess.DEVNULL)
man = []
for u in urls:
    p = os.path.join(pdf, hashlib.sha1(u.encode()).hexdigest()[:16] + '.pdf')
    ok = os.path.exists(p) and open(p, 'rb').read(5) == b'%PDF-'
    e = {'url': u, 'arquivo': p, 'valido': ok}
    if ok:
        e['sha256'] = hashlib.sha256(open(p, 'rb').read()).hexdigest()
        subprocess.run(['pdftotext', '-layout', p, os.path.join(TXT, os.path.basename(p)[:-4] + '.txt')])
    man.append(e)
for r in inv['reunioes_2026_gov_br']:
    p = os.path.join(DIR, r['arquivo']); man.append({'url': r['url'], 'arquivo': p, 'valido': True, 'sha256': hashlib.sha256(open(p, 'rb').read()).hexdigest()})
json.dump(man, open(MAN, 'w'), ensure_ascii=False, indent=1)
print('manifesto', len(man), 'pdfs validos', sum(1 for m in man if m['arquivo'].endswith('.pdf') and m['valido']), 'de', len(urls))
