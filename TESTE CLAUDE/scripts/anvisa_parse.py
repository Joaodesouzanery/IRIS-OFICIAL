"""ANVISA: parser das atas de ROP/REP 2026 -> anvisa.json. Uso: python3 -I scripts/anvisa_parse.py manifesto_anvisa.json anvisa.json (le texto_anvisa/)"""
import re, sys, json, unicodedata, collections
man = json.load(open(sys.argv[1])); out = sys.argv[2]
ROST = [('Leandro Pinheiro Safatle', r'safatle|leandro'), ('Daniel Meirelles Fernandes Pereira', r'daniel|meirelles|pereira'), ('Daniela Marreco Cerqueira', r'daniela|marreco|cerqueira'), ('Thiago Lopes Cardoso Campos', r'thiago|campos'), ('Marcelo Mario Matos Moreira', r'marcelo|moreira')]
TITULARES = [n for n, _ in ROST[:4]]
def norm(s): return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
def quem(t):
    t = norm(t); return [n for n, p in ROST if re.search(r'\b(?:' + p + r')\b', t)]
def limpa(t):
    t = unicodedata.normalize('NFKC', t).replace('​', '')
    t = re.sub(r'\b(?:[A-Za-zÀ-ú] ){3,}[A-Za-zÀ-ú]\b', lambda m: m[0].replace(' ', ''), t)
    t = re.sub(r'(?m)^(\s*)(\d)((?:\s*\.\s*\d)+)', lambda m: m[1] + m[2] + re.sub(r'\s+', '', m[3]), t)
    return re.sub(r'^.*Ata da Reuni[ãa]o (?:Ordin[áa]ria|Extraordin[áa]ria) P[úu]blica da Dicol.*pg\. ?\d+\s*$', '', t, flags=re.M)
