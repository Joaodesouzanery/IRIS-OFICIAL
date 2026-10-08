#!/usr/bin/env python3
"""Consolida ANM + ANTT + ARTESP em votos_2026.xlsx. Uso: python3 -I scripts/build_xlsx.py  (rodar dentro de 'TESTE CLAUDE/')"""
import json, re, glob, collections, os, sys, zipfile
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

anm, antt, art = (json.load(open(f)) for f in ('anm.json', 'antt.json', 'artesp_final.json'))
man_antt = {r['tag']: r for r in json.load(open('manifesto_antt.json'))}
inv_antt = json.load(open('antt_inventario.json')); inv_art = json.load(open('artesp_inventario.json'))
rde270 = json.load(open('antt_rde270.json'))
ano = lambda x: (x.get('data') or '')[:4]

# ---- ANM (só 2026)
keep_anm = {r['reuniao'] for r in anm['reunioes'] if ano(r) == '2026'}
R, D, V = [], [], []
for r in anm['reunioes']:
    if r['reuniao'] in keep_anm: R.append(dict(r, agencia='ANM', tipo='Ordinária (ROP)' if r['reuniao'].startswith('ROP') else 'Extraordinária (REP)', ausentes=[]))
for d in anm['deliberacoes']:
    if d['reuniao'] in keep_anm: D.append(dict(d, agencia='ANM', item=d['processo'], texto=d.get('deliberacao_texto', '')))
VX = []   # votos de ex-diretores (relator de reunião anterior): aparecem na aba Votos, mas NÃO entram nos totais de 2026
for v in anm['votos']:
    if v['reuniao'] in keep_anm: (VX if v.get('fora_total') else V).append(dict(v, agencia='ANM'))
# ---- ANTT
for r in antt['reunioes']: R.append(dict(r, agencia='ANTT'))
for d in antt['deliberacoes']: D.append(dict(d, agencia='ANTT', texto=d.get('decisao_texto', ''), item=d['processo']))
for v in antt['votos']: V.append(dict(v, agencia='ANTT'))
# RDE270: só votos dos relatores (sem ata)
for x in rde270:
    d = {'agencia': 'ANTT', 'reuniao': 'RDE270', 'data': '2026-03-02', 'processo': x['processo'], 'relator': x['relator'], 'interessado': '', 'assunto': x['objeto'],
         'resultado': 'SEM ATA — só o voto do relator (' + (x['encaminhamento'] or 'sem encaminhamento') + ')', 'voto_doc': x['arquivo'].replace('voto_Voto_', '').replace('.pdf.txt', ''), 'texto': '', 'item': x['processo']}
    D.append(d); V.append({'agencia': 'ANTT', 'reuniao': 'RDE270', 'data': '2026-03-02', 'processo': x['processo'], 'diretor': x['relator'], 'voto': 'RELATOR (proposta; resultado sem ata)', 'proveniencia': 'nominal'})
# ---- ARTESP
for r in art['reunioes']: R.append(dict(r, agencia='ARTESP'))
for d in art['deliberacoes']: D.append(dict(d, agencia='ARTESP', relator='Conselho Diretor', texto='', item=f"Del. {d['deliberacao']}", voto_doc=''))
PROC_ART = json.load(open('artesp_procedencia.json')) if os.path.exists('artesp_procedencia.json') else {}
for v in art['votos']:
    pr_ = PROC_ART.get(str(v.get('deliberacao'))) or {}
    nv_ = dict(v, agencia='ARTESP')
    if pr_.get('diretor') and v['diretor'] == pr_['diretor'] and not v['voto'].startswith(('AUSENTE', 'SEM VOTO')):
        nv_['voto'] = 'PROPONENTE (Procedência da deliberação: ' + pr_['procedencia'][:60] + ')'; nv_['proveniencia'] = 'nominal'
    V.append(nv_)
for d in D:
    pr_ = PROC_ART.get(str(d.get('deliberacao'))) if d['agencia'] == 'ARTESP' else None
    if pr_ and pr_.get('diretor'): d['relator'] = pr_['diretor'] + ' (proponente: ' + pr_['procedencia'][:40] + ')'

# ---- Agencias novas (um <sigla>.json por agencia; mesmo formato: reunioes/deliberacoes/votos + qualidade/cobertura/pendencias/nao_feito/diretores)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import agencias as AG
EXTRAS = AG.carregar()
for sg, x in EXTRAS.items():
    for r in x['reunioes']: R.append(dict(r, agencia=sg, ausentes=r.get('ausentes', [])))
    for d in x['deliberacoes']: D.append(dict(d, agencia=sg, texto=d.get('decisao_texto', ''), item=d['processo']))
    _pres = {r['reuniao']: set(r.get('presentes', [])) | set(r.get('ausentes', [])) for r in x['reunioes']}
    for v in x['votos']:
        if sg in AG.ex_fora_total() and v['diretor'] not in _pres.get(v['reuniao'], {v['diretor']}): VX.append(dict(v, agencia=sg, fora_total=True))   # ex-conselheiro (relator/votante de reunião anterior): na aba Votos, fora dos totais
        else: V.append(dict(v, agencia=sg))
AGS = ['ANM', 'ANTT', 'ARTESP'] + list(EXTRAS)

def tipo_de(d):
    r = d['resultado']
    if d.get('tipo_item'): return d['tipo_item']
    if r.startswith('CANCELADA'): return 'Cancelada'
    if r.startswith('RETIRADO'): return 'Retirada de pauta'
    if r.startswith('SOBRESTADO'): return 'Vista'
    if r.startswith('SEM ATA'): return 'Só voto do relator (sem ata)'
    return 'Deliberação'
for d in D: d['tipo_item'] = tipo_de(d)
def chave(x): return (x['agencia'], x['reuniao'], x.get('processo'), x.get('deliberacao'))
def kd(x): return f"{x['agencia']}|{x['reuniao']}|{x.get('processo')}|{x.get('deliberacao') or ''}"
TEMAS = json.load(open('temas.json')) if os.path.exists('temas.json') else {}
def tm(d, k, default=''): return (TEMAS.get(kd(d)) or {}).get(k, default)
res = {}
for d in D: res[(d['agencia'], d['reuniao'], d['processo'], d.get('deliberacao'))] = d
def get_res(v):
    d = res.get((v['agencia'], v['reuniao'], v['processo'], v.get('deliberacao')))
    return d or {}
for v in V + VX: v['tipo_item'] = get_res(v).get('tipo_item', 'Deliberação')

# ---- CICLO DA VISTA: liga o item em vista ao desfecho posterior do MESMO processo (mesma agência, reunião/data depois)
def _ck(x): return (x['agencia'], x['reuniao'], x.get('processo'), x.get('deliberacao'))
DESF = {}   # chave do item -> (status, chave do item do desfecho | None)
_por_proc = collections.defaultdict(list)
for d in D:
    if d['tipo_item'] in ('Deliberação', 'Vista', 'Aprovação de ata') and d.get('processo') and not str(d['processo']).startswith(('ROP', 'CD ')): _por_proc[(d['agencia'], d['processo'])].append(d)
for d in D:
    if d['tipo_item'] != 'Vista': continue
    seq = sorted([x for x in _por_proc.get((d['agencia'], d.get('processo')), []) if (x['data'] or '') > (d['data'] or '') or ((x['data'] or '') == (d['data'] or '') and _ck(x) != _ck(d) and x['reuniao'] > d['reuniao'])], key=lambda x: (x['data'] or '', x['reuniao']))
    fim = next((x for x in seq if x['tipo_item'] == 'Deliberação'), None)
    DESF[_ck(d)] = ('Resolvido em ' + fim['reuniao'] + ' (' + (fim['data'] or '') + ')', _ck(fim)) if fim else ('Aberto: vista ainda sem desfecho em 2026', None)
def status_proc(x): return DESF.get(_ck(x), ('', None))[0]
_resx = {}
for d in D: _resx[_ck(d)] = d
def desfecho_final(x):
    k = DESF.get(_ck(x), ('', None))[1]; return _resx[k]['resultado'] if k else ''
_vk = {}
for v in V: _vk[(v['agencia'], v['reuniao'], v.get('processo'), v.get('deliberacao'), v['diretor'])] = v
def voto_final(v):
    k = DESF.get((v['agencia'], v['reuniao'], v.get('processo'), v.get('deliberacao')), ('', None))[1]
    if not k: return ''
    w = _vk.get(k + (v['diretor'],)); return w['voto'] if w else ''

wb = Workbook(); wb.remove(wb.active)
def sheet(nome, cab, linhas, larg=None):
    ws = wb.create_sheet(nome); ws.append(cab)
    for c in ws[1]: c.font = Font(bold=True, color='FFFFFF'); c.fill = PatternFill('solid', fgColor='1F3A5F'); c.alignment = Alignment(wrap_text=True, vertical='top')
    for l in linhas: ws.append([('; '.join(map(str, c)) if isinstance(c, (list, tuple)) else c) for c in l])
    for i, c in enumerate(cab, 1): ws.column_dimensions[get_column_letter(i)].width = (larg or {}).get(c, 16)
    ws.freeze_panes = 'A2'; ws.auto_filter.ref = ws.dimensions; return ws

# ---- Resumo por diretor
def kind(v):
    t = v['voto']
    if t.startswith('RELATOR') or t.startswith('RETIROU') or t.startswith('PROPONENTE'): return 'como relator/proponente'
    if t.startswith('ACOMPANHOU'): return 'acompanhou'
    if t.startswith('VOTOU'): return 'votou (antes da vista)'
    if t.startswith('NÃO PARTICIPOU'): return 'sem voto (não votou)'
    if t.startswith('SEM VOTO REGISTRADO'): return 'a revisar'
    if t.startswith('DIVERGIU'): return 'divergiu'
    if t == 'PEDIU VISTA': return 'pediu vista'
    if t.startswith('AUSENTE'): return 'ausente'
    if t.startswith('IMPEDIDO'): return 'impedido'
    if t.startswith('SEM VOTO (não votou'): return 'sem voto (não votou)'
    if t.startswith('SEM VOTO'): return 'sem voto (retirado de pauta)'
    if t.startswith('VISTA COLETIVA'): return 'pediu vista'
    return 'a revisar'
