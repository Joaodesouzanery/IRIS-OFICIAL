"""ANVISA: parser dos extratos de Circuito Deliberativo (tabela nominal de votacao) -> anvisa_cd.json
Uso: python3 -I scripts/anvisa_cd_parse.py manifesto_anvisa_cd.json anvisa_cd.json"""
import re, sys, json, subprocess, unicodedata, collections, datetime
man = json.load(open(sys.argv[1])); out = sys.argv[2]
inv = json.load(open('anvisa_cd_inventario.json'))
ROST = [('Leandro Pinheiro Safatle', r'LEANDRO\s+\w+\s+SAFATLE'), ('Daniel Meirelles Fernandes Pereira', r'DANIEL\s+MEIRELLES\s+FERNANDES(?:\s+PEREIRA)?'), ('Daniela Marreco Cerqueira', r'DANIELA\s+MARRECO\s+CERQUEIRA'), ('Thiago Lopes Cardoso Campos', r'THIAGO\s+LOPES\s+CARDOSO\s+CAMPOS'), ('Marcelo Mario Matos Moreira', r'MARCELO\s+\S+\s+\S+\s+MOREIRA'), ('Rômison Rodrigues Mota', r'R[ÔO]MISON\s+RODRIGUES\s+MOTA')]
NOMES = {n: p for n, p in ROST}
def norm(s): return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
def quem(t):
    t = norm(t); sob = {'Leandro Pinheiro Safatle': 'safatle|leandro', 'Daniel Meirelles Fernandes Pereira': 'daniel|meirelles|pereira', 'Daniela Marreco Cerqueira': 'daniela|marreco|cerqueira', 'Thiago Lopes Cardoso Campos': 'thiago|campos', 'Marcelo Mario Matos Moreira': 'marcelo|moreira', 'Rômison Rodrigues Mota': 'romison|mota'}
    return [n for n, p in sob.items() if re.search(r'\b(?:' + p + r')\b', t)]
def limpa(t): return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', t).replace('​', ''))
def dt(s):
    s = re.sub(r'[oº°]', '', s); d, m, a = s.split('/'); return f'{a}-{int(m):02d}-{int(d):02d}'
