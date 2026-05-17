import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { DEMO_ASSOCIADOS } from "@/lib/server/associado-documents";

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams.get("search")?.toLowerCase() ?? "";

  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json(enrichAssociados(DEMO_ASSOCIADOS, [], search));
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const [{ data: associados, error: assocError }, { data: deliberacoes }] = await Promise.all([
    db.from("associados").select("*").eq("ativo", true).order("nome"),
    db
      .from("deliberacoes")
      .select("id, interessado, assunto, processo, microtema, resultado, data_reuniao, agencias(sigla)")
      .limit(5000),
  ]);

  if (assocError) return NextResponse.json({ error: "Erro ao buscar associados" }, { status: 500 });
  return NextResponse.json(enrichAssociados(associados ?? [], deliberacoes ?? [], search));
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

function enrichAssociados(associados: any[], deliberacoes: any[], search: string) {
  return associados
    .filter((associado) => !search || String(associado.nome).toLowerCase().includes(search))
    .map((associado) => {
      const keywords = (associado.palavras_chave ?? []).map(normalize);
      const microtemas = new Set(associado.microtemas ?? []);
      const agencias = new Set(associado.agencia_siglas ?? []);
      const related = deliberacoes.filter((delib) => {
        const sigla = delib.agencias?.sigla;
        const agencyOk = !sigla || agencias.has(sigla);
        const microtemaOk = delib.microtema ? microtemas.has(delib.microtema) : false;
        const haystack = normalize([delib.interessado, delib.assunto, delib.processo].filter(Boolean).join(" "));
        const keywordOk = keywords.some((keyword: string) => keyword && haystack.includes(keyword));
        return agencyOk && (microtemaOk || keywordOk);
      });

      return {
        ...associado,
        plataforma: {
          deliberacoes_relacionadas: related.length,
          ultima_deliberacao: related
            .map((item) => item.data_reuniao ?? "")
            .filter(Boolean)
            .sort()
            .at(-1) ?? null,
          microtemas_detectados: [...new Set(related.map((item) => item.microtema).filter(Boolean))],
          processos: [...new Set(related.map((item) => item.processo).filter(Boolean))].slice(0, 12),
        },
      };
    });
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
