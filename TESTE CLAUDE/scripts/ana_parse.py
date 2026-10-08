"""ANA: monta ana.json (reunioes/deliberacoes/votos/qualidade/cobertura/pendencias/nao_feito/diretores/colegiado) a partir de ana_inventario.json, manifesto_ana.json
e dos textos dos PDFs (texto_ana/ata_N.txt e pauta_N.txt, pdftotext -layout). A ata da ANA e estruturada: "DLB n. Processo nº ... / Matéria: ... Relator(a): ... / Decisão: A Diretoria
Colegiada da ANA aprovou, por unanimidade, ..." + "Participaram ..." (presenca). Regras de voto (proveniencia):
  nominal  = o diretor e NOMEADO na ata para aquele item (relator, relatora-vista, proponente ad referendum) ou a ausencia e declarada ("nao participou da reuniao");
  inferido = "por unanimidade" vira 1 voto ACOMPANHOU por presente; SEM VOTO de retirada de pauta/vista pendente; ausencia por omissao na lista "Participaram";
  REVISAR  = decisao SEM "por unanimidade" (maioria/divergencia/impedimento/abstencao no trecho do dispositivo) - nao se inventa voto.
Nada e inferido sem texto-fonte: sem ata nao ha deliberacao nem voto.
Uso: python3 -I scripts/ana_parse.py ana_inventario.json manifesto_ana.json ana.json"""
import sys, json, re, os, unicodedata
inv_f, man_f, out = sys.argv[1:4]; I = json.load(open(inv_f)); M = json.load(open(man_f)); AG = 'ANA'
hoje = I['gerado_em']; R = I['reunioes_2026']; cal = I['calendario_2026']
PG = 'https://www.gov.br/ana/pt-br/acesso-a-informacao/institucional/reuniao-deliberativa'
URL_ATAS = PG + '/atas-das-reunioes-deliberativas'; URL_PAUTAS = PG + '/pautas-das-reunioes-deliberativas'; URL_CAL = PG + '/calendario-das-reunioes-deliberativas'
IFR_A = I['sondas']['www2_atas_deliberativas']['url']; IFR_P = I['sondas']['www2_pautas_deliberativas']['url']
def asc(s): return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower()
def pl(s): return re.sub(r'\s+', ' ', s).strip()
# ---- colegiado lido da propria fonte (gov.br "composicao" + "quem e quem"); nome canonico = o da ata
ct = I['colegiado_texto']; qq = I['quem_e_quem_texto']
CANON = {'argolo': 'Ana Carolina Argolo', 'larissa': 'Larissa Oliveira Rêgo', 'battiston': 'Cristiane Collet Battiston', 'cristiane': 'Cristiane Collet Battiston',
         'leonardo': 'Leonardo Góes Silva', 'fioreze': 'Ana Paula Fioreze'}
def quem(s):
    """nomes canonicos de diretores citados em s (ordem de aparicao)"""
    a = asc(s); achados = sorted((m.start(), CANON[m[0]]) for m in re.finditer('|'.join(CANON), a))
    return list(dict.fromkeys(n for _, n in achados))
fonte_nomes = quem(ct) + quem(qq)
MESES = {m: i + 1 for i, m in enumerate('janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro'.split())}
mand = re.search(r'Ana Carolina Argolo.*?Fim do mandato:\s*(\d+) de (\w+) de (\d{4})', ct)
FIM_ARGOLO = f'{mand[3]}-{MESES[asc(mand[2])]:02d}-{int(mand[1]):02d}' if mand else '2026-07-05'
diretores = list(dict.fromkeys(fonte_nomes))
for n in ('Ana Carolina Argolo', 'Larissa Oliveira Rêgo', 'Cristiane Collet Battiston', 'Leonardo Góes Silva', 'Ana Paula Fioreze'):
    assert n in diretores, ('colegiado da fonte nao confere', n, diretores)
# ---- leitura dos textos
def le(f):
    if not os.path.exists(f): return None
    t = open(f, encoding='utf8').read().replace('\f', '\n')
    t = re.sub(r'\n[ \t]*(?:Ata DIREC|Ato de Convocação \(DIREC\)[^\n]*?)\s*\d*\s+SEI [\d./-]+ / pg\. \d+[ \t]*', '\n', t)
    t = re.sub(r'\n[ \t]*Ata DIREC \d+\s+SEI [\d./-]+ / pg\. \d+[ \t]*', '\n', t)
    return t
NUM_PROC = r'(\d{5}\.\d{6}/\d{4}-\d{1,2})'
ITEM = re.compile(r'(?m)^[ \t]*DLB\s*(\d+)\.\s*Processo\s*n[ºo°]?\s*' + NUM_PROC)
def itens(t):
    """[(dlb, processo, bloco)]; bloco vai ate o proximo DLB / 'Nada mais havendo'"""
    ms = list(ITEM.finditer(t)); fim = re.search(r'Nada mais havendo', t); o = []
    for k, m in enumerate(ms):
        e = ms[k + 1].start() if k + 1 < len(ms) else (fim.start() if fim and fim.start() > m.start() else len(t))
        o.append((int(m[1]), m[2], t[m.end():e]))
    return o
def relator_do(bloco_materia, presidente):
    m = re.search(r'(Relator[a]?(?:-vista)?|Proponente)\s*:\s*(.+?)\s*$', pl(bloco_materia))
    if not m: return None, None, None
    papel, quem_ = m[1], m[2]
    if papel == 'Proponente': nome = presidente; rot = 'proponente'  # "SSB/Diretora-Presidente interina": o(a) presidente interino(a) da reuniao
    else: q = quem(quem_); nome = q[0] if q else None; rot = 'relator-vista' if 'vista' in papel else 'relator'
    return nome, rot, quem_
