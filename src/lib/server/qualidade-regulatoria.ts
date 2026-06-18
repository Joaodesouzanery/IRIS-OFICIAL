export type QualidadeNivel = "avancado" | "em_desenvolvimento" | "inicial";
export type QualidadeStatusRevisao = "preliminar" | "pendente" | "em_revisao" | "validado" | "rejeitado";

export interface QualidadeAgencia {
  sigla: string;
  nome_completo: string;
  setor_regulado: string;
  ano_criacao: number;
  lei_criacao: string;
  site_oficial: string;
  portal_transparencia: string;
  portal_dados_abertos: string;
  portal_consultas_publicas: string;
  portal_ouvidoria: string;
  email_contato: string | null;
  ativo: boolean;
}

export interface QualidadeCriterio {
  id: number;
  nome: string;
  descricao: string;
  peso: number;
  nivel_prioridade: "alta" | "media" | "baixa";
  fontes_coleta: string[];
  metodo_coleta: "api" | "scraping" | "manual" | "misto";
  url_documentacao: string | null;
  obrigatorio_por_lei: boolean;
  base_legal: string | null;
}

export interface QualidadeNota {
  agencia_sigla: string;
  criterio_id: number;
  nota: number;
  nivel: QualidadeNivel;
  observacao: string;
  evidencias: string[];
  data_avaliacao: string;
  fonte_avaliacao: string;
  status_revisao: QualidadeStatusRevisao;
}

export interface QualidadeDiagnostico {
  agencia_sigla: string;
  notas: QualidadeNota[];
  score_geral: number;
  posicao_ranking: number | null;
  destaques_positivos: string[];
  areas_melhoria: string[];
  ultima_atualizacao: string;
  status_revisao: QualidadeStatusRevisao;
}

export interface QualidadeFonte {
  id: string;
  nome: string;
  url: string;
  api_url: string | null;
  requer_chave: boolean;
  metodo_coleta: "api" | "scraping" | "manual" | "misto";
  criterios_relacionados: number[];
  formato: string;
  atualizacao: string;
}

export interface QualidadeCategoriaPremio {
  id: string;
  nome: string;
  descricao: string;
  criterios_avaliados: number[];
  tipo: "geral" | "tematico" | "evolucao";
}

export interface QualidadeEvidencia {
  agencia_sigla: string;
  criterio_id: number;
  titulo: string;
  url: string;
  fonte: string;
  trecho_publico: string;
  data_referencia: string;
  status_revisao: "pendente" | "validada" | "rejeitada";
}

export const QUALIDADE_LEGAL_REFERENCES = [
  {
    label: "LGPD - Lei 13.709/2018",
    url: "https://www.planalto.gov.br/ccivil_03/_Ato2015-2018/2018/Lei/L13709compilado.htm",
  },
  {
    label: "LAI - Lei 12.527/2011",
    url: "https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2011/lei/l12527.htm",
  },
  {
    label: "Lei das Agências Reguladoras - Lei 13.848/2019",
    url: "https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2019/lei/L13848.htm",
  },
  {
    label: "Lei 15.352/2026 - ANPD como agência reguladora",
    url: "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/lei/l15352.htm",
  },
  {
    label: "Guia ANPD para tratamento de dados pessoais pelo Poder Público",
    url: "https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-poder-publico-anpd-versao-final.pdf/view",
  },
];

export const QUALIDADE_GUARDRAILS = [
  "Coletar somente dados necessários, oficiais, públicos e relacionados ao desempenho institucional.",
  "Não armazenar CPF, telefone pessoal, e-mail pessoal, endereço, remuneração individualizada ou dados sensíveis.",
  "Avaliar instituições, não pessoas físicas: diretores entram apenas como cargo, mandato e ato oficial quando necessário.",
  "Marcar toda evidência coletada automaticamente como pendente até revisão humana.",
  "Separar diagnóstico preliminar, nota validada e resultado oficial.",
  "Usar linguagem de risco institucional, sem acusações ou juízo reputacional individual.",
];

