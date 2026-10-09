"""ANAC: varredura 100% INDEPENDENTE (NAO importa o parser nem anac_lib): relê TODAS as páginas salvas em fonte/anac (APEX, calendário,
páginas de reunião, pautas) E os textos das atas/certidões/votos lidos (texto_anac/, com regex própria, por sobrenome) e confere contra anac.json
item a item e voto a voto (presença real, ausentes, impedidos, vencidos, vista, relator); confere sha256 do manifesto e a cadeia listado×baixado×lido.
uso: python3 -I scripts/anac_varredura.py anac.json anac_inventario.json [fonte/anac] [manifesto_anac.json]
saída: contadores oficial × listado × baixado × lido; falhas por regra; exit 1 se alguma regra falhar."""
import sys, os, re, json, html, hashlib, datetime, unicodedata, collections, glob
J = json.load(open(sys.argv[1])); INV = json.load(open(sys.argv[2])); DIR = sys.argv[3] if len(sys.argv) > 3 else 'fonte/anac'; MAN = sys.argv[4] if len(sys.argv) > 4 else 'manifesto_anac.json'
falhas = collections.defaultdict(list)
def F(regra, msg): falhas[regra].append(msg)
def rd(p): return open(p, errors='replace').read()
def limpa(x): return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', x))).replace('\xa0', ' ').strip()
def nz(s): return ''.join(c for c in unicodedata.normalize('NFD', s.lower()) if unicodedata.category(c) != 'Mn').strip()
# --- colegiado re-codificado aqui (independente do parser): sobrenome -> nome; janela por sobrenome
SOBRE = {'faierstein': 'Tiago Faierstein', 'mesquita': 'Rui Mesquita', 'moreira': 'Antônio Mathias Moreira', 'honorato': 'Roberto Honorato', 'ianelli': 'Cláudio Ianelli', 'nascimento': 'Luiz Ricardo Nascimento', 'altoe': 'Mariana Altoé'}
def quem(nome): return SOBRE.get(nz(nome.split()[-1])) if nome.strip() else None
JAN = {'Tiago Faierstein': ('2026-01-01', '2026-12-31'), 'Rui Mesquita': ('2026-01-01', '2026-12-31'), 'Antônio Mathias Moreira': ('2026-01-01', '2026-12-31'),
       'Luiz Ricardo Nascimento': ('2026-01-01', '2026-03-22'), 'Mariana Altoé': ('2026-02-12', '2026-04-24'), 'Roberto Honorato': ('2026-03-23', '2026-12-31'), 'Cláudio Ianelli': ('2026-04-25', '2026-12-31')}
# --- 1. índices APEX: ids e títulos
apex = {}
for arq, tipo in (('apex_presenciais_2026.html', 'p'), ('apex_eletronicas_2026.html', 'e')):
    u = html.unescape(rd(os.path.join(DIR, arq)))
    for i, t, d in re.findall(r'P139_ID_REUNIAO_DIRETORIA:(\d+)">([^<]+)</a></div><div class="description" >([^<]*)', u): apex[i] = (tipo, t.strip(), d.strip())
n_apex_p = sum(1 for v in apex.values() if v[0] == 'p'); n_apex_e = sum(1 for v in apex.values() if v[0] == 'e')
ids_json = {r['id_apex'] for r in J['reunioes']}
if set(apex) != ids_json: F('indice APEX = reuniões do JSON', f'só no índice {sorted(set(apex) - ids_json)}; só no JSON {sorted(ids_json - set(apex))}')
# ordinais sem buraco
for tipo, rot in (('p', 'presencial'), ('e', 'eletrônica')):
    for extra in (False, True):
        ns = sorted(int(re.match(r'(\d+)', v[1]).group(1)) for v in apex.values() if v[0] == tipo and (('Extraordin' in v[1]) == extra))
        if ns and ns != list(range(1, len(ns) + 1)): F('numeração sem buraco', f'{rot} extra={extra}: {ns}')
# paginador ausente
for arq in ('apex_presenciais_2026.html', 'apex_eletronicas_2026.html'):
    if re.search(r'a-IRR-pagination|apex_pagination|a-IRR-paginator|Linhas por p', html.unescape(rd(os.path.join(DIR, arq))), flags=re.I): F('sem paginador', arq + ' tem marcador de paginação')
