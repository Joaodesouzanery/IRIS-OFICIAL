"""ANAC: inventario 2026. Sessao unica de Chromium (anac_fetch.cjs) passa o desafio JS do F5; captcha nunca e resolvido.
uso: python3 -I scripts/anac_inventario.py anac_inventario.json fonte/anac"""
import sys, os, json, re, subprocess, html
OUT, DIR = sys.argv[1], sys.argv[2]
B = 'https://www.gov.br/anac/pt-br/acesso-a-informacao/institucional/reunioes-da-diretoria'
APEX = {  # indices oficiais de 2026 (os pastas /2026 do gov.br dao 404; o gov.br so tem ate set/out-2025)
 'presenciais_2026': 'https://departamental.anac.gov.br/menu/f?p=107101:137',
 'eletronicas_2026': 'https://santosdumont.anac.gov.br/menu/f?p=107101:138:0:::138:P138_ANO:2026',
 'calendario_portaria_18366': 'https://www.anac.gov.br/assuntos/legislacao/legislacao-1/portarias/2025/portaria-18366'}
def ordn(n): return f'{n}a'
lst = []
lst += [(f'{B}/reunioes-deliberativas/2026', 'g_pres2026.html'), (f'{B}/reunioes-deliberativas-eletronicas/2026', 'g_ele2026.html'),
        (f'{B}/reunioes-deliberativas', 'g_pres.html'), (f'{B}/reunioes-deliberativas-eletronicas', 'g_ele.html'),
        (f'{B}/calendarios-das-reunioes/calendario-de-reunioes', 'g_cal.html'), (f'{B}/diretoria-colegiada', 'g_dir.html'),
        (f'{B}/reunioes-da-diretoria-colegiada', 'g_rdc.html')]
lst += [(u, f'apex_{k}.html') for k, u in APEX.items()]
for n in range(1, 61):
    lst.append((f'{B}/reunioes-deliberativas/2026/{ordn(n)}-reuniao-deliberativa-da-diretoria-colegiada', f'p2026_{n}.html'))
    lst.append((f'{B}/reunioes-deliberativas-eletronicas/2026/{ordn(n)}-reuniao-deliberativa-eletronica-da-diretoria-colegiada', f'e2026_{n}.html'))
os.makedirs(DIR, exist_ok=True)
lf = os.path.join(DIR, '_lista.tsv')
open(lf, 'w').write('\n'.join(f'{u}\t{n}' for u, n in lst) + '\n')
subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'anac_fetch.cjs'), DIR, lf], check=False, stdout=subprocess.DEVNULL)
log = {e['url']: e for e in json.load(open(os.path.join(DIR, '_log.json')))} if os.path.exists(os.path.join(DIR, '_log.json')) else {}
def st(u, n):
    p = os.path.join(DIR, n)
    if os.path.exists(p) and os.path.getsize(p) > 0: return 'ok'
    e = log.get(u, {}); return 'http%s' % e.get('http') if e.get('http') else 'bloqueado'
fontes = [{'url': u, 'arquivo': n, 'status': st(u, n)} for u, n in lst]
reunioes = []
for f in fontes:
    if f['status'] == 'ok' and re.match(r'(p|e)2026_', f['arquivo']):
        t = html.unescape(re.sub(r'<[^>]+>', ' ', open(os.path.join(DIR, f['arquivo']), errors='replace').read()))
        m = re.search(r'(\d+)ª Reunião Deliberativa( Eletrônica)?[^\n]{0,80}?Realização:\s*([^\n]{5,40})', re.sub(r'\s+', ' ', t))
        reunioes.append({'url': f['url'], 'arquivo': f['arquivo'], 'tipo': 'eletronica' if f['arquivo'].startswith('e') else 'presencial', 'n': int(f['arquivo'].split('_')[1].split('.')[0]), 'realizacao': m.group(3) if m else ''})
apex_ok = [f for f in fontes if f['arquivo'].startswith('apex_') and f['status'] == 'ok']
inv = {'ano': 2026, 'fontes': fontes, 'reunioes_2026_gov_br': reunioes,
       'contadores': {'oficial_apex_presenciais': None, 'oficial_apex_eletronicas': None, 'calendario_portaria_18366': None,
                      'listadas_gov_br_2026': len(reunioes)},
       'acesso': {'govbr_html_via_chromium': 'ok', 'govbr_pastas_2026': 'http404', 'apex_2026': 'ok' if apex_ok else 'bloqueado pelo egress (403 CONNECT)'}}
json.dump(inv, open(OUT, 'w'), ensure_ascii=False, indent=1)
print('fontes', len(fontes), 'ok', sum(f['status'] == 'ok' for f in fontes), 'reunioes 2026 no gov.br', len(reunioes), 'apex ok', len(apex_ok))
