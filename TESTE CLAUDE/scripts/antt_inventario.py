#!/usr/bin/env python3
"""ANTT: enumera TODAS as reunioes da listagem paginada e filtra 2026. Saida: antt_inventario.json
Uso: python3 -I antt_inventario.py saida.json"""
import re, sys, json, subprocess, html
BASE = ('https://portal.antt.gov.br/web/guest/reunioes-da-diretoria?p_p_id=com_liferay_asset_publisher_web_portlet_AssetPublisherPortlet_INSTANCE_DlACjCuEcGUm'
        '&p_p_lifecycle=0&p_p_state=normal&p_p_mode=view&_com_liferay_asset_publisher_web_portlet_AssetPublisherPortlet_INSTANCE_DlACjCuEcGUm_delta=20'
        '&p_r_p_resetCur=false&_com_liferay_asset_publisher_web_portlet_AssetPublisherPortlet_INSTANCE_DlACjCuEcGUm_cur=')
def get(u):
    for _ in range(3):
        r = subprocess.run(['curl', '-sS', '-m', '60', '-L', u], capture_output=True)
        if r.returncode == 0 and len(r.stdout) > 2000: return r.stdout.decode('utf8', 'replace')
    return ''
def cards(t):
    for c in t.split('<div class="line">'):
        m = re.search(r'<h4>([^<]+)</h4>', c); d = re.findall(r'<p>(\d\d/\d\d/\d{4})<p>', c)
        pub = re.search(r'Data Publica[^:]*:\s*(\d\d/\d\d/\d{4})', c); h = re.search(r'href="(/reuniao/[^"#]+)"', c)
        if m and d and h:
            tipo = re.search(r'<h6>([^<]+)</h6>', c)
            yield {'titulo': html.unescape(m[1]).strip(), 'tipo': html.unescape(tipo[1]).strip() if tipo else '', 'data': d[0], 'publicacao': pub[1] if pub else '',
                   'url': 'https://portal.antt.gov.br' + h[1], 'abas': sorted(set(re.findall(r'title="(Pauta|Ata|Voto|Video)"', c)))}
out, vistos, abaixo = [], set(), 0
for cur in range(1, 200):
    t = get(BASE + str(cur)); cs = list(cards(t))
    if not cs: print('pagina vazia', cur); break
    novos = [c for c in cs if c['url'] not in vistos]
    for c in novos: vistos.add(c['url']); out.append(c)
    anos = [int(c['data'][-4:]) for c in cs]
    print(cur, len(cs), min(anos), max(anos), flush=True)
    if max(anos) < 2026: abaixo += 1
    if abaixo >= 2: break
    if not novos: break
json.dump(out, open(sys.argv[1], 'w'), ensure_ascii=False, indent=1)
a26 = [c for c in out if c['data'].endswith('2026')]
print('total listadas', len(out), '2026:', len(a26))
