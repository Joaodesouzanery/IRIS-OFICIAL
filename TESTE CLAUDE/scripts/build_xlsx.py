#!/usr/bin/env python3
"""Consolida ANM + ANTT + ARTESP em votos_2026.xlsx. Uso: python3 -I scripts/build_xlsx.py  (rodar dentro de 'TESTE CLAUDE/')"""
import json, re, glob, collections, os, zipfile
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
for v in anm['votos']:
    if v['reuniao'] in keep_anm: V.append(dict(v, agencia='ANM'))
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
for v in art['votos']: V.append(dict(v, agencia='ARTESP'))

def chave(x): return (x['agencia'], x['reuniao'], x.get('processo'), x.get('deliberacao'))
res = {}
for d in D: res[(d['agencia'], d['reuniao'], d['processo'], d.get('deliberacao'))] = d
def get_res(v):
    d = res.get((v['agencia'], v['reuniao'], v['processo'], v.get('deliberacao')))
    return d or {}

wb = Workbook(); wb.remove(wb.active)
def sheet(nome, cab, linhas, larg=None):
    ws = wb.create_sheet(nome); ws.append(cab)
    for c in ws[1]: c.font = Font(bold=True, color='FFFFFF'); c.fill = PatternFill('solid', fgColor='1F3A5F'); c.alignment = Alignment(wrap_text=True, vertical='top')
    for l in linhas: ws.append(l)
    for i, c in enumerate(cab, 1): ws.column_dimensions[get_column_letter(i)].width = (larg or {}).get(c, 16)
    ws.freeze_panes = 'A2'; ws.auto_filter.ref = ws.dimensions; return ws

# ---- Resumo por diretor
def kind(v):
    t = v['voto']
    if t.startswith('RELATOR') or t.startswith('RETIROU'): return 'como relator/proponente'
    if t == 'ACOMPANHOU': return 'acompanhou'
    if t.startswith('DIVERGIU'): return 'divergiu'
    if t == 'PEDIU VISTA': return 'pediu vista'
    if t.startswith('AUSENTE'): return 'ausente'
    if t.startswith('SEM VOTO'): return 'sem voto (retirado de pauta)'
    if t.startswith('VISTA COLETIVA'): return 'pediu vista'
    return 'a revisar'
cols = ['como relator/proponente', 'acompanhou', 'divergiu', 'pediu vista', 'ausente', 'sem voto (retirado de pauta)', 'a revisar']
cnt = collections.defaultdict(collections.Counter)
for v in V:
    c = cnt[(v['agencia'], v['diretor'])]; c['registros'] += 1; c[kind(v)] += 1; c['nominal'] += v['proveniencia'] == 'nominal'; c['inferido'] += v['proveniencia'] == 'inferido'
    c['deliberações votadas (sem ausência)'] += kind(v) not in ('ausente',)
tot = ['registros'] + cols + ['nominal', 'inferido']
sheet('Resumo por diretor', ['Agência', 'Diretor', 'Registros (linhas de voto)'] + [c.capitalize() for c in cols] + ['Votos nominais', 'Votos inferidos (unanimidade)'],
      [[a, d, cnt[(a, d)]['registros']] + [cnt[(a, d)][c] for c in cols] + [cnt[(a, d)]['nominal'], cnt[(a, d)]['inferido']] for (a, d) in sorted(cnt)], {'Diretor': 40})
mes = collections.defaultdict(collections.Counter)
for v in V: mes[(v['agencia'], v['diretor'])][(v['data'] or '')[:7]] += 1
meses = sorted({m for c in mes.values() for m in c})
sheet('Diretor por mês', ['Agência', 'Diretor'] + meses, [[a, d] + [mes[(a, d)][m] for m in meses] for (a, d) in sorted(mes)], {'Diretor': 40})

# ---- Votos / Deliberações / Reuniões
sheet('Votos', ['Agência', 'Reunião', 'Data', 'Processo', 'Deliberação nº', 'Diretor', 'Voto', 'Proveniência', 'Resultado da deliberação', 'Relator'],
      [[v['agencia'], v['reuniao'], v['data'], v['processo'], v.get('deliberacao', ''), v['diretor'], v['voto'], v['proveniencia'], get_res(v).get('resultado', ''), get_res(v).get('relator', '')] for v in V],
      {'Diretor': 38, 'Voto': 30, 'Resultado da deliberação': 34, 'Relator': 38, 'Processo': 24})
sheet('Deliberações', ['Agência', 'Reunião', 'Data', 'Processo', 'Deliberação nº', 'Relator', 'Interessado', 'Assunto', 'Resultado', 'Voto (doc)', 'Texto da decisão'],
      [[d['agencia'], d['reuniao'], d['data'], d['processo'], d.get('deliberacao', ''), d.get('relator'), d.get('interessado', ''), d.get('assunto', ''), d['resultado'], d.get('voto_doc', ''), d.get('texto', '')] for d in D],
      {'Relator': 36, 'Interessado': 40, 'Assunto': 50, 'Texto da decisão': 80, 'Processo': 24, 'Resultado': 34})
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
        t = open(fs[0], encoding='utf8').read().replace('\u200b', ''); t = re.sub(r'D\s?ecis[ãa]o:', 'Decisão:', t); tot_ancora += len(re.findall(pat, t)); tot_lido += sum(1 for d in D if d['agencia'] == ag and d['reuniao'] == r['reuniao'] and not d['resultado'].startswith(('SEM ATA',)) and not d['resultado'].startswith('SEM DELIB') and not d['resultado'].startswith('SEM DECIS'))
    chk(ag, f'Deliberações com desfecho lidas × âncoras "{pat}" nas atas', tot_ancora, tot_lido, 'diferença = âncora citada em texto corrido ou item multi-linha; ver amostra')
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
for ag in ('ANM', 'ANTT', 'ARTESP'):
    vs = [v for v in V if v['agencia'] == ag]; c = collections.Counter(v['proveniencia'] for v in vs)
    chk(ag, 'nominal + inferido + REVISAR + n/a = total de votos', len(vs), sum(c.values()), str(dict(c)))
    chk(ag, 'Datas dentro de 2026', len(vs), sum(1 for v in vs if (v['data'] or '').startswith('2026')))
    pres = collections.defaultdict(set)
    for r in R:
        if r['agencia'] == ag: pres[r['reuniao']] = set(r.get('presentes', [])) | set(r.get('ausentes', []))
    fora = sum(1 for v in vs if v['reuniao'] in pres and pres[v['reuniao']] and v['diretor'] not in pres[v['reuniao']] and not v['voto'].startswith('RELATOR'))
    chk(ag, 'Votos de diretor que não está na presença/ausência da reunião (exceto relator)', 0, fora, 'relator de vista pode ser diretor de reunião anterior (ANM)')
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
wb.save('votos_2026.xlsx'); print('ok', len(V), 'votos', len(D), 'deliberacoes', len(R), 'reunioes')
for q in Q: print(q[4], '|', q[0], '|', q[1][:70], '|', q[2], q[3])
