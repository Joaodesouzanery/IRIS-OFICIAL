import os
HERE=os.path.dirname(os.path.abspath(__file__))
OUTDIR=os.path.dirname(HERE)
"""Catálogo de fontes + sinais + mapa condição→sinal + monitor 12×10. Gera fontes-monitoramento.json."""
import json, re
from model import load, AG
DATA='2026-10-09'
ENC=f'encontrada em busca ({DATA})'; INF='inferida do caminho de arquivo encontrado'; PROV='padrão provável (não verificado)'; DESC='a descobrir'
# ---------- fontes nacionais/transversais
NAC=[
 dict(id='N01',nome='Diário Oficial da União (DOU)',entidade='Imprensa Nacional',url='https://www.in.gov.br',formato='HTML + XML diário (INLABS)',periodicidade='diária',status='padrão conhecido (não aberto nesta sessão)',cobre='AGE,AIR,ARR,EST,PRO',uso='Publicação de portarias/resoluções que aprovam agenda, manual de AIR/ARR e consolidações; contagem de normas por agência/ano; aderência norma×agenda.',risco='Baixo (XML oficial); busca por título exige normalização'),
 dict(id='N02',nome='Planalto — legislação federal',entidade='Presidência da República',url='http://www.planalto.gov.br/ccivil_03/_ato2019-2022/2019/lei/l13848.htm',formato='HTML',periodicidade='sob demanda',status=ENC,cobre='base legal',uso='Texto da Lei 13.848/2019 (art. 15 relatório anual, art. 17 plano estratégico, arts. 18–20 PGA, art. 21 agenda); Decreto 10.411/2020; Decreto 12.002/2024.',risco='Baixo'),
 dict(id='N03',nome='Brasil Participativo (plataforma federal)',entidade='Presidência da República',url='https://brasilparticipativo.presidencia.gov.br',formato='HTML (páginas por processo)',periodicidade='contínua',status=ENC,cobre='PS,AGE,ARR',uso='Consultas/tomadas de subsídio de ANVISA, ANEEL, ANM, ANP, ANPD e outras; datas e status por processo.',risco='Médio (a plataforma mudou de nome; ver N04)'),
 dict(id='N04',nome='Participa + Brasil (plataforma anterior)',entidade='Presidência da República',url='https://www.gov.br/participamaisbrasil',formato='HTML',periodicidade='histórico',status=ENC,cobre='PS,AGE,ARR',uso='Histórico de consultas 2022–2025 (ANM, ANTT, ANCINE, ANAC…). Páginas por agência.',risco='Médio (migração para Brasil Participativo)'),
 dict(id='N05',nome='Portal Brasileiro de Dados Abertos',entidade='CGU/MGI',url='https://dados.gov.br',formato='CSV/JSON (CKAN)',periodicidade='variável por conjunto',status=ENC,cobre='AGE,PS',uso='Conjuntos como "Regulamentação — Agenda Regulatória" (ANAC) e "Audiências e Consultas Públicas" (ANEEL, atualização trimestral). Fonte mais estável para automação.',risco='Baixo'),
 dict(id='N06',nome='Portal de Governança Regulatória (MDIC)',entidade='MDIC',url='https://portalreg.mdic.gov.br',formato='HTML + PDF',periodicidade='sob demanda',status=ENC,cobre='AIR,ARR,EST,PRO',uso='Relatórios de benchmarking de governança de agências (FGV, mar/2026) e de ARR; referência externa para validar critérios e comparar agências.',risco='Médio (conteúdo em PDF)'),
 dict(id='N07',nome='MDIC — Agenda regulatória das agências',entidade='MDIC',url='https://www.gov.br/mdic/pt-br/acesso-a-informacao/reg/agenda-regulatoria/agencias-reguladoras',formato='HTML',periodicidade='sob demanda',status=ENC,cobre='AGE',uso='Índice cruzado de agendas das agências (segunda fonte para detectar agenda vigente).',risco='Baixo'),
 dict(id='N08',nome='Ministério da Fazenda/SRE — manifestações em consultas públicas de órgãos reguladores',entidade='MF/SRE',url='https://www.gov.br/fazenda/pt-br/composicao/orgaos/secretaria-de-reformas-economicas/manifestacoes-em-consultas-publicas-de-orgaos-reguladores',formato='HTML + PDF (pareceres)',periodicidade='contínua',status=ENC,cobre='PS,AIR',uso='Revisor externo: parecer sobre propostas das agências (ex.: ANTT 2026). Indício de AIR/competição avaliada por terceiro.',risco='Baixo'),
 dict(id='N09',nome='CGU — e-Aud (relatórios de avaliação)',entidade='CGU',url='https://eaud.cgu.gov.br/relatorios',formato='PDF',periodicidade='anual',status=ENC,cobre='PRO,PS,AIR',uso='Auditorias de governança regulatória por agência (ex.: ANATEL, ANM).',risco='Médio (PDF, publicação irregular)'),
 dict(id='N10',nome='TCU — acórdãos e e-Contas',entidade='TCU',url='https://pesquisa.apps.tcu.gov.br',formato='HTML/PDF',periodicidade='contínua',status='padrão conhecido (não aberto nesta sessão)',cobre='AIR,PRO,CAP',uso='Recomendações de governança regulatória e relatórios de gestão das agências (prestação de contas).',risco='Médio'),
 dict(id='N11',nome='Casa Civil — conteúdo de regulação (guias de AIR/ARR)',entidade='Casa Civil',url='https://www.gov.br/casacivil/pt-br/conteudo-de-regulacao/regulacao',formato='HTML + PDF',periodicidade='sob demanda',status=ENC,cobre='AIR,ARR',uso='Guia orientativo federal de AIR/ARR — régua de conteúdo mínimo para avaliar qualidade de relatórios.',risco='Baixo'),
 dict(id='N12',nome='Fala.BR / e-SIC (Lei de Acesso à Informação)',entidade='CGU',url='https://falabr.cgu.gov.br',formato='Pedido formal',periodicidade='sob demanda',status='padrão conhecido (não aberto nesta sessão)',cobre='CAP,PRO',uso='ÚNICO caminho para dado interno (% de servidores capacitados em AIR/ARR; indicadores internos do processo normativo). Resposta fica pública quando a agência a publica.',risco='Alto (depende de resposta da agência; prazo legal de 20+10 dias)'),
 dict(id='N13',nome='Internet Archive — Wayback Machine',entidade='Internet Archive',url='https://web.archive.org',formato='HTML (snapshots) + API CDX',periodicidade='histórico',status='padrão conhecido (não aberto nesta sessão)',cobre='todos',uso='Reconstituir o estado das páginas das agências em 2019–2025 (baseline para o Prêmio Evolução) e provar o que estava publicado numa data.',risco='Médio (nem toda página foi arquivada)'),
 dict(id='N14',nome='SEI — pesquisa pública de processos (por agência)',entidade='cada agência',url='https://sei.antaq.gov.br/sei/modulos/pesquisa/md_pesq_documento_consulta_externa.php',formato='HTML (consulta externa)',periodicidade='contínua',status=ENC+' (exemplo ANTAQ)',cobre='PRO,AIR',uso='Datas de abertura/encerramento do processo normativo (tempo de tramitação) e relatórios de AIR com nº SEI. Cada agência tem seu domínio.',risco='Alto (CAPTCHA/ritmo; cada SEI é distinto)'),
 dict(id='N15',nome='ENAP — Escola Virtual (cursos de AIR/ARR)',entidade='ENAP',url='https://suap.enap.gov.br/vitrine/curso/1600/',formato='HTML',periodicidade='sob demanda',status=ENC,cobre='CAP',uso='Apenas confirma que a capacitação existe no ecossistema federal; NÃO informa quantos servidores de cada agência a fizeram.',risco='Baixo (mas não resolve a condição)'),
 dict(id='N16',nome='Painel Estatístico de Pessoal (agregado por órgão)',entidade='MGI',url='https://www.gov.br/gestao/pt-br',formato='painel',periodicidade='mensal',status='padrão conhecido (não aberto nesta sessão)',cobre='CAP (contexto)',uso='Apenas contexto de porte (nº de servidores por carreira). Só dados agregados — nunca nominais (LGPD).',risco='Médio'),
]
# ---------- sinais observáveis
SIG=[
 ('S01','Página de agenda regulatória com ciclo vigente','A','HTTP 200 na página da agenda + texto "Agenda Regulatória" + biênio/quadriênio que cobre o ano corrente','portal da agência; N07','mensal'),
 ('S02','Ato de aprovação da agenda publicado no DOU','A','busca no DOU por título "Agenda Regulatória" + agência + ano','N01','diária'),
 ('S03','Participação social na elaboração da agenda (tomada de subsídios/consulta)','A','processo com "Agenda Regulatória" no título na plataforma de participação','N03,N04, plataforma própria','mensal'),
 ('S04','Relatório/painel de execução da agenda (% de cumprimento)','B','PDF/painel periódico; extrai "nível de execução", "ICAR" ou "% concluído"','portal da agência','trimestral'),
 ('S05','Aderência: normas do DOU ligadas a itens da agenda','B','cruza títulos de normas do DOU com itens da agenda vigente','N01 + agenda','semestral'),
 ('S06','Plano Estratégico e PGA publicados e alinhados à agenda','B','páginas "Plano de Gestão Anual"/"Planejamento estratégico" + citação da agenda','portal; Lei 13.848 arts. 17–21','anual'),
 ('S07','Índice/acervo de relatórios de AIR publicado','A','página de AIR com lista de relatórios; conta PDFs por ano','portal da agência','mensal'),
 ('S08','Relatórios de AIR novos no ano','A','diferença de PDFs de AIR entre coletas','portal da agência','mensal'),
 ('S09','Manual/ato interno que institui a AIR','A','ato na legislação da agência/DOU com "Análise de Impacto Regulatório" no título','portal; N01','trimestral'),
 ('S10','Dispensa de AIR justificada e publicada','A','nota técnica/tabela de dispensas no portal','portal da agência','trimestral'),
 ('S11','Índice próprio de qualidade das AIR (ex.: IQR Anatel, IQAIR ANA)','B','relatório/painel de qualidade; extrai nota média','portal da agência','anual'),
 ('S12','Relatório de AIR anexado à consulta pública','B','anexos da consulta contêm "Relatório de AIR"','plataformas de participação','mensal'),
 ('S13','Agenda de ARR publicada','A','página/ato de agenda de ARR','portal; N01','trimestral'),
 ('S14','Relatórios de ARR publicados','A','lista de relatórios de ARR; conta PDFs','portal da agência','trimestral'),
 ('S15','Manual/ato interno que institui a ARR','A','ato com "Resultado Regulatório" no título','portal; N01','trimestral'),
 ('S16','Participação social na agenda de ARR','A','tomada de subsídios com "Agenda de ARR"','N03,N04, plataforma própria','trimestral'),
 ('S17','Execução da agenda de ARR monitorada/divulgada','B','relatório de acompanhamento da agenda (inclui ARR)','portal da agência','semestral'),
 ('S18','Lista de consultas/audiências (status e datas)','A','plataforma própria, Brasil Participativo ou dataset aberto','N03,N05, plataforma própria','semanal'),
 ('S19','Relatório/nota de análise das contribuições publicado','B','por consulta encerrada, procura relatório de contribuições; razão com/sem','plataformas de participação','mensal'),
 ('S20','Prazo da consulta vs mínimo normativo (45 dias p/ normas)','A','datas de abertura/encerramento → dias; compara com norma interna','plataformas de participação','mensal'),
 ('S21','Ato interno de participação social','A','resolução/portaria sobre consultas e audiências','portal; N01','anual'),
 ('S22','Relatórios de ouvidoria/consumidor.gov.br usados em decisões','C','citação em votos/notas técnicas; exige leitura humana','relatório anual de ouvidoria; votos','anual'),
 ('S23','Efetividade da participação mensurada (ex.: RAPS Anvisa)','B','relatório de análise de participação social','portal da agência','anual'),
 ('S24','Consolidação normativa por tema','A','atos "consolidam" no DOU/legislação da agência','N01; legislação da agência','trimestral'),
 ('S25','Levantamento/painel quantitativo do estoque','B','painel com normas publicadas/vigentes/revogadas','portal da agência','trimestral'),
 ('S26','Normas classificadas/indexadas por tema','B','sistema de legislação com filtro temático','sistema de legislação da agência','trimestral'),
 ('S27','Revisão/revogação em lote do estoque','A','resoluções de revogação (ex.: "guilhotina") no DOU','N01','mensal'),
 ('S28','Fardo regulatório estimado em AIR de alto impacto','C','leitura do relatório de AIR (custos de conformidade)','relatórios de AIR','anual'),
 ('S29','Manual/regimento do processo normativo','A','manual/regimento publicado no portal','portal da agência','semestral'),
 ('S30','Indicadores do processo normativo monitorados (ex.: ICPN ANEEL)','B','relatório/painel de indicadores','portal da agência','anual'),
 ('S31','Instâncias de aprovação formalizadas','A','regimento interno/competências publicadas','portal; N01','semestral'),
 ('S32','Plano de capacitação (PDP) menciona AIR/ARR','B','PDF do plano de desenvolvimento de pessoas/PGA','portal; N10','anual'),
 ('S33','% de servidores capacitados em AIR/ARR','C','dado interno — pedido via LAI (N12)','N12','anual'),
 ('S34','Evidência de melhoria contínua (revisão do próprio processo)','C','relatórios de revisão do processo; leitura humana','portal; N09; N10','anual'),
]
SIGD={s[0]:dict(id=s[0],nome=s[1],automacao=s[2],metodo=s[3],fontes=s[4],frequencia=s[5]) for s in SIG}
# ---------- condição → sinal(is)
def sinais_da_condicao(crit,txt):
    t=txt.lower(); out=[]
    def has(p): return re.search(p,t) is not None
    if crit=='AIR_CAP': return ['S33'] + (['S32'] if has('plano') else [])
    if crit=='ARR_CAP': return ['S33'] + (['S32'] if has('plano') else [])
    if crit=='AIR_MET':
        if has('particip'): out+=['S12','S09']
        elif has('critérios objetivos'): out+=['S09']
        else: out+=['S09']
    elif crit=='AIR_PRO':
        if has('qualidade|melhoria'): out+=['S11']
        elif has('particip'): out+=['S12']
        elif has('dispensa'): out+=['S10']
        elif has('publicad|acessíve'): out+=['S07','S08']
        elif has('mapead'): out+=['S29']
        else: out+=['S07','S08']
    elif crit=='PS':
        if has('manual|dispositivo|ato normativo|metodologia'): out+=['S21']
        elif has('ouvidoria|consumidor'): out+=['S22']
        elif has('divulgad|portal'): out+=['S19']
        elif has('efetividade'): out+=['S23']
        else: out+=['S18','S20']
    elif crit=='EST':
        if has('agenda'): out+=['S01','S24']
        elif has('consolida'): out+=['S24']
        elif has('indexa|classifica'): out+=['S26']
        elif has('levantamento'): out+=['S25']
        elif has('fardo'): out+=['S28']
        else: out+=['S24','S25']
    elif crit=='AGE':
        if has('ampla participação|participação social'): out+=['S03']
        elif has('estratégico|plano de gestão|ministério'): out+=['S06']
        elif has('cumprimento'): out+=['S04']
        elif has('monitorad|divulgad'): out+=['S04']
        elif has('temas|elencados|aderência'): out+=['S01','S02']
        else: out+=['S01','S02']
    elif crit=='PRO':
        if has('indicador|melhoria'): out+=['S30','S34']
        elif has('instância'): out+=['S31']
        elif has('particip'): out+=['S29']
        else: out+=['S29']
    elif crit=='ARR_MET':
        if has('integrada'): out+=['S13']
        elif has('particip'): out+=['S16']
        elif has('manual|ato normativo'): out+=['S15']
        else: out+=['S13']
    elif crit=='ARR_PRO':
        if has('monitorad|melhoria'): out+=['S17']
        elif has('particip'): out+=['S14','S16']
        elif has('agenda'): out+=['S13']
        else: out+=['S14']
    return out
