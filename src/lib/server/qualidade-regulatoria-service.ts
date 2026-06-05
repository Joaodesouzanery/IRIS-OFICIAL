import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  buildInitialDiagnostics,
  buildInitialEvidences,
  buildPremioWinners,
  calculateWeightedScore,
  rankDiagnostics,
  QUALIDADE_AGENCIAS,
  QUALIDADE_CATEGORIAS_PREMIO,
  QUALIDADE_CRITERIOS,
  QUALIDADE_FONTES,
  QUALIDADE_GUARDRAILS,
  QUALIDADE_LEGAL_REFERENCES,
  type QualidadeCategoriaPremio,
  type QualidadeDiagnostico,
  type QualidadeEvidencia,
  type QualidadeFonte,
  type QualidadeNota,
  type QualidadeStatusRevisao,
} from "@/lib/server/qualidade-regulatoria";

type AvaliacaoRow = {
  id: string;
  agencia_sigla: string;
  ano: number;
  criterio_id: number;
  nota: number | string;
  nivel: "avancado" | "em_desenvolvimento" | "inicial";
  observacao: string | null;
  fonte_avaliacao: string | null;
  status_revisao: QualidadeStatusRevisao;
  evidencias_count: number | null;
  updated_at?: string | null;
};

type DiagnosticoRow = {
  agencia_sigla: string;
  ano: number;
  score_geral: number | string;
  posicao_ranking: number | null;
  status_revisao: QualidadeStatusRevisao;
  destaques_positivos: string[] | null;
  areas_melhoria: string[] | null;
  updated_at?: string | null;
};

type EvidenceRow = QualidadeEvidencia & {
  id?: string;
  avaliacao_id?: string | null;
  created_at?: string | null;
};

export type QualidadeDashboardData = {
  ano: number;
  ranking: QualidadeDiagnostico[];
  agencias: Array<(typeof QUALIDADE_AGENCIAS)[number] & {
    score_geral: number;
    posicao_ranking: number | null;
    destaques_positivos: string[];
    areas_melhoria: string[];
    status_revisao: QualidadeStatusRevisao;
  }>;
  criterios: Array<(typeof QUALIDADE_CRITERIOS)[number] & {
    score_medio: number;
    ranking: Array<{ agencia_sigla: string; nota: number; nivel: string; posicao: number }>;
    distribuicao_niveis: Record<string, number>;
    fontes: QualidadeFonte[];
  }>;
  fontes: QualidadeFonte[];
  categorias: QualidadeCategoriaPremio[];
  premio: ReturnType<typeof buildPremioWinners>;
  evidencias_resumo: EvidenceRow[];
  matriz: Array<{
    agencia_sigla: string;
    posicao_ranking: number | null;
    score_geral: number;
    criterios: Record<number, { nota: number; nivel: string; status_revisao: QualidadeStatusRevisao; evidencias: string[] }>;
  }>;
  legal: { guardrails: string[]; references: typeof QUALIDADE_LEGAL_REFERENCES; disclaimer: string };
  metricas: {
    agencias: number;
    criterios: number;
    avaliacoes: number;
    evidencias: number;
    score_medio: number;
    diagnosticos_validados: number;
    diagnosticos_preliminares: number;
    pesos_total: number;
  };
  source: "database" | "fallback_code";
};