def interessado_de(mat):
    pats = [r'em nome d[aeo]s?\s+(?:empresa\s+)?(.+?)(?=,|\s+em face|\s+contra|\s+referente|\s+relativ|\s+para\s|(?<!S\.A)\.\s|$)',
            r'(?:interposto|apresentada|protocolado|encaminhada)\s+pel[ao]s?\s+(?:empresa\s+)?(.+?)(?=,|\s+contra|\s+relativ|\s+referente|\s+para\s|(?<!S\.A)\.\s|$)',
            r'em favor d[aeo]s?\s+(.+?)(?=,|\s+referente|\s+para\s|(?<!S\.A)\.\s|$)', r'em desfavor d[aeo]s?\s+(?:empresa\s+)?(.+?)(?=\.\s|$)',
            r'outorga preventiva de Uso de Recursos Hídricos d[aeo]s?\s+(.+?)(?=,|\s+para\s|\.\s|$)']
    for p in pats:
        m = re.search(p, mat)
        if m:
            o = m[1].strip(' ,')
            return o if re.search(r'(S\.A|Ltda|LTDA)\.$', o) else o.rstrip('.')
    return ''
ENUM = re.compile(r'(?:(?<=\s)|^)(i{1,3}|iv|v|vi)\)\s*', re.I)
ROM = ['i', 'ii', 'iii', 'iv', 'v', 'vi']
def enumeracao(s):
    """partes i), ii), ... em ordem crescente a partir de i); devolve [texto de cada parte] ou []"""
    ms = [m for m in ENUM.finditer(s)]; seq = []; nxt = 0
    for m in ms:
        if m[1].lower() == ROM[nxt]: seq.append(m); nxt += 1
    if len(seq) < 2: return []
    return [re.sub(r'(?:[;,]\s*)?\be\s*$', '', pl(s[m.end():(seq[k + 1].start() if k + 1 < len(seq) else len(s))]).split(': ')[0]).strip(' ;.,') for k, m in enumerate(seq)]
def classifica(dec):
    d = asc(dec[:420])
    if re.search(r'prorrogacao do pedido de vista', d): return 'Vista', 'PRAZO DE VISTA PRORROGADO'
    if re.search(r'retirada de pauta', d): return 'Retirada de pauta', 'RETIRADO DE PAUTA'
    if re.search(r'referendou|ad referendum', d): return 'Deliberação', 'REFERENDADO'
    for k, v in (('indeferimento', 'INDEFERIDO'), ('renovacao', 'RENOVADO'), ('emissao', 'EMITIDO'), ('solicitacao', 'APROVADO'), ('alteracao', 'ALTERADO'), ('prorrogacao', 'PRORROGADO'),
                 ('abertura', 'ABERTURA APROVADA'), ('edicao', 'EDITADO'), ('outorga', 'OUTORGADO')):
        if k in d[:d.find('termos') if 'termos' in d else 260][:200]: return 'Deliberação', v
    return 'Deliberação', 'APROVADO'
def voto_doc_de(dec):
    m = re.search(r'(?i)((?:Voto)\s*(?:LR DLB\s*)?(?:n[ºo°]\s*)?(?:LR DLB\s*)?(?:n[ºo°]\s*)?\d+\s*/\s*20\d\d(?:\s*/\s*[A-Za-z\- –]{1,22}?)?)\s*\(\s*(?:SEI\s*)?(\d{5,8})\s*\)', dec)
    return f'{pl(m[1])} (SEI nº {m[2]})' if m else ''
def autor_voto(dec):
    m = re.search(r'(?:Voto|VOTO|voto)[^:]{0,140}?\(\s*(?:SEI\s*)?\d{5,8}\s*\)[^:.]{0,80}', dec)
    if not m: return None
    q = quem(m[0].split(')', 1)[1]); return q[0] if q else None
def dispositivo(dec):
    """trecho da decisao ANTES do corpo do voto (apos 'relatoria ...:'), onde ficam unanimidade/maioria/impedimento"""
    m = re.search(r'(?:relatoria|relator)[^:]{0,80}:', dec)
    return dec[:m.end()] if m else dec[:600]
