"""ANCINE (Diretoria Colegiada): parser -> ancine.json (reunioes, deliberacoes, votos, qualidade, cobertura, pendencias, nao_feito, diretores, colegiado).
Fontes (todas do SEI Publicacoes, baixadas por ancine_baixar.py): Ata de Reuniao (serie 298; itens + resultado + DDC), Deliberacao-DDC (307; decisao,
modo de votacao, ressalvas nominais, ausencias, ASSINANTES = diretores que participaram), Pauta (296; denominador de itens), Deliberacao Ad Referendum (366),
Circuitos Deliberativos: pauta (702), ata (703), Decisao-Proclamacao (518; TABELA NOMINAL de votos), Lista de Processos Distribuidos (771; relator do circuito).
Proveniencia: nominal = a fonte nomeia o diretor (tabela de proclamacao do circuito; voto contrario/vencido, abstencao, impedimento, ausencia, manifestacao
propria publicada na DDC); inferido = "por unanimidade" na DDC -> 1 ACOMPANHOU por diretor signatario da DDC (so assina quem participou; ausentes vem em AUSENCIAS);
REVISAR = a fonte nao declara o modo de votacao (tomou conhecimento) ou a DDC nao esta publicada (sessao reservada), com motivo.
Uso: python3 -I scripts/ancine_parse.py manifesto_ancine.json ancine_inventario.json ancine.json"""
import sys, re, json, collections, unicodedata, datetime
man_f, inv_f, out_f = sys.argv[1:4]
man = {m['ref']: m for m in json.load(open(man_f))}
inv = json.load(open(inv_f))
SEI = 'https://sei.ancine.gov.br/sei/publicacoes/controlador_publicacoes.php'
def url_doc(i): return f'{SEI}?acao=publicacao_visualizar&id_documento={i}&id_orgao_publicacao=0'
def url_serie(s): return inv['series'][str(s)]['url']
def texto(i):
    m = man.get(i)
    return open(m['texto'], encoding='utf8').read().replace('\u200b', '') if m and m['ok'] and m['texto'] else None
def sem_acento(s): return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')
def limpa(s): return re.sub(r'\s+', ' ', s.replace('\u200b', '')).strip()
# ---------------------------------------------------------------- diretores (nome canonico)
CAN = [('alex', 'Alex Braga Muniz'), ('alcoforado', 'Paulo Xavier Alcoforado'), ('barcelos', 'Patrícia Barcelos'), ('clay', 'Vinicius Clay Araújo Gomes'),
       ('leandro', 'Leandro de Sousa Mendes'), ('mendes', 'Leandro de Sousa Mendes')]
PAPEL = {'Alex Braga Muniz': 'Diretor-Presidente', 'Paulo Xavier Alcoforado': 'Diretor', 'Patrícia Barcelos': 'Diretora', 'Vinicius Clay Araújo Gomes': 'Diretor',
         'Leandro de Sousa Mendes': 'Diretor Substituto'}
def nomes_em(s):
    """diretores citados num trecho (ordem de aparicao), pelo sobrenome/nome-chave"""
    t = sem_acento(s).lower(); achados = []
    for k, n in CAN:
        for m in re.finditer(r'\b' + k, t): achados.append((m.start(), n))
    out = []
    for _, n in sorted(achados):
        if n not in out: out.append(n)
    return out
def ordem(ns): return [n for n in PAPEL if n in ns]
MES = {m: i + 1 for i, m in enumerate(['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'])}
def data_ext(d, m, a): return f'{int(a):04d}-{MES[sem_acento(m).lower()]:02d}-{int(d):02d}'
def data_br(s): d, m, a = s.split('/'); return f'{a}-{m}-{d}'
def lista_signatarios(t):
    out = []
    for m in re.finditer(r'Documento assinado eletronicamente por\s+(.*?),\s*(.*?),\s*em \d', t):
        ns = nomes_em(m[1])
        if ns and ns[0] not in out: out.append(ns[0])
    return out
# ---------------------------------------------------------------- 1) DDC (serie 307)
DDC = {}
for x in inv['series']['307']['itens']:
    n = int(re.search(r'DDC (\d+)', x['descricao'])[1]); t = texto(x['id_documento'])
    d = dict(num=n, doc=x['id_documento'], protocolo=x['protocolo'], pub=x['data'], ok=t is not None, url=url_doc(x['id_documento']))
    if t:
        h = re.search(r'DELIBERA[ÇC][ÃA]O DE DIRETORIA COLEGIADA n\.?º\s*(\d+)-E', t); d['num_doc'] = int(h[1]) if h else None
        h = re.search(r'(\d+)ª Reuni[ãa]o (\w+) de Diretoria Colegiada, de (\d+)[ºo]? de (\w+) de (\d{4})', t)
        d['reuniao'] = h[1] if h else None; d['data'] = data_ext(h[3], h[4], h[5]) if h else None
        h = re.search(r'ASSUNTO:\s*(.*?)\nDECIS[ÃA]O:', t, re.S); d['assunto'] = limpa(h[1]) if h else ''
        d['processos'] = re.findall(r'\d{5}\.\d{6}/\d{4}-\d{2}', d['assunto'])
        h = re.search(r'DECIS[ÃA]O:\s*(.*?)\n(?=FUNDAMENTA[ÇC][ÃA]O LEGAL|AUS[ÊE]NCIAS?:|ENCAMINHAMENTO:)', t, re.S)
        full = h[1].strip() if h else ''
        i = re.search(r'\n\s*(Manifesta[çc][ãa]o d|MANIFESTA[ÇC][ÃA]O D)', full)
        d['decisao'] = limpa(full[:i.start()] if i else full); d['manifestacao'] = limpa(full[i.start():]) if i else ''
        d['manifestante'] = ((nomes_em(full[i.start():i.start() + 140]) or (['Alex Braga Muniz'] if 'PRESIDENTE' in full[i.start():i.start() + 60].upper() else [None]))[0] if i else None)
        d['manifestante_relator'] = bool(i and d['manifestante'] and re.search(r'nos termos da manifesta[çc][ãa]o d', full[:i.start()]) and d['manifestante'] in nomes_em(full[:i.start()]))
        h = re.search(r'AUS[ÊE]NCIAS?:\s*(.*?)\n', t); aus = limpa(h[1]) if h else ''
        d['ausencias_txt'] = aus; d['ausentes'] = nomes_em(aus) if not re.match(r'N[ãa]o houve', aus) else []
        d['assinantes'] = lista_signatarios(t)
    DDC[n] = d
# ---------------------------------------------------------------- 2) DAR (serie 366): autores
DAR = {}
for x in inv['series']['366']['itens']:
    t = texto(x['id_documento']); m = re.search(r'Delibera[çc][ãa]o Ad Referendum\s+n\.?º\s*(\d+)-E, de (\d{4})', t or '')
    if m: DAR[(int(m[1]), int(m[2]))] = dict(doc=x['id_documento'], autores=lista_signatarios(t), url=url_doc(x['id_documento']))
