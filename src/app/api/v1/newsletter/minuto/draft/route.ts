import { NextRequest, NextResponse } from "next/server";
import {
  buildMinutoRegulacaoDraftJson,
  buildMinutoRegulacaoPrompt,
  type MinutoRegulacaoItemInput,
} from "@/lib/newsletter-document";
import { requireAdmin } from "@/lib/server/request-guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RegulatoryNews } from "@/types";

export const dynamic = "force-dynamic";

type MinutoDraft = {
  titulo_geral: string;
  subtitulo_geral: string;
  itens: MinutoRegulacaoItemInput[];
  llm_used: boolean;
  review_required: boolean;
  prompt?: string;
};

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const noticiaIds = Array.isArray(body.noticia_ids)
    ? body.noticia_ids.map(String).filter(Boolean).slice(0, 12)
    : [];
  if (noticiaIds.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos uma noticia" }, { status: 400 });
  }

  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("regulatory_news")
    .select("*, agencia:agencias(sigla, nome)")
    .in("id", noticiaIds);

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar noticias selecionadas" }, { status: 500 });
  }

  const rows = (data ?? []) as RegulatoryNews[];
  const noticias = noticiaIds
    .map((id: string) => rows.find((item) => item.id === id))
    .filter((item: RegulatoryNews | undefined): item is RegulatoryNews => Boolean(item));
  if (noticias.length === 0) {
    return NextResponse.json({ error: "Noticias selecionadas nao encontradas" }, { status: 404 });
  }

  const prompt = buildMinutoRegulacaoPrompt(noticias);
  const llmDraft = await callConfiguredEditorialLlm(prompt);
  const fallback = buildDeterministicDraft(noticias);
  const draft = llmDraft ? mergeDraft(fallback, llmDraft) : fallback;

  return NextResponse.json({
    ...draft,
    llm_used: Boolean(llmDraft),
    review_required: !llmDraft,
    prompt: llmDraft ? undefined : prompt,
  } satisfies MinutoDraft);
}

async function callConfiguredEditorialLlm(prompt: string): Promise<Partial<MinutoDraft> | null> {
  const url = process.env.MINUTO_EDITORIAL_API_URL;
  if (!url) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (process.env.MINUTO_EDITORIAL_API_TOKEN) headers.authorization = `Bearer ${process.env.MINUTO_EDITORIAL_API_TOKEN}`;
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt, response_format: "json" }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const json = await response.json().catch(() => null);
    return normalizeLlmDraft(json);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildDeterministicDraft(noticias: RegulatoryNews[]): MinutoDraft {
  const parsed = JSON.parse(buildMinutoRegulacaoDraftJson(noticias)) as { itens?: MinutoRegulacaoItemInput[] };
  const agencies = [...new Set(noticias.map((item) => item.agencia_sigla ?? item.agencia?.sigla ?? item.fonte).filter(Boolean))];
  const title = agencies.length > 1 ? "Minuto da Regulação" : `Minuto da Regulação - ${agencies[0] ?? "Fontes oficiais"}`;
  return {
    titulo_geral: title,
    subtitulo_geral: buildGeneralSubtitle(noticias),
    itens: parsed.itens ?? [],
    llm_used: false,
    review_required: true,
  };
}

function mergeDraft(fallback: MinutoDraft, llm: Partial<MinutoDraft>): MinutoDraft {
  const fallbackById = new Map(fallback.itens.map((item) => [item.noticia_id, item]));
  const fallbackByUrl = new Map(fallback.itens.map((item) => [item.fonte_url, item]));
  const llmItems = normalizeItems(llm.itens).map((item, index) => {
    const fallbackItem = (item.noticia_id ? fallbackById.get(item.noticia_id) : undefined)
      ?? (item.fonte_url ? fallbackByUrl.get(item.fonte_url) : undefined)
      ?? fallback.itens[index];
    return {
      ...item,
      imagem_url: item.imagem_url ?? fallbackItem?.imagem_url ?? null,
      imagem_alt: item.imagem_alt ?? fallbackItem?.imagem_alt ?? item.titulo_minuto ?? null,
      fonte_url: item.fonte_url ?? fallbackItem?.fonte_url ?? null,
      noticia_id: item.noticia_id ?? fallbackItem?.noticia_id ?? null,
    };
  });
  return {
    titulo_geral: normalizeString(llm.titulo_geral, fallback.titulo_geral, 160),
    subtitulo_geral: normalizeString(llm.subtitulo_geral, fallback.subtitulo_geral, 260),
    itens: llmItems.length ? llmItems : fallback.itens,
    llm_used: true,
    review_required: false,
  };
}

function normalizeLlmDraft(value: unknown): Partial<MinutoDraft> | null {
  const payload = typeof value === "object" && value ? value as Record<string, unknown> : null;
  if (!payload) return null;
  const content = typeof payload.content === "string" ? parseJson(payload.content) : payload;
  if (!content || typeof content !== "object") return null;
  const row = content as Record<string, unknown>;
  return {
    titulo_geral: typeof row.titulo_geral === "string" ? row.titulo_geral : undefined,
    subtitulo_geral: typeof row.subtitulo_geral === "string" ? row.subtitulo_geral : undefined,
    itens: normalizeItems(row.itens),
  };
}

function normalizeItems(value: unknown): MinutoRegulacaoItemInput[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      return {
        noticia_id: optionalString(row.noticia_id ?? row.id, 80),
        data: optionalString(row.data, 80),
        agencia: optionalString(row.agencia, 240),
        imagem_url: optionalString(row.imagem_url, 1200),
        imagem_alt: optionalString(row.imagem_alt, 240),
        titulo_minuto: optionalString(row.titulo_minuto ?? row.titulo, 160),
        subtitulo_minuto: optionalString(row.subtitulo_minuto ?? row.subtitulo, 240),
        ato: null,
        ato_titulo: null,
        texto_minuto: optionalString(row.texto_minuto ?? row.roteiro ?? row.texto, 3000),
        texto_institucional: optionalString(row.texto_institucional ?? row.texto_minuto ?? row.roteiro ?? row.texto, 3000),
        editorial_model: optionalString(row.editorial_model, 60),
        review_status: "revisado",
        fonte_url: optionalString(row.fonte_url ?? row.url, 1000),
      };
    })
    .filter(Boolean) as MinutoRegulacaoItemInput[];
}

function buildGeneralSubtitle(noticias: RegulatoryNews[]) {
  const agencies = [...new Set(noticias.map((item) => item.agencia_sigla ?? item.agencia?.sigla ?? item.fonte).filter(Boolean))];
  const titles = noticias.map((item) => item.titulo.split(":")[0]).filter(Boolean).slice(0, 3);
  const agencyText = agencies.length ? agencies.join(", ") : "fontes oficiais";
  return normalizeString(`Atualizacao regulatoria com destaques de ${agencyText}: ${titles.join("; ")}.`, "Atualizacao regulatoria com base em fontes oficiais.", 260);
}

function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeString(value: unknown, fallback: string, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ").slice(0, max) : fallback;
}

function optionalString(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ").slice(0, max) : null;
}
