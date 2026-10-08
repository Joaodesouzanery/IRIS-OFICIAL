"""ANP: parser das atas de Reuniao de Diretoria (RD) e Reuniao Extraordinaria 2026 -> anp.json.
Uso: python3 -I scripts/anp_parse.py manifesto_anp.json anp.json   (le texto_anp/ e anp_inventario.json; roda da raiz da pasta)
Entradas independentes usadas no QA: calendario/pasta paginada do inventario (anp_baixar.py) e ancoras do proprio texto."""
import re, sys, json, glob, unicodedata, itertools, collections, datetime, os

# ------------------------------------------------------------------ NORMALIZACAO DO TEXTO (ligaduras quebradas)
# O PDF da ANP perde as ligaduras 'ti'/'tí'/'tt'/'fí' ("Biocombus veis", "Par ciparam", "Wa Neto"). Reparo por vocabulario:
# vocabulario = palavras COM ti/tí/tt/fí atestadas >=3x em textos intactos (outras agencias da pasta + a propria ANP);
# junta 2-3 fragmentos separados por UM espaco quando o resultado esta no vocabulario.
def _toks(t): return re.findall(r'[A-Za-zÀ-ÿ]+', t)
_LIG = {'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', '­': '', '​': '', ' ': ' '}
def _lig(t):
    for a, b in _LIG.items(): t = t.replace(a, b)
    return t
EXTRAS = {'biocombustíveis', 'biocombustível', 'automotivos', 'automotivo', 'compatível', 'compatíveis', 'motivo', 'tipos', 'físico', 'físicas', 'físico-químicas'}
def monta_vocab(textos_anp):
    C = collections.Counter()
    for d in ('texto_anvisa', 'texto_anpd', 'texto_antt', 'texto_artesp', 'texto_anvisa_cd', 'texto'):
        for f in glob.glob(d + '/*.txt'):
            C.update(w.lower() for w in _toks(_lig(open(f, encoding='utf8', errors='ignore').read())))
    for t in textos_anp: C.update(w.lower() for w in _toks(t))
    return {w for w, c in C.items() if c >= 3 and re.search('ti|tí|tt|fí', w)} | EXTRAS
GAPS = ['tí', 'ti', 'tt', 'fí']
def conserta_linha(ln, VOC):
    ms = list(re.finditer(r'[A-Za-zÀ-ÿ]+', ln)); out = []; i = 0; pos = 0
    while i < len(ms):
        feito = False
        for n in (3, 2):
            if i + n > len(ms): continue
            ch = ms[i:i + n]
            if any(ln[ch[k].end():ch[k + 1].start()] != ' ' for k in range(n - 1)): continue
            fr = [m[0] for m in ch]
            for gs in itertools.product(GAPS, repeat=n - 1):
                c = fr[0] + ''.join(g + f for g, f in zip(gs, fr[1:]))
                if c.lower() in VOC:
                    out.append(ln[pos:ch[0].start()] + c); pos = ch[-1].end(); i += n; feito = True; break
            if feito: break
        if not feito: i += 1
    out.append(ln[pos:]); r = ''.join(out)
    r = re.sub(r'\bArtur Wa\b', 'Artur Watt', r)                        # Artur Watt (tt perdido)
    r = re.sub(r'(?<![A-Za-zÀ-ÿ])pos(?= de (?:derivados|combust))', 'tipos', r)
    r = re.sub(r'(?<![A-Za-zÀ-ÿ])sico-', 'físico-', r)
    return r
# ---- FIM NORMALIZACAO

# ------------------------------------------------------------------ COLEGIADO 2026
ROST = [('Artur Watt Neto', r'artur\s*watt|artur\s*wa\b|diretor\s*-?\s*geral'), ('Symone Christine de Santana Araújo', r'symone'),
        ('Daniel Maia Vieira', r'daniel\s*maia'), ('Fernando Wandscheer de Moura Alves', r'fernando'), ('Pietro Adamo Sampaio Mendes', r'pietro')]
# Daniel Vieira (relator) e Daniel Maia (Daniel Maia Vieira) sao a MESMA pessoa: a ata usa "Daniel Vieira" e "Daniel Maia"
ROST[2] = ('Daniel Maia Vieira', r'daniel\s*(?:maia|vi?eira)')
NOMES = [n for n, _ in ROST]
DG = NOMES[0]
def quem(t):
    """diretores citados em t, na ordem em que aparecem (sem repetir)"""
    achados = []
    for n, p in ROST:
        for m in re.finditer(p, t, flags=re.I): achados.append((m.start(), n))
    achados.sort(); out = []
    for _, n in achados:
        if n not in out: out.append(n)
    return out
