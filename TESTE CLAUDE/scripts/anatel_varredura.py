"""ANATEL: varredura 100% INDEPENDENTE do parser (nao importa anatel_parse.py nem reusa suas regexes). Le direto texto_anatel/ (acordaos s8, atas de reuniao s229,
atas de circuito s187) e extrai, para cada uma das deliberacoes de anatel.json, os FATOS NOMINAIS: relator, vencidos/divergentes, ausentes, impedidos/suspeitos,
pedinte de vista e quem 'nao pode se manifestar'. Compara com anatel.json e imprime TODA diferenca por categoria (falso positivo x erro real fica a cargo do humano).
Uso: python3 -I scripts/anatel_varredura.py [anatel.json]   (da raiz da pasta; nao escreve nada)"""
import re, sys, json, glob, collections, unicodedata
arq = sys.argv[1] if len(sys.argv) > 1 else 'anatel.json'
J = json.load(open(arq)); TXT = 'texto_anatel'
FULL = {'baigorri': 'Carlos Manuel Baigorri', 'alexandre': 'Alexandre Reis Siqueira Freire', 'siqueira freire': 'Alexandre Reis Siqueira Freire',
        'edson': 'Edson Victor Eugênio de Holanda', 'holanda': 'Edson Victor Eugênio de Holanda', 'octavio': 'Octavio Penna Pieranti', 'pieranti': 'Octavio Penna Pieranti',
        'vicente': 'Vicente Bandeira de Aquino Neto', 'aquino neto': 'Vicente Bandeira de Aquino Neto', 'cristiana': 'Cristiana Camarate Silveira Martins Leão Quinalia',
        'quinalia': 'Cristiana Camarate Silveira Martins Leão Quinalia', 'nilo': 'Nilo Pasquali', 'pasquali': 'Nilo Pasquali', 'suzana': 'Suzana Silva Rodrigues', 'susana': 'Suzana Silva Rodrigues'}
def asc(s): return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower()
PAT = re.compile('|'.join(sorted(map(re.escape, FULL), key=len, reverse=True)))
def nomes(s):
    o = []
    for m in PAT.finditer(asc(s)):
        n = FULL[m[0]]
        if n not in o: o.append(n)
    return o
def pl(s): return re.sub(r'\s+', ' ', s).strip()
SPL = re.compile(r'(?<=[a-zçãõáéíóú\)\"”0-9])\.\s+(?=[A-ZÁÉÍÓÚÂÊÔ])')
def sents(t): return [s for p in t.split('\n') for s in SPL.split(pl(p)) if s.strip()]
RE_PARCIAL = re.compile(r'acompanh\w+ a proposta do relator e prop\w+ altera', re.I)
RE_AUS = re.compile(r'f[ée]rias|licen[çc]a|miss[ãa]o oficial|afastad|ausen|viagem')

def le(p): return open(p, encoding='utf8').read()
# ------------------------------------------------------------------ fatos de um bloco de texto
def fatos_texto(S):
    F = {'venc': [], 'venc_B': [], 'parcial': [], 'sem_voto': [], 'imp': [], 'vista': [], 'aus': [], 'nao_votou': []}
    for s in S:
        a = asc(s)
        if RE_PARCIAL.search(s):
            F['parcial'] += [n for n in nomes(s.split('acompanh')[0]) if n not in F['parcial']]; continue
        if 'vencid' in a and not re.search(r'prazo|vencid[oa]s? o ', a[:0]):
            nm = nomes(s)
            F['venc'] += [n for n in nm if n not in F['venc']]
            for mv in re.finditer(r'vencid', a):   # C: nomes depois de 'vencid' ate 'nos termos'; sem nomes -> os do trecho anterior
                dep = nomes(re.split(r'nos termos|propondo|em relacao', a[mv.start():])[0]) or nomes(a[:mv.start()])
                F['venc_B'] += [n for n in dep if n not in F['venc_B']]
        if re.search(r'nao pode[m]? se manifestar', a): F['sem_voto'] += [n for n in nomes(s.split('nao pode')[0].split('considerando que')[-1]) if n not in F['sem_voto']]
        if re.search(r'\bimpedid[oa]s?\b|suspeic|suspeit', a) and not re.search(r'estacoes moveis|cemi|impedimento', a): F['imp'] += [n for n in nomes(s) if n not in F['imp']]
        if re.search(r'nao proferiu voto|nao votou|nao participou da votacao', a): F['nao_votou'] += [n for n in nomes(re.split(r' nao ', s)[0]) if n not in F['nao_votou']]
        if re.search(r'solicit\w+ vista|pediu vista|pedido de vista|vistor', a): F['vista'] += [n for n in nomes(s) if n not in F['vista']]
    return F

