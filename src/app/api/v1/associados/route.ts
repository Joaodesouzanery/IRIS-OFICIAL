import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { DEMO_ASSOCIADOS } from "@/lib/server/associado-documents";

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) return NextResponse.json(DEMO_ASSOCIADOS);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("associados")
    .select("*")
    .eq("ativo", true)
    .order("nome");

  if (error) return NextResponse.json({ error: "Erro ao buscar associados" }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) return NextResponse.json({ error: "Cadastro indisponivel em modo demo" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const nome = typeof body.nome === "string" ? body.nome.trim() : "";
  const setor = typeof body.setor === "string" ? body.setor.trim() : "";
  if (!nome || !setor) {
    return NextResponse.json({ error: "nome e setor sao obrigatorios" }, { status: 400 });
  }

  const payload = {
    nome,
    setor,
    descricao: typeof body.descricao === "string" ? body.descricao : null,
    agencia_siglas: Array.isArray(body.agencia_siglas) ? body.agencia_siglas.map(String) : [],
    ministerios: Array.isArray(body.ministerios) ? body.ministerios.map(String) : [],
    ministerio_urls: Array.isArray(body.ministerio_urls) ? body.ministerio_urls.map(String) : [],
    microtemas: Array.isArray(body.microtemas) ? body.microtemas.map(String) : [],
    palavras_chave: Array.isArray(body.palavras_chave) ? body.palavras_chave.map(String) : [],
    vp_nome: typeof body.vp_nome === "string" ? body.vp_nome : null,
    vp_cargo: typeof body.vp_cargo === "string" ? body.vp_cargo : null,
    vp_minibio: typeof body.vp_minibio === "string" ? body.vp_minibio : null,
    vp_foto_url: typeof body.vp_foto_url === "string" ? body.vp_foto_url : null,
    ativo: body.ativo !== false,
  };

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db.from("associados").insert(payload).select("*").single();
  if (error) return NextResponse.json({ error: "Erro ao criar associado" }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
