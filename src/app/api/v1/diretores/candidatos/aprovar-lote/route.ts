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
import { isDemoRequest, requireAdmin, requireAdminOrCron, getAuthenticatedUser } from "@/lib/server/request-guards";
import { aprovarCandidato } from "@/lib/server/candidato-approval";
import { findBestMatch, findBestMatchComMargem, isStrictPersonName } from "@/lib/server/name-matcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_MIN_CONFIDENCE = 0.8;

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Aprovação em lote indisponível em modo DEMO." }, { status: 403 });
  }
  // AdminOrCron: a pipeline zero-toque (/pipeline/run) também chama esta rota.
  const guard = await requireAdminOrCron(req, "candidatos/aprovar-lote");
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

  // Zero-toque (incluir_novos): também considera os candidatos SEM match forte (novos), que a
  // query acima (gte confidence) não traz. Política de 3 FAIXAS (anti grafia-errada):
  //   ≥0.8 → aprova como o diretor casado · 0.6–0.8 → provável VARIANTE de grafia, NÃO cria
  //   pessoa (fica pendente/exceção) · <0.6 + nome estrito → cria diretor novo.
  let candidatosNovos: any[] = [];
  if (incluirNovos) {
    let qNovos = db
      .from("diretor_candidatos")
      .select("*")
      .eq("review_status", "pendente")
      .is("diretor_id", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (body.agencia_id) qNovos = qNovos.eq("agencia_id", body.agencia_id);
    const { data } = await qNovos;
    candidatosNovos = (data ?? []).filter((c: any) => !(candidatos ?? []).some((x: any) => x.id === c.id));
  }

  const diretoresCache = new Map<string, Array<{ id: string; nome: string; nome_variantes: string[] }>>();
  async function diretoresDe(agenciaId: string) {
    const cached = diretoresCache.get(agenciaId);
    if (cached) return cached;
    const { data } = await db.from("diretores").select("id, nome, nome_variantes").eq("agencia_id", agenciaId);
    const lista = (data ?? []).map((x: any) => ({
      id: x.id, nome: x.nome, nome_variantes: Array.isArray(x.nome_variantes) ? x.nome_variantes : [],
    }));
    diretoresCache.set(agenciaId, lista);
    return lista;
  }

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

  // Faixa 0.6–0.8 com trava de MARGEM (zero-toque ago/2026): quando o melhor diretor é
  // INEQUÍVOCO (margem ≥0.15 sobre o 2º), é variante de grafia da mesma pessoa → aprova
  // como ele (não cria ninguém). Dois diretores próximos → segue exceção humana.
  let aprovadosPorMargem = 0;
  if (incluirNovos) {
    let qFaixa = db
      .from("diretor_candidatos")
      .select("*")
      .eq("review_status", "pendente")
      .gte("confidence", 0.6)
      .lt("confidence", minConfidence)
      .not("diretor_id", "is", null)
      .order("confidence", { ascending: false })
      .limit(limit);
    if (body.agencia_id) qFaixa = qFaixa.eq("agencia_id", body.agencia_id);
    const { data: faixa } = await qFaixa;
    for (const candidato of (faixa ?? []) as any[]) {
      if (!candidato.agencia_id) continue;
      const m = findBestMatchComMargem(String(candidato.nome_detectado ?? ""), await diretoresDe(candidato.agencia_id));
      if (m.diretorId && m.score >= 0.6 && m.margem >= 0.15) {
        try {
          const result = await aprovarCandidato(db, candidato, { reviewedBy, diretorId: m.diretorId });
          aprovados.push({ id: candidato.id, nome: candidato.nome_detectado, diretor_id: result.diretorId });
          aprovadosPorMargem++;
        } catch (e) {
          console.error("[candidatos/aprovar-lote] Falha (margem):", e);
          pulados.push({ id: candidato.id, nome: candidato.nome_detectado, reason: "erro ao aprovar (margem)" });
        }
      } else {
        pulados.push({ id: candidato.id, nome: candidato.nome_detectado, reason: "dois diretores com score próximo — decidir manualmente" });
      }
    }
  }

  for (const candidato of candidatosNovos) {
    const nome = String(candidato.nome_detectado ?? "");
    if (!isStrictPersonName(nome)) {
      pulados.push({ id: candidato.id, nome, reason: "nome não passa na validação estrita (prosa não vira pessoa)" });
      continue;
    }
    const match = candidato.agencia_id ? findBestMatch(nome, await diretoresDe(candidato.agencia_id)) : { diretorId: null, needsReview: false };
    if (match.diretorId && match.needsReview) {
      // Faixa 0.6–0.8: provável variante de grafia de alguém já cadastrado — criar duplicaria a pessoa.
      pulados.push({ id: candidato.id, nome, reason: "similaridade 0.6–0.8 com diretor existente (provável variante de grafia) — decidir manualmente" });
      continue;
    }
    try {
      // <0.6 (ninguém parecido) ou ≥0.85 (o aprovarCandidato reusa o cadastro): aprova.
      const result = await aprovarCandidato(db, candidato, { reviewedBy });
      aprovados.push({ id: candidato.id, nome, diretor_id: result.diretorId });
    } catch (e) {
      console.error("[candidatos/aprovar-lote] Falha (novo):", e);
      pulados.push({ id: candidato.id, nome, reason: "erro ao aprovar (novo)" });
    }
  }

  return NextResponse.json({
    min_confidence: minConfidence,
    analisados: (candidatos ?? []).length + candidatosNovos.length,
    aprovados: aprovados.length,
    aprovados_por_margem: aprovadosPorMargem,
    pulados: pulados.length,
    aprovados_detalhe: aprovados,
    pulados_detalhe: pulados.slice(0, 30),
    legal_notice: "Aprovação em lote conservadora: só candidatos com match a diretor já cadastrado (≥ limiar). Votos retroativos aplicados de forma idempotente.",
  });
}