cols = ['como relator/proponente', 'acompanhou', 'divergiu', 'pediu vista', 'ausente', 'sem voto (retirado de pauta)', 'votou (antes da vista)', 'a revisar', 'aprovou a ata anterior']
cnt = collections.defaultdict(collections.Counter)
for v in V:
    c = cnt[(v['agencia'], v['diretor'])]; c['registros'] += 1; c['aprovou a ata anterior' if v['tipo_item'] == 'Aprovação de ata' else kind(v)] += 1; c['nominal'] += v['proveniencia'] == 'nominal'; c['inferido'] += v['proveniencia'] == 'inferido'
    c['deliberações votadas (sem ausência)'] += kind(v) not in ('ausente',)
tot = ['registros'] + cols + ['nominal', 'inferido']
sheet('Resumo por diretor', ['Agência', 'Diretor', 'Registros (linhas de voto)'] + [c.capitalize() for c in cols] + ['Votos nominais', 'Votos inferidos (unanimidade)'],
      [[a, d, cnt[(a, d)]['registros']] + [cnt[(a, d)][c] for c in cols] + [cnt[(a, d)]['nominal'], cnt[(a, d)]['inferido']] for (a, d) in sorted(cnt)], {'Diretor': 40})
mes = collections.defaultdict(collections.Counter)
for v in V: mes[(v['agencia'], v['diretor'])][(v['data'] or '')[:7]] += 1
meses = sorted({m for c in mes.values() for m in c})
sheet('Diretor por mês', ['Agência', 'Diretor'] + meses, [[a, d] + [mes[(a, d)][m] for m in meses] for (a, d) in sorted(mes)], {'Diretor': 40})

# ---- Votos / Deliberações / Reuniões
sheet('Votos', ['Agência', 'Reunião', 'Data', 'Processo', 'Deliberação nº', 'Diretor', 'Voto', 'Proveniência', 'Tipo de item', 'Resultado da deliberação', 'Relator', 'Modal', 'Tema', 'Subtema'],
      [[v['agencia'], v['reuniao'], v['data'], v['processo'], v.get('deliberacao', ''), v['diretor'], v['voto'], v['proveniencia'], v['tipo_item'], get_res(v).get('resultado', ''), get_res(v).get('relator', ''), tm(get_res(v), 'modal'), tm(get_res(v), 'tema'), tm(get_res(v), 'subtema')] for v in V],
      {'Diretor': 38, 'Voto': 30, 'Tipo de item': 22, 'Resultado da deliberação': 34, 'Relator': 38, 'Processo': 24, 'Modal': 26, 'Tema': 22, 'Subtema': 28})
sheet('Deliberações', ['Agência', 'Reunião', 'Data', 'Processo', 'Deliberação nº', 'Tipo de item', 'Relator', 'Interessado', 'Assunto', 'Resultado', 'Voto (doc)', 'Modal', 'Tema', 'Subtema', 'Tipo de ato', 'Microtema (IRIS)', 'Área (IRIS)', 'Confiança', 'Fonte da classificação', 'Texto da decisão'],
      [[d['agencia'], d['reuniao'], d['data'], d['processo'], d.get('deliberacao', ''), d['tipo_item'], d.get('relator'), d.get('interessado', ''), d.get('assunto', ''), d['resultado'], d.get('voto_doc', ''), tm(d, 'modal'), tm(d, 'tema'), tm(d, 'subtema'), tm(d, 'tipo_ato'), tm(d, 'microtema_iris'), tm(d, 'area_iris'), tm(d, 'confianca', ''), tm(d, 'fonte'), d.get('texto', '')] for d in D],
      {'Relator': 36, 'Interessado': 40, 'Assunto': 50, 'Texto da decisão': 80, 'Processo': 24, 'Resultado': 34, 'Tipo de item': 22, 'Modal': 26, 'Tema': 22, 'Subtema': 28, 'Tipo de ato': 22})
nd = collections.Counter((d['agencia'], d['reuniao']) for d in D)
sheet('Reuniões', ['Agência', 'Reunião', 'Data', 'Tipo', 'Presentes', 'Ausentes', 'Nº deliberações lidas', 'Observação'],
      [[r['agencia'], r['reuniao'], r.get('data'), r.get('tipo', ''), '; '.join(r.get('presentes', [])), '; '.join(r.get('ausentes', [])), nd[(r['agencia'], r['reuniao'])], r.get('obs', '')] for r in sorted(R, key=lambda r: (r['agencia'], r.get('data') or ''))],
      {'Presentes': 70, 'Ausentes': 30, 'Observação': 40})

# ---- Qualidade (checagens automáticas; cada linha pode falhar)
Q = []
def chk(ag, nome, esp, obs, nota=''): Q.append([ag, nome, esp, obs, 'OK' if esp == obs else 'DIVERGE', nota])
for ag, pat, pasta in (('ANM', r'DELIBERA[ÇC][ÃA]O:', 'texto/{}.txt'), ('ANTT', r'Decis[ãa]o:', 'texto_antt/{}__ata_*')):
    tot_ancora = tot_lido = 0
    for r in R:
        if r['agencia'] != ag or r.get('obs'): continue
        fs = glob.glob(pasta.format(r['reuniao']))
        if not fs: continue
        t = open(fs[0], encoding='utf8').read().replace('\u200b', ''); t = re.sub(r'D\s?ecis[ãa]o:', 'Decisão:', t); tot_ancora += len(re.findall(pat, t)); tot_lido += sum(1 for d in D if d['agencia'] == ag and d['reuniao'] == r['reuniao'] and d['tipo_item'] in (('Deliberação', 'Vista') if ag == 'ANM' else ('Deliberação', 'Vista', 'Retirada de pauta')))
    if ag == 'ANM': tot_ancora -= sum(r.get('itens_duplicados_na_ata', 0) for r in R if r['agencia'] == 'ANM')   # itens que a própria ata imprime 2x
    chk(ag, f'Itens com desfecho (' + ('mérito+vista' if ag == 'ANM' else 'mérito, vista, retirada') + f') lidos × âncoras "{pat}" nas atas', tot_ancora, tot_lido, 'diferença = âncora citada em texto corrido ou item multi-linha; ver amostra')
tx = {f.split('/')[1][:-4]: open(f, encoding='utf8').read() for f in glob.glob('texto_artesp/*.txt')}
sys_path = __import__('sys').path; sys_path.insert(0, 'scripts'); import artesp_parse as ap
def _anc(t):
    t = ap.limpa(t); reg = t.find('PARA REGISTRO'); reg = reg if reg >= 0 else len(t) + 1
    return sum(1 for m in re.finditer(r'\d{1,3}\. Delibera[çc][ãa]o ARTESP n[ºo] ?\d+\.?', t) if m.start() < reg and re.match(r'[\s.]*(?:\(Cancelad[oa]\)[\s.]*)?Processo\s+SEI', t[m.end():m.end() + 60], re.I))
anc = sum(_anc(t) for k, t in tx.items() if k != 'S230_243')
extra = sum(1 for d in D if d['agencia'] == 'ARTESP' and d['reuniao'] == 'S230_243')
chk('ARTESP', 'Deliberações lidas × âncoras "N. Deliberação ARTESP nº" nas atas (243ª: reconstruída dos PDFs)', anc + extra, sum(1 for d in D if d['agencia'] == 'ARTESP'), 'ata da 243ª é a da 244ª (erro da ARTESP)')
nums = {d['deliberacao'] for d in D if d['agencia'] == 'ARTESP'}; falt = [x for x in range(1, max(nums) + 1) if x not in nums]
dels = collections.Counter(d['deliberacao'] for d in D if d['agencia'] == 'ARTESP')
Q.append(['ARTESP', 'Numeração das deliberações 1..max sem buraco', 0, len(falt), 'OK' if not falt else 'EXCEÇÃO', f'sem registro em ata nem em PDF de Deliberação: {falt}; repetidos: {[k for k, n in dels.items() if n > 1]}'])
for ag in AGS:
    vs = [v for v in V if v['agencia'] == ag]; c = collections.Counter(v['proveniencia'] for v in vs)
    chk(ag, 'nominal + inferido + REVISAR + n/a = total de votos', len(vs), sum(c.values()), str(dict(c)))
    chk(ag, 'Datas dentro de 2026', len(vs), sum(1 for v in vs if (v['data'] or '').startswith('2026')))
    pres = collections.defaultdict(set)
    for r in R:
        if r['agencia'] == ag: pres[r['reuniao']] = set(r.get('presentes', [])) | set(r.get('ausentes', []))
    ext_ = {(d['agencia'], d['reuniao'], d['processo'], d.get('deliberacao')) for d in D if str(d.get('voto_fonte', '')).startswith('extrato')}
    fora = sum(1 for v in vs if (ag, v['reuniao'], v['processo'], v.get('deliberacao')) not in ext_ and v['reuniao'] in pres and pres[v['reuniao']] and v['diretor'] not in pres[v['reuniao']] and not v['voto'].startswith('RELATOR'))
    chk(ag, 'Votos de diretor que não está na presença/ausência da reunião (exceto relator)', 0, fora, 'relator de vista pode ser diretor de reunião anterior (ANM)')
for sg, x in EXTRAS.items(): Q.extend(x['qualidade'])
sheet('Qualidade', ['Agência', 'Checagem', 'Esperado', 'Observado', 'Status', 'Nota'], Q, {'Checagem': 70, 'Nota': 80})

