"""ANCINE (Diretoria Colegiada): inventario das fontes de 2026.
Fonte real: SEI Publicacoes (https://sei.ancine.gov.br/sei/publicacoes/), HTML estatico e SEM captcha, com CONTADOR OFICIAL
("Exibindo 1 - 20 de N"). gov.br/ancine (Volto) so tem links para ela (pagina reunioes_deliberativas = so a ultima e a proxima reuniao;
arquivo 2018-2020 em PDF/zip); as paginas gov.br relevantes sao salvas em fonte/ancine/govbr como prova.
Series (id_serie): 307 Deliberacao-DDC, 298 Ata RDC, 296 Pauta RDC, 527 Extrapauta, 366 Deliberacao Ad Referendum, 702 Pauta de Circuito,
703 Ata de Circuito, 518 Decisao/Proclamacao, 771 Lista de processos distribuidos.
PROVA DE PAGINACAO: para cada serie, contador anual N; soma dos contadores mensais = N; linhas efetivamente percorridas (20 por pagina,
hdnInicio=0,20,...) = N; sem protocolo repetido. Divergencia fica registrada em 'checagens'.
Uso: python3 -I scripts/ancine_inventario.py ancine_inventario.json fonte/ancine"""
import sys, re, json, os, time, html, calendar
from concurrent.futures import ThreadPoolExecutor
import requests
out, dest = sys.argv[1:3]
os.makedirs(dest + '/govbr', exist_ok=True)
SEI = 'https://sei.ancine.gov.br/sei/publicacoes/controlador_publicacoes.php'
SERIES = {307: 'Deliberação - DDC', 298: 'Ata de Reunião de Diretoria Colegiada', 296: 'Pauta de Reunião de Diretoria Colegiada',
          527: 'Extrapauta de Reunião de Diretoria Colegiada', 366: 'Deliberação Ad Referendum', 702: 'Pauta de Circuito Deliberativo',
          703: 'Ata de Circuito Deliberativo', 518: 'Decisão Proclamação', 771: 'Lista de Processos Distribuídos para Relatoria'}
ANO = 2026
def sessao():
    s = requests.Session(); s.headers['User-Agent'] = 'Mozilla/5.0'; return s
def pesquisa(serie, ini, fim, inicio, tries=12):
    d = {'hdnInfraTipoPagina': '1', 'txtInteiroTeor': '', 'txtResumo': '', 'selUnidadeResponsavel': '', 'selSerie': str(serie), 'txtNumero': '',
         'txtProtocoloPesquisa': '', 'selVeiculoPublicacao': '', 'txtDataDocumento': '', 'rdoDataPublicacao': 'E', 'txtDataInicio': ini,
         'txtDataFim': fim, 'hdnInicio': str(inicio)}
    for i in range(tries):
        try:
            r = sessao().post(SEI, params={'acao': 'publicacao_pesquisar', 'acao_origem': 'publicacao_pesquisar', 'id_orgao_publicacao': '0'}, data=d, timeout=60)
            if r.status_code == 200 and b'tblPublicacoes' in r.content: return r.content.decode('latin-1')
        except Exception: pass
        time.sleep(1 + 0.6 * i)
    raise RuntimeError(f'falha {serie} {ini} {inicio}')
def limpa(x): return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', x))).strip()
def linhas(t):
    res = []
    for m in re.finditer(r'<tr id="trPublicacaoA\d+".*?</tr>\s*<tr id="trPublicacaoB\d+"[^>]*>(.*?)</tr>', t, re.S):
        bloco = m[0]
        doc = re.search(r'id_documento=(\d+)', bloco)[1]
        tds = re.findall(r'<td[^>]*>(.*?)</td>', bloco.split('</tr>')[0], re.S)
        cel = [limpa(c) for c in tds[1:8]]           # protocolo, descricao, veiculo, data, unidade, orgao, resumo
        snip = limpa(m[1])
        res.append(dict(id_documento=doc, protocolo=cel[0], descricao=cel[1], veiculo=cel[2], data=cel[3], unidade=cel[4], orgao=cel[5], resumo=cel[6], trecho=snip))
    return res
def contador(t):
    m = re.search(r'Exibindo\s+(\d+)\s*-\s*(\d+)\s+de\s+([\d.]+)', t)
    if m: return int(m[3].replace('.', ''))
    return None
def percorre(serie, ini, fim):
    t = pesquisa(serie, ini, fim, 0); n = contador(t); rows = linhas(t); pag = [{'inicio': 0, 'linhas': len(rows)}]
    pagina_unica = n is None
    if n is None:      # o SEI so mostra o contador "Exibindo a - b de N" quando ha mais de uma pagina
        n = len(rows) if len(rows) < 20 else 10**6
    ini_ = 20
    while n > 0 and ini_ < n:
        t = pesquisa(serie, ini, fim, ini_); r = linhas(t); rows += r; pag.append({'inicio': ini_, 'linhas': len(r)}); ini_ += 20
        if not r: break
    if n == 10**6: n = len(rows)
    return dict(contador=n, linhas=rows, paginas=pag, contador_oficial=not pagina_unica)