HDR = re.compile(r'^\s{0,14}(\d+(?:\.\d+)+)\.?(?:[ \t]+(.*))?$')
SEC = re.compile(r'^\s{0,6}(I{1,3}|IV|V|VI{1,3}|VII)\.\s+[A-ZÇÃÕÉÊÍÓÚ]')
R, D, V, Qd = [], [], [], {}
for tag, m in sorted(man.items(), key=lambda kv: kv[1]['data']):
    if not m['ok']: continue
    t = limpa(open(f'texto_anvisa/{tag}_ata.txt', encoding='utf8').read()); h = re.sub(r'\s+', ' ', t)
    hd = re.search(r'A Diretoria Colegiada da Anvisa,(.*?)reuniu-se', h)
    pres = quem(re.split(r'contando ainda', hd[1])[0]) if hd else []
    aus = [n for n in TITULARES if n not in pres]
    ret_hdr = set(re.findall(r'\d+(?:\.\d+)+', (re.search(r'Ite(?:ns|m) retirad[oa]s? de pauta:(.*?)(?:c\.|Requerimento de sigilo|I\. ASSUNTOS)', h) or [None, ''])[1]))
    sig_hdr = set(re.findall(r'\d+(?:\.\d+)+', (re.search(r'Requerimento de sigilo:(.*?)I\. ASSUNTOS', h) or [None, ''])[1]))
    L = t.split('\n'); idx = []; grp_at = {}; g_atual = ''
    for i, ln in enumerate(L):
        mg = re.match(r'^\s{0,8}\d+(?:\.\d+)+\.?\s+Assuntos d[aoe]s? ([A-Za-zÀ-ú0-9/ -]{2,40})$', ln)
        if mg: g_atual = re.sub(r'\s+', ' ', mg[1]).strip()
        grp_at[i] = g_atual
    for i, ln in enumerate(L):
        mm = HDR.match(ln)
        if mm:
            nxt = []
            for x in L[i + 1:i + 14]:
                if not x.strip(): continue
                if HDR.match(x) or SEC.match(x): break
                nxt.append(x.strip())
                if len(nxt) >= 4: break
            seg = ' '.join(nxt)
            if re.search(r'Diretor(?:a)?(?:-Presidente)?(?: Substituto)? Relator(?:a)?:', (mm[2] or '') + ' ' + seg):
                idx.append((i, mm[1]))
    for j, (i, item) in enumerate(idx):
        fim = idx[j + 1][0] if j + 1 < len(idx) else len(L)
        for k in range(i + 1, fim):
            if SEC.match(L[k]) or re.match(r'\s*[ÀA]s .{3,80}foi encerrada', L[k]) or re.match(r'\s*\d+\.\d+\.\s+(?:DIRETOR|DIRETORA|DIRETOR-PRESIDENTE)', L[k]) or re.match(r'\s*\d+(?:\.\d+)+\.\s+Assuntos d', L[k]): fim = k; break
        bl = L[i:fim]; btxt = re.sub(r'\s+', ' ', ' '.join(bl))
        # bullets (linhas que comecam com '- ')
        bul, cur = [], None
        for ln in bl:
            s = ln.strip()
            if re.match(r'^-\s', s): cur = [s]; bul.append(cur)
            elif not s: cur = None
            elif cur is not None: cur.append(s)
        bul = [re.sub(r'\s+', ' ', ' '.join(b)) for b in bul]
        rel_m = re.search(r'Diretor(?:a)?(?:-Presidente)?(?: Substituto)? Relator(?:a)?:\s*(.*?)\s*(?:Processos?\s*:|Recorrente|Interessado|Assuntos?:|Expediente|Recurso|Empresa)', btxt)
        rel = quem(rel_m[1]) if rel_m else []
        proc = re.findall(r'Processos?\s*:\s*([\d.\/-]+)', btxt); procs = list(dict.fromkeys(proc))
        recte = (re.search(r'Recorrente:\s*(.*?)\s*(?:CNPJ|Processos?\s*:|Expediente)', btxt) or [None, ''])[1].strip()
        ass = (re.search(r'Assuntos?:\s*(.*?)\s*(?:[ÁA]rea:|Agenda Regulat|Excepcionalidade|Decis(?:[õo]es|[ãa]o) anteriores?|- A Diretoria|- Retirado)', btxt) or [None, ''])[1].strip()
        area = (re.search(r'[ÁA]rea:\s*(\S+)', btxt) or [None, ''])[1]
        desf = []
        for b in bul:
            if re.match(r'^-\s*A Diretoria Colegiada decidiu', b): desf.append(('fin', b))
            elif re.match(r'^-\s*A Diretoria Colegiada.*concedeu vista', b): desf.append(('vis', b))
            elif re.match(r'^-\s*A Diretoria Colegiada.*transferiu o item', b): desf.append(('tra', b))
            elif re.match(r'^-\s*(?:Item )?[Rr]etirado de pauta', b): desf.append(('ret', b))
        fin = [b for k, b in desf if k == 'fin']; vis = [b for k, b in desf if k == 'vis']
        ult = desf[-1][0] if desf else None
        tipo, res_, vencidos, vista_a, decis, vexterno, votaram = 'Deliberação', '', [], [], '', False, []
        rel_venc, nominais_maioria = False, set()
        if ult == 'fin':
            decis = fin[-1]; mm = re.match(r'^-\s*A Diretoria Colegiada decidiu,?\s*(por unanimidade|por maioria)?,?\s*(.*)$', decis)
            modo = (mm[1] or '').replace('por ', '') if mm else ''
            resto = mm[2] if mm else decis
            if modo == 'maioria':
                vv = re.search(r'vencid[oa]s?\s+(.*?),\s+(?:e,\s+)?(?:por \w+,\s+)?(?:[A-ZÇÃÕÉÊÍÓÚ]{3,}|nos termos)', resto)
                vencidos = quem(vv[1]) if vv else []
                if vv and re.search(r'Relator(?:a)?(?! à época)', vv[1]): vencidos = list(dict.fromkeys(vencidos + rel))
                vexterno = bool(vv) and not vencidos
                # D4: relator vencido -> quem seguiu a tese vencedora votou CONTRA o relator (convencao do extrato de CD: DIVERGIU)
                rel_venc = bool(rel) and rel[0] in vencidos
                ms_ = re.findall(r'((?:O|A|Os|As)\s+[^.]*?)\s+acompanhar(?:am|á)\s+o\s+voto', btxt); seguiu = quem(ms_[-1]) if ms_ else []
                mt_ = re.search(r'nos termos do voto d[oa]s?\s+(?:Diretor[a]?(?: Substituto)?\s+)?([^.,;]+)', decis); autor = quem(mt_[1]) if mt_ else []
                nominais_maioria = set(seguiu) | set(autor)
            runs = [x for x in re.findall(r'((?:N[ÃA]O )?[A-ZÇÃÕÉÊÍÓÚ]{4,}(?: (?:E |DE |DO |DA |O |A |OS |AS )?[A-ZÇÃÕÉÊÍÓÚ]{2,})*)', resto) if x.split()[0] not in ('DIRE', 'ANVISA', 'DIRETOR', 'PRESIDENTE', 'DIRETORA', 'SEI')]
            acao = runs[0] if runs else ''
            res_ = f"{acao or 'DECIDIU'} — {'POR UNANIMIDADE' if modo == 'unanimidade' else 'POR MAIORIA' if modo == 'maioria' else (modo or 'SEM MODO NA ATA')}".strip()
            if re.search(r'\bII\)', decis): res_ += ' [decisão composta: ver texto]'
            if modo == 'maioria' and vexterno: res_ += ' (vencido ex-diretor, fora do colegiado atual)'
            elif modo == 'maioria' and not vencidos: res_ += ' (vencidos não identificados: revisar)'
        elif ult == 'tra': tipo, res_ = 'Retirada de pauta', 'TRANSFERIDO — reunião presencial'
        elif ult == 'vis':
            tipo = 'Vista'; vv = re.search(r'concedeu vista (?:ao|à|aos|às|a)\s+(.*?)(?:\.|$)', vis[-1]); vista_a = quem(vv[1]) if vv else []
            mvv = re.search(r'votos? d[aoe]s? (.*?)(?:,? e)? concedeu vista', vis[-1]); votaram = [x for x in quem(mvv[1]) if x not in vista_a] if mvv else []
            mrv = re.search(r'retorno de vista d[aoe]s? (.*?)(?:,? e)? concedeu vista', vis[-1])
            if mrv: votaram = list(dict.fromkeys(votaram + [x for x in quem(mrv[1]) if x not in vista_a]))
            res_ = 'SOBRESTADO — vista concedida a ' + (', '.join(vista_a) or '?')
        elif re.search(r'(?:ser[áa]|ser[áa] ) deliberado na pr[óo]xima reuni[ãa]o', btxt) and not ult: tipo, res_ = 'Retirada de pauta', 'ADIADO — será deliberado na próxima reunião pública (pedido do recorrente, art. 3º da RDC 862/2024)'
        elif ult == 'ret': tipo, res_ = 'Retirada de pauta', 'RETIRADO DE PAUTA' + (' (por despacho, antes da reunião)' if 'Despacho' in desf[-1][1] else '')
        else: tipo, res_ = 'Deliberação', 'SEM DESFECHO NA ATA (revisar)'
        atual = btxt
        for b in bul:
            if re.match(r'^-\s*ROP\s*\d+', b): atual = atual.replace(b, ' ')
        mk = [mm.start() for mm in re.finditer(r'O item foi apreciado (?:em sigilo )?(?:no|em) Circuito Deliberativo\s+n[ºo]\s*[\d.]+/2026', btxt)]
        if mk: atual = btxt[mk[-1]:]
        # Notas de impedimento/ausencia podem estar apos bullets de historico que, no texto corrido, engolem o relato da sessao
        # (item de "sessao reservada" nao traz o marcador "apreciado em CD"). Varre o item inteiro menos a 1a sentenca de cada
        # bullet de historico ("- ROP n/AAAA, item ..." / "- SJO ...") e une com a janela antiga `atual`. Retiradas ficam de fora (ninguem votou).
        # bullet de historico de 2025 ou antes cuja 1a sentenca ja e uma DECISAO (tomou conhecimento/concedeu vista/decidiu): o resto do bullet (sessao reservada, ouvintes, registros) e historico, nao a sessao atual
        btxt_h = re.sub(r'-\s*(?:ROP|REP|SJO)\s*n?[ºo]?\s*\d+/(?:20[01]\d|2025)\b[^-]{0,40}?-\s*(?:(?!\.\s+[A-ZÀ-Ú]).){0,250}?(?:tomou conhecimento do relat|concedeu vista|decidiu).*?(?=\s-\s(?:A Diretoria|Retirado|Item|ROP|REP|SJO)\b|$)', ' ', btxt)
        corpo = re.sub(r'-\s*(?:ROP|REP|SJO)\s*n?[ºo]?\s*\d+/\d{4}\b.*?(?:\.(?=\s+(?:[A-ZÀ-Ú]|-\s))|$)', ' ', btxt_h)
        varre = atual + ' ' + corpo if tipo != 'Retirada de pauta' else ''
        imp = quem(' '.join(re.findall(r'(?:Diretor|Diretora|Diretor Substituto)[^.]{0,80}?(?:declarou-se|declarou se)\s+(?:impedid|suspeit)[oa]\s+(?:na|da|d[ao]) vota[çc][ãa]o', varre) + re.findall(r'(?:Diretor|Diretora|Diretor Substituto)[^.]{0,60}?(?:declarou-se|declarou se)\s+(?:impedid|suspeit)[oa]', atual)))
        cds_cit = sorted({int(x.replace('.', '')) for x in re.findall(r'Circuito Deliberativo\s+n[ºo]?\s*([\d.]+)/2026', atual)})
        ausv = quem(' '.join(re.findall(r'(?:Diretor|Diretora|Diretor Substituto)[^.]{0,60}?esteve ausente d[ae] vota[çc][ãa]o', atual) + re.findall(r'(?:Diretor|Diretora|Diretor Substituto)[^.]{0,80}?(?:esteve ausente|ausentou-se)\s+(?:d[ae]|n[ae])\s+(?:vota[çc][ãa]o|sess[ãa]o reservada)', varre)))
        proferiu = quem(' '.join(re.findall(r'(?:O|A) Diretor[a]?[^.]{0,50}?proferiu o Voto', atual + ' ' + corpo)))
        if tipo == 'Vista': votaram = list(dict.fromkeys(votaram + [x for x in proferiu if x not in vista_a and x not in rel]))  # D5: a ata cita 'proferiu o Voto n' antes da vista
        if re.search(r'Item renumerado de [\d.]+ para [\d.]+', btxt): Qd.setdefault(tag + '_renumerados', []).append(item); continue
        if item.startswith('1.'): Qd.setdefault(tag + '_informes', []).append(item); continue
        deli = item; pr = procs[0] if procs else f'{tag}-{item}'
        d = {'reuniao': tag, 'data': m['data'], 'processo': pr, 'deliberacao': deli, 'item_n': item, 'relator': rel[0] if rel else None, 'interessado': recte or area, 'assunto': (ass or ('Recurso administrativo — ' + recte if recte else ''))[:600], 'resultado': res_, 'voto_doc': (re.search(r'Voto n[ºo]\s*([\d/A-Za-z.]+)', decis) or [None, ''])[1], 'decisao_texto': (decis or (vis[-1] if vis else ''))[:1500], 'tipo_item': tipo, 'area': area, 'processos_do_item': procs, 'sigilo': item in sig_hdr, 'cds_citados': cds_cit, 'secao': item.split('.')[0], 'unidade': grp_at.get(i, '')}
        D.append(d)
        for n in [x for x in pres]:
            base = {'reuniao': tag, 'data': m['data'], 'processo': pr, 'deliberacao': deli, 'diretor': n}
            if n in imp: v, pv = 'IMPEDIDO (declarou-se impedido/suspeito)', 'nominal'
            elif n in ausv: v, pv = 'AUSENTE DA VOTAÇÃO (registrado na ata)', 'nominal'
            elif tipo == 'Retirada de pauta': v, pv = 'SEM VOTO (retirado de pauta)', 'nominal'
            elif tipo == 'Vista':
                if n in vista_a: v, pv = 'PEDIU VISTA', 'nominal'
                elif n in rel: v, pv = 'RELATOR (voto proferido; vista concedida)', 'nominal'
                elif n in votaram: v, pv = 'VOTOU (antes da vista; posição só no voto escrito)', 'nominal'
                else: v, pv = 'SEM VOTO AINDA (vista pendente)', 'inferido'
            elif 'SEM DESFECHO' in res_: v, pv = 'A REVISAR (sem desfecho na ata)', 'REVISAR'
            elif 'MAIORIA' in res_:
                if n in vencidos and n in rel: v, pv = 'RELATOR (voto vencido)', 'nominal'
                elif rel_venc and n in vencidos: v, pv = 'ACOMPANHOU (acompanhou o relator, vencido)', 'nominal'
                elif n in vencidos: v, pv = 'DIVERGIU (vencido)', 'nominal'
                elif n in rel: v, pv = 'RELATOR (voto proferido)', 'nominal'
                elif rel_venc: v, pv = 'DIVERGIU (votou contra o relator vencido; integra a maioria)', 'nominal' if n in nominais_maioria else 'inferido'
                elif vencidos or vexterno: v, pv = 'ACOMPANHOU', 'inferido'
                else: v, pv = 'A REVISAR (maioria sem vencidos nomeados)', 'REVISAR'
            else:
                if n in rel: v, pv = 'RELATOR (voto proferido)', 'nominal'
                else: v, pv = 'ACOMPANHOU', 'inferido'
            V.append(dict(base, voto=v, proveniencia=pv))
        for n in aus:
            if tipo == 'Vista' and n in vista_a: V.append({'reuniao': tag, 'data': m['data'], 'processo': pr, 'deliberacao': deli, 'diretor': n, 'voto': 'PEDIU VISTA (não consta entre os presentes do cabeçalho; a ata registra a concessão de vista)', 'proveniencia': 'nominal'}); continue  # D8
            V.append({'reuniao': tag, 'data': m['data'], 'processo': pr, 'deliberacao': deli, 'diretor': n, 'voto': 'AUSENTE (não consta entre os presentes)', 'proveniencia': 'nominal'})
        Qd.setdefault(tag, []).append({'ausv': ausv, 'votaram': votaram, 'item': item, 'tipo': tipo, 'rel': rel, 'vencidos': vencidos, 'imp': imp, 'vista': vista_a, 'proferiu': proferiu, 'ndec': len(fin)})
    ntot_dec = len(re.findall(r'(?:^|[.;:)] )- ?A Diretoria Colegiada decidiu', h))
    R.append({'reuniao': tag, 'titulo': m['titulo'], 'tipo': m['tipo'], 'data': m['data'], 'presentes': pres, 'ausentes': aus, 'obs': '', '_ret_hdr': sorted(ret_hdr), '_sig_hdr': sorted(sig_hdr), '_ndec_total': ntot_dec, '_ndec_blocos': sum(q['ndec'] for q in Qd.get(tag, []))})
