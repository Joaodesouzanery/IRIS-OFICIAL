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
      "O Radar acompanha os portais das agências todos os dias e detecta pauta, ata, voto e " +
      "deliberação novos assim que são publicados. Nada depende de alguém lembrar de olhar, e nada " +
      "depende de a agência avisar.",
  },
  {
    numero: "02",
    titulo: "Extrai o conteúdo dos PDFs",
    texto:
      "Cada documento oficial é lido e estruturado: número, processo, interessado, relator, " +
      "microtema e resultado. O que a leitura não sustenta fica marcado para revisão humana em vez " +
      "de ser preenchido por suposição, porque um campo inventado é pior que um campo vazio.",
  },
  {
    numero: "03",
    titulo: "Materializa o voto de cada diretor",
    texto:
      "A decisão colegiada é transformada em voto individual, e cada voto aponta para o trecho do " +
      "PDF que o originou. Hoje a esteira de votos cobre a ANTT, a ANM e a ARTESP. Nas outras nove " +
      "agências federais o Radar faz acompanhamento regulatório e avaliação de qualidade, e a " +
      "página diz isso em vez de deixar subentendido.",
  },
  {
    numero: "04",
    titulo: "Avalia a qualidade regulatória",
    texto:
      "A matriz IMQN aplica seis critérios, de Análise de Impacto Regulatório a participação " +
      "social, sobre as 12 agências federais. Cada nota guarda a evidência que a sustenta, de modo " +
      "que a avaliação pode ser contestada item por item.",
  },
] as const;

/**
 * ⚠️ O QUE O LEITOR GANHA — a parte que faltava, e ela é diferente das etapas.
 *
 * As quatro etapas dizem o que o sistema FAZ. Nenhuma respondia "e daí?", que é a única pergunta que
 * um associado faz na primeira visita. Cada item aqui nomeia uma consequência concreta, e nenhum
 * promete o que a plataforma não entrega.
 */
export interface BeneficioDoRadar { titulo: string; texto: string }

export const BENEFICIOS_DO_RADAR: readonly BeneficioDoRadar[] = [
  {
    titulo: "Saber antes, não depois",
    texto:
      "A decisão aparece no painel no mesmo dia da publicação oficial, com o documento anexado. " +
      "O prazo para reagir começa a contar quando a decisão sai, não quando alguém a descobre.",
  },
  {
    titulo: "O voto com nome e sobrenome",
    texto:
      "Quem votou o quê, em qual processo, em que reunião. É o que permite entender a posição de " +
      "cada diretor ao longo do mandato em vez de ler apenas o resultado do colegiado.",
  },
  {
    titulo: "Evidência a um clique",
    texto:
      "Todo número da plataforma tem o PDF de origem do lado. Um dado que não pode ser conferido " +
      "contra o documento oficial não serve para sustentar tese, parecer nem decisão de investimento.",
  },
  {
    titulo: "Histórico que responde perguntas",
    texto:
      "A base acumula os documentos ano a ano, então dá para perguntar como um tema foi tratado ao " +
      "longo do tempo, quanto tempo um processo levou e com que frequência uma tese foi acolhida.",
  },
  {
    titulo: "Qualidade normativa medida",
    texto:
      "A matriz IMQN dá uma leitura comparável entre as 12 agências, com a evidência de cada nota " +
      "registrada. Serve para mostrar onde o ambiente regulatório é previsível e onde não é.",
  },
  {
    titulo: "Lacuna declarada é lacuna visível",
    texto:
      "Quando a leitura de um documento falha, a plataforma registra o motivo em vez de omitir a " +
      "linha. Você vê o que está coberto e o que não está, e essa é a diferença entre um painel e " +
      "uma vitrine.",
  },
] as const;

/**
 * Como o Radar trata o que não consegue ler. É a seção que um comprador técnico procura primeiro, e
 * é também um compromisso: se ela mudar, o comportamento do sistema mudou.
 */
export const METODO_DO_RADAR: readonly string[] = [
  "A fonte é sempre o documento oficial publicado pela agência. O Radar não reescreve, não resume " +
    "por aproximação e não completa campo que o documento não tem.",
  "Voto individual só é registrado quando o documento o sustenta. Em decisão unânime, o voto é " +
    "inferido do colegiado presente e fica marcado como inferido, nunca como leitura direta.",
  "Divergência entre o que a plataforma calculou e o que o documento diz é publicada como número, " +
    "não escondida. É por isso que os painéis mostram o que falta cobrir.",
] as const;

/** Canais institucionais — os mesmos já usados pela newsletter, para não haver duas verdades. */
export const CANAIS = {
  instagram: "https://www.instagram.com/iris.regulacao/",
  linkedin: "https://www.linkedin.com/company/irisregulacao/",
  site: "https://irisregulacao.org/",
  eventos: "https://irisregulacao.org/eventos/",
  email: "contato@irisregulacao.org",
} as const;
