"""ANEEL: coleta das fontes de 2026 -> fonte/aneel/, manifesto_aneel.json, aneel_inventario.json.
Uso: python3 -I scripts/aneel_baixar.py        (rodar na pasta TESTE CLAUDE; precisa de curl, node+Playwright/Chromium)

O que e coletado (e o que NAO abre):
  - dadosabertos.aneel.gov.br (CKAN): datasets 'pautas-e-atas-das-reunioes-publicas-da-diretoria' (CSV com TODAS as decisoes de ata,
    2017-2026, texto da decisao + relator + resultado) e 'reunioes-publicas-da-diretoria' (CSV de reunioes). Sao a listagem COMPLETA (nao paginada);
    a contagem e conferida por uma 2a fonte independente (API datastore_search do mesmo CKAN, por data de reuniao).
  - gov.br/aneel: reunioes-publicas, pautas-e-atas, calendario (tabela oficial da Portaria 7.014/2025), distribuicao-de-processos, informativo.
  - www2.aneel.gov.br (listagem noticias_area idAreaNoticia=425, ata_diretoria/ata.cfm, cedoc) e reuniaodiretoria.aneel.gov.br: tentados via Chromium
    (aneel_chromium.cjs, UMA sessao, com espera do desafio JS); o resultado de cada tentativa fica em aneel_inventario.json['tentativas_chromium'].
    Se a fonte bloqueia (Cloudflare 'Sorry, you have been blocked' / reset de conexao), vira pendencia 'bloqueado pela fonte' (nao se resolve captcha)."""