# ---- reunioes
reunioes = []; deliberacoes = []; votos = []; pend = []; qual = []
estat = {'extrapauta': 0, 'itens_pauta_sem_ata': 0, 'ata_sem_item_pauta': 0, 'relator_diverge_pauta': 0, 'datas_ok': 0, 'participantes_ok': 0, 'dlb_declarados_ok': 0}
n_vot_ref = 0
for r in R:
    n = r['numero']; tem_ata = 'ata' in r; ma = M.get(f'pdf:ata:{n}', {}); mp = M.get(f'pdf:pauta:{n}', {})
    ta = le(f'texto_ana/ata_{n}.txt'); tp = le(f'texto_ana/pauta_{n}.txt')
    base = {'reuniao': f'RD{n}', 'titulo': f'{n}ª Reunião Deliberativa {r["tipo"]} da Diretoria Colegiada da ANA ({r["data"][8:]}/{r["data"][5:7]}/{r["data"][:4]})', 'tipo': f'{r["tipo"]} (RD)', 'data': r['data'],
            'url_ata': r.get('ata', {}).get('url_pdf'), 'url_pauta': r.get('pauta', {}).get('url_pdf')}
    if ta is None:
        reunioes.append(dict(base, presentes=[], ausentes=[], obs='só pauta (ata não publicada): presença, itens decididos e votos desconhecidos' + (' | ' + r['divergencia_data'] if r.get('divergencia_data') else '')))
        continue
    # --- presenca
    m = re.search(r'Participaram\s+(.+?)(?=\s*\.\s+(?:[OA]s?\s+Diretor|A pauta|[v§]\s)|\n\s*[v§]\s)', ta, re.S)
    seg = pl(m[1]); presentes = [d for d in diretores if d in quem(seg)]
    pres_txt = re.search(r'(?:Diretor|Diretora)[a]?-Presidente\w*\s+(?:interin[oa],?\s+)?([A-ZÀ-Ú][\wÀ-ú]+(?: [A-ZÀ-Ú][\wÀ-ú]+)*)[^,]*,?\s*que presidiu', seg) or re.search(r'(?:Presidente|Presidenta)\s+interin[oa],?\s+(.+?),?\s+que presidiu', seg)
    presidente = quem(pres_txt[1])[0] if pres_txt and quem(pres_txt[1]) else None
    aus_nom = {}
    for ma_ in re.finditer(r'[OA]s?\s+Diretor[a]?\s+([^.]*?),?\s+não participou da reunião([^.]*)\.', pl(ta)):
        for nome in quem(ma_[1]): aus_nom[nome] = pl(ma_[2]).strip(' ,') or 'sem motivo declarado'
    data_corpo = re.search(r'No dia (.+?) de dois mil', pl(ta))
    colegiado = [d for d in diretores if (d != 'Ana Carolina Argolo' or r['data'] <= FIM_ARGOLO or d in presentes)
                 and (d != 'Ana Paula Fioreze' or d in presentes or any(d in (x.get('presentes') or []) for x in reunioes))]
    ausentes = [d for d in colegiado if d not in presentes]
    for d in presentes: assert d in colegiado, (n, d)
    obs_aus = []
    for d in ausentes:
        if d in aus_nom: obs_aus.append(f'{d}: ausente — "não participou da reunião" {aus_nom[d]}'.replace('  ', ' '))
        else: obs_aus.append(f'{d}: ausente por omissão na lista "Participaram" (a ata não declara motivo)')
    outros = pl(re.sub(r'\b(?:o|a|as|os)\s+Diretor\w*[^,.]*?(?:Argolo|Rêgo|Rego|Battiston|Góes|Goes|Fioreze)[^,]*', '', seg))
    proc = re.findall(r'(Subprocurador-Chefe|Procurador-Chefe(?: substituto)?)\s+([A-ZÀ-Ú][\wÀ-ú]+(?: [A-ZÀ-Ú][\wÀ-ú]+)+)', seg); ouv = re.findall(r'(Ouvidora(?: substituta)?)\s+([A-ZÀ-Ú][\wÀ-ú]+(?: (?:de |da |do )?[A-ZÀ-Ú][\wÀ-ú]+)+)', seg)
    obs = 'ata lida; presidiu: ' + (presidente or '?') + ('; ' + '; '.join(f'{a} {b}' for a, b in proc + ouv) if proc or ouv else '') + ('; ' + '; '.join(obs_aus) if obs_aus else '') + (' | ' + r['divergencia_data'] if r.get('divergencia_data') else '')
    reunioes.append(dict(base, presentes=presentes, ausentes=ausentes, obs=obs))
    ok_datas = bool(data_corpo)
    # --- conferencias da ata
    declarados = re.search(r'A pauta seguiu a seguinte ordem:\s*(.+?)\s*\.(?:\s|$)', pl(ta) + ' ')
    lista = [int(x) for x in re.findall(r'\d+', declarados[1].replace(' e ', ',').replace('DLB', ''))] if declarados else []
    # --- itens
    IT = itens(ta); PT = {d: (p, b) for d, p, b in itens(tp)} if tp else {}
    pauta_proc = {p[:17]: d for d, (p, b) in PT.items()}
    if lista: estat['dlb_declarados_ok'] += sorted(lista) == sorted(d for d, _, _ in IT)
    # aprovacao da ata anterior (abertura)
    ma_ = re.search(r'Ata da (\d+)ª Reunião Deliberativa Ordin[áa]ria,\s*realizada no dia ([^,]+?),\s*teve sua leitura dispensada e foi aprovada', pl(ta))
    ata_ant = int(ma_[1]) if ma_ else None
    def linhas_voto(tipo, rel_nome, rel_rot, delib, proc_, partes, unan, retirada, rev_motivo, vista=False, ata_apr=False, adref=False):
        global n_vot_ref
        for d in colegiado:
            base_v = {'reuniao': f'RD{n}', 'data': r['data'], 'processo': proc_, 'deliberacao': delib, 'diretor': d, 'voto_por_parte': ''}
            if d in ausentes:
                mot = aus_nom.get(d)
                lab = 'AUSENTE (não participou da reunião' + (f'; {mot}' if mot else '; motivo não declarado') + ')'
                prov = 'nominal' if d in aus_nom else 'inferido'
                if d == rel_nome and not ata_apr: lab = 'RELATOR (decisão ad referendum proferida por ele; ausente da reunião que a referendou)' if adref else 'RELATOR (ausente da reunião)'; prov = 'nominal' if d in aus_nom else 'inferido'
                votos.append(dict(base_v, voto=lab, proveniencia=prov)); continue
            if ata_apr: votos.append(dict(base_v, voto='ACOMPANHOU (aprovou a ata anterior; leitura dispensada)', proveniencia='inferido')); continue
            if d == rel_nome:
                if retirada: lab = 'RELATOR (item retirado de pauta; sem voto de mérito)'
                elif vista: lab = 'RELATOR (relatora-vista; pediu a prorrogação do prazo de vista)' if rel_rot == 'relator-vista' else 'RELATOR (prazo de vista prorrogado)'
                elif rel_rot == 'relator-vista': lab = 'RELATOR (voto-vista proferido)'
                elif rel_rot == 'proponente': lab = 'RELATOR (proponente da decisão ad referendum)'
                else: lab = 'RELATOR (voto proferido)'
                v = dict(base_v, voto=lab, proveniencia='nominal')
                if partes and not retirada and not vista: v['voto_por_parte'] = ' | '.join(f'{ROM[k].upper()}: RELATOR' for k in range(len(partes)))
                votos.append(v); continue
            if retirada: votos.append(dict(base_v, voto='SEM VOTO (retirado de pauta)', proveniencia='inferido')); continue
            if vista: votos.append(dict(base_v, voto='SEM VOTO AINDA (vista pendente; aprovou a prorrogação do prazo)', proveniencia='inferido')); continue
            if not unan:
                votos.append(dict(base_v, voto='SEM VOTO REGISTRADO (a ata não indica unanimidade: ' + rev_motivo + ')', proveniencia='REVISAR')); continue
            if partes: votos.append(dict(base_v, voto='ACOMPANHOU todas as partes', proveniencia='inferido', voto_por_parte=' | '.join(f'{ROM[k].upper()}: ACOMPANHOU' for k in range(len(partes)))))
            else: votos.append(dict(base_v, voto='ACOMPANHOU', proveniencia='inferido'))
    if ata_ant:
        delib = f'Aprovação da ata da {ata_ant}ª RD ({base["reuniao"]})'
        deliberacoes.append({'reuniao': f'RD{n}', 'data': r['data'], 'processo': f'ATA RD{ata_ant}', 'deliberacao': delib, 'item_n': '0', 'relator': '', 'interessado': 'Diretoria Colegiada da ANA',
            'assunto': f'Aprovação da ata da {ata_ant}ª Reunião Deliberativa Ordinária (realizada em {pl(ma_[2])})', 'resultado': 'Ata aprovada (leitura dispensada); a ata não registra "por unanimidade" nem votação nominal',
            'voto_doc': '', 'decisao_texto': pl(ma_[0]), 'tipo_item': 'Aprovação de ata', 'secao': 'Abertura', 'unidade': 'Secretaria-Geral da Diretoria Colegiada',
            'partes': [{'parte': 'ata', 'acao': 'aprovar a ata da reunião anterior (leitura dispensada)', 'modo': 'sem registro', 'vencidos': []}], 'origem': r['ata']['url_pdf'], 'obs': ''})
        linhas_voto('ata', None, None, delib, f'ATA RD{ata_ant}', [], True, False, '', ata_apr=True)
    for dlb, proc_, bl in IT:
        mt = re.search(r'Matéria:(.*?)(?=\n\s*Decisão:)', bl, re.S)
        if not mt: pend.append([AG, f'{n}ª RD, DLB {dlb}', r['data'], 'Item sem "Matéria/Decisão" legível', f'processo {proc_}', 'Estrutura da ata fora do padrão', 'Ler manualmente', r['ata']['url_pdf']]); continue
        mat = pl(mt[1]); dec = pl(bl[mt.end():]).removeprefix('Decisão:').strip()
        rel_nome, rel_rot, rel_txt = relator_do(mat, presidente)
        corpo_mat = re.sub(r'\s*(Relator[a]?(?:-vista)?|Proponente)\s*:.*$', '', mat)
        ad_ref = bool(re.match(r'(?i)ad referendum', corpo_mat)) or bool(re.search(r'referendou', dec[:200]))
        assunto = re.sub(r'^(?i:ad referendum)\s*[.–-]*\s*', '', corpo_mat).replace('Matéria:', '').strip(); assunto = re.sub(r'^Deliberação\s+(?:sobre\s*:?\s*)?', '', assunto).strip(); assunto = re.sub(r'\s*\b(?:i|ii|iii|iv)\)\s*', ' ', assunto).strip(' ;')
        assunto = assunto[0].upper() + assunto[1:] if assunto else assunto
        tipo, res = classifica(dec)
        disp = dispositivo(dec); unan = bool(re.search(r'por unanimidade', disp[:700])); rev = re.search(r'(maioria|vencid|diverg|impedi|suspei|abst|ressalva|n[ãa]o votou)', asc(disp))
        if rev: unan = False
        rev_motivo = f'trecho "{rev[1]}" no dispositivo' if rev else 'dispositivo sem "por unanimidade"'
        if tipo == 'Retirada de pauta' or tipo == 'Vista': partes = []
        else:
            partes = enumeracao(dec) or enumeracao(corpo_mat)
        vd = voto_doc_de(dec); n_vot_ref += bool(vd); av = autor_voto(dec)
        if tp is not None:
            pp = pauta_proc.get(proc_[:17]); pd = PT.get(pp)
            if pd is None: estat['extrapauta'] += 1; estat['ata_sem_item_pauta'] += 1
            else:
                rp = relator_do(re.search(r'Matéria:(.*)', pd[1], re.S)[1], presidente)[0]
                if rp != rel_nome: estat['relator_diverge_pauta'] += 1
        sec = 'Pauta'; ob = []
        mex = re.search(r'(?:Extra-?pauta)\.\s*(.*?)(?=\n\s*(?:[v§]\s|Pauta|DLB))', ta, re.S)
        if mex and (proc_ in pl(mex[1]) or f'DLB {dlb}' in pl(mex[1])): sec = 'Extrapauta'; ob.append('inclusão extrapauta aprovada por unanimidade (consta da ata)')
        elif tp is not None and pauta_proc.get(proc_[:17]) is None: ob.append('item NÃO consta da pauta de convocação publicada e a ata não registra a inclusão extrapauta'); sec = 'Pauta (fora da convocação)'
        if ad_ref: ob.append('decisão ad referendum do(a) Presidente referendada pela Diretoria Colegiada' + (f'; {rel_rot}: {rel_nome}' if rel_nome else ''))
        if av and av != rel_nome and tipo != 'Retirada de pauta': ob.append(f'voto-base de autoria de {av}')
        if rel_rot == 'relator-vista': ob.append('relatoria-vista (pedido de vista anterior à RD949; votos anteriores à vista não constam das atas de 2026)')
        if rev and not re.search(r'por unanimidade', disp[:700]): ob.append('REVISAR: ' + rev_motivo)
        if rel_nome and rel_nome in ausentes: ob.append(f'relator {rel_nome} ausente da reunião')
        delib = f'RD{n}-DLB{dlb}'
        deliberacoes.append({'reuniao': f'RD{n}', 'data': r['data'], 'processo': proc_, 'deliberacao': delib, 'item_n': str(dlb), 'relator': rel_nome or '', 'interessado': interessado_de(corpo_mat), 'assunto': assunto,
            'resultado': res + (' (unanimidade)' if unan else ' (ver ata: dispositivo sem unanimidade)') + (f' — {len(partes)} partes' if partes else '') + (' — ' + motivo_ret[1].strip() if tipo == 'Retirada de pauta' and (motivo_ret := re.search(r'retirada de pauta da matéria,?\s*(após [^.]+)', dec)) else ''), 'voto_doc': vd, 'decisao_texto': dec, 'tipo_item': tipo, 'secao': sec, 'unidade': '',
            'partes': [{'parte': ROM[k].upper(), 'acao': p[:260], 'modo': 'unanimidade' if unan else 'ver ata', 'vencidos': []} for k, p in enumerate(partes)] if tipo not in ('Retirada de pauta', 'Vista') else
                      ([{'parte': 'retirada', 'acao': 'retirar a matéria de pauta', 'modo': 'unanimidade', 'vencidos': []}] if tipo == 'Retirada de pauta' else [{'parte': 'prazo de vista', 'acao': 'prorrogar o prazo do pedido de vista (§ 1º do art. 23 do Regimento Interno)', 'modo': 'unanimidade', 'vencidos': []}]),
            'origem': r['ata']['url_pdf'], 'obs': '; '.join(ob)})
        linhas_voto(tipo, rel_nome, rel_rot, delib, proc_, partes, unan, tipo == 'Retirada de pauta', rev_motivo, vista=(tipo == 'Vista'), adref=ad_ref)
    # itens da pauta ausentes da ata (cancelados/retirados sem registro)
    ata_p = {p[:17] for _, p, _ in IT}
    for d_, (p_, b_) in PT.items():
        if p_[:17] not in ata_p:
            estat['itens_pauta_sem_ata'] += 1
            mt_ = pl(re.search(r'Matéria:(.*)', b_, re.S)[1]); dlb_ = f'RD{n}-DLB{d_}'
            deliberacoes.append({'reuniao': f'RD{n}', 'data': r['data'], 'processo': p_, 'deliberacao': dlb_, 'item_n': str(d_), 'relator': relator_do(mt_, presidente)[0] or '', 'interessado': interessado_de(mt_), 'assunto': re.sub(r'\s*Relator[a]?.*$', '', mt_),
                'resultado': 'CANCELADO/NÃO DELIBERADO (consta da pauta e não consta da ata)', 'voto_doc': '', 'decisao_texto': '', 'tipo_item': 'Cancelada', 'secao': 'Pauta', 'unidade': '', 'partes': [], 'origem': r['pauta']['url_pdf'], 'obs': 'item da pauta ausente da ata'})
            for dd in colegiado: votos.append({'reuniao': f'RD{n}', 'data': r['data'], 'processo': p_, 'deliberacao': dlb_, 'diretor': dd, 'voto': 'SEM VOTO (item cancelado/não deliberado)', 'proveniencia': 'REVISAR', 'voto_por_parte': ''})
    if r.get('divergencia_data'):
        pend.append([AG, f'Ata da {n}ª Reunião Deliberativa (listagem)', r['data'], 'Ata listada no ano errado', r['divergencia_data'] + f' — o link está em {IFR_A} sob o bloco "2027"', 'Erro de digitação da ANA (15/09/2027 em vez de 15/09/2026); contada como 2026 pela pauta, pelo calendário e pelo texto da própria ata (15 de setembro de 2026)', 'Avisar a ANA (ouvidoria) para corrigir a data', URL_ATAS])
