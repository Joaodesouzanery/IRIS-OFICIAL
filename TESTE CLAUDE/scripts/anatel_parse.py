"""ANATEL: parser do Conselho Diretor 2026 -> anatel.json (mesmo formato de antaq.json/anp.json + `partes`/`voto_por_parte`).
Uso (da raiz da pasta): python3 -I scripts/anatel_parse.py manifesto_anatel.json anatel.json
Le: anatel_inventario.json (sondas das paginas oficiais), fonte/anatel/listas/*.json (listagens SEI, contador independente),
    texto_anatel/ (texto limpo dos HTML do SEI; gerado por scripts/anatel_txt.py), manifesto_anatel.json (sha256).

Fonte (tudo publico, sem captcha): SEI > Publicacoes Eletronicas (sei.anatel.gov.br/sei/publicacoes), unidade SCD:
  - Pauta de Reuniao (serie 432) .......... denominador: itens pautados por reuniao (950..958)
  - Ata de Reuniao (serie 229) ............ itens, relator, quorum, resultado (unanimidade/maioria), vistas, retiradas
  - Acordao (serie 8) ..................... decisao numerada: relator, forum (Reuniao/Circuito), 'Participaram da deliberacao', vencidos
  - Ata de Circuito Deliberativo (187) .... VOTO NOMINAL de cada conselheiro (Acompanha/Nao acompanha/ausencia)
  - Pauta de Circuito (188) ............... denominador dos circuitos
  - Analise (7) e Voto (94) ............... voto escrito do relator / dos conselheiros (voto_doc)
Modelo de voto: RELATOR e VENCIDO sao NOMINAIS (acordao/ata); 'por unanimidade' -> ACOMPANHOU inferido; no circuito deliberativo
cada conselheiro tem linha propria na ata (ACOMPANHOU/DIVERGIU nominais)."""
import re, sys, json, os, glob, collections, unicodedata, datetime
man = json.load(open(sys.argv[1])); out = sys.argv[2]
inv = json.load(open('anatel_inventario.json'))
AG = 'ANATEL'; HOJE = datetime.date.today()
TXT = 'texto_anatel'
URL_DOC = 'https://sei.anatel.gov.br/sei/publicacoes/controlador_publicacoes.php?acao=publicacao_visualizar&id_documento={}&id_orgao_publicacao=0'
URL_SEI_LISTA = 'https://sei.anatel.gov.br/sei/publicacoes/controlador_publicacoes.php?acao=publicacao_pesquisar&acao_origem=publicacao_pesquisar&id_orgao_publicacao=0&id_unidade_responsavel=110000842&id_serie={}&rdo_data_publicacao=I'
URL_REUN = 'https://www.gov.br/anatel/pt-br/composicao/conselho-diretor/reunioes'
URL_HIST = 'https://www.gov.br/anatel/pt-br/composicao/conselho-diretor/historico-de-pautas-e-atas'

# ------------------------------------------------------------------ conselheiros
ROST = [  # (nome completo, regex sobre texto normalizado, titular em 2026?)
    ('Carlos Manuel Baigorri', r'baigorri', True),
    ('Alexandre Reis Siqueira Freire', r'alexandre reis|reis siqueira|alexandre freire|siqueira freire', True),
    ('Edson Victor Eugênio de Holanda', r'edson (?:victor|holanda)|eugenio de holanda|conselheiro holanda|victor eugenio', True),
    ('Octavio Penna Pieranti', r'octavio|pieranti', True),
    ('Vicente Bandeira de Aquino Neto', r'vicente|aquino neto', False),
    ('Cristiana Camarate Silveira Martins Leão Quinalia', r'cristiana|quinalia|camarate', False),
    ('Nilo Pasquali', r'nilo pasquali|\bnilo\b', False),
    ('Suzana Silva Rodrigues', r'suzana|susana', False),
]
TITULARES = [n for n, _, t in ROST if t]
def norm(s): return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
def nomes(t):
    tn = norm(t); ach = []
    for n, p, _ in ROST:
        m = re.search(p, tn)
        if m: ach.append((m.start(), n))
    return [n for _, n in sorted(ach)]
def nomes_todos(t):
    """todas as ocorrencias (ordem), sem repetir"""
    tn = norm(t); ach = []
    for n, p, _ in ROST:
        for m in re.finditer(p, tn): ach.append((m.start(), n))
    o = []
    for _, n in sorted(ach):
        if n not in o: o.append(n)
    return o
