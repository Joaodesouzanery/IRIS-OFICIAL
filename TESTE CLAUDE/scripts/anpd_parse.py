"""ANPD: parser das Atas de Circuito Deliberativo -> anpd.json (reunioes/deliberacoes/votos + cobertura/qualidade/pendencias/nao_feito).
Uso: python3 -I scripts/anpd_parse.py manifesto_anpd.json anpd.json   (le texto_anpd/ e texto_anpd_ocr/)"""
import re, sys, json, os, subprocess, unicodedata, datetime
man = json.load(open(sys.argv[1])); out = sys.argv[2]
ROST = [('Waldemar Gonçalves Ortunho Júnior', r'ortunho|waldemar'), ('Miriam Wimmer', r'wimmer|miriam'), ('Lorena Giuberti Coutinho', r'giuberti|lorena'), ('Iagê Zendron Miola', r'miola|zendron|iag[eé]|lag[eé]')]
def norm(s): return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
def quem(t):
    t = norm(t); return [n for n, p in ROST if re.search(p, t)]
def txt(cd, tipo):
    f = f'texto_anpd/cd-{cd:02d}-2026-{tipo}.txt'
    if os.path.exists(f): t = open(f, encoding='utf8').read()
    else: t = ''
    if len(t.strip()) < 400 and os.path.exists(f'texto_anpd_ocr/cd-{cd:02d}-2026-{tipo}.txt'): return open(f'texto_anpd_ocr/cd-{cd:02d}-2026-{tipo}.txt', encoding='utf8').read(), True
    return t, False
def dt(s): d, m, a = s.split('/'); return f'{a}-{m}-{d}'

