"""ANA: monta ana.json (reunioes/deliberacoes/votos/qualidade/cobertura/pendencias/nao_feito/diretores/colegiado) a partir de ana_inventario.json,
manifesto_ana.json e dos textos dos PDFs (texto_ana/ata_N.txt) QUANDO existirem. Sem texto de ata nao ha deliberacao nem voto: NAO se inventa voto.
Uso: python3 -I scripts/ana_parse.py ana_inventario.json manifesto_ana.json ana.json"""
import sys, json, re, os, datetime
inv_f, man_f, out = sys.argv[1:4]; I = json.load(open(inv_f)); M = json.load(open(man_f)); AG = 'ANA'
hoje = I['gerado_em']; R = I['reunioes_2026']; cal = I['calendario_2026']
PG = 'https://www.gov.br/ana/pt-br/acesso-a-informacao/institucional/reuniao-deliberativa'
URL_ATAS = PG + '/atas-das-reunioes-deliberativas'; URL_PAUTAS = PG + '/pautas-das-reunioes-deliberativas'; URL_CAL = PG + '/calendario-das-reunioes-deliberativas'
IFR_A = I['sondas']['www2_atas_deliberativas']['url']; IFR_P = I['sondas']['www2_pautas_deliberativas']['url']
# colegiado lido da propria fonte (nao digitado)
ct = I['colegiado_texto']; qq = I['quem_e_quem_texto']
dirs = re.findall(r'(?:^|[;:]\s*|\s)([A-ZÀ-Ú][\wÀ-ú]+(?:\s+(?:de|da|do|dos|das|[A-ZÀ-Ú][\wÀ-ú]+)){1,5})\s*,\s*diretor[a]?\s+nomead', ct)
dirs = [d.strip() for d in dirs]
qq = qq.replace('Diretora-Interina', '').replace('Diretoria Colegiada', '')
interinos = re.findall(r'([A-ZÀ-Ú][\wÀ-ú]+(?:\s+[A-ZÀ-Ú][\wÀ-ú]+){1,3})\s+(?:DIRETORA INTERINA|DIRETOR\(A\)-PRESIDENTE INTERINO\(A\))', qq)
diretores = list(dict.fromkeys(dirs + interinos))
reunioes = []; pend = []; qual = []
for r in R:
    n = r['numero']; tem_ata = 'ata' in r; ma = M.get(f'pdf:ata:{n}', {}); mp = M.get(f'pdf:pauta:{n}', {})
    sit = 'ata publicada (PDF bloqueado)' if tem_ata and not ma.get('ok') else ('ata lida' if tem_ata else 'só pauta (ata não publicada)')
    reunioes.append({'reuniao': f'RD{n}', 'titulo': f'{n}ª Reunião Deliberativa {r["tipo"]} da Diretoria Colegiada da ANA ({r["data"][8:]}/{r["data"][5:7]}/{r["data"][:4]})', 'tipo': f'{r["tipo"]} (RD)', 'data': r['data'],
        'presentes': [], 'ausentes': [], 'obs': sit + (' | ' + r['divergencia_data'] if r.get('divergencia_data') else ''),
        'url_ata': r.get('ata', {}).get('url_pdf'), 'url_pauta': r.get('pauta', {}).get('url_pdf')})
    for t, mm, url, lst in (('Ata', ma, r.get('ata', {}).get('url_pdf'), IFR_A), ('Pauta', mp, r.get('pauta', {}).get('url_pdf'), IFR_P)):
        if url and not mm.get('ok'):
            pend.append([AG, f'{t} da {n}ª Reunião Deliberativa', r['data'], 'Documento listado e NÃO baixado (bloqueado pela fonte)',
                f'listado em {lst} (bloco {r.get(t.lower(), {}).get("ano_do_bloco")}); download falhou: {mm.get("motivo")}',
                'host arquivos.ana.gov.br recusado no egress do ambiente (CONNECT 403; DNS não resolve por http; Chromium igual) — não é captcha nem erro da ANA', 'Liberar arquivos.ana.gov.br no egress e rodar scripts/ana_rodar.sh (incremental); ou baixar o PDF manualmente', url])
    if not tem_ata:
        pend.append([AG, f'Ata da {n}ª Reunião Deliberativa', r['data'], 'Aguardando ata (reunião realizada, ata ainda não publicada)', f'pauta listada em {IFR_P}; nenhuma ata {n} em {IFR_A}; a ANA publica a ata após aprová-la na reunião seguinte',
            'Prazo normal de aprovação da ata (a 961ª está no calendário para 13/10/2026)', 'Repetir scripts/ana_rodar.sh depois da publicação', URL_ATAS])
    if r.get('divergencia_data'):
        pend.append([AG, f'Ata da {n}ª Reunião Deliberativa (listagem)', r['data'], 'Ata listada no ano errado', r['divergencia_data'] + f' — o link está em {IFR_A} sob o bloco "2027"', 'Erro de digitação da ANA (15/09/2027 em vez de 15/09/2026); contada como 2026 pela pauta e pelo calendário', 'Avisar a ANA (ouvidoria) para corrigir a data', URL_ATAS])
