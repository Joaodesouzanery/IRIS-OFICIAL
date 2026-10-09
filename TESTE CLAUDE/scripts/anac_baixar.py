"""ANAC: manifesto sha256 de tudo que foi baixado (indices APEX, calendario, paginas de reuniao, pautas) e download de cada documento ligado
nas paginas (ata, voto, relatorio, certidao de deliberacao, resolucao/decisao: sei.anac.gov.br; ementas: pergamum.anac.gov.br).
Hosts liberados no egress (09/10/2026). O F5 rejeita ~50% das requisicoes: curl com cookie jar e retry. CAPTCHA nunca e resolvido.
O SEI (consulta externa) devolve HTML ISO-8859-1 (nao PDF): o HTML cru e guardado com sha256 e o texto limpo vai para texto_anac/<id>.txt.
PDF (se vier) -> pdftotext -layout; PDF sem texto -> ocr (scripts/ocr_pdf.py, RapidOCR) quando disponivel, senao registrado 'imagem sem OCR'.
pergamum.anac.gov.br/acervo/N e uma SPA React (casca de 3,7 KB; o conteudo vem de uma API autenticada): a casca e baixada e registrada
com texto=False e motivo; o conteudo NAO e lido (nao se usa a API com credenciais).
Cada tentativa e registrada (url, rotulo, reuniao, item, resultado). Incremental: o que ja existe em fonte/anac/doc e reaproveitado.
uso: python3 -I scripts/anac_baixar.py anac_inventario.json manifesto_anac.json fonte/anac texto_anac"""
import sys, os, json, re, html, hashlib, subprocess, time, threading
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anac_lib as L
INV, MAN, DIR, TXT = sys.argv[1:5]
inv = json.load(open(INV)); os.makedirs(TXT, exist_ok=True); os.makedirs(os.path.join(DIR, 'doc'), exist_ok=True)
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()

def html_texto(b):
    """bytes de pagina SEI (iso-8859-1) -> texto limpo, mantendo quebras de paragrafo."""
    s = b.decode('latin1') if b'charset=iso-8859-1' in b[:3000].lower() or b'charset=iso-8859-1' in b[:3000].lower().replace(b' ', b'') else b.decode('utf-8', 'replace')
    s = re.sub(r'<(script|style)\b.*?</\1>', ' ', s, flags=re.S | re.I)
    s = re.sub(r'</(p|div|tr|li|h\d|table)>|<br\s*/?>', '\n', s, flags=re.I)
    s = html.unescape(re.sub(r'<[^>]+>', ' ', s)).replace('\xa0', ' ').replace('​', '')
    s = re.sub(r'[ \t\r]+', ' ', s); s = re.sub(r' ?\n ?', '\n', s)
    return re.sub(r'\n{3,}', '\n\n', s).strip()

def busca(u, dest, tentativas=10):
    """curl com retry (cookie jar por thread). Devolve (codigo, bytes|None)."""
    jar = os.path.join(DIR, f'_cj_{threading.get_ident()}.txt'); code = ''
    for t in range(tentativas):
        r = subprocess.run(['curl', '-sS', '-m', '45', '-L', '-c', jar, '-b', jar, '-o', dest, '-w', '%{http_code}', u], capture_output=True, text=True)
        code = r.stdout.strip(); sz = os.path.getsize(dest) if os.path.exists(dest) else 0
        if code == '200' and sz > 0:
            b = open(dest, 'rb').read()
            if b[:400].lower().find(b'request rejected') >= 0 or (sz < 400 and b'rejected' in b.lower()): time.sleep(1); continue
            return code, b
        if code == '404': break
        time.sleep(1.5)
    return code, None

man = []
for f in inv['fontes']:
    p = os.path.join(DIR, f['arquivo'])
    if os.path.exists(p): man.append({'tipo': 'pagina/indice', 'url': f['url'], 'arquivo': p, 'valido': True, 'sha256': sha(p), 'bytes': os.path.getsize(p)})
    else: man.append({'tipo': 'pagina/indice', 'url': f['url'], 'arquivo': p, 'valido': False, 'motivo': f['status']})