# ---- dedupe de chave
cnt = collections.Counter((d['reuniao'], d['processo'], d['deliberacao']) for d in D)
# ---- Qualidade
Q = []
def chk(nome, esp, obs, nota=''): Q.append(['ANVISA', nome, esp, obs, 'OK' if esp == obs else 'DIVERGE', nota])
chk('Itens retirados de pauta: lista do cabeçalho da ata × itens classificados como retirada', sum(len([x for x in r['_ret_hdr'] if not x.startswith('1.')]) for r in R), sum(1 for d in D if d['resultado'] == 'RETIRADO DE PAUTA'), f'a lista do cabeçalho é independente do corpo (itens 1.x são informes e ficam fora); {sum(1 for d in D if "por despacho" in d["resultado"])} retirada(s) por despacho antes da reunião não constam da lista e ficam de fora da comparação')
chk('Decisões "A Diretoria Colegiada decidiu" no texto × decisões atribuídas a itens', sum(r['_ndec_total'] for r in R), sum(r['_ndec_blocos'] for r in R), 'texto: bullets "- A Diretoria Colegiada decidiu" (exclui o histórico citado em "Decisões anteriores"); itens com 2 decisões contam 2')
ok_p = 0; bad = []
for r in R:
    nomes = set()
    for q in Qd.get(r['reuniao'], []): nomes |= (set(q['rel']) if q['tipo'] != 'Retirada de pauta' else set()) | set(q['vencidos'])
    fora = [n for n in nomes if n not in r['presentes']]
    ok_p += not fora
    if fora: bad.append((r['reuniao'], fora))
