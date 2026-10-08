"""ANEEL: parser da esteira de votos 2026 (RPO/RPC/RPE) -> aneel.json  (mesmo formato de antaq.json/anp.json + `partes` e `voto_por_parte`).
Uso: python3 -I scripts/aneel_parse.py manifesto_aneel.json aneel.json   (le aneel_inventario.json, fonte/aneel/, escreve texto_aneel/)

FONTE DO TEXTO DAS DECISOES (todas publicas):
  - Dados Abertos ANEEL, conjunto 'Pautas e Atas das Reunioes Publicas da Diretoria' (CSV): 1 linha por item de pauta/ata, com o relator,
    o resultado e o TEXTO DA DECISAO tal como consta na ata ("A Diretoria, por maioria, acompanhando ..., e vencido o Diretor X, decidiu: (i) ...").
    A ata em PDF (www2.aneel.gov.br / reuniaodiretoria.aneel.gov.br) esta BLOQUEADA pelo Cloudflare/reset de conexao (ver pendencias): por isso a
    PRESENCA nominal da reuniao inteira NAO e observavel; o colegiado e a composicao inferida (5 diretores) e so ha ausencia registrada no nivel do item.
  - Calendario oficial (Portaria ANEEL 7.014/2025, tabela em gov.br) = denominador independente de reunioes (25 RPOs).
  - Datastore CKAN (API do mesmo portal) = contador independente de itens por data.
Os votos dos diretores NAO estao num extrato nominal: relator, vencido/divergente, impedido/suspeito, ausente, pedido de vista e quem votou antes da vista
sao NOMINAIS (citados na ata); 'ACOMPANHOU' e INFERIDO (unanimidade ou, em maioria, exclusao dos vencidos nomeados)."""
import re, sys, json, csv, os, collections, datetime, unicodedata, hashlib
man = json.load(open(sys.argv[1])); out = sys.argv[2]
inv = json.load(open('aneel_inventario.json'))
HOJE = datetime.date.today().isoformat()
AG = 'ANEEL'
URL_ATAS = 'https://www.gov.br/aneel/pt-br/reunioes-publicas/pautas-e-atas'
URL_WWW2 = 'https://www2.aneel.gov.br/aplicacoes_liferay/noticias_area/?idAreaNoticia=425'
URL_ATA = 'https://www2.aneel.gov.br/aplicacoes_liferay/ata_diretoria/ata.cfm'
URL_CAL = 'https://www.gov.br/aneel/pt-br/reunioes-publicas/calendario'
URL_CSV = inv['dataset_pautas_atas']['url']

def norm(s):
    """minusculas ASCII com o MESMO comprimento do original (indices de norm(s) valem em s)"""
    o = []
    for ch in s:
        b = unicodedata.normalize('NFKD', ch)[:1]
        o.append(b.lower() if b and b.isascii() else ' ')
    return ''.join(o)
def plano(x): return re.sub(r'\s+', ' ', x.replace('\xa0', ' ').replace('​', '')).strip()

# ---------------------------------------------------------------- diretores
NOMES = {'sandoval': 'Sandoval de Araújo Feitosa Neto', 'agnes': 'Agnes Maria de Aragão da Costa', 'gentil': 'Gentil Nogueira de Sá Júnior', 'willamy': 'Willamy Moreira Frota',
         'fernando': 'Fernando Luiz Mosna Ferreira da Silva', 'ludimila': 'Ludimila Lima da Silva', 'daniel': 'Daniel Cardoso Danna', 'ricardo': 'Ricardo Lavorato Tili'}
SANDOVAL, AGNES, GENTIL, WILLAMY, FERNANDO, LUDIMILA, DANNA, TILI = [NOMES[k] for k in ('sandoval', 'agnes', 'gentil', 'willamy', 'fernando', 'ludimila', 'daniel', 'ricardo')]
NAMEPAT = re.compile(r'sandoval de ara|agnes maria|gentil nogueira|gentil de sa|willamy moreira|fernando luiz mosna|ludimila lima|daniel cardoso danna|ricardo lavorato tili')
def nomes(seg):
    res = []
    for m in NAMEPAT.finditer(norm(seg)):
        n = NOMES[m[0].split()[0]]
        if n not in res: res.append(n)
    return res
def nome_col(s):          # coluna NomDiretorRelator (MAIUSCULAS sem acento)
    r = nomes(s.title()) if s else []
    return r[0] if r else (s.title() if s else None)
# Colegiado: 5 diretores (Sandoval = Diretor-Geral). Fernando Mosna deixa o colegiado e Ludimila Lima assume a partir do CDPO de 18/08/2026
# (1a atuacao de Ludimila como diretora em exercicio: CDPO 14/2026 de 18/08; ultima atuacao de Fernando: RPO 16/2026 de 11/08). Inferencia: ver pendencias.
TROCA = '2026-08-18'
def roster(data): return [SANDOVAL, AGNES, GENTIL, WILLAMY, FERNANDO if data < TROCA else LUDIMILA]

# ---------------------------------------------------------------- leitura do CSV
raw = list(csv.DictReader(open('fonte/aneel/pautas_atas.csv', encoding='utf8'), delimiter=';'))
rows = [r for r in raw if r['DatReuniao'].startswith('2026')]
def tag_de(ide):
    m = re.match(r'(\d+)/2026 - (RPO|RPC|RPE)$', ide); return f'{m[2]}{int(m[1])}' if m else None
TIPO = {'RPO': 'Reunião Pública Ordinária (RPO)', 'RPC': 'Circuito Deliberativo Público Ordinário (CDPO/RPC)', 'RPE': 'Reunião Pública Extraordinária (RPE)'}
ORD = {'RPO': 'Reunião Pública Ordinária', 'RPC': 'Circuito Deliberativo Público Ordinário', 'RPE': 'Reunião Pública Extraordinária'}
def nup(s):
    s = s.strip()
    return f'{s[:5]}.{s[5:11]}/{s[11:15]}-{s[15:17]}' if re.fullmatch(r'\d{17}', s) else s
def dmy(d): return f'{d[8:]}/{d[5:7]}/{d[:4]}'

# ---------------------------------------------------------------- parsing do texto da decisao
ROM = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx']
MARK = re.compile(r'\((' + '|'.join(ROM) + r')\)')
def marcadores(p):
    """posicoes dos marcadores (i),(ii).. de nivel 1 (precedidos de ':' '-' ';' ',' ' e ' ou inicio)"""
    res = []
    dentro = []; ab = None
    for i_, ch in enumerate(p):
        if ch == '“' and ab is None: ab = i_
        elif ch == '”' and ab is not None: dentro.append((ab, i_)); ab = None
    if ab is not None: dentro.append((ab, len(p)))
    for m in MARK.finditer(p):
        if any(a_ < m.start() < b_ for a_, b_ in dentro): continue
        ant = p[max(0, m.start() - 6):m.start()]
        if re.search(r'(?:^|[:\-;,–.]|\be|\bou)\s*$', ant): res.append((m.start(), m.end(), m[1]))
    return res
def paragrafos(t): return [p.strip() for p in re.split(r'\n+|\s{3,}', t.replace('\xa0', ' ').replace('​', '')) if p.strip()]
SENT = re.compile(r'(?<=[a-zA-Z0-9\)”"º»])\.\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕ])')
def eh_decisao(p): return bool(re.match(r'(?:A )?Diretoria\b', p))
def modo_de(s):
    n = norm(s); a, b = n.find('por unanimidade'), n.find('por maioria')
    if a < 0 and b < 0: return None
    return 'unanimidade' if (b < 0 or (a >= 0 and a < b)) else 'maioria'
def seg_vencidos(s):
    """nomes dos vencidos num trecho (a partir de 'vencid' ate a proxima oracao verbal)"""
    n = norm(s); m = re.search(r'vencid', n)
    if not m: return []
    seg = s[m.start():]
    fim = re.search(r'\bacompanhand|,\s*(?:decidiu|decidiram|e decidiu)|,\s*[a-zà-ú]+(?:ar|er|ir|or)\b', seg)
    return nomes(seg[:fim.start()] if fim else seg[:400])
def seg_lider(s):
    """(nome, tipo) de quem lidera o voto vencedor: 'acompanhando o voto do Diretor-Relator X' / 'o voto-vista do Diretor Y' / 'o voto divergente|divergencia ... Z'"""
    n = norm(s); m = re.search(r'acompanhand[oa]', n)
    if not m: return None, None
    seg = s[m.start():]; fim = re.search(r'\bvencid|,\s*decidiu|\bdecidiu', norm(seg))
    seg = seg[:fim.start()] if fim else seg[:300]
    ns = nomes(seg)
    if not ns: return None, None
    k = norm(seg); tipo = 'vista' if 'voto-vista' in k or 'voto vista' in k else ('div' if re.search(r'diverg', k) else 'rel')
    return ns[0], tipo
def limpa_acao(a):
    a = plano(a).strip(' -;,:–')
    a = re.sub(r'\s*[-–;]\s*(?:e|ou)?\s*$', '', a)
    return a.strip(' -;,:–')

