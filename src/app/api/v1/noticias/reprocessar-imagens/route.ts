/**
 * POST /api/v1/noticias/reprocessar-imagens[?agencia_sigla=ANM][&limit=40]
 *
 * Re-resolve a IMAGEM de notícias já coletadas que estão SEM imagem no banco
 * (`imagem_url IS NULL`). Necessário porque a coleta normal PULA URLs já conhecidas
 * (news-collector.ts: filtro `!knownUrls.has(url)`) — então itens antigos nunca
 * reprocessam a imagem e ficam no placeholder. Aqui re-buscamos o DETALHE via
 * `extractNewsFromUrl` (que ignora knownUrls) e atualizamos `imagem_url` só quando
 * a nova extração produz imagem. Orçamento de tempo contra o SIGKILL. Admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";
import { extractNewsFromUrl } from "@/lib/server/news-collector";
import { hasBudget } from "@/lib/server/time-budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;
  if (isDemo()) {
    return NextResponse.json({ error: "Indisponível em modo DEMO." }, { status: 403 });
  }

  const agenciaSigla = req.nextUrl.searchParams.get("agencia_sigla")?.trim().toUpperCase() || null;
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 40)));
  const deadlineAt = Date.now() + 50_000; // Hobby mata a função aos 60s — corta antes, o resto fica p/ a próxima chamada

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Itens sem imagem, mais recentes primeiro (têm maior chance de a página ainda existir).
  let query = db
    .from("regulatory_news")
    .select("id, url")
    .is("imagem_url", null)
    .order("publicado_em", { ascending: false, nullsFirst: false })
    .order("first_seen_at", { ascending: false })
    .limit(limit);
  if (agenciaSigla) query = query.eq("agencia_sigla", agenciaSigla);

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: "Erro ao listar notícias sem imagem." }, { status: 500 });

  const encontrados = (rows ?? []).length;
  let recuperadas = 0;
  let semImagem = 0;
  let falhas = 0;
  let restantes = 0;

  for (const row of (rows ?? []) as Array<{ id: string; url: string }>) {
    if (!hasBudget(deadlineAt, 8_000)) { restantes++; continue; }
    try {
      const extracted = await extractNewsFromUrl(row.url);
      const novaImagem = extracted?.item.imagem_url ?? null;
      if (!novaImagem) { semImagem++; continue; }
      const { error: updErr } = await db
        .from("regulatory_news")
        .update({ imagem_url: novaImagem, last_seen_at: new Date().toISOString() })
        .eq("id", row.id);
      if (updErr) falhas++;
      else recuperadas++;
    } catch {
      falhas++;
    }
  }

  return NextResponse.json({
    agencia: agenciaSigla,
    encontrados,
    recuperadas,
    sem_imagem: semImagem, // a página realmente não tinha imagem resolvível
    falhas,
    restantes, // ficaram para a próxima rodada (orçamento de tempo) — re-chamar
    legal_notice: "Re-resolução de imagem de notícias já coletadas (ignora o skip de URLs conhecidas). Re-chame enquanto restantes>0.",
  });
}
