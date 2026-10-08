"""ANVISA: une as atas das ROP/REP (anvisa.json) com os extratos dos Circuitos Deliberativos (anvisa_cd.json) -> anvisa_final.json.
Regra: item de ROP que a ata diz ter sido 'apreciado em Circuito Deliberativo n' e cujo extrato existe (origem ROP/item igual) passa a usar a
TABELA NOMINAL do extrato (votos individuais) e o extrato nao entra de novo como deliberacao (evita contar a mesma decisao duas vezes).
Uso: python3 -I scripts/anvisa_unir.py anvisa.json anvisa_cd.json anvisa_final.json"""
import json, sys, collections
a, c = json.load(open(sys.argv[1])), json.load(open(sys.argv[2])); out = sys.argv[3]
cdv = collections.defaultdict(list)
for v in c['votos']: cdv[(v['reuniao'], v['processo'])].append(v)
rop_idx = {(d['reuniao'], d['item_n']): d for d in a['deliberacoes']}
liga = collections.defaultdict(list)
for d in c['deliberacoes']:
    if d['origem_rop']:
        t, item = d['origem_rop'].split('|'); r, ano = t.split('/')
        if ano == '2026' and (r, item) in rop_idx: liga[(r, item)].append(d)
cd_por_num = collections.defaultdict(list)
for d in c['deliberacoes']: cd_por_num[int(d['reuniao'][2:])].append(d)
for d in a['deliberacoes']:
    for n in d.get('cds_citados', []):
        for x in cd_por_num.get(n, []):
            if x['processo'] in set(d.get('processos_do_item', [])) | {d['processo']} and x not in liga[(d['reuniao'], d['item_n'])]: liga[(d['reuniao'], d['item_n'])].append(x)
usados = set(); D = []; V = []; sem_voto_cd = 0
votos_rop = collections.defaultdict(list)
for v in a['votos']: votos_rop[(v['reuniao'], v['processo'], v['deliberacao'])].append(v)
for d in a['deliberacoes']:
    k = (d['reuniao'], d['item_n']); d = dict(d)
    cands = sorted(liga.get(k, []), key=lambda x: (x['data'] or '', int(x['reuniao'][2:])))
    if cands:
        ch = cands[-1]; usados.update(id(x) for x in cands)
        d['voto_fonte'] = f"extrato do CD {ch['reuniao'][2:]}/2026 (tabela nominal)"; d['cd_vinculado'] = [int(x['reuniao'][2:]) for x in cands]
        for v in cdv[(ch['reuniao'], ch['processo'])]:
            nv = dict(v, reuniao=d['reuniao'], processo=d['processo'], deliberacao=d['deliberacao'], data=d['data']); V.append(nv)
        # diretores que constam como presentes na ROP mas nao na tabela do CD: mantem a linha da ata (inferida), marcada
        na_tabela = {v['diretor'] for v in cdv[(ch['reuniao'], ch['processo'])]}
        for v in votos_rop[(d['reuniao'], d['processo'], d['deliberacao'])]:
            if v['diretor'] not in na_tabela and v['voto'].startswith('AUSENTE'): V.append(dict(v))
    else:
        d['voto_fonte'] = 'ata da ROP'; d['cd_vinculado'] = []
        V.extend(votos_rop[(d['reuniao'], d['processo'], d['deliberacao'])])
    D.append(d)
extra_cd = [x for x in c['deliberacoes'] if id(x) not in usados]
for x in extra_cd:
    x = dict(x); x['voto_fonte'] = 'extrato do CD (tabela nominal)'; x['cd_vinculado'] = [int(x['reuniao'][2:])]; D.append(x)
    V.extend(cdv[(x['reuniao'], x['processo'])])
cd_reun = {r['reuniao']: r for r in c['reunioes']}
R = list(a['reunioes']) + [r for r in c['reunioes'] if r['reuniao'] in {x['reuniao'] for x in extra_cd}]
# ---- Qualidade da uniao
Q = list(a['qualidade']) + list(c['qualidade'])
def chk(nome, esp, obs, nota=''): Q.append(['ANVISA', nome, esp, obs, 'OK' if esp == obs else 'DIVERGE', nota])
cit = {(d['reuniao'], d['item_n']): d['cds_citados'] for d in a['deliberacoes'] if d.get('cds_citados')}
cds_ext = {int(x['reuniao'][2:]) for x in c['deliberacoes']}
tem = [k for k, v in cit.items() if any(n in cds_ext for n in v)]
chk('Itens de ROP que a ata diz terem passado por CD (com extrato publicado) × itens que receberam a tabela nominal do extrato', len(tem), sum(1 for k in tem if liga.get(k)), 'o texto da ata cita o nº do CD; vincula-se ao extrato de mesmo nº e mesmo processo (ou de mesma origem ROP/item)')
falta = sorted({n for v in cit.values() for n in v if n not in cds_ext})
Q.append(['ANVISA', 'CDs citados nas atas das ROP sem extrato publicado', 0, len(falta), 'OK' if not falta else 'EXCEÇÃO', f'CD {falta[:20]}'])
nv = collections.Counter((v['reuniao'], v['processo'], v['deliberacao']) for v in V)
chk('Itens com 1 linha de voto por diretor votante/ausente (nenhum item sem voto)', len(D), sum(1 for d in D if nv[(d['reuniao'], d['processo'], d['deliberacao'])] > 0))
chk('Votos duplicados (mesmo item e diretor)', 0, len(V) - len({(v['reuniao'], v['processo'], v['deliberacao'], v['diretor']) for v in V}))
pend = list(a.get('pendencias', [])) + list(c['pendencias'])
cob = list(a.get('cobertura', [])) + [['ANVISA', 'Extratos de Circuito Deliberativo 2026 (tabela nominal de votos)', len(c['deliberacoes']), f"{len(usados)} ligados a itens de ROP (mesma decisão), {len(extra_cd)} avulsos; listagem oficial {c.get('items_total', '')}"]]
json.dump({'cobertura': cob, 'pendencias': pend, 'nao_feito': a.get('nao_feito', []), 'reunioes': R, 'deliberacoes': D, 'votos': V, 'qualidade': Q, 'diretores': c['diretores'], 'cd_buracos': c['pendencias'], 'itens_rop_com_cd': len(tem), 'cds_vinculados': len(usados), 'cds_avulsos': len(extra_cd), 'cds_sem_extrato_citados': falta}, open(out, 'w'), ensure_ascii=False, indent=1)
print(len(R), 'reuniões', len(D), 'itens', len(V), 'votos | CDs ligados a itens de ROP:', len(usados), '| CDs avulsos:', len(extra_cd), '| citados sem extrato:', len(falta))
for q in Q[-4:]: print(q[1][:80], q[2], q[3], q[4])