def tira_modo(txt):
    """remove 'por unanimidade|por maioria[, vencido(s) ...,]' do inicio de uma parte"""
    m = re.match(r'\s*(?:e\s+)?por (unanimidade|maioria)\s*,?\s*', txt, re.I)
    if not m: return txt
    rest = txt[m.end():]
    if m[1].lower() == 'maioria' and re.match(r'(?:acompanhando|vencid)', norm(rest)):
        k = re.search(r'(?:^|,\s*)(?=[a-zà-ú]{4,}(?:ar|er|ir|or)\b)', rest)
        if k: rest = rest[k.end():]
    return rest
def analisa(texto, relator, resultado_col):
    """-> (partes, ctx): partes = ações da decisão ('A Diretoria ... decidiu: (i)...') com modo/vencidos; ctx = eventos narrativos
    (pedido de vista, impedimento, ausência, não participação, destaque, posições nominais 'votou no sentido de')"""
    partes = []
    ctx = {'vista': [], 'coletiva': False, 'destaque': [], 'impedidos': [], 'ausentes': {}, 'nao_part': [], 'camps': [], 'retirada': False, 'ressalva': []}
    sents = [s for p in paragrafos(texto) for s in SENT.split(p)]
    for s in sents:
        n = norm(s)
        if eh_decisao(s):
            iDec = n.find('decidiu'); iDec = iDec if iDec >= 0 else len(s)
            ms = marcadores(s)
            pre = s[:iDec]
            head = s[:ms[0][0]] if ms else s[:min(len(s), iDec + 160)]
            mdo = modo_de(head); venc = seg_vencidos(pre) if mdo == 'maioria' else []
            if mdo == 'maioria' and not venc: venc = seg_vencidos(head)
            lider, ltipo = seg_lider(pre)
            hacao = limpa_acao(re.sub(r'^\s*decidiu\s*,?\s*(?:ainda\s*,?\s*)?(?:por (?:unanimidade|maioria)\s*,?\s*)?', '', s[iDec:ms[0][0]], flags=re.I)) if ms else ''
            hacao = hacao if re.match(r'[a-zà-ú]+(?:ar|er|ir|or)\b', hacao) else ''
            if not ms: bloco = [(None, s[iDec:] if iDec < len(s) else s)]
            else: bloco = [(r, s[b:(ms[k + 1][0] if k + 1 < len(ms) else len(s))]) for k, (a, b, r) in enumerate(ms)]
            for r, txt in bloco:
                m2 = modo_de(txt[:230]) if r and re.match(r'\s*(?:e\s+)?por (?:unanimidade|maioria)', norm(txt)) else None
                v2, md = venc, mdo
                if m2: md = m2; v2 = seg_vencidos(txt[:400]) if m2 == 'maioria' else []
                if m2: acao = limpa_acao(tira_modo(txt))
                elif not r: acao = limpa_acao(re.sub(r'^\s*(?:,\s*)?(?:ouvida a [A-Za-zç]+,\s*)?(?:ainda,\s*)?(?:por (?:unanimidade|maioria):?\s*)?', '', txt))
                else: acao = limpa_acao(txt)
                if not r: acao = limpa_acao(re.sub(r'^\s*decidiu\s*,?\s*(?:ainda\s*,?\s*)?(?:por (?:unanimidade|maioria)\s*,?\s*)?', '', acao, flags=re.I))
                partes.append({'marca': r, 'acao': acao, 'pref': hacao, 'modo': md or 'sem registro', 'vencidos': list(v2), 'lider': lider, 'lider_tipo': ltipo})
            continue
        def antes(pat):
            m = re.search(pat, n)
            return (nomes(s[:m.start()]) if m else []), m
        ns, m = antes(r'pediu vista|solicitou vista|pedido de vista')
        if m and ns and not re.search(r'a pedido', n[:m.start()]):
            ctx['vista'].extend([x for x in ns[-1:] if x not in ctx['vista']])
            if 'coletiva' in n: ctx['coletiva'] = True
        ns, m = antes(r'solicitou (?:o )?destaque|pediu destaque')
        if m and ns: ctx['destaque'].extend(ns[-1:])
        ns, m = antes(r'declar\w+ (?:sua|seu|suas|seus) (?:suspei|impedi)|declar\w+-se (?:suspeit|impedid)')
        if m: ctx['impedidos'].extend([x for x in ns if x not in ctx['impedidos']])
        ns, m = antes(r'estava ausente|estavam ausentes|ausente no momento|consignou seu voto|consignando seu voto')
        if m and ns and re.search(r'ausen', n):
            cons = bool(re.search(r'consign', n))
            tipo = 'acompanhou o relator' if re.search(r'acompanhar o voto d[oa] diretor[a]?-relator', n) else ('acompanhou a divergência' if re.search(r'acompanhar a diverg', n) else ('voto consignado' if cons else ''))
            for x in ns: ctx['ausentes'][x] = tipo or ctx['ausentes'].get(x, '')
        ns, m = antes(r'nao participou|nao participaram')
        if m: ctx['nao_part'].extend([x for x in ns if x not in ctx['nao_part']])
        if re.search(r'fundamentacao diversa', n):
            m = re.search(r'fundamentacao diversa|apresentou|apresentaram', n); ctx['ressalva'].extend([x for x in nomes(s[:m.start()]) if x not in ctx['ressalva']])
        m = re.search(r'\bvotou\b|\bvotaram\b|proferiu (?:seu )?voto|manteve (?:o )?seu voto|registrou a altera|apresentou (?:seu )?voto|apresentaram votos|apresentou diverg|ratificou seu voto', n)
        if m and not re.search(r'fundamentacao diversa', n):
            iac = n.find('acompanhad')
            lead_seg = s[:iac] if 0 <= iac < m.start() else s[:m.start()]
            lead = nomes(lead_seg)
            if lead:
                if iac >= 0 and iac < m.start(): fol = [x for x in nomes(s[iac:m.start()]) if x != lead[0]]
                elif iac >= 0: fol = [x for x in nomes(s[iac:iac + 200]) if x != lead[0]]
                else: fol = lead[1:] if re.search(r'votaram|apresentaram', n[m.start():m.end() + 12]) else []
                ctx['camps'].append({'lider': lead[0], 'seguidores': fol, 'txt': s[:240]})
        if re.match(r'(?:o )?processo (?:acima )?foi retirado|decididas as preliminares', n) and 'retirad' in n: ctx['retirada'] = True
    # rotulos das partes: o marcador do texto quando e' sequencia consecutiva a partir de (i); senao, ordem de aparicao
    ms_ = [x['marca'] for x in partes]
    seq_ok = bool(ms_) and all(ms_) and ms_[0] == 'i' and all(ROM.index(m_) == k for k, m_ in enumerate(ms_))
    for k, x in enumerate(partes):
        x['parte'] = x['marca'].upper() if (seq_ok and x['marca']) else ROM[k].upper()
        if x['marca'] and x['marca'].upper() != x['parte']: x['nota'] = f"marcador do texto: ({x['marca']})"
    if len(partes) == 1: partes[0]['parte'] = 'única'
    return partes, ctx