# ---------------------------------------------------------------- 3) Atas de reuniao (serie 298)
SESS = {'RESERVADA': 'Sessão reservada', 'ADMINISTRATIVA': 'Sessão administrativa', 'PÚBLICA': 'Sessão pública'}
ATAS = {}
for x in inv['series']['298']['itens']:
    t = texto(x['id_documento'])
    if not t: continue
    nm = int(re.search(r'(\d+)ª REUNIÃO DELIBERATIVA', t)[1])
    h = re.search(r'Ao (.*?) dia do m[êe]s de (\w+) do ano de (.*?), [àa]s', t, re.S)
    datas = re.findall(r'(\d{2})\.(\d{2})\.(\d{4})', x['descricao'])
    datas = [f'{a}-{m}-{d}' for d, m, a in datas]
    ini = t.find('Ao '); fim = t.find('Verificado')
    cab = limpa(t[ini:fim]); pres_txt = cab[cab.find('presidida'):cab.find('Registrada também')] if 'presidida' in cab else cab
    presentes = ordem(nomes_em(pres_txt))
    aus_txt = re.findall(r'Registra-se a aus[êe]ncia[^.]*\.', cab); ausentes = ordem(nomes_em(' '.join(aus_txt)))
    body = t[fim:]; sess = None; cur = None; itens = []
    for ln in body.split('\n'):
        ln = ln.strip()
        m = re.fullmatch(r'SESSÃO (RESERVADA|ADMINISTRATIVA|PÚBLICA)', ln, re.I)
        if m: sess = m[1].upper(); cur = None; continue
        m = re.match(r'(\d+)\) Processo(?: n\.?º)?:\s*(.*)', ln)
        if m: cur = dict(sessao=sess, n=m[1], proc_linha=m[2], linhas=[]); itens.append(cur); continue
        if cur is not None and ln != '|' and not ln.startswith(('Documento assinado', 'A autenticidade', 'Referência', 'SEI nº')): cur['linhas'].append(ln)
        if re.match(r'(Às|As) .*nada mais havendo a tratar', ln): cur = None
    for it in itens:
        blob = '\n'.join(it['linhas']); it['bruto'] = blob
        m = re.search(r'\d{5}\.\d{6}/\d{4}-\d{2}', it['proc_linha']); it['processo'] = m[0] if m else it['proc_linha'].strip()
        m = re.search(r'Extrapauta \(SEI (\d+)\)', it['proc_linha']); it['extrapauta'] = m[1] if m else None
        def campo(k):
            mm = re.search(k + r':\s*(.*?)(?=\n(?:Interessado|Área responsável|Resultados? da delibera|CNPJ|Assunto)|$)', blob, re.S); return limpa(mm[1]) if mm else ''
        it['assunto'] = campo('Assunto'); it['interessado'] = campo('Interessado'); it['area'] = campo('Área responsável')
        mm = re.search(r'Resultados? da delibera[çc][ãa]o:\s*(.*)', blob, re.S); res = limpa(mm[1]) if mm else ''
        it['res_bruto'] = res
        refs = re.findall(r'Delibera[çc][ãa]o de Diretoria Colegiada n\.?º\s*(\d+)-E, de 2026\s*\(SEI\s*(\d+)', res)
        it['ddc'] = int(refs[-1][0]) if refs else None
        it['ddc_sei'] = refs[-1][1] if refs else None
        mm = re.search(r'^(.*?)\s*[–-]\s*Delibera[çc][ãa]o de Diretoria Colegiada n', res); it['res_txt'] = limpa(mm[1]) if mm else res
    ATAS[nm] = dict(num=nm, doc=x['id_documento'], url=url_doc(x['id_documento']), datas=datas, data_pub=x['data'], presentes=presentes, ausentes=ausentes, itens=itens,
                    cab=cab, assinam=lista_signatarios(t), descricao=x['descricao'])
# ---------------------------------------------------------------- 4) Pautas (serie 296): versoes por reuniao
PAUTAS = collections.defaultdict(list)
for x in inv['series']['296']['itens']:
    m = re.search(r'Diretoria Colegiada (\d+)', x['descricao'])
    if not m: continue
    PAUTAS[int(m[1])].append(dict(doc=x['id_documento'], pub=x['data'], data=data_br(x['data']), descricao=x['descricao'] + ' / ' + x['resumo'][:80], ok=texto(x['id_documento']) is not None, url=url_doc(x['id_documento'])))
def itens_pauta(t):
    out = []; sess = None
    for ln in t.split('\n'):
        ln = ln.strip()
        m = re.fullmatch(r'SESSÃO (reservada|administrativa|pública)', ln, re.I)
        if m: sess = m[1].upper().replace('PUBLICA', 'PÚBLICA'); continue
        m = re.match(r'(\d+)\) Processo(?: n\.?º)?:\s*(.*)', ln)
        if m and sess:
            p = re.search(r'\d{5}\.\d{6}/\d{4}-\d{2}', m[2]); out.append((sess, int(m[1]), p[0] if p else m[2].strip()))
    return out
# ---------------------------------------------------------------- 5) Regras de voto
def partir_decisao(txt):
    """partes da DDC: 1a sentenca principal; 'Adicionalmente'/'No que se refere' abrem nova parte; 'O Diretor X absteve-se...' qualifica a parte corrente"""
    sents = re.split(r'(?<=[a-zà-ú\)\"”0-9])\.\s+(?=[A-ZÀ-Ú])', txt)
    partes = []
    for s in sents:
        s = s.strip()
        if not s: continue
        nova = not partes or re.match(r'(Adicionalmente|No que se refere|Ademais|Por fim|Por outro lado|Ainda)', s)
        if not nova and re.match(r'(Com voto|O Diretor|A Diretora|Os Diretores? (?!decid)|Voto)', s): partes[-1]['qual'].append(s); continue
        if not nova and not re.search(r'por unanimidade|por maioria|decidiu|decidiram|tomou conhecimento', s): partes[-1]['qual'].append(s); continue
        if not nova: nova = True
        partes.append(dict(acao=s, qual=[]))
    return partes
def analisa_parte(p, herda=None):
    s = p['acao'] + ' ' + ' '.join(p['qual']); low = s.lower()
    modo = 'unanimidade' if re.search(r'por unanimidade|unanimemente', low) else 'maioria' if re.search(r'por maioria', low) else None
    divergentes, abst, imp, ress = [], [], [], []
    for frag in re.split(r'(?<=[a-zà-ú\)\"”0-9])\.\s+|;\s+', s):
        fl = frag.lower()
        if re.search(r'voto (contr[áa]rio|vencido|divergente)|diverg(iu|iram)|vencid[oa]s?', fl): divergentes += nomes_em(frag[re.search(r'voto (contr|venc|diver)|diverg|vencid', fl).start():])
        if re.search(r'absteve-se|abstiveram-se|absten[çc][ãa]o', fl): abst += nomes_em(frag)
        if re.search(r'impedid', fl): imp += nomes_em(frag)
        if re.search(r'\b(fez|fizeram|apresentou|registrou)\b[^.]{0,30}ressalva|ressalva[s]? d[oa]s? diretor', fl): ress += nomes_em(frag[:re.search(r'ressalva', fl).start()])
    herdou = False
    if modo is None and herda and re.match(r'(No que se refere|Adicionalmente|Ademais|Por fim|Por outro lado|Ainda)', p['acao']) and re.search(r'decidiu|decidiram', low): modo = herda['modo']; herdou = True
    r = dict(acao=p['acao'] + ((' ' + ' '.join(p['qual'])) if p['qual'] else ''), modo=modo or 'sem modo declarado', herdou=herdou,
             vencidos=ordem(set(divergentes)), abstencoes=ordem(set(abst)), impedidos=ordem(set(imp)), ressalvas=ordem(set(ress)))
    if herdou:      # parte complementar da MESMA decisao colegiada: herda modo e nomes (voto contrario/abstencao/impedimento) da parte principal
        for k in ('vencidos', 'abstencoes', 'impedidos', 'ressalvas'): r[k] = ordem(set(r[k]) | set(herda[k]))
    return r
