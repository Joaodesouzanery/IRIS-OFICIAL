#!/usr/bin/env python3
"""Taxonomia de temas (3 níveis) para as deliberações.

Nível 1  MODAL    : setor/modal regulado (Rodovias, Ferrovias, Hidroviário...).
Nível 2  TEMA     : natureza da matéria (tarifa, equilíbrio, contrato, recurso...).
Nível 3  SUBTEMA  : detalhe (reajuste anual, termo aditivo, CFEM-cobrança...).
Além disso, 'Microtema (IRIS)' e 'Área (IRIS)' vêm dos dicionários DO REPO (classifier.ts e
area-regulatoria.ts), lidos por este script — fonte única, nada copiado à mão.
"""
import re, json, unicodedata, os

def norm(s):
    return ''.join(c for c in unicodedata.normalize('NFD', (s or '').lower()) if unicodedata.category(c) != 'Mn')

def lig(s):
    """Chave insensível à perda de 'ti' por ligadura do PDF ('Adi vo' == 'aditivo') e a espaços."""
    return re.sub(r'ti', '', re.sub(r'[\s​]+', '', norm(s)))

# ------------------------------------------------------------------ dicionários do repo (TS -> dict)
REPO = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'lib', 'server')
def _dict_ts(path, nome):
    t = open(path, encoding='utf8').read()
    m = re.search(r'const\s+' + nome + r'[^=]*=\s*(\{.*?\n\};)', t, re.S)
    if not m: raise SystemExit(f'{nome} não encontrado em {path}')
    out = {}
    for k, body in re.findall(r'\n\s*([a-z_]+):\s*\[(.*?)\],?\s*(?=\n\s*[a-z_]+:\s*\[|\n\};)', m[1], re.S):
        out[k] = re.findall(r'"((?:[^"\\]|\\.)*)"', body)
    return out
def _area_ts(path):
    t = open(path, encoding='utf8').read()
    m = re.search(r'AREA_KEYWORDS[^=]*=\s*\[(.*?)\n\];', t, re.S)
    out = {}
    for k, body in re.findall(r'\["([a-z_]+)",\s*\[(.*?)\]\]', m[1], re.S): out[k] = re.findall(r'"((?:[^"\\]|\\.)*)"', body)
    return out
MICRO_GERAL = _dict_ts(os.path.join(REPO, 'classifier.ts'), 'MICROTEMA_KEYWORDS')
MICRO_ANM = _dict_ts(os.path.join(REPO, 'classifier.ts'), 'MICROTEMA_KEYWORDS_ANM')
AREA = _area_ts(os.path.join(REPO, 'area-regulatoria.ts'))

def _score(text, dicts):
    sc = {}
    for d in dicts:
        for tema, kws in d.items():
            s = 0
            for kw in kws:
                if norm(kw) in text or lig(kw) in lig_cache(text): s += max(1, len(kw.split()))
            if s: sc[tema] = sc.get(tema, 0) + s
    return sc
_lc = {}
def lig_cache(text):
    if text not in _lc: _lc[text] = lig(text)
    return _lc[text]
def microtema_iris(texto, agencia):
    t = norm(texto); dicts = [MICRO_ANM, MICRO_GERAL] if agencia == 'ANM' else [MICRO_GERAL, MICRO_ANM]
    sc = _score(t, dicts)
    return (max(sc, key=sc.get) if sc else 'outros')
def area_iris(texto):
    t = norm(texto); best, bs = 'outros', 0
    for area, kws in AREA.items():
        s = sum(max(1, len(norm(k).split())) for k in kws if norm(k) in t)
        if s > bs: best, bs = area, s
    return best