import os, sys, re, json, csv, hashlib, subprocess, datetime, html, time, urllib.parse
HOJE = datetime.date.today().isoformat()
D = 'fonte/aneel'; os.makedirs(D, exist_ok=True)
man = {}
def sha(p): return hashlib.sha256(open(p, 'rb').read()).hexdigest()
def curl(url, saida, tent=4, mt=150):
    st = 0
    for t in range(tent):
        r = subprocess.run(['curl', '-sS', '-L', '-m', str(mt), '-A', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36', '-o', saida, '-w', '%{http_code}', url], capture_output=True)
        st = int(r.stdout.decode() or 0) if r.stdout.decode().isdigit() else 0
        if st == 200 and os.path.getsize(saida) > 500: return st, ''
        time.sleep(2 * (t + 1))
    return st, r.stderr.decode()[:160].strip()
def reg(chave, url, arq, obs=''):
    st, err = curl(url, arq)
    ok = st == 200 and os.path.exists(arq) and os.path.getsize(arq) > 500
    man[chave] = {'fonte': urllib.parse.urlparse(url).netloc, 'url': url, 'arquivo': arq if ok else None, 'http': st, 'ok': ok, 'sha256': sha(arq) if ok else None, 'bytes': os.path.getsize(arq) if ok else 0, 'erro': '' if ok else (err or f'HTTP {st}'), 'obs': obs}
    print(('ok  ' if ok else 'FALHA'), chave, st)
    return ok

# ---------------------------------------------------------------- dados abertos (CKAN)
CK = 'https://dadosabertos.aneel.gov.br'
for pk in ('pautas-e-atas-das-reunioes-publicas-da-diretoria', 'reunioes-publicas-da-diretoria'):
    reg(f'ckan:{pk}', f'{CK}/api/3/action/package_show?id={pk}', f'{D}/pkg_{pk}.json')
pa = json.load(open(f'{D}/pkg_pautas-e-atas-das-reunioes-publicas-da-diretoria.json'))['result']
rp = json.load(open(f'{D}/pkg_reunioes-publicas-da-diretoria.json'))['result']
csv_pa = next(r for r in pa['resources'] if r['format'] == 'CSV'); csv_rp = next(r for r in rp['resources'] if r['format'] == 'CSV')
reg('csv:pautas_atas', csv_pa['url'], f'{D}/pautas_atas.csv', f"modificado {csv_pa.get('last_modified')}; resource_id {csv_pa['id']}")
reg('csv:reunioes', csv_rp['url'], f'{D}/reunioes.csv', f"modificado {csv_rp.get('last_modified')}; resource_id {csv_rp['id']}")
for r in pa['resources'] + rp['resources']:
    if r['format'] == 'PDF': reg('dicionario:' + r['name'][:40], r['url'], f"{D}/dic_{r['id'][:8]}.pdf", 'dicionario de dados')

# ---------------------------------------------------------------- gov.br/aneel
GOV = 'https://www.gov.br/aneel/pt-br/reunioes-publicas'
reg('govbr:reunioes-publicas', GOV, f'{D}/reunioes-publicas.html')
for p in ('pautas-e-atas', 'calendario', 'distribuicao-de-processos', 'informativo-aneel-de-deliberacoes-da-diretoria', 'videos-das-reunioes', 'decisoes-monocraticas', 'sustentacao-oral'):
    reg(f'govbr:{p}', f'{GOV}/{p}', f'{D}/rp_{p}.html')

# calendario oficial (tabela da pagina; Portaria 7.014/2025)
def tabela_calendario():
    t = open(f'{D}/rp_calendario.html', encoding='utf8').read()
    i = t.find('<table'); tb = t[i:t.find('</table>', i)]
    MES = {'Janeiro': 1, 'Fevereiro': 2, 'Março': 3, 'Abril': 4, 'Maio': 5, 'Junho': 6, 'Julho': 7, 'Agosto': 8, 'Setembro': 9, 'Outubro': 10, 'Novembro': 11, 'Dezembro': 12}
    rpo, cir = [], []
    for tr in re.findall(r'<tr.*?</tr>', tb, re.S):
        c = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', x))).strip() for x in re.findall(r'<t[dh].*?</t[dh]>', tr, re.S)]
        if len(c) < 3 or c[0] not in MES: continue
        for col, dst in ((1, rpo), (2, cir)):
            for d in re.findall(r'(\d+)', c[col].replace('1º', '1')): dst.append(f'2026-{MES[c[0]]:02d}-{int(d):02d}')
    return sorted(rpo), sorted(cir)
cal_rpo, cal_cir = tabela_calendario()
print('calendario oficial: RPO', len(cal_rpo), 'circuitos', len(cal_cir))

# ---------------------------------------------------------------- conferencia independente da listagem: datastore_search por data
rows = list(csv.DictReader(open(f'{D}/pautas_atas.csv', encoding='utf8'), delimiter=';'))
r26 = [r for r in rows if r['DatReuniao'].startswith('2026')]
por_data = {}
for r in r26: por_data[r['DatReuniao']] = por_data.get(r['DatReuniao'], 0) + 1
ds = {}
for d in sorted(por_data):
    q = urllib.parse.urlencode({'resource_id': csv_pa['id'], 'limit': 0, 'filters': json.dumps({'DatReuniao': d})})
    arq = f'{D}/_ds_tmp.json'
    st, _ = curl(f'{CK}/api/3/action/datastore_search?{q}', arq, tent=3, mt=60)
    ds[d] = json.load(open(arq))['result']['total'] if st == 200 else None
if os.path.exists(f'{D}/_ds_tmp.json'): os.remove(f'{D}/_ds_tmp.json')
q = urllib.parse.urlencode({'resource_id': csv_pa['id'], 'limit': 0}); curl(f'{CK}/api/3/action/datastore_search?{q}', f'{D}/_ds_tot.json', tent=3, mt=60)
ds_total = json.load(open(f'{D}/_ds_tot.json'))['result']['total']; os.remove(f'{D}/_ds_tot.json')

# ---------------------------------------------------------------- Chromium (UMA sessao por modo): www2 / reuniaodiretoria / biblioteca / sei
ALVOS = ['https://www2.aneel.gov.br/aplicacoes_liferay/noticias_area/?idAreaNoticia=425',
         'https://www2.aneel.gov.br/aplicacoes_liferay/ata_diretoria/ata.cfm',
         'https://www2.aneel.gov.br/aplicacoes/noticias_area/dsp_listarProcessosCancelados.cfm?idarea=424&idPerfil=3&idAreaNoticia=424&c=1',
         'https://www2.aneel.gov.br/cedoc/prt20257014.pdf',
         'https://reuniaodiretoria.aneel.gov.br/',
         'https://biblioteca.aneel.gov.br/acervo/detalhe/257019',
         'https://sei.aneel.gov.br/sei/publicacoes/controlador_publicacoes.php?acao=publicacao_pesquisar&acao_origem=publicacao_pesquisar&id_orgao_publicacao=0']
tent = []
for modo, cmd, env in (('headless', ['node', 'scripts/aneel_chromium.cjs', f'{D}/chromium_headless'] + ALVOS, {}),
                       ('headed(xvfb)', ['xvfb-run', '-a', 'node', 'scripts/aneel_chromium.cjs', f'{D}/chromium_headed'] + ALVOS, {'ANEEL_HEADED': '1'})):
    try:
        subprocess.run(cmd, capture_output=True, timeout=900, env={**os.environ, **env})
        lg = json.load(open(f"{D}/chromium_{'headless' if modo == 'headless' else 'headed'}/_log.json"))
    except Exception as e:
        lg = [{'url': u, 'modo': modo, 'erro': 'falha ao executar: ' + str(e)[:100]} for u in ALVOS]
    tent += lg
for t in tent:
    t['aberto'] = bool(t.get('status') == 200 and not t.get('bloqueio') and t.get('bytes', 0) > 3000 and 'Attention' not in t.get('title', '') and 'momento' not in t.get('title', ''))
    man['chromium:' + t['modo'] + ':' + t['url']] = {'fonte': urllib.parse.urlparse(t['url']).netloc, 'url': t['url'], 'arquivo': None, 'ok': t['aberto'], 'http': t.get('status'),
                                                     'erro': '' if t['aberto'] else (t.get('bloqueio') or t.get('erro') or f"status {t.get('status')} / titulo '{t.get('title')}'"), 'obs': 'Chromium ' + t['modo']}
# curl simples nas mesmas URLs (prova do bloqueio sem navegador)
for u in ALVOS:
    arq = f'{D}/_t.html'
    st, err = curl(u, arq, tent=2, mt=40)
    man['curl:' + u] = {'fonte': urllib.parse.urlparse(u).netloc, 'url': u, 'arquivo': None, 'ok': False, 'http': st, 'erro': err or f'HTTP {st}', 'obs': 'curl'} if st != 200 else {'fonte': urllib.parse.urlparse(u).netloc, 'url': u, 'ok': True, 'http': 200, 'erro': '', 'arquivo': None, 'obs': 'curl'}
if os.path.exists(f'{D}/_t.html'): os.remove(f'{D}/_t.html')

# ---------------------------------------------------------------- inventario
reun = []
raw = open(f'{D}/reunioes.csv', 'rb').read().decode('utf8', 'replace')
for r in csv.DictReader(raw.splitlines(), delimiter=';'):
    if r['DatReuniao'].startswith('2026'): reun.append({'ide': r['IdeReuniao'], 'data': r['DatReuniao'], 'sessao': r['DscTipoSessao'], 'situacao': r['DscSituacaoReuniao']})
inv = {'gerado_em': HOJE, 'agencia': 'ANEEL',
       'calendario_oficial': {'url': f'{GOV}/calendario', 'norma': 'Portaria ANEEL nº 7.014, de 3/11/2025', 'rpo': cal_rpo, 'circuitos_cdpo': cal_cir},
       'dataset_pautas_atas': {'url': csv_pa['url'], 'linhas_csv_total': len(rows), 'linhas_csv_2026': len(r26), 'datastore_total': ds_total, 'itens_por_data_csv': por_data, 'itens_por_data_datastore': ds},
       'dataset_reunioes_2026': reun,
       'paginas_govbr': {k: v['url'] for k, v in man.items() if k.startswith('govbr:')},
       'tentativas_chromium': tent}
json.dump(inv, open('aneel_inventario.json', 'w'), ensure_ascii=False, indent=1)
json.dump(man, open('manifesto_aneel.json', 'w'), ensure_ascii=False, indent=1)
print('inventario: reunioes 2026', len(reun), '| itens 2026', len(r26), '| datastore total', ds_total, '| csv total', len(rows))