export const QUALIDADE_AGENCIAS: QualidadeAgencia[] = [
  ["ANA", "Agência Nacional de Águas e Saneamento Básico", "Recursos hídricos e saneamento", 2000, "Lei 9.984/2000", "https://www.gov.br/ana"],
  ["ANAC", "Agência Nacional de Aviação Civil", "Aviação civil", 2005, "Lei 11.182/2005", "https://www.gov.br/anac"],
  ["ANCINE", "Agência Nacional do Cinema", "Setor cinematográfico e audiovisual", 2001, "MP 2.228-1/2001", "https://www.ancine.gov.br"],
  ["ANEEL", "Agência Nacional de Energia Elétrica", "Energia elétrica", 1996, "Lei 9.427/1996", "https://www.gov.br/aneel"],
  ["ANM", "Agência Nacional de Mineração", "Mineração", 2017, "Lei 13.575/2017", "https://www.gov.br/anm"],
  ["ANP", "Agência Nacional do Petróleo, Gás Natural e Biocombustíveis", "Petróleo, gás natural e biocombustíveis", 1997, "Lei 9.478/1997", "https://www.gov.br/anp"],
  ["ANS", "Agência Nacional de Saúde Suplementar", "Planos e seguros de saúde", 2000, "Lei 9.961/2000", "https://www.gov.br/ans"],
  ["ANATEL", "Agência Nacional de Telecomunicações", "Telecomunicações", 1997, "Lei 9.472/1997", "https://www.gov.br/anatel"],
  ["ANTAQ", "Agência Nacional de Transportes Aquaviários", "Transportes aquaviários e portos", 2001, "Lei 10.233/2001", "https://www.gov.br/antaq"],
  ["ANTT", "Agência Nacional de Transportes Terrestres", "Transportes terrestres", 2001, "Lei 10.233/2001", "https://www.gov.br/antt"],
  ["ANVISA", "Agência Nacional de Vigilância Sanitária", "Vigilância sanitária", 1999, "Lei 9.782/1999", "https://www.gov.br/anvisa"],
  ["ANPD", "Agência Nacional de Proteção de Dados", "Proteção de dados pessoais", 2026, "Lei 15.352/2026", "https://www.gov.br/anpd"],
].map(([sigla, nome_completo, setor_regulado, ano_criacao, lei_criacao, site_oficial]) => {
  const base = String(site_oficial);
  const lower = String(sigla).toLowerCase();
  return {
    sigla: String(sigla),
    nome_completo: String(nome_completo),
    setor_regulado: String(setor_regulado),
    ano_criacao: Number(ano_criacao),
    lei_criacao: String(lei_criacao),
    site_oficial: base,
    portal_transparencia: `${base}/acesso-a-informacao`,
    portal_dados_abertos: lower === "aneel" ? "https://dadosabertos.aneel.gov.br" : `https://dados.gov.br/organization?q=${lower}`,
    portal_consultas_publicas: `${base}/participacao-social`,
    portal_ouvidoria: `${base}/canais_atendimento/ouvidoria`,
    email_contato: null,
    ativo: true,
  };
});

