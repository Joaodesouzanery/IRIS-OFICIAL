#!/usr/bin/env python3
"""ANM: texto das atas (texto/*.txt) -> deliberacoes + votos por diretor (CSV/JSON).

Proveniencia: nominal (o texto cita o diretor), inferido (unanimidade: todos os presentes),
REVISAR (maioria/vista/impedimento que o texto nao resolve por nome).
Uso: python3 -I anm_parse.py <dir_texto> <saida.json>
"""
import re, sys, json, glob, os, unicodedata

MESES = {'janeiro':1,'fevereiro':2,'marco':3,'abril':4,'maio':5,'junho':6,'julho':7,'agosto':8,'setembro':9,'outubro':10,'novembro':11,'dezembro':12}
UNID = {'um':1,'dois':2,'tres':3,'quatro':4,'cinco':5,'seis':6,'sete':7,'oito':8,'nove':9,'dez':10,'onze':11,'doze':12,'treze':13,'quatorze':14,'quinze':15,'dezesseis':16,'dezessete':17,'dezoito':18,'dezenove':19,'vinte':20,'trinta':30}

def norm(s):
    s = s.replace('Mendonga','Mendonca').replace('mendonga','mendonca')
    return ''.join(c for c in unicodedata.normalize('NFD', s.lower()) if unicodedata.category(c) != 'Mn')

def data_da_ata(t):
    m = re.search(r'Aos\s+(.+?)\s+do\s+m[eê]s\s+de\s+(\w+)\s+do\s+ano', t, re.S)
    if not m: return None
    d = sum(UNID.get(w, 0) for w in re.split(r'\s+e\s+|\s+', norm(m[1])) if w in UNID)
    a = re.search(r'ano\s+de\s+dois\s+mil\s+e\s+([a-zç\s]+?),\s', t[m.start():m.start()+300])
    ano = 2000 + sum(UNID.get(w, 0) for w in norm(a[1]).split() if w in UNID) if a else None
    return f'{ano or 0}-{MESES.get(norm(m[2]),0):02d}-{d:02d}' if d else None

def presentes(t):
    m = re.search(r'presidida pelo (.+?)\.\s*(?:Tamb[eé]m|O Diretor-Geral)', re.sub(r'\s+', ' ', t[:4000]))
    if not m: return []
    txt = re.split(r'\.?\s*Em raz[aã]o d[oa]\s+(?:t[eé]rmino|aus[eê]ncia|afastamento)', m[1])[0]   # nome citado so como quem SAIU (REP31: Guilherme Gomes) nao e presente
    nomes = []
    for p in re.split(r',\s*e\s+|,\s+|\s+e\s+do\s+|\s+e\s+da\s+|\s+do\s+Diretor|\s+da\s+Diretora', txt):
        p = re.sub(r'^(?:e\s+)?(?:contou com a presen[cç]a\s*)?(?:d[oa]\s+)?', '', p.strip())
        p = re.sub(r'^(Diretor-Geral|Diretora?(?: Substitut[oa])?|Diretor)\s*,?\s*', '', p).strip(' .')
        p = re.sub(r'^(?:Diretor(?:a)?(?: Substitut[oa])?\s+)', '', p)
        p = re.split(r'\.\s|\s+Em raz[aã]o|\s+tamb[eé]m', p)[0].strip(' .')
        if p and 2 <= len(p.split()) <= 7 and not re.search(r'reuni|Procurador|Secret|presen', p): nomes.append(p)
    return nomes

def ausentes_ata(t, pres):
    """Diretores que a ata declara ausentes (hospitalizado / ausencia justificada) -> [(nome_em_pres_ou_texto, motivo)]."""
    f = re.sub(r'\s+', ' ', t[:6000]); out = []
    for mm in re.finditer(r'Diretor(?:a)?(?: Substitut[oa])?\s+([A-ZÀ-Ú][\wÀ-ú]+(?: [A-ZÀ-Ú][\wÀ-ú]+){1,4}) encontra-se hospitaliza', f):
        out.append((mm[1], 'hospitalizado'))
    for mm in re.finditer(r'aus[eê]ncia justificada d[oa] Diretor(?:a)?(?: Substitut[oa])?\s+([A-ZÀ-Ú][\wÀ-ú]+(?: [A-ZÀ-Ú][\wÀ-ú]+){1,4})', t[:12000].replace('\n', ' ')):
        if all(norm(mm[1]) != norm(o[0]) for o in out): out.append((mm[1], 'ausência justificada'))
    return out

