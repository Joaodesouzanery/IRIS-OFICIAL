"""ANTAQ: auditoria por amostra (40 acordaos) de antaq.json contra o TEXTO BRUTO da ata.
Independente do parser: le o PDF com `pdftotext` -raw (ordem do fluxo de conteudo, sem -layout), nao usa limpa()/blocos()/texto_antaq/, e re-extrai
relator, interessado, processo, presentes, resultado (vencidos e verbo do dispositivo) e assunto por regex proprias.
Uso: python3 -I scripts/antaq_auditoria.py antaq.json manifesto_antaq.json [semente] [tamanho]   -> imprime taxa por campo e divergencias"""
import re, sys, json, random, subprocess, unicodedata, collections
a = json.load(open(sys.argv[1])); man = json.load(open(sys.argv[2]))
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 20261008; N = int(sys.argv[4]) if len(sys.argv) > 4 else 40
def norm(s): return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
def flat(s): return re.sub(r'\s+', ' ', re.sub(r'[​ \xa0]', ' ', s)).strip()
RAW = collections.defaultdict(str)
for k, v in man.items():
    if k.startswith('sophia:') and v.get('ok'):
        t_ = subprocess.run(['pdftotext', '-raw', v['arquivo'], '-'], capture_output=True).stdout.decode('utf8', 'ignore')
        # rodape/cabecalho de pagina do SEI (nao faz parte da ata): remove por regex simples, sem reaproveitar o parser
        t_ = '\n'.join(l for l in t_.replace('\f', '\n').split('\n') if not re.match(r'^(https://sei\.antaq\.gov\.br/|\d\d/\d\d/\d{4}, \d\d:\d\d$|SEI/ANTAQ - \d+ - |\d+/\d+$)', l.strip()))
        RAW[v['reuniao']] += '\n' + t_
D = [d for d in a['deliberacoes'] if d['tipo_item'] == 'Deliberação']
random.seed(seed); amostra = random.sample(D, N)
SOBRENOME = {'frederico': 'Frederico Carvalho Dias', 'lima filho': 'Wilson Pereira de Lima Filho', 'alber': 'Alber Furtado de Vasconcelos Neto', 'caio': 'Caio César Farias Leôncio',
             'takafashi': 'Flávia Morais Takafashi', 'cristina': 'Cristina Castro Lucas de Souza', 'florambel': 'Alexandre Palmieri Florambel'}
def nomes(t):
    t = norm(t); return {v for k, v in SOBRENOME.items() if k in t}
# verbo -> rotulos aceitaveis (tabela independente da ROT do parser)
ACEITA = {'conhecer': {'CONHECIDO', 'NÃO CONHECIDO'}, 'referendar': {'REFERENDADO'}, 'aprovar': {'APROVADO', 'APROVADO COM RESSALVAS'}, 'indeferir': {'INDEFERIDO'}, 'deferir': {'DEFERIDO'}, 'reconhecer': {'RECONHECIDO', 'NÃO RECONHECIDO', 'CUMPRIMENTO DECLARADO'},
          'autorizar': {'AUTORIZADO'}, 'declarar': {'AUTO DE INFRAÇÃO INSUBSISTENTE', 'AUTO DE INFRAÇÃO SUBSISTENTE', 'PERDA DE OBJETO', 'EXTINTO', 'CUMPRIMENTO DECLARADO'}, 'rejeitar': {'REJEITADO'}, 'designar': {'DESIGNADO'}, 'negar': {'PROVIMENTO NEGADO', 'INDEFERIDO'},
          'dar': {'PROVIMENTO', 'PROVIMENTO PARCIAL', 'CUMPRIMENTO DECLARADO', 'ANUÊNCIA'}, 'conceder': {'CONCEDIDO', 'PROVIMENTO', 'DEFERIDO'}, 'prorrogar': {'PRORROGADO'}, 'revogar': {'REVOGADO'}, 'retificar': {'RETIFICADO'}, 'responder': {'CONSULTA RESPONDIDA'},
          'receber': {'CONHECIDO'}, 'admitir': {'CONHECIDO'}, 'manter': {'MANTIDO'}, 'suspender': {'SUSPENSO'}, 'acolher': {'ACOLHIDO'}, 'homologar': {'HOMOLOGADO'}}