export const QUALIDADE_CRITERIOS: QualidadeCriterio[] = [
  {
    id: 1,
    nome: "Transparência Ativa",
    descricao: "Publicação proativa de informações institucionais, normativas, atas, AIRs, contratos, orçamento, agenda e dados abertos.",
    peso: 0.15,
    nivel_prioridade: "alta",
    fontes_coleta: ["portal_transparencia_federal", "site_agencia", "dados_gov_br"],
    metodo_coleta: "misto",
    url_documentacao: null,
    obrigatorio_por_lei: true,
    base_legal: "Lei 12.527/2011; Lei 13.848/2019, art. 18",
  },
  {
    id: 2,
    nome: "Participação Social",
    descricao: "Volume, qualidade e devolutiva de consultas públicas, audiências públicas e instrumentos de participação.",
    peso: 0.15,
    nivel_prioridade: "alta",
    fontes_coleta: ["participa_br", "site_agencia", "relatorios_anuais"],
    metodo_coleta: "scraping",
    url_documentacao: null,
    obrigatorio_por_lei: true,
    base_legal: "Lei 13.848/2019, arts. 19 a 25",
  },
  {
    id: 3,
    nome: "Análise de Impacto Regulatório",
    descricao: "Existência, qualidade e publicidade das AIRs, incluindo problema, alternativas, impactos e análise custo-benefício.",
    peso: 0.15,
    nivel_prioridade: "alta",
    fontes_coleta: ["site_agencia", "qualireg_cgu", "diario_oficial"],
    metodo_coleta: "misto",
    url_documentacao: null,
    obrigatorio_por_lei: true,
    base_legal: "Decreto 10.411/2020; Lei 13.874/2019",
  },
  {
    id: 4,
    nome: "Governança Regulatória",
    descricao: "Planejamento estratégico, gestão de riscos, integridade, código de conduta e controles internos.",
    peso: 0.12,
    nivel_prioridade: "alta",
    fontes_coleta: ["tcu", "cgu", "site_agencia"],
    metodo_coleta: "misto",
    url_documentacao: null,
    obrigatorio_por_lei: true,
    base_legal: "Lei 13.848/2019; IN CGU 01/2016",
  },
  {
    id: 5,
    nome: "Independência Decisória",
    descricao: "Autonomia técnica, mandatos fixos, quarentena regulatória e registros institucionais de estabilidade decisória.",
    peso: 0.08,
    nivel_prioridade: "media",
    fontes_coleta: ["atos_nomeacao", "acordaos_tcu", "site_agencia"],
    metodo_coleta: "manual",
    url_documentacao: null,
    obrigatorio_por_lei: true,
    base_legal: "Lei 13.848/2019, arts. 5 a 12",
  },
  {
    id: 6,
    nome: "Prestação de Contas",
    descricao: "Relatório anual de atividades, controle externo, metas, auditorias e resposta institucional a recomendações.",
    peso: 0.12,
    nivel_prioridade: "alta",
    fontes_coleta: ["tcu", "cgu", "portal_transparencia_federal"],
    metodo_coleta: "misto",
    url_documentacao: null,
    obrigatorio_por_lei: true,
    base_legal: "Lei 13.848/2019, art. 15",
  },
  {
    id: 7,
    nome: "Qualidade Normativa",
    descricao: "Clareza, consistência, proporcionalidade, revisão periódica, ARR e gestão do estoque regulatório.",
    peso: 0.08,
    nivel_prioridade: "media",
    fontes_coleta: ["site_agencia", "acervo_normativo", "relatorios_arr"],
    metodo_coleta: "misto",
    url_documentacao: null,
    obrigatorio_por_lei: true,
    base_legal: "Decreto 10.411/2020",
  },
  {
    id: 8,
    nome: "Ouvidoria e Atendimento",
    descricao: "Estrutura de ouvidoria, tempo médio de resposta, taxa de resolução e satisfação dos usuários.",
    peso: 0.06,
    nivel_prioridade: "media",
    fontes_coleta: ["falabr", "relatorios_ouvidoria", "cgu"],
    metodo_coleta: "misto",
    url_documentacao: null,
    obrigatorio_por_lei: true,
    base_legal: "Lei 13.460/2017; Lei 13.848/2019, art. 24",
  },
  {
    id: 9,
    nome: "Dados Abertos",
    descricao: "Datasets em formatos abertos, atualização regular, API pública e catálogo em dados.gov.br.",
    peso: 0.05,
    nivel_prioridade: "media",
    fontes_coleta: ["dados_gov_br", "api_agencia", "inda"],
    metodo_coleta: "api",
    url_documentacao: null,
    obrigatorio_por_lei: true,
    base_legal: "Decreto 8.777/2016",
  },
  {
    id: 10,
    nome: "Gestão Financeira e Orçamentária",
    descricao: "Execução orçamentária, eficiência de gastos, arrecadação regulatória e relatórios financeiros públicos.",
    peso: 0.04,
    nivel_prioridade: "baixa",
    fontes_coleta: ["siafi", "portal_transparencia_federal", "relatorios_anuais"],
    metodo_coleta: "api",
    url_documentacao: null,
    obrigatorio_por_lei: true,
    base_legal: "Lei 4.320/1964; Lei Complementar 101/2000",
  },
];

