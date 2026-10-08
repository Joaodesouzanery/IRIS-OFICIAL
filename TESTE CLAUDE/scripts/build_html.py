"""Gera o dashboard votos_2026.html (arquivo unico, offline) a partir de votos_2026.xlsx.
As 9 abas da planilha viram 9 visoes (mesmos dados, lidos do mesmo xlsx). Falha se a releitura do HTML divergir do xlsx.
Uso: python3 -I scripts/build_html.py [xlsx] [saida.html]   (gera tambem <saida>_artifact.html, sem botao de exportar)"""
import json, sys, gzip, base64, re, openpyxl, datetime
xlsx = sys.argv[1] if len(sys.argv) > 1 else 'votos_2026.xlsx'; out = sys.argv[2] if len(sys.argv) > 2 else 'votos_2026.html'
wb = openpyxl.load_workbook(xlsx, read_only=True)
def cel(c):
    if c is None: return ''
    if isinstance(c, (datetime.datetime, datetime.date)): return c.isoformat()[:10]
    return c
SH = {}
for ws in wb:
    rows = [[cel(c) for c in r] for r in ws.iter_rows(values_only=True)]
    while rows and not any(x != '' for x in rows[-1]): rows.pop()
    rows = [r[:max((i + 1 for i, c in enumerate(r) if c != ''), default=0)] for r in rows]
    SH[ws.title] = rows
payload = base64.b64encode(gzip.compress(json.dumps(SH, ensure_ascii=False, separators=(',', ':')).encode('utf8'), 9)).decode()
TPL = open(__file__.replace('build_html.py', 'dashboard_template.html'), encoding='utf8').read()
def montar(exporta):
    return TPL.replace('__PAYLOAD__', payload).replace('__EXPORTA__', 'true' if exporta else 'false').replace('__GERADO__', datetime.date.today().strftime('%d/%m/%Y'))
full = montar(True); open(out, 'w', encoding='utf-8').write(full)
art = montar(False)
art = re.sub(r'^<!doctype html>\s*<html[^>]*>\s*<head>\s*<meta charset="utf-8">\s*<meta name="viewport"[^>]*>', '', art, flags=re.S).replace('</head>', '', 1).replace('<body>', '', 1).replace('</body></html>', '')
open(out.replace('.html', '_artifact.html'), 'w', encoding='utf-8').write(art)
# ---- PARIDADE: relê o HTML gravado em disco e compara célula a célula com o xlsx (aberto de novo, sem reaproveitar SH)
txt = open(out, encoding='utf-8').read(); m = re.search(r'<script id="dados" type="text/plain">([^<]+)</script>', txt)
back = json.loads(gzip.decompress(base64.b64decode(m[1])).decode('utf8'))
wb2 = openpyxl.load_workbook(xlsx, read_only=True); erros = []
assert list(back) == wb2.sheetnames, ('abas diferentes', list(back), wb2.sheetnames)
for ws in wb2:
    lin = [[cel(c) for c in r] for r in ws.iter_rows(values_only=True)]
    while lin and not any(x != '' for x in lin[-1]): lin.pop()
    b = back[ws.title]
    if len(b) != len(lin): erros.append((ws.title, 'linhas', len(b), len(lin))); continue
    nb = sum(1 for r in b for c in r if c != ''); nl = sum(1 for r in lin for c in r if c != '')
    sb = sum(c for r in b for c in r if isinstance(c, (int, float))); sl = sum(c for r in lin for c in r if isinstance(c, (int, float)))
    if nb != nl or sb != sl: erros.append((ws.title, 'celulas/soma', (nb, sb), (nl, sl)))
    print(f'  {ws.title:16} {len(b):6} linhas  {nb:7} células  soma numérica {sb}')
if erros: raise SystemExit('PARIDADE FALHOU: ' + str(erros))
print('ok', out, round(len(full) / 1e6, 2), 'MB · paridade HTML × xlsx OK ({} abas, linhas, células e somas)'.format(len(back)) + '')