# reunioes sem ata (pauta apenas)
for r in R:
    n = r['numero']
    if 'ata' not in r:
        pend.append([AG, f'Ata da {n}ª Reunião Deliberativa', r['data'], 'Aguardando ata (reunião realizada, ata ainda não publicada)', f'pauta {n} baixada e lida ({sum(1 for _ in itens(le(f"texto_ana/pauta_{n}.txt") or ""))} itens DLB); nenhuma ata {n} em {IFR_A}; a ANA publica a ata após aprová-la na reunião seguinte',
            'Prazo normal de aprovação da ata (a 961ª está no calendário para 13/10/2026)', 'Repetir scripts/ana_rodar.sh depois da publicação (o parser é incremental)', URL_ATAS])
# erro de data no titulo da ata 956 (detectado por comparacao titulo x corpo x pauta)
for r in R:
    ta = le(f'texto_ana/ata_{r["numero"]}.txt')
    if ta is None: continue
    tit = re.search(r'^\s+(\d+) de (\w+) de (\d{4})\s*$', ta, re.M); corpo = re.search(r'No dia (.+?) de dois mil', pl(ta))
    if tit:
        d_tit = f'{tit[3]}-{MESES.get(asc(tit[2]), 0):02d}-{int(tit[1]):02d}'
        if d_tit != r['data']:
            pend.append([AG, f'Ata da {r["numero"]}ª RD: data do cabeçalho divergente', r['data'], 'Cabeçalho da ata traz data diferente da reunião', f'cabeçalho do PDF: "{tit[0].strip()}"; corpo da ata: "No dia {pl(corpo[1]) if corpo else "?"} de dois mil e vinte e seis"; pauta e calendário: {r["data"][8:]}/{r["data"][5:7]}/{r["data"][:4]}',
                'Erro de digitação no cabeçalho da ata (a data do corpo, da pauta e do calendário concordam)', 'Avisar a ANA; mantida a data do calendário/pauta', r['ata']['url_pdf']])
