"""ARTESP: le o campo 'Procedência:' de cada PDF de Deliberação (dentro dos delib.zip) -> artesp_procedencia.json {numero: {procedencia, tipo, diretor}}.
Superintendência = limite da fonte (a ARTESP não diz quem relatou). Procedência 'DIR-XX' ou 'Presidência' = proponente nominal."""
import glob, zipfile, tempfile, subprocess, re, json, os, collections
DIR = {'DIR-RC': 'Raquel França Carneiro', 'DIR-DZ': 'Diego Albert Zanatto', 'DIR-FR': 'Fernanda Esbízaro Rodrigues Rudnik', 'PRE': 'André Isper Rodrigues Barnabé', 'PRESIDÊNCIA': 'André Isper Rodrigues Barnabé', 'PRESIDENCIA': 'André Isper Rodrigues Barnabé'}
out = {}; tmp = tempfile.mkdtemp()
for z in sorted(glob.glob('fonte/artesp/*/delib.zip')):
    try: zf = zipfile.ZipFile(z)
    except Exception: continue
    for nm in zf.namelist():
        if not nm.lower().endswith('.pdf') or not re.search(r'DELIBERA[ÇC][ÃA]O', nm, re.I): continue
        m = re.search(r'N[ºO°]\s*(\d+)', nm)
        if not m: continue
        f = os.path.join(tmp, 'x.pdf'); open(f, 'wb').write(zf.read(nm))
        t = subprocess.run(['pdftotext', '-layout', f, '-'], capture_output=True, text=True).stdout
        pr = re.search(r'Proced[êe]ncia:\s*(.*?)\.?\s*(?:\n|$)', t); proc = re.sub(r'\s+', ' ', pr[1]).strip() if pr else ''
        tipo = 'sem campo' if not proc else 'diretoria' if re.search(r'\bDIR-[A-Z]{2}\b|Diretoria \d|Presid[êe]ncia|\bPRE\b', proc) else 'superintendência'
        dr = next((v for k, v in DIR.items() if re.search(r'\b' + k + r'\b', proc.upper())), None) if tipo == 'diretoria' else None
        out[int(m[1])] = {'procedencia': proc, 'tipo': tipo, 'diretor': dr, 'zip': z, 'arquivo': nm}
json.dump(out, open('artesp_procedencia.json', 'w'), ensure_ascii=False, indent=1)
print(len(out), collections.Counter(v['tipo'] for v in out.values()), collections.Counter(v['diretor'] for v in out.values() if v['diretor']))
