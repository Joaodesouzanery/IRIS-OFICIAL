"""ANAC: inventario 2026 (indices APEX + calendario Portaria 18.366 + paginas de reuniao + pautas).
Hosts: departamental./santosdumont./www.anac.gov.br (liberados) e www.gov.br. O F5 da ANAC rejeita ~50% das requisicoes
('Request Rejected', 246 bytes): curl com cookie jar e retry. CAPTCHA nunca e resolvido: se aparecer, registra 'bloqueado pela fonte'.
O indice APEX NAO tem paginador: e uma regiao HTML unica com TODA a lista do ano (provado: marcadores de paginacao ausentes
e controle com P137_ANO/P138_ANO=2025 devolve a lista inteira de 2025 na mesma pagina).
uso: python3 -I scripts/anac_inventario.py anac_inventario.json fonte/anac"""
import sys, os, re, json, html, time, subprocess, hashlib, datetime
OUT, DIR = sys.argv[1], sys.argv[2]
B = 'https://www.gov.br/anac/pt-br/acesso-a-informacao/institucional/reunioes-da-diretoria'
URL_PRES = 'https://departamental.anac.gov.br/menu/f?p=107101:137'
URL_PRES_ANO = 'https://departamental.anac.gov.br/menu/f?p=107101:137:0:::137:P137_ANO:%d'
URL_ELE = 'https://santosdumont.anac.gov.br/menu/f?p=107101:138:0:::138:P138_ANO:2026'
URL_ELE_ANO = 'https://santosdumont.anac.gov.br/menu/f?p=107101:138:0:::138:P138_ANO:%d'
URL_CAL = 'https://www.anac.gov.br/assuntos/legislacao/legislacao-1/portarias/2025/portaria-18366'
URL_REU = 'https://santosdumont.anac.gov.br/menu/f?p=107101:139:0:::139:P139_ID_REUNIAO_DIRETORIA:%s'
URL_PAUTA = 'https://santosdumont.anac.gov.br/menu/f?p=107101:141:0:::141:P141_ID_REUNIAO_DIRETORIA:%s'
MESES = {'janeiro': 1, 'fevereiro': 2, 'março': 3, 'abril': 4, 'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12}
os.makedirs(os.path.join(DIR, 'reu'), exist_ok=True); os.makedirs(os.path.join(DIR, 'pauta'), exist_ok=True)
JAR = os.path.join(DIR, '_cookies.txt')

def baixa(url, dest, minimo=5000, tentativas=8):
    """curl com retry. Devolve 'ok' | 'cache' | 'http<N>' | 'bloqueado'. Nunca resolve captcha."""
    if os.path.exists(dest) and os.path.getsize(dest) >= minimo: return 'cache'
    why = 'bloqueado'
    for t in range(tentativas):
        r = subprocess.run(['curl', '-sS', '-m', '60', '-L', '-c', JAR, '-b', JAR, '-o', dest, '-w', '%{http_code}', url], capture_output=True, text=True)
        code = r.stdout.strip()
        sz = os.path.getsize(dest) if os.path.exists(dest) else 0
        if code == '200' and sz >= minimo:
            b = open(dest, 'rb').read(4000).decode('latin1', 'replace')
            if 'captcha' in b.lower() and 'recaptcha' not in b.lower() and sz < 20000: why = 'captcha'; break   # nunca resolvido
            return 'ok'
        why = 'http' + code if code not in ('', '000') else 'bloqueado'
        if code == '404': break
        time.sleep(1.5)
    if os.path.exists(dest) and os.path.getsize(dest) < minimo: os.remove(dest)
    return why

def lista_apex(h):
    """itens da regiao HTML (escapada) do APEX; dedup por id (a regiao aparece duplicada na pagina)."""
    u = html.unescape(h); out = []
    for i, t, d in re.findall(r'P139_ID_REUNIAO_DIRETORIA:(\d+)">([^<]+)</a></div><div class="description" >([^<]*)', u):
        if i not in [x['id'] for x in out]: out.append({'id': i, 'titulo': t.strip(), 'realizacao': d.replace('Realização:', '').strip()})
    return out
def classifica_titulo(t):
    m = re.match(r'(\d+)[ªº] Reunião Deliberativa( Eletrônica)?( Extraordinária)?', t)
    if not m: return None
    return {'n': int(m.group(1)), 'eletronica': bool(m.group(2)), 'extra': bool(m.group(3))}
def datas(real):
    """'06 e 09/10/2026' -> ['2026-10-06','2026-10-09']; '30/06 e 03/07/2026'; '06/10/2026'."""
    ano = int(re.search(r'/(\d{4})', real).group(1)); parts = [p.strip() for p in real.split(' e ')]
    r = re.sub(r'/\d{4}', '', real); out = []
    for p in re.split(r'\s+e\s+', r):
        m = re.fullmatch(r'(\d{1,2})(?:/(\d{1,2}))?', p.strip())
        if m: out.append((int(m.group(1)), int(m.group(2)) if m.group(2) else None))
    res = []; mes_final = int(re.search(r'/(\d{1,2})/\d{4}$', real).group(1))
    for d, m in out: res.append(datetime.date(ano, m or mes_final, d).isoformat())
    return res

fontes = []
def f(url, nome, minimo=5000):
    st = baixa(url, os.path.join(DIR, nome), minimo); fontes.append({'url': url, 'arquivo': nome, 'status': st}); return st
for u, n in [(f'{B}/reunioes-deliberativas', 'g_pres.html'), (f'{B}/reunioes-deliberativas-eletronicas', 'g_ele.html'),
             (f'{B}/calendarios-das-reunioes/calendario-de-reunioes', 'g_cal.html'), (f'{B}/diretoria-colegiada', 'g_dir.html'),
             (f'{B}/reunioes-da-diretoria-colegiada', 'g_rdc.html')]:
    if not os.path.exists(os.path.join(DIR, n)) or os.path.getsize(os.path.join(DIR, n)) < 5000: f(u, n)
    else: fontes.append({'url': u, 'arquivo': n, 'status': 'cache'})
f(URL_PRES, 'apex_presenciais_2026.html'); f(URL_ELE, 'apex_eletronicas_2026.html'); f(URL_CAL, 'apex_calendario_portaria_18366.html')
# controle de paginacao: mesma pagina com ano explicito e com 2025 (lista do ano inteiro numa pagina so)
f(URL_PRES_ANO % 2026, 'ctl_pres_2026.html'); f(URL_PRES_ANO % 2025, 'ctl_pres_2025.html'); f(URL_ELE_ANO % 2025, 'ctl_ele_2025.html')

def rd(n): return open(os.path.join(DIR, n), errors='replace').read() if os.path.exists(os.path.join(DIR, n)) else ''
pres, ele = lista_apex(rd('apex_presenciais_2026.html')), lista_apex(rd('apex_eletronicas_2026.html'))
ctl = {k: len(lista_apex(rd(n))) for k, n in [('pres_2026_param', 'ctl_pres_2026.html'), ('pres_2025', 'ctl_pres_2025.html'), ('ele_2025', 'ctl_ele_2025.html')]}
PAG = ('a-IRR-pagination', 'apex_pagination', 'a-IRR-paginator', 'Linhas por página', 'Rows per page', 'pagination', 'Próximo', 'Next')
marcadores = {k: [m for m in PAG if m.lower() in html.unescape(rd(n)).lower()] for k, n in [('presenciais', 'apex_presenciais_2026.html'), ('eletronicas', 'apex_eletronicas_2026.html')]}

reunioes = []
for tipo, L in (('presencial', pres), ('eletronica', ele)):
    for x in L:
        c = classifica_titulo(x['titulo'])
        if not c: continue
        rid = ('RD' if tipo == 'presencial' else 'RE') + ('X' if c['extra'] else '') + str(c['n'])
        e = {'reuniao': rid, 'id_apex': x['id'], 'tipo': tipo, 'extraordinaria': c['extra'], 'n': c['n'], 'titulo': x['titulo'], 'realizacao': x['realizacao'], 'datas': datas(x['realizacao']),
             'url': URL_REU % x['id'], 'arquivo': f"reu/{x['id']}.html", 'url_pauta': URL_PAUTA % x['id'], 'arquivo_pauta': f"pauta/{x['id']}.html"}
        e['status'] = f(e['url'], e['arquivo'], 10000); e['status_pauta'] = f(e['url_pauta'], e['arquivo_pauta'], 10000)
        reunioes.append(e)
# calendario (Portaria 18.366): denominador independente
cal_t = html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', rd('apex_calendario_portaria_18366.html'))))
cal = []
m0 = re.search(r'ANEXO CALENDÁRIO DE REUNIÕES.*?Mês Datas das Reuniões(.*?)_{5,}', cal_t)
if m0:
    for mes, ds in re.findall(r'(Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\s+([0-9º, e]+?)(?=\s+(?:Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\b|\s*$)', m0.group(1)):
        for d in re.findall(r'\d+', ds): cal.append(datetime.date(2026, MESES[mes.lower()], int(d)).isoformat())
hoje = datetime.date.today().isoformat()
presenciais = [r for r in reunioes if r['tipo'] == 'presencial']
datas_pres = {d for r in presenciais for d in r['datas']}
def lacunas(tipo, extra=False):
    ns = sorted(r['n'] for r in reunioes if r['tipo'] == tipo and r['extraordinaria'] == extra)
    return ns, [k for k in range(1, (ns[-1] if ns else 0) + 1) if k not in ns]
ns_p, bur_p = lacunas('presencial'); ns_e, bur_e = lacunas('eletronica'); ns_x, bur_x = lacunas('eletronica', True)
inv = {'ano': 2026, 'gerado_em': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'), 'fontes': fontes, 'reunioes_2026': reunioes,
       'contadores': {'listadas_apex_presenciais': len(pres), 'listadas_apex_eletronicas': len(ele), 'listadas_apex_total': len(pres) + len(ele),
                      'paginas_reuniao_baixadas': sum(1 for r in reunioes if r['status'] in ('ok', 'cache')), 'pautas_baixadas': sum(1 for r in reunioes if r['status_pauta'] in ('ok', 'cache')),
                      'calendario_portaria_18366_ano': len(cal), 'calendario_ate_hoje': sum(1 for d in cal if d <= hoje),
                      'calendario_ate_hoje_com_reuniao_na_data': sum(1 for d in cal if d <= hoje and d in datas_pres),
                      'presenciais_realizadas_fora_do_calendario': sorted(d for d in datas_pres if d not in cal), 'oficial_contador_exibido': None},
       'calendario': {'datas': cal, 'hoje': hoje, 'sem_reuniao_na_data': [d for d in cal if d <= hoje and d not in datas_pres]},
       'numeracao': {'presenciais': ns_p, 'buracos_presenciais': bur_p, 'eletronicas': ns_e, 'buracos_eletronicas': bur_e, 'extraordinarias_eletronicas': ns_x, 'buracos_extra': bur_x},
       'paginacao': {'marcadores_de_paginacao_na_pagina': marcadores, 'controle_lista_inteira_do_ano': ctl,
                     'conclusao': 'regiao HTML unica sem paginador; o indice devolve o ano inteiro (2025: %d presenciais e %d eletronicas na mesma pagina)' % (ctl['pres_2025'], ctl['ele_2025'])},
       'acesso': {'apex_2026': 'ok' if pres and ele else 'bloqueado', 'calendario': 'ok' if cal else 'bloqueado', 'sei.anac.gov.br': 'bloqueado pelo egress (CONNECT 403): atas, votos, certidoes, relatorios',
                  'pergamum.anac.gov.br': 'bloqueado pelo egress (CONNECT 403)'}}
json.dump(inv, open(OUT, 'w'), ensure_ascii=False, indent=1)
print('fontes', len(fontes), 'ok', sum(x['status'] in ('ok', 'cache') for x in fontes), '| presenciais', len(pres), 'eletronicas', len(ele), '| calendario', len(cal), '| buracos', bur_p, bur_e, bur_x,
      '| paginas', inv['contadores']['paginas_reuniao_baixadas'], 'pautas', inv['contadores']['pautas_baixadas'])