# ---------------------------------------------------------------- rotulos de resultado (todas as acoes)
CONN = re.compile(r'\s(?:com vistas|visando|a fim de|de modo a|com o objetivo|destinad[ao]s? a|para(?=\s+(?:que|[a-zà-ú]+(?:ar|er|ir|or)\b)))')
VERBOS = [(r'conhecer', 'CONHECIDO'), (r'reconhecer', 'RECONHECIDO'), (r'(?:negar|nao dar)(?:-lhes?)? (?:o )?provimento', 'PROVIMENTO NEGADO'),
          (r'(?:dar|conceder)(?:-lhes?)? (?:parcial )?provimento(?: parcial)?', 'PROVIMENTO'), (r'indeferir', 'INDEFERIDO'), (r'deferir', 'DEFERIDO'), (r'nao aprovar', 'NÃO APROVADO'),
          (r'aprovar', 'APROVADO'), (r'homologar', 'HOMOLOGADO'), (r'autorizar', 'AUTORIZADO'), (r'ratificar', 'RATIFICADO'), (r'referendar', 'REFERENDADO'), (r'atestar', 'ATESTADO'),
          (r'declarar', 'DECLARADO'), (r'perda (?:superveniente )?d[eo] objeto', 'PERDA DE OBJETO'), (r'extinguir', 'EXTINTO'), (r'determinar', 'DETERMINAÇÃO'), (r'recomendar', 'RECOMENDAÇÃO'),
          (r'encaminhar', 'ENCAMINHADO'), (r'oficiar', 'OFICIADO'), (r'prorrogar', 'PRAZO PRORROGADO'), (r'conceder prazo adicional', 'PRAZO ADICIONAL CONCEDIDO'), (r'anuir', 'ANUÊNCIA'),
          (r'instaurar', 'PROCEDIMENTO INSTAURADO'), (r'revogar', 'REVOGADO'), (r'estabelecer', 'ESTABELECIDO'), (r'arquivar', 'ARQUIVADO'), (r'aplicar', 'APLICADO'),
          (r'manter', 'MANTIDO'), (r'reformar', 'REFORMADO'), (r'suspender', 'SUSPENSO'), (r'cancelar', 'CANCELADO'), (r'rejeitar', 'REJEITADO'), (r'acolher', 'ACOLHIDO'),
          (r'revisar', 'REVISADO'), (r'publicar', 'PUBLICAÇÃO DETERMINADA'), (r'registrar', 'REGISTRADO'), (r'tornar sem efeito', 'TORNADO SEM EFEITO'), (r'delegar', 'DELEGADO'),
          (r'conceder', 'CONCEDIDO'), (r'alterar', 'ALTERADO'), (r'atualizar', 'ATUALIZADO'), (r'excluir', 'EXCLUÍDO'), (r'incluir', 'INCLUÍDO'), (r'cientificar|dar ci[eê]ncia', 'CIENTIFICADO'),
          (r'julgar', 'JULGADO'), (r'converter', 'CONVERTIDO'), (r'solicitar|requisitar', 'SOLICITADO'), (r'submeter', 'SUBMETIDO'), (r'designar', 'DESIGNADO'), (r'retificar', 'RETIFICADO'),
          (r'anular', 'ANULADO'), (r'fixar', 'FIXADO'), (r'definir', 'DEFINIDO'), (r'indicar', 'INDICADO'), (r'adotar', 'ADOTADO'), (r'restituir|devolver', 'RESTITUÍDO'), (r'substituir', 'SUBSTITUÍDO'),
          (r'sobrestar', 'SOBRESTADO'), (r'dispensar', 'DISPENSADO'), (r'liberar', 'LIBERADO'), (r'instituir', 'INSTITUÍDO'), (r'reduzir', 'REDUZIDO'), (r'transferir', 'TRANSFERIDO'),
          (r'habilitar', 'HABILITADO'), (r'inabilitar', 'INABILITADO'), (r'adjudicar', 'ADJUDICADO'), (r'estender', 'ESTENDIDO'), (r'divulgar|disponibilizar', 'DIVULGAÇÃO DETERMINADA'),
          (r'abrir|aprovar a abertura', 'ABERTURA'), (r'reabrir', 'REABERTO'), (r'modificar', 'MODIFICADO'), (r'reiterar', 'REITERADO'),
          (r'impor|penalizar|multar', 'PENALIDADE IMPOSTA'), (r'repactuar', 'REPACTUADO'), (r'considerar', 'CONSIDERADO'), (r'dar andamento|prosseguir', 'PROSSEGUIMENTO'), (r'convocar', 'CONVOCADO'), (r'aprimorar', 'APRIMORADO'), (r'rescindir', 'RESCINDIDO'), (r'formalizar', 'FORMALIZADO'), (r'negar', 'NEGADO'), (r'flexibilizar', 'FLEXIBILIZADO'), (r'informar', 'INFORMADO'), (r'retirar', 'RETIRADO'), (r'resolver', 'RESOLVIDO'), (r'recalcular', 'RECALCULADO'), (r'promover', 'PROMOVIDO'), (r'enviar|remeter', 'ENVIADO'), (r'apresentar', 'APRESENTAÇÃO DETERMINADA'), (r'cumprir', 'CUMPRIMENTO DETERMINADO'), (r'afastar', 'AFASTADO'), (r'desconsiderar', 'DESCONSIDERADO'), (r'valorar|valorando', 'VALORADO'), (r'esclarecer', 'ESCLARECIDO'), (r'autorizar a publica', 'PUBLICAÇÃO AUTORIZADA'), (r'iniciar', 'INICIADO'), (r'realizar', 'REALIZAÇÃO DETERMINADA'), (r'ajustar', 'AJUSTADO'), (r'tornar', 'TORNADO'), (r'sanear', 'SANEADO'), (r'implementar', 'IMPLEMENTAÇÃO DETERMINADA'), (r'proceder', 'PROVIDÊNCIA DETERMINADA'), (r'proibir|vedar', 'VEDADO'), (r'permitir', 'PERMITIDO'), (r'reconsiderar', 'RECONSIDERADO'), (r'excepcionalizar', 'EXCEPCIONALIZADO'), (r'deslocar', 'DESLOCADO'), (r'notificar|comunicar', 'NOTIFICADO'), (r'(?<=pelo )arquivamento', 'ARQUIVADO'), (r'atribuir', 'ATRIBUÍDO'), (r'facultar', 'FACULTADO'), (r'(?<=pela )definicao', 'DEFINIDO'), (r'(?<=pela )fixacao', 'FIXADO'), (r'xxnuncaxx', 'X')]
def rotulos(acao, pref=''):
    a = re.sub(r'“[^”]*”', ' ', acao)
    if ':' in a[:500]: a = a.split(':')[0]
    n = norm(a[:700]); m0 = CONN.search(n); lim = m0.start() if m0 else len(n)
    ach = []
    for pat, lab in VERBOS:
        for m in re.finditer(r'\b' + pat + r'\b', n[:lim]):
            ant = n[max(0, m.start() - 4):m.start()]
            if lab == 'CONHECIDO' and ant.endswith('nao '): continue
            if lab == 'DEFERIDO' and n[max(0, m.start() - 2):m.start()] == 'in': continue
            if lab == 'PROVIMENTO' and ant.endswith('nao '): continue
            if lab == 'APLICADO':
                if n[max(0, m.start() - 3):m.start()] in ('ao ', 'ra ') or n[max(0, m.start() - 5):m.start()] == 'para ': continue
                lab = 'SANÇÃO APLICADA' if re.search(r'multa|penalidade|sancao', n[m.end():m.end() + 60]) else 'APLICADO'
            if lab == 'PROVIMENTO' and 'provimento parcial' in m[0] or (lab == 'PROVIMENTO' and 'parcial' in m[0]): lab = 'PROVIMENTO PARCIAL'
            if lab == 'DECLARADO':
                seg = n[m.end():m.end() + 70]
                lab = 'DECLARADA A UTILIDADE PÚBLICA' if 'utilidade publica' in seg else ('INSUBSISTENTE' if 'insubsist' in seg else ('PREJUDICADO' if 'prejudic' in seg else ('EXTINTO' if 'extint' in seg else 'DECLARADO')))
            if lab == 'PROCEDIMENTO INSTAURADO':
                seg = n[m.end():m.end() + 60]
                lab = 'CONSULTA PÚBLICA INSTAURADA' if 'consulta publica' in seg else ('AUDIÊNCIA PÚBLICA INSTAURADA' if 'audiencia publica' in seg else ('TOMADA DE SUBSÍDIOS INSTAURADA' if 'subsidio' in seg else ('PROCESSO ADMINISTRATIVO INSTAURADO' if 'processo' in seg else 'PROCEDIMENTO INSTAURADO')))
            ach.append((m.start(), lab)); break
    nc = [p for p, l in ach if l == 'CONHECIDO']
    for m in re.finditer(r'\bnao conhecer\b', n[:lim]): ach.append((m.start(), 'NÃO CONHECIDO'))
    if re.search(r'\bnao conhecer\b', n[:lim]):
        ach = [(p, l) for p, l in ach if not (l == 'CONHECIDO' and n[max(0, p - 4):p] == 'nao ')]
    ach.sort()
    DIRETIVOS = ('DETERMINAÇÃO', 'RECOMENDAÇÃO', 'ENCAMINHADO', 'OFICIADO', 'SOLICITADO', 'FACULTADO', 'NOTIFICADO', 'CIENTIFICADO', 'ATRIBUÍDO')
    cort = next((i for i, (_, l) in enumerate(ach) if l in DIRETIVOS), None)
    if cort is not None: ach = ach[:cort + 1]      # o que vem depois de "determinar/encaminhar ..." descreve o que OUTRO deve fazer
    res = []
    for _, l in ach:
        if l not in res: res.append(l)
    if 'PROVIMENTO NEGADO' in res and 'NEGADO' in res: res.remove('NEGADO')
    if 'DECLARADO' in res and 'PERDA DE OBJETO' in res: res.remove('DECLARADO'); res[res.index('PERDA DE OBJETO')] = 'PERDA DE OBJETO DECLARADA'
    if 'PERDA DE OBJETO' in res and 'EXTINTO' in res: res.remove('PERDA DE OBJETO'); res[res.index('EXTINTO')] = 'EXTINTO POR PERDA DE OBJETO'
    if res: return res[:4]
    if pref:
        pr = rotulos(pref)
        if pr and not pr[0].startswith('DECIDIU'): return pr
    pal = plano(re.sub(r'^(?:decidiu\s+)?', '', acao)).split()
    return [' '.join(pal[:7]).upper() + ('…' if len(pal) > 7 else '')]

