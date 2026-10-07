#!/usr/bin/env python3
"""ARTESP: concilia as deliberacoes das ATAS com os PDFs de 'Deliberacoes' (ZIP/PDF por reuniao), por numero e por processo.
Saida: artesp_conciliacao.json. Uso: python3 -I artesp_conciliar.py artesp.json fonte/artesp saida.json"""
import zipfile, glob, re, json, sys, os, subprocess, tempfile, collections
art = json.load(open(sys.argv[1])); pasta = sys.argv[2]
ata = {(d['deliberacao']): d for d in art['deliberacoes']}
proc_ata = collections.defaultdict(list)
for d in art['deliberacoes']: proc_ata[d['processo']].append(d['deliberacao'])
def txt(path): return re.sub(r'\s+', ' ', subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True).stdout)
docs = []  # (reuniao, nº, processo, data_doc)
tmp = tempfile.mkdtemp(prefix='zx_', dir=os.environ.get('TMPDIR', '/tmp'))
for f in sorted(glob.glob(f'{pasta}/*/delib.*')):
    tag = f.split('/')[-2]; files = []
    if f.endswith('.zip'):
        z = zipfile.ZipFile(f)
        for n in z.namelist():
            m = re.search(r'DELIBERA\w*\s*ARTESP\s*N[ºO°]?\s*(\d+)', n, re.I)
            if m and n.lower().endswith('.pdf'): files.append((int(m[1]), z.extract(n, tmp)))
    else:
        t = txt(f); m = re.search(r'DELIBERA\w*\s*ARTESP\s*N[ºO°]?\s*(\d+)', t, re.I)
        if m: files.append((int(m[1]), f))
    for num, p in files:
        t = txt(p); pr = re.search(r'Processo SEI! n[ºo]\s*([\d./-]+)', t)
        docs.append({'reuniao': tag, 'numero': num, 'processo': pr[1] if pr else '', 'unanimidade': 'unanimidade' in t.lower()})
zn = collections.defaultdict(list)
for d in docs: zn[d['numero']].append(d)
out = {'pdfs_deliberacao': len(docs), 'numeros_zip': len(zn),
       'so_no_zip': sorted(set(zn) - set(ata)), 'so_na_ata': sorted(set(ata) - set(zn)),
       'numero_diverge_por_processo': [], 'buracos_nos_dois': [x for x in range(1, max(set(zn) | set(ata)) + 1) if x not in zn and x not in ata]}
for num, ds in zn.items():
    for d in ds:
        if d['processo'] and d['processo'] in proc_ata and num not in proc_ata[d['processo']]:
            out['numero_diverge_por_processo'].append({'zip_numero': num, 'processo': d['processo'], 'ata_numero': proc_ata[d['processo']], 'reuniao_zip': d['reuniao']})
out['docs'] = docs
out['docs_so_no_zip'] = [dict(d, ata_com_o_processo=[(x['reuniao'], x['deliberacao']) for x in art['deliberacoes'] if x['processo'].rstrip('.') == d['processo'].rstrip('.')]) for n in out['so_no_zip'] for d in zn[n]]
json.dump(out, open(sys.argv[3], 'w'), ensure_ascii=False, indent=1)
print({k: (v if not isinstance(v, list) else v[:12]) for k, v in out.items()})
