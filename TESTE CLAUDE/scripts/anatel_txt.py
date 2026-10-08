"""ANATEL: converte o HTML do SEI (latin-1) em texto limpo -> texto_anatel/<serie>_<id>.txt (usado por anatel_parse.py).
Uso: python3 -I scripts/anatel_txt.py manifesto_anatel.json texto_anatel"""
import re, html, sys, json, os
def html2txt(raw):
    t = raw.decode('latin1') if isinstance(raw, bytes) else raw
    t = re.sub(r'<(style|script).*?</\1>', '', t, flags=re.S | re.I)
    t = re.sub(r'<br\s*/?>', '\n', t, flags=re.I)
    t = re.sub(r'</(p|div|tr|h\d|li|table)>', '\n', t, flags=re.I); t = re.sub(r'</t[dh]>', ' | ', t, flags=re.I)
    t = html.unescape(re.sub(r'<[^>]+>', '', t))
    t = re.sub(r'[​﻿\xa0]', ' ', t); t = re.sub(r'[ \t]+', ' ', t)
    return re.sub(r'\n\s*\n+', '\n', t).strip() + '\n'
if __name__ == '__main__':
    man = json.load(open(sys.argv[1])); dest = sys.argv[2]; os.makedirs(dest, exist_ok=True); n = 0
    for k, v in man.items():
        if v.get('ok'):
            open(f'{dest}/s{v["serie"]}_{v["id_documento"]}.txt', 'w', encoding='utf8').write(html2txt(open(v['arquivo'], 'rb').read())); n += 1
    print('textos', n)
