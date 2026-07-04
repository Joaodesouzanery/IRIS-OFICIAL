/**
 * POST /api/v1/diretores/candidatos/aprovar-lote
 * Aprova EM LOTE os candidatos de diretor pendentes com confiança ≥ limiar,
 * destravando os votos retroativos (matches fracos 0.6–0.85 eram o gargalo:
 * cada um exigia revisão 1-a-1 e os votos ficavam perdidos até lá).
 *
 * Conservador por padrão: só aprova candidatos JÁ CASADOS a um diretor
 * cadastrado (diretor_id preenchido). Criar diretores NOVOS a partir de nomes
 * extraídos continua 1-a-1 (ou explicitamente via incluir_novos=true). Admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin, getAuthenticatedUser } from "@/lib/server/request-guards";
import { aprovarCandidato } from "@/lib/server/candidato-approval";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_MIN_CONFIDENCE = 0.8;

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Aprovação em lote indisponível em modo DEMO." }, { status: 403 });
  }
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const userResult = await getAuthenticatedUser(req);
  const reviewedBy = userResult instanceof NextResponse ? null : userResult.email;

  const body = (await req.json().catch(() => ({}))) as {
    min_confidence?: number;
    limit?: number;
    agencia_id?: string;
    incluir_novos?: boolean;
    ids?: string[];
  };
  const minConfidence = Math.min(0.94, Math.max(0.6, Number(body.min_confidence ?? DEFAULT_MIN_CONFIDENCE)));
  const limit = Math.min(100, Math.max(1, Number(body.limit ?? 50)));
  const incluirNovos = body.incluir_novos === true;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let query = db
    .from("diretor_candidatos")
    .select("*")
    .eq("review_status", "pendente")
    .gte("confidence", minConfidence)
    .order("confidence", { ascending: false })
    .limit(limit);
  if (body.agencia_id) query = query.eq("agencia_id", body.agencia_id);
  if (Array.isArray(body.ids) && body.ids.length > 0) query = query.in("id", body.ids.slice(0, 100));

  const { data: candidatos, error } = await query;
  if (error) return NextResponse.json({ error: "Falha ao listar candidatos." }, { status: 500 });

  const aprovados: Array<{ id: string; nome: string; diretor_id: string }> = [];
  const pulados: Array<{ id: string; nome: string; reason: string }> = [];

  for (const candidato of candidatos ?? []) {
    if (!candidato.diretor_id && !incluirNovos) {
      pulados.push({ id: candidato.id, nome: candidato.nome_detectado, reason: "sem diretor cadastrado (novo) — aprovar 1-a-1 ou incluir_novos=true" });
      continue;
    }
    try {
      const result = await aprovarCandidato(db, candidato, { reviewedBy });
      aprovados.push({ id: candidato.id, nome: candidato.nome_detectado, diretor_id: result.diretorId });
    } catch (e) {
      console.error("[candidatos/aprovar-lote] Falha:", e);
      pulados.push({ id: candidato.id, nome: candidato.nome_detectado, reason: "erro ao aprovar" });
    }
  }

  return NextResponse.json({
    min_confidence: minConfidence,
    analisados: (candidatos ?? []).length,
    aprovados: aprovados.length,
    pulados: pulados.length,
    aprovados_detalhe: aprovados,
    pulados_detalhe: pulados.slice(0, 30),
    legal_notice: "Aprovação em lote conservadora: só candidatos com match a diretor já cadastrado (≥ limiar). Votos retroativos aplicados de forma idempotente.",
  });
}
