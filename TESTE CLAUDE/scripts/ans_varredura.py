"""ANS: VARREDURA 100% independente de ans.json contra as ATAS oficiais. NAO importa ans_parse.py nem ans_ata.py: extrai o texto direto do PDF (pdftotext) e
refaz a leitura com regex proprios. Mapeamento area -> diretor vem das ASSINATURAS da propria ata ("Fulano, Diretor(a) de Normas e Habilitacao dos Produtos").
Uso: python3 -I scripts/ans_varredura.py ans.json manifesto_ans.json [saida=ans_varredura.json]
Saida: taxas por verificacao (acertos/total), lista de divergencias e codigo 1 se alguma verificacao ficar < 95%."""
import sys, json, re, subprocess, hashlib, collections, os
d = json.load(open(sys.argv[1])); man = json.load(open(sys.argv[2])); saida = sys.argv[3] if len(sys.argv) > 3 else 'ans_varredura.json'
D, V, R = d['deliberacoes'], d['votos'], d['reunioes']
vb = collections.defaultdict(list)
for v in V: vb[(v['reuniao'], v['processo'], v['deliberacao'])].append(v)
ROTULOS = ('ACOMPANHOU', 'DIVERGIU', 'RELATOR', 'AUSENTE', 'IMPEDIDO', 'SEM VOTO', 'PEDIU VISTA', 'VOTOU', 'NÃO PARTICIPOU', 'VISTA COLETIVA')
SOBRENOME = [('Damous', 'Wadih Nemer Damous Filho'), ('Medeiros', 'Eliane Aparecida de Castro Medeiros'), ('Aquino', 'Jorge Antônio Aquino Lopes'), ('Secchin', 'Lenise Barcellos de Mello Secchin'), ('Soares', 'Carla de Figueiredo Soares')]
def nomes(seg): return sorted({n for k, n in SOBRENOME if k in seg}, key=lambda n: seg.find(next(k for k, nn in SOBRENOME if nn == n)))
def pdf_txt(f):
    t = subprocess.run(['pdftotext', '-layout', f, '-'], capture_output=True, text=True).stdout
    t = re.sub(r'\s+', ' ', t.replace('\u200b', ''))
    t = re.sub(r'\s+', ' ', re.sub(r'Ata de Reunião - DICOL.*?/ pg\. \d+', ' ', t))
    return re.sub(r'D\s?e\s?c\s?i\s?s\s?ã\s?o\s?:', 'Decisão:', t)
checks = collections.OrderedDict(); falhas = collections.defaultdict(list)
def ok(nome, cond, detalhe=''):
    c = checks.setdefault(nome, [0, 0]); c[1] += 1
    if cond: c[0] += 1
    else: falhas[nome].append(detalhe)
# ---------- 0) integridade do manifesto: sha256 recalculado de cada PDF baixado
for m in man:
    if m['formato'] == 'pdf' and m['ok']:
        ok('sha256 do manifesto = sha256 recalculado do arquivo (todos os PDFs)', hashlib.sha256(open(m['arquivo_local'], 'rb').read()).hexdigest() == m['sha256'], m['arquivo_local'])
atas = {m['ref']: m for m in man if m['tipo'] == 'ata_dicol' and m['ok']}
def mid(ref): return ('DICOLE%02d' % int(ref[1:])) if ref.startswith('X') else 'DICOL' + ref
AREAS = 'DIGES|DIOPE|DIPRO|DIFIS|DIDES|PRESI'
CARGO = [('Fiscaliza', 'DIFIS'), ('Produtos', 'DIPRO'), ('Operadoras', 'DIOPE'), ('Gest', 'DIGES'), ('Desenvolvimento', 'DIDES'), ('Presidente', 'PRESI')]
MESES = {m: i + 1 for i, m in enumerate('JANEIRO FEVEREIRO MARÇO ABRIL MAIO JUNHO JULHO AGOSTO SETEMBRO OUTUBRO NOVEMBRO DEZEMBRO'.split())}
# votos escritos (anexos) -> quem assina
ANEXO = {}
api = json.load(open('ans_inventario.json'))['dicol_api']
item_proc = {(r['chave'], i['id']): (re.findall(r'\d{5}\.\d{6}/\d{4}-\d{2}', i['assunto']) or [None])[0] for r in api['reunioes'] for i in r['itens']}
for m in man:
    if m['tipo'] == 'anexo_dicol' and m['ok'] and m['formato'] == 'pdf':
        k, _, iid = m['ref'].partition('_'); t = subprocess.run(['pdftotext', '-layout', m['arquivo_local'], '-'], capture_output=True, text=True).stdout
        h = re.search(r'(?m)^DIRETORA?\s*\n\s*(.+)$', t)
        if h and item_proc.get((k, iid)): ANEXO[(k, item_proc[(k, iid)])] = h[1].strip()
