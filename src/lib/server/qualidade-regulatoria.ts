// Níveis da Matriz de Maturidade da Qualidade Normativa (IMQN), do menos ao mais
// maduro. Valores IMQN 0 / 0.35 / 0.7 / 1 → nota 0 / 35 / 70 / 100 (ver LEVEL_TO_NOTA).
export type QualidadeNivel = "inexistente" | "inicial" | "gerenciado" | "melhoria_continua";
export type QualidadeStatusRevisao = "preliminar" | "pendente" | "em_revisao" | "validado" | "rejeitado";

// Nota (0–100) que representa cada nível da matriz (classificação IMQN × 100).
export const LEVEL_TO_NOTA: Record<QualidadeNivel, number> = {
  inexistente: 0,
  inicial: 35,
  gerenciado: 70,
  melhoria_continua: 100,
};

export const NIVEL_LABEL: Record<QualidadeNivel, string> = {
  inexistente: "Inexistente",
  inicial: "Inicial",
  gerenciado: "Gerenciado",
  melhoria_continua: "Melhoria Contínua",
};

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
  // Descrição de cada nível de maturidade desta dimensão (Matriz IMQN).
  niveis?: Record<QualidadeNivel, string>;
  // Subcritérios da dimensão (ex.: AIR e ARR → Capacitação / Metodologia / Processo).
  subcriterios?: string[];
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
  {
    label: "Lei da Liberdade Econômica - Lei 13.874/2019 (AIR obrigatória)",
    url: "https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2019/lei/L13874.htm",
  },
  {
    label: "Decreto 10.411/2020 - regulamenta AIR e ARR",
    url: "https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/decreto/D10411.htm",
  },
  {
    label: "Decreto 10.139/2019 - revisão e consolidação de atos normativos",
    url: "https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2019/decreto/D10139.htm",
  },
];

// Programa INFRA Competitividade (Ministério da Infraestrutura) — contexto/metodologia
// da Matriz de Maturidade da Qualidade Normativa. Exibido como referência (NÃO entra no
// cálculo do IMQN). Eixos, projetos por agência e indicadores OCDE PMR (Product Market
// Regulation 2018/2022, escala 0 = menos restritivo a 6 = mais restritivo).
export const INFRA_COMPETITIVIDADE = {
  visao: "Tornar-se líder da América Latina em Infraestrutura de transportes.",
  eixos: [
    { nome: "Segurança Jurídica", descricao: "Previsibilidade para o mercado, participação social e análise de impacto regulatório (AIR/ARR)." },
    { nome: "Produtividade", descricao: "Desburocratização, redução do custo Brasil, celeridade e redução do fardo regulatório." },
    { nome: "Livre Mercado", descricao: "Liberdade econômica, investimento, inovação e limitação da atuação do Estado como regulador." },
  ] as Array<{ nome: string; descricao: string }>,
  indicadores_ocde: [
    { nome: "PMR Geral (Brasil)", valor: 2.62, referencia: "Penúltima posição entre 39 países (PMR 2018)" },
    { nome: "PMR Transportes (Brasil)", valor: 2.29, meta: 0.76, meta_posicao: "1º lugar" },
    { nome: "PMR Aquaviário", valor: 2.42, meta: 0.67, meta_posicao: "3º lugar (evolução de 36 posições)" },
    { nome: "PMR Rodoviário", valor: 2.0, meta: 1.36, meta_posicao: "11º lugar (evolução de 23 posições)" },
    { nome: "PMR Ferroviário", valor: 4.07, meta: 1.36, meta_posicao: "1º lugar (evolução de 26 posições)" },
    { nome: "PMR Aeroviário", valor: 0.67, meta: 0.25, meta_posicao: "3º lugar (evolução de 7 posições)" },
  ] as Array<{ nome: string; valor: number; meta?: number; meta_posicao?: string; referencia?: string }>,
  indicador_qualidade_normativa_2022: [
    { agencia: "ANAC", imqn: 82.75 },
    { agencia: "ANTT", imqn: 89.5 },
    { agencia: "ANTAQ", imqn: 92.88 },
    { agencia: "MINFRA", imqn: 72.25 },
  ] as Array<{ agencia: string; imqn: number }>,
} as const;

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