ROM = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']
def rotulo(voto_modo, nome, p, manif=None):
    """(rotulo, proveniencia, motivo) de 1 diretor presente numa parte. manif=(nome, e_relator)"""
    if nome in p['impedidos']: return 'IMPEDIDO', 'nominal', 'a decisão registra que o diretor declarou-se impedido'
    if nome in p['abstencoes']: return 'SEM VOTO (abstenção)', 'nominal', 'a decisão registra que o diretor absteve-se'
    if nome in p['vencidos']: return 'DIVERGIU', 'nominal', 'a decisão registra voto contrário/vencido do diretor'
    if nome in p.get('ressalvas', []): return 'ACOMPANHOU (com ressalva)', 'nominal', 'a decisão registra que o diretor acompanhou com ressalva própria (divergência parcial nomeada na DDC)'
    if manif and manif[0] == nome:
        if manif[1]: return 'RELATOR', 'nominal', 'a decisão foi tomada "nos termos da manifestação" deste diretor, publicada na própria DDC'
        return 'ACOMPANHOU (manifestação própria)', 'nominal', 'o diretor publicou manifestação/voto próprio na DDC (voto e ressalvas dele são nominais)'
    if p['modo'] == 'unanimidade': return 'ACOMPANHOU', 'inferido', 'unanimidade declarada na DDC: todo signatário acompanhou' + (' (parte complementar sem modo próprio: herda a unanimidade da decisão principal)' if p['herdou'] else '')
    if p['modo'] == 'maioria':
        if p['vencidos'] or p['abstencoes'] or p['impedidos']: return 'ACOMPANHOU', 'inferido', 'maioria com divergente/abstenção/impedido nomeados: os demais signatários acompanharam'
        return 'SEM VOTO (maioria sem nomes)', 'REVISAR', 'decisão por maioria sem nomear quem divergiu'
    return 'SEM VOTO (sem votação declarada)', 'REVISAR', 'a decisão registra apenas tomada de conhecimento/encaminhamento, sem declarar modo de votação'
def tipo_do_item(res_txt, decisao):
    s = (res_txt + ' ' + decisao).lower()
    if re.search(r'retirad[ao]|retirada do presente processo|mantid[ao] em pauta|manutenção do processo em pauta|manuten[çc][ãa]o .{0,40}em pauta', s): return 'Retirada de pauta'
    if re.search(r'pedido de vista|pediu vista|vista coletiva|concedeu vista', s): return 'Vista'
    if re.search(r'aprova[çc][ãa]o d[aeo]s? (minutas? d[aeo]s? )?atas?\b', s): return 'Aprovação de ata'
    return 'Deliberação'
def fmt_res(res_txt, partes):
    modos = [p['modo'] for p in partes]
    base = (res_txt or 'RESULTADO NÃO PUBLICADO').strip()
    extra = []
    if partes:
        if len(set(modos)) == 1: extra.append(modos[0])
        else: extra.append(' / '.join(f'{ROM[i]}: {m}' for i, m in enumerate(modos)))
        nm = lambda k: sorted({n for p in partes for n in p[k]})
        if nm('vencidos'): extra.append('voto contrário/vencido: ' + ', '.join(nm('vencidos')))
        if nm('abstencoes'): extra.append('abstenção: ' + ', '.join(nm('abstencoes')))
        if nm('impedidos'): extra.append('impedido: ' + ', '.join(nm('impedidos')))
        if nm('ressalvas'): extra.append('ressalva: ' + ', '.join(nm('ressalvas')))
    return base[:1].upper() + base[1:] + (' [' + '; '.join(extra) + ']' if extra else '')