def resolve(nome, pres):
    n = norm(nome)
    for p in pres:
        if norm(p) in n or n in norm(p): return p
    toks = [x for x in n.split() if len(x) > 3]
    for p in pres:
        if toks and all(x in norm(p) for x in toks[:2]): return p
    return None

NARR = json.load(open('anm_narrativas.json')) if os.path.exists('anm_narrativas.json') else {}

def parse(path):
    raw = open(path, encoding='utf8').read()
    # remove rodapes de pagina para nao quebrar frases
    t = re.sub(r'\n\s*Ata \d+ª.*?pg\. \d+\s*\n', '\n', raw)
    tag = os.path.basename(path)[:-4]
    pres = presentes(t)
    dg = pres[0] if pres else None
    aus_ = [(resolve(n, pres + [n]) or n, mot) for n, mot in ausentes_ata(t, pres) if not any(norm(n).split()[0] == norm(p).split()[0] for p in pres)]
    meta = {'reuniao': tag, 'data': data_da_ata(t), 'presentes': pres}
    if aus_: meta['ausentes_ata'] = [{'diretor': n, 'motivo': mot} for n, mot in aus_]
    # divide por itens: cada "PROCESSO Nº"
    itens = list(re.finditer(r'(?:^|\n)\s*(\d+(?:\.\d+)*)\.?\s*(?:ASSUNTO:.*?\n\s*)*?(?:\d+(?:\.\d+)+\s+)?PROCESSO N[ºO°]:\s*([\d./-]+)', t))
    heads = [(m.start(), m[0]) for m in re.finditer(r'\n\s*\d+\.\s+DIRETOR(?:-GERAL| SUBSTITUTO)?\s*([A-ZÁÉÍÓÚÇÂÊÃÕ ]*)\n', t)]
    procs = list(re.finditer(r'PROCESSOS?\s+N[ºO°o0]?\s*:\s*([\d][\d./-]*)', t))
    out = []
    for i, m in enumerate(procs):
        ini = m.start(); fim = procs[i+1].start() if i+1 < len(procs) else len(t)
        bloco = t[ini:fim]
        # relator = ultimo cabecalho "N. DIRETOR X" antes do item
        rel = None
        for pos, h in heads:
            if pos < ini:
                nome = re.sub(r'^\s*\d+\.\s+', '', h).strip()
                nome = re.sub(r'^DIRETOR(?:-GERAL| SUBSTITUTO)?\s*', '', nome).strip() or 'Diretor-Geral'
                rel = dg if nome == 'Diretor-Geral' else (resolve(nome.title(), pres) or nome.title())
        inter = re.search(r'INTERESSAD[OA]S?:\s*(.+?)(?:\n\s*(?:SUSTENTA|VOTO|ASSUNTO|DELIBERA)|$)', bloco, re.S)
        deli = re.search(r'DELIBERA[ÇC][ÃA]O:\s*(.+?)(?:\n\s*\n|\Z)', bloco, re.S)
        dtx = re.sub(r'\s+', ' ', deli[1]).strip() if deli else ''
        dn = norm(dtx)
        r2 = re.search(r'voto do (?:relator|revisor)[^,]*,\s*(?:Diretor(?:a)?(?:-Geral)?(?: Substitut[oa])?)\s*([A-Za-zÀ-ú ]*?)(?:,|\s+aprov)', dtx, re.I)
        bn = norm(bloco[:2600]); retirou = None; tipo_item = 'Deliberação'; processos_item = re.findall(r'\d{5}\.\d{3}\.?\d*/\d{4}-?\d*', bloco.split('INTERESSAD')[0])
        m_ret = re.search(r'item retirado de pauta pel[oa]\s+(?:diretor[ -]+)?(relator|revisor|geral)', bn)
        m_prop = re.search(r'diretor(?: substituto)? ([a-z ]+?) propos a retirada do item de pauta', bn)
        if re.search(r'aprovada a ata', bn[:500]) and not deli: res, tipo_item = 'ATA APROVADA', 'Aprovação de ata'
        elif not deli and m_ret: res, tipo_item, retirou = 'RETIRADO DE PAUTA', 'Retirada de pauta', ('diretor-geral' if m_ret[1] == 'geral' else m_ret[1])
        elif not deli and m_prop: res, tipo_item, retirou = 'RETIRADO DE PAUTA (diligência)', 'Retirada de pauta', 'proposta:' + m_prop[1]
        elif re.search(r'sobrest|pedido de vista', dn): res = 'SOBRESTADO (vista)'
        elif not deli: res = 'SEM DELIBERACAO NO TEXTO'
        elif 'unanimidade' in dn: res = 'APROVADO POR UNANIMIDADE'
        elif 'maioria' in dn: res = 'APROVADO POR MAIORIA'
        elif re.search(r'retirad|baixad|adiad', dn): res = 'RETIRADO/ADIADO'
        else: res = 'OUTRO'
        num_item = re.search(r'(\d+\.\d+)\.\d+\s*$', t[max(0, ini - 14):ini])
        m_item = re.search(r'(\d+(?:\.\d+)+)\.?\s*$', t[max(0, ini - 16):ini]); item_n = m_item[1] if m_item else f'#{i + 1}'
        grp = [g for g in re.finditer(r'(\d+\.\d+)\.?\s*ASSUNTO:\s*(.+?)(?=\n\s*\d+\.\d+\.\d+\s+PROCESSOS?\b)', t[:ini + 30], re.S)]
        if num_item: grp = [g for g in grp if g[1] == num_item[1]]
        ass = type('G', (), {'__getitem__': lambda self, k, g=grp[-1]: g[2]})() if grp and (num_item or ini - grp[-1].end() < 2500) else None
        mvt = re.search(r'VOTO[^:\n]{0,40}:\s*(.{40,700}?)(?:\n\s*(?:DELIBERA|INTERESSAD|SUSTENTA)|\Z)', bloco, re.S)
        voto_resumo = re.sub(r'\s+', ' ', mvt[1]).strip()[:500] if mvt else ''
        mr = re.search(r'Voto do Relator,\s*(?:Diretor(?:a)?(?:-Geral)?(?: Substitut[oa])?)\s*([A-Za-zÀ-ú ]+?)(?:,|\s+aprovad)', dtx)
        if mr and resolve(mr[1], pres + [x for x in [rel] if x]): rel = resolve(mr[1], pres + [rel] if rel else pres)
        elif mr: rel = mr[1].strip()
        if re.search(r'Voto do Relator,\s*Diretor-Geral', dtx, re.I): rel = dg
        def quem(sx):
            tk = re.findall(r'\w+', norm(sx))
            r_ = [x for x in pres if norm(x).split()[0] in tk]   # primeiro nome identifica (Tasso x José Fernando: ambos terminam em Júnior/Jr)
            if not r_: r_ = [x for x in pres if norm(x).split()[-1] in tk and sum(norm(y).split()[-1] == norm(x).split()[-1] for y in pres) == 1]
            if re.search(r'diretor-?\s?geral', sx, re.I) and dg and dg not in r_: r_.append(dg)
            return r_
        dissid, favor, vista_por = [], [], []
        mdv = re.search(r'diverg[eê]nc\w+(.{0,90})', dtx, re.I)
        if mdv: dissid = quem(mdv[1])
        mct = re.search(r'voto contr[aá]rio d[oa]s?\s+(.{0,90})', dtx, re.I)   # "com voto contrário do Diretor X, relator original"
        if mct:
            for x in quem(re.split(r'[.,;]', mct[1])[0]):
                if x not in dissid: dissid.append(x)
        mvi = re.search(r'pedido de vistas?[^.]{0,40}?\s+pel[oa](?=\s|Diretor)\s*(.{0,70})', dtx, re.I)
        if mvi: vista_por = quem(re.split(r'[.,]|,? sendo', mvi[1])[0])
        mfa = re.search(r'^(.*?)(?:,\s*a delibera[çc][ãa]o foi sobrestada|a delibera[çc][ãa]o foi sobrestada)', dtx, re.I)
        if mfa and re.search(r'favor[aá]vel|acompanhar|acompanhou', mfa[1], re.I): favor = [x for x in quem(mfa[1]) if x not in vista_por]
        rev = None
        if re.search(r'diverg[eê]ncia[^.]*Revisor,\s*Diretor-Geral', dtx, re.I) or re.search(r'Voto do revisor,\s*Diretor-Geral', dtx, re.I): rev = dg
        else:
            mv = re.search(r'(?:Revisor|revisor),\s*(?:Diretor(?:a)?(?: Substitut[oa])?)\s*([A-Za-zÀ-ú ]+?)(?:,|\s+aprovad|\.)', dtx)
            if mv: rev = resolve(mv[1], pres)
        _nd = NARR.get(f"{tag}|{item_n}", {}).get('_dissidentes')
        if _nd: dissid = [x for x in [next((p_ for p_ in pres if norm(n_) in norm(p_)), n_) for n_ in _nd]]   # vencidos nomeados pela narrativa (ata nao traz "divergencia")
        if tipo_item == 'Deliberação' and res.startswith('SOBRESTADO'): tipo_item = 'Vista'
        def _lab(rot):
            ml = re.search(r'VOTO D[OA] ' + rot + r'\s*\(([^)]{3,80})\)', bloco, re.I)
            if not ml: return None
            nm = re.sub(r'^(?:Diretor(?:a)?(?:-Geral)?(?: Substitut[oa])?)\s*', '', ml[1].strip()).strip(' ,.')
            if re.search(r'diretor-?\s?geral', ml[1], re.I): return dg
            return (resolve(nm.title(), pres) or nm) if nm else None
        _lr, _lv = _lab('RELATOR'), _lab('REVISOR')
        if _lr: rel = _lr
        if _lv: rev = _lv
        # impedimentos / "não votaria": lidos do bloco inteiro do item (a frase vem antes de DELIBERAÇÃO)
        _ant = out[-1] if out else None
        _tail = ''
        if i > 0:
            _pb = t[procs[i-1].start():ini]; _dl = re.search(r'DELIBERA[ÇC][ÃA]O:\s*(.+?)(?:\n\s*\n|\Z)', _pb, re.S)
            _tail = _pb[_dl.end():] if _dl else ''
            _mp = re.search(r'Antes d[ao]s? delibera[çc][ãa]o do item\s+\d+(?:\.\d+)+', _pb)
            if _mp and not _dl: _tail = _pb[_mp.start():]
        _corpo = bloco.split('DELIBERAÇÃO:')[0] if 'DELIBERAÇÃO:' in bloco else bloco
        _mx = re.search(r'Antes d[ao]s? delibera[çc][ãa]o do item\s+\d+(?:\.\d+)+', _corpo)
        if _mx: _corpo = _corpo[:_mx.start()]   # a frase seguinte é do PRÓXIMO item (ex.: ROP82 2.3.1)
        bflat = re.sub(r'\s+', ' ', re.sub(r'\n\s*Ata \d+[ªa].*?pg\. \d+\s*', ' ', _tail + ' ' + _corpo)); imped = []
        for mi in re.finditer(r'(?:encontrava-se|encontravam-se|estava|estavam|ficou|ficaram)\s+impedid[oa]s?|n[ãa]o votari(?:a|am)\b|n[ãa]o participaria da vota[çc][ãa]o', bflat, re.I):
            pre = bflat[max(0, mi.start() - 230):mi.start()]
            cl = re.split(r',|\bque\b|pelo qual|motivo pelo|em raz[ãa]o d[eao]\b', pre)[-1]
            nomes_ = quem(cl) or quem(pre[-150:])
            for x in nomes_:
                if x not in imped: imped.append(x)
        out.append({'deliberacao': item_n, 'revisor': rev, 'reuniao': tag, 'data': meta['data'], 'processo': m[1], 'relator': rel,
                    'interessado': re.sub(r'\s+', ' ', inter[1]).strip() if inter else '',
                    'assunto': re.sub(r'\s+', ' ', ass[1]).strip()[:300] if ass else '', 'voto_resumo': voto_resumo,
                    'tipo_item': tipo_item, 'retirada_por': retirou or '', 'processos_do_item': processos_item[:30], 'dissidentes': dissid, 'favoraveis': favor, 'vista_por': vista_por, 'resultado': res, 'deliberacao_texto': dtx[:600], 'tem_impedimento': bool(imped), 'impedidos': imped, 'texto_impedimento': ('; '.join(re.findall(r'[^.]*(?:impedid|n[ãa]o votari|n[ãa]o participaria)[^.]*\.', bflat))[:400] if imped else '')})
    vistos, unico, dups = set(), [], 0
    for d in out:
        k = (d['deliberacao'], d['processo'])
        if k in vistos and not d['deliberacao'].startswith('#'): dups += 1 if d['resultado'] != 'ATA APROVADA' and not d['resultado'].startswith(('RETIRADO', 'SEM')) else 0; continue   # item impresso duas vezes na própria ata (ex.: ROP81 3.5.3)
        vistos.add(k); unico.append(d)
    out = unico; meta['itens_duplicados_na_ata'] = dups
    votos = []; meta_aus = {tag: meta.get('ausentes_ata', [])}
    for d in out:
        pr = [p for p in pres]
        if d['tipo_item'] == 'Aprovação de ata':
            for p in pr: votos.append({'reuniao': d['reuniao'], 'data': d['data'], 'processo': d['processo'], 'deliberacao': d['deliberacao'], 'diretor': p, 'voto': 'ACOMPANHOU', 'proveniencia': 'inferido', 'tipo_item': d['tipo_item']})
            continue
        if d['tipo_item'] == 'Retirada de pauta':
            rp = d['retirada_por']
            for p in pr:
                if rp == 'relator' and p == d['relator']: v, prov = 'RETIROU DE PAUTA', 'nominal'
                elif rp.startswith('proposta:'):
                    quem = resolve(rp.split(':', 1)[1].title(), pr)
                    v, prov = ('RETIROU DE PAUTA', 'nominal') if p == quem else ('ACOMPANHOU', 'nominal')
                else: v, prov = 'SEM VOTO (retirado de pauta)', 'n/a'
                votos.append({'reuniao': d['reuniao'], 'data': d['data'], 'processo': d['processo'], 'deliberacao': d['deliberacao'], 'diretor': p, 'voto': v, 'proveniencia': prov, 'tipo_item': d['tipo_item']})
            continue
        if d['resultado'].startswith('SEM DELIB'): continue
        citados = {}
        for p in pr:
            ult = norm(p).split()
            if re.search(r'\b' + re.escape(ult[-1]) + r'\b', norm(d['deliberacao_texto'])) : citados[p] = True
        ativos = [x for x in pr if x not in d.get('impedidos', [])]
        narr = NARR.get(f"{d['reuniao']}|{d['deliberacao']}", {})
        for p in pr:
            nv_ = next((v_ for k_, v_ in narr.items() if not k_.startswith('_') and norm(k_) in norm(p)), None)
            if nv_ and p not in d.get('impedidos', []):
                votos.append({'reuniao': d['reuniao'], 'data': d['data'], 'processo': d['processo'], 'deliberacao': d['deliberacao'], 'diretor': p, 'voto': nv_[0], 'proveniencia': nv_[1], 'tipo_item': d['tipo_item'], 'fonte_voto': 'narrativa do Secretário-Geral na ata'}); continue
            if p in d.get('impedidos', []) and p != d['relator']: v, prov = 'IMPEDIDO (ata: impedido de votar / não votaria)', 'nominal'
            elif p == d['relator'] and p in d.get('dissidentes', []): v, prov = 'DIVERGIU (relator original; voto vencido)', 'nominal'
            elif p == d['relator']: v, prov = 'RELATOR (voto proferido)', 'nominal'
            elif d.get('revisor') and p == d['revisor'] and p in d.get('dissidentes', []): v, prov = 'DIVERGIU (revisor; ata: divergência apresentada pelo revisor)', 'nominal'
            elif d.get('revisor') and p == d['revisor'] and d['revisor'] != d['relator'] and d['resultado'] in ('APROVADO POR UNANIMIDADE', 'APROVADO POR MAIORIA'): v, prov = 'REVISOR (voto proferido; ata cita o revisor)', 'nominal'
            elif p in d.get('dissidentes', []): v, prov = 'DIVERGIU', 'nominal'
            elif p in d.get('vista_por', []): v, prov = 'PEDIU VISTA', 'nominal'
            elif p in d.get('favoraveis', []): v, prov = 'ACOMPANHOU (votou a favor antes da vista)', 'nominal'
            elif d['resultado'] == 'APROVADO POR MAIORIA' and len(d.get('dissidentes', [])) == 1 and len(ativos) >= 3: v, prov = 'ACOMPANHOU (por exclusão: um só divergente nomeado)', 'inferido'
            elif d['resultado'] == 'APROVADO POR UNANIMIDADE': v, prov = 'ACOMPANHOU', 'inferido'
            elif d['resultado'] == 'SOBRESTADO (vista)': v, prov = 'SEM VOTO AINDA (vista pendente; os demais aguardam o retorno)', 'inferido'
            else: v, prov = 'REVISAR (maioria sem divergentes nomeados na ata)', 'REVISAR'
            votos.append({'reuniao': d['reuniao'], 'data': d['data'], 'processo': d['processo'], 'deliberacao': d['deliberacao'], 'diretor': p, 'voto': v, 'proveniencia': prov, 'tipo_item': d['tipo_item']})
        for ex_ in narr.get('_extras', []):   # voto escrito de quem nao esta na sessao (ex.: Revisor 1 que ja saiu da Diretoria)
            votos.append({'reuniao': d['reuniao'], 'data': d['data'], 'processo': d['processo'], 'deliberacao': d['deliberacao'], 'diretor': ex_['diretor'], 'voto': ex_['voto'], 'proveniencia': ex_['prov'], 'tipo_item': d['tipo_item'], 'fora_total': True})
        _aus = next((a_ for a_ in meta_aus.get(d['reuniao'], []) if d['relator'] and norm(a_['diretor']).split()[0] == norm(d['relator']).split()[0]), None)
        if d['relator'] and d['relator'] not in pr and _aus and d['tipo_item'] in ('Deliberação', 'Vista'):
            votos.append({'reuniao': d['reuniao'], 'data': d['data'], 'processo': d['processo'], 'deliberacao': d['deliberacao'], 'diretor': d['relator'], 'voto': f"AUSENTE ({_aus['motivo']}; relator da matéria — voto lido pelo Diretor-Geral, conforme a ata)", 'proveniencia': 'nominal', 'tipo_item': d['tipo_item']})
        elif d['relator'] and d['relator'] not in pr and d['tipo_item'] in ('Deliberação', 'Vista'):
            votos.append({'reuniao': d['reuniao'], 'data': d['data'], 'processo': d['processo'], 'deliberacao': d['deliberacao'], 'diretor': d['relator'], 'voto': 'RELATOR (voto de ex-diretor; fora da reunião e dos totais de 2026)', 'proveniencia': 'nominal', 'tipo_item': d['tipo_item'], 'fora_total': True})
    return meta, out, votos