export const QUALIDADE_FONTES: QualidadeFonte[] = [
  ["portal_transparencia_federal", "Portal da Transparência Federal", "https://portaldatransparencia.gov.br", "https://api.portaldatransparencia.gov.br/api-de-dados", true, "api", [1, 6, 10], "JSON", "diária"],
  ["dados_gov_br", "Portal Dados Abertos Brasil", "https://dados.gov.br", "https://dados.gov.br/api/3/action", false, "api", [1, 9], "JSON", "variável"],
  ["participa_br", "Participa.br", "https://www.participa.br", null, false, "scraping", [2], "HTML", "contínua"],
  ["falabr", "Fala.BR", "https://falabr.cgu.gov.br", null, false, "misto", [1, 8], "CSV/HTML", "mensal"],
  ["qualireg_cgu", "QualiREG - CGU", "https://www.gov.br/cgu/pt-br/assuntos/auditoria-e-fiscalizacao/qualireg", null, false, "scraping", [3, 4], "PDF/HTML", "anual"],
  ["diario_oficial", "Diário Oficial da União", "https://www.in.gov.br", "https://www.in.gov.br/consulta/-/buscar/dou", false, "misto", [3, 7], "HTML/RSS", "diária"],
  ["tcu", "Tribunal de Contas da União", "https://portal.tcu.gov.br", "https://contas.tcu.gov.br/pesquisaJurisprudencia/", false, "scraping", [4, 5, 6], "HTML/PDF", "contínua"],
  ["cgu", "Controladoria-Geral da União", "https://www.gov.br/cgu", null, false, "scraping", [1, 4, 6, 8], "HTML/PDF", "contínua"],
  ["siafi", "Tesouro/SIAFI público", "https://www.tesourotransparente.gov.br/ckan/dataset", null, false, "api", [10], "CSV/JSON", "diária"],
  ["site_agencia", "Portal oficial da agência", "https://www.gov.br", null, false, "misto", [1, 2, 3, 4, 6, 7, 8], "HTML/PDF", "contínua"],
].map(([id, nome, url, api_url, requer_chave, metodo_coleta, criterios_relacionados, formato, atualizacao]) => ({
  id: String(id),
  nome: String(nome),
  url: String(url),
  api_url: api_url ? String(api_url) : null,
  requer_chave: Boolean(requer_chave),
  metodo_coleta: metodo_coleta as QualidadeFonte["metodo_coleta"],
  criterios_relacionados: criterios_relacionados as number[],
  formato: String(formato),
  atualizacao: String(atualizacao),
}));

export const QUALIDADE_CATEGORIAS_PREMIO: QualidadeCategoriaPremio[] = [
  { id: "geral", nome: "Melhor Agência Global", descricao: "Maior score geral ponderado.", criterios_avaliados: QUALIDADE_CRITERIOS.map((item) => item.id), tipo: "geral" },
  { id: "transparencia", nome: "Destaque em Transparência e Dados Abertos", descricao: "Transparência Ativa e Dados Abertos.", criterios_avaliados: [1, 9], tipo: "tematico" },
  { id: "participacao", nome: "Destaque em Participação Social", descricao: "Qualidade, volume e devolutiva de participação social.", criterios_avaliados: [2], tipo: "tematico" },
  { id: "inovacao", nome: "Destaque em Inovação Regulatória", descricao: "AIR, ARR e qualidade normativa.", criterios_avaliados: [3, 7], tipo: "tematico" },
  { id: "governanca", nome: "Destaque em Governança e Integridade", descricao: "Governança, independência decisória e prestação de contas.", criterios_avaliados: [4, 5, 6], tipo: "tematico" },
  { id: "evolucao", nome: "Prêmio Evolução Regulatória", descricao: "Maior evolução percentual frente à edição anterior.", criterios_avaliados: QUALIDADE_CRITERIOS.map((item) => item.id), tipo: "evolucao" },
];

const CURATED_NOTES: Record<string, number[]> = {
  ANATEL: [90, 88, 84, 83, 80, 84, 82, 81, 93, 82],
  ANVISA: [84, 88, 89, 86, 78, 82, 83, 82, 78, 79],
  ANEEL: [86, 82, 87, 80, 75, 80, 82, 78, 88, 76],
  ANP: [80, 72, 73, 74, 70, 78, 72, 70, 74, 76],
  ANA: [76, 83, 70, 72, 68, 72, 70, 73, 76, 69],
  ANS: [70, 69, 66, 69, 67, 68, 66, 70, 68, 67],
  ANAC: [68, 64, 66, 65, 67, 66, 65, 66, 64, 64],
  ANTT: [65, 63, 64, 63, 62, 64, 62, 63, 61, 64],
  ANTAQ: [60, 57, 56, 58, 56, 58, 57, 58, 55, 56],
  ANM: [54, 51, 50, 52, 50, 53, 51, 52, 50, 52],
  ANCINE: [52, 51, 49, 50, 49, 51, 50, 50, 48, 50],
  ANPD: [48, 44, 43, 45, 46, 44, 43, 47, 42, 43],
};