# ---- Cobertura
a26 = [c for c in inv_antt if c['data'].endswith('2026')]; tp = collections.Counter(c['tipo'] for c in a26)
sem_ata = [r['reuniao'] for r in antt['reunioes'] if r['obs']]
FUT = {'ROD1043': '08/10/2026', 'RDE302': '13/10/2026'}
AGU = [x for x in ('ROD1042', 'RDE300', 'RDE299', 'RDE301') if x in sem_ata]
art26 = [r for r in inv_art if r['data'].endswith('2026')]
ordn = sorted(r['numero'] for r in art26 if r['numero'] > 1000); ext = sorted(r['numero'] for r in art26 if r['numero'] < 1000)
lidas_art = sum(1 for r in art['reunioes'] if not r.get('obs'))
dist = lambda ag: collections.Counter(d['resultado'] for d in D if d['agencia'] == ag)
cob = [
 ['ANM', 'Calendário oficial de ROPs 2026 (PDF da ANM)', 12, 'Denominador independente'],
 ['ANM', 'ROPs que já deveriam ter ocorrido até 07/10/2026', 9, '28/1,23/2,25/3,29/4,27/5,30/6*,29/7,19/8,30/9 (*a ROP86 foi em 30/06; calendário previa 24/06)'],
 ['ANM', 'ROPs com ata publicada e lida (81ª a 88ª)', 8, 'Fonte: subpágina atas-da-rop/atas-reunioes-ordinarias (59ª a 88ª sem buraco). A página-índice mostra só as 8 mais recentes'],
 ['ANM', 'ROP sem ata ainda', 1, '89ª (30/09): só a PAUTA está publicada; ata aguardando publicação'],
 ['ANM', 'Reuniões extraordinárias (REP) em 2026', 0, 'A última, 34ª, é de 19/11/2025'],
 ['ANM', 'Deliberações lidas (ROP 81–88)', sum(1 for d in D if d['agencia'] == 'ANM'), str(dict(dist('ANM'))) + ' — ROP87 lida por OCR'],
 ['ANTT', 'Reuniões listadas em 2026 (listagem paginada até 2025)', len(a26), f'Tipos: {dict(tp)}'],
 ['ANTT', 'Reuniões administrativas', 37, 'Só têm PAUTA publicada (sem ata/voto): fora do escopo'],
 ['ANTT', 'Reuniões deliberativas (Ord.+Extra+Eletrônicas)', len(antt['reunioes']), 'Sequências sem buraco: Ord. 1024-1043, Extra 99-102, Eletr. 263-302'],
 ['ANTT', 'Futuras (só pauta; ainda não ocorreram)', len(FUT), ', '.join(f'{k} ({v})' for k, v in FUT.items())],
 ['ANTT', 'Realizadas', len(antt['reunioes']) - len(FUT), ''],
 ['ANTT', 'Realizadas COM ata lida', len(antt['reunioes']) - len(sem_ata), ''],
 ['ANTT', 'Realizadas, ata ainda não publicada (set–out/2026)', len(AGU), ', '.join(AGU) + ' — votos individuais já publicados (exceto 301ª)'],
 ['ANTT', 'Realizada SEM ata (lacuna antiga)', 1, 'RDE270 (02/03/2026): só os 4 votos de relator; entram na planilha como "SEM ATA", sem resultado'],
 ['ANTT', 'Deliberações lidas', sum(1 for d in D if d['agencia'] == 'ANTT'), str(dict(dist('ANTT')))],
 ['ARTESP', 'Reuniões listadas em 2026 (página + Chromium comum)', len(art26), f'Ordinárias {ordn[0]}ª–{ordn[-1]}ª ({len(ordn)}, sem buraco; 1177ª = 13/01/2026) + Extraordinárias {ext[0]}–{ext[-1]} ({len(ext)}, sem buraco)'],
 ['ARTESP', 'Atas baixadas', len(art['reunioes']), f'{len(art26)} de {len(art26)}; {lidas_art} corretas + 1 trocada (a "ata" da 243ª é a da 244ª); 168 PDFs/ZIPs (Ata, Pauta, Deliberações) sem falha, hashes em manifesto_artesp_*.json'],
 ['ARTESP', 'Conciliação com os PDFs de Deliberação', '708 PDFs', 'Corrigidos 2 números digitados errado na ata (282→303, 479→480) e reconstruída a 243ª (539 e 540, via OCR). Sem registro em nenhuma fonte: nºs 12, 76, 77, 80, 102, 103'],
 ['ARTESP', 'Deliberações lidas', sum(1 for d in D if d['agencia'] == 'ARTESP'), str(dict(dist('ARTESP')))],
 ['ARTESP', 'Presença', 'ver Reuniões', 'Constituição da ata: 4 diretores (47 reuniões) ou 3 com ausência justificada nominal (9 reuniões)'],
]
for ag in AGS:
    ct = collections.Counter(d['tipo_item'] for d in D if d['agencia'] == ag)
    cob.append([ag, 'Itens da ata por tipo (todos têm 1 linha de voto por diretor, exceto Cancelada)', sum(ct.values()), '; '.join(f'{k}: {v}' for k, v in ct.most_common())])
for ag in AGS:   # resumo honesto de cobertura de votos: o que existe × o que a fonte entregou (ZERO / PARCIAL / COMPLETA)
    _rs = [r for r in R if r['agencia'] == ag]; _com = {d['reuniao'] for d in D if d['agencia'] == ag}
    _sem = [r['reuniao'] for r in _rs if r['reuniao'] not in _com]; _vs = [v for v in V if v['agencia'] == ag]
    _n = collections.Counter(v['proveniencia'] for v in _vs)
    _st = 'ZERO (nenhum voto lido)' if not _vs else ('PARCIAL' if _sem else 'COMPLETA no que a fonte publicou')
    cob.append([ag, 'COBERTURA DE VOTOS (resumo)', f'{len(_vs)} votos', f'{_st} · reuniões listadas {len(_rs)}, com itens lidos {len(_rs) - len(_sem)}, sem itens {len(_sem)}' + (f' ({", ".join(_sem[:8])}{"…" if len(_sem) > 8 else ""})' if _sem else '') + f' · nominal {_n["nominal"]}, inferido {_n["inferido"]}, REVISAR {_n["REVISAR"]}'])
for sg, x in EXTRAS.items(): cob += x['cobertura']
sheet('Cobertura', ['Agência', 'Medida', 'Valor', 'Nota'], cob, {'Medida': 70, 'Nota': 110})
sheet('Pendências', ['Item', 'Detalhe'], [
 ['Proveniência', 'inferido = a ata diz "por unanimidade": todos os presentes acompanharam (não há voto individual escrito). nominal = o texto cita o diretor (relator, vista, ausente, retirada, divergência).'],
 ['REVISAR', 'Maioria, vista pendente ou texto ambíguo: a ata não nomina quem votou como; exige o voto individual/vídeo.'],
 ['ANM', 'Ata da 89ª ROP (30/09) ainda não publicada. Métricas cobrem ROP 81–88 (jan–ago/2026).'],
 ['ANTT', 'Atas ausentes: 299ª, 300ª, 301ª, 1042ª (publicação) e 270ª (lacuna antiga: só votos de relator). 3 reuniões futuras.'],
 ['ANTT', '99 PDFs de voto são imagem e não foram lidos (a ata já traz o resultado).'],
 ['ARTESP', 'Numeração de deliberações com buracos e repetições: ver aba Qualidade. Deliberações canceladas não têm voto.'],
 ['Qualidade', 'Parser conferido por contagem automática e amostra manual (ver AMOSTRA.md); não é auditoria completa.'],
], {'Detalhe': 150})
sheet('ARTESP inventário', ['Série', 'Nº', 'Data', 'Pauta', 'Ata', 'Deliberações (ZIP)'],
      [['Ordinária' if r['numero'] > 1000 else 'Extraordinária', r['numero'], r['data'], *['sim' if any(d['rotulo'].lower().startswith(k) for d in r['docs']) else 'NÃO' for k in ('pauta', 'ata', 'delib')]] for r in sorted(art26, key=lambda r: (r['numero'] > 1000, r['numero']))])

# ---- Matriz de votos (1 linha por deliberação, 1 coluna por diretor)
import datetime
hoje = datetime.date.today()
ordem = {'ANM': ['Mauro Henrique Moreira Sousa', 'Fábio Fernando Borges', 'Luiz Paniago Neves', 'José Fernando de Mendonça Gomes Júnior'],
         'ANTT': ['Guilherme Theo Rodrigues da Rocha Sampaio', 'Felipe Fernandes Queiroz', 'Lucas Asfor da Rocha Lima', 'Alex Antônio de Azevedo Cruz', 'Alessandro Baumgartner', 'Marcelo Cardoso Fonseca', 'Severino Medeiros Ramos Neto'],
         'ARTESP': ['André Isper Rodrigues Barnabé', 'Diego Albert Zanatto', 'Fernanda Esbízaro Rodrigues Rudnik', 'Raquel França Carneiro']}
for sg, x in EXTRAS.items(): ordem[sg] = x['diretores']
vidx = collections.defaultdict(dict)
for v in V: vidx[(v['agencia'], v['reuniao'], v['processo'], v.get('deliberacao'))][v['diretor']] = v
def cod(v):
    t = v['voto']; b = ('RELATOR' if t.startswith(('RELATOR', 'PROPONENTE')) else 'RETIROU' if t.startswith('RETIROU') else 'ACOMPANHOU' if t.startswith('ACOMPANHOU') else 'DIVERGIU' if t.startswith('DIVERGIU')
                        else 'VISTA' if 'VISTA' in t and not t.startswith('SEM') else 'AUSENTE' if t.startswith('AUSENTE') else 'VOTOU' if t.startswith('VOTOU') else 'N/PARTIC' if t.startswith('NÃO PARTICIPOU') else 'REVISAR' if t.startswith('SEM VOTO REGISTRADO') else 'sem voto' if t.startswith('SEM VOTO') else 'IMPEDIDO' if t.startswith('IMPEDIDO') else 'REVISAR')
    return b + ('*' if v['proveniencia'] == 'inferido' else '')