# ------------------------------------------------------------------ MODAL
# (modal, [regex sobre texto normalizado], peso)
MODAL = [
    ('Mineração', [r'\bcfem\b', r'alvara de pesquisa', r'\blavra\b', r'registro de licenca', r'guia de utilizacao', r'servidao minera', r'\btah\b', r'taxa anual por hectare', r'barragen', r'recursos minerais', r'mineracao', r'disponibilidade de area', r'\bplg\b', r'relatorio final de pesquisa'], 3),
    ('Ferrovias', [r'ferrovi', r'malha (central|paulista|norte|oeste|sul)', r'\brumo\b', r'\bfcmm\b', r'subconcessao ferroviaria', r'autorizacao ferroviaria', r'estrada de ferro', r'\bsufer\b', r'\bsufeg\b'], 3),
    ('Metroferroviário (trens e metrô)', [r'\bmetro\b', r'metroviari', r'\btrem\b', r'\btrens\b', r'\bcptm\b', r'trivia', r'metroferroviari', r'\bsumef\b', r'trem intercidades', r'\btic\b', r'trilhos', r'bilhetagem', r'bilhete unico', r'linha \d+ ?-? ?(rubi|esmeralda|safira|turquesa|coral|diamante|jade|lilas|prata)'], 3),
    ('Hidroviário e aquaviário', [r'hidrovia', r'navegacao interior', r'aquaviari', r'porto organizado', r'terminal portuario', r'autoridade portuaria', r'travessias? (litoranea|hidroviaria|de balsa)', r'acquavias', r'balsas?\b', r'hidroviari'], 3),
    ('Aeroportuário', [r'aeroporto', r'aerodromo', r'aviacao', r'infraero', r'\bsuhap\b', r'aeroportuari'], 3),
    ('Transporte rodoviário de passageiros', [r'passageiros', r'\bonibus\b', r'autorizacao especial', r'\bbrt\b', r'transporte coletivo', r'\bsucol\b', r'\bsupas\b', r'fretamento', r'\bemtu\b', r'transportes? rodoviari', r'\b(auto )?viacao [a-z ]{3,30}(ltda|s\.?a\b)', r'turismo ltda', r'expresso ', r'seccionamento', r'pedidos? de mercado', r'\bmercados?\b', r'linhas? (interestadua|intermunicipa|metropolitana)', r'\blinha\b.*\bseco', r'\bbus\+', r'\btar\b', r'mercado.*linha', r'enem'], 3),
    ('Cargas e logística', [r'transportador autonomo de cargas', r'\brntrc\b', r'vale-?pedagio', r'\bfrete\b', r'transporte rodoviario de cargas', r'\bsucar\b', r'\bcarga(s)?\b', r'\bipef\b', r'pagamento eletronico de frete'], 3),
    ('Rodovias (concessões e pedágio)', [r'\brodovias?\b', r'pedagio', r'\bbr-? ?\d{2,3}', r'\bsp-? ?\d{2,3}', r'\bsurod\b', r'rodoanel', r'praca de pedagio', r'\boae\b', r'obras de arte especiais', r'free flow', r'livre passagem', r'conservacao (especial|de rotina)', r'\bpista\b', r'viaduto', r'sistema rodoviario', r'contorno', r'concessionaria de rodovia', r'\bsuinf\b', r'infraestrutura rodoviaria', r'pesagem veicular', r'sistema de pesagem', r'\bcobranca de pedagio'], 2),
    ('Transporte rodoviário de passageiros', [r'\benem\b', r'gratuidade', r'ressarcimento'], 6),
    ('Governança regulatória e normas', [r'audiencia publica', r'consulta publica', r'tomada de subsidios', r'sandbox', r'ato normativo', r'sumula', r'agenda regulatoria', r'regimento interno', r'resolucao antt', r'minuta de resolucao', r'avaliacao de resultado regulatorio', r'protocolo de intencoes', r'cooperacao tecnica'], 2),
    ('Institucional e administrativo', [r'cargos? (em comissao|comissionados?)', r'pregao', r'registro de precos', r'plano de gestao anual', r'\bpga\b', r'demonstracoes contabeis', r'orcamento', r'estatuto', r'servidor', r'\bpessoal\b', r'auditoria interna', r'comissao processante', r'comissao (setorial|de)', r'bonificacao', r'sacola|caderno|caneta|squeeze', r'contratacao de servicos', r'filiacao', r'anuidade', r'portaria conjunta', r'ouvidoria', r'plano de contratacoes', r'\bsuadi\b', r'sustentabilidade, pessoas'], 2),
]
# pistas por unidade/superintendência (ARTESP 'unidade'; ANTT 'interessado' quando é superintendência)
UNIDADE_MODAL = {'surod': 'Rodovias (concessões e pedágio)', 'sucol': 'Transporte rodoviário de passageiros', 'supas': 'Transporte rodoviário de passageiros', 'sumef': 'Metroferroviário (trens e metrô)',
                 'suhap': 'Aeroportuário', 'sufer': 'Ferrovias', 'sufeg': 'Ferrovias', 'sucar': 'Cargas e logística', 'suadi': 'Institucional e administrativo', 'sustentabilidade': 'Institucional e administrativo'}

