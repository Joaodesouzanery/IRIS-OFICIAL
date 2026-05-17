import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { buildRegulatoryNewsletterHtml } from "@/lib/newsletter-document";
import { getAuthenticatedUser, requireAdmin } from "@/lib/server/request-guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RegulatoryNews, RegulatoryNewsletterEditionCreateResponse } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("regulatory_newsletter_editions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ error: "Erro ao listar edições de newsletter" }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (isDemo()) {
    return NextResponse.json({ error: "Edições de newsletter indisponíveis em modo DEMO" }, { status: 403 });
  }

  const guard = await requireAdmin(req);
  if (guard) return guard;

  const userResult = await getAuthenticatedUser(req);
  if (userResult instanceof NextResponse) return userResult;

  const body = await req.json().catch(() => ({}));
  const noticiaIds = Array.isArray(body.noticia_ids)
    ? body.noticia_ids.map(String).filter(Boolean)
    : [];
  if (noticiaIds.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos uma notícia" }, { status: 400 });
  }

  const assunto = normalizeString(body.assunto, "Newsletter Regulatório - Atualização semanal", 240);
  const descricao = normalizeOptionalString(body.descricao, 2000);
  const destinatarios = normalizeStringArray(body.destinatarios, 200);
  const temas = normalizeStringArray(body.temas, 40);

  const db = createSupabaseServerClient();
  const { data: noticias, error: newsError } = await db
    .from("regulatory_news")
    .select("*, agencia:agencias(sigla, nome)")
    .in("id", noticiaIds);

  if (newsError) {
    return NextResponse.json({ error: "Erro ao buscar notícias selecionadas" }, { status: 500 });
  }

  const newsRows = (noticias ?? []) as RegulatoryNews[];
  const orderedNoticias = noticiaIds
    .map((id: string) => newsRows.find((item: RegulatoryNews) => item.id === id))
    .filter((item: RegulatoryNews | undefined): item is RegulatoryNews => Boolean(item));

  const html = buildRegulatoryNewsletterHtml({
    assunto,
    descricao,
    destinatarios,
    temas,
    noticias: orderedNoticias,
    baseUrl: req.nextUrl.origin,
  });

  const { data, error } = await db
    .from("regulatory_newsletter_editions")
    .insert({
      assunto,
      descricao,
      destinatarios,
      temas,
      noticia_ids: noticiaIds,
      status: "rascunho",
      html,
      created_by: userResult.id,
      created_by_email: userResult.email,
      metadata: {
        source: "noticias",
        generated_at: new Date().toISOString(),
      },
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Erro ao salvar edição de newsletter" }, { status: 500 });
  }

  return NextResponse.json({ edition: data } satisfies RegulatoryNewsletterEditionCreateResponse, { status: 201 });
}

function normalizeString(value: unknown, fallback: string, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

function normalizeOptionalString(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function normalizeStringArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, maxItems);
}