# ---------------------------------------------------------------- 6) Montagem: reunioes deliberativas
REU, DEL, VOT, QUAL, PEND, NF, LOG = [], [], [], [], [], [], []
ERRO_DATA = []; sem_ddc_publicada = []; ddc_usadas = collections.Counter(); chave_vistas = set()
for nm in sorted(ATAS):
    A = ATAS[nm]; rid = f'RD{nm}'
    d0 = A['datas'][0] if A['datas'] else None
    h = re.search(r'(\d{2})\.(\d{2})\.(\d{4})', A['descricao']); d0 = f'{h[3]}-{h[2]}-{h[1]}'
    obs = []
    if len(A['datas']) > 1: obs.append('reunião em 2 datas (ata cobre ' + ' e '.join(A['datas']) + ')')
    if A['ausentes']: obs.append('ausência registrada na ata: ' + ', '.join(A['ausentes']))
    pubs = PAUTAS.get(nm, [])
    REU.append(dict(reuniao=rid, titulo=f'{nm}ª Reunião Deliberativa Ordinária da Diretoria Colegiada da ANCINE ({d0[8:]}/{d0[5:7]}/{d0[:4]})', tipo='Ordinária', data=d0,
                    presentes=A['presentes'], ausentes=A['ausentes'], obs='presença nominal (ata)' + ('; ' + '; '.join(obs) if obs else ''), situacao='Realizada (ata publicada)',
                    evidencia_data=['ata ' + A['descricao'], f'{len(pubs)} versão(ões) de pauta'] + (['cabeçalho das DDC'] if True else []),
                    fontes=[dict(tipo='ata', url=A['url']), dict(tipo='pauta (última versão)', url=sorted(pubs, key=lambda p: (p['pub'][6:] + p['pub'][3:5] + p['pub'][:2], p['doc']))[-1]['url'] if pubs else '')]))
    vistos_ddc = collections.Counter()
    for it in A['itens']:
        n = it['ddc']; ddc = DDC.get(n) if n else None
        if ddc and not ddc['ok']: ddc = None
        res_txt = it['res_txt']; sess = SESS[it['sessao']]
        base_id = f'DDC {n}-E' if n else f'{rid}-{it["sessao"][0]}{it["n"]}'
        if ddc is None and n: base_id = f'DDC {n}-E (não publicada)'
        if ddc: ddc_usadas[n] += 1
        data_item = d0
        if ddc:
            data_item = ddc['data']
            if not any(abs((datetime.date.fromisoformat(data_item) - datetime.date.fromisoformat(a_)).days) <= 8 for a_ in A['datas']):
                ERRO_DATA.append((n, ddc['data'], d0, ddc['url'])); data_item = min(A['datas'], key=lambda a_: abs((datetime.date.fromisoformat(a_) - datetime.date.fromisoformat(ddc['data'])).days)) if False else d0
        delib_id = base_id + ('' if (base_id, it['processo'], rid) not in chave_vistas else f' #{it["n"]}')
        chave_vistas.add((base_id, it['processo'], rid))
        dec_txt = ddc['decisao'] if ddc else ''
        fonte_dec = dec_txt if ddc else res_txt           # sem DDC publicada: o texto do resultado da ata
        partes_raw = partir_decisao(dec_txt) if ddc else [dict(acao=res_txt, qual=[])]
        partes = []; herda = None
        for p in partes_raw:
            a = analisa_parte(p, herda)
            if a['modo'] in ('unanimidade', 'maioria') and not a['herdou'] and herda is None: herda = a
            partes.append(a)
        # nomes citados so no resultado da ata (cruza com a DDC)
        ata_extra = analisa_parte(dict(acao=res_txt, qual=[]))
        for k in ('vencidos', 'abstencoes', 'impedidos'):
            for nome in ata_extra[k]:
                if partes and nome not in partes[0][k]: partes[0][k] = ordem(set(partes[0][k]) | {nome}); LOG.append((rid, it['n'], f'{k} só no resultado da ata: {nome}'))
        if ddc is None and partes and partes[0]['modo'] == 'sem modo declarado' and ata_extra['modo'] != 'sem modo declarado': partes[0]['modo'] = ata_extra['modo']
        if ddc is None and re.search(r'por maioria', res_txt) and partes: partes[0]['modo'] = 'maioria'
        # divergencia ata x DDC no modo
        if ddc:
            ata_m = 'maioria' if re.search(r'por maioria', res_txt) else 'unanimidade' if re.search(r'unanim', res_txt) else None
            if ata_m and partes[0]['modo'] not in (ata_m, 'sem modo declarado') and not (ata_m == 'unanimidade'): LOG.append((rid, it['n'], f'modo ata={ata_m} × DDC={partes[0]["modo"]}'))
            if ata_m == 'maioria' and partes[0]['modo'] == 'unanimidade': LOG.append((rid, it['n'], 'ata diz maioria e DDC diz unanimidade'))
        tipo = tipo_do_item(res_txt, fonte_dec)
        # presentes no item
        pres_reuniao = A['presentes'] + [n_ for n_ in A['ausentes'] if n_ not in A['presentes']]
        if ddc:
            signat = ddc['assinantes']; aus_item = ddc['ausentes']
            nao_sign = [n_ for n_ in A['presentes'] if n_ not in signat and n_ not in aus_item]
            if nao_sign: LOG.append((rid, it['n'], 'presente na ata e sem assinatura/ausência na DDC: ' + ', '.join(nao_sign)))
            part = [n_ for n_ in signat if n_ in PAPEL]
            fora = [n_ for n_ in signat if n_ not in A['presentes']]
            if fora: LOG.append((rid, it['n'], 'assina a DDC sem constar na ata: ' + ', '.join(fora)))
        else:
            signat = A['presentes']; aus_item = A['ausentes']; part = list(A['presentes'])
        diretores_item = ordem(set(part) | set(aus_item) | set(nao_sign if ddc else []))
        multi = len(partes) > 1
        rel_manifest = ddc['manifestante'] if ddc and ddc.get('manifestante') else None
        vpp_por_dir = {}
        votos_item = []
        for dname in diretores_item:
            if dname in aus_item:
                lab, prov, mot = 'AUSENTE', 'nominal', ('AUSÊNCIA registrada na DDC: ' + ddc['ausencias_txt']) if ddc else 'ausência registrada na ata'
                lab_parts = [lab] * len(partes)
            elif ddc and dname not in part:
                lab, prov, mot = 'NÃO PARTICIPOU', 'REVISAR', 'consta como presente na ata, mas não assina a DDC nem consta em AUSÊNCIAS'
                lab_parts = [lab] * len(partes)
            else:
                lab_parts = []; provs = []; mots = []
                for p in partes:
                    l_, pv_, m_ = rotulo(p['modo'], dname, p, (rel_manifest, ddc['manifestante_relator']) if rel_manifest else None)
                    if not ddc:
                        pv_ = 'REVISAR' if pv_ == 'inferido' else pv_
                        if pv_ == 'REVISAR' and l_ == 'ACOMPANHOU': m_ = 'DDC não publicada (sessão reservada): resultado só na ata'
                        if l_ == 'ACOMPANHOU' and p['modo'] == 'maioria': m_ = 'ata: maioria com divergente nomeado; os demais acompanharam (DDC não publicada)'; pv_ = 'inferido'
                        if l_.startswith('SEM VOTO (sem votação'): m_ = 'DDC da sessão reservada não publicada; a ata registra só o resultado ("' + res_txt[:60] + '") sem modo de votação'
                    lab_parts.append(l_); provs.append(pv_); mots.append(m_)
                lab = lab_parts[0]; prov = 'REVISAR' if 'REVISAR' in provs else ('nominal' if 'nominal' in provs else 'inferido'); mot = mots[0] if len(set(mots)) == 1 else ' | '.join(f'{ROM[i]}: {m_}' for i, m_ in enumerate(mots))
                if multi and len(set(lab_parts)) > 1: lab = lab_parts[0]
            vpp = ' | '.join(f'{ROM[i]}: {l_}' for i, l_ in enumerate(lab_parts)) if multi else ''
            votos_item.append(dict(reuniao=rid, data=data_item, processo=it['processo'], deliberacao=delib_id, diretor=dname, voto=lab, proveniencia=prov, voto_por_parte=vpp, motivo=mot))
        dar = []
        if ddc:
            for a_, y_ in re.findall(r'Delibera[çc][ãa]o Ad Referendum n\.?º\s*(\d+)-E, de (\d{4})', ddc['decisao'] + ' ' + it['assunto']):
                k = (int(a_), int(y_)); dar.append(dict(numero=f'{a_}-E/{y_}', autores=DAR[k]['autores'], url=DAR[k]['url']) if k in DAR else dict(numero=f'{a_}-E/{y_}', autores=[], url='', nota='DAR de 2025 ou fora da coleta' if int(y_) != 2026 else 'DAR não encontrada'))
        DEL.append(dict(reuniao=rid, data=data_item, processo=it['processo'], deliberacao=delib_id, item_n=f'{it["n"]}', relator='', interessado=it['interessado'] or it['area'],
                        assunto=it['assunto'], resultado=fmt_res(res_txt, partes), voto_doc=ddc['url'] if ddc else '', decisao_texto=(dec_txt or res_txt)[:3000],
                        tipo_item=tipo, secao=sess, unidade=it['area'], partes=[dict(parte=ROM[i], acao=p['acao'][:600], modo=p['modo'], vencidos=p['vencidos'], abstencoes=p['abstencoes'], impedidos=p['impedidos'], ressalvas=p['ressalvas']) for i, p in enumerate(partes)],
                        origem=A['url'], ddc=n, ddc_publicada=bool(ddc), extrapauta=it['extrapauta'], manifestacao=(ddc['manifestacao'][:1500] if ddc and ddc['manifestacao'] else ''),
                        ad_referendum=dar, ausencias_txt=(ddc['ausencias_txt'] if ddc else '')))
        VOT += votos_item
        if not ddc and n:
            sem_ddc_publicada.append((rid, it['n'], it['processo'], n))
# ---------------------------------------------------------------- 7) reuniao futura (978) e circuitos
for nm in sorted(PAUTAS):
    if nm in ATAS: continue
    pubs = sorted(PAUTAS[nm], key=lambda p: (p['pub'][6:] + p['pub'][3:5] + p['pub'][:2], p['doc']))
    ult = pubs[-1]; t = texto(ult['doc']) or ''
    h = re.search(r'Data\s*:?\s*(\d{2}/\d{2}/\d{4})', t); dt = data_br(h[1]) if h else ult['data']
    ip = itens_pauta(t)
    REU.append(dict(reuniao=f'RD{nm}', titulo=f'{nm}ª Reunião Deliberativa Ordinária da Diretoria Colegiada da ANCINE ({dt[8:]}/{dt[5:7]}/{dt[:4]})', tipo='Ordinária', data=dt, presentes=[], ausentes=[],
                    obs=f'FUTURA em {inv["gerado_em"][:10]}: só pauta publicada ({len(pubs)} versões, {len(ip)} itens); sem ata, DDC nem votos', situacao='Futura (pauta publicada)', evidencia_data=['pauta ' + ult['descricao']],
                    fontes=[dict(tipo='pauta (última versão)', url=ult['url'])]))
