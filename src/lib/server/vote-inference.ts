import type { TipoDocumento, VotoSugerido } from "@/types";
import { findBestMatch } from "@/lib/server/name-matcher";

export type DiretorVoteRecord = {
  id: string;
  nome: string;
  nome_variantes: string[];
};

export type TipoVoto = "Favoravel" | "Desfavoravel" | "Abstencao" | "Ausente";

export type VotoInsertRow = {
  deliberacao_id: string;
  diretor_id: string;
  tipo_voto: TipoVoto;
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
  nomesAbstencao?: string[];
  /** Nº de signatários detectados na ata (quórum) — habilita inferência ANM. */
  signatariosCount?: number;
}) {
  if (!isFinalVoteDocument(input)) return false;
  if (!input.resultado || input.resultado === "Retirado de Pauta") return false;
  const isUnanimous = Boolean(input.unanimidadeDetectada) || input.resultado === "Aprovado por Unanimidade";
  // Divergência ou abstenção quebram a unanimidade e justificam inferir o restante por mandato.
  const hasDivergence = Boolean(input.nomesContra?.length) || Boolean(input.nomesAbstencao?.length);
  const hasNominalNames = Boolean(input.nomes?.length);
  // Quórum colegiado (≥2 signatários) com resultado, mas sem voto nominal nem
  // divergência (caso típico das atas ANM): infere a decisão por mandato.
  const hasQuorum = (input.signatariosCount ?? 0) >= 2;
  return hasDivergence || (isUnanimous && !hasNominalNames) || (hasQuorum && !hasNominalNames);
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

  if (unique.size === 0) return fallback;

  // Diretores do fallback que NÃO têm nenhum mandato cadastrado não podem ser
  // excluídos por data — inclui-os de forma conservadora (evita perder votos de
  // diretores com datas de mandato ausentes).
  const { data: comMandato } = await db
    .from("mandatos")
    .select("diretor_id, diretores!inner(agencia_id)")
    .eq("diretores.agencia_id", agenciaId);
  const temMandato = new Set<string>((comMandato ?? []).map((r: any) => r.diretor_id));
  for (const d of fallback) {
    if (!temMandato.has(d.id) && !unique.has(d.id)) unique.set(d.id, d);
  }

  return [...unique.values()];
}

export function buildVotoRows(input: {
  deliberacao_id: string;
  nomes: string[];
  nomesContra: string[];
  nomesAusente?: string[];
  nomesAbstencao?: string[];
  diretoresList: DiretorVoteRecord[];
  activeDiretoresList: DiretorVoteRecord[];
  inferFromMandate: boolean;
}): VotoInsertRow[] {
  const contraIds = matchIds(input.nomesContra, input.diretoresList);
  const ausenteIds = matchIds(input.nomesAusente ?? [], input.diretoresList);
  const abstencaoIds = matchIds(input.nomesAbstencao ?? [], input.diretoresList);
  const rows = new Map<string, VotoInsertRow>();

  for (const nome of input.nomes) {
    const match = findBestMatch(nome, input.diretoresList);
    // Só atribui voto nominal com alta confiança. Matches "needsReview"
    // (0.6–0.85) ficam de fora para não atribuir voto ao diretor errado —
    // o revisor humano resolve esses casos manualmente.
    if (!match.diretorId || match.needsReview) continue;
    // Precedência: Ausente > Abstencao > Desfavoravel > Favoravel.
    if (ausenteIds.has(match.diretorId)) {
      rows.set(match.diretorId, rowFor(input.deliberacao_id, match.diretorId, "Ausente", true));
    } else if (abstencaoIds.has(match.diretorId)) {
      rows.set(match.diretorId, rowFor(input.deliberacao_id, match.diretorId, "Abstencao", true));
    } else if (contraIds.has(match.diretorId)) {
      rows.set(match.diretorId, rowFor(input.deliberacao_id, match.diretorId, "Desfavoravel", true));
    } else {
      rows.set(match.diretorId, rowFor(input.deliberacao_id, match.diretorId, "Favoravel", true));
    }
  }

  for (const diretorId of contraIds) {
    if (ausenteIds.has(diretorId) || abstencaoIds.has(diretorId)) continue;
    rows.set(diretorId, rowFor(input.deliberacao_id, diretorId, "Desfavoravel", true));
  }

  for (const diretorId of abstencaoIds) {
    if (ausenteIds.has(diretorId)) continue;
    rows.set(diretorId, rowFor(input.deliberacao_id, diretorId, "Abstencao", true));
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
  nomesAbstencao?: string[];
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
        : row.tipo_voto === "Abstencao"
          ? "abstencao"
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
  tipoVoto: TipoVoto,
  isNominal: boolean,
): VotoInsertRow {
  return {
    deliberacao_id: deliberacaoId,
    diretor_id: diretorId,
    tipo_voto: tipoVoto,
    // Abstenção não é divergência (a matriz de votação a contabiliza em coluna própria).
    is_divergente: tipoVoto === "Desfavoravel",
    is_nominal: isNominal,
  };
}