# ---------------------------------------------------------------- votos por parte
def curto(n): return n.split()[0] + ' ' + n.split()[-1] if n else ''
def voto_parte(d, pt, c):
    """-> (rotulo, proveniencia) do diretor d na parte pt (deliberacao decidida)"""
    if d in c['impedidos']: return 'IMPEDIDO (declarou suspeição/impedimento)', 'nominal'
    if d in c['nao_part']: return 'NÃO PARTICIPOU (voto subsistente de ex-diretor; art. 54 NO-1)', 'nominal'
    if d in c['ausentes']:
        x = c['ausentes'][d]
        if d in pt['vencidos']: x = (x + '; ' if x else '') + 'vencido'
        return 'AUSENTE (não participou da votação' + (f'; {x}' if x else '') + ')', 'nominal'
    rel = c['relator']
    if d == rel: return ('RELATOR (voto vencido)' if d in pt['vencidos'] else 'RELATOR (voto proferido)'), 'nominal'
    if d in pt['vencidos']: return 'DIVERGIU', 'nominal'
    if d == pt.get('lider') and pt.get('lider_tipo') in ('div', 'vista') and (pt['lider_tipo'] == 'div' or rel in pt['vencidos']) and pt['modo'] == 'maioria': return 'DIVERGIU', 'nominal'
    if d == pt.get('lider') and pt.get('lider_tipo') in ('vista', 'div') and pt['modo'] in ('unanimidade', 'maioria'): return 'ACOMPANHOU', 'nominal'   # autor do voto-vista/divergência que prevaleceu sem relator vencido: citado nominalmente
    if pt['modo'] == 'unanimidade': return 'ACOMPANHOU', 'inferido'
    if pt['modo'] == 'maioria':
        if pt['vencidos']: return 'ACOMPANHOU (por exclusão)', 'inferido'
        return 'REVISAR (por maioria sem vencido nomeado)', 'REVISAR'
    return 'ACOMPANHOU', 'REVISAR'
def romanos(ps): return ' e '.join(ps) if len(ps) <= 2 else ', '.join(ps[:-1]) + ' e ' + ps[-1]
def resume(lbls, provs, partes_nomes):
    """lbls/provs por parte -> (voto, proveniencia, voto_por_parte)"""
    det = ' | '.join(f'{pn}: {l}' for pn, l in zip(partes_nomes, lbls)) if len(lbls) > 1 else f'única: {lbls[0]}'
    if len(set(lbls)) == 1:
        l = lbls[0]
        if len(lbls) > 1 and l.startswith('ACOMPANHOU'): l = 'ACOMPANHOU todas as partes'
        return l, ('nominal' if all(p == 'nominal' for p in provs) else ('REVISAR' if 'REVISAR' in provs else 'inferido')), det
    div = [pn for pn, l in zip(partes_nomes, lbls) if l.startswith('DIVERGIU')]
    ven = [pn for pn, l in zip(partes_nomes, lbls) if 'voto vencido' in l]
    base = next((l for l in lbls if l.startswith('RELATOR') or l.startswith('REDATOR')), None)
    if div: v = f'DIVERGIU na parte {romanos(div)}' if len(div) == 1 else f'DIVERGIU nas partes {romanos(div)}'
    elif ven: v = f'{base.split(" (")[0]} (voto vencido na parte {romanos(ven)})'
    elif base: v = base
    else:
        outros = [l for l in lbls if not l.startswith('ACOMPANHOU')]
        v = outros[0] if outros else 'ACOMPANHOU todas as partes'
    prov = 'REVISAR' if 'REVISAR' in provs else ('nominal' if (div or ven or (base and base == v)) else 'inferido')
    return v, prov, det

INT_PAT = re.compile(r'(?:interpost[oa]s?|protocolad[oa]s?|apresentad[oa]s?|formulad[oa]s?|requerid[oa]s?|solicitad[oa]s?|impetrad[oa]s?) (?:pela|pelo|pelas|pelos|por|em nome d[ao]s?|em nome de)\s+(.+?)(?:,? em face|,? contra| com vistas|,? em oposi|,? para |,? referente|,? relativ|,? visando|,? que |,? a fim| junto|, |\. |$)', re.I)
UNI_PAT = re.compile(r'Superintend[êe]ncia[^–\-]{3,140}?[–-]\s*(S[A-Z]{1,3})\b')
def interessado(assunto, dec):
    for src in (assunto, dec):
        m = INT_PAT.search(src)
        if m and 3 < len(m[1]) < 200 and not re.match(r'(?:o |a )?(?:diretor|diretoria)', norm(m[1])): return plano(m[1]).strip(' .')
    return ''
def unidade(assunto, dec):
    m = UNI_PAT.search(assunto) or UNI_PAT.search(dec); return m[1] if m else ''

# ---------------------------------------------------------------- montagem
R, D, V = [], [], []
por_reuniao = collections.OrderedDict()
for r in rows:
    por_reuniao.setdefault(r['IdeReuniao'], []).append(r)
def chave(ide): m = re.match(r'(\d+)/2026 - (\w+)', ide); return (m[2], int(m[1]))
reuniao_data = {i: v[0]['DatReuniao'] for i, v in por_reuniao.items()}
pauta_so = [i for i, v in por_reuniao.items() if all(not x['DscResultadoJulgamento'] for x in v)]   # pauta publicada, sem resultado de ata
extras_log, revisar_log, sem_vista_log, rel_dif, xref_log, trunc_log, lider_venc_log = [], [], [], [], [], [], []
PRE = {}      # (ide, NumOrdem) -> (partes, ctx)  [pre-passagem: permite referenciar decisoes de circuitos anteriores]
for r_ in rows:
    PRE[(r_['IdeReuniao'], r_['NumOrdem'])] = analisa(r_['TxtDecisaoJulgamento'], nome_col(r_['NomDiretorRelator']), r_['DscResultadoJulgamento'])
def proc1(r_): return nup(re.split(r'\s*-\s*', r_['NumProcesso'].strip())[0])
IDX_PROC = {(r_['IdeReuniao'], proc1(r_)): r_ for r_ in rows}
def completa_xref(it, partes, ctx):
    """(1) 'ratificar a decisão proferida no Nº Circuito (item K)' sem vencidos: herda modo/vencidos da decisão ratificada;
    (2) 'permanecendo válidos os votos proferidos no Nº Circuito': herda as posições nominais do item do mesmo processo naquele circuito"""
    dec = plano(it['TxtDecisaoJulgamento']); n = norm(dec); did = f"{tag_de(it['IdeReuniao'])}-{it['NumOrdem']}"
    m = re.search(r'ratificar a decis[aã]o proferida no (\d+)[ºo] circuito deliberativo[^()]*\(item (\d+)\)', dec, re.I)
    if m and any(p_['modo'] == 'maioria' and not p_['vencidos'] for p_ in partes):
        ref = PRE.get((f'{int(m[1])}/2026 - RPC', m[2]))
        if ref:
            vs = [v for p_ in ref[0] if p_['modo'] == 'maioria' for v in p_['vencidos']]
            for p_ in partes:
                if p_['modo'] == 'maioria' and not p_['vencidos'] and vs: p_['vencidos'] = list(dict.fromkeys(vs)); p_['xref'] = f'vencidos herdados da decisão ratificada (RPC{int(m[1])} item {m[2]})'
            xref_log.append((did, f'RPC{int(m[1])}-{m[2]}', 'vencidos herdados'))
    m = re.search(r'perman\w+ v[aá]lidos os votos proferidos n[ao] (\d+)[ºªo] (circuito|reuni)', dec, re.I)
    if m and not ctx['camps']:
        ref = IDX_PROC.get((f"{int(m[1])}/2026 - {'RPC' if m[2].lower() == 'circuito' else 'RPO'}", proc1(it)))
        if ref:
            rp_, rc_ = PRE[(ref['IdeReuniao'], ref['NumOrdem'])]
            if rc_['camps']: ctx['camps'] = [dict(k, txt='(herdado de %s-%s) ' % (tag_de(ref['IdeReuniao']), ref['NumOrdem']) + k['txt']) for k in rc_['camps']]; ctx['xref'] = f'posições herdadas de {tag_de(ref["IdeReuniao"])}-{ref["NumOrdem"]}'; xref_log.append((did, f'{tag_de(ref["IdeReuniao"])}-{ref["NumOrdem"]}', 'posições herdadas'))
    return partes, ctx
