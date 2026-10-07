#!/usr/bin/env python3
"""Consolida anm.json + antt.json (+ manifesto) em votos_2026.xlsx. Uso: python3 -I build_xlsx.py"""
import json, collections
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
anm = json.load(open('anm.json')); antt = json.load(open('antt.json')); man = {r['tag']: r for r in json.load(open('manifesto_antt.json'))}
inv = json.load(open('antt_inventario.json'))
def ano(r): return (r.get('data') or '')[:4]
AR = [dict(r, agencia='ANM') for r in anm['reunioes'] if ano(r) == '2026'] + [dict(r, agencia='ANTT') for r in antt['reunioes']]
keep_anm = {r['reuniao'] for r in AR if r['agencia'] == 'ANM'}
D = [dict(d, agencia='ANM') for d in anm['deliberacoes'] if d['reuniao'] in keep_anm] + [dict(d, agencia='ANTT') for d in antt['deliberacoes']]
V = [dict(v, agencia='ANM') for v in anm['votos'] if v['reuniao'] in keep_anm] + [dict(v, agencia='ANTT') for v in antt['votos']]
res = {(d['agencia'], d['reuniao'], d['processo']): d for d in D}
wb = Workbook()
def sheet(nome, cab, linhas, larg=None):
    ws = wb.create_sheet(nome); ws.append(cab)
    for c in ws[1]: c.font = Font(bold=True, color='FFFFFF'); c.fill = PatternFill('solid', fgColor='1F3A5F'); c.alignment = Alignment(wrap_text=True, vertical='top')
    for l in linhas: ws.append(l)
    for i, c in enumerate(cab, 1): ws.column_dimensions[get_column_letter(i)].width = (larg or {}).get(c, 18)
    ws.freeze_panes = 'A2'; ws.auto_filter.ref = ws.dimensions; return ws
wb.remove(wb.active)
# Resumo por diretor
cnt = collections.defaultdict(collections.Counter)
for v in V:
    k = (v['agencia'], v['diretor']); c = cnt[k]; c['deliberacoes com presenca/registro'] += 1
    t = v['voto']
    if t.startswith('RELATOR'): c['como relator'] += 1
    elif t == 'ACOMPANHOU': c['acompanhou'] += 1
    elif t == 'PEDIU VISTA': c['pediu vista'] += 1
    elif t == 'AUSENTE': c['ausente'] += 1
    elif t.startswith('SEM VOTO'): c['retirado de pauta'] += 1
    else: c['a revisar'] += 1
    c['voto nominal (citado no texto)'] += v['proveniencia'] == 'nominal'; c['voto inferido (unanimidade)'] += v['proveniencia'] == 'inferido'
cols = ['deliberacoes com presenca/registro', 'como relator', 'acompanhou', 'pediu vista', 'ausente', 'retirado de pauta', 'a revisar', 'voto nominal (citado no texto)', 'voto inferido (unanimidade)']
sheet('Resumo por diretor', ['Agência', 'Diretor'] + cols, [[a, d] + [cnt[(a, d)][c] for c in cols] for (a, d) in sorted(cnt)], {'Diretor': 40})
sheet('Votos', ['Agência', 'Reunião', 'Data', 'Processo', 'Diretor', 'Voto', 'Proveniência', 'Resultado da deliberação', 'Relator'],
      [[v['agencia'], v['reuniao'], v['data'], v['processo'], v['diretor'], v['voto'], v['proveniencia'], res[(v['agencia'], v['reuniao'], v['processo'])]['resultado'], res[(v['agencia'], v['reuniao'], v['processo'])]['relator']] for v in V],
      {'Diretor': 38, 'Voto': 28, 'Resultado da deliberação': 30, 'Relator': 38, 'Processo': 24})