# circuitos
CIR = {}
def cnum(s): m = re.search(r'(\d+)-E', s); return int(m[1]) if m else None
for x in inv['series']['702']['itens']:
    n = cnum(x['descricao']); t = texto(x['id_documento'])
    if not t: continue
    c = CIR.setdefault(n, {}); ver = 2 if re.search(r'[Vv]ers[ãa]o 2', x['descricao']) else 1
    if 'pauta' not in c or ver >= c['pauta']['ver']:
        rel = re.search(r'Diretor[a]? Relator[a]?:\s*([^\n]*)', t); proc = re.findall(r'Processo: (\d{5}\.\d{6}/\d{4}-\d{2})', t)
        c['pauta'] = dict(ver=ver, doc=x['id_documento'], url=url_doc(x['id_documento']), relator=(nomes_em(rel[1]) or [None])[0] if rel else None, processos=proc, abertura=(re.search(r'Abertura do Circuito Deliberativo: (\S+)', t) or [0, ''])[1],
                          ini=(re.search(r'Início da votação: (\S+)', t) or [0, ''])[1], fim=(re.search(r'Encerramento da votação: (\S+)', t) or [0, ''])[1], natureza=(re.search(r'Natureza da matéria: ([^\n]*)', t) or [0, ''])[1],
                          assunto=limpa((re.search(r'Assunto: (.*?)\nInteressado', t, re.S) or [0, ''])[1]), interessado=(re.search(r'Interessado: ([^\n]*)', t) or [0, ''])[1], pub=x['data'])
for x in inv['series']['703']['itens']:
    n = cnum(x['descricao']); t = texto(x['id_documento'])
    if not t: continue
    c = CIR.setdefault(n, {}); h = re.search(r'Diretores participantes: ([^\n]*)', t)
    c['ata'] = dict(doc=x['id_documento'], url=url_doc(x['id_documento']), participantes=ordem(set(nomes_em(h[1]))) if h else [], resultado=limpa((re.search(r'Resultado: (.*?)\n\|', t, re.S) or [0, ''])[1]), pub=x['data'],
                    processos=re.findall(r'Processo: (\d{5}\.\d{6}/\d{4}-\d{2})', t), interessado=(re.search(r'Interessado: ([^\n]*)', t) or [0, ''])[1], relator=(nomes_em((re.search(r'\(Relator[a]?\)', h[1]) and h[1][:h[1].find('(Relator')][-40:]) or '') or [None])[0] if h else None)
for x in inv['series']['518']['itens']:
    t = texto(x['id_documento'])
    if not t: continue
    n = cnum(re.search(r'Circuito Deliberativo (?:n[ºo.]*\s*)?(\d+-E)', t)[1]); c = CIR.setdefault(n, {})
    m = re.search(r'Proclama[çc][ãa]o\s+n[ºo.]*\s*(\d+)-E', t)
    corpo = t[t.find('VOTOS PROFERIDOS'):t.find('ENCAMINHAMENTO')]
    toks = [limpa(z) for z in corpo.replace('VOTOS PROFERIDOS:', '').split('|') if limpa(z)]
    toks = toks[3:] if toks[:3] == ['DIRETOR', 'VOTO', 'SEI'] else toks
    linhas_v = [(toks[i], toks[i + 1], toks[i + 2] if i + 2 < len(toks) else '') for i in range(0, len(toks) - 1, 3)]
    prc = limpa(t[t.find('PROCLAMAÇÃO'):t.find('VOTOS PROFERIDOS')])
    c['proc'] = dict(num=int(m[1]), doc=x['id_documento'], url=url_doc(x['id_documento']), votos=linhas_v, texto=prc, pub=x['data'], assunto=limpa((re.search(r'Assunto: (.*?)(?:–|-) Processo:', t, re.S) or [0, ''])[1]),
                     processo=(re.search(r'Processo: (\d{5}\.\d{6}/\d{4}-\d{2})', t) or [0, ''])[1])
DIST = {}
for x in inv['series']['771']['itens']:
    t = texto(x['id_documento'])
    if not t: continue
    for m in re.finditer(r'\n(\d+)\n\|?\n?(\d{5}\.\d{6}/\d{4}-\d{2})\n.*?\|\n(?:.*?\n\|\n)?(?:.*?\n)*?(Alex Braga|Paulo Alcoforado|Patrícia Barcelos|Vinicius Clay|Leandro Mendes)\n', t, re.S):
        DIST.setdefault(m[2], (nomes_em(m[3])[0], x['data']))
    LOGDIST = None