// As 6 dimensões da Matriz de Avaliação da Maturidade da Qualidade Normativa (IMQN),
// programa INFRA Competitividade. Pesos (soma 1,0): AIR 0.25, Participação Social 0.15,
// Estoque 0.20, Agenda 0.15, Processo Normativo 0.10, ARR 0.15. Cada dimensão traz a
// descrição dos 4 níveis (Inexistente → Melhoria Contínua) conforme a matriz oficial.
export const QUALIDADE_CRITERIOS: QualidadeCriterio[] = [
  {
    id: 1,
    nome: "Análise de Impacto Regulatório (AIR)",
    descricao: "Capacitação, metodologia e processo de AIR: existência, qualidade e publicidade das análises de impacto (problema, alternativas, impactos e participação social).",
    peso: 0.25,
    nivel_prioridade: "alta",
    fontes_coleta: ["site_agencia", "qualireg_cgu", "diario_oficial"],
    metodo_coleta: "misto",
    url_documentacao: null,
    obrigatorio_por_lei: true,
    base_legal: "Decreto 10.411/2020; Lei 13.874/2019, art. 5; Lei 13.848/2019, art. 6",
    subcriterios: ["Capacitação", "Metodologia", "Processo"],
    niveis: {
      inexistente: "Não há servidores capacitados em AIR; não há metodologia de AIR estabelecida; AIR realizada apenas eventualmente.",
      inicial: "Pequena quantidade de servidores com capacitação introdutória; AIR institucionalizada conforme o Decreto 10.411/2020; AIR sempre realizada e a dispensa justificada por critérios objetivos.",
      gerenciado: "Servidores capacitados em nível introdutório/intermediário/avançado; há manual instituindo a aplicabilidade institucional da AIR; AIR realizada sistematicamente, com participação social posterior e processo mapeado.",
      melhoria_continua: "Plano de capacitação em AIR estabelecido e em prática; critérios objetivos de classificação por impacto/complexidade; AIRs de alto impacto submetidas à participação social prévia e posterior; avaliação contínua da qualidade das AIRs.",
    },
  },
  {
    id: 2,
    nome: "Participação Social",
    descricao: "Instrumentos, metodologia e efetividade de consultas públicas, audiências e tomadas de subsídios, incluindo devolutiva às contribuições.",
    peso: 0.15,
    nivel_prioridade: "alta",
    fontes_coleta: ["participa_br", "site_agencia", "relatorios_anuais"],
    metodo_coleta: "scraping",
    url_documentacao: null,
    obrigatorio_por_lei: true,
    base_legal: "Lei 13.848/2019, arts. 19 a 25; Decreto 10.411/2020",
    niveis: {
      inexistente: "A instituição não atende ao disposto na legislação sobre participação social.",
      inicial: "Existe dispositivo interno orientando a participação social conforme a legislação (Leis 13.848/2019, 13.874/2019 e Decreto 10.411/2020).",
      gerenciado: "Manual/ato normativo instituindo metodologia e procedimento de PS; relatórios de ouvidoria e consumidor.gov subsidiam decisões; informações divulgadas no portal e/ou Participa+Brasil; efetividade avaliada de forma intuitiva.",
      melhoria_continua: "Eventos de PS para construção de conhecimento e propostas; ouvidoria, consumidor.gov, pesquisas de satisfação e atendimento subsidiam decisões; instrumentos e contribuições divulgados; efetividade da PS mensurada conforme metodologia instituída.",
    },
  },
  {
    id: 3,
    nome: "Gestão de Estoque Regulatório",
    descricao: "Levantamento, análise, indexação e consolidação do acervo normativo, integrados ao planejamento e à transparência.",
    peso: 0.20,
    nivel_prioridade: "alta",
    fontes_coleta: ["site_agencia", "diario_oficial", "acervo_normativo"],
    metodo_coleta: "misto",
    url_documentacao: null,
    obrigatorio_por_lei: true,
    base_legal: "Decreto 10.139/2019, art. 19; Lei 13.874/2019",
    niveis: {
      inexistente: "Não há levantamento de atos normativos publicados pelo órgão.",
      inicial: "Levantamento quantitativo dos atos normativos; normas publicadas e disponíveis para consulta pública na internet.",
      gerenciado: "Análise qualitativa dos atos normativos, indexação e classificação por tema; normas no portal gov.br; fardo regulatório estimado para normas de alto impacto; manutenção da consolidação normativa (art. 19 do Decreto 10.139/2019).",
      melhoria_continua: "Processos de gestão de estoque integrados ao planejamento normativo e à transparência; alterações do estoque priorizadas por agenda regulatória; novas normas passam por consolidação e compatibilização.",
    },
  },
  {
    id: 4,
    nome: "Agenda Regulatória",
    descricao: "Elaboração, priorização, participação social e cumprimento da agenda regulatória, integrada ao planejamento estratégico.",
    peso: 0.15,
    nivel_prioridade: "alta",
    fontes_coleta: ["site_agencia", "participa_br", "relatorios_anuais"],
    metodo_coleta: "misto",
    url_documentacao: null,
    obrigatorio_por_lei: true,
    base_legal: "Lei 13.848/2019, art. 21",
    niveis: {
      inexistente: "Não há agenda regulatória.",
      inicial: "Existe Agenda Regulatória no órgão; temas elencados e priorizados pelos gestores; avaliada a aderência da proposta às políticas públicas.",
      gerenciado: "Elaboração, atualização e acompanhamento institucionalizados; ampla participação social (analisada, porém não respondida); Ministério setorial oficiado na abertura; cumprimento de 50% a 79%; execução monitorada.",
      melhoria_continua: "Processos da Agenda integrados ao planejamento e à gestão do órgão; participação social analisada, respondida e divulgada; projetos aderentes ao planejamento estratégico; cumprimento ≥ 80%; execução monitorada e divulgada.",
    },
  },
  {
    id: 5,
    nome: "Gestão do Processo Normativo",
    descricao: "Formalização, padronização e monitoramento por indicadores do fluxo de elaboração de atos normativos.",
    peso: 0.10,
    nivel_prioridade: "media",
    fontes_coleta: ["site_agencia", "diario_oficial"],
    metodo_coleta: "misto",
    url_documentacao: null,
    obrigatorio_por_lei: true,
    base_legal: "Lei 13.848/2019; Decreto 10.411/2020",
    niveis: {
      inexistente: "O processo normativo não é padronizado.",
      inicial: "Há documento que institucionaliza o processo normativo; fluxo formalizado de forma clara; instâncias de aprovação claras e formalizadas.",
      gerenciado: "Processo padronizado no órgão; as intervenções de participação social estão claramente inseridas no processo.",
      melhoria_continua: "Indicadores de processo normativo monitorados e usados para melhoria contínua, integrando o processo normativo à gestão estratégica da instituição.",
    },
  },
  {
    id: 6,
    nome: "Análise de Resultado Regulatório (ARR)",
    descricao: "Capacitação, metodologia e processo de ARR: avaliação dos resultados das normas em vigor, com agenda de ARR e participação social.",
    peso: 0.15,
    nivel_prioridade: "alta",
    fontes_coleta: ["site_agencia", "qualireg_cgu", "relatorios_arr"],
    metodo_coleta: "misto",
    url_documentacao: null,
    obrigatorio_por_lei: true,
    base_legal: "Decreto 10.411/2020, art. 12",
    subcriterios: ["Capacitação", "Metodologia", "Processo"],
    niveis: {
      inexistente: "Não há servidores capacitados em ARR; não há metodologia de ARR estabelecida; ARR realizada esporadicamente.",
      inicial: "25% a 49% dos servidores capacitados em ARR; existe Agenda de ARR (Decreto 10.411/2020); ARRs publicadas e acessíveis ao público; agenda de ARR publicada no site do órgão.",
      gerenciado: "50% a 74% dos servidores capacitados; ARR institucionalizada; manual/ato normativo instituindo a aplicabilidade da ARR; ARRs de alto impacto submetidas à participação social.",
      melhoria_continua: "Plano de capacitação em ARR com ≥ 75% dos servidores; metodologia contempla participação social; agenda de ARR construída com participação social e integrada à Agenda Regulatória; execução monitorada e com melhoria contínua.",
    },
  },
];