# ------------------------------------------------------------------ TEMA / SUBTEMA  (tema, subtema, [regex], peso)
TEMAS = [
    # --- mineração
    ('CFEM (compensação financeira)', 'Cobrança / notificação de débito', [r'cfem', r'compensacao financeira pela exploracao'], 3, r'cobranca|debito|nflcd|notificacao|lancamento|pagamento'),
    ('CFEM (compensação financeira)', 'Parcelamento / outros', [r'cfem'], 1, None),
    ('Pesquisa mineral', 'Alvará de pesquisa (nulidade / TAH)', [r'alvara de pesquisa', r'\btah\b', r'taxa anual por hectare', r'nulidade'], 3, None),
    ('Pesquisa mineral', 'Relatório final de pesquisa', [r'relatorio final de pesquisa', r'relatorio de pesquisa'], 4, None),
    ('Pesquisa mineral', 'Autorização / requerimento de pesquisa', [r'autorizacao de pesquisa', r'requerimento de pesquisa', r'indeferimento do requerimento de pesquisa', r'\bpesquisa\b'], 2, None),
    ('Lavra', 'Concessão / requerimento de lavra', [r'\blavra\b', r'concessao de lavra', r'requerimento de lavra'], 3, None),
    ('Lavra', 'Caducidade / suspensão de lavra', [r'caducidade', r'suspensao dos trabalhos'], 4, None),
    ('Licenciamento e registro de licença', 'Registro de licença / guia de utilização', [r'registro de licenca', r'guia de utilizacao', r'licenciamento'], 4, None),
    ('Servidão e áreas', 'Servidão minerária', [r'servidao'], 4, None),
    ('Servidão e áreas', 'Disponibilidade de área', [r'disponibilidade de area', r'disponibilidade'], 3, None),
    ('Barragens e segurança', 'Autos de infração (barragens)', [r'barragen'], 4, None),
    ('Fiscalização, infrações e sanções', 'Multa / auto de infração', [r'multa', r'auto de infracao', r'imposicao de multa'], 3, None),
    ('Título e cadastro minerário', 'Baixa / transcrição de título', [r'baixa na transcricao', r'titulo de plg', r'\bplg\b'], 4, None),
    # --- tarifa e equilíbrio
    ('Tarifa e pedágio', 'Reajuste anual', [r'reajuste (do|da|de) (pedagio|tarifa)', r'reajuste (anual|tarifario)', r'reajuste'], 3, None),
    ('Tarifa e pedágio', 'Revisão ordinária / extraordinária', [r'revisao (ordinaria|extraordinaria) (da|de) tarifa', r'revisao (ordinaria|extraordinaria)', r'tarifa basica de pedagio', r'tarifa de pedagio', r'tarifa de remuneracao'], 3, None),
    ('Tarifa e pedágio', 'Publicação / atualização de tarifas', [r'publicacao (das|de) tarifas', r'tarifas de pedagio', r'saldo tarifario'], 4, None),
    ('Equilíbrio econômico-financeiro', 'Reequilíbrio / pleitos', [r'reequilibrio', r'equilibrio economico', r'pleito', r'custos adicionais', r'imprevistos', r'desequilibrio'], 3, None),
    ('Desempenho e qualidade', 'Indicadores (IQD, CSP, ICPCR)', [r'\biqd\b', r'\bcsp\b', r'indicador', r'icpcr', r'nivel de servico', r'ficha relativa', r'apendice'], 3, None),
    ('Desempenho e qualidade', 'Desconto por atraso / inexecução', [r'desconto por atraso', r'inexecucao', r'etapas construtivas', r'postergacao', r'atraso'], 3, None),
    # --- contratos e obras
    ('Contratos de concessão', 'Termo aditivo / modificativo', [r'termo aditivo', r'termo de aditamento', r'aditivo e modificativo', r'\baditivo\b'], 4, None),
    ('Contratos de concessão', 'Anuência prévia (crédito, debêntures, controle)', [r'anuencia previa', r'debenture', r'operacao de credito', r'transferencia de controle', r'transferencia do controle'], 4, None),
    ('Contratos de concessão', 'Conta outorga / vinculada', [r'conta outorga', r'conta vinculada', r'conta centralizadora', r'saldo da conta'], 4, None),
    ('Contratos de concessão', 'Prorrogação / extinção / caducidade', [r'prorrogacao', r'extincao', r'rescisao', r'encampacao', r'caducidade do contrato'], 3, None),
    ('Contratos de concessão', 'Contrato de concessão (geral)', [r'contrato de (concessao|subconcessao)', r'contrato referente ao edital', r'edital de concessao'], 2, None),
    ('Obras e investimentos', 'Conservação / OAE / projeto executivo', [r'\boae\b', r'conservacao', r'projeto executivo', r'obras? de arte', r'duplicacao', r'implantacao de', r'construcao', r'investimento', r'rotatoria', r'\bviario\b', r'\bobras?\b', r'estudo de viabilidade', r'\bevtea\b'], 3, None),
    ('Obras e investimentos', 'Declaração técnica REIDI', [r'reidi', r'declaracao tecnica'], 4, None),
    # --- licitação, outorga
    ('Licitações e leilões', 'Edital / processo competitivo / leilão', [r'edital de processo competitivo', r'processo competitivo', r'leilao', r'homologacao do resultado', r'edital de participacao', r'edital complementar', r'chamamento', r'\bedital\b'], 3, None),
    ('Outorgas, autorizações e habilitações', 'Autorização / outorga ferroviária', [r'autorizacao ferroviaria', r'outorga', r'expedicao de outorga'], 4, None),
    ('Outorgas, autorizações e habilitações', 'Linhas e seções de passageiros', [r'autorizacao para operar', r'autorizar para operar', r'linha .{0,40}\bsecoes\b', r'autorizacao especial', r'operacao simultanea de linhas', r'mercado', r'seccionamento', r'\blinha\b'], 3, None),
    ('Outorgas, autorizações e habilitações', 'Habilitação / revogação (IPEF, FVPO, RNTRC)', [r'habilitacao', r'revogacao da empresa', r'\bipef\b', r'\bfvpo\b', r'rntrc'], 3, None),
    # --- fiscalização, recursos, normas
    ('Fiscalização, infrações e sanções', 'Auto de infração / multa', [r'auto de infracao', r'infracao', r'\bmulta\b', r'notificacao de infracao'], 3, None),
    ('Fiscalização, infrações e sanções', 'Processo sancionador / comissão processante', [r'sancionador', r'comissao processante', r'processo administrativo ordinario'], 4, None),
    ('Recursos administrativos', 'Recurso / reconsideração / embargos', [r'\brecurso', r'reconsideracao', r'embargos de declaracao', r'efeito suspensivo', r'voto vista', r'voto-vista'], 1, None),
    ('Regulação e normas', 'Audiência / consulta pública', [r'audiencia publica', r'consulta publica', r'tomada de subsidios'], 4, None),
    ('Regulação e normas', 'Resolução / súmula / ato normativo', [r'resolucao', r'sumula', r'ato normativo', r'regimento interno', r'minuta de (resolucao|portaria)'], 3, None),
    ('Regulação e normas', 'Sandbox regulatório', [r'sandbox'], 4, None),
    ('Regulação e normas', 'Acordos e cooperação', [r'acordo de cooperacao', r'cooperacao tecnica', r'convenio', r'protocolo de intencoes', r'memorando de entendimento', r'instrucao tecnica', r'portaria'], 4, None),
    ('Gestão institucional e administrativa', 'Pessoal, estrutura e orçamento', [r'avaliacao de desempenho', r'concurso interno', r'processo seletivo', r'bonificacao', r'politica de protecao de dados', r'corregedoria', r'integridade'], 4, None),
    # --- institucional, usuários
    ('Gestão institucional e administrativa', 'Contratação interna / licitação da agência', [r'pregao', r'registro de precos', r'contratacao de servicos', r'locacao', r'impressao', r'sacola', r'aquisicao', r'termo de aditamento ao contrato n'], 3, None),
    ('Gestão institucional e administrativa', 'Pessoal, estrutura e orçamento', [r'cargos? (em comissao|comissionados?)', r'pessoal', r'estrutura organizacional', r'plano de gestao', r'orcamento', r'demonstracoes contabeis', r'estatuto', r'auditoria'], 3, None),
    ('Usuários e atendimento', 'Ressarcimento / gratuidade / atendimento', [r'ressarcimento', r'gratuidade', r'\benem\b', r'usuarios?\b', r'atendimento ao usuario', r'central de atendimento', r'\bsau\b'], 3, None),
    ('Segurança e meio ambiente', 'Segurança viária / incêndios / ambiental', [r'seguranca viaria', r'incendio', r'licenciamento ambiental', r'meio ambiente', r'passivo ambiental', r'desapropriacao', r'faixa de dominio'], 3, None),
]

