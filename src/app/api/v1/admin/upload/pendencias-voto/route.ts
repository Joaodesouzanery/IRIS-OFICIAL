/**
 * GET /api/v1/admin/upload/pendencias-voto[?agencia_id=...]
 *
 * Diagnóstico ZERO-TOQUE: por que os documentos `voto_individual` em `review_pending`
 * NÃO auto-confirmaram. Roda o MESMO gate `canAutoConfirm` (com o mesmo cálculo de
 * `relator_match_ok` da rota upload/auto-confirm) sobre todos os votos pendentes e
 * AGREGA por motivo — "180 sem direção do voto · 60 confiança baixa · 55 relator
 * ambíguo". É o que a tela Votos dos Diretores mostra para o operador entender o
 * gargalo (substitui o botão inútil "Re-enfileirar 0 ignorado(s)", já que os votos
 * estão em review_pending, não em ignored). Somente leitura; admin explícito.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { canAutoConfirm } from "@/lib/server/auto-confirm";
import { findBestMatch } from "@/lib/server/name-matcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Buckets legíveis a partir do `verdict.reason` do gate (que é texto livre).
function bucketFor(reason: string): { key: string; label: string } {
  const r = reason.toLowerCase();
  if (r.includes("sem resultado") || r.includes("direção") || r.includes("direcao")) return { key: "sem_resultado", label: "Sem direção do voto (deferido/indeferido não lido)" };
  if (r.includes("relator sem match") || r.includes("sem match")) return { key: "relator_sem_match", label: "Relator não casa com diretor cadastrado (≥0.85)" };
  if (r.includes("relator") && (r.includes("ambíg") || r.includes("ambig") || r.includes("identificado"))) return { key: "relator_ambiguo", label: "Relator ambíguo / não identificado" };
  if (r.includes("confiança") || r.includes("confianca")) return { key: "confianca_baixa", label: "Confiança de extração abaixo do corte" };
  if (r.includes("chave de dedup") || (r.includes("processo") && r.includes("data"))) return { key: "sem_chave_dedup", label: "Sem processo e sem data (risco de duplicata)" };
  if (r.includes("escaneado")) return { key: "escaneado", label: "Provável PDF escaneado (baixa densidade de texto)" };
  if (r.includes("warning de qualidade") || r.includes("warning")) return { key: "warning_qualidade", label: "Aviso de qualidade na extração" };
  if (r.includes("duplicata")) return { key: "possivel_duplicata", label: "Possível duplicata" };
  return { key: "outro", label: "Outro motivo" };
}

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ total_pendentes: 0, motivos: [], amostras: [], demo: true });
  }
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const agenciaId = req.nextUrl.searchParams.get("agencia_id");

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let query = db
    .from("documentos_regulatorios")
    .select("id, status, tipo_documento, extraction_confidence, chars_per_page, is_duplicate, agencia_id, ata_items, warnings, campos_detectados")
    .eq("status", "review_pending")
    .order("id", { ascending: true }) // determinístico (antes: sem order + limit → subcontagem aleatória)
    .limit(2000);
  if (agenciaId) query = query.eq("agencia_id", agenciaId);

  const { data: docsRaw, error } = await query;
  if (error) return NextResponse.json({ error: "Falha ao listar pendências de voto." }, { status: 500 });

  // QA ago/2026: separa o RESÍDUO ESPERADO do ATRASO REAL em toda a fila (não só votos).
  // pauta/documento_apoio NUNCA viram deliberação (NAO_FINAL, por desenho) — ficam na fila mas não
  // são atraso; ata/deliberacao/resolucao/portaria pendentes SÃO trabalho aguardando confirmação.
  const RESIDUO = new Set(["pauta", "documento_apoio"]);
  const AGUARDANDO = new Set(["ata", "deliberacao", "resolucao", "portaria"]);
  const tipoDe = (d: any) => String(d?.campos_detectados?.preview?.fields?.tipo_documento ?? d.tipo_documento ?? "outro");
  const porTipoMap = new Map<string, number>();
  for (const d of docsRaw ?? []) porTipoMap.set(tipoDe(d), (porTipoMap.get(tipoDe(d)) ?? 0) + 1);
  const por_tipo = [...porTipoMap.entries()]
    .map(([tipo, total]) => ({
      tipo,
      total,
      categoria: tipo === "voto_individual" ? "voto" : RESIDUO.has(tipo) ? "residuo_esperado" : AGUARDANDO.has(tipo) ? "aguardando_confirmacao" : "outro",
    }))
    .sort((a, b) => b.total - a.total);

  // Só voto_individual (o preview carrega o tipo real em campos_detectados).
  const docs = (docsRaw ?? []).filter((d: any) => tipoDe(d) === "voto_individual");

  // Cache de diretores por agência p/ o relator_match_ok (idêntico à rota auto-confirm).
  const diretoresCache = new Map<string, Array<{ id: string; nome: string; nome_variantes: string[] }>>();
  async function diretoresDe(ag: string) {
    const cached = diretoresCache.get(ag);
    if (cached) return cached;
    const { data } = await db.from("diretores").select("id, nome, nome_variantes").eq("review_status", "aprovado").eq("agencia_id", ag);
    const lista = (data ?? []).map((x: any) => ({
      id: x.id, nome: x.nome, nome_variantes: Array.isArray(x.nome_variantes) ? x.nome_variantes : [],
    }));
    diretoresCache.set(ag, lista);
    return lista;
  }

  const buckets = new Map<string, { key: string; label: string; total: number }>();
  const amostras: Array<{ id: string; agencia_id: string | null; relator: string | null; motivo: string }> = [];
  let confirmaveis = 0;

  for (const doc of docs as any[]) {
    const fields = doc?.campos_detectados?.preview?.fields ?? {};
    if (fields.relator && doc.agencia_id) {
      const match = findBestMatch(String(fields.relator), await diretoresDe(doc.agencia_id));
      doc.relator_match_ok = Boolean(match.diretorId) && !match.needsReview;
    }
    const verdict = canAutoConfirm(doc);
    if (verdict.ok) { confirmaveis++; continue; }
    const b = bucketFor(verdict.reason);
    const cur = buckets.get(b.key) ?? { ...b, total: 0 };
    cur.total++;
    buckets.set(b.key, cur);
    if (amostras.length < 20) amostras.push({ id: doc.id, agencia_id: doc.agencia_id ?? null, relator: fields.relator ?? null, motivo: verdict.reason });
  }

  const motivos = [...buckets.values()].sort((a, b) => b.total - a.total);
  return NextResponse.json({
    total_pendentes: docs.length,
    confirmaveis, // passariam no gate AGORA (rodar Auto-confirmar materializa)
    motivos,
    amostras,
    total_review_pending: (docsRaw ?? []).length,
    por_tipo, // toda a fila por tipo: voto | residuo_esperado (pauta/apoio) | aguardando_confirmacao (ata/delib)
    legal_notice: "Diagnóstico read-only: por que cada voto_individual está em revisão. 'confirmaveis' = passariam no gate conservador nesta rodada.",
  });
}
