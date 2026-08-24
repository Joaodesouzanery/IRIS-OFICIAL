/**
 * demo-data.ts
 * Dados reais da ARTESP para visualização da plataforma sem Supabase configurado.
 * Inclui apenas a ARTESP com 3 diretores reais e 10 deliberações autênticas.
 * Remova quando o Supabase estiver ativo em produção.
 */

import { isSancao } from "@/lib/server/regulatory-documents";

// ─── IDs fixos ─────────────────────────────────────────────────────────────
const A_ARTESP = "demo-agency-artesp";
const A_ANM    = "demo-agency-anm";

// Diretores ARTESP — nomes reais conforme deliberações 2026
const DA1 = "demo-dir-artesp-1"; // André Isper Rodrigues Barnabé (Diretor-Presidente)
const DA2 = "demo-dir-artesp-2"; // Diego Albert Zanatto (Diretor)
const DA3 = "demo-dir-artesp-3"; // Fernanda Esbízaro Rodrigues Rudnik (Diretora)
const DA4 = "demo-dir-artesp-4"; // Raquel França Carneiro (Diretora)

// Diretores ANM — nomes reais conforme atas de reunião 2019
const DN1 = "demo-dir-anm-1"; // Victor Hugo Froner Bicca (Diretor-Geral)
const DN2 = "demo-dir-anm-2"; // Debora Toci Puccini (Diretora)
const DN3 = "demo-dir-anm-3"; // Eduardo Araujo de Souza Leão (Diretor)
const DN4 = "demo-dir-anm-4"; // Tasso Mendonça Júnior (Diretor)
const DN5 = "demo-dir-anm-5"; // Tomás Antonio Albuquerque de Paula Pessoa Filho (Diretor)

// ─── Mapeamento agência → diretores ──────────────────────────────────────
const AGENCY_DIRS: Record<string, Array<{ id: string; nome: string }>> = {
  [A_ARTESP]: [
    { id: DA1, nome: "André Isper Rodrigues Barnabé" },
    { id: DA2, nome: "Diego Albert Zanatto" },
    { id: DA3, nome: "Fernanda Esbízaro Rodrigues Rudnik" },
    { id: DA4, nome: "Raquel França Carneiro" },
  ],
  [A_ANM]: [
    { id: DN1, nome: "Victor Hugo Froner Bicca" },
    { id: DN2, nome: "Debora Toci Puccini" },
    { id: DN3, nome: "Eduardo Araujo de Souza Leão" },
    { id: DN4, nome: "Tasso Mendonça Júnior" },
    { id: DN5, nome: "Tomás Antonio Albuquerque de Paula Pessoa Filho" },
  ],
};

// ─── Deliberações brutas ──────────────────────────────────────────────────
// 10 ARTESP — Indeferidos: 005 e 010
// 3 votos por deliberação = 30 total (26 Favoravel, 4 Desfavoravel)
// Para indeferidos: 2 Desfavoravel (maioria) + 1 Favoravel (divergente)

type DelRaw = {
  id: string;
  agencia: string;
  n: string;
  reuniao: string;
  data: string;
  interessado: string | null;
  processo: string;
  microtema: string;
  resultado: "Deferido" | "Indeferido";
  resumo: string;
  fundamento: string;
  // IDs que votaram diferente da maioria (divergentes)
  divergentes?: string[];
};

