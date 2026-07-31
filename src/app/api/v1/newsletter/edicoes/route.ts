import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { NEWSLETTER_ARTICLE_TEXT_LIMITS, buildRegulatoryNewsletterHtml, type SocialPostInput, type EventoInput } from "@/lib/newsletter-document";
import { repairRegulatoryNewsItems } from "@/lib/news-repairs";
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
  const variant = body.template_variant === "v2" ? "v2" : "v1";
  const templateVersion = documentoTipo === "minuto_regulacao"
    ? (variant === "v2" ? "iris_minuto_retrospectiva_v2" : "iris_minuto_retrospectiva_v1")
    : (variant === "v2" ? "iris_newsletter_layout_v2" : "iris_newsletter_layout_v1");
  const documentNewsIds = noticiaIds;

  const db = createSupabaseServerClient();
  const { data: noticias, error: newsError } = await db
    .from("regulatory_news")
    .select("*, agencia:agencias(sigla, nome)")
    .in("id", documentNewsIds);

  if (newsError) {
    return NextResponse.json({ error: "Erro ao buscar notícias selecionadas" }, { status: 500 });
  }

  const newsRows = (noticias ?? []) as RegulatoryNews[];
  const orderedNoticias = repairRegulatoryNewsItems(documentNewsIds
    .map((id: string) => newsRows.find((item: RegulatoryNews) => item.id === id))
    .filter((item: RegulatoryNews | undefined): item is RegulatoryNews => Boolean(item)));
  const minutoItems = normalizeMinutoItems(body.minuto_items, orderedNoticias);
  const newsletterTextos = normalizeNewsletterArticleTexts(body.newsletter_textos, orderedNoticias);
  const socialPosts = documentoTipo === "newsletter_regulatoria" ? normalizeSocialPosts(body.social_posts) : [];
  const eventos = documentoTipo === "newsletter_regulatoria" ? normalizeEventos(body.eventos) : [];

  const html = buildRegulatoryNewsletterHtml({
    assunto,
    descricao,
    destinatarios,
    temas,
    noticias: orderedNoticias,
    newsletter_textos: newsletterTextos,
    baseUrl: req.nextUrl.origin,
    documento_tipo: documentoTipo,
    template_version: templateVersion,
    minuto_textos: minutoTextos,
    minuto_items: minutoItems,
    social_posts: socialPosts,
    eventos,
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
        page_count: documentoTipo === "newsletter_regulatoria"
          ? Math.ceil(documentNewsIds.length / 3)
          : documentNewsIds.length,
        page_groups: documentoTipo === "newsletter_regulatoria"
          ? chunkIds(documentNewsIds, 3)
          : documentNewsIds.map((id: string) => [id]),
        newsletter_textos: newsletterTextos,
        minuto_textos: minutoTextos,
        minuto_items: minutoItems,
        social_posts: socialPosts,
        eventos,
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

function normalizeNewsletterArticleTexts(value: unknown, selectedNews: RegulatoryNews[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const allowedIds = selectedNews.map((item) => item.id).filter(Boolean);
  const result: Record<string, string> = {};
  allowedIds.forEach((id, index) => {
    const text = normalizeOptionalString(raw[id], index === 0
      ? NEWSLETTER_ARTICLE_TEXT_LIMITS.main
      : index % 3 === 1
        ? NEWSLETTER_ARTICLE_TEXT_LIMITS.side_1
        : NEWSLETTER_ARTICLE_TEXT_LIMITS.side_2);
    if (text) result[id] = text;
  });
  return result;
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
        subtitulo_minuto: normalizeOptionalString(row.subtitulo_minuto ?? row.subtitulo, 300),
        ato: normalizeOptionalString(row.ato, 500),
        ato_titulo: normalizeOptionalString(row.ato_titulo ?? row.ato, 500),
        texto_minuto: normalizeOptionalString(row.texto_minuto, 2000),
        texto_institucional: normalizeOptionalString(row.texto_institucional ?? row.texto_minuto, 2000),
        editorial_model: normalizeOptionalString(row.editorial_model, 60),
        review_status: normalizeReviewStatus(row.review_status),
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
      subtitulo_minuto: string | null;
      ato: string | null;
      ato_titulo: string | null;
      texto_minuto: string | null;
      texto_institucional: string | null;
      editorial_model: string | null;
      review_status: "pendente" | "revisado" | "aprovado";
      fonte_url: string | null;
    } => Boolean(item))
    .slice(0, 80);
}

function normalizeReviewStatus(value: unknown): "pendente" | "revisado" | "aprovado" {
  return value === "aprovado" || value === "revisado" ? value : "pendente";
}

function chunkIds(ids: string[], size: number) {
  const groups: string[][] = [];
  for (let index = 0; index < ids.length; index += size) groups.push(ids.slice(index, index + size));
  return groups;
}

// Eventos do IRIS (auto-fetch) embutidos no HTML salvo da edição (snapshot).
function normalizeEventos(value: unknown): EventoInput[] {
  if (!Array.isArray(value)) return [];
  const out: EventoInput[] = [];
  for (const raw of value.slice(0, 12)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const titulo = typeof r.titulo === "string" ? r.titulo.trim().slice(0, 240) : "";
    const data = typeof r.data === "string" ? r.data.trim().slice(0, 40) : "";
    if (!titulo || !data) continue;
    out.push({
      titulo,
      data,
      local: typeof r.local === "string" ? r.local.trim().slice(0, 200) : null,
      url: typeof r.url === "string" ? r.url.trim().slice(0, 600) : "https://irisregulacao.org/eventos/",
    });
  }
  return out;
}

// Posts sociais (IG/LinkedIn) colados na newsletter — validação manual (sem zod, padrão do projeto).
function normalizeSocialPosts(value: unknown): SocialPostInput[] {
  if (!Array.isArray(value)) return [];
  const out: SocialPostInput[] = [];
  for (const raw of value.slice(0, 12)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url.trim().slice(0, 600) : "";
    const titulo = typeof r.titulo === "string" ? r.titulo.trim().slice(0, 240) : "";
    if (!url && !titulo) continue; // descarta card vazio
    const imagem = typeof r.imagem_url === "string" ? r.imagem_url.trim().slice(0, 1000) : "";
    out.push({
      rede: r.rede === "linkedin" ? "linkedin" : "instagram",
      url,
      titulo,
      resumo: typeof r.resumo === "string" ? r.resumo.trim().slice(0, 600) : null,
      imagem_url: imagem || null,
    });
  }
  return out;
}
