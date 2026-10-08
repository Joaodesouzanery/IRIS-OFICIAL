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
        dv = (re.search(r'(?:assinado|ssinado) eletronicamente por.{0,160}?em (\d{2}/\d{2}/\d{4})', re.sub(r'\s+', ' ', t)) or [None, None])[1]; dfx = dt(dv) if dv else None
        R.append({'reuniao': tag, 'titulo': f'Circuito Deliberativo nº {cd}/2026', 'tipo': 'Circuito Deliberativo', 'data': dfx, 'presentes': [], 'ausentes': [], 'obs': 'SEM ATA PUBLICADA (só o PDF de votos)'})
        D.append({'reuniao': tag, 'data': dfx, 'processo': proc, 'deliberacao': dlb, 'relator': rel[0] if rel else None, 'interessado': 'ANPD', 'assunto': ass, 'resultado': 'SEM ATA — só o voto do relator', 'voto_doc': '', 'decisao_texto': '', 'tipo_item': 'Só voto do relator (sem ata)', 'natureza': ''})
        if rel: V.append({'reuniao': tag, 'data': dfx, 'processo': proc, 'deliberacao': dlb, 'diretor': rel[0], 'voto': 'RELATOR (proposta; resultado sem ata)', 'proveniencia': 'nominal'})
        pend.append(['ANPD', tag, dfx, 'Ata do circuito não publicada (só PDF de votos)', 'PDF de votos existe; ata não', 'Circuito já realizado', 'Rodar rodar_tudo.sh; conferir a página de circuitos da ANPD'])
        continue
    t, ocr = txt(cd, 'ata'); h = re.sub(r'\s+', ' ', t); h = re.sub(r'Ata de Circuito Deliberativo n?[º°o²]? ?\d+/2026 \(\d+\) S[EI]+l? [\d./-]+ ?/ ?pg\. ?\d+', '', h)
    cab = h.split('Decisão do Circuito')[0] if 'Decisão do Circuito' in h else h.split('Decisao do Circuito')[0]
    corpo_ata = re.split(r'ATA DE CIRCUITO DELIBERATIVO', cab, maxsplit=1, flags=re.I)[-1]
    proc = (re.search(r'Process[o0] n\.?[º°o²]?\s*(\d[\d./-]+)', corpo_ata, re.I) or [None, ''])[1]
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
chk('Nº de votantes citados × "Total de votos" da própria ata', len(com_total), sum(1 for k in com_total if assin[k]['total'] == assin[k]['votantes']), f'{len(assin) - len(com_total)} atas por OCR sem a contagem')
chk('Acompanha + relator = Total (aritmética da ata)', len(com_total), sum(1 for k in com_total if (assin[k]['acomp'] or 0) + (assin[k]['nao'] or 0) + 1 == assin[k]['total']))
chk('Ata assinada por diretor do colegiado (presidente/substituta)', len(assin), sum(1 for a in assin.values() if a['assinante']))
nums = sorted(cds)
Q.append(['ANPD', 'Numeração dos circuitos 1..max sem buraco', 0, len([x for x in range(1, max(nums) + 1) if x not in nums]), 'OK' if nums == list(range(1, max(nums) + 1)) else 'EXCEÇÃO', f'1..{max(nums)} na página oficial'])
Q.append(['ANPD', 'Votos por circuito = 4 diretores (1 por membro do colegiado)', len(cds), sum(1 for c in cds if sum(1 for v in V if v['reuniao'] == f'CD{c:02d}') == (4 if f'cd-{c:02d}-ata' in man and man[f'cd-{c:02d}-ata']['ok'] else 1)), 'OK' if True else ''])
Q[-1][4] = 'OK' if Q[-1][2] == Q[-1][3] else 'DIVERGE'
cob = [['ANPD', 'Circuitos deliberativos 2026 na página oficial', len(cds), 'cd-01 a cd-%02d, sem buraco' % max(nums)],
       ['ANPD', 'Circuitos com ata lida', len(cds) - len(pend), f'{sum(1 for a in assin.values() if a["ocr"])} por OCR (cd-02, cd-04)'],
       ['ANPD', 'Reuniões deliberativas marcadas em 2026', 9, 'todas canceladas por "ausência de processos" (página de avisos); a deliberação ocorre por circuito']]
nf = [['ANPD', 'Voto individual em divergência', f'{sum(1 for v in V if v["proveniencia"] == "REVISAR")} linhas REVISAR', 'NÃO FEITO' if any(v['proveniencia'] == 'REVISAR' for v in V) else 'SEM CASOS', 'Quem não acompanhou o relator só consta no PDF de votos', 'Ler o PDF de votos nos circuitos com "não acompanha" > 0']]
json.dump({'reunioes': R, 'deliberacoes': D, 'votos': V, 'qualidade': Q, 'cobertura': cob, 'pendencias': pend, 'nao_feito': nf, 'diretores': [n for n, _ in ROST], 'colegiado': 'Conselho Diretor', 'meses_nota': ''}, open(out, 'w'), ensure_ascii=False, indent=1)
print(len(R), 'circuitos', len(D), 'delib', len(V), 'votos'); [print(q) for q in Q]
