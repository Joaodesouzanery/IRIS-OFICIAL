"""ANCINE: baixa TODOS os documentos do inventario (SEI Publicacoes, publicacao_visualizar), grava sha256 e converte para texto.
Cada documento vira fonte/ancine/doc/<id_documento>.html (bytes originais, ISO-8859-1) e texto_ancine/<id_documento>.txt.
Validacao: o HTML precisa conter o titulo 'SEI/ANCINE - <protocolo>' (pagina de erro/captcha nao entra como ok). Captcha nunca e resolvido:
se aparecesse, o documento fica ok=false com motivo e vira pendencia 'bloqueado pela fonte' no parser.
Uso: python3 -I scripts/ancine_baixar.py ancine_inventario.json manifesto_ancine.json fonte/ancine texto_ancine"""
import sys, json, os, re, time, hashlib, html
from concurrent.futures import ThreadPoolExecutor
import requests
inv_f, man_f, dest, txt = sys.argv[1:5]
os.makedirs(dest + '/doc', exist_ok=True); os.makedirs(txt, exist_ok=True)
inv = json.load(open(inv_f))
SEI = 'https://sei.ancine.gov.br/sei/publicacoes/controlador_publicacoes.php'
def html2txt(b):
    t = b.decode('latin-1')
    t = re.sub(r'(?is)<(style|script|head)\b.*?</\1>', ' ', t)
    t = re.sub(r'(?i)<br\s*/?>|</(p|div|tr|li|h\d|table)>', '\n', t)
    t = re.sub(r'(?i)</t[dh]>', ' | ', t)
    t = html.unescape(re.sub(r'<[^>]+>', '', t)).replace('\xa0', ' ')
    t = re.sub(r'[ \t\r\f\v]+', ' ', t)
    return re.sub(r'\n\s*\n+', '\n', re.sub(r' *\n *', '\n', t)).strip()
def baixa(it):
    doc = it['id_documento']; f = f'{dest}/doc/{doc}.html'
    ok_local = os.path.exists(f) and b'SEI/ANCINE' in open(f, 'rb').read(4000)
    motivo = ''
    if not ok_local:
        for i in range(14):
            try:
                r = requests.get(SEI, params={'acao': 'publicacao_visualizar', 'id_documento': doc, 'id_orgao_publicacao': '0'}, headers={'User-Agent': 'Mozilla/5.0'}, timeout=90)
                if r.status_code == 200 and b'SEI/ANCINE' in r.content[:4000] and len(r.content) > 3000:
                    open(f, 'wb').write(r.content); ok_local = True; break
                motivo = f'HTTP {r.status_code} {len(r.content)} bytes'
                if b'captcha' in r.content.lower(): motivo = 'captcha'; break
            except Exception as e: motivo = 'rede: ' + type(e).__name__
            time.sleep(1 + 0.7 * i)
    t = None; sha = None; n = 0
    if ok_local:
        b = open(f, 'rb').read(); sha = hashlib.sha256(b).hexdigest(); n = len(b)
        t = f'{txt}/{doc}.txt'; open(t, 'w', encoding='utf8').write(html2txt(b))
    return dict(url=f'{SEI}?acao=publicacao_visualizar&id_documento={doc}&id_orgao_publicacao=0', tipo=it['_serie'], ref=doc, protocolo=it['protocolo'], descricao=it['descricao'],
                formato='html', ok=ok_local, arquivo_local=f if ok_local else None, texto=t, sha256=sha, bytes=n, motivo='' if ok_local else motivo)
alvos = []
for sid, S in inv['series'].items():
    for it in S['itens']: alvos.append(dict(it, _serie=sid))
with ThreadPoolExecutor(8) as ex: man = list(ex.map(baixa, alvos))
json.dump(man, open(man_f, 'w'), ensure_ascii=False, indent=1)
por = {}
for m in man: por.setdefault(m['tipo'], [0, 0]); por[m['tipo']][0] += 1; por[m['tipo']][1] += m['ok']
print('listados × baixados por série:', por, '| falhas:', [(m['ref'], m['motivo']) for m in man if not m['ok']][:20])
