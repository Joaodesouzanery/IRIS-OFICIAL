/**
 * GET /api/v1/admin/monitoramento/nao-enfileirados
 *
 * Diagnóstico do elo coleta→fila (QA ago/2026, "208 detectados / 0 processados"):
 * responde ONDE os itens detectados estão parados, sem filtro de data:
 *  - monitoramento_itens por agência × tipo × status (novo/ignorado/importado…),
 *    com amostra de url_item + motivo (metadata.enqueue_motivo/captura_erro);
 *  - documentos_regulatorios `failed` com error_message (extração que quebrou).
 * Read-only, admin/cron.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    // Etapa65 — o ramo demo tem de ter TODOS os campos do real. Faltava `total_nao_enfileirados`,
    // e como o cast de `api.get<T>` não verifica nada, o consumidor lia `undefined` e o painel
    // sumia em silêncio. Os ramos demo são alcançáveis em produção: `attachRuntimeHeaders` injeta
    // `x-iris-demo: 1` a partir do localStorage.
    return NextResponse.json({ modo: "demo", total_nao_enfileirados: 0, grupos: [], falhas_extracao: [] });
  }
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const [agenciasRes, itensRes, failedRes] = await Promise.all([
    db.from("agencias").select("id, sigla"),
    db.from("monitoramento_itens")
      .select("agencia_id, tipo, status, url_item, titulo, metadata, data_reuniao")
      .in("status", ["novo", "ignorado"])
      .order("last_seen_at", { ascending: false })
      .limit(4000),
    db.from("documentos_regulatorios")
      .select("id, agencia_id, filename, status, error_message, updated_at")
      .in("status", ["failed", "queued", "processing"])
      .order("updated_at", { ascending: false })
      .limit(300),
  ]);

  const sigla = new Map<string, string>((agenciasRes.data ?? []).map((a: any) => [a.id, a.sigla]));
  const nomeAg = (id: string | null) => (id ? sigla.get(id) ?? "?" : "?");

  // Agrupa agência × tipo × status, com amostra de até 5 URLs + motivo por grupo.
  type Grupo = { agencia: string; tipo: string; status: string; total: number; amostra: Array<{ url: string; titulo: string | null; motivo: string | null }> };
  const grupos = new Map<string, Grupo>();
  for (const it of (itensRes.data ?? []) as any[]) {
    const key = `${nomeAg(it.agencia_id)}|${it.tipo}|${it.status}`;
    const g = grupos.get(key) ?? { agencia: nomeAg(it.agencia_id), tipo: String(it.tipo), status: String(it.status), total: 0, amostra: [] };
    g.total += 1;
    if (g.amostra.length < 5) {
      const meta = (it.metadata ?? {}) as Record<string, unknown>;
      const motivo = typeof meta.enqueue_motivo === "string"
        ? meta.enqueue_motivo
        : typeof meta.captura_erro === "string" ? `erro: ${meta.captura_erro}` : null;
      g.amostra.push({ url: String(it.url_item ?? ""), titulo: it.titulo ?? null, motivo });
    }
    grupos.set(key, g);
  }

  const falhasExtracao = ((failedRes.data ?? []) as any[]).map((d) => ({
    documento_id: d.id,
    agencia: nomeAg(d.agencia_id),
    filename: d.filename,
    status: d.status,
    erro: d.error_message ?? null,
    atualizado_em: d.updated_at,
  }));

  const totalNovo = [...grupos.values()].filter((g) => g.status === "novo").reduce((s, g) => s + g.total, 0);

  return NextResponse.json({
    total_nao_enfileirados: totalNovo,
    grupos: [...grupos.values()].sort((a, b) => b.total - a.total),
    falhas_extracao: falhasExtracao,
  });
}