for ag in AGS:
    cabs = ordem[ag]; linhas = []
    for d in D:
        if d['agencia'] != ag or d['tipo_item'] == 'Cancelada': continue
        m = vidx.get((ag, d['reuniao'], d['processo'], d.get('deliberacao')), {})
        linhas.append([d['reuniao'], d['data'], d['processo'], d.get('deliberacao', ''), d['tipo_item'], d['resultado'], tm(d, 'tema')] + [cod(m[x]) if x in m else '—' for x in cabs] + [len(m)])
    sheet('Matriz ' + ag, ['Reunião', 'Data', 'Processo', 'Deliberação nº', 'Tipo de item', 'Resultado', 'Tema'] + [x.split()[0] + ' ' + x.split()[-1] for x in cabs] + ['Nº de votos'], linhas, {'Resultado': 32, 'Tipo de item': 20, 'Processo': 24})
    wb['Matriz ' + ag].cell(row=len(linhas) + 3, column=1, value='* = voto inferido (ata diz unanimidade); sem asterisco = nominal; — = diretor não faz parte da reunião')
# ---- Qualidade: 1 voto por diretor presente/ausente em cada deliberação
falhas = []
rmap = {(r['agencia'], r['reuniao']): r for r in R}
for d in D:
    if d['tipo_item'] in ('Cancelada', 'Só voto do relator (sem ata)'): continue
    r = rmap.get((d['agencia'], d['reuniao']))
    n_esp = len(set(r.get('presentes', [])) | set(r.get('ausentes', []))) if r else 0
    n_obs = len(vidx.get((d['agencia'], d['reuniao'], d['processo'], d.get('deliberacao')), {}))
    if str(d.get('voto_fonte', '')).startswith('extrato'): continue   # votantes vêm da tabela nominal do extrato do CD (podem diferir dos presentes da ROP)
    if n_esp != n_obs: falhas.append((d['agencia'], d['reuniao'], d['processo'], n_esp, n_obs))
for ag in AGS:
    tot_d = sum(1 for d in D if d['agencia'] == ag and d['tipo_item'] not in ('Cancelada', 'Só voto do relator (sem ata)'))
    ruim = [f for f in falhas if f[0] == ag]
    Q.append([ag, 'Cada deliberação não cancelada tem 1 linha de voto por diretor presente/ausente', tot_d, tot_d - len(ruim), 'OK' if not ruim else 'DIVERGE', f'{len(ruim)} divergentes: {ruim[:4]}' if ruim else ''])
# ---- Presença conferida por FONTE INDEPENDENTE (assinaturas + relatorias): não usa a lista de presentes para se validar
import unicodedata, antt_parse as at
nz = lambda x: ''.join(c for c in unicodedata.normalize('NFD', x.lower()) if unicodedata.category(c) != 'Mn')
def _chk_presenca():
    out = {}
    # ANTT: (assinantes ∪ relatores) − ausentes declarados ⊆ presentes
    bad = []; n = 0
    for r in R:
        if r['agencia'] != 'ANTT' or r.get('obs') or not glob.glob(f"texto_antt/{r['reuniao']}__ata_*"): continue
        t = re.sub(r'\s+', ' ', open(glob.glob(f"texto_antt/{r['reuniao']}__ata_*")[0], encoding='utf8').read()); n += 1
        sig = set(at._quem(' '.join(re.findall(r'assinado eletronicamente por ([^,]{5,70}),\s*Diretor', t))))
        rel = {d['relator'] for d in D if d['agencia'] == 'ANTT' and d['reuniao'] == r['reuniao'] and d.get('relator') in at.ORDEM}
        E = (sig | rel) - set(r['ausentes'])
        if not E <= set(r['presentes']): bad.append((r['reuniao'], sorted(x.split()[0] for x in E - set(r['presentes']))))
    out['ANTT'] = (n, n - len(bad), bad, 'assinantes ∪ relatores (menos ausentes declarados) ⊆ presentes. Ausente declarado pode assinar a ata depois (ROD1030)')
    # ANM: assinantes == presentes
    bad = []; n = 0
    for r in R:
        if r['agencia'] != 'ANM': continue
        t = re.sub(r'\s+', ' ', open(f"texto/{r['reuniao']}.txt", encoding='utf8').read()); n += 1
        sig = {nz(a).split()[0] for a in re.findall(r'assinado eletronicamente por\s+([A-ZÁÉÍÓÚÂÊÃÕÇ][^,]{5,60}),', t)}; pr = {nz(p).split()[0] for p in r['presentes']}
        if sig != pr: bad.append((r['reuniao'], sorted(pr ^ sig)))
    out['ANM'] = (n, n - len(bad), bad, 'assinantes do SEI == presentes da ata')
    # ARTESP: signatários (2 formatos: e-assinatura ou lista de nomes no fim) ⊆ presentes ∪ ausentes e presentes ⊆ signatários
    bad = []; n = 0; nv = []
    for r in R:
        if r['agencia'] != 'ARTESP' or r.get('obs') or not os.path.exists(f"texto_artesp/{r['reuniao']}.txt"): continue
        t = open(f"texto_artesp/{r['reuniao']}.txt", encoding='utf8').read(); n += 1
        tail = nz(re.sub(r'\s+', ' ', t)[-2200:]); E = {k for k in ap.DIRS if k in tail}
        if not E: nv.append(r['reuniao']); n -= 1; continue   # PDF sem bloco de assinaturas: não verificável
        pr = {k for k in ap.DIRS if ap.DIRS[k] in r['presentes']}; au = {k for k in ap.DIRS if ap.DIRS[k] in r['ausentes']}
        if not (pr <= E and E <= pr | au): bad.append((r['reuniao'], sorted(pr ^ E)))
    out['ARTESP'] = (n, n - len(bad), bad, f'presentes ⊆ signatários ⊆ presentes ∪ ausentes (bloco final da ata). Não verificável (PDF da ata sem bloco de assinaturas): {nv}')
    return out
for ag, (n, ok, bad, nota) in _chk_presenca().items():
    Q.append([ag, 'Presença conferida por assinatura/relatoria (fonte independente)', n, ok, 'OK' if not bad else 'DIVERGE', f'{nota}. Divergentes: {bad[:8]}' if bad else nota])
wb.remove(wb['Qualidade']); sheet('Qualidade', ['Agência', 'Checagem', 'Esperado', 'Observado', 'Status', 'Nota'], Q, {'Checagem': 70, 'Nota': 80})

# ---- Pendências da fonte (gerada dos dados a cada rodada)
fatos = json.load(open('fatos_fonte.json')) if os.path.exists('fatos_fonte.json') else {}
P = []   # (agencia, reuniao, data, situacao, existe, motivo, como)
cal = json.load(open('calendario_anm_2026.json'))['rops']
pub = {r['reuniao'][3:] for r in R if r['agencia'] == 'ANM' and r['reuniao'].startswith('ROP')}
for n, dt in cal.items():
    if n in pub: continue
    dd = datetime.date.fromisoformat(dt)
    if dd > hoje: P.append(('ANM', f'ROP{n}', dt, 'Futura (calendário oficial)', 'nada ainda', 'Ainda não ocorreu', 'Nada a fazer: rodar após a data'))
    else:
        dias = (hoje - dd).days
        P.append(('ANM', f'ROP{n}', dt, 'Lacuna antiga (>45 dias sem ata)' if dias > 45 else 'Realizada, ata aguardando publicação', fatos.get('anm_pauta_' + n, 'pauta publicada' if n in fatos.get('anm_pautas', []) else 'sem pauta/ata'),
                  f'{dias} dias desde a reunião; atas anteriores saíram em ~3–4 semanas', 'Rodar rodar_tudo.sh: subpágina atas-da-rop/atas-reunioes-ordinarias; cobrar a ANM se passar de 45 dias'))
for r in R:
    if r['agencia'] != 'ANTT': continue
    mm = man_antt.get(r['reuniao'], {}); docs = mm.get('docs', []); dd = datetime.date.fromisoformat(r['data'])
    existe = ', '.join(f"{n} {t}" for t, n in collections.Counter(d['tipo'] for d in docs).items())
    if r.get('obs'):
        if dd > hoje: P.append(('ANTT', r['reuniao'], r['data'], 'Futura (só pauta)', existe, 'Ainda não ocorreu', 'Nada a fazer: rodar após a data'))
        else:
            dias = (hoje - dd).days
            P.append(('ANTT', r['reuniao'], r['data'], 'Lacuna antiga (>30 dias sem ata)' if dias > 30 else 'Realizada, ata aguardando publicação', existe, f'{dias} dias desde a reunião' + ('; votos de relator lidos (sem resultado)' if r['reuniao'] == 'RDE270' else ''), 'Rodar rodar_tudo.sh; perguntar à ANTT se passar de 30 dias'))