export const QUALIDADE_FONTES: QualidadeFonte[] = [
  ["portal_transparencia_federal", "Portal da Transparência Federal", "https://portaldatransparencia.gov.br", "https://api.portaldatransparencia.gov.br/api-de-dados", true, "api", [3, 4], "JSON", "diária"],
  ["dados_gov_br", "Portal Dados Abertos Brasil", "https://dados.gov.br", "https://dados.gov.br/api/3/action", false, "api", [3], "JSON", "variável"],
  ["participa_br", "Participa.br", "https://www.participa.br", null, false, "scraping", [2, 4], "HTML", "contínua"],
  ["falabr", "Fala.BR", "https://falabr.cgu.gov.br", null, false, "misto", [2], "CSV/HTML", "mensal"],
  ["qualireg_cgu", "QualiREG - CGU", "https://www.gov.br/cgu/pt-br/assuntos/auditoria-e-fiscalizacao/qualireg", null, false, "scraping", [1, 6], "PDF/HTML", "anual"],
  ["diario_oficial", "Diário Oficial da União", "https://www.in.gov.br", "https://www.in.gov.br/consulta/-/buscar/dou", false, "misto", [1, 3, 5], "HTML/RSS", "diária"],
  ["tcu", "Tribunal de Contas da União", "https://portal.tcu.gov.br", "https://contas.tcu.gov.br/pesquisaJurisprudencia/", false, "scraping", [5], "HTML/PDF", "contínua"],
  ["cgu", "Controladoria-Geral da União", "https://www.gov.br/cgu", null, false, "scraping", [1, 6], "HTML/PDF", "contínua"],
  ["siafi", "Tesouro/SIAFI público", "https://www.tesourotransparente.gov.br/ckan/dataset", null, false, "api", [], "CSV/JSON", "diária"],
  ["site_agencia", "Portal oficial da agência", "https://www.gov.br", null, false, "misto", [1, 2, 3, 4, 5, 6], "HTML/PDF", "contínua"],
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
  { id: "geral", nome: "Melhor Índice de Maturidade (IMQN)", descricao: "Maior score geral ponderado nas 6 dimensões da Matriz de Qualidade Normativa.", criterios_avaliados: QUALIDADE_CRITERIOS.map((item) => item.id), tipo: "geral" },
  { id: "air", nome: "Destaque em Análise de Impacto Regulatório", descricao: "Maturidade em AIR (capacitação, metodologia e processo).", criterios_avaliados: [1], tipo: "tematico" },
  { id: "participacao", nome: "Destaque em Participação Social", descricao: "Instrumentos, metodologia e efetividade da participação social.", criterios_avaliados: [2], tipo: "tematico" },
  { id: "estoque", nome: "Destaque em Gestão do Estoque Regulatório", descricao: "Levantamento, consolidação e gestão do acervo normativo.", criterios_avaliados: [3], tipo: "tematico" },
  { id: "agenda_arr", nome: "Destaque em Agenda Regulatória e ARR", descricao: "Agenda regulatória e análise de resultado regulatório.", criterios_avaliados: [4, 6], tipo: "tematico" },
  { id: "evolucao", nome: "Prêmio Evolução Regulatória", descricao: "Maior evolução percentual frente à edição anterior.", criterios_avaliados: QUALIDADE_CRITERIOS.map((item) => item.id), tipo: "evolucao" },
];

