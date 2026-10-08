"""ANA: varredura 100% INDEPENDENTE do parser (nao importa ana_parse.py nem reusa suas regexes). Le direto texto_ana/ata_N.txt (maquina de estados por LINHA) e
confere, para TODAS as deliberacoes e TODOS os votos de ana.json: processo, relator (papel), tipo do item (vista/retirada/deliberacao/aprovacao de ata), unanimidade, SEI do voto,
numero de partes, secao (pauta/extrapauta), presenca por reuniao, conjunto de diretores por item e rotulo+proveniencia de cada voto. Tambem confere o inverso: cada item DLB
do texto existe no JSON (nada sobrando nem faltando). Imprime toda divergencia por categoria. Uso: python3 -I scripts/ana_varredura.py [ana.json]   (da raiz da pasta; nao escreve nada)"""
import re, sys, json, unicodedata, collections
J = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'ana.json'))
def asc(s): return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower()
def pl(s): return re.sub(r'\s+', ' ', s).strip()
NOMES = [('argolo', 'Ana Carolina Argolo'), ('larissa', 'Larissa Oliveira Rêgo'), ('battiston', 'Cristiane Collet Battiston'), ('cristiane', 'Cristiane Collet Battiston'), ('leonardo', 'Leonardo Góes Silva'), ('fioreze', 'Ana Paula Fioreze')]
def quem(s):
    a = asc(s); pos = {}
    for k, v in NOMES:
        i = a.find(k)
        if i >= 0 and (v not in pos or i < pos[v]): pos[v] = i
    return [v for v, _ in sorted(pos.items(), key=lambda kv: kv[1])]
div = collections.defaultdict(list); n_chk = collections.Counter()
def chk(cat, rot, ok, esp='', got=''):
    n_chk[cat] += 1
    if not ok: div[cat].append((rot, esp, got))
# ---------------- leitura por linha
def linhas(n):
    return [l for l in open(f'texto_ana/ata_{n}.txt', encoding='utf8').read().replace('\f', '\n').split('\n') if not re.search(r'Ata DIREC \d+\s+SEI .*pg\. \d+', l)]
ITENS_TXT = {}; PRES = {}
for r in J['reunioes']:
    n = int(r['reuniao'][2:])
    try: L = linhas(n)
    except FileNotFoundError:
        chk('reuniao sem ata', r['reuniao'], not r['presentes'] and not r['ausentes'] and not any(d['reuniao'] == r['reuniao'] for d in J['deliberacoes']), 'vazia', r['presentes']); continue
    # estado: CAB -> item -> fim
    cab = []; cur = None; blocos = []
    for l in L:
        m = re.match(r'\s*DLB\s*(\d+)\.\s*Processo\s*n[º°o]?\s*(\d{5}\.\d{6}/\d{4}-\d{2})', l)
        if m: cur = {'dlb': int(m[1]), 'proc': m[2], 'txt': []}; blocos.append(cur); continue
        if 'Nada mais havendo' in l: cur = None; continue
        (cur['txt'] if cur else cab).append(l)
    CAB = pl(' '.join(cab)); ITENS_TXT[n] = blocos
    i = CAB.find('Participaram'); fim = [CAB.find(t, i) for t in ('A pauta seguiu', ' v Leitura', ' § Leitura', 'O Diretor Leonardo', 'O Diretor') if CAB.find(t, i) > 0]
    seg = CAB[i:min(fim)] if fim else CAB[i:i + 500]
    pres = set(quem(seg)); decl = {}
    for m in re.finditer(r'(?:O|A) Diretor[a]? ([^.]{3,60}?),? n.o participou da reuni.o([^.]*)\.', CAB): decl.update({q: pl(m[2]) for q in quem(m[1])})
    PRES[n] = (pres, decl, quem(seg.split('que presidiu')[0].split('Participaram')[1])[-1] if 'que presidiu' in seg else None, CAB)
    # presenca do JSON
    chk('presenca: presentes', r['reuniao'], set(r['presentes']) == pres, sorted(pres), r['presentes'])
    colegiado = {v for v in ('Larissa Oliveira Rêgo', 'Cristiane Collet Battiston', 'Leonardo Góes Silva')} | ({'Ana Carolina Argolo'} if r['data'] <= '2026-07-05' else set()) | pres
    chk('presenca: ausentes = colegiado - presentes', r['reuniao'], set(r['ausentes']) == colegiado - pres, sorted(colegiado - pres), r['ausentes'])
    chk('presenca: nominal x omissao na obs', r['reuniao'], all((('ausente — "não participou' in r['obs'] and a in r['obs']) if a in decl else ('por omissão' in r['obs'])) for a in r['ausentes']), 'declarado' , r['obs'][:80])
    # data do corpo da ata x data da reuniao
    cd = re.search(r'No dia (.+?) de dois mil', CAB); mes = {m: i + 1 for i, m in enumerate('janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro'.split())}
    ext = {'um': 1, 'dois': 2, 'tres': 3, 'quinze': 15, 'desessete': 17, 'vinte e cinco': 25, 'vinte e oito': 28, 'trinta e um': 31, 'nove': 9, 'onze': 11, 'quatro': 4}
    mm = re.match(r'(.+?) de (?:de )?(\w+)$', asc(cd[1])) if cd else None
    chk('data do corpo da ata = data da reuniao', r['reuniao'], bool(mm) and mes.get(mm[2]) == int(r['data'][5:7]) and ext.get(mm[1].strip()) == int(r['data'][8:]), r['data'], cd and cd[1])