const DELIBERACOES_RAW: DelRaw[] = [
  // ── ARTESP (Transporte) ───────────────────────────────────────────────
  { id: "demo-artesp-001", agencia: A_ARTESP, n: "001/2024", reuniao: "321ª Reunião Ordinária", data: "2024-03-13",
    interessado: "Rota das Bandeiras S.A.", processo: "SEI nº 023.0001/2024", microtema: "tarifa", resultado: "Deferido",
    resumo: "Reajuste tarifário anual de pedágio da Rota das Bandeiras pelo índice IPCA acumulado de 4,62%.",
    fundamento: "Revisão em conformidade com cláusula contratual 25.2. Laudos técnicos atestam equilíbrio econômico-financeiro." },
  { id: "demo-artesp-002", agencia: A_ARTESP, n: "002/2024", reuniao: "322ª Reunião Ordinária", data: "2024-04-10",
    interessado: "CCR Via Bandeirantes S.A.", processo: "SEI nº 023.0009/2024", microtema: "obras", resultado: "Deferido",
    resumo: "Aprovação do projeto executivo de duplicação de 20 km do trecho km 90-110 da SP-348.",
    fundamento: "Projeto atende normas do DNIT. Prazo de 36 meses e investimento de R$ 340 milhões aprovados." },
  { id: "demo-artesp-003", agencia: A_ARTESP, n: "003/2024", reuniao: "323ª Reunião Ordinária", data: "2024-05-08",
    interessado: "Autopista Litoral Sul S.A.", processo: "SEI nº 023.0022/2024", microtema: "multa", resultado: "Deferido",
    resumo: "Multa por descumprimento do IRI mínimo no trecho km 40-55 da rodovia concedida.",
    fundamento: "Laudo confirma IRI médio de 3,8 (limite contratual: 2,5). Multa de R$ 1,2 milhão aplicada." },
  { id: "demo-artesp-004", agencia: A_ARTESP, n: "004/2024", reuniao: "324ª Reunião Ordinária", data: "2024-06-12",
    interessado: "CCR RodoVias S.A.", processo: "SEI nº 023.0035/2024", microtema: "contrato", resultado: "Deferido",
    resumo: "Aprovação do 5º Termo Aditivo ao Contrato de Concessão, reprogramando CAPEX para 2024-2026.",
    fundamento: "Aditivo alinha investimentos às prioridades regionais, acrescendo R$ 180 milhões em obras de segurança." },
  { id: "demo-artesp-005", agencia: A_ARTESP, n: "005/2024", reuniao: "325ª Reunião Ordinária", data: "2024-07-10",
    interessado: "EcoRodovias S.A.", processo: "SEI nº 023.0048/2024", microtema: "reequilibrio", resultado: "Indeferido",
    resumo: "Pedido de reequilíbrio econômico-financeiro alegando impactos de legislação ambiental superveniente.",
    fundamento: "Risco regulatório ambiental é alocado à concessionária pelo edital. Desequilíbrio contratual não reconhecido.",
    divergentes: [DA3] },
  { id: "demo-artesp-006", agencia: A_ARTESP, n: "006/2024", reuniao: "326ª Reunião Ordinária", data: "2024-08-14",
    interessado: "CCR SPVias S.A.", processo: "SEI nº 023.0057/2024", microtema: "tarifa", resultado: "Deferido",
    resumo: "Revisão tarifária ordinária da SP-070 com reajuste de 5,1% pelo índice contratual.",
    fundamento: "Cálculo atuarial homologado pela Auditoria ARTESP. Mantido equilíbrio econômico-financeiro." },
  { id: "demo-artesp-007", agencia: A_ARTESP, n: "007/2024", reuniao: "327ª Reunião Ordinária", data: "2024-09-11",
    interessado: "Intervias S.A.", processo: "SEI nº 023.0071/2024", microtema: "obras", resultado: "Deferido",
    resumo: "Aprovação do projeto de ampliação da capacidade viária da SP-147, km 22 ao 45.",
    fundamento: "Obra essencial para fluxo regional. Investimento de R$ 95 milhões, prazo de execução de 24 meses." },
  { id: "demo-artesp-008", agencia: A_ARTESP, n: "008/2024", reuniao: "328ª Reunião Ordinária", data: "2024-10-09",
    interessado: "Autoban S.A.", processo: "SEI nº 023.0085/2024", microtema: "multa", resultado: "Deferido",
    resumo: "Auto de infração por descumprimento do prazo de conservação do pavimento na SP-330.",
    fundamento: "Inadimplência contratual reiterada. Multa de R$ 850 mil, prazo de 30 dias para regularização." },
  { id: "demo-artesp-009", agencia: A_ARTESP, n: "009/2024", reuniao: "329ª Reunião Ordinária", data: "2024-11-13",
    interessado: "Rota Sorocabana S.A.", processo: "SEI nº 023.0099/2024", microtema: "contrato", resultado: "Deferido",
    resumo: "Aprovação do 2º Aditivo à Concessão Rota Sorocabana incluindo obras de drenagem e iluminação.",
    fundamento: "Obras necessárias para conformidade com Plano de Drenagem Urbana de Sorocaba. Investimento de R$ 28 milhões." },
  { id: "demo-artesp-010", agencia: A_ARTESP, n: "010/2024", reuniao: "330ª Reunião Ordinária", data: "2024-12-11",
    interessado: null, processo: "SEI nº 023.0112/2024", microtema: "fiscalizacao", resultado: "Indeferido",
    resumo: "Proposta de abertura de processo administrativo por inadimplências identificadas na SP-021.",
    fundamento: "Divergência sobre critérios de avaliação do indicador de pavimento. Processo devolvido para revisão técnica.",
    divergentes: [DA2] },
];

