"""ANS (DICOL): inventario das fontes de 2026 (reunioes da Diretoria Colegiada).
A pasta OFICIAL de atas (gov.br/ans/pt-br/acesso-a-informacao/transparencia-e-prestacao-de-contas/reunioes-da-diretoria-da-ans, atalho do
site 'Reunioes da Diretoria da ANS' -> componentes-portal.ans.gov.br/link/listadicol) esta RESTRITA ("Conteudo Restrito"/401) ou fora da allowlist;
a ANS nao e Volto (++api++ responde 404). O que e publico: (1) noticias de aviso/deliberacoes em assuntos/noticias-1/periodo-eleitoral (listagem
HTML paginada, 30 por pagina, sem contador), (2) pautas em PDF (/arquivos/assuntos/noticias/), (3) extratos de ata em PDF (Rol de Procedimentos,
dentro de audiencias-publicas/NN).
Uso: python3 -I scripts/ans_inventario.py ans_inventario.json fonte/ans
Prova de paginacao: percorre b_start=0,30,60... ate a pagina vazia; registra links por pagina."""
import sys, re, json, subprocess, time, html, os
from concurrent.futures import ThreadPoolExecutor
out, dest = sys.argv[1:3]; os.makedirs(dest + '/html', exist_ok=True)
G = 'https://www.gov.br/ans/pt-br'
def curl(u, tries=8):
    for i in range(tries):
        r = subprocess.run(['curl', '-sSL', '-m', '90', '-A', 'Mozilla/5.0', '-w', '\n__HTTP__%{http_code}', u], capture_output=True)
        if r.returncode == 0 and r.stdout:
            b, _, c = r.stdout.rpartition(b'\n__HTTP__'); return int(c or 0), b
        time.sleep(1.2 * (i + 1))
    return 0, b''
def estado(code, b):
    if code == 0: return 'REDE'
    if code in (401, 403): return 'RESTRITO'
    if code == 404 or b[:2] == b'{"': return '404'
    t = b[:200000].decode('utf8', 'replace')
    if 'Conteúdo Restrito' in t: return 'RESTRITO'
    return 'OK'
# 1) listagem paginada da pasta de noticias (onde estao os avisos/deliberacoes de jul-out/2026)
pastas = {'periodo-eleitoral': G + '/assuntos/noticias-1/periodo-eleitoral'}
paginas = []; noticias = {}
for nome, base in pastas.items():
    b = 0
    while True:
        code, body = curl(f'{base}?b_start:int={b}'); t = body.decode('utf8', 'replace')
        ls = {}
        for m in re.finditer(r'<a[^>]*href="([^"#?]+)"[^>]*>\s*([^<]{3,200})</a>', t):
            u = m[1].rstrip('/')
            if u.startswith(base + '/') and not u.endswith('.pdf'): ls.setdefault(u, html.unescape(m[2]).strip())
        novos = [u for u in ls if u not in noticias]
        for u in novos: noticias[u] = ls[u]
        paginas.append({'pasta': nome, 'b_start': b, 'http': code, 'links_na_pagina': len(ls), 'novos': len(novos)})
        if not novos: break
        b += 30
dicol = {u: t for u, t in noticias.items() if re.search(r'reuni[ãa]o.*diretoria colegiada|diretoria colegiada.*(composi|reuni)', t, re.I) and not re.search(r'cosa', t, re.I)}
# 2) sementes: paginas e PDFs conhecidos (descobertos por busca do site/links das noticias); cada uma e testada ao vivo
seeds_html = [G + '/assuntos/noticias-1/periodo-eleitoral/diretoria-colegiada-da-ans-tem-nova-composicao']
for n in range(632, 646):
    for pre in ('', 'deliberacoes-da-'):
        for fo in ('assuntos/noticias-1/periodo-eleitoral/', 'assuntos/noticias/sobre-ans/', 'assuntos/noticias/'):
            seeds_html.append(f'{G}/{fo}{pre}{n}a-reuniao-da-diretoria-colegiada')
for n in range(1, 14):
    for pre in ('', 'deliberacoes-da-'):
        for fo in ('assuntos/noticias-1/periodo-eleitoral/', 'assuntos/noticias/sobre-ans/'):
            seeds_html.append(f'{G}/{fo}{pre}{n}a-reuniao-extraordinaria-da-diretoria-colegiada-de-2026')
seeds_html += [G + '/assuntos/noticias/sobre-ans/4a-extraordinaria-da-diretoria-colegiada-de-2026',
               G + '/acesso-a-informacao/transparencia-e-prestacao-de-contas/reunioes-da-diretoria-da-ans',
               G + '/acesso-a-informacao/transparencia-e-prestacao-de-contas/reunioes-da-diretoria-da-ans/historico-de-reunioes-da-diretoria-ans',
               G + '/acesso-a-informacao/participacao-da-sociedade/audiencias-publicas/audiencias-publicas-realizadas-1/audiencias-publicas-realizadas',
               'https://componentes-portal.ans.gov.br/link/listadicol', 'https://www.ans.gov.br/aans/transparencia-institucional/reunioes-da-diretoria-ans']