# --- 2. calendário: re-lê a Portaria
ct = limpa(rd(os.path.join(DIR, 'apex_calendario_portaria_18366.html')))
m = re.search(r'Mês Datas das Reuniões(.*?)_{5,}', ct); MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
cal = []
for i, mes in enumerate(MESES):
    mm = re.search(mes + r'\s+([0-9º ,e]+?)(?=\s+(?:' + '|'.join(MESES) + r')\b|\s*$)', m.group(1))
    cal += [f'2026-{i+1:02d}-{int(d):02d}' for d in re.findall(r'\d+', mm.group(1))] if mm else []
if cal != INV['calendario']['datas']: F('calendário', f'varredura {len(cal)} datas × inventário {len(INV["calendario"]["datas"])}')
# --- 3. páginas de reunião: itens e campos, 100%
def itens_pagina(h):
    """cópia real = texto fora dos atributos escapados: os blocos reais contêm '<strong>Processo:' sem &lt;"""
    partes = re.split(r'(?=<table\s+class="c">)', h)[1:]
    out = []
    for blk in partes:
        blk = blk.split('</table>')[0]
        if '<strong>Processo:' not in blk: continue
        g = lambda lab: (lambda mm: limpa(mm.group(1)) if mm else None)(re.search(r'<strong>\s*' + lab + r':(?:&nbsp;?)*\s*</strong>.*?<p[^>]*>(.*?)</p>', blk, flags=re.S))
        n = re.search(r'<strong>\s*(\d+)\)', blk)
        out.append({'n': n.group(1) if n else None, 'proc': g('Processo'), 'assunto': g('Assunto'), 'relator': g('Relator'), 'delib': g('Deliberação')})
    return out
dj = collections.defaultdict(list)
for d in J['deliberacoes']: dj[d['reuniao']].append(d)
rj = {r['reuniao']: r for r in J['reunioes']}
vj = collections.defaultdict(list)
for v in J['votos']: vj[(v['reuniao'], v['processo'], v['deliberacao'])].append(v)
MANIF = json.load(open(MAN)); TXT = os.path.join(os.path.dirname(os.path.abspath(DIR.rstrip('/'))), 'texto_anac') if False else 'texto_anac'
def texto_de(e): 
    f = os.path.join(TXT, str(e.get('id')) + '.txt'); return re.sub(r'\s+', ' ', rd(f)).replace('V erificado', 'Verificado') if e.get('texto') and os.path.exists(f) else ''
ATA_T = {e['reuniao']: texto_de(e) for e in MANIF if e['tipo'] == 'documento (Ata)' and e.get('texto')}
DOC_URL = {e['url']: e for e in MANIF if e['tipo'].startswith('documento')}
def sobrenomes(trecho):
    """quais membros (por sobrenome) aparecem num trecho de texto"""
    t = nz(trecho); return {nome for sob, nome in SOBRE.items() if re.search(r'\b' + sob + r'\b', t)}
SOBRE['pereira'] = 'Tiago Sousa Pereira'
def presenca_ata(t):
    """independente do parser: preâmbulo -> (presentes, ausentes). Presidente conta como presente."""
    i = t.find('teve início'); j = t.find('Verificado', i); pre = t[i:j]
    aus_m = re.search(r'ausentes?\s+justificadamente\s+(?:o|a|os|as)\s+Diretor\w*\s+([^.]+?)\s*\.', pre)
    aus = sobrenomes(aus_m.group(1)) if aus_m else set()
    corpo = pre[:aus_m.start()] if aus_m else pre
    corpo = re.sub(r'Diretora? Substitut\w*', '', corpo)
    return sobrenomes(corpo) - aus, aus
def chunk_item(t, proc):
    """trecho da ata do item: de 'Processo: <proc>' até o próximo item/relatoria/encerramento; devolve (chunk, voto_vista_antes)"""
    k = t.find('Processo: ' + proc)
    if k < 0: return '', ''
    ant = t[max(0, k - 160):k]
    rest = t[k:]; fim = re.search(r'\s\d+\s?\)\s*Processo:|Relatoria d[oa]|Em \d+ de \w+ de \d{4}, foi submetido|Na sequência|A reunião encerrou-se|Nada mais havendo', rest[20:])
    return rest[:(fim.start() + 20) if fim else len(rest)], ant
