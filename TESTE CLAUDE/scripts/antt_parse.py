#!/usr/bin/env python3
"""ANTT: atas (texto_antt/*__ata_*) + manifesto -> deliberacoes e votos por diretor.
Uso: python3 -I antt_parse.py manifesto_antt.json saida.json"""
import re, sys, json, unicodedata
def norm(s): return ''.join(c for c in unicodedata.normalize('NFD', s.lower()) if unicodedata.category(c) != 'Mn')
def limpa(t):
    t = t.replace('\u200b', '').replace('\u200c', '')
    t = re.sub(r'D\s?ecis[ãa]o:', 'Decisão:', t)
    return re.sub(r'\n\s*Ata da Reuni.*?pg\.\s*\d+\s*\n', '\n', t)
NOME = r'([A-ZÁÉÍÓÚÂÊÃÕÇ][\wÀ-ú]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÁÉÍÓÚÂÊÃÕÇ][\wÀ-ú]+){1,5})'
def _nomes(seg):
    seg = re.sub(r'\s+', ' ', seg); out = []
    seg = re.sub(r'(Diretor(?:es|a)?(?:-Geral)?(?:\s+subs\s?\w+)?),\s*', r'\1 ', seg)
    for pc in re.split(r',\s*|;\s*|\s+e\s+(?:o\s+|a\s+|os\s+)?(?=Diretor|[A-ZÁÉÍÓÚ])', seg):
        pc = re.sub(r'^(?:presentes\s+)?(?:o\s+|os\s+|a\s+)?(?:Diretor(?:es|a)?(?:-Geral)?(?:\s+subs\s?\w+)?\s*)*', '', pc.strip())
        m = re.match(NOME, pc)
        if m and not re.search(r'Procurador|Ouvidor|Secretar|Sistema|Sendo|Ag[eê]ncia', pc[:40]): out.append(m[1].strip())
    return out
def roster(t):
    head = re.split(r'\n\s*1\.\s+MAT[ÉE]RIAS', t, maxsplit=1)[0][:3000]
    head = re.sub(r'\s+', ' ', head)
    k = re.search(r'(?:Tendo a )?aus[êe]ncia', head); pre = head[:k.start()] if k else head
    st = re.search(r'sob a presid[êe]ncia d[oa]|par\s?(?:ti)?\s?cipa[çc][ãa]o d[oa]', pre) or re.search(r'(?:Reuni[ãa]o|Ag[eê]ncia)[^.]{0,120}?(?=Diretor)', pre)
    pres = _nomes(re.split(r'Procurador|Ouvidor|Chefe|chefe|Secretári', pre[st.end():])[0]) if st else []
    pres = [x for x in pres if len(x.split()) >= 2]
    aus = _nomes(re.sub(r'^.*?aus[êe]ncia d[oa]s?\s*', '', head[k.start():], flags=re.S).split(', por estar')[0]) if k else []
    return list(dict.fromkeys(pres)), list(dict.fromkeys(aus))
CANON = {'queiroz': 'Felipe Fernandes Queiroz', 'asfor': 'Lucas Asfor da Rocha Lima', 'azevedo': 'Alex Antônio de Azevedo Cruz', 'alex': 'Alex Antônio de Azevedo Cruz',
         'sampaio': 'Guilherme Theo Rodrigues da Rocha Sampaio', 'guilherme': 'Guilherme Theo Rodrigues da Rocha Sampaio', 'fonseca': 'Marcelo Cardoso Fonseca',
         'baumgartner': 'Alessandro Baumgartner', 'severino': 'Severino Medeiros Ramos Neto', 'ramos': 'Severino Medeiros Ramos Neto'}
def canon(n):
    for tk in norm(n).split():
        if tk in CANON: return CANON[tk]
    return n
def acha(nome, lista):
    toks = [x for x in norm(nome).split() if len(x) > 3]
    for p in lista:
        if toks and (toks[-1] in norm(p).split() or all(x in norm(p) for x in toks)): return p
    return None