chk('Presença: relatores e vencidos citados no corpo ⊆ presentes do cabeçalho (reuniões)', len(R), ok_p, str(bad))
vis_aus = [(r['reuniao'], q['item'], n) for r in R for q in Qd.get(r['reuniao'], []) for n in q['vista'] if n not in r['presentes']]
Q.append(['ANVISA', 'Vista concedida a diretor que consta como ausente na reunião', 0, len(vis_aus), 'OK' if not vis_aus else 'EXCEÇÃO', str(vis_aus)])
chk('Itens com chave única (reunião, processo, item)', len(D), len(cnt), f'{[k for k, n in cnt.items() if n > 1][:5]}')

# ---- Cobertura / pendencias / nao feito (denominadores: pautas e pastas de votos da propria ANVISA)
import datetime
inv = json.load(open('anvisa_inventario.json')); hoje = datetime.date.today()
MES = {'janeiro': 1, 'fevereiro': 2, 'marco': 3, 'abril': 4, 'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8, 'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12}
def data_slug(u):
    m = re.search(r'de-(\d+|1o)-de-([a-z]+)-de-2026', u); return datetime.date(2026, MES[m[2]], 1 if m[1] == '1o' else int(m[1])) if m else None
pend = []; com_ata = {r['reuniao'] for r in R}
todas = {}
for k, u in inv['pautas'].items(): todas[k] = ('pauta', data_slug(u))
for k in inv['votos_pastas']:
    m = re.match(r'rop-(\d+)', k)
    if m: todas.setdefault('ROP' + m[1], ('votos', None))