os.makedirs('texto_aneel', exist_ok=True)
for ide in sorted(por_reuniao, key=lambda i: (reuniao_data[i], i)):
    tag = tag_de(ide); data = reuniao_data[ide]; kind = tag[:3]; num = int(tag[3:])
    ros = roster(data)
    itens = sorted(por_reuniao[ide], key=lambda x: int(x['NumOrdem'] or 0))
    if ide in pauta_so:
        R.append({'reuniao': tag, 'titulo': f'{num}{"º" if kind == "RPC" else "ª"} {ORD[kind]} da Diretoria da ANEEL ({dmy(data)}) - pauta publicada; ata/resultados ainda não publicados', 'tipo': TIPO[kind], 'data': data,
                  'presentes': [], 'ausentes': [], 'obs': f'Realizada em {dmy(data)}; a fonte tem só a pauta ({len(itens)} itens) e nenhum resultado: fora de deliberacoes/votos até a ata sair.'})
        continue
    txt_dump = []
    aus_item = collections.Counter()
    for it in itens:
        n_item = it['NumOrdem']; dec = plano(it['TxtDecisaoJulgamento']); dec_par = '\n'.join(plano(p_) for p_ in paragrafos(it['TxtDecisaoJulgamento'])); col = it['DscResultadoJulgamento']
        relator = nome_col(it['NomDiretorRelator'])
        procs = [nup(x) for x in re.split(r'\s*-\s*', it['NumProcesso'].strip()) if x.strip()] or ['']
        partes, c = PRE[(ide, n_item)]; partes, c = completa_xref(it, partes, c); c['relator'] = relator
        lider_venc_log.extend([did_ for did_ in [f'{tag}-{n_item}'] if any(p_.get('lider') and p_['lider'] in p_['vencidos'] for p_ in partes)])
        did = f'{tag}-{n_item}'
        txt_dump.append(f'### {did} | processo {"; ".join(procs)} | relator {relator} | resultado(ata): {col}\n{dec}\n')
        # ---- tipo do item e votos
        obs = []
        extras = []
        for x in [relator] + [v for p_ in partes for v in p_['vencidos']] + [p_['lider'] for p_ in partes if p_['lider']] + c['vista'] + c['impedidos'] + list(c['ausentes']) + [k['lider'] for k in c['camps']] + [s for k in c['camps'] for s in k['seguidores']]:
            if x and x not in ros and x not in extras: extras.append(x)
        # ex-diretor so conta se for papel substantivo (relator, vencido, lider, vista); seguidores/camps de ex-diretor so em vista/nao-deliberado
        votantes = ros + [x for x in extras if x == relator or any(x in p_['vencidos'] or x == p_['lider'] for p_ in partes) or x in c['vista'] or x in c['impedidos'] or x in c['ausentes'] or (col in ('Não Deliberado', 'Pedido de Vista') and any(x == k['lider'] or x in k['seguidores'] for k in c['camps']))]
        for x in votantes:
            if x not in ros: extras_log.append((did, x))
        L = {}      # diretor -> (voto, prov, por_parte)
        resultado, tipo_item = '', 'Deliberação'
        if re.search(r'aus[êe]ncia de 3 \(tr[êe]s\) votos', dec) and col != 'Não Deliberado': col = 'Não Deliberado'; obs.append('ata (dataset): ' + it['DscResultadoJulgamento'] + ', mas o texto registra deliberação suspensa por ausência de 3 votos convergentes')
        if len(it['TxtDecisaoJulgamento']) >= 3990:
            obs.append('texto da decisão TRUNCADO na fonte (limite de 4.000 caracteres do campo): impedimentos/ausências/vistas ao final podem faltar'); trunc_log.append(did)
        if col in ('Retirado da Pauta', 'Pedido de Vista + Retirado de Pauta') or (not partes and c['retirada']):
            tipo_item = 'Retirada de pauta'; resultado = 'RETIRADO DE PAUTA' + (' (após pedido de vista)' if 'Vista' in col else '') + (' (na fase de debate dos Diretores)' if 'debate' in norm(dec) else '')
            for d in votantes: L[d] = ('SEM VOTO (retirado de pauta)', 'nominal', 'única: retirado de pauta')
        elif col == 'Destacado no Circuito Deliberativo':
            tipo_item = 'Retirada de pauta'; q = ', '.join(c['destaque'] or ['?'])
            resultado = f'DESTACADO DO CIRCUITO DELIBERATIVO a pedido de {q} (vai à pauta da próxima RPO; sem deliberação no circuito)'
            for d in votantes: L[d] = ('SEM VOTO (retirado de pauta)', 'nominal', f'única: destacado do circuito por {q}')
            if not c['destaque']: revisar_log.append((did, 'destaque sem solicitante identificado'))
        elif col == 'Pedido de Vista':
            tipo_item = 'Vista'; pedinte = c['vista']
            resultado = 'PEDIDO DE VISTA' + (' COLETIVA' if c['coletiva'] else '') + f' ({", ".join(pedinte) if pedinte else "pedinte não identificado"})'
            if not pedinte: revisar_log.append((did, 'vista sem pedinte identificado')); sem_vista_log.append(did)
            votou_antes = {}
            for k in c['camps']:
                votou_antes[k['lider']] = 'lider'
                for s in k['seguidores']: votou_antes.setdefault(s, 'seg')
            for d in votantes:
                if d in c['impedidos']: L[d] = ('IMPEDIDO (declarou suspeição/impedimento)', 'nominal', 'única: impedido'); continue
                if d in c['ausentes']: L[d] = ('AUSENTE (não participou da votação)', 'nominal', 'única: ausente'); continue
                if d in pedinte: L[d] = ('PEDIU VISTA' + (' (vista coletiva)' if c['coletiva'] else ''), 'nominal', 'única: pediu vista'); continue
                if d == relator: L[d] = (('RELATOR (voto proferido; vista concedida)', 'nominal', 'única: relator votou; vista concedida') if d in votou_antes else ('RELATOR (vista concedida; sem voto proferido na ata)', 'nominal', 'única: relator; vista concedida')); continue
                if d in votou_antes: L[d] = ('VOTOU (antes da vista)', 'nominal', 'única: votou antes da vista'); continue
                if c['coletiva']: L[d] = ('VISTA COLETIVA (aderiu ao pedido de vista)', 'nominal', 'única: vista coletiva'); continue
                L[d] = ('SEM VOTO AINDA (vista pendente)', 'inferido', 'única: aguardando o voto-vista')
        elif col == 'Pedido de Vista + Prorrogação':
            tipo_item = 'Vista'; pt = partes[0] if partes else {'modo': 'sem registro', 'vencidos': [], 'lider': None, 'lider_tipo': None, 'acao': dec, 'parte': 'única'}
            m_pz = re.search(r'prazo adicional de (\d+)', pt['acao']); m_ate = re.search(r'at[ée] a Reuni[ãa]o P[úu]blica do dia (\d+ de \w+ de \d{4})', pt['acao'])
            resultado = 'PRORROGAÇÃO DO PRAZO DE VISTA — ' + (f'PRAZO ADICIONAL DE {m_pz[1]} DIAS CONCEDIDO PARA O VOTO-VISTA' if m_pz else (f'PRAZO DE VISTA PRORROGADO (processo retorna até a RPO de {m_ate[1]})' if m_ate else 'PRAZO DE VISTA PRORROGADO')) + f' ({pt["modo"]}' + (f'; vencido(s): {", ".join(pt["vencidos"])}' if pt['vencidos'] else '') + ')'
            for d in votantes:
                if d in pt['vencidos']: L[d] = ('DIVERGIU', 'nominal', 'única: DIVERGIU (vencido na prorrogação da vista)'); continue
                if d == relator: L[d] = ('RELATOR (prazo de vista prorrogado)', 'nominal', 'única: relator do processo; prazo de vista prorrogado'); continue
                lb, pv = voto_parte(d, pt, c)
                L[d] = (lb, pv, f'única: {lb}')
        elif col == 'Não Deliberado':
            tipo_item = 'Deliberação'; resultado = 'NÃO DELIBERADO — ausência de 3 votos convergentes (art. 8º, §3º, Anexo I do Decreto 2.335/1997); processo suspenso e volta à pauta da 1ª RPO seguinte'
            if not c['camps']: revisar_log.append((did, 'não deliberado sem posições nominais'))
            for d in votantes:
                if d in c['impedidos']: L[d] = ('IMPEDIDO (declarou suspeição/impedimento)', 'nominal', 'única: impedido'); continue
                if d in c['ausentes']: L[d] = ('AUSENTE (não participou da votação)', 'nominal', 'única: ausente'); continue
                lb = None
                for k_i, k in enumerate(c['camps']):
                    if d == k['lider']:
                        lb = 'RELATOR (voto proferido)' if d == relator else ('DIVERGIU' if k_i > 0 or c['camps'][0]['lider'] != relator else 'ACOMPANHOU'); break
                    if d in k['seguidores']: lb = 'ACOMPANHOU' if k_i == 0 else 'DIVERGIU'; break
                if lb: L[d] = (lb + ('' if lb.startswith('RELATOR') else ''), 'nominal', f'única: {lb} (deliberação sem maioria)')
                else: L[d] = ('SEM VOTO REGISTRADO (deliberação suspensa)', 'REVISAR', 'única: posição não identificada'); revisar_log.append((did, f'posição de {curto(d)} não identificada (não deliberado)'))
        else:
            # Deliberado / Parcialmente Deliberado
            if not partes:
                revisar_log.append((did, 'sem parágrafo de decisão "A Diretoria ..."')); partes = [{'marca': None, 'acao': dec, 'modo': 'sem registro', 'vencidos': [], 'lider': None, 'lider_tipo': None, 'parte': 'única'}]
            pns = [p_['parte'] for p_ in partes]
            res_p = []
            for p_ in partes:
                s_ = ' + '.join(rotulos(p_['acao'], p_.get('pref', ''))) + f' ({p_["modo"]}' + (f'; vencido(s): {", ".join(p_["vencidos"])}' if p_['vencidos'] else '') + ')'
                res_p.append(s_)
            resultado = res_p[0] if len(partes) == 1 else ' | '.join(f'{pn}) {s_}' for pn, s_ in zip(pns, res_p))
            hp = next((p_.get('pref') for p_ in partes if p_.get('pref')), '')
            if hp:
                lh = rotulos(hp); lp = {l_ for p_ in partes for l_ in rotulos(p_['acao'], p_.get('pref', ''))}
                if not set(lh) <= lp: resultado = ' + '.join(lh) + ' → ' + resultado
            if col == 'Parcialmente Deliberado': obs.append('ata: Parcialmente Deliberado (parte da matéria permanece pendente)')
            for d in votantes:
                lbs, pvs = zip(*[voto_parte(d, p_, c) for p_ in partes])
                v, pv, det = resume(list(lbs), list(pvs), pns)
                L[d] = (v, pv, det)
        for d, (v, pv, det) in L.items():
            if v.startswith('AUSENTE') and d in ros: aus_item[d] += 1
        # ---- registros
        for d in votantes:
            v, pv, det = L[d]
            ex = ' [ex-diretor; voto proferido em reunião anterior e subsistente]' if d not in ros else ''
            if d in c['ressalva']: ex += ' [ressalva: apresentou fundamentação diversa do relator, sem divergir do resultado]'
            if c.get('xref'): ex += f' [{c["xref"]}]'
            xr = [p_.get('xref') for p_ in partes if p_.get('xref')]
            if xr: ex += f' [{xr[0]}]'
            V.append({'reuniao': tag, 'data': data, 'processo': procs[0], 'deliberacao': did, 'diretor': d, 'voto': v, 'proveniencia': pv, 'voto_por_parte': det + ex})
            if pv == 'REVISAR': revisar_log.append((did, f'{curto(d)}: {v}'))
        if relator and relator != None:
            tx_rel = [k['lider'] for k in c['camps'] if 'relator' in norm(k['txt'][:80])]
        # relator citado no texto x coluna
        m_rel = re.search(r'acompanhando o voto d[oa] Diretor[a]?-Relator[a]?,\s*([^,]+),', dec)
        if m_rel and nomes(m_rel[1]) and nomes(m_rel[1])[0] != relator: rel_dif.append((did, relator, m_rel[1]))
        pr_list = partes if tipo_item in ('Deliberação',) and col not in ('Não Deliberado',) else []
        if tipo_item == 'Vista' and col == 'Pedido de Vista + Prorrogação': pr_list = partes
        D.append({'reuniao': tag, 'data': data, 'processo': procs[0], 'deliberacao': did, 'item_n': n_item, 'relator': relator, 'interessado': interessado(it['TxtAssunto'], dec),
                  'assunto': plano(it['TxtAssunto']), 'resultado': resultado, 'voto_doc': '', 'decisao_texto': dec_par, 'tipo_item': tipo_item, 'secao': plano(it['NomClassificacaoAssunto']),
                  'unidade': unidade(it['TxtAssunto'], dec),
                  'partes': [dict({'parte': p_['parte'], 'acao': p_['acao'], 'modo': p_['modo'], 'vencidos': p_['vencidos']}, **({'nota': '; '.join(x_ for x_ in (p_.get('nota'), p_.get('xref')) if x_)} if (p_.get('nota') or p_.get('xref')) else {})) for p_ in pr_list],
                  'ato': plano(f"{it['NomTipoAtoAdministrativo']} nº {it['NumAtoAdministrativo']}") if it['NumAtoAdministrativo'] else '', 'situacao_ata': col,
                  'processos_do_item': procs, 'obs': '; '.join(obs)})
    open(f'texto_aneel/{tag}.txt', 'w', encoding='utf8').write(f'# {tag} - {dmy(data)} - {ide}\n# Fonte: Dados Abertos ANEEL (pautas-atas-reunioes-publicas-diretoria.csv); ata prévia, sujeita a ajustes até a assinatura\n\n' + '\n'.join(txt_dump))
    aus_txt = '; '.join(f'{curto(d)} ({n} itens)' for d, n in aus_item.items())
    R.append({'reuniao': tag, 'titulo': f'{num}{"º" if kind == "RPC" else "ª"} {ORD[kind]} da Diretoria da ANEEL ({dmy(data)})', 'tipo': TIPO[kind], 'data': data, 'presentes': ros, 'ausentes': [],
              'obs': 'Colegiado inferido (presença nominal da reunião não consta da fonte coletada; ata em PDF bloqueada); ' + (f'ausência registrada só por item: {aus_txt}; ' if aus_txt else 'sem ausência registrada em item; ') + 'ata prévia, sujeita a ajustes até a assinatura.'})

