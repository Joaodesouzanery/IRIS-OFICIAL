import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { collectRegulatoryNews } from "@/lib/server/news-collector";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import type { RegulatoryNewsCollectResponse } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return collect(req);
}

export async function GET(req: NextRequest) {
  return collect(req);
}

async function collect(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json(
      { error: "Coleta real indisponível em modo DEMO. Confirme que o ambiente está em Dados Reais para gravar notícias." },
      { status: 403 },
    );
  }

  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  const limit = Math.min(24, Math.max(3, Number(req.nextUrl.searchParams.get("limit") ?? 24)));
  const result = await collectRegulatoryNews(limit);
  const items = result.items;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data: agencias } = await db.from("agencias").select("id, sigla");
  const agencyBySigla = new Map((agencias ?? []).map((a) => [a.sigla, a.id]));

  const rows = items.map((item) => ({
    agencia_id: agencyBySigla.get(item.agencia_sigla) ?? null,
    agencia_sigla: item.agencia_sigla,
    titulo: item.titulo,
    url: item.url,
    fonte: item.fonte,
    imagem_url: item.imagem_url,
    resumo: item.resumo,
    conteudo: item.conteudo,
    publicado_em: item.publicado_em,
    hash_item: item.hash_item,
    metadata: item.metadata,
    last_seen_at: new Date().toISOString(),
  }));

  if (rows.length === 0) {
    return NextResponse.json({
      found: 0,
      upserted: 0,
      items: [],
      source_reports: result.source_reports,
    } satisfies RegulatoryNewsCollectResponse);
  }

  const { data, error } = await db
    .from("regulatory_news")
    .upsert(rows, { onConflict: "url" })
    .select("*, agencia:agencias(sigla, nome)");

  if (error) {
    return NextResponse.json({ error: "Erro ao salvar notícias coletadas" }, { status: 500 });
  }

  return NextResponse.json({
    found: items.length,
    upserted: data?.length ?? 0,
    items: data ?? [],
    source_reports: result.source_reports,
  } satisfies RegulatoryNewsCollectResponse);
}