import html as _html
def _toks(f):
    x = subprocess.run(['pdftotext', '-bbox', f, '-'], capture_output=True).stdout.decode('utf8', 'ignore'); out = []; pg = 0
    for line in x.splitlines():
        if '<page ' in line: pg += 1
        m = re.search(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="[\d.]+" yMax="[\d.]+">(.*?)</word>', line)
        if m: out.append((pg, float(m[2]), float(m[1]), _html.unescape(m[3])))
    return out
def votos_pdf(f):
    """PDF de votos do circuito (um formulario por diretor) -> ({diretor: 'RELATOR'|'ACOMPANHA'|'NAO'|'?'}, [datas de assinatura]).
    Associa cada formulario ao signatario ('assinado eletronicamente por ...') e le o X pela posicao vertical em relacao as opcoes
    'Acompanho/Acompanha a Relatoria' e 'Nao acompanho' (o X pode estar na linha da opcao, na de cima ou na de baixo)."""
    T = _toks(f); tx = [t[3] for t in T]; out = {}; datas = []; ult = 0
    for i in [i for i, w in enumerate(tx) if norm(w).startswith('assinado') and i + 1 < len(tx) and norm(tx[i + 1]).startswith('eletron')]:
        q = quem((' '.join(tx[i + 3:i + 12])).split(',')[0]); dm = re.search(r'em (\d{2}/\d{2}/\d{4})', ' '.join(tx[i:i + 40]))
        if dm: datas.append(dm[1])
        seg = T[ult:i]; ult = i
        if not q: continue
        A = N = None; Xs = []
        for k, (pg, y, x, w) in enumerate(seg):
            nw = norm(w); nx = norm(seg[k + 1][3]) if k + 1 < len(seg) else ''
            if re.fullmatch(r'acompanh[ao]', nw) and k > 0 and norm(seg[k - 1][3]) != 'nao' and nx in ('a', 'o'): A = A or (pg, y)
            if nw == 'nao' and re.fullmatch(r'acompanh[ao]', nx): N = N or (pg, y)
            if w in ('X', 'x'): Xs.append((pg, y))
        if not (A or N): out[q[0]] = 'RELATOR'; continue
        marca = None
        for xp, xy in Xs:
            ya = A[1] if A and A[0] == xp else None; yn = N[1] if N and N[0] == xp else None
            if ya is not None and ya - 8 <= xy and (yn is None or xy < yn - 8): marca = 'ACOMPANHA'
            elif yn is not None and yn - 8 <= xy < yn + 22: marca = 'NAO'
        out[q[0]] = marca or '?'
    return out, datas
cds = sorted({v['cd'] for v in man.values()})
R, D, V, Q_tot, pend, assin = [], [], [], [], [], {}
nums_esp = []
for cd in cds:
    has_ata = man.get(f'cd-{cd:02d}-ata', {}).get('ok')
    tag = f'CD{cd:02d}'; dlb = f'CD {cd}/2026'
    if not has_ata:
        # so votos publicados: le o voto (relator/assunto) e registra "so voto do relator"
        f = man.get(f'cd-{cd:02d}-votos', {}).get('arquivo')
        t = subprocess.run(['pdftotext', '-layout', f, '-'], capture_output=True).stdout.decode('utf8', 'ignore') if f else ''
        h = re.sub(r'\s+', ' ', t[:2500])
        proc = (re.search(r'PROCESSO N\.?[º°o]\s*(\d[\d./-]+)', h) or [None, ''])[1]
        rel = quem((re.search(r'RELATORA?\s+(.*?)\s+1\.\s+ASSUNTO', h) or [None, ''])[1])
        ass = (re.search(r'ASSUNTO\s+(.*?)\s+2\.\s+EMENTA', h) or [None, ''])[1].strip(' .')
        vp, datas = votos_pdf(f) if f else ({}, [])
        dfx = max((dt(x) for x in datas), default=None)   # fim do circuito = ultima assinatura
        rel = [n for n, v in vp.items() if v == 'RELATOR'] or rel
        pres = [n for n, _ in ROST if n in vp or n in rel]; aus = [n for n, _ in ROST if n not in pres]
        lidos = all(vp.get(n) in ('ACOMPANHA', 'NAO') for n in vp if n not in rel) and len(vp) >= 2
        R.append({'reuniao': tag, 'titulo': f'Circuito Deliberativo nº {cd}/2026', 'tipo': 'Circuito Deliberativo', 'data': dfx, 'presentes': pres, 'ausentes': aus, 'obs': 'SEM ATA PUBLICADA: votos lidos do PDF de votos (marcação X de cada diretor)'})
        nao_v = [n for n, v in vp.items() if v == 'NAO']
        res_ = ('APROVADO NO CIRCUITO — todos os votantes acompanharam o relator (lido do PDF de votos; ata não publicada)' if lidos and not nao_v
                else 'DIVERGÊNCIA — há voto que não acompanha o relator (PDF de votos; ata não publicada)' if nao_v else 'SEM ATA — marcação do PDF de votos ilegível (revisar)')
        D.append({'reuniao': tag, 'data': dfx, 'processo': proc, 'deliberacao': dlb, 'relator': rel[0] if rel else None, 'interessado': 'ANPD', 'assunto': ass, 'resultado': res_, 'voto_doc': '', 'decisao_texto': f'Sem ata: PDF de votos com {len(vp)} diretores ({sum(1 for v in vp.values() if v == "ACOMPANHA")} acompanham o relator, {len(nao_v)} não acompanham)', 'tipo_item': 'Deliberação (lida do PDF de votos, sem ata)', 'natureza': ''})
        for n, _ in ROST:
            base = {'reuniao': tag, 'data': dfx, 'processo': proc, 'deliberacao': dlb, 'diretor': n}; v = vp.get(n)
            if n in rel: V.append(dict(base, voto='RELATOR (voto proferido)', proveniencia='nominal'))
            elif v == 'ACOMPANHA': V.append(dict(base, voto='ACOMPANHOU', proveniencia='nominal'))
            elif v == 'NAO': V.append(dict(base, voto='DIVERGIU (não acompanhou o relator, PDF de votos)', proveniencia='nominal'))
            elif v == '?': V.append(dict(base, voto='VOTOU (marcação ilegível no PDF de votos)', proveniencia='REVISAR'))
            else: V.append(dict(base, voto='SEM VOTO (não votou no circuito)', proveniencia='nominal'))
        assin[tag] = {'assinante': None, 'total': None, 'votantes': len(set(vp) | set(rel)), 'acomp': None, 'nao': None, 'ocr': False, 'rel': rel, 'voters': list(vp), 'sem_ata': True}
        pend.append(['ANPD', tag, dfx, 'Ata do circuito não publicada (só PDF de votos)', 'PDF de votos existe; ata não', 'Votos individuais lidos do PDF de votos; falta só a ata oficial (data de encerramento e contagem)', 'Rodar rodar_tudo.sh; conferir a página de circuitos da ANPD'])
        continue
    t, ocr = txt(cd, 'ata'); h = re.sub(r'\s+', ' ', t); h = re.sub(r'Ata de Circuito Deliberativo n?[º°o²]? ?\d+/2026 \(\d+\) S[EI]+l? [\d./-]+ ?/ ?pg\. ?\d+', '', h)
    cab = h.split('Decisão do Circuito')[0] if 'Decisão do Circuito' in h else h.split('Decisao do Circuito')[0]
    corpo_ata = re.split(r'ATA DE CIRCUITO DELIBERATIVO', cab, maxsplit=1, flags=re.I)[-1]
    proc = (re.search(r'Pr[o0]cess[o0]\s+n\.?\s*[º°o²?]?\s*(\d[\d./-]+)', corpo_ata, re.I) or [None, ''])[1]   # tolera OCR ('Pr0cess0')
    inter = re.sub(r'\s*Fim:?$', '', (re.search(r'Interessado:\s*(.*?)\s+(?:Per[ií]odo|Periodo)', cab) or [None, 'ANPD'])[1].strip())
    per = re.search(r'(\d{2}/\d{2}/\d{4})\s+(\d{2}/\d{2}/\d{4})', cab); ini, fim = (dt(per[1]), dt(per[2])) if per else (None, None)
    nat = re.sub(r'\s*mat[eé]ria\s*$', '', (re.search(r'Natureza da\s+(?:matéria|materia)?\s*(.*?)\s+Assunto', cab) or [None, ''])[1].strip(), flags=re.I).strip()
    ass = (re.search(r'Assunto\s+(.*?)\s+Diretor\(a\)', cab) or [None, ''])[1].strip()
    rel = quem((re.search(r'Diretor\(a\)\s+(.*?)\s+Relator\(a\)', cab) or [None, ''])[1])
    vdoc = (re.search(r'VOTO N[º°o²]?\s*([\d/]+\S*)', cab) or [None, ''])[1]
    corpo = h.split('Decisão do Circuito')[-1] if 'Decisão do Circuito' in h else h
    def num(p):
        m = re.search(p + r'\s+(\d+)', re.sub(r'\bdos\b', '', corpo)); return int(m[1]) if m else None
    total = (lambda m: int(m[1]) if m else None)(re.search(r'Total de votos no Circuito.{0,90}?\b(\d)\b(?!\s*/)', corpo.replace('2026',''))); acomp = num(r'Acompanha (?:o relator|a relatora)'); nao = num(r'N[aã]o acompanha (?:o relator|a relatora)')
    levar = (re.search(r'Levar [àa] Reuni[aã]o Deliberativa\s+(Sim|N[aã]o)', h) or [None, ''])[1]
    vot_txt = re.split(r'Votos proferidos no Circuito Deliberativo', h)[-1].split('Documento assinado')[0].split('Documento assinado eletronicamente')[0]
    voters = quem(vot_txt)
    assinante = quem((re.search(r'ssinado eletronicamente por\s+(.*?),\s*Diretor', h) or [None, ''])[1])
    if not rel: rel = voters[:1]
    pres = [n for n, _ in ROST if n in voters or n in rel]; aus = [n for n, _ in ROST if n not in pres]
    R.append({'reuniao': tag, 'titulo': f'Circuito Deliberativo nº {cd}/2026', 'tipo': 'Circuito Deliberativo', 'data': fim, 'inicio': ini, 'presentes': pres, 'ausentes': aus, 'obs': 'ata lida por OCR (sem acentos; contagens em branco)' if ocr else ''})
    if nao: res_ = 'DIVERGÊNCIA — há voto que não acompanha o relator (nomes só nos PDFs de voto)'
    elif levar.lower().startswith('s'): res_ = 'LEVADO À REUNIÃO DELIBERATIVA'
    else: res_ = 'APROVADO NO CIRCUITO — todos os votantes acompanharam o relator'
    D.append({'reuniao': tag, 'data': fim, 'processo': proc, 'deliberacao': dlb, 'relator': rel[0] if rel else None, 'interessado': inter, 'assunto': ass, 'resultado': res_, 'voto_doc': vdoc, 'decisao_texto': (f'Total de votos {total}; acompanha {acomp}; não acompanha {nao}; levar à reunião: {levar}' if total is not None else f'Contagens ilegíveis no OCR da ata; levar à reunião: {levar}'), 'natureza': nat, 'tipo_item': 'Deliberação'})
    for n, _ in ROST:
        base = {'reuniao': tag, 'data': fim, 'processo': proc, 'deliberacao': dlb, 'diretor': n}
        if n in rel: V.append(dict(base, voto='RELATOR (voto proferido)', proveniencia='nominal'))
        elif n in voters: V.append(dict(base, voto='ACOMPANHOU' if not nao else 'VOTOU (divergência no circuito; ver PDF de votos)', proveniencia='nominal' if not nao else 'REVISAR'))
        else: V.append(dict(base, voto='SEM VOTO (não votou no circuito)', proveniencia='nominal'))
    assin[tag] = {'assinante': assinante, 'total': total, 'votantes': len(set(voters) | set(rel)), 'acomp': acomp, 'nao': nao, 'ocr': ocr, 'rel': rel, 'voters': voters}
# ---- Qualidade (fontes independentes entre si)
Q = []
def chk(nome, esp, obs, nota=''): Q.append(['ANPD', nome, esp, obs, 'OK' if esp == obs else 'DIVERGE', nota])
com_total = [k for k, a in assin.items() if a['total'] is not None]
chk('Nº de votantes citados × "Total de votos" da própria ata', len(com_total), sum(1 for k in com_total if assin[k]['total'] == assin[k]['votantes']), f'{sum(1 for a in assin.values() if a["ocr"])} atas por OCR sem a contagem; {sum(1 for a in assin.values() if a.get("sem_ata"))} circuito sem ata (votos do PDF)')
chk('Acompanha + relator = Total (aritmética da ata)', len(com_total), sum(1 for k in com_total if (assin[k]['acomp'] or 0) + (assin[k]['nao'] or 0) + 1 == assin[k]['total']))
com_ata = [a for a in assin.values() if not a.get('sem_ata')]
chk('Ata assinada por diretor do colegiado (presidente/substituta)', len(com_ata), sum(1 for a in com_ata if a['assinante']))
nums = sorted(cds)
Q.append(['ANPD', 'Numeração dos circuitos 1..max sem buraco', 0, len([x for x in range(1, max(nums) + 1) if x not in nums]), 'OK' if nums == list(range(1, max(nums) + 1)) else 'EXCEÇÃO', f'1..{max(nums)} na página oficial'])
Q.append(['ANPD', 'Votos por circuito = 4 diretores (1 por membro do colegiado)', len(cds), sum(1 for c in cds if sum(1 for v in V if v['reuniao'] == f'CD{c:02d}') == 4), '', ''])
Q[-1][4] = 'OK' if Q[-1][2] == Q[-1][3] else 'DIVERGE'
chk('Processo preenchido em todos os circuitos (inclusive os lidos por OCR)', len(cds), sum(1 for d in D if d['processo']))
# PDF de votos x ata: quem assinou formulario de voto (relator ou X em 'acompanho') = votantes da ata
_vp_ok = _vp_n = 0
for c in cds:
    fa = man.get(f'cd-{c:02d}-ata', {}).get('ok'); fv = man.get(f'cd-{c:02d}-votos', {}).get('arquivo')
    if fa and fv:
        vp, _ = votos_pdf(fv)
        if len(vp) >= 2:
            _vp_n += 1; a = assin[f'CD{c:02d}']; _vp_ok += int({n for n, v in vp.items() if v in ('ACOMPANHA', 'RELATOR')} <= (set(a['voters']) | set(a['rel'])))
chk('PDF de votos (X em acompanho) × votantes da ata: formulários marcados ⊆ votantes da ata', _vp_n, _vp_ok, 'confere a leitura do X contra a fonte independente (ata)')
cob = [['ANPD', 'Circuitos deliberativos 2026 na página oficial', len(cds), 'cd-01 a cd-%02d, sem buraco' % max(nums)],
       ['ANPD', 'Circuitos com ata lida', len(cds) - len(pend), f'{sum(1 for a in assin.values() if a["ocr"])} por OCR (cd-02, cd-04)'],
       ['ANPD', 'Reuniões deliberativas marcadas em 2026 (página oficial de avisos, modificada em 11/09/2026)', 9, 'todas 9 constam como "Reunião cancelada em função de ausência de processos" (23/01 a 18/09); a deliberação ocorre só por circuito. Conferido na página em 08/10/2026; reuniões após 18/09 não constam da página']]
nf = [['ANPD', 'Voto individual em divergência', f'{sum(1 for v in V if v["proveniencia"] == "REVISAR")} linhas REVISAR', 'NÃO FEITO' if any(v['proveniencia'] == 'REVISAR' for v in V) else 'SEM CASOS', 'Quem não acompanhou o relator só consta no PDF de votos', 'Ler o PDF de votos nos circuitos com "não acompanha" > 0']]
json.dump({'reunioes': R, 'deliberacoes': D, 'votos': V, 'qualidade': Q, 'cobertura': cob, 'pendencias': pend, 'nao_feito': nf, 'diretores': [n for n, _ in ROST], 'colegiado': 'Conselho Diretor', 'meses_nota': ''}, open(out, 'w'), ensure_ascii=False, indent=1)
print(len(R), 'circuitos', len(D), 'delib', len(V), 'votos'); [print(q) for q in Q]