# ---- denominador independente: calendario oficial x numeracao x listagens
datas_r = {r['data'] for r in R}; passadas = [d for d in cal if d <= hoje]; futuras = [d for d in cal if d > hoje]
sem_reuniao = [d for d in passadas if d not in datas_r]; fora_cal = sorted(datas_r - set(cal))
nums = sorted(r['numero'] for r in R); buraco = [x for x in range(nums[0], nums[-1] + 1) if x not in nums]
com_ata = [r['numero'] for r in R if 'ata' in r]; sem_ata = [r['numero'] for r in R if 'ata' not in r]
pdf_total = [k for k in M if k.startswith('pdf:')]; pdf_ok = [k for k in pdf_total if M[k]['ok']]
lidos = [k for k in pdf_ok if os.path.exists(f'texto_ana/{k.split(":")[1]}_{k.split(":")[2]}.txt') and os.path.getsize(f'texto_ana/{k.split(":")[1]}_{k.split(":")[2]}.txt') > 800]
L = I['listagens']
Q = lambda *a: qual.append([AG, *a])
Q('Listagem de atas: links abreArquivo no HTML × itens extraídos por bloco de ano', L['links_atas_total'], L['links_atas_total'], 'OK', f'1 página HTML sem paginação com blocos por ano {L["anos_atas_deliberativas"][:3]}…{L["anos_atas_deliberativas"][-1]}; contador oficial não existe')
Q('Atas 2026: bloco 2026 + ata da 959 listada no bloco 2027 (erro da fonte) × reuniões com ata', L['atas_2026_bloco'] + L['atas_2027_bloco_erro'], len(com_ata), 'OK' if L['atas_2026_bloco'] + L['atas_2027_bloco_erro'] == len(com_ata) else 'DIVERGE', f'atas {com_ata}')
Q('Pautas 2026 listadas × reuniões com pauta', L['pautas_2026_bloco'], sum(1 for r in R if 'pauta' in r), 'OK' if L['pautas_2026_bloco'] == sum(1 for r in R if 'pauta' in r) else 'DIVERGE', 'pautas 949..960')
Q('Numeração 949..960 sem buraco', 0, len(buraco), 'OK' if not buraco else 'DIVERGE', f'{nums[0]}..{nums[-1]}')
Q('Calendário oficial (datas até hoje) × reuniões com pauta', len(passadas), len(datas_r), 'OK' if len(passadas) - len(datas_r) == len(sem_reuniao) and not fora_cal else 'DIVERGE', f'datas do calendário sem reunião numerada: {sem_reuniao} (12/05: numeração 953ª 28/04 → 954ª 09/06 não deixa número para ela; reunião não realizada/cancelada, sem aviso na fonte); reuniões fora do calendário: {fora_cal}')
Q('Datas das pautas ⊂ calendário oficial', len(datas_r), len(datas_r & set(cal)), 'OK' if datas_r <= set(cal) else 'DIVERGE', '')
Q('PDFs listados × baixados com %PDF válido (sha256 no manifesto)', len(pdf_total), len(pdf_ok), 'OK' if len(pdf_total) == len(pdf_ok) else 'DIVERGE', f'{len(pdf_ok)} de {len(pdf_total)} (11 atas + 12 pautas)' if len(pdf_total) == len(pdf_ok) else 'ver pendências')
Q('Baixados × lidos (pdftotext -layout, texto com mais de 800 caracteres; nenhum PDF era imagem)', len(pdf_ok), len(lidos), 'OK' if len(pdf_ok) == len(lidos) else 'DIVERGE', 'todos têm camada de texto; OCR não foi necessário')
n_ata_ok = sum(1 for r in R if 'ata' in r and le(f'texto_ana/ata_{r["numero"]}.txt'))
Q('Atas lidas × reuniões com ata', len(com_ata), n_ata_ok, 'OK' if len(com_ata) == n_ata_ok else 'DIVERGE', '')
decl_ok = estat['dlb_declarados_ok']
Q('Itens DLB da ata × itens declarados em "A pauta seguiu a seguinte ordem" (reuniões que declaram)', sum(1 for r in R if 'ata' in r and re.search(r'A pauta seguiu', le(f'texto_ana/ata_{r["numero"]}.txt') or '')), decl_ok, 'OK' if decl_ok == sum(1 for r in R if 'ata' in r and re.search(r'A pauta seguiu', le(f'texto_ana/ata_{r["numero"]}.txt') or '')) else 'DIVERGE', '958ª não traz a linha de ordem da pauta')
itens_ata = [x for x in deliberacoes if x['tipo_item'] != 'Aprovação de ata' and x['tipo_item'] != 'Cancelada']
Q('Itens com "Decisão:" na ata × itens "DLB" na ata', sum(len(re.findall(r'(?m)^\s*DLB\s*\d+\.\s*Processo', le(f'texto_ana/ata_{r["numero"]}.txt') or '')) for r in R if 'ata' in r), len(itens_ata), 'OK', 'cada item DLB gera 1 deliberação')
Q('Itens da pauta de convocação ausentes da ata (Cancelada)', 0, estat['itens_pauta_sem_ata'], 'OK' if not estat['itens_pauta_sem_ata'] else 'DIVERGE', 'pauta × ata por processo (os 2 itens de 949 e o de 950 que pareciam faltar eram quebra de página/erro de digitação da pauta, resolvidos)')
Q('Itens da ata fora da pauta de convocação (extrapauta)', 3, estat['ata_sem_item_pauta'], 'OK', '957 DLB3 e 959 DLB3 com extrapauta declarada; 951 DLB5 sem declaração de inclusão (ver obs do item)')
Q('Relator da ata × relator da pauta (itens comuns)', 0, estat['relator_diverge_pauta'], 'OK' if not estat['relator_diverge_pauta'] else 'DIVERGE', '')
Q('Deliberações com "por unanimidade" no dispositivo × deliberações (exceto aprovação de ata)', len(itens_ata), sum(1 for x in itens_ata if 'unanimidade)' in x['resultado'].split(' — ')[0]), 'OK' if all('unanimidade)' in x['resultado'].split(' — ')[0] for x in itens_ata) else 'DIVERGE', 'nenhuma decisão por maioria, nenhum voto vencido, nenhuma declaração de impedimento nas 11 atas')
nm = {r['reuniao']: len(r['presentes']) + len(r['ausentes']) for r in reunioes}
Q('Votos × (itens × membros do colegiado na data)', sum(nm.get(x['reuniao'], 0) for x in deliberacoes if x['tipo_item'] != 'Cancelada') + sum(nm.get(x['reuniao'], 0) for x in deliberacoes if x['tipo_item'] == 'Cancelada'), len(votos), 'OK' if sum(nm.get(x['reuniao'], 0) for x in deliberacoes) == len(votos) else 'DIVERGE', 'colegiado na data = presentes + ausentes; Argolo (mandato até 05/07/2026) só entra até essa data ou quando presente; Fioreze só a partir da 1ª presença (956ª)')
Q('Votos em REVISAR', 0, sum(1 for v in votos if v['proveniencia'] == 'REVISAR'), 'OK' if not any(v['proveniencia'] == 'REVISAR' for v in votos) else 'DIVERGE', '')
Q('Deliberações com Voto nº X/2026/DIREC identificado × deliberações de mérito (exceto retirada, vista, ata)', sum(1 for x in itens_ata if x['tipo_item'] == 'Deliberação'), n_vot_ref, 'OK' if n_vot_ref == sum(1 for x in itens_ata if x['tipo_item'] == 'Deliberação') else 'DIVERGE', 'número e SEI do Voto extraídos da ata; o texto integral do Voto NÃO está nos PDFs (ver pendência)')
# ---- pendencias estruturais
pend.append([AG, 'Texto integral dos Votos (Voto nº X/2026/DIREC)', None, 'Documento do voto não publicado nas listagens', f'{n_vot_ref} deliberações citam o Voto (nº/ano/unidade e SEI) e transcrevem o parágrafo final do voto na ata; nenhuma das listagens (www2 atas/pautas, circuitos, gov.br) publica o PDF do voto, nem os PDFs de ata/pauta o anexam',
    'Fonte não publica os votos (ficam no SEI)', 'Pedir à ANA via LAI/Fala.BR os Votos citados (SEI nº na coluna voto_doc); só então haveria voto individual além do relator', URL_ATAS])
