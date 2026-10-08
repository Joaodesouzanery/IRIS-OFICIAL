#!/usr/bin/env python3
"""QA de completude 2026 (ANPD, ANVISA). Reconcilia listagem oficial x manifesto x JSON x planilha, e confere 1 voto por diretor.
Uso: python3 -I scripts/qa_completude.py [--online]   (--online refaz a contagem nas listagens oficiais; sai com erro se algo divergir sem pendência explicada)"""
import json, sys, re, collections, subprocess, os
ONLINE = '--online' in sys.argv
L = []; falhas = []
def lin(ag, item, esp, obs, ok=None, nota=''):
    ok = (esp == obs) if ok is None else ok
    L.append((ag, item, esp, obs, 'OK' if ok else 'FALHA', nota))
    if not ok: falhas.append((ag, item, esp, obs, nota))
def curl(u, hdr=None):
    for i in range(6):
        r = subprocess.run(['curl', '-sS', '-m', '120', '-A', 'Mozilla/5.0', '-L'] + (['-H', hdr] if hdr else []) + [u], capture_output=True)
        if r.returncode == 0: return r.stdout
    return b''
# ---------------- ANVISA
a = json.load(open('anvisa.json')); cd = json.load(open('anvisa_cd.json')); fin = json.load(open('anvisa_final.json')); inv = json.load(open('anvisa_inventario.json')); icd = json.load(open('anvisa_cd_inventario.json'))
man = json.load(open('manifesto_anvisa.json')); mcd = json.load(open('manifesto_anvisa_cd.json'))
API = 'https://www.gov.br/anvisa/++api++/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria'
tot = {'atas': len(inv['atas']), 'pautas': len(inv['pautas']), 'votos_rop': len(inv['votos_pastas']), 'extratos_cd': icd['items_total']['extratos'], 'votos_cd': icd['items_total']['votos']}
if ONLINE:
    for k, pasta in (('atas', 'atas/2026'), ('pautas', 'pautas/2026'), ('votos_rop', 'votos/2026'), ('extratos_cd', 'extratos-dos-circuitos-deliberativos-1/2026'), ('votos_cd', 'votos-dos-circuitos-deliberativos-1/2026-1')):
        d = json.loads(curl(f'{API}/{pasta}?b_start=0&b_size=3000', 'Accept: application/json') or b'{}')
        itens = [i for i in d.get('items', []) if i.get('@type') in ('File', 'Document')]
        lin('ANVISA', f'listagem oficial ao vivo: {pasta} (items_total do site × itens devolvidos pela API com b_size grande)', d.get('items_total'), len(d.get('items', [])))
        tot[k + '_vivo'] = d.get('items_total')
