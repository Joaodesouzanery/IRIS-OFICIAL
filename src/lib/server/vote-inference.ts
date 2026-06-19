import type { TipoDocumento, VotoSugerido } from "@/types";
import { findBestMatch } from "@/lib/server/name-matcher";

export type DiretorVoteRecord = {
  id: string;
  nome: string;
  nome_variantes: string[];
};

export type VotoInsertRow = {
  deliberacao_id: string;
  diretor_id: string;
  tipo_voto: "Favoravel" | "Desfavoravel" | "Ausente";
  is_divergente: boolean;
  is_nominal: boolean;
};

export function isFinalVoteDocument(input: {
  tipo_documento: TipoDocumento | string | null;
  import_counts_as_final?: boolean | null;
}) {
  if (input.import_counts_as_final === false) return false;
  return !["pauta", "voto_individual", "documento_apoio"].includes(String(input.tipo_documento ?? ""));
}

export function shouldInferVotesFromMandate(input: {
  resultado: string | null;
  tipo_documento: TipoDocumento | string | null;
  import_counts_as_final?: boolean | null;
  unanimidadeDetectada?: boolean | null;
  nomes?: string[];
  nomesContra?: string[];
}) {
  if (!isFinalVoteDocument(input)) return false;
  if (!input.resultado || input.resultado === "Retirado de Pauta") return false;
  const isUnanimous = Boolean(input.unanimidadeDetectada) || input.resultado === "Aprovado por Unanimidade";
  const hasDivergence = Boolean(input.nomesContra?.length);
  const hasNominalNames = Boolean(input.nomes?.length);
  return hasDivergence || (isUnanimous && !hasNominalNames);
}

export async function getActiveDiretoresForVote(
  db: any,
  agenciaId: string,
  dataReuniao: string | null,
  fallback: DiretorVoteRecord[],
): Promise<DiretorVoteRecord[]> {
  if (!dataReuniao) return fallback;

  const { data, error } = await db
    .from("mandatos")
    .select("diretor_id, data_inicio, data_fim, diretores!inner(id, nome, nome_variantes, agencia_id)")
    .eq("diretores.agencia_id", agenciaId)
    .lte("data_inicio", dataReuniao)
    .or(`data_fim.is.null,data_fim.gte.${dataReuniao}`);

  if (error || !data?.length) return fallback;

  const unique = new Map<string, DiretorVoteRecord>();
  for (const row of data as any[]) {
    const diretor = row.diretores;
    if (!diretor?.id) continue;
    unique.set(diretor.id, {
      id: diretor.id,
      nome: diretor.nome,
      nome_variantes: Array.isArray(diretor.nome_variantes) ? diretor.nome_variantes : [],
    });
  }

  return unique.size > 0 ? [...unique.values()] : fallback;
}

export function buildVotoRows(input: {
  deliberacao_id: string;
  nomes: string[];
  nomesContra: string[];
  nomesAusente?: string[];
  diretoresList: DiretorVoteRecord[];
  activeDiretoresList: DiretorVoteRecord[];
  inferFromMandate: boolean;
}): VotoInsertRow[] {
  const contraIds = matchIds(input.nomesContra, input.diretoresList);
  const ausenteIds = matchIds(input.nomesAusente ?? [], input.diretoresList);
  const rows = new Map<string, VotoInsertRow>();

  for (const nome of input.nomes) {
    const match = findBestMatch(nome, input.diretoresList);
    // Só atribui voto nominal com alta confiança. Matches "needsReview"
    // (0.6–0.85) ficam de fora para não atribuir voto ao diretor errado —
    // o revisor humano resolve esses casos manualmente.
    if (!match.diretorId || match.needsReview) continue;
    if (ausenteIds.has(match.diretorId)) {
      rows.set(match.diretorId, rowFor(input.deliberacao_id, match.diretorId, "Ausente", true));
    } else if (contraIds.has(match.diretorId)) {
      rows.set(match.diretorId, rowFor(input.deliberacao_id, match.diretorId, "Desfavoravel", true));
    } else {
      rows.set(match.diretorId, rowFor(input.deliberacao_id, match.diretorId, "Favoravel", true));
    }
  }

  for (const diretorId of contraIds) {
    rows.set(diretorId, rowFor(input.deliberacao_id, diretorId, "Desfavoravel", true));
  }

  for (const diretorId of ausenteIds) {
    rows.set(diretorId, rowFor(input.deliberacao_id, diretorId, "Ausente", true));
  }

  if (input.inferFromMandate) {
    for (const diretor of input.activeDiretoresList) {
      if (rows.has(diretor.id)) continue;
      rows.set(diretor.id, rowFor(input.deliberacao_id, diretor.id, "Favoravel", false));
    }
  }

  return [...rows.values()];
}

export function buildVotoRowsFromSuggestions(input: {
  deliberacao_id: string;
  votosSugeridos: VotoSugerido[];
}): VotoInsertRow[] {
  const rows = new Map<string, VotoInsertRow>();
  for (const voto of input.votosSugeridos) {
    if (!voto.diretor_id) continue;
    rows.set(voto.diretor_id, rowFor(
      input.deliberacao_id,
      voto.diretor_id,
      voto.tipo_voto,
      voto.is_nominal,
    ));
  }
  return [...rows.values()];
}

export function buildVoteSuggestions(input: {
  nomes: string[];
  nomesContra: string[];
  nomesAusente?: string[];
  diretoresList: DiretorVoteRecord[];
  activeDiretoresList: DiretorVoteRecord[];
  inferFromMandate: boolean;
}): VotoSugerido[] {
  const rows = buildVotoRows({
    deliberacao_id: "preview",
    ...input,
  });

  return rows.map((row) => {
    const diretor = input.diretoresList.find((dir) => dir.id === row.diretor_id)
      ?? input.activeDiretoresList.find((dir) => dir.id === row.diretor_id);
    return {
      nome: diretor?.nome ?? row.diretor_id,
      diretor_id: row.diretor_id,
      tipo_voto: row.tipo_voto,
      origem: row.tipo_voto === "Ausente"
        ? "ausente"
        : row.tipo_voto === "Desfavoravel"
          ? "contrario"
          : row.is_nominal
            ? "nominal"
            : "inferido_mandato",
      is_nominal: row.is_nominal,
    };
  });
}

function matchIds(names: string[], diretoresList: DiretorVoteRecord[]) {
  const ids = new Set<string>();
  for (const nome of names) {
    const match = findBestMatch(nome, diretoresList);
    // Apenas matches de alta confiança contam como voto contra/ausente.
    if (match.diretorId && !match.needsReview) ids.add(match.diretorId);
  }
  return ids;
}

function rowFor(
  deliberacaoId: string,
  diretorId: string,
  tipoVoto: "Favoravel" | "Desfavoravel" | "Ausente",
  isNominal: boolean,
): VotoInsertRow {
  return {
    deliberacao_id: deliberacaoId,
    diretor_id: diretorId,
    tipo_voto: tipoVoto,
    is_divergente: tipoVoto === "Desfavoravel",
    is_nominal: isNominal,
  };
}