TIPO_ATO = [
    ('Recurso / reconsideração', r'\brecurso|reconsideracao|embargos'),
    ('Termo aditivo', r'termo aditivo|termo de aditamento|\baditivo\b'),
    ('Edital / leilão / processo competitivo', r'edital|leilao|processo competitivo|homologacao'),
    ('Audiência / consulta pública', r'audiencia publica|consulta publica'),
    ('Auto de infração / sanção', r'auto de infracao|infracao|sancionador|multa'),
    ('Autorização / outorga / habilitação', r'autorizacao|autorizar|outorga|habilitacao|anuencia'),
    ('Reajuste / revisão / reequilíbrio', r'reajuste|revisao|reequilibrio|pleito'),
    ('Resolução / norma', r'resolucao|ato normativo|sumula|regimento'),
    ('Contratação interna', r'pregao|contratacao|registro de precos'),
    ('Aprovação de ata', r'^ata aprovada|aprovacao da ata'),
]

def lig_pat(p):
    """Versão do padrão para texto 'achatado' (sem espaços e sem 'ti'); None se o padrão for complexo."""
    q = p.replace('\\b', '')
    if re.search(r'[()|?.*+\[\]{}\\^$]', q) or len(q) < 7 or 'ti' not in q: return None   # só quando a ligadura (perda de 'ti') pode ter ocorrido
    return re.sub(r'ti|\s', '', q)
def casa(p, t, campo_bruto):
    if re.search(p, t): return True
    lp = lig_pat(p)
    return bool(lp and lp in lig(campo_bruto))

def pontuar_modal(campos, agencia):
    """campos: dict(assunto, interessado, unidade, texto). Retorna (modal, score, termos)."""
    if agencia == 'ANM': return 'Mineração', 99, ['agência ANM']
    sc = {}; termos = {}
    pesos = {'assunto': 3, 'interessado': 2, 'unidade': 3, 'texto': 1}
    for campo, peso in pesos.items():
        t = norm(campos.get(campo, ''))
        if not t: continue
        for modal, pats, w in MODAL:
            for p in pats:
                if casa(p, t, campos.get(campo, '')):
                    sc[modal] = sc.get(modal, 0) + w * peso; termos.setdefault(modal, []).append(p.strip('\\b'))
    un = norm(campos.get('unidade', '') + ' ' + campos.get('interessado', ''))
    for sig, modal in UNIDADE_MODAL.items():
        if re.search(r'\b' + sig, un): sc[modal] = sc.get(modal, 0) + 6; termos.setdefault(modal, []).append('unidade:' + sig)
    if not sc: return 'Outros / não identificado', 0, []
    # modais "genéricos" só vencem se nenhum modal de setor pontuar >= metade
    setor = {m: v for m, v in sc.items() if m not in ('Governança regulatória e normas', 'Institucional e administrativo')}
    pool = setor if setor and max(setor.values()) * 2 >= max(sc.values()) else sc
    best = max(pool, key=pool.get)
    return best, pool[best], termos.get(best, [])[:4]