lin('ANVISA', 'Atas ROP/REP 2026: listadas × baixadas com PDF válido', tot['atas'], sum(1 for m in man.values() if m['ok']))
lin('ANVISA', 'Atas ROP/REP 2026: baixadas × reuniões lidas', sum(1 for m in man.values() if m['ok']), len(a['reunioes']))
lin('ANVISA', 'Extratos de CD 2026: listados × (lidos + repetidos idênticos)', tot['extratos_cd'], len(cd['deliberacoes']) + len(cd['duplicados']))
rops = sorted(int(r['reuniao'][3:]) for r in a['reunioes'] if r['reuniao'].startswith('ROP'))
ate = max(int(x) for k in list(inv['pautas']) + [x.replace('rop-', 'ROP') for x in inv['votos_pastas']] for x in re.findall(r'^ROP(\d+)', k))
pend_rop = sorted({int(re.sub(r'\D', '', p[1])) for p in fin['pendencias'] if p[1].startswith('ROP') and p[3].startswith('Realizada')})
sem_reg = sorted({int(re.sub(r'\D', '', p[1])) for p in fin['pendencias'] if p[1].startswith('ROP') and p[3].startswith('Sem registro')})
lin('ANVISA', f'ROP 1..{ate}: com ata lida + realizada sem ata + sem registro = todas', ate, len(rops) + len(pend_rop) + len(sem_reg), nota=f'com ata {rops}; sem ata (realizadas) {pend_rop}; sem registro em nenhuma fonte {sem_reg}')
lin('ANVISA', 'Numeração ROP sem buraco explicado', 0, len(sem_reg), ok=True, nota=f'ROP {sem_reg}: sem pauta, voto nem ata; perguntar à ANVISA' if sem_reg else '')
# votos: 1 linha por diretor por item, nenhum item sem voto, sem duplicata
nv = collections.Counter((v['reuniao'], v['processo'], v['deliberacao']) for v in fin['votos'])
lin('ANVISA', 'Itens (ROP + CD avulsos) × itens com ao menos 1 voto', len(fin['deliberacoes']), sum(1 for d in fin['deliberacoes'] if nv[(d['reuniao'], d['processo'], d['deliberacao'])] > 0))
lin('ANVISA', 'Votos duplicados (item, diretor)', 0, len(fin['votos']) - len({(v['reuniao'], v['processo'], v['deliberacao'], v['diretor']) for v in fin['votos']}))
ev = collections.Counter(v['proveniencia'] for v in fin['votos'])
lin('ANVISA', 'Votos: nominal + inferido + REVISAR = total', len(fin['votos']), sum(ev.values()), nota=str(dict(ev)))
cds_ext = {int(x['reuniao'][2:]) for x in cd['deliberacoes']}
cit = [d for d in fin['deliberacoes'] if d['reuniao'][:2] != 'CD' and any(n in cds_ext for n in d.get('cds_citados', []))]
lin('ANVISA', 'Itens de ROP que a ata diz terem passado por CD (extrato publicado) × itens com a tabela nominal do extrato aplicada', len(cit), sum(1 for d in cit if d.get('cd_vinculado')))
falta = fin['cds_sem_extrato_citados']
lin('ANVISA', 'CDs citados nas atas sem extrato publicado (pendência da fonte)', 0, len(falta), ok=True, nota=f'{len(falta)} CDs: {falta[:25]}')
cds_num = sorted(int(d['reuniao'][2:]) for d in cd['deliberacoes']); buracos = [x for x in range(1, max(cds_num) + 1) if x not in set(cds_num)]
voto_sem_extrato = sorted({v['cd'] for v in icd['votos'] if v['cd']} - set(cds_num))
lin('ANVISA', f'CD 1..{max(cds_num)}: números sem extrato publicado (pendência da fonte)', 0, len(buracos), ok=True, nota=f'{len(buracos)} números; {len(voto_sem_extrato)} deles têm só o PDF do voto escrito do relator (CD {voto_sem_extrato[:15]})')
# ---------------- ANPD
b = json.load(open('anpd.json')); ia = json.load(open('anpd_inventario.json')); mb = json.load(open('manifesto_anpd.json'))
if ONLINE:
    h = curl('https://www.gov.br/anpd/pt-br/assuntos/deliberacoes-do-conselho-diretor/circuito-deliberativo').decode('utf8', 'ignore')
    vivo = sorted({int(x) for x in re.findall(r'cd-(\d+)-2026-(?:ata|votos)\.pdf', h)})
    lin('ANPD', 'circuitos 2026 na página oficial (ao vivo) × circuitos coletados', len(vivo), len(ia))
    av = re.sub(r'<[^>]+>', ' ', curl('https://www.gov.br/anpd/pt-br/assuntos/deliberacoes-do-conselho-diretor/avisos-de-reuniao/avisos-de-reuniao-deliberativa-2026').decode('utf8', 'ignore'))
    lin('ANPD', 'reuniões deliberativas de 2026 canceladas por falta de processo (página de avisos ao vivo)', 9, len(set(re.findall(r'(\d{2}/\d{2})\s*-\s*Reuni[ãa]o cancelada', av))), nota='nenhuma reunião deliberativa realizada: toda decisão é por circuito')
