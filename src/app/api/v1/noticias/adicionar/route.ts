/**
 * POST /api/v1/noticias/adicionar
 * "Colar link" → o sistema ingere UMA notícia de uma URL (gov.br/ARTESP/qualquer),
 * reusando o mesmo parser + validação de imagem da coleta automática. Serve para
 * trazer notícias que o crawler não pegou e para selecioná-las no Minuto da
 * Regulação / Newsletter Regulatório. Admin-only, demo-guarded.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { extractNewsFromUrl } from "@/lib/server/news-collector";
import { assertPublicUrl } from "@/lib/server/url-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // fetch do artigo + validação de imagem
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json(
      { error: "Ingestão por link indisponível em modo DEMO. Confirme que o ambiente está em Dados Reais." },
      { status: 403 },
    );
  }
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
  if (!rawUrl) {
    return NextResponse.json({ error: "Informe a URL da notícia (campo 'url')." }, { status: 400 });
  }
  // Guard anti-SSRF na FRONTEIRA (mesmo helper de monitoramento/sites e resilient-fetch):
  // rejeita protocolo não-http(s) E host interno/loopback/metadata (169.254…) antes de
  // qualquer fetch. resilient-fetch ainda revalida cada redirect a jusante.
  try {
    assertPublicUrl(rawUrl);
  } catch {
    return NextResponse.json({ error: "URL inválida ou não permitida. Cole o link público completo da notícia (https://...)." }, { status: 400 });
  }

  let extracted: Awaited<ReturnType<typeof extractNewsFromUrl>>;
  try {
    extracted = await extractNewsFromUrl(rawUrl);
  } catch (error) {
    console.error("[noticias/adicionar] Falha ao extrair:", error);
    return NextResponse.json({ error: "Não foi possível ler a notícia desse link (a página pode ter bloqueado o acesso)." }, { status: 502 });
  }
  if (!extracted || !extracted.item.titulo) {
    return NextResponse.json({ error: "Não encontrei uma notícia válida nesse link (sem título/conteúdo reconhecível)." }, { status: 422 });
  }

  const { item, detected } = extracted;
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Resolve a agência pela sigla detectada (pode não estar cadastrada — segue com null).
  const { data: agencia } = await db
    .from("agencias")
    .select("id, sigla, nome")
    .ilike("sigla", detected.agencia_sigla)
    .maybeSingle();

  const row: Record<string, unknown> = {
    agencia_id: agencia?.id ?? null,
    agencia_sigla: item.agencia_sigla,
    titulo: item.titulo,
    url: item.url,
    fonte: item.fonte,
    publicado_em: item.publicado_em,
    hash_item: item.hash_item,
    status_curadoria: "novo",
    imagem_url: item.imagem_url ?? null,
    resumo: item.resumo ?? null,
    conteudo: item.conteudo ?? null,
    last_seen_at: new Date().toISOString(),
    metadata: {
      ...item.metadata,
      origem: "manual",
      adicionado_em: new Date().toISOString(),
      agencia_detectada: detected.agencia_sigla,
      agencia_cadastrada: Boolean(agencia?.id),
    },
  };

  const { data, error } = await db
    .from("regulatory_news")
    .upsert(row, { onConflict: "url" })
    .select("*, agencia:agencias(sigla, nome)")
    .single();

  if (error) {
    console.error("[noticias/adicionar] Falha ao salvar:", error);
    return NextResponse.json({ error: `Erro ao salvar a notícia: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    noticia: data,
    agencia_detectada: detected.agencia_sigla,
    agencia_cadastrada: Boolean(agencia?.id),
    imagem_status: item.metadata.image_status ?? null,
  });
}
