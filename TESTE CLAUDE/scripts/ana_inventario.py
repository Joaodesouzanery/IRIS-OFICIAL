"""ANA (Diretoria Colegiada): coleta as LISTAGENS oficiais (gov.br + iframes do www2/resolucoes), o calendario 2026 e a composicao do colegiado,
sonda o host dos PDFs (arquivos.ana.gov.br) e grava ana_inventario.json (todas as reunioes/atas/pautas 2026 com URL).
Uso: python3 -I scripts/ana_inventario.py ana_inventario.json fonte/ana"""
import sys, os, re, json, time, hashlib, html, subprocess, datetime
out, dest = sys.argv[1:3]; W = f'{dest}/web'; os.makedirs(W, exist_ok=True)
G = 'https://www.gov.br/ana/pt-br'; I = G + '/acesso-a-informacao/institucional'; R = 'https://www.ana.gov.br/www2/resolucoes'
PAGINAS = {
 'govbr_reuniao_deliberativa': (I + '/reuniao-deliberativa', 'pagina-mae (links para calendario/pautas/atas; a pagina diz que Pautas e Atas sao iframes do www2)'),
 'govbr_calendario': (I + '/reuniao-deliberativa/calendario-das-reunioes-deliberativas', 'calendario oficial 2026 (denominador independente)'),
 'govbr_atas': (I + '/reuniao-deliberativa/atas-das-reunioes-deliberativas', 'embute iframe www2/resolucoes/atasreuniao.asp'),
 'govbr_pautas': (I + '/reuniao-deliberativa/pautas-das-reunioes-deliberativas', 'embute iframe www2/resolucoes/atosconvocatorios.asp'),
 'govbr_circuitos': (I + '/circuitos-deliberativos', 'colecao de circuitos deliberativos'),
 'govbr_circuitos_atas': (I + '/circuitos-deliberativos/atas-dos-circuitos-deliberativos', 'atas dos circuitos (colecao)'),
 'govbr_diretoria': (I + '/diretoria-colegiada', 'composicao e mandatos'),
 'govbr_quem_e_quem': (G + '/composicao/diretoria-colegiada/quem-e-quem', 'quem e quem (interinos)'),
 'govbr_administrativas': (I + '/reunioes-administrativas-da-diretoria-colegiada', 'reunioes ADMINISTRATIVAS (fora do escopo: sem votos de relator em materia regulatoria; so contagem)'),
 'www2_atas_deliberativas': (R + '/atasreuniao.asp', 'LISTAGEM de atas deliberativas (iframe, HTML estatico por ano)'),
 'www2_pautas_deliberativas': (R + '/atosconvocatorios.asp', 'LISTAGEM de pautas deliberativas (iframe)'),
 'www2_atas_administrativas': (R + '/atasreuniao.asp?tiporeuniao=Administrativa', 'atas administrativas (fora do escopo)'),
 'www2_pautas_administrativas': (R + '/atosconvocatorios.asp?tiporeuniao=Administrativa', 'pautas administrativas (fora do escopo)'),
}
def curl(u, f, tent=6):
    for i in range(tent):
        p = subprocess.run(['curl', '-sS', '-L', '-m', '60', '-A', 'Mozilla/5.0', '-o', f, '-w', '%{http_code}|%{size_download}', u], capture_output=True)
        if p.returncode == 0:
            c, n = p.stdout.decode().split('|'); return c, int(n), ''
        time.sleep(3 * (i + 1))
    return '000', 0, p.stderr.decode()[:200]
sh = lambda f: hashlib.sha256(open(f, 'rb').read()).hexdigest()
res = {'sondas': {}, 'gerado_em': datetime.date.today().isoformat()}
for k, (u, nota) in PAGINAS.items():
    f = f'{W}/{k}.html'; c, n, err = curl(u, f)
    res['sondas'][k] = {'url': u, 'http': c, 'bytes': n, 'sha256': sh(f) if os.path.exists(f) and n else None, 'nota': nota, 'arquivo': f}
    print(k, c, n)
# host dos PDFs: DNS/egress
p = subprocess.run(['curl', '-sS', '-m', '30', '-o', '/dev/null', '-w', '%{http_code}', 'https://arquivos.ana.gov.br/atas/2026/ata-958-ordin-delib.pdf'], capture_output=True)
res['sondas']['arquivos_ana_pdf'] = {'url': 'https://arquivos.ana.gov.br/atas/2026/ata-958-ordin-delib.pdf', 'http': p.stdout.decode() or '000', 'erro': p.stderr.decode().strip()[:200],
  'nota': 'host que serve TODOS os PDFs (atas, pautas, votos). Aqui: CONNECT recusado (403) pelo proxy de saida do ambiente; via http nao resolve DNS; Chromium igual (ERR_TUNNEL_CONNECTION_FAILED). Nao contornado.'}
print('arquivos', res['sondas']['arquivos_ana_pdf']['http'], res['sondas']['arquivos_ana_pdf']['erro'])