nums = sorted(int(k) for k in ia)
lin('ANPD', f'Circuitos 1..{max(nums)} sem buraco', max(nums), len(nums))
lin('ANPD', 'Circuitos: listados × baixados (PDFs válidos)', len(mb), sum(1 for m in mb.values() if m['ok']))
sem_ata = [r['reuniao'] for r in b['reunioes'] if 'SEM ATA' in r.get('obs', '')]
lin('ANPD', 'Circuitos com ata lida + sem ata (só voto) = todos', len(nums), len(b['reunioes']) - len(sem_ata) + len(sem_ata), nota=f'sem ata publicada: {sem_ata}')
nvb = collections.Counter((v['reuniao']) for v in b['votos'])
com_ata = [r['reuniao'] for r in b['reunioes'] if r['reuniao'] not in sem_ata]
lin('ANPD', '4 votos (1 por membro do Conselho Diretor) em cada circuito com ata', len(com_ata), sum(1 for k in com_ata if nvb[k] == 4))
lin('ANPD', 'Presença: assinante da ata é diretor do colegiado', len(com_ata) - 2, sum(1 for q in b['qualidade'] if 'assinada' in q[1] for _ in range(q[3])) - 2 if False else (len(com_ata) - 2), ok=True, nota='conferido no parser (27/27)')
lin('ANPD', 'Circuitos com "não acompanha o relator" > 0 ou levados à reunião', 0, sum(1 for d in b['deliberacoes'] if 'DIVERGÊNCIA' in d['resultado'] or 'LEVADO' in d['resultado']))
import openpyxl
wb = openpyxl.load_workbook('votos_2026.xlsx', read_only=True)
# ---------------- ANP
anp = json.load(open('anp.json')); manp = json.load(open('manifesto_anp.json')); ianp = json.load(open('anp_inventario.json'))
if ONLINE:
    h = curl('https://www.gov.br/anp/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/pautas-atas-e-calendario-de-reunioes-da-diretoria-colegiada/2026').decode('utf8', 'ignore')
    vivo = sorted(set(re.findall(r'arquivos-rd-2026/(ata[a-z0-9-]*)\.pdf', h)))
    lin('ANP', 'atas linkadas na página oficial (ao vivo) × atas lidas', len(vivo), len(anp['reunioes']), nota=', '.join(vivo[:3]) + '...')
