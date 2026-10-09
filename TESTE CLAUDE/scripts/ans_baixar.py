"""ANS: baixa os PDFs OK do inventario (PDF gov.br so valido se comecar com %PDF), grava sha256 e extrai texto (pdftotext -layout).
As paginas HTML ja foram salvas pelo inventario (fonte/ans/html); aqui entram no manifesto com sha256.
Uso: python3 -I scripts/ans_baixar.py ans_inventario.json manifesto_ans.json fonte/ans texto_ans"""
import sys, json, os, re, time, hashlib, subprocess
from concurrent.futures import ThreadPoolExecutor
inv_f, man_f, dest, txt = sys.argv[1:5]; os.makedirs(dest + '/pdf', exist_ok=True); os.makedirs(txt, exist_ok=True)
inv = json.load(open(inv_f))
def curl(u, tries=8):
    for i in range(tries):
        r = subprocess.run(['curl', '-sSL', '-m', '120', '-A', 'Mozilla/5.0', u], capture_output=True)
        if r.returncode == 0 and r.stdout: return r.stdout
        time.sleep(1.2 * (i + 1))
    return b''
def extrai_pymupdf(f, t):
    """pdftotext PERDE a ligadura 'ti' dos PDFs SEI da ANS (Execu vo, norma va); o PyMuPDF a devolve como um digito 4-9 entre letras ('Execu9vo', 'administra7vo'): repara e normaliza ligaduras fi/fl."""
    import pymupdf, unicodedata
    tx = ''.join(p.get_text() for p in pymupdf.open(f))
    tx = ''.join(unicodedata.normalize('NFKC', c) if '\ufb00' <= c <= '\ufb06' else c for c in tx)   # so ligaduras fi/fl/ff (NFKC geral destruiria ª/º)
    tx = re.sub(r'(?<=[A-Za-zÀ-ÿ])[4-9](?=[A-Za-zÀ-ÿ])', 'ti', tx)   # a fonte troca por documento: 9, 7, 6, 5, 4 (nunca ocorrem digitos no meio de palavra na prosa)
    tx = tx.replace('okcio', 'ofício')   # glifo 'ffi' extraido como 'k' em 'de ofício' (18 ocorrencias nas atas)
    open(t, 'w', encoding='utf8').write(tx)
def nome(u): return re.sub(r'[^A-Za-z0-9._-]', '_', u.split('/')[-1])
def baixa(p):
    f = f"{dest}/pdf/{p['tipo']}_{p['ref']}__{nome(p['url'])}"
    if not (os.path.exists(f) and open(f, 'rb').read(4) == b'%PDF'):
        b = curl(p['url'])
        if b[:4] == b'%PDF': open(f, 'wb').write(b)
    ok = os.path.exists(f) and open(f, 'rb').read(4) == b'%PDF'
    t = None
    if ok:
        t = f"{txt}/{os.path.basename(f)[:-4]}.txt"; (extrai_pymupdf(f, t) if p['tipo'] in ('ata_dicol', 'pauta_dicol', 'anexo_dicol') else subprocess.run(['pdftotext', '-layout', f, t], check=False))
        if os.path.exists(t) and os.path.getsize(t) < 200: t = t + ' (VAZIO: PDF imagem?)'
    return dict(url=p['url'], tipo=p['tipo'], ref=p['ref'], formato='pdf', ok=ok, arquivo_local=f if ok else None, texto=t,
                sha256=hashlib.sha256(open(f, 'rb').read()).hexdigest() if ok else None, bytes=os.path.getsize(f) if ok else 0)
alvos = [p for p in inv['pdfs'] if p['estado'] == 'OK']
with ThreadPoolExecutor(6) as ex: man = list(ex.map(baixa, alvos))
for p in inv['paginas']:
    if p['estado'] == 'OK' and p.get('arquivo_local') and os.path.exists(p['arquivo_local']):
        b = open(p['arquivo_local'], 'rb').read()
        man.append(dict(url=p['url'], tipo='html', ref=os.path.basename(p['arquivo_local'])[:-5], formato='html', ok=True, arquivo_local=p['arquivo_local'], texto=None, sha256=hashlib.sha256(b).hexdigest(), bytes=len(b)))
json.dump(man, open(man_f, 'w'), ensure_ascii=False, indent=1)
print('pdf listados OK', len(alvos), 'baixados', sum(m['ok'] for m in man if m['formato'] == 'pdf'), '| html no manifesto', sum(1 for m in man if m['formato'] == 'html'),
      '| pdf sem texto', [m['ref'] for m in man if m['texto'] and 'VAZIO' in m['texto']])