export async function loadQualidadeDashboardData(year: number): Promise<QualidadeDashboardData> {
  const fallbackDiagnostics = buildInitialDiagnostics(year);
  const fallbackEvidence = buildInitialEvidences(year);
  const fallback = buildDataset(year, fallbackDiagnostics, fallbackEvidence, "fallback_code");

  try {
    const db = createSupabaseServerClient();
    const [avaliacoesResult, diagnosticosResult, evidenciasResult, agenciasResult, criteriosResult, fontesResult, categoriasResult] = await Promise.all([
      db.from("qualidade_regulatoria_avaliacoes").select("id, agencia_sigla, ano, criterio_id, nota, nivel, observacao, fonte_avaliacao, status_revisao, evidencias_count, updated_at").eq("ano", year),
      db.from("qualidade_regulatoria_diagnosticos").select("agencia_sigla, ano, score_geral, posicao_ranking, status_revisao, destaques_positivos, areas_melhoria, updated_at").eq("ano", year),
      db.from("qualidade_regulatoria_evidencias").select("id, avaliacao_id, agencia_sigla, criterio_id, titulo, url, fonte, trecho_publico, data_referencia, status_revisao, created_at").limit(500),
      db.from("qualidade_regulatoria_agencias").select("*").eq("ativo", true).order("sigla"),
      db.from("qualidade_regulatoria_criterios").select("*").eq("ativo", true).order("ordem"),
      db.from("qualidade_regulatoria_fontes").select("*").order("id"),
      db.from("qualidade_regulatoria_premio_categorias").select("*").eq("ativo", true).order("id"),
    ]);

    if (avaliacoesResult.error || !avaliacoesResult.data?.length) return fallback;

    const agencias = agenciasResult.error || !agenciasResult.data?.length ? QUALIDADE_AGENCIAS : agenciasResult.data as typeof QUALIDADE_AGENCIAS;
    const criterios = criteriosResult.error || !criteriosResult.data?.length ? QUALIDADE_CRITERIOS : criteriosResult.data as typeof QUALIDADE_CRITERIOS;
    const fontes = fontesResult.error || !fontesResult.data?.length ? QUALIDADE_FONTES : fontesResult.data as QualidadeFonte[];
    const categorias = categoriasResult.error || !categoriasResult.data?.length ? QUALIDADE_CATEGORIAS_PREMIO : categoriasResult.data as QualidadeCategoriaPremio[];
    const evidencias = evidenciasResult.error ? fallbackEvidence : evidenciasResult.data as EvidenceRow[];
    const diagnostics = buildDiagnosticsFromRows(
      year,
      avaliacoesResult.data as AvaliacaoRow[],
      diagnosticosResult.error ? [] : diagnosticosResult.data as DiagnosticoRow[],
      evidencias,
      fallbackDiagnostics,
    );

    return buildDataset(year, diagnostics, evidencias, "database", agencias, criterios, fontes, categorias);
  } catch {
    return fallback;
  }
}

function buildDiagnosticsFromRows(
  year: number,
  rows: AvaliacaoRow[],
  diagnosticRows: DiagnosticoRow[],
  evidences: EvidenceRow[],
  fallback: QualidadeDiagnostico[],
) {
  const byAgency = groupBy(rows, (row) => row.agencia_sigla);
  const evidenceByAgencyCriterion = groupBy(evidences, (row) => `${row.agencia_sigla}:${row.criterio_id}`);
  const diagnosticByAgency = new Map(diagnosticRows.map((row) => [row.agencia_sigla, row]));

  const diagnostics = QUALIDADE_AGENCIAS.map((agencia) => {
    const fallbackDiag = fallback.find((item) => item.agencia_sigla === agencia.sigla);
    const agencyRows = byAgency.get(agencia.sigla) ?? [];
    const rowsByCriterion = new Map(agencyRows.map((row) => [row.criterio_id, row]));
    const notes: QualidadeNota[] = QUALIDADE_CRITERIOS.map((criterion) => {
      const row = rowsByCriterion.get(criterion.id);
      const fallbackNote = fallbackDiag?.notas.find((note) => note.criterio_id === criterion.id);
      const evidenceRows = evidenceByAgencyCriterion.get(`${agencia.sigla}:${criterion.id}`) ?? [];
      if (!row) return fallbackNote ?? {
        agencia_sigla: agencia.sigla,
        criterio_id: criterion.id,
        nota: 0,
        nivel: "inicial",
        observacao: "Criterio sem avaliacao registrada.",
        evidencias: [],
        data_avaliacao: `${year}-06-01`,
        fonte_avaliacao: "fallback_incompleto",
        status_revisao: "preliminar",
      };
      return {
        agencia_sigla: row.agencia_sigla,
        criterio_id: row.criterio_id,
        nota: Number(row.nota),
        nivel: row.nivel,
        observacao: row.observacao ?? fallbackNote?.observacao ?? "Avaliacao institucional registrada no modulo Qualidade Regulatoria.",
        evidencias: evidenceRows.map((evidence) => evidence.url).filter(Boolean),
        data_avaliacao: String(row.updated_at ?? new Date().toISOString()).slice(0, 10),
        fonte_avaliacao: row.fonte_avaliacao ?? "base_curada_2026",
        status_revisao: row.status_revisao,
      };
    });
    const diagnostic = diagnosticByAgency.get(agencia.sigla);
    const statuses = new Set(notes.map((note) => note.status_revisao));
    const status_revisao: QualidadeStatusRevisao = statuses.has("validado") && notes.every((note) => note.status_revisao === "validado") ? "validado" : "preliminar";
    return {
      agencia_sigla: agencia.sigla,
      notas: notes,
      score_geral: diagnostic ? Number(Number(diagnostic.score_geral).toFixed(1)) : calculateWeightedScore(notes),
      posicao_ranking: diagnostic?.posicao_ranking ?? null,
      destaques_positivos: diagnostic?.destaques_positivos?.length ? diagnostic.destaques_positivos : fallbackDiag?.destaques_positivos ?? [],
      areas_melhoria: diagnostic?.areas_melhoria?.length ? diagnostic.areas_melhoria : fallbackDiag?.areas_melhoria ?? [],
      ultima_atualizacao: diagnostic?.updated_at ?? new Date().toISOString(),
      status_revisao,
    };
  });

  return rankDiagnostics(diagnostics);
}