# ---------------- itens: texto -> JSON (nada falta) e JSON -> texto (nada sobra)
DJ = {(d['reuniao'], d['item_n']): d for d in J['deliberacoes'] if d['tipo_item'] != 'Aprovação de ata'}
for n, bl in ITENS_TXT.items():
    for b in bl: chk('item do texto existe no JSON', f'RD{n} DLB{b["dlb"]}', (f'RD{n}', str(b['dlb'])) in DJ, b['proc'], None)
txt_keys = {(f'RD{n}', str(b['dlb'])) for n, bl in ITENS_TXT.items() for b in bl}
for k in DJ: chk('item do JSON existe no texto', k, k in txt_keys)
APR = {(d['reuniao']): d for d in J['deliberacoes'] if d['tipo_item'] == 'Aprovação de ata'}
VOT = collections.defaultdict(list)
for v in J['votos']: VOT[(v['reuniao'], v['deliberacao'])].append(v)
for n, (pres, decl, presid, CAB) in PRES.items():
    a = APR.get(f'RD{n}'); m = re.search(r'Ata da (\d+)ª Reuni.o Deliberativa Ordin.ria,\s*realizada no dia (.+?),\s*teve sua leitura dispensada e foi aprovada', CAB)
    chk('aprovacao de ata: existe iff texto', f'RD{n}', bool(a) == bool(m), bool(m), bool(a))
    if a and m: chk('aprovacao de ata: ata anterior', f'RD{n}', a['processo'] == f'ATA RD{m[1]}', f'ATA RD{m[1]}', a['processo'])
# ---------------- campo a campo + votos
def esperado_tipo(dec):
    a = asc(dec[:380])
    return 'Vista' if 'prorrogacao do pedido de vista' in a else ('Retirada de pauta' if 'retirada de pauta' in a else 'Deliberação')