a243 = [r for r in R if r['agencia'] == 'ARTESP' and 'ATA PUBLICADA' in (r.get('obs') or '')]
for r in a243: P.append(('ARTESP', r['reuniao'], r['data'], 'Ata publicada na reunião errada', 'Pauta, ZIP de Deliberações (539 e 540, OCR)', 'A "ata" desta reunião é a da 244ª (erro de publicação da ARTESP)', 'Pedir à ARTESP a ata da 243ª; rodar rodar_tudo.sh quando corrigirem'))
for n in falt: P.append(('ARTESP', f'Deliberação nº {n}', '', 'Número sem registro em nenhuma fonte', 'nada (nem ata nem PDF)', 'Provavelmente cancelada sem listagem; a ARTESP não publica', 'Perguntar à ARTESP; rodar rodar_tudo.sh periodicamente'))
for d in D:
    if d['agencia'] == 'ARTESP' and d.get('numero_na_ata'): P.append(('ARTESP', f"{d['reuniao']} Del. {d['deliberacao']}", d['data'], 'Erro de numeração na fonte (corrigido pelo PDF)', f"ata diz {d['numero_na_ata']}; PDF diz {d['deliberacao']}", 'Número digitado errado na ata', 'Nenhuma: já corrigido na planilha'))
for r in R:
    if r['agencia'] == 'ARTESP' and r['reuniao'] == 'ORD1187': P.append(('ARTESP', r['reuniao'], r['data'], 'Erro de digitação no título da ata (sem efeito)', 'ata completa', 'Título diz 1178ª; data e conteúdo são da 1187ª', 'Nenhuma'))
for sg, x in EXTRAS.items():
    for pe in x['pendencias']: P.append(tuple(pe))
hist = json.load(open('pendencias_historico.json')) if os.path.exists('pendencias_historico.json') else {}
hoje_s = hoje.isoformat(); atuais = set()
for pe in P:
    k = '|'.join(pe[:2] + (pe[3],)); atuais.add(k); h = hist.setdefault(k, {'primeira_vez': hoje_s, 'resolvida_em': None}); h['ultima_vez'] = hoje_s; h['resolvida_em'] = None
for k, h in hist.items():
    if k not in atuais and not h.get('resolvida_em'): h['resolvida_em'] = hoje_s
json.dump(hist, open('pendencias_historico.json', 'w'), ensure_ascii=False, indent=1)
linhas = [[pe[0], pe[1], pe[2], pe[3], pe[4], pe[5], 'ABERTA', hist['|'.join(pe[:2] + (pe[3],))]['primeira_vez'], hoje_s, pe[6]] for pe in P]
linhas += [[k.split('|')[0], k.split('|')[1], '', k.split('|')[2], '', '', 'RESOLVIDA em ' + h['resolvida_em'], h['primeira_vez'], h['resolvida_em'], ''] for k, h in hist.items() if h.get('resolvida_em')]
ws = sheet('Pendências da fonte', ['Agência', 'Reunião / item', 'Data', 'Situação', 'O que já existe', 'Motivo', 'Status', 'Visto pela 1ª vez', 'Verificado em', 'Como resolver'], linhas, {'Reunião / item': 24, 'Situação': 40, 'O que já existe': 38, 'Motivo': 56, 'Status': 22, 'Como resolver': 64})
ws.insert_rows(1); ws['A1'] = 'LIMITE DA FONTE (não é falha da coleta). Esta aba é gerada a cada rodada; quando a fonte publicar, rodar ./rodar_tudo.sh e o item passa a RESOLVIDA. Histórico começa em 07/10/2026.'; ws['A1'].font = Font(bold=True, color='9C0006')
ws.freeze_panes = 'A3'
print('PENDENCIAS ABERTAS:', len(P)); [print('  ', pe[0], pe[1], '|', pe[3]) for pe in P]

# ---- Temas e Diretor × tema
if TEMAS:
    dv = {kd(d): d for d in D}
    c3 = collections.Counter(); porm = collections.defaultdict(collections.Counter)
    for d in D:
        if d['tipo_item'] == 'Cancelada': continue
        k = (d['agencia'], tm(d, 'modal') or '—', tm(d, 'tema') or '—', tm(d, 'subtema') or '—'); c3[k] += 1; porm[k][(d['data'] or '')[:7]] += 1
    mesesT = sorted({m for c in porm.values() for m in c})
    sheet('Temas', ['Agência', 'Modal', 'Tema', 'Subtema', 'Total'] + mesesT, [list(k) + [n] + [porm[k][m] for m in mesesT] for k, n in sorted(c3.items(), key=lambda kv: (kv[0][0], kv[0][1], -kv[1]))], {'Modal': 34, 'Tema': 36, 'Subtema': 40})
    # Diretor × tema (mérito + vista; sem aprovação de ata)
    dt = collections.defaultdict(collections.Counter)
    for v in V:
        d = get_res(v)
        if v['tipo_item'] in ('Aprovação de ata', 'Cancelada'): continue
        base = (v['agencia'], v['diretor'], tm(d, 'modal') or '—', tm(d, 'tema') or '—')
        dt[base]['Deliberações'] += 1
        kk = kind(v); dt[base][{'como relator/proponente': 'Como relator/proponente', 'acompanhou': 'Acompanhou', 'divergiu': 'Divergiu', 'pediu vista': 'Pediu vista', 'ausente': 'Ausente'}.get(kk, 'Outros/revisar')] += 1
    colsD = ['Deliberações', 'Como relator/proponente', 'Acompanhou', 'Divergiu', 'Pediu vista', 'Ausente', 'Outros/revisar']
    sheet('Diretor × tema', ['Agência', 'Diretor', 'Modal', 'Tema'] + colsD, [list(k) + [c[x] for x in colsD] for k, c in sorted(dt.items())], {'Diretor': 38, 'Modal': 34, 'Tema': 36})
    # concordância regra × IA
    ia = [(k, r) for k, r in TEMAS.items() if r.get('fonte') == 'IA']
    if ia:
        sheet('Temas regra x IA', ['Chave', 'Regra sugeriu', 'IA classificou', 'Concorda', 'Confiança IA', 'Motivo da IA'],
              [[k, r.get('regra', ''), f"{r['modal']} / {r['tema']} / {r['subtema']}", 'sim' if r.get('concorda_regra') else 'NÃO', r.get('confianca'), r.get('motivo_ia', '')] for k, r in ia], {'Chave': 46, 'Regra sugeriu': 60, 'IA classificou': 60, 'Motivo da IA': 70})
# =====================================================================================
# PLANILHA FINAL: 9 abas (as 16 acima são só área de preparo e NÃO são salvas)
# =====================================================================================
wbf = Workbook(); wbf.remove(wbf.active)
COR = {'leia': '2E7D32', 'base': '1F3A5F', 'dir': '6A1B9A', 'ctrl': 'E65100', 'apoio': '757575'}
def sheetf(nome, cab, linhas, larg=None, cor='base', filtro=True):
    ws = wbf.create_sheet(nome); ws.append(cab)
    for c in ws[1]: c.font = Font(bold=True, color='FFFFFF'); c.fill = PatternFill('solid', fgColor=COR[cor]); c.alignment = Alignment(wrap_text=True, vertical='top')
    for l in linhas: ws.append([('; '.join(map(str, c)) if isinstance(c, (list, tuple)) else c) for c in l])
    for k, c in enumerate(cab, 1): ws.column_dimensions[get_column_letter(k)].width = (larg or {}).get(c, 16)
    ws.freeze_panes = 'A2'
    if filtro: ws.auto_filter.ref = ws.dimensions
    ws.sheet_properties.tabColor = COR[cor]; return ws
def papel(v):
    if v.get('fora_total'): return 'Relator (voto em reunião anterior)'
    if v['tipo_item'] == 'Aprovação de ata': return 'Aprovou a ata anterior'
    return {'como relator/proponente': 'Relator/proponente', 'acompanhou': 'Votante (acompanhou)', 'divergiu': 'Votante (divergiu)', 'pediu vista': 'Pediu vista', 'ausente': 'Ausente', 'sem voto (retirado de pauta)': 'Sem voto (retirada)', 'a revisar': 'A revisar', 'impedido': 'Impedido', 'sem voto (não votou)': 'Sem voto (não votou)', 'votou (antes da vista)': 'Votou (antes da vista)'}[kind(v)]
EVID = {'nominal': 'Individual (citada na ata)', 'inferido': 'Inferida (unanimidade/sem divergência)', 'n/a': 'Não se aplica', 'REVISAR': 'A revisar'}
mes_ = lambda d: (d or '')[:7]
# ---- Votos
sheetf('Votos', ['Agência', 'Mês', 'Data', 'Reunião', 'Processo', 'Deliberação nº / item', 'Diretor', 'Voto', 'Papel', 'Evidência', 'Proveniência', 'Tipo de item', 'Resultado da deliberação', 'Relator', 'Modal', 'Tema', 'Subtema', 'Microtema (IRIS)', 'Área (IRIS)', 'Assunto', 'Status do processo (vista)', 'Voto final (reunião do desfecho)', 'Conta nos totais de 2026'],
       [[v['agencia'], mes_(v['data']), v['data'], v['reuniao'], v['processo'], v.get('deliberacao', ''), v['diretor'], v['voto'], papel(v), EVID[v['proveniencia']], v['proveniencia'], v['tipo_item'], get_res(v).get('resultado', ''), get_res(v).get('relator', ''),
         tm(get_res(v), 'modal'), tm(get_res(v), 'tema'), tm(get_res(v), 'subtema'), tm(get_res(v), 'microtema_iris'), tm(get_res(v), 'area_iris'), (get_res(v).get('assunto') or '')[:160], status_proc(get_res(v)) if get_res(v) else '', voto_final(v), 'Não (ex-diretor, voto em reunião anterior)' if v.get('fora_total') else 'Sim'] for v in V + VX],
       {'Conta nos totais de 2026': 28, 'Diretor': 38, 'Voto': 32, 'Papel': 22, 'Evidência': 32, 'Tipo de item': 22, 'Resultado da deliberação': 34, 'Relator': 36, 'Processo': 24, 'Modal': 30, 'Tema': 30, 'Subtema': 30, 'Microtema (IRIS)': 30, 'Área (IRIS)': 24, 'Assunto': 60})
