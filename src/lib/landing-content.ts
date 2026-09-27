/**
 * Conteúdo institucional da landing page — Fase 32.
 *
 * ⚠️ Texto é DADO, não markup. Fica aqui para (a) o usuário poder revisar sem abrir componente
 * React, e (b) o teste poder cobrar que os 9 itens continuem sendo 9 — uma seção institucional que
 * perde um item silenciosamente é o tipo de erro que ninguém vê até um associado perguntar.
 *
 * Fonte dos textos: o próprio usuário (e conferem com o que está publicado em irisregulacao.org).
 */

export interface ItemDoQueFazemos { titulo: string; texto: string }

/** Os 9 eixos de atuação, na ordem em que o usuário os enviou. */
export const O_QUE_FAZEMOS: readonly ItemDoQueFazemos[] = [
  {
    titulo: "Estudar e debater",
    texto:
      "Estudar e debater normas e diretrizes regulatórias, buscando aperfeiçoamento técnico, " +
      "previsibilidade normativa e alinhamento às melhores práticas nacionais e internacionais.",
  },
  {
    titulo: "Analisar e monitorar",
    texto:
      "Analisar e monitorar a execução das atividades e serviços regulados, avaliando sua " +
      "conformidade com padrões técnicos, legais e contratuais, além de identificar e prevenir " +
      "práticas abusivas ou contrárias ao interesse coletivo.",
  },
  {
    titulo: "Medir impactos",
    texto:
      "Medir impactos e promover boas práticas regulatórias, incluindo a realização de pesquisas, " +
      "estudos de impacto regulatório (AIR) e a proposição de aprimoramentos legislativos e normativos.",
  },
  {
    titulo: "Atuar na resolução de conflitos",
    texto:
      "Atuar na resolução de conflitos, mediando divergências entre usuários, prestadores de " +
      "serviços, entes reguladores e demais agentes setoriais, por meio de soluções técnicas e " +
      "céleres, prevenindo ou mitigando a judicialização.",
  },
  {
    titulo: "Apoiar e influenciar políticas públicas",
    texto:
      "Apoiar e influenciar políticas públicas voltadas à regulação e ao desenvolvimento econômico, " +
      "propondo recomendações, pareceres técnicos e avaliações estratégicas para órgãos " +
      "governamentais e entidades do setor regulado.",
  },
  {
    titulo: "Práticas inovadoras e sustentáveis",
    texto:
      "Incentivar a adoção de práticas inovadoras e sustentáveis no ambiente regulatório, promovendo " +
      "pesquisas e soluções que equilibrem desenvolvimento econômico e responsabilidade ambiental.",
  },
  {
    titulo: "Transparência e participação social",
    texto:
      "Assegurar a transparência e participação social na regulação, incentivando boas práticas de " +
      "governança, controle social e interação entre sociedade civil, setor produtivo e entes reguladores.",
  },
  {
    titulo: "Cooperar com órgãos públicos",
    texto:
      "Cooperar com órgãos públicos, entidades privadas e organizações internacionais para " +
      "intercâmbio de boas práticas, desenvolvimento de projetos e aperfeiçoamento da regulação.",
  },
  {
    titulo: "Promover educação e capacitação",
    texto:
      "Promover educação e capacitação sobre temas regulatórios, organizando congressos, eventos, " +
      "seminários e publicações técnicas que contribuam para a disseminação do conhecimento.",
  },
] as const;

export const QUEM_SOMOS: readonly string[] = [
  "Somos uma entidade privada, sem fins lucrativos, comprometida com o estudo, a análise e o " +
    "aprimoramento da regulação no Brasil. Nosso propósito é promover um ambiente regulatório " +
    "estável, seguro e de alta qualidade, contribuindo para a eficiência normativa e a adoção das " +
    "melhores práticas nacionais e internacionais.",
  "Atuamos de forma estratégica no monitoramento e aperfeiçoamento de normas, na análise de " +
    "impactos regulatórios, na mediação de conflitos e no apoio à formulação de políticas públicas. " +
    "Estimulamos a transparência, a participação social e o desenvolvimento de soluções inovadoras " +
    "e sustentáveis. Por meio de pesquisas, programas de capacitação e cooperação institucional, " +
    "fortalecemos a governança regulatória e impulsionamos o desenvolvimento econômico com " +
    "responsabilidade e visão de futuro.",
] as const;

/**
 * As quatro etapas do Radar Regulatório.
 *
 * ⚠️ CADA UMA DESCREVE O QUE O SISTEMA FAZ DE VERDADE — nenhuma é aspiração. Isso importa mais
 * aqui do que em qualquer outra seção: a página mostra 12 logos de agências, e a esteira de votos
 * cobre 3. Prometer voto individual nas 12 seria, para fora, o mesmo defeito que a Fase 31 inteira
 * perseguiu dentro: um número afirmando o que o dado não sustenta.
 *
 * Por isso a etapa 3 declara a cobertura em vez de deixar subentendida.
 */
export interface EtapaDoRadar { numero: string; titulo: string; texto: string }

export const ETAPAS_DO_RADAR: readonly EtapaDoRadar[] = [
  {
    numero: "01",
    titulo: "Monitora as fontes oficiais",
    texto:
      "Acompanha os portais das agências e detecta pauta, ata, voto e deliberação novos assim que " +
      "são publicados — sem depender de alguém lembrar de olhar.",
  },
  {
    numero: "02",
    titulo: "Extrai o conteúdo dos PDFs",
    texto:
      "Lê os documentos oficiais e estrutura o que está neles: número, processo, interessado, " +
      "microtema e resultado. O que a leitura não sustenta fica marcado para revisão humana, não " +
      "é preenchido por suposição.",
  },
  {
    numero: "03",
    titulo: "Materializa o voto de cada diretor",
    texto:
      "Transforma a decisão colegiada em voto individual, auditável um a um contra o PDF de origem. " +
      "Hoje com cobertura de esteira de votos na ANTT, na ANM e na ARTESP — as demais agências " +
      "entram no acompanhamento regulatório e na avaliação de qualidade.",
  },
  {
    numero: "04",
    titulo: "Avalia a qualidade regulatória",
    texto:
      "Aplica a matriz IMQN — seis critérios, de Análise de Impacto Regulatório a participação " +
      "social — sobre as 12 agências federais, com a evidência de cada nota registrada.",
  },
] as const;

/** Canais institucionais — os mesmos já usados pela newsletter, para não haver duas verdades. */
export const CANAIS = {
  instagram: "https://www.instagram.com/iris.regulacao/",
  linkedin: "https://www.linkedin.com/company/irisregulacao/",
  site: "https://irisregulacao.org/",
  eventos: "https://irisregulacao.org/eventos/",
  email: "contato@irisregulacao.org",
} as const;