R, D, V, falhas, sem_tabela = [], [], [], [], []
VAL = r'(SIM|N[ÃA]O|ABSTEN[ÇC][ÃA]O|IMPEDID[OA]|AUSENTE|SUSPEIT[OA]|-|–)'
vistos_sha = {}; vistos_conteudo = {}; duplicados = []; erros_data = []
for m in sorted(man, key=lambda x: (x['cd'] or 0, x['arquivo'])):
    if not m['ok']: falhas.append(m['arquivo']); continue
    if m['sha256'] in vistos_sha: duplicados.append((m['arquivo'], vistos_sha[m['sha256']])); continue
    vistos_sha[m['sha256']] = m['arquivo']
    raw = subprocess.run(['pdftotext', '-layout', m['arquivo_local'], '-'], capture_output=True).stdout.decode('utf8', 'ignore'); t = limpa(raw)
    mc = re.search(r'Circuito Deliberativo\s*[,–-]?\s*CD\s*[-–]?\s*([\d.]+)/(\d{2,6})\s*[,–-]?\s*(.*?)\s*,?\s*(?:de\s*)?(\d{1,2}[oº°]?/\d{1,2}/\d{4})\s*,?\s*informo', t)
    if not mc: falhas.append(m['arquivo'] + ' (sem cabeçalho CD)'); continue
    cd_h = int(mc[1].replace('.', '')); cd = m['cd'] or cd_h; ano = 2026; assunto_cd = mc[3].strip(' ,-–'); data = dt(mc[4])
    if not data.startswith('2026'):
        ass_ = re.search(r'em (\d{2}/\d{2}/2026)', t[t.find('Documento assinado'):] if 'Documento assinado' in t else ''); erros_data.append((f'CD{cd}', data, dt(ass_[1]) if ass_ else None)); data = dt(ass_[1]) if ass_ else data
    ref = re.search(r'(ROP|REP)\s*(\d+)/(\d{4}),?\s*item\s*([\d.]+)', assunto_cd); tipo = re.sub(r',?\s*(ROP|REP).*$', '', assunto_cd).strip()
    rel_m = re.search(r'(?:Diretor(?:a)? )?Relator(?:a)?:\s*(.*?)\s*(?:Recorrente|Processos?:|Ementa|Interessad|CNPJ|Assunto|Posição)', t)
    rel = quem(rel_m[1]) if rel_m else []
    proc = re.findall(r'Processos?:\s*([\d.]{10,}/\d{4}-\d{2})', t); recte = (re.search(r'Recorrente:\s*(.*?)\s*CNPJ', t) or [None, ''])[1]
    ementa = (re.search(r'Ementa:\s*(.*?)\s*(?:Posi[çc][ãa]o|Diretoria:|[ÁA]rea:|INFORMA)', t) or [None, ''])[1]
    area = (re.search(r'[ÁA]rea:\s*(\S+)', t) or [None, ''])[1]
    votos = {}
    L = unicodedata.normalize('NFKC', raw).replace('\u200b', '').split('\n'); k0 = next((i for i, x in enumerate(L) if 'INFORMAÇÕES DA VOTAÇÃO' in x), None)
    if k0 is not None:
        linhas = []
        for x in L[k0 + 1:]:
            sx = x.strip()
            if re.match(r'(?:- ?A Diretoria|Documento assinado|- Retirado|O Diretor|A Diretoria|Registre-se|Circuito Deliberativo n|- Item|Item )', sx): break
            if not sx or re.match(r'Extrato de Delibera', sx) or re.match(r'DIRETOR\s+VOTO', sx): continue
            linhas.append(sx)
        rows = []
        for sx in linhas:
            if re.match(r'(?:LEANDRO|DANIELA|DANIEL|THIAGO|MARCELO|R[ÔO]MISON)\b', sx): rows.append(sx)
            elif rows: rows[-1] += ' ' + sx
        NT = {'LEANDRO', 'PINHEIRO', 'SAFATLE', 'DANIEL', 'MEIRELLES', 'FERNANDES', 'PEREIRA', 'DANIELA', 'MARRECO', 'CERQUEIRA', 'THIAGO', 'LOPES', 'CARDOSO', 'CAMPOS', 'MARCELO', 'MARIO', 'MÁRIO', 'MATOS', 'MATOIS', 'MOREIRA', 'RÔMISON', 'ROMISON', 'RODRIGUES', 'MOTA'}
        for r_ in rows:
            nome = next((n for n, p_ in ROST if re.match(p_.split(r'\s+')[0], r_)), None)
            first = r_.split()[0]; nome = next((n for n, _ in ROST if first == n.split()[0].upper() or (first in ('RÔMISON', 'ROMISON') and n.startswith('Rômison'))), None)
            if not nome: continue
            val = ' '.join(w for w in r_.split() if w not in NT).strip()
            votos[nome] = (val or '-').upper().replace('NAO', 'NÃO')
    if not votos: sem_tabela.append(m['arquivo']); 
    decis = ' '.join(re.findall(r'(?:- A Diretoria Colegiada.*?(?:Anvisa(?: \(SEI \d+\))?\.|\.$)|- Retirado de pauta\.?|- Item.*?\.)', t))[:1500]
    if not decis:
        md = re.search(r'(- ?A Diretoria Colegiada.*?)(?:Documento assinado|$)', t); decis = md[1][:1500] if md else ''
    unan = 'unanimidade' in decis; maior = 'maioria' in decis
    acao = (re.search(r'(?:por unanimidade|por maioria)[^A-ZÇÃÕ]{0,80}?([A-ZÇÃÕÉÊÍÓÚ]{4,}(?: (?:E |DE |DO |DA |O |A )?[A-ZÇÃÕÉÊÍÓÚ]{2,})*)', decis) or [None, ''])[1]
    if 'Retirado de pauta' in decis and 'A Diretoria Colegiada decidiu' not in decis: res_, tipo_item = 'RETIRADO DE PAUTA', 'Retirada de pauta'
    elif not decis: res_, tipo_item = 'SEM DECISÃO NO EXTRATO (revisar)', 'Deliberação'
    else: res_, tipo_item = f"{acao or 'DECIDIU'} — {'POR UNANIMIDADE' if unan else 'POR MAIORIA' if maior else 'SEM MODO'}", 'Deliberação'
    if tipo.lower().startswith('ata da') and tipo_item == 'Deliberação': tipo_item = 'Aprovação de ata'
    tag = f'CD{cd}'; deli = f'CD {cd}/{ano}'
    ck = (cd, proc[0] if proc else '', decis, tuple(sorted(votos.items())))
    if ck in vistos_conteudo: duplicados.append((m['arquivo'], vistos_conteudo[ck])); continue
    vistos_conteudo[ck] = m['arquivo']
    D.append({'reuniao': tag, 'data': data, 'processo': proc[0] if proc else deli, 'deliberacao': deli, 'item_n': deli, 'relator': rel[0] if rel else None, 'interessado': recte, 'assunto': (tipo + ' — ' + (ementa or recte or ''))[:600], 'resultado': res_, 'voto_doc': (re.search(r'Voto n[ºo]\s*([\d/A-Za-z.-]+)', decis) or [None, ''])[1], 'decisao_texto': decis, 'tipo_item': tipo_item, 'area': area, 'processos_do_item': proc, 'tipo_cd': tipo, 'origem_rop': (f"{ref[1]}{ref[2]}/{ref[3]}|{ref[4]}" if ref else ''), 'arquivo': m['arquivo'], 'cd_no_cabecalho': cd_h, 'secao': 'CD', 'unidade': area.split('/')[0] if area else ''})
    pres = [n for n in votos]; R.append({'reuniao': tag, 'titulo': f'Circuito Deliberativo nº {cd}/{ano}', 'tipo': 'Circuito Deliberativo (DICOL)', 'data': data, 'presentes': pres, 'ausentes': [], 'obs': ''})
    for n, v in votos.items():
        base = {'reuniao': tag, 'data': data, 'processo': proc[0] if proc else deli, 'deliberacao': deli, 'diretor': n}
        if v == 'SIM': voto = 'RELATOR (voto proferido)' if n in rel else 'ACOMPANHOU (SIM no extrato)'
        elif v in ('NÃO', 'NAO'): voto = 'DIVERGIU (NÃO no extrato)' if n not in rel else 'RELATOR (voto NÃO/retirada)'
        elif v.startswith('IMPED') or v.startswith('SUSP'): voto = 'IMPEDIDO (declarou-se impedido/suspeito)'
        elif v.startswith('ABST'): voto = 'ABSTEVE-SE'
        elif v in ('FÉRIAS', 'FERIAS', 'AFASTADO', 'AFASTADA', 'AUSENTE', 'LICENÇA', 'LICENCA'): voto = f'AUSENTE ({v.capitalize()} no extrato)'
        else: voto = 'SEM VOTO REGISTRADO (-) no extrato'
        V.append(dict(base, voto=voto, proveniencia='nominal'))
