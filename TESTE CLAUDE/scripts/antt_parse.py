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
# --- presença por conjunto FECHADO de diretores (ANTT 2026): robusta a variações de redação do cabeçalho
TOKENS = [('guilherme', 'sampaio'), ('felipe', 'queiroz'), ('lucas', 'asfor'), ('alex', 'azevedo'), ('alessandro', 'baumgartner'), ('marcelo', 'fonseca'), ('severino', 'severino')]
ORDEM = ['Guilherme Theo Rodrigues da Rocha Sampaio', 'Felipe Fernandes Queiroz', 'Lucas Asfor da Rocha Lima', 'Alex Antônio de Azevedo Cruz', 'Alessandro Baumgartner', 'Marcelo Cardoso Fonseca', 'Severino Medeiros Ramos Neto']
def _quem(trecho):
    t = norm(trecho); return [ORDEM[i] for i, (_, sob) in enumerate(TOKENS) if re.search(r'\b' + sob + r'\b', t)]
def roster(t):
    head = re.sub(r'\s+', ' ', re.split(r'\n\s*1\.\s+MAT[ÉE]RIAS', t, maxsplit=1)[0][:3500])
    k = re.search(r'aus[êe]ncia', head)
    pre_txt = head[:k.start()] if k else head; aus_txt = head[k.start():] if k else ''
    pre_txt = re.split(r'Procurador|Ouvidor|Chefe|chefe da', pre_txt)[0]
    pres = _quem(pre_txt); aus = _quem(aus_txt)      # quem aparece nos dois trechos = presente com ausência parcial (ex.: ROD1035)
    rel = [x for h in re.findall(r'\n\s*\d+\.\d+\s+DIRETOR(?:-GERAL| SUBSTITUTO)?:\s*([^\n]+)', t) for x in _quem(h)]
    for x in rel:
        if x not in pres and x not in aus: pres.append(x)     # relatoria na própria reunião = participação
    return [x for x in ORDEM if x in pres], [x for x in ORDEM if x in aus and x not in pres]
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
# --- Fase ANTT-OCR: nomes por tokens DISTINTIVOS (a ata cita "Diretor Lucas Asfor", nunca "Lima"), cabeçalho de relator tolerante a variações
# ("DIRETOR LUCAS ASFOR", "DIRETOR-GERAL GUILHERME SAMPAIO" sem dois-pontos, "1.3 SEVERINO MEDEIROS") e corte da decisão antes do fecho/assinaturas da ata.
TOK = {ORDEM[0]: ('guilherme', 'sampaio'), ORDEM[1]: ('felipe', 'queiroz'), ORDEM[2]: ('lucas', 'asfor'), ORDEM[3]: ('alex', 'azevedo'),
       ORDEM[4]: ('alessandro', 'baumgartner'), ORDEM[5]: ('marcelo', 'fonseca'), ORDEM[6]: ('severino', 'medeiros')}
PREFIXO = {'DG': ORDEM[0], 'DFQ': ORDEM[1], 'DLA': ORDEM[2], 'DAA': ORDEM[3], 'DAB': ORDEM[4], 'DMF': ORDEM[5], 'DSM': ORDEM[6]}
def quem(txt):
    """diretores citados em txt (ordem de ORDEM), por primeiro nome ou sobrenome distintivo"""
    n = norm(txt); return [p for p, ts in TOK.items() if any(re.search(r'\b' + k + r'\b', n) for k in ts)]
HEAD = re.compile(r'\n[ \t]*(\d+\.\d+)[ \t]+(?:DIRETOR(?:-GERAL| SUBSTITUTO)?[ \t]*:?[ \t]*)?((?:GUILHERME|FELIPE|LUCAS|ALEX|ALESSANDRO|SEVERINO|MARCELO)[A-ZÁÉÍÓÚÂÊÔÃÕÇ ]*)[ \t]*(?=\n)')
def corta(dec):
    """a decisão do ÚLTIMO item de cada ata vem colada no fecho ('Dado o encerramento...') e nas assinaturas: cortar"""
    return re.split(r'Dado o encerramento|Ata da Reuni[ãa]o[^\n]{0,80}SEI[^\n]*pg\.|Documento assinado eletronicamente|\s\d+\.\d+\s+(?:DIRETOR|GUILHERME|FELIPE|LUCAS|ALEX|ALESSANDRO|SEVERINO|MARCELO)\b|\s\d+\.\s+(?:MAT[ÉE]RIAS|ASSUNTOS)', dec)[0].strip()