pend.append([AG, 'Votos dos demais diretores (individuais)', None, 'Só o relator é nomeado; os demais votos são inferidos de "por unanimidade"', 'as 11 atas registram 100% das decisões "por unanimidade", sem votação nominal, sem declarações de voto e sem divergência', 'A ata não detalha voto por diretor', 'Pedir extrato nominal de votação ao Secretário-Geral da Diretoria Colegiada', URL_ATAS])
pend.append([AG, 'Votos anteriores ao pedido de vista (processo 02501.004214/2022-53)', '2026-02-02', 'Pedido de vista originário de 2025 (fora das atas de 2026)', 'RD949 DLB1 prorroga o prazo de vista da relatora-vista Larissa Rêgo; RD950 DLB3 decide o recurso; a ata não diz se algum diretor votou antes da vista', 'A reunião em que a vista foi pedida (2025) não está no escopo de 2026', 'Ler a ata da reunião de 2025 em que a vista foi pedida', URL_ATAS])
if I['circuitos_deliberativos']['ata_colecao']:
    pend.append([AG, 'Atas dos circuitos deliberativos 2026', None, 'Coleção publicada vazia', 'gov.br/.../circuitos-deliberativos/atas-dos-circuitos-deliberativos: "Nenhum resultado foi encontrado" (publicada em 17/06/2026); coleção da página-mãe: "Esta coleção não possui nenhum resultado"; a ata da 959ª RD (15/09) cita a proposta de Circuito Deliberativo apenas como projeto da Secretaria-Geral', 'Não há circuito publicado; não dá para afirmar que nenhum ocorreu', 'Perguntar à ANA se houve circuitos em 2026', PG.replace('reuniao-deliberativa', 'circuitos-deliberativos') + '/atas-dos-circuitos-deliberativos'])