# ---------- monitor por agência (URLs encontradas em busca de 2026-10-09)
G='https://www.gov.br/'
M={
'ANATEL':{'AGE':[(G+'anatel/pt-br/regulado/agenda-regulatoria/2025-2026',ENC)],
 'AIR':[(G+'anatel/pt-br/assuntos/noticias/anatel-divulga-metodologia-para-avaliar-a-qualidade-regulatoria',ENC),('https://informacoes.anatel.gov.br/legislacao/component/content/article/149-resolucoes-internas/1511-resolucao-interna-8',ENC)],
 'ARR':[(G+'anatel/pt-br/assuntos/noticias/anatel-publica-relatorio-de-avaliacao-de-resultado-regulatorio',ENC)],
 'PS':[(G+'anatel/pt-br/acesso-a-informacao/participacao-social/consultas-publicas',ENC),('https://apps.anatel.gov.br/ParticipaAnatel/Home.aspx',ENC)],
 'EST':[(G+'anatel/pt-br/regulado/agenda-regulatoria/revisao-e-consolidacao-de-atos-normativos',ENC),(G+'anatel/pt-br/regulado/agenda-regulatoria/simplificacao-regulatoria',ENC),('https://informacoes.anatel.gov.br/legislacao',ENC)],
 'PRO':[('https://informacoes.anatel.gov.br/legislacao/component/content/article/149-resolucoes-internas/1511-resolucao-interna-8',ENC)],
 'plataforma_ps':'Participa Anatel (própria)','metrica_propria':'IQR — Índice de Qualidade Regulatória das AIR (piloto: 18 relatórios, média 72,5%)','painel':'Painel de normas (publicadas/revogadas/vigentes)'},
'ANVISA':{'AGE':[(G+'anvisa/pt-br/assuntos/regulamentacao/agenda-regulatoria/agenda-2024-2025/construcao-da-agenda-2024-2025',ENC),(G+'anvisa/pt-br/assuntos/regulamentacao/agenda-regulatoria/anteriores',ENC)],
 'AIR':[(G+'anvisa/pt-br/assuntos/regulamentacao/air/saiba-mais',ENC)],
 'ARR':[(G+'anvisa/pt-br/assuntos/regulamentacao/avaliacao-do-resultado-regulatorio/saiba-mais',ENC)],
 'PS':[(G+'anvisa/pt-br/acessoainformacao/participacaosocial',ENC),('https://brasilparticipativo.presidencia.gov.br/processes/Participa-anvisa',ENC)],
 'EST':[('https://anvisalegis.datalegis.net',PROV)],
 'PRO':[(DESC,DESC)],
 'plataforma_ps':'Brasil Participativo + páginas próprias','metrica_propria':'Informe de resultados e monitoramento trimestral da agenda; RAPS (relatório de análise de participação social)','painel':'Painel diário de acompanhamento da agenda'},
'ANEEL':{'AGE':[(G+'aneel/pt-br/assuntos/governanca-regulatoria/agenda-regulatoria/2025-2026',ENC)],
 'AIR':[(G+'aneel/pt-br/assuntos/instrumentos-regulatorios/analise-de-impacto-regulatorio/air',ENC),('https://www.aneel.gov.br/impacto-regulatorio',ENC)],
 'ARR':[(G+'aneel/pt-br/assuntos/governanca-regulatoria/avaliacao-de-resultado-regulatorio-arr',ENC)],
 'PS':[(G+'aneel/pt-br/acesso-a-informacao/participacao-social',ENC),(G+'aneel/pt-br/acesso-a-informacao/participacao-social/consultas-publicas',ENC),('https://dadosabertos.aneel.gov.br/dataset/audiencias-e-consultas-publicas',ENC)],
 'EST':[(G+'aneel/pt-br/assuntos/noticias/2024/consolidacao-do-estoque-regulatorio-da-aneel-entra-em-discussao',ENC),('https://biblioteca.aneel.gov.br/index.html',ENC)],
 'PRO':[('https://www2.aneel.gov.br/cedoc/ren2021941.html',ENC)],
 'plataforma_ps':'Própria + dataset aberto (CSV, trimestral)','metrica_propria':'ICPN — Índice de Conformidade do Processo Normativo','painel':'—'},
'ANTT':{'AGE':[(G+'antt/pt-br/acesso-a-informacao/acoes-e-programas/agenda-regulatoria',ENC),(G+'antt/pt-br/assuntos/ultimas-noticias/painel-de-acompanhamento-da-agenda-regulatoria-antt-2025-2026-ja-esta-disponivel',ENC)],
 'AIR':[(G+'antt/pt-br/acesso-a-informacao/acoes-e-programas/agenda-regulatoria/air',ENC)],
 'ARR':[(G+'antt/pt-br/acesso-a-informacao/acoes-e-programas/agenda-regulatoria/arr',ENC)],
 'PS':[(G+'antt/pt-br/acesso-a-informacao/participacao-social/consulta-publica',ENC),(G+'antt/pt-br/acesso-a-informacao/participacao-social/audiencia-publica',ENC),(G+'participamaisbrasil/agencia-nacional-de-transportes-terrestres',ENC)],
 'EST':[(G+'antt/pt-br/acesso-a-informacao/acoes-e-programas/governanca/gestao-do-estoque-regulatorio',ENC),('https://anttlegis.antt.gov.br',ENC)],
 'PRO':[(G+'antt/pt-br/acesso-a-informacao/acoes-e-programas/agenda-regulatoria/documentos-orientativos-da-agenda-regulatoria/MANUALDEPROCEDIMENTOSDAAGENDAREGULATRIAaprovado1.pdf',ENC)],
 'plataforma_ps':'ParticipANTT (própria) + Participa + Brasil','metrica_propria':'ICAR — Índice de Cumprimento da Agenda Regulatória (painel público)','painel':'Painel da Agenda 2025-2026; painel de AIR (pós-Decreto 10.411)'},
'ANAC':{'AGE':[(G+'anac/pt-br/acesso-a-informacao/participacao-social/agenda-regulatoria/agenda-regulatoria-2025-2026',ENC),('https://dados.gov.br/dataset/regulamentacao-agenda-regulatoria',ENC)],
 'AIR':[(G+'anac/pt-br/acesso-a-informacao/participacao-social/governanca-regulatoria/analise-de-impacto-regulatorio-2013-air',ENC)],
 'ARR':[(G+'anac/pt-br/acesso-a-informacao/participacao-social/governanca-regulatoria',ENC)],
 'PS':[(G+'anac/pt-br/acesso-a-informacao/participacao-social/consultas-publicas',ENC),(G+'participamaisbrasil/dir-anac',ENC)],
 'EST':[(G+'anac/pt-br/acesso-a-informacao/participacao-social/governanca-regulatoria/gestao-do-estoque-regulatorio',ENC)],
 'PRO':[('https://www.anac.gov.br/assuntos/legislacao/legislacao-1/instrucoes-normativas/2020/instrucao-normativa-no-154-20-03-2020',ENC)],
 'plataforma_ps':'Própria (consultas CP nn/AAAA com anexo de AIR)','metrica_propria':'—','painel':'Painel Interativo do Estoque Regulatório'},
'ANTAQ':{'AGE':[(G+'antaq/pt-br/acesso-a-informacao/acoes-e-programas/governanca-regulatoria/agenda-regulatoria-ar/14.BoletimAR20252028fevereiro26.pdf',ENC)],
 'AIR':[('https://juris.antaq.gov.br/index.php/tag/analise-de-impacto-regulatorio-air/',ENC),(G+'antaq/pt-br/acesso-a-informacao/acoes-e-programas/governanca-regulatoria/analise-de-impacto-regulatorio-air-3',INF)],
 'ARR':[('https://juris.antaq.gov.br/index.php/tag/avaliacao-de-resultado-regulatorio-arr/',ENC),(G+'antaq/pt-br/acesso-a-informacao/acoes-e-programas/governanca-regulatoria/PlanoAnualdeGovernanaRegulatria2026191125_documento.pdf',ENC)],
 'PS':[(G+'antaq/pt-br/acesso-a-informacao/participacao-social/audiencias-e-consultas-publicas',ENC)],
 'EST':[('https://juris.antaq.gov.br',ENC)],
 'PRO':[(G+'antaq/pt-br/acesso-a-informacao/acoes-e-programas/governanca-regulatoria/PlanoAnualdeGovernanaRegulatria2026191125_documento.pdf',ENC)],
 'plataforma_ps':'Própria (audiências/consultas por número/ano)','metrica_propria':'Boletim mensal da agenda; Plano Anual de Governança Regulatória','painel':'Painel de AIR e ARR (atualização mensal prevista)'},
'ANP':{'AGE':[(G+'anp/pt-br/acesso-a-informacao/agenda-regulatoria',ENC),(G+'anp/pt-br/acesso-a-informacao/ar/ar-2025-2026-rev-set.pdf',ENC)],
 'AIR':[(G+'anp/pt-br/assuntos/analise-de-impacto-regulatorio-air',ENC)],
 'ARR':[(G+'anp/pt-br/acesso-a-informacao/acoes-e-programas/agenda-de-avaliacao-de-resultado-regulatorio',ENC)],
 'PS':[(G+'anp/pt-br/assuntos/consultas-e-audiencias-publicas',INF),('https://brasilparticipativo.presidencia.gov.br/processes/ANP-13-2026',ENC)],
 'EST':[(DESC,DESC)],
 'PRO':[(G+'anp/pt-br/acesso-a-informacao/arq/manual-boas-praticas-regulatorias.pdf',ENC),(G+'anp/pt-br/acesso-a-informacao/acoes-e-programas/plano-de-gestao-anual',ENC)],
 'plataforma_ps':'Brasil Participativo + página própria','metrica_propria':'Painel dinâmico da agenda (via SEI)','painel':'Painel Dinâmico da Agenda Regulatória'},
'ANA':{'AGE':[(G+'ana/pt-br/assuntos/governanca-regulatoria/agenda-regulatoria',ENC)],
 'AIR':[(G+'ana/pt-br/assuntos/governanca-regulatoria/analise-de-impacto-regulatorio-air/air-realizadas',ENC),(G+'ana/pt-br/assuntos/governanca-regulatoria/analise-de-impacto-regulatorio-air/iqair/relatorio-resultados-2020-2024-final.pdf',ENC)],
 'ARR':[(G+'ana/pt-br/assuntos/governanca-regulatoria/avaliacao-de-resultado-regulatorio',ENC),(G+'ana/pt-br/assuntos/governanca-regulatoria/monitoramento-e-avaliacao-de-resultado-regulatorio',ENC)],
 'PS':[('https://participacao-social.ana.gov.br',ENC)],
 'EST':[(G+'ana/pt-br/legislacao/resolucoes/resolucoes-regulatorias',ENC)],
 'PRO':[(G+'ana/pt-br/assuntos/governanca-regulatoria/programa-de-qualidade-regulatoria',ENC)],
 'plataforma_ps':'Sistema de Participação Social nas Decisões da ANA (próprio)','metrica_propria':'IQAIR — Indicador de Qualidade das AIR (média 89 em 2023, escala 0–100)','painel':'Painel de monitoramento da agenda'},
'ANS':{'AGE':[(G+'ans/pt-br/acesso-a-informacao/participacao-da-sociedade/agenda-regulatoria',ENC)],
 'AIR':[(G+'ans/pt-br/acesso-a-informacao/transparencia-e-prestacao-de-contas/governanca-regulatoria/copy_of_analise-de-impacto-regulatorio-air',ENC)],
 'ARR':[(G+'ans/pt-br/acesso-a-informacao/transparencia-e-prestacao-de-contas/agenda-de-avaliacao-de-resultado-regulatorio-arr',ENC)],
 'PS':[(G+'ans/pt-br/consultas-publicas-em-andamento',ENC),('https://www.ans.gov.br/participacao-da-sociedade/consultas-e-participacoes-publicas',ENC)],
 'EST':[('https://bvsms.saude.gov.br/bvs/saudelegis/ans',PROV)],
 'PRO':[('https://bvsms.saude.gov.br/bvs/saudelegis/ans/2021/res0071_17_06_2021.html',ENC),(G+'ans/pt-br/acesso-a-informacao/transparencia-e-prestacao-de-contas/plano-de-gestao-anual',ENC)],
 'plataforma_ps':'Própria (formulário no portal)','metrica_propria':'—','painel':'—'},
'ANM':{'AGE':[(G+'anm/pt-br/acesso-a-informacao/acoes-e-programas/governanca-regulatoria/governanca-regulatoria',ENC),(G+'participamaisbrasil/agenda-regulatoria-anm',ENC)],
 'AIR':[(G+'anm/pt-br/acesso-a-informacao/acoes-e-programas/governanca-regulatoria/analise-de-impacto-regulatorio-air/relatorios-air',ENC)],
 'ARR':[(G+'anm/pt-br/acesso-a-informacao/acoes-e-programas/governanca-regulatoria/avaliacao-de-resultado-regulatorio-arr',ENC),(G+'anm/pt-br/acesso-a-informacao/acoes-e-programas/governanca-regulatoria/agenda-regulatoria/agenda-e-relatorios-de-arr/agenda-arr_2023-a-2026',ENC)],
 'PS':[(G+'anm/pt-br/acesso-a-informacao/participacao-social/audiencias-publicas',INF),(G+'anm/pt-br/acesso-a-informacao/participacao-social/consultas-publicas',INF),(G+'participamaisbrasil/agencia-nacional-de-mineracao',ENC)],
 'EST':[(DESC,DESC)],
 'PRO':[(G+'anm/pt-br/assuntos/noticias/anm-lanca-manual-e-cartilha-sobre-processos-de-participacao-e-controle-social',ENC),(G+'anm/pt-br/assuntos/noticias/anm-ganha-selo-de-boas-praticas-regulatorias',ENC)],
 'plataforma_ps':'Brasil Participativo','metrica_propria':'Selo de Boas Práticas Regulatórias (critérios: AIR, participação social, custos)','painel':'Painel de projetos da agenda'},
'ANCINE':{'AGE':[(G+'ancine/pt-br/assuntos/atribuicoes-ancine/regulacao/agenda-regulatoria',ENC)],
 'AIR':[(G+'ancine/pt-br/assuntos/atribuicoes-ancine/regulacao/analise-de-impacto-regulatorio-e-avaliacao-de-resultado-regulatorio',ENC)],
 'ARR':[(G+'ancine/pt-br/assuntos/atribuicoes-ancine/regulacao/agenda-de-arr',ENC)],
 'PS':[(G+'ancine/pt-br/acesso-a-informacao/participacao-social-novo/consultas-publicas-da-ancine',ENC),(G+'ancine/pt-br/acesso-a-informacao/participacao-social/consulta-publica/encerradas',ENC)],
 'EST':[(DESC,DESC)],
 'PRO':[(G+'ancine/pt-br/acesso-a-informacao/institucional/competencias/plano-de-gestao-anual',ENC)],
 'plataforma_ps':'Participa + Brasil / Brasil Participativo','metrica_propria':'Relatório de cumprimento da agenda (por biênio)','painel':'—'},
'ANPD':{'AGE':[(G+'anpd/pt-br/assuntos/regulacao/agenda-regulatoria-1',ENC)],
 'AIR':[(G+'anpd/pt-br/assuntos/regulacao/analise-de-impacto-regulatorio-1',INF)],
 'ARR':[(G+'anpd/pt-br/assuntos/noticias/anpd-abre-ts-agenda-regulatoria-e-avaliacao-de-resultado-regulatorio',ENC)],
 'PS':[(G+'anpd/pt-br/assuntos/regulacao/consultas_a_sociedade',ENC),(G+'anpd/pt-br/acesso-a-informacao/participacao-social',ENC)],
 'EST':[(DESC,DESC)],
 'PRO':[(DESC,DESC)],
 'plataforma_ps':'Brasil Participativo (antes Participa + Brasil)','metrica_propria':'Balanço semestral da agenda','painel':'—'},
}
CRIT_KEY={'AIR_CAP':'CAP','AIR_MET':'AIR','AIR_PRO':'AIR','PS':'PS','EST':'EST','AGE':'AGE','PRO':'PRO','ARR_CAP':'CAP','ARR_MET':'ARR','ARR_PRO':'ARR'}
BUSCA={'CAP':'plano de desenvolvimento de pessoas capacitação regulação','AIR':'análise de impacto regulatório relatórios','ARR':'avaliação de resultado regulatório agenda','PS':'consultas públicas audiências participação social','EST':'estoque regulatório consolidação normativa','AGE':'agenda regulatória','PRO':'processo normativo manual regimento'}
def build():
    dims,crits,conds=load()
    mapa=[]
    for c in conds:
        ss=sinais_da_condicao(c['crit'],c['texto'])
        gr=[SIGD[s]['automacao'] for s in ss]
        grau='C' if 'C' in gr and 'A' not in gr and 'B' not in gr else ('A' if gr and all(g=='A' for g in gr) else ('B' if 'B' in gr or ('A' in gr and 'C' in gr) else 'A'))
        # a pior das automatizáveis: se qualquer sinal é C e é o único, C; se mistura, B
        mapa.append(dict(condicao=c['id'],critério=c['crit'],nivel=c['nivel'],ordem=c['ordem'],celula_planilha=c['celula'],texto=c['texto'],sinais=ss,grau=grau))
    monitor=[]
    for sigla,*_ in AG:
        d=M[sigla]
        for cr in crits:
            k=CRIT_KEY[cr['codigo']]
            if k=='CAP':
                urls=[dict(url=DESC,status='dado interno — via LAI (N12); PGA/relatório de gestão podem citar o plano',tipo='interno')]
            else:
                urls=[dict(url=u,status=s,tipo='externo') for u,s in d.get(k,[(DESC,DESC)])]
            monitor.append(dict(agencia=sigla,criterio=cr['codigo'],chave=k,fontes=urls,busca=BUSCA[k],plataforma_ps=d['plataforma_ps'] if k=='PS' else '',metrica_propria=d['metrica_propria'] if k in('AIR','AGE') else '',painel=d['painel'] if k in('AGE','EST','AIR') else ''))
    return dict(gerado_em=DATA,aviso='Nenhuma URL foi aberta por navegador; "encontrada em busca" = retornada por mecanismo de busca em '+DATA+'. Nenhuma nota é atribuída por este arquivo.',nacionais=NAC,sinais=list(SIGD.values()),mapa=mapa,monitor=monitor,agencias=[dict(sigla=s,nome=n,lei=l,**{k:v for k,v in M[s].items() if k in('plataforma_ps','metrica_propria','painel')}) for s,n,st,l,sl in AG])
if __name__=='__main__':
    r=build(); json.dump(r,open(os.path.join(OUTDIR,'fontes-monitoramento.json'),'w'),ensure_ascii=False,indent=1)
    from collections import Counter
    print(len(r['mapa']),len(r['monitor']),Counter(m['grau'] for m in r['mapa']))
    print(Counter((x['status'][:12]) for m in r['monitor'] for x in m['fontes']))
    for cr in crits_ if False else []: pass
    import collections
    byc=collections.defaultdict(Counter)
    for m in r['mapa']: byc[m['critério']][m['grau']]+=1
    for k,v in byc.items(): print(k,dict(v))