function buildDataset(
  year: number,
  diagnostics: QualidadeDiagnostico[],
  evidences: EvidenceRow[],
  source: "database" | "fallback_code",
  agencies = QUALIDADE_AGENCIAS,
  criteria = QUALIDADE_CRITERIOS,
  sources = QUALIDADE_FONTES,
  categories = QUALIDADE_CATEGORIAS_PREMIO,
): QualidadeDashboardData {
  const ranking = rankDiagnostics(diagnostics);
  const enrichedAgencies = agencies.map((agency) => {
    const diagnostic = ranking.find((item) => item.agencia_sigla === agency.sigla);
    return {
      ...agency,
      score_geral: diagnostic?.score_geral ?? 0,
      posicao_ranking: diagnostic?.posicao_ranking ?? null,
      destaques_positivos: diagnostic?.destaques_positivos ?? [],
      areas_melhoria: diagnostic?.areas_melhoria ?? [],
      status_revisao: diagnostic?.status_revisao ?? "preliminar" as const,
    };
  });
  const enrichedCriteria = criteria.map((criterion) => {
    const criterionNotes = ranking.flatMap((diag) => diag.notas.filter((note) => note.criterio_id === criterion.id));
    const criterionRanking = criterionNotes
      .map((note) => ({ agencia_sigla: note.agencia_sigla, nota: note.nota, nivel: note.nivel }))
      .sort((a, b) => b.nota - a.nota)
      .map((item, index) => ({ ...item, posicao: index + 1 }));
    return {
      ...criterion,
      score_medio: criterionNotes.length ? Number((criterionNotes.reduce((sum, note) => sum + note.nota, 0) / criterionNotes.length).toFixed(1)) : 0,
      ranking: criterionRanking,
      distribuicao_niveis: {
        avancado: criterionNotes.filter((note) => note.nivel === "avancado").length,
        em_desenvolvimento: criterionNotes.filter((note) => note.nivel === "em_desenvolvimento").length,
        inicial: criterionNotes.filter((note) => note.nivel === "inicial").length,
      },
      fontes: sources.filter((sourceItem) => criterion.fontes_coleta.includes(sourceItem.id) || sourceItem.criterios_relacionados.includes(criterion.id)),
    };
  });
  const average = ranking.length ? Number((ranking.reduce((sum, item) => sum + item.score_geral, 0) / ranking.length).toFixed(1)) : 0;

  return {
    ano: year,
    ranking,
    agencias: enrichedAgencies,
    criterios: enrichedCriteria,
    fontes: sources,
    categorias: categories,
    premio: buildPremioWinners(ranking),
    evidencias_resumo: evidences.slice(0, 240),
    matriz: ranking.map((diag) => ({
      agencia_sigla: diag.agencia_sigla,
      posicao_ranking: diag.posicao_ranking,
      score_geral: diag.score_geral,
      criterios: Object.fromEntries(diag.notas.map((note) => [
        note.criterio_id,
        { nota: note.nota, nivel: note.nivel, status_revisao: note.status_revisao, evidencias: note.evidencias },
      ])),
    })),
    legal: {
      guardrails: QUALIDADE_GUARDRAILS,
      references: QUALIDADE_LEGAL_REFERENCES,
      disclaimer: "Ranking institucional baseado em fontes publicas, evidencias oficiais e revisao metodologica. Nao representa avaliacao individual de diretores ou agentes publicos.",
    },
    metricas: {
      agencias: ranking.length,
      criterios: criteria.length,
      avaliacoes: ranking.reduce((sum, item) => sum + item.notas.length, 0),
      evidencias: evidences.length,
      score_medio: average,
      diagnosticos_validados: ranking.filter((item) => item.status_revisao === "validado").length,
      diagnosticos_preliminares: ranking.filter((item) => item.status_revisao !== "validado").length,
      pesos_total: Number(criteria.reduce((sum, item) => sum + Number(item.peso), 0).toFixed(2)),
    },
    source,
  };
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}