# ---- Qualidade
Q = []
def chk(nome, esp, obs, nota=''): Q.append(['ANVISA', nome, esp, obs, 'OK' if esp == obs else 'DIVERGE', nota])
ex_tot = inv['items_total']['extratos']; vo_tot = inv['items_total']['votos']
chk('Extratos de CD 2026: itens da listagem oficial (items_total) × arquivos baixados, lidos ou duplicados idênticos', ex_tot, len(D) + len(duplicados) + len(falhas), f'{len(duplicados)} arquivos repetidos pela ANVISA (mesmo conteúdo, nome com sufixo -1/_2); falhas: {falhas[:5]}')
cds = collections.Counter(d['reuniao'] for d in D)
rep = [k for k, n in cds.items() if n > 1]
nums = sorted(int(k[2:]) for k in cds)
buracos = [x for x in range(1, max(nums) + 1) if x not in nums]
chk('Extratos distintos = pares (CD, processo) únicos', len(D), len({(d['reuniao'], d['processo']) for d in D}), 'mesmo nº de CD reutilizado para dois processos: ' + str([k for k in rep]))
chk('Extratos com tabela nominal de votação lida', len(D), len(D) - len(sem_tabela), f'sem tabela: {sem_tabela[:6]}')
vv = collections.Counter(d['reuniao'] for d in D); nv = collections.defaultdict(int)
for v in V: nv[v['reuniao']] += 1
nvk = collections.Counter((v['reuniao'], v['processo']) for v in V)
chk('Votos por extrato = diretores listados na tabela (3 a 5)', len(D), sum(1 for d in D if 3 <= nvk[(d['reuniao'], d['processo'])] <= 5), 'fora de 3–5: ' + str([(d['reuniao'], nvk[(d['reuniao'], d['processo'])]) for d in D if not 3 <= nvk[(d['reuniao'], d['processo'])] <= 5][:8]))
vcd = {v['cd'] for v in inv['votos'] if v['cd']}; ecd = set(nums)
Q.append(['ANVISA', 'CDs com PDF de voto escrito publicado ⊆ CDs com extrato', len(vcd), len(vcd & ecd), 'OK' if vcd <= ecd else 'EXCEÇÃO', f'{len(vcd - ecd)} CDs têm o voto escrito do relator mas o extrato nominal não foi publicado: CD {sorted(vcd - ecd)[:20]}'])
Q.append(['ANVISA', 'Data do cabeçalho do extrato dentro de 2026', len(D), len(D) - len(erros_data), 'OK' if not erros_data else 'EXCEÇÃO', f'erro de data na fonte (usada a data da assinatura): {erros_data}'])
Q.append(['ANVISA', 'Numeração dos CD 2026 (1..max) sem buraco', 0, len(buracos), 'OK' if not buracos else 'EXCEÇÃO', f'{len(buracos)} números sem extrato publicado (ex.: {buracos[:12]}); a ANVISA publica extrato só após a ata da ROP citar? perguntar' if buracos else ''])
pend = [['ANVISA', f'CD {x[0][2:]}/2026', x[2], 'Erro de data no extrato (corrigido pela assinatura)', f'cabeçalho diz {x[1]}', 'Data do cabeçalho em outro ano', 'Nenhuma: já corrigido'] for x in erros_data] + [['ANVISA', f'CD {b}/2026', None, 'Circuito sem extrato publicado', 'não consta na listagem de extratos', 'Número intermediário sem extrato (pode ser cancelado, sigiloso ou ainda não publicado)', 'Rodar rodar_tudo.sh; perguntar à ANVISA'] for b in buracos]
json.dump({'duplicados': duplicados, 'reunioes': R, 'deliberacoes': D, 'votos': V, 'qualidade': Q, 'pendencias': pend, 'diretores': [n for n, _ in ROST[:5]], 'n_buracos': len(buracos)}, open(out, 'w'), ensure_ascii=False, indent=1)
print(len(D), 'extratos', len(V), 'votos', 'sem tabela', len(sem_tabela), 'falhas', len(falhas), 'buracos', len(buracos), 'max', max(nums))
for q in Q: print(q[1][:70], q[2], q[3], q[4])