def pontuar_tema(campos, agencia):
    sc = {}; termos = {}
    pesos = {'assunto': 3, 'interessado': 1, 'texto': 1}
    for tema, sub, pats, w, _ in TEMAS:
        if agencia != 'ANM' and tema in ('CFEM (compensação financeira)', 'Pesquisa mineral', 'Lavra', 'Licenciamento e registro de licença', 'Servidão e áreas', 'Barragens e segurança', 'Título e cadastro minerário'): continue
        if agencia == 'ANM' and tema in ('Tarifa e pedágio', 'Contratos de concessão', 'Obras e investimentos', 'Licitações e leilões'): continue
        for campo, peso in pesos.items():
            t = norm(campos.get(campo, ''))
            if not t: continue
            for p in pats:
                if casa(p, t, campos.get(campo, '')):
                    k = (tema, sub); sc[k] = sc.get(k, 0) + w * peso; termos.setdefault(k, []).append(p)
    if not sc: return ('Outros', 'Não classificado'), 0, 0.0, []
    ordenado = sorted(sc.items(), key=lambda kv: -kv[1]); (best, s1) = ordenado[0]; s2 = ordenado[1][1] if len(ordenado) > 1 else 0
    conf = round(min(1.0, (s1 / (s1 + s2 + 1)) * min(1.0, s1 / 6)), 2)
    return best, s1, conf, termos[best][:4]

def tipo_ato(campos):
    t = norm(campos.get('assunto', '')); t2 = t or norm(campos.get('texto', ''))
    for nome, pat in TIPO_ATO:
        if re.search(pat, t2): return nome
    return 'Outros'