# ---- Deliberações
sheetf('Deliberações', ['Agência', 'Mês', 'Data', 'Reunião', 'Processo', 'Deliberação nº / item', 'Tipo de item', 'Relator', 'Interessado', 'Assunto', 'Resultado', 'Voto (doc)', 'Modal', 'Tema', 'Subtema', 'Tipo de ato', 'Microtema (IRIS)', 'Área (IRIS)', 'Confiança', 'Fonte da classificação', 'Texto da decisão', 'Status do processo (vista)', 'Desfecho final'],
       [[d['agencia'], mes_(d['data']), d['data'], d['reuniao'], d['processo'], d.get('deliberacao', ''), d['tipo_item'], d.get('relator'), d.get('interessado', ''), d.get('assunto', ''), d['resultado'], d.get('voto_doc', ''),
         tm(d, 'modal'), tm(d, 'tema'), tm(d, 'subtema'), tm(d, 'tipo_ato'), tm(d, 'microtema_iris'), tm(d, 'area_iris'), tm(d, 'confianca', ''), tm(d, 'fonte'), d.get('texto', ''), status_proc(d), desfecho_final(d)] for d in D],
       {'Relator': 36, 'Interessado': 40, 'Assunto': 50, 'Texto da decisão': 80, 'Status do processo (vista)': 34, 'Desfecho final': 34, 'Processo': 24, 'Resultado': 34, 'Tipo de item': 22, 'Modal': 30, 'Tema': 30, 'Subtema': 30, 'Tipo de ato': 22})
# ---- Matriz de votos única
todos_dir = [(ag, nome) for ag in AGS for nome in ordem[ag]]
curto = lambda ag, n: f"{ag}: {n.split()[0]} {n.split()[-1]}"
linhas = []
for d in D:
    if d['tipo_item'] == 'Cancelada': continue
    m = vidx.get((d['agencia'], d['reuniao'], d['processo'], d.get('deliberacao')), {})
    linhas.append([d['agencia'], mes_(d['data']), d['data'], d['reuniao'], d['processo'], d.get('deliberacao', ''), d['tipo_item'], d['resultado'], tm(d, 'tema')] +
                  [(cod(m[n]) if n in m else '—') if ag == d['agencia'] else '' for ag, n in todos_dir] + [len(m)])
ws = sheetf('Matriz de votos', ['Agência', 'Mês', 'Data', 'Reunião', 'Processo', 'Deliberação nº / item', 'Tipo de item', 'Resultado', 'Tema'] + [curto(a, n) for a, n in todos_dir] + ['Nº de votos'], linhas, {'Resultado': 32, 'Tipo de item': 20, 'Processo': 24, 'Tema': 28})
ws.cell(row=len(linhas) + 3, column=1, value='Legenda: * = voto inferido da unanimidade; sem * = individual; — = diretor da agência que não participou da reunião; célula vazia = diretor de outra agência. Filtre a coluna Agência.')
# ---- Diretores (long)
dl = collections.defaultdict(collections.Counter)
for v in V:
    d = get_res(v); k = (v['agencia'], v['diretor'], mes_(v['data']), tm(d, 'modal') or '—', tm(d, 'tema') or '—', tm(d, 'subtema') or '—', tm(d, 'microtema_iris') or '—', tm(d, 'area_iris') or '—'); c = dl[k]; c['Registros'] += 1
    c['Aprovou a ata anterior' if v['tipo_item'] == 'Aprovação de ata' else {'como relator/proponente': 'Como relator/proponente', 'acompanhou': 'Acompanhou', 'divergiu': 'Divergiu', 'pediu vista': 'Pediu vista', 'ausente': 'Ausente', 'sem voto (retirado de pauta)': 'Sem voto (retirada)', 'a revisar': 'A revisar', 'impedido': 'Impedido', 'sem voto (não votou)': 'Sem voto (não votou)', 'votou (antes da vista)': 'Votou (antes da vista)'}[kind(v)]] += 1
    c['Votos individuais (citados)'] += v['proveniencia'] == 'nominal'; c['Votos inferidos'] += v['proveniencia'] == 'inferido'
colsDir = ['Registros', 'Como relator/proponente', 'Acompanhou', 'Divergiu', 'Pediu vista', 'Ausente', 'Sem voto (retirada)', 'Sem voto (não votou)', 'Impedido', 'A revisar', 'Aprovou a ata anterior', 'Votos individuais (citados)', 'Votos inferidos']
sheetf('Diretores', ['Agência', 'Diretor', 'Mês', 'Modal', 'Tema', 'Subtema', 'Microtema (IRIS)', 'Área (IRIS)'] + colsDir, [list(k) + [c[x] for x in colsDir] for k, c in sorted(dl.items())], {'Diretor': 38, 'Modal': 32, 'Tema': 34, 'Subtema': 34, 'Microtema (IRIS)': 30, 'Área (IRIS)': 24}, cor='dir')
# ---- Reuniões
sheetf('Reuniões', ['Agência', 'Reunião', 'Data', 'Tipo', 'Presentes', 'Ausentes', 'Nº de itens lidos', 'Observação'], [[r['agencia'], r['reuniao'], r.get('data'), r.get('tipo', ''), '; '.join(r.get('presentes', [])), '; '.join(r.get('ausentes', [])), nd[(r['agencia'], r['reuniao'])], r.get('obs', '')] for r in sorted(R, key=lambda r: (r['agencia'], r.get('data') or ''))], {'Presentes': 80, 'Ausentes': 36, 'Observação': 50}, cor='apoio')

# ---- Itens "NÃO FEITO" (lacunas conhecidas, com a contagem medida)
NF = []
rev = collections.Counter((v['agencia']) for v in V if v['proveniencia'] == 'REVISAR')
imp = sum(1 for d in D if d['agencia'] == 'ANM' and d.get('tem_impedimento'))
_imp = collections.Counter(v['agencia'] for v in V if v['voto'].startswith('IMPEDIDO'))
_narr = sum(1 for v in V if v['agencia'] == 'ANM' and v.get('fonte_voto'))
NF.append(['ANM', 'B. Impedimento / "não votaria"', f"{_imp.get('ANM', 0)} linhas IMPEDIDO (nominal); 'revisar' de 34 para {rev.get('ANM', 0)}; {_narr} linhas lidas da narrativa do Secretário-Geral (anm_narrativas.json)", 'FEITO', 'Impedido sai do denominador da maioria; maioria com 1 divergente nomeado vira inferido por exclusão; as linhas que restam em REVISAR dizem o motivo (a ata não narra o voto do Diretor-Geral/Diretor X)', 'Aguardar a ANM publicar o resultado nominal'])
NF.append(['ANTT', 'B. Impedimento / voto antes da vista', '0 menções a impedimento/suspeição e 0 votos antes da vista nas 57 atas lidas (varredura do texto)', 'FEITO (nada a registrar)', 'O texto da ata da ANTT só relata o voto do relator antes do pedido de vista; os demais ficam "sem voto ainda" corretamente', 'Nenhuma'])
NF.append(['ANVISA', 'B. Impedimento', f"{_imp.get('ANVISA', 0)} linhas IMPEDIDO (nominal)", 'FEITO', 'Lido de "declarou-se impedido" nas atas e nos extratos de CD', 'Nenhuma'])
_comp = sum(1 for d in D if str(d.get('decisao_texto', '') or d.get('texto', '')).count('unanimidade') and str(d.get('decisao_texto', '') or d.get('texto', '')).count('maioria') and d['agencia'] in ('ANVISA',))
NF.append(['TODAS', 'Decisão de várias partes (I/II/III)', 'ANVISA 73 itens, ANP 64, ANTAQ 46 com mais de uma ação; só 1 item (ANVISA ROP1 2.5) tem modos de votação diferentes por parte, e os diretores atuais acompanharam as duas', 'FEITO (medido)', 'O texto completo de todas as ações está na coluna "Texto da decisão"; o voto de cada diretor não muda por parte nos dados de 2026. Os itens do ANP com "unanimidade" e "maioria" no texto são a suspensão/retomada da reunião 1.179, sem voto individual', 'Reavaliar a cada rodada (regra no QA)'])
NF.append(['ANM/ANVISA/ANTT', 'Votos escritos (PDFs de voto)', 'ANTT: 99 PDFs de voto em imagem não lidos; ANVISA: PDFs de voto por reunião não lidos; ANM: sem PDF de voto separado', 'PARCIAL', 'Onde a ata/extrato nomeia o voto de cada diretor o voto escrito não muda nada; só resolveria "maioria sem divergentes nomeados" (ANM: 5 linhas) e as posições dentro de "unanimidade"', 'Ler o voto escrito só para as 5 linhas REVISAR'])
for ag in ('ANM', 'ANTT', 'ANVISA'):
    vis = [d for d in D if d['agencia'] == ag and d['tipo_item'] == 'Vista']
    if not vis: continue
    res_ = sum(1 for d in vis if DESF.get(_ck(d), ('', None))[1])
    NF.append([ag, 'C. Ciclo da vista ligado ao desfecho', f'{len(vis)} itens em vista: {res_} resolvidos em reunião posterior (coluna "Status do processo" e "Voto final"), {len(vis) - res_} abertos', 'FEITO (abertos = aguardam a fonte)', 'Cada item em vista aponta o desfecho do mesmo processo em reunião posterior de 2026', 'Vistas abertas estão em Faltam na fonte'])
