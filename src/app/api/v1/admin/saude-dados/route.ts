/**
 * GET /api/v1/admin/saude-dados
 * Observabilidade da esteira coleta → extração → votos, SEM painel no front-end
 * (removido a pedido do usuário — Etapa 14): consulta manual por admin (sessão)
 * ou automação via CRON_SECRET. Responde:
 *   1) a base já tem deliberações/votos coletados? (ou está ligada-porém-vazia)
 *   2) onde a esteira está vazando? (fila de revisão, falhas, alertas)
 *
 * Somente leitura: agrega contagens via Supabase; em modo DEMO devolve um retrato fictício.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { findDiretorDuplicatas } from "@/lib/server/diretor-duplicatas";

export const dynamic = "force-dynamic";

// Buckets de confiança alinhados ao name-matcher (>=0.85 alta, 0.6–0.85 revisão).
const CONF_ALTA = 0.85;
const CONF_MEDIA = 0.6;

interface AgenciaSaude {
  agencia_id: string | null;
  sigla: string;
  nome: string;
  deliberacoes: number;
  deliberacoes_com_voto: number;
  votos: number;
  documentos_pendentes: number;
  documentos_falhos: number;
}

interface ExecucaoRecente {
  dominio: string | null;
  status: string | null;
  started_at: string | null;
  itens: number | null;
  novos: number | null;
  error_message: string | null;
}

export interface SaudeDadosResponse {
  gerado_em: string;
  modo: "real" | "demo";
  totais: {
    deliberacoes: number;
    deliberacoes_com_voto: number;
    deliberacoes_sem_voto: number;
    deliberacoes_so_inferidas: number;
    votos: number;
    votos_nominais: number;
    votos_inferidos: number;
    pct_cobertura_votos: number;
    pct_nominal: number;
  };
  fila: {
    documentos_total: number;
    queued: number;
    processing: number;
    review_pending: number;
    confirmed: number;
    failed: number;
    ignored: number;
    candidatos_diretores_pendentes: number;
    itens_monitorados_novos: number;
  };
  confianca: { alta: number; media: number; baixa: number; sem: number };
  por_agencia: AgenciaSaude[];
  execucoes_recentes: ExecucaoRecente[];
  // Diretores aprovados sem mandato: bloqueiam a inferência de voto por mandato.
  diretores_sem_mandato?: Array<{ diretor_id: string; nome: string; agencia_sigla: string | null }>;
  // Auditoria por amostragem: deliberações auto-confirmadas nos últimos 7 dias.
  auto_confirmadas_7d?: {
    total: number;
    amostra: Array<{ deliberacao_id: string; numero_deliberacao: string | null; agencia_sigla: string | null; created_at: string | null }>;
  };
  alertas: string[];
}

const SAUDE_DADOS_DEMO: SaudeDadosResponse = {
  gerado_em: "2026-06-23T12:00:00.000Z",
  modo: "demo",
  totais: {
    deliberacoes: 128,
    deliberacoes_com_voto: 96,
    deliberacoes_sem_voto: 32,
    deliberacoes_so_inferidas: 18,
    votos: 384,
    votos_nominais: 240,
    votos_inferidos: 144,
    pct_cobertura_votos: 75,
    pct_nominal: 63,
  },
  fila: {
    documentos_total: 47,
    queued: 3,
    processing: 1,
    review_pending: 9,
    confirmed: 31,
    failed: 3,
    ignored: 0,
    candidatos_diretores_pendentes: 4,
    itens_monitorados_novos: 6,
  },
  confianca: { alta: 71, media: 38, baixa: 12, sem: 7 },
  por_agencia: [
    { agencia_id: "demo-antt", sigla: "ANTT", nome: "Agência Nacional de Transportes Terrestres", deliberacoes: 74, deliberacoes_com_voto: 61, votos: 244, documentos_pendentes: 5, documentos_falhos: 1 },
    { agencia_id: "demo-anm", sigla: "ANM", nome: "Agência Nacional de Mineração", deliberacoes: 33, deliberacoes_com_voto: 24, votos: 96, documentos_pendentes: 2, documentos_falhos: 1 },
    { agencia_id: "demo-artesp", sigla: "ARTESP", nome: "Agência de Transporte do Estado de SP", deliberacoes: 21, deliberacoes_com_voto: 11, votos: 44, documentos_pendentes: 2, documentos_falhos: 1 },
  ],
  execucoes_recentes: [
    { dominio: "monitoramento", status: "ok", started_at: "2026-06-23T10:10:00.000Z", itens: 18, novos: 3, error_message: null },
    { dominio: "monitoramento", status: "needs_headless", started_at: "2026-06-22T10:10:00.000Z", itens: 0, novos: 0, error_message: "Página exige renderização headless" },
    { dominio: "noticias", status: "ok", started_at: "2026-06-23T11:00:00.000Z", itens: 12, novos: 5, error_message: null },
  ],
  alertas: [
    "9 documento(s) aguardando confirmação manual em Upload → Revisão.",
    "3 documento(s) falharam no processamento (PDF escaneado/erro — sem OCR ainda).",
    "32 deliberação(ões) sem nenhum voto registrado.",
    "4 candidato(s) de diretor aguardando revisão.",
  ],
};

function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json(SAUDE_DADOS_DEMO);
  }

  // Defesa em profundidade: o middleware já gate-a GET /api/v1/*, mas sem o
  // painel no front esta rota vive só para admin/cron — o guard torna isso explícito.
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const [
    agenciasRes,
    delibsRes,
    votosRes,
    docsRes,
    candidatosRes,
    itensNovosRes,
    execucoesRes,
    diretoresRes,
    mandatosRes,
    autoConfirmadasRes,
    fontesDocsRes,
  ] = await Promise.all([
    db.from("agencias").select("id, sigla, nome").eq("ativo", true),
    db.from("deliberacoes").select("id, agencia_id, extraction_confidence, numero_deliberacao, processo, data_reuniao, tipo_documento").limit(20000),
    db.from("votos").select("deliberacao_id, is_nominal").limit(50000),
    db.from("documentos_regulatorios").select("agencia_id, status").limit(20000),
    db.from("diretor_candidatos").select("id", { count: "exact", head: true }).eq("review_status", "pendente"),
    db.from("monitoramento_itens").select("id", { count: "exact", head: true }).eq("status", "novo"),
    db.from("coleta_execucoes").select("dominio, status, started_at, itens, novos, error_message").order("started_at", { ascending: false }).limit(12),
    db.from("diretores").select("id, agencia_id, nome").eq("review_status", "aprovado").limit(2000),
    db.from("mandatos").select("diretor_id").limit(10000),
    // Auditoria por AMOSTRAGEM do auto-confirm: quantas deliberações entraram sozinhas
    // nos últimos 7 dias (raw_extraction.auto_confirmado=true) + amostra p/ conferência.
    db.from("deliberacoes")
      .select("id, numero_deliberacao, agencia_id, created_at")
      .eq("raw_extraction->>auto_confirmado", "true")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(200),
    // Fontes de DOCUMENTOS sem verificação há >48h (congelamento silencioso — visto em prod).
    db.from("monitoramento_sites")
      .select("nome, ultimo_check, ultimo_status")
      .eq("ativo", true)
      .neq("tipo_fonte", "noticias"),
  ]);

  if (delibsRes.error || votosRes.error) {
    return NextResponse.json({ error: "Erro ao agregar saúde dos dados" }, { status: 500 });
  }

  const agencias: Array<{ id: string; sigla: string; nome: string }> = agenciasRes.data ?? [];
  const delibs: Array<{
    id: string;
    agencia_id: string | null;
    extraction_confidence: number | null;
    numero_deliberacao?: string | null;
    processo?: string | null;
    data_reuniao?: string | null;
    tipo_documento?: string | null;
  }> = delibsRes.data ?? [];
  const votos: Array<{ deliberacao_id: string; is_nominal: boolean }> = votosRes.data ?? [];
  const docs: Array<{ agencia_id: string | null; status: string }> = docsRes.data ?? [];

  // ── Mapas auxiliares ──────────────────────────────────────────────
  const delibAgencia = new Map<string, string | null>();
  const confianca = { alta: 0, media: 0, baixa: 0, sem: 0 };
  for (const d of delibs) {
    delibAgencia.set(d.id, d.agencia_id);
    const c = d.extraction_confidence;
    if (c == null) confianca.sem += 1;
    else if (c >= CONF_ALTA) confianca.alta += 1;
    else if (c >= CONF_MEDIA) confianca.media += 1;
    else confianca.baixa += 1;
  }

  // Deliberações com ≥1 voto (set de deliberacao_id distintos) + nominais.
  const delibsComVoto = new Set<string>();
  const delibsComNominal = new Set<string>();
  let votosNominais = 0;
  const votosPorAgencia = new Map<string | null, number>();
  for (const v of votos) {
    delibsComVoto.add(v.deliberacao_id);
    if (v.is_nominal) { votosNominais += 1; delibsComNominal.add(v.deliberacao_id); }
    const ag = delibAgencia.get(v.deliberacao_id) ?? null;
    votosPorAgencia.set(ag, (votosPorAgencia.get(ag) ?? 0) + 1);
  }
  // Deliberações com voto MAS sem nenhum voto nominal → 100% inferidas (suspeita de falsa unanimidade legada).
  let delibsSoInferidas = 0;
  for (const id of delibsComVoto) if (!delibsComNominal.has(id)) delibsSoInferidas += 1;

  // Contagens de documentos por status (global) e por agência.
  const statusCount: Record<string, number> = {};
  const docsPendPorAgencia = new Map<string | null, number>();
  const docsFalhosPorAgencia = new Map<string | null, number>();
  for (const doc of docs) {
    statusCount[doc.status] = (statusCount[doc.status] ?? 0) + 1;
    if (doc.status === "review_pending") docsPendPorAgencia.set(doc.agencia_id, (docsPendPorAgencia.get(doc.agencia_id) ?? 0) + 1);
    if (doc.status === "failed") docsFalhosPorAgencia.set(doc.agencia_id, (docsFalhosPorAgencia.get(doc.agencia_id) ?? 0) + 1);
  }

  // Deliberações por agência.
  const delibsPorAgencia = new Map<string | null, number>();
  const delibsComVotoPorAgencia = new Map<string | null, number>();
  for (const d of delibs) {
    delibsPorAgencia.set(d.agencia_id, (delibsPorAgencia.get(d.agencia_id) ?? 0) + 1);
    if (delibsComVoto.has(d.id)) delibsComVotoPorAgencia.set(d.agencia_id, (delibsComVotoPorAgencia.get(d.agencia_id) ?? 0) + 1);
  }

  const totalDelibs = delibs.length;
  const comVoto = delibsComVoto.size;
  const semVoto = Math.max(0, totalDelibs - comVoto);
  const totalVotos = votos.length;

  const porAgencia: AgenciaSaude[] = agencias
    .map((a) => ({
      agencia_id: a.id,
      sigla: a.sigla,
      nome: a.nome,
      deliberacoes: delibsPorAgencia.get(a.id) ?? 0,
      deliberacoes_com_voto: delibsComVotoPorAgencia.get(a.id) ?? 0,
      votos: votosPorAgencia.get(a.id) ?? 0,
      documentos_pendentes: docsPendPorAgencia.get(a.id) ?? 0,
      documentos_falhos: docsFalhosPorAgencia.get(a.id) ?? 0,
    }))
    .sort((a, b) => b.deliberacoes - a.deliberacoes);

  const candidatosPendentes = candidatosRes.count ?? 0;
  const itensNovos = itensNovosRes.count ?? 0;
  const reviewPending = statusCount["review_pending"] ?? 0;
  const failed = statusCount["failed"] ?? 0;

  // ── Diretores SEM mandato (bloqueia a inferência de voto por mandato) ─────
  // getActiveDiretoresForVote retorna [] quando não há mandato na data → docs de
  // unanimidade sem nomes explícitos geram 0 voto. Aqui o gap fica visível.
  const diretoresAprovados: Array<{ id: string; agencia_id: string | null; nome: string }> = diretoresRes.data ?? [];
  const diretoresComMandato = new Set((mandatosRes.data ?? []).map((m: { diretor_id: string }) => m.diretor_id));
  const semMandato = diretoresAprovados.filter((d) => !diretoresComMandato.has(d.id));
  const siglaPorAgencia = new Map(agencias.map((a) => [a.id, a.sigla]));
  const diretoresSemMandato = semMandato.map((d) => ({
    diretor_id: d.id,
    nome: d.nome,
    agencia_sigla: d.agencia_id ? siglaPorAgencia.get(d.agencia_id) ?? null : null,
  }));

  // ── Alertas derivados (o que dói, em ordem de impacto) ────────────
  const alertas: string[] = [];
  if (totalDelibs === 0) {
    alertas.push("Base real ligada, porém SEM deliberações coletadas ainda — rode a coleta ponta-a-ponta.");
  }
  if (reviewPending > 0) alertas.push(`${reviewPending} documento(s) aguardando confirmação manual em Upload → Revisão.`);
  if (failed > 0) alertas.push(`${failed} documento(s) falharam no processamento (PDF escaneado/erro — sem OCR ainda).`);
  if (semVoto > 0) alertas.push(`${semVoto} deliberação(ões) sem nenhum voto registrado.`);
  if (delibsSoInferidas > 0) alertas.push(`${delibsSoInferidas} deliberação(ões) com votos 100% inferidos (sem nome no documento) — possível unanimidade legada a revisar.`);
  if (candidatosPendentes > 0) alertas.push(`${candidatosPendentes} candidato(s) de diretor aguardando revisão.`);
  if (diretoresSemMandato.length > 0) {
    const porSigla = [...new Set(diretoresSemMandato.map((d) => d.agencia_sigla).filter(Boolean))].join("/");
    alertas.push(`${diretoresSemMandato.length} diretor(es) aprovado(s) SEM mandato cadastrado (${porSigla || "agências diversas"}) — a inferência de voto por mandato fica desligada para eles; informe data_inicio/data_fim.`);
  }
  // Fonte de documentos congelada: >48h sem verificação = risco de reuniões novas não coletadas.
  const limite48h = Date.now() - 48 * 60 * 60 * 1000;
  for (const fonte of (fontesDocsRes.data ?? []) as Array<{ nome: string; ultimo_check: string | null; ultimo_status: string | null }>) {
    const checkMs = fonte.ultimo_check ? new Date(fonte.ultimo_check).getTime() : 0;
    if (!checkMs || checkMs < limite48h) {
      const quando = fonte.ultimo_check ? new Date(fonte.ultimo_check).toLocaleDateString("pt-BR") : "nunca";
      alertas.push(`Fonte "${fonte.nome}" sem verificação há mais de 48h (última: ${quando}, status ${fonte.ultimo_status ?? "?"}) — conferir cron de monitoramento.`);
    }
  }
  for (const ex of (execucoesRes.data ?? [])) {
    if (ex.status === "error") { alertas.push(`Última coleta de ${ex.dominio} falhou: ${ex.error_message ?? "erro"}.`); break; }
  }

  // Deliberações em dobro (mesma agência+número no mesmo ano, entre finais; ou
  // mesmo processo na mesma data) — legado anterior ao dedup da importação.
  const tiposApoio = new Set(["pauta", "voto_individual", "documento_apoio"]);
  const gruposDelib = new Map<string, number>();
  for (const d of delibs) {
    if (tiposApoio.has(d.tipo_documento ?? "")) continue;
    const ano = d.data_reuniao ? d.data_reuniao.slice(0, 4) : "?";
    const key = d.numero_deliberacao
      ? `n|${d.agencia_id}|${d.numero_deliberacao}|${ano}`
      : d.processo && d.data_reuniao
        ? `p|${d.agencia_id}|${d.processo}|${d.data_reuniao}`
        : null;
    if (!key) continue;
    gruposDelib.set(key, (gruposDelib.get(key) ?? 0) + 1);
  }
  const delibsEmDobro = [...gruposDelib.values()].filter((n) => n > 1).reduce((sum, n) => sum + n - 1, 0);
  if (delibsEmDobro > 0) {
    alertas.push(`${delibsEmDobro} deliberação(ões) em DOBRO na base (mesmo número/processo) — rode POST /api/v1/admin/deliberacoes/dedup (dry-run) e depois com dry_run=0 para fundir.`);
  }

  // Diretores possivelmente duplicados no cadastro (pares fuzzy ≥0.85).
  try {
    const duplicatas = await findDiretorDuplicatas(db);
    if (duplicatas.length > 0) {
      const exemplos = duplicatas.slice(0, 3).map((p) => `"${p.dup.nome}"≈"${p.keep.nome}" (${p.agencia_sigla ?? "?"})`).join("; ");
      alertas.push(`${duplicatas.length} par(es) de diretores possivelmente DUPLICADOS: ${exemplos} — mescle no card da tela Votos dos Diretores.`);
    }
  } catch {
    // Auditoria de duplicatas é melhor-esforço.
  }

  const response: SaudeDadosResponse = {
    gerado_em: new Date().toISOString(),
    modo: "real",
    totais: {
      deliberacoes: totalDelibs,
      deliberacoes_com_voto: comVoto,
      deliberacoes_sem_voto: semVoto,
      deliberacoes_so_inferidas: delibsSoInferidas,
      votos: totalVotos,
      votos_nominais: votosNominais,
      votos_inferidos: Math.max(0, totalVotos - votosNominais),
      pct_cobertura_votos: pct(comVoto, totalDelibs),
      pct_nominal: pct(votosNominais, totalVotos),
    },
    fila: {
      documentos_total: docs.length,
      queued: statusCount["queued"] ?? 0,
      processing: statusCount["processing"] ?? 0,
      review_pending: reviewPending,
      confirmed: statusCount["confirmed"] ?? 0,
      failed,
      ignored: statusCount["ignored"] ?? 0,
      candidatos_diretores_pendentes: candidatosPendentes,
      itens_monitorados_novos: itensNovos,
    },
    confianca,
    por_agencia: porAgencia,
    execucoes_recentes: (execucoesRes.data ?? []) as ExecucaoRecente[],
    diretores_sem_mandato: diretoresSemMandato,
    auto_confirmadas_7d: {
      total: (autoConfirmadasRes.data ?? []).length,
      amostra: (autoConfirmadasRes.data ?? []).slice(0, 10).map((d: any) => ({
        deliberacao_id: d.id,
        numero_deliberacao: d.numero_deliberacao,
        agencia_sigla: d.agencia_id ? siglaPorAgencia.get(d.agencia_id) ?? null : null,
        created_at: d.created_at,
      })),
    },
    alertas,
  };

  return NextResponse.json(response);
}