# ------------------------------------------------------------------ SETORES (agencias nao-transporte): modal fixo + temas proprios
# regra: (tema, subtema, [regex sobre assunto+unidade normalizados], peso). 'unidade' = "secao|grupo" (ANVISA) ou natureza (ANPD).
SETOR = {
    'ANVISA': {'modal': 'Saúde e vigilância sanitária', 'temas': [
        ('Pessoal e missões', 'Afastamento do país / capacitação', [r'afastamento do pais', r'capacitacao'], 8),
        ('Pessoal e missões', 'Cargo em comissão / promoção / cessão', [r'cargo em comissao', r'cargos? comissionad', r'promocao de servidores', r'cessao de servidor', r'exoneracao', r'nomeacao'], 8),
        ('Autorizações excepcionais', 'Importação em caráter excepcional', [r'importacao em carater excepcional', r'importacao excepcional'], 8),
        ('Autorizações excepcionais', 'Excepcionalidade / esgotamento de estoque', [r'solicitacao de excepcionalidade', r'esgotamento de estoque', r'excepcionalidade'], 8),
        ('Fiscalização sanitária', 'Cronograma de inspeção', [r'cronograma de inspecao'], 8),
        ('Acesso à informação (LAI)', 'Recurso LAI (2ª instância)', [r'recurso lai', r'acesso a informacao', r'fala\.?br'], 8),
        ('Governança e gestão', 'Planejamento estratégico e gestão', [r'planejamento estrategico', r'plano estrategico', r'relatorio de gestao', r'calendario das reunioes', r'data da reuniao', r'alteracao de portaria'], 8),
        ('Autorizações excepcionais', 'Termo de guarda / exportação excepcional', [r'termo de guarda', r'autorizacao de exportacao', r'liberacao termo'], 8),
        ('Recursos administrativos', 'Prorrogação de prazo / revisão de ato', [r'prorrogacao de prazo', r'revisao de ato', r'retorno de vista'], 7),
        ('Governança e gestão', 'Aprovação de ata', [r'^ata da'], 8),
        ('Governança e gestão', 'Acordos, memorandos e apoio institucional', [r'memorando de entendimento', r'apoio institucional', r'acordo de cooperacao', r'plano anual', r'paint', r'plano diretor', r'planos? de gerenciamento', r'regimento interno', r'projeto de lei', r'decreto legislativo'], 7),
        ('Regulação e normas', 'Abertura de processo regulatório / agenda', [r'abertura de processo administrativo de regulacao', r'agenda regulatoria'], 4),
        ('Regulação e normas', 'Resolução (RDC) / instrução normativa', [r'resolucao da diretoria colegiada', r'\brdc\b', r'instrucao normativa', r'\bin n'], 3),
        ('Regulação e normas', 'Consulta pública / audiência', [r'consulta publica', r'audiencia publica'], 4),
        ('Regulação e normas', 'Norma (geral)', [r'^2\|'], 2),
        ('Recursos administrativos', 'Fiscalização e inspeção sanitária (GGFIS)', [r'^3\|ggfis', r'ggfis'], 4),
        ('Recursos administrativos', 'Portos, aeroportos e fronteiras (GGPAF)', [r'ggpaf'], 4),
        ('Recursos administrativos', 'Medicamentos (GGMED)', [r'ggmed'], 4),
        ('Recursos administrativos', 'Alimentos (GGALI)', [r'ggali'], 4),
        ('Recursos administrativos', 'Produtos fumígenos (GGTAB)', [r'ggtab'], 4),
        ('Recursos administrativos', 'Cosméticos e saneantes (GGCOS)', [r'ggcos'], 4),
        ('Recursos administrativos', 'Tecnologia de produtos para saúde (GGTPS)', [r'ggtps'], 4),
        ('Recursos administrativos', 'Produtos biológicos / toxicologia (GGBIO, GGTOX)', [r'ggbio', r'ggtox'], 4),
        ('Recursos administrativos', 'Servidor / pessoal (SIAPE, GGPES)', [r'ggpes', r'siape'], 4),
        ('Recursos administrativos', 'Gestão (GGGAF)', [r'gggaf'], 4),
        ('Recursos administrativos', 'Recurso (geral)', [r'^3\|', r'recurso administrativo'], 2),
        ('Efeito suspensivo', 'Julgamento de efeito suspensivo', [r'^4\|', r'efeito suspensivo'], 9),
        ('Efeito suspensivo', 'Pedido de revisão', [r'^5\|', r'pedido de revisao'], 9),
        ('Governança e gestão', 'Recomendações e orientações', [r'^[67]\|', r'recomenda'], 2),
    ]},
    'ANPD': {'modal': 'Proteção de dados pessoais', 'temas': [
        ('Acesso à informação (LAI)', 'Recurso em 2ª instância', [r'lei de acesso', r'\blai\b', r'fala\.?br', r'recurso em 2'], 5),
        ('Cooperação e acordos', 'Acordo / ACT / memorando', [r'acordo de cooperacao', r'\bact\b', r'memorando de entendimento', r'convenio', r'protocolo de intencoes', r'cooperacao', r'arranjo administrativo'], 4),
        ('Regulamentação', 'Resolução / regulamento / portaria', [r'minuta de (resolucao|portaria|regulamento)', r'regulamento', r'resolucao cd', r'portaria anpd', r'revisao da resolucao', r'\bnorma', r'diretrizes', r'politica nacional', r'\bguia\b'], 4),
        ('Regulamentação', 'Consulta / tomada de subsídios', [r'consulta publica', r'tomada de subsidios', r'audiencia publica'], 5),
        ('Fiscalização e sanções', 'Processo sancionador / fiscalização', [r'sancionador', r'fiscaliza', r'infracao', r'sancao', r'multa'], 4),
        ('Transferência internacional e adequação', 'Decisão de adequação / cláusulas', [r'adequacao', r'transferencia internacional', r'clausulas', r'uniao europeia', r'reciprocidade'], 5),
        ('Proteção de crianças e adolescentes', 'ECA Digital', [r'eca digital', r'crianca', r'adolescente'], 5),
        ('Gestão institucional e administrativa', 'Estrutura / agenda / planejamento', [r'agenda regulatoria', r'planejamento estrategico', r'regimento interno', r'estrutura', r'orcamento', r'servidor', r'organizacao e funcionamento', r'administrativa', r'premio', r'concurso', r'lei n.{0,3}9\.986', r'substituicao'], 3),
    ]},
}
def pontuar_setor(campos, agencia):
    cfg = SETOR[agencia]; t = norm(campos.get('assunto', '')); u = norm(campos.get('unidade', '')); tx = t + ' ' + norm(campos.get('texto', ''))[:300]
    sc = {}; termos = {}
    for tema, sub, pats, w in cfg['temas']:
        for p in pats:
            alvo = u if p.startswith('^') else (u + ' ' + t if re.search(r'gg[a-z]{3}|siape', p) else tx)
            if re.search(p, alvo):
                k = (tema, sub); sc[k] = sc.get(k, 0) + w + (3 if re.search(r'gg[a-z]{3}|siape', p) else 0); termos.setdefault(k, []).append(p)
    if not sc: return ('Outros', 'Não classificado'), 0, 0.0, []
    o = sorted(sc.items(), key=lambda kv: -kv[1]); (best, s1) = o[0]; s2 = o[1][1] if len(o) > 1 else 0
    return best, s1, round(min(1.0, (s1 / (s1 + s2 + 1)) * min(1.0, s1 / 4)), 2), termos[best][:4]