sheet('Deliberações', ['Agência', 'Reunião', 'Data', 'Processo', 'Relator', 'Interessado', 'Assunto', 'Resultado', 'Voto (doc)', 'Texto da decisão'],
      [[d['agencia'], d['reuniao'], d['data'], d['processo'], d['relator'], d['interessado'], d.get('assunto', ''), d['resultado'], d.get('voto_doc', ''), d.get('decisao_texto') or d.get('deliberacao_texto', '')] for d in D],
      {'Relator': 36, 'Interessado': 40, 'Assunto': 50, 'Texto da decisão': 80, 'Processo': 24, 'Resultado': 28})
nd = collections.Counter((d['agencia'], d['reuniao']) for d in D)
sheet('Reuniões', ['Agência', 'Reunião', 'Data', 'Tipo', 'Presentes', 'Ausentes', 'Nº deliberações lidas', 'Nº PDFs de voto no site', 'Observação'],
      [[r['agencia'], r['reuniao'], r.get('data'), r.get('tipo', ''), '; '.join(r.get('presentes', [])), '; '.join(r.get('ausentes', [])), nd[(r['agencia'], r['reuniao'])],
        sum(1 for d in man.get(r['reuniao'], {}).get('docs', []) if d['tipo'] == 'voto') if r['agencia'] == 'ANTT' else '', r.get('obs', '')] for r in sorted(AR, key=lambda r: (r['agencia'], r.get('data') or ''))],
      {'Presentes': 70, 'Ausentes': 30, 'Observação': 40})