const AGENCY_CONTEXT: Record<string, { foco: string; maturidade: string; highlights: string[]; improvements: string[] }> = {
  ANATEL: {
    foco: "telecomunicacoes, consultas publicas setoriais e dados abertos consolidados",
    maturidade: "alta maturidade institucional",
    highlights: ["Dados abertos estruturados", "Consultas publicas maduras", "Transparencia institucional consistente"],
    improvements: ["Aprofundar ARR em normas de maior impacto", "Ampliar indicadores comparaveis de atendimento"],
  },
  ANVISA: {
    foco: "vigilancia sanitaria, AIR e participacao social em temas de alto impacto",
    maturidade: "alta maturidade regulatoria",
    highlights: ["Uso relevante de AIR", "Participacao social consolidada", "Governanca robusta"],
    improvements: ["Ampliar interoperabilidade de bases abertas", "Padronizar evidencias de devolutiva das consultas"],
  },
  ANEEL: {
    foco: "energia eletrica, audiencias publicas, AIR e portal de dados setoriais",
    maturidade: "alta maturidade regulatoria",
    highlights: ["Historico de AIR", "Portal de dados robusto", "Audiencias publicas com alta maturidade"],
    improvements: ["Evidenciar melhor a revisao periodica de normas", "Ampliar metricas de atendimento ao usuario"],
  },
  ANP: {
    foco: "petroleo, gas natural, biocombustiveis e prestacao de contas setorial",
    maturidade: "maturidade intermediaria alta",
    highlights: ["Transparencia institucional consistente", "Prestacao de contas setorial visivel"],
    improvements: ["Ampliar rastreabilidade de AIR e ARR", "Consolidar indicadores de participacao social"],
  },
  ANA: {
    foco: "recursos hidricos, saneamento e participacao por comites de bacia",
    maturidade: "maturidade intermediaria",
    highlights: ["Participacao em comites de bacia", "Dados hidricos estruturados"],
    improvements: ["Ampliar evidencias de AIR", "Melhorar comparabilidade de indicadores financeiros"],
  },
  ANS: {
    foco: "saude suplementar, atendimento ao consumidor e consultas tecnicas",
    maturidade: "maturidade em desenvolvimento",
    highlights: ["Base institucional verificavel", "Canais de atendimento relevantes para usuarios"],
    improvements: ["Aumentar transparencia de devolutivas", "Fortalecer dados abertos e ARR"],
  },
  ANAC: {
    foco: "aviacao civil, seguranca operacional e modernizacao regulatoria",
    maturidade: "maturidade em consolidacao",
    highlights: ["Modernizacao regulatoria recente", "Base normativa ampla"],
    improvements: ["Consolidar AIR em temas estrategicos", "Ampliar datasets e indicadores publicos"],
  },
  ANTT: {
    foco: "transportes terrestres, concessoes e fiscalizacao de infraestrutura",
    maturidade: "maturidade em desenvolvimento",
    highlights: ["Agenda regulatoria ligada a concessoes", "Base de controle setorial relevante"],
    improvements: ["Ampliar dados abertos", "Melhorar rastreabilidade de participacao e AIR"],
  },
  ANTAQ: {
    foco: "transportes aquaviarios, portos e navegacao interior",
    maturidade: "estrutura menor com evolucao gradual",
    highlights: ["Base institucional verificavel", "Fontes publicas disponiveis para avaliacao"],
    improvements: ["Ampliar evidencias de AIR e dados abertos", "Fortalecer indicadores de qualidade normativa"],
  },
  ANM: {
    foco: "mineracao, transicao institucional pos-DNPM e fiscalizacao mineral",
    maturidade: "governanca em construcao",
    highlights: ["Estrutura regulatoria recente", "Potencial de integracao de dados minerais"],
    improvements: ["Fortalecer governanca e sistemas de dados", "Ampliar AIR, ARR e dados abertos"],
  },
  ANCINE: {
    foco: "audiovisual, fomento e regulacao de mercado setorial menor",
    maturidade: "maturidade inicial-intermediaria",
    highlights: ["Conhecimento setorial especializado", "Base normativa rastreavel"],
    improvements: ["Estruturar AIR e governanca", "Ampliar dados abertos e indicadores"],
  },
  ANPD: {
    foco: "protecao de dados pessoais e consolidacao como agencia reguladora em 2026",
    maturidade: "estrutura institucional em formacao",
    highlights: ["Potencial institucional em protecao de dados", "Agenda de construcao regulatoria em 2026"],
    improvements: ["Consolidar estrutura de agencia", "Criar historico comparavel para edicoes futuras"],
  },
};

