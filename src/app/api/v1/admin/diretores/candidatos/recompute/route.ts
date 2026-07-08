/**
 * POST /api/v1/admin/diretores/candidatos/recompute[?dry_run=0][&agencia_id=...]
 *
 * Limpeza RETROATIVA dos candidatos de diretor pendentes. A dedup/matcher da
 * Etapa 13 é forward-only: candidatos legados ficaram com `confidence` congelada
 * (ex.: 6 cartões "Alex Azevedo" a 60% que o código atual nem criaria) e nunca
 * colapsam sozinhos. Aqui, por (agencia_id, nome_detectado):
 *   - recalcula findBestMatch com o matcher ATUAL;
 *   - grupos que agora casam >=0.85 → AUTO-APROVA (cascata + votos retroativos
 *     idempotentes) — destrava os diretores que apareciam zerados nas métricas;
 *   - grupos ainda ambíguos → atualiza confidence/diretor_id e COLAPSA os cartões
 *     duplicados num só (os votos vêm de raw_extraction na aprovação, não do
 *     cartão, então apagar duplicatas não perde voto).
 * dry_run (padrão) só relata. Admin explícito; votos são upsert idempotente.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";
import { findBestMatch } from "@/lib/server/name-matcher";
import { aprovarCandidato } from "@/lib/server/candidato-approval";

export const dynamic = "force-dynamic";

type Candidato = {
  id: string;
  agencia_id: string;
  nome_detectado: string;
  cargo_detectado: string | null;
  diretor_id: string | null;
  confidence: number | null;
  source_url: string | null;
  source_type: string | null;
  source_hash: string | null;
  created_at: string;
};

type DiretorRec = { id: string; nome: string; nome_variantes: string[] };

// Mesmo clamp de confidence usado na criação (confirm/route.ts).
function clampConfidence(score: number): number {
  return Math.max(0.35, Math.min(score || 0.5, 0.94));
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;
  if (isDemo()) {
    return NextResponse.json({ error: "Indisponível em modo DEMO." }, { status: 403 });
  }

  const dryRun = req.nextUrl.searchParams.get("dry_run") !== "0";
  const agenciaFilter = req.nextUrl.searchParams.get("agencia_id");

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let candQuery = db
    .from("diretor_candidatos")
    .select("id, agencia_id, nome_detectado, cargo_detectado, diretor_id, confidence, source_url, source_type, source_hash, created_at")
    .eq("review_status", "pendente")
    .limit(5000);
  if (agenciaFilter) candQuery = candQuery.eq("agencia_id", agenciaFilter);
  const { data: candidatos, error } = await candQuery;
  if (error) {
    return NextResponse.json({ error: "Erro ao listar candidatos" }, { status: 500 });
  }

  // Cache de diretores por agência (id, nome, nome_variantes).
  const diretoresPorAgencia = new Map<string, DiretorRec[]>();
  async function diretoresDe(agenciaId: string): Promise<DiretorRec[]> {
    const cached = diretoresPorAgencia.get(agenciaId);
    if (cached) return cached;
    const { data } = await db
      .from("diretores")
      .select("id, nome, nome_variantes")
      .eq("agencia_id", agenciaId);
    const lista = (data ?? []).map((d: { id: string; nome: string; nome_variantes?: unknown }) => ({
      id: d.id,
      nome: d.nome,
      nome_variantes: Array.isArray(d.nome_variantes) ? (d.nome_variantes as string[]) : [],
    }));
    diretoresPorAgencia.set(agenciaId, lista);
    return lista;
  }

  // Agrupa por (agencia_id, nome_detectado).
  const grupos = new Map<string, Candidato[]>();
  for (const c of (candidatos ?? []) as Candidato[]) {
    const key = `${c.agencia_id}|${c.nome_detectado}`;
    grupos.set(key, [...(grupos.get(key) ?? []), c]);
  }

  let autoAprovados = 0;
  let recomputados = 0;
  let cartoesColapsados = 0;
  let votosCriados = 0;
  const amostra: Array<{ nome: string; agencia_id: string; score: number; acao: string; cartoes: number }> = [];

  for (const [, grupo] of grupos) {
    // Canônico = maior confidence, desempate pelo mais antigo.
    const canonico = [...grupo].sort(
      (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || a.created_at.localeCompare(b.created_at),
    )[0];
    const lista = await diretoresDe(canonico.agencia_id);
    const match = findBestMatch(canonico.nome_detectado, lista);
    const aprovavel = Boolean(match.diretorId) && !match.needsReview; // >=0.85

    if (aprovavel) {
      if (amostra.length < 20) amostra.push({ nome: canonico.nome_detectado, agencia_id: canonico.agencia_id, score: Math.round(match.score * 100) / 100, acao: "auto-aprovar", cartoes: grupo.length });
      autoAprovados += 1;
      if (!dryRun) {
        // aprovarCandidato cascateia para TODOS os pendentes do mesmo nome + cria
        // votos retroativos idempotentes. Passa o diretor recomputado.
        const res = await aprovarCandidato(db, canonico, { diretorId: match.diretorId, reviewedBy: "recompute" });
        const votos = res.votosRetroativos as { criados?: number } | null;
        votosCriados += votos?.criados ?? 0;
      }
      continue;
    }

    // Ainda ambíguo/novo: recomputa confidence+diretor_id no canônico e colapsa duplicatas.
    recomputados += 1;
    if (amostra.length < 20) amostra.push({ nome: canonico.nome_detectado, agencia_id: canonico.agencia_id, score: Math.round(match.score * 100) / 100, acao: match.diretorId ? "revisar" : "novo", cartoes: grupo.length });
    if (!dryRun) {
      await db
        .from("diretor_candidatos")
        .update({ confidence: clampConfidence(match.score), diretor_id: match.diretorId })
        .eq("id", canonico.id);
      const duplicados = grupo.filter((c) => c.id !== canonico.id);
      if (duplicados.length > 0) {
        await db.from("diretor_candidatos").delete().in("id", duplicados.map((c) => c.id));
        cartoesColapsados += duplicados.length;
      }
    } else {
      cartoesColapsados += grupo.length - 1;
    }
  }

  return NextResponse.json({
    dry_run: dryRun,
    candidatos_pendentes: (candidatos ?? []).length,
    grupos: grupos.size,
    grupos_auto_aprovados: autoAprovados,
    grupos_recomputados: recomputados,
    cartoes_colapsados: cartoesColapsados,
    votos_retroativos_criados: votosCriados,
    amostra,
    ...(dryRun ? { notice: "Somente relatório. Repita com ?dry_run=0 para aplicar (auto-aprova >=0.85, recomputa e colapsa o resto)." } : {}),
  });
}
