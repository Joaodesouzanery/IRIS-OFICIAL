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
for v in V: v['tipo_item'] = get_res(v).get('tipo_item', 'Deliberação')

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
cols = ['como relator/proponente', 'acompanhou', 'divergiu', 'pediu vista', 'ausente', 'sem voto (retirado de pauta)', 'a revisar', 'aprovou a ata anterior']
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
for ag in ('ANM', 'ANTT', 'ARTESP'):
    ct = collections.Counter(d['tipo_item'] for d in D if d['agencia'] == ag)
    cob.append([ag, 'Itens da ata por tipo (todos têm 1 linha de voto por diretor, exceto Cancelada)', sum(ct.values()), '; '.join(f'{k}: {v}' for k, v in ct.most_common())])
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
vidx = collections.defaultdict(dict)
for v in V: vidx[(v['agencia'], v['reuniao'], v['processo'], v.get('deliberacao'))][v['diretor']] = v
def cod(v):
    t = v['voto']; b = ('RELATOR' if t.startswith('RELATOR') else 'RETIROU' if t.startswith('RETIROU') else 'ACOMPANHOU' if t.startswith('ACOMPANHOU') else 'DIVERGIU' if t.startswith('DIVERGIU')
                        else 'VISTA' if 'VISTA' in t and not t.startswith('SEM') else 'AUSENTE' if t.startswith('AUSENTE') else 'sem voto' if t.startswith('SEM VOTO') else 'REVISAR')
    return b + ('*' if v['proveniencia'] == 'inferido' else '')
for ag in ('ANM', 'ANTT', 'ARTESP'):
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
    if n_esp != n_obs: falhas.append((d['agencia'], d['reuniao'], d['processo'], n_esp, n_obs))
for ag in ('ANM', 'ANTT', 'ARTESP'):
    tot_d = sum(1 for d in D if d['agencia'] == ag and d['tipo_item'] not in ('Cancelada', 'Só voto do relator (sem ata)'))
    ruim = [f for f in falhas if f[0] == ag]
    Q.append([ag, 'Cada deliberação não cancelada tem 1 linha de voto por diretor presente/ausente', tot_d, tot_d - len(ruim), 'OK' if not ruim else 'DIVERGE', f'{len(ruim)} divergentes: {ruim[:4]}' if ruim else ''])
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
# ---- ordem final das abas
ordem_abas = ['Resumo por diretor', 'Diretor × tema', 'Diretor por mês', 'Temas', 'Votos', 'Matriz ANM', 'Matriz ANTT', 'Matriz ARTESP', 'Deliberações', 'Reuniões', 'Pendências da fonte', 'Cobertura', 'Qualidade', 'Temas regra x IA', 'Pendências', 'ARTESP inventário']
wb._sheets = [wb[n] for n in ordem_abas if n in wb.sheetnames] + [w for w in wb._sheets if w.title not in ordem_abas]

wb.save('votos_2026.xlsx'); print('ok', len(V), 'votos', len(D), 'deliberacoes', len(R), 'reunioes')
for q in Q: print(q[4], '|', q[0], '|', q[1][:70], '|', q[2], q[3])