const CRITERION_EVIDENCE: Record<number, { fonte: string; titulo: string; detalhe: string }> = {
  1: { fonte: "site_agencia", titulo: "Portal institucional e acesso a informacao", detalhe: "Verifica secoes de transparencia ativa, agenda, atos, contratos e informacoes institucionais." },
  2: { fonte: "participa_br", titulo: "Participacao social e consultas publicas", detalhe: "Observa instrumentos de consulta, audiencia, tomada de subsidios e devolutivas publicas." },
  3: { fonte: "qualireg_cgu", titulo: "AIR e boas praticas regulatorias", detalhe: "Considera publicidade de AIR, abrangencia metodologica e referencias do Decreto 10.411/2020." },
  4: { fonte: "cgu", titulo: "Governanca, riscos e integridade", detalhe: "Considera planejamento estrategico, gestao de riscos, integridade e controles internos." },
  5: { fonte: "site_agencia", titulo: "Independencia decisoria e estrutura colegiada", detalhe: "Observa mandatos, atos oficiais, colegiado e regras de autonomia decisoria institucional." },
  6: { fonte: "portal_transparencia_federal", titulo: "Prestacao de contas e relatorios de gestao", detalhe: "Verifica relatorios anuais, auditorias, metas e respostas a controle externo." },
  7: { fonte: "diario_oficial", titulo: "Qualidade normativa e estoque regulatorio", detalhe: "Observa clareza normativa, revisoes, ARR e publicacoes oficiais de atos reguladores." },
  8: { fonte: "falabr", titulo: "Ouvidoria e atendimento ao usuario", detalhe: "Considera canais de ouvidoria, atendimento, prazos e informacoes publicas de satisfacao." },
  9: { fonte: "dados_gov_br", titulo: "Catalogo de dados abertos", detalhe: "Verifica datasets, formatos abertos, atualizacao e disponibilidade de APIs ou catalogos publicos." },
  10: { fonte: "siafi", titulo: "Execucao financeira e orcamentaria", detalhe: "Observa informacoes publicas de orcamento, execucao e eficiencia de gastos institucionais." },
};

export function buildInitialDiagnostics(year = new Date().getFullYear()): QualidadeDiagnostico[] {
  const now = new Date().toISOString();
  const diagnostics = QUALIDADE_AGENCIAS.map((agencia) => {
    const scores = CURATED_NOTES[agencia.sigla] ?? Array(10).fill(50);
    const notes = QUALIDADE_CRITERIOS.map((criterion, index) => {
      const nota = clampScore(scores[index] ?? 50);
      return {
        agencia_sigla: agencia.sigla,
        criterio_id: criterion.id,
        nota,
        nivel: scoreToLevel(nota),
        observacao: `Diagnóstico preliminar de ${criterion.nome} para ${agencia.sigla}, baseado em pesquisa documental pública e sujeito a revisão humana.`,
        evidencias: buildEvidenceUrls(agencia.sigla, criterion.id),
        data_avaliacao: `${year}-06-01`,
        fonte_avaliacao: "base_curada_2026",
        status_revisao: "preliminar" as const,
      };
    });
    return {
      agencia_sigla: agencia.sigla,
      notas: notes,
      score_geral: calculateWeightedScore(notes),
      posicao_ranking: null,
      destaques_positivos: buildHighlights(agencia.sigla),
      areas_melhoria: buildImprovements(agencia.sigla),
      ultima_atualizacao: now,
      status_revisao: "preliminar" as const,
    };
  });

  return rankDiagnostics(diagnostics);
}

export function buildInitialEvidences(year = new Date().getFullYear()): QualidadeEvidencia[] {
  return QUALIDADE_AGENCIAS.flatMap((agencia) => QUALIDADE_CRITERIOS.map((criterion) => {
    const evidence = CRITERION_EVIDENCE[criterion.id];
    const source = QUALIDADE_FONTES.find((item) => item.id === evidence.fonte);
    const url = getAgencyEvidenceUrl(agencia.sigla, criterion.id) || source?.url || agencia.site_oficial;
    return {
      agencia_sigla: agencia.sigla,
      criterio_id: criterion.id,
      titulo: `${agencia.sigla} - ${evidence.titulo}`,
      url,
      fonte: evidence.fonte,
      trecho_publico: `${evidence.detalhe} Diagnostico preliminar baseado em fontes publicas para ${agencia.sigla}.`,
      data_referencia: `${year}-06-01`,
      status_revisao: "pendente" as const,
    };
  }));
}

