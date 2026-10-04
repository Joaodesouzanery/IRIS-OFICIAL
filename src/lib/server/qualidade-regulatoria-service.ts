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
  INFRA_COMPETITIVIDADE,
  type QualidadeCategoriaPremio,
  type QualidadeDiagnostico,
  type QualidadeEvidencia,
  type QualidadeFonte,
  type QualidadeNivel,
  type QualidadeNota,
  type QualidadeStatusRevisao,
  type OrigemNota,
} from "@/lib/server/qualidade-regulatoria";
import { IMQN_REV2022, notaComprovadaEMaxima, type NotaComprovada } from "@/lib/server/imqn";
import { lerTudo } from "@/lib/server/select-all-paged";

type AvaliacaoRow = {
  id: string;
  agencia_sigla: string;
  ano: number;
  criterio_id: number;
  nota: number | string;
  nivel: QualidadeNivel;
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
  programa: typeof INFRA_COMPETITIVIDADE;
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
  /**
   * IMQN rev2022 — a matriz versionada e, por agência, NOTA COMPROVADA × MÁXIMA POSSÍVEL.
   * `comprovada` só conta condições com evidência VALIDADA; `maxima_verificavel_publica` é o teto
   * que fontes públicas conseguem provar (≈62 de 100 na rev2022).
   */
  imqn: {
    versao: string;
    fonte: string;
    maxima_verificavel_publica: number;
    criterios: Array<{
      dimensao_id: number; dimensao: string; codigo: string; nome: string; peso_na_dimensao: number;
      peso_dimensao: number; verificabilidade: string; base_legal: string; base_legal_conferida: boolean;
      nota_base_legal: string | null; condicoes: number; condicoes_publicas: number;
    }>;
    por_agencia: Record<string, NotaComprovada>;
    /** false = a tabela de avaliação por condição ainda não existe (migration não aplicada). */
    avaliacao_por_condicao_disponivel: boolean;
  };
  /** Cobertura de evidência validada por agência (dimensões com ≥1 evidência validada). */
  cobertura_validada: Record<string, number[]>;
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

    const extras = await carregarComprovacao(db, year);
    if (avaliacoesResult.error || !avaliacoesResult.data?.length) {
      return buildDataset(year, fallbackDiagnostics, fallbackEvidence, "fallback_code", undefined, undefined, undefined, undefined, extras);
    }

    const agencias = agenciasResult.error || !agenciasResult.data?.length ? QUALIDADE_AGENCIAS : agenciasResult.data as typeof QUALIDADE_AGENCIAS;
    // Usa os critérios do DB quando existem, mas mescla a descrição dos NÍVEIS e os
    // SUBCRITÉRIOS a partir do código (fonte da verdade da Matriz IMQN) — assim a UI
    // mostra os 4 níveis mesmo que o DB só guarde nome/peso/base_legal.
    const criteriosDb = criteriosResult.error || !criteriosResult.data?.length ? null : (criteriosResult.data as typeof QUALIDADE_CRITERIOS);
    const criterios = (criteriosDb ?? QUALIDADE_CRITERIOS).map((criterio) => {
      const codeMatch = QUALIDADE_CRITERIOS.find((item) => item.id === criterio.id);
      return { ...criterio, niveis: criterio.niveis ?? codeMatch?.niveis, subcriterios: criterio.subcriterios ?? codeMatch?.subcriterios };
    }) as typeof QUALIDADE_CRITERIOS;
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

    return buildDataset(year, diagnostics, evidencias, "database", agencias, criterios, fontes, categorias, extras);
  } catch {
    return fallback;
  }
}

type Comprovacao = {
  coberturaValidada: Map<string, Set<number>>;
  condicoesComprovadas: Map<string, Set<string>>;
  avaliacaoPorCondicaoDisponivel: boolean;
};