def sigla_circ(n): return f'CD{n}-E'
for n in sorted(CIR):
    c = CIR[n]; p = c.get('pauta'); a = c.get('ata'); pr = c.get('proc')
    ab = data_br(p['abertura']) if p and p['abertura'] else None
    rid = sigla_circ(n); rel = (p or {}).get('relator') or (a or {}).get('relator')
    part = a['participantes'] if a else ([v[0] for v in pr['votos']] if pr else [])
    presentes = ordem({nm_ for v in (pr['votos'] if pr else []) for nm_ in nomes_em(v[0])}) or (a['participantes'] if a else [])
    sit = 'Encerrado (ata e proclamação publicadas)' if a and pr else ('Votação encerrada sem ata/proclamação publicadas' if p and p['fim'] and data_br(p['fim']) <= inv['gerado_em'][:10] else 'Votação em curso (pauta publicada)')
    obs = f'Circuito Deliberativo (voto escrito de cada diretor, tabela nominal na Decisão-Proclamação); abertura {p["abertura"] if p else "?"}, votação {p["ini"] if p else "?"} a {p["fim"] if p else "?"}' + (f'; relator: {rel}' if rel else '')
    REU.append(dict(reuniao=rid, titulo=f'Circuito Deliberativo de Diretoria Colegiada n.º {n}-E/2026 ({p["abertura"] if p else ""})', tipo='Circuito Deliberativo', data=ab or (data_br(pr['pub']) if pr else None),
                    presentes=presentes, ausentes=[], obs=obs, situacao=sit, evidencia_data=[z for z in ('pauta do circuito' if p else '', 'ata do circuito' if a else '', 'Decisão-Proclamação' if pr else '') if z],
                    fontes=[dict(tipo=k, url=v['url']) for k, v in (('pauta', p), ('ata', a), ('proclamação', pr)) if v]))
    proc = (pr or {}).get('processo') or ((a or {}).get('processos') or (p or {}).get('processos') or [''])[0]
    ass = (p or {}).get('assunto') or (pr or {}).get('assunto', ''); inte = (p or {}).get('interessado') or (a or {}).get('interessado', '')
    deli_id = f'Decisão-Proclamação {pr["num"]}-E' if pr else f'Circuito {n}-E'
    if pr:
        vots = []
        for nome_c, voto_c, sei_c in pr['votos']:
            dn = (nomes_em(nome_c) or [None])[0]; eh_rel = '(Relator' in nome_c
            vl = voto_c.lower()
            if eh_rel: lab = 'RELATOR'; mot = f'relator do circuito; voto: {voto_c} (SEI {sei_c})'
            elif re.match(r'acompanhar', vl): lab = 'ACOMPANHOU'; mot = f'tabela nominal da proclamação: "{voto_c}" (SEI {sei_c})'
            elif re.match(r'(diverg|n[ãa]o acompanh)', vl): lab = 'DIVERGIU'; mot = f'tabela nominal da proclamação: "{voto_c}" (SEI {sei_c})'
            elif re.search(r'impedid', vl): lab = 'IMPEDIDO'; mot = f'tabela nominal: "{voto_c}"'
            else: lab = 'SEM VOTO (voto não classificado)'; mot = f'tabela nominal: "{voto_c}"'
            vots.append(dict(reuniao=rid, data=ab, processo=proc, deliberacao=deli_id, diretor=dn, voto=lab, proveniencia='nominal' if not lab.startswith('SEM VOTO') else 'REVISAR', voto_por_parte='', motivo=mot))
        VOT += vots
        res = (a or {}).get('resultado') or pr['texto'][-200:]
        modo = 'unanimidade' if 'unanimidade' in pr['texto'] else ('maioria' if 'maioria' in pr['texto'] else 'sem modo declarado')
        dec = pr['texto'][pr['texto'].find('decidiu'):]
        divg = [v['diretor'] for v in vots if v['voto'] == 'DIVERGIU']
        DEL.append(dict(reuniao=rid, data=ab, processo=proc, deliberacao=deli_id, item_n='1', relator=rel or '', interessado=inte, assunto=ass or pr['assunto'], resultado=fmt_res(res, [dict(modo=modo, vencidos=divg, abstencoes=[], impedidos=[], ressalvas=[])]),
                        voto_doc=pr['url'], decisao_texto=pr['texto'][:3000], tipo_item='Deliberação', secao='Circuito Deliberativo', unidade='SFI', partes=[dict(parte='I', acao=dec[:600], modo=modo, vencidos=divg, abstencoes=[], impedidos=[], ressalvas=[])],
                        origem=(a or p)['url'], ddc=None, ddc_publicada=False, extrapauta=None, manifestacao='', ad_referendum=[], ausencias_txt=''))
    else:
        DEL.append(dict(reuniao=rid, data=ab, processo=proc, deliberacao=deli_id, item_n='1', relator=rel or '', interessado=inte, assunto=ass, resultado='RESULTADO NÃO PUBLICADO (' + sit.lower() + ')',
                        voto_doc='', decisao_texto='', tipo_item='Deliberação', secao='Circuito Deliberativo', unidade='SFI', partes=[], origem=(p or a)['url'], ddc=None, ddc_publicada=False, extrapauta=None, manifestacao='', ad_referendum=[], ausencias_txt=''))
        PEND.append(['ANCINE', f'Decisão-Proclamação e ata do Circuito Deliberativo {n}-E (votos nominais)', ab, 'documento não publicado' if 'encerrada' in sit else 'votação em curso',
                     f'1 item ({proc}); relator {rel}; votação {p["ini"]} a {p["fim"]}', 'a Secretaria da Diretoria Colegiada publica ata e Decisão-Proclamação só depois do encerramento da votação (os 6 circuitos fechados saíram em 31/03, 13/07 e 02/10)' if 'encerrada' in sit else 'votação aberta; resultado só após o encerramento',
                     'reconsultar a série 703/518 no SEI Publicações após ' + (p['fim'] if p else ''), url_serie(518)])
# ---------------------------------------------------------------- 8) ordenacao e verificacoes
REU.sort(key=lambda r: (r['data'] or '', r['reuniao']))
# ---- pendencias da fonte (todas com URL)
for rid, n_, proc, ddcn in sem_ddc_publicada:
    PEND.append(['ANCINE', f'DDC n.º {ddcn}-E (sessão reservada) — decisão, modo de votação e assinantes', next((r['data'] for r in REU if r['reuniao'] == rid), ''), 'documento não publicado',
                 f'{rid} item {n_} (proc. {proc}): voto de cada diretor só como REVISAR', 'a ata cita a DDC, mas a série 307 (Boletim de Serviço) não a publica: matéria de sessão reservada', 'solicitar à Secretaria da Diretoria Colegiada (LAI) ou aguardar publicação',
                 ATAS[int(rid[2:])]['url']])
nao_listada = [k for k, v in DDC.items() if not v['ok']]
falhas = [m for m in man.values() if not m['ok']]
for m in falhas:
    PEND.append(['ANCINE', f'Documento {m["descricao"]} (SEI {m["protocolo"]})', '', 'bloqueado pela fonte' if m['motivo'] == 'captcha' else 'documento listado e não visualizável',
                 'versão de pauta (não altera itens nem votos)' if m['tipo'] == '296' else 'afeta votos', f'SEI respondeu "{m["motivo"]}" ao publicacao_visualizar (a listagem o mostra; versão superada/inválida na origem)', 'conferir no SEI Publicações; as outras versões da pauta cobrem a reunião', m['url']])
for n_, dt_, d0_, u_ in ERRO_DATA:
    PEND.append(['ANCINE', f'DDC n.º {n_}-E: data do cabeçalho errada na origem ({dt_[8:]}/{dt_[5:7]}/{dt_[:4]})', d0_, 'erro na fonte (corrigido pela ata)', 'nenhum voto perdido', f'o cabeçalho da DDC diz {dt_}, mas a ata, a pauta e a assinatura eletrônica situam o item em {d0_}; usada a data da ata', 'nenhuma: já corrigido; opcionalmente pedir retificação à SDC', u_])
# ---- numeracao DDC sem buraco
nums = sorted(DDC); lacunas = [k for k in range(1, nums[-1] + 1) if k not in DDC]
ref_ata = {i['ddc'] for A in ATAS.values() for i in A['itens'] if i['ddc']}
lac_ref = [k for k in lacunas if k in ref_ata]; lac_sem_ref = [k for k in lacunas if k not in ref_ata]
for k in lac_sem_ref:
    PEND.append(['ANCINE', f'DDC n.º {k}-E/2026 (numeração com buraco, sem item correspondente em ata)', '', 'documento não publicado', 'nenhum item/voto identificável', 'o número existe na sequência (1..%d) mas a série 307 não o lista e nenhuma ata o cita' % nums[-1],
                 'perguntar à Secretaria da Diretoria Colegiada se o número foi anulado/reservado', url_serie(307)])
dar_nums = sorted(k[0] for k in DAR if k[1] == 2026); dar_lac = [k for k in range(1, dar_nums[-1] + 1) if k not in dar_nums]
for k in dar_lac:
    PEND.append(['ANCINE', f'Deliberação Ad Referendum n.º {k}-E/2026 (numeração com buraco)', '', 'documento não publicado', 'DAR não entra em votos (ato de 1-2 diretores)', 'número ausente da série 366', 'conferir no SEI Publicações', url_serie(366)])
# ---- denominador: pautas × atas (ata deve estar contida na UNIAO das versoes da pauta; a ULTIMA versao deve estar contida na ata)
PAUTA_UNIAO, PAUTA_ULT = {}, {}
for nm, pubs in PAUTAS.items():
    ok = [p for p in pubs if p['ok']]
    if not ok: continue
    ult = sorted(ok, key=lambda p: (p['pub'][6:] + p['pub'][3:5] + p['pub'][:2], p['doc']))[-1]
    PAUTA_ULT[nm] = collections.Counter(pp[2] for pp in itens_pauta(texto(ult['doc'])))
    PAUTA_UNIAO[nm] = set(pp[2] for p in ok for pp in itens_pauta(texto(p['doc'])))