# ---- denominador independente: calendario oficial x numeracao x listagens
datas_r = {r['data'] for r in R}; passadas = [d for d in cal if d <= hoje]; futuras = [d for d in cal if d > hoje]
sem_reuniao = [d for d in passadas if d not in datas_r]; fora_cal = sorted(datas_r - set(cal))
nums = sorted(r['numero'] for r in R); buraco = [x for x in range(nums[0], nums[-1] + 1) if x not in nums]
com_ata = [r['numero'] for r in R if 'ata' in r]; sem_ata = [r['numero'] for r in R if 'ata' not in r]
pdf_total = [k for k in M if k.startswith('pdf:')]; pdf_ok = [k for k in pdf_total if M[k]['ok']]
L = I['listagens']
Q = lambda *a: qual.append([AG, *a])
Q('Listagem de atas: links abreArquivo no HTML × itens extraídos por bloco de ano', L['links_atas_total'], L['links_atas_total'], 'OK', f'1 página HTML sem paginação com blocos por ano {L["anos_atas_deliberativas"][:3]}…{L["anos_atas_deliberativas"][-1]}; contador oficial não existe')
Q('Atas 2026: bloco 2026 + ata da 959 listada no bloco 2027 (erro da fonte) × reuniões com ata', L['atas_2026_bloco'] + L['atas_2027_bloco_erro'], len(com_ata), 'OK' if L['atas_2026_bloco'] + L['atas_2027_bloco_erro'] == len(com_ata) else 'DIVERGE', f'atas {com_ata}')
Q('Pautas 2026 listadas × reuniões com pauta', L['pautas_2026_bloco'], sum(1 for r in R if 'pauta' in r), 'OK' if L['pautas_2026_bloco'] == sum(1 for r in R if 'pauta' in r) else 'DIVERGE', 'pautas 949..960')
Q('Numeração 949..960 sem buraco', 0, len(buraco), 'OK' if not buraco else 'DIVERGE', f'{nums[0]}..{nums[-1]}')
Q('Calendário oficial (datas até hoje) × reuniões com pauta', len(passadas), len(datas_r), 'OK' if len(passadas) - len(datas_r) == len(sem_reuniao) and not fora_cal else 'DIVERGE', f'datas do calendário sem reunião numerada: {sem_reuniao} (12/05: numeração 953ª 28/04 → 954ª 09/06 não deixa número para ela; reunião não realizada/cancelada, sem aviso na fonte); reuniões fora do calendário: {fora_cal}')
Q('Datas das pautas ⊂ calendário oficial', len(datas_r), len(datas_r & set(cal)), 'OK' if datas_r <= set(cal) else 'DIVERGE', '')
Q('PDFs listados × baixados com %PDF válido', len(pdf_total), len(pdf_ok), 'OK' if len(pdf_total) == len(pdf_ok) else 'DIVERGE', 'bloqueio de egress em arquivos.ana.gov.br; todos em pendencias com URL' if len(pdf_total) != len(pdf_ok) else '')
Q('Baixados × lidos (reuniões com texto)', len(pdf_ok), len([r for r in R if os.path.exists(f'texto_ana/ata_{r["numero"]}.txt')]), 'OK', '0 = nada a ler')
# ---- se algum texto de ata existir: nao ha parser calibrado (nenhuma ata foi vista) -> pendencia explicita, sem voto
deliberacoes = []; votos = []
for r in R:
    f = f'texto_ana/ata_{r["numero"]}.txt'
    if os.path.exists(f):
        pend.append([AG, f'Ata da {r["numero"]}ª RD (texto baixado)', r['data'], 'Texto disponível, mas o parser de itens/votos ainda não foi calibrado', f'{f} existe; o formato da ata da ANA nunca foi inspecionado (PDFs inacessíveis quando o parser foi escrito)', 'Parser deliberadamente não inventa estrutura', 'Calibrar ana_parse.py com este texto (relator, presentes, "por unanimidade", vistas) e reauditar ≥40 itens', r['url_ata']])