/**
 * O que está COMPROVADO: evidência validada por (agência, dimensão) e condição IMQN atendida com
 * evidência validada.
 *
 * ⚠️ `lerTudo`, não o `.limit(500)` da lista de evidências da tela: a cobertura é o PORTÃO do prêmio,
 * e um corte silencioso do PostgREST faria agência com evidência validada parecer descoberta.
 *
 * ⚠️ Degrada sem a migration rev2022: tabela ausente → nenhuma condição comprovada (nota comprovada
 * 0), e o flag diz que a avaliação por condição ainda não existe — em vez de afirmar "0 comprovado".
 */
async function carregarComprovacao(db: ReturnType<typeof createSupabaseServerClient>, year: number): Promise<Comprovacao> {
  const coberturaValidada = new Map<string, Set<number>>();
  const condicoesComprovadas = new Map<string, Set<string>>();
  let avaliacaoPorCondicaoDisponivel = false;
  try {
    const ev = await lerTudo<{ agencia_sigla: string; criterio_id: number | null }>(
      () => db.from("qualidade_regulatoria_evidencias").select("agencia_sigla, criterio_id")
        .eq("status_revisao", "validado").order("id"),
      "qualidade/evidencias-validadas");
    for (const r of ev.data ?? []) {
      if (!r.agencia_sigla || r.criterio_id == null) continue;
      const set = coberturaValidada.get(r.agencia_sigla) ?? new Set<number>();
      set.add(Number(r.criterio_id));
      coberturaValidada.set(r.agencia_sigla, set);
    }
  } catch { /* sem cobertura: ninguém concorre ao prêmio — o lado seguro */ }
  try {
    const cond = await lerTudo<{ agencia_sigla: string; condicao_id: string; dimensao?: unknown }>(
      () => db.from("qualidade_imqn_condicoes_avaliadas").select("agencia_sigla, condicao_id")
        .eq("ano", year).eq("versao", IMQN_REV2022.versao).eq("atendida", true)
        .eq("status_revisao", "validado").not("evidencia_url", "is", null).order("id"),
      "qualidade/condicoes-comprovadas");
    if (!cond.error) {
      avaliacaoPorCondicaoDisponivel = true;
      for (const r of cond.data ?? []) {
        const set = condicoesComprovadas.get(r.agencia_sigla) ?? new Set<string>();
        set.add(r.condicao_id);
        condicoesComprovadas.set(r.agencia_sigla, set);
      }
    }
  } catch { /* tabela ausente: avaliação por condição indisponível */ }
  return { coberturaValidada, condicoesComprovadas, avaliacaoPorCondicaoDisponivel };
}