res = collections.defaultdict(list); falhas = []
for d in sorted(amostra, key=lambda x: (x['reuniao'], int(x['item_n']))):
    n = int(d['item_n']); raw = RAW[d['reuniao']]
    m = re.search(r'AC[ÓO]RD[ÃA]O N[ºo°]\s*' + str(n) + r'\s*-\s*2026\s*-\s*ANTAQ\s*\n(.*?)(?=\n\s*AC[ÓO]RD[ÃA]O N[ºo°]\s*\d+\s*-\s*2026\s*-\s*ANTAQ\s*\n|\Z)', raw, re.S | re.I)
    if not m: falhas.append((d['deliberacao'], 'bloco não achado no PDF bruto')); [res[c].append(False) for c in ('processo', 'relator', 'interessado', 'presentes', 'resultado', 'assunto')]; continue
    b = flat(m[1])
    r_proc = (re.search(r'Processo:\s*(\d{5}\.\d{6}/\d{4}-\d{2})', b) or [None, None])[1]
    r_rel = (re.search(r'Relatora?:\s*(.*?)\s*(?:Revisora?:|Redator|Unidades? T[ée]cnicas?:|\d\.\s*Unidade)', b) or [None, ''])[1]
    r_int = (re.search(r'Interessad[oa]s?:\s*(.*?)\s*(?:\d\.\s*Relator|Relatora?:)', b) or [None, ''])[1]
    r_pres = (re.search(r'Diretores? presentes?:\s*(.*?)(?:\.\s|\.$|\s7\.\d)', b) or [None, ''])[1]
    r_venc = (re.search(r'(?:Diretor|Diretora|Diretores)\s+com voto vencido:\s*(.*?)(?:\.\s|\.$)', b) or [None, ''])[1]
    r_ant = (re.search(r'votou em [\d/]+:\s*(.*?)(?:\.\s|\.$)', b) or [None, ''])[1]
    r_imp = (re.search(r'impedimento:\s*(.*?)(?:\.\s|\.$)', b) or [None, ''])[1]
    disp = (re.search(r'ACORDAM.*?\bem\s*:?\s*(?:5\.1\.\s*)?(\S+(?:\s\S+){0,3})', b) or [None, ''])[1]
    verbo = norm(disp).split()[0] if disp else ''
    if verbo == 'nao' and len(norm(disp).split()) > 1: verbo = norm(disp).split()[1]
    r_ass = (re.search(r'VISTOS, relatados e discutidos (.*?)\s*ACORDAM', b) or [None, ''])[1]
    r_ass = re.sub(r'^os presentes autos,?\s*(?:que\s+)?(?:tratam|trata|versam|relativos?|referentes?|concernentes?)?\s*(?:(?:a|de|d[aeo]s?|sobre|ao?s?)\s+)?', '', r_ass).strip(' ,;.')
    ok = {}
    ok['processo'] = r_proc == d['processo']
    ok['relator'] = nomes(r_rel) == nomes(d['relator'] or '') and len(nomes(r_rel)) == 1
    # interessado: texto do parser deve estar contido no bruto e ter o mesmo tamanho (+-10%)
    ok['interessado'] = flat(d['interessado']) == flat(r_int) or (norm(flat(d['interessado'])) in norm(b) and abs(len(flat(d['interessado'])) - len(flat(r_int))) <= max(5, 0.1 * len(r_int)))
    vts = [v for v in a['votos'] if (v['reuniao'], v['deliberacao']) == (d['reuniao'], d['deliberacao'])]
    pres_json = {v['diretor'] for v in vts if not v['voto'].startswith(('AUSENTE', 'VOTOU ANTES'))} - ({v['diretor'] for v in vts if v['voto'].startswith('IMPEDIDO')} if False else set())
    ok['presentes'] = nomes(r_pres) <= {v['diretor'] for v in vts} and {v['diretor'] for v in vts if v['voto'].startswith(('ACOMPANHOU', 'RELATOR', 'REVISOR', 'REDATOR', 'DIVERGIU', 'IMPEDIDO'))} <= nomes(r_pres) | nomes(r_imp) | nomes(r_ant)
    venc_json = {v['diretor'] for v in vts if v['voto'].startswith('DIVERGIU') or 'voto vencido' in v['voto']}
    lab = set(re.split(r'\s*;\s*', d['resultado'].split(' — ')[0]))
    rd = norm(flat((re.search(r'ACORDAM.*?\bem\s*:?\s*(.*?)\s6\.\s*Data da Reuni', b) or [None, ''])[1]))
    FAM = ((r'\bneg\w*(?:-lhe)? (?:o )?provimento', 'PROVIMENTO NEGADO'), (r'parcial provimento|provimento parcial', 'PROVIMENTO PARCIAL'), (r'\bd[aá]r?(?:-lhe)? (?:integral )?provimento|dar provimento', 'MÉRITO: PROVIMENTO'),
           (r'rejeit\w+ (?:os )?embargos', 'EMBARGOS REJEITADOS'), (r'\bnao conhec', 'NÃO CONHECIDO'), (r'arquivamento|arquivar', 'ARQUIVADO'), (r'\breferendar', 'REFERENDADO'), (r'inexistencia de obices', 'ÓBICES'),
           (r'\bindefer', 'INDEFERIDO'), (r'(?<!in)\bdefer|(?<!in)defer(?:ir|imos)', 'DEFERIDO'), (r'\breform', 'REFORMADA'), (r'^(?:\d\.\d\.\s*)?(?:conhecer|receber|admitir)|\d\.\d\.\s*(?:conhecer|receber|admitir)\b', 'CONHECIDO'))
    esperado = {rot for pat, rot in FAM if re.search(pat, rd)}
    res_lab = d['resultado'].split(' — ')[0]
    obtido = {rot for pat, rot in FAM if rot.split(': ')[-1] in res_lab or rot in res_lab}
    # 'DEFERIDO' esta dentro de 'INDEFERIDO': checa pelo termo com fronteira
    if 'DEFERIDO' in esperado and not re.search(r'(?<!IN)DEFERIDO', res_lab): obtido.discard('DEFERIDO')
    if 'DEFERIDO' in obtido and not re.search(r'(?<!IN)DEFERIDO', res_lab): obtido.discard('DEFERIDO')
    if 'PROVIMENTO NEGADO' in esperado: esperado.discard('MÉRITO: PROVIMENTO')
    if 'PROVIMENTO NEGADO' in obtido: obtido.discard('MÉRITO: PROVIMENTO')
    if 'PROVIMENTO PARCIAL' in esperado: esperado.discard('MÉRITO: PROVIMENTO')
    ok['resultado'] = (nomes(r_venc) == venc_json) and (('POR MAIORIA' in d['resultado']) == bool(r_venc)) and (('IMPEDIDO' in d['resultado'] or 'impedido:' in d['resultado']) == bool(r_imp)) and (esperado - {'CONHECIDO'} <= obtido) and (obtido - esperado <= {'CONHECIDO'} | ({'REFORMADA'} if 'REFORMADA' in obtido else set()))
    if not ok['resultado']: falhas.append((d['deliberacao'], 'resultado-detalhe', (sorted(esperado), sorted(obtido), res_lab)))
    r_ass = re.sub(r'^(?:de|d[aeo]s?)\s+', '', r_ass).rstrip('.')
    ok['assunto'] = norm(flat(d['assunto'])[:80].rstrip('.')) in norm(r_ass) and (len(flat(d['assunto'])) >= min(len(r_ass), 600) * 0.7)
    for c, v in ok.items():
        res[c].append(bool(v))
        if not v: falhas.append((d['deliberacao'], c, {'processo': (r_proc, d['processo']), 'relator': (r_rel, d['relator']), 'interessado': (r_int[:120], d['interessado'][:120]), 'presentes': (r_pres, sorted(pres_json)), 'resultado': (verbo, r_venc, r_imp, d['resultado']), 'assunto': (r_ass[:100], d['assunto'][:100])}[c]))
print(f'Amostra: {N} acórdãos (semente {seed}), reuniões: {dict(collections.Counter(d["reuniao"] for d in amostra))}')
for c, v in res.items(): print(f'{c:12s} {sum(v)}/{len(v)} = {100 * sum(v) / len(v):.1f}%')
tot = [x for v in res.values() for x in v]; print(f'GERAL {sum(tot)}/{len(tot)} = {100 * sum(tot) / len(tot):.1f}%')
for f in falhas: print('FALHA', f)