pres_anm = {r['reuniao']: set(r['presentes']) for r in R if r['agencia'] == 'ANM'}
NF.append(['ANM', 'D. Relator que não é mais diretor', f'{len(VX)} linhas de ex-diretores (Guilherme Santana, Caio Mário, Roger Cabral, Carlos Cordeiro)', 'FEITO', 'Entram na aba Votos como "Relator (voto em reunião anterior)", com a coluna "Conta nos totais de 2026" = Não', 'Nenhuma'])
pr_ = fatos.get('artesp_procedencia', {})
NF.append(['ARTESP', 'E. Relator não publicado (parcial)', f"Procedência dos {pr_.get('pdfs_de_deliberacao', 0)} PDFs: superintendência {pr_.get('superintendencia', 0)}; diretor (DIR-RC) {pr_.get('diretoria_dir_rc', 0)}; Presidência {pr_.get('presidencia', 0)}", 'FEITO para os que a fonte informa / LIMITE DA FONTE no resto', 'A ARTESP não diz quem relatou na maioria das deliberações; as de procedência diretor/Presidência entram como PROPONENTE nominal (' + str(sum(1 for v in V if v['agencia'] == 'ARTESP' and v['voto'].startswith('PROPONENTE'))) + ' votos)', 'Resto em Faltam na fonte'])
for ag in AGS:
    vs = [v for v in V if v['agencia'] == ag]; n_inf = sum(1 for v in vs if v['proveniencia'] == 'inferido')
    NF.append([ag, 'G. Voto individual inferido da unanimidade', f'{n_inf} de {len(vs)} linhas ({n_inf * 100 // max(1, len(vs))}%)', 'LIMITE ESTRUTURAL', 'Em unanimidade a ata não traz o voto de cada diretor; só vídeos das sessões trazem', 'Não perseguido; usar a coluna Evidência para separar individual de inferida'])
for sg, x in EXTRAS.items(): NF += x['nao_feito']
for ag in AGS: NF.append([ag, 'H. Auditoria humana de 60 deliberações (resultado e presença)', 'não feita', 'NÃO FEITO', 'Só há amostras de tema (AMOSTRA_TEMAS.md) e conferência automática', 'Sortear e conferir 60 itens'])


# ---- FALTAM NA FONTE: tudo que a FONTE deveria ter publicado (ou não publica) e que por isso não está nos votos
URL_FONTE = {
 'ANM': 'https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/atas-da-rop/atas-reunioes-ordinarias',
 'ANTT': 'https://portal.antt.gov.br/web/guest/reunioes-da-diretoria', 'ARTESP': 'https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria'}
URL_FONTE.update(AG.urls())   # demais agências: registro único em scripts/agencias.py
def _tipo_pend(sit):
    t = sit.lower()
    if t.startswith('futura'): return 'Reunião futura (ainda não ocorreu)'
    if 'sem registro' in t or 'número sem' in t: return 'Número sem registro na fonte'
    if 'erro' in t: return 'Erro da fonte (corrigido por nós)'
    if 'bloqueado' in t: return 'Bloqueado pela fonte'
    if 'sem extrato' in t or 'sem ata' in t or 'não publicad' in t: return 'Documento não publicado'
    return 'Documento não publicado'
FALTAM = []   # [Agência, Tipo, Documento ou dado esperado, Data, Como sabemos que existe, URL da fonte, Situação, Votos afetados, Visto pela 1ª vez, Verificado em, Como resolver]
for pe in P:
    ag, item, dt_, sit, existe, motivo, como = pe[:7]; url = pe[7] if len(pe) > 7 and pe[7] else (URL_FONTE['ANVISA|CD'] if ag == 'ANVISA' and item.startswith('CD ') else URL_FONTE.get(ag, ''))
    k = '|'.join(pe[:2] + (pe[3],)); h_ = hist.get(k, {})
    afet = 'nenhum ainda (reunião futura)' if sit.lower().startswith('futura') else ('todos os diretores × itens da reunião/circuito' if _tipo_pend(sit) in ('Documento não publicado', 'Bloqueado pela fonte') else 'ver detalhe')
    FALTAM.append([ag, _tipo_pend(sit), f'{item} — {sit}', dt_ or '', f'{existe}; {motivo}', url, 'ABERTA', afet, h_.get('primeira_vez', hoje_s), hoje_s, como])
for k, x in DESF.items():
    if x[1] is None:
        d = _resx[k]; FALTAM.append([d['agencia'], 'Desfecho pendente (vista aberta)', f"{d['reuniao']} · {d.get('processo')} · item {d.get('deliberacao', '')}: voto final dos demais diretores", d['data'] or '', 'processo em vista sem retorno em reunião posterior de 2026', URL_FONTE.get(d['agencia'], ''), 'ABERTA', 'voto final dos diretores que não votaram antes da vista', hoje_s, hoje_s, 'Rodar rodar_tudo.sh quando a reunião de retorno for publicada'])
_rv = collections.defaultdict(list)
for v in V:
    if v['proveniencia'] == 'REVISAR' and v['agencia'] == 'ANM': _rv[(v['reuniao'], v.get('processo'), v.get('deliberacao'))].append(v['diretor'])
for (r_, pr_, dl_), ds_ in _rv.items():
    d = _resx.get(('ANM', r_, pr_, dl_)) or {}
    FALTAM.append(['ANM', 'Dado não publicado na ata', f'{r_} · {pr_}: nomes dos diretores que divergiram ("aprovado por maioria" sem nomear)', d.get('data', ''), 'a ata diz maioria e não lista os votos individuais', URL_FONTE['ANM'], 'LIMITE DA FONTE', f'{len(ds_)} votos (' + ', '.join(x.split()[0] for x in ds_) + ')', hoje_s, hoje_s, 'Depende da ANM publicar o resultado nominal; não resolvível por nós'])
n_art = sum(1 for d in D if d['agencia'] == 'ARTESP' and 'proponente' not in str(d.get('relator')) and d['tipo_item'] != 'Cancelada')
FALTAM.append(['ARTESP', 'Dado não publicado na ata', f'Relator/proponente de {n_art} deliberações (a Procedência do PDF é uma superintendência)', '', 'a ARTESP não informa qual diretor relatou', URL_FONTE['ARTESP'], 'LIMITE DA FONTE', f'campo "relator" de {n_art} deliberações; o voto de cada diretor continua registrado', hoje_s, hoje_s, 'Depende da ARTESP; 59 deliberações com procedência de diretoria já constam como proponente'])
FALTAM.sort(key=lambda r: (r[0], r[1], r[2]))

# ---- Controle (Cobertura + Qualidade + Não feito)
ctrl = []
for r in [list(x) for x in wb['Cobertura'].iter_rows(min_row=2, values_only=True)]: ctrl.append(['Cobertura', r[0], r[1], r[2], '', '', r[3], '', '', ''])
for r in [list(x) for x in wb['Qualidade'].iter_rows(min_row=2, values_only=True)]: ctrl.append(['Qualidade', r[0], r[1], r[2], r[3], r[4], r[5], '', '', ''])
for r in NF: ctrl.append(['Não feito', r[0], r[1], '', r[2], r[3], r[4], r[5], '', hoje_s])
ctrl_ws = sheetf('Controle', ['Tipo', 'Agência', 'Item', 'Valor / data / esperado', 'Observado', 'Status', 'Detalhe', 'Como resolver', 'Visto pela 1ª vez', 'Verificado em'], ctrl, {'Tipo': 18, 'Item': 70, 'Valor / data / esperado': 22, 'Observado': 34, 'Status': 26, 'Detalhe': 100, 'Como resolver': 60}, cor='ctrl')

sheetf('Faltam na fonte', ['Agência', 'Tipo', 'Documento ou dado esperado', 'Data', 'Como sabemos que existe', 'URL da fonte', 'Situação', 'Votos afetados', 'Visto pela 1ª vez', 'Verificado em', 'Como resolver'], FALTAM, {'Tipo': 30, 'Documento ou dado esperado': 70, 'Como sabemos que existe': 60, 'URL da fonte': 60, 'Votos afetados': 40, 'Como resolver': 50}, cor='ctrl')

# ---- Apoio (Temas, Temas regra x IA, ARTESP inventário)
ap_rows = []
if TEMAS:
    for r in [list(x) for x in wb['Temas'].iter_rows(min_row=2, values_only=True)]: ap_rows.append(['Temas (contagem)', r[0], r[1], r[2], r[3], r[4], '', 'Modal | Tema | Subtema | Total'])
    if 'Temas regra x IA' in wb.sheetnames:
        for r in [list(x) for x in wb['Temas regra x IA'].iter_rows(min_row=2, values_only=True)]: ap_rows.append(['Regra x IA', r[0].split('|')[0], r[1], r[2], 'concorda' if r[3] == 'sim' else 'DISCORDA', r[4], r[5], 'Regra sugeriu | IA classificou | Concorda | Confiança IA | Motivo'])
for r in [list(x) for x in wb['ARTESP inventário'].iter_rows(min_row=2, values_only=True)]: ap_rows.append(['Inventário ARTESP', 'ARTESP', f'{r[0]} {r[1]}', r[2], f'pauta {r[3]}, ata {r[4]}', r[5], '', 'Série e nº | Data | Pauta/Ata | Deliberações (ZIP)'])
sheetf('Apoio', ['Tipo', 'Agência', 'Campo A', 'Campo B', 'Campo C', 'Campo D', 'Campo E', 'Colunas'], ap_rows, {'Tipo': 22, 'Campo A': 50, 'Campo B': 50, 'Campo C': 34, 'Campo D': 12, 'Campo E': 70, 'Colunas': 60}, cor='apoio')

# ---- Painel (números gerados a cada rodada)
ws = wbf.create_sheet('Painel'); ws.sheet_properties.tabColor = COR['leia']
def bloco(ws, titulo, cab, linhas, linha0):
    ws.cell(row=linha0, column=1, value=titulo).font = Font(bold=True, size=13, color='1F3A5F')
    for k, c in enumerate(cab, 1):
        x = ws.cell(row=linha0 + 1, column=k, value=c); x.font = Font(bold=True, color='FFFFFF'); x.fill = PatternFill('solid', fgColor='1F3A5F'); x.alignment = Alignment(wrap_text=True, vertical='top')
    for i, l in enumerate(linhas):
        for k, val in enumerate(l, 1): ws.cell(row=linha0 + 2 + i, column=k, value=val).alignment = Alignment(wrap_text=True, vertical='top')
    return linha0 + 3 + len(linhas)