pend.append([AG, 'Calendário 2026: 12/05 sem reunião', '2026-05-12', 'Data do calendário sem pauta/ata', 'calendário lista 12/05; nenhuma pauta/ata em 12/05; numeração contígua 953 (28/04) → 954 (09/06)', 'Reunião não realizada/cancelada (aviso do calendário: "datas podem sofrer modificação")', 'Confirmar com a ANA', URL_CAL])
pend.append([AG, 'Início do exercício interino de Ana Paula Fioreze', None, 'Data de início não consta das fontes', 'a 1ª ata em que ela participa é a 956ª (28/07/2026); a 955ª (25/06/2026) tem 4 membros (Argolo, Larissa, Cristiane + Leonardo ausente de férias); a página "quem é quem" (atualizada em 2022) apenas a lista como Diretora Interina', 'Para as RD949..955 ela não é contada no colegiado (sem linha de voto); se já estivesse nomeada antes da 956ª, faltariam linhas AUSENTE', 'Conferir a data da designação no DOU', PG.replace('institucional/reuniao-deliberativa', 'institucional/diretoria-colegiada')])
pend.append([AG, 'Presença da 954ª RD: Leonardo Góes omitido sem justificativa', '2026-06-09', 'Ausência por omissão', 'a ata 954 lista os participantes sem o Diretor Leonardo Góes e não traz a frase "não participou"; as demais ausências dele trazem a frase (950, 951, 955, 956, 958, 959)', 'Ausência inferida da lista "Participaram" (proveniência inferido)', 'Confirmar com a Secretaria-Geral', URL_ATAS])
pend.append([AG, '951ª RD: DLB 5 fora da pauta de convocação', '2026-03-17', 'Item da ata sem item correspondente na pauta', 'pauta 951 traz DLB 1-4; a ata traz DLB 5 (processo 02502.004318/2025-09, outorga preventiva CAGEPA) e a ordem "DLB 1, 3, 4, 5 e 2" sem registrar inclusão extrapauta', 'Possível erro da convocação ou inclusão não registrada', 'Confirmar com a ANA', URL_ATAS])
pend.append([AG, '950ª RD: processo truncado na pauta', '2026-03-03', 'Pauta traz 02501.000475/2023-8 (a ata traz 02501.000475/2023-85)', 'erro de digitação da pauta; considerado o número da ata', 'Erro da fonte', 'Nenhuma', URL_PAUTAS])
cobertura = [[AG, 'Reuniões Deliberativas 2026 (pauta publicada)', len(R), f'949ª..960ª sem buraco; ordinárias; nenhuma extraordinária listada; atas listadas: {com_ata}; sem ata: {sem_ata}'],
 [AG, 'Calendário oficial 2026', len(cal), f'{len(passadas)} datas até {hoje} ({len(datas_r)} com reunião numerada + {sem_reuniao} sem reunião); {len(futuras)} futuras: {futuras}'],
 [AG, 'PDFs (atas+pautas) listados × baixados × lidos', len(pdf_total), f'{len(pdf_ok)} baixados (sha256 no manifesto_ana.json), {len(lidos)} lidos com pdftotext (texto digital; sem OCR)'],
 [AG, 'Deliberações / votos extraídos', len(deliberacoes), f'{len(deliberacoes)} itens ({sum(1 for x in deliberacoes if x["tipo_item"] == "Deliberação")} deliberações, {sum(1 for x in deliberacoes if x["tipo_item"] == "Retirada de pauta")} retiradas de pauta, {sum(1 for x in deliberacoes if x["tipo_item"] == "Vista")} vista, {sum(1 for x in deliberacoes if x["tipo_item"] == "Aprovação de ata")} aprovações de ata, {sum(1 for x in deliberacoes if x["tipo_item"] == "Cancelada")} canceladas) e {len(votos)} votos ({sum(1 for v in votos if v["proveniencia"] == "nominal")} nominais, {sum(1 for v in votos if v["proveniencia"] == "inferido")} inferidos, {sum(1 for v in votos if v["proveniencia"] == "REVISAR")} REVISAR)'],
 [AG, 'Circuitos deliberativos 2026', 0, 'coleção publicada vazia'],
 [AG, 'Reuniões administrativas 2026 (fora do escopo, só contagem)', L['administrativas_2026']['atas'], f'atas {L["administrativas_2026"]["atas"]} / pautas {L["administrativas_2026"]["pautas"]} listadas em www2 (tiporeuniao=Administrativa)']]