MES = {'janeiro': 1, 'fevereiro': 2, 'marco': 3, 'abril': 4, 'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12}
NUM_EXT = {'um': 1, 'primeiro': 1, 'dois': 2, 'tres': 3, 'quatro': 4, 'cinco': 5, 'seis': 6, 'sete': 7, 'oito': 8, 'nove': 9, 'dez': 10, 'onze': 11, 'doze': 12, 'treze': 13, 'quatorze': 14, 'catorze': 14,
           'quinze': 15, 'dezesseis': 16, 'dezessete': 17, 'dezoito': 18, 'dezenove': 19, 'vinte': 20, 'trinta': 30}
def dia_extenso(s):
    s = norm(s).strip(); m = re.fullmatch(r'(vinte|trinta) e (\w+)', s)
    if m: return NUM_EXT[m[1]] + NUM_EXT[m[2]]
    return NUM_EXT.get(s)
def iso(d, m, a): return f'{int(a):04d}-{MES[norm(m)]:02d}-{int(d):02d}'
def plano(x): return re.sub(r'\s+', ' ', x or '').strip()
def corta(x, n): x = plano(x); return x if len(x) <= n else x[:n - 1].rstrip() + '…'
def ler(serie, idd): return open(f'{TXT}/s{serie}_{idd}.txt', encoding='utf8').read()

# ------------------------------------------------------------------ listagens SEI (contador independente) + manifesto
LST = {}
for f in sorted(glob.glob('fonte/anatel/listas/sei_*.json')):
    for s, v in json.load(open(f)).items(): LST[s] = v
DOCS = {s: {r['id_documento']: r for r in v['linhas']} for s, v in LST.items()}
PROTO = {}   # protocolo (SEI nº) -> (serie, id_documento)
for s, v in LST.items():
    for r in v['linhas']: PROTO[r['protocolo']] = (s, r['id_documento'])
Q = []; PEND = []
def chk(desc, esp, obt, det='', ok=None):
    st = ok if ok else ('OK' if esp == obt else 'EXCEÇÃO'); Q.append([AG, desc, esp, obt, st, det])
def url_proto(p):
    if p in PROTO: return URL_DOC.format(PROTO[p][1])
    return ''

# ------------------------------------------------------------------ ACORDAOS
def sentencas(par):
    return [s for s in re.split(r'(?<=[a-zçãõáéíóú\)\"”0-9])\.\s+(?=[A-ZÁÉÍÓÚÂÊÔ])', par) if s.strip()]
ALIN = re.compile(r'^([a-z](?:\.\d+)*)\)\s+(.*)$')

def nomes_vencidos(s):
    """conselheiros VENCIDOS numa frase: nomes depois de 'vencido(s)' (ate 'nos termos'/'propondo'/'em relacao') ou, se nao houver, o nome mais proximo antes."""
    sn = norm(s); res = []
    for m in re.finditer(r'vencid[oa]s?', sn):
        if re.match(r'vencid[oa]s? (?:ao|no|em|de|e)\b', sn[m.start():m.start() + 14]) and not re.search(r'votou|votaram|votado|tendo', sn[max(0, m.start() - 30):m.start()]): continue
        after = s[m.end():m.end() + 420]
        after = re.split(r'nos termos|propondo|\bem relação\b|\. [A-Z]', after)[0]
        nm = nomes_todos(after)
        if nm: res += nm; continue
        before = sn[max(0, m.start() - 260):m.start()]
        allm = [(mm.start(), n) for n, pat, _ in ROST for mm in re.finditer(pat, before)]
        if allm: res.append(max(allm)[1])
    o = []
    for n in res:
        if n not in o: o.append(n)
    return o
def tokens_alineas(s):
    """['a','b','c.2'..] citadas entre aspas; marca intervalos '"x" a "y"'"""
    res = [];
    for m in re.finditer(r'[“"]([a-z](?:\.\d+)*)[”"](\s+a\s+[“"]([a-z](?:\.\d+)*)[”"])?', s):
        res.append((m[1], m[3]))
    return res
MODO = re.compile(r'por unanimidade(?: dos votantes)?|por maioria(?: de (\w+) votos)?', re.I)
RE_ITENS = re.compile(r'\b(?:it(?:em|ens)|pontos?|subit(?:em|ens)|incisos?)\s+((?:[\d]+(?:\.[\dIVXa-z]+)*)(?:\s*(?:,|e|a)\s*(?:[\d]+(?:\.[\dIVXa-z]+)*))*)', re.I)
def rotulo_tokens(toks):
    r = [(f'{a}–{b}' if b else a) for a, b in toks]
    return r[0] if len(r) == 1 else ', '.join(r[:-1]) + ' e ' + r[-1]
def analisa_dispositivo(disp, relator, participantes):
    """-> (partes, alineas). partes = [{parte, acao, modo, vencidos[], acompanharam[], maioria_n}] a partir do texto do dispositivo.
    Cada frase que declara 'por unanimidade'/'por maioria' abre uma entrada; frases seguintes com 'vencido(s)' + nome de conselheiro
    atribuem os vencidos a ela; 'Acompanharam ...' atribui votos nominais de quem acompanhou."""
    L = [l.strip() for l in disp.split('\n') if l.strip()]
    alin = collections.OrderedDict(); paras = []
    for l in L:
        m = ALIN.match(l)
        if m: alin[m[1]] = m[2]
        else:
            if re.match(r'^(Participaram|Participou|Presentes?|Ausentes?)\b', l): continue
            paras.append(l)
    ids = list(alin)
    intro = re.sub(r'^Vistos, relatados e discutidos os presentes autos, acordam os membros do Conselho Diretor da Anatel,?\s*', '', paras[0] if paras else '')
    def expande(toks):
        o = []
        for a, b in toks:
            if b and a in ids and b in ids:
                i, j = ids.index(a), ids.index(b)
                while j + 1 < len(ids) and ids[j + 1].startswith(b + '.'): j += 1
                o += ids[i:j + 1]
            else:
                o.append(a); o += [k for k in ids if k.startswith(a + '.')]
        return [x for x in dict.fromkeys(o) if x in alin]
    ent = []; last = None
    for p in paras:
        for s in sentencas(p):
            sn = norm(s); mm = MODO.search(s)
            eh_modo = bool(mm) and not re.match(r'^(Acompanh|Votaram|Participaram|Presentes)', s)
            if eh_modo:
                antes = s[:mm.start()]
                toks = tokens_alineas(antes) if re.search(r'al[ií]nea', antes, re.I) else []
                itens = None
                if not toks:
                    mi = RE_ITENS.search(antes)
                    if mi: itens = plano(mi[0])
                exc = re.search(r'com exceção|exceto|salvo', s[mm.end():], re.I)
                e = {'toks': toks, 'itens': itens, 'modo': 'unanimidade' if 'unanim' in mm[0].lower() else 'maioria', 'n': mm[1], 'venc': [], 'venc_exc': [], 'acomp': [], 'texto': s, 'exc': (s[mm.end() + exc.start():] if exc else None), 'antes': antes}
                ent.append(e); last = e
                resto = s[mm.end():]
                if re.search(r'vencid', norm(resto)):
                    nm = nomes_vencidos(s)
                    (e['venc_exc'] if e['exc'] else e['venc']).extend(n for n in nm if n not in (e['venc_exc'] if e['exc'] else e['venc']))
                continue
            if last is None: continue
            if re.search(r'vencid', sn) and nomes_vencidos(s):
                alvo = last['venc_exc'] if last['exc'] is not None else last['venc']
                alvo.extend(n for n in nomes_vencidos(s) if n not in alvo)
            elif re.search(r'acompanh', sn) and nomes_todos(s):
                nm = [n for n in nomes_todos(s.split('acompanh')[0] if not re.match(r'^Acompanh', s) else s) if n != relator]
                last['acomp'].extend(n for n in nm if n not in last['acomp'])
    # escopo
    for e in ent:
        e['ids'] = expande(e['toks']) if e['toks'] else None
    cobertos = set(k for e in ent if e['ids'] for k in e['ids'])
    restantes = [k for k in ids if k not in cobertos and not (any(x.startswith(k + '.') for x in ids) and all(x in cobertos for x in ids if x.startswith(k + '.')))]
    tem_escopo = [e for e in ent if e['ids'] or e['itens']]
    partes = []
    def mk(rot, ac, e, extra_venc=None):
        return {'parte': rot, 'acao': corta(ac, 700), 'modo': e['modo'], 'vencidos': list(extra_venc if extra_venc is not None else e['venc']), 'acompanharam': list(e['acomp']), 'maioria_n': e['n']}
    for e in ent:
        if e['ids']:
            ac = ' '.join(f'{k}) {alin[k]}' for k in e['ids'] if k in e['ids'])[:1400]
            partes.append(mk('alíneas ' + rotulo_tokens(e['toks']) if len(e['toks']) > 1 or e['toks'][0][1] else 'alínea ' + e['toks'][0][0], ac, e))
        elif e['itens']:
            partes.append(mk(e['itens'], e['itens'] + ' — ' + intro, e))
        elif tem_escopo:
            if restantes:
                partes.append(mk('demais alíneas (' + ', '.join(k for k in restantes if '.' not in k) + ')', ' '.join(f'{k}) {alin[k]}' for k in restantes), e)); restantes = []
            elif not partes or True:
                pass
        else:
            ac = intro + (' ' + ' '.join(f'{k}) {v}' for k, v in alin.items()) if alin else '')
            partes.append(mk('decisão', ac, e))
        if e['exc'] is not None and e['venc_exc']:
            partes.append({'parte': 'ponto excepcionado da unanimidade', 'acao': corta(e['exc'], 500), 'modo': 'maioria', 'vencidos': list(e['venc_exc']), 'acompanharam': [], 'maioria_n': None})
    if not ent:
        venc = []
        for p in paras:
            for s in sentencas(p):
                if re.search(r'vencid', norm(s)) and nomes_vencidos(s): venc += [n for n in nomes_vencidos(s) if n not in venc]
        partes.append({'parte': 'decisão', 'acao': corta(intro + (' ' + ' '.join(f'{k}) {v}' for k, v in alin.items()) if alin else ''), 700), 'modo': 'maioria' if venc else 'sem registro', 'vencidos': venc, 'acompanharam': [], 'maioria_n': None})
    elif restantes and tem_escopo:
        partes.append({'parte': 'demais alíneas (' + ', '.join(k for k in restantes if '.' not in k) + ')', 'acao': corta(' '.join(f'{k}) {alin[k]}' for k in restantes), 700), 'modo': 'sem registro', 'vencidos': [], 'acompanharam': [], 'maioria_n': None})
    return partes, alin

MESES_N = {k: v for k, v in MES.items()}
ACS = {}   # numero -> dict (primeiro) ; ACS_ALL lista
ACS_ALL = []
RETIF = []
for idd, r in DOCS.get('8', {}).items():
    t = ler('8', idd)
    m = re.search(r'Acórdão nº (\d+), de (\d+)º? de (\w+) de (\d{4})', t)
    if not m: continue
    num = int(m[1]); dt_ac = iso(m[2], m[3], m[4])
    proc = (re.search(r'Processo nº ([\d\.\/\-]+)', t) or [0, ''])[1]
    if 'ACÓRDÃO\n' not in t and re.search(r'RETIFICA', t):
        RETIF.append({'numero': num, 'id': idd, 'processo': proc}); continue
    inter = plano((re.search(r'Recorrente/Interessado:\s*(.*)', t) or [0, ''])[1])
    rel = plano((re.search(r'Conselheiro\(a\) Relator\(a\):\s*(.*)', t) or [0, ''])[1])
    fm = re.search(r'Fórum Deliberativo:\s*(Reunião Extraordinária|Reunião|Circuito Deliberativo) nº (\d+)(?:/\d{4})?,?\s*de\s+(\d+)º?\s*de\s*(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*de\s*(\d{4})', t)
    ementa = ''
    me = re.search(r'\nEMENTA\n(.*?)\n(?:I\. |[IVX]+\. )', t, re.S)
    if me: ementa = plano(me[1])
    else:
        me = re.search(r'\nEMENTA\n(.*?)\nACÓRDÃO\n', t, re.S); ementa = plano(me[1])[:400] if me else ''
    disp = t.split('\nACÓRDÃO\n', 1)[1] if '\nACÓRDÃO\n' in t else ''
    disp = re.split(r'\n ?\|? ?Documento assinado|\nDocumento assinado|\nA autenticidade', disp)[0]
    a = {'numero': num, 'id': idd, 'protocolo': r['protocolo'], 'data_ac': dt_ac, 'processo': proc, 'interessado': inter, 'relator_txt': rel,
         'relator': (nomes(rel) or [rel])[0] if rel else '', 'forum_tipo': fm[1] if fm else '', 'forum_n': int(fm[2]) if fm else None,
         'forum_data': iso(fm[3], fm[4], fm[5]) if fm else '', 'ementa': ementa, 'disp': disp, 'url': URL_DOC.format(idd), 'resumo_lista': r['resumo']}
    pp = re.search(r'^Participaram da deliberação (.*)$|^Participou da deliberação (.*)$|^Presentes na deliberação (.*)$', disp, re.M)
    a['participantes'] = nomes_todos(pp[0]) if pp else []
    pr = re.search(r'^Presentes?\b(?! na deliberação).*$', disp, re.M) or re.search(r'^Presentes na deliberação.*$', disp, re.M)
    a['presentes'] = nomes_todos(pr[0]) if pr else []
    a['ausentes_txt'] = [plano(x) for x in re.findall(r'^Ausentes?\b.*$', disp, re.M)]
    a['ausentes'] = [n for x in a['ausentes_txt'] for n in nomes_todos(x)]
    a['nao_votou'] = []
    for s in sentencas(disp.replace('\n', ' ')):
        if re.search(r'não proferiu voto|não votou|não participou da votação', s): a['nao_votou'] += [n for n in nomes_todos(s.split(' não ')[0]) if n not in a['nao_votou']]
    a['impedidos'] = []
    for s in sentencas(disp.replace('\n', ' ')):
        if re.search(r'impedid|suspeit|declarou-se impedido', norm(s)) and nomes_todos(s): a['impedidos'] += [n for n in nomes_todos(s) if n not in a['impedidos']]
    a['partes'], a['alineas'] = analisa_dispositivo(disp, a['relator'], a['participantes'])
    a['voto_refs'] = re.findall(r'((?:Análise|Voto|Parecer)[^()]{0,60}?nº ?[\d/]+[A-Za-z/]*\s*\(SEI nº ?(\d+) ?\))', disp)
    ACS_ALL.append(a)
    if num in ACS: ACS[num].setdefault('dup', []).append(a)
    else: ACS[num] = a
AC_POR_FORUM = collections.defaultdict(list)
for a in sorted(ACS_ALL, key=lambda x: x['numero']): AC_POR_FORUM[(a['forum_tipo'], a['forum_n'])].append(a)

# ------------------------------------------------------------------ PAUTAS
def le_pauta(idd):
    t = ler('432', idd); ln = t.split('\n'); itens = []; sec = ''; rel = ''
    for i, l in enumerate(ln):
        if re.match(r'^PROCESSOS PAUTADOS EM SEDE DE (\w+)', l): sec = re.match(r'^PROCESSOS PAUTADOS EM SEDE DE (\w+)', l)[1].lower()
        mh = re.match(r'^(CONSELHEIR[OA]|PRESIDENTE)( SUBSTITUT[OA])?\s+(.+)$', l)
        if mh and not l.startswith('Processo'): rel = nomes(mh[3])[0] if nomes(mh[3]) else mh[3]
        mi = re.match(r'^(\d{3})\) ([\d\.\/\-]+) - (.*)$', l)
        if mi: itens.append({'n': int(mi[1]), 'processo': mi[2], 'tema': mi[3], 'secao': sec, 'relator': rel})
    return t, itens
PAUTAS = {}   # tag -> dict
OUTROS_ORGAOS = []
for idd, r in DOCS.get('432', {}).items():
    res = r['resumo']; m = re.search(r'RCD (Extraordinária )?(\d+) - (\d\d)/(\d\d)/(\d{4})', res)
    if not m: OUTROS_ORGAOS.append({'resumo': res, 'id': idd, 'url': URL_DOC.format(idd)}); continue
    tag = ('RCDE' if m[1] else 'RCD') + m[2]; t, itens = le_pauta(idd)
    alt = res.startswith('Alteração')
    PAUTAS.setdefault(tag, []).append({'id': idd, 'data': f'{m[5]}-{m[4]}-{m[3]}', 'itens': itens, 'alterada': alt, 'pub': r['data_pub'], 'resumo': res})
def pauta_vigente(tag):
    """alteracao da pauta substitui a original quando traz itens; senao usa a original"""
    L = PAUTAS.get(tag, [])
    if not L: return None
    com = [p for p in L if p['itens']]
    alt = [p for p in com if p['alterada']]
    return (alt or com or L)[-1] if (alt or com) else L[-1]

# ------------------------------------------------------------------ ATAS DE REUNIAO
def cab_ata(t):
    h = plano(t[:3000])
    m = re.search(r'Aos (.+?) dias do mês de (\w+) do ano de (.+?), às', h)
    dia = dia_extenso(m[1]) if m else None; mes = MES.get(norm(m[2])) if m else None
    pres = re.search(r'sob a Presidência d[eo](.*?)(?:Registradas as presen|\.\s+A reunião)', h)
    ptxt = pres[1] if pres else ''
    pa = re.split(r'\bAusentes?\b', ptxt, maxsplit=1)
    motivo = {}
    if len(pa) > 1:
        for fr in re.split(r'(?<=\.)\s+|;\s*', pa[1]):
            for n in nomes_todos(fr): motivo[n] = plano(re.sub(r'^.*?,\s*', '', fr.strip().rstrip('.'))) if ',' in fr else ''
    return dia, mes, nomes_todos(pa[0]), (nomes_todos(pa[1]) if len(pa) > 1 else []), h, motivo
def bloco_itens(t):
    """-> itens [{n, secao, processo, tema, relator_hdr, relator, trazido_por, tipo_materia, partes_txt, descricao, resultado}] ; extrapauta; aprov_ata"""
    L = t.split('\n'); i0 = next((i for i, l in enumerate(L) if l.startswith('EXTRAPAUTA') or l.startswith('PROCESSOS PAUTADOS')), len(L))
    head = '\n'.join(L[:i0]); sec = ''; rel = ''; itens = []; extra = []; it = None
    for l in L[i0:]:
        if l.startswith('Nada mais havendo'): break
        if l.startswith('EXTRAPAUTA'): sec = 'extrapauta'; continue
        ms = re.match(r'^PROCESSOS PAUTADOS EM SEDE DE (\w+)', l)
        if ms: sec = ms[1].lower(); it = None; continue
        mh = re.match(r'^(CONSELHEIR[OA]|PRESIDENTE)( SUBSTITUT[OA])?\s+([A-ZÇÃÕÁÉÍÓÚÂÊÔ ]+)$', l)
        if mh and sec != 'extrapauta': rel = (nomes(mh[3]) or [mh[3]])[0]; it = None; continue
        mi = re.match(r'^(\d{5}) - Processo: ([\d\.\/\-]+) - (.*)$', l)
        if mi and sec != 'extrapauta':
            it = {'n': int(mi[1]), 'secao': sec, 'processo': mi[2], 'tema': mi[3], 'cab': rel, 'relator': '', 'trazido': '', 'tipo_mat': '', 'partes': '', 'desc': '', 'res': []}; itens.append(it); continue
        if sec == 'extrapauta':
            me = re.match(r'^(\d{5}) - (.*)$', l)
            if me: extra.append({'n': int(me[1]), 'texto': me[2]})
            continue
        if it is None: continue
        if re.match(r'^Relatora?:', l): it['relator'] = plano(l.split(':', 1)[1]); continue
        if re.match(r'^\d{3}\) [\d\.\/\-]+ - ', l): continue
        if l.startswith('Trazido por:'): it['trazido'] = plano(l[12:]); continue
        if l.startswith('Tipo da Matéria:'): it['tipo_mat'] = plano(l[16:]); continue
        if l.startswith('Parte(s):'): it['partes'] = plano(l[9:]); continue
        if l.startswith('Descrição:'): it['desc'] = plano(l[10:]); continue
        if l.startswith(' |') or l.startswith('Referência'): continue
        it['res'].append(plano(l))
    return head, itens, extra

ATAS = {}   # tag -> dict
ATAS_FORA = []
for idd, r in DOCS.get('229', {}).items():
    m = re.search(r'RCD (Extraordinária )?(\d+) - (\d\d)/(\d\d)/(\d{4})', r['resumo'])
    if not m: ATAS_FORA.append(r); continue
    tag = ('RCDE' if m[1] else 'RCD') + m[2]; data = f'{m[5]}-{m[4]}-{m[3]}'
    if not data.startswith('2026'): ATAS_FORA.append(dict(r, motivo=f'reunião de {data} (fora de 2026)')); continue
    t = ler('229', idd); dia, mes, pres, aus_decl, h, aus_mot = cab_ata(t); head, itens, extra = bloco_itens(t)
    ATAS[tag] = {'id': idd, 'data': data, 'texto': t, 'dia': dia, 'mes': mes, 'presentes': pres, 'aus_decl': aus_decl, 'aus_mot': aus_mot, 'head': head, 'itens': itens, 'extra': extra, 'url': URL_DOC.format(idd), 'protocolo': r['protocolo']}

# ------------------------------------------------------------------ CIRCUITOS
def norm_circ(t):
    L = []
    for l in t.split('\n'):
        l = re.sub(r'^\s*\|\s*', '', l).rstrip(' |').strip()
        if l: L.append(l)
    return '\n'.join(L)
ROLE = r'(Presidente Substituto|Presidente|Conselheiro Substituto|Conselheira Substituta|Conselheiro|Conselheira):'
def le_circuito(idd):
    t0 = ler('187', idd); t = norm_circ(t0)
    m = re.search(r'Circuito Deliberativo do Conselho Diretor N[ºo] (\d+)/(\d{4})', t)
    if not m: return None
    c = {'n': int(m[1]), 'ano': m[2], 'id': idd, 'url': URL_DOC.format(idd), 'texto': t}
    c['processo'] = (re.search(r'Processo nº ([\d\.\/\-]+)', t) or [0, ''])[1]
    c['interessado'] = plano((re.search(r'Interessado:\s*(.*)', t) or [0, ''])[1])
    ini = re.search(r'Início:\s*(\d\d)/(\d\d)/(\d{4})', t) or re.search(r'Inicio:\s*(\d\d)/(\d\d)/(\d{4})', t); fim = re.search(r'Fim:\s*(\d\d)/(\d\d)/(\d{4})', t)
    c['ini'] = f'{ini[3]}-{ini[2]}-{ini[1]}' if ini else ''; c['fim'] = f'{fim[3]}-{fim[2]}-{fim[1]}' if fim else ''
    def campo(rot, ate):
        mm = re.search(rot + r'\s*\n?(.*?)\n(?:' + ate + ')', t, re.S); return plano(mm[1]) if mm else ''
    c['natureza'] = campo('Natureza da Matéria:', 'Assunto:'); c['assunto'] = campo('Assunto:', r'Conselheiro\(a\) Relator\(a\):')
    c['relator'] = (nomes(campo(r'Conselheiro\(a\) Relator\(a\):', 'Voto do|Presidente:|Observações:')) or [''])[0]
    c['obs'] = campo('Observações:', 'Decisão do Circuito')
    ci = t.find('Decisão do Circuito Deliberativo:'); cv = t.find('Votos proferidos no Circuito:')
    dec = t[ci + len('Decisão do Circuito Deliberativo:'):cv] if ci >= 0 and cv > ci else ''
    c['decisao_bruta'] = dec
    mr = re.search(r'Voto do\(a\) Conselheiro\(a\) Relator\(a\):\s*\n(.*?)(?:\nAcompanha o voto|\nTotal de votos|\nLevar à reunião|$)', dec, re.S)
    c['voto_relator_txt'] = plano(mr[1]) if mr else ''
    c['resumo'] = {}
    for k, rot in (('acompanha', r'Acompanha o voto do\(?a?\)? ?Relator(?:\(a\))?:'), ('nao', r'Não acompanha o voto do\(?a?\)? ?Relator(?:\(a\))?:'), ('levar', r'Levar à reunião:'), ('total', r'Total de votos no Circuito Deliberativo:')):
        mm = re.search(rot + r'\s*\n?\s*(\d+)', dec)
        if mm: c['resumo'][k] = int(mm[1])
    # texto livre de decisao: tudo que nao e o bloco 'Resumo dos Votos'
    livre = re.sub(r'Resumo dos Votos:.*?(?=O Conselho Diretor|Com relação|Quanto|Em relação|$)', '', dec, flags=re.S) if 'Resumo dos Votos:' in dec else dec
    mdec = re.search(r'(O Conselho Diretor decidiu.*|Decis[ãa]o:.*)', dec, re.S)
    c['decisao'] = plano(mdec[1]) if mdec else ''
    ml = re.search(r'O Conselho Diretor decidiu:?\s*\n(.*)', dec, re.S); c['decisao_linhas'] = ml[1] if ml else ''
    # votos
    votos = []; vt = t[cv + len('Votos proferidos no Circuito:'):] if cv >= 0 else ''
    vt = re.split(r'\n(?:Documento assinado|A autenticidade)|\n ?Documento assinado', vt)[0]
    for mm in re.finditer(ROLE + r'\s*\n(.*?)\nVoto:\s*\n(.*?)(?=\n' + ROLE + r'|\Z)', vt, re.S):
        votos.append({'cargo': mm[1], 'nome': (nomes(mm[2]) or [plano(mm[2])])[0], 'nome_txt': plano(mm[2]), 'voto_txt': plano(mm[3])})
    c['votos'] = votos
    return c
CIRC = {}
for idd, r in DOCS.get('187', {}).items():
    c = le_circuito(idd)
    if c:
        c['protocolo'] = r['protocolo']; c['resumo_lista'] = r['resumo']
        if c['n'] in CIRC: CIRC[c['n']].setdefault('dup', []).append(c)
        else: CIRC[c['n']] = c
PAUTA_CIRC = {}
for idd, r in DOCS.get('188', {}).items():
    m = re.search(r'(\d+)$', r['descricao'])
    PAUTA_CIRC[int(m[1])] = {'id': idd, 'resumo': r['resumo'], 'data': r['data_pub']}
ANALISES = {r['protocolo']: r for r in DOCS.get('7', {}).values()}

# ------------------------------------------------------------------ voto -> classificacao
RE_AUSENCIA = re.compile(r'licen[çc]a|f[ée]rias|miss[ãa]o oficial|afastad|ausen|viagem|impedid', re.I)
def classifica_voto_circ(vt, nome, relator):
    s = norm(vt)
    if nome == relator and not re.match(r'(acompanha|nao acompanha)', s): return ('RELATOR (voto proferido)', 'nominal')
    if re.match(r'nao acompanha|diverge|divergiu', s): return ('DIVERGIU', 'nominal')
    if re.match(r'acompanha', s): return ('ACOMPANHOU', 'nominal')
    if RE_AUSENCIA.search(s) and not re.search(r'(voto|analise) n', s): return ('AUSENTE (' + plano(vt).rstrip('.') + ')', 'nominal')
    if re.match(r'(voto|analise|documento sei) n', s) or s.startswith('documento sei'): return ('REVISAR', 'REVISAR')
    return ('REVISAR', 'REVISAR')

# ------------------------------------------------------------------ montagem
R = []; D = []; V = []
def add_reuniao(tag, titulo, tipo, data, presentes, ausentes, obs=''):
    R.append({'reuniao': tag, 'titulo': titulo, 'tipo': tipo, 'data': data, 'presentes': presentes, 'ausentes': ausentes, 'obs': obs})
def partes_out(ps):
    return [{'parte': p['parte'], 'acao': p['acao'], 'modo': p['modo'], 'vencidos': p['vencidos']} for p in ps]
def voto_por_parte_txt(rows):
    return '; '.join(f'{p}: {v}' for p, v in rows)

def emite_votos(reuniao, data, processo, delib, roster, relator, partes, base_prov='inferido', extra=None):
    """roster: lista de conselheiros votantes (nomes). partes: lista; extra: dict nome->(voto, prov) que sobrepoe.
    Devolve linhas de voto."""
    extra = extra or {}; linhas = []
    for dir_ in roster:
        if dir_ in extra:
            vv, pv = extra[dir_]; linhas.append({'reuniao': reuniao, 'data': data, 'processo': processo, 'deliberacao': delib, 'diretor': dir_, 'voto': vv, 'proveniencia': pv, 'voto_por_parte': ''}); continue
        pr = []
        for p in partes:
            if dir_ in p['vencidos']: pr.append((p['parte'], 'DIVERGIU', 'nominal'))
            elif dir_ == relator: pr.append((p['parte'], 'RELATOR (voto proferido)', 'nominal'))
            elif dir_ in p.get('acompanharam', []): pr.append((p['parte'], 'ACOMPANHOU', 'nominal'))
            else:
                if p['modo'] == 'sem registro': pr.append((p['parte'], 'ACOMPANHOU', 'REVISAR'))
                else: pr.append((p['parte'], 'ACOMPANHOU', 'inferido'))
        if any(x[1] == 'DIVERGIU' for x in pr): vv, pv = 'DIVERGIU', 'nominal'
        elif dir_ == relator: vv, pv = 'RELATOR (voto proferido)', 'nominal'
        elif all(x[2] == 'nominal' for x in pr): vv, pv = 'ACOMPANHOU', 'nominal'
        elif any(x[2] == 'REVISAR' for x in pr): vv, pv = 'ACOMPANHOU', 'REVISAR'
        else: vv, pv = 'ACOMPANHOU', 'inferido'
        vpp = ''
        if len(pr) > 1: vpp = voto_por_parte_txt([(a, b) for a, b, _ in pr])
        linhas.append({'reuniao': reuniao, 'data': data, 'processo': processo, 'deliberacao': delib, 'diretor': dir_, 'voto': vv, 'proveniencia': pv, 'voto_por_parte': vpp})
    return linhas

def ref_voto(txt):
    m = re.search(r'((?:Análise|Voto)[^()]{0,70}?nº ?[\d/]+[A-Za-z/]*\s*\(SEI nº ?(\d+) ?\))', txt or '')
    if not m: return ''
    u = url_proto(m[2])
    return plano(m[1]) + (f' | {u}' if u else ' | (documento não listado em Publicações Eletrônicas)')

def resultado_ac(a):
    ps = a['partes']; alin = a['alineas']
    top = [(k, v) for k, v in alin.items() if '.' not in k]
    if top:
        acoes = ' | '.join(f'{k}) {corta(v, 200)}' for k, v in top)
    else:
        acoes = corta(re.sub(r'^Vistos, relatados e discutidos os presentes autos, acordam os membros do Conselho Diretor da Anatel,?\s*', '', a['disp'].split('\n')[0]), 450)
    mods = ' ; '.join(f"{p['parte']}: {p['modo']}" + (f" (vencido(s): {', '.join(p['vencidos'])})" if p['vencidos'] else '') for p in ps)
    return f'{acoes} [{mods}]'

# ---------- 1) reunioes (atas) ----------
CIRC_TAGS = {}
def ausente_txt(at, n):
    m = at['aus_mot'].get(n, '')
    return f'AUSENTE ({m})' if m else 'AUSENTE (não consta entre os presentes da reunião)'
def roster_reuniao(at):
    pres = at['presentes']; aus = [n for n in TITULARES if n not in pres]
    aus += [n for n in at['aus_decl'] if n not in aus and n not in pres]
    return pres, aus
usados_ac = set(); sem_acordao_aprovada = []; ata_sem_item = []
for tag in sorted(ATAS, key=lambda k: int(re.sub(r'\D', '', k))):
    at = ATAS[tag]; num = int(re.sub(r'\D', '', tag)); pres, aus = roster_reuniao(at)
    extraord = tag.startswith('RCDE')
    titulo = f'{num}ª Reunião {"Extraordinária " if extraord else ""}do Conselho Diretor da ANATEL ({at["data"][8:]}/{at["data"][5:7]}/{at["data"][:4]})'
    # presentes: cargos
    obs = ''
    if at['dia'] and at['dia'] != int(at['data'][8:]): obs = f'ATENÇÃO: dia do cabeçalho ({at["dia"]}) ≠ resumo SEI ({at["data"]})'
    add_reuniao(tag, titulo, 'Extraordinária (RCDE)' if extraord else 'Ordinária (RCD)', at['data'], pres, aus, obs)
    # aprovacao de ata
    ma = re.search(r'dispensando a leitura da (Ata d[ao] .*?Reunião.*?)(?:,| realizada)', at['head'] + ' ' + plano(at['texto'][:4000]))
    mt = re.search(r'Ata d[ao] ([\w ]+?) Reunião do Conselho Diretor.*?realizada em (.+?), cujo', plano(at['texto'][:5000]))
    resa = re.search(r'Em discussão e votação, a Ata foi ([^.]*)\.', plano(at['texto'][:5000]))
    if resa:
        ant = f'RCD{num - 1}'
        proc = f'ATA {ant}'
        vot = {n: ('ACOMPANHOU', 'inferido') for n in pres}
        D.append({'reuniao': tag, 'data': at['data'], 'processo': proc, 'deliberacao': f'Aprovação da ata da {num - 1}ª reunião ({tag})', 'item_n': '0', 'relator': '', 'interessado': 'Conselho Diretor da ANATEL',
                  'assunto': f'Aprovação da ata da {num - 1}ª Reunião do Conselho Diretor', 'resultado': 'Ata ' + resa[1], 'voto_doc': '', 'decisao_texto': corta(resa[0], 400), 'tipo_item': 'Aprovação de ata',
                  'secao': 'Abertura', 'unidade': 'Secretaria do Conselho Diretor - SCD', 'partes': [{'parte': 'ata', 'acao': 'aprovar a ata da reunião anterior', 'modo': 'unanimidade' if 'sem restri' in resa[1] else 'sem registro', 'vencidos': []}], 'origem': at['url']})
        for n in pres:
            V.append({'reuniao': tag, 'data': at['data'], 'processo': proc, 'deliberacao': D[-1]['deliberacao'], 'diretor': n, 'voto': 'ACOMPANHOU', 'proveniencia': 'inferido', 'voto_por_parte': ''})
        for n in aus:
            V.append({'reuniao': tag, 'data': at['data'], 'processo': proc, 'deliberacao': D[-1]['deliberacao'], 'diretor': n, 'voto': ausente_txt(at, n), 'proveniencia': 'nominal', 'voto_por_parte': ''})
    for it in at['itens']:
        ns = 'R' if it['secao'] == 'relatoria' else 'V' if it['secao'] == 'vista' else it['secao'][:1].upper()
        item_n = f'{ns}{it["n"]}'
        res = plano(' '.join(it['res'])); rs = norm(res)
        # relator formal e proponente
        if it['secao'] == 'vista': relator = (nomes(it['relator']) or [it['relator']])[0] if it['relator'] else ''; vistor_cab = it['cab']
        else: relator = it['cab']; vistor_cab = ''
        # acordao correspondente (mesmo forum + processo)
        cands = [a for a in AC_POR_FORUM.get(('Reunião Extraordinária' if extraord else 'Reunião', num), []) if a['processo'] == it['processo'] and a['numero'] not in usados_ac]
        ac = cands[0] if cands else None
        if ac: usados_ac.add(ac['numero'])
        retirada = bool(re.search(r'retirad[oa] de pauta', rs))
        # vistas e votos antecipados (frases)
        vistores = []; antes = []; apresentou = []
        for s in sentencas(res):
            sn = norm(s)
            if re.search(r'(solicit\w+|pedi\w+|pediu) vista', sn) and not re.search(r'prazo de vista|voto-vista|em sede de vista', sn):
                nm = nomes_todos(s)
                if nm: vistores += [n for n in nm if n not in vistores]
            elif re.search(r'antecipou seu voto|registrou voto|acompanhando integralmente|acompanhou a proposta|acompanhou integralmente', sn) and not re.search(r'materia aprovada', sn):
                nm = nomes_todos(s.split('acompanh')[0].split('antecipou')[0].split('registrou')[0])
                if nm and nm[0] not in antes: antes.append(nm[0])
            m_ap = re.match(r'^Apresentad[oa] pel[oa] (.*?)(?:, em sede de vista|, Relator|, Relatora|, a An|, o Voto)', s)
            if m_ap:
                nm = nomes_todos(m_ap[1])
                if nm: apresentou.append((nm[0], 'em sede de vista' in s))
        em_vista = bool(vistores) and not ac
        prorrog = bool(re.search(r'prorroga[çc][ãa]o do prazo de (relatoria|vista)', rs)); dilig = 'conversao da deliberacao em diligencia' in rs
        tipo = 'Retirada de pauta' if (retirada and not ac) else 'Vista' if (em_vista or (prorrog and 'prazo de vista' in rs)) else 'Deliberação'
        # modo/partes/vencidos
        if ac:
            partes = ac['partes']; roster = list(ac['participantes']) or [n for n in pres]
            delib = f'Acórdão {ac["numero"]}/2026'; relator_v = ac['relator'] or relator
            interessado = ac['interessado'] or it['partes']
            decisao = corta(ac['disp'], 1500); resultado = resultado_ac(ac)
            if relator_v and relator_v not in roster and relator_v in ROST[4][0:1]: roster.append(relator_v)
            vdoc = ref_voto(ac['disp'])
        else:
            delib = f'Item {item_n} ({tag})'; relator_v = relator; interessado = it['partes']; vdoc = ref_voto(res)
            roster = [n for n in pres]; decisao = corta(res, 1500)
            mo = MODO.search(res); venc = []
            for s in sentencas(res):
                if re.search(r'vencid', norm(s)) and nomes_vencidos(s): venc += [n for n in nomes_vencidos(s) if n not in venc]
            if mo: modo = 'unanimidade' if 'unanim' in mo[0].lower() else 'maioria'
            else: modo = 'maioria' if venc else 'sem registro'
            partes = [{'parte': 'decisão', 'acao': corta(re.sub(r'^(Matéria|O Conselho) aprovou?,?\s*', '', res), 500), 'modo': modo, 'vencidos': venc, 'acompanharam': []}]
            resultado = corta(res, 600)
            if tipo == 'Deliberação' and not retirada and 'aprovad' in rs and not prorrog and not dilig:
                sem_acordao_aprovada.append((tag, item_n, it['processo']))
        ex = {}
        if tipo == 'Retirada de pauta':
            for n in roster: ex[n] = ('SEM VOTO (retirado de pauta)', 'nominal')
            partes = []; resultado = corta(res, 300)
        elif tipo == 'Vista' and vistores:
            for n in roster: ex[n] = ('SEM VOTO AINDA (vista pendente)', 'nominal')
            for n in vistores: ex[n] = ('PEDIU VISTA', 'nominal')
            for n in antes:
                if n in roster and n not in vistores: ex[n] = ('VOTOU (antes da vista)', 'nominal')
            for n, vista_ in apresentou:
                if n in roster and n not in vistores: ex[n] = ('VOTOU (antes da vista)', 'nominal')
            if relator_v in roster and relator_v not in vistores: ex[relator_v] = ('RELATOR (voto proferido; vista concedida)', 'nominal') if it['secao'] == 'relatoria' else ex.get(relator_v, ('SEM VOTO AINDA (vista pendente)', 'nominal'))
            partes = []; resultado = 'VISTA: ' + corta(res, 400)
        elif tipo == 'Vista':   # prorrogacao do prazo de vista
            for n in roster: ex[n] = ('ACOMPANHOU', 'inferido')
            if it['trazido'] and (nomes(it['trazido']) or [''])[0] in roster: ex[nomes(it['trazido'])[0]] = ('PEDIU VISTA', 'nominal')
            if not ac and relator_v in roster: ex[relator_v] = ('ACOMPANHOU', 'inferido')
            resultado = corta(res, 400)
        else:
            if vistor_cab and not ac and 'prorroga' in rs and 'relatoria' in rs: pass
            # proponente em sede de vista (relator formal ausente/ex-conselheiro): quem 'Trazido por' nao e relator
            pass
        # ausentes titulares
        for n in aus:
            if n not in roster: pass
        linhas = emite_votos(tag, at['data'], it['processo'], delib, roster, relator_v, partes, extra=ex)
        if tipo == 'Deliberação':
            for n in [x for x, _ in apresentou] + antes:   # apresentou voto-vista / 'acompanhou a proposta... incluindo o Voto' na ata: posicao registrada nominalmente
                for l in linhas:
                    if l['diretor'] == n and l['voto'] == 'ACOMPANHOU' and l['proveniencia'] == 'inferido': l['proveniencia'] = 'nominal'
        # quem esta presente mas fora do rol de votantes (acordao): sem voto
        if ac:
            for n in pres:
                if n not in roster and n not in ac['ausentes']:
                    motivo = 'art. 5º, § 2º do Regimento Interno: sucedeu o Relator' if n in ac['nao_votou'] else 'presente à reunião, fora do rol de participantes da deliberação no acórdão'
                    linhas.append({'reuniao': tag, 'data': at['data'], 'processo': it['processo'], 'deliberacao': delib, 'diretor': n, 'voto': f'SEM VOTO (não votou — {motivo})', 'proveniencia': 'nominal' if n in ac['nao_votou'] else 'REVISAR', 'voto_por_parte': ''})
        for n in aus:
            if n not in roster: linhas.append({'reuniao': tag, 'data': at['data'], 'processo': it['processo'], 'deliberacao': delib, 'diretor': n, 'voto': ausente_txt(at, n), 'proveniencia': 'nominal', 'voto_por_parte': ''})
        V.extend(linhas)
        D.append({'reuniao': tag, 'data': at['data'], 'processo': it['processo'], 'deliberacao': delib, 'item_n': item_n, 'relator': relator_v, 'interessado': interessado,
                  'assunto': corta(it['desc'] or (ac or {}).get('ementa', ''), 700), 'resultado': resultado, 'voto_doc': vdoc, 'decisao_texto': decisao, 'tipo_item': tipo,
                  'secao': {'relatoria': 'Processos pautados em sede de relatoria', 'vista': 'Processos pautados em sede de vista'}.get(it['secao'], it['secao']),
                  'unidade': it['tema'], 'partes': partes_out(partes), 'tipo_materia': it['tipo_mat'], 'trazido_por': it['trazido'], 'origem_ata': at['url'], 'url_acordao': ac['url'] if ac else ''})

# ---------- 2) acordaos de reuniao SEM ata publicada (957, Extraordinaria 32...) ----------
sem_ata_ac = collections.defaultdict(list)
for (ft, fn), L in AC_POR_FORUM.items():
    if ft in ('Reunião', 'Reunião Extraordinária'):
        for a in L:
            if a['numero'] not in usados_ac: sem_ata_ac[(ft, fn)].append(a)
ac_orfaos_com_ata = []
for (ft, fn), L in sorted(sem_ata_ac.items(), key=lambda kv: kv[0][1]):
    tag = ('RCDE' if ft == 'Reunião Extraordinária' else 'RCD') + str(fn)
    if tag in ATAS:
        ac_orfaos_com_ata += [(tag, a['numero'], a['processo']) for a in L]   # acordao de reuniao com ata, sem item casado
    data = L[0]['forum_data']
    pres = sorted({n for a in L for n in a['presentes']} | {n for a in L for n in a['participantes']}, key=lambda n: [x[0] for x in ROST].index(n))
    pres = [n for n in pres if n != 'Vicente Bandeira de Aquino Neto']
    aus = [n for n in TITULARES if n not in pres]
    if tag not in ATAS:
        add_reuniao(tag, f'{fn}ª Reunião {"Extraordinária " if ft.endswith("Extraordinária") else ""}do Conselho Diretor da ANATEL ({data[8:]}/{data[5:7]}/{data[:4]})', 'Extraordinária (RCDE)' if ft.endswith('Extraordinária') else 'Ordinária (RCD)', data, pres, aus,
                    'Ata ainda não publicada no SEI; presentes derivados dos acórdãos ("Participaram da deliberação"/"Presentes") — itens sem acórdão (vistas, retiradas, prorrogações) desconhecidos')
    for a in L:
        pa = pauta_vigente(tag); item_p = next((i for i in (pa['itens'] if pa else []) if i['processo'] == a['processo']), None)
        roster = list(a['participantes']) or pres
        delib = f'Acórdão {a["numero"]}/2026'
        linhas = emite_votos(tag, data, a['processo'], delib, roster, a['relator'], a['partes'])
        for n in pres:
            if n not in roster and n not in a['ausentes']:
                motivo = 'art. 5º, § 2º do Regimento Interno: sucedeu o Relator' if n in a['nao_votou'] else 'presente à reunião, fora do rol de participantes da deliberação no acórdão'
                linhas.append({'reuniao': tag, 'data': data, 'processo': a['processo'], 'deliberacao': delib, 'diretor': n, 'voto': f'SEM VOTO (não votou — {motivo})', 'proveniencia': 'nominal' if n in a['nao_votou'] else 'REVISAR', 'voto_por_parte': ''})
        for n in aus:
            if n not in roster: linhas.append({'reuniao': tag, 'data': data, 'processo': a['processo'], 'deliberacao': delib, 'diretor': n, 'voto': 'AUSENTE (não participou da deliberação)', 'proveniencia': 'nominal', 'voto_por_parte': ''})
        V.extend(linhas)
        D.append({'reuniao': tag, 'data': data, 'processo': a['processo'], 'deliberacao': delib, 'item_n': f'P{item_p["n"]}' if item_p else '', 'relator': a['relator'], 'interessado': a['interessado'], 'assunto': corta(item_p and (item_p['tema']) or a['ementa'], 700) if False else corta(a['ementa'] or (item_p or {}).get('tema', ''), 700),
                  'resultado': resultado_ac(a), 'voto_doc': ref_voto(a['disp']), 'decisao_texto': corta(a['disp'], 1500), 'tipo_item': 'Deliberação', 'secao': 'Acórdão (ata da reunião ainda não publicada)',
                  'unidade': (item_p or {}).get('tema', ''), 'partes': partes_out(a['partes']), 'origem_ata': a['url'], 'url_acordao': a['url']})

# ---------- 3) circuitos deliberativos ----------
circ_sem_voto = []
for n in sorted(CIRC):
    c = CIRC[n]; tag = f'CD{n}'; data = c['fim'] or c['ini']
    votos_c = c['votos']; ausentes = []; presentes = []; ex = {}; roster = []
    if not c['relator']:   # campo 'Relator' da ata veio preenchido com outra coisa (ex.: 'Matéria Administrativa'): relator = quem vota com documento proprio
        proprios = [vv['nome'] for vv in votos_c if not re.match(r'(acompanha|n[ãa]o acompanha)', norm(vv['voto_txt'])) and not RE_AUSENCIA.search(vv['voto_txt'])]
        if len(proprios) == 1: c['relator'] = proprios[0]; c['relator_inferido'] = True
    for vv in votos_c:
        cl, pv = classifica_voto_circ(vv['voto_txt'], vv['nome'], c['relator'])
        vv['classe'] = cl; vv['prov'] = pv
        if cl.startswith('AUSENTE'): ausentes.append(vv['nome'])
        else: presentes.append(vv['nome']); roster.append(vv['nome'])
        ex[vv['nome']] = (cl, pv)
    titulo = f'Circuito Deliberativo nº {n}/2026 (período {c["ini"][8:]}/{c["ini"][5:7]} a {c["fim"][8:]}/{c["fim"][5:7]}/{c["fim"][:4]})'
    if c['obs'] and c['obs'] != '-': titulo += ' — obs. da ata: ' + corta(c['obs'], 220)   # (obs fica no titulo: 'obs' preenchido sinaliza reuniao sem ata nos consumidores)
    add_reuniao(tag, titulo, 'Circuito Deliberativo (CD)', data, presentes, ausentes, '')
    acs = AC_POR_FORUM.get(('Circuito Deliberativo', n), []); ac = None
    for a in acs:
        if a['processo'] == c['processo'] and a['numero'] not in usados_ac: ac = a; break
    if not ac and acs:
        for a in acs:
            if a['numero'] not in usados_ac: ac = a; break
    if ac: usados_ac.add(ac['numero'])
    # partes: do acordao (dispositivo) se houver; senao do texto de decisao da ata do circuito
    vencidos_circ = [vv['nome'] for vv in votos_c if vv['classe'] == 'DIVERGIU']
    if ac: partes = [dict(p) for p in ac['partes']]
    elif c['decisao_linhas'] and MODO.search(c['decisao_linhas']):
        partes, _ = analisa_dispositivo(c['decisao_linhas'], c['relator'], roster)
        for p_ in partes:
            if p_['modo'] == 'sem registro' and not p_['vencidos']: p_['modo'] = 'unanimidade' if not vencidos_circ else 'maioria'
    else: partes = [{'parte': 'decisão', 'acao': corta(c['decisao'] or c['voto_relator_txt'] or c['assunto'], 500), 'modo': 'maioria' if vencidos_circ else 'unanimidade', 'vencidos': vencidos_circ, 'acompanharam': [vv['nome'] for vv in votos_c if vv['classe'] == 'ACOMPANHOU']}]
    # votos nominais do circuito prevalecem; vencidos em partes (acordao/ata) complementam
    for p in partes:
        p['acompanharam'] = list(dict.fromkeys(p.get('acompanharam', []) + [vv['nome'] for vv in votos_c if vv['classe'] == 'ACOMPANHOU']))
        p['vencidos'] = list(dict.fromkeys(p['vencidos'] + ([] if len(partes) > 1 else vencidos_circ)))
        if p['modo'] == 'unanimidade' and p['vencidos']: p['modo'] = 'maioria'
    ex2 = {}
    for vv in votos_c:
        if vv['classe'] in ('DIVERGIU',) or vv['classe'].startswith('AUSENTE') or vv['classe'] == 'REVISAR': ex2[vv['nome']] = (vv['classe'], vv['prov'])
        elif vv['classe'].startswith('RELATOR'): ex2[vv['nome']] = (vv['classe'], vv['prov'])
    linhas = emite_votos(tag, data, c['processo'], f'Acórdão {ac["numero"]}/2026' if ac else f'Circuito Deliberativo {n}/2026', roster, c['relator'], partes, extra={k: v for k, v in ex2.items() if v[0].startswith(('REVISAR', 'AUSENTE'))})
    # linhas para ausentes
    for vv in votos_c:
        if vv['classe'].startswith('AUSENTE'):
            linhas.append({'reuniao': tag, 'data': data, 'processo': c['processo'], 'deliberacao': f'Acórdão {ac["numero"]}/2026' if ac else f'Circuito Deliberativo {n}/2026', 'diretor': vv['nome'], 'voto': vv['classe'], 'proveniencia': 'nominal', 'voto_por_parte': ''})
    # relator e divergentes nominais da ata do circuito prevalecem sobre o inferido do acordao
    for l in linhas:
        vv = next((x for x in votos_c if x['nome'] == l['diretor']), None)
        if vv and vv['classe'] == 'ACOMPANHOU' and l['voto'] == 'ACOMPANHOU': l['proveniencia'] = 'nominal'
        if vv and vv['classe'] == 'DIVERGIU' and l['voto'] != 'DIVERGIU': l['voto'] = 'DIVERGIU'; l['proveniencia'] = 'nominal'
    V.extend(linhas)
    delib = f'Acórdão {ac["numero"]}/2026' if ac else f'Circuito Deliberativo {n}/2026'
    vr = c['voto_relator_txt']
    if c['decisao']: base_res = c['decisao']
    elif re.search(r'(Voto|Análise|Documento SEI) n', vr) and len(vr) < 200: base_res = f'Aprovado nos termos do {vr} — {c["assunto"]}'
    else:
        mp = re.search(r'(propon\w+|Propõe-se).*', vr, re.I | re.S); base_res = ('Proposta do Relator: ' + mp[0]) if mp else (vr or 'Aprovado conforme voto do Relator')
    resultado = resultado_ac(ac) if ac else corta(base_res + ' [' + '; '.join(f"{p['modo']}" + (f" (vencido(s): {', '.join(p['vencidos'])})" if p['vencidos'] else '') for p in partes) + ']', 700)
    vdoc = ref_voto(c['voto_relator_txt']) or (ref_voto(ac['disp']) if ac else '')
    D.append({'reuniao': tag, 'data': data, 'processo': c['processo'], 'deliberacao': delib, 'item_n': '1', 'relator': c['relator'], 'interessado': c['interessado'] or (ac or {}).get('interessado', ''),
              'assunto': corta(c['assunto'], 700), 'resultado': resultado, 'voto_doc': vdoc, 'decisao_texto': corta(ac['disp'] if ac else base_res, 1500), 'tipo_item': 'Deliberação',
              'secao': 'Circuito Deliberativo', 'unidade': c['natureza'], 'partes': partes_out(partes), 'origem_ata': c['url'], 'url_acordao': ac['url'] if ac else ''})
    if not votos_c: circ_sem_voto.append(n)


# =============================================================================== QA (fontes independentes) / cobertura / pendencias
def idx(l): return [x[0] for x in ROST].index(l)
URL_L = lambda ser: URL_SEI_LISTA.format(ser)
SERIES_NOME = {'8': 'Acórdão', '229': 'Ata de Reunião', '432': 'Pauta de Reunião', '187': 'Ata de Circuito Deliberativo', '188': 'Pauta de Circuito Deliberativo', '7': 'Análise (voto escrito do relator)', '94': 'Voto'}
# (a) documentos listados (contador impresso pela propria pagina SEI) x baixados (manifesto) x lidos
lidos = {'8': len(ACS_ALL) + len(RETIF), '229': len(ATAS) + len(ATAS_FORA), '432': sum(len(v) for v in PAUTAS.values()) + len(OUTROS_ORGAOS), '187': sum(1 + len(c.get('dup', [])) for c in CIRC.values()),
         '188': len(PAUTA_CIRC), '7': len(ANALISES), '94': len(DOCS.get('94', {}))}
for ser in ('8', '229', '432', '187', '188', '7', '94'):
    v = LST.get(ser, {}); decl = v.get('declarado'); nlin = len(v.get('linhas', []))
    bx = sum(1 for m in man.values() if m['serie'] == ser and m['ok'])
    chk(f'(a) SEI {SERIES_NOME[ser]} (série {ser}) 01/01–08/10/2026: contador impresso pela página × linhas lidas nas {v.get("paginas", 1)} páginas da listagem', decl if decl is not None else nlin, nlin,
        'contador da página' if decl is not None else 'a página não imprime contador quando cabe em 1 página; usado o nº de linhas')
    chk(f'(a) SEI {SERIES_NOME[ser]}: listados × baixados (manifesto, sha256)', nlin, bx)
    chk(f'(a) SEI {SERIES_NOME[ser]}: baixados × lidos/parseados', bx, lidos[ser], {'8': 'inclui 1 retificação do Acórdão 63 (não é nova deliberação)', '229': 'inclui a ata da 949ª (04/12/2025), fora de 2026, lida só para checar a aprovação',
         '432': f'inclui {len(OUTROS_ORGAOS)} pautas de outros colegiados (Comissão Conjunta/CRCA), fora do Conselho Diretor', '7': 'indexados por SEI nº para resolver voto_doc', '94': 'indexados por SEI nº para resolver voto_doc (não interpretados)'}.get(ser, ''))
# (b) reunioes numeradas
nums_pauta = sorted({int(re.sub(r'\D', '', t)) for t in PAUTAS if t.startswith('RCD') and not t.startswith('RCDE')})
nums_ata = sorted({int(re.sub(r'\D', '', t)) for t in ATAS if not t.startswith('RCDE')})
nums_ac = sorted({fn for (ft, fn) in AC_POR_FORUM if ft == 'Reunião'})
lo, hi = min(nums_pauta), max(nums_pauta)
chk('(b) Reuniões ordinárias numeradas 950..N: sequência contínua nas PAUTAS publicadas (denominador independente)', list(range(lo, hi + 1)), nums_pauta, f'950ª em 12/02 … {hi}ª em {pauta_vigente("RCD" + str(hi))["data"]}; o enunciado cita 950 (12/02), 953 (07/05), 955 (02/07): conferem com as pautas e atas')
chk('(b) Reuniões numeradas × atas coletadas (cada reunião realizada deve ter ata)', len(nums_pauta), len(nums_ata), f'pautas {lo}..{hi}; atas lidas {nums_ata[0]}..{nums_ata[-1]}; SEM ata: ' + ', '.join(f'{n}ª ({pauta_vigente("RCD"+str(n))["data"]})' for n in nums_pauta if n not in nums_ata), ok=('OK' if len(nums_pauta) == len(nums_ata) else 'EXCEÇÃO'))
chk('(b) Reuniões com acórdão (forum "Reunião nº N" nos acórdãos) ⊆ reuniões pautadas', sorted(set(nums_ac) - set(nums_pauta)), [], f'forum dos acórdãos: {nums_ac}')
chk('(b) Reuniões extraordinárias: pauta × ata × acórdão', 'RCDE32 pauta=1', f'ata={"RCDE32" in ATAS}; acórdão={("Reunião Extraordinária", 32) in AC_POR_FORUM}', 'a ata da extraordinária ainda não foi publicada', ok='EXCEÇÃO')
dif_dia = [(t, a['dia'], a['data']) for t, a in ATAS.items() if a['dia'] and a['dia'] != int(a['data'][8:])]
chk('(b) Data da ata: dia por extenso no cabeçalho do PDF × data do título SEI/pauta', 0, len(dif_dia), str(dif_dia))
chk('(b) Atas: abertura aprova a ata da reunião anterior (aprovação de ata item)', len(ATAS), sum(1 for d in D if d['tipo_item'] == 'Aprovação de ata'))
# (c) acordaos lidos x numeros citados
nums_ac_lidos = sorted(a['numero'] for a in ACS_ALL)
hi_ac = max(nums_ac_lidos); buracos = [n for n in range(1, hi_ac + 1) if n not in nums_ac_lidos]
cit = collections.Counter()
for ser in ('229', '432', '187', '188', '7', '94'):
    for idd in DOCS.get(ser, {}):
        t = ler(ser, idd)
        for m in re.finditer(r'Acórdãos? nº ?(\d+)(?:/2026|, de [\dº]+ de [a-zç]+ de 2026)', t):
            if re.search(r'TCU|Tribunal de Contas|Plenário', t[max(0, m.start() - 60):m.end() + 40]): continue   # Acórdão do TCU, não da ANATEL
            cit[int(m[1])] += 1
cit_fora = sorted(n for n in cit if n not in nums_ac_lidos)
chk('(c) Acórdãos 2026 lidos × sequência 1..N (declarado: SEI lista 262 registros; numeração vai até o maior nº lido)', hi_ac, len(nums_ac_lidos) + len(buracos) - 0 - 0 + 0 - 0 if False else len(nums_ac_lidos) + len(buracos), f'lidos {len(nums_ac_lidos)} únicos + buracos {buracos}; 1 retificação (Acórdão 63) explica 262 documentos = 261 acórdãos + 1', ok=('OK' if hi_ac == len(nums_ac_lidos) + len(buracos) else 'EXCEÇÃO'))
chk('(c) Acórdãos citados em OUTROS documentos (atas, pautas, análises, votos) × lidos: citados que não foram lidos', [], cit_fora, f'{len(cit)} números distintos citados fora dos próprios acórdãos; números citados e não lidos: {cit_fora}')
for n in buracos:
    cit_n = cit.get(n, 0)
# associacao provavel dos buracos (item aprovado em ata sem acordao no mesmo bloco de numeracao)
def vizinhos(n):
    return [a for a in ACS_ALL if a['numero'] in (n - 1, n + 1)]
BURACO_INFO = {}
for n in buracos:
    vz = vizinhos(n); fl = {(a['forum_tipo'], a['forum_n']) for a in vz}
    cand = [x for x in sem_acordao_aprovada if (('Reunião', int(re.sub(r'\D', '', x[0]))) in fl)]
    BURACO_INFO[n] = (vz, cand)
# (d) presenca / consistencia de votos
viol_rel = []; viol_venc = []
for a in ACS_ALL:
    if a['relator'] and a['participantes'] and a['relator'] not in a['participantes']: viol_rel.append(a['numero'])
    for p in a['partes']:
        for n in p['vencidos'] + p['acompanharam']:
            if a['participantes'] and n not in a['participantes']: viol_venc.append((a['numero'], n))
chk('(d) Acórdãos: relator ∈ "Participaram da deliberação"', 0, len(viol_rel), str(viol_rel[:10]))
chk('(d) Acórdãos: vencidos/acompanharam ⊆ "Participaram da deliberação"', 0, len(viol_venc), str(viol_venc[:10]))
vk = collections.Counter((v['reuniao'], v['deliberacao'], v['processo'], v['diretor']) for v in V)
dup_v = [k for k, c in vk.items() if c > 1]
chk('(d) 1 voto por conselheiro em cada item (reunião, deliberação, processo, diretor)', 0, len(dup_v), str(dup_v[:5]))
rost_por_item = collections.defaultdict(set)
for v in V: rost_por_item[(v['reuniao'], v['deliberacao'], v['processo'])].add(v['diretor'])
sem_votos = [(d['reuniao'], d['deliberacao']) for d in D if (d['reuniao'], d['deliberacao'], d['processo']) not in rost_por_item]
chk('(d) Todo item tem votos emitidos', 0, len(sem_votos), str(sem_votos[:5]))
pres_por_r = {r['reuniao']: set(r['presentes']) | set(r['ausentes']) for r in R}
viol_p = []
for d in D:
    if d['reuniao'] in pres_por_r and pres_por_r[d['reuniao']]:
        for dr in rost_por_item[(d['reuniao'], d['deliberacao'], d['processo'])]:
            if dr not in pres_por_r[d['reuniao']] and dr != d['relator'] and dr != 'Vicente Bandeira de Aquino Neto': viol_p.append((d['reuniao'], d['deliberacao'], dr))
chk('(d) Votantes de cada item ⊆ presentes/ausentes da reunião (exceto ex-Conselheiro relator que votou antes de sair)', 0, len(viol_p), str(viol_p[:6]))
viol_r = [(d['reuniao'], d['deliberacao'], d['relator']) for d in D if d['tipo_item'] == 'Deliberação' and d['relator'] and not any(v['diretor'] == d['relator'] and v['voto'].startswith('RELATOR') for v in V if (v['reuniao'], v['deliberacao'], v['processo']) == (d['reuniao'], d['deliberacao'], d['processo'])) and d['relator'] in [x[0] for x in ROST]]
chk('(d) Itens deliberados cujo relator tem linha "RELATOR (voto proferido)" (exceção legítima: relator = ex-Conselheiro que deixou o cargo, sem linha)', 0, len([x for x in viol_r if x[2] != 'Vicente Bandeira de Aquino Neto']), f'{len(viol_r)} itens com relator ex-Conselheiro Vicente Bandeira de Aquino Neto (mandato encerrado; item de diligência/prorrogação decidido sem ele): {[x[:2] for x in viol_r][:8]}')
# (e) itens da ata x pauta
for t in sorted(ATAS, key=lambda k: int(re.sub(r'\D', '', k))):
    pa = pauta_vigente(t); n_at = len(ATAS[t]['itens'])
    if pa:
        proc_p = collections.Counter(i['processo'] for i in pa['itens']); proc_a = collections.Counter(i['processo'] for i in ATAS[t]['itens'])
        chk(f'(e) {t}: itens pautados (PAUTA publicada, doc distinto) × itens da ata', len(pa['itens']), n_at, f'processos só na pauta: {sorted((proc_p - proc_a).elements())[:4]}; só na ata: {sorted((proc_a - proc_p).elements())[:4]}', ok=('OK' if proc_p == proc_a else 'EXCEÇÃO'))
# acordaos de reuniao com ata: casados com item
chk('(e) Acórdãos de reuniões com ata × itens da ata (acórdão sem item correspondente)', 0, len(ac_orfaos_com_ata), str(ac_orfaos_com_ata[:5]))
n_apr = sum(1 for d in D if d['reuniao'] in ATAS and d['tipo_item'] == 'Deliberação' and d['deliberacao'].startswith('Acórdão'))
n_ac_atas = sum(1 for a in ACS_ALL if a['forum_tipo'] == 'Reunião' and 'RCD' + str(a['forum_n']) in ATAS)
chk('(e) Itens aprovados nas atas com acórdão casado × acórdãos de reunião (fórum 950..956) lidos', n_ac_atas, n_apr, f'itens aprovados na ata sem acórdão publicado (= buracos na numeração): {sem_acordao_aprovada}', ok=('OK' if n_ac_atas == n_apr else 'EXCEÇÃO'))
# (f) circuitos
cn = sorted(CIRC); pn = sorted(PAUTA_CIRC); mx = max(pn)
falta_ata = [n for n in range(1, mx + 1) if n not in CIRC]; falta_pauta = [n for n in range(1, mx + 1) if n not in PAUTA_CIRC]
chk('(f) Circuitos deliberativos 1..N: pautas publicadas (denominador) × atas coletadas', len(pn), len(cn), f'N={mx}; sem ata: {falta_ata}; sem pauta: {falta_pauta}', ok=('OK' if len(pn) == len(cn) else 'EXCEÇÃO'))
circ_ac = sorted(fn for (ft, fn) in AC_POR_FORUM if ft == 'Circuito Deliberativo')
chk('(f) Acórdãos cujo fórum é um circuito: o circuito tem ata coletada', [], [n for n in circ_ac if n not in CIRC], f'circuitos com acórdão: {len(circ_ac)}')
chk('(f) Circuito: processo da ata × processo do acórdão do mesmo circuito', 0, sum(1 for n in circ_ac if n in CIRC and not any(a['processo'] == CIRC[n]['processo'] for a in AC_POR_FORUM[("Circuito Deliberativo", n)])), 'processo do acórdão = processo da ata do circuito nº N')
# resumo de votos impresso x linhas por conselheiro
cmp_ok = cmp_dif = 0; dif_l = []
for n, c in CIRC.items():
    rs = c['resumo']
    if 'acompanha' not in rs: continue
    vot = c['votos']; ac_ = sum(1 for vv in vot if vv['classe'] == 'ACOMPANHOU'); rel_ = sum(1 for vv in vot if vv['classe'].startswith('RELATOR')); dv = sum(1 for vv in vot if vv['classe'] == 'DIVERGIU')
    if rs['acompanha'] in (ac_, ac_ + rel_) and rs.get('nao', dv) == dv: cmp_ok += 1
    else: cmp_dif += 1; dif_l.append((n, rs, ac_, rel_, dv))
chk('(f) Circuitos: "Resumo dos Votos" impresso na ata (Acompanha/Não acompanha) × votos por conselheiro lidos', cmp_ok + cmp_dif, cmp_ok, f'divergências (n, resumo, acompanha, relator, divergiu): {dif_l[:8]}', ok=('OK' if not cmp_dif else 'EXCEÇÃO'))
tv = collections.Counter(len(c['votos']) for c in CIRC.values())
chk('(f) Circuitos: nº de votos listados (5 cadeiras)', len(CIRC), tv.get(5, 0), f'distribuição {dict(tv)}; circuitos com 4 votantes: {[n for n, c in CIRC.items() if len(c["votos"]) != 5]} (a própria ata lista só 4 conselheiros; sem substituto)', ok='INFO')
sr = [(a['numero'], p['parte']) for a in ACS_ALL for p in a['partes'] if p['modo'] == 'sem registro']
chk('(d) Acórdãos/partes sem declaração "por unanimidade/por maioria" no dispositivo', 0, len(sr), f'{sr[:10]} (modo = sem registro; votos dessas partes ficam REVISAR)', ok=('OK' if not sr else 'EXCEÇÃO'))
rel_inf = [n for n, c in CIRC.items() if c.get('relator_inferido')]
chk('(f) Circuitos: campo Relator preenchido corretamente na ata', 0, len(rel_inf), f'circuitos com campo Relator inválido na fonte (relator inferido pelo voto próprio): {rel_inf}', ok=('OK' if not rel_inf else 'EXCEÇÃO'))
chk('(f) Circuitos: todo conselheiro tem classe de voto reconhecida (REVISAR)', 0, sum(1 for c in CIRC.values() for vv in c['votos'] if vv['classe'] == 'REVISAR'))
# (g) datas e escopo 2026
fora = [d for d in D if not d['data'].startswith('2026')]
chk('(g) Datas dentro de 2026', len(D), len(D) - len(fora))
# (h) voto_doc resolvido
com_ref = [d for d in D if d['voto_doc']]; res_ = [d for d in com_ref if 'http' in d['voto_doc']]
chk('(h) voto_doc (Análise/Voto do relator citado) resolvido para URL pública em Publicações Eletrônicas', len(com_ref), len(res_), f'{len(res_)} de {len(com_ref)} itens com documento citado têm o voto escrito aberto ao público (Análises dos gabinetes + Votos da Presidência são publicados; Votos em Circuito individuais não)', ok='INFO')
# nominal
n_nom = sum(1 for v in V if v['proveniencia'] == 'nominal'); n_inf = sum(1 for v in V if v['proveniencia'] == 'inferido'); n_rev = sum(1 for v in V if v['proveniencia'] == 'REVISAR')
chk('Votos por proveniência: nominal + inferido + REVISAR = total', len(V), n_nom + n_inf + n_rev, f'nominal {n_nom} ({100 * n_nom / len(V):.1f}%), inferido {n_inf} ({100 * n_inf / len(V):.1f}%), REVISAR {n_rev}')
for v_ in V:
    if v_['proveniencia'] == 'REVISAR': PEND.append([AG, f'{v_["reuniao"]} {v_["deliberacao"]} {v_["diretor"]}', v_['data'], 'Voto a REVISAR', v_['voto'], 'Voto não classificável pelo texto', 'Ler o documento do circuito/acórdão', ''])

# auditoria manual (40+40 itens lidos contra o texto-fonte; veredito humano em anatel_auditoria.json, gerado a partir de scripts/anatel_auditoria.py)
if os.path.exists('anatel_auditoria.json'):
    au = json.load(open('anatel_auditoria.json'))
    for k, a_ in au['amostras'].items():
        for campo, (ok_, tot_) in a_['campos'].items():
            chk(f'(AUDITORIA {k}: {a_["descricao"]}) campo "{campo}": itens corretos × auditados', tot_, ok_, a_.get('nota', ''), ok=('OK' if ok_ / tot_ >= 0.95 else 'EXCEÇÃO'))
# ------------------------------------------------------------------------------- pendencias
def pend(item, data, sit, existe, motivo, como, url): PEND.append([AG, item, data, sit, existe, motivo, como, url])
for n in buracos:
    vz, cand = BURACO_INFO[n]
    pend(f'Acórdão {n}-2026', None, 'Numeração sem acórdão publicado (bloqueado pela fonte)', f'ausente da listagem SEI da série Acórdão (contador 262 = 261 acórdãos + 1 retificação); vizinhos {n - 1} e {n + 1} são do fórum ' + ', '.join(f'{ft} {fn}' for ft, fn in sorted({(a["forum_tipo"], a["forum_n"]) for a in vz})) + (f'; a ata registra item aprovado sem acórdão publicado: ' + '; '.join(f'{t} item {i} processo {pr}' for t, i, pr in cand) if cand else ''),
         'Provável acórdão ainda não publicado/restrito (único item aprovado em ata sem acórdão no mesmo bloco de numeração) ou número não utilizado', 'Pedir à Secretaria do Conselho Diretor (SCD) ou buscar no SEI pelo processo', URL_L('8'))
for t, i, pr in sem_acordao_aprovada:
    pend(f'{t} item {i} processo {pr}', ATAS[t]['data'], 'Item aprovado em ata sem Acórdão publicado', f'ata {ATAS[t]["url"]}', 'Acórdão correspondente não aparece na série Acórdão (ver buraco de numeração)', 'Reconsultar a série Acórdão do SEI depois', URL_L('8'))
for n in falta_ata:
    pa_ = PAUTA_CIRC.get(n)
    if pa_ and n >= mx - 2: pend(f'Circuito Deliberativo {n}/2026', None, 'Circuito em andamento (pauta publicada, ata ainda não)', f'pauta SEI {pa_["resumo"][:140]}', 'Período do circuito ainda não encerrado em 08/10/2026', 'Rodar novamente após o encerramento', URL_L('188'))
    elif pa_: pend(f'Circuito Deliberativo {n}/2026', None, 'Realizado/pautado sem ata publicada', f'pauta SEI {pa_["resumo"][:140]}', 'Ata de circuito não consta na série Ata de Circuito Deliberativo (provável restrição de acesso)', 'Pedir à SCD; conferir se há acórdão correspondente', URL_L('187'))
    else: pend(f'Circuito Deliberativo {n}/2026', None, 'Número sem pauta nem ata', 'numeração pula este nº nas séries Pauta e Ata de Circuito', 'Número não utilizado ou sigiloso', 'Perguntar à SCD', URL_L('187'))
for t in sorted(PAUTAS, key=lambda k: (k.startswith('RCDE'), int(re.sub(r'\D', '', k)))):
    if t in ATAS: continue
    pa = pauta_vigente(t); n_ac_t = len(sem_ata_ac.get(('Reunião Extraordinária' if t.startswith('RCDE') else 'Reunião', int(re.sub(r'\D', '', t))), []))
    futura = pa['data'] >= HOJE.isoformat()
    pend(f'{t}', pa['data'], 'Realizada hoje (08/10/2026, 15h), ata e acórdãos ainda não publicados' if pa['data'] == HOJE.isoformat() else 'Realizada, ata não publicada',
         f'pauta com {len(pa["itens"])} itens pautados ({pa["resumo"]})' + (f'; {n_ac_t} acórdãos já publicados com fórum desta reunião (incluídos em deliberacoes com origem no acórdão)' if n_ac_t else ''),
         'A ata só é publicada depois de aprovada na reunião seguinte (ata 952 → 08/05; 955 → 07/08; 956 → 04/09: 1 a 2 meses depois)', 'Rodar scripts/anatel_sei.cjs + anatel_baixar.py + anatel_parse.py quando a ata sair na série Ata de Reunião', URL_L('229') + ' | pauta: ' + URL_DOC.format(pa['id']))
    if n_ac_t:
        itens_sem = len(pa['itens']) - n_ac_t
        pend(f'{t} itens pautados sem acórdão', pa['data'], 'Desfecho desconhecido (vista/retirada/prorrogação sem ata)', f'{len(pa["itens"])} itens na pauta, {n_ac_t} com acórdão; {itens_sem} sem desfecho conhecido', 'Itens sem acórdão (vistas, retiradas de pauta, prorrogações de prazo) só aparecem na ata', 'Ler a ata quando publicada', URL_DOC.format(pa['id']))
for o in OUTROS_ORGAOS:
    pend(f'Pauta de outro colegiado: {o["resumo"][:80]}', None, 'Fora do escopo (não é o Conselho Diretor)', o['resumo'], 'Comissão Conjunta/CRCA (conflitos entre agências) — deliberação remota de representantes', 'Nenhuma ação; registrado como denominador excluído', o['url'])
for r_ in ATAS_FORA:
    pend(f'Ata {r_["resumo"][:60]}', None, 'Fora do escopo (2025)', r_['resumo'], 'Reunião de 04/12/2025 (949ª), ata publicada em 13/02/2026', 'Nenhuma ação', URL_DOC.format(r_['id_documento']))
pend('Pesquisa pública de processos do SEI (votos em circuito individuais, Análises não publicadas)', None, 'Bloqueado pela fonte (CAPTCHA)', 'formulário exige captcha; não resolvido', 'Os "Votos em Circuito Deliberativo nº N/2026/XX" dos demais conselheiros ficam no processo, fora de Publicações Eletrônicas', 'Pedir o extrato nominal de votação à SCD ou consultar o processo com captcha manual', inv['sei_pesquisa_publica']['url'])
pend('Página oficial de reuniões (URL do enunciado)', None, 'URL legada redireciona', 'www.anatel.gov.br/institucional/conselho-diretor/76-reunioes/conselho-diretor → 302 → gov.br/anatel (home)', 'Site migrado para o gov.br; aviso de defeso eleitoral desde 04/07/2026 remove parte do conteúdo; a página atual só aponta para o SEI', 'Usar o SEI Publicações (fonte primária, efetivamente usada)', URL_REUN)
pend('Histórico de pautas e atas no gov.br', None, 'Desatualizado', 'lista só até a 873ª reunião (01/08/2019)', 'A ANATEL passou a publicar pautas/atas no SEI (Publicações Eletrônicas)', 'Nenhuma ação', URL_HIST)
pend('Anexos do SEI (sistemas.anatel.gov.br/anexar-api/publico/anexos/download/<hash>)', None, 'Sem como enumerar', 'host responde (HTTP 400 para hash inválido)', 'Nenhuma página de reunião ou de Publicações expõe o hash dos anexos', 'Se a SCD fornecer hashes, baixar direto', inv['anexar_api']['url'])
for n in rel_inf:
    pend(f'Circuito Deliberativo {n}/2026 — campo "Relator" da ata inválido', CIRC[n]['fim'], 'Erro na fonte', f'campo Relator = "Matéria Administrativa"', 'Relator inferido a partir do voto com documento próprio (Presidente)', 'Conferir com a SCD', CIRC[n]['url'])

# ------------------------------------------------------------------------------- cobertura / nao_feito / saida
if True:
    # 958 (pauta apenas) entra como reuniao sem presentes
    for t in sorted(PAUTAS):
        if t not in {r['reuniao'] for r in R}:
            pa = pauta_vigente(t); d_ = pa['data']
            add_reuniao(t, f'{re.sub(r"\D", "", t)}ª Reunião do Conselho Diretor da ANATEL ({d_[8:]}/{d_[5:7]}/{d_[:4]})', 'Ordinária (RCD)', d_, [], [], 'Realizada em 08/10/2026 (15h, videoconferência); só a pauta foi publicada — ata e acórdãos ainda não')
R.sort(key=lambda r: (r['reuniao'].startswith('CD'), r['data'], r['reuniao']))
cob = [[AG, 'Reuniões do Conselho Diretor 2026 (pauta publicada)', len(nums_pauta) + 1, f'ordinárias {lo}..{hi} (950ª 12/02 … {hi}ª 08/10) + 1 extraordinária (RCDE32, 03/09); atas lidas: {", ".join("RCD" + str(n) for n in nums_ata)}; acórdão sem ata: RCD957, RCDE32; só pauta: RCD958'],
       [AG, 'Atas de reunião lidas', len(ATAS), f'{sum(len(a["itens"]) for a in ATAS.values())} itens pautados nas atas (= {sum(len(pauta_vigente(t)["itens"]) for t in ATAS)} itens nas pautas)'],
       [AG, 'Circuitos Deliberativos 2026 com ata lida', len(CIRC), f'1..{mx} (sem ata: {falta_ata}); {len(circ_ac)} circuitos geraram acórdão'],
       [AG, 'Acórdãos 2026 lidos', len(nums_ac_lidos), f'1..{hi_ac}; buracos: {buracos}; Acórdão 63 tem 1 retificação'],
       [AG, 'Itens: deliberações / retiradas de pauta / vistas / aprovações de ata', f'{sum(1 for d in D if d["tipo_item"]=="Deliberação")} / {sum(1 for d in D if d["tipo_item"]=="Retirada de pauta")} / {sum(1 for d in D if d["tipo_item"]=="Vista")} / {sum(1 for d in D if d["tipo_item"]=="Aprovação de ata")}', 'Circuitos = 241 deliberações; prorrogações de prazo e conversões em diligência aparecem como deliberação (sem acórdão)'],
       [AG, 'Votos emitidos', len(V), f'nominal {n_nom} ({100 * n_nom / len(V):.1f}%) / inferido {n_inf} ({100 * n_inf / len(V):.1f}%) / REVISAR {n_rev}'],
       [AG, 'Denominadores independentes usados', 'pautas, contador SEI, numeração', 'nº das reuniões (pautas 950..958 + notícia gov.br da 958ª), contador "Exibindo a-b de N" do SEI, numeração de Acórdãos (1..263), numeração de Circuitos (1..246), pautas de circuito (244), itens das pautas × atas, Resumo dos Votos impresso nas atas de circuito'],
       [AG, 'Voto escrito publicado', f'{len(DOCS.get("7", {}))} Análises + {len(DOCS.get("94", {}))} Votos', 'Análises dos gabinetes (OP/NP/AF/EH/CL/VA) e Votos (Presidência e gabinetes) na série pública; resolvidos em voto_doc (URL) quando citados'],
       [AG, 'Onde ficam pauta/ata/voto/acórdão', 'SEI > Publicações Eletrônicas (unidade SCD)', 'Pauta de Reunião (432), Ata de Reunião (229), Acórdão (8), Ata/Pauta de Circuito (187/188), Análise (7), Voto (94); gov.br/anatel/…/reunioes só aponta para o SEI']]
nf = [[AG, 'Voto individual dos conselheiros nas REUNIÕES', f'{n_inf} de {len(V)} linhas ({100 * n_inf / len(V):.1f}%) seguem INFERIDAS', 'PARCIAL (bloqueado pela fonte)', 'Nas reuniões a ata/acórdão registra só o resultado ("por unanimidade"/"por maioria" + vencidos nominais); o voto individual (Voto em Circuito/Voto nº do conselheiro) fica no processo SEI com captcha', 'Pedir extrato nominal à SCD'],
      [AG, 'ACOMPANHOU (inferido)', f'{n_inf} linhas', 'LIMITE DO MODELO', '"por unanimidade" não é voto nominal do conselheiro; nos 241 circuitos o voto é nominal na própria ata', 'Extrato nominal de votação'],
      [AG, 'Acórdãos 82 e 173', '2 números', 'BLOQUEADO PELA FONTE', 'Ausentes da série Acórdão do SEI', 'Ver pendências'],
      [AG, 'Atas das reuniões 957, Extraordinária 32 e 958', '3 reuniões', 'LIMITE DA FONTE', 'Ata sai 1–2 meses depois', 'Reexecutar o pipeline'],
      [AG, 'Texto integral do dispositivo por item', 'decisao_texto limitado a 1500 caracteres', 'LIMITE DO MODELO', 'Dispositivos longos truncados', 'Ler o acórdão (url_acordao)'],
      [AG, 'Sustentações orais, comunicações e registros extrapauta das atas', f'{sum(len(a["extra"]) for a in ATAS.values())} registros extrapauta', 'FORA DO ESCOPO', 'Não são deliberação', '']]
DIRET = [n for n, _, _ in ROST]
json.dump({'reunioes': R, 'deliberacoes': D, 'votos': V, 'qualidade': Q, 'cobertura': cob, 'pendencias': PEND, 'nao_feito': nf, 'diretores': DIRET, 'colegiado': 'Conselho Diretor', 'meses_nota': ''},
          open(out, 'w'), ensure_ascii=False, indent=1)
print(len(R), 'reunioes', len(D), 'itens', len(V), 'votos', dict(collections.Counter(d['tipo_item'] for d in D)), '| nominal', n_nom, 'inferido', n_inf, 'REVISAR', n_rev)
for q in Q: print(q[4], '|', q[1][:120], '|', str(q[2])[:30], str(q[3])[:30], '|', q[5][:140])