for ref, m in sorted(atas.items()):
    mi = mid(ref); T = pdf_txt(m['arquivo_local']); corpo_fim = T.find('Feitas essas'); corpo_fim = corpo_fim if corpo_fim > 0 else len(T)
    r = next(x for x in R if x['reuniao'] == mi); Ds = [x for x in D if x['reuniao'] == mi]
    cab = T[:T.find('youtube/ansreguladoraoficial')]
    # ---- 1) data
    h = re.search(r'REALIZADA EM (\d+) DE (\w+) DE (\d{4})', cab)
    d_ata = '%s-%02d-%02d' % (h[3], MESES[h[2].upper()], int(h[1])) if h else ''
    ok('data da reunião (cabeçalho da ata × JSON; erro de digitação do ano na ata conta como divergência explicada)', d_ata == r['data'] or (d_ata[5:] == r['data'][5:] and d_ata[:4] != r['data'][:4]), f'{mi} ata {d_ata} json {r["data"]}')
    # ---- 2) presenca / ausencia
    pr = re.search(r'contou com a presença (.*?)(?:\. Ausente|\. A reunião foi)', cab); pres_ata = set(nomes((pr[1] if pr else '')))
    pres_ata.add('Wadih Nemer Damous Filho')   # presidiu
    aus = re.search(r'Ausente[s]? (?:o|a) (.*?)(?:\. A reunião)', cab); aus_ata = set(nomes(aus[1])) if aus else set()
    ok('presentes (cabeçalho da ata × JSON)', pres_ata == set(r['presentes']), f'{mi} ata {sorted(pres_ata)} json {sorted(r["presentes"])}')
    ok('ausentes declarados na ata ⊆ ausentes do JSON', aus_ata <= set(r['ausentes']), f'{mi}')
    # ---- 3) mapa area -> diretor pelas assinaturas da ata
    mapa = {}
    for nm, cargo in re.findall(r'assinado eletronicamente por ([A-ZÀ-Úa-zà-ú ]+?), Diretor\(a\)(?:-Presidente)? ?(?:de |da )?([^,(]*)', T):
        for k, a in CARGO:
            if k in cargo: mapa[a] = next((n for kk, n in SOBRENOME if kk.lower() in nm.lower().replace('ô', 'o') or nm.split()[0].lower() in n.lower()), None)
    mapa.setdefault('PRESI', 'Wadih Nemer Damous Filho'); mapa.setdefault('DIDES', 'Wadih Nemer Damous Filho')
    ok('mapa área→diretor reconstruído das assinaturas da ata cobre as áreas dos diretores presentes', all(mapa.get(a) for a, dn in (('DIPRO', 'Lenise'), ('DIFIS', 'Eliane'), ('DIOPE', 'Jorge'), ('DIGES', 'Carla')) if any(dn in p_ for p_ in pres_ata)), f'{mi} {mapa}')
    # ---- 4) itens de sessao: cada "Decisão:" da ata <-> um item JSON
    corpo = T[:corpo_fim]; iaep = corpo.find('Circuito Deliberativo'); iaep = iaep if iaep > 0 else corpo.upper().find('CIRCUITO DELIBERATIVO'); sess = corpo[:iaep] if iaep > 0 else corpo
    n_dec = len(re.findall(r'Decisão:', sess)); itens_json = [x for x in Ds if not x['secao'].startswith('Blocão') and not x['processo'].startswith('BLOCAO')]
    ok('nº de "Decisão:" nas sessões da ata = nº de itens de sessão no JSON', n_dec == len(itens_json), f'{mi} ata {n_dec} json {len(itens_json)}')
    # blocos "N. [Processo: P] Assunto: ... Área Responsável: A Decisão: ..."
    blocos = re.findall(r'(?:Processo:\s*(\S+?)\s+)?(?:[^:]{0,400}?\s)?Assunto:\s*(.*?)\s*Área Responsável:\s*(\w+)\s*Decisão:\s*(.*?)(?=\s\d{1,2}[.)]\s+(?:Processo|Assunto):|\s[A-Z]\)\s+(?:Informe|Apreciaç|Delibera|Circuito)|$)', sess, re.I)
    ok('nº de blocos Assunto/Área/Decisão relidos = itens JSON', len(blocos) == len(itens_json), f'{mi} blocos {len(blocos)} json {len(itens_json)}')
    # casamento por (processo, ordem): usa o texto da decisao
    usados = set()
    for proc, assunto, area, dec in blocos:
        dec = dec.strip(); procn = (proc or '').rstrip('.,;')
        cand = [x for x in itens_json if x['id'] not in usados] if False else [x for x in itens_json if (x['processo'] == procn if procn else x['assunto'][:40] == re.sub(r'\s+', ' ', assunto)[:40]) and id(x) not in usados]
        if not cand: ok('item da ata encontrado no JSON (processo/assunto)', False, f'{mi} {procn or assunto[:50]}'); continue
        x = cand[0]; usados.add(id(x)); ok('item da ata encontrado no JSON (processo/assunto)', True)
        vs = vb[(x['reuniao'], x['processo'], x['deliberacao'])]
        # tipo_item
        if re.match(r'(?i)item retirado de pauta', dec): esp = 'Retirada de pauta'
        elif re.search(r'(?i)suspensa pelo pedido de (vistas?|dilig)', dec): esp = 'Vista'
        elif re.match(r'(?i)somente informe', dec) and not re.search(r'(?i)aprov', dec): esp = 'Informe'
        elif re.match(r'(?i)aprova[çc][ãa]o d(a|as) minutas? d(a|as) atas?', assunto.strip()): esp = 'Aprovação de ata'
        elif re.match(r'(?i)informe', assunto) and not re.search(r'(?i)aprov|deliber', dec): esp = 'Informe'
        else: esp = 'Deliberação'
        ok('tipo_item (Informe/Retirada/Vista/Ata/Deliberação) relido da decisão', x['tipo_item'] == esp, f'{mi} {procn or assunto[:40]}: ata→{esp} json→{x["tipo_item"]}')
        # impedidos
        mi_ = re.search(r'(?i)impedid[oa]s?\s+de\s+votar\s+(.{0,330})', dec); imp_ata = set()
        if mi_:
            seg = mi_[1]; cut = re.search(r'(?i),?\s+(?:o|os)\s+(?:voto|despacho)\b|\.\s+[A-ZÁ]|Processo', seg); imp_ata = set(nomes(seg[:cut.start()] if cut else seg))
        ok('impedidos (ata × JSON x[impedidos])', imp_ata == set(x.get('impedidos', [])), f'{mi} {procn}: ata {sorted(imp_ata)} json {x.get("impedidos")}')
        imp_json = {v['diretor'] for v in vs if v['voto'].startswith('IMPEDIDO')}
        ok('linhas IMPEDIDO nos votos = impedidos da ata', imp_ata == imp_json, f'{mi} {procn}')
        # votos
        pres = set(r['presentes']); aus_j = set(r['ausentes'])
        if esp in ('Informe',):
            ok('informe não tem votos', not vs, f'{mi} {procn}')
        else:
            ok('1 linha de voto por membro (presentes + ausentes) e sem duplicata', sorted(v['diretor'] for v in vs) == sorted(pres | aus_j), f'{mi} {procn}')
            ok('todos os rótulos de voto dentro da lista permitida', all(v['voto'].startswith(ROTULOS) for v in vs), f'{mi} {procn}')
        if esp in ('Deliberação', 'Aprovação de ata') and re.search(r'(?i)por unanimidade', dec):
            ok('unanimidade → ninguém DIVERGIU e todo presente não impedido ACOMPANHOU/RELATOR', all(v['voto'].startswith(('ACOMPANHOU', 'RELATOR')) for v in vs if v['diretor'] in pres - imp_ata) and not any(v['voto'].startswith('DIVERGIU') for v in vs), f'{mi} {procn}')
            # proveniencia: inferido so quando a ata diz so "por unanimidade"
            ok('proveniência inferido apenas em ACOMPANHOU/RELATOR de item "por unanimidade"', all(v['proveniencia'] != 'inferido' or v['voto'].startswith(('ACOMPANHOU', 'RELATOR')) for v in vs), f'{mi} {procn}')
            # relator
            area_v = re.search(r'(?i)(?:voto|despacho)(?:\s+(?:o|da|do|condutor))*\s+d[ao]\s+(' + AREAS + r')\b', dec + ' ' + assunto) or re.search(r'(?i)(?:voto|despacho)\s+n\s?[ºo°]?\s*:?\s*[\w./ -]*?/(' + AREAS + r')\b', dec + ' ' + assunto)
            a = (area_v[1] if area_v else area).upper()
            esp_rel = mapa.get(a); rel_j = [v for v in vs if v['voto'].startswith('RELATOR')]
            if (ref, procn) in ANEXO:
                nm = nomes(ANEXO[(ref, procn)])
                if nm: esp_rel = nm[0]
            if esp_rel and esp_rel in pres and esp_rel not in imp_ata and esp == 'Deliberação':
                ok('relator = diretor da área do voto citado na ata (ou signatário do voto escrito)', len(rel_j) == 1 and rel_j[0]['diretor'] == esp_rel and x['relator'] == esp_rel, f'{mi} {procn}: esperado {esp_rel} ({a}) json {x["relator"]}')
            else:
                ok('sem relator quando o diretor da área não vota (impedido/ausente) ou item de ata/PRESI sem diretor', not rel_j or not esp_rel or esp == 'Aprovação de ata', f'{mi} {procn}')
            # proveniencia nominal do relator quando ha voto escrito que nomeia
            if (ref, procn) in ANEXO and nomes(ANEXO[(ref, procn)]) and rel_j:
                ok('relator com voto escrito nomeando o diretor → proveniência nominal', rel_j[0]['proveniencia'] == 'nominal', f'{mi} {procn}')
        if esp == 'Retirada de pauta':
            ok('retirada → todos SEM VOTO (retirado de pauta)', all(v['voto'].startswith('SEM VOTO') for v in vs if v['diretor'] in pres), f'{mi} {procn}')
            ok('quem retirou (nome na ata) aparece no resultado', all(next(k for k, n in SOBRENOME if n == nm).upper() in x['resultado'].upper() for nm in nomes(dec)), f'{mi} {procn}')
        if esp == 'Vista':
            ped = nomes(re.sub(r'.*?pedido de (?:vistas?|diligência)', '', dec))
            ok('vista/diligência → o pedinte nominal tem PEDIU VISTA', bool(ped) and any(v['voto'] == 'PEDIU VISTA' and v['diretor'] == ped[-1] for v in vs), f'{mi} {procn}: pedinte {ped}')
    # ---- 5) blocao (AEP): processos e classes
    bl = [x for x in Ds if x['processo'].startswith('BLOCAO')]
    if iaep > 0:
        aep = corpo[iaep:]
        procs_ata = collections.Counter()
        for m_ in re.finditer(r'Processo\s*(?:n[ºo°.]{0,2}\s*)?:?\s*(\d{5})\.?(\d{6})/(\d{4})-?\s?(\d{2})\s*[.;,]?', aep, re.I): procs_ata['%s.%s/%s-%s' % m_.groups()] += 1
        ok('blocão: existe item agregado BLOCAO na reunião', len(bl) == 1, f'{mi}')
        if bl:
            b = bl[0]; ind = b['decisoes_individuais']; procs_json = collections.Counter(i['processo'] for i in ind if i['processo']) + collections.Counter(p for i in ind for p in i['processos_citados'])
            # processos que a ata cita no AEP como "Processo: P" (qualquer ocorrencia) devem estar nas decisoes individuais (processo ou citado)
            falta = [p for p in procs_ata if p not in procs_json]
            ok('blocão: todo processo citado como "Processo: P" no AEP aparece nas decisões individuais', not falta, f'{mi} faltam {falta[:5]}')
            ok('blocão: nº de decisões = nº de decisões relidas (unanimidade + retirado + apreciação) no AEP', len(ind) in (len(re.findall(r'(?i)Aprovad[oa]s? por unanimidade|Item retirado de pauta pel|Apreciação do voto', aep)),), f'{mi} json {len(ind)} ata {len(re.findall(r"(?i)Aprovad[oa]s? por unanimidade|Item retirado de pauta pel|Apreciação do voto", aep))}')
            n_ret = len(re.findall(r'(?i)Item retirado de pauta pel', aep)); n_imp = len(re.findall(r'(?i)impedid[oa]s? de votar', aep)); n_apr = len(re.findall(r'Apreciação do voto', aep))
            cl = b['classes']
            ok('blocão: retiradas de pauta (ata × JSON)', n_ret == cl.get('retirado de pauta', 0), f'{mi} ata {n_ret} json {cl.get("retirado de pauta", 0)}')
            ok('blocão: impedimentos (ata × JSON)', n_imp == cl.get('impedimento', 0), f'{mi} ata {n_imp} json {cl.get("impedimento", 0)}')
            ok('blocão: apreciações sem unanimidade (ata × JSON)', n_apr == cl.get('apreciação/outro', 0), f'{mi} ata {n_apr} json {cl.get("apreciação/outro", 0)}')
            # --- cada decisão individual relida no texto da ata (o trecho que termina em "Processo: P")
            TERM = r'Pro[ce]*s{1,3}o\s*(?:n[ºo°.]{0,2}\s*)?:?\s*\d{5}\.?\d{6}/\d{4}-?\s?\d{2}\s*[.;,]?'
            for i in ind:
                if not i['processo']: continue
                dg = re.sub(r'\D', '', i['processo']); rx = r'\.?\s?'.join([dg[:5], dg[5:11]]) + r'/' + dg[11:15] + r'-?\s?' + dg[15:17]
                ms = [m_ for m_ in re.finditer(r'Pro[ce]*s{1,3}o\s*(?:n[ºo°.]{0,2}\s*)?:?\s*' + rx, aep)]
                if not ms: ok('blocão: decisão individual localizada na ata pelo "Processo: P"', False, f'{mi} {i["processo"]}'); continue
                ok('blocão: decisão individual localizada na ata pelo "Processo: P"', True)
                fim = ms[-1].start(); janela = aep[max(0, fim - 5000):fim]
                ant = list(re.finditer(TERM, janela)); trecho = janela[ant[-1].end():] if ant else janela
                hh = list(re.finditer(r'[A-Z]\.\d\)\s+[^:]{3,90}:', trecho)); trecho = trecho[hh[-1].end():] if hh else trecho   # cabeçalho de subseção (F.1) Processos ...:)
                trecho = re.sub(r'^\s*(?:(?:\d+\s*)?[–-]\s*)?PAUTADO SDCOL\s*', '', trecho.strip()); trecho = re.sub(r'^\s*(?:\d\s?){1,4}[.)]\s*', '', trecho.strip())
                esp_cl = 'retirado de pauta' if re.match(r'(?i)item retirado de pauta', trecho) else 'apreciação/outro' if not re.match(r'(?i)aprovad', trecho) else 'impedimento' if re.search(r'(?i)impedid[oa]s? de votar', trecho) else 'unanimidade'
                ok('blocão: classe da decisão individual (unanimidade/impedimento/retirada/apreciação) relida na ata', esp_cl == i['classe'], f'{mi} {i["processo"]}: ata→{esp_cl} json→{i["classe"]}')
                ma = re.search(r'(?i)(?:voto|despacho)(?:\s+(?:o|da|do|condutor))*\s+d[ao]\s+(' + AREAS + r')\b', trecho) or re.search(r'(?i)(?:voto|despacho)\s+n\s?[ºo°]?\s*:?\s*[\w./ -]*?/(' + AREAS + r')\b', trecho)
                if esp_cl in ('unanimidade', 'impedimento'): ok('blocão: área condutora da decisão individual relida na ata', bool(ma) and ma[1].upper() == i['area_condutora'], f'{mi} {i["processo"]}: ata→{ma[1].upper() if ma else None} json→{i["area_condutora"]}')
                if esp_cl == 'impedimento':
                    mm_ = re.search(r'(?i)impedid[oa]s? de votar (.{0,300})', trecho); cut = re.search(r'(?i),?\s+(?:o|os)\s+(?:voto|despacho)\b|\.\s+[A-ZÁ]', mm_[1]) if mm_ else None
                    ok('blocão: impedidos da decisão individual relidos na ata', set(nomes(mm_[1][:cut.start()] if cut else mm_[1])) == set(i['impedidos']), f'{mi} {i["processo"]}')
            ok('blocão: todo exceção (retirada/impedimento/apreciação) virou item próprio', (n_ret + n_imp + n_apr) == sum(1 for x in Ds if x['secao'].startswith('Blocão (AEP) —')), f'{mi}')
            ok('blocão: processos_do_bloco = processos distintos das decisões', set(b['processos_do_bloco']) == {i['processo'] for i in ind if i['processo']}, f'{mi}')
    ok('reunião com ata tem ≥1 item', len(Ds) > 0, mi)
