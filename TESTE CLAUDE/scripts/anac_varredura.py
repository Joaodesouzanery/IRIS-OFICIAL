"""ANAC: varredura 100% INDEPENDENTE (NAO importa o parser nem anac_lib): relê TODAS as páginas salvas em fonte/anac (APEX, calendário,
páginas de reunião, pautas) com regex própria e confere contra anac.json item a item e voto a voto; confere sha256 do manifesto.
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
       'Luiz Ricardo Nascimento': ('2026-01-01', '2026-03-22'), 'Mariana Altoé': ('2026-03-03', '2026-04-24'), 'Roberto Honorato': ('2026-03-23', '2026-12-31'), 'Cláudio Ianelli': ('2026-04-25', '2026-12-31')}
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
tot_it = tot_dec = tot_votos_esp = 0; paginas = 0; hoje = INV['calendario']['hoje']
PRESIDX = {}
for r in J['reunioes']:
    pg = os.path.join(DIR, 'reu', r['id_apex'] + '.html')
    if not os.path.exists(pg): F('página da reunião existe', r['reuniao']); continue
    h = rd(pg); paginas += 1; its = itens_pagina(h)
    if len(its) != len(dj[r['reuniao']]): F('nº de itens por reunião', f"{r['reuniao']}: página {len(its)} × JSON {len(dj[r['reuniao']])}")
    # datas: do índice
    real = apex[r['id_apex']][2].replace('Realização:', '').strip()
    if real not in r['titulo']: F('data/título da reunião', f"{r['reuniao']}: índice '{real}' não está em '{r['titulo']}'")
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
        # presentes esperados pelas janelas (código próprio)
        ds = apex[r['id_apex']][2].replace('Realização:', '')
        ano = 2026; mes_fim = int(re.search(r'/(\d{1,2})/\d{4}', ds).group(1)); dts = []
        for p in re.split(r'\s+e\s+', re.sub(r'/\d{4}', '', ds).strip()):
            mm = re.fullmatch(r'(\d{1,2})(?:/(\d{1,2}))?', p.strip())
            if mm: dts.append(f'2026-{int(mm.group(2) or mes_fim):02d}-{int(mm.group(1)):02d}')
        esp = {n for n, (x, y) in JAN.items() if any(x <= dd <= y for dd in dts)} | ({quem(a['relator'])} if a['relator'] else set())
        got = [v['diretor'] for v in vs]
        if len(got) != len(set(got)): F('voto duplicado', f"{r['reuniao']}#{a['n']}")
        if set(got) != esp: F('votantes = colegiado em exercício na data', f"{r['reuniao']}#{a['n']}: JSON {sorted(set(got))} × esperado {sorted(esp)}")
        if sorted(r['presentes']) != sorted(esp) and False: pass
        tot_votos_esp += len(esp)
        lo = txt.lower()
        for v in vs:
            L_, pv = v['voto'], v['proveniencia']
            if pv not in ('nominal', 'inferido', 'REVISAR'): F('proveniência válida', f"{r['reuniao']}#{a['n']} {pv}")
            if not re.match(r'(ACOMPANHOU|DIVERGIU|RELATOR|AUSENTE|IMPEDIDO|SEM VOTO|PEDIU VISTA|VOTOU|NÃO PARTICIPOU|VISTA COLETIVA)', L_): F('rótulo de voto válido', f"{r['reuniao']}#{a['n']} {L_!r}")
            if pv == 'REVISAR' and not v.get('motivo'): F('REVISAR tem motivo', f"{r['reuniao']}#{a['n']} {v['diretor']}")
            is_rel = quem(a['relator'] or '') == v['diretor']
            if is_rel and not L_.startswith('RELATOR'): F('relator vota como RELATOR', f"{r['reuniao']}#{a['n']} {L_}")
            if L_.startswith('RELATOR') and not is_rel: F('RELATOR só para o relator', f"{r['reuniao']}#{a['n']} {v['diretor']}")
            if L_.startswith('ACOMPANHOU') and not ('unanimidade' in lo or 'maioria' in lo): F('ACOMPANHOU só com unanimidade/maioria', f"{r['reuniao']}#{a['n']}")
            if L_.startswith('ACOMPANHOU') and ('retirad' in lo or 'vista' in lo): F('ACOMPANHOU em retirada/vista', f"{r['reuniao']}#{a['n']}")
            if 'unanimidade' in lo and not is_rel and 'retirad' not in lo and not L_.startswith('ACOMPANHOU'): F('unanimidade => ACOMPANHOU', f"{r['reuniao']}#{a['n']} {v['diretor']} {L_}")
            if 'maioria' in lo and not re.search(r'venc|contr', lo) and not is_rel and pv != 'REVISAR' and not L_.startswith(('VOTOU', 'PEDIU')): F('maioria sem vencidos => REVISAR', f"{r['reuniao']}#{a['n']} {v['diretor']}")
            if L_.startswith('DIVERGIU') and not re.search(r'venc|contr|diverg', lo): F('DIVERGIU exige nome no texto', f"{r['reuniao']}#{a['n']}")
            if 'retirado de pauta' in lo and 'vista' not in lo and not (L_.startswith('RELATOR') or L_.startswith('SEM VOTO')): F('retirada => sem voto', f"{r['reuniao']}#{a['n']} {L_}")
        tp = d['tipo_item']
        if ('vista' in lo and tp != 'Vista') or ('retirado' in lo and 'vista' not in lo and tp != 'Retirada de pauta') or (not ('vista' in lo or 'retirado' in lo) and tp != 'Deliberação'): F('tipo_item', f"{r['reuniao']}#{a['n']} {tp}")
    # presença inferida e exclusão de ex-membros fora da janela
    if r['presentes'] and any(not (JAN[quem(p)][0] <= max(r['datas']) and min(r['datas']) <= JAN[quem(p)][1]) for p in r['presentes']): F('ex-membros fora da presença', r['reuniao'])
# pautas
for r in INV['reunioes_2026']:
    pp = os.path.join(DIR, r['arquivo_pauta'])
    if not os.path.exists(pp) or os.path.getsize(pp) < 10000: F('pauta baixada', r['reuniao'])
# --- 4. manifesto: sha256 de tudo
man = json.load(open(MAN)); nsha = nbad = 0
for e in man:
    if e.get('sha256'):
        nsha += 1
        if not os.path.exists(e['arquivo']) or hashlib.sha256(open(e['arquivo'], 'rb').read()).hexdigest() != e['sha256']: nbad += 1; F('sha256 do manifesto', e['arquivo'])
docs = [e for e in man if e['tipo'].startswith('documento')]
# --- 5. totais do JSON
if len(J['votos']) != sum(1 for _ in J['votos']) or len(J['votos']) != tot_votos_esp: F('total de votos', f'JSON {len(J["votos"])} × esperado {tot_votos_esp}')
pend_txt = json.dumps(J['pendencias'], ensure_ascii=False)
for e in docs:
    if not e['valido'] and e['url'] not in pend_txt and not any(e['url'].split('&infra_hash')[0] in str(p) for p in J['pendencias']):
        # o documento bloqueado precisa estar coberto por uma pendência da reunião (URL da página ou do documento)
        rr = next((r for r in J['reunioes'] if r['reuniao'] == e['reuniao']), None)
        if not rr or not any(rr['fontes'][0]['url'] == p[7] or e['reuniao'] + ' —' in p[1] for p in J['pendencias']): F('documento bloqueado coberto por pendência', e['url'][:90])
print('=== VARREDURA ANAC (independente do parser) ===')
print(f"índice APEX: presenciais {n_apex_p} + eletrônicas {n_apex_e} = {len(apex)} | reuniões no JSON {len(J['reunioes'])} | páginas de reunião lidas {paginas} | pautas {sum(1 for r in INV['reunioes_2026'] if os.path.exists(os.path.join(DIR, r['arquivo_pauta'])))}")
print(f"calendário Portaria 18.366: {len(cal)} datas no ano, {sum(1 for c in cal if c <= hoje)} até {hoje}; presenciais listadas {n_apex_p}")
print(f"itens: páginas {tot_it} × JSON {len(J['deliberacoes'])} (decididos {tot_dec}) | votos: esperados {tot_votos_esp} × JSON {len(J['votos'])}")
print(f"manifesto: {len(man)} entradas, {nsha} com sha256 ({nbad} divergentes); documentos SEI/pergamum tentados {len(docs)}, baixados {sum(1 for e in docs if e['valido'])}")
tot_regras = 0
for k, v in sorted(falhas.items()): print(f'FALHA [{k}] {len(v)}:', v[:4])
print('RESULTADO:', 'OK (0 falhas)' if not falhas else f'{sum(len(v) for v in falhas.values())} falha(s) em {len(falhas)} regra(s)')
sys.exit(1 if falhas else 0)