docs = {}   # url -> dados
for r in inv['reunioes_2026']:
    h = open(os.path.join(DIR, r['arquivo']), errors='replace').read()
    man.append({'tipo': 'pagina da reuniao', 'reuniao': r['reuniao'], 'url': r['url'], 'arquivo': os.path.join(DIR, r['arquivo']), 'valido': True, 'sha256': sha(os.path.join(DIR, r['arquivo']))})
    pp = os.path.join(DIR, r['arquivo_pauta'])
    if os.path.exists(pp): man.append({'tipo': 'pauta', 'reuniao': r['reuniao'], 'url': r['url_pauta'], 'arquivo': pp, 'valido': True, 'sha256': sha(pp)})
    cb = L.cabecalho(h)
    for rot, u in cb['links'].items():
        if rot in ('Ata',): docs.setdefault(u, {'rotulo': 'Ata', 'reuniao': r['reuniao'], 'item': None})
    for it in L.itens(h):
        for rot, u in it['docs']:
            if 'sei.anac.gov.br' in u or 'pergamum.anac.gov.br' in u: docs.setdefault(u, {'rotulo': rot, 'reuniao': r['reuniao'], 'item': it['n']})

def um(arg):
    u, d = arg
    nome = hashlib.sha1(u.encode()).hexdigest()[:16]; tp = os.path.join(TXT, nome + '.txt')
    e = {'tipo': 'documento (' + d['rotulo'] + ')', 'reuniao': d['reuniao'], 'item': d['item'], 'url': u, 'id': nome, 'valido': False}
    cache = [os.path.join(DIR, 'doc', nome + x) for x in ('.html', '.pdf')]
    ex = next((c for c in cache if os.path.exists(c) and os.path.getsize(c) > 0), None)
    if ex: code, b = '200', open(ex, 'rb').read()
    else:
        tmp = os.path.join(DIR, 'doc', nome + '.tmp'); code, b = busca(u, tmp)
        if os.path.exists(tmp): os.remove(tmp)
    if b is None:
        e['motivo'] = 'http' + code if code not in ('', '000') else 'sem resposta (tentativas esgotadas)'; return e
    if b[:5] == b'%PDF-':
        p = os.path.join(DIR, 'doc', nome + '.pdf'); open(p, 'wb').write(b)
        subprocess.run(['pdftotext', '-layout', p, tp]); tx = open(tp, errors='replace').read() if os.path.exists(tp) else ''
        e.update(valido=True, arquivo=p, formato='pdf', sha256=sha(p), bytes=len(b))
        if len(tx.strip()) <= 50:   # PDF imagem -> OCR (RapidOCR); texto OCR e reaproveitado se ja existir
            if not (os.path.exists(tp) and len(open(tp, errors='replace').read().strip()) > 50 and os.path.exists(tp + '.ocr')):
                subprocess.run(['python3', '-I', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ocr_pdf.py'), p, tp], capture_output=True)
                open(tp + '.ocr', 'w').write('1')
            tx = open(tp, errors='replace').read() if os.path.exists(tp) else ''; e['ocr'] = True
        e['texto'] = len(tx.strip()) > 50; e['chars'] = len(tx)
        if not e['texto']: e['motivo_texto'] = 'PDF imagem sem texto mesmo com OCR'
        return e
    low = b[:6000].lower()
    p = os.path.join(DIR, 'doc', nome + '.html'); open(p, 'wb').write(b)
    e.update(valido=True, arquivo=p, formato='html', sha256=sha(p), bytes=len(b))
    if b'captcha' in low and len(b) < 20000 and b'recaptcha/api' not in low:
        os.remove(p); e.update(valido=False, motivo='captcha/desafio: bloqueado pela fonte (nunca resolvido)'); return e
    if 'pergamum.anac.gov.br' in u:
        e.update(texto=False, motivo_texto='SPA React (casca): o conteudo vem de API autenticada; nao lido'); return e
    tx = html_texto(b); open(tp, 'w').write(tx)
    e.update(texto=len(tx) > 80, chars=len(tx))
    return e

t0 = time.time()
with ThreadPoolExecutor(4) as ex: res = list(ex.map(um, docs.items()))
man += res
tent = {'total': len(docs), 'baixados': sum(1 for e in res if e['valido']), 'bloqueados': sum(1 for e in res if not e['valido']),
        'com_texto_lido': sum(1 for e in res if e.get('texto')), 'por_host': {}}
for e in res:
    h = tent['por_host'].setdefault(e['url'].split('/')[2], {'tentados': 0, 'baixados': 0, 'lidos': 0})
    h['tentados'] += 1; h['baixados'] += e['valido']; h['lidos'] += bool(e.get('texto'))
json.dump(man, open(MAN, 'w'), ensure_ascii=False, indent=1)
json.dump(tent, open(os.path.join(DIR, '_tentativas_documentos.json'), 'w'), ensure_ascii=False, indent=1)
print('manifesto', len(man), '| documentos ligados (unicos)', tent['total'], 'baixados', tent['baixados'], 'lidos', tent['com_texto_lido'], 'falhas', tent['bloqueados'], tent['por_host'], f'{time.time()-t0:.0f}s')