for (rid, dlb), x in sorted(DJ.items(), key=lambda kv: (kv[0][0], int(kv[0][1]))):
    n = int(rid[2:]); b = next(b for b in ITENS_TXT[n] if str(b['dlb']) == dlb); pres, decl, presid, CAB = PRES[n]
    T = pl(' '.join(b['txt'])); k = T.find('Decisão:'); mat, dec = T[:k], T[k:]
    chk('processo', x['deliberacao'], b['proc'] == x['processo'], b['proc'], x['processo'])
    pap = re.findall(r'(Relator[a]?(?:-vista)?|Proponente)\s*:\s*(.{3,100}?)$', mat); papel, quem_ = pap[-1] if pap else (None, '')
    exp_rel = (presid if papel == 'Proponente' else (quem(quem_) or [None])[0]) if papel else None
    chk('relator', x['deliberacao'], exp_rel == x['relator'], exp_rel, x['relator'])
    tp = esperado_tipo(dec); chk('tipo_item', x['deliberacao'], tp == x['tipo_item'], tp, x['tipo_item'])
    disp = dec[:dec.find(':', dec.find('elatoria')) + 1] if 'elatoria' in dec else dec[:500]
    unan = 'por unanimidade' in asc(disp); chk('unanimidade no resultado', x['deliberacao'], unan == ('unanimidade)' in x['resultado']), unan, x['resultado'])
    chk('decisao_texto integra', x['deliberacao'], pl(x['decisao_texto']) == pl(dec[len('Decisão:'):]), len(dec), len(x['decisao_texto']))
    if tp == 'Deliberação':
        sei = re.search(r'(?i)voto[^()]{0,60}?\d+\s*/\s*20\d\d[^()]{0,30}\(\s*(?:SEI\s*)?(\d{5,8})\s*\)', dec)
        chk('voto_doc (SEI)', x['deliberacao'], bool(sei) and f'SEI nº {sei[1]}' in x['voto_doc'], sei and sei[1], x['voto_doc'])
        enum = len(re.findall(r'(?:^|\s)(?:i|ii|iii|iv)\)\s', dec + ' ' + mat, flags=re.I))
        chk('partes>=2 iff enumeracao i) ii)', x['deliberacao'], (len(x['partes']) >= 2) == (enum >= 2), enum, len(x['partes']))
    else: chk('voto_doc vazio (vista/retirada)', x['deliberacao'], x['voto_doc'] == '', '', x['voto_doc'])
    extra = re.search(r'Extra-?pauta\.\s*(.*?)(?=\s(?:[v§]|Pauta)\s)', CAB)
    chk('secao extrapauta', x['deliberacao'], (x['secao'] == 'Extrapauta') == bool(extra and (b['proc'] in extra[1] or f'DLB {dlb}' in extra[1])), bool(extra), x['secao'])
    chk('ad referendum x obs', x['deliberacao'], ('ad referendum' in asc(mat + dec[:200])) == ('ad referendum' in x['obs']), '', x['obs'][:60])
    # votos
    vs = {v['diretor']: v for v in VOT[(rid, x['deliberacao'])]}
    r = next(r for r in J['reunioes'] if r['reuniao'] == rid); col = set(r['presentes']) | set(r['ausentes'])
    chk('votos: diretores do item = colegiado da reuniao', x['deliberacao'], set(vs) == col, sorted(col), sorted(vs))
    for dname, v in vs.items():
        ausente = dname not in pres
        if dname == exp_rel: fam = 'RELATOR'
        elif ausente: fam = 'AUSENTE'
        elif tp == 'Retirada de pauta': fam = 'SEM VOTO'
        elif tp == 'Vista': fam = 'SEM VOTO AINDA'
        else: fam = 'ACOMPANHOU'
        prov = 'nominal' if (fam == 'RELATOR' and not (ausente and dname not in decl)) or (ausente and dname in decl) else 'inferido'
        if fam == 'ACOMPANHOU' and len(x['partes']) >= 2: chk('voto_por_parte (todas as partes)', x['deliberacao'] + ' ' + dname, v['voto'].startswith('ACOMPANHOU todas as partes') and v['voto_por_parte'].count('ACOMPANHOU') == len(x['partes']), len(x['partes']), v['voto_por_parte'])
        chk('voto: rotulo e proveniencia', f'{x["deliberacao"]} {dname}', v['voto'].startswith(fam) and v['proveniencia'] == prov, f'{fam}/{prov}', f'{v["voto"][:45]}/{v["proveniencia"]}')
for rid, a in APR.items():
    n = int(rid[2:]); pres, decl, presid, CAB = PRES[n]
    for v in VOT[(rid, a['deliberacao'])]:
        fam = 'AUSENTE' if v['diretor'] not in pres else 'ACOMPANHOU'
        chk('voto: rotulo e proveniencia (ata)', f'{a["deliberacao"]} {v["diretor"]}', v['voto'].startswith(fam) and v['proveniencia'] == ('nominal' if fam == 'AUSENTE' and v['diretor'] in decl else 'inferido'), fam, v['voto'][:45] + '/' + v['proveniencia'])
    chk('votos da ata: um por membro do colegiado', a['deliberacao'], len(VOT[(rid, a['deliberacao'])]) == len(next(r for r in J['reunioes'] if r['reuniao'] == rid)['presentes']) + len(next(r for r in J['reunioes'] if r['reuniao'] == rid)['ausentes']))
OKR = ('ACOMPANHOU', 'DIVERGIU', 'RELATOR', 'AUSENTE', 'IMPEDIDO', 'SEM VOTO', 'PEDIU VISTA', 'VOTOU', 'NÃO PARTICIPOU', 'VISTA COLETIVA')
chk('rotulos permitidos', 'todos', all(v['voto'].startswith(OKR) for v in J['votos']), '', [v['voto'] for v in J['votos'] if not v['voto'].startswith(OKR)][:3])
chk('proveniencia permitida', 'todos', all(v['proveniencia'] in ('nominal', 'inferido', 'REVISAR') for v in J['votos']))
tot = sum(n_chk.values()); bad = sum(len(v) for v in div.values())
print(f'VARREDURA 100%: {tot} checagens sobre {len(DJ)} deliberacoes + {len(APR)} aprovacoes de ata, {len(J["votos"])} votos, {len(J["reunioes"])} reunioes; divergencias: {bad}')
for c in n_chk: print(f'  {c}: {n_chk[c]} checagens, {len(div.get(c, []))} divergencias')
for c, L in div.items():
    for x in L: print('DIVERGE', c, x)
sys.exit(1 if bad else 0)
