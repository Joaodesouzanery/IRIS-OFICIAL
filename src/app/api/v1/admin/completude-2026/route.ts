/**
 * GET /api/v1/admin/completude-2026?year=2026
 *
 * "Conferência completa" da esteira de votos para um ano: por agência, cruza
 * reuniões, documentos, deliberações, votos, diretores e empresas — respondendo
 * "já temos TUDO de 2026, por diretor, sem perder nada?". Complementa
 * cobertura-documentos (funil de scraper) e saude-dados (qualidade) com as duas
 * peças que ninguém calcula hoje: deliberações com interessado mas SEM empresa_id,
 * e diretores aprovados com 0 voto + votos órfãos.
 *
 * Read-only, admin (middleware + guard). Não filtra reuniões/docs de outras
 * fontes por ano quando a tabela não tem data; usa data_reuniao onde existe.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

const NAO_FINAL = new Set(["pauta", "voto_individual", "documento_apoio"]);
const YEAR_RE = /^(20)\d{2}$/;

type Delib = {
  id: string;
  agencia_id: string | null;
  tipo_documento: string | null;
  documento_pai_id: string | null;
  numero_deliberacao: string | null;
  numero_reuniao: string | null;
  data_reuniao: string | null;
  resultado: string | null;
  interessado: string | null;
  empresa_id: string | null;
  reuniao_id: string | null;
};

/**
 * Deliberação FINAL — versão leve do predicado canônico `isFinalDecisionRecord`
 * (regulatory-documents.ts): exclui pauta/voto/apoio; ata só conta como filho COM
 * resultado (QA ago/2026: a regra antiga aceitava filho sem resultado, inflando a
 * Completude com itens que os demais dashboards descartam). Sem raw_extraction
 * aqui (40k linhas) — a checagem de subtipo fica de fora, delta desprezível.
 */
function isFinalDelib(d: Delib): boolean {
  if (NAO_FINAL.has(String(d.tipo_documento))) return false;
  if (d.tipo_documento === "ata") return Boolean(d.documento_pai_id && d.resultado);
  return true;
}