# ---------------------------------------------------------------- QA
Q, COB, PEN, NF = [], [], [], []
def qa(chk, esp, obt, ok, det=''): Q.append([AG, chk, esp, obt, 'OK' if ok else 'DIVERGE', det])
realizadas = [i for i in por_reuniao if i not in pauta_so]
# (a) atas listadas x baixadas x lidas
ide_rr = {x['ide']: x for x in inv['dataset_reunioes_2026']}
pdf_ok = [k for k, v in man.items() if v.get('ok') and re.search(r'ata_diretoria|noticias_area|reuniaodiretoria', v.get('url', ''))]
qa('(a) Atas 2026 listadas (dataset de reuniões: executadas) × listadas no dataset de itens × atas lidas (texto de decisão)',
   f"{sum(1 for x in inv['dataset_reunioes_2026'] if x['situacao'] == 'Executada')} executadas", f'{len(realizadas)} com resultado lido',
   sum(1 for x in inv['dataset_reunioes_2026'] if x['situacao'] == 'Executada') == len(realizadas) + sum(1 for i in pauta_so if ide_rr.get(i, {}).get('situacao') == 'Executada'),
   f'{len(pauta_so)} reunião(ões) só com pauta: {pauta_so}. Atas em PDF baixadas: {len(pdf_ok)} (www2/reuniaodiretoria bloqueados; a fonte lida é o texto de ata do dataset de dados abertos)')
ids_rr = {x['ide'] for x in inv['dataset_reunioes_2026']}
qa('(a2) Reuniões do dataset de reuniões × reuniões do dataset de itens (2 arquivos independentes)', len(ids_rr), len(por_reuniao), ids_rr == set(por_reuniao), f'só em um: {sorted(ids_rr ^ set(por_reuniao))}')
# (b) calendario oficial x atas
cal_rpo, cal_cir = inv['calendario_oficial']['rpo'], inv['calendario_oficial']['circuitos_cdpo']
hoje = HOJE
datas_rpo = sorted(reuniao_data[i] for i in por_reuniao if '- RPO' in i); datas_rpc = sorted(reuniao_data[i] for i in por_reuniao if '- RPC' in i)
cal_rpo_pass = [d for d in cal_rpo if d <= hoje]; cal_cir_pass = [d for d in cal_cir if d <= hoje]
qa('(b) RPOs do calendário oficial (Portaria 7.014/2025) = denominador', 25, len(cal_rpo), len(cal_rpo) == 25, f'gov.br/calendario; {len(cal_cir)} circuitos CDPO no ano')
qa('(b) RPOs do calendário já passadas × RPOs com ata/pauta no dataset', len(cal_rpo_pass), len(datas_rpo), len(cal_rpo_pass) == len(datas_rpo), f'ata com resultado: {len(datas_rpo) - len([i for i in pauta_so if "RPO" in i])}; só pauta: {[i for i in pauta_so if "RPO" in i]}')
dif_rpo = sorted(set(cal_rpo_pass) ^ set(datas_rpo))
qa('(b) Datas das RPOs: calendário × dataset (mesma data)', 0, len(dif_rpo), not dif_rpo, f'divergentes: {dif_rpo} (calendário 2026-08-25 × dataset 2026-08-24 → RPO 17; ver pendências)')
dif_c = sorted(set(cal_cir_pass) ^ set(datas_rpc))
qa('(b) Circuitos CDPO do calendário já passados × RPC no dataset', len(cal_cir_pass), len(datas_rpc), not dif_c, f'divergentes: {dif_c}')
exp_extra = [i for i in por_reuniao if '- RPE' in i]
COB.append([AG, 'RPOs do calendário oficial (denominador)', 25, f'{len(cal_rpo_pass)} já passadas ({len(datas_rpo)} no dataset: {len(datas_rpo) - len([i for i in pauta_so if "RPO" in i])} com ata + {len([i for i in pauta_so if "RPO" in i])} só pauta); {25 - len(cal_rpo_pass)} futuras: {[dmy(d) for d in cal_rpo if d > hoje]}'])
COB.append([AG, 'Circuitos CDPO (calendário)', len(cal_cir), f'{len(cal_cir_pass)} já passados, todos com ata/resultado no dataset; futuros: {[dmy(d) for d in cal_cir if d > hoje]}'])
COB.append([AG, 'Reuniões extraordinárias (RPE; fora do calendário ordinário)', len(exp_extra), ', '.join(sorted(exp_extra))])
# (c) itens x ancoras
sem_gap, gaps = 0, []
for ide, v in por_reuniao.items():
    if ide in pauta_so: continue
    ns = sorted(int(x['NumOrdem']) for x in v); mx = max(ns)
    falt = [i for i in range(1, mx + 1) if i not in ns]; dup = [i for i, k in collections.Counter(ns).items() if k > 1]
    if falt or dup: gaps.append((tag_de(ide), falt, dup))
