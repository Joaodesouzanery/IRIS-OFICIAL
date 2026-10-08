"""ANATEL: sonda as paginas/hosts oficiais e registra o que responde (HTTP, redirecionamento, tamanho, sha256) -> anatel_inventario.json
Documenta ONDE ficam pauta/ata/voto/acordao e o que e inacessivel (captcha, defeso eleitoral, redirecionamento).
Uso: python3 -I scripts/anatel_inventario.py anatel_inventario.json fonte/anatel"""
import sys, json, subprocess, hashlib, os, time, datetime, re, html
out, dest = sys.argv[1:3]; os.makedirs(f'{dest}/web', exist_ok=True)
SONDAS = [
 ('legado_reunioes', 'https://www.anatel.gov.br/institucional/conselho-diretor/76-reunioes/conselho-diretor', 'URL citada no enunciado (Joomla antigo): hoje responde 302 para a home do gov.br (site migrado; conteúdos podem ter sido removidos no defeso eleitoral desde 04/07/2026)'),
 ('govbr_reunioes', 'https://www.gov.br/anatel/pt-br/composicao/conselho-diretor/reunioes', 'Página oficial atual de Reuniões: texto institucional + links para o SEI (Publicações Eletrônicas, série 229 Ata e 432 Pauta), sem lista de reuniões'),
 ('govbr_historico', 'https://www.gov.br/anatel/pt-br/composicao/conselho-diretor/historico-de-pautas-e-atas', 'Histórico de pautas e atas: só até a 873ª reunião (01/08/2019); nada de 2026'),
 ('govbr_conselho', 'https://www.gov.br/anatel/pt-br/composicao/conselho-diretor', 'Composição do Conselho Diretor'),
 ('govbr_noticia_958', 'https://www.gov.br/anatel/pt-br/assuntos/noticias/anatel-realiza-958a-reuniao-do-conselho-diretor-nesta-quinta-feira-8-10', 'Notícia da 958ª reunião (08/10/2026, 15h, videoconferência): denominador independente do nº da reunião'),
 ('legislacao', 'https://informacoes.anatel.gov.br/legislacao/', 'Portal de Legislação (resoluções, súmulas, portarias): não publica Acórdãos nem atas'),
 ('sei_publicacoes', 'https://sei.anatel.gov.br/sei/publicacoes/controlador_publicacoes.php?acao=publicacao_pesquisar&acao_origem=publicacao_pesquisar&id_orgao_publicacao=0&rdo_data_publicacao=I', 'SEI > Publicações Eletrônicas: ABRE SEM CAPTCHA (usado). Séries: Acórdão 8, Análise 7, Voto 94, Ata de Reunião 229, Pauta de Reunião 432, Ata de Circuito 187, Pauta de Circuito 188'),
 ('sei_pesquisa_publica', 'https://sei.anatel.gov.br/sei/modulos/pesquisa/md_pesq_processo_pesquisar.php?acao_externa=protocolo_pesquisar&acao_origem_externa=protocolo_pesquisar&id_orgao_acesso_externo=0', 'SEI > Pesquisa pública de processo: exige CAPTCHA (não resolvido; bloqueado pela fonte)'),
 ('anexar_api', 'https://sistemas.anatel.gov.br/anexar-api/publico/anexos/download/0000', 'API de anexos: host responde (400 para hash inválido); nenhum hash é publicado nas páginas de reunião/Publicações -> não há como enumerar'),
 ('anexar_api_raiz', 'https://sistemas.anatel.gov.br/', 'Raiz de sistemas.anatel: 302'),
]
res = {}
for k, u, nota in SONDAS:
    f = f'{dest}/web/{k}.html'; cod = loc = ''
    for i in range(6):
        p = subprocess.run(['curl', '-sS', '-m', '60', '-A', 'Mozilla/5.0', '-o', f, '-w', '%{http_code}|%{redirect_url}|%{size_download}', u], capture_output=True)
        if p.returncode == 0: cod, loc, tam = (p.stdout.decode().split('|') + ['', ''])[:3]; break
        time.sleep(3)
    ok = os.path.exists(f)
    res[k] = {'url': u, 'http': cod, 'redirect': loc, 'bytes': os.path.getsize(f) if ok else 0, 'sha256': hashlib.sha256(open(f, 'rb').read()).hexdigest() if ok else None, 'nota': nota, 'sondado_em': datetime.date.today().isoformat()}
# series SEI relevantes (rotulos oficiais do select)
g = open(f'{dest}/web/sei_publicacoes.html', encoding='latin1').read()
m = re.search(r'<select id="selSerie".*?</select>', g, re.S)
res['sei_series_disponiveis'] = {v: html.unescape(t) for v, t in re.findall(r'<option value="(\d+)"[^>]*>([^<]*)', m[0])} if m else {}
res['defeso_eleitoral'] = 'gov.br/anatel exibe aviso: parte dos conteúdos do portal ficará indisponível desde 04/07/2026 (defeso eleitoral); o SEI Publicações não foi afetado'
json.dump(res, open(out, 'w'), ensure_ascii=False, indent=1)
for k, v in res.items():
    if isinstance(v, dict) and 'http' in v: print(k, v['http'], v['redirect'][:70], v['bytes'])
