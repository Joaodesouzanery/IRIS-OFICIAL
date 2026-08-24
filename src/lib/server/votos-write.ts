/**
 * Etapa 58 — caminho ÚNICO de escrita na tabela `votos`.
 *
 * Três problemas que este módulo existe para resolver:
 *
 * 1. **O erro do upsert era descartado.** `await db.from("votos").upsert(...)` sem `const { error }`
 *    significa que uma violação futura de constraint apagaria os votos do documento EM SILÊNCIO —
 *    o confirm reportaria sucesso e a deliberação ficaria sem voto nenhum. Aqui o erro sempre volta.
 *
 * 2. **Três write-paths divergentes.** `confirm/route.ts` tinha a proteção do voto nominal; o
 *    backfill retroativo e o `materializar-faltantes` faziam upsert cru. O mesmo dado entrava na
 *    mesma tabela por três portas com três comportamentos.
 *
 * 3. **Colunas que ainda não existem.** A migration da etapa59 é aplicada À MÃO pelo usuário, e o
 *    deploy vem ANTES dela (regra do projeto: o código degrada sem a migration). A sonda de
 *    capacidade abaixo deixa o código gravar `proveniencia` assim que a coluna existir, SEM
 *    redeploy — e sem quebrar enquanto ela não existe.
 */

import type { VotoInsertRow } from "@/lib/server/vote-inference";
import type { VotoSugerido } from "@/types";

/**
 * Colunas de `votos` que só passam a existir com a migration `20260824120000_votos_proveniencia`.
 * Enquanto ausentes, são removidas do payload — o voto é gravado sem elas, nunca perdido.
 */
export const COLUNAS_VOTOS_OPCIONAIS = [
  "proveniencia",
  "motivo_nao_voto",
  "fonte_presenca",
  "papel",
  "confianca_match",
  "voto_em_autos",
] as const;

export type ColunaOpcional = (typeof COLUNAS_VOTOS_OPCIONAIS)[number];

type Capacidade = { presente: boolean; checadoEm: number };
const capacidade = new Map<ColunaOpcional, Capacidade>();

/**
 * TTL só para o NEGATIVO. Coluna que existe não deixa de existir: `true` é memoizado para sempre.
 * `false` expira em 60s porque a migration é aplicada à mão a qualquer momento — sem o TTL, a
 * instância continuaria gravando sem a coluna até o próximo deploy.
 */
const TTL_AUSENTE_MS = 60_000;

/** Reseta a sonda (uso em teste). */
export function resetCapacidadeVotos() {
  capacidade.clear();
}

function colunasPermitidas(agora: number): Set<ColunaOpcional> {
  const out = new Set<ColunaOpcional>();
  for (const coluna of COLUNAS_VOTOS_OPCIONAIS) {
    const cap = capacidade.get(coluna);
    // Sem informação → TENTA (é assim que a coluna nova é descoberta).
    if (!cap) { out.add(coluna); continue; }
    if (cap.presente) { out.add(coluna); continue; }
    if (agora - cap.checadoEm > TTL_AUSENTE_MS) out.add(coluna);
  }
  return out;
}

/**
 * Nome da coluna ausente quando o PostgREST/Postgres recusa o payload.
 * `PGRST204` = "column not found in schema cache" · `42703` = undefined_column.
 */
export function colunaAusenteDoErro(error: unknown): ColunaOpcional | null {
  const err = error as { code?: unknown; message?: unknown } | null;
  const code = String(err?.code ?? "");
  if (code !== "PGRST204" && code !== "42703") return null;
  const msg = String(err?.message ?? "");
  for (const coluna of COLUNAS_VOTOS_OPCIONAIS) {
    // O PostgREST cita a coluna entre aspas simples; o Postgres, entre duplas.
    if (msg.includes(`'${coluna}'`) || msg.includes(`"${coluna}"`) || new RegExp(`\\b${coluna}\\b`).test(msg)) {
      return coluna;
    }
  }
  return null;
}

function stripColunas(rows: VotoInsertRow[], permitidas: Set<ColunaOpcional>): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if ((COLUNAS_VOTOS_OPCIONAIS as readonly string[]).includes(k)) {
        if (!permitidas.has(k as ColunaOpcional) || v === undefined) continue;
      }
      out[k] = v;
    }
    return out;
  });
}

export type UpsertVotosResult = {
  gravados: number;
  /** `null` em sucesso. NUNCA descartado — é a diferença entre "sem votos" e "falhou calado". */
  error: { code?: string; message: string } | null;
  /** Colunas removidas do payload por ainda não existirem no banco. */
  colunasIgnoradas: ColunaOpcional[];
};

/**
 * Upsert cru com strip-and-retry. Cada rejeição por coluna inexistente remove AQUELA coluna e
 * tenta de novo; o laço é limitado ao número de colunas opcionais, então não há retry infinito.
 */