qa('(c) Numeração dos itens de pauta/ata sem buraco nem duplicidade (NumOrdem 1..N por reunião)', 0, len(gaps), not gaps, f'reuniões com buraco/duplicata: {gaps}')
n_itens_csv = sum(len(v) for i, v in por_reuniao.items() if i not in pauta_so)
qa('(c) Itens lidos (D) × linhas do CSV das reuniões com ata', n_itens_csv, len(D), n_itens_csv == len(D))
ds = inv['dataset_pautas_atas']
cmp_ds = [(d, n, ds['itens_por_data_datastore'].get(d)) for d, n in ds['itens_por_data_csv'].items() if ds['itens_por_data_datastore'].get(d) and ds['itens_por_data_datastore'].get(d) != n]
so_csv = [d for d, n in ds['itens_por_data_csv'].items() if not ds['itens_por_data_datastore'].get(d)]
qa('(c) Itens por data: CSV × API datastore do mesmo portal (contador independente; datas presentes nos dois)', len(ds['itens_por_data_csv']) - len(so_csv), len(ds['itens_por_data_csv']) - len(so_csv) - len(cmp_ds), not cmp_ds,
   f'divergências: {cmp_ds}; datas só no CSV (datastore ainda não atualizado; CSV de 02/10/2026): {so_csv}')
# ancoras no TEXTO (contagem independente, por item): paragrafos/sentencas "A Diretoria ..." e marcadores romanos de nivel 1 x partes emitidas
bad, ancoras = [], 0
for d_ in D:
    if d_['tipo_item'] == 'Retirada de pauta' or d_['situacao_ata'] == 'Não Deliberado' or (d_['tipo_item'] == 'Vista' and not d_['partes']): continue
    sents = [x for p_ in paragrafos(d_['decisao_texto']) for x in SENT.split(p_) if eh_decisao(x)]
    esp = sum(max(1, len(marcadores(x))) for x in sents)
    ancoras += 1
    if len(d_['partes']) != max(1, esp): bad.append((d_['deliberacao'], len(d_['partes']), esp))
qa('(c) Itens decididos: nº de partes emitidas × âncoras do texto (marcadores (i),(ii).. ou sentenças "A Diretoria ... decidiu")', ancoras, ancoras - len(bad), not bad, f'divergentes: {bad[:8]}')
def txt_dec(d_): return ' '.join(x for p_ in paragrafos(d_['decisao_texto']) for x in SENT.split(p_) if eh_decisao(x))
it_maioria_txt = {d_['deliberacao'] for d_ in D if 'por maioria' in norm(txt_dec(d_)) and d_['tipo_item'] != 'Retirada de pauta'}
it_maioria_p = {d_['deliberacao'] for d_ in D if any(p_['modo'] == 'maioria' for p_ in d_['partes'])}
qa('(c) Itens com "por maioria" nas sentenças de decisão × itens com alguma parte modo=maioria', len(it_maioria_txt), len(it_maioria_txt & it_maioria_p), it_maioria_txt == it_maioria_p, f'só no texto: {sorted(it_maioria_txt - it_maioria_p)[:6]}; só nas partes: {sorted(it_maioria_p - it_maioria_txt)[:6]}')
it_unan_txt = {d_['deliberacao'] for d_ in D if 'por unanimidade' in norm(txt_dec(d_)) and d_['tipo_item'] != 'Retirada de pauta'}
it_unan_p = {d_['deliberacao'] for d_ in D if any(p_['modo'] == 'unanimidade' for p_ in d_['partes'])}
qa('(c) Itens com "por unanimidade" nas sentenças de decisão × itens com alguma parte modo=unanimidade', len(it_unan_txt), len(it_unan_txt & it_unan_p), it_unan_txt == it_unan_p, f'só no texto: {sorted(it_unan_txt - it_unan_p)[:6]}; só nas partes: {sorted(it_unan_p - it_unan_txt)[:6]}')
it_venc_txt = {d_['deliberacao'] for d_ in D if re.search(r'\bvencid', norm(txt_dec(d_)))}
it_venc_p = {d_['deliberacao'] for d_ in D if any(p_['vencidos'] and 'herdados' not in p_.get('nota', '') for p_ in d_['partes'])}
qa('(c) Itens com "vencido(s)" nas sentenças de decisão × itens com vencido nomeado nas partes', len(it_venc_txt), len(it_venc_txt & it_venc_p), it_venc_txt == it_venc_p, f'só no texto: {sorted(it_venc_txt - it_venc_p)[:6]}; só nas partes: {sorted(it_venc_p - it_venc_txt)[:6]}')
qa('(d) Quem lidera o voto vencedor ("acompanhando o voto/divergência de X") nunca consta entre os vencidos da mesma parte', len(D), len(D) - len(lider_venc_log), not lider_venc_log, f'{lider_venc_log[:6]}')
# vencidos nomeados (texto) x linhas DIVERGIU/RELATOR vencido nos votos
vot_div = collections.defaultdict(set)
for v in V:
    if v['voto'].startswith('DIVERGIU') or 'voto vencido' in v['voto'] or (v['voto'].startswith('AUSENTE') and 'vencido' in v['voto']): vot_div[v['deliberacao']].add(v['diretor'])
dif_v = [d_['deliberacao'] for d_ in D if {x for p_ in d_['partes'] for x in p_['vencidos']} - vot_div[d_['deliberacao']]]
qa('(e) Todo vencido nomeado numa parte tem voto DIVERGIU/RELATOR (voto vencido) na linha do diretor', len(it_venc_p), len(it_venc_p) - len(dif_v), not dif_v, f'{dif_v[:6]}')
if os.path.exists('aneel_auditoria.json'):
    aud = json.load(open('aneel_auditoria.json'))['final']
    qa('(g) Auditoria manual de 40 itens vs texto da ata (amostra final, semente 31415): relator / resultado / partes / vencidos / votos', '>=95% por campo',
       f"relator {aud['relator']:.0%}, resultado {aud['resultado']:.0%}, partes {aud['partes']:.0%}, vencidos {aud['vencidos']:.0%}, votos {aud['votos_resolvidos']:.0%} (+2 REVISAR)",
       min(aud[k] for k in ('relator', 'resultado', 'partes', 'vencidos', 'votos_resolvidos')) >= 0.95, 'detalhe e 4 rodadas anteriores em aneel_auditoria.json (scripts/aneel_auditoria.py)')
# (d) presenca: citados x presentes
ros_por = {r['reuniao']: set(r['presentes']) for r in R}
fora = collections.Counter()
for d_ in D:
    cit = set([d_['relator']] + [v for p_ in d_['partes'] for v in p_['vencidos']])
    for x in cit:
        if x and x not in ros_por[d_['reuniao']]: fora[x] += 1
qa('(d) Relator/vencidos citados ⊆ colegiado da reunião (itens com ex-diretor como relator/vencido: voto subsistente)', 0, sum(fora.values()), True,
   f'exceções justificadas (ex-diretores com voto proferido em reunião anterior, art. 54 da NO-1): {dict(fora)}')
# (e) um voto por diretor
dup_v, falta_v = [], []
vot_por = collections.defaultdict(list)
for v in V: vot_por[v['deliberacao']].append(v['diretor'])
for d_ in D:
    lst = vot_por[d_['deliberacao']]; ros_ = ros_por[d_['reuniao']]
    if len(lst) != len(set(lst)): dup_v.append(d_['deliberacao'])
    if not ros_ <= set(lst): falta_v.append(d_['deliberacao'])
qa('(e) 1 voto por diretor do colegiado em CADA item (sem duplicata e sem diretor faltando)', len(D), len(D) - len(set(dup_v) | set(falta_v)), not dup_v and not falta_v, f'duplicatas {dup_v[:5]}; faltando {falta_v[:5]}')
sem_prov = [v for v in V if v['proveniencia'] not in ('nominal', 'inferido', 'REVISAR')]
qa('(e) proveniencia ∈ {nominal, inferido, REVISAR}', 0, len(sem_prov), not sem_prov)
# (f) coerencia tipo_item x resultado da ata
mapa = collections.Counter((d_['situacao_ata'], d_['tipo_item']) for d_ in D)
qa('(f) Situação da ata (dataset) × tipo_item atribuído (mapa)', len(D), sum(mapa.values()), True, '; '.join(f'{a} → {b}: {n}' for (a, b), n in sorted(mapa.items())))
qa('(f) Relator da coluna × relator citado no texto ("acompanhando o voto do Diretor-Relator X")', 0, len(rel_dif), not rel_dif, f'{rel_dif[:5]}')
n_vista_ok = sum(1 for d_ in D if d_['tipo_item'] == 'Vista' and d_['situacao_ata'] == 'Pedido de Vista' and 'não identificado' not in d_['resultado'])
n_vista = sum(1 for d_ in D if d_['situacao_ata'] == 'Pedido de Vista')
qa('(f) Textos de decisão truncados na fonte (limite de 4.000 caracteres)', 0, len(trunc_log), not trunc_log, f'{trunc_log}: início da decisão (modo, vencidos, relator) preservado; narrativa final pode faltar')
qa('(f) Itens "Pedido de Vista": pedinte nominal identificado no texto', n_vista, n_vista_ok, n_vista == n_vista_ok, f'sem pedinte: {sem_vista_log}')
tot = len(V); nom = sum(1 for v in V if v['proveniencia'] == 'nominal'); inf = sum(1 for v in V if v['proveniencia'] == 'inferido'); rev = sum(1 for v in V if v['proveniencia'] == 'REVISAR')
COB.append([AG, 'Reuniões 2026 com ata lida (texto de decisão)', len(realizadas), ', '.join(tag_de(i) for i in sorted(realizadas, key=lambda i: (reuniao_data[i], i)))])
COB.append([AG, 'Itens (deliberações) lidos', len(D), '; '.join(f'{k}: {n}' for k, n in collections.Counter(d_['tipo_item'] for d_ in D).most_common())])
COB.append([AG, 'Linhas de voto (1 por diretor por item)', tot, f'nominal {nom} ({100 * nom / tot:.1f}%); inferido {inf} ({100 * inf / tot:.1f}%); REVISAR {rev} ({100 * rev / tot:.1f}%)'])
COB.append([AG, 'Itens com decisão composta (≥2 partes)', sum(1 for d_ in D if len(d_['partes']) > 1), f"partes emitidas: {sum(len(d_['partes']) for d_ in D)}; itens com parte por maioria: {len(it_maioria_p)}"])
COB.append([AG, 'Ex-diretores com voto subsistente (linhas extras)', len(set(extras_log)), f"{dict(collections.Counter(x for _, x in set(extras_log)))}"])
COB.append([AG, 'Itens da pauta de 06/10/2026 (RPO 20) sem resultado', sum(len(por_reuniao[i]) for i in pauta_so), 'pauta publicada; ata ainda não publicada em 08/10/2026'])

