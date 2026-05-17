import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import type { FonteOficialTipo } from "@/types";

const SOURCE_TYPES = new Set<FonteOficialTipo>([
  "diario_oficial",
  "pagina_agencia",
  "portal_transparencia",
  "deliberacao",
  "ata",
  "outro",
]);

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) return NextResponse.json([]);

  const agenciaId = req.nextUrl.searchParams.get("agencia_id");
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  let query = db
    .from("fontes_oficiais")
    .select("*, agencia:agencias(sigla, nome)")
    .order("coletado_em", { ascending: false })
    .limit(100);

  if (agenciaId) query = query.eq("agencia_id", agenciaId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Erro ao buscar fontes" }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json({ error: "Cadastro indisponivel em modo demo" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const tipo = SOURCE_TYPES.has(body.tipo) ? body.tipo : "outro";
  const titulo = typeof body.titulo === "string" ? body.titulo.trim().slice(0, 300) : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const agencia_id = typeof body.agencia_id === "string" && body.agencia_id ? body.agencia_id : null;
  const confianca = typeof body.confianca === "number" && body.confianca >= 0 && body.confianca <= 1
    ? body.confianca
    : 0.7;

  if (!titulo) return NextResponse.json({ error: "Titulo obrigatorio" }, { status: 400 });
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "URL invalida" }, { status: 400 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("fontes_oficiais")
    .insert({
      agencia_id,
      tipo,
      titulo,
      url,
      hash_conteudo: typeof body.hash_conteudo === "string" ? body.hash_conteudo.slice(0, 64) : null,
      confianca,
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
    })
    .select("*, agencia:agencias(sigla, nome)")
    .single();

  if (error) return NextResponse.json({ error: "Erro ao criar fonte" }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
