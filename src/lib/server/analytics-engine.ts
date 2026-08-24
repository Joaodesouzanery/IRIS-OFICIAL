/**
 * analytics-engine.ts
 * Pure functions that compute dashboard/analytics from Deliberacao[].
 * Used by API routes when in "local" mode (synced from client localStorage).
 * Each function returns the exact same shape as the corresponding demoData method.
 */

import type { Deliberacao, VotoEmbutido } from "@/types";
import { isFinalDecisionRecord , isConsensual, isDecidedOnMerits, decisionStatus } from "@/lib/server/regulatory-documents";
import { isResultadoPositivo } from "@/lib/utils";
import { isOrgaoInterno } from "@/lib/server/empresa-resolver";
import { canonicalizeEmpresa } from "@/lib/server/name-matcher";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function filterByAgencia(delibs: Deliberacao[], agenciaId?: string | null): Deliberacao[] {
  return agenciaId ? delibs.filter((d) => d.agencia_id === agenciaId) : delibs;
}

/** YYYY-MM-DD para N dias atrás. */
function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM para N meses atrás. */
function isoMonthAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 7);
}

/**
 * Exclui ata-parents das contagens para evitar double-counting.
 * Ata-parents são registros com tipo_documento="ata" e SEM documento_pai_id
 * (i.e., são o registro "envelope" da ata, não um item individual).
 * Items de ata TÊM documento_pai_id preenchido e devem ser contados.
 */
function excludeAtaParents(delibs: Deliberacao[]): Deliberacao[] {
  return delibs.filter(isFinalDecisionRecord);
}

function allVotos(delibs: Deliberacao[]): Array<VotoEmbutido & { delib: Deliberacao }> {
  const result: Array<VotoEmbutido & { delib: Deliberacao }> = [];
  for (const d of delibs) {
    for (const v of d.votos ?? []) {
      result.push({ ...v, delib: d });
    }
  }
  return result;
}

// ─── 19. extractDirectors ────────────────────────────────────────────────────

export function extractDirectors(delibs: Deliberacao[]) {
  const map = new Map<string, { id: string; nome: string; agencia_id: string }>();
  for (const d of delibs) {
    for (const v of d.votos ?? []) {
      if (!map.has(v.diretor_id)) {
        map.set(v.diretor_id, {
          id: v.diretor_id,
          nome: v.diretor_nome ?? v.diretor_id,
          agencia_id: d.agencia_id ?? "",
        });
      }
    }
  }
  return [...map.values()];
}

// ─── 1. computeOverview ──────────────────────────────────────────────────────