def cert_de(item_docs, rid):
    """certidão ligada ao item (por link) e lida: (relator por sobrenome, modo, texto) ou None se for de outra reunião"""
    for x in item_docs:
        if x['rotulo'] == 'Certidão de deliberação':
            e = DOC_URL.get(x['url']); 
            if not e or not e.get('texto'): continue
            c = texto_de(e); m = re.search(r'apreciação da matéria abaixo na (\d+)ª Reunião Deliberativa( Eletrônica)?( Extraordinária)?|pela Diretoria Colegiada na (\d+)ª Reunião Deliberativa( Eletrônica)?( Extraordinária)?', c)
            if m:
                g = [x_ for x_ in m.groups()]; num = g[0] or g[3]; ele = bool(g[1] or g[4])
                if num != re.sub(r'\D', '', rid) or ele != rid.startswith('RE'): return None
            mr = re.search(r'Relator (.+?) Deliberação (.*?)(?: Ato decorrente| À | Ao | Documento assinado)', c)
            if mr: return (quem(mr.group(1)), mr.group(2), c)
            return (None, c, c)
    return None
tot_it = tot_dec = tot_votos_esp = 0; paginas = 0; hoje = INV['calendario']['hoje']
n_pres_real = n_pres_inf = 0; cont_prov = collections.Counter()
for r in J['reunioes']:
    pg = os.path.join(DIR, 'reu', r['id_apex'] + '.html')
    if not os.path.exists(pg): F('página da reunião existe', r['reuniao']); continue
    h = rd(pg); paginas += 1; its = itens_pagina(h)
    if len(its) != len(dj[r['reuniao']]): F('nº de itens por reunião', f"{r['reuniao']}: página {len(its)} × JSON {len(dj[r['reuniao']])}")
    real = apex[r['id_apex']][2].replace('Realização:', '').strip()
    if real not in r['titulo']: F('data/título da reunião', f"{r['reuniao']}: índice '{real}' não está em '{r['titulo']}'")
    ds = apex[r['id_apex']][2].replace('Realização:', ''); mes_fim = int(re.search(r'/(\d{1,2})/\d{4}', ds).group(1)); dts = []
    for p in re.split(r'\s+e\s+', re.sub(r'/\d{4}', '', ds).strip()):
        mm = re.fullmatch(r'(\d{1,2})(?:/(\d{1,2}))?', p.strip())
        if mm: dts.append(f'2026-{int(mm.group(2) or mes_fim):02d}-{int(mm.group(1)):02d}')
    ata_t = ATA_T.get(r['reuniao']); decidida = any(a['delib'] for a in its)
    # ---- presença: REAL (ata) ou janela (sem ata) ----
    if decidida:
        if ata_t:
            pres_esp, aus_esp = presenca_ata(ata_t); n_pres_real += 1
            if r.get('presenca') != 'real (ata)': F('presença marcada como real quando há ata', r['reuniao'])
        else:
            pres_esp = {n for n, (x, y) in JAN.items() if any(x <= dd <= y for dd in dts)} | {quem(a['relator']) for a in its if a['relator'] and quem(a['relator'])}; aus_esp = set(); n_pres_inf += 1
            if r.get('presenca') != 'inferida': F('presença marcada como inferida quando não há ata', r['reuniao'])
        if set(r['presentes']) != pres_esp: F('presentes = presença da ata/janela', f"{r['reuniao']}: JSON {sorted(r['presentes'])} × esperado {sorted(pres_esp)}")
        if set(r['ausentes']) != aus_esp: F('ausentes = ausentes justificados da ata', f"{r['reuniao']}: JSON {sorted(r['ausentes'])} × esperado {sorted(aus_esp)}")
    else: pres_esp, aus_esp = set(), set()
    for a, d in zip(its, dj[r['reuniao']]):
        tot_it += 1
        mproc = re.search(r'\d{5}\.\d{6}/\d{4}-\d{2}', a['proc'] or '')
        if not mproc or mproc.group(0) != d['processo']: F('processo do item', f"{r['reuniao']}#{a['n']}: {a['proc']!r} × {d['processo']!r}")
        if a['n'] != d['item_n']: F('número do item', f"{r['reuniao']}: {a['n']} × {d['item_n']}")
        if (a['relator'] and quem(a['relator'])) != d['relator']: F('relator do item', f"{r['reuniao']}#{a['n']}: {a['relator']!r} × {d['relator']!r}")
        if (a['assunto'] or '') != d['assunto']: F('assunto do item', f"{r['reuniao']}#{a['n']}")
        txt = a['delib'] or ''
        if txt and not d['resultado'].startswith(txt): F('deliberação do item', f"{r['reuniao']}#{a['n']}: {txt!r} × {d['resultado']!r}")
        if not txt and not d['resultado'].startswith(('RESULTADO NÃO PUBLICADO', 'REUNIÃO AINDA NÃO')): F('item sem desfecho identificado', f"{r['reuniao']}#{a['n']}")
        vs = vj[(r['reuniao'], d['processo'], d['deliberacao'])]
        if not txt:
            if vs: F('item sem desfecho não tem voto', f"{r['reuniao']}#{a['n']}: {len(vs)} votos")
            continue
        tot_dec += 1
        rel = quem(a['relator']) if a['relator'] else None
        esp = set(pres_esp) | aus_esp | ({rel} if rel else set())
        got = [v['diretor'] for v in vs]
        if len(got) != len(set(got)): F('voto duplicado', f"{r['reuniao']}#{a['n']}")
        if set(got) != esp: F('votantes = presentes + ausentes da reunião', f"{r['reuniao']}#{a['n']}: JSON {sorted(set(got))} × esperado {sorted(esp)}")
        tot_votos_esp += len(esp)
        lo = txt.lower(); ch, ant = chunk_item(ata_t, d['processo']) if ata_t else ('', '')
        if ata_t and not ch: F('item localizado na ata (por nº do processo)', f"{r['reuniao']}#{a['n']} {d['processo']}")
        cert = cert_de(d['documentos'], r['reuniao'])
        if cert:
            if cert[0] and a['relator'] and cert[0] != quem(a['relator']): F('relator página = certidão', f"{r['reuniao']}#{a['n']}: {quem(a['relator'])} × {cert[0]}")
            mc = 'unanimidade' if 'unanimidade' in cert[1].lower() else ('maioria' if 'maioria' in cert[1].lower() else '')
            mp = 'unanimidade' if 'unanimidade' in lo else ('maioria' if 'maioria' in lo else '')
            if mp and mc and mp != mc: F('modo página = certidão', f"{r['reuniao']}#{a['n']}: {mp} × {mc}")
        # textos que valem para o item: página + ata + certidão
        T = ' '.join(x for x in (lo, ch.lower(), (cert[1].lower() if cert else '')) if x)
        vista_m = re.search(r'pedido de vista formulado pel[oa] diretor[a]? ([^.;]+)', ch, flags=re.I); vista_p = quem(vista_m.group(1)) if vista_m else None
        imped = {quem(m.group(1)) for m in re.finditer(r'diretor[a]? ([\wÀ-ÿ ]+?) declarou-se imped', ch, flags=re.I)}
        vv_m = re.search(r'Voto-Vista do Diretor[a]? ([\wÀ-ÿ ]+?):', ant + ' ' + ch[:0]); vv_p = quem(vv_m.group(1)) if vv_m else None
        rel_venc = bool(re.search(r'vencido o relator', T))
        relator_votou = 'o relator votou' in ch.lower()
        tp = d['tipo_item']
        for v in vs:
            L_, pv, dn = v['voto'], v['proveniencia'], v['diretor']; cont_prov[(L_.split(' (')[0], pv)] += 1
            if pv not in ('nominal', 'inferido', 'REVISAR'): F('proveniência válida', f"{r['reuniao']}#{a['n']} {pv}")
            if not re.match(r'(ACOMPANHOU|DIVERGIU|RELATOR|AUSENTE|IMPEDIDO|SEM VOTO|PEDIU VISTA|VOTOU|NÃO PARTICIPOU|VISTA COLETIVA)', L_): F('rótulo de voto válido', f"{r['reuniao']}#{a['n']} {L_!r}")
            if pv == 'REVISAR': F('sem REVISAR', f"{r['reuniao']}#{a['n']} {dn}: {L_}")
            if not v.get('motivo'): F('todo voto tem motivo', f"{r['reuniao']}#{a['n']} {dn}")
            if dn in aus_esp:
                if not (L_.startswith('AUSENTE') and pv == 'nominal'): F('ausente justificado => AUSENTE nominal', f"{r['reuniao']}#{a['n']} {dn} {L_}")
                continue
            if L_.startswith('AUSENTE'): F('AUSENTE só para ausente justificado da ata', f"{r['reuniao']}#{a['n']} {dn}")
            is_rel = (dn == rel)
            if dn in imped:
                if not (L_.startswith('IMPEDIDO') and pv == 'nominal'): F('impedido na ata => IMPEDIDO nominal', f"{r['reuniao']}#{a['n']} {dn} {L_}")
                continue
            if L_.startswith('IMPEDIDO'): F('IMPEDIDO só com declaração na ata', f"{r['reuniao']}#{a['n']} {dn}")
            if vista_p and dn == vista_p:
                if not (L_.startswith('PEDIU VISTA') and pv == 'nominal'): F('pedido de vista da ata => PEDIU VISTA nominal', f"{r['reuniao']}#{a['n']} {dn} {L_}")
                continue
            if L_.startswith('PEDIU VISTA') and dn != vista_p: F('PEDIU VISTA só para quem a ata nomeia', f"{r['reuniao']}#{a['n']} {dn}")
            if tp == 'Vista':
                if is_rel and not L_.startswith('RELATOR'): F('relator em vista => RELATOR', f"{r['reuniao']}#{a['n']} {L_}")
                if is_rel and relator_votou and 'votou antes da vista' not in L_: F('relator votou antes da vista (ata)', f"{r['reuniao']}#{a['n']} {L_}")
                if not is_rel and not L_.startswith(('SEM VOTO', 'PEDIU VISTA')): F('vista => demais sem voto de mérito', f"{r['reuniao']}#{a['n']} {dn} {L_}")
                continue
            if is_rel and rel_venc:
                if not (L_.startswith('DIVERGIU') and pv == 'nominal'): F('relator vencido (ata) => DIVERGIU nominal', f"{r['reuniao']}#{a['n']} {L_}")
                continue
            if vv_p and dn == vv_p and rel_venc:
                if not (L_.startswith('VOTOU') and pv == 'nominal'): F('autor do voto-vista vencedor => VOTOU nominal', f"{r['reuniao']}#{a['n']} {L_}")
                continue
            if is_rel and not L_.startswith('RELATOR'): F('relator vota como RELATOR', f"{r['reuniao']}#{a['n']} {L_}")
            if L_.startswith('RELATOR') and not is_rel: F('RELATOR só para o relator', f"{r['reuniao']}#{a['n']} {dn}")
            if is_rel: continue
            if tp == 'Retirada de pauta':
                if not L_.startswith('SEM VOTO'): F('retirada => sem voto', f"{r['reuniao']}#{a['n']} {L_}")
                continue
            if 'unanimidade' in T and not rel_venc:
                if not L_.startswith('ACOMPANHOU'): F('unanimidade => ACOMPANHOU', f"{r['reuniao']}#{a['n']} {dn} {L_}")
                if L_.startswith('ACOMPANHOU') and pv == 'nominal' and L_ == 'ACOMPANHOU': F('ACOMPANHOU simples por unanimidade é inferido', f"{r['reuniao']}#{a['n']} {dn}")
            elif rel_venc:
                if not (L_.startswith('ACOMPANHOU') and pv == 'inferido'): F('maioria com relator vencido => demais ACOMPANHOU inferido', f"{r['reuniao']}#{a['n']} {dn} {L_}")
            else: F('decisão sem modo reconhecido', f"{r['reuniao']}#{a['n']} {dn} {L_}")
        if tp == 'Vista' and not vista_p and ata_t: F('vista com pedinte na ata', f"{r['reuniao']}#{a['n']}")
        if ('vista' in lo and tp != 'Vista') or ('retirado' in lo and 'vista' not in lo and tp != 'Retirada de pauta') or (not ('vista' in lo or 'retirado' in lo) and tp != 'Deliberação'): F('tipo_item', f"{r['reuniao']}#{a['n']} {tp}")
        if not (d.get('decisao_ata') or not ata_t): F('decisao_ata preenchida quando há ata', f"{r['reuniao']}#{a['n']}")
