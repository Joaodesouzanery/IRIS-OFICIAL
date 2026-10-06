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
cob = [
 ['ANM', 'Calendário oficial de ROPs 2026 (PDF da ANM)', 12, 'Fonte independente do denominador'],
 ['ANM', 'ROPs que já deveriam ter ocorrido até 06/10/2026 (28/1,23/2,25/3,29/4,27/5,24/6*,29/7,19/8,30/9)', 9, '*a ROP86 foi em 30/06; 81ª a 84ª e 89ª inferidas pela numeração'],
 ['ANM', 'ROPs com ata publicada na listagem do site (85ª a 88ª)', 4, 'Listagem tem só 8 atas: ROP 85-88 e REP 31-34; REP31-34 são de 2024/2025'],
 ['ANM', 'ROPs de 2026 SEM ata no site', 5, '81ª, 82ª, 83ª, 84ª (jan-abr) e 89ª (30/09); URLs adivinhadas devolvem 404. Lacuna real ou publicação pendente — confirmar com a ANM'],
 ['ANM', 'Deliberações lidas nas atas disponíveis', sum(1 for d in D if d['agencia'] == 'ANM'), '1 ata (ROP87) era PDF-imagem e foi lida por OCR (sem acento)'],
 ['ANTT', 'Reuniões listadas em 2026 (todas)', len(a26), f'Tipos: {dict(tp)}'],
 ['ANTT', 'Reuniões deliberativas (Ordinárias+Extraordinárias+Eletrônicas)', len(antt['reunioes']), 'Administrativas (37) não deliberam processos e foram excluídas'],
 ['ANTT', 'Sequências sem buraco', 'sim', 'Ordinárias 1024-1043, Extra 99-102, Eletrônicas 263-302: todos os números presentes'],
 ['ANTT', 'Reuniões COM ata em texto', len(antt['reunioes']) - len(sem_ata), ''],
 ['ANTT', 'Reuniões SEM ata no site', len(sem_ata), ', '.join(sem_ata)],
 ['ANTT', 'Deliberações lidas nas atas', sum(1 for d in D if d['agencia'] == 'ANTT'), 'Confere com as 304 ocorrências de "Decisão:" no texto'],
 ['ARTESP', 'Reuniões / deliberações', 'NÃO COLETADO', 'Site protegido pelo Imperva/Incapsula: o servidor devolve página de desafio (1,2 KB) mesmo por navegador headless'],
]
sheet('Cobertura', ['Agência', 'Medida', 'Valor', 'Nota'], cob, {'Medida': 80, 'Nota': 100})
sheet('Pendências', ['Item', 'Detalhe'], [
 ['Proveniência', 'inferido = ata diz "por unanimidade": todos os presentes acompanharam o relator (não há voto individual escrito). nominal = o texto cita o diretor (relator, vista, ausente).'],
 ['REVISAR', 'Maioria, vista pendente ou texto ambíguo: o voto de cada diretor não está nominado na ata; exige leitura do voto individual/vídeo.'],
 ['ANM', 'Faltam atas 81-84 e 89 (ver Cobertura). Sem elas, as métricas por diretor da ANM cobrem só mai-ago/2026.'],
 ['ANTT', 'Atas ausentes listadas em Cobertura. 99 PDFs de voto eram imagem; OCR em andamento e não usado na extração (a ata já traz o resultado).'],
 ['ARTESP', 'Precisa de download manual dos PDFs ou liberação do Imperva.'],
 ['Qualidade', 'Parser não validado contra gabarito manual; amostrar 10 deliberações por agência antes de confiar nos números.'],
], {'Detalhe': 140})
wb.save('votos_2026.xlsx'); print('ok', len(V), 'votos', len(D), 'deliberacoes')
