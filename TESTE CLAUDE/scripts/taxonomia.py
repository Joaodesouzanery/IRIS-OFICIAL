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