/** Extrai o inteiro inicial de "08", "160", "15-A" → 8, 160, 15. null se não numérico. */
function numeroInteiro(numero: string | null): number | null {
  if (!numero) return null;
  const m = numero.trim().match(/^(\d+)/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface AgenciaCompletude {
  agencia_id: string | null;
  sigla: string;
  nome: string;
  reunioes: { com_deliberacao: number };
  documentos_2026: { detectados: number; por_status: Record<string, number> };
  /**
   * Funil REAL de processamento (documentos_regulatorios por status). Sem ele, o
   * "detectados" acima (monitoramento_itens = links descobertos) era ambíguo entre
   * "nunca baixado", "arquivado" e "confirmado" (QA ago/2026 — caso ANM 17→0).
   */
  documentos_processados: { por_status: Record<string, number> };
  deliberacoes: { finais: number; sem_voto: number; so_inferidas: number; sem_empresa_id: number };
  votos: { total: number; nominais: number; inferidos: number };
  diretores: { aprovados: number; com_voto: number; sem_mandato: number; candidatos_pendentes: number };
  /**
   * Buraco de numeração: as deliberações de um ano/agência costumam ser sequenciais
   * (ARTESP 2026 = 08..62 contíguo). Um número pulado = documento provavelmente NÃO
   * capturado — invisível no funil de contagem. `faltantes` lista os números ausentes
   * dentro de [min,max] observados (capado); `range_suspeito` marca salto anômalo.
   */
  sequencia: { min: number | null; max: number | null; faltantes: number[]; range_suspeito: boolean };
  /** Staleness: fonte "parada no dia X" fica visível (QA Etapa 22 — sintoma ANTT-notícias). */
  ultima_captura: { documento_em: string | null; deliberacao_em: string | null };
}

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ modo: "demo", ano: 2026, por_agencia: [], totais: {}, alertas: [] });
  }
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam && YEAR_RE.test(yearParam) ? yearParam : "2026";
  const de = `${year}-01-01`;
  const ate = `${year}-12-31`;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const [agenciasRes, delibsAllRes, itens2026Res, docsRegRes, votosRes, diretoresRes, mandatosRes, candidatosRes] =
    await Promise.all([
      db.from("agencias").select("id, sigla, nome").eq("ativo", true),
      // Acervo de deliberações (bounded); o subconjunto 2026 é filtrado em código
      // (também serve para detectar votos órfãos contra o universo real de ids).
      db.from("deliberacoes")
        .select("id, agencia_id, tipo_documento, documento_pai_id, numero_deliberacao, numero_reuniao, data_reuniao, resultado, interessado, empresa_id, reuniao_id")
        .limit(40000),
      db.from("monitoramento_itens").select("agencia_id, status, data_reuniao").gte("data_reuniao", de).lte("data_reuniao", ate).limit(40000),
      db.from("documentos_regulatorios").select("agencia_id, status").limit(40000),
      db.from("votos").select("deliberacao_id, diretor_id, is_nominal").limit(80000),
      db.from("diretores").select("id, agencia_id").eq("review_status", "aprovado").limit(5000),
      db.from("mandatos").select("diretor_id").limit(20000),
      db.from("diretor_candidatos").select("agencia_id").eq("review_status", "pendente").limit(5000),
    ]);

  const agencias: Array<{ id: string; sigla: string; nome: string }> = agenciasRes.data ?? [];
  const byId = new Map<string, AgenciaCompletude>();
  for (const a of agencias) {
    byId.set(a.id, {
      agencia_id: a.id, sigla: a.sigla, nome: a.nome,
      reunioes: { com_deliberacao: 0 },
      documentos_2026: { detectados: 0, por_status: {} },
      documentos_processados: { por_status: {} },
      deliberacoes: { finais: 0, sem_voto: 0, so_inferidas: 0, sem_empresa_id: 0 },
      votos: { total: 0, nominais: 0, inferidos: 0 },
      diretores: { aprovados: 0, com_voto: 0, sem_mandato: 0, candidatos_pendentes: 0 },
      sequencia: { min: null, max: null, faltantes: [], range_suspeito: false },
      ultima_captura: { documento_em: null, deliberacao_em: null },
    });
  }
  const ag = (id: string | null) => (id ? byId.get(id) ?? null : null);

  // Universo de ids de deliberação (para votos órfãos) + subconjunto 2026.
  const allDelibIds = new Set<string>();
  const delibs2026 = new Map<string, Delib>();
  const reunioesComDelib = new Set<string>();
  // Números de deliberação vistos por agência (só tipo "deliberacao" — atas usam
  // item_numero, que poluiria a sequência). Alimenta a detecção de buraco de numeração.
  const numerosPorAgencia = new Map<string, Set<number>>();
  for (const d of (delibsAllRes.data ?? []) as Delib[]) {
    allDelibIds.add(d.id);
    const dentro = typeof d.data_reuniao === "string" && d.data_reuniao >= de && d.data_reuniao <= ate;
    if (!dentro) continue;
    delibs2026.set(d.id, d);
    const e = ag(d.agencia_id);
    if (!e) continue;
    if (!isFinalDelib(d)) continue;
    e.deliberacoes.finais += 1;
    if (d.agencia_id && d.tipo_documento === "deliberacao") {
      const n = numeroInteiro(d.numero_deliberacao);
      if (n != null) {
        const set = numerosPorAgencia.get(d.agencia_id) ?? new Set<number>();
        set.add(n);
        numerosPorAgencia.set(d.agencia_id, set);
      }
    }
    if (d.data_reuniao && (!e.ultima_captura.deliberacao_em || d.data_reuniao > e.ultima_captura.deliberacao_em)) {
      e.ultima_captura.deliberacao_em = d.data_reuniao;
    }
    if (d.interessado && d.interessado.trim() && !d.empresa_id) e.deliberacoes.sem_empresa_id += 1;
    const chave = d.numero_reuniao
      ? `${d.agencia_id}|r|${d.numero_reuniao}`
      : d.data_reuniao ? `${d.agencia_id}|d|${d.data_reuniao}` : null;
    if (chave) reunioesComDelib.add(chave);
  }
  // Reuniões distintas com deliberação, por agência.
  for (const chave of reunioesComDelib) {
    const agenciaId = chave.split("|")[0];
    const e = ag(agenciaId);
    if (e) e.reunioes.com_deliberacao += 1;
  }

  // Buraco de numeração por agência: para cada [min,max] observado, quais inteiros faltam.
  // Range muito largo (> RANGE_MAX) é sinal de outlier (numeração antiga/atípica) e não de
  // "faltou 400 docs" → marca range_suspeito e NÃO explode a lista de faltantes.
  const RANGE_MAX = 400;
  const FALTANTES_CAP = 60;
  for (const [agenciaId, numeros] of numerosPorAgencia) {
    const e = ag(agenciaId);
    if (!e || numeros.size === 0) continue;
    // min/max por iteração (não `Math.min(...set)`) — sem risco de estourar argumentos.
    let min = Infinity;
    let max = -Infinity;
    for (const n of numeros) { if (n < min) min = n; if (n > max) max = n; }
    e.sequencia.min = min;
    e.sequencia.max = max;
    if (max - min > RANGE_MAX) { e.sequencia.range_suspeito = true; continue; }
    const faltantes: number[] = [];
    for (let n = min; n <= max && faltantes.length < FALTANTES_CAP; n++) {
      if (!numeros.has(n)) faltantes.push(n);
    }
    e.sequencia.faltantes = faltantes;
  }

  // Documentos 2026 detectados (monitoramento_itens com data_reuniao no ano).
  for (const it of itens2026Res.data ?? []) {
    const e = ag(it.agencia_id);
    if (!e) continue;
    e.documentos_2026.detectados += 1;
    const st = String(it.status ?? "?");
    e.documentos_2026.por_status[st] = (e.documentos_2026.por_status[st] ?? 0) + 1;
    const dt = typeof (it as { data_reuniao?: unknown }).data_reuniao === "string" ? (it as { data_reuniao: string }).data_reuniao : null;
    if (dt && (!e.ultima_captura.documento_em || dt > e.ultima_captura.documento_em)) {
      e.ultima_captura.documento_em = dt;
    }
  }

  // Funil real: documentos_regulatorios por status (queued/review_pending/confirmed/ignored/failed).
  for (const doc of docsRegRes.data ?? []) {
    const e = ag((doc as { agencia_id: string | null }).agencia_id);
    if (!e) continue;
    const st = String((doc as { status?: unknown }).status ?? "?");
    e.documentos_processados.por_status[st] = (e.documentos_processados.por_status[st] ?? 0) + 1;
  }

  // Votos: total/nominais/inferidos por agência (só das deliberações de 2026),
  // deliberações com voto, e votos órfãos (deliberacao_id inexistente).
  const delibDaAgenciaComVoto = new Map<string, Set<string>>(); // agencia_id → set diretor_id
  const delibsComVoto = new Set<string>();
  const delibsComNominal = new Set<string>();
  let votosOrfaos = 0;
  for (const v of votosRes.data ?? []) {
    if (!allDelibIds.has(v.deliberacao_id)) { votosOrfaos += 1; continue; }
    const d = delibs2026.get(v.deliberacao_id);
    if (!d) continue; // voto de deliberação fora de 2026
    const e = ag(d.agencia_id);
    if (!e) continue;
    e.votos.total += 1;
    if (v.is_nominal) e.votos.nominais += 1; else e.votos.inferidos += 1;
    delibsComVoto.add(v.deliberacao_id);
    if (v.is_nominal) delibsComNominal.add(v.deliberacao_id);
    if (d.agencia_id && v.diretor_id) {
      const set = delibDaAgenciaComVoto.get(d.agencia_id) ?? new Set<string>();
      set.add(v.diretor_id);
      delibDaAgenciaComVoto.set(d.agencia_id, set);
    }
  }
  // Deliberações finais 2026 sem voto / só-inferidas.
  for (const [id, d] of delibs2026) {
    const e = ag(d.agencia_id);
    if (!e) continue;
    if (!isFinalDelib(d)) continue;
    if (!delibsComVoto.has(id)) e.deliberacoes.sem_voto += 1;
    else if (!delibsComNominal.has(id)) e.deliberacoes.so_inferidas += 1;
  }

  // Diretores: aprovados, com ≥1 voto, sem mandato.
  const comMandato = new Set((mandatosRes.data ?? []).map((m: { diretor_id: string }) => m.diretor_id));
  for (const d of (diretoresRes.data ?? []) as Array<{ id: string; agencia_id: string | null }>) {
    const e = ag(d.agencia_id);
    if (!e) continue;
    e.diretores.aprovados += 1;
    if (!comMandato.has(d.id)) e.diretores.sem_mandato += 1;
    if (d.agencia_id && delibDaAgenciaComVoto.get(d.agencia_id)?.has(d.id)) e.diretores.com_voto += 1;
  }
  for (const c of candidatosRes.data ?? []) {
    const e = ag(c.agencia_id);
    if (e) e.diretores.candidatos_pendentes += 1;
  }

  const por_agencia = [...byId.values()].sort((a, b) => b.deliberacoes.finais - a.deliberacoes.finais);
  const soma = (f: (a: AgenciaCompletude) => number) => por_agencia.reduce((s, a) => s + f(a), 0);
  const totais = {
    documentos_2026_detectados: soma((a) => a.documentos_2026.detectados),
    deliberacoes_finais: soma((a) => a.deliberacoes.finais),
    deliberacoes_sem_voto: soma((a) => a.deliberacoes.sem_voto),
    deliberacoes_sem_empresa_id: soma((a) => a.deliberacoes.sem_empresa_id),
    votos_total: soma((a) => a.votos.total),
    votos_nominais: soma((a) => a.votos.nominais),
    votos_inferidos: soma((a) => a.votos.inferidos),
    votos_orfaos: votosOrfaos,
    diretores_aprovados: soma((a) => a.diretores.aprovados),
    diretores_com_voto: soma((a) => a.diretores.com_voto),
    diretores_sem_mandato: soma((a) => a.diretores.sem_mandato),
    candidatos_pendentes: soma((a) => a.diretores.candidatos_pendentes),
    deliberacoes_faltantes_sequencia: soma((a) => a.sequencia.faltantes.length),
  };

  const alertas: string[] = [];
  if (totais.candidatos_pendentes > 0) alertas.push(`${totais.candidatos_pendentes} candidato(s) de diretor pendente(s) — votos presos até aprovar (rode /admin/diretores/candidatos/recompute).`);
  if (totais.diretores_sem_mandato > 0) alertas.push(`${totais.diretores_sem_mandato} diretor(es) sem mandato — inferência de voto desligada para eles.`);
  if (totais.deliberacoes_sem_empresa_id > 0) alertas.push(`${totais.deliberacoes_sem_empresa_id} deliberação(ões) com interessado mas SEM empresa_id (não entram nas visões por empresa).`);
  if (totais.deliberacoes_sem_voto > 0) alertas.push(`${totais.deliberacoes_sem_voto} deliberação(ões) final(is) sem nenhum voto.`);
  if (votosOrfaos > 0) alertas.push(`${votosOrfaos} voto(s) órfão(s) (deliberação inexistente).`);
  for (const a of por_agencia) {
    // Link descoberto que nunca virou documento processado (status "novo" no
    // monitoramento): era o buraco invisível do "17 ANM → 0 deliberações".
    const nuncaProcessados = a.documentos_2026.por_status["novo"] ?? 0;
    if (nuncaProcessados > 0) {
      alertas.push(`${a.sigla}: ${nuncaProcessados} documento(s) descoberto(s) e nunca enfileirado(s)/baixado(s) — rode "Buscar todas" ou verifique o tipo/URL no monitoramento.`);
    }
    const emRevisao = a.documentos_processados.por_status["review_pending"] ?? 0;
    if (emRevisao > 0) {
      alertas.push(`${a.sigla}: ${emRevisao} documento(s) em revisão (Exceções) — o próximo "Rodar tudo" tenta drenar.`);
    }
    if (a.sequencia.faltantes.length > 0) {
      const amostra = a.sequencia.faltantes.slice(0, 15).join(", ");
      const resto = a.sequencia.faltantes.length > 15 ? "…" : "";
      alertas.push(`${a.sigla}: ${a.sequencia.faltantes.length} nº de deliberação faltando na sequência ${a.sequencia.min}–${a.sequencia.max} (${amostra}${resto}) — possíveis documentos não capturados.`);
    }
  }

  return NextResponse.json({ modo: "real", ano: Number(year), gerado_em: new Date().toISOString(), por_agencia, totais, alertas });
}
