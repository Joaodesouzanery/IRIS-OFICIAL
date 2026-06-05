import type { RegulatoryNews } from "@/types";

const MINERALS_SOURCE_URL = "https://www12.senado.leg.br/noticias/materias/2026/05/28/debatedores-pedem-controle-estatal-menor-em-politica-de-minerais-criticos";
const MINERALS_IMAGE_URL = "https://www12.senado.leg.br/noticias/materias/2026/05/28/debatedores-pedem-controle-estatal-menor-em-politica-de-minerais-criticos/20260528_00092g.jpg/mural/imagem_materia";
const MINERALS_TITLE = "Senado debate política nacional para minerais críticos e reforça necessidade de fortalecer capacidade regulatória e institucional do setor mineral";

const MINERALS_SUMMARY = "Audiência da Comissão de Infraestrutura do Senado discutiu a criação de uma política nacional para minerais críticos e estratégicos, com foco em rapidez decisória, segurança regulatória e incentivos ao investimento. O debate também expôs a necessidade de fortalecer a Agência Nacional de Mineração e as estruturas públicas já existentes para que o país aproveite a demanda global por lítio, grafite, nióbio, terras-raras e outros insumos estratégicos.";

const MINERALS_CONTENT = [
  "A Comissão de Infraestrutura do Senado voltou a discutir a criação de uma política nacional para minerais críticos e estratégicos. Representantes do setor defenderam regras capazes de acelerar decisões, atrair investimento privado e manter equilíbrio entre coordenação estatal e liberdade de mercado.",
  "O debate ocorreu no contexto dos projetos que tratam da Política Nacional de Minerais Críticos e Estratégicos. A agenda ganhou relevância porque esses minerais, como lítio, grafite, níquel, nióbio, cobalto e terras-raras, são essenciais para transição energética, semicondutores, defesa, mobilidade elétrica e tecnologias de ponta.",
  "Durante a audiência, participantes destacaram que o Brasil possui reservas relevantes e pode ocupar uma posição estratégica nas cadeias globais. Para isso, apontaram a necessidade de previsibilidade regulatória, incentivos adequados e capacidade institucional para dar vazão aos processos de pesquisa, licenciamento, fiscalização e desenvolvimento produtivo.",
  "O diretor-geral da Agência Nacional de Mineração, Mauro Henrique Moreira Sousa, alertou que a ANM ainda não tem estrutura suficiente para absorver novas atribuições previstas nas propostas em discussão. Segundo ele, o fortalecimento da agência e o uso das estruturas já existentes devem ser parte central de qualquer política pública para o setor.",
  "Também foram debatidos os riscos de excesso de controle estatal, especialmente em modelos que criem conselhos com funções executivas ou imponham barreiras sem condições concretas para formação de cadeias industriais no país. A avaliação apresentada foi que uma política de fomento à descoberta e ao investimento tende a ser mais efetiva do que uma abordagem centrada em punição e controle.",
  "Para a agenda regulatória, o ponto principal é que a política de minerais críticos dependerá não apenas de novos instrumentos legais, mas da capacidade operacional das instituições responsáveis pela regulação mineral. Sem reforço institucional, o país pode perder uma janela de oportunidade aberta pela demanda internacional por insumos estratégicos.",
].join("\n\n");

export function repairRegulatoryNewsItem<T extends RegulatoryNews>(item: T): T {
  if (!isMineralsCriticalNews(item)) return item;
  const imageUrl = chooseMineralsImageUrl(item);
  const sourceUrl = item.url || MINERALS_SOURCE_URL;

  return {
    ...item,
    titulo: item.titulo || MINERALS_TITLE,
    url: item.url,
    imagem_url: imageUrl,
    resumo: MINERALS_SUMMARY,
    conteudo: MINERALS_CONTENT,
    metadata: {
      ...(isRecord(item.metadata) ? item.metadata : {}),
      manual_repair: true,
      manual_repair_reason: "newsletter_specific_quality_fix",
      source_repair_url: sourceUrl,
      source_repair_fallback_url: MINERALS_SOURCE_URL,
      source_repair_image_url: imageUrl,
      manual_repair_applied_in_code: true,
    },
  };
}

export function repairRegulatoryNewsItems<T extends RegulatoryNews>(items: T[]): T[] {
  return items.map(repairRegulatoryNewsItem);
}

function isMineralsCriticalNews(item: RegulatoryNews) {
  const haystack = normalizeText(`${item.titulo ?? ""} ${item.url ?? ""}`);
  return (
    haystack.includes("minerais criticos") &&
    (
      haystack.includes("capacidade regulatoria") ||
      haystack.includes("controle estatal menor") ||
      haystack.includes("politica nacional")
    )
  );
}

function chooseMineralsImageUrl(item: RegulatoryNews) {
  const currentImageUrl = typeof item.imagem_url === "string" ? upgradeImageScale(item.imagem_url) : "";
  if (currentImageUrl && isPreferredOfficialImageUrl(currentImageUrl)) return currentImageUrl;
  if (currentImageUrl && !isSenateUrl(currentImageUrl)) return currentImageUrl;
  return currentImageUrl || MINERALS_IMAGE_URL;
}

function isPreferredOfficialImageUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return hostname === "gov.br" || hostname.endsWith(".gov.br");
  } catch {
    return false;
  }
}

function isSenateUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return hostname.endsWith("senado.leg.br") || hostname.endsWith("senado.gov.br");
  } catch {
    return false;
  }
}

function upgradeImageScale(value: string) {
  return value
    .replace(/\/@@images\/image\/preview\b/i, "/@@images/image/large")
    .replace(/\/@@images\/image\/mini\b/i, "/@@images/image/large")
    .replace(/\/@@images\/image\/thumb\b/i, "/@@images/image/large")
    .replace(/\/@@images\/image\/icon\b/i, "/@@images/image/large")
    .replace(/\/@@images\/image\/tile\b/i, "/@@images/image/large")
    .replace(/\/@@images\/image\/listing\b/i, "/@@images/image/large")
    .replace(/\/@@images\/image\/wide\b/i, "/@@images/image/large")
    .replace(/\/@@images\/image\/portrait\b/i, "/@@images/image/large")
    .replace(/\/@@images\/image\/teaser\b/i, "/@@images/image/large")
    .replace(/\/@@images\/image\/thumb_?[0-9]*x?[0-9]*/i, "/@@images/image/large")
    .replace(/\/@@images\/image\/preview_?[0-9]*x?[0-9]*/i, "/@@images/image/large");
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