def parse(r, ata):
    t = limpa(open(ata['texto'], encoding='utf8').read())
    pres, aus = roster(t); todos = pres + [a for a in aus if a not in pres]
    heads = [(m.start(), m[1]) for m in re.finditer(r'\n\s*\d+\.\d+\s+DIRETOR(?:-GERAL| SUBSTITUTO)?:\s*([^\n]+)', t)]
    procs = list(re.finditer(r'\n\s*(\d+\.\d+\.\d+)\s+Processo[^\d\n]{0,10}[\u200b ]*([\d]{4,5}\.[\d./-]+)', t))
    D, V = [], []
    for i, m in enumerate(procs):
        fim = procs[i+1].start() if i+1 < len(procs) else len(t)
        b = t[m.start():fim]; b = re.split(r'\n\s*\d+\.\d+\s+DIRETOR', b)[0]
        rel = None
        for pos, h in heads:
            if pos < m.start(): rel = acha(h, todos) or h.title().strip()
        g = lambda k: (lambda x: re.sub(r'\s+', ' ', x[1]).strip() if x else '')(re.search(k + r'\s*:\s*(.+?)(?=\n\s*(?:Interessad|A\s?ssunto|Decis)|\Z)', b, re.S))
        dec = g('Decis[ãa]o'); dn = norm(dec)
        voto = re.search(r'Voto\s+([A-Z]+)\s*-\s*(\d+/\d{4})', dec)
        if re.search(r'vista coletiva', dn): res = 'SOBRESTADO (vista coletiva)'
        elif re.search(r'pedido de vista|pediu vista', dn): res = 'SOBRESTADO (vista)'
        elif re.search(r're\s?(?:ti)?\s?rad', dn): res = 'RETIRADO DE PAUTA'
        elif 'unanimidade' in dn: res = 'APROVADO POR UNANIMIDADE'
        elif 'maioria' in dn: res = 'APROVADO POR MAIORIA'
        elif not dec: res = 'SEM DECISAO NO TEXTO'
        else: res = 'OUTRO'
        ausentes_item = [a for a in todos if re.search(r'ausente', dn) and norm(a).split()[-1] in dn and 'considerado ausente' in dn] if 'considerado ausente' in dn else []
        vista = [p for p in todos if re.search(r'vista[^.]{0,60}' + re.escape(norm(p).split()[-1]), dn) or re.search(r'diretor[^.]{0,30}' + re.escape(norm(p).split()[-1]) + r'[^.]{0,40}(pediu vista|vista)', dn)]
        d = {'reuniao': r['tag'], 'data': r['data'][6:] + '-' + r['data'][3:5] + '-' + r['data'][:2], 'processo': m[2], 'relator': rel, 'interessado': g('Interessad[oa]')[:200],
             'assunto': g('A\\s?ssunto')[:250], 'resultado': res, 'voto_doc': f'{voto[1]} {voto[2]}' if voto else '', 'decisao_texto': dec[:700]}
        D.append(d)
        for p in pres + [a for a in aus if a not in pres]:
            if p in aus and p not in pres or p in ausentes_item: v, pv = 'AUSENTE', 'nominal'
            elif res == 'RETIRADO DE PAUTA': v, pv = 'SEM VOTO (retirado de pauta)', 'nominal' if p == rel else 'n/a'
            elif res == 'SOBRESTADO (vista coletiva)' and p != rel: v, pv = 'VISTA COLETIVA (concedida)', 'nominal'
            elif p in vista: v, pv = 'PEDIU VISTA', 'nominal'
            elif p == rel: v, pv = 'RELATOR (voto proferido)', 'nominal'
            elif res == 'APROVADO POR UNANIMIDADE': v, pv = 'ACOMPANHOU', 'inferido'
            elif res == 'SOBRESTADO (vista)': v, pv = 'SEM VOTO AINDA (vista pendente)', 'inferido'
            else: v, pv = 'REVISAR', 'REVISAR'
            V.append({'reuniao': r['tag'], 'data': d['data'], 'processo': m[2], 'diretor': p, 'voto': v, 'proveniencia': pv})
    return {'reuniao': r['tag'], 'titulo': r['titulo'], 'tipo': r['tipo'], 'data': d['data'] if D else None, 'presentes': pres, 'ausentes': aus}, D, V
if __name__ == '__main__':
    M = json.load(open(sys.argv[1])); out = {'reunioes': [], 'deliberacoes': [], 'votos': []}
    for r in M:
        atas = [d for d in r['docs'] if d['tipo'] == 'ata' and d['chars'] > 300]
        info = {'reuniao': r['tag'], 'titulo': r['titulo'], 'tipo': r['tipo'], 'data': r['data'][6:] + '-' + r['data'][3:5] + '-' + r['data'][:2], 'presentes': [], 'ausentes': [],
                'obs': '' if atas else 'SEM ATA PUBLICADA/COM TEXTO'}
        if atas:
            i, D, V = parse(r, atas[0]); i['data'] = info['data']; info = i; info['obs'] = ''
            out['deliberacoes'] += D; out['votos'] += V
        out['reunioes'].append(info)
    OK = set(CANON.values())
    for r in out['reunioes']: r['presentes'] = [x for x in map(canon, r['presentes']) if x in OK]; r['ausentes'] = [x for x in map(canon, r['ausentes']) if x in OK]
    for d in out['deliberacoes']: d['relator'] = canon(d['relator'] or '') or None
    for v in out['votos']: v['diretor'] = canon(v['diretor'])
    out['votos'] = [v for v in out['votos'] if v['diretor'] in OK]
    json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False, indent=1)
    import collections
    print('reunioes', len(out['reunioes']), 'delib', len(out['deliberacoes']), 'votos', len(out['votos']))
    print(collections.Counter(d['resultado'] for d in out['deliberacoes'])); print(collections.Counter(v['proveniencia'] for v in out['votos']))
    print('sem presentes:', [r['reuniao'] for r in out['reunioes'] if not r['presentes'] and not r['obs']])