# ------------------------------------------------------------------ acordaos
AC = {}
for f in glob.glob(f'{TXT}/s8_*.txt'):
    t = le(f); m = re.search(r'Acórdão nº (\d+), de', t)
    if not m or 'acordam os membros' not in t: continue
    disp = t.split('\nACÓRDÃO\n', 1)[1]; disp = re.split(r'\n ?\|? ?Documento assinado|\nDocumento assinado', disp)[0]
    rel = pl((re.search(r'Conselheiro\(a\) Relator\(a\):\s*(.*)', t) or [0, ''])[1])
    fm = re.search(r'Fórum Deliberativo:\s*(Reunião Extraordinária|Reunião|Circuito Deliberativo) nº (\d+)', t)
    aus = [x for l in disp.split('\n') if re.match(r'^Ausentes?\b', l) for x in nomes(l)]
    F = fatos_texto(sents(disp)); F['aus'] = aus; F['rel'] = nomes(rel)[:1]
    F['participaram'] = [x for l in disp.split('\n') if re.match(r'^(Participaram|Participou)\b', l) for x in nomes(l)]
    F['forum'] = (fm[1], int(fm[2])) if fm else None
    AC[int(m[1])] = F

# ------------------------------------------------------------------ atas de reuniao (itens)
ATAIT = {}   # (tag, 'R'/'V'/..., n) -> fatos ; tag do titulo da ata
ATAHDR = {}
for f in glob.glob(f'{TXT}/s229_*.txt'):
    L = le(f).split('\n'); tm = next((re.match(r'^(\d+)ª REUNIÃO( EXTRAORDINÁRIA)? DO CONSELHO', l) for l in L if re.match(r'^(\d+)ª REUNIÃO', l)), None)
    if not tm: continue
    tag = ('RCDE' if tm[2] else 'RCD') + tm[1]
    hdr = ' '.join(L[3:6]); ATAHDR[tag] = {'aus': [x for s in sents(hdr) if re.search(r'^Ausentes?\b|\bAusentes?\b', s) for x in nomes(re.split(r'Ausentes?', s, 1)[1])]}
    sec = ''; relh = ''; cur = None; itens = []
    for l in L:
        ms = re.match(r'^PROCESSOS PAUTADOS EM SEDE DE (\w+)', l)
        if ms: sec = 'R' if ms[1].lower().startswith('relat') else 'V'; cur = None; continue
        if l.startswith('EXTRAPAUTA'): sec = 'X'; cur = None; continue
        mh = re.match(r'^(CONSELHEIR[OA]|PRESIDENTE)( SUBSTITUT[OA])?\s+([A-ZÇÃÕÁÉÍÓÚÂÊÔ ]+)$', l)
        if mh and sec in ('R', 'V'): relh = (nomes(mh[3]) or [''])[0]; cur = None; continue
        mi = re.match(r'^(\d{5}) - Processo: ([\d\.\/\-]+)', l)
        if mi and sec in ('R', 'V'):
            cur = {'n': int(mi[1]), 'sec': sec, 'hdr': relh, 'rel_linha': '', 'trazido': '', 'linhas': []}; itens.append(cur); continue
        if l.startswith('Nada mais havendo'): cur = None
        if cur is None: continue
        if re.match(r'^Relatora?:', l): cur['rel_linha'] = (nomes(l) or [''])[0]; continue
        if l.startswith('Trazido por:'): cur['trazido'] = (nomes(l) or [''])[0]; continue
        if l.startswith(('Tipo da Matéria', 'Parte(s)', 'Descrição:', 'Referência', ' |')) or re.match(r'^\d{3}\) ', l): continue
        cur['linhas'].append(l)
    for it in itens:
        F = fatos_texto(sents(' '.join(it['linhas']))); F['rel'] = [it['rel_linha'] or it['hdr']] if (it['rel_linha'] or it['hdr']) else []; F['hdr'] = it['hdr']; F['trazido'] = it['trazido']; F['sec'] = it['sec']
        F['texto'] = ' '.join(it['linhas'])
        ATAIT[(tag, it['sec'], it['n'])] = F

