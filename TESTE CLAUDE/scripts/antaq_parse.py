"""ANTAQ: parser das Atas de Reuniao de Diretoria (ROD/RED) de 2026 -> antaq.json
(reunioes/deliberacoes/votos + qualidade/cobertura/pendencias/nao_feito). Mesmo formato de anpd.json/anvisa.json.
Uso: python3 -I scripts/antaq_parse.py manifesto_antaq.json antaq.json   (le antaq_inventario.json, fonte/antaq/, texto_antaq/)

Fontes (todas publicas):
  - Atas (Externa = materias finalisticas; Interna = materias administrativas) no acervo Sophia (via Chromium) e, para ROD610/615, tambem no gov.br;
  - Pautas (Sophia) e pagina 'Resultado das Reunioes Virtuais' (gov.br) = denominadores INDEPENDENTES do texto das atas;
  - Calendarios semestrais (gov.br; o 2o e imagem -> OCR) e registros 'Acordao N/2026' do Sophia = contadores independentes.
Os votos dos demais diretores NAO estao na ata: relator/vencido/impedido/ausente/revisor sao NOMINAIS (quorum do acordao);
'ACOMPANHOU' e INFERIDO (nenhuma divergencia registrada no item 7 do acordao)."""
import re, sys, json, os, subprocess, unicodedata, html, collections, datetime
man = json.load(open(sys.argv[1])); out = sys.argv[2]
inv = json.load(open('antaq_inventario.json'))
HOJE = datetime.date.today()
AG = 'ANTAQ'
ROST = [('Frederico Carvalho Dias', r'frederico'), ('Wilson Pereira de Lima Filho', r'lima filho'), ('Alber Furtado de Vasconcelos Neto', r'alber'),
        ('Caio César Farias Leôncio', r'caio'), ('Flávia Morais Takafashi', r'fl[aá]via|takafashi'), ('Cristina Castro Lucas de Souza', r'cristina'),
        ('Alexandre Palmieri Florambel', r'alexandre|florambel')]