export async function upsertVotos(db: any, rows: VotoInsertRow[]): Promise<UpsertVotosResult> {
  if (!rows.length) return { gravados: 0, error: null, colunasIgnoradas: [] };

  const ignoradas: ColunaOpcional[] = [];
  for (let tentativa = 0; tentativa <= COLUNAS_VOTOS_OPCIONAIS.length; tentativa++) {
    const agora = Date.now();
    const permitidas = colunasPermitidas(agora);
    const payload = stripColunas(rows, permitidas);

    const { error } = await db.from("votos").upsert(payload, { onConflict: "deliberacao_id,diretor_id" });
    if (!error) {
      // Sucesso confirma que TODAS as colunas enviadas existem — memoiza o positivo.
      for (const coluna of permitidas) {
        if (payload.some((p) => coluna in p)) capacidade.set(coluna, { presente: true, checadoEm: agora });
      }
      return { gravados: rows.length, error: null, colunasIgnoradas: ignoradas };
    }

    const ausente = colunaAusenteDoErro(error);
    if (!ausente) {
      // Erro REAL (constraint, FK, RLS). Propaga — este é o silêncio que a etapa58 elimina.
      return {
        gravados: 0,
        error: { code: String((error as any)?.code ?? ""), message: String((error as any)?.message ?? error) },
        colunasIgnoradas: ignoradas,
      };
    }
    capacidade.set(ausente, { presente: false, checadoEm: agora });
    if (!ignoradas.includes(ausente)) ignoradas.push(ausente);
  }

  return {
    gravados: 0,
    error: { message: "upsert de votos falhou após remover todas as colunas opcionais" },
    colunasIgnoradas: ignoradas,
  };
}

/**
 * Upsert que NÃO rebaixa um voto nominal (lido do documento) para um voto inferido ao reprocessar
 * a mesma deliberação. O que foi LIDO prevalece sobre o que foi INFERIDO.
 *
 * Movido de `confirm/route.ts` para cá na etapa58: os outros dois write-paths faziam upsert cru e
 * podiam sobrescrever voto nominal com inferência — o reprocessamento degradava o dado.
 */
export async function upsertVotosProtegido(db: any, votoRows: VotoInsertRow[]): Promise<UpsertVotosResult> {
  if (!votoRows.length) return { gravados: 0, error: null, colunasIgnoradas: [] };

  const delibIds = [...new Set(votoRows.map((r) => r.deliberacao_id))];
  const { data: existentes, error: erroLeitura } = await db
    .from("votos")
    .select("deliberacao_id, diretor_id, is_nominal")
    .in("deliberacao_id", delibIds);

  // Falha ao LER o estado atual não pode virar "grava tudo": sem saber o que é nominal, o upsert
  // rebaixaria votos lidos. Melhor recusar e devolver o erro.
  if (erroLeitura) {
    return {
      gravados: 0,
      error: { code: String((erroLeitura as any)?.code ?? ""), message: `falha ao ler votos existentes: ${(erroLeitura as any)?.message}` },
      colunasIgnoradas: [],
    };
  }

  const nominalExistente = new Set<string>(
    (existentes ?? [])
      .filter((v: any) => v.is_nominal)
      .map((v: any) => `${v.deliberacao_id}|${v.diretor_id}`),
  );
  const toUpsert = votoRows.filter(
    (r) => r.is_nominal || !nominalExistente.has(`${r.deliberacao_id}|${r.diretor_id}`),
  );
  if (!toUpsert.length) return { gravados: 0, error: null, colunasIgnoradas: [] };

  return upsertVotos(db, toUpsert);
}

// ─── Sanitização de `votos_sugeridos` vindo do browser ─────────────────────
// Hoje o CHECK do Postgres é o ÚNICO validador desse input de usuário: o payload chega do cliente
// e vai para o banco. Allowlist explícita, no espírito do projeto (validação manual, sem zod).

const TIPOS_VOTO_VALIDOS = new Set(["Favoravel", "Desfavoravel", "Abstencao", "Ausente"]);
const ORIGENS_VALIDAS = new Set([
  "nominal", "inferido_mandato", "contrario", "abstencao", "ausente", "impedido", "revisao_humana",
]);
const MAX_VOTOS_SUGERIDOS = 30;

/** Aceita SÓ o que a allowlist reconhece; descarta o resto sem lançar. */
export function sanitizeVotosSugeridos(input: unknown): VotoSugerido[] {
  if (!Array.isArray(input)) return [];
  const out: VotoSugerido[] = [];
  const vistos = new Set<string>();

  for (const raw of input.slice(0, MAX_VOTOS_SUGERIDOS)) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as Record<string, unknown>;

    const diretor_id = typeof v.diretor_id === "string" ? v.diretor_id.trim() : "";
    // UUID do Supabase; qualquer outra coisa não é um diretor_id nosso.
    if (!/^[0-9a-fA-F-]{36}$/.test(diretor_id)) continue;
    if (vistos.has(diretor_id)) continue;

    const tipo_voto = typeof v.tipo_voto === "string" ? v.tipo_voto : "";
    if (!TIPOS_VOTO_VALIDOS.has(tipo_voto)) continue;

    const origem = typeof v.origem === "string" && ORIGENS_VALIDAS.has(v.origem) ? v.origem : "nominal";

    vistos.add(diretor_id);
    out.push({
      nome: typeof v.nome === "string" ? v.nome.slice(0, 100) : diretor_id,
      diretor_id,
      tipo_voto: tipo_voto as VotoSugerido["tipo_voto"],
      origem: origem as VotoSugerido["origem"],
      is_nominal: v.is_nominal === true,
    });
  }
  return out;
}