cnt_q = collections.Counter(r[5] for r in ctrl if r[0] == 'Qualidade'); n_pend = sum(1 for r in FALTAM if r[6] == 'ABERTA' and not r[1].startswith('Reunião futura') and not r[1].startswith('Erro')); n_nf = sum(1 for r in ctrl if r[0] == 'Não feito')
vot = {ag: [v for v in V if v['agencia'] == ag] for ag in AGS}
pc = lambda ag, p: f"{sum(1 for v in vot[ag] if v['proveniencia'] == p) * 100 // max(1, len(vot[ag]))}%"
def cob_ag(ag):
    rs = [r for r in R if r['agencia'] == ag]; return rs
cal_n = sum(1 for dt in json.load(open('calendario_anm_2026.json'))['rops'].values() if datetime.date.fromisoformat(dt) <= hoje)
antt_real = sum(1 for r in R if r['agencia'] == 'ANTT' and datetime.date.fromisoformat(r['data']) <= hoje); antt_ata = sum(1 for r in R if r['agencia'] == 'ANTT' and not r.get('obs'))
art_ok = sum(1 for r in R if r['agencia'] == 'ARTESP' and not r.get('obs')); art_tot = sum(1 for r in R if r['agencia'] == 'ARTESP')
ws.cell(row=1, column=1, value=f'PAINEL — votos dos diretores em 2026 ({', '.join(AGS)}) · gerado em {hoje.strftime("%d/%m/%Y")}').font = Font(bold=True, size=15, color='2E7D32')
r0 = bloco(ws, '1. Placar do objetivo final', ['Parte', 'Situação', 'Evidência medida'], [
    ['1. Coleta sem perda silenciosa', 'Quase', f'ANM {sum(1 for r in R if r["agencia"] == "ANM")}/{cal_n} ROPs realizadas · ANTT {antt_ata}/{antt_real} realizadas com ata · ARTESP {art_ok}/{art_tot} atas corretas' + ''.join(f' · {sg} {sum(1 for r in R if r["agencia"] == sg and not r.get("obs"))} reuniões com ata lida' for sg in EXTRAS) + f' · {n_pend} pendências da fonte abertas (aba Controle)'],
    ['2. Extração (relator, resultado, processo, interessado)', 'Bom, com furos', 'Contagens batem com as âncoras das atas (aba Controle > Qualidade); modal e tema ≈ 94% em amostra manual (AMOSTRA_TEMAS.md); ARTESP não publica o relator em ~91% das deliberações'],
    ['3. Voto de cada diretor com proveniência', 'Parcial', f'{len(V)} linhas de voto, 1 por diretor em cada item; evidência individual ANM {pc("ANM", "nominal")} · ANTT {pc("ANTT", "nominal")} · ARTESP {pc("ARTESP", "nominal")}; o restante é inferido da unanimidade; {sum(rev.values())} linhas ainda "A revisar"'],
    ['4. Métricas por diretor, agência e período', 'Parcial', f'Abas Diretores e Votos (filtros por Agência, Diretor, Mês, Modal, Tema). Qualidade: {dict(cnt_q)}; {n_nf} lacunas "Não feito" listadas em Controle'],
], 3)
r0 = bloco(ws, '2. Cobertura por agência', ['Agência', 'Reuniões com ata lida', 'Itens lidos', 'Linhas de voto', 'Individual (citada)', 'Inferida', 'A revisar', 'Faltam na fonte (abertas)'], [
    [ag, sum(1 for r in R if r['agencia'] == ag and not r.get('obs')), sum(1 for d in D if d['agencia'] == ag), len(vot[ag]), pc(ag, 'nominal'), pc(ag, 'inferido'), sum(1 for v in vot[ag] if v['proveniencia'] == 'REVISAR'), sum(1 for r in FALTAM if r[0] == ag and r[6] == 'ABERTA' and not r[1].startswith('Reunião futura') and not r[1].startswith('Erro'))] for ag in AGS], r0)
dres = collections.defaultdict(collections.Counter)
for v in V:
    c = dres[(v['agencia'], v['diretor'])]; c['reg'] += 1; c['p' if v['tipo_item'] == 'Aprovação de ata' else kind(v)] += 1; c['nom'] += v['proveniencia'] == 'nominal'
r0 = bloco(ws, '3. Resumo por diretor (2026)', ['Agência', 'Diretor', 'Linhas de voto', 'Como relator/proponente', 'Acompanhou', 'Divergiu', 'Pediu vista', 'Ausente', 'Sem voto (retirada)', 'A revisar', 'Aprovou ata anterior', 'Evidência individual'],
           [[a, d, c['reg'], c['como relator/proponente'], c['acompanhou'], c['divergiu'], c['pediu vista'], c['ausente'], c['sem voto (retirado de pauta)'], c['a revisar'], c['p'], f"{c['nom'] * 100 // c['reg']}%"] for (a, d), c in sorted(dres.items())], r0)
ws.column_dimensions['A'].width = 38; ws.column_dimensions['B'].width = 40; ws.column_dimensions['C'].width = 60
for col in 'DEFGHIJKL': ws.column_dimensions[col].width = 18
# ---- LEIA-ME
ws = wbf.create_sheet('LEIA-ME'); ws.sheet_properties.tabColor = COR['leia']; ws.column_dimensions['A'].width = 34; ws.column_dimensions['B'].width = 140
linhas = [
 ('VOTOS DOS DIRETORES — 2026', 'ANM (atas da ROP), ANTT (atas das reuniões deliberativas), ARTESP (atas do Conselho Diretor)' + ''.join(f", {a['sg']} ({a['desc']})" for a in AG.ativas()) + '. Coleta independente do pipeline do IRIS.'),
 ('Gerada em', f'{hoje.strftime("%d/%m/%Y")} · tudo é gerado por scripts (rodar_tudo.sh); nada é digitado à mão.'),
 ('', ''),
 ('COMO LER AS ABAS', ''),
 ('Painel', 'Placar do objetivo final, cobertura e resumo por diretor.'),
 ('Votos', 'Base única: 1 linha por diretor em cada item da ata. Filtre por Agência, Diretor, Mês, Modal, Tema, Papel, Evidência.'),
 ('Deliberações', '1 linha por item da ata, com relator, resultado, interessado, assunto, modal/tema/subtema.'),
 ('Matriz de votos', '1 linha por item, 1 coluna por diretor (filtre Agência). * = voto inferido da unanimidade.'),
 ('Diretores', 'Contagens por Agência, Diretor, Mês, Modal, Tema, Subtema, Microtema e Área (filtre ou some com tabela dinâmica).'),
 ('Faltam na fonte', 'Tudo que a FONTE deveria ter publicado (ou não publica) e por isso não está nos votos: documento, URL da página-fonte, como sabemos que existe, votos afetados e como resolver. Filtre por Agência e Tipo.'),
 ('Controle', 'Coluna Tipo: Cobertura, Qualidade (checagens automáticas) e Não feito (lacunas nossas conhecidas).'),
 ('Reuniões', 'Presentes e ausentes de cada reunião, e observações.'),
 ('Apoio', 'Contagem de temas, concordância regra × IA e inventário da ARTESP (coluna Tipo).'),
 ('', ''),
 ('LEGENDA', ''),
 ('Evidência: Individual', 'A ata cita o diretor (relator, vista, ausência, retirada, divergência, voto antes da vista).'),
 ('Evidência: Inferida', 'A ata diz "por unanimidade": todos os presentes acompanharam. NÃO é o voto escrito de cada um; vale como "acompanhou", não prova divergência.'),
 ('A revisar', 'Maioria ou vista em que a ata não diz quem votou como.'),
 ('Tipo de item', 'Deliberação · Vista · Retirada de pauta · Aprovação de ata · Cancelada (sem voto) · Só voto do relator (sem ata).'),
 ('Modal / Tema / Subtema', 'Modal = setor (Rodovias, Ferrovias, Hidroviário...); Tema = natureza da matéria; Subtema = detalhe (o mais frágil). Regras do IRIS + revisão por IA; ver AMOSTRA_TEMAS.md.'),
 ('', ''),
 ('LIMITES (não escondidos)', ''),
 ('Fonte', 'O site só garante o que publica; atas ainda não publicadas estão em Controle > Pendência da fonte.'),
 ('ARTESP', 'Não publica quem relatou (~91% das deliberações); há erros de numeração e uma ata publicada na reunião errada (corrigidos pelos PDFs).'),
 ('Validação', 'Contagens automáticas + amostras manuais; não é auditoria completa (ver AMOSTRA.md e AMOSTRA_TEMAS.md).'),
]
for i, (a, b) in enumerate(linhas, 1):
    ws.cell(row=i, column=1, value=a).font = Font(bold=True, color='2E7D32' if b == '' and a else '000000', size=14 if i == 1 else 11); ws.cell(row=i, column=2, value=b).alignment = Alignment(wrap_text=True, vertical='top')
wbf._sheets = [wbf[n] for n in ['LEIA-ME', 'Painel', 'Votos', 'Deliberações', 'Matriz de votos', 'Diretores', 'Faltam na fonte', 'Controle', 'Reuniões', 'Apoio']]
wb = wbf

wb.save('votos_2026.xlsx'); print('ok', len(V), 'votos', len(D), 'deliberacoes', len(R), 'reunioes')
for q in Q: print(q[4], '|', q[0], '|', q[1][:70], '|', q[2], q[3])