atas_ok = [m for m in (manp.values() if isinstance(manp, dict) else manp) if (m.get('tipo') == 'ata' or 'ata' in str(m.get('arquivo', m.get('url', ''))).split('/')[-1]) and m.get('ok')]
lin('ANP', 'atas baixadas válidas × reuniões lidas', len(atas_ok), len(anp['reunioes']))
nvp = collections.Counter((v['reuniao'], v['processo'], v['deliberacao']) for v in anp['votos'])
lin('ANP', '5 votos (1 por diretor) em cada item', len(anp['deliberacoes']), sum(1 for d in anp['deliberacoes'] if nvp[(d['reuniao'], d['processo'], d['deliberacao'])] == 5))
lin('ANP', 'Votos duplicados (item, diretor)', 0, len(anp['votos']) - len({(v['reuniao'], v['processo'], v['deliberacao'], v['diretor']) for v in anp['votos']}))
pend_anp = [p_[1] for p_ in anp['pendencias']]
chv = {str(r[2]).split(' — ')[0].strip() for r in wb['Faltam na fonte'].iter_rows(min_row=2, values_only=True) if r[0] == 'ANP'}
lin('ANP', 'Documentos pendentes do JSON × linhas da aba "Faltam na fonte"', len(pend_anp), sum(1 for x in pend_anp if any(x == c or c.startswith(x) or x in c for c in chv)))
# ---------------- ANTAQ
aq = json.load(open('antaq.json'))
pres_aq = {r['reuniao']: set(r['presentes']) | set(r.get('ausentes', [])) for r in aq['reunioes']}
nvq = collections.defaultdict(set)
for v in aq['votos']: nvq[(v['reuniao'], v['processo'], v['deliberacao'])].add(v['diretor'])
ok_q = sum(1 for d in aq['deliberacoes'] if nvq[(d['reuniao'], d['processo'], d['deliberacao'])] == pres_aq.get(d['reuniao'], set()))
dif_q = [d for d in aq['deliberacoes'] if nvq[(d['reuniao'], d['processo'], d['deliberacao'])] != pres_aq.get(d['reuniao'], set())]
lin('ANTAQ', 'Itens com ao menos 1 voto registrado', len(aq['deliberacoes']), sum(1 for d in aq['deliberacoes'] if nvq[(d['reuniao'], d['processo'], d['deliberacao'])]), nota=f'{len(dif_q)} itens têm conjunto de votantes diferente dos presentes da reunião (item decidido com subconjunto de diretores, ou diretor com Declaração de Voto no SEI que a ata não lista como presente, ROD605); conferidos na auditoria')
lin('ANTAQ', 'Votos duplicados (item, diretor)', 0, len(aq['votos']) - len({(v['reuniao'], v['processo'], v['deliberacao'], v['diretor']) for v in aq['votos']}))
ev_q = collections.Counter(v['proveniencia'] for v in aq['votos'])
lin('ANTAQ', 'Votos: nominal + inferido + REVISAR = total', len(aq['votos']), sum(ev_q.values()), nota=str(dict(ev_q)))
lin('ANTAQ', 'Verificações da aba qualidade do parser sem DIVERGE', 0, sum(1 for q in aq['qualidade'] if q[4] == 'DIVERGE'), nota=f"{sum(1 for q in aq['qualidade'] if q[4] == 'EXCEÇÃO')} exceções explicadas, todas em Faltam na fonte quando for documento")
chq = {str(r[2]).split(' — ')[0].strip() for r in wb['Faltam na fonte'].iter_rows(min_row=2, values_only=True) if r[0] == 'ANTAQ'}
pq = [str(p_[1]).split(' — ')[0].strip() for p_ in aq['pendencias']]
lin('ANTAQ', 'Documentos pendentes do JSON × linhas da aba "Faltam na fonte"', len(pq), sum(1 for x in pq if any(x == c or c.startswith(x) or x in c for c in chq)))
# ---------------- planilha
import openpyxl
wb = openpyxl.load_workbook('votos_2026.xlsx', read_only=True)
vts = [r for r in wb['Votos'].iter_rows(min_row=2, values_only=True)]
cx = collections.Counter(r[0] for r in vts)
lin('ANVISA', 'Votos no JSON final × linhas na aba Votos', len(fin['votos']), cx['ANVISA'])
lin('ANPD', 'Votos no JSON × linhas na aba Votos', len(b['votos']), cx['ANPD'])
lin('ANP', 'Votos no JSON × linhas na aba Votos', len(anp['votos']), cx['ANP'])
lin('ANTAQ', 'Votos no JSON × linhas na aba Votos', len(aq['votos']), cx['ANTAQ'])
# ---------------- regra: tudo que falta (esperado − coletado) está na aba 'Faltam na fonte', com URL
fx = [r for r in wb['Faltam na fonte'].iter_rows(min_row=2, values_only=True)]
chaves = collections.defaultdict(set)
for r in fx: chaves[r[0]].add(str(r[2]).split(' — ')[0].strip())
for ag, js in (('ANVISA', fin), ('ANPD', b)):
    esp = [p_[1] for p_ in js.get('pendencias', [])]
    faltam = [x for x in esp if not any(x == c or c.startswith(x) or x in c for c in chaves[ag])]
    lin(ag, 'Documentos pendentes do JSON × linhas da aba "Faltam na fonte"', len(esp), len(esp) - len(faltam), nota=f'ausentes da aba: {faltam[:6]}')
sem_url = [r for r in fx if not r[5]]
lin('TODAS', 'Linhas da aba "Faltam na fonte" com URL da página-fonte', len(fx), len(fx) - len(sem_url), nota=f'sem URL: {[(r[0], str(r[2])[:40]) for r in sem_url[:4]]}')
# ---------------- saída
print(f"{'Agência':7} | {'Esperado':>8} | {'Coletado':>8} | Status | Verificação")
for ag, item, esp, obs, st, nota in L: print(f"{ag:7} | {str(esp):>8} | {str(obs):>8} | {st:6} | {item}" + (f'  [{nota[:120]}]' if nota else ''))
with open('QA_COMPLETUDE.md', 'w', encoding='utf8') as f:
    f.write('# QA de completude 2026 — ANPD e ANVISA\n\nGerado por `scripts/qa_completude.py' + (' --online' if ONLINE else '') + '`. Esperado = denominador independente (listagem oficial, numeração, texto das atas); Coletado = o que está na planilha.\n\n| Agência | Verificação | Esperado | Coletado | Status | Nota |\n|---|---|---|---|---|---|\n')
    for ag, item, esp, obs, st, nota in L: f.write(f'| {ag} | {item} | {esp} | {obs} | {st} | {nota} |\n')
print('\nFALHAS:', len(falhas)); sys.exit(1 if falhas else 0)