// Fallback preliminar (demo/offline) — 6 dimensões IMQN por agência, na ordem
// [AIR, Participação Social, Estoque Regulatório, Agenda Regulatória, Processo Normativo, ARR].
// Notas ancoradas nos níveis (0/35/70/100). Substituídas pela auto-classificação + curadoria.
const CURATED_NOTES: Record<string, number[]> = {
  ANATEL: [100, 85, 85, 85, 70, 70],
  ANVISA: [85, 85, 70, 70, 70, 70],
  ANEEL: [85, 70, 85, 70, 70, 35],
  ANTT: [85, 70, 70, 85, 70, 70],
  ANAC: [70, 70, 70, 70, 70, 35],
  ANTAQ: [70, 35, 70, 70, 35, 35],
  ANP: [70, 35, 35, 70, 35, 35],
  ANA: [35, 70, 35, 35, 35, 35],
  ANS: [35, 35, 35, 35, 35, 0],
  ANM: [35, 35, 35, 35, 0, 0],
  ANCINE: [35, 0, 35, 0, 0, 0],
  ANPD: [0, 0, 35, 0, 0, 0],
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
  1: { fonte: "qualireg_cgu", titulo: "AIR - Analise de Impacto Regulatorio", detalhe: "Verifica publicidade de AIR, capacitacao, metodologia e processo conforme o Decreto 10.411/2020." },
  2: { fonte: "participa_br", titulo: "Participacao social e consultas publicas", detalhe: "Observa consultas, audiencias, tomadas de subsidios e devolutiva das contribuicoes." },
  3: { fonte: "diario_oficial", titulo: "Gestao do estoque regulatorio", detalhe: "Considera levantamento, indexacao e consolidacao do acervo normativo (Decreto 10.139/2019)." },
  4: { fonte: "site_agencia", titulo: "Agenda regulatoria", detalhe: "Observa elaboracao, priorizacao, participacao social e cumprimento da agenda regulatoria." },
  5: { fonte: "site_agencia", titulo: "Gestao do processo normativo", detalhe: "Verifica formalizacao, padronizacao e monitoramento por indicadores do processo normativo." },
  6: { fonte: "qualireg_cgu", titulo: "ARR - Analise de Resultado Regulatorio", detalhe: "Considera capacitacao, metodologia, agenda de ARR e participacao social na avaliacao de resultados." },
};

