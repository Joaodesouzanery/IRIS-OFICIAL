import type { AreaRegulatoria } from "@/types";

const AREA_KEYWORDS: Array<[AreaRegulatoria, string[]]> = [
  ["rodovia", [
    "rodovia", "rodoviaria", "pedagio", "pedágio", "tarifa basica de pedagio",
    "tarifa básica de pedágio", "concessionaria de rodovia", "concessionária de rodovia",
    "br-", "praca de pedagio", "praça de pedágio", "surod",
  ]],
  ["ferrovia", [
    "ferrovia", "ferroviaria", "ferroviário", "ferroviária", "malha", "trilho",
    "transporte ferroviario", "transporte ferroviário", "autorizacao ferroviaria",
    "autorização ferroviária", "sufeg", "sufer",
  ]],
  ["rodoviario_passageiros", [
    "passageiros", "linha", "mercado", "transporte rodoviario de passageiros",
    "transporte rodoviário de passageiros", "autorizacao para operar", "termo de autorizacao",
    "termo de autorização", "supas", "permissao de linha", "permissão de linha",
  ]],
  ["cargas_logistica", [
    "carga", "cargas", "logistica", "logística", "vale-pedagio", "vale-pedágio",
    "transportador autonomo de cargas", "transportador autônomo de cargas", "rntrc",
    "tac", "frete", "transporte rodoviario de cargas",
  ]],
  ["infraestrutura_geral", [
    "infraestrutura", "obra", "obras", "faixa de dominio", "faixa de domínio",
    "demolicao", "demolição", "recuperacao", "recuperação", "sinistro",
    "reidi", "programa de exploracao", "programa de exploração",
  ]],
  ["governanca_regulatoria", [
    "resolucao", "resolução", "regulatorio", "regulatório", "sandbox",
    "audiencia publica", "audiência pública", "tomada de subsidios",
    "tomada de subsídios", "protocolo de intencoes", "protocolo de intenções",
    "cooperacao tecnica", "cooperação técnica", "avaliacao de resultado regulatorio",
  ]],
  ["administrativo", [
    "regimento interno", "processo administrativo", "gestao administrativa",
    "gestão administrativa", "contratacao", "contratação", "servidor",
    "pessoal", "organograma", "corregedoria",
  ]],
];

export function classifyAreaRegulatoria(text: string | null | undefined): AreaRegulatoria {
  const source = normalize(text ?? "");
  let best: AreaRegulatoria = "outros";
  let bestScore = 0;

  for (const [area, keywords] of AREA_KEYWORDS) {
    const score = keywords.reduce((total, keyword) => {
      const normalizedKeyword = normalize(keyword);
      return total + (source.includes(normalizedKeyword) ? Math.max(1, normalizedKeyword.split(/\s+/).length) : 0);
    }, 0);
    if (score > bestScore) {
      best = area;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : "outros";
}

export function isAreaRegulatoria(value: unknown): value is AreaRegulatoria {
  return typeof value === "string" && (AREA_KEYWORDS.some(([area]) => area === value) || value === "outros");
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