SETOR['ANP'] = {'modal': 'Petróleo, gás e biocombustíveis', 'temas': [
    ('Regulação e normas', 'Ação regulatória / agenda / resolução', [r'acao regulatoria', r'agenda regulatoria', r'resolucao anp', r'revisao d[aeo]', r'edicao de nova resolucao', r'consulta publica', r'audiencia publica', r'\bair\b', r'analise de impacto'], 6),
    ('Recursos administrativos', 'Recurso / reconsideração', [r'recurso administrativo', r'recurso', r'reconsideracao', r'embargos'], 5),
    ('Fiscalização e sanções', 'Auto de infração / multa / processo administrativo', [r'auto de infracao', r'multa', r'sancionador', r'infracao', r'processo administrativo'], 6),
    ('Exploração e produção', 'Contratos, blocos e campos', [r'bloco', r'campo de', r'contrato de concessao', r'partilha', r'plano de desenvolvimento', r'rodada', r'unitizacao', r'exploracao e producao', r'\bpd\b', r'cessao de direitos'], 6),
    ('Combustíveis e biocombustíveis', 'Biometano, CGOB e subvenção', [r'biometano', r'cgob', r'garantia de origem', r'subvencao', r'medida provisoria', r'hidrogenio', r'certificado'], 7),
    ('Combustíveis e biocombustíveis', 'Abastecimento, preços e concorrência', [r'abusividade', r'precos', r'defesa da concorrencia', r'anticoncorrenc', r'fiscalizacao do abastecimento', r'\bsfi\b', r'\bsdl\b', r'\bspc\b', r'\bsbq\b'], 6),
    ('Participações governamentais', 'Conciliação / cumprimento de sentença', [r'conciliacao', r'cumprimento de sentenca', r'\bspg\b'], 7),
    ('Exploração e produção', 'Obrigações e programas exploratórios', [r'exoneracao da obrigacao', r'programa exploratorio minimo', r'\bsep\b', r'decisao de diretoria'], 6),
    ('Gestão institucional e administrativa', 'Governança e delegações', [r'delegacoes de competencia', r'governanca', r'\bsge\b'], 6),
    ('Combustíveis e biocombustíveis', 'Autorização, qualidade e mercado', [r'combustive', r'biocombustive', r'etanol', r'biodiesel', r'distribuidor', r'revendedor', r'gasolina', r'diesel', r'glp', r'cbio', r'renovabio', r'qualidade'], 5),
    ('Gás natural', 'Transporte, tarifas e infraestrutura', [r'gas natural', r'gasoduto', r'transporte de gas', r'tarifa', r'terminal de gnl', r'\bgnl\b', r'armazenagem'], 6),
    ('Abastecimento e logística', 'Infraestrutura e autorizações de instalações', [r'armazenamento', r'refin', r'dutovia', r'terminal', r'autorizacao de operacao', r'servicos de armazenagem'], 5),
    ('Participações governamentais', 'Royalties / participação especial', [r'royalt', r'participacao especial', r'participacoes governamentais', r'pagamento'], 6),
    ('Gestão institucional e administrativa', 'Estrutura, pessoal e orçamento', [r'sessao administrativa', r'orcamento', r'estrutura', r'pessoal', r'servidor', r'regimento interno', r'calendario', r'cooperacao', r'convenio', r'acordo'], 4),
]}
SETOR['ANTAQ'] = {'modal': 'Portos, hidrovias e navegação', 'temas': [
    ('Denúncias e medidas cautelares', 'Sobre-estadia / cobranças indevidas (usuários)', [r'sobre-?estadia', r'cobranca', r'armazenagem', r'denuncia', r'medida cautelar', r'cautelar', r'cobranca abusiva'], 8),
    ('Controle societário e anuências', 'Transferência de controle / anuência prévia', [r'transferencia (indireta )?(de|do) controle', r'controle societario', r'anuencia previa', r'aprovacao previa', r'ato de concentracao'], 8),
    ('Fiscalização e sanções', 'Termo de ajustamento de conduta (TAC) e cumprimento de determinações', [r'termo de compromisso de ajustamento', r'termo de ajustamento', r'\btac\b', r'cumprimento (do|da|das|dos)', r'determinacoes impostas', r'acao fiscalizadora', r'monitoramento'], 8),
    ('Autorizações e outorgas', 'Registro de instalação de apoio / empresas', [r'registro de instalacao', r'instalacao de apoio', r'apoio ao transporte aquaviario', r'requerimento (formulado|apresentado)', r'habilitacao'], 7),
    ('Regulação e normas', 'Análise de impacto regulatório / alteração de resolução', [r'impacto regulatorio', r'carga administrativa', r'alteracao da resolucao', r'resolucao antaq'], 8),
    ('Regulação e normas', 'Norma / resolução / audiência pública', [r'resolucao normativa', r'norma', r'audiencia publica', r'consulta publica', r'regulamento', r'agenda regulatoria', r'\bair\b'], 6),
    ('Recursos administrativos', 'Recurso / reconsideração', [r'recurso', r'reconsideracao', r'embargos', r'pedido de revisao'], 5),
    ('Fiscalização e sanções', 'Auto de infração / multa / sanção', [r'auto de infracao', r'multa', r'infracao', r'sancionador', r'penalidade', r'processo administrativo sancionador'], 6),
    ('Autorizações e outorgas', 'Autorização de instalação portuária e empresas', [r'autorizacao', r'terminal de uso privado', r'\btup\b', r'estacao de transbordo', r'\betc\b', r'instalacao portuaria', r'empresa brasileira de navegacao', r'\bebn\b', r'outorga', r'afretamento'], 6),
    ('Concessões e arrendamentos portuários', 'Contratos, reequilíbrio e licitação', [r'arrendamento', r'concessao', r'contrato de arrendamento', r'leilao', r'reequilibrio', r'termo aditivo', r'licitacao', r'porto organizado', r'autoridade portuaria'], 6),
    ('Tarifas e preços', 'Tarifa portuária e fretes', [r'tarifa', r'preco', r'taxa', r'frete'], 5),
    ('Navegação e hidrovias', 'Navegação interior, cabotagem e longo curso', [r'navegacao', r'cabotagem', r'hidrovia', r'longo curso', r'balsa', r'travessia', r'embarcacao'], 5),
    ('Gestão institucional e administrativa', 'Estrutura, pessoal, orçamento e reuniões', [r'orcamento', r'pessoal', r'servidor', r'regimento interno', r'calendario', r'deliberacao do diretor-geral', r'ad referendum', r'acordo de cooperacao', r'plano de gestao'], 4),
]}