if __name__ == '__main__':
    pasta, saida = sys.argv[1], sys.argv[2]
    R = {'reunioes': [], 'deliberacoes': [], 'votos': []}
    for f in sorted(glob.glob(os.path.join(pasta, 'R[EO]P*.txt'))):
        if os.path.getsize(f) < 500 and False:
            R['reunioes'].append({'reuniao': os.path.basename(f)[:-4], 'data': None, 'presentes': [], 'obs': 'SEM TEXTO (PDF imagem: precisa OCR)'}); continue
        m, d, v = parse(f); R['reunioes'].append(m); R['deliberacoes'] += d; R['votos'] += v
    canon = {}
    for m in R['reunioes']:
        for n in m['presentes']:
            if re.search(r'[À-ú]', n): canon[norm(n)] = n
    ALIAS = {norm(a): b for a, b in {'Caio Mário Seabra Filho': 'Caio Mário Trivellato Seabra Filho', 'José Fernando de Mendonça Gomes Jr': 'José Fernando de Mendonça Gomes Júnior', 'José Fernando de Mendonça Gomes Jr.': 'José Fernando de Mendonça Gomes Júnior', 'Guilherme Gomes': 'Guilherme Santana Lopes Gomes'}.items()}
    def fix(n):
        if not n: return n
        n = canon.get(norm(re.sub(r'^Substitut[oa]\s+', '', n)), re.sub(r'^Substitut[oa]\s+', '', n))
        return ALIAS.get(norm(n), n)
    for m in R['reunioes']: m['presentes'] = [fix(n) for n in m['presentes']]
    for x in R['deliberacoes']:
        x['relator'] = fix(x['relator']); x['revisor'] = fix(x['revisor'])
        for k in ('dissidentes', 'favoraveis', 'vista_por', 'impedidos'): x[k] = [fix(n) for n in x[k]]
    for m in R['reunioes']:
        for a_ in m.get('ausentes_ata', []): a_['diretor'] = fix(a_['diretor'])
    for x in R['votos']: x['diretor'] = fix(x['diretor'])
    json.dump(R, open(saida, 'w'), ensure_ascii=False, indent=1)
    for m in R['reunioes']: print(m['reuniao'], m.get('data'), len(m['presentes']), m.get('obs', ''))
    print('deliberacoes', len(R['deliberacoes']), 'votos', len(R['votos']))