/** A origem de uma linha do banco, pelo `fonte_avaliacao` que a gravou. */
function origemDaLinha(fonte: string | null): OrigemNota {
  if (fonte === "iris_auto_classificacao") return "auto";
  if (!fonte || fonte === "base_curada_2026" || fonte.startsWith("fallback")) return "curada";
  return "manual";
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
      /**
       * ⚠️ Dimensão SEM avaliação é AUSENTE — não recebe a nota curada. Antes ela era preenchida com
       * `CURATED_NOTES`, dentro de um conjunto rotulado `source: "database"`: a referência curada
       * entrava no ranking misturada com a medição, sem nada que a distinguisse.
       */
      if (!row) return {
        agencia_sigla: agencia.sigla,
        criterio_id: criterion.id,
        nota: 0,
        nivel: "inexistente",
        observacao: "Dimensão sem avaliação registrada — fora do ranking até ser avaliada.",
        evidencias: [],
        data_avaliacao: `${year}-06-01`,
        fonte_avaliacao: "sem_avaliacao",
        status_revisao: "preliminar",
        origem_nota: "ausente",
      };
      return {
        agencia_sigla: row.agencia_sigla,
        criterio_id: row.criterio_id,
        nota: Number(row.nota),
        nivel: row.nivel,
        observacao: row.observacao ?? fallbackNote?.observacao ?? "Avaliacao institucional registrada no modulo Qualidade Regulatoria.",
        evidencias: evidenceRows.map((evidence) => evidence.url).filter(Boolean),
        data_avaliacao: String(row.updated_at ?? new Date().toISOString()).slice(0, 10),
        fonte_avaliacao: row.fonte_avaliacao ?? "sem_fonte",
        status_revisao: row.status_revisao,
        origem_nota: origemDaLinha(row.fonte_avaliacao),
      };
    });
    const diagnostic = diagnosticByAgency.get(agencia.sigla);
    const statuses = new Set(notes.map((note) => note.status_revisao));
    const status_revisao: QualidadeStatusRevisao = statuses.has("validado") && notes.every((note) => note.status_revisao === "validado") ? "validado" : "preliminar";
    return {
      agencia_sigla: agencia.sigla,
      notas: notes,
      /**
       * ⚠️ SEMPRE calculado das notas. O `score_geral` gravado em `qualidade_regulatoria_diagnosticos`
       * veio do SEED CURADO de 2026 (na escala antiga de 10 critérios) — a migration IMQN apagou as
       * avaliações e NÃO apagou os diagnósticos, e nenhum código escreve nessa tabela. Ele era
       * preferido ao cálculo: o ranking exibia a ordem CURADA com as notas MEDIDAS ao lado.
       */
      score_geral: calculateWeightedScore(notes),
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
  extras: Comprovacao = { coberturaValidada: new Map(), condicoesComprovadas: new Map(), avaliacaoPorCondicaoDisponivel: false },
): QualidadeDashboardData {
  const ranking = rankDiagnostics(diagnostics);
  const imqnPorAgencia: Record<string, NotaComprovada> = {};
  for (const agency of agencies) {
    imqnPorAgencia[agency.sigla] = notaComprovadaEMaxima(
      IMQN_REV2022, extras.condicoesComprovadas.get(agency.sigla) ?? new Set());
  }
  const maximaPublica = notaComprovadaEMaxima(IMQN_REV2022, new Set()).maxima_verificavel_publica;
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
        melhoria_continua: criterionNotes.filter((note) => note.nivel === "melhoria_continua").length,
        gerenciado: criterionNotes.filter((note) => note.nivel === "gerenciado").length,
        inicial: criterionNotes.filter((note) => note.nivel === "inicial").length,
        inexistente: criterionNotes.filter((note) => note.nivel === "inexistente").length,
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
    // ⚠️ O prêmio recebe a cobertura VALIDADA: sem ela (ou com nota curada) não há vencedora.
    premio: buildPremioWinners(ranking, undefined, extras.coberturaValidada),
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
    programa: INFRA_COMPETITIVIDADE,
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
    imqn: {
      versao: IMQN_REV2022.versao,
      fonte: IMQN_REV2022.fonte,
      maxima_verificavel_publica: maximaPublica,
      criterios: IMQN_REV2022.dimensoes.flatMap((d) => d.criterios.map((c) => ({
        dimensao_id: d.id,
        dimensao: d.nome,
        codigo: c.codigo,
        nome: c.nome,
        peso_na_dimensao: c.peso_na_dimensao,
        peso_dimensao: d.peso,
        verificabilidade: c.verificabilidade,
        base_legal: d.base_legal,
        base_legal_conferida: d.base_legal_conferida,
        nota_base_legal: d.nota_base_legal ?? null,
        condicoes: c.condicoes.length,
        condicoes_publicas: c.condicoes.filter((x) => x.verificabilidade === "publica").length,
      }))),
      por_agencia: imqnPorAgencia,
      avaliacao_por_condicao_disponivel: extras.avaliacaoPorCondicaoDisponivel,
    },
    cobertura_validada: Object.fromEntries(
      [...extras.coberturaValidada.entries()].map(([sigla, set]) => [sigla, [...set].sort((a, b) => a - b)])),
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