# pautas
for r in INV['reunioes_2026']:
    pp = os.path.join(DIR, r['arquivo_pauta'])
    if not os.path.exists(pp) or os.path.getsize(pp) < 10000: F('pauta baixada', r['reuniao'])
# --- 4. manifesto: sha256 de tudo, arquivo e texto
man = MANIF; nsha = nbad = 0
for e in man:
    if e.get('sha256'):
        nsha += 1
        if not os.path.exists(e['arquivo']) or hashlib.sha256(open(e['arquivo'], 'rb').read()).hexdigest() != e['sha256']: nbad += 1; F('sha256 do manifesto', e['arquivo'])
docs = [e for e in man if e['tipo'].startswith('documento')]
# cadeia listado (links nas páginas) x baixado x lido, recontada das PÁGINAS salvas
links = set()
for r in INV['reunioes_2026']:
    h = rd(os.path.join(DIR, r['arquivo']))
    reg = h[h.find('<div class="conteudo">'):] if '<div class="conteudo">' in h else h
    cab = reg[:reg.find('<table')] if '<table' in reg else reg
    for href, rot in re.findall(r'<a [^>]*?href=\s*"?([^\s">]+)[^>]*>(.*?)</a>', cab, flags=re.S):
        if limpa(rot) == 'Ata': links.add(html.unescape(href))
    for blk in re.findall(r'<table\s+class="c">(.*?)</table>', reg, flags=re.S):
        if 'Documentos' not in blk: continue
        for href in re.findall(r'<a [^>]*?href=\s*"?([^\s">]+)', blk.split('Documentos')[-1]):
            u = html.unescape(href)
            if 'sei.anac.gov.br' in u or 'pergamum.anac.gov.br' in u: links.add(u)
