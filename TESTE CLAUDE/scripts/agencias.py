"""Registro único das agências com pipeline próprio (além de ANM/ANTT/ARTESP, que têm tratamento histórico no build).
Para incluir uma agência nova: acrescentar uma linha aqui (+ SETOR em taxonomia.py + scripts/<sg>_rodar.sh no rodar_tudo.sh).
Campos: json = arquivo gerado pelo parser; url = página-fonte que aparece em 'Faltam na fonte'; desc = texto do LEIA-ME;
ex_fora_total = votos de quem não está na presença da reunião (ex-conselheiro/ex-diretor) ficam na aba Votos mas fora dos totais."""
import json, os
AGENCIAS = [
 {'sg': 'ANPD', 'json': 'anpd.json', 'desc': 'atas dos circuitos deliberativos', 'ex_fora_total': False,
  'url': 'https://www.gov.br/anpd/pt-br/assuntos/deliberacoes-do-conselho-diretor/circuito-deliberativo'},
 {'sg': 'ANVISA', 'json': 'anvisa_final.json', 'desc': 'atas das ROP/REP da Diretoria Colegiada', 'ex_fora_total': False,
  'url': 'https://www.gov.br/anvisa/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria/atas/2026',
  'url_extra': {'ANVISA|CD': 'https://www.gov.br/anvisa/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria/extratos-dos-circuitos-deliberativos-1/2026'}},
 {'sg': 'ANP', 'json': 'anp.json', 'desc': 'atas da Diretoria Colegiada', 'ex_fora_total': False,
  'url': 'https://www.gov.br/anp/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/pautas-atas-e-calendario-de-reunioes-da-diretoria-colegiada/2026'},
 {'sg': 'ANTAQ', 'json': 'antaq.json', 'desc': 'atas das reuniões deliberativas', 'ex_fora_total': False,
  'url': 'https://www.gov.br/antaq/pt-br/acesso-a-informacao/institucional/reunioes-deliberativas/atas-e-pautas-das-reunioes'},
 {'sg': 'ANATEL', 'json': 'anatel.json', 'desc': 'atas, acórdãos e circuitos do Conselho Diretor (SEI)', 'ex_fora_total': True,
  'url': 'https://sei.anatel.gov.br/sei/publicacoes/controlador_publicacoes.php?acao=publicacao_pesquisar&id_orgao_publicacao=0&id_unidade_responsavel=110000842&id_serie=8'},
 {'sg': 'ANEEL', 'json': 'aneel.json', 'desc': 'texto de decisão das reuniões públicas (Dados Abertos)', 'ex_fora_total': True,
  'diverge_ok': ('divergência de data', 'buraco', 'truncad', 'sem pedinte'),
  'url': 'https://www.gov.br/aneel/pt-br/acesso-a-informacao/participacao-social/reunioes-publicas'},
 {'sg': 'ANA', 'json': 'ana.json', 'desc': 'atas da Diretoria Colegiada (PDFs em arquivos.ana.gov.br)', 'ex_fora_total': False, 'diverge_ok': ('NÃO baixado', 'bloqueado pela fonte'),
  'url': 'https://www.gov.br/ana/pt-br/acesso-a-informacao/institucional/diretoria-colegiada/reunioes-deliberativas'},
 {'sg': 'ANS', 'json': 'ans.json', 'desc': 'pautas, extratos e páginas de deliberações da DICOL (atas restritas)', 'ex_fora_total': False,
  'diverge_ok': ('restrit', 'bloqueado', 'fora da allowlist', 'sem documento'),
  'url': 'https://www.gov.br/ans/pt-br/acesso-a-informacao/transparencia-e-prestacao-de-contas/reunioes-da-diretoria-da-ans'},
]
# Novas (ANS, ANA, ...) entram aqui quando o json existir; arquivo ausente = agência ignorada (degrada sem quebrar)
def ativas(): return [a for a in AGENCIAS if os.path.exists(a['json'])]
def carregar(): return {a['sg']: json.load(open(a['json'])) for a in ativas()}
def urls(): 
    u = {}
    for a in AGENCIAS: u[a['sg']] = a['url']; u.update(a.get('url_extra', {}))
    return u
def ex_fora_total(): return {a['sg'] for a in AGENCIAS if a['ex_fora_total']}