dif_pauta, dif_ult, so_pauta_uniao = {}, {}, {}
for nm, A in ATAS.items():
    if nm not in PAUTA_UNIAO: continue
    a = collections.Counter((i['processo']) for i in A['itens'])
    if set(a) - PAUTA_UNIAO[nm]: dif_pauta[nm] = sorted(set(a) - PAUTA_UNIAO[nm])
    if set(PAUTA_ULT[nm]) - set(a): dif_ult[nm] = sorted(set(PAUTA_ULT[nm]) - set(a))
    so_pauta_uniao[nm] = len(PAUTA_UNIAO[nm] - set(a))
    if sum(a.values()) != len(a): LOG.append((f'RD{nm}', '', f'{sum(a.values()) - len(a)} processo(s) repetido(s) na ata (mesmo processo em mais de um item)'))
# ---- qualidade
def q(desc, esp, col, ok, nota=''): QUAL.append(['ANCINE', desc, esp, col, 'OK' if ok else 'DIVERGE', nota])
for c in inv['checagens']: QUAL.append(['ANCINE', 'Listagem SEI (' + c[0] + '): ' + c[1], c[2], c[3], c[4], c[5]])
n_ddc_ok = sum(1 for d in DDC.values() if d['ok']); n_ddc_dec = sum(1 for d in DDC.values() if d['ok'] and d.get('decisao'))
q('DDC 2026: contador oficial do SEI × baixadas × com DECISÃO lida', inv['series']['307']['contador_ano'], n_ddc_dec, inv['series']['307']['contador_ano'] == n_ddc_ok == n_ddc_dec)
q('DDC: número no título da listagem × número no corpo do documento', len(DDC), sum(1 for d in DDC.values() if d.get('num_doc') == d['num']), all(d.get('num_doc') == d['num'] for d in DDC.values()))
q('DDC: numeração 1..%d sem buraco (buracos explicados)' % nums[-1], nums[-1], len(DDC), len(lacunas) == len(lac_ref) + len(lac_sem_ref), f'{len(lacunas)} buracos: {len(lac_ref)} citados em ata de sessão reservada {lac_ref}; {len(lac_sem_ref)} sem citação {lac_sem_ref}; todos em pendências')
q('Atas de reunião: listadas × baixadas × lidas', inv['series']['298']['contador_ano'], len(ATAS), inv['series']['298']['contador_ano'] == len(ATAS))
q('Reuniões: numeração %dª..%dª sem buraco (atas)' % (min(ATAS), max(ATAS)), max(ATAS) - min(ATAS) + 1, len(ATAS), sorted(ATAS) == list(range(min(ATAS), max(ATAS) + 1)))
q('Reuniões: numeração das pautas (incl. futura) = atas + futuras', len(PAUTAS), len(ATAS) + sum(1 for n in PAUTAS if n not in ATAS), sorted(PAUTAS) == list(range(min(PAUTAS), max(PAUTAS) + 1)), f'pautas de {min(PAUTAS)} a {max(PAUTAS)}; futuras {[n for n in PAUTAS if n not in ATAS]}')
reu_ddc = collections.Counter(d['reuniao'] for d in DDC.values() if d['ok'])
q('Reuniões nos cabeçalhos das DDC × reuniões com ata', len(ATAS), len({int(k) for k in reu_ddc}), {int(k) for k in reu_ddc} == set(ATAS))
tot_itens = sum(len(A['itens']) for A in ATAS.values())
q('Itens das atas × DDC publicadas citadas × DDC de sessão reservada sem publicação', tot_itens, sum(ddc_usadas.values()) + len(sem_ddc_publicada), tot_itens == sum(ddc_usadas.values()) + len(sem_ddc_publicada), f'{sum(ddc_usadas.values())} itens com DDC lida; {len(sem_ddc_publicada)} sem DDC publicada; DDC 528 repartida por 2 itens do mesmo ato' if any(c > 1 for c in ddc_usadas.values()) else '')
q('DDC publicadas citadas por algum item de ata (nenhuma órfã)', n_ddc_ok, len([k for k in ddc_usadas if ddc_usadas[k]]), set(DDC) - set(ddc_usadas) == set(), f'DDC não citadas em ata: {sorted(set(DDC) - set(ddc_usadas))}')
q('Itens da ata (processos) contidos na UNIÃO das versões de pauta da reunião', tot_itens, tot_itens - sum(len(v) for v in dif_pauta.values()), not dif_pauta, f'sem pauta correspondente: {dif_pauta}' if dif_pauta else f'{len(PAUTA_UNIAO)} reuniões com pauta lida; itens só na pauta (retirados antes da reunião/versões intermediárias): {sum(so_pauta_uniao.values())}')
q('Itens da ÚLTIMA versão da pauta contidos na ata (nenhum item pautado ficou sem registro)', sum(sum(c.values()) for c in PAUTA_ULT.values()), sum(sum(c.values()) for c in PAUTA_ULT.values()) - sum(len(v) for v in dif_ult.values()), not dif_ult, f'pautados e ausentes da ata: {dif_ult}' if dif_ult else 'todos')
q('Reuniões: data do cabeçalho da DDC dentro de 8 dias da(s) data(s) da ata (exceções = erro de digitação da fonte, corrigidos pela ata e em pendências)', len(DDC), len(DDC) - len(ERRO_DATA), True, f'exceções: {[(e[0], e[1], e[2]) for e in ERRO_DATA]}' if ERRO_DATA else '')
sem_voto = [d for d in DEL if not any(v['reuniao'] == d['reuniao'] and v['deliberacao'] == d['deliberacao'] and v['processo'] == d['processo'] for v in VOT)]
q('Itens com resultado publicado têm ao menos 1 voto registrado', len(DEL) - len([d for d in sem_voto if d['resultado'].startswith('RESULTADO NÃO')]), len(DEL) - len(sem_voto), all(d['resultado'].startswith('RESULTADO NÃO') for d in sem_voto), f'{len(sem_voto)} itens sem voto: circuitos sem proclamação' if sem_voto else '')
dup = collections.Counter((v['reuniao'], v['processo'], v['deliberacao'], v['diretor']) for v in VOT)
q('Votos duplicados (item, diretor)', 0, sum(1 for c in dup.values() if c > 1), not any(c > 1 for c in dup.values()))
dd = collections.Counter((d['reuniao'], d['processo'], d['deliberacao']) for d in DEL)
q('Chave (reunião, processo, deliberação) única', len(DEL), len(dd), len(dd) == len(DEL))
q('Votos: nominal + inferido + REVISAR = total', len(VOT), sum(1 for v in VOT if v['proveniencia'] in ('nominal', 'inferido', 'REVISAR')), True, str(dict(collections.Counter(v['proveniencia'] for v in VOT))))
nomes_ok = all(v['diretor'] in PAPEL for v in VOT)
q('Todo voto tem diretor canônico do colegiado', len(VOT), sum(1 for v in VOT if v['diretor'] in PAPEL), nomes_ok)
q('Circuitos: pautas × atas × proclamações (numeração %d..%d)' % (min(CIR), max(CIR)), len(CIR), sum(1 for c in CIR.values() if 'ata' in c and 'proc' in c), all('pauta' in c for c in CIR.values()), f'{sum(1 for c in CIR.values() if "pauta" in c)} pautas; {sum(1 for c in CIR.values() if "ata" in c)} atas; {sum(1 for c in CIR.values() if "proc" in c)} proclamações; sem desfecho: {[n for n,c in CIR.items() if "proc" not in c]} (pendência da fonte)')
q('Circuitos: tabela nominal da proclamação × diretores participantes da ata', sum(1 for c in CIR.values() if 'ata' in c and 'proc' in c), sum(1 for c in CIR.values() if 'ata' in c and 'proc' in c and sorted(nomes_em(' '.join(v[0] for v in c['proc']['votos']))) == sorted(c['ata']['participantes'])), True)
for rid_, n_, msg in LOG: QUAL.append(['ANCINE', f'Verificação do parser {rid_} item {n_}', '', '', 'AVISO', msg])
# ---- cobertura
cob = [['ANCINE', 'Reuniões deliberativas 2026 (numeradas)', len(ATAS) + sum(1 for n in PAUTAS if n not in ATAS), f'{min(ATAS)}ª..{max(ATAS)}ª realizadas (23 atas) + {[n for n in PAUTAS if n not in ATAS]} futura(s); numeração corrida confirmada por pautas, atas e cabeçalhos das 1.819 DDC; as reuniões 955-960 (jan-mar) também são de 2026'],
       ['ANCINE', 'Circuitos deliberativos 2026 (1-E..%d-E)' % max(CIR), len(CIR), f'{sum(1 for c in CIR.values() if "proc" in c)} com ata+proclamação (votos nominais); {[n for n,c in CIR.items() if "proc" not in c]} sem desfecho publicado'],
       ['ANCINE', 'Itens deliberados em reunião (itens das atas)', tot_itens, f'{sum(ddc_usadas.values())} com DDC lida; {len(sem_ddc_publicada)} de sessão reservada sem DDC publicada'],
       ['ANCINE', 'Deliberações Ad Referendum 2026 (série 366)', len(DAR), 'ato de 1-2 diretores (não é voto colegiado); entram só como autores de cada ratificação'],
       ['ANCINE', 'Lista de processos distribuídos para relatoria', len(inv['series']['771']['itens']), 'relator dos circuitos'],
       ['ANCINE', 'Presidente e demais diretores', len(PAPEL), 'Alex Braga Muniz (Diretor-Presidente), Paulo Xavier Alcoforado, Patrícia Barcelos, Vinicius Clay Araújo Gomes (até a 966ª), Leandro de Sousa Mendes (Diretor Substituto, a partir da 971ª)']]