def parse(r, ata):
    t = limpa(open(ata['texto'], encoding='utf8').read())
    pres, aus = roster(t); todos = pres + [a for a in aus if a not in pres]
    heads = [(m.start(), (quem(m[2]) or [None])[0]) for m in HEAD.finditer(t)]
    procs = list(re.finditer(r'\n\s*(\d+\.\d+\.\d+)\s+Processo[^\d\n]{0,10}[\u200b ]*([\d]{4,5}\.[\d./-]+)', t))
    D, V = [], []
    for i, m in enumerate(procs):
        fim = procs[i+1].start() if i+1 < len(procs) else len(t)
        b = t[m.start():fim]; b = HEAD.split(b)[0] if HEAD.search(b) else b
        rel = None
        for pos, h in heads:
            if pos < m.start(): rel = h
        g = lambda k: (lambda x: re.sub(r'\s+', ' ', x[1]).strip() if x else '')(re.search(k + r'\s*:\s*(.+?)(?=\n\s*(?:Interessad|A\s?ssunto|Decis)|\Z)', b, re.S))
        dec = corta(g('Decis[ãa]o')); dn = norm(dec)
        # voto ACOLHIDO: o que vem depois de "acolheu a proposição do Relator/Revisor, apresentada no" ou "Conforme"; senão o primeiro citado
        voto = re.search(r'(?:acolheu a proposi[cç][aã]o d[oa] \w+,? apresentad[oa] no|[Cc]onforme)\s+Voto\s+(Vista\s+)?([A-Z]+)\s*-\s*(\d+/\d{4})', dec) or re.search(r'Voto\s+(Vista\s+)?([A-Z]+)\s*-\s*(\d+/\d{4})', dec)
        if voto and not voto[1] and voto[2] in PREFIXO: rel = PREFIXO[voto[2]]   # relatoria = prefixo do Voto acolhido (confere com RELATORIA do PDF)
        coletiva = re.search(r'vista\s+cole\s?(?:ti)?\s?va', dn)
        m_un, m_ma = re.search(r'por unanimidade', dn), re.search(r'por maioria', dn)
        if coletiva: res = 'SOBRESTADO (vista coletiva)'
        elif re.search(r'pedido de vista|pediu vista|solicit\w+ vista|pedido de vistas', dn) and not re.search(r'voto vista', dn): res = 'SOBRESTADO (vista)'
        elif re.search(r're\s?(?:ti)?\s?rad', dn): res = 'RETIRADO DE PAUTA'
        elif m_ma and (not m_un or m_ma.start() < m_un.start()): res = 'APROVADO POR MAIORIA'
        elif m_un: res = 'APROVADO POR UNANIMIDADE'
        elif not dec: res = 'SEM DECISAO NO TEXTO'
        else: res = 'OUTRO'
        # "considerado ausente na deliberação deste processo" (art. 81 §3º do RI): só o diretor citado na MESMA frase
        ausentes_item = []
        for fr in re.split(r'(?<=[.;])\s', dec):
            if re.search(r'considerad[oa]s? ausentes?', norm(fr)): ausentes_item += [p for p in quem(fr) if p in todos]
        # quem pediu vista nesta reunião: diretor citado na frase do pedido (inclui "pediu vista o Diretor X" e "pedido de vista do Diretor X")
        vista = []
        if res.startswith('SOBRESTADO'):
            for fr in re.split(r'(?<=[.;])\s', dec):
                nf = norm(fr)
                if re.search(r'(?:pediu|solicitou|solicitaram|formulou)\s+(?:a\s+)?vistas?|pedido de vistas?\s+(?:pelo|do|da)|protocolado pedido de vista', nf) and not re.search(r'acesso aos autos', nf): vista += [p for p in quem(fr) if p in todos and p != rel]
        vista = list(dict.fromkeys(vista))
        d = {'reuniao': r['tag'], 'data': r['data'][6:] + '-' + r['data'][3:5] + '-' + r['data'][:2], 'processo': m[2], 'relator': rel, 'interessado': g('Interessad[oa]')[:200],
             'assunto': g('A\\s?ssunto')[:250], 'resultado': res, 'voto_doc': f'{voto[2]} {voto[3]}' if voto and not voto[1] else (f'Vista {voto[2]} {voto[3]}' if voto else ''), 'decisao_texto': dec[:700]}
        if voto and not voto[1]: d['voto_doc'] = f'{voto[2]} {voto[3]}'
        D.append(d)
        for p in pres + [a for a in aus if a not in pres]:
            if p == rel and p in aus and p not in pres and res != 'RETIRADO DE PAUTA': v, pv = 'RELATOR (voto escrito; ausência declarada na ata)', 'nominal'
            elif p in aus and p not in pres or p in ausentes_item: v, pv = 'AUSENTE', 'nominal'
            elif res == 'RETIRADO DE PAUTA': v, pv = 'SEM VOTO (retirado de pauta)', 'nominal' if p == rel else 'n/a'
            elif res == 'SOBRESTADO (vista coletiva)' and p in vista: v, pv = 'PEDIU VISTA', 'nominal'
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
    # etapa final (aditiva): revisão curada + cruzamento com os PDFs de voto (texto/OCR) + pendências com URL. Só roda se antt_revisao.json existir (degrada para o parse puro)
    import os
    if os.path.exists('antt_revisao.json'):
        import antt_votos_pdf, antt_finalizar
        antt_votos_pdf.main(sys.argv[1], 'antt_votos_pdf.json')
        antt_finalizar.main(sys.argv[2], sys.argv[1], 'antt_inventario.json', 'antt_votos_pdf.json', 'antt_revisao.json', 'antt_sem_ata.json')
