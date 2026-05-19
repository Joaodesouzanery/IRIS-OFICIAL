import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import type { MonitoramentoSite } from "@/types";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";

const DEMO_SITES: MonitoramentoSite[] = [{
  id: "demo-monitor-artesp",
  agencia_id: "demo-agency-artesp",
  agencia: { sigla: "ARTESP", nome: "ARTESP" },
  nome: "ARTESP - Reuniões da Diretoria",
  url: "https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria",
  estrategia: "html-static",
  tipo_fonte: "documentos_regulatorios",
  auto_enfileirar_pdf: true,
  seletor_links: "a[href]",
  ativo: true,
  ultimo_check: null,
  ultimo_hash: null,
  ultimo_status: "never",
  ultimo_erro: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}];

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) return NextResponse.json(DEMO_SITES);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("monitoramento_sites")
    .select("*, agencia:agencias(sigla, nome)")
    .neq("tipo_fonte", "noticias")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar sites monitorados" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json({ error: "Cadastro indisponível em modo demo" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const nome = typeof body.nome === "string" ? body.nome.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const agencia_id = typeof body.agencia_id === "string" && body.agencia_id ? body.agencia_id : null;
  const estrategia = body.estrategia === "govbr-news"
    ? "govbr-news"
    : body.estrategia === "antt-2026"
      ? "antt-2026"
      : "html-static";
  const tipo_fonte = body.tipo_fonte === "institucional" ? "institucional" : "documentos_regulatorios";
  const auto_enfileirar_pdf = body.auto_enfileirar_pdf === false ? false : true;
  const seletor_links = typeof body.seletor_links === "string" && body.seletor_links.trim()
    ? body.seletor_links.trim()
    : "a[href]";

  if (!nome || nome.length > 200) {
    return NextResponse.json({ error: "Nome inválido" }, { status: 400 });
  }
  try {
    new URL(url);
  } catch {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("monitoramento_sites")
    .insert({ nome, url, agencia_id, seletor_links, estrategia, tipo_fonte, auto_enfileirar_pdf })
    .select("*, agencia:agencias(sigla, nome)")
    .single();

  if (error) {
    return NextResponse.json({ error: "Erro ao criar site monitorado" }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
