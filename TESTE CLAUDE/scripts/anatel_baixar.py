"""ANATEL: baixa os documentos publicos do SEI (Publicacoes Eletronicas) listados por scripts/anatel_sei.cjs.
Pipeline: (1) anatel_sei.cjs (Chromium, 1 sessao) lista por serie/periodo -> fonte/anatel/listas/sei_listas.json;
          (2) este script baixa cada documento (curl, retry) e grava manifesto_anatel.json com sha256;
          (3) anatel_parse.py le tudo e gera anatel.json.
Uso: python3 -I scripts/anatel_baixar.py fonte/anatel/listas/sei_listas.json manifesto_anatel.json fonte/anatel"""
import sys, json, os, time, hashlib, subprocess
from concurrent.futures import ThreadPoolExecutor
lst, man_out, dest = sys.argv[1:4]
L = json.load(open(lst))
URL = 'https://sei.anatel.gov.br/sei/publicacoes/controlador_publicacoes.php?acao=publicacao_visualizar&id_documento={}&id_orgao_publicacao=0'
man = json.load(open(man_out)) if os.path.exists(man_out) else {}
def sha(f): return hashlib.sha256(open(f, 'rb').read()).hexdigest()
def baixa(a):
    serie, r = a; k = f'sei:{serie}:{r["id_documento"]}'; os.makedirs(f'{dest}/s{serie}', exist_ok=True)
    f = f'{dest}/s{serie}/{r["id_documento"]}.html'
    if os.path.exists(f) and os.path.getsize(f) > 3000 and b'SEI/ANATEL' in open(f, 'rb').read(2000): ok = True; cod = '200'
    else:
        ok = False; cod = ''
        for i in range(7):
            p = subprocess.run(['curl', '-sS', '-m', '90', '-A', 'Mozilla/5.0', '-L', '-w', '%{http_code}', '-o', f, URL.format(r['id_documento'])], capture_output=True)
            cod = p.stdout[-3:].decode() if p.stdout else ''
            if cod == '200' and os.path.getsize(f) > 3000 and b'SEI/ANATEL' in open(f, 'rb').read(2000): ok = True; break
            time.sleep(2 * (i + 1))
    return k, {'serie': serie, 'rotulo': L[serie]['rotulo'], 'protocolo': r['protocolo'], 'id_documento': r['id_documento'], 'resumo': r['resumo'], 'data_pub': r['data_pub'],
               'url': URL.format(r['id_documento']), 'arquivo': f if ok else None, 'http': cod, 'bytes': os.path.getsize(f) if ok else 0, 'sha256': sha(f) if ok else None, 'ok': ok}
tarefas = [(s, r) for s, v in L.items() for r in v.get('linhas', [])]
with ThreadPoolExecutor(5) as ex:
    for k, v in ex.map(baixa, tarefas): man[k] = v
json.dump(man, open(man_out, 'w'), ensure_ascii=False, indent=1)
print('listados', len(tarefas), 'baixados ok', sum(1 for v in man.values() if v['ok']), 'falhas', sum(1 for v in man.values() if not v['ok']))