export function computeOverview(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = excludeAtaParents(filterByAgencia(delibs, agenciaId));
  const total = rows.length;
  const deferidos = rows.filter((r) => isResultadoPositivo(r.resultado)).length;
  const indeferidos = rows.filter((r) => r.resultado === "Indeferido").length;
  const sem_resultado = rows.filter((r) => !r.resultado).length;
  const decididos = rows.filter((r) => isDecidedOnMerits(r as any)).length;

  const withConf = rows.filter((r) => r.extraction_confidence != null);
  const avg_confidence = withConf.length > 0
    ? withConf.reduce((s, r) => s + (r.extraction_confidence ?? 0), 0) / withConf.length
    : 0;

  const reunioes_unicas = new Set(rows.map((r) => r.data_reuniao).filter(Boolean)).size;

  const temaCount = new Map<string, number>();
  for (const r of rows) {
    if (r.microtema) temaCount.set(r.microtema, (temaCount.get(r.microtema) ?? 0) + 1);
  }
  const top_microtema = temaCount.size > 0
    ? [...temaCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  const autoClassified = rows.filter((r) => r.auto_classified).length;
  const pauta_interna_count = rows.filter((r) => r.pauta_interna).length;

  return {
    total_deliberacoes: total,
    deferidos,
    indeferidos,
    sem_resultado,
    // Etapa60: espelho EXATO da rota /dashboard/overview — denominador de mérito.
    total_decidido: decididos,
    taxa_deferimento: decididos > 0 ? ((deferidos / decididos) * 100).toFixed(1) : "0",
    reunioes_unicas,
    avg_confidence,
    top_microtema,
    auto_classified_pct: total > 0 ? Math.round((autoClassified / total) * 100) : 0,
    pauta_externa: total - pauta_interna_count,
    pauta_interna_count,
  };
}

// ─── 2. computeMicrotemas ────────────────────────────────────────────────────

export function computeMicrotemas(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = excludeAtaParents(filterByAgencia(delibs, agenciaId));
  const stats = new Map<string, { total: number; decidido: number; deferido: number; indeferido: number }>();
  for (const d of rows) {
    const m = d.microtema ?? "outros";
    if (!stats.has(m)) stats.set(m, { total: 0, decidido: 0, deferido: 0, indeferido: 0 });
    const s = stats.get(m)!;
    s.total++;
    // Numerador e denominador no MESMO universo (etapa60): contar positivos sobre TODAS as
    // linhas com o divisor só sobre as decididas deixa a taxa passar de 100%.
    if (isDecidedOnMerits(d as any)) {
      s.decidido++;
      if (isResultadoPositivo(d.resultado)) s.deferido++;
      else if (d.resultado === "Indeferido") s.indeferido++;
    }
  }
  return [...stats.entries()]
    .map(([microtema, s]) => ({
      microtema,
      total: s.total,
      // Etapa60: `total` segue sendo o PAUTADO; os percentuais passam a dividir pelos DECIDIDOS.
      // Um microtema com muitos itens retirados de pauta tinha deferimento artificialmente baixo.
      total_decidido: s.decidido,
      deferido: s.deferido,
      indeferido: s.indeferido,
      pct_deferido: s.decidido > 0 ? (s.deferido / s.decidido) * 100 : 0,
      pct_indeferido: s.decidido > 0 ? (s.indeferido / s.decidido) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

// ─── 3. computeMicrotemasEvolution ───────────────────────────────────────────

export function computeMicrotemasEvolution(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = excludeAtaParents(filterByAgencia(delibs, agenciaId));
  const groups = new Map<string, Map<string, number>>();
  for (const d of rows) {
    const period = (d.data_reuniao ?? "").slice(0, 7);
    if (!period) continue;
    if (!groups.has(period)) groups.set(period, new Map());
    const pm = groups.get(period)!;
    const m = d.microtema ?? "outros";
    pm.set(m, (pm.get(m) ?? 0) + 1);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, temas]) => ({ period, ...Object.fromEntries(temas) }));
}

// ─── 4. computeDiretoresOverview ─────────────────────────────────────────────

export function computeDiretoresOverview(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = filterByAgencia(delibs, agenciaId);
  const map = new Map<string, {
    diretor_id: string; diretor_nome: string;
    total: number; favoravel: number; desfavoravel: number; divergente: number;
    nominais: number; inferidos: number;
  }>();

  for (const d of rows) {
    for (const v of d.votos ?? []) {
      if (!v.diretor_id) continue;
      if (!map.has(v.diretor_id)) {
        map.set(v.diretor_id, {
          diretor_id: v.diretor_id,
          diretor_nome: v.diretor_nome ?? v.diretor_id,
          total: 0, favoravel: 0, desfavoravel: 0, divergente: 0,
          nominais: 0, inferidos: 0,
        });
      }
      const s = map.get(v.diretor_id)!;
      s.total++;
      if (v.tipo_voto === "Favoravel") s.favoravel++;
      else s.desfavoravel++;
      if (v.is_divergente) s.divergente++;
      if (v.is_nominal) s.nominais++; else s.inferidos++;
    }
  }

  return [...map.values()]
    .map((s) => ({
      ...s,
      pct_favor: s.total > 0 ? Math.round((s.favoravel / s.total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

// ─── 5. computeReunioesCalendar ──────────────────────────────────────────────

export function computeReunioesCalendar(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = filterByAgencia(delibs, agenciaId);
  const counts = new Map<string, number>();
  for (const d of rows) {
    if (d.data_reuniao) counts.set(d.data_reuniao, (counts.get(d.data_reuniao) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

// ─── 6. computeReunioesStats ─────────────────────────────────────────────────

export function computeReunioesStats(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = excludeAtaParents(filterByAgencia(delibs, agenciaId));
  const byMonth = new Map<string, { total: number; decidido: number; deferido: number; indeferido: number }>();
  for (const d of rows) {
    const period = (d.data_reuniao ?? "").slice(0, 7);
    if (!period) continue;
    if (!byMonth.has(period)) byMonth.set(period, { total: 0, decidido: 0, deferido: 0, indeferido: 0 });
    const s = byMonth.get(period)!;
    s.total++;
    // Numerador e denominador no MESMO universo (etapa60): contar positivos sobre TODAS as
    // linhas com o divisor só sobre as decididas deixa a taxa passar de 100%.
    if (isDecidedOnMerits(d as any)) {
      s.decidido++;
      if (isResultadoPositivo(d.resultado)) s.deferido++;
      else if (d.resultado === "Indeferido") s.indeferido++;
    }
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, s]) => ({ period, ...s }));
}

// ─── 7. computeDelibList ─────────────────────────────────────────────────────

export function computeDelibList(
  delibs: Deliberacao[],
  params?: {
    page?: number; limit?: number; agencia_id?: string | null;
    microtema?: string | null; resultado?: string | null;
    search?: string | null; year?: string | null;
  },
) {
  const page = params?.page ?? 1;
  const limit = params?.limit ?? 20;

  let items = [...delibs];
  if (params?.agencia_id) items = items.filter((d) => d.agencia_id === params.agencia_id);
  if (params?.microtema)  items = items.filter((d) => d.microtema === params.microtema);
  if (params?.resultado)  items = items.filter((d) => d.resultado === params.resultado);
  if (params?.year)       items = items.filter((d) => (d.data_reuniao ?? "").startsWith(params.year!));
  if (params?.search) {
    const q = params.search.toLowerCase();
    items = items.filter((d) =>
      d.interessado?.toLowerCase().includes(q) ||
      d.processo?.toLowerCase().includes(q) ||
      d.numero_deliberacao?.toLowerCase().includes(q)
    );
  }

  items.sort((a, b) => (b.data_reuniao ?? "").localeCompare(a.data_reuniao ?? ""));

  const total = items.length;
  const offset = (page - 1) * limit;
  return { data: items.slice(offset, offset + limit), total, page, limit, pages: Math.ceil(total / limit) };
}

// ─── 8. computeDelibById ─────────────────────────────────────────────────────

export function computeDelibById(delibs: Deliberacao[], id: string): Deliberacao | null {
  return delibs.find((d) => d.id === id) ?? null;
}

// ─── 9. computeVotacaoMatrix ─────────────────────────────────────────────────

export function computeVotacaoMatrix(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = filterByAgencia(delibs, agenciaId);
  const map = new Map<string, {
    diretor_id: string; diretor_nome: string;
    total: number; favoravel: number; desfavoravel: number; abstencao: number; divergente: number;
  }>();

  for (const d of rows) {
    for (const v of d.votos ?? []) {
      if (!v.diretor_id) continue;
      if (!map.has(v.diretor_id)) {
        map.set(v.diretor_id, {
          diretor_id: v.diretor_id,
          diretor_nome: v.diretor_nome ?? v.diretor_id,
          total: 0, favoravel: 0, desfavoravel: 0, abstencao: 0, divergente: 0,
        });
      }
      const s = map.get(v.diretor_id)!;
      s.total++;
      if (v.tipo_voto === "Favoravel") s.favoravel++;
      else if (v.tipo_voto === "Abstencao") s.abstencao++;
      else s.desfavoravel++;
      if (v.is_divergente) s.divergente++;
    }
  }

  return [...map.values()].sort((a, b) => b.total - a.total);
}

// ─── 10. computeVotacaoDistribution ──────────────────────────────────────────

export function computeVotacaoDistribution(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = filterByAgencia(delibs, agenciaId);
  const counts = new Map<string, number>();
  let totalVotos = 0;

  for (const d of rows) {
    for (const v of d.votos ?? []) {
      counts.set(v.tipo_voto, (counts.get(v.tipo_voto) ?? 0) + 1);
      totalVotos++;
    }
  }

  return [...counts.entries()]
    .map(([tipo_voto, count]) => ({
      tipo_voto,
      count,
      pct: totalVotos > 0 ? ((count / totalVotos) * 100).toFixed(1) : "0",
    }))
    .sort((a, b) => b.count - a.count);
}

// ─── 11. computeVotacaoFidelidade ────────────────────────────────────────────

// ─── Reuniões (agrupamento de deliberações) ──────────────────────────────────
function reuniaoKey(d: Deliberacao): string {
  return `${d.agencia_id ?? "-"}__${d.data_reuniao ?? "-"}__${d.numero_reuniao ?? "-"}`;
}

export function computeReunioesList(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = filterByAgencia(delibs, agenciaId).filter((d) => d.data_reuniao && isFinalDecisionRecord(d));
  const map = new Map<string, {
    agencia_id: string | null; agencia_sigla: string | null; data_reuniao: string | null;
    numero_reuniao: string | null; tipo_reuniao: string | null;
    total_itens: number; itens_com_voto: number; total_votos: number; votos_nominais: number; votos_inferidos: number; divergencias: number;
  }>();
  for (const d of rows) {
    const key = reuniaoKey(d);
    let e = map.get(key);
    if (!e) {
      e = {
        agencia_id: d.agencia_id ?? null, agencia_sigla: d.agencia?.sigla ?? null,
        data_reuniao: d.data_reuniao, numero_reuniao: d.numero_reuniao ?? null, tipo_reuniao: d.tipo_reuniao ?? null,
        total_itens: 0, itens_com_voto: 0, total_votos: 0, votos_nominais: 0, votos_inferidos: 0, divergencias: 0,
      };
      map.set(key, e);
    }
    e.total_itens++;
    const votos = d.votos ?? [];
    e.total_votos += votos.length;
    e.votos_nominais += votos.filter((v) => v.is_nominal).length;
    e.votos_inferidos += votos.filter((v) => !v.is_nominal).length;
    // Etapa60: só entra na conta de consenso o item que TEM voto — array vazio não é concordância.
    const consensual = isConsensual(votos);
    if (consensual !== null) {
      e.itens_com_voto++;
      if (!consensual) e.divergencias++;
    }
  }
  return [...map.entries()]
    .map(([slug, e]) => ({
      slug, ...e,
      pct_consenso: e.itens_com_voto > 0
        ? Math.round(((e.itens_com_voto - e.divergencias) / e.itens_com_voto) * 1000) / 10
        : 0,
    }))
    .sort((a, b) => (b.data_reuniao ?? "").localeCompare(a.data_reuniao ?? ""));
}

export function computeReuniaoDetalhe(
  delibs: Deliberacao[],
  key: { agenciaId: string | null; dataReuniao: string | null; numeroReuniao: string | null },
) {
  const rows = delibs.filter((d) =>
    isFinalDecisionRecord(d) &&
    (d.agencia_id ?? null) === key.agenciaId &&
    (d.data_reuniao ?? null) === key.dataReuniao &&
    (d.numero_reuniao ?? null) === (key.numeroReuniao ?? null),
  );
  if (rows.length === 0) return null;

  let deferidos = 0, indeferidos = 0, divergencias = 0, votos_nominais = 0, votos_inferidos = 0;
  let itensComVoto = 0;
  const dirMap = new Map<string, { id: string; nome: string; favoravel: number; desfavoravel: number; divergente: number; nominais: number; inferidos: number }>();
  const itens = rows.map((d) => {
    if (isResultadoPositivo(d.resultado)) deferidos++;
    else if (d.resultado === "Indeferido") indeferidos++;
    const consensualItem = isConsensual(d.votos);
    if (consensualItem !== null) {
      itensComVoto++;
      if (!consensualItem) divergencias++;
    }
    for (const v of d.votos ?? []) {
      if (v.is_nominal) votos_nominais++; else votos_inferidos++;
      if (!v.diretor_id) continue;
      let e = dirMap.get(v.diretor_id);
      if (!e) { e = { id: v.diretor_id, nome: v.diretor_nome ?? v.diretor_id, favoravel: 0, desfavoravel: 0, divergente: 0, nominais: 0, inferidos: 0 }; dirMap.set(v.diretor_id, e); }
      if (v.tipo_voto === "Favoravel") e.favoravel++;
      else if (v.tipo_voto === "Desfavoravel") e.desfavoravel++;
      if (v.is_divergente) e.divergente++;
      if (v.is_nominal) e.nominais++; else e.inferidos++;
    }
    return {
      deliberacao_id: d.id,
      numero_deliberacao: d.numero_deliberacao,
      interessado: d.interessado,
      microtema: d.microtema,
      resultado: d.resultado,
      votos: (d.votos ?? []).map((v) => ({
        diretor_id: v.diretor_id, diretor_nome: v.diretor_nome, tipo_voto: v.tipo_voto, is_divergente: v.is_divergente, is_nominal: v.is_nominal,
      })),
    };
  });

  const first = rows[0];
  return {
    cabecalho: {
      agencia_id: first.agencia_id ?? null,
      agencia_sigla: first.agencia?.sigla ?? null,
      data_reuniao: first.data_reuniao,
      numero_reuniao: first.numero_reuniao ?? null,
      tipo_reuniao: first.tipo_reuniao ?? null,
    },
    resumo: {
      total_itens: rows.length, deferidos, indeferidos, divergencias,
      // Denominador do consenso: itens COM VOTO (etapa60), publicado para o leitor saber a base.
      itens_com_voto: itensComVoto,
      votos_nominais, votos_inferidos,
      pct_consenso: itensComVoto > 0 ? Math.round(((itensComVoto - divergencias) / itensComVoto) * 1000) / 10 : 0,
    },
    itens,
    diretores: [...dirMap.values()].sort((a, b) => (b.favoravel + b.desfavoravel) - (a.favoravel + a.desfavoravel)),
  };
}

export function computeConsensoTimeline(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = filterByAgencia(delibs, agenciaId).filter((d) => d.data_reuniao && isFinalDecisionRecord(d));
  const byMonth = new Map<string, { total: number; com_voto: number; divergentes: number; com_voto_nominal: number }>();
  for (const d of rows) {
    const period = (d.data_reuniao ?? "").slice(0, 7);
    if (!period) continue;
    const m = byMonth.get(period) ?? { total: 0, com_voto: 0, divergentes: 0, com_voto_nominal: 0 };
    m.total++;
    const consensualMes = isConsensual(d.votos);
    if (consensualMes !== null) {
      m.com_voto++;
      if (!consensualMes) m.divergentes++;
    }
    if ((d.votos ?? []).some((v) => v.is_nominal)) m.com_voto_nominal++;
    byMonth.set(period, m);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, m]) => ({
      period,
      total_itens: m.total,
      consensuais: m.total - m.divergentes,
      divergentes: m.divergentes,
      pct_consenso: m.total > 0 ? Math.round(((m.total - m.divergentes) / m.total) * 1000) / 10 : 0,
      // % de itens com ao menos um voto nominal — o consenso só é confiável onde há base nominal.
      cobertura_nominal: m.total > 0 ? Math.round((m.com_voto_nominal / m.total) * 1000) / 10 : 0,
    }));
}

export function computeVotacaoFidelidade(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = filterByAgencia(delibs, agenciaId);
  const map = new Map<string, {
    diretor_id: string; diretor_nome: string;
    total_votos: number; votos_nominais: number; votos_divergentes: number;
  }>();

  for (const d of rows) {
    for (const v of d.votos ?? []) {
      if (!v.diretor_id) continue;
      if (!map.has(v.diretor_id)) {
        map.set(v.diretor_id, {
          diretor_id: v.diretor_id,
          diretor_nome: v.diretor_nome ?? v.diretor_id,
          total_votos: 0, votos_nominais: 0, votos_divergentes: 0,
        });
      }
      const s = map.get(v.diretor_id)!;
      s.total_votos++;
      if (v.is_nominal) s.votos_nominais++;
      if (v.is_divergente) s.votos_divergentes++;
    }
  }

  return [...map.values()].map((s) => ({
    ...s,
    taxa_fidelidade: s.total_votos > 0
      ? ((1 - s.votos_divergentes / s.total_votos) * 100).toFixed(1)
      : "100.0",
  }));
}

// ─── 12. computeVotacaoSectors ───────────────────────────────────────────────

export function computeVotacaoSectors(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = filterByAgencia(delibs, agenciaId);
  const counts = new Map<string, number>();
  for (const d of rows) {
    const m = d.microtema ?? "outros";
    const votosCount = (d.votos ?? []).length;
    counts.set(m, (counts.get(m) ?? 0) + (votosCount || 1));
  }
  return [...counts.entries()]
    .map(([microtema, count]) => ({ microtema, count }))
    .sort((a, b) => b.count - a.count);
}

// ─── 13. computeMandatos ─────────────────────────────────────────────────────

export function computeMandatos(
  delibs: Deliberacao[],
  agenciaId?: string | null,
  statusFilter?: string | null,
) {
  const rows = filterByAgencia(delibs, agenciaId);
  const dirs = extractDirectors(rows);

  // Build a date range per director from deliberação dates
  const dateRange = new Map<string, { earliest: string; latest: string }>();
  for (const d of rows) {
    for (const v of d.votos ?? []) {
      const date = d.data_reuniao ?? "";
      if (!date) continue;
      const r = dateRange.get(v.diretor_id);
      if (!r) {
        dateRange.set(v.diretor_id, { earliest: date, latest: date });
      } else {
        if (date < r.earliest) r.earliest = date;
        if (date > r.latest) r.latest = date;
      }
    }
  }

  const mandatos = dirs.map((dir, i) => {
    const range = dateRange.get(dir.id);
    return {
      id: `synced-m-${i}`,
      diretor_id: dir.id,
      diretor_nome: dir.nome,
      cargo: "Diretor(a)",
      agencia_id: dir.agencia_id,
      data_inicio: range?.earliest ?? "",
      data_fim: null as string | null,
      status: "Ativo" as const,
    };
  });

  if (statusFilter) {
    return mandatos.filter((m) => m.status === statusFilter);
  }
  return mandatos;
}

// ─── 14. computeMandatosStats ────────────────────────────────────────────────

export function computeMandatosStats(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = filterByAgencia(delibs, agenciaId);
  const dirs = extractDirectors(rows);
  const total = rows.length;

  // Etapa60: denominador = itens COM VOTO. O fallback "100%" para base vazia também sai: base
  // vazia não é consenso perfeito, é ausência de dado — dizer 100% ali era o pior dos dois erros.
  const comVoto = rows.filter((d) => isConsensual(d.votos) !== null).length;
  const comDivergencia = rows.filter((d) => isConsensual(d.votos) === false).length;
  const taxa_consenso = comVoto > 0
    ? (((comVoto - comDivergencia) / comVoto) * 100).toFixed(1) + "%"
    : "—";

  return {
    diretores_ativos: dirs.length,
    participacoes_colegiadas: total * dirs.length,
    taxa_consenso,
    total_deliberacoes: total,
  };
}

// ─── 15. computeMandatosAnalytics ────────────────────────────────────────────

export function computeMandatosAnalytics(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = filterByAgencia(delibs, agenciaId);
  const total = rows.length;

  const comVoto = rows.filter((d) => isConsensual(d.votos) !== null).length;
  const comLitigio = rows.filter((d) => isConsensual(d.votos) === false).length;
  const taxa_litigio = comVoto > 0 ? `${((comLitigio / comVoto) * 100).toFixed(1)}%` : "0%";
  const taxa_consenso = comVoto > 0 ? `${(((comVoto - comLitigio) / comVoto) * 100).toFixed(1)}%` : "0%";

  const sancao = rows.filter((d) =>
    d.microtema === "multa" || d.resultado === "Indeferido"
  ).length;
  // Espelho EXATO da rota /mandatos/analytics (etapa60): sanção sobre os DECIDIDOS. O engine
  // servia o caminho demo/local com `total` (pautado) enquanto a rota já usava `decidido` — o
  // mesmo painel mostrava números diferentes conforme o modo, que é o pior tipo de divergência
  // porque some quando alguém vai conferir.
  const decididoMandatos = rows.filter((d) => isDecidedOnMerits(d as any)).length;
  const taxa_sancao = decididoMandatos > 0 ? `${((sancao / decididoMandatos) * 100).toFixed(1)}%` : "0%";

  const resultadoCount = new Map<string, number>();
  for (const d of rows) {
    const r = d.resultado ?? "Sem resultado";
    resultadoCount.set(r, (resultadoCount.get(r) ?? 0) + 1);
  }
  const distribuicao_decisao = [...resultadoCount.entries()]
    .map(([resultado, count]) => ({
      resultado,
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const byMonth = new Map<string, { total: number; decidido: number; deferido: number; indeferido: number }>();
  for (const d of rows) {
    const period = (d.data_reuniao ?? "").slice(0, 7);
    if (!period) continue;
    if (!byMonth.has(period)) byMonth.set(period, { total: 0, decidido: 0, deferido: 0, indeferido: 0 });
    const s = byMonth.get(period)!;
    s.total++;
    // Numerador e denominador no MESMO universo (etapa60): contar positivos sobre TODAS as
    // linhas com o divisor só sobre as decididas deixa a taxa passar de 100%.
    if (isDecidedOnMerits(d as any)) {
      s.decidido++;
      if (isResultadoPositivo(d.resultado)) s.deferido++;
      else if (d.resultado === "Indeferido") s.indeferido++;
    }
  }
  const evolucao_mensal = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, s]) => ({ period, ...s }));

  return {
    total_deliberacoes: total,
    total_decidido: decididoMandatos,
    total_com_voto: comVoto,
    taxa_litigio, taxa_consenso, taxa_sancao, distribuicao_decisao, evolucao_mensal,
  };
}

// ─── 16. computeDiretores ────────────────────────────────────────────────────

export function computeDiretores(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = filterByAgencia(delibs, agenciaId);
  const dirs = extractDirectors(rows);
  return dirs.map((d) => ({
    id: d.id,
    nome: d.nome,
    agencia_id: d.agencia_id,
    cargo: "Diretor(a)",
    needs_review: false,
    ativo: true,
    created_at: new Date().toISOString(),
  }));
}

// ─── 17. computeDiretorProfile ───────────────────────────────────────────────

export function computeDiretorProfile(delibs: Deliberacao[], dirId: string) {
  const allDirs = extractDirectors(delibs);
  const diretor = allDirs.find((d) => d.id === dirId);
  if (!diretor) return null;

  let favoravel = 0, desfavoravel = 0, abstencao = 0, divergente = 0;
  const microtemaCount = new Map<string, number>();
  const historico: Array<{
    deliberacao_id: string; numero_deliberacao: string | null; data_reuniao: string | null;
    interessado: string | null; microtema: string | null; resultado: string | null;
    tipo_voto: string; is_divergente: boolean;
  }> = [];

  for (const d of delibs) {
    const meuVoto = (d.votos ?? []).find((v) => v.diretor_id === dirId);
    if (!meuVoto) continue;

    if (meuVoto.tipo_voto === "Favoravel") favoravel++;
    else if (meuVoto.tipo_voto === "Abstencao") abstencao++;
    else desfavoravel++;
    if (meuVoto.is_divergente) divergente++;
    if (d.microtema) microtemaCount.set(d.microtema, (microtemaCount.get(d.microtema) ?? 0) + 1);

    historico.push({
      deliberacao_id: d.id,
      numero_deliberacao: d.numero_deliberacao,
      data_reuniao: d.data_reuniao,
      interessado: d.interessado,
      microtema: d.microtema,
      resultado: d.resultado,
      tipo_voto: meuVoto.tipo_voto,
      is_divergente: meuVoto.is_divergente,
    });
  }
  historico.sort((a, b) => (b.data_reuniao ?? "").localeCompare(a.data_reuniao ?? ""));

  const total = favoravel + desfavoravel + abstencao;
  const pct_favoravel = total > 0 ? (favoravel / total) * 100 : 0;
  const pct_divergente = total > 0 ? (divergente / total) * 100 : 0;

  const perfil: "Consensual" | "Moderadamente divergente" | "Divergente" =
    pct_divergente < 5 ? "Consensual"
    : pct_divergente < 15 ? "Moderadamente divergente"
    : "Divergente";

  const microtema_dominante = microtemaCount.size > 0
    ? [...microtemaCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  const taxa_aprovacao = total > 0 ? `${pct_favoravel.toFixed(1)}%` : "—";
  const descricao = total > 0
    ? (pct_divergente < 5
        ? `Vota com a maioria em ${(100 - pct_divergente).toFixed(0)}% dos casos`
        : `Apresentou voto divergente em ${pct_divergente.toFixed(1)}% das deliberações`)
    : "Sem histórico de votos registrado";

  return {
    id: diretor.id,
    nome: diretor.nome,
    cargo: "Diretor(a)",
    agencia_id: diretor.agencia_id,
    agencia_sigla: null,
    mandato: {
      data_inicio: historico.length > 0 ? historico[historico.length - 1].data_reuniao ?? "" : "",
      data_fim: null,
      status: "Ativo" as const,
      dias_restantes: null,
    },
    stats: { total_votos: total, favoravel, desfavoravel, abstencao, divergente, pct_favoravel, pct_divergente },
    por_microtema: [...microtemaCount.entries()]
      .map(([microtema, t]) => ({ microtema, total: t }))
      .sort((a, b) => b.total - a.total),
    historico,
    tendencias: { perfil, microtema_dominante, taxa_aprovacao, descricao },
  };
}

// ─── 18. computeEmpresas ─────────────────────────────────────────────────────

export function computeEmpresas(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = filterByAgencia(delibs, agenciaId).filter((d) => d.interessado && isFinalDecisionRecord(d));
  const map = new Map<string, {
    nome: string;
    delibs: Deliberacao[];
    microtemas: Set<string>;
    agencia: string;
  }>();

  for (const d of rows) {
    if (!d.interessado) continue;
    if (isOrgaoInterno(d.interessado)) continue; // órgão interno não é empresa regulada
    const key = canonicalizeEmpresa(d.interessado) || d.interessado;
    let entry = map.get(key);
    if (!entry) {
      entry = { nome: d.interessado, delibs: [], microtemas: new Set(), agencia: d.agencia_id ?? "" };
      map.set(key, entry);
    }
    if (d.interessado.length > entry.nome.length) entry.nome = d.interessado;
    entry.delibs.push(d);
    if (d.microtema) entry.microtemas.add(d.microtema);
  }

  return [...map.values()]
    .map((s) => {
      const nome = s.nome;
      const microtemas = [...s.microtemas];
      const total = s.delibs.length;
      const deferido = s.delibs.filter((d) => isResultadoPositivo(d.resultado)).length;
      const indeferido = s.delibs.filter((d) => d.resultado === "Indeferido").length;
      const pct_deferido = total > 0 ? (deferido / total) * 100 : 0;
      const ultima = s.delibs
        .map((d) => d.data_reuniao ?? "")
        .filter(Boolean)
        .sort()
        .at(-1) ?? "";

      // Tendência: primeira vs segunda metade do histórico
      const sorted = [...s.delibs].sort((a, b) => (a.data_reuniao ?? "").localeCompare(b.data_reuniao ?? ""));
      const mid = Math.floor(sorted.length / 2);
      const ant = sorted.slice(0, mid);
      const rec = sorted.slice(mid);
      const pct_ant = ant.length > 0 ? (ant.filter((d) => isResultadoPositivo(d.resultado)).length / ant.length) * 100 : pct_deferido;
      const pct_rec = rec.length > 0 ? (rec.filter((d) => isResultadoPositivo(d.resultado)).length / rec.length) * 100 : pct_deferido;
      const diff = pct_rec - pct_ant;
      const tendencia_direcao: "melhorando" | "estavel" | "piorando" =
        diff > 5 ? "melhorando" : diff < -5 ? "piorando" : "estavel";

      const risco_regulatorio: "alto" | "medio" | "baixo" =
        pct_deferido < 40 ? "alto" : pct_deferido < 70 ? "medio" : "baixo";

      return {
        nome,
        total_deliberacoes: total,
        deferidos: deferido,
        indeferidos: indeferido,
        pct_deferido,
        ultima_deliberacao: ultima || null,
        microtemas,
        microtema_principal: microtemas[0] ?? null,
        agencia_id: s.agencia,
        risco_regulatorio,
        tendencia_direcao,
      };
    })
    .sort((a, b) => b.total_deliberacoes - a.total_deliberacoes);
}

// ─── 20. computeEmpresaDetalhe ───────────────────────────────────────────────

export function computeEmpresaDetalhe(delibs: Deliberacao[], empresaNome: string) {
  const alvo = canonicalizeEmpresa(empresaNome) || empresaNome;
  const rows = delibs.filter(
    (d) => d.interessado != null && (canonicalizeEmpresa(d.interessado) || d.interessado) === alvo && isFinalDecisionRecord(d),
  );
  if (rows.length === 0) return null;

  const total = rows.length;
  const deferidos = rows.filter((d) => isResultadoPositivo(d.resultado)).length;
  const indeferidos = rows.filter((d) => d.resultado === "Indeferido").length;
  const pct_deferido = total > 0 ? (deferidos / total) * 100 : 0;

  const ultima = rows
    .map((d) => d.data_reuniao ?? "")
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  // Risco regulatório
  const risco_regulatorio: "alto" | "medio" | "baixo" =
    pct_deferido < 40 ? "alto" : pct_deferido < 70 ? "medio" : "baixo";

  // Tendência: metade mais antiga vs. metade mais recente
  const sorted = [...rows].sort((a, b) => (a.data_reuniao ?? "").localeCompare(b.data_reuniao ?? ""));
  const mid = Math.floor(sorted.length / 2);
  const ant = sorted.slice(0, mid);
  const rec = sorted.slice(mid);
  const pct_anterior = ant.length > 0 ? (ant.filter((d) => isResultadoPositivo(d.resultado)).length / ant.length) * 100 : pct_deferido;
  const pct_recente = rec.length > 0 ? (rec.filter((d) => isResultadoPositivo(d.resultado)).length / rec.length) * 100 : pct_deferido;
  const diff = pct_recente - pct_anterior;
  const direcao: "melhorando" | "estavel" | "piorando" =
    diff > 5 ? "melhorando" : diff < -5 ? "piorando" : "estavel";

  // Evolução mensal
  const byMonth = new Map<string, { total: number; positivo: number; negativo: number }>();
  for (const d of rows) {
    const period = (d.data_reuniao ?? "").slice(0, 7);
    if (!period) continue;
    if (!byMonth.has(period)) byMonth.set(period, { total: 0, positivo: 0, negativo: 0 });
    const s = byMonth.get(period)!;
    s.total++;
    if (isResultadoPositivo(d.resultado)) s.positivo++;
    else if (d.resultado === "Indeferido") s.negativo++;
  }
  const evolucao_mensal = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, s]) => ({ period, ...s }));

  // Microtemas breakdown
  const microtemaCount = new Map<string, number>();
  for (const d of rows) {
    const m = d.microtema ?? "outros";
    microtemaCount.set(m, (microtemaCount.get(m) ?? 0) + 1);
  }
  const microtemas_breakdown = [...microtemaCount.entries()]
    .map(([microtema, count]) => ({ microtema, count }))
    .sort((a, b) => b.count - a.count);

  // Diretores que votaram em deliberações desta empresa
  const dirMap = new Map<string, { id: string; nome: string; total: number; favoravel: number; desfavoravel: number; abstencao: number; divergente: number }>();
  for (const d of rows) {
    for (const v of d.votos ?? []) {
      if (!v.diretor_id) continue;
      if (!dirMap.has(v.diretor_id)) {
        dirMap.set(v.diretor_id, { id: v.diretor_id, nome: v.diretor_nome ?? v.diretor_id, total: 0, favoravel: 0, desfavoravel: 0, abstencao: 0, divergente: 0 });
      }
      const dir = dirMap.get(v.diretor_id)!;
      dir.total++;
      if (v.tipo_voto === "Favoravel") dir.favoravel++;
      else if (v.tipo_voto === "Desfavoravel") dir.desfavoravel++;
      else if (v.tipo_voto === "Abstencao") dir.abstencao++;
      if (v.is_divergente) dir.divergente++;
    }
  }
  const diretores = [...dirMap.values()]
    .map((d) => ({
      ...d,
      pct_favoravel: d.total > 0 ? (d.favoravel / d.total) * 100 : 0,
      pct_divergente: d.total > 0 ? (d.divergente / d.total) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // Alertas ativos
  const alertas: string[] = [];
  const iso90 = isoDateDaysAgo(90);
  const negativas90 = rows.filter((d) => d.resultado === "Indeferido" && (d.data_reuniao ?? "") >= iso90).length;
  if (negativas90 >= 2) alertas.push(`${negativas90} indeferimentos nos últimos 90 dias`);
  if (risco_regulatorio === "alto" && total >= 3) alertas.push("Taxa de aprovação abaixo de 40%");
  if (direcao === "piorando" && total >= 4) alertas.push("Tendência de queda na taxa de aprovação");

  return {
    nome: empresaNome,
    total_deliberacoes: total,
    deferidos,
    indeferidos,
    pct_deferido,
    ultima_deliberacao: ultima,
    agencia_id: rows[0].agencia_id ?? null,
    risco_regulatorio,
    tendencia: { pct_anterior, pct_recente, direcao },
    evolucao_mensal,
    microtemas_breakdown,
    diretores,
    historico: rows.sort((a, b) => (b.data_reuniao ?? "").localeCompare(a.data_reuniao ?? "")),
    alertas,
  };
}

// ─── 21. computeAlertas ──────────────────────────────────────────────────────

export function computeAlertas(delibs: Deliberacao[], agenciaId?: string | null) {
  const rows = filterByAgencia(delibs, agenciaId).filter(isFinalDecisionRecord);
  const alertas: Array<{
    id: string;
    tipo: "empresa_risco" | "tema_emergente" | "diretor_divergente";
    severity: "high" | "medium" | "low";
    titulo: string;
    mensagem: string;
    entidade: string;
    created_at: string;
  }> = [];

  const now = new Date().toISOString();
  const iso90 = isoDateDaysAgo(90);

  // ── 1. Empresas com ≥ 3 indeferimentos nos últimos 90 dias ────────────
  const empresaNeg = new Map<string, number>();
  for (const d of rows) {
    if (d.resultado === "Indeferido" && (d.data_reuniao ?? "") >= iso90 && d.interessado) {
      empresaNeg.set(d.interessado, (empresaNeg.get(d.interessado) ?? 0) + 1);
    }
  }
  for (const [empresa, count] of empresaNeg) {
    if (count >= 3) {
      alertas.push({
        id: `empresa_risco_${empresa.slice(0, 30).replace(/\s+/g, "_")}`,
        tipo: "empresa_risco",
        severity: "high",
        titulo: "Empresa em risco regulatório",
        mensagem: `${empresa} recebeu ${count} indeferimentos nos últimos 90 dias`,
        entidade: empresa,
        created_at: now,
      });
    }
  }

  // ── 2. Tema emergente: crescimento > 20% no último trimestre ──────────
  const iso3m = isoMonthAgo(3);
  const iso6m = isoMonthAgo(6);
  const temaRec = new Map<string, number>();
  const temaAnt = new Map<string, number>();

  for (const d of rows) {
    const period = (d.data_reuniao ?? "").slice(0, 7);
    const tema = d.microtema;
    if (!period || !tema) continue;
    if (period >= iso3m) temaRec.set(tema, (temaRec.get(tema) ?? 0) + 1);
    else if (period >= iso6m) temaAnt.set(tema, (temaAnt.get(tema) ?? 0) + 1);
  }

  for (const [tema, countRec] of temaRec) {
    const countAnt = temaAnt.get(tema) ?? 0;
    if (countAnt > 0 && countRec >= 3) {
      const crescimento = ((countRec - countAnt) / countAnt) * 100;
      if (crescimento > 20) {
        alertas.push({
          id: `tema_emergente_${tema}`,
          tipo: "tema_emergente",
          severity: "medium",
          titulo: "Tema em crescimento",
          mensagem: `Microtema "${tema}" cresceu ${crescimento.toFixed(0)}% no último trimestre (${countAnt} → ${countRec})`,
          entidade: tema,
          created_at: now,
        });
      }
    }
  }

  // ── 3. Diretor com divergência > 30% (mínimo 5 votos) ────────────────
  const dirStats = computeVotacaoMatrix(rows);
  for (const dir of dirStats) {
    if (dir.total >= 5) {
      const pctDiv = (dir.divergente / dir.total) * 100;
      if (pctDiv > 30) {
        alertas.push({
          id: `diretor_divergente_${dir.diretor_id}`,
          tipo: "diretor_divergente",
          severity: "medium",
          titulo: "Perfil divergente ativo",
          mensagem: `${dir.diretor_nome} votou divergentemente em ${pctDiv.toFixed(1)}% dos casos (${dir.divergente}/${dir.total})`,
          entidade: dir.diretor_id,
          created_at: now,
        });
      }
    }
  }

  return alertas.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.severity] - order[b.severity];
  });
}
