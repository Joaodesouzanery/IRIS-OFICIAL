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
  numero_reuniao: string | null;
  data_reuniao: string | null;
  interessado: string | null;
  empresa_id: string | null;
  reuniao_id: string | null;
};

interface AgenciaCompletude {
  agencia_id: string | null;
  sigla: string;
  nome: string;
  reunioes: { com_deliberacao: number };
  documentos_2026: { detectados: number; por_status: Record<string, number> };
  deliberacoes: { finais: number; sem_voto: number; so_inferidas: number; sem_empresa_id: number };
  votos: { total: number; nominais: number; inferidos: number };
  diretores: { aprovados: number; com_voto: number; sem_mandato: number; candidatos_pendentes: number };
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

  const [agenciasRes, delibsAllRes, itens2026Res, votosRes, diretoresRes, mandatosRes, candidatosRes] =
    await Promise.all([
      db.from("agencias").select("id, sigla, nome").eq("ativo", true),
      // Acervo de deliberações (bounded); o subconjunto 2026 é filtrado em código
      // (também serve para detectar votos órfãos contra o universo real de ids).
      db.from("deliberacoes")
        .select("id, agencia_id, tipo_documento, documento_pai_id, numero_reuniao, data_reuniao, interessado, empresa_id, reuniao_id")
        .limit(40000),
      db.from("monitoramento_itens").select("agencia_id, status, data_reuniao").gte("data_reuniao", de).lte("data_reuniao", ate).limit(40000),
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
      deliberacoes: { finais: 0, sem_voto: 0, so_inferidas: 0, sem_empresa_id: 0 },
      votos: { total: 0, nominais: 0, inferidos: 0 },
      diretores: { aprovados: 0, com_voto: 0, sem_mandato: 0, candidatos_pendentes: 0 },
      ultima_captura: { documento_em: null, deliberacao_em: null },
    });
  }
  const ag = (id: string | null) => (id ? byId.get(id) ?? null : null);

  // Universo de ids de deliberação (para votos órfãos) + subconjunto 2026.
  const allDelibIds = new Set<string>();
  const delibs2026 = new Map<string, Delib>();
  const reunioesComDelib = new Set<string>();
  for (const d of (delibsAllRes.data ?? []) as Delib[]) {
    allDelibIds.add(d.id);
    const dentro = typeof d.data_reuniao === "string" && d.data_reuniao >= de && d.data_reuniao <= ate;
    if (!dentro) continue;
    delibs2026.set(d.id, d);
    const e = ag(d.agencia_id);
    if (!e) continue;
    // Deliberação FINAL: exclui pauta/voto_individual/documento_apoio e ata-pai sem item.
    if (NAO_FINAL.has(String(d.tipo_documento))) continue;
    if (d.tipo_documento === "ata" && d.documento_pai_id == null) continue;
    e.deliberacoes.finais += 1;
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
    if (NAO_FINAL.has(String(d.tipo_documento))) continue;
    if (d.tipo_documento === "ata" && d.documento_pai_id == null) continue;
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
  };

  const alertas: string[] = [];
  if (totais.candidatos_pendentes > 0) alertas.push(`${totais.candidatos_pendentes} candidato(s) de diretor pendente(s) — votos presos até aprovar (rode /admin/diretores/candidatos/recompute).`);
  if (totais.diretores_sem_mandato > 0) alertas.push(`${totais.diretores_sem_mandato} diretor(es) sem mandato — inferência de voto desligada para eles.`);
  if (totais.deliberacoes_sem_empresa_id > 0) alertas.push(`${totais.deliberacoes_sem_empresa_id} deliberação(ões) com interessado mas SEM empresa_id (não entram nas visões por empresa).`);
  if (totais.deliberacoes_sem_voto > 0) alertas.push(`${totais.deliberacoes_sem_voto} deliberação(ões) final(is) sem nenhum voto.`);
  if (votosOrfaos > 0) alertas.push(`${votosOrfaos} voto(s) órfão(s) (deliberação inexistente).`);

  return NextResponse.json({ modo: "real", ano: Number(year), gerado_em: new Date().toISOString(), por_agencia, totais, alertas });
}