def tarefa(a):
    serie, ini, fim, rotulo = a
    return a, percorre(serie, ini, fim)
tarefas = []
for s in SERIES:
    tarefas.append((s, f'01/01/{ANO}', f'31/12/{ANO}', 'ano'))
    for mes in range(1, 13):
        u = calendar.monthrange(ANO, mes)[1]
        tarefas.append((s, f'01/{mes:02d}/{ANO}', f'{u:02d}/{mes:02d}/{ANO}', f'{mes:02d}'))
with ThreadPoolExecutor(5) as ex: res = list(ex.map(tarefa, tarefas))
inv = {'gerado_em': time.strftime('%Y-%m-%d %H:%M'), 'fonte': SEI, 'series': {}, 'checagens': [], 'govbr': []}
for (serie, ini, fim, rot), r in res:
    S = inv['series'].setdefault(str(serie), {'nome': SERIES[serie], 'id_serie': serie, 'url': f'{SEI}?acao=publicacao_pesquisar&acao_origem=publicacao_pesquisar&id_orgao_publicacao=0&id_serie={serie}&rdo_data_publicacao=E&dta_inicio=01/01/{ANO}&dta_fim=31/12/{ANO}', 'mensal': {}})
    if rot == 'ano': S['ano'] = r
    else: S['mensal'][rot] = dict(contador=r['contador'], linhas=len(r['linhas']), paginas=len(r['paginas']))
for sid, S in inv['series'].items():
    a = S['ano']; soma_m = sum(m['contador'] for m in S['mensal'].values()); soma_l = sum(m['linhas'] for m in S['mensal'].values())
    prot = [x['protocolo'] for x in a['linhas']]; docs = [x['id_documento'] for x in a['linhas']]
    ok = a['contador'] == len(a['linhas']) == soma_m == soma_l and len(set(docs)) == len(docs)
    inv['checagens'].append([f"{sid} {S['nome']}", 'contador oficial (ano) × linhas percorridas × soma dos contadores mensais × soma das linhas mensais × documentos únicos',
                              a['contador'], len(a['linhas']), 'OK' if ok else 'DIVERGE',
                              f"mensal={soma_m}/{soma_l}; páginas de 20 percorridas={len(a['paginas'])}; únicos={len(set(docs))}; contador oficial exibido={a['contador_oficial']} (o SEI só o exibe com mais de 1 página; sem ele N = linhas da página única)"])
    S['contador_oficial_exibido'] = a['contador_oficial']; S['itens'] = a['linhas']; S['contador_ano'] = a['contador']; S['paginas_percorridas'] = len(a['paginas']); del S['ano']
# paginas gov.br (prova de que a listagem publica so tem ultima/proxima e links para o SEI)
GOV = 'https://www.gov.br/ancine/++api++/pt-br/'
for nome, caminho in [('reunioes_deliberativas', 'assuntos/diretoria-colegiada/reunioes_deliberativas'), ('diretoria-colegiada', 'assuntos/diretoria-colegiada'),
                      ('circuitos-deliberativos', 'assuntos/diretoria-colegiada/circuitos-deliberativos'), ('pautas-e-atas', 'assuntos/reunioes-diretoria-colegiada/pautas-e-atas'),
                      ('historico', 'assuntos/diretoria-colegiada/historico'), ('diretores', 'assuntos/diretoria-colegiada/diretores'),
                      ('distribuicao_de_processos', 'assuntos/diretoria-colegiada/distribuicao_de_processos')]:
    u = GOV + caminho + '?b_start=0&b_size=3000'; b = None
    for i in range(8):
        try:
            r = requests.get(u, headers={'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0'}, timeout=60)
            if r.status_code == 200 and r.content[:1] == b'{': b = r.content; break
        except Exception: pass
        time.sleep(1 + i)
    f = f'{dest}/govbr/{nome}.json'
    if b: open(f, 'wb').write(b)
    j = json.loads(b) if b else {}
    inv['govbr'].append({'pagina': nome, 'url': 'https://www.gov.br/ancine/pt-br/' + caminho, 'estado': 'OK' if b else 'REDE', 'arquivo_local': f if b else None,
                         'items_total': j.get('items_total'), 'titulo': j.get('title')})
json.dump(inv, open(out, 'w'), ensure_ascii=False, indent=1)
for c in inv['checagens']: print(c)
print([(g['pagina'], g['estado'], g['items_total']) for g in inv['govbr']])