# ---------- 6) toda reuniao do JSON com fonte 'ata (DICOL)' tem o PDF no manifesto; todo PDF listado na API foi lido
ok('atas listadas na API oficial = atas baixadas e lidas', sum(1 for r_ in api['reunioes'] if r_['ata']) == len(atas), f'api {sum(1 for r_ in api["reunioes"] if r_["ata"])} baixadas {len(atas)}')
ok('toda reunião JSON com fonte "ata (DICOL)" tem o PDF no manifesto', all(any(m['url'] == f['url'] for m in man if m['ok']) for r_ in R for f in r_['fontes'] if f['tipo'] == 'ata (DICOL)'), '')
ok('votos: rótulos dentro da lista permitida (todas as agências-ANS)', all(v['voto'].startswith(ROTULOS) for v in V), str([v['voto'] for v in V if not v['voto'].startswith(ROTULOS)][:3]))
ok('votos: proveniência ∈ {nominal, inferido, REVISAR}', all(v['proveniencia'] in ('nominal', 'inferido', 'REVISAR') for v in V), '')
ok('deliberações: chave (reunião, processo, deliberação) única', len({(x['reuniao'], x['processo'], x['deliberacao']) for x in D}) == len(D), '')
ok('votos: chave (item, diretor) única', len({(v['reuniao'], v['processo'], v['deliberacao'], v['diretor']) for v in V}) == len(V), '')
ok('no máximo 1 RELATOR por item e relator preenchido ⇒ linha RELATOR (itens com voto)', all((sum(1 for v in vb[(x['reuniao'], x['processo'], x['deliberacao'])] if v['voto'].startswith('RELATOR')) <= 1) and (not x.get('relator') or any(v['voto'].startswith('RELATOR') and v['diretor'] == x['relator'] for v in vb[(x['reuniao'], x['processo'], x['deliberacao'])])) for x in D), '')
res = {k: dict(acertos=a, total=t, taxa=round(100 * a / max(1, t), 2)) for k, (a, t) in checks.items()}
tot_a = sum(a for a, t in checks.values()); tot_t = sum(t for a, t in checks.values())
json.dump(dict(verificacoes=res, total=dict(acertos=tot_a, total=tot_t, taxa=round(100 * tot_a / tot_t, 2)), divergencias={k: v[:40] for k, v in falhas.items()}), open(saida, 'w'), ensure_ascii=False, indent=1)
for k, v in res.items(): print(f"{v['acertos']:>6}/{v['total']:<6} {v['taxa']:>6}%  {k}")
print(f'TOTAL {tot_a}/{tot_t} = {100 * tot_a / tot_t:.2f}%')
for k, v in falhas.items(): print('DIVERGE', k, '->', v[:4])
sys.exit(0 if all(v['taxa'] >= 95 for v in res.values()) else 1)