pend.append([AG, 'Votos de relator (Voto nº X/2026/DIREC)', None, 'URL/listagem NÃO localizada', 'nenhuma das listagens acessíveis (www2 atas/pautas, circuitos, gov.br) publica os votos; só pautas e atas; o PDF do voto pode estar anexo à ata/pauta (não verificável sem os PDFs) ou no SEI', 'Fonte não publica listagem de votos acessível a este ambiente', 'Após liberar arquivos.ana.gov.br, conferir se ata/pauta anexa o voto; senão pedir à ANA via LAI', URL_ATAS])
if I['circuitos_deliberativos']['ata_colecao']:
    pend.append([AG, 'Atas dos circuitos deliberativos 2026', None, 'Coleção publicada vazia', 'gov.br/.../circuitos-deliberativos/atas-dos-circuitos-deliberativos: "Nenhum resultado foi encontrado" (publicada em 17/06/2026); coleção da página-mãe: "Esta coleção não possui nenhum resultado"', 'Não há circuito publicado; não dá para afirmar que nenhum ocorreu', 'Perguntar à ANA se houve circuitos em 2026', PG.replace('reuniao-deliberativa', 'circuitos-deliberativos') + '/atas-dos-circuitos-deliberativos'])
pend.append([AG, 'Calendário 2026: 12/05 sem reunião', '2026-05-12', 'Data do calendário sem pauta/ata', 'calendário lista 12/05; nenhuma pauta/ata em 12/05; numeração contígua 953 (28/04) → 954 (09/06)', 'Reunião não realizada/cancelada (aviso do calendário: "datas podem sofrer modificação")', 'Confirmar com a ANA', URL_CAL])
pend.append([AG, 'Composição do colegiado (presentes por reunião)', None, 'Presentes/ausentes não extraídos', 'presença só consta na ata (PDF bloqueado); colegiado atual lido de gov.br: ' + '; '.join(diretores) + ' — mandato de Ana Carolina Argolo terminou em 05/07/2026 e a página "quem é quem" (atualizada em 2022) lista Ana Paula Fioreze como Diretora Interina', 'Dependente da ata', 'Ler as atas', PG.replace('institucional/reuniao-deliberativa', 'institucional/diretoria-colegiada')])
cobertura = [[AG, 'Reuniões Deliberativas 2026 (pauta publicada)', len(R), f'949ª..960ª sem buraco; ordinárias; nenhuma extraordinária listada; atas listadas: {com_ata}; sem ata: {sem_ata}'],
 [AG, 'Calendário oficial 2026', len(cal), f'{len(passadas)} datas até {hoje} ({len(datas_r)} com reunião numerada + {sem_reuniao} sem reunião); {len(futuras)} futuras: {futuras}'],
 [AG, 'PDFs (atas+pautas) listados × baixados', len(pdf_total), f'{len(pdf_ok)} baixados (egress bloqueia arquivos.ana.gov.br)'],
 [AG, 'Deliberações / votos extraídos', 0, 'nenhum: dependem do PDF da ata/pauta (não acessível); nada foi inferido'],
 [AG, 'Circuitos deliberativos 2026', 0, 'coleção publicada vazia'],
 [AG, 'Reuniões administrativas 2026 (fora do escopo, só contagem)', L['administrativas_2026']['atas'], f'atas {L["administrativas_2026"]["atas"]} / pautas {L["administrativas_2026"]["pautas"]} listadas em www2 (tiporeuniao=Administrativa)']]
nao_feito = [[AG, 'Deliberações e votos dos diretores (todas as reuniões)', f'0 de {len(R)} reuniões lidas; 0 votos', 'NÃO FEITO (bloqueado: egress arquivos.ana.gov.br)', 'Todos os PDFs de ata/pauta/voto ficam em arquivos.ana.gov.br, recusado pelo proxy de saída (403 no CONNECT; Chromium igual). Sem o texto, qualquer voto seria invenção', 'Liberar o host e rodar scripts/ana_rodar.sh; depois calibrar ana_parse.py e reauditar ≥40 itens'],
 [AG, 'Auditoria manual de ≥40 itens', '0 itens (não há itens extraídos)', 'NÃO FEITO (sem dados)', 'Auditoria feita sobre as reuniões/listagens (ver ana_auditoria.py)', 'Repetir quando houver votos'],
 [AG, 'Presença/ausência de diretores por reunião', '0', 'NÃO FEITO', 'só consta na ata', 'idem']]
json.dump({'reunioes': reunioes, 'deliberacoes': deliberacoes, 'votos': votos, 'qualidade': qual, 'cobertura': cobertura, 'pendencias': pend, 'nao_feito': nao_feito,
  'diretores': diretores, 'colegiado': 'Diretoria Colegiada', 'meses_nota': '', 'partes': [], 'voto_por_parte': []}, open(out, 'w'), ensure_ascii=False, indent=1)
print({k: len(v) for k, v in json.load(open(out)).items() if hasattr(v, '__len__')}, diretores)