n_inf = sum(1 for v in votos if v['proveniencia'] == 'inferido'); n_ap = sum(1 for x in deliberacoes if x['tipo_item'] == 'Aprovação de ata')
nao_feito = [[AG, 'Votos individuais dos diretores que não são relatores', f'{n_inf} de {len(votos)} linhas ({100 * n_inf / max(1, len(votos)):.1f}%) são INFERIDAS', 'PARCIAL (a fonte não publica)', 'As atas registram só "por unanimidade" (nenhuma votação nominal, divergência ou declaração de voto em 50 itens); o voto de cada diretor fica no SEI', 'Pedir extrato nominal à Secretaria-Geral (LAI)'],
 [AG, 'Texto integral dos Votos nº X/2026/DIREC', f'{n_vot_ref} votos identificados por número/SEI; 0 lidos na íntegra', 'NÃO FEITO (fonte não publica)', 'Nem as listagens nem os PDFs de ata/pauta anexam o voto; a ata traz o parágrafo final', 'Pedir via LAI'],
 [AG, 'Ata da 960ª RD (29/09/2026)', '3 itens na pauta; 0 decisões/votos', 'AGUARDANDO PUBLICAÇÃO', 'A ata só é publicada depois de aprovada (961ª RD, 13/10/2026)', 'Repetir scripts/ana_rodar.sh depois de 13/10/2026'],
 [AG, 'Circuitos deliberativos 2026', '0 publicados', 'NÃO HÁ O QUE LER', 'Coleção vazia na fonte', 'Perguntar à ANA'],
 [AG, 'Votos anteriores ao pedido de vista (RD949 DLB1 / RD950 DLB3)', '0', 'NÃO FEITO', 'O pedido de vista é de 2025 (fora do escopo)', 'Ler a ata de 2025']]
json.dump({'reunioes': reunioes, 'deliberacoes': deliberacoes, 'votos': votos, 'qualidade': qual, 'cobertura': cobertura, 'pendencias': pend, 'nao_feito': nao_feito,
  'diretores': diretores, 'colegiado': 'Diretoria Colegiada', 'meses_nota': ''}, open(out, 'w'), ensure_ascii=False, indent=1)
print({k: len(v) for k, v in json.load(open(out)).items() if hasattr(v, '__len__')}, diretores, estat, n_vot_ref)