for k, (fonte, dt_) in sorted(todas.items(), key=lambda kv: int(re.sub(r'\D', '', kv[0]))):
    if k in com_ata: continue
    if dt_ and dt_ > hoje: pend.append(['ANVISA', k, dt_.isoformat(), 'Futura (só pauta)', 'pauta publicada', 'Ainda não ocorreu', 'Nada a fazer: rodar após a data']); continue
    pend.append(['ANVISA', k, dt_.isoformat() if dt_ else None, 'Realizada, ata aguardando publicação', f'existe {fonte}', 'Ata da ANVISA sai ~1–2 meses depois (ROP 9: 27/05 → 31/07)', 'Rodar rodar_tudo.sh'])
num = sorted({int(re.sub(r'\D', '', k)) for k in todas if k.startswith('ROP')} | {int(t[3:]) for t in com_ata if t.startswith('ROP')})
buraco = [x for x in range(1, max(num) + 1) if x not in num]
Q.append(['ANVISA', 'Numeração das ROP 1..max (pautas ∪ votos ∪ atas) sem buraco', 0, len(buraco), 'OK' if not buraco else 'EXCEÇÃO', f'sem pauta, voto nem ata: ROP {buraco} (numeração pulada? perguntar à ANVISA)' if buraco else ''])
for b in buraco: pend.append(['ANVISA', f'ROP{b}', None, 'Sem registro em nenhuma fonte', 'nem pauta, nem votos, nem ata', f'ROP {b-1} e {b+1} existem; ROP {b} não aparece', 'Perguntar à ANVISA se a numeração foi pulada'])
ret_ok = sum(1 for d in D if d['resultado'].startswith('RETIRADO'))
cob = [['ANVISA', 'Reuniões 2026 com ata lida', len(R), f'ROP {sorted(int(t[3:]) for t in com_ata if t.startswith("ROP"))} + REP {[t for t in com_ata if t.startswith("REP")]}'],
       ['ANVISA', 'Reuniões realizadas (pauta ou votos) sem ata', sum(1 for p in pend if p[3].startswith('Realizada')), ', '.join(p[1] for p in pend if p[3].startswith('Realizada'))],
       ['ANVISA', 'Itens de informe (seção I, sem votação)', sum(len(v) for k, v in Qd.items() if k.endswith('_informes')), 'ficam fora: não são deliberação'],
       ['ANVISA', 'Itens renumerados (duplicata de outro item)', sum(len(v) for k, v in Qd.items() if k.endswith('_renumerados')), 'ficam fora: contados no número novo']]
