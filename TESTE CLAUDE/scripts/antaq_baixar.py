"""ANTAQ: inventario + download das atas 2026 com manifesto sha256 e retry (proxy reseta).
Fontes: (1) gov.br (paginas HTML, 2 atas ROD em PDF, calendarios) via curl; (2) acervo Sophia (atas Externa/Interna) via Chromium
(Cloudflare barra curl) -> scripts/antaq_sophia.cjs. SEI nao e usado (login/captcha; ver pendencias).
Uso: python3 -I scripts/antaq_baixar.py antaq_inventario.json manifesto_antaq.json fonte/antaq"""
import re, sys, json, hashlib, subprocess, time, os, html, datetime
from concurrent.futures import ThreadPoolExecutor
inv_out, man_out, dest = sys.argv[1:4]
GOV = 'https://www.gov.br/antaq/pt-br/acesso-a-informacao/institucional/reunioes-deliberativas'
NODE = os.environ.get('NODE', 'node'); CJS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'antaq_sophia.cjs')
for d in ('govbr', 'sophia', 'sophia/pdf'): os.makedirs(f'{dest}/{d}', exist_ok=True)
def get(url, out=None, tries=6, hdr=None):
    for i in range(tries):
        a = ['curl', '-sS', '-m', '90', '-A', 'Mozilla/5.0', '-L', '-w', '%{http_code}'] + sum([['-H', h] for h in (hdr or [])], []) + ['-o', out or '-', url]
        r = subprocess.run(a, capture_output=True); code = r.stdout[-3:].decode() if out else None
        if out and code == '200': return True
        if not out and r.returncode == 0: return r.stdout.decode('utf-8', 'ignore')[:-3] if r.stdout[-3:].isdigit() else r.stdout.decode('utf-8', 'ignore')
        if out and code == '404': return False
        time.sleep(2 * (i + 1))
    return False if out else ''
def sha(f): return hashlib.sha256(open(f, 'rb').read()).hexdigest()
inv = {'gerado_em': datetime.date.today().isoformat(), 'govbr': {}, 'sophia': {}, 'virtuais': {}}
# ---- 1. paginas gov.br (com barra final)
for k, p in (('raiz', ''), ('atas_pautas', 'atas-e-pautas-das-reunioes/'), ('virtuais', 'resultado-das-reunioes-virtuais-da-diretoria-1/')):
    f = f'{dest}/govbr/{k}.html'
    for t in range(5):
        if get(f'{GOV}/{p}', f) and os.path.getsize(f) > 20000: break
    inv['govbr'][k] = {'url': f'{GOV}/{p}', 'arquivo': f, 'bytes': os.path.getsize(f)}
# contador oficial via API Volto (tentativa; registrar o resultado, qualquer que seja)
api = {}
for p in ('atas-e-pautas-das-reunioes', 'resultado-das-reunioes-virtuais-da-diretoria-1', ''):
    u = f'https://www.gov.br/++api++/antaq/pt-br/acesso-a-informacao/institucional/reunioes-deliberativas/{p}?b_start=0&b_size=3000'
    r = subprocess.run(['curl', '-sS', '-m', '60', '-A', 'Mozilla/5.0', '-H', 'Accept: application/json', '-w', '\n%{http_code}', u], capture_output=True).stdout.decode('utf8', 'ignore')
    corpo, _, code = r.rpartition('\n'); items_total = None
    try: items_total = json.loads(corpo).get('items_total')
    except Exception: pass
    api[p or '(pasta)'] = {'url': u, 'http': code, 'items_total': items_total}
inv['govbr']['api_volto'] = api
# links de PDF publicados na pagina de atas/pautas
ap = open(f'{dest}/govbr/atas_pautas.html', encoding='utf8').read()
inv['govbr']['links_pagina_atas'] = sorted(set(re.findall(r'href="(https://www\.gov\.br/antaq/pt-br/acesso-a-informacao/institucional/reunioes-deliberativas/[^"]+?\.pdf)"', ap)))
inv['govbr']['links_sophia_pagina'] = [{'texto': re.sub(r'<[^>]+>|\s+', ' ', html.unescape(t)).strip(), 'url': html.unescape(u)} for u, t in re.findall(r'href="(https://sophia\.antaq\.gov\.br/[^"]+)"[^>]*>(.*?)</a>', ap, re.S) if 'Reuni' in t]
# sonda de nomes de arquivo (a pasta nao expoe listagem: a API Volto nao existe neste site) -> guarda so o que responde 200
def sonda(n):
    for _ in range(3):
        r = subprocess.run(['curl', '-sS', '-m', '40', '-A', 'Mozilla/5.0', '-o', '/dev/null', '-w', '%{http_code} %{content_type}', f'{GOV}/{n}'], capture_output=True)
        if r.returncode == 0: return n, r.stdout.decode()
    return n, 'ERR'