# ---------------------------------------------------------------- pendencias / nao_feito
MOT = 'www2.aneel.gov.br (ata_diretoria e noticias_area) responde 403 do Cloudflare ("Sorry, you have been blocked" / "Attention Required") ao IP do ambiente, em curl, Chromium headless e headed (xvfb); reuniaodiretoria.aneel.gov.br reseta a conexão (ERR_CONNECTION_RESET); biblioteca/sei.aneel via proxy do ambiente = 403 no túnel. Captcha não é resolvido.'
for r_ in sorted(R, key=lambda x: (x['data'], x['reuniao'])):
    tag = r_['reuniao']; ide = next(i for i in por_reuniao if tag_de(i) == tag); n_it = len(por_reuniao[ide])
    if ide in pauta_so:
        PEN.append([AG, f'{tag} ({r_["titulo"][:60]}…)', r_['data'], 'Realizada, ata ainda não publicada', f'só a pauta ({n_it} itens, dataset gerado em 02/10/2026) sem resultado/decisão', 'ata sai dias após a reunião; reunião de 06/10/2026', 'Rodar scripts/aneel_baixar.py e aneel_parse.py quando o dataset "Pautas e Atas" for atualizado (CKAN, atualização diária)', URL_ATAS])
    else:
        PEN.append([AG, f'{tag} - ata em PDF (presença nominal da reunião inteira, ordem de votação, texto integral)', r_['data'], 'bloqueado pela fonte',
                    f'{n_it} itens com relator, resultado e texto da decisão da ata, via Dados Abertos', MOT, 'Abrir a ata em www2.aneel.gov.br/aplicacoes_liferay/ata_diretoria/ata.cfm (ou idAreaNoticia=425) num navegador comum / de outro IP e conferir presença e ausências', URL_WWW2])
for tag_, falt, dup in gaps:
    for f_ in falt: PEN.append([AG, f'{tag_}-{f_}', reuniao_data[next(i for i in por_reuniao if tag_de(i) == tag_)], 'Numeração com buraco', f'itens 1..{max(int(x["NumOrdem"]) for x in por_reuniao[next(i for i in por_reuniao if tag_de(i) == tag_)])} do dataset sem o nº {f_}', 'o item {0} da pauta não consta do dataset de dados abertos (pode ter sido excluído da pauta antes da reunião ou omitido da exportação)'.format(f_), 'Conferir a pauta/ata do dia em www2 (ata_diretoria) ou na pauta publicada', URL_ATAS])
if dif_rpo:
    PEN.append([AG, 'RPO 17/2026 - data da reunião', '/'.join(dif_rpo), 'Data divergente: calendário × dataset', 'calendário oficial (Portaria 7.014/2025): 25/08/2026; dataset de reuniões e de itens: 24/08/2026 (17/2026 - RPO, Executada)', 'possível antecipação da reunião (ou erro de data no dataset); o dataset foi adotado como data da reunião', 'Conferir em www2 a data da ata/pauta da 17ª RPO e a eventual portaria de alteração do calendário', URL_CAL])
rev_por_item = collections.OrderedDict()
for did, motivo in sorted(set(revisar_log)): rev_por_item.setdefault(did, []).append(motivo)
for did, motivos in rev_por_item.items():
    PEN.append([AG, did, next((d_['data'] for d_ in D if d_['deliberacao'] == did), ''), 'REVISAR', 'texto da decisão no dataset: ver decisao_texto (posições nominais incompletas)', '; '.join(motivos), 'Conferir o item na ata em PDF (www2.aneel.gov.br ata_diretoria)', URL_WWW2])
for did in trunc_log:
    PEN.append([AG, did, next(d_['data'] for d_ in D if d_['deliberacao'] == did), 'texto truncado na fonte', 'texto da decisão cortado em 4.000 caracteres no dataset de dados abertos (relator, modo e vencidos aparecem no início e foram lidos)',
                'o campo TxtDecisaoJulgamento do CSV tem limite de 4.000 caracteres; impedimentos, ausências e vistas no fim do texto podem não constar', 'Conferir o final da decisão na ata em PDF (www2.aneel.gov.br ata_diretoria)', URL_WWW2])
PEN.append([AG, 'Colegiado 2026 (composição por reunião)', '2026-08-18', 'inferido', 'Sandoval (DG), Agnes, Gentil, Willamy e Fernando até a RPO de 11/08; Ludimila Lima no lugar de Fernando Mosna a partir do CDPO de 18/08',
            'a fonte coletada não traz lista de presentes; a troca foi inferida pelas atuações nominais em texto (1ª atuação de Ludimila 18/08; última de Fernando 11/08) e pelo art. 54 da NO-1 ("voto subsistente")', 'Conferir a portaria de posse/vacância e as listas de presentes das atas', 'https://www.gov.br/aneel/pt-br/composicao/diretoria'])
NF += [[AG, 'Atas em PDF (presença/ausência da reunião inteira, ordem da apuração nominal, sustentações)', f'{len(realizadas)} reuniões', 'PARCIAL (bloqueado pela fonte)', MOT, 'Obter as atas em outro IP/navegador e reprocessar'],
       [AG, 'Votos dos demais diretores (extrato nominal)', f'{inf} de {tot} linhas ({100 * inf / tot:.1f}%) seguem INFERIDAS', 'PARCIAL (limite da fonte)', 'a ata registra só relator, vencidos, impedidos, ausentes e vistas; "ACOMPANHOU" = unanimidade ou exclusão dos vencidos nomeados', 'Pedir o extrato nominal de votação à Secretaria-Geral/SGE (reuniaodir@aneel.gov.br)'],
       [AG, 'Votos escritos dos relatores (SEI) e declarações de voto', '0 lidos', 'NÃO FEITO', 'SEI público/biblioteca da ANEEL bloqueados pelo proxy do ambiente (403 no túnel)', 'Ler os votos pelo SEI (consulta pública) fora do ambiente'],
       [AG, 'Tipo "Aprovação de ata"', '0 itens', 'N/A', 'o dataset de dados abertos não traz item de aprovação de ata (a ANEEL aprova atas por outro rito)', ''],
       [AG, 'Presença da reunião inteira', f'{len(R)} reuniões com colegiado inferido', 'LIMITE', 'sem lista de presentes na fonte coletada; só ausência por item', 'Conferir as atas em PDF']]
diretores = [SANDOVAL, AGNES, GENTIL, WILLAMY, FERNANDO, LUDIMILA] + sorted({x for _, x in extras_log if x not in (SANDOVAL, AGNES, GENTIL, WILLAMY, FERNANDO, LUDIMILA)})
res = {'reunioes': R, 'deliberacoes': D, 'votos': V, 'qualidade': Q, 'cobertura': COB, 'pendencias': PEN, 'nao_feito': NF, 'diretores': diretores, 'colegiado': 'Diretoria Colegiada',
       '_fonte': {'dataset': URL_CSV, 'gerado_em': HOJE, 'nota': 'Texto de decisão da ata via Dados Abertos ANEEL (CSV, atualização de 02/10/2026); ata prévia sujeita a ajustes até a assinatura.'}}
json.dump(res, open(out, 'w'), ensure_ascii=False, indent=1)
print('reunioes', len(R), '| deliberacoes', len(D), '| votos', len(V), f'| nominal {100 * nom / tot:.1f}% inferido {100 * inf / tot:.1f}% REVISAR {rev}', '| pendencias', len(PEN))
for q_ in Q: print(q_[4], '|', q_[1][:100], '|', q_[2], '|', q_[3])