export function buildInitialDiagnostics(year = new Date().getFullYear()): QualidadeDiagnostico[] {
  const now = new Date().toISOString();
  const diagnostics = QUALIDADE_AGENCIAS.map((agencia) => {
    const scores = CURATED_NOTES[agencia.sigla] ?? Array(QUALIDADE_CRITERIOS.length).fill(35);
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

// Mapeia a nota (0–100) para um dos 4 níveis IMQN. Cortes nos pontos médios entre
// as notas-âncora dos níveis (0/35/70/100): 17.5, 52.5 e 85.
export function scoreToLevel(score: number): QualidadeNivel {
  if (score >= 85) return "melhoria_continua";
  if (score >= 52.5) return "gerenciado";
  if (score >= 17.5) return "inicial";
  return "inexistente";
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
// Palavras-chave por DIMENSÃO IMQN (usadas pela auto-classificação e pela validação
// semântica das evidências coletadas). Sem acento/caixa (normalizeForMatch cuida disso).
const CRITERIO_KEYWORDS: Record<number, string[]> = {
  1: ["analise de impacto regulatorio", "air", "impacto regulatorio", "relatorio de air", "custo-beneficio", "alternativas regulatorias", "decreto 10.411"],
  2: ["consulta publica", "audiencia publica", "participacao social", "tomada de subsidios", "contribuicoes", "participa mais brasil"],
  3: ["estoque regulatorio", "consolidacao normativa", "revisao de normas", "acervo normativo", "levantamento de atos", "guilhotina regulatoria", "decreto 10.139"],
  4: ["agenda regulatoria", "agenda de regulacao", "temas prioritarios", "planejamento regulatorio"],
  5: ["processo normativo", "fluxo normativo", "regimento interno", "instancias de aprovacao", "padronizacao do processo"],
  6: ["analise de resultado regulatorio", "arr", "avaliacao de resultado regulatorio", "resultado regulatorio", "avaliacao ex-post"],
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
  const level = NIVEL_LABEL[scoreToLevel(nota)];
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
  // Dimensão 2 = Participação Social → portal de consultas/participação.
  if (criterioId === 2) return agency.portal_consultas_publicas || agency.site_oficial;
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
