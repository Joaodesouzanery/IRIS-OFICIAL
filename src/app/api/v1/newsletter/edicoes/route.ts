import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { buildRegulatoryNewsletterHtml } from "@/lib/newsletter-document";
import { getAuthenticatedUser, requireAdmin } from "@/lib/server/request-guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { NewsletterDocumentType, RegulatoryNews, RegulatoryNewsletterEditionCreateResponse } from "@/types";

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
  const documentoTipo = normalizeDocumentType(body.documento_tipo);
  const minutoTextos = normalizeStringArray(body.minuto_textos, 80);
  const templateVersion = documentoTipo === "minuto_regulacao" ? "iris_minuto_retrospectiva_v1" : "iris_newsletter_layout_v1";
  const documentNewsIds = documentoTipo === "newsletter_regulatoria" ? noticiaIds.slice(0, 3) : noticiaIds;

  const db = createSupabaseServerClient();
  const { data: noticias, error: newsError } = await db
    .from("regulatory_news")
    .select("*, agencia:agencias(sigla, nome)")
    .in("id", documentNewsIds);

  if (newsError) {
    return NextResponse.json({ error: "Erro ao buscar notícias selecionadas" }, { status: 500 });
  }

  const newsRows = (noticias ?? []) as RegulatoryNews[];
  const orderedNoticias = documentNewsIds
    .map((id: string) => newsRows.find((item: RegulatoryNews) => item.id === id))
    .filter((item: RegulatoryNews | undefined): item is RegulatoryNews => Boolean(item));
  const minutoItems = normalizeMinutoItems(body.minuto_items, orderedNoticias);

  const html = buildRegulatoryNewsletterHtml({
    assunto,
    descricao,
    destinatarios,
    temas,
    noticias: orderedNoticias,
    baseUrl: req.nextUrl.origin,
    documento_tipo: documentoTipo,
    minuto_textos: minutoTextos,
    minuto_items: minutoItems,
  });

  const { data, error } = await db
    .from("regulatory_newsletter_editions")
    .insert({
      assunto,
      descricao,
      destinatarios,
      temas,
      noticia_ids: documentNewsIds,
      documento_tipo: documentoTipo,
      template_version: templateVersion,
      status: "rascunho",
      html,
      created_by: userResult.id,
      created_by_email: userResult.email,
      metadata: {
        source: "noticias",
        documento_tipo: documentoTipo,
        template_version: templateVersion,
        generated_at: new Date().toISOString(),
        selected_news_count: documentNewsIds.length,
        minuto_textos: minutoTextos,
        minuto_items: minutoItems,
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

function normalizeDocumentType(value: unknown): NewsletterDocumentType {
  return value === "minuto_regulacao" ? "minuto_regulacao" : "newsletter_regulatoria";
}

function normalizeMinutoItems(value: unknown, selectedNews: RegulatoryNews[]) {
  if (!Array.isArray(value)) return [];
  const allowedIds = new Set(selectedNews.map((item) => item.id).filter(Boolean));
  const allowedUrls = new Set(selectedNews.map((item) => item.url).filter(Boolean));
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      return {
        noticia_id: normalizeOptionalString(row.noticia_id ?? row.id, 80),
        data: normalizeOptionalString(row.data, 80),
        agencia: normalizeOptionalString(row.agencia, 240),
        titulo_minuto: normalizeOptionalString(row.titulo_minuto, 300),
        ato: normalizeOptionalString(row.ato, 500),
        texto_minuto: normalizeOptionalString(row.texto_minuto, 2000),
        fonte_url: normalizeOptionalString(row.fonte_url, 1000),
      };
    })
    .filter((item) => {
      if (!item) return false;
      if (!allowedIds.size && !allowedUrls.size) return true;
      if (item.noticia_id && allowedIds.has(item.noticia_id)) return true;
      if (item.fonte_url && allowedUrls.has(item.fonte_url)) return true;
      return false;
    })
    .filter((item): item is {
      noticia_id: string | null;
      data: string | null;
      agencia: string | null;
      titulo_minuto: string | null;
      ato: string | null;
      texto_minuto: string | null;
      fonte_url: string | null;
    } => Boolean(item))
    .slice(0, 80);
}