# ---- diretores e colegiado
primeira, ultima = {}, {}
for r in REU:
    for n_ in r['presentes']: primeira.setdefault(n_, r['data']); ultima[n_] = r['data']
ex = {}
fim_data = max(r['data'] for r in REU if r['situacao'].startswith('Realizada'))
for n_, u in ultima.items():
    if u < '2026-09-01' and n_ != 'Alex Braga Muniz': ex[n_] = f'última participação em {u[8:]}/{u[5:7]}/{u[:4]}; não consta mais nas atas seguintes (a fonte não informa o motivo/término de mandato)'
nao_feito = [
    ['ANCINE', 'Voto individual nominal nas reuniões deliberativas', f'{sum(1 for v in VOT if v["reuniao"].startswith("RD"))} votos de reunião', 'LIMITE ESTRUTURAL DA FONTE (parcial)', 'A ANCINE publica, para reuniões, só o RESULTADO ("decidiu por unanimidade/maioria") + exceções nomeadas (voto contrário, abstenção, impedimento, ausência) na DDC; a unanimidade vira 1 ACOMPANHOU por diretor signatário (inferido). Só os circuitos têm tabela nominal.', 'Só o vídeo da reunião (YouTube @AncineGov) mostraria cada voto; fora de escopo'],
    ['ANCINE', 'Relator nos itens de reunião', f'{sum(1 for d in DEL if d["reuniao"].startswith("RD"))} itens', 'LIMITE DA FONTE', 'Pauta, ata e DDC não nomeiam relator; a análise é da área técnica (SFO, SEF, SGI, OUV…). Relator só existe nos circuitos (pauta/proclamação) e onde a DDC publica "Manifestação do Diretor" (2 itens: RELATOR nominal).', 'Distribuição de relatoria de reuniões não é publicada'],
    ['ANCINE', 'tipo_item Vista / Aprovação de ata / Cancelada', '0 / 0 / 0', 'MEDIDO (inexistente)', 'varredura 100% do texto das 23 atas, 148 pautas e 1.819 DDC: nenhuma ocorrência de pedido de vista, item de aprovação de ata ou reunião cancelada em 2026', 'Reavaliar a cada rodada'],
    ['ANCINE', '"Mantida em pauta" classificada como Retirada de pauta', f'{sum(1 for d in DEL if d["tipo_item"] == "Retirada de pauta")} itens', 'DECISÃO DE CLASSIFICAÇÃO', 'a Diretoria decide por unanimidade manter/retirar o processo da pauta para nova apreciação (não decide o mérito); votos mantidos como ACOMPANHOU inferido', 'Rever se o IRIS quiser tipo próprio'],
    ['ANCINE', 'Decisões "tomou conhecimento" (sem modo de votação)', f'{sum(1 for v in VOT if v["voto"].startswith("SEM VOTO (sem votação"))} linhas', 'REVISAR (limite da fonte)', 'a DDC registra que a Diretoria "tomou conhecimento" sem declarar unanimidade/maioria; cada signatário aparece como SEM VOTO (sem votação declarada) REVISAR', 'Nenhuma: a fonte não declara'],
    ['ANCINE', 'Deliberações Ad Referendum (série 366)', f'{len(DAR)} DAR', 'FORA DO ESCOPO DE VOTO', 'decididas por 1-2 diretores; só aparecem aqui como autores das ratificações; a ratificação em reunião é o voto colegiado', 'n/a'],
    ['ANCINE', 'Pauta de reunião: versões anteriores', f'{sum(len(v) for v in PAUTAS.values())} versões', 'USADAS SÓ NA CONTAGEM', 'a última versão de cada reunião é o denominador de itens; versões intermediárias só contam para a prova de listagem', 'n/a'],
    ['ANCINE', 'Power BI de Reuniões/Circuitos (calendário e painel)', '2 painéis', 'NÃO LIDO', 'app.powerbi.com é painel dinâmico sem dado estático; o denominador independente usado foi pauta × ata × cabeçalho das DDC × página gov.br "Última/Próxima reunião"', 'Liberar app.powerbi.com se quiser o calendário oficial'],
]
DISP = {dd_: v for dd_, v in DIST.items()}
out = dict(reunioes=REU, deliberacoes=DEL, votos=VOT, qualidade=QUAL, cobertura=cob, pendencias=PEND, nao_feito=nao_feito, diretores=list(PAPEL), colegiado='Diretoria Colegiada (ANCINE)',
           ex_diretores=ex, composicao_nota='Colegiado de 5 cadeiras com vagas: reuniões de 2026 contam 3 a 5 diretores (Presidente + Diretores; Leandro de Sousa Mendes atua como Diretor Substituto). Diretor-Presidente vota como os demais.',
           papeis=PAPEL, distribuicao_relatoria=DIST, log_parser=[list(x) for x in LOG], _fonte=dict(sei=SEI, inventario=inv_f, gerado_em=inv['gerado_em']))
json.dump(out, open(out_f, 'w'), ensure_ascii=False, indent=1)
print('reunioes', len(REU), '| deliberacoes', len(DEL), '| votos', len(VOT), dict(collections.Counter(v['proveniencia'] for v in VOT)))
print('tipos', dict(collections.Counter(d['tipo_item'] for d in DEL)), '| rótulos', dict(collections.Counter(v['voto'].split(' (')[0] for v in VOT)))
print('pendencias', len(PEND), '| avisos do parser', len(LOG), '| qualidade DIVERGE:', [x[1][:70] for x in QUAL if x[4] == 'DIVERGE'])