export function rankDiagnostics(diagnostics: QualidadeDiagnostico[]) {
  return [...diagnostics]
    .sort((a, b) => b.score_geral - a.score_geral)
    .map((item, index) => ({ ...item, posicao_ranking: index + 1 }));
}

export function calculateWeightedScore(notes: Array<{ criterio_id: number; nota: number }>) {
  const byCriterion = new Map(notes.map((note) => [note.criterio_id, Number(note.nota)]));
  const score = QUALIDADE_CRITERIOS.reduce((sum, criterion) => {
    const note = byCriterion.get(criterion.id) ?? 0;
    return sum + note * criterion.peso;
  }, 0);
  return Number(score.toFixed(1));
}

export function scoreToLevel(score: number): QualidadeNivel {
  if (score >= 76) return "avancado";
  if (score >= 45) return "em_desenvolvimento";
  return "inicial";
}

export function clampScore(score: number) {
  return Number(Math.max(0, Math.min(100, score)).toFixed(1));
}

export function sanitizeEvidenceText(value: string | null | undefined) {
  if (!value) return "";
  return value
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF removido]")
    .replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[e-mail removido]")
    .replace(/\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-\s]?\d{4}\b/g, "[telefone removido]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
}

// Palavras-chave por criterio para validacao semantica da evidencia coletada.
// "sucesso" HTTP nao garante relevancia; aqui medimos se o conteudo realmente
// fala do criterio antes da revisao humana.
const CRITERIO_KEYWORDS: Record<number, string[]> = {
  1: ["transparencia", "transparencia ativa", "dados abertos", "acesso a informacao", "lai", "informacoes institucionais", "agenda"],
  2: ["consulta publica", "audiencia publica", "participacao social", "tomada de subsidios", "contribuicoes"],
  3: ["analise de impacto", "air", "impacto regulatorio", "custo-beneficio", "alternativas regulatorias"],
  4: ["governanca", "gestao de riscos", "integridade", "codigo de conduta", "controles internos", "planejamento estrategico"],
  5: ["mandato", "quarentena", "autonomia", "independencia", "nomeacao", "estabilidade decisoria"],
  6: ["prestacao de contas", "relatorio anual", "auditoria", "controle externo", "metas", "tcu"],
  7: ["qualidade normativa", "revisao periodica", "estoque regulatorio", "arr", "consolidacao", "proporcionalidade"],
  8: ["ouvidoria", "atendimento", "fala.br", "falabr", "tempo de resposta", "satisfacao", "usuarios"],
  9: ["dados abertos", "dataset", "api", "csv", "json", "catalogo", "dados.gov"],
  10: ["orcamento", "execucao orcamentaria", "siafi", "arrecadacao", "financeiro", "gastos"],
};

function normalizeForMatch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Calcula a relevancia (0-100) de um texto de evidencia para um criterio,
 * pela proporcao de palavras-chave do criterio presentes no conteudo.
 */
export function scoreEvidenceRelevance(criterioId: number | null, text: string | null | undefined): number {
  if (!criterioId || !text) return 0;
  const keywords = CRITERIO_KEYWORDS[criterioId];
  if (!keywords?.length) return 0;
  const haystack = normalizeForMatch(text);
  const hits = keywords.filter((keyword) => haystack.includes(normalizeForMatch(keyword))).length;
  return Math.round(Math.min(1, hits / Math.min(keywords.length, 3)) * 100);
}

export function detectComplianceFlags(value: string | null | undefined) {
  const text = value ?? "";
  return {
    has_cpf: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(text),
    has_email: /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/.test(text),
    has_phone: /\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-\s]?\d{4}\b/.test(text),
    reviewed: false,
  };
}