A = G + '/arquivos/assuntos/noticias/'; E = G + '/arquivos/acesso-a-informacao/participacao-da-sociedade/audiencias-publicas/'
seeds_pdf = [
 ('pauta', '633', A + 'Pauta_633_DICOL_ANS23.02.2026.pdf'), ('pauta', '634', G + '/assuntos/noticias/sobre-ans/Pauta_634_DICOL_ANS13.03.2026.pdf'),
 ('pauta', '635', A + 'Pauta_DICOL_635ANS06.04.2026.pdf'), ('pauta', '636', A + 'copy_of_Pauta_Dicol_636_ANS_24.04.2026.pdf'),
 ('pauta', '637', A + 'Pauta_DICOL637ANS15.05.2026v.pdf'), ('pauta', '638', A + 'Pauta_Reuniao_DICOL_638_ANS08.06.2026.pdf'),
 ('pauta', '639', G + '/assuntos/noticias/sobre-ans/639a-reuniao-da-diretoria-colegiada/Pauta_DICOL_639ANS26.06.2026v.pdf'),
 ('pauta', '640', A + 'Pauta_DICOL640ANS17.07.2026.pdf'), ('pauta', '641', A + 'Pauta_641__DICOLANS07.08.2026.pdf'),
 ('pauta', '642', A + 'Pauta_DICOL_642ANS26.08.2026_v.pdf'), ('pauta', '643', A + 'Pauta_643__DICOLANS18.09.2026_v3.pdf'),
 ('pauta', '644', A + 'Pauta_Dicol_644ANS09.10.2026.pdf'), ('pauta', 'X2', A + 'PautaDicol2ExtraANS06.02.2026.pdf'),
 ('extrato', 'X1', E + '61/SEI_34981036_Extrato_da_Ata_de_1_Reuniao_Extra__DICOL.pdf'), ('extrato', 'X2', E + '60/SEI_35064558_Extrato_da_Ata_de_Reuniao___DICOL.pdf'),
 ('extrato', '635', E + '63/SEI_35423786_Extrato_da_Ata_de_Reuniao___DICOL.pdf'), ('extrato', '636', E + '63/SEI_35592298_Extrato_da_Ata_de_Reuniao___DICOL.pdf'),
 ('extrato', '638', E + '65/SEI_35936254_Extrato_da_Ata_de_Reuniao___DICOL.pdf'), ('extrato', 'X12', E + '68/SEI_37004163_Extrato_da_Ata_de_Reuniao___DICOL.pdf')]
def testa(u):
    code, b = curl(u); return u, code, estado(code, b), len(b), b
with ThreadPoolExecutor(8) as ex: res = list(ex.map(testa, list(dict.fromkeys(seeds_html + list(dicol)))))
paginas_ok = {}
for u, code, est, n, b in res:
    if est == 'OK' and u.startswith(G + '/assuntos'):
        if 'Publicado em' not in b.decode('utf8', 'replace'): est = 'SEM_CONTEUDO'
    paginas_ok[u] = dict(url=u, http=code, estado=est, bytes=n)
    if est == 'OK':
        f = f"{dest}/html/{u.rstrip('/').split('/')[-1]}.html"; open(f, 'wb').write(b); paginas_ok[u]['arquivo_local'] = f
# 3) PDFs linkados nas noticias OK (pautas/extratos) alem das sementes
pdfs = {u: (k, r) for k, r, u in seeds_pdf}
for u, d in paginas_ok.items():
    if d['estado'] != 'OK' or 'arquivo_local' not in d: continue
    t = open(d['arquivo_local'], encoding='utf8').read()
    for m in re.finditer(r'href="([^"]+\.pdf)"', t):
        p = m[1]
        if 'organograma' in p: continue
        pdfs.setdefault(p, ('pauta_linkada', u.rstrip('/').split('/')[-1]))
pdf_res = []
def testa_pdf(it):
    u, (k, r) = it; code, b = curl(u)
    return dict(url=u, tipo=k, ref=r, http=code, estado='OK' if b[:4] == b'%PDF' else estado(code, b) if estado(code, b) != 'OK' else 'NAO_PDF', bytes=len(b))
with ThreadPoolExecutor(8) as ex: pdf_res = list(ex.map(testa_pdf, pdfs.items()))
inv = {'gerado_em': time.strftime('%Y-%m-%d'), 'listagem_noticias': {'pasta': pastas['periodo-eleitoral'], 'paginas': paginas, 'total_links_unicos': len(noticias),
        'contador_oficial': None, 'nota': 'listagem HTML Plone sem contador (items_total); a ANS nao expoe ++api++ (404). Prova de completude = paginar ate pagina sem novos links'},
       'noticias_dicol_na_listagem': [{'url': u, 'titulo': t} for u, t in dicol.items()],
       'paginas': sorted(paginas_ok.values(), key=lambda d: d['url']), 'pdfs': sorted(pdf_res, key=lambda d: d['url'])}
json.dump(inv, open(out, 'w'), ensure_ascii=False, indent=1)
from collections import Counter
print('listagem: links', len(noticias), 'dicol', len(dicol), '| paginas', Counter(d['estado'] for d in paginas_ok.values()), '| pdfs', Counter(d['estado'] for d in pdf_res))