n_baix = sum(1 for e in docs if e['valido'] and os.path.exists(e['arquivo'])); n_lido = sum(1 for e in docs if e.get('texto') and os.path.exists(os.path.join(TXT, str(e['id']) + '.txt')) and len(rd(os.path.join(TXT, str(e['id']) + '.txt')).strip()) > 80)
if links != {e['url'] for e in docs}: F('documentos listados nas páginas = documentos do manifesto', f'páginas {len(links)} × manifesto {len(docs)}')
nao_lidos_json = {x['url'] for x in J.get('documentos_nao_lidos', [])}
for e in docs:
    if e['valido'] and not e.get('texto') and e['url'] not in nao_lidos_json: F('documento baixado e não lido está declarado', e['url'][:90])
    if not e['valido'] and not any((e['reuniao'] + ' —') in p[1] for p in J['pendencias']): F('documento não baixado coberto por pendência', e['url'][:90])
# --- 5. totais do JSON
if len(J['votos']) != tot_votos_esp: F('total de votos', f'JSON {len(J["votos"])} × esperado {tot_votos_esp}')
for p in J['pendencias']:
    if len(p) < 8 or not str(p[7]).startswith('http'): F('toda pendência tem URL', str(p[1])[:80])
print('=== VARREDURA ANAC (independente do parser) ===')
print(f"índice APEX: presenciais {n_apex_p} + eletrônicas {n_apex_e} = {len(apex)} | reuniões no JSON {len(J['reunioes'])} | páginas de reunião lidas {paginas} | pautas {sum(1 for r in INV['reunioes_2026'] if os.path.exists(os.path.join(DIR, r['arquivo_pauta'])))}")
print(f"calendário Portaria 18.366: {len(cal)} datas no ano, {sum(1 for c in cal if c <= hoje)} até {hoje}; presenciais listadas {n_apex_p}")
print(f"presença: REAL (ata, recontada por sobrenome) em {n_pres_real} reuniões; inferida (sem ata) em {n_pres_inf}")
print(f"itens: páginas {tot_it} × JSON {len(J['deliberacoes'])} (decididos {tot_dec}) | votos: esperados {tot_votos_esp} × JSON {len(J['votos'])}")
print(f"documentos: listados nas páginas {len(links)} × manifesto {len(docs)} × baixados {n_baix} × lidos {n_lido} (não lidos declarados: {len(nao_lidos_json)})")
print(f"manifesto: {len(man)} entradas, {nsha} com sha256 ({nbad} divergentes)")
print('votos por rótulo×proveniência:', dict(sorted(cont_prov.items())))
for k, v in sorted(falhas.items()): print(f'FALHA [{k}] {len(v)}:', v[:4])
print('RESULTADO:', 'OK (0 falhas)' if not falhas else f'{sum(len(v) for v in falhas.values())} falha(s) em {len(falhas)} regra(s)')
sys.exit(1 if falhas else 0)