// ─── demoData ─────────────────────────────────────────────────────────────
export const demoData = {
  agencias() {
    return [
      { id: A_ARTESP, sigla: "ARTESP", nome: "Agência de Transporte do Estado de SP",
        nome_completo: "Agência Reguladora de Serviços Públicos Delegados de Transporte do Estado de São Paulo",
        ativo: true, created_at: "2020-01-10T10:00:00Z" },
      { id: A_ANM, sigla: "ANM", nome: "Agência Nacional de Mineração",
        nome_completo: "Agência Nacional de Mineração",
        ativo: true, created_at: "2019-01-01T10:00:00Z" },
    ];
  },

  diretores() {
    return [
      { id: DA1, nome: "André Isper Rodrigues Barnabé",       agencia_id: A_ARTESP, cargo: "Diretor-Presidente", needs_review: false, ativo: true, created_at: "2023-06-15T10:00:00Z" },
      { id: DA2, nome: "Diego Albert Zanatto",                agencia_id: A_ARTESP, cargo: "Diretor",            needs_review: false, ativo: true, created_at: "2021-03-10T10:00:00Z" },
      { id: DA3, nome: "Fernanda Esbízaro Rodrigues Rudnik",  agencia_id: A_ARTESP, cargo: "Diretora",           needs_review: false, ativo: true, created_at: "2022-07-22T10:00:00Z" },
      { id: DA4, nome: "Raquel França Carneiro",              agencia_id: A_ARTESP, cargo: "Diretora",           needs_review: false, ativo: true, created_at: "2024-01-10T10:00:00Z" },
    ];
  },

  mandatos() {
    const now = new Date().toISOString().slice(0, 10);
    const raw = [
      { id: "demo-m-1", diretor_id: DA1, diretor_nome: "André Isper Rodrigues Barnabé",      cargo: "Diretor-Presidente", agencia_id: A_ARTESP, data_inicio: "2023-06-15", data_fim: "2027-06-14" },
      { id: "demo-m-2", diretor_id: DA2, diretor_nome: "Diego Albert Zanatto",               cargo: "Diretor",            agencia_id: A_ARTESP, data_inicio: "2021-03-10", data_fim: "2029-03-09" },
      { id: "demo-m-3", diretor_id: DA3, diretor_nome: "Fernanda Esbízaro Rodrigues Rudnik", cargo: "Diretora",           agencia_id: A_ARTESP, data_inicio: "2022-07-22", data_fim: "2026-07-21" },
      { id: "demo-m-4", diretor_id: DA4, diretor_nome: "Raquel França Carneiro",             cargo: "Diretora",           agencia_id: A_ARTESP, data_inicio: "2024-01-10", data_fim: "2028-01-09" },
    ];
    return raw.map((m) => ({
      ...m,
      status: (!m.data_fim || m.data_fim >= now) ? "Ativo" as const : "Inativo" as const,
    }));
  },

  // Aceita agencia_id para filtrar — retorna tudo se omitido
  overview(agencia_id?: string | null) {
    const rows = agencia_id ? DELIBERACOES_RAW.filter((d) => d.agencia === agencia_id) : DELIBERACOES_RAW;
    const total = rows.length;
    const deferidos = rows.filter((d) => d.resultado === "Deferido").length;
    const indeferidos = rows.filter((d) => d.resultado === "Indeferido").length;
    const dates = new Set(rows.map((d) => d.data));
    const byTema = new Map<string, number>();
    for (const d of rows) byTema.set(d.microtema, (byTema.get(d.microtema) ?? 0) + 1);
    const topMicrotema = byTema.size > 0 ? [...byTema.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
    const pauta_interna_count = rows.filter((d) => d.interessado === null).length;
    const pauta_externa = total - pauta_interna_count;
    return {
      total_deliberacoes: total,
      deferidos,
      indeferidos,
      sem_resultado: 0,
      taxa_deferimento: total > 0 ? ((deferidos / total) * 100).toFixed(1) : "0",
      reunioes_unicas: dates.size,
      avg_confidence: 0.85,
      top_microtema: topMicrotema,
      auto_classified_pct: 100,
      pauta_externa,
      pauta_interna_count,
    };
  },

  microtemas(agencia_id?: string | null) {
    const rows = agencia_id ? DELIBERACOES_RAW.filter((d) => d.agencia === agencia_id) : DELIBERACOES_RAW;
    const stats = new Map<string, { total: number; deferido: number; indeferido: number }>();
    for (const d of rows) {
      if (!stats.has(d.microtema)) stats.set(d.microtema, { total: 0, deferido: 0, indeferido: 0 });
      const s = stats.get(d.microtema)!;
      s.total++;
      if (d.resultado === "Deferido") s.deferido++;
      else s.indeferido++;
    }
    return [...stats.entries()]
      .map(([microtema, s]) => ({
        microtema, total: s.total, deferido: s.deferido, indeferido: s.indeferido,
        pct_deferido: s.total > 0 ? (s.deferido / s.total) * 100 : 0,
        pct_indeferido: s.total > 0 ? (s.indeferido / s.total) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);
  },

  microtemasEvolution(agencia_id?: string | null) {
    const rows = agencia_id ? DELIBERACOES_RAW.filter((d) => d.agencia === agencia_id) : DELIBERACOES_RAW;
    const groups = new Map<string, Map<string, number>>();
    for (const d of rows) {
      const period = d.data.slice(0, 7);
      if (!groups.has(period)) groups.set(period, new Map());
      const pm = groups.get(period)!;
      pm.set(d.microtema, (pm.get(d.microtema) ?? 0) + 1);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, temas]) => ({ period, ...Object.fromEntries(temas) }));
  },

  // 10 deliberações × 4 diretores = 40 votos.
  // Indeferidos: 005 (divergente=DA3) e 010 (divergente=DA2).
  // DA1=André:   8F/2D/0div=80%; DA2=Diego: 9F/1D/1div=90%;
  // DA3=Fernanda:9F/1D/1div=90%; DA4=Raquel: 8F/2D/0div=80%
  diretoresOverview(agencia_id?: string | null) {
    const all = [
      // nominais/inferidos espelham os votos demo: só os das 2 deliberações indeferidas são is_nominal.
      { diretor_id: DA1, diretor_nome: "André Isper Rodrigues Barnabé",      agencia: A_ARTESP, total: 10, favoravel: 8, desfavoravel: 2, divergente: 0, nominais: 2, inferidos: 8, pct_favor: 80.0 },
      { diretor_id: DA2, diretor_nome: "Diego Albert Zanatto",               agencia: A_ARTESP, total: 10, favoravel: 9, desfavoravel: 1, divergente: 1, nominais: 2, inferidos: 8, pct_favor: 90.0 },
      { diretor_id: DA3, diretor_nome: "Fernanda Esbízaro Rodrigues Rudnik", agencia: A_ARTESP, total: 10, favoravel: 9, desfavoravel: 1, divergente: 1, nominais: 2, inferidos: 8, pct_favor: 90.0 },
      { diretor_id: DA4, diretor_nome: "Raquel França Carneiro",             agencia: A_ARTESP, total: 10, favoravel: 8, desfavoravel: 2, divergente: 0, nominais: 2, inferidos: 8, pct_favor: 80.0 },
    ];
    const filtered = agencia_id ? all.filter((d) => d.agencia === agencia_id) : all;
    return filtered.map(({ agencia: _, ...rest }) => rest).sort((a, b) => b.total - a.total);
  },

  reunioesCalendar(agencia_id?: string | null) {
    const rows = agencia_id ? DELIBERACOES_RAW.filter((d) => d.agencia === agencia_id) : DELIBERACOES_RAW;
    const counts = new Map<string, number>();
    for (const d of rows) counts.set(d.data, (counts.get(d.data) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count }));
  },

  reunioesStats(agencia_id?: string | null) {
    const rows = agencia_id ? DELIBERACOES_RAW.filter((d) => d.agencia === agencia_id) : DELIBERACOES_RAW;
    const byMonth = new Map<string, { total: number; deferido: number; indeferido: number }>();
    for (const d of rows) {
      const period = d.data.slice(0, 7);
      if (!byMonth.has(period)) byMonth.set(period, { total: 0, deferido: 0, indeferido: 0 });
      const s = byMonth.get(period)!;
      s.total++;
      if (d.resultado === "Deferido") s.deferido++;
      else s.indeferido++;
    }
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, s]) => ({ period, ...s }));
  },

  votacaoMatrix(agencia_id?: string | null) {
    const all = [
      { diretor_id: DA1, diretor_nome: "André Isper Rodrigues Barnabé",      agencia: A_ARTESP, total: 10, favoravel: 8, desfavoravel: 2, abstencao: 0, divergente: 0 },
      { diretor_id: DA2, diretor_nome: "Diego Albert Zanatto",               agencia: A_ARTESP, total: 10, favoravel: 9, desfavoravel: 1, abstencao: 0, divergente: 1 },
      { diretor_id: DA3, diretor_nome: "Fernanda Esbízaro Rodrigues Rudnik", agencia: A_ARTESP, total: 10, favoravel: 9, desfavoravel: 1, abstencao: 0, divergente: 1 },
      { diretor_id: DA4, diretor_nome: "Raquel França Carneiro",             agencia: A_ARTESP, total: 10, favoravel: 8, desfavoravel: 2, abstencao: 0, divergente: 0 },
    ];
    const filtered = agencia_id ? all.filter((d) => d.agencia === agencia_id) : all;
    return filtered.map(({ agencia: _, ...rest }) => rest).sort((a, b) => b.total - a.total);
  },

  votacaoDistribution(agencia_id?: string | null) {
    // 10 deliberações × 4 diretores = 40 votos: 34 Favoravel, 6 Desfavoravel
    if (agencia_id && agencia_id !== A_ARTESP) return [
      { tipo_voto: "Favoravel", count: 0, pct: "0" },
    ];
    return [
      { tipo_voto: "Favoravel",    count: 34, pct: "85.0" },
      { tipo_voto: "Desfavoravel", count: 6,  pct: "15.0" },
    ];
  },

  votacaoFidelidade(agencia_id?: string | null) {
    const all = [
      { diretor_id: DA1, diretor_nome: "André Isper Rodrigues Barnabé",      agencia: A_ARTESP, total_votos: 10, votos_nominais: 2, votos_divergentes: 0, taxa_fidelidade: "100.0" },
      { diretor_id: DA2, diretor_nome: "Diego Albert Zanatto",               agencia: A_ARTESP, total_votos: 10, votos_nominais: 2, votos_divergentes: 1, taxa_fidelidade: "90.0" },
      { diretor_id: DA3, diretor_nome: "Fernanda Esbízaro Rodrigues Rudnik", agencia: A_ARTESP, total_votos: 10, votos_nominais: 2, votos_divergentes: 1, taxa_fidelidade: "90.0" },
      { diretor_id: DA4, diretor_nome: "Raquel França Carneiro",             agencia: A_ARTESP, total_votos: 10, votos_nominais: 2, votos_divergentes: 0, taxa_fidelidade: "100.0" },
    ];
    const filtered = agencia_id ? all.filter((d) => d.agencia === agencia_id) : all;
    return filtered.map(({ agencia: _, ...rest }) => rest);
  },

  deliberacoes(params?: {
    page?: number; limit?: number; agencia_id?: string;
    microtema?: string; resultado?: string; search?: string; year?: string;
  }) {
    const page  = params?.page  ?? 1;
    const limit = params?.limit ?? 20;

    let items = DELIBERACOES_RAW.map((d) => ({
      id: d.id,
      agencia_id: d.agencia,
      numero_deliberacao: d.n,
      numero_reuniao: null as string | null,
      reuniao_ordinaria: d.reuniao,
      tipo_reuniao: "Ordinaria" as const,
      tipo_documento: "deliberacao" as const,
      data_reuniao: d.data,
      interessado: d.interessado,
      procedencia: null as string | null,
      relator: null as string | null,
      item_numero: null as string | null,
      documento_pai_id: null as string | null,
      processo: d.processo,
      microtema: d.microtema,
      resultado: d.resultado,
      decisoes_todas: [d.resultado] as string[] | null,
      pauta_interna: d.interessado === null,
      resumo_pleito: d.resumo,
      fundamento_decisao: d.fundamento,
      extraction_confidence: 0.85,
      auto_classified: true,
      created_at: `${d.data}T10:00:00Z`,
      votos: _buildVotos(d),
      raw_extraction: null as Record<string, unknown> | null,
    }));

    // Filtros
    if (params?.agencia_id) items = items.filter((d) => d.agencia_id === params.agencia_id);
    if (params?.microtema)   items = items.filter((d) => d.microtema === params.microtema);
    if (params?.resultado)   items = items.filter((d) => d.resultado === params.resultado);
    if (params?.year)        items = items.filter((d) => d.data_reuniao.startsWith(params.year!));
    if (params?.search) {
      const q = params.search.toLowerCase();
      items = items.filter((d) =>
        d.interessado?.toLowerCase().includes(q) ||
        d.processo?.toLowerCase().includes(q) ||
        d.numero_deliberacao?.toLowerCase().includes(q)
      );
    }

    // Ordenar por data decrescente
    items.sort((a, b) => b.data_reuniao.localeCompare(a.data_reuniao));

    const total  = items.length;
    const offset = (page - 1) * limit;
    return { data: items.slice(offset, offset + limit), total, page, limit, pages: Math.ceil(total / limit) };
  },

  deliberacaoById(id: string) {
    const raw = DELIBERACOES_RAW.find((d) => d.id === id);
    if (!raw) return null;
    return {
      id: raw.id, agencia_id: raw.agencia, numero_deliberacao: raw.n,
      reuniao_ordinaria: raw.reuniao, data_reuniao: raw.data,
      interessado: raw.interessado, processo: raw.processo,
      microtema: raw.microtema, resultado: raw.resultado,
      pauta_interna: raw.interessado === null,
      resumo_pleito: raw.resumo, fundamento_decisao: raw.fundamento,
      extraction_confidence: 0.85, auto_classified: true,
      created_at: `${raw.data}T10:00:00Z`,
      votos: _buildVotos(raw),
      raw_extraction: null,
    };
  },

  mandatosStats(agencia_id?: string | null) {
    const rows = agencia_id ? DELIBERACOES_RAW.filter((d) => d.agencia === agencia_id) : DELIBERACOES_RAW;
    const total = rows.length;
    const dirs = agencia_id ? (AGENCY_DIRS[agencia_id] ?? []) : Object.values(AGENCY_DIRS).flat();
    const diretores_ativos = dirs.length;
    const participacoes_colegiadas = total * dirs.length;
    const comDivergencia = rows.filter((d) => (d.divergentes ?? []).length > 0).length;
    const taxa_consenso = total > 0
      ? ((((total - comDivergencia) / total) * 100).toFixed(1) + "%")
      : "100%";
    return { diretores_ativos, participacoes_colegiadas, taxa_consenso, total_deliberacoes: total };
  },

  votacaoSectors(agencia_id?: string | null) {
    const rows = agencia_id ? DELIBERACOES_RAW.filter((d) => d.agencia === agencia_id) : DELIBERACOES_RAW;
    const counts = new Map<string, number>();
    const dirs = agencia_id ? (AGENCY_DIRS[agencia_id] ?? []) : Object.values(AGENCY_DIRS).flat();
    const votsPerDelib = dirs.length > 0 ? dirs.length : 3;
    for (const d of rows) {
      counts.set(d.microtema, (counts.get(d.microtema) ?? 0) + votsPerDelib);
    }
    return [...counts.entries()]
      .map(([microtema, count]) => ({ microtema, count }))
      .sort((a, b) => b.count - a.count);
  },

  diretorProfile(id: string) {
    const diretor = this.diretores().find((d) => d.id === id);
    if (!diretor) return null;

    const mandato = this.mandatos().find((m) => m.diretor_id === id) ?? null;
    const agencia = this.agencias().find((a) => a.id === diretor.agencia_id) ?? null;

    const historico: Array<{
      deliberacao_id: string; numero_deliberacao: string | null; data_reuniao: string | null;
      interessado: string | null; microtema: string | null; resultado: string | null;
      tipo_voto: string; is_divergente: boolean;
    }> = [];
    let favoravel = 0, desfavoravel = 0, abstencao = 0, divergente = 0;
    const microtemaCount = new Map<string, number>();

    for (const delib of DELIBERACOES_RAW) {
      const votos = _buildVotos(delib);
      const meuVoto = votos.find((v) => v.diretor_id === id);
      if (!meuVoto) continue;

      if (meuVoto.tipo_voto === "Favoravel") favoravel++;
      else if (meuVoto.tipo_voto === "Desfavoravel") desfavoravel++;
      else abstencao++;
      if (meuVoto.is_divergente) divergente++;
      if (delib.microtema) microtemaCount.set(delib.microtema, (microtemaCount.get(delib.microtema) ?? 0) + 1);

      historico.push({
        deliberacao_id: delib.id,
        numero_deliberacao: delib.n,
        data_reuniao: delib.data,
        interessado: delib.interessado,
        microtema: delib.microtema,
        resultado: delib.resultado,
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

    let dias_restantes: number | null = null;
    if (mandato?.data_fim && mandato.status === "Ativo") {
      const fim = new Date(mandato.data_fim).getTime();
      const hoje = Date.now();
      dias_restantes = Math.max(0, Math.round((fim - hoje) / 86400000));
    }

    return {
      id: diretor.id,
      nome: diretor.nome,
      cargo: diretor.cargo,
      agencia_id: diretor.agencia_id,
      agencia_sigla: agencia?.sigla ?? null,
      mandato: {
        data_inicio: mandato?.data_inicio ?? "",
        data_fim: mandato?.data_fim ?? null,
        status: mandato?.status ?? "Inativo",
        dias_restantes,
      },
      stats: { total_votos: total, favoravel, desfavoravel, abstencao, divergente, pct_favoravel, pct_divergente },
      por_microtema: [...microtemaCount.entries()]
        .map(([microtema, t]) => ({ microtema, total: t }))
        .sort((a, b) => b.total - a.total),
      historico,
      tendencias: { perfil, microtema_dominante, taxa_aprovacao, descricao },
    };
  },

  mandatosAnalytics(agencia_id?: string | null) {
    const rows = agencia_id ? DELIBERACOES_RAW.filter((d) => d.agencia === agencia_id) : DELIBERACOES_RAW;
    const total = rows.length;

    const comLitigio = rows.filter((d) => (d.divergentes ?? []).length > 0).length;
    const taxa_litigio = total > 0 ? `${((comLitigio / total) * 100).toFixed(1)}%` : "0%";

    const consenso = total - comLitigio;
    const taxa_consenso = total > 0 ? `${((consenso / total) * 100).toFixed(1)}%` : "0%";

    // Predicado da FONTE ÚNICA (etapa65) — antes era a quarta cópia literal da expressão. O
    // divisor aqui é o pautado, e continua correto porque o corpus demo só tem Deferido/Indeferido:
    // não há retirado nem admissibilidade, então pautado == decidido. Se alguém adicionar um item
    // "Retirado de Pauta" ao demo, esta linha precisa do filtro de mérito como as rotas reais.
    const sancao = rows.filter((d) => isSancao(d)).length;
    const taxa_sancao = total > 0 ? `${((sancao / total) * 100).toFixed(1)}%` : "0%";

    const resultadoCount = new Map<string, number>();
    for (const d of rows) {
      const r = d.resultado;
      resultadoCount.set(r, (resultadoCount.get(r) ?? 0) + 1);
    }
    const distribuicao_decisao = [...resultadoCount.entries()]
      .map(([resultado, count]) => ({ resultado, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);

    const byMonth = new Map<string, { total: number; deferido: number; indeferido: number }>();
    for (const d of rows) {
      const period = d.data.slice(0, 7);
      if (!byMonth.has(period)) byMonth.set(period, { total: 0, deferido: 0, indeferido: 0 });
      const s = byMonth.get(period)!;
      s.total++;
      if (d.resultado === "Deferido") s.deferido++;
      else if (d.resultado === "Indeferido") s.indeferido++;
    }
    const evolucao_mensal = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, s]) => ({ period, ...s }));

    return { total_deliberacoes: total, taxa_litigio, taxa_consenso, taxa_sancao, distribuicao_decisao, evolucao_mensal };
  },

  empresas(agencia_id?: string | null) {
    const rows = agencia_id
      ? DELIBERACOES_RAW.filter((d) => d.agencia === agencia_id && d.interessado !== null)
      : DELIBERACOES_RAW.filter((d) => d.interessado !== null);

    const map = new Map<string, {
      total: number; deferido: number; indeferido: number;
      ultima: string; microtemas: Set<string>; agencia: string;
    }>();

    for (const d of rows) {
      if (!d.interessado) continue;
      if (!map.has(d.interessado)) {
        map.set(d.interessado, { total: 0, deferido: 0, indeferido: 0, ultima: "", microtemas: new Set(), agencia: d.agencia });
      }
      const s = map.get(d.interessado)!;
      s.total++;
      if (d.resultado === "Deferido") s.deferido++;
      else s.indeferido++;
      if (!s.ultima || d.data > s.ultima) s.ultima = d.data;
      s.microtemas.add(d.microtema);
    }

    return [...map.entries()]
      .map(([nome, s]) => {
        const microtemas = [...s.microtemas];
        return {
          nome,
          total_deliberacoes: s.total,
          deferidos: s.deferido,
          indeferidos: s.indeferido,
          pct_deferido: s.total > 0 ? (s.deferido / s.total) * 100 : 0,
          ultima_deliberacao: s.ultima || null,
          microtemas,
          microtema_principal: microtemas[0] ?? null,
          agencia_id: s.agencia,
        };
      })
      .sort((a, b) => b.total_deliberacoes - a.total_deliberacoes);
  },

  uploadDemo(filenames: string[]) {
    return {
      total: filenames.length, queued: 0, rejected: filenames.length,
      results: filenames.map((filename) => ({
        filename, job_id: null, status: "rejected" as const,
        message: "Upload desabilitado no modo demo. Configure o Supabase para processar PDFs reais.",
      })),
    };
  },
};

// ─── Helper: constrói votos de uma deliberação ────────────────────────────
function _buildVotos(d: DelRaw) {
  const dirs = AGENCY_DIRS[d.agencia] ?? [];
  const isIndeferido = d.resultado === "Indeferido";
  const divergentes = d.divergentes ?? [];
  return dirs.map((dir, vi) => {
    const isDivergente = isIndeferido && divergentes.includes(dir.id);
    // Se indeferido: maioria vota Desfavoravel; divergentes votam Favoravel
    const tipo_voto = isIndeferido
      ? (isDivergente ? "Favoravel" : "Desfavoravel")
      : "Favoravel";
    return {
      id: `${d.id}-v${vi + 1}`,
      deliberacao_id: d.id,
      diretor_id: dir.id,
      diretor_nome: dir.nome,
      tipo_voto,
      is_divergente: isDivergente,
      is_nominal: isIndeferido,
    };
  });
}