CURTO = {'Artur Watt Neto': 'Artur Watt', 'Symone Christine de Santana Araújo': 'Symone Araújo', 'Daniel Maia Vieira': 'Daniel Maia', 'Fernando Wandscheer de Moura Alves': 'Fernando Moura', 'Pietro Adamo Sampaio Mendes': 'Pietro Mendes'}
def sp(t): return re.sub(r'\s+', ' ', t).strip()
MES = {'janeiro': 1, 'fevereiro': 2, 'março': 3, 'marco': 3, 'abril': 4, 'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12}
def iso(d, m): return '2026-%02d-%02d' % (MES[m.lower()], int(d))

SESS = re.compile(r'^\s*(?:A Sess[ãa]o (?P<s1>.+?) compreendeu|Foi(?:ram)? acrescentados? como extrapauta na Sess[ãa]o (?P<s2>.+?) os? seguintes?)')
ITEM = re.compile(r'^\s*(\d+)\.\s*Processo\s*:\s*(.*)$')
RETOMA = re.compile(r'^\s*##RETOMADA (\d+) (\w+)##')
SEC_ID = {'Regulatória': 'REG', 'Regulatória – Pauta Pública': 'REG-PUB', 'Regulatória – Pauta Reservada': 'REG-RSV', 'Administrativa': 'ADM', 'Reservada': 'RES'}
def sess_norm(s):
    s = sp(s).replace(' - ', ' – ').rstrip(':')
    return s[:1].upper() + s[1:]

def le_ata(path, VOC):
    raw = _lig(open(path, encoding='utf8').read())
    L = [conserta_linha(l, VOC) for l in raw.split('\n')]
    L = [l for l in L if not re.match(r'^\s*Ata de Reuni[ãa]o de Diretoria.*SEI.*pg\.\s*\d+\s*$', l)]
    t = '\n'.join(L)
    t = re.sub(r'(?s)[ÀA]s (\d+)h(\d*) do dia (\d+) de (\w+) de 2026, a Diretoria Colegiada.{0,260}?reuniu-se para retomar[^\n]*', lambda m: '##RETOMADA %s %s##' % (m[3], m[4]), t)
    fim = t.find('Nada mais havendo')
    return (t[:fim] if fim > 0 else t), t

def cabecalho(t):
    m = re.search(r'Ata da ([\d.]+)ª Reuni[ãa]o de Diretoria( Extraordin[áa]ria)?, realizada (?:no dia|nos dias) ([^\n]+)', t)
    num = int(m[1].replace('.', '')); ext = bool(m[2])
    d1 = re.search(r'(\d+) de (\w+)', m[3]); data = iso(d1[1], d1[2])
    h = sp(t[:t.find('A Sessão') if 'A Sessão' in t else 2500])
    mp = re.search(r'Participaram(.*?)(?:além d|Estav[ao]m? ausentes?|REGISTRO)', h)
    pres = quem(mp[1]) if mp else []
    aus, motivo = [], ''
    ma = re.search(r'Estav[ao]m? ausentes? da reuni[ãa]o (.*?)\.(?:\s|$)', h)
    if ma:
        aus = quem(ma[1]); mm = re.search(r'por motivo de (.*)$', ma[1]); motivo = mm[1] if mm else ''
    return num, ext, data, sp(m[0]), pres, aus, motivo, sp(m[3])

def segmenta(t):
    """blocos de item: (sessao, n, extrapauta, data_sentada, linhas)"""
    L = t.split('\n'); blocos = []; sess = ''; extra = False; data_sent = None; cur = None; retomada = 0
    for ln in L:
        ms = SESS.match(ln); mr = RETOMA.match(ln)
        if ms:
            sess = sess_norm(ms['s1'] or ms['s2']); extra = bool(ms['s2']); cur = None; continue
        if mr:
            data_sent = iso(mr[1], mr[2]); retomada += 1; cur = None; sess = ''; continue
        mi = ITEM.match(ln)
        if mi:
            cur = {'sessao': sess, 'n': int(mi[1]), 'extra': extra, 'data': data_sent, 'ret': retomada, 'linhas': [ln.strip()]}
            blocos.append(cur); continue
        if cur is not None: cur['linhas'].append(ln.strip())
        elif blocos is not None: pass
    return blocos

# ------------------------------------------------------------------ BLOCO DE ITEM -> campos
VERBOS = ['não conhecer', 'conhecer', 'negar provimento', 'dar provimento', 'dar provimento parcial', 'aprovar', 'reprovar', 'rejeitar', 'indeferir', 'deferir', 'autorizar', 'determinar', 'atestar', 'prorrogar',
          'dispensar', 'homologar', 'nomear', 'exonerar', 'apostilar', 'declarar', 'revogar', 'acolher', 'receber', 'sobrestar', 'aprovar parcialmente', 'recomendar', 'orientar', 'condicionar', 'estabelecer', 'conceder', 'submeter', 'alterar', 'manter', 'ratificar', 'arquivar']
def sentencas(t):
    t = sp(t)
    t = re.sub(r'(?:(?<=\s)|^)\d{1,2}\s*[-–]\s+(?=[A-ZÀ-Ú])', '\n', t)                 # "2 - O Diretor..." (registros numerados)
    t = re.sub(r'(?:(?<=\s)|^)\d{1,2}\.\s+(?=(?:O|A|Os|As|Nos|Antes|Considerad\w+|De forma|Nas|Com|Diante)\b)', '\n', t)
    t = re.sub(r'(?<=[a-zçãõáéíóúê\)\d"])\.\s+(?=[A-ZÀ-Ú])', '.\n', t)
    t = re.sub(r'\.\s*(?=(?:O|A|Os|As) (?:Diretor|Diretora|Diretores|Diretoras|Diretoria)\b)', '.\n', t)
    return [x.strip() for x in t.split('\n') if x.strip()]

def acao(dl, mdec):
    """verbo(s) da decisao -> texto do resultado"""
    corpo = dl[mdec.end():]
    corpo = re.sub(r'^[\s,:]*(?:por (?:unanimidade|maioria)(?: absoluta| simples| qualificada)?(?: entre os presentes| dentre os (?:Diretores )?presentes)?[,:]?\s*)?', '', corpo)
    c0 = re.sub(r'^(?:[IVX]+\s*[-–)]+\s*|[IVX]+\)\s*)', '', corpo.strip(), flags=re.I)
    low = c0.lower()
    if re.search(r'\bnão conhecer\b|\bnão conhecimento\b', low[:80]): a = 'NÃO CONHECER'
    elif re.match(r'(?:conhecer|receber)\b', low) and re.search(r'negar(?:-lhe)?\s+(?:o\s+|seu\s+|o\s+seu\s+)?provimento', low[:300]): a = 'CONHECER E NEGAR PROVIMENTO'
    elif re.match(r'(?:conhecer|receber)\b', low) and re.search(r'dar\s+(?:o\s+|seu\s+)?provimento', low[:300]): a = 'CONHECER E DAR PROVIMENTO'
    else:
        vb = [v for v in sorted(VERBOS, key=len, reverse=True) if low.startswith(v)]
        m = re.match(r'([a-zçãõáéíóúê]+(?:\s+(?:provimento|parcialmente))?)', low)
        a = vb[0].upper() if vb else (m[1].upper() if m else 'DECIDIU')
    comp = bool(re.search(r'[;:]?\s+(?:II|2)\s*[-–)]', corpo)) or bool(re.search(r'\bII\)', corpo))
    return a, comp

def modo_de(dl):
    m = re.search(r'por\s+(unanimidade|maioria(?:\s+(?:absoluta|simples|qualificada))?)(\s+(?:entre os presentes|dos votos dentre os (?:Diretores )?presentes|dentre os (?:Diretores )?presentes))?', dl)
    if not m: return '', False
    return m[1], bool(m[2])

NOME = r"([A-ZÀ-Ú][\wÀ-ÿ&./'-]*(?:\s+(?:(?:de|do|da|dos|das|e|&)\s+)?[A-ZÀ-Ú][\wÀ-ÿ&./'-]*)*)"
def interessado_de(ass, uni):
    """a ata não tem campo 'interessado': heurística sobre o assunto (…requerido/apresentado/interposto pela EMPRESA…); sem achado, sigla da unidade autora"""
    for m in re.finditer(r'(?:requerid[oa]|apresentad[oa]|interpost[oa]|formulad[oa]|submetid[oa]|solicitad[oa]|pleiteado|recurso|[Pp]edido de [a-zçãõ ]{3,40}?|proposta)\s+(?:pel[oa]s?|por|d[ao]s?)\s+(?:operadora\s+|empresa\s+|concessionária\s+|sociedade\s+)?' + NOME, ass):
        nome = m[1].strip(' .,-')
        if len(nome) >= 4 and not re.match(r'(?:Superintend|Diretor|Ag[êe]ncia|ANP\b)', nome): return nome[:90]
    ms = re.search(r'\(([A-Z]{2,6})\)\s*$', uni or '')
    return ms[1] if ms else (uni or '')[:60]

def parse_bloco(b, ctx):
    """b: bloco de segmenta(); ctx: dict da reuniao. Retorna (d, info) ou None"""
    txt = sp(' '.join(b['linhas']))
    txt = re.sub(r'(?<=Diretor)\s*-\s*(?=Geral|Relator)', '-', txt)
    txt = re.sub(r'Diretor(a)?\s*-\s*Relator(a)?', lambda m: 'Diretor%s-Relator%s' % (m[1] or '', m[2] or ''), txt)
    ireg = re.search(r'\bREGISTROS?\s*:', txt)
    cab_e_del = txt[:ireg.start()] if ireg else txt
    reg = txt[ireg.end():] if ireg else ''
    mdel = re.search(r'Delibera[çc][ãa]o\s*:', cab_e_del)
    cab = cab_e_del[:mdel.start()] if mdel else cab_e_del
    dl = cab_e_del[mdel.end():].strip() if mdel else ''
    # numeros de processo
    mproc = re.match(r'(?:Processos?\s*:\s*)?(.*?)\s*-\s*Assunto\s*:', cab)
    procs = list(dict.fromkeys(re.findall(r'\d{5}\.\d{6}/\d{4}-\d{2}', mproc[1] if mproc else cab[:120])))
    ass = (re.search(r'Assunto\s*:\s*(.*?)[\s-]*(?:Unidade Autora|UORG)\s*:', cab) or [None, ''])[1]
    uni = (re.search(r'(?:Unidade Autora|UORG)\s*:\s*(.*?)[\s.]*(?:-\s*)?Diretor(?:a)?(?:-Geral)?-?\s*Relator', cab) or [None, ''])[1].strip(' .-')
    mrel = re.search(r'Relator(?:a)?\s*:\s*(.*)$', cab)
    rel_txt = mrel[1] if mrel else ''
    if mrel and not mdel:                      # sem rotulo "Deliberação:": a narrativa do voto vem logo apos o campo do relator
        partes = re.split(r'\.\s+(?=[A-ZÀ-Ú])', rel_txt, maxsplit=1)
        rel_txt = partes[0]
        if len(partes) > 1: reg = partes[1] + ' ' + reg
    retorno = (re.search(r'\((Retorno[^)]*)\)', rel_txt) or [None, ''])[1]
    rel_nome = quem(re.sub(r'\(.*', '', rel_txt))
    rel = rel_nome[0] if rel_nome else None
    return dict(txt=txt, cab=cab, dl=dl, reg=reg, procs=procs, ass=ass, uni=uni, rel=rel, retorno=retorno, rel_txt=rel_txt)

# ------------------------------------------------------------------ ANALISE DO DESFECHO E DOS VOTOS
RETIROU = r'retirou\s*(?:a\s*mat[ée]ria\s*)?de\s*pauta'
def analisa(p):
    """classifica o item e extrai quem fez o que (so do texto do proprio item)"""
    S = sentencas(p['reg']); SD = sentencas(p['dl']); rel = p['rel']; dl = p['dl']
    r = dict(dec=None, modo='', entre_presentes=False, retirou=[], transf=False, suspenso=False, vista=[], aderiu=[], antes=[], rel_votou=False, rel_nao_votou=False,
             acomp=[], div=[], div_alvo={}, conv=[], conv_alt=False, imp=[], saiu=[], parcial=[], mantido=None)
    mdec = re.search(r'\b(decidiu|decide|deliberou)\b', dl) if dl else None
    if mdec: r['dec'] = mdec; r['modo'], r['entre_presentes'] = modo_de(dl)
    for s in S + SD:                                   # frases de voto: aparecem tanto nos REGISTROS quanto na propria clausula de deliberacao
        m = re.search(r'(n[ãa]o\s+)?acompanh(?:ou|aram|ar|arem)(\s+parcialmente)?\s+o\s+voto\s+(alternativo\s+|divergente\s+)?(?:d[oa]s?\s+)?(.*?)(?:,|\.|\s+e,|\s+na\s+Reuni|\s+nos\s+termos|\s+apresentando|$)', s)
        if m and 'sem prejuízo' not in s:
            suj = quem(s[:m.start()]); alvo = m[4]
            alvo_rel = bool(re.search(r'Relator', alvo)) or (rel and quem(alvo) == [rel] and not m[3])
            if m[1] or m[3] or (not alvo_rel):
                r['div'] += suj
                for x in suj: r['div_alvo'][x] = (quem(alvo)[0] if quem(alvo) and not alvo_rel and quem(alvo)[0] != x else None)
            else: r['acomp'] += suj
            if m[2]: r['parcial'] += suj
        m = re.search(r'Acompanharam\s+o\s+voto\s+d[ao]\s+Diretor(?:a)?-Relator(?:a)?,?[^,]*,\s*(?:os?|as?)\s+Diretor\w*\s+(.*?)\.?$', s)
        if m: r['acomp'] += quem(m[1])
        m = re.search(r'(.*?)apresentaram\s+votos?\s+divergentes(.*)', s)
        if m:
            r['div'] += quem(m[1])
            mt = re.search(r'Relator\w*\s+(.*)$', m[2])
            if mt: r['div'] += quem(mt[1])
        m = re.search(r'votos?\s+divergentes\s+d[ao]s?\s+(.*?)(?:\s+[àa]\s+proposta|,\s+o\s+resultado|$)', s)
        if m: r['div'] += quem(m[1])
        m = re.search(r'(.*?)aderiu\s+ao\s+voto\s+d[oa]\s+Diretor\w*\s+(.*)$', s)
        if m:
            suj = quem(m[1]); alvo = quem(m[2])
            r['div'] += suj
            for x in suj: r['div_alvo'][x] = alvo[0] if alvo else None
        m = re.search(r'votos?\s+convergentes\s+d[ao]s?\s+(.*?)(?:\s+[àa]\s+proposta|\s+ao\s+voto|,\s+decid|,\s+por maioria|,\s+o resultado|$)', s)
        if m:
            r['conv'] += quem(m[1]); r['conv_alt'] = r['conv_alt'] or bool(re.search(r'alternativ|diverg', s))
    for s in S:
        m = re.search(RETIROU, s)
        if m: r['retirou'] += quem(s[:m.start()]) or ([rel] if rel else [])
        if re.search(r'solicitou a transfer[êe]ncia', s): r['transf'] = True
        if re.search(r'delibera[çc][ãa]o suspensa|ficar[áa] com a delibera[çc][ãa]o suspensa', s): r['suspenso'] = True
        m = re.search(r'(?:apresentou|formulou)\s+(?:o\s+)?(?:pedido de vistas?|prorroga[çc][ãa]o do pedido de vistas?|pedido de prorroga[çc][ãa]o de vistas?)', s)
        if m and not re.search(r'considerando que o referido Diretor\s+formulou', s): r['vista'] += quem(s[:m.start()])
        m = re.search(r'aderi\w*\s+ao\s+pedido\s+de\s+vistas?', s)
        if m: r['aderiu'] += quem(s[:m.start()])
        m = re.search(r'(?:declarou|declararam)-se\s+(?:impedid|suspeit)|impedid[oa]s? de votar|suspei[çc][ãa]o', s)
        if m and 'impedimentos' not in s: r['imp'] += quem(s[:m.start()])
        m = re.search(r'informou\s+sua\s+sa[íi]da\s+antecipada', s)
        if m: r['saiu'] += quem(s[:m.start()])
        mv = re.search(r'\bvotou\b|proferiu\s+(?:o\s+)?seu\s+voto|declarou\s+o\s+seu\s+voto|apresentou\s+seu\s+voto', s)
        if mv and rel and not re.search(r'n[ãa]o o proferiu', s) and (rel in quem(s[:mv.start()]) or re.search(r'Relator', s[:mv.start()])): r['rel_votou'] = True
        if re.search(r'n[ãa]o o proferiu', s): r['rel_nao_votou'] = True
        if re.search(r'manifest\w+\s+(?:seus?|o seu)\s+votos?.{0,80}acompanhar\w*\s+o\s+Diretor(?:a)?-Relator', s): r['rel_votou'] = True
        m = re.search(r'manifest\w+\s+(?:seus?|o seu)\s+votos?', s)
        if m: r['antes'] += quem(s[:m.start()])
        m = re.search(r'consultad\w+\s+(?:o|a|os|as)\s+Diretor\w*,?\s*(.*?),?\s+acerca de eventual interesse na desist[êe]ncia do pedido de (vista|retirada de pauta)', s)
        if m and re.search(r'manifest\w+-se\s+pela\s+manuten[çc][ãa]o', s): r['mantido'] = (m[2], quem(m[1]))
        if re.search(r'apresentou antecipadamente voto|proferiu voto pela', s) : pass
    for k in ('div', 'acomp', 'vista', 'aderiu', 'antes', 'retirou', 'imp', 'saiu', 'conv'):
        r[k] = list(dict.fromkeys(r[k]))
    return r

def resultado_de(p, r):
    dl = p['dl']
    if r['dec'] is not None:
        a, comp = acao(dl, r['dec']); modo = r['modo']
        sufixo = 'POR UNANIMIDADE' if modo.startswith('unanim') else ('POR MAIORIA' + (' ABSOLUTA' if 'absoluta' in modo else '')) if modo.startswith('maioria') else 'SEM MODO NA ATA'
        if r['entre_presentes']: sufixo += ' ENTRE OS PRESENTES'
        return 'Deliberação', f'{a} — {sufixo}' + (' [decisão composta: ver texto]' if comp else '')
    if r['mantido'] and r['mantido'][0] == 'vista':
        r['vista'] = r['mantido'][1]
        return 'Vista', 'SOBRESTADO — vista mantida na retomada (' + ', '.join(r['mantido'][1]) + ')'
    if r['mantido']:
        return 'Retirada de pauta', 'RETIRADO DE PAUTA (mantido na retomada; permanece fora de deliberação)'
    if r['retirou']:
        return 'Retirada de pauta', 'RETIRADO DE PAUTA' + (' (por ' + ', '.join(r['retirou']) + ')' if r['retirou'] else '')
    if r['transf']: return 'Retirada de pauta', 'TRANSFERIDO PARA A SESSÃO RESERVADA'
    if r['suspenso']: return 'Retirada de pauta', 'ADIADO — deliberação suspensa e retomada em outra data da mesma reunião'
    if r['vista']:
        return 'Vista', 'SOBRESTADO — vista concedida a ' + ', '.join(r['vista'] + [x for x in r['aderiu'] if x not in r['vista']])
    return 'Deliberação', 'SEM DESFECHO NA ATA (revisar)'

def votos_item(tipo, res, p, r, ctx):
    rel = p['rel']; out = {}; pres = ctx['presentes']; ant = ctx['antecipado']
    maioria = r['modo'].startswith('maioria')
    explicito = set(r['acomp']) | set(r['div'])
    rel_vencido = False
    if tipo == 'Deliberação' and maioria and rel:
        lado_rel = {rel} | set(r['acomp']) | (set() if r['conv_alt'] else set(r['conv']) - set(r['div']))
        lado_div = (set(r['div']) | (set(r['conv']) if r['conv_alt'] else set())) - lado_rel
        rel_vencido = len(lado_div) > len(lado_rel)
    for n in NOMES:
        if n in ctx['left'] and (tipo != 'Deliberação' or r['entre_presentes']):      # decisão "por unanimidade" (sem "entre os presentes") inclui quem saiu depois (apreciação conjunta)
            out[n] = ('AUSENTE (saída antecipada registrada na ata)', 'nominal'); continue
        if n != ant and (n in ctx['ausentes'] or n not in pres) and not (maioria and n in explicito):
            out[n] = ('AUSENTE (não consta entre os presentes)', 'nominal'); continue
        if n in r['imp']:
            out[n] = ('IMPEDIDO (declarou-se impedido/suspeito)', 'nominal'); continue
        if tipo == 'Retirada de pauta':
            out[n] = ('SEM VOTO (retirado de pauta)', 'nominal'); continue
        if tipo == 'Vista':
            if n in r['vista']: v, pv = 'PEDIU VISTA', 'nominal'
            elif n in r['aderiu']: v, pv = 'VISTA COLETIVA (aderiu ao pedido de vista)', 'nominal'
            elif n == rel: v, pv = ('RELATOR (voto proferido; vista concedida)', 'nominal') if r['rel_votou'] else ('RELATOR (vista concedida; sem voto proferido na ata)', 'nominal')
            elif n in r['div']:
                alvo = r['div_alvo'].get(n); v, pv = 'DIVERGIU' + (f' (aderiu ao voto divergente de {CURTO[alvo]})' if alvo else ''), 'nominal'
            elif n in r['antes'] or n in r['acomp']: v, pv = 'VOTOU (antes da vista)', 'nominal'
            else: v, pv = 'SEM VOTO AINDA (vista pendente)', 'inferido'
            out[n] = (v, pv); continue
        if 'SEM DESFECHO' in res:
            out[n] = ('A REVISAR (sem desfecho na ata)', 'REVISAR'); continue
        if maioria:
            if n == rel: v, pv = ('RELATOR (voto vencido)' if rel_vencido else 'RELATOR (voto proferido)'), 'nominal'
            elif n in r['div']:
                alvo = r['div_alvo'].get(n); v, pv = 'DIVERGIU' + (f' (acompanhou o voto divergente de {CURTO[alvo]})' if alvo else ''), 'nominal'
            elif n in r['acomp']: v, pv = 'ACOMPANHOU', 'nominal'
            elif n in r['conv']: v, pv = ('DIVERGIU (votos convergentes ao voto alternativo)' if r['conv_alt'] else 'ACOMPANHOU'), 'nominal'
            else: v, pv = 'A REVISAR (maioria sem posição nominal do diretor)', 'REVISAR'
        else:
            if n == rel: v, pv = 'RELATOR (voto proferido)', 'nominal'
            else: v, pv = 'ACOMPANHOU', 'inferido'
        out[n] = (v, pv)
    return out

# ------------------------------------------------------------------ MAIN
man = json.load(open(sys.argv[1])); out_path = sys.argv[2]
inv = json.load(open('anp_inventario.json')); hoje = datetime.date.today()
atas = sorted([(v['tag'], k, v) for k, v in man.items() if v['tipo'] == 'ata' and v['ok']], key=lambda x: (x[0].startswith('EXT'), int(re.sub(r'\D', '', x[0]))))
raw_all = {tag: _lig(open(v['texto'], encoding='utf8').read()) for tag, k, v in atas}
VOC = monta_vocab(raw_all.values())
R, D, V = [], [], []; QA_AUX = collections.defaultdict(dict); ITENS_DBG = []
for tag, nome, mi in atas:
    corpo, completo = le_ata(mi['texto'], VOC)
    num, ext, data, titulo, pres, aus, motivo, datas_txt = cabecalho(corpo)
    reu = ('RDE%d' % num) if ext else ('RD%d' % num)
    # voto antecipado de diretor ausente (encaminhado ao Diretor-Geral)
    antecipado = {}; obs = []
    flat = sp(corpo)
    for ms in re.finditer(r'seus votos ao Diretor-Geral.{0,260}?mat[ée]rias relacionadas nos (.*?)\.\s', flat):
        quem_ = re.findall(r'[Dd]iretor(?:a)? (.{3,40}?) jus\w*\s*\w*\s+a impossibilidade', flat[max(0, ms.start() - 600):ms.start()])
        dire = quem(quem_[-1]) if quem_ else []
        if dire:
            for g in re.finditer(r'[Ii]tens? ([\d,\se]+?) da Sess[ãa]o (\w+)', ms[1]):
                for x in re.findall(r'\d+', g[1]):
                    antecipado[({'Regulatória': 'REG', 'Reservada': 'RES', 'Administrativa': 'ADM'}[g[2]], int(x))] = dire[0]
            obs.append(f'{dire[0]} (ausente) enviou seus votos ao Diretor-Geral para: ' + sp(ms[1]))
    if aus: obs.append('Ausente(s): ' + ', '.join(aus) + (f' (motivo: {motivo})' if motivo else ''))
    if re.search(r'nos dias', titulo): obs.append('Reunião suspensa e retomada em outra data; a ata cobre os dois dias')
    blocos = segmenta(corpo); left = set(); ret_atual = 0; n_items = 0
    for b in blocos:
        if b['ret'] != ret_atual: left = set(); ret_atual = b['ret']
        p = parse_bloco(b, None)
        r = analisa(p)
        sec_id = SEC_ID.get(b['sessao'], 'SES')
        sufixo = 'R' if b['ret'] else ''
        chave = (sec_id.split('-')[0], b['n'])
        ctx = dict(presentes=pres, ausentes=aus, left=set(left), antecipado=antecipado.get(chave))
        tipo, res = resultado_de(p, r)
        vt = votos_item(tipo, res, p, r, ctx)
        deli = f'{sec_id}-{b["n"]}{sufixo}'
        proc = p['procs'][0] if p['procs'] else f'{reu}-{deli}'
        dd = (re.search(r'\(DD\s*n[ºo]\s*([\d/.]+)\)', p['dl']) or [None, ''])[1]
        dtxt = ''
        if r['dec'] is not None: dtxt = sp(p['dl'][max(0, r['dec'].start() - 160):])[:1500]
        elif tipo != 'Deliberação': dtxt = sp(p['reg'])[:1500]
        d = {'reuniao': reu, 'data': b['data'] or data, 'processo': proc, 'deliberacao': deli, 'item_n': str(b['n']), 'relator': p['rel'], 'interessado': interessado_de(p['ass'], p['uni']),
             'assunto': p['ass'][:600], 'resultado': res, 'voto_doc': dd, 'decisao_texto': dtxt, 'tipo_item': tipo, 'secao': 'Sessão ' + b['sessao'] + (' (extrapauta)' if b['extra'] else ''),
             'unidade': p['uni'], 'processos_do_item': p['procs'], 'retorno_de_vista': bool(p['retorno'])}
        D.append(d); n_items += 1
        for n in NOMES:
            v, pv = vt[n]; V.append({'reuniao': reu, 'data': d['data'], 'processo': proc, 'deliberacao': deli, 'diretor': n, 'voto': v, 'proveniencia': pv})
        left |= set(r['saiu'])
        ITENS_DBG.append(dict(reu=reu, deli=deli, p=p, r={k: v for k, v in r.items() if k != 'dec'}, tipo=tipo, res=res, votos={n: vt[n][0] for n in NOMES}, left=sorted(left), ncab=b['n']))
        QA_AUX[reu].setdefault('itens', []).append(deli)
    for x in list(left): pass
    if left: obs.append('Saída antecipada registrada: ' + ', '.join(sorted(left)))
    R.append({'reuniao': reu, 'titulo': titulo, 'tipo': 'Extraordinária (RDE)' if ext else 'Ordinária (RD)', 'data': data, 'presentes': pres, 'ausentes': aus, 'obs': '; '.join(obs),
              '_num': num, '_ext': ext, '_texto': mi['texto'], '_corpo': corpo})
json.dump({'D': D, 'V': V, 'dbg': ITENS_DBG}, open(os.environ.get('ANP_DBG', os.devnull), 'w'), ensure_ascii=False, indent=1, default=lambda o: sorted(o) if isinstance(o, set) else str(o))

# ------------------------------------------------------------------ QA (fontes independentes do parser)
AG = 'ANP'; Q = []
def chk(nome, esp, obs, nota='', exc=False): Q.append([AG, nome, esp, obs, 'OK' if esp == obs else ('EXCEÇÃO' if exc else 'DIVERGE'), nota])
cal = inv['calendario']
cal_atas = sorted(c['tag'] for c in cal if c['ata_publicada_em'])
links_atas = sorted(v['tag'] for v in man.values() if v['tipo'] == 'ata')
pasta_atas = sorted(n for n in inv['pasta_arquivos'] if n.startswith('ata'))
tags_lidas = sorted(r['reuniao'].replace('RDE', 'EXT').replace('RD', 'RD') for r in R)
tag_cal = lambda t: t.replace('RDE', 'EXT')
chk('(a) Atas marcadas "Ata (publicação em ...)" no CALENDÁRIO da página × atas baixadas (manifesto ok)', len(cal_atas), sum(1 for v in man.values() if v['tipo'] == 'ata' and v['ok']), 'calendário: ' + ', '.join(cal_atas))
chk('(a) Atas do CALENDÁRIO × atas .pdf linkadas na página (arquivos-rd-2026/ata-*.pdf)', len(cal_atas), len(links_atas))
chk('(a) Atas linkadas na página × atas na listagem PAGINADA da pasta arquivos-rd-2026 (b_start 0/20/40; %d páginas, %d arquivos)' % (inv['pasta_paginas_lidas'], len(inv['pasta_arquivos'])), len(links_atas), len(pasta_atas))
chk('(a) Todos os PDFs da página (ata+pauta) × arquivos da pasta paginada (não só a 1ª página)', len(inv['links_pagina']), len(inv['pasta_arquivos']), 'a pasta tem >20 itens: prova de que a paginação foi seguida (1ª página = 20)')
chk('(a) Atas baixadas × atas LIDAS (reuniões no anp.json)', sum(1 for v in man.values() if v['tipo'] == 'ata' and v['ok']), len(R))
chk('(a) Reuniões lidas × atas do calendário (mesmas etiquetas)', sorted(tag_cal(t) for t in cal_atas), sorted(tag_cal(t) for t in links_atas))
api = inv['api']
Q.append([AG, 'Contador oficial: API Volto items_total da pasta × PDFs da pasta paginada', len(inv['pasta_arquivos']), 'indisponível (HTTP ' + '/'.join(str(v['http']) for v in api.values()) + ')', 'EXCEÇÃO',
          'A API ++api++ responde 404 (host sem a rota) e o REST da pasta 401 (sem permissão "Use REST API"): não há items_total anônimo. Substituído por 3 contadores independentes: calendário da página, links da página e listagem paginada da pasta (46 = 46)'])
# datas: reuniao x calendario
cal_d = {c['tag']: c['data'] for c in cal if not c['retomada']}
bad = [(r['reuniao'], r['data'], cal_d.get(tag_cal(r['reuniao']))) for r in R if cal_d.get(tag_cal(r['reuniao'])) != r['data']]
chk('(a) Data da ata (cabeçalho) × data do calendário da página', len(R), len(R) - len(bad), str(bad))
# (e) numeracao
ord_cal = sorted(c['numero'] for c in cal if not c['extraordinaria'] and not c['retomada'])
ext_cal = sorted(c['numero'] for c in cal if c['extraordinaria'])
bur_o = [x for x in range(1175, max(ord_cal) + 1) if x not in ord_cal]
chk('(e) Numeração das RD ordinárias 1.175..%d no calendário sem buraco' % max(ord_cal), 0, len(bur_o), f'buracos: {bur_o}; calendário vai de {min(ord_cal)} a {max(ord_cal)} (23 reuniões previstas)')
bur_e = [x for x in range(min(ext_cal), max(ext_cal) + 1) if x not in ext_cal]
chk('(e) Numeração das extraordinárias %d..%d no calendário sem buraco' % (min(ext_cal), max(ext_cal)), 0, len(bur_e), f'extraordinárias no calendário: {ext_cal}')
lidas_o = sorted(r['_num'] for r in R if not r['_ext'])
fal_o = [x for x in range(1175, max(lidas_o) + 1) if x not in lidas_o]
chk('(e) Atas lidas das ordinárias 1.175..%d sem buraco' % max(lidas_o), 0, len(fal_o), f'ordinárias com ata lida: {lidas_o[0]}..{lidas_o[-1]}')
# (b) itens x ancoras
tot_anc = 0; tot_dd = 0; dd_itens = 0; tot_lab = 0; diverg_b = []
for r in R:
    c = r['_corpo']; flat = sp(c)
    n_anc = len(re.findall(r'(?<![\d.])\d{1,2}\.\s*Processo\s*:\s*\d{5}\.\d{6}/\d{4}-\d{2}', flat)); n_it = len(QA_AUX[r['reuniao']]['itens'])
    tot_anc += n_anc
    if n_anc != n_it: diverg_b.append((r['reuniao'], n_anc, n_it))
    dd_txt = set(re.findall(r'\(DD\s*n[ºo]\s*([\d/.]+)\)', flat)); dd_par = {d['voto_doc'] for d in D if d['reuniao'] == r['reuniao'] and d['voto_doc']}
    tot_dd += len(dd_txt); dd_itens += len(dd_par & dd_txt)
    tot_lab += len(re.findall(r'Delibera[çc][ãa]o\s*:', flat))
chk('(b) Itens lidos × âncoras "N. Processo: <nº>" do texto (regex sobre o texto corrido, independente da segmentação por linhas)', tot_anc, len(D), str(diverg_b))
chk('(b) Decisões "(DD nº N/2026)" distintas no texto × itens com voto_doc igual a um DD do texto', tot_dd, dd_itens, 'cada DD do texto deve estar em algum item')
n_del = sum(1 for d in D if d['tipo_item'] == 'Deliberação' and 'SEM DESFECHO' not in d['resultado'])
chk('(b) Rótulos "Deliberação:" no texto × itens classificados como Deliberação decidida', tot_lab, n_del, 'o rótulo só existe nos itens decididos; vista/retirada não o têm')
n_sd = sum(1 for d in D if 'SEM DESFECHO' in d['resultado'])
Q.append([AG, '(b) Itens sem desfecho identificado (nem decidiu, nem retirada, nem vista)', 0, n_sd, 'OK' if not n_sd else 'DIVERGE', ''])
# (c) presenca
vot_aus = []; cit_aus = []
for dbg in ITENS_DBG:
    r_ = next(x for x in R if x['reuniao'] == dbg['reu']); pres_ = set(r_['presentes'])
    citados = set([dbg['p']['rel']] if dbg['p']['rel'] else []) | set(dbg['r']['div']) | set(dbg['r']['imp']) | set(dbg['r']['vista']) | set(dbg['r']['aderiu']) | set(dbg['r']['acomp'])
    fora = [x for x in citados if x not in pres_]
    if fora: cit_aus.append((dbg['reu'], dbg['deli'], [CURTO[x] for x in fora]))
chk('(c) Itens cujos relatores/divergentes/vista/impedidos citados no corpo ⊆ presentes do cabeçalho', len(ITENS_DBG), len(ITENS_DBG) - len(cit_aus), str(cit_aus) + ' — citados ausentes = voto antecipado enviado ao Diretor-Geral ou voto dado em reunião anterior (REGISTROS)', exc=True)
sig_bad = []
for r in R:
    c = open(r['_texto'], encoding='utf8').read()
    sig = set(quem(' '.join(re.findall(r'assinado eletronicamente por ([A-ZÇÃÕÉÊÍÓÚÂ ]+?),\s*Diretor', c))))
    if sig != set(r['presentes']): sig_bad.append((r['reuniao'], sorted(CURTO[x] for x in set(r['presentes']) ^ sig)))
chk('(c) Presentes do cabeçalho × diretores que ASSINAM a ata (bloco de assinaturas eletrônicas, fonte independente do cabeçalho)', len(R), len(R) - len(sig_bad), str(sig_bad))
chk('(c) Presentes ∪ ausentes do cabeçalho = os 5 diretores do colegiado (por reunião)', len(R), sum(1 for r in R if set(r['presentes']) | set(r['ausentes']) == set(NOMES) and not set(r['presentes']) & set(r['ausentes'])))
# (d) 1 voto por diretor
vk = collections.Counter((v['reuniao'], v['processo'], v['deliberacao'], v['diretor']) for v in V)
dup = [k for k, n in vk.items() if n > 1]
chk('(d) Linhas de voto = 5 diretores × itens (1 por diretor, presentes e ausentes)', len(D) * 5, len(V))
chk('(d) Nenhum diretor com 2 votos no mesmo item', 0, len(dup), str(dup[:5]))
pres_sem = 0
for r in R:
    ids = {d['deliberacao'] for d in D if d['reuniao'] == r['reuniao']}
    for i_ in ids:
        vs_ = [v for v in V if v['reuniao'] == r['reuniao'] and v['deliberacao'] == i_ and v['diretor'] in r['presentes'] and not v['voto'].startswith('AUSENTE')]
        if len(vs_) < len(r['presentes']) - sum(1 for v in V if v['reuniao'] == r['reuniao'] and v['deliberacao'] == i_ and v['diretor'] in r['presentes'] and v['voto'].startswith('AUSENTE')): pres_sem += 1
chk('(d) Itens em que algum diretor presente ficou sem linha de voto', 0, pres_sem)
cnt = collections.Counter((d['reuniao'], d['processo'], d['deliberacao']) for d in D)
chk('(d) Itens com chave única (reunião, processo, deliberação)', len(D), len(cnt))
# unanimidade x texto
conf = []
for dbg in ITENS_DBG:
    if dbg['res'].startswith(('Deliberação',)): pass
    if 'UNANIMIDADE' in dbg['res'] and re.search(r'n[ãa]o acompanh|votos? divergentes|apresentou\w* (?:proposta|voto) alternativ', dbg['p']['txt']): conf.append((dbg['reu'], dbg['deli']))
chk('(c) Itens "por unanimidade" cujo texto cita voto divergente / não acompanhamento', 0, len(conf), str(conf))
# relator no cabecalho do item == relator citado na propria ata (2a fonte: "Relator" no campo bruto)
sem_rel = [(d['reuniao'], d['deliberacao']) for d in D if not d['relator']]
chk('(c) Itens com relator identificado', len(D), len(D) - len(sem_rel), str(sem_rel))
nrev = sum(1 for v in V if v['proveniencia'] == 'REVISAR')
Q.append([AG, '(d) Linhas de voto marcadas REVISAR (maioria sem posição nominal)', 0, nrev, 'OK' if not nrev else 'EXCEÇÃO', 'ata diz "por maioria" sem nomear todos os votantes' if nrev else ''])

# ------------------------------------------------------------------ COBERTURA / PENDENCIAS / NAO FEITO
PAG = inv['pagina']; pend = []
com_ata = {tag_cal(r['reuniao']) for r in R}
pautas_pdf = collections.defaultdict(list)
for k, v in man.items():
    if v['tipo'] == 'pauta' and v['tag']: pautas_pdf[v['tag']].append(k)
for c in sorted(cal, key=lambda c: c['data']):
    if c['tag'] in com_ata or c['retomada']: continue
    nome = ('RDE%d' % c['numero']) if c['extraordinaria'] else ('RD%d' % c['numero'])
    futura = c['data'] > hoje.isoformat()
    existe = 'pauta publicada (%s)' % ', '.join(sorted(pautas_pdf.get(c['tag'], []))) if pautas_pdf.get(c['tag']) else ('só a data no calendário' if futura else 'nada além do calendário')
    if futura: pend.append([AG, nome, c['data'], 'Futura (ainda não ocorreu)', existe, 'Reunião prevista no calendário da página', 'Nada a fazer: rodar scripts/anp_baixar.py e anp_parse.py após a data', PAG])
    else:
        motivo = 'A ANP só publica a ata depois de aprovada na reunião seguinte (RD 1.175/1.176: 26/01 e 13/02 → ata em 13/04; RD 1.178/1.179/1.181 → 28/05; RD 1.180/1.182–1.185, RDE 69/70 → 18/08)'
        if c['extraordinaria'] and c['numero'] == 71: motivo = 'Pauta reservada e reunião não transmitida; ata ainda não publicada (atas só saem após aprovação em reunião seguinte)'
        pend.append([AG, nome, c['data'], 'Realizada, ata aguardando publicação', existe, motivo, 'Rodar scripts/anp_baixar.py + anp_parse.py quando a ata aparecer em arquivos-rd-2026/ata-NNNN.pdf', PAG])
n_real = sum(1 for p_ in pend if p_[3].startswith('Realizada')); n_fut = sum(1 for p_ in pend if p_[3].startswith('Futura'))
chk('(e) Reuniões do calendário realizadas (data ≤ hoje) = atas lidas + pendências "Realizada" (nada fica sem destino)', sum(1 for c in cal if c['data'] <= hoje.isoformat() and not c['retomada']), len(R) + n_real, f'hoje={hoje}; pendências futuras: {n_fut}')
Qi = {'REV': sum(1 for v in V if v['proveniencia'] == 'REVISAR'), 'nom': sum(1 for v in V if v['proveniencia'] == 'nominal'), 'inf': sum(1 for v in V if v['proveniencia'] == 'inferido')}
cob = [[AG, 'Reuniões 2026 com ata lida', len(R), 'RD ' + str(lidas_o) + ' + RDE ' + str(sorted(r['_num'] for r in R if r['_ext']))],
       [AG, 'Reuniões realizadas sem ata (pendências)', n_real, ', '.join(p_[1] for p_ in pend if p_[3].startswith('Realizada'))],
       [AG, 'Reuniões futuras no calendário', n_fut, ', '.join(p_[1] for p_ in pend if p_[3].startswith('Futura'))],
       [AG, 'Itens lidos (deliberações, vistas e retiradas)', len(D), str(dict(collections.Counter(d['tipo_item'] for d in D)))],
       [AG, 'Itens por sessão', len(D), str(dict(collections.Counter(d['secao'] for d in D)))],
       [AG, 'Linhas de voto', len(V), f"nominal {Qi['nom']} ({100*Qi['nom']//len(V)}%), inferido {Qi['inf']}, REVISAR {Qi['REV']}"],
       [AG, 'Itens da Sessão Reservada com deliberação/voto na ata (incluídos)', sum(1 for d in D if 'Reservada' in d['secao']), 'a ata da ANP registra votos e decisão de itens da pauta reservada; entram com secao "Sessão Reservada" / "Pauta Reservada"'],
       [AG, 'Itens só da Sessão Reservada/informes sem deliberação (excluídos)', 0, 'a ata não traz item de informe: toda entrada "N. Processo:" tem decisão, vista ou retirada; REGISTROS (ordem da pauta, convites a técnicos, suspensões) não são itens'],
       [AG, 'Pautas baixadas (denominador para itens sem ata)', sum(1 for v in man.values() if v['tipo'] == 'pauta' and v['ok']), 'pautas das reuniões ainda sem ata servem de prova de existência; seus itens NÃO entram em deliberações']]
nf = [[AG, 'Atas das RD 1.186–1.191 e RDE 71', f'{n_real} reuniões realizadas sem ata', 'LIMITE DA FONTE', 'A ANP só publica a ata após a aprovação na reunião seguinte', 'Rodar anp_baixar.py/anp_parse.py quando publicarem'],
      [AG, 'Contador oficial via API Volto (items_total)', 'HTTP 404/401', 'LIMITE DA FONTE', 'Sem permissão REST anônima; substituído por calendário + links + listagem paginada da pasta', 'Reconferir se a ANP liberar a API'],
      [AG, 'Ausência temporária de diretor (ex.: RD 1.179: Symone Araújo 10h15, 15 min)', '1 ocorrência', 'NÃO FEITO', 'A ata não diz em qual item a ausência ocorreu; os votos nos itens 13/14 da extrapauta seguem o texto da própria decisão', 'Cruzar com a gravação (YouTube)'],
      [AG, 'Posição individual nos votos escritos (alternativos/divergentes)', 'votos "incluídos no processo"', 'LIMITE DA FONTE', 'A ata cita que o voto escrito foi incluído no processo SEI, mas não o reproduz', 'Pedir à ANP / consultar o SEI'],
      [AG, 'Voto de diretor em vista (ex.: "sem prejuízo de reavaliação")', 'itens com vista', 'FEITO (parcial)', 'Votos antes da vista registrados como "VOTOU (antes da vista)"; quem divergiu de forma explícita fica DIVERGIU; demais "SEM VOTO AINDA"', 'Revisar quando o item retornar'],
      [AG, 'Decisões compostas (I/II/III)', f"{sum(1 for d in D if 'decisão composta' in d['resultado'])} itens", 'LIMITE DO MODELO', 'O resultado guarda a 1ª ação; as demais estão em decisao_texto', 'Listar todas as ações'],
      [AG, 'Interessado do item', 'heurística', 'LIMITE', 'A ata não tem campo "interessado"; extraído do texto do assunto (regex) ou, na falta, a sigla da unidade autora', 'Revisar manualmente se for usado'],
      [AG, 'Itens do 2º dia da RD 1.179 (retomada 02/04)', 'sufixo R no id', 'DESENHO', 'A RD 1.179 foi suspensa e retomada: o mesmo processo aparece 2 vezes (REG-4 em 27/03 com vista; REG-4R em 02/04 decidido); ids com sufixo R, data 2026-04-02', '']]
print(len(R), 'reunioes', len(D), 'itens', len(V), 'votos', dict(collections.Counter(d['tipo_item'] for d in D)), '| % nominal', round(100 * Qi['nom'] / len(V), 1))
for q in Q: print(q[4], '|', q[1][:110], '|', q[2], q[3])
json.dump({'reunioes': [{k: v for k, v in r.items() if not k.startswith('_')} for r in R], 'deliberacoes': D, 'votos': V, 'qualidade': Q, 'cobertura': cob, 'pendencias': pend, 'nao_feito': nf,
           'diretores': NOMES, 'colegiado': 'Diretoria Colegiada', '_fonte': {'pagina': PAG, 'api': inv['api'], 'pasta_arquivos': len(inv['pasta_arquivos']), 'calendario': [c['tag'] for c in cal]}},
          open(out_path, 'w'), ensure_ascii=False, indent=1)
