"""ANP: inventario das reunioes de Diretoria 2026 (pagina + calendario + pasta paginada) + download das atas/pautas com sha256 e retry
(o proxy reseta ~50% das conexoes). Uso: python3 -I scripts/anp_baixar.py anp_inventario.json manifesto_anp.json fonte/anp [texto_anp]
Contadores INDEPENDENTES gravados no inventario (para o QA do parser):
  (1) calendario da pagina (blocos 'Reuniao de Diretoria n 1.NNN' / 'Extraordinaria n NN' com 'Ata (publicacao em ...)');
  (2) links .pdf da pagina; (3) listagem PAGINADA da pasta arquivos-rd-2026/view (20 por pagina: segue b_start ate acabar);
  (4) tentativa da API Volto/Plone (items_total) — registrada com o status HTTP (hoje 401/404 sem permissao)."""
import re, sys, json, hashlib, subprocess, time, os, html as H
BASE = 'https://www.gov.br'
PAG = BASE + '/anp/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/pautas-atas-e-calendario-de-reunioes-da-diretoria-colegiada/2026'
PASTA = PAG + '/arquivos-rd-2026'
inv_out, man_out, dest = sys.argv[1:4]
txt_dir = sys.argv[4] if len(sys.argv) > 4 else 'texto_anp'
os.makedirs(dest, exist_ok=True); os.makedirs(txt_dir, exist_ok=True)

def get(url, out=None, tries=8, hdr=None, want_code=False):
    for i in range(tries):
        a = ['curl', '-sS', '-m', '90', '-A', 'Mozilla/5.0', '-L', '-w', '\n%{http_code}']
        for k in (hdr or []): a += ['-H', k]
        if out: a += ['-o', out]
        a += [url]
        r = subprocess.run(a, capture_output=True)
        if r.returncode == 0:
            code = r.stdout.decode().rsplit('\n', 1)[-1].strip()
            body = r.stdout[:r.stdout.rfind(b'\n')]
            if want_code: return code, body.decode('utf-8', 'ignore')
            if code == '200': return True if out else body.decode('utf-8', 'ignore')
            if code in ('404', '401', '403'): break
        time.sleep(2 * (i + 1))
    if want_code: return 'ERR', ''
    return False if out else ''

def texto(h):
    b = re.sub(r'<script.*?</script>|<style.*?</style>', '', h, flags=re.S)
    t = H.unescape(re.sub(r'<[^>]+>', '\n', b)).replace('\xa0', ' '); t = re.sub(r'[ \t]+', ' ', t)
    return re.sub(r'\n\s*\n+', '\n', t)