nf = [['ANVISA', 'Votos escritos (PDF por ROP)', f'{len(inv["votos_pastas"])} pastas de votos não lidas', 'NÃO FEITO', 'Só a ata foi lida; os votos escritos detalham divergências', 'Ler os PDFs de voto das ROP com maioria'],
      ['ANVISA', 'Votos já proferidos em itens com vista', f'{sum(1 for v in V if v["voto"].startswith("SEM VOTO AINDA"))} linhas "sem voto ainda"', 'NÃO FEITO', 'A ata cita os votos já dados antes da vista ("dos votos da Diretora X, do Diretor Y"); hoje todos os não-relator ficam "sem voto ainda"', 'Registrar esses votos como nominais'],
      ['ANVISA', 'Relator vencido: quem integra a maioria vencedora (DIVERGIU)', f'{sum(1 for v in V if v["voto"].startswith("DIVERGIU (votou contra o relator vencido") and v["proveniencia"] == "inferido")} linhas inferidas por exclusão (ROP5 4.1.2.1, ROP9 3.4.3.1) + {sum(1 for v in V if v["voto"].startswith("DIVERGIU (votou contra o relator vencido") and v["proveniencia"] == "nominal")} nominais (ROP6 3.4.1.1 nomeia quem acompanhou o voto vencedor; autor do voto vencedor nomeado nos demais)', 'LIMITE DA FONTE', 'A ata nomeia só os vencidos e o autor do voto vencedor; quem seguiu o voto vencedor sem ser nomeado entra por exclusão (todos presentes votaram). Convenção do extrato de CD: votar contra o relator = DIVERGIU', 'Conferir no voto escrito/vídeo da reunião'],
      ['ANVISA', 'VOTOU (antes da vista) sem posição', f'{sum(1 for v in V if v["voto"].startswith("VOTOU (antes da vista"))} linhas (inclui ROP2 3.5.7.2 Thiago, Voto nº 43/2026)', 'LIMITE DA FONTE', 'A ata diz que o diretor proferiu o voto, mas não diz se acompanhou ou divergiu do relator', 'Ler o PDF do voto escrito'],
      ['ANVISA', 'Impedimento/ausência na votação em itens de sessão reservada', f'{sum(1 for v in V if v["voto"].startswith(("IMPEDIDO", "AUSENTE DA VOTAÇÃO")))} linhas lidas das notas da ata (varredura de todo o item, exceto a 1ª sentença dos bullets de histórico "- ROP/SJO")', 'FEITO', 'O texto corrido do histórico não separa decisões anteriores do relato da sessão atual; retiradas de pauta mantêm o critério antigo (não varrem o item inteiro)', 'Se a ANVISA mudar o layout, rever o filtro de histórico'],
      ['ANVISA', 'Decisões compostas (I/II/III)', f'{sum(1 for d in D if "decisão composta" in d["resultado"])} itens', 'LIMITE DO MODELO', 'O resultado guarda a 1ª ação; as demais estão no texto da decisão', 'Listar todas as ações'],
      ['ANVISA', 'Itens com maioria sem vencido identificável', f'{sum(1 for v in V if v["proveniencia"] == "REVISAR")} linhas REVISAR', 'NÃO FEITO' if any(v['proveniencia'] == 'REVISAR' for v in V) else 'SEM CASOS', 'Ata diz "por maioria" sem nomear', 'Ler o voto escrito']]

tags_ok = sorted(m for m in man if man[m]['ok']); rops = sorted(int(t[3:]) for t in tags_ok if t.startswith('ROP'))
json.dump({'reunioes': [{k: v for k, v in r.items() if not k.startswith('_')} for r in R], 'deliberacoes': D, 'votos': V, 'qualidade': Q, 'cobertura': cob, 'pendencias': pend, 'nao_feito': nf, 'diretores': [n for n, _ in ROST], 'colegiado': 'Diretoria Colegiada', '_rops': rops}, open(out, 'w'), ensure_ascii=False, indent=1)
print(len(R), 'reunioes', len(D), 'itens', len(V), 'votos', dict(collections.Counter(d['tipo_item'] for d in D)))
for q in Q: print(q)
