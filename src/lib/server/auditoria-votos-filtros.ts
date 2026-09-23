/**
 * Filtros da auditoria por voto (Fase 29) — folha pura, validada à mão (o projeto não usa zod).
 *
 * ⚠️ `?limit=abc` vira `NaN` com `Number()`/`parseInt()`, e `NaN` propaga pelos `Math.min/max` até
 * o `.range()` do Supabase — erro 500 ou resultado vazio, em vez de cair no default. É o que
 * `http-params.ts` existe para impedir, e é por isso que ele é reusado aqui em vez de reescrito.
 *
 * ⚠️ Valor livre NÃO vai para `.eq()`. `tipo_voto` é conferido contra o CHECK real da tabela
 * (`Favoravel | Desfavoravel | Abstencao | Ausente`, migration 001): filtro inválido devolve 400,
 * não uma tela vazia que o operador leria como "não há votos".
 */

import { parseIntParam } from "@/lib/server/http-params";

export const TIPOS_DE_VOTO = ["Favoravel", "Desfavoravel", "Abstencao", "Ausente"] as const;
export type TipoDeVoto = (typeof TIPOS_DE_VOTO)[number];

export const LIMITE_PADRAO = 50;
export const LIMITE_MAXIMO = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ANO_RE = /^20\d{2}$/;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * O número da reunião como o banco o guarda: `deliberacoes.numero_reuniao` é VARCHAR(20)
 * (`002_expand_deliberacoes.sql:32`, ampliado em `20260519123000_repair_deliberacoes_columns.sql:9`).
 * Aceita dígito, letra, ordinal (79ª), ponto e traço — o bastante para "1024", "79ª", "264".
 * Recusa o resto para o filtro não virar entrada livre numa consulta.
 */
const REUNIAO_RE = /^[0-9A-Za-zºª./-]{1,20}$/;

export interface FiltrosDaAuditoria {
  diretor_id: string | null;
  agencia_id: string | null;
  ano: string | null;
  /**
   * ⚠️ Filtra por `deliberacoes.numero_reuniao`, NÃO por `reuniao_id`. `ensureReuniao` só grava o
   * vínculo quando a data existe (`reunioes.ts:75`), então filtrar pela FK excluiria em silêncio
   * exatamente as deliberações sem data — que são a população que mais precisa ser auditada.
   */
  numero_reuniao: string | null;
  date_from: string | null;
  date_to: string | null;
  tipo_voto: TipoDeVoto | null;
  origem: "lido" | "inferido" | null;
  divergente: boolean;
  page: number;
  limit: number;
  format: "json" | "csv";
}

export type NormalizacaoDeFiltros =
  | { ok: true; filtros: FiltrosDaAuditoria }
  | { ok: false; erro: string };

export function normalizarFiltros(params: URLSearchParams): NormalizacaoDeFiltros {
  const texto = (k: string) => {
    const v = params.get(k);
    return v === null ? null : v.trim() || null;
  };

  const uuid = (k: string): string | null | undefined => {
    const v = texto(k);
    if (v === null) return null;
    return UUID_RE.test(v) ? v : undefined; // `undefined` = inválido
  };
  const diretor_id = uuid("diretor_id");
  if (diretor_id === undefined) return { ok: false, erro: "diretor_id inválido." };
  const agencia_id = uuid("agencia_id");
  if (agencia_id === undefined) return { ok: false, erro: "agencia_id inválido." };

  const anoBruto = texto("ano");
  // Ano fora do formato é IGNORADO, não recusado: é filtro de conveniência e recusar a tela
  // inteira por causa dele seria pior que mostrar tudo.
  const ano = anoBruto && ANO_RE.test(anoBruto) ? anoBruto : null;

  const reuniaoBruta = texto("numero_reuniao");
  if (reuniaoBruta !== null && !REUNIAO_RE.test(reuniaoBruta)) {
    return { ok: false, erro: "numero_reuniao inválido (até 20 caracteres, sem espaços)." };
  }

  const data = (k: string): string | null | undefined => {
    const v = texto(k);
    if (v === null) return null;
    return DATA_RE.test(v) ? v : undefined;
  };
  const date_from = data("date_from");
  if (date_from === undefined) return { ok: false, erro: "date_from deve ser AAAA-MM-DD." };
  const date_to = data("date_to");
  if (date_to === undefined) return { ok: false, erro: "date_to deve ser AAAA-MM-DD." };

  const tipoBruto = texto("tipo_voto");
  if (tipoBruto !== null && !(TIPOS_DE_VOTO as readonly string[]).includes(tipoBruto)) {
    return { ok: false, erro: `tipo_voto deve ser um de: ${TIPOS_DE_VOTO.join(", ")}.` };
  }

  const origemBruta = texto("origem");
  // Origem desconhecida = SEM filtro. Tratá-la como "inferido" inverteria a leitura da tela — e a
  // tela existe para dizer se o voto foi lido do documento ou completado por regra.
  const origem = origemBruta === "lido" || origemBruta === "inferido" ? origemBruta : null;

  return {
    ok: true,
    filtros: {
      diretor_id, agencia_id, ano, numero_reuniao: reuniaoBruta, date_from, date_to,
      tipo_voto: (tipoBruto as TipoDeVoto | null) ?? null,
      origem,
      divergente: params.get("divergente") === "1",
      page: Math.max(1, parseIntParam(params.get("page"), 1)),
      limit: Math.min(LIMITE_MAXIMO, Math.max(1, parseIntParam(params.get("limit"), LIMITE_PADRAO))),
      format: params.get("format") === "csv" ? "csv" : "json",
    },
  };
}

/** A janela de datas efetiva: `ano` é açúcar para o par `date_from`/`date_to`. */
export function janelaDeDatas(f: FiltrosDaAuditoria): { de: string | null; ate: string | null } {
  if (f.date_from || f.date_to) return { de: f.date_from, ate: f.date_to };
  if (f.ano) return { de: `${f.ano}-01-01`, ate: `${f.ano}-12-31` };
  return { de: null, ate: null };
}

/**
 * O predicado PostgREST de "lido" × "inferido", espelhando `isVotoNominal`.
 *
 * ⚠️ O ramo `proveniencia IS NULL AND is_nominal` NÃO é opcional: `proveniencia` só existe desde
 * 24/08/2026 e a maioria do acervo é anterior. Sem ele, todo voto antigo viraria "inferido"
 * justamente na tela que existe para dizer se o dado é confiável.
 */
export function filtroOrigemPostgrest(origem: "lido" | "inferido"): string {
  return origem === "lido"
    ? "proveniencia.in.(nominal,revisao_humana),and(proveniencia.is.null,is_nominal.is.true)"
    : "proveniencia.in.(inferido_unanimidade,inferido_decisao),and(proveniencia.is.null,is_nominal.is.false)";
}
