import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";
import { COLEGIADO_SOURCE_URLS, ensureColegiadoSources } from "@/lib/server/colegiado-sources";

export const dynamic = "force-dynamic";

// Status das fontes de reunioes colegiadas (ANTT/ANM/ARTESP) e documentos de
// decisao detectados, para alimentar a aba "Votos dos Diretores".
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json({ sources: [], itens: [], demo: true });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  try {
    await ensureColegiadoSources(db);
  } catch {
    // Segue mesmo se o seed falhar — exibimos o que houver cadastrado.
  }

  const { data: sources, error: sourcesError } = await db
    .from("monitoramento_sites")
    .select("*, agencia:agencias(sigla, nome)")
    .in("url", COLEGIADO_SOURCE_URLS);

  if (sourcesError) {
    return NextResponse.json({ error: "Erro ao buscar fontes colegiadas" }, { status: 500 });
  }

  const siteIds = (sources ?? []).map((site) => site.id);
  let itens: unknown[] = [];
  if (siteIds.length) {
    const { data: itensData } = await db
      .from("monitoramento_itens")
      .select("*, agencia:agencias(sigla, nome), site:monitoramento_sites(nome, url)")
      .in("site_id", siteIds)
      .in("tipo", ["deliberacao", "voto", "ata", "pauta", "documento"])
      .or("data_reuniao.gte.2026-01-01,data_reuniao.is.null")
      .order("first_seen_at", { ascending: false })
      .limit(60);
    itens = itensData ?? [];
  }

  return NextResponse.json({ sources: sources ?? [], itens });
}
