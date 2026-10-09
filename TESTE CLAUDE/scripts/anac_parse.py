"""ANAC: parser das paginas de reuniao (Processo/Interessado/Assunto/Relator/Deliberacao) -> anac.json.
uso: python3 -I scripts/anac_parse.py manifesto_anac.json anac_inventario.json anac.json [--pagina arq.html  (autoteste, imprime itens)]
Voto: nominal so quando a pagina nomeia ("voto vencido do Diretor X"); unanimidade -> ACOMPANHOU inferido por presente; sem lista de presentes -> REVISAR."""
import sys, os, json, re, html
def itens_pagina(h):
    t = re.sub(r'<script.*?</script>|<style.*?</style>', '', h, flags=re.S)
    i = t.find('PROCESSOS DELIBERADOS'); t = t[i:] if i >= 0 else t
    t = re.sub(r'<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>', lambda m: re.sub(r'<[^>]+>', '', m.group(2)).strip() + ' <' + m.group(1) + '>', t, flags=re.S)
    L = [x.strip() for x in html.unescape(re.sub(r'<[^>]+>', '\n', t)).split('\n') if x.strip()]
    its, cur, campo = [], None, None
    for x in L:
        if re.fullmatch(r'\d{1,3}', x) and (cur is None or cur.get('deliberacao') is not None or True) and campo != 'Assunto':
            cur = {'item_n': x}; its.append(cur); campo = None; continue
        if cur is None: continue
        if x in ('Processo', 'Interessado', 'Assunto', 'Relator', 'Deliberação', 'Documentos', 'Ato decorrente'): campo = x; cur.setdefault(x, ''); continue
        if x.startswith('link para Copiar'): break
        if campo: cur[campo] = (cur[campo] + ' ' + x).strip()
    return its
def classifica(delib):
    d = delib.lower()
    if 'vista' in d: return 'Vista'
    if 'retirad' in d or 'adiad' in d: return 'Retirada de pauta'
    if 'ata' in d and 'aprova' in d: return 'Aprovação de ata'
    if 'cancel' in d: return 'Cancelada'
    return 'Deliberação'
if len(sys.argv) > 2 and sys.argv[1] == '--pagina':
    its = itens_pagina(open(sys.argv[2], errors='replace').read())
    for i in its: print(i.get('item_n'), i.get('Processo'), '|', i.get('Relator'), '|', i.get('Deliberação'))
    sys.exit(0)
MAN, INV, OUT = sys.argv[1:4]
inv = json.load(open(INV)); man = json.load(open(MAN))
dirs = {}  # diretores 2026 so entram com ata/pagina que os nomeie
reun, delib, votos, pend = [], [], [], []
for r in inv['reunioes_2026_gov_br']:
    its = itens_pagina(open(r['arquivo'], errors='replace').read())
    rid = ('RD' if r['tipo'] == 'presencial' else 'RE') + str(r['n'])
    reun.append({'reuniao': rid, 'tipo': r['tipo'], 'titulo': '', 'data': r['realizacao'], 'presentes': [], 'ausentes': [], 'obs': 'presença não publicada na página (ata)', 'fontes': [{'tipo': 'pagina', 'url': r['url']}]})
    for i in its:
        d = i.get('Deliberação', '')
        delib.append({'reuniao': rid, 'processo': i.get('Processo', ''), 'item_n': i['item_n'], 'relator': i.get('Relator', ''), 'interessado': i.get('Interessado', ''), 'assunto': i.get('Assunto', ''), 'resultado': d, 'tipo_item': classifica(d), 'partes': [{'parte': 'I', 'acao': d, 'modo': 'unanimidade' if 'unanimidade' in d.lower() else ('maioria' if 'maioria' in d.lower() else ''), 'vencidos': [], 'abstencoes': [], 'impedidos': [], 'ressalvas': []}], 'origem': r['url']})
        votos.append({'reuniao': rid, 'processo': i.get('Processo', ''), 'deliberacao': i['item_n'], 'diretor': '', 'voto': 'SEM VOTO', 'proveniencia': 'REVISAR', 'voto_por_parte': '', 'motivo': 'lista de presentes só na ata (não publicada/baixada): voto individual não atribuível'})
sem_apex = inv['acesso']['apex_2026'] != 'ok'
if sem_apex:
    for k, u in [('Índice de reuniões presenciais 2026 (REDIR, atas, pautas, deliberações)', 'https://departamental.anac.gov.br/menu/f?p=107101:137'),
                 ('Índice de reuniões eletrônicas 2026', 'https://santosdumont.anac.gov.br/menu/f?p=107101:138:0:::138:P138_ANO:2026'),
                 ('Calendário 2026 (Portaria 18.366) = denominador independente', 'https://www.anac.gov.br/assuntos/legislacao/legislacao-1/portarias/2025/portaria-18366')]:
        pend.append(['ANAC', k, '2026', 'bloqueado pela fonte/egress', 'host fora da allowlist do proxy (403 CONNECT); gov.br/anac/.../2026 retorna 404 (2026 só existe no APEX)', 'liberar o host ou o usuário enviar os PDFs/HTML', 'reexecutar scripts/anac_rodar.sh', u])
out = {'reunioes': reun, 'deliberacoes': delib, 'votos': votos, 'qualidade': [], 'cobertura': [['ANAC', 'Reuniões 2026 listadas (gov.br)', len(reun), 'índices oficiais de 2026 inacessíveis; calendário não lido']],
       'pendencias': pend, 'nao_feito': [['ANAC', 'Votos de diretores 2026', 'todos', 'BLOQUEADO PELA FONTE', 'índices/atas 2026 em hosts fora da allowlist', 'liberar departamental/santosdumont/www.anac.gov.br']] if sem_apex else [],
       'diretores': [], 'colegiado': 'Diretoria Colegiada (ANAC)', 'ex_diretores': {}, 'papeis': {}, '_fonte': {'govbr': 'https://www.gov.br/anac/pt-br/acesso-a-informacao/institucional/reunioes-da-diretoria', 'inventario': INV},
       'composicao_nota': 'Pág. gov.br/diretoria-colegiada (22/05/2026): Tiago Faierstein (Presidente), Rui Mesquita, Antônio Mathias Moreira, Roberto Honorato (substituto desde 23/03/2026), Cláudio Ianelli (substituto desde 25/04/2026). Nenhum voto atribuído.'}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
print('reunioes', len(reun), 'itens', len(delib), 'votos', len(votos), 'pendencias', len(pend))