nomes = [f'AtaROD{k}.pdf' for k in range(595, 626)] + [f'PautaROD{k}.pdf' for k in range(595, 626)] + [f'AtaRED{k}.pdf' for k in range(28, 45)] + [f'Pautade{k}RED.pdf' for k in range(28, 45)] + ['Calendrio12026vs2.pdf', 'Calendrio2semestre2026.pdf']
with ThreadPoolExecutor(8) as ex: res = dict(ex.map(sonda, nomes))
inv['govbr']['sonda_arquivos'] = {'testados': len(nomes), 'existem': sorted(n for n, r in res.items() if r.startswith('200'))}
man = {}
for n in inv['govbr']['sonda_arquivos']['existem']:
    f = f'{dest}/govbr/{n}'
    ok = os.path.exists(f) and open(f, 'rb').read(4) == b'%PDF' or (get(f'{GOV}/{n}', f) and open(f, 'rb').read(4) == b'%PDF')
    man['govbr:' + n] = {'fonte': 'gov.br', 'url': f'{GOV}/{n}', 'arquivo': f if ok else None, 'sha256': sha(f) if ok else None, 'ok': bool(ok)}
# ---- 2. Sophia: atas de 2026 e registros de Acordao (contador independente)
def sophia(termo, html_out, codigos=None):
    for t in range(4):
        a = [NODE, CJS, termo, '2026', html_out] + ([f'{dest}/sophia/pdf', ','.join(codigos)] if codigos else [])
        r = subprocess.run(a, capture_output=True, timeout=1500)
        if os.path.exists(html_out) and os.path.getsize(html_out) > 100000 and b'520: Web server' not in open(html_out, 'rb').read(4000): return True
        time.sleep(15)
    return False
def parse_sophia(path):
    h = open(path, encoding='utf8').read(); txt = html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', re.sub(r'<script.*?</script>|<style.*?</style>', '', h, flags=re.S))))
    decl = (re.search(r'(\d+) registros encontrados', txt) or [None, None])[1]
    itens, prev, seen = {}, 0, set()
    for m in re.finditer(r"selecionarRegistroMinhaSelecao\((\d+), '([^']*)'", h):
        if m[1] in seen: continue
        seen.add(m[1]); seg = h[prev:m.start()]; prev = m.start()
        arqs = {c: html.unescape(t) for c, t in re.findall(r'Download\?codigoArquivo=(\d+)&amp;tipoMidia=0" class="[^"]*"[^>]*onclick="downloadArquivo\(\{&quot;Codigo&quot;:\d+,&quot;Titulo&quot;:&quot;([^&]*)&quot;', seg)}
        st = html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', seg)))
        ass = re.findall(r'Assinatura: (\d\d/\d\d/\d{4})', st); pub = re.findall(r'Publica..o: (\d\d/\d\d/\d{4})', st); proc = re.findall(r'Processos?:? ?(\d{5}\.\d{6}/\d{4}-\d\d)', st)
        itens[m[1]] = {'id': int(m[1]), 'titulo': html.unescape(m[2]), 'assinatura': ass[-1] if ass else None, 'publicacao': pub[-1] if pub else None, 'processo': proc[-1] if proc else None, 'arquivos': [{'codigo': int(c), 'titulo': t} for c, t in arqs.items()],
                         'url': f'https://sophia.antaq.gov.br/Terminal/acervo/detalhe/{m[1]}'}
    return decl, itens
p_at = f'{dest}/sophia/busca_atas.html'
if not sophia('Ata de Reunião', p_at): sys.exit('Sophia indisponivel (busca de atas)')
decl, it = parse_sophia(p_at)
atas = {}
for i in it.values():
    m = re.match(r'Ata de Reuni[ãa]o (Ordin[áa]ria|Extraordin[áa]ria) da Diretoria (\d+)/2026$', i['titulo'])
    if m: atas[('ROD' if m[1].startswith('Ordin') else 'RED') + m[2]] = i