html = get(PAG)
assert html, 'pagina nao baixada'
# (2) links da pagina
links = sorted(set(re.findall(r'href="([^"]*?/arquivos-rd-2026/[^"]*?\.pdf)[^"]*"', html)))
# (1) calendario
t = texto(html)
ini = t.find('Reunião de Diretoria nº 1.197')
cal_txt = t[ini:t.find('Compartilhe', t.find('Reunião de Diretoria nº 1.175'))]
partes = re.split(r'\n- ?\n?(?=(?:Retomada da )?Reuni[ãa]o de Diretoria)', '\n- ' + cal_txt.strip())
MES = {'janeiro': 1, 'fevereiro': 2, 'março': 3, 'abril': 4, 'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12}
cal = []
for p in partes:
    p = p.strip()
    m = re.match(r'-?\s*(Retomada da )?Reuni[ãa]o de Diretoria (Extraordin[áa]ria )?n[ºo] ([\d.]+)\s*:?\s*(\d+)\s*(?:º)?\s*de ([a-zç]+)', p)
    if not m: continue
    num = int(m[3].replace('.', ''))
    tag = ('EXT%d' % num) if m[2] else ('RD%d' % num)
    if m[1]: tag += '-retomada'
    ata = re.search(r'\bAta\s*\(publica[çc][ãa]o em ([\d/]+)\)', p)
    obs = ' '.join(re.findall(r'(?:Aviso|Observação|Observa[çc][ãa]o):?[^\n]*', p))[:300]
    cal.append({'tag': tag, 'numero': num, 'extraordinaria': bool(m[2]), 'retomada': bool(m[1]), 'dia': int(m[4]), 'mes': MES[m[5]], 'data': '2026-%02d-%02d' % (MES[m[5]], int(m[4])),
                'ata_publicada_em': ata[1] if ata else None, 'tem_pauta': bool(re.search(r'\bPauta\b', p)), 'obs': obs})
# (3) pasta paginada
pasta, paginas, bs = set(), 0, 0
while True:
    code, ph = get(PASTA + '/view' + (f'?b_start:int={bs}' if bs else ''), want_code=True)
    if code != '200': break
    paginas += 1
    arq = set(re.findall(r'href="[^"]*?/arquivos-rd-2026/([^"/]+?\.pdf)/view"', ph))
    pasta |= arq
    if not re.search(r'b_start:int=%d\b' % (bs + 20), ph): break
    bs += 20
# (4) API Volto
api = {}
for nome, u in [('volto', BASE + '/anp/++api++/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/pautas-atas-e-calendario-de-reunioes-da-diretoria-colegiada/2026?b_start=0&b_size=3000'),
                ('restapi_pasta', PASTA + '?b_start=0&b_size=3000')]:
    c, b = get(u, want_code=True, hdr=['Accept: application/json'], tries=4)
    mt = re.search(r'"items_total":\s*(\d+)', b)
    api[nome] = {'url': u, 'http': c, 'items_total': int(mt[1]) if mt else None, 'msg': b[:120].replace('\n', ' ') if not mt else ''}
inv = {'pagina': PAG, 'calendario': cal, 'links_pagina': links, 'pasta_arquivos': sorted(pasta), 'pasta_paginas_lidas': paginas, 'api': api}
json.dump(inv, open(inv_out, 'w'), ensure_ascii=False, indent=1)

# download: atas (todas) + pautas
man = {}
for href in links:
    nome = href.rsplit('/', 1)[-1]
    tipo = 'ata' if nome.startswith('ata') else 'pauta'
    f = f'{dest}/{nome}'
    ok = os.path.exists(f) and os.path.getsize(f) > 1000 and open(f, 'rb').read(4) == b'%PDF'
    if not ok:
        url = href if href.startswith('http') else BASE + href
        ok = get(url + '/@@download/file', f) and os.path.exists(f) and open(f, 'rb').read(4) == b'%PDF'
    sha = hashlib.sha256(open(f, 'rb').read()).hexdigest() if ok else None
    m = re.search(r'extraordinaria-?(\d+)|(?:ata|pauta)-(\d{4})|extraordinaria(\d+)|pautardcextraordinaria(\d+)', nome)
    tag = None
    if m:
        if m[1] or m[3] or m[4]: tag = 'EXT' + str(int(m[1] or m[3] or m[4]))
        else: tag = 'RD' + m[2]
    if nome.startswith('pautardcextraordinaria'): tag = 'EXT69'
    txt = None
    if ok and tipo == 'ata':
        txt = f'{txt_dir}/{nome[:-4]}.txt'
        subprocess.run(['pdftotext', '-layout', f, txt], check=False)
    man[nome] = {'tag': tag, 'tipo': tipo, 'url': href, 'arquivo': f if ok else None, 'sha256': sha, 'ok': bool(ok), 'texto': txt}
json.dump(man, open(man_out, 'w'), ensure_ascii=False, indent=1)
atas = [v for v in man.values() if v['tipo'] == 'ata']
print('calendario', len(cal), 'links', len(links), 'pasta', len(pasta), f'({paginas} paginas)', 'API', {k: (v['http'], v['items_total']) for k, v in api.items()},
      '| atas', len(atas), 'ok', sum(v['ok'] for v in atas), '| pautas', len(man) - len(atas), 'ok', sum(v['ok'] for v in man.values() if v['tipo'] == 'pauta'))