MES = {'janeiro': 1, 'fevereiro': 2, 'marco': 3, 'abril': 4, 'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12}
PROC = r'\d{5}\.\d{6}/\d{4}-\d{2}'
P5 = r'\d{5}\.\d{6}'
def norm(s): return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
def quem(t):
    """nomes completos na ORDEM em que aparecem no texto"""
    t = norm(t); ach = []
    for n, p in ROST:
        m = re.search(p, t)
        if m: ach.append((m.start(), n))
    return [n for _, n in sorted(ach)]
def quem_papeis(t):
    """[(nome, papel)] ; papel = texto entre parenteses logo apos o nome (sem outro diretor no meio)"""
    tn = norm(t); res = []
    for n, p in ROST:
        m = re.search(p, tn)
        if not m: continue
        pm = re.match(r'([^(),;]{0,40}?)\(([^)]*)\)', t[m.end():m.end() + 70])
        pap = pm[2] if pm and not quem(pm[1]) else ''
        res.append((m.start(), n, pap))
    return [(n, p) for _, n, p in sorted(res)]
def dtiso(d, m, a): return f'{int(a):04d}-{MES[norm(m)]:02d}-{int(d):02d}'
RUIDO = [re.compile(p) for p in (r'^\s*https://sei\.antaq\.gov\.br/\S*.*\d+/\d+\s*$', r'^\s*\d\d/\d\d/\d{4}, \d\d:\d\d\s+SEI/ANTAQ.*$', r'^.*Ata de Reuni[ãa]o de Diretoria\s+DRCP\s+\d+\s+SEI.*pg\.\s*\d+\s*$',
                          r'^\s*Pauta de Reuni[ãa]o de Diretoria\s+DRCP.*$', r'^\s*Refer[êe]ncia: Processo n.*SEI n.*$')]
def limpa(t):
    t = re.sub(r'[\u200b\u202f\ufeff\xa0]', ' ', t)
    L, pular = t.replace('\f', '\n').split('\n'), False; o = []
    for ln in L:
        if any(r.match(ln) for r in RUIDO): pular = True; continue
        if pular and not ln.strip(): pular = False; continue
        pular = False; o.append(ln)
    t = '\n'.join(o)
    return re.sub(r'(?<=\d)-\s*\n\s*(?=\d\d\b)', '-', t)
def pdftxt(arq, saida):
    if not os.path.exists(saida):
        os.makedirs(os.path.dirname(saida), exist_ok=True)
        open(saida, 'w', encoding='utf8').write(subprocess.run(['pdftotext', '-layout', arq, '-'], capture_output=True).stdout.decode('utf8', 'ignore'))
    return open(saida, encoding='utf8').read()
HEAD_UP = re.compile(r'^\s*(ACÓRDÃOS? APROVADOS?|PROCESSOS RETIRADOS DE PAUTA|PEDIDOS DE VISTA|PROSSEGUIMENTOS? DE VOTAÇÃO|REABERTURAS? DE DISCUSSÃO|HOMOLOGAÇÃO DE ATAS|COMUNICAÇÕES|SUSTENTAÇÕES ORAIS|PUBLICAÇÃO DAS? ATAS? NA INTERNET|ENCERRAMENTO)\s*$')
def secoes(t):
    s, cur = collections.defaultdict(list), 'CABECALHO'
    for ln in t.split('\n'):
        m = HEAD_UP.match(ln)
        if m: cur = re.sub(r'S?\b$', '', m[1]) if False else m[1]; continue
        s[cur].append(ln)
    return {k: '\n'.join(v) for k, v in s.items()}
def plano(x): return re.sub(r'\s+', ' ', x).strip()

# ---------------------------------------------------------------- atas (Sophia): texto
atas = {}   # tag -> {'ext':texto,'int':texto,'govbr':texto}
for k, v in man.items():
    if v.get('fonte') == 'sophia' and v.get('ok') and k.startswith('sophia:'):
        tag = v['reuniao']; ext = 'Externa' in v['titulo']
        t = pdftxt(v['arquivo'], f'texto_antaq/{tag}_{"externa" if ext else "interna"}.txt')
        atas.setdefault(tag, {})['ext' if ext else 'int'] = limpa(t)
for k, v in man.items():
    if k.startswith('govbr:AtaROD') and v.get('ok'):
        tag = k[len('govbr:Ata'):-4]; atas.setdefault(tag, {})['govbr'] = limpa(pdftxt(v['arquivo'], f'texto_antaq/govbr_{tag}.txt'))
def cab(t):
    h = plano(t[:3500]); r = {}
    m = re.search(r'REALIZADA (?:ENTRE (\d+) (?:E|e|A|a) (\d+) DE (\w+) DE (\d{4})|EM (?:EM )?(\d+) DE (\w+) DE (\d{4}))', h, re.I)
    if m:
        if m[1]: r['ini'], r['fim'] = dtiso(m[1], m[3], m[4]), dtiso(m[2], m[3], m[4])
        else: r['ini'] = r['fim'] = dtiso(m[5], m[6], m[7])
    m = re.search(r'Diretoria Colegiada da (?:ANTAQ|Antaq) de n[ºo°] (\d+)', h); r['num'] = int(m[1]) if m else None
    m = re.search(r'sob a presid[êe]ncia d[oa] (?:Diretor(?:a)?-Geral(?:[- ]Substitut[oa])?|Diretor(?:a)?(?:[- ]Substitut[oa])?) (.*?), foi', h); r['presidente'] = (quem(m[1]) or [None])[0] if m else None
    m = re.search(r'com a participa[çc][ãa]o (.*?)(?:, d[oa] Secret[áa]rio|, do Secret)', h); r['participantes'] = quem(m[1]) if m else []
    if r['presidente'] and r['presidente'] not in r['participantes']: r['participantes'].insert(0, r['presidente'])
    m = re.search(r'Ausentes? (?:o|a|os|as) Diretor[^.]*\.', plano(t[:6000])); r['ausentes'] = quem(m[0]) if m else []
    r['ausente_txt'] = m[0] if m else ''
    return r
ACORD = re.compile(r'\n[ \t]*AC[ÓO]RD[ÃA]O N[ºo°]\s*(\d+)\s*[-–/]\s*(\d{4})\s*[-–/]\s*ANTAQ[ \t]*(?=\n\s*1\.\s*Processo)', re.I)
def blocos(t, tag, origem):
    partes = ACORD.split('\n' + t); res = []
    for i in range(1, len(partes), 3):
        num, ano, corpo = int(partes[i]), int(partes[i + 1]), partes[i + 2]
        # corta no que vem depois do quorum (encerramento/secoes)
        m7 = re.search(r'7\.\s*Especifica[çc][ãa]o do qu[óo]rum:', corpo)
        if m7:
            tail = corpo[m7.end():]; fim = re.search(r'\n[ \t]*\n[ \t]*(?!7\.\d)\S', tail)
            qtxt = tail[:fim.start()] if fim else tail
            corpo_u = corpo[:m7.end()] + qtxt
        else: qtxt, corpo_u = '', corpo
        res.append({'num': num, 'ano': ano, 'corpo': corpo_u, 'q': qtxt, 'reuniao': tag, 'origem': origem})
    return res
def campos(b):
    c = re.sub(r'(?<=[a-zA-ZÀ-ú])-[ \t]*\n[ \t]*(?=[a-zà-ú])', '-', b['corpo']); flat = plano(c)
    g = lambda p: (re.search(p, flat) or [None, ''])[1].strip()
    d = {'num': b['num'], 'ano': b['ano'], 'origem': b['origem']}
    d['processo'] = (re.search(r'1\.\s*Processo:\s*(' + PROC + ')', flat) or [None, ''])[1]
    d['processos_corpo'] = list(dict.fromkeys(re.findall(r'1\.\s*Processos?:\s*(' + PROC + ')', flat)))
    d['interessado'] = g(r'2\.\s*Interessad[oa]s?:\s*(.*?)\s*3\.\s*(?:Relator|Redator)')
    rl = re.search(r'3\.\s*(Relatora?|Redator[a]?):\s*(.*?)\s*(?:3\.1\.|4\.)', flat)
    d['relator_txt'] = rl[2].strip() if rl else ''; d['relator'] = (quem(rl[2]) or [None])[0] if rl else None
    rv = re.search(r'3\.1\.\s*(Revisora?|Redator[a]?):\s*(.*?)\s*4\.', flat); d['revisor'] = (quem(rv[2]) or [None])[0] if rv else None; d['papel31'] = rv[1] if rv else ''
    d['unidade'] = g(r'4\.\s*Unidades? T[ée]cnicas?:\s*(.*?)\s*5\.\s*Ac[óo]rd[ãa]o')
    m = re.search(r'VISTOS, relatados e discutidos (.*?)\s*ACORDAM', flat)
    ass = m[1] if m else ''
    ass = re.sub(r'^os presentes autos,?\s*', '', ass)
    ass = re.sub(r'^(?:sobre|acerca d[aeo]s?)\s+', '', ass)
    ass = re.sub(r'^(?:de\s+)?(?:que\s+)?(?:tratam|trata|versam|versa|referem-se|referentes?|relativos?|relativas?|concernentes?)\s*(?:ao?s?\s+|de\s+|d[aeo]s?\s+|sobre\s+)?', '', ass).strip(' ,;')
    ass = re.sub(r'^(?:de|d[aeo]s?)\s+(?=\w)', '', ass) if not re.match(r'^d[aeo]s?\s+(?:Rep[uú]blica|Uni[ãa]o)', ass) else ass
    if ass.endswith('.') and not re.search(r'[A-Z]\.$', ass[-3:]): ass = ass.rstrip('.')
    d['assunto'] = ass[:600]
    m = re.search(r'ACORDAM (.*?)(?:\s+6\.\s*Data da Reuni[ãa]o)', flat)
    disp = m[1] if m else ''
    d['dispositivo'] = disp
    d['disp_5x'] = re.sub(r'^.*?ante as raz[õo]es expostas pel[oa]s? [A-Za-zÀ-ú ]+?,\s*(?:em\s*:?\s*)?', '', disp, count=1)
    m = re.search(r'6\.\s*Data da Reuni[ãa]o:\s*(.*?)\s*7\.\s*Especifica', flat); d['data_txt'] = m[1].strip() if m else ''
    d['voto_doc'] = (re.search(r'Voto (?:SEI )?(?:n[ºo]\s*)?(\d{6,8})', flat) or [None, ''])[1]
    # quorum 7.x
    qs = [(m[1], plano(m[2])) for m in re.finditer(r'7\.(\d+)\.?\s+(.*?)(?=\n\s*7\.\d+\.?\s|\Z)', b['q'], re.S)]
    d['q'] = {}
    for n, tx in qs:
        if re.match(r'Diretor(?:es|a|as)? presentes?:', tx):
            d['q']['presentes'] = quem_papeis(tx.split(':', 1)[1]); d['q']['presentes_txt'] = tx
        elif re.search(r'voto vencido', tx, re.I): d['q'].setdefault('vencidos', []).extend(quem(tx.split(':', 1)[1]))
        elif re.search(r'(?:alegou|declarou|declarou-se|arguiu).{0,20}(?:impedimento|suspei)', tx, re.I): d['q'].setdefault('impedidos', []).extend(quem(tx.split(':', 1)[1]))
        elif re.search(r'n[ãa]o participou da vota', tx, re.I):
            d['q'].setdefault('nao_votou', []).extend(quem(tx.split(':', 1)[1])); d['q']['nao_votou_legal'] = bool(re.search(r'afastamento legal', tx, re.I))
        elif re.search(r'votou em', tx, re.I):
            d['q'].setdefault('votou_antes', []).extend(quem(tx.split(':', 1)[1])); d['q']['votou_antes_txt'] = tx
        else: d['q'].setdefault('nao_classificado', []).append(tx)
    return d

R, D, V = [], [], []
blks = {}         # tag -> lista de dicts (acordaos)
cab_ata = {}
sec_ata = {}
for tag in sorted(atas):
    a = atas[tag]
    if 'ext' not in a and 'govbr' not in a: continue
    c = cab(a.get('ext') or a['govbr']); cab_ata[tag] = c
    if not c.get('ini') or not c['ini'].startswith('2026'): continue   # ROD600/601 (dez/2025) sao rotulados "/2026" no Sophia
    lst = []
    for origem in ('ext', 'int'):
        if origem in a: lst += [campos(b) for b in blocos(a[origem], tag, 'externa' if origem == 'ext' else 'interna')]
    blks[tag] = lst
    sec_ata[tag] = {o: secoes(a[o]) for o in ('ext', 'int') if o in a}
TAGS = sorted(blks, key=lambda x: int(x[3:]))

# ---------------------------------------------------------------- pautas (Sophia) e resultados virtuais (gov.br)
def parse_pauta(t):
    t = limpa(t); itens = {}; rel = None
    for ln in t.split('\n'):
        m = re.match(r'^\s*RELATOR(A)?:\s*(.*?):?\s*$', ln)
        if m: rel = (quem(m[2]) or [None])[0]; continue
    # percorre item a item
    L = [x for x in t.split('\n')]
    rel = None; cur = None
    for ln in L:
        m = re.match(r'^\s*RELATOR(?:A)?:\s*(.*?):?\s*$', ln)
        if m: rel = (quem(m[1]) or [None])[0]; cur = None; continue
        m = re.match(r'^\s*(\d+)\.\s*(' + PROC + r')?\s*(?:\([^)]*\))?\s*$', ln)
        if m and m[2]: cur = {'item': int(m[1]), 'processo': m[2], 'relator': rel, 'txt': []}; itens[m[2]] = cur; continue
        m = re.match(r'^\s*(\d+)\.\s*$', ln)
        if m: cur = {'item': int(m[1]), 'processo': None, 'relator': rel, 'txt': []}; continue
        if cur is not None:
            mp = re.match(r'^\s*(' + PROC + r')\s*$', ln)
            if mp and cur['processo'] is None: cur['processo'] = mp[1]; itens[mp[1]] = cur; continue
            cur['txt'].append(ln)
    for it in itens.values():
        x = plano(' '.join(it['txt'])); it['tipo'] = (re.search(r'Tipo:\s*(.*?)\s*(?:Interessad|Contextualiza|$)', x) or [None, ''])[1].strip()
        it['interessado'] = (re.search(r'Interessad[oa]s?:\s*(.*?)\s*Contextualiza', x) or [None, ''])[1].strip()
        it['ctx'] = (re.search(r'Contextualiza[çc][ãa]o:\s*(.*?)(?:Resultado:|$)', x) or [None, ''])[1].strip()
        it['resultado_pauta'] = (re.search(r'Resultado:\s*(\S.*)$', x) or [None, ''])[1].strip(); del it['txt']
    return itens
pauta = {}
for k, v in man.items():
    if k.startswith('sophia_pauta:') and v.get('ok') and v['reuniao'] not in pauta and 'Interna' not in v['titulo']:
        t = pdftxt(v['arquivo'], f'texto_antaq/pauta_{v["reuniao"]}.txt'); pauta[v['reuniao']] = parse_pauta(t)
for pn in ('PautaROD602', 'PautaROD608', 'PautaROD601'):
    k = f'govbr:{pn}.pdf'
    if k in man and man[k].get('ok'): pauta.setdefault('govbr_' + pn[5:], parse_pauta(pdftxt(man[k]['arquivo'], f'texto_antaq/govbr_{pn}.txt')))
def parse_virtuais():
    h = open('fonte/antaq/govbr/virtuais.html', encoding='utf8').read()
    hs = [(m.start(), html.unescape(m[1]).strip()) for m in re.finditer(r'<a class="toggle[^"]*" href="[^"]*">([^<]*)</a>', h)]
    res = {}
    for k, (p, tt) in enumerate(hs):
        mm = re.match(r'(\d+)ª Reunião Ordinária Virtual', tt)
        if not mm: continue
        seg = h[p:hs[k + 1][0] if k + 1 < len(hs) else len(h)]
        per = (re.search(r'Per[íi]odo:\s*(?:14h de )?(\d\d/\d\d/\d{4})', seg) or [None, None])[1]
        if not per or not per.endswith('2026'): continue
        tx = html.unescape(re.sub(r'<[^>]+>', '\n', seg)); tx = re.sub(r'[ \t\u200b\xa0\u202f]+', ' ', tx)
        L = [l.strip() for l in tx.split('\n') if l.strip()]
        itens, rel, cur, adref = {}, None, None, False
        i = 0
        while i < len(L):
            l = L[i]
            if re.match(r'PROCESSOS AD REFERENDUM', l, re.I): adref = True
            elif re.match(r'PROCESSOS DE RELATORIA', l, re.I): adref = False
            m = re.match(r'RELATOR(?:A)?: ?(.*?):?$', l)
            if m: rel = (quem(m[1]) or [None])[0]
            else:
                m = re.match(r'^(\d+)\.\s*(' + PROC + r')?', l)
                if m and not m[2] and i + 1 < len(L) and re.match(r'^' + PROC, L[i + 1]): m = (None, m[1], re.match(PROC, L[i + 1])[0]); i += 1
                if m and m[2]: cur = {'item': int(m[1]), 'processo': m[2], 'relator': rel, 'adreferendum': adref, 'tipo': '', 'interessado': '', 'ctx': '', 'resultado': ''}; itens.setdefault(m[2], cur)
                elif cur is not None:
                    for ch, pat in (('tipo', r'Tipo:\s*(.*)'), ('interessado', r'Interessad[oa]s?:\s*(.*)'), ('ctx', r'Contextualiza[çc][ãa]o:\s*(.*)')):
                        mm2 = re.match(pat, l)
                        if mm2: cur[ch] = mm2[1].strip()
                    mr = re.match(r'^Resultado\s*:?\s*(.*)$', l)
                    if mr:
                        val = mr[1].strip()
                        j = i + 1
                        while not val and j < len(L) and j < i + 4:
                            if L[j] != ':' and not re.match(r'^(\d+\.|' + PROC + r'|RELATOR|PROCESSO)', L[j]): val = L[j]; break
                            if L[j] != ':': break
                            j += 1
                        cur['resultado'] = val
                    elif cur['ctx'] and not cur['resultado']:
                        mr2 = re.search(r'Resultado\s*:\s*(\S.*)$', l)
                        if mr2: cur['resultado'] = mr2[1]
            i += 1
        # link do SEI (processo de votacao) de cada item: o href que aparece entre o inicio do item e o inicio do proximo
        hs_ = seg.replace('&amp;', '&')
        ini_ = [(m_.start(), m_[2]) for m_ in re.finditer(r'(\d+)\.\s*(?:</?[^>]+>|\s|&nbsp;)*(' + PROC + ')', hs_)]
        for j_, (pos_, pr_) in enumerate(ini_):
            fim_ = ini_[j_ + 1][0] if j_ + 1 < len(ini_) else len(hs_)
            lk_ = re.findall(r'href="(https://sei\.antaq\.gov\.br/sei/modulos/pesquisa/md_pesq_processo_exibir\.php[^"]+)"', hs_[pos_:fim_])
            if pr_ in itens and lk_ and not itens[pr_].get('sei_url'): itens[pr_]['sei_url'] = lk_[0]
        n_res = sum(1 for l in L if re.match(r'^Resultado\s*:?', l))
        res['ROD' + mm[1]] = {'periodo_ini': per, 'itens': itens, 'n_resultado_linhas': n_res, 'n_itens': len(itens)}
    return res
virt = parse_virtuais()
for k, v in virt.items():
    for p, it in v['itens'].items():
        it['resultado'] = re.sub(r'^[:\s]+', '', it['resultado'])

# ---------------------------------------------------------------- calendario semestral
def calendario():
    cal = {}
    t1 = open('texto_antaq/govbr_cal1.txt', encoding='utf8').read() if os.path.exists('texto_antaq/govbr_cal1.txt') else pdftxt(man['govbr:Calendrio12026vs2.pdf']['arquivo'], 'texto_antaq/govbr_cal1.txt')
    for m in re.finditer(r'(\d{3})ª\s+(\d\d/\d\d)(?:\s+a\s+(\d\d/\d\d))?\s+(virtual|telepresencial)', t1):
        cal['ROD' + m[1]] = {'ini': f'2026-{m[2][3:]}-{m[2][:2]}', 'fim': f'2026-{(m[3] or m[2])[3:]}-{(m[3] or m[2])[:2]}', 'mod': m[4], 'cancelada': False, 'fonte': 'Calendário 1º sem (gov.br, republicado em 13/05/2026)'}
    if re.search(r'609ª[^\n]*\n\s*\(Reuni[ãa]o cancelada\)', t1): cal['ROD609']['cancelada'] = True
    ocrf = 'texto_antaq/govbr_cal2_ocr.txt'
    if not os.path.exists(ocrf): subprocess.run(['python3', '-I', 'scripts/ocr_pdf.py', man['govbr:Calendrio2semestre2026.pdf']['arquivo'], ocrf])
    t2 = open(ocrf, encoding='utf8').read()
    # OCR lê "ª" como "a"/"2": datas na ordem do texto, ROD 613..625 em sequencia
    datas = re.findall(r'(\d\d/\d\d)(?:\s*a\s*(\d\d/\d\d))?', re.sub(r'2026|\[pg \d+\]', '', t2))
    mods = re.findall(r'(virtual|telepresencial)', t2)
    for i, ((a, b), mod) in enumerate(zip(datas, mods)):
        n = 613 + i
        cal[f'ROD{n}'] = {'ini': f'2026-{a[3:]}-{a[:2]}', 'fim': f'2026-{(b or a)[3:]}-{(b or a)[:2]}', 'mod': mod, 'cancelada': False, 'fonte': 'Calendário 2º sem (gov.br, imagem -> OCR; atualizado em 22/06/2026)'}
    cal['_ocr_n'] = len(datas)
    return cal
cal = calendario(); ocr_n = cal.pop('_ocr_n')

# ---------------------------------------------------------------- montagem: reunioes, deliberacoes, votos
def lista_nomes(ns): return ', '.join(ns)
ROT = ((r'^n[aã]o conhec', 'NÃO CONHECIDO'), (r'^conhec|^receb|^admit', 'CONHECIDO'), (r'^referend', 'REFERENDADO'), (r'^aprov\w*,? com ressalva', 'APROVADO COM RESSALVAS'), (r'^aprov', 'APROVADO'),
       (r'^indefer', 'INDEFERIDO'), (r'^defer', 'DEFERIDO'), (r'^neg\w+ (?:o )?provimento|^neg\w+-lhe provimento', 'PROVIMENTO NEGADO'), (r'^d\w+ (?:parcial )?provimento parcial|^d\w+ parcial provimento|parcial provimento', 'PROVIMENTO PARCIAL'),
       (r'^d\w+(?:-lhe)? provimento|^conced\w+ provimento', 'PROVIMENTO'), (r'^declar\w+ (?:a )?insubsist', 'AUTO DE INFRAÇÃO INSUBSISTENTE'), (r'^declar\w+ (?:a )?subsist|^julg\w+ subsist', 'AUTO DE INFRAÇÃO SUBSISTENTE'),
       (r'^declar\w+ (?:a )?perda|^declar\w+ que .{0,60}(?:prejudicad|perda (?:do|de) objeto)', 'PERDA DE OBJETO'), (r'^declar\w+ (?:a )?extin', 'EXTINTO'), (r'^(?:declar|d[aá])\w* (?:como |por )?(?:cumprid|cumprimento)|^reconhec\w+ o cumprimento', 'CUMPRIMENTO DECLARADO'),
       (r'^autoriz', 'AUTORIZADO'), (r'^rejeit', 'REJEITADO'), (r'^reconhec', 'RECONHECIDO'), (r'^conced', 'CONCEDIDO'), (r'^prorrog', 'PRORROGADO'), (r'^revog', 'REVOGADO'), (r'^retific', 'RETIFICADO'),
       (r'^design', 'DESIGNADO'), (r'^respond', 'CONSULTA RESPONDIDA'), (r'^manifestar-se favor', 'MANIFESTAÇÃO FAVORÁVEL'), (r'^convert\w+ o julgamento', 'CONVERTIDO EM DILIGÊNCIA'),
       (r'^aplic\w+ (?:a )?(?:multa|penalidade|san)', 'SANÇÃO APLICADA'), (r'^mant', 'MANTIDO'), (r'^suspend', 'SUSPENSO'), (r'^determin\w+ a suspens', 'SUSPENSO'), (r'^instaur|^abrir|^determin\w+ a abertura', 'PROCEDIMENTO INSTAURADO'),
       (r'^acolh', 'ACOLHIDO'), (r'^declar', 'DECLARADO'), (r'^homolog', 'HOMOLOGADO'), (r'^anuir|^dar anuência|^conced\w+ anuência', 'ANUÊNCIA'), (r'^restitu|^devolv', 'RESTITUÍDO'), (r'^extingu', 'EXTINTO'))
SECUND = ((r'^determin', 'DETERMINAÇÃO'), (r'^recomend', 'RECOMENDAÇÃO'), (r'^encaminh', 'ENCAMINHADO'), (r'^inform', 'INFORMADO'), (r'^consider\w+ .*encerrad|^encerr', 'ENCERRADO'),
          (r'^convert\w+ em definitiva', 'CAUTELAR CONVERTIDA EM DEFINITIVA'), (r'^reintegr|^incorpor', 'PROVIDÊNCIA PATRIMONIAL'), (r'^cientific|^dar ci[eê]ncia|^arquiv|^notific', 'CIENTIFICADA(S) AS PARTES'))
def _obj(c_, verbo):
    m = re.search(verbo + r'\w*\s+(?:parcialmente\s+)?(.{4,200})', c_, re.I)
    if not m or re.match(r'-?l[oa]s?\b', m[1]) : return ''
    o = re.split(r'[;,]| uma vez| por | haja vista| tendo em vista| considerando', m[1])[0].strip()
    o = re.sub(r'^(?:o|a|os|as)\s+', '', o)
    if len(o) > 90: o = o[:90].rsplit(' ', 1)[0]
    return (': ' + o) if len(o) > 3 else ''
def tag_resultado(disp):
    cl = [plano(c) for c in re.split(r'(?:(?<=^)|(?<=\s))5\.\d+(?:\.\d+)*\.\s+(?!\d)', disp) if c.strip()]
    if not cl: cl = [plano(disp)]
    tags, sec, defer = [], [], collections.Counter()
    def add(t):
        if t not in tags: tags.append(t)
    for c in cl:
        x = norm(c).strip(' :,;')
        x = re.sub(r'^(?:com fundamento|com base|nos termos|em face|tendo em vista|considerando)[^,]{0,200},\s*', '', x)
        usado = False
        if re.search(r'^conhec\w+ parcialmente', x): add('CONHECIDO PARCIALMENTE'); usado = True
        elif re.search(r'^n[aã]o conhec|^nao conhec', x): add('NÃO CONHECIDO'); usado = True
        elif re.search(r'^(?:conhec|receb|admit)', x): add('CONHECIDO'); usado = True
        elif re.search(r'^referend', x): add('REFERENDADO'); usado = True
        extras = []
        for pat, rot in ((r'\bneg\w+(?:-lhe)? (?:o )?provimento', 'MÉRITO: PROVIMENTO NEGADO'), (r'parcial provimento|provimento parcial', 'MÉRITO: PROVIMENTO PARCIAL'),
                         (r'\bd[aá]r?(?:-lhe| lhes)? (?:integral )?provimento|\bdar provimento|conced\w+ provimento', 'MÉRITO: PROVIMENTO'), (r'\breform\w+', 'DECISÃO REFORMADA'),
                         (r'rejeit\w+ (?:os )?embargos', 'EMBARGOS REJEITADOS'), (r'acolh\w+ (?:os )?embargos', 'EMBARGOS ACOLHIDOS'), (r'inexistencia de obices', 'INEXISTÊNCIA DE ÓBICES DECLARADA'),
                         (r'arquiv', 'ARQUIVADO')):
            m_ = re.search(pat, x)
            if m_: extras.append((m_.start(), rot))
        if re.search(r'\breform\w+ parcialmente|parcialmente (?:a )?decis', x): extras = [(p_, 'DECISÃO REFORMADA PARCIALMENTE' if r_ == 'DECISÃO REFORMADA' else r_) for p_, r_ in extras]
        for pat, base in ((r'indefer', 'INDEFERIDO'), (r'(?<!in)defer', 'DEFERIDO')):
            for m_ in re.finditer(pat, x):
                ob = _obj(c, 'indefer' if base == 'INDEFERIDO' else r'(?<!in)defer')
                extras.append((m_.start(), base + ob)); defer[base + ob] += 1; break
        if any(r_ == 'MÉRITO: PROVIMENTO PARCIAL' for _, r_ in extras): extras = [(p_, r_) for p_, r_ in extras if r_ != 'MÉRITO: PROVIMENTO']
        for _, r_ in sorted(extras): add(r_); usado = True
        if not usado:
            neg_ = bool(re.match(r'^n[aã]o (?:reconhec|acolh|aprov|autoriz)', x)); x2 = re.sub(r'^n[aã]o ', '', x) if neg_ else x
            for pat, rot in ROT:
                if re.search(pat, x2):
                    add(('NÃO ' + rot) if neg_ else rot); usado = True; break
        if not usado:
            for pat, rot in SECUND:
                if re.search(pat, x):
                    if rot not in sec: sec.append(rot)
                    break
    if not tags: tags = sec[:2]
    # varios pedidos deferidos/indeferidos sem objeto identificavel: indicar a quantidade
    out = []
    for t in tags[:5]: out.append(t + (f' ({defer[t]} pedidos)' if defer.get(t, 0) > 1 else ''))
    return '; '.join(out) if out else 'DECIDIDO'
AUS_MOT = {}
def aus_label(n, tag=None):
    m = AUS_MOT.get(tag or CUR_TAG[0], {})
    if n in m: return m[n]
    return 'AUSENTE (não consta entre os presentes do acórdão, item 7.1)'
CUR_TAG = [None]
def voto_linhas(tag, ac, presentes_reuniao, roster):
    """1 linha por diretor: roster da reuniao U quorum do acordao"""
    q = ac['q']; pres = [n for n, _ in q.get('presentes', [])]; papeis = dict(q.get('presentes', []))
    pessoas = list(dict.fromkeys(roster + pres + q.get('vencidos', []) + q.get('impedidos', []) + q.get('nao_votou', []) + q.get('votou_antes', []) + ([ac['relator']] if ac['relator'] else []) + ([ac['revisor']] if ac['revisor'] else [])))
    rel, rev = ac['relator'], ac['revisor']; venc, imp, nv, ant = q.get('vencidos', []), q.get('impedidos', []), q.get('nao_votou', []), q.get('votou_antes', [])
    out = []
    for n in pessoas:
        if n in imp: v, pv = 'IMPEDIDO (alegou impedimento)', 'nominal'
        elif n in nv: v, pv = ('AUSENTE (não participou da votação; afastamento legal)' if q.get('nao_votou_legal') else 'AUSENTE (não participou da votação)'), 'nominal'
        elif n == rel and n in venc: v, pv = 'RELATOR (voto vencido' + ('; votou antes do pedido de vista' if n in ant else '') + ')', 'nominal'
        elif n == rel: v, pv = 'RELATOR (voto proferido)', ('nominal' if (n in pres or n in ant) else 'REVISAR')
        elif n in venc: v, pv = 'DIVERGIU (voto vencido)', 'nominal'
        elif n == rev: v, pv = ('REDATOR (voto proferido)' if ac['papel31'].lower().startswith('redator') else 'REVISOR (voto proferido)'), 'nominal'
        elif n in ant: v, pv = 'VOTOU ANTES (pedido de vista)', 'nominal'
        elif n in pres: v, pv = 'ACOMPANHOU', 'inferido'
        else: v, pv = aus_label(n), 'nominal'
        out.append((n, v, pv))
    return out
def acha_pauta(tag, p):
    for tg2 in [tag] + sorted(pauta, reverse=True):
        x = pauta.get(tg2, {}).get(p)
        if x and x.get('interessado'): return x
    for tg2 in [tag] + sorted(virt, reverse=True):
        x = virt.get(tg2, {}).get('itens', {}).get(p)
        if x and x.get('interessado'): return x
    return None
chaves = set()
def add_d(d, v):
    k = (d['reuniao'], d['processo'], d['deliberacao'])
    if k in chaves: d['_dup'] = True
    chaves.add(k); D.append(d)
    for n, vt, pv in v: V.append({'reuniao': d['reuniao'], 'data': d['data'], 'processo': d['processo'], 'deliberacao': d['deliberacao'], 'diretor': n, 'voto': vt, 'proveniencia': pv})
meta_r = {}
for tag in TAGS:
    c = cab_ata[tag]; ac_l = blks[tag]
    num = int(tag[3:]); cc = cal.get(tag, {})
    modal = (re.search(r'-\s*(Virtual|Telepresencial|Presencial)', ' '.join(a['data_txt'] for a in ac_l)) or [None, ''])[1] or cc.get('mod', '').capitalize()
    ini, fim = c['ini'], c['fim']
    pres = c['participantes']; aus = c['ausentes']
    roster = list(dict.fromkeys(pres + aus))
    AUS_MOT[tag] = {n: ('AUSENTE (não participou da votação; afastamento legal)' if 'afastamento legal' in c['ausente_txt'] else 'AUSENTE (ausente na abertura da reunião)') for n in aus}; CUR_TAG[0] = tag
    meta_r[tag] = {'ini': ini, 'fim': fim, 'roster': roster, 'pres': pres, 'aus': aus, 'modal': modal, 'num': num}
    per = f'{ini[8:]}/{ini[5:7]} a {fim[8:]}/{fim[5:7]}/2026' if fim != ini else f'{ini[8:]}/{ini[5:7]}/2026'
    obs = '' if 'int' in atas[tag] else 'Só a ata Externa foi localizada (a Interna não consta no Sophia)'
    R.append({'reuniao': tag, 'titulo': f'{num}ª Reunião Ordinária da Diretoria Colegiada da ANTAQ ({modal}, {per})', 'tipo': 'Ordinária (ROD)', 'data': ini, 'presentes': pres, 'ausentes': aus, 'obs': obs})
    base = {'reuniao': tag, 'data': ini}
    # --- acordaos
    for ac in sorted(ac_l, key=lambda x: x['num']):
        q = ac['q']; venc = q.get('vencidos', [])
        tg = tag_resultado(ac['disp_5x'])
        res = tg + (' — POR MAIORIA (vencido: ' + lista_nomes(venc) + ')' if venc else ' — sem voto vencido registrado na ata (item 7.2 vazio)')
        if q.get('impedidos'): res += f' [impedido: {lista_nomes(q["impedidos"])}]'
        d = dict(base, processo=ac['processo'], deliberacao=f'Acórdão {ac["num"]}-2026', item_n=str(ac['num']), relator=ac['relator'], interessado=ac['interessado'], assunto=ac['assunto'], resultado=res, voto_doc=ac['voto_doc'],
                 decisao_texto=ac['disp_5x'][:1500], tipo_item='Deliberação', secao='Acórdãos aprovados (ata ' + ac['origem'] + ')', unidade=ac['unidade'])
        d['revisor'] = ac['revisor']; d['origem_ata'] = ac['origem']
        add_d(d, voto_linhas(tag, ac, pres, roster))
    # --- retirados / vistas / homologacao
    ja = {(ac['processo']) for ac in ac_l}
    for o, S in sec_ata[tag].items():
        og = 'externa' if o == 'ext' else 'interna'
        # retirados
        tx = plano(S.get('PROCESSOS RETIRADOS DE PAUTA', ''))
        for m in re.finditer(r'-\s*((?:' + PROC + r'(?:,\s*|\s+e\s+|\s+))+?)\s*,?\s*de relatoria d[oa]s? (.*?)(?=;|\.\s|\s-\s' + P5 + r'|$)', tx):
            procs = re.findall(PROC, m[1]); rel = (quem(m[2]) or [None])[0]
            for p in procs:
                pa = acha_pauta(tag, p)
                d = dict(base, processo=p, deliberacao='Retirada de pauta', item_n='', relator=rel, interessado=(pa or {}).get('interessado', ''), assunto=(pa or {}).get('ctx', '')[:600], resultado='RETIRADO DE PAUTA', voto_doc='',
                         decisao_texto=f'Retirado de pauta (ata {og}), relatoria: {rel}', tipo_item='Retirada de pauta', secao='Processos retirados de pauta (ata ' + og + ')', unidade='')
                if (tag, p, 'Retirada de pauta') in chaves: continue
                add_d(d, [(n, 'SEM VOTO (retirado de pauta)', 'nominal') for n in pres] + [(n, aus_label(n, tag), 'nominal') for n in aus])
        # vistas (pedidos novos e renovacoes)
        for sec in ('PEDIDOS DE VISTA', 'REABERTURAS DE DISCUSSÃO'):
            tx = S.get(sec, '')
            if not tx: continue
            tx = plano(tx)
            if sec == 'REABERTURAS DE DISCUSSÃO': tx = tx.split('foi reaberta a discuss')[0]
            partes = re.split(r'(?:(?<=\s)|^)-\s+(?=' + P5 + r')|(?<=\.)\s+(?=O processo n)|processo n[ºo]\s*(?=' + P5 + r')', tx)
            for pt in partes:
                procs = list(dict.fromkeys(re.findall(PROC, pt)))
                if not procs or not re.search(r'vista', pt, re.I): continue
                mr = re.search(r'relatoria d[oa]s? (?:Diretor(?:a)?(?:-Geral)?(?: Substitut[oa])?) ([^,.]+)', pt); rel = (quem(mr[1]) if mr else [None])[0] if mr else None
                mv = re.search(r'(?:de )?pedidos? de vista formulados? pel[oa]s? (.*?)(?: ap[óo]s| por ocasi| ou| Não| O Relator|\.|,)', pt) or re.search(r'vista formulados? pel[oa]s? (.*?)(?: ap[óo]s| por ocasi| Não| O Relator|\.|,)', pt)
                vistantes = quem(mv[1]) if mv else []
                nvoto = 'Não houve adiantamento de votos' in pt
                relvotou = bool(re.search(r'(?:Relator|Relatora) proferi|após o Relator|após a Relatora', pt))
                ocas = (re.search(r'por ocasi[ãa]o da Reuni[ãa]o n[ºo] (\d+)', pt) or [None, ''])[1]
                renov = sec == 'REABERTURAS DE DISCUSSÃO'
                for p in procs:
                    pa = acha_pauta(tag, p)
                    dlb = 'Pedido de vista (renovado)' if renov else 'Pedido de vista'
                    if (tag, p, dlb) in chaves: continue
                    d = dict(base, processo=p, deliberacao=dlb, item_n='', relator=rel, interessado=(pa or {}).get('interessado', ''), assunto=(pa or {}).get('ctx', '')[:600],
                             resultado='SOBRESTADO — vista concedida a ' + (lista_nomes(vistantes) or '?') + (' (renovação; pedido original na Reunião ' + ocas + ')' if renov and ocas else ''), voto_doc='',
                             decisao_texto=pt[:1000], tipo_item='Vista', secao=sec.capitalize() + ' (ata ' + og + ')', unidade='')
                    vl = []
                    for n in pres:
                        if n in vistantes: vl.append((n, 'PEDIU VISTA', 'nominal'))
                        elif n == rel: vl.append((n, 'RELATOR (voto proferido; vista concedida)' if relvotou else 'RELATOR (relatou; sem voto — vista pendente)', 'nominal' if (relvotou or nvoto) else 'inferido'))
                        else: vl.append((n, 'SEM VOTO AINDA (vista pendente)', 'nominal' if nvoto else 'inferido'))
                    vl += [(n, aus_label(n, tag), 'nominal') for n in aus]
                    add_d(d, vl)
        # homologacao de atas
        tx = plano(S.get('HOMOLOGAÇÃO DE ATAS', ''))
        m = re.search(r'homologou as atas? referentes? [àa]s? Reuni[õo]es? (Ordin[áa]rias?|Extraordin[áa]rias?)(?: e (Ordin[áa]rias?|Extraordin[áa]rias?))? de n[ºo]s?\s*([\d,\se]+)', tx)
        if m:
            for nn in re.findall(r'\d+', m[3]):
                dlb = f'Homologação da ata da {nn}ª reunião'
                if (tag, f'ATA-ROD{nn}', dlb) in chaves: continue
                d = dict(base, processo=f'ATA-ROD{nn}', deliberacao=dlb, item_n='', relator=None, interessado='Diretoria Colegiada', assunto=f'Homologação da ata da {nn}ª Reunião', resultado='ATA HOMOLOGADA', voto_doc='', decisao_texto=tx[:400],
                         tipo_item='Aprovação de ata', secao='Homologação de atas (ata ' + og + ')', unidade='Secretaria-Geral')
                add_d(d, [(n, 'ACOMPANHOU', 'inferido') for n in pres] + [(n, aus_label(n, tag), 'nominal') for n in aus])
        if re.search(r'homologou', tx) and not m: D.append({'_erro': f'homologação não parseada em {tag}', 'reuniao': tag})
D = [d for d in D if '_erro' not in d]
# ---------------------------------------------------------------- SEI: declaracoes de voto (HTML publico) -> votos NOMINAIS dos demais diretores
INI = {'FD': 'Frederico Carvalho Dias', 'AV': 'Alber Furtado de Vasconcelos Neto', 'CF': 'Caio César Farias Leôncio', 'LF': 'Wilson Pereira de Lima Filho', 'CCS': 'Cristina Castro Lucas de Souza', 'FT': 'Flávia Morais Takafashi'}
sei = json.load(open('antaq_sei.json')) if os.path.exists('antaq_sei.json') else {}
def sei_texto(path):
    b = open(path, 'rb').read().decode('iso-8859-1')
    return html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', re.sub(r'<script.*?</script>|<style.*?</style>', '', b, flags=re.S)))).strip()
decls = []
for u, pg in sei.items():
    tg_ = 'ROD' + re.match(r'(\d+)', pg['reuniao'])[1]
    for ab in pg.get('abertos', []):
        if not ab.get('arquivo') or not os.path.exists(ab['arquivo']): continue
        t_ = sei_texto(ab['arquivo'])
        proc_ = (re.search(r'Processo\s*:\s*(' + PROC + ')', t_) or [None, ''])[1]
        aut_ = (quem((re.search(r'assinado eletronicamente por (.*?) ,', t_) or [None, ''])[1]) or [None])[0]
        corpo_ = (re.search(r'Contextualiza[çc][ãa]o\s*:(.*?)Documento assinado', t_) or [None, ''])[1]
        n_ = norm(corpo_)
        cl_ = 'ACOMPANHOU' if re.search(r'\bacompanho\b', n_) and not re.search(r'\bdiverg|\bdiscordo|nao acompanho', n_) else ('DIVERGIU' if re.search(r'\bdivirjo|\bdiscordo|nao acompanho|voto divergente', n_) else 'OUTRO')
        decls.append({'tag': tg_, 'proc': proc_, 'autor': aut_, 'cl': cl_, 'num': ab['num'], 'tipo': ab['tipo'], 'url': u})
url2item = {}
for t_, v_ in virt.items():
    for p_, it_ in v_['itens'].items():
        if it_.get('sei_url') and it_['sei_url'] not in url2item: url2item[it_['sei_url']] = (t_, p_)
vot_idx = collections.defaultdict(list)
for v_ in V: vot_idx[(v_['reuniao'], v_['processo'], v_['diretor'])].append(v_)
sei_casadas = sei_conf = sei_conf_ok = 0; sei_div = []; sei_sem_item = []
for dc in decls:
    if not dc['tipo'].startswith('Declaração de Voto'): continue
    tg_i, pr_i = url2item.get(dc['url'], (dc['tag'], dc['proc']))
    rows_ = [v_ for v_ in vot_idx.get((tg_i, pr_i, dc['autor']), []) if v_['deliberacao'].startswith('Acórdão')]
    if not rows_: sei_sem_item.append((tg_i, pr_i, dc['autor'].split()[0], dc['num'])); continue
    sei_casadas += 1
    for v_ in rows_:
        if dc['cl'] == 'ACOMPANHOU' and v_['voto'] == 'ACOMPANHOU':
            v_['proveniencia'] = 'nominal'; v_['doc_sei'] = f'SEI nº {dc["num"]} ({dc["tipo"]})'; sei_conf_ok += 1
        else: sei_div.append((tg_i, pr_i, dc['autor'].split()[0], dc['cl'], v_['voto'], dc['num']))
# ---------------------------------------------------------------- narrativas de vista (PROSSEGUIMENTOS/REABERTURAS) -> vencidos por acordao (fonte interna independente do item 7)
narr = {}
for tag in TAGS:
    for o, S in sec_ata[tag].items():
        tx = plano(S.get('REABERTURAS DE DISCUSSÃO', '') + ' ' + S.get('PROSSEGUIMENTOS DE VOTAÇÃO', ''))
        for m in re.finditer(r'aprovou o Ac[óo]rd[ãa]o n[ºo] (\d+),? (.*?)(?=(?:\s-\s' + P5 + r')|(?:\s' + P5 + r'\S+ - )|;|$)', tx):
            n = int(m[1]); t2 = m[2]
            mv = re.search(r'Vencid[oa]s? (.*?)(?:\.|;|$)', t2)
            narr[n] = {'vencidos': quem(mv[1]) if mv else [], 'vencedora': 'Revisor' if re.search(r'proposta apresentada pel[oa] Revisor', t2) else ('Relator' if re.search(r'proposta apresentada pel[oa] Relator', t2) else '?'), 'tag': tag}
# ---------------------------------------------------------------- QUALIDADE
Q, pend = [], []
def chk(nome, esp, obs, nota='', ok=None):
    st = ('OK' if esp == obs else 'DIVERGE') if ok is None else ok
    Q.append([AG, nome, esp, obs, st, nota])
URL_ATAS = 'https://www.gov.br/antaq/pt-br/acesso-a-informacao/institucional/reunioes-deliberativas/atas-e-pautas-das-reunioes/'
URL_SOPH = lambda i: f'https://sophia.antaq.gov.br/Terminal/acervo/detalhe/{i}'
URL_VIRT = 'https://www.gov.br/antaq/pt-br/acesso-a-informacao/institucional/reunioes-deliberativas/resultado-das-reunioes-virtuais-da-diretoria-1/'
sat = inv['sophia']['atas']
# (a) atas listadas x baixadas x lidas
listadas = {t for t in sat if int(t[3:]) >= 602}   # Sophia rotula "600/2026" e "601/2026" mas sao reunioes de 04/12 e 15-17/12/2025
excl = sorted(set(sat) - listadas)
baix = {t for t in listadas if all(man.get(f'sophia:{t}:{a["codigo"]}', {}).get('ok') for a in sat[t]['arquivos'])}
lidas = set(TAGS)
chk('(a) Atas 2026 listadas no Sophia (Ata de Reunião, ano 2026, contador oficial 26 registros) × baixadas (PDF ok, sha256 no manifesto)', len(listadas), len(baix), f'Sophia declara {inv["sophia"]["atas_contador_declarado"]} registros no filtro (ata+outros: {inv["sophia"]["atas_registros_carregados"]} carregados = declarado); {len(sat)} atas ROD no filtro, das quais {len(excl)} ({", ".join(excl)}) são reuniões de dez/2025 rotuladas "/2026" e ficam fora')
chk('(a) Atas baixadas × lidas pelo parser (cabeçalho com data 2026 e nº da reunião)', len(baix), len(lidas), 'lidas = atas com data de abertura em 2026')
chk('(a) Contador do Sophia (registros carregados até o fim do "Mais resultados") × declarado', inv['sophia']['atas_contador_declarado'], inv['sophia']['atas_registros_carregados'], 'prova de paginação completa: botão "Mais resultados" clicado até esgotar')
ok_n = [t for t in TAGS if cab_ata[t]['num'] == int(t[3:])]
chk('(a) Nº da reunião no texto da ata = nº do título no Sophia', len(TAGS), len(ok_n))
ok_d = [t for t in TAGS if t in cal and cal[t]['ini'] == cab_ata[t]['ini'] and cal[t]['fim'] == cab_ata[t]['fim']]
chk('(a/e) Datas do cabeçalho da ata × datas do calendário semestral (fonte independente)', len(TAGS), len(ok_d), 'diferenças: ' + str([(t, cal.get(t, {}).get('ini'), cab_ata[t]['ini']) for t in TAGS if t not in ok_d]))
# gov.br x Sophia (ROD610, ROD615): mesma ata publicada em 2 fontes
for t in ('ROD610', 'ROD615'):
    if 'govbr' in atas.get(t, {}):
        g = {b['num'] for b in blocos(atas[t]['govbr'], t, 'govbr')}; s = {b['num'] for b in blocos(atas[t]['ext'], t, 'ext')}
        decl = re.search(r'Ac[óo]rd[ãa]os? de n[ºo]s?\s*([\d\s,a e]+),? a seguir', plano(atas[t]['govbr']))
        chk(f'(a) {t}: acórdãos da ata no gov.br (PDF) × ata Externa no Sophia', len(g), len(g & s), f'gov.br {sorted(g)[:2]}..{sorted(g)[-1:]}; só no gov.br {sorted(g - s)}; só no Sophia(ext) {sorted(s - g)}', ok=('OK' if g == s else ('EXCEÇÃO' if g <= s or s <= g else 'DIVERGE')))
# gov.br x Sophia: mesmos campos por acordao (processo, relator, presentes 7.1, vencidos) nas duas publicacoes da mesma ata
for t in ('ROD610', 'ROD615'):
    if 'govbr' in atas.get(t, {}):
        g = {c['num']: c for c in (campos(b) for b in blocos(atas[t]['govbr'], t, 'govbr'))}; s_ = {c['num']: c for c in (campos(b) for b in blocos(atas[t]['ext'], t, 'ext'))}
        comuns = sorted(set(g) & set(s_))
        difs = [n for n in comuns if (g[n]['processo'], g[n]['relator'], [x for x, _ in g[n]['q'].get('presentes', [])], g[n]['q'].get('vencidos', []), g[n]['interessado']) != (s_[n]['processo'], s_[n]['relator'], [x for x, _ in s_[n]['q'].get('presentes', [])], s_[n]['q'].get('vencidos', []), s_[n]['interessado'])]
        chk(f'(a) {t}: processo/relator/interessado/presentes/vencidos por acórdão no PDF do gov.br × PDF do Sophia', len(comuns), len(comuns) - len(difs), f'divergentes: {difs[:6]}')
# (b) numeracao
def expande(txt):
    n = set()
    for m in re.finditer(r'(\d+)(?:\s*a\s*(\d+))?', txt):
        a, b = int(m[1]), int(m[2] or m[1]); n |= set(range(a, b + 1))
    return n
lidos = collections.defaultdict(set); dup = collections.Counter()
for tag in TAGS:
    for ac in blks[tag]: lidos[tag].add(ac['num']); dup[ac['num']] += 1
for tag in TAGS:
    decl = set(); dtxt = []
    for o in ('ext', 'int'):
        if o in atas[tag]:
            m = re.search(r'A Diretoria Colegiada aprovou os? Ac[óo]rd[ãa]os? de n[ºo]s?\s*(.*?),?\s*a seguir', plano(atas[tag][o]))
            if m: decl |= expande(re.sub(r'\bAc[óo]rd[ãa]os?\b', '', m[1])); dtxt.append(f'{o}: {m[1]}')
    meta_r[tag]['decl_txt'] = ' | '.join(dtxt)
    meta_r[tag]['decl'] = decl
    q_ = lidos[tag]
    chk(f'(b) {tag}: acórdãos transcritos (blocos lidos) × nºs declarados no cabeçalho da própria ata ("aprovou os Acórdãos de nºs ...")', len(decl), len(q_ & decl), f'lidos {len(q_)}; declarados e não lidos {sorted(decl - q_)}; lidos e não declarados {sorted(q_ - decl)}', ok=('OK' if q_ == decl else 'DIVERGE'))
todos = set().union(*lidos.values())
chk('(b) Acórdão com número repetido entre atas/blocos', 0, sum(1 for n, c in dup.items() if c > 1), str([n for n, c in dup.items() if c > 1]))
acs = {int(k): v for k, v in inv['sophia'].get('acordaos', {}).items()}
lo, hi = 1, max(todos)
buracos = [n for n in range(lo, hi + 1) if n not in todos]
# narrativa cita acordao n que nao tem bloco?
chk(f'(b) Numeração dos acórdãos 1..{hi} lidos nas atas, sem buraco', 0, len(buracos), 'buracos: ' + str(buracos), ok=('OK' if not buracos else 'EXCEÇÃO'))
so_sophia = sorted(n for n in acs if n not in todos); so_atas = sorted(n for n in todos if n not in acs)
chk('(b) Acórdãos nas atas × registros "Acórdão N/2026" do Sophia (contador independente), intersecção', len(acs), len(set(acs) & todos), f'só no Sophia (ata não lida/publicada): {len(so_sophia)} -> {so_sophia[:30]}{"..." if len(so_sophia) > 30 else ""}; só nas atas (sem registro Sophia): {so_atas}', ok=('OK' if not so_sophia and not so_atas else 'EXCEÇÃO'))
cit = collections.defaultdict(set)
for tag in TAGS:
    for o in ('ext', 'int'):
        if o in atas[tag]:
            for m in re.finditer(r'Ac[óo]rd[ãa]o n[ºo]\s*(\d{1,3})(?![\d./-]*[-/]\s*20(?:1\d|2[0-5]))(?!\s*[/-]\s*(?:20)?(?:1\d|2[0-5])\b)', plano(atas[tag][o])):
                pass
fora = sorted(n for n in narr if n not in todos)
chk('(b) Acórdãos citados nas narrativas de vista/prosseguimento ("aprovou o Acórdão nº N") × blocos transcritos', len(narr), len(narr) - len(fora), f'citados sem bloco: {fora}')
# pendencias de numeracao
for n in buracos:
    prox = next((t for t in TAGS if meta_r[t]['decl'] and min(meta_r[t]['decl']) <= n <= max(meta_r[t]['decl'])), None)
    reg = acs.get(n)
    pend.append([AG, f'Acórdão {n}-2026', meta_r[prox]['ini'] if prox else None, 'Numeração sem acórdão transcrito nas atas lidas', 'nenhum bloco "ACÓRDÃO Nº ' + str(n) + '-2026" nas atas Externa/Interna; ' + ('registro Sophia: ' + reg['url'] if reg else 'sem registro "Acórdão ' + str(n) + '/2026" no Sophia'),
                 (f'Número cai entre os intervalos que a própria {prox} declara ("aprovou os Acórdãos de nºs …": {meta_r[prox]["decl_txt"]}) e não consta de nenhum outro; provável acórdão de acesso restrito/sigiloso ou número não utilizado' if prox else (lambda a_, b_: f'Número fora dos intervalos declarados por qualquer ata: fica entre o último acórdão da {a_} ({max(meta_r[a_]["decl"])}) e o primeiro da {b_} ({min(meta_r[b_]["decl"])})')(max((t for t in TAGS if meta_r[t]['decl'] and max(meta_r[t]['decl']) < n), key=lambda t: max(meta_r[t]['decl'])), min((t for t in TAGS if meta_r[t]['decl'] and min(meta_r[t]['decl']) > n), key=lambda t: min(meta_r[t]['decl'])))),
                 'Perguntar à Secretaria-Geral/DRCP (cgd@antaq.gov.br) ou buscar no SEI pelo nº do acórdão', (reg or {}).get('url') or (URL_SOPH(sat[prox]['id']) if prox in sat else URL_ATAS)])
for n in so_sophia:
    reg = acs[n]
    pend.append([AG, f'Acórdão {n}-2026', (lambda d_: f'{d_[6:]}-{d_[3:5]}-{d_[:2]}' if d_ else None)(reg.get('assinatura')), 'Acórdão com registro no Sophia mas sem ata publicada/lida', 'registro Acórdão ' + str(n) + '/2026 (PDF individual)', 'Ata da reunião ainda não publicada (ROD619/620) ou acórdão fora das atas', 'Rodar scripts/antaq_baixar.py após a publicação da ata', reg['url']])
# (c) presenca: relator/presidente/revisor/vencido ⊆ presentes (7.1) U votou antes ; 7.1 ⊆ participantes do cabeçalho
bad_rel, bad_pres, bad_hdr, bad_q, bad_13 = [], [], [], [], []
for tag in TAGS:
    hdr = set(meta_r[tag]['pres'])
    for ac in blks[tag]:
        q = ac['q']; p71 = [n for n, _ in q.get('presentes', [])]; pap = dict(q.get('presentes', []))
        if not p71: bad_q.append((tag, ac['num'], 'sem 7.1')); continue
        ant = set(q.get('votou_antes', []))
        if ac['relator'] and ac['relator'] not in p71 and ac['relator'] not in ant: bad_rel.append((tag, ac['num'], ac['relator']))
        pres_n = [n for n, p in q['presentes'] if 'Presidente' in p]
        if not pres_n: bad_pres.append((tag, ac['num']))
        rel71 = [n for n, p in q['presentes'] if re.search(r'Relator', p)]
        if rel71 and ac['relator'] and ac['relator'] not in rel71: bad_13.append((tag, ac['num'], ac['relator'], rel71))
        if ac['relator'] is None: bad_13.append((tag, ac['num'], 'relator não lido'))
        fora_h = [n for n in p71 + q.get('vencidos', []) + q.get('impedidos', []) if n not in hdr and n not in ant]
        if fora_h: bad_hdr.append((tag, ac['num'], fora_h))
        if q.get('nao_classificado'): bad_q.append((tag, ac['num'], q['nao_classificado']))
tot_ac = sum(len(v) for v in blks.values())
chk('(c) Relator (item 3) ∈ "Diretores presentes" (7.1) ou "votou antes" (vista)', tot_ac, tot_ac - len(bad_rel), str(bad_rel[:8]))
chk('(c) Presidente marcado em 7.1 (todo acórdão)', tot_ac, tot_ac - len(bad_pres), str(bad_pres[:8]))
chk('(c) Relator do item 3 = diretor marcado "(Relator)" em 7.1 (campos distintos da ata)', tot_ac, tot_ac - len(bad_13), str(bad_13[:8]))
chk('(c) Presentes/vencidos/impedidos de cada acórdão ⊆ participantes do cabeçalho da reunião', tot_ac, tot_ac - len(bad_hdr), str(bad_hdr[:8]))
chk('(c) Linhas 7.x do quórum todas classificadas (presentes/vencido/impedido/não participou/votou antes)', 0, len(bad_q), str(bad_q[:6]))
# vencidos (item 7) x narrativa de vista
dv = [(n, sorted(a['q'].get('vencidos', [])), sorted(narr[n]['vencidos'])) for tag in TAGS for a in blks[tag] for n in [a['num']] if n in narr]
dv_bad = [x for x in dv if x[1] != x[2]]
chk('(c) Vencidos do item 7.2 × vencidos nomeados na narrativa "Prosseguimentos/Reaberturas" (2 trechos distintos da ata)', len(dv), len(dv) - len(dv_bad), str(dv_bad[:6]))
# (d) 1 voto por diretor presente
por_d = collections.defaultdict(list)
for v in V: por_d[(v['reuniao'], v['processo'], v['deliberacao'])].append(v)
bad_v = []; bad_dup = []
for d in D:
    k = (d['reuniao'], d['processo'], d['deliberacao']); vs = por_d[k]
    nomes = [v['diretor'] for v in vs]
    if len(nomes) != len(set(nomes)): bad_dup.append(k)
    if d['tipo_item'] == 'Deliberação':
        ac = next(a for a in blks[d['reuniao']] if a['num'] == int(d['item_n'])); p71 = {n for n, _ in ac['q'].get('presentes', [])}
        if not p71 <= set(nomes): bad_v.append(k)
        if sum(1 for v in vs if v['voto'].startswith('RELATOR')) != (1 if ac['relator'] else 0): bad_v.append(('relator', k))
    else:
        if not set(meta_r[d['reuniao']]['pres']) <= set(nomes): bad_v.append(k)
nd = sum(1 for d in D)
chk('(d) Itens (acórdão/retirada/vista/ata) com 1 linha de voto para cada diretor presente (7.1 do acórdão ou cabeçalho da reunião)', nd, nd - len(bad_v), str(bad_v[:6]))
chk('(d) Nenhum diretor com 2 linhas de voto no mesmo item', 0, len(bad_dup), str(bad_dup[:4]))
chk('(d) Acórdãos com exatamente 1 relator na tabela de votos', tot_ac, sum(1 for d in D if d['tipo_item'] == 'Deliberação' and sum(1 for v in por_d[(d['reuniao'], d['processo'], d['deliberacao'])] if v['voto'].startswith('RELATOR')) == 1))
chaves_d = collections.Counter((d['reuniao'], d['processo'], d['deliberacao']) for d in D)
chk('(d) Chave (reunião, processo, deliberação) única', len(D), len(chaves_d))
# (e) calendario x atas
def datai(s): return datetime.date.fromisoformat(s)
cal_rows = []
for n in range(602, 626):
    t = f'ROD{n}'; c_ = cal.get(t)
    if not c_: cal_rows.append((t, 'FORA DO CALENDÁRIO')); continue
    if c_['cancelada']: st = 'cancelada'
    elif t in TAGS: st = 'com ata'
    elif datai(c_['fim']) < HOJE: st = 'realizada sem ata publicada'
    else: st = 'futura'
    cal_rows.append((t, st))
cnt = collections.Counter(s for _, s in cal_rows)
prevista = [t for t, s in cal_rows]
chk('(e) Calendário (1º sem 602-612 texto + 2º sem 613-625 OCR) cobre as 24 reuniões ordinárias ROD602..625', 24, len([1 for t in prevista if t in cal]), f'OCR do 2º semestre: {ocr_n} reuniões lidas (esperado 13)')
chk('(e) Reuniões do calendário já ocorridas e não canceladas (até hoje) × atas coletadas', cnt['com ata'] + cnt['realizada sem ata publicada'], cnt['com ata'], f'{dict(cnt)}', ok=('OK' if cnt['realizada sem ata publicada'] == 0 else 'EXCEÇÃO'))
chk('(e) Atas coletadas que não constam do calendário', 0, len([t for t in TAGS if t not in cal]), str([t for t in TAGS if t not in cal]))
for t, st in cal_rows:
    c_ = cal.get(t)
    if st == 'com ata': continue
    ps = pauta.get(t)
    sophia_pauta = (inv['sophia'].get('pautas', {}).get(t) or {}).get('url')
    if st == 'cancelada': pend.append([AG, t, c_['ini'], 'Reunião CANCELADA (calendário)', f'pauta Sophia: {"sim" if ps is not None else "não"}', 'Calendário 1º semestre: "609ª 14/05 telepresencial (Reunião cancelada)"; não há ata', 'Nada a fazer (conferir se os processos foram a ROD610)', sophia_pauta or URL_ATAS])
    elif st == 'realizada sem ata publicada': pend.append([AG, t, c_['ini'], 'Realizada, ata ainda não publicada', f'pauta Sophia: {"sim (" + str(len(ps)) + " processos)" if ps else "não"}; Acórdãos individuais podem já constar no Sophia', 'Ata sai ~2 semanas depois (618: realizada 08-10/09, assinada 21/09, publicada 22/09)', 'Rodar scripts/antaq_baixar.py + antaq_parse.py quando a ata for publicada', sophia_pauta or URL_ATAS])
    elif st == 'futura': pend.append([AG, t, c_['ini'], 'Futura (calendário)', 'só calendário', 'Ainda não ocorreu (hoje ' + HOJE.isoformat() + ')', 'Rodar após a data', URL_ATAS])
# RED
red = [t for t in inv['sophia']['atas'] if t.startswith('RED')]
red_g = [n for n in inv['govbr']['sonda_arquivos']['existem'] if 'RED' in n]
chk('(e) Reuniões EXTRAORDINÁRIAS (RED) 2026 com ata: Sophia (busca "Ata de Reunião", 2026) + sondagem gov.br AtaRED28..44', 0, len(red), f'nenhuma RED 2026 encontrada: no gov.br existem só {red_g} (AtaRED31/32/33 = fev-jun/2025, não 2026; a página mostra "33ª RED" como última). O "33" citado na tarefa é de 25/06/2025', ok='EXCEÇÃO')
pend.append([AG, 'RED (extraordinárias) 2026', None, 'Nenhuma ata/pauta de RED de 2026 localizada', 'gov.br: AtaRED31/32/33 e Pautade33RED (todas de 2025); Sophia: nenhum "Ata de Reunião Extraordinária da Diretoria N/2026"', 'Última RED conhecida é a 33ª (25/06/2025); calendários 2026 listam só ordinárias', 'Reconferir periodicamente a página (RED 34+)', URL_ATAS])
# --- pauta x ata (denominador independente)
pa_rows, pa_bad = [], []
for tag in TAGS:
    if tag not in pauta: continue
    pp = set(pauta[tag]); dest = collections.defaultdict(set)
    for d in D:
        if d['reuniao'] == tag and not d['processo'].startswith('ATA-'): dest[d['processo']].add(d['tipo_item'])
    sem = sorted(p for p in pp if p not in dest)
    pa_rows.append((tag, len(pp), len(pp) - len(sem), sem))
    if sem: pa_bad.append((tag, sem))
    meta_r[tag]['pauta_n'] = len(pp)
chk('(e/b) Processos da PAUTA (Sophia, independente da ata) com destino na ata (acórdão, retirada ou vista) — reuniões com pauta', sum(r[1] for r in pa_rows), sum(r[2] for r in pa_rows), f'{len(pa_rows)} reuniões; sem destino: {pa_bad[:6]}', ok=('OK' if not pa_bad else 'EXCEÇÃO'))
for tag, sem in pa_bad:
    for p in sem:
        pa = pauta[tag][p]
        pend.append([AG, f'{tag} processo {p}', meta_r[tag]['ini'], 'Processo pautado sem acórdão/retirada/vista na ata', f'pauta: relator {pa["relator"]}; {pa["tipo"]}; {pa["interessado"][:80]}', 'Pode ter sido sobrestado/adiado sem registro na seção própria, ou acórdão sigiloso fora da ata', 'Conferir no SEI/Sophia', URL_SOPH(sat[tag]['id'])])
# --- virtuais x ata
vr_bad = []; vr_tot = 0; vr_ok = 0; vr_ret = [0, 0]
for tag, v in virt.items():
    if tag not in TAGS:
        continue
    for p, it in v['itens'].items():
        vr_tot += 1; dst = {d['tipo_item'] for d in D if d['reuniao'] == tag and d['processo'] == p}
        res = it['resultado'].lower()
        esperado = 'Retirada de pauta' if 'retirado' in res else 'Deliberação'
        if esperado in dst or (esperado == 'Deliberação' and dst): vr_ok += 1
        else: vr_bad.append((tag, p, it['resultado'], sorted(dst)))
    vr_ret[0] += sum(1 for it in v['itens'].values() if 'retirado' in it['resultado'].lower())
    vr_ret[1] += sum(1 for d in D if d['reuniao'] == tag and d['tipo_item'] == 'Retirada de pauta')
chk('(e/b) Reuniões VIRTUAIS: processos da página oficial "Resultado das Reuniões Virtuais" (gov.br) com o mesmo desfecho na ata', vr_tot, vr_ok, f'{len(virt)} reuniões virtuais 2026 na página (ROD {sorted(int(t[3:]) for t in virt)}); divergências: {vr_bad[:6]}', ok=('OK' if not vr_bad else 'EXCEÇÃO'))
sem_res = {t: sum(1 for i in v['itens'].values() if not i['resultado']) for t, v in virt.items()}
dif_res = {t: v['n_resultado_linhas'] - (v['n_itens'] - sem_res[t]) for t, v in virt.items() if v['n_resultado_linhas'] != v['n_itens'] - sem_res[t]}
chk('(e/b) Virtuais: nº de linhas "Resultado:" da página × (itens lidos − itens sem Resultado na própria página)', sum(v['n_resultado_linhas'] for v in virt.values()), sum(v['n_itens'] - sem_res[t] for t, v in virt.items()),
    f'itens sem Resultado na página (processo extrapauta): {({t: n for t, n in sem_res.items() if n})}; diferença por reunião (erro de digitação da página, "Resultado" duplicado no mesmo item): {dif_res}', ok=('OK' if not dif_res else 'EXCEÇÃO'))
chk('(e/b) Virtuais: "Retirado de pauta" na página × retiradas lidas na ata (reuniões em comum)', vr_ret[0], vr_ret[1])
for tag, v in virt.items():
    if tag not in TAGS: pend.append([AG, f'{tag} (virtual)', v['periodo_ini'], 'Reunião virtual na página de resultados, sem ata lida', f'{v["n_itens"]} processos na página de resultados', 'Ata não publicada', 'Rodar após a publicação da ata', URL_VIRT])
# votos: contagens
n_nom = sum(1 for v in V if v['proveniencia'] == 'nominal'); n_inf = sum(1 for v in V if v['proveniencia'] == 'inferido'); n_rev = sum(1 for v in V if v['proveniencia'] == 'REVISAR')
chk('Votos por proveniência: nominal + inferido + REVISAR = total', len(V), n_nom + n_inf + n_rev, f'nominal {n_nom} ({100 * n_nom / len(V):.1f}%), inferido {n_inf} ({100 * n_inf / len(V):.1f}%), REVISAR {n_rev}')
for v in V:
    if v['proveniencia'] == 'REVISAR': pend.append([AG, f'{v["reuniao"]} {v["deliberacao"]} {v["diretor"]}', v['data'], 'Voto a REVISAR', v['voto'], 'Relator fora do quórum 7.1 sem "votou antes"', 'Ler o acórdão', URL_ATAS])
# --- SEI (fonte INDEPENDENTE das atas): lista de documentos de voto por processo de votacao das reunioes virtuais
URL_SEI_EX = 'https://www.gov.br/antaq/pt-br/acesso-a-informacao/institucional/reunioes-deliberativas/resultado-das-reunioes-virtuais-da-diretoria-1/'
if sei:
    por_reun = collections.defaultdict(lambda: {'paginas': 0, 'abre': 0, 'restrito': 0, 'docs': 0, 'declarado': 0, 'abertos': 0})
    for u_, pg in sei.items():
        r_ = por_reun[pg['reuniao'][:4]]; r_['paginas'] += 1; r_['docs'] += len(pg['docs']); r_['declarado'] += pg.get('declarado', 0); r_['abertos'] += len(pg.get('abertos', []))
        r_['abre' if pg['links_abrem'] else 'restrito'] += 1
    links_virt = {t: len({it['sei_url'] for it in v['itens'].values() if it.get('sei_url')}) for t, v in virt.items()}
    ok_pag = [t for t in links_virt if links_virt[t] and por_reun['%dª' % int(t[3:])]['paginas'] == links_virt[t]]
    chk('(SEI) Páginas SEI percorridas × links "Resultado" distintos na página oficial das reuniões virtuais (por reunião)', sum(1 for t in links_virt if links_virt[t]), len(ok_pag), 'paginas por reunião ' + str({t: (links_virt[t], por_reun['%dª' % int(t[3:])]['paginas']) for t in sorted(links_virt) if links_virt[t]}))
    if all('declarado' in pg for pg in sei.values()):
        chk('(SEI) Documentos lidos na tabela × "Lista de Protocolos (N registros)" declarado pela própria página SEI', sum(pg['declarado'] for pg in sei.values()), sum(len(pg['docs']) for pg in sei.values()), 'contador independente impresso pela página SEI')
    # lista de iniciais x votos ACOMPANHOU da ata (todas as paginas, abertas ou restritas)
    vot_ac = collections.defaultdict(dict)
    for v_ in V: vot_ac[(v_['reuniao'], v_['processo'], v_['deliberacao'])][v_['diretor']] = v_['voto']
    cmp_ = collections.Counter(); exc_ = []
    for t, vv in virt.items():
        for p_, it in vv['itens'].items():
            pg = sei.get(it.get('sei_url') or '')
            if not pg or links_virt.get(t, 0) < 5: continue
            dirs_ = {INI[re.sub(r'.*-', '', r_[2] if len(r_) > 2 else '')] for r_ in pg['docs'] if len(r_) > 2 and r_[2].startswith('Declaração de Voto') and re.sub(r'.*-', '', r_[2]) in INI}
            for dl_, vs_ in [(k[2], x) for k, x in vot_ac.items() if k[0] == t and k[1] == p_ and k[2].startswith('Acórdão')]:
                ac_ = {n for n, x in vs_.items() if x == 'ACOMPANHOU'}; vt_ = {n for n, x in vs_.items() if x.startswith(('ACOMPANHOU', 'DIVERGIU', 'REVISOR', 'REDATOR'))}
                cmp_['acórdãos comparados'] += 1
                if dirs_ == ac_: cmp_['igual'] += 1
                elif dirs_ <= vt_: cmp_['subconjunto (declarante divergente/revisor)'] += 1
                else: cmp_['diverge'] += 1; exc_.append((t, p_, sorted(n.split()[0] for n in dirs_ - vt_)))
    chk('(SEI×ata) Diretores com documento "Declaração de Voto-<iniciais>" no SEI × diretores ACOMPANHOU na ata (acórdãos das reuniões virtuais 602-610)', cmp_['acórdãos comparados'], cmp_['igual'] + cmp_['subconjunto (declarante divergente/revisor)'],
        f'{dict(cmp_)}; declarante no SEI fora dos votantes da ata: {exc_}', ok=('OK' if not exc_ else 'EXCEÇÃO'))
    for t_, p_, qm_ in exc_:
        pend.append([AG, f'{t_} processo {p_}', meta_r[t_]['ini'], 'SEI lista Declaração de Voto de diretor que a ata não registra como votante', f'diretor(es) {qm_} com "Declaração de Voto" no SEI', 'Provável voto antecipado (vista anterior) não citado no quórum do acórdão (data da declaração anterior à reunião)', 'Conferir a Declaração no SEI (restrita)', URL_VIRT])
    n_dc = sum(1 for dc in decls if dc['tipo'].startswith('Declaração de Voto'))
    chk('(SEI×ata) Declarações de voto ABERTAS (HTML público, lidas) casadas com um item da ata (reunião+processo+diretor)', n_dc, sei_casadas, f'sem item: {sei_sem_item[:5]}', ok=('OK' if n_dc == sei_casadas else 'EXCEÇÃO'))
    chk('(SEI×ata) Declarações lidas cujo texto ("Acompanho o Voto ...") concorda com o voto ACOMPANHOU da ata', sei_casadas, sei_conf_ok, f'conflitos ata × SEI: {sei_div}', ok=('OK' if not sei_div else 'EXCEÇÃO'))
    for tg_, pr_, au_, cl_, vo_, nu_ in sei_div:
        pend.append([AG, f'{tg_} processo {pr_} — {au_}', meta_r[tg_]['ini'], 'CONFLITO ata × SEI no voto', f'SEI nº {nu_}: declaração do diretor diz "{cl_}" (acompanha o relator); ata (7.2) registra: {vo_}', 'Pode ser voto vencido apenas em parte do dispositivo (ata) ou declaração anterior a voto complementar do relator', 'Ler a declaração no SEI e o acórdão; voto mantido como registrado na ata (nominal)', URL_VIRT])
    ab_tot = sum(1 for pg in sei.values() for _ in pg.get('abertos', []))
    for rt in sorted(por_reun):
        r_ = por_reun[rt]; tg = 'ROD' + rt[:3]
        if r_['restrito'] or tg in ('ROD612', 'ROD613', 'ROD615', 'ROD617', 'ROD618'):
            pend.append([AG, f'{tg} votos nominais dos demais diretores no SEI', meta_r.get(tg, {}).get('ini'), 'Parcialmente bloqueado pela fonte' if r_['abre'] else 'Sem declarações de voto públicas',
                         f'{r_["paginas"]} página(s) SEI de votação, {r_["docs"]} documentos listados; {r_["abre"]} página(s) com documentos abertos ({r_["abertos"]} declarações/votos lidos) e {r_["restrito"]} com documentos restritos (lista visível, conteúdo não abre)' if tg in ('ROD602', 'ROD604', 'ROD606', 'ROD608', 'ROD610') else
                         f'1 processo SEI por reunião (relatórios e votos dos RELATORES; sem "Declaração de Voto" dos demais diretores)',
                         'votos dos demais diretores no SEI (bloqueado pela fonte): documentos restritos às partes; o acesso público do SEI só abre parte dos documentos (sem captcha)', 'Pedir à Secretaria-Geral/DRCP (cgd@antaq.gov.br) o extrato nominal de votação', URL_VIRT])
pend.append([AG, 'Votos dos demais diretores no SEI (telepresenciais ROD603/605/607/611/614/616)', None, 'Não publicado', 'Reuniões telepresenciais não têm página de "Resultado" nem processo SEI público', 'votos dos demais diretores no SEI (bloqueado pela fonte): só a ata registra relator/vencido/impedido/ausente', 'Extrato nominal de votação junto à Secretaria-Geral', URL_ATAS])

# ---------------------------------------------------------------- cobertura, nao_feito, saida
n_sei_pag = len(sei); n_sei_abre = sum(1 for pg in sei.values() if pg['links_abrem']); n_sei_docs = sum(len(pg['docs']) for pg in sei.values())
n_sei_up = sum(1 for v in V if v.get('doc_sei'))
cob = [[AG, 'Atas de Reunião Ordinária 2026 lidas (Externa + Interna)', len(TAGS), f'{", ".join(TAGS)}; Sophia: 26 registros no filtro "Ata de Reunião / 2026" (=16 atas 2026 + 2 de dez/2025 rotuladas /2026 + 8 outros atos), todos carregados'],
       [AG, 'Acórdãos transcritos nas atas', tot_ac, f'1..{hi}; buracos: {buracos} (a própria ata pula esses números e o Sophia também não os tem); Sophia tem {len(acs)} registros Acórdão N/2026 (562..587 = ROD619/620 sem ata)'],
       [AG, 'Itens: acórdãos / retiradas de pauta / vistas / homologações de ata', f'{sum(1 for d in D if d["tipo_item"]=="Deliberação")} / {sum(1 for d in D if d["tipo_item"]=="Retirada de pauta")} / {sum(1 for d in D if d["tipo_item"]=="Vista")} / {sum(1 for d in D if d["tipo_item"]=="Aprovação de ata")}', 'Prosseguimentos de votação já constam como acórdão; comunicações e sustentações orais não são itens de votação'],
       [AG, 'Calendário 2026 (ROD 602..625)', 24, f'{dict(cnt)}; 609 cancelada; 619 e 620 realizadas sem ata ainda; 621..625 futuras'],
       [AG, 'Reuniões extraordinárias (RED) 2026', 0, 'nenhuma localizada (ver pendências)'],
       [AG, 'Contador oficial da pasta gov.br (API Volto items_total)', 'indisponível', 'API ++api++ do gov.br responde 404/503 (site Plone clássico); contadores usados no lugar: Sophia (26 atas; 579 acórdãos), página de resultados virtuais (415 processos / 10 reuniões), calendário semestral (24 ROD), lista "Lista de Protocolos (N registros)" do SEI'],
       [AG, 'Pautas do Sophia lidas', len(pauta), f'processos pautados: {sum(len(p) for p in pauta.values())}'],
       [AG, 'SEI público (pesquisa processual, Chromium, sem captcha)', f'{n_sei_pag} páginas / {n_sei_docs} documentos', f'{n_sei_abre} páginas com documentos abertos; {sum(len(pg.get("abertos", [])) for pg in sei.values())} declarações/votos HTML lidos; {n_sei_up} votos promovidos de inferido para nominal pela Declaração de Voto do próprio diretor']]
nf = [[AG, 'Votos dos demais diretores (SEI)', f'{n_inf} de {len(V)} linhas ({100 * n_inf / len(V):.1f}%) seguem INFERIDAS', 'PARCIAL (bloqueado pela fonte)', 'SEI abre só parte dos documentos (declarações de ROD602-610 em processos não restritos); reuniões telepresenciais e ROD612-618 não têm "Declaração de Voto" pública', 'Pedir extrato nominal de votação à Secretaria-Geral/DRCP (cgd@antaq.gov.br)'],
      [AG, 'ACOMPANHOU (inferido)', f'{n_inf} linhas inferidas', 'LIMITE DO MODELO', 'Ausência de divergência no item 7 do acórdão ≠ voto nominal do diretor', 'Extrato nominal de votação'],
      [AG, 'Texto integral do dispositivo por item', 'decisao_texto limitado a 1500 caracteres', 'LIMITE DO MODELO', 'Dispositivos longos truncados', 'Ler o PDF da ata'],
      [AG, 'Acórdãos sigilosos/ausentes das atas', f'{len(buracos)} números sem bloco', 'NÃO FEITO' if buracos else 'SEM CASOS', 'Não transcritos nas atas', 'Ver pendências'],
      [AG, 'Sustentações orais, comunicações e informes', 'fora do modelo de votos', 'FORA DO ESCOPO', 'Não são deliberação', '']]
for d in D:
    for k in ('revisor', 'origem_ata'): pass
json.dump({'reunioes': R, 'deliberacoes': D, 'votos': V, 'qualidade': Q, 'cobertura': cob, 'pendencias': pend, 'nao_feito': nf,
           'diretores': [n for n, _ in ROST], 'colegiado': 'Diretoria Colegiada', 'meses_nota': ''}, open(out, 'w'), ensure_ascii=False, indent=1)
print(len(R), 'reunioes', len(D), 'itens', len(V), 'votos', dict(collections.Counter(d['tipo_item'] for d in D)), '| nominal', n_nom, 'inferido', n_inf, 'REVISAR', n_rev)
for q in Q: print(q[4], '|', q[1][:110], '|', q[2], q[3], '|', q[5][:160])