export function buildPremioWinners(diagnostics: QualidadeDiagnostico[], previous?: QualidadeDiagnostico[]) {
  const byPrevious = new Map((previous ?? []).map((item) => [item.agencia_sigla, item.score_geral]));
  return QUALIDADE_CATEGORIAS_PREMIO.map((category) => {
    if (category.tipo === "evolucao") {
      const candidates = diagnostics
        .filter((item) => item.agencia_sigla !== "ANPD" || byPrevious.has(item.agencia_sigla))
        .map((item) => {
          const old = byPrevious.get(item.agencia_sigla);
          const variation = old ? ((item.score_geral - old) / old) * 100 : 0;
          return { ...item, category_score: Number(variation.toFixed(1)) };
        })
        .sort((a, b) => b.category_score - a.category_score);
      return { categoria: category, vencedora: candidates[0]?.agencia_sigla ?? null, score: candidates[0]?.category_score ?? null, status: "preliminar" };
    }

    const ranking = diagnostics.map((diag) => {
      const notes = diag.notas.filter((note) => category.criterios_avaliados.includes(note.criterio_id));
      return { ...diag, category_score: notes.length ? Number((notes.reduce((sum, note) => sum + note.nota, 0) / notes.length).toFixed(1)) : diag.score_geral };
    }).sort((a, b) => b.category_score - a.category_score);
    return { categoria: category, vencedora: ranking[0]?.agencia_sigla ?? null, score: ranking[0]?.category_score ?? null, status: "preliminar" };
  });
}

function buildCriterionObservation(sigla: string, criterioNome: string, nota: number) {
  const context = AGENCY_CONTEXT[sigla];
  const level = nota >= 76 ? "avancado" : nota >= 45 ? "em desenvolvimento" : "inicial";
  return `${criterioNome} em nivel ${level} para ${sigla}: ${context?.maturidade ?? "maturidade em avaliacao"}, com foco em ${context?.foco ?? "fontes institucionais publicas"}. Nota preliminar baseada em evidencias publicas e sujeita a revisao humana.`;
}

function buildEvidenceUrls(sigla: string, criterioId: number) {
  const agency = QUALIDADE_AGENCIAS.find((item) => item.sigla === sigla);
  const evidence = CRITERION_EVIDENCE[criterioId];
  const source = QUALIDADE_FONTES.find((item) => item.id === evidence?.fonte);
  return [getAgencyEvidenceUrl(sigla, criterioId), source?.url, agency?.site_oficial].filter(Boolean) as string[];
}

function getAgencyEvidenceUrl(sigla: string, criterioId: number) {
  const agency = QUALIDADE_AGENCIAS.find((item) => item.sigla === sigla);
  if (!agency) return "";
  if (criterioId === 1) return agency.portal_transparencia || agency.site_oficial;
  if (criterioId === 2) return agency.portal_consultas_publicas || agency.site_oficial;
  if (criterioId === 8) return agency.portal_ouvidoria || agency.site_oficial;
  if (criterioId === 9) return agency.portal_dados_abertos || agency.site_oficial;
  return agency.site_oficial;
}

function buildHighlights(sigla: string) {
  const context = AGENCY_CONTEXT[sigla];
  if (context) return context.highlights;
  const mapping: Record<string, string[]> = {
    ANATEL: ["Dados abertos estruturados", "Consultas públicas maduras", "Transparência institucional consistente"],
    ANVISA: ["Uso relevante de AIR", "Participação social consolidada", "Governança robusta"],
    ANEEL: ["Histórico de AIR", "Portal de dados robusto", "Audiências públicas com alta maturidade"],
    ANA: ["Participação em comitês de bacia", "Dados hídricos estruturados"],
    ANPD: ["Potencial institucional em proteção de dados", "Agenda de construção regulatória em 2026"],
  };
  return mapping[sigla] ?? ["Base institucional verificável", "Fontes públicas disponíveis para avaliação"];
}

function buildImprovements(sigla: string) {
  const context = AGENCY_CONTEXT[sigla];
  if (context) return context.improvements;
  const mapping: Record<string, string[]> = {
    ANM: ["Fortalecer governança e sistemas de dados", "Ampliar AIR, ARR e dados abertos"],
    ANCINE: ["Estruturar AIR e governança", "Ampliar dados abertos e indicadores"],
    ANPD: ["Consolidar estrutura de agência", "Criar histórico comparável para edições futuras"],
    ANTAQ: ["Ampliar evidências de AIR e dados abertos", "Fortalecer indicadores de qualidade normativa"],
  };
  return mapping[sigla] ?? ["Revisar evidências oficiais por critério", "Aprimorar rastreabilidade e revisão humana"];
}