def txt(h): return html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', re.sub(r'<script.*?</script>|<style.*?</style>', '', h, flags=re.S)))).strip()
def listagem(arq):
    """devolve {ano_do_bloco: [(data, arquivo_pdf, rotulo)]} lendo os blocos Assunto_AAAA do iframe"""
    h = open(arq, encoding='utf8', errors='ignore').read(); blocos = {}
    for m in re.finditer(r'<div id="Assunto_(\d{4})"[^>]*>(.*?)</div>', h, re.S):
        blocos[m[1]] = re.findall(r'<b>(\d\d/\d\d/\d{4})</b>\s*-\s*<a[^>]*abreArquivo\(\'[^\']*?file=([^\']+)\'\)[^>]*>\s*([^<]+?)\s*</a>', m[2])
    return blocos, sorted(re.findall(r"mostraAssunto\('(\d{4})'\)", h)), len(re.findall(r'abreArquivo\(', h))
atas, anos_a, nab_a = listagem(f'{W}/www2_atas_deliberativas.html')
pautas, anos_p, nab_p = listagem(f'{W}/www2_pautas_deliberativas.html')
adm_a, _, _ = listagem(f'{W}/www2_atas_administrativas.html'); adm_p, _, _ = listagem(f'{W}/www2_pautas_administrativas.html')
# calendario
c = txt(open(f'{W}/govbr_calendario.html', encoding='utf8', errors='ignore').read()); c = c[c.find('Mês Data das Reuniões'):]; c = c[:c.find('*As datas')]
MES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
cal = []
for i, m in enumerate(MES):
    mm = re.search(m + r'\s+(.*?)(?=' + (MES[i + 1] if i < 11 else '$') + ')', c) if i < 11 else re.search(m + r'\s+(.*)$', c)
    for d in re.findall(r'\d+', mm[1]) if mm else []: cal.append(f'2026-{i+1:02d}-{int(d):02d}')
def iso(d): return f'{d[6:]}-{d[3:5]}-{d[:2]}'
def num(r): return int(re.search(r'(\d+)ª', r)[1])
reun = {}
for ano, L in atas.items():
    for d, arq, rot in L:
        n = num(rot); r = reun.setdefault(n, {'numero': n, 'tipo': 'Ordinária' if 'Ordin' in rot else rot})
        r['ata'] = {'data_listada': iso(d), 'ano_do_bloco': ano, 'rotulo': rot, 'arquivo_fonte': arq, 'url_pdf': 'https://arquivos.ana.gov.br' + arq if arq.startswith('/') else arq}
for ano, L in pautas.items():
    for d, arq, rot in L:
        n = num(rot); r = reun.setdefault(n, {'numero': n, 'tipo': 'Ordinária' if 'Ordin' in rot else rot})
        r['pauta'] = {'data_listada': iso(d), 'ano_do_bloco': ano, 'rotulo': rot, 'arquivo_fonte': arq, 'url_pdf': 'https://arquivos.ana.gov.br' + arq if arq.startswith('/') else arq}
# so 2026 por DATA REAL (pauta/ata): inclui a ata da 959 listada com data 2027 (erro da fonte) quando a pauta a situa em 2026
lista = []
for n in sorted(reun):
    r = reun[n]; dp = r.get('pauta', {}).get('data_listada'); da = r.get('ata', {}).get('data_listada')
    r['data'] = dp or da
    if r['data'] and r['data'].startswith('2026'):
        if dp and da and dp != da: r['divergencia_data'] = f'pauta {dp} x ata {da} (bloco {r["ata"]["ano_do_bloco"]}): erro de digitacao da fonte; vale a pauta'
        lista.append(r)
res.update({
 'listagens': {'anos_atas_deliberativas': anos_a, 'anos_pautas_deliberativas': anos_p, 'links_atas_total': nab_a, 'links_pautas_total': nab_p,
   'atas_2026_bloco': len(atas.get('2026', [])), 'atas_2027_bloco_erro': len(atas.get('2027', [])), 'pautas_2026_bloco': len(pautas.get('2026', [])),
   'administrativas_2026': {'atas': sum(1 for _ in adm_a.get('2026', [])), 'pautas': sum(1 for _ in adm_p.get('2026', []))},
   'observacao_paginacao': 'listagem = 1 pagina HTML com TODOS os anos (blocos Assunto_AAAA colapsados); sem paginacao; o contador oficial nao existe, entao o denominador e (a) calendario e (b) numeracao'},
 'calendario_2026': cal, 'reunioes_2026': lista, 'circuitos_deliberativos': {'ata_colecao': 'Nenhum resultado foi encontrado' in txt(open(f'{W}/govbr_circuitos_atas.html', encoding='utf8', errors='ignore').read()), 'colecao_home': 'Esta coleção não possui nenhum resultado' in txt(open(f'{W}/govbr_circuitos.html', encoding='utf8', errors='ignore').read())}})
d2 = txt(open(f'{W}/govbr_diretoria.html', encoding='utf8', errors='ignore').read()); i = d2.find('Atualmente os integrantes são'); res['colegiado_texto'] = d2[i:i + 520]
q = txt(open(f'{W}/govbr_quem_e_quem.html', encoding='utf8', errors='ignore').read()); i = q.find('Diretoria Colegiada Diretora'); res['quem_e_quem_texto'] = q[i:i + 560]
json.dump(res, open(out, 'w'), ensure_ascii=False, indent=1)
print('reunioes 2026:', [(r['numero'], r['data'], 'ata' in r, 'pauta' in r) for r in lista]); print('calendario:', len(cal), cal)
