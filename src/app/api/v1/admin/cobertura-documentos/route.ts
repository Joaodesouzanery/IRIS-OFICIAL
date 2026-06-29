/**
 * GET /api/v1/admin/cobertura-documentos
 * Funil de cobertura do scraper de DOCUMENTOS por agência, para verificar se o
 * scraper traz TODOS os documentos e os organiza certo:
 *   descoberto (reuniões/itens) → coletado → enfileirado/processado → confirmado (deliberação)
 * + perdas: coletados com erro, regulatórios failed, review_pending parado, itens
 *   descobertos mas não enfileirados, coletados isolados (sem virar deliberação).
 *
 * Read-only. Protegido pelo middleware (admin em todo GET /api/v1/*); em DEMO devolve retrato fictício.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

// Resultados que NÃO são decisão final (não contam como deliberação consolidada).
const NAO_FINAL = new Set(["pauta", "voto_individual", "documento_apoio"]);

interface AgenciaCobertura {
  agencia_id: string | null;
  sigla: string;
  nome: string;
  reunioes_descobertas: number;       // antt_reunioes_coletadas
  itens_monitorados: number;          // monitoramento_itens
  docs_coletados: number;             // documentos_coletados
  docs_coletados_erro: number;
  docs_por_tipo: Record<string, number>;
  regulatorios: Record<string, number>; // por status
  deliberacoes_finais: number;
}

export interface CoberturaDocumentosResponse {
  gerado_em: string;
  modo: "real" | "demo";
  por_agencia: AgenciaCobertura[];
  perdas: {
    coletados_com_erro: number;
    regulatorios_failed: number;
    review_pending: number;
    monitorados_nao_enfileirados: number;
    coletados_nao_importados: number;
  };
  alertas: string[];
}

const DEMO: CoberturaDocumentosResponse = {
  gerado_em: "2026-06-29T12:00:00.000Z",
  modo: "demo",
  por_agencia: [
    { agencia_id: "demo-antt", sigla: "ANTT", nome: "Agência Nacional de Transportes Terrestres", reunioes_descobertas: 18, itens_monitorados: 0, docs_coletados: 132, docs_coletados_erro: 4, docs_por_tipo: { ata: 16, voto: 70, deliberacao: 40, pauta: 6 }, regulatorios: { queued: 2, processing: 0, review_pending: 9, confirmed: 110, ignored: 6, failed: 5 }, deliberacoes_finais: 104 },
    { agencia_id: "demo-anm", sigla: "ANM", nome: "Agência Nacional de Mineração", reunioes_descobertas: 0, itens_monitorados: 44, docs_coletados: 0, docs_coletados_erro: 0, docs_por_tipo: {}, regulatorios: { queued: 1, processing: 0, review_pending: 3, confirmed: 33, ignored: 1, failed: 2 }, deliberacoes_finais: 31 },
    { agencia_id: "demo-artesp", sigla: "ARTESP", nome: "Agência de Transporte do Estado de SP", reunioes_descobertas: 0, itens_monitorados: 6, docs_coletados: 0, docs_coletados_erro: 0, docs_por_tipo: {}, regulatorios: { queued: 0, processing: 0, review_pending: 2, confirmed: 12, ignored: 0, failed: 1 }, deliberacoes_finais: 11 },
  ],
  perdas: { coletados_com_erro: 4, regulatorios_failed: 8, review_pending: 14, monitorados_nao_enfileirados: 38, coletados_nao_importados: 76 },
  alertas: [
    "38 itens monitorados descobertos mas NÃO enfileirados (ARTESP/ANM página 2+ provavelmente perdida).",
    "8 documento(s) com status 'failed' (PDF escaneado/erro — sem OCR).",
    "14 documento(s) em review_pending aguardando confirmação manual.",
  ],
};

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json(DEMO);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const [agenciasRes, reunioesRes, itensRes, coletadosRes, regsRes, delibsRes] = await Promise.all([
    db.from("agencias").select("id, sigla, nome").eq("ativo", true),
    db.from("antt_reunioes_coletadas").select("agencia_id").limit(20000),
    db.from("monitoramento_itens").select("agencia_id, status, documento_id").limit(40000),
    db.from("documentos_coletados").select("agencia_id, tipo, status").limit(40000),
    db.from("documentos_regulatorios").select("agencia_id, status").limit(40000),
    db.from("deliberacoes").select("agencia_id, tipo_documento, documento_pai_id").limit(40000),
  ]);

  const agencias: Array<{ id: string; sigla: string; nome: string }> = agenciasRes.data ?? [];
  const bySigla = new Map<string, AgenciaCobertura>();
  for (const a of agencias) {
    bySigla.set(a.id, {
      agencia_id: a.id, sigla: a.sigla, nome: a.nome,
      reunioes_descobertas: 0, itens_monitorados: 0, docs_coletados: 0, docs_coletados_erro: 0,
      docs_por_tipo: {}, regulatorios: {}, deliberacoes_finais: 0,
    });
  }
  const ag = (id: string | null) => (id ? bySigla.get(id) ?? null : null);

  for (const r of reunioesRes.data ?? []) { const e = ag(r.agencia_id); if (e) e.reunioes_descobertas += 1; }

  let monitoradosNaoEnfileirados = 0;
  for (const it of itensRes.data ?? []) {
    const e = ag(it.agencia_id); if (e) e.itens_monitorados += 1;
    // descoberto mas nunca enfileirado (sem documento ligado e ainda "novo")
    if (!it.documento_id && it.status === "novo") monitoradosNaoEnfileirados += 1;
  }

  let coletadosComErro = 0;
  let coletadosNaoImportados = 0;
  for (const c of coletadosRes.data ?? []) {
    const e = ag(c.agencia_id); if (e) { e.docs_coletados += 1; e.docs_por_tipo[c.tipo] = (e.docs_por_tipo[c.tipo] ?? 0) + 1; }
    if (c.status === "erro") { coletadosComErro += 1; if (e) e.docs_coletados_erro += 1; }
    else if (c.status !== "importado" && c.status !== "ignorado") coletadosNaoImportados += 1;
  }

  let regsFailed = 0, reviewPending = 0;
  for (const d of regsRes.data ?? []) {
    const e = ag(d.agencia_id); if (e) e.regulatorios[d.status] = (e.regulatorios[d.status] ?? 0) + 1;
    if (d.status === "failed") regsFailed += 1;
    if (d.status === "review_pending") reviewPending += 1;
  }

  for (const d of delibsRes.data ?? []) {
    const e = ag(d.agencia_id); if (!e) continue;
    // Decisão final: exclui pauta/voto_individual/documento_apoio e ata-pai (sem item).
    if (NAO_FINAL.has(String(d.tipo_documento))) continue;
    if (d.tipo_documento === "ata" && d.documento_pai_id == null) continue;
    e.deliberacoes_finais += 1;
  }

  const por_agencia = [...bySigla.values()].sort((a, b) => b.deliberacoes_finais - a.deliberacoes_finais);

  const alertas: string[] = [];
  if (monitoradosNaoEnfileirados > 0) alertas.push(`${monitoradosNaoEnfileirados} item(ns) monitorado(s) descoberto(s) mas NÃO enfileirado(s) — possível página 2+ ou auto-enfileiramento falho.`);
  if (regsFailed > 0) alertas.push(`${regsFailed} documento(s) com status 'failed' (PDF escaneado/erro — sem OCR).`);
  if (reviewPending > 0) alertas.push(`${reviewPending} documento(s) em review_pending aguardando confirmação manual.`);
  if (coletadosComErro > 0) alertas.push(`${coletadosComErro} documento(s) coletado(s) com erro de download (sem retry).`);

  const response: CoberturaDocumentosResponse = {
    gerado_em: new Date().toISOString(),
    modo: "real",
    por_agencia,
    perdas: {
      coletados_com_erro: coletadosComErro,
      regulatorios_failed: regsFailed,
      review_pending: reviewPending,
      monitorados_nao_enfileirados: monitoradosNaoEnfileirados,
      coletados_nao_importados: coletadosNaoImportados,
    },
    alertas,
  };
  return NextResponse.json(response);
}