# Cobertura
a26 = [c for c in inv if c['data'].endswith('2026')]; tp = collections.Counter(c['tipo'] for c in a26)
sem_ata = [r['reuniao'] for r in antt['reunioes'] if r['obs']]
ana = sum(1 for d in D if d['agencia'] == 'ANM' and d['resultado'].startswith('SEM DELIB'))
FUT = {'RDE302': '13/10/2026', 'ROD1043': '08/10/2026', 'RDE301': '05/10/2026'}
AGU = ['ROD1042', 'RDE300', 'RDE299']
cob = [
 ['ANM', 'Calendário oficial de ROPs 2026 (PDF da ANM)', 12, 'Denominador independente'],
 ['ANM', 'ROPs que já deveriam ter ocorrido até 07/10/2026 (28/1,23/2,25/3,29/4,27/5,30/6*,29/7,19/8,30/9)', 9, '*a ROP86 foi em 30/06 (calendário previa 24/06); 81ª a 89ª pela numeração'],
 ['ANM', 'ROPs com ata publicada e lida (81ª a 88ª)', 8, 'Fonte: subpágina atas-da-rop/atas-reunioes-ordinarias (59ª a 88ª sem buraco). A página atas-da-rop mostra só as 8 mais recentes'],
 ['ANM', 'ROP sem ata ainda', 1, '89ª (30/09): só a PAUTA está publicada; ata aguardando publicação (as anteriores saíram ~3 a 4 semanas depois)'],
 ['ANM', 'Reuniões extraordinárias (REP) em 2026', 0, 'A última, 34ª, é de 19/11/2025'],
 ['ANM', 'Deliberações lidas (ROP 81–88)', sum(1 for d in D if d['agencia'] == 'ANM'), f'{ana} itens sem "DELIBERAÇÃO:" no texto (em geral aprovação da ata anterior, sem voto). ROP87 lida por OCR'],
 ['ANTT', 'Reuniões listadas em 2026 (todas, listagem paginada até 2025)', len(a26), f'Tipos: {dict(tp)}'],
 ['ANTT', 'Reuniões administrativas (37)', 37, 'Só têm PAUTA publicada (sem ata, sem voto): fora do escopo'],
 ['ANTT', 'Reuniões deliberativas (Ord.+Extra+Eletrônicas)', len(antt['reunioes']), 'Sequências sem buraco: Ord. 1024-1043, Extra 99-102, Eletr. 263-302'],
 ['ANTT', 'Futuras (só pauta, ainda não ocorreram)', len(FUT), ', '.join(f'{k} ({v})' for k, v in FUT.items())],
 ['ANTT', 'Realizadas', len(antt['reunioes']) - len(FUT), ''],
 ['ANTT', 'Realizadas COM ata lida', len(antt['reunioes']) - len(sem_ata), ''],
 ['ANTT', 'Realizadas, ata em publicação (set/2026)', len(AGU), ', '.join(AGU) + ' — votos individuais já publicados; ata ainda não'],
 ['ANTT', 'Realizada SEM ata (lacuna antiga)', 1, 'RDE270 (02/03/2026): há 4 PDFs de voto, nenhuma ata — perguntar à ANTT'],
 ['ANTT', 'Deliberações lidas nas atas', sum(1 for d in D if d['agencia'] == 'ANTT'), 'Confere com as 304 ocorrências de "Decisão:" no texto'],
 ['ARTESP', 'Reuniões listadas em 2026 (página carregada com navegador comum)', len(json.load(open('artesp_inventario.json'))) and sum(1 for r in json.load(open('artesp_inventario.json')) if r['data'].endswith('2026')), 'Ordinárias 1177ª-1214ª (38, sem buraco; 1177ª = 13/01/2026) + série 230-247 (18, sem buraco); todas com Pauta, Ata e Deliberações'],
 ['ARTESP', 'PDFs baixados / votos extraídos', 0, 'PDFs em admin.cms.sp.gov.br (AWS WAF): o proxy do ambiente nega *.token.awswaf.com, o desafio não termina. Liberar admin.cms.sp.gov.br e *.token.awswaf.com'],
]
sheet('Cobertura', ['Agência', 'Medida', 'Valor', 'Nota'], cob, {'Medida': 80, 'Nota': 100})
sheet('Pendências', ['Item', 'Detalhe'], [
 ['Proveniência', 'inferido = ata diz "por unanimidade": todos os presentes acompanharam o relator (não há voto individual escrito). nominal = o texto cita o diretor (relator, vista, ausente).'],
 ['REVISAR', 'Maioria, vista pendente ou texto ambíguo: o voto de cada diretor não está nominado na ata; exige leitura do voto individual/vídeo.'],
 ['ANM', 'Ata da 89ª ROP (30/09) ainda não publicada. Métricas da ANM cobrem ROP 81–88 (jan–ago/2026).'],
 ['ANTT', 'RDE270 sem ata; 299/300/1042 aguardando ata; 3 reuniões futuras. 99 PDFs de voto são imagem e não foram lidos (a ata já traz o resultado).'],
 ['ARTESP', 'Inventário feito; PDFs dependem de liberar admin.cms.sp.gov.br e *.token.awswaf.com no proxy do ambiente.'],
 ['Qualidade', 'Parser não validado contra gabarito manual; amostrar 10 deliberações por agência antes de confiar nos números.'],
], {'Detalhe': 140})
art = [r for r in json.load(open('artesp_inventario.json')) if r['data'].endswith('2026')]
lab = lambda r, k: 'sim' if any(d['rotulo'].lower().startswith(k) for d in r['docs']) else 'NÃO'
sheet('ARTESP inventário', ['Série', 'Nº', 'Data', 'Tipo', 'Pauta', 'Ata', 'Deliberações', 'Status'],
      [['Ordinárias (1177+)' if r['numero'] > 1000 else 'Série 230+', r['numero'], r['data'][6:] + '-' + r['data'][3:5] + '-' + r['data'][:2], r['tipo'], lab(r, 'pauta'), lab(r, 'ata'), lab(r, 'delib'), 'listada; PDF não baixado (rede)'] for r in sorted(art, key=lambda r: (r['numero'] > 1000, r['numero']))],
      {'Série': 20, 'Status': 36})
wb.save('votos_2026.xlsx'); print('ok', len(V), 'votos', len(D), 'deliberacoes')
