"""ANAC: manifesto sha256 de tudo que foi baixado (indices APEX, calendario, paginas de reuniao, pautas) e TENTATIVA de baixar
cada documento ligado nas paginas (ata, voto, relatorio, certidao de deliberacao, resolucao/decisao: todos em sei.anac.gov.br;
ementas em pergamum.anac.gov.br). Cada tentativa e registrada (url, rotulo, reuniao, item, resultado). CAPTCHA nunca e resolvido.
PDF baixado -> pdftotext -layout -> texto_anac/; sem texto (PDF imagem) -> registrado como 'imagem sem OCR' (tesseract ausente).
uso: python3 -I scripts/anac_baixar.py anac_inventario.json manifesto_anac.json fonte/anac texto_anac"""
import sys, os, json, re, hashlib, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anac_lib as L
INV, MAN, DIR, TXT = sys.argv[1:5]
inv = json.load(open(INV)); os.makedirs(TXT, exist_ok=True); os.makedirs(os.path.join(DIR, 'doc'), exist_ok=True)
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
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
tent = {'total': len(docs), 'baixados': 0, 'bloqueados': 0, 'por_host': {}}
for u, d in docs.items():
    host = u.split('/')[2]; h = tent['por_host'].setdefault(host, {'tentados': 0, 'baixados': 0})
    h['tentados'] += 1
    nome = hashlib.sha1(u.encode()).hexdigest()[:16]; p = os.path.join(DIR, 'doc', nome + '.bin')
    rr = subprocess.run(['curl', '-sS', '-m', '30', '-L', '-o', p, '-w', '%{http_code}', u], capture_output=True, text=True)
    code = rr.stdout.strip(); ok = code == '200' and os.path.exists(p) and os.path.getsize(p) > 0
    e = {'tipo': 'documento (' + d['rotulo'] + ')', 'reuniao': d['reuniao'], 'item': d['item'], 'url': u, 'valido': False}
    if not ok:
        e['motivo'] = 'bloqueado pelo egress (CONNECT 403: host fora da allowlist)' if code in ('', '000') else 'http' + code
        if os.path.exists(p): os.remove(p)
        tent['bloqueados'] += 1
    else:
        b = open(p, 'rb').read()
        if b[:5] == b'%PDF-':
            pdf = os.path.join(DIR, 'doc', nome + '.pdf'); os.replace(p, pdf)
            subprocess.run(['pdftotext', '-layout', pdf, os.path.join(TXT, nome + '.txt')])
            tx = open(os.path.join(TXT, nome + '.txt'), errors='replace').read() if os.path.exists(os.path.join(TXT, nome + '.txt')) else ''
            e.update(valido=True, arquivo=pdf, sha256=sha(pdf), texto=len(tx.strip()) > 50 or 'imagem sem OCR (tesseract ausente)')
            tent['baixados'] += 1; h['baixados'] += 1
        else:
            cap = b[:3000].lower()
            e['motivo'] = 'captcha/desafio: bloqueado pela fonte (nunca resolvido)' if b'captcha' in cap or b'bobcmn' in cap else 'resposta nao-PDF'
            os.remove(p); tent['bloqueados'] += 1
    man.append(e)
json.dump(man, open(MAN, 'w'), ensure_ascii=False, indent=1)
json.dump(tent, open(os.path.join(DIR, '_tentativas_documentos.json'), 'w'), ensure_ascii=False, indent=1)
print('manifesto', len(man), '| paginas+pautas+indices com sha256', sum(1 for m in man if m.get('sha256') and not m['tipo'].startswith('documento')),
      '| documentos ligados (unicos)', tent['total'], 'baixados', tent['baixados'], 'bloqueados', tent['bloqueados'], tent['por_host'])
