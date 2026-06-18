import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";
import { COLEGIADO_SOURCE_URLS, ensureColegiadoSources } from "@/lib/server/colegiado-sources";
import { tipoPrioridade } from "@/lib/server/monitoring";

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
      .limit(120);

    // Decisoes (voto/ata) primeiro; depois deliberacoes/pautas. Itens sem
    // data_reuniao sao marcados como "a revisar" e vao para o fim da lista.
    itens = (itensData ?? [])
      .map((item) => ({
        ...item,
        prioridade: (item.metadata as { prioridade?: number } | null)?.prioridade ?? tipoPrioridade(item.tipo),
        a_revisar: !item.data_reuniao,
      }))
      .sort((a, b) => {
        if (a.a_revisar !== b.a_revisar) return a.a_revisar ? 1 : -1;
        if (b.prioridade !== a.prioridade) return b.prioridade - a.prioridade;
        return String(b.data_reuniao ?? "").localeCompare(String(a.data_reuniao ?? ""));
      })
      .slice(0, 60);
  }

  return NextResponse.json({ sources: sources ?? [], itens });
}