inv['sophia']['atas'] = dict(sorted(atas.items())); inv['sophia']['atas_contador_declarado'] = int(decl); inv['sophia']['atas_registros_carregados'] = len(it)
inv['sophia']['atas_outros_registros'] = sorted(i['titulo'] for i in it.values() if i['titulo'] not in {a['titulo'] for a in atas.values()})
cods = [str(a['codigo']) for i in atas.values() for a in i['arquivos']]
if not sophia('Ata de Reunião', p_at, cods): sys.exit('Sophia: falha no download')
for tag, i in atas.items():
    for a in i['arquivos']:
        f = f'{dest}/sophia/pdf/{a["codigo"]}.pdf'; ok = os.path.exists(f) and os.path.getsize(f) > 1000 and open(f, 'rb').read(4) == b'%PDF'
        man[f'sophia:{tag}:{a["codigo"]}'] = {'fonte': 'sophia', 'reuniao': tag, 'titulo': a['titulo'], 'url': i['url'], 'download': f'https://sophia.antaq.gov.br/Terminal/Busca/Download?codigoArquivo={a["codigo"]}&tipoMidia=0', 'arquivo': f if ok else None, 'sha256': sha(f) if ok else None, 'ok': bool(ok)}
# pautas (denominador independente: todo processo pautado deve aparecer na ata como acordao, retirada ou vista)
p_pa = f'{dest}/sophia/busca_pautas.html'
if sophia('Pauta de Reunião', p_pa):
    decl_p, it_p = parse_sophia(p_pa); pautas = {}
    for i in it_p.values():
        m = re.match(r'Pauta de Reuni[ãa]o (Ordin[áa]ria|Extraordin[áa]ria) da Diretoria (\d+)/2026$', i['titulo'])
        if m: pautas[('ROD' if m[1].startswith('Ordin') else 'RED') + m[2]] = i
    inv['sophia']['pautas'] = dict(sorted(pautas.items())); inv['sophia']['pautas_contador_declarado'] = int(decl_p)
    cods_p = [str(a['codigo']) for i in pautas.values() for a in i['arquivos']]
    if sophia('Pauta de Reunião', p_pa, cods_p):
        for tag, i in pautas.items():
            for a in i['arquivos']:
                f = f'{dest}/sophia/pdf/{a["codigo"]}.pdf'; ok = os.path.exists(f) and os.path.getsize(f) > 1000 and open(f, 'rb').read(4) == b'%PDF'
                man[f'sophia_pauta:{tag}:{a["codigo"]}'] = {'fonte': 'sophia', 'reuniao': tag, 'titulo': a['titulo'], 'url': i['url'], 'download': f'https://sophia.antaq.gov.br/Terminal/Busca/Download?codigoArquivo={a["codigo"]}&tipoMidia=0', 'arquivo': f if ok else None, 'sha256': sha(f) if ok else None, 'ok': bool(ok)}
else: print('AVISO: busca de pautas no Sophia falhou')
p_ac = f'{dest}/sophia/busca_acordaos.html'
if os.path.exists(p_ac) and os.path.getsize(p_ac) > 1000000: pass
elif not sophia('Acórdão', p_ac): print('AVISO: busca de acordaos no Sophia falhou')
if os.path.exists(p_ac):
    d2, it2 = parse_sophia(p_ac); ac = {}
    for i in it2.values():
        m = re.match(r'Acórdão (\d+)/2026$', i['titulo'])
        if m: ac[int(m[1])] = {'id': i['id'], 'url': i['url'], 'assinatura': i['assinatura'], 'publicacao': i['publicacao'], 'arquivos': i['arquivos']}
    inv['sophia']['acordaos'] = {str(k): v for k, v in sorted(ac.items())}; inv['sophia']['acordaos_contador_declarado_1a_pagina'] = int(d2) if d2 else None
# ---- 3. virtuais (gov.br): lista de reunioes virtuais publicadas
vh = open(f'{dest}/govbr/virtuais.html', encoding='utf8').read()
inv['virtuais'] = [{'titulo': html.unescape(t).strip()} for t in re.findall(r'<a class="toggle[^"]*" href="[^"]*">([^<]*)</a>', vh)]
man['govbr:virtuais.html'] = {'fonte': 'gov.br', 'url': inv['govbr']['virtuais']['url'], 'arquivo': inv['govbr']['virtuais']['arquivo'], 'sha256': sha(inv['govbr']['virtuais']['arquivo']), 'ok': True}
json.dump(inv, open(inv_out, 'w'), indent=1, ensure_ascii=False); json.dump(man, open(man_out, 'w'), indent=1, ensure_ascii=False)
print('atas Sophia', len(atas), 'arquivos ok', sum(v['ok'] for v in man.values()), '/', len(man), '| acordaos Sophia', len(inv['sophia'].get('acordaos', {})), '| virtuais', len(inv['virtuais']))