# ------------------------------------------------------------------ circuitos
CIRC = {}
for f in glob.glob(f'{TXT}/s187_*.txt'):
    t = '\n'.join(re.sub(r'^\s*\|\s*', '', l).rstrip(' |').strip() for l in le(f).split('\n') if l.strip(' |'))
    m = re.search(r'Circuito Deliberativo do Conselho Diretor N[ºo] (\d+)/2026', t)
    if not m: continue
    rel = re.search(r'Conselheiro\(a\) Relator\(a\):\s*\n(.*)', t)
    vt = t.split('Votos proferidos no Circuito:', 1)[1] if 'Votos proferidos no Circuito:' in t else ''
    votos = {}
    for mm in re.finditer(r'(?:Presidente Substituto|Presidente|Conselheiro Substituto|Conselheira Substituta|Conselheiro|Conselheira):\s*\n(.*?)\nVoto:\s*\n(.*?)(?=\n(?:Presidente|Conselheir[oa])[^\n]*:\s*\n|\nDocumento assinado|\nA autenticidade|\Z)', vt, re.S):
        n = (nomes(mm[1]) or [pl(mm[1])])[0]; votos[n] = pl(mm[2])
    dec = t.split('Decisão do Circuito Deliberativo:', 1)[1].split('Votos proferidos no Circuito:')[0] if 'Decisão do Circuito Deliberativo:' in t else ''
    F = fatos_texto(sents(dec)); F['rel'] = nomes(rel[1])[:1] if rel else []; F['votos'] = votos
    F['venc_voto'] = [n for n, v in votos.items() if re.match(r'(nao acompanha|diverge)', asc(v))]
    F['aus_voto'] = [n for n, v in votos.items() if RE_AUS.search(asc(v)) and not re.search(r'(voto|analise|documento sei) n', asc(v))]
    F['parcial_voto'] = [n for n, v in votos.items() if re.match(r'acompanha parcialmente', asc(v))]
    F['proprio'] = [n for n, v in votos.items() if not re.match(r'(acompanha|nao acompanha)', asc(v)) and not RE_AUS.search(asc(v))]
    CIRC[int(m[1])] = F