SETOR['ANATEL'] = {'modal': 'Telecomunicações', 'temas': [
    ('Fiscalização e sanções', 'PADO / multa / sanção', [r'pado', r'multa', r'sancao', r'infracao', r'descumprimento', r'obrigacao', r'pacer', r'fiscaliza'], 7),
    ('Espectro e radiofrequências', 'Radiofrequência / satélite / espectro', [r'radiofrequencia', r'espectro', r'satelite', r'faixa de', r'\bmhz\b', r'\bghz\b', r'\b5g\b'], 7),
    ('Outorgas e autorizações', 'Autorização / outorga / anuência prévia', [r'outorga', r'autorizacao', r'anuencia', r'transferencia de controle', r'\bscm\b', r'\bstfc\b', r'cessao', r'prestadora'], 6),
    ('Regulação e normas', 'Regulamento / consulta pública / agenda', [r'regulamento', r'consulta publica', r'agenda regulatoria', r'resolucao', r'norma', r'tomada de subsidios'], 6),
    ('Recursos administrativos', 'Recurso / reconsideração', [r'recurso', r'reconsideracao', r'reexame', r'embargos'], 6),
    ('Qualidade e consumidor', 'Qualidade, universalização e consumidor', [r'qualidade', r'consumidor', r'universaliza', r'cobertura', r'compromisso'], 5),
    ('Numeração e infraestrutura', 'Numeração / interconexão / compartilhamento', [r'numeracao', r'interconexao', r'compartilhamento', r'infraestrutura', r'homologacao'], 5),
    ('Gestão institucional e administrativa', 'Estrutura, pessoal, orçamento e reuniões', [r'orcamento', r'pessoal', r'servidor', r'regimento interno', r'calendario', r'cooperacao', r'convenio'], 4),
]}

SETOR['ANEEL'] = {'modal': 'Energia elétrica', 'temas': [
    ('Fiscalização e sanções', 'Auto de infração / multa / penalidade', [r'auto de infracao', r'multa', r'penalidade', r'sancao', r'infracao', r'fiscaliza'], 7),
    ('Tarifas e reajustes', 'Reajuste / revisão tarifária e bandeiras', [r'reajuste tarifario', r'revisao tarifaria', r'tarifa', r'bandeira', r'\btusd?\b', r'receita anual'], 7),
    ('Geração e outorgas', 'Usinas, outorga e leilões', [r'usina', r'outorga', r'geracao', r'central geradora', r'leilao', r'eolic', r'fotovoltaic', r'hidreletric', r'autorizacao'], 6),
    ('Transmissão e distribuição', 'Concessões, contratos e expansão da rede', [r'transmissao', r'distribuicao', r'distribuidora', r'concessao', r'contrato de concessao', r'subestacao', r'linha de transmissao', r'rede basica'], 6),
    ('Regulação e normas', 'Resolução normativa / consulta pública', [r'resolucao normativa', r'consulta publica', r'audiencia publica', r'regulamento', r'norma', r'agenda regulatoria', r'procedimento'], 6),
    ('Recursos administrativos', 'Recurso / reconsideração', [r'recurso', r'reconsideracao', r'pedido de reexame', r'embargos'], 6),
    ('Qualidade e consumidor', 'Qualidade do serviço e direitos do consumidor', [r'qualidade', r'consumidor', r'dec\b', r'fec\b', r'compensacao'], 5),
    ('Gestão institucional e administrativa', 'Estrutura, pessoal, orçamento e reuniões', [r'orcamento', r'pessoal', r'servidor', r'regimento interno', r'calendario', r'cooperacao', r'convenio'], 4),
]}

SETOR['ANA'] = {'modal': 'Recursos hídricos e saneamento', 'temas': [
    ('Outorgas e autorizações', 'Outorga / reserva de disponibilidade hídrica', [r'outorga', r'reserva de disponibilidade', r'direito de uso', r'dominio da uniao', r'captacao'], 8),
    ('Saneamento básico', 'Normas de referência e regulação do saneamento', [r'saneamento', r'norma de referencia', r'abastecimento de agua', r'esgot', r'residuos solidos', r'drenagem'], 8),
    ('Fiscalização e sanções', 'Auto de infração / multa', [r'auto de infracao', r'multa', r'infracao', r'penalidade', r'fiscaliza'], 7),
    ('Segurança de barragens', 'Barragens e reservatórios', [r'barragem', r'reservatorio', r'seguranca de barragens', r'operacao de reservatorio', r'sala de situacao'], 7),
    ('Regulação e normas', 'Resolução / consulta pública / agenda regulatória', [r'resolucao', r'consulta publica', r'audiencia publica', r'agenda regulatoria', r'norma', r'regulamento'], 6),
    ('Recursos administrativos', 'Recurso / reconsideração', [r'recurso', r'reconsideracao', r'embargos'], 6),
    ('Cobrança e arrecadação', 'Cobrança pelo uso de recursos hídricos', [r'cobranca', r'arrecadacao', r'tarifa', r'prestacao de contas'], 6),
    ('Gestão institucional e administrativa', 'Estrutura, pessoal, orçamento e reuniões', [r'orcamento', r'pessoal', r'servidor', r'regimento interno', r'calendario', r'cooperacao', r'convenio', r'acordo de cooperacao'], 4),
]}