# ------------------------------------------------------------------ json por item
VT = collections.defaultdict(list)
for v in J['votos']: VT[(v['reuniao'], v['deliberacao'])].append(v)
DIFS = collections.defaultdict(list)
def dif(cat, d, msg): DIFS[cat].append((d['reuniao'], d['deliberacao'], msg))
def curto(n): return n.split()[0]
total = collections.Counter()
for d in J['deliberacoes']:
    k = (d['reuniao'], d['deliberacao']); rows = VT[k]; tag = d['reuniao']
    jdiv = {v['diretor'] for v in rows if v['voto'].startswith('DIVERGIU')}
    jaus = {v['diretor'] for v in rows if v['voto'].startswith('AUSENTE')}
    jimp = {v['diretor'] for v in rows if v['voto'].startswith('IMPEDIDO') or 'impedid' in asc(v['voto'])}
    jvis = {v['diretor'] for v in rows if v['voto'].startswith('PEDIU VISTA')}
    jrel = {v['diretor'] for v in rows if v['voto'].startswith('RELATOR')}
    jsv = {v['diretor'] for v in rows if v['voto'].startswith('SEM VOTO') and 'retirado' not in v['voto'] and 'vista pendente' not in v['voto']}
    fontes = []   # (nome_fonte, F)
    mac = re.match(r'Acórdão (\d+)/2026', d['deliberacao'])
    if mac: fontes.append(('acordao', AC[int(mac[1])]))
    if tag.startswith('CD'): fontes.append(('circuito', CIRC[int(tag[2:])]))
    mi = re.match(r'Item ([RV])(\d+) \((RCDE?\d+)\)', d['deliberacao'])
    if mi: fontes.append(('ata', ATAIT[(mi[3], mi[1], int(mi[2]))]))
    elif d['tipo_item'] != 'Aprovação de ata' and d['item_n'][:1] in 'RV' and d['item_n'][1:].isdigit() and (tag, d['item_n'][0], int(d['item_n'][1:])) in ATAIT: fontes.append(('ata', ATAIT[(tag, d['item_n'][0], int(d['item_n'][1:]))]))
    total['itens'] += 1
    if d['tipo_item'] == 'Aprovação de ata':
        total['atas'] += 1
        if jrel: dif('ata: RELATOR em aprovacao de ata', d, str(jrel))
        if any(p['modo'] == 'unanimidade' for p in d['partes']): dif('ata: modo unanimidade sem a fonte dizer', d, d['decisao_texto'][:100])
        continue
    if not fontes: dif('sem fonte localizada', d, ''); continue
    # --- vencidos
    venc = set(); vencB = set(); parc = set(); sv = set(); imp = set(); vis = set(); aus = set(); relf = set()
    for nome, F in fontes:
        venc |= set(F['venc']) | set(F.get('venc_voto', [])); vencB |= set(F['venc_B']) | set(F.get('venc_voto', [])); parc |= set(F['parcial']) | set(F.get('parcial_voto', []))
        sv |= set(F['sem_voto']); imp |= set(F['imp']); vis |= set(F['vista']); aus |= set(F['aus']) | set(F.get('aus_voto', [])); relf |= set(F['rel'])
    pt = set(F_ for _, F in fontes for F_ in F['parcial'])   # so o texto 'acompanhou e propos alteracoes' (CD215); 'acompanha parcialmente' + 'votou vencido' continua divergente
    venc -= pt; vencB -= pt
    vencB |= (set(n for _, F in fontes for n in F.get('venc_voto', [])))
    if vencB != jdiv:
        dif('vencidos: fonte x json', d, f'src_ampla={sorted(map(curto, venc))} src_apos_vencid={sorted(map(curto, vencB))} json={sorted(map(curto, jdiv))}')
    elif venc != jdiv: total['vencidos_so_na_varredura_ampla'] += 1
    if parc: dif('parcial (acompanha e propos alteracoes/parcialmente)', d, f'src={sorted(map(curto, parc))} json_voto={[(curto(v["diretor"]), v["voto"][:40]) for v in rows if v["diretor"] in parc]}')
    if imp != jimp: dif('impedidos: fonte x json', d, f'src={sorted(map(curto, imp))} json={sorted(map(curto, jimp))}')
    # --- ausentes: toda ausencia declarada na fonte deve estar no json
    if not aus <= jaus: dif('ausentes: declarado na fonte e AUSENTE no json', d, f'faltam no json={sorted(map(curto, aus - jaus))}')
    if mi or (d['tipo_item'] != 'Aprovação de ata' and ('ata' in [n for n, _ in fontes])):
        ah = ATAHDR.get(tag, {}).get('aus', [])
        if not set(ah) <= jaus: dif('ausentes: cabecalho da ata x json', d, f'faltam no json={sorted(map(curto, set(ah) - jaus))}')
    extra_aus = jaus - aus - set(ATAHDR.get(tag, {}).get('aus', []))
    if extra_aus: dif('AUSENTE no json sem declaracao explicita na fonte do item (derivado da presenca)', d, f'{sorted(map(curto, extra_aus))}')
    # --- vista
    if d['tipo_item'] in ('Vista',) or vis or jvis:
        trz = {F.get('trazido') for n, F in fontes if F.get('trazido')} - {''}
        if vis != jvis and not (not vis and jvis == trz): dif('pedinte de vista: fonte x json', d, f'src={sorted(map(curto, vis))} trazido_por={sorted(map(curto, trz))} json={sorted(map(curto, jvis))}')
        elif vis != jvis: total['vista_via_trazido_por'] += 1
    # --- relator
    if relf:
        if d['relator'] not in relf and not (len(fontes) > 1 and any(d['relator'] in set(F['rel']) for _, F in fontes)):
            fe = [F for n, F in fontes if n == 'circuito']
            if fe and not relf and fe[0]['proprio']: pass
            else: dif('relator: campo json x fonte', d, f'src={sorted(map(curto, relf))} json={curto(d["relator"]) if d["relator"] else "-"}')
    elif d['tipo_item'] == 'Deliberação': dif('relator: fonte sem relator extraivel', d, f'json={d["relator"]}')
    if d['relator'] and d['tipo_item'] == 'Deliberação' and d['relator'] in [x for x in FULL.values()]:
        if d['relator'] not in jrel and d['relator'] not in jsv and d['relator'] not in jaus:
            dif('relator sem linha RELATOR/SEM VOTO/AUSENTE no json', d, f'relator={curto(d["relator"])} linhas={[(curto(v["diretor"]), v["voto"][:22]) for v in rows]}')
    # --- RELATOR em ato procedural
    if d['tipo_item'] == 'Deliberação' and not mac and not tag.startswith('CD') and re.search(r'prorroga|diligencia', asc(d['decisao_texto'])):
        if any(v['voto'] == 'RELATOR (voto proferido)' for v in rows): dif('prorrogacao/diligencia com RELATOR (voto proferido)', d, '')
        for p in d['partes']:
            if p['modo'] == 'unanimidade' and not re.search(r'unanimidade', asc(d['decisao_texto'])): dif('prorrogacao/diligencia: modo unanimidade sem a fonte dizer', d, '')
    # --- sem voto "nao pode se manifestar"
    if sv and not (sv <= jsv or all(any(x['voto_por_parte'] and 'SEM VOTO' in x['voto_por_parte'] for x in rows if x['diretor'] == n) for n in sv)):
        dif('"nao pode se manifestar": sem voto no json', d, f'src={sorted(map(curto, sv))}')
    # --- relator ex-conselheiro ou dois relatores: relator da fonte precisa estar no rol

    # --- R1: acordao: quem 'participou' x linhas que votaram
    if mac:
        A_ = AC[int(mac[1])]; votaram = {v['diretor'] for v in rows if v['voto'].startswith(('ACOMPANHOU', 'DIVERGIU', 'RELATOR', 'VOTOU'))}
        sem_ = {v['diretor'] for v in rows if v['voto'].startswith('SEM VOTO')}
        if A_['participaram'] and set(A_['participaram']) - set(A_['sem_voto']) - votaram: dif('participou do acordao mas sem linha de voto', d, str(sorted(map(curto, set(A_['participaram']) - votaram))))
        if A_['participaram'] and votaram - set(A_['participaram']): dif('linha de voto de quem nao participou do acordao', d, str(sorted(map(curto, votaram - set(A_['participaram'])))))
        if sem_ - set(A_['nao_votou']) and not all('fora do rol' in v['voto'] for v in rows if v['diretor'] in sem_ - set(A_['nao_votou'])): dif('SEM VOTO sem base no acordao', d, str(sorted(map(curto, sem_ - set(A_['nao_votou'])))))
    # --- R2: circuito: voto declarado por conselheiro x linha
    if tag.startswith('CD'):
        C_ = CIRC[int(tag[2:])]; por = {v['diretor']: v for v in rows}
        for n, vt_ in C_['votos'].items():
            j = por.get(n); a_ = asc(vt_)
            if j is None: dif('circuito: conselheiro votante sem linha', d, curto(n)); continue
            if re.match(r'nao acompanha', a_) and not j['voto'].startswith('DIVERGIU'): dif('circuito: "Nao acompanha" sem DIVERGIU', d, f'{curto(n)} json={j["voto"][:30]}')
            elif re.match(r'acompanha', a_) and j['voto'].startswith(('AUSENTE', 'SEM VOTO', 'PEDIU')): dif('circuito: "Acompanha" com linha de ausencia/sem voto', d, f'{curto(n)} json={j["voto"][:30]}')
            elif n in C_['aus_voto'] and not j['voto'].startswith('AUSENTE'): dif('circuito: ausente declarado sem AUSENTE', d, f'{curto(n)} json={j["voto"][:30]}')
            elif n in C_['proprio'] and n not in C_['aus_voto'] and not j['voto'].startswith(('RELATOR', 'DIVERGIU', 'ACOMPANHOU', 'VOTOU')): dif('circuito: voto proprio com rotulo estranho', d, f'{curto(n)} {vt_[:40]} json={j["voto"][:30]}')
        if C_['proprio'] and len(C_['proprio']) == 1 and C_['rel'] and C_['proprio'][0] != C_['rel'][0] and mac is None: dif('circuito: voto proprio de quem nao e o relator', d, f'proprio={C_["proprio"]} relator={C_["rel"]}')
    # --- R4/R6: itens de ata
    if mi or (not mac and fontes and fontes[0][0] == 'ata'):
        A_ = [F for n, F in fontes if n == 'ata'][0]; tx = asc(A_['texto'])
        if d['tipo_item'] == 'Retirada de pauta' and not all(v['voto'].startswith(('SEM VOTO (retirado', 'AUSENTE')) for v in rows): dif('retirada de pauta com voto', d, str([(curto(v['diretor']), v['voto'][:25]) for v in rows]))
        if 'retirad' in tx and 'pauta' in tx and d['tipo_item'] != 'Retirada de pauta' and not mac: dif('texto diz retirada de pauta mas tipo_item difere', d, d['tipo_item'])
        for sx in sents(A_['texto']):
            ax = asc(sx)
            if re.search(r'antecipou seu voto|registrou voto|acompanhou integralmente|acompanhando integralmente', ax) and d['tipo_item'] == 'Vista':
                for n in nomes(re.split(r'antecipou|registrou|acompanh', sx)[0]):
                    j = [v for v in rows if v['diretor'] == n]
                    if j and not j[0]['voto'].startswith(('VOTOU', 'RELATOR', 'PEDIU')): dif('voto antecipado registrado na ata sem VOTOU', d, f'{curto(n)} json={j[0]["voto"][:30]}')
    # --- identidade: votos por conselheiro unicos
    if len({v['diretor'] for v in rows}) != len(rows): dif('linhas duplicadas por conselheiro', d, '')
print('vencidos achados so na varredura ampla (nomes extras que nao sao vencidos): ', total['vencidos_so_na_varredura_ampla'])
print('itens varridos:', total['itens'], '| aprovacoes de ata:', total['atas'], '| vista via "Trazido por":', total['vista_via_trazido_por'])
print('fontes lidas: acordaos', len(AC), '| itens de ata', len(ATAIT), '| circuitos', len(CIRC))
for cat, L in sorted(DIFS.items(), key=lambda kv: kv[0]):
    print(f'\n### {cat}: {len(L)}')
    for r in L[:int(sys.argv[2]) if len(sys.argv) > 2 else 60]: print('  ', r[0], '|', r[1], '|', r[2][:300])
