import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { COLEGIADO_SOURCE_URLS, ensureColegiadoSources } from "@/lib/server/colegiado-sources";
import { processMonitoringSite } from "@/lib/server/monitoring-runner";

export const dynamic = "force-dynamic";

const TARGET_YEAR = 2026;

// Backfill das deliberacoes colegiadas de 2026 (ANTT/ANM/ARTESP).
// Descobre tudo que ja saiu em 2026, descarta acervo anterior e auto-enfileira
// os PDFs no pipeline existente (extracao -> votos). Reusa processMonitoringSite.
export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json({
      demo: true,
      ano: TARGET_YEAR,
      resultados: [],
      message: "Modo DEMO: backfill validado sem persistir.",
    });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  try {
    await ensureColegiadoSources(db);
  } catch {
    // Segue com o que houver cadastrado.
  }

  const { data: sites, error } = await db
    .from("monitoramento_sites")
    .select("id, agencia_id, nome, url, estrategia, seletor_links, ativo, tipo_fonte, auto_enfileirar_pdf")
    .in("url", COLEGIADO_SOURCE_URLS);

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar fontes colegiadas" }, { status: 500 });
  }

  const resultados = [];
  let totalEnfileirados = 0;
  let totalNovos = 0;

  for (const site of sites ?? []) {
    // Cobertura ampla para a estrategia antt-2026; ANM/ARTESP usam a listagem HTML.
    const result = await processMonitoringSite(db, site, {
      yearFilter: TARGET_YEAR,
      maxPages: 20,
      maxMeetings: 200,
    });
    totalEnfileirados += result.documentos_enfileirados;
    totalNovos += result.novos_itens;
    resultados.push(result);
  }

  return NextResponse.json({
    ano: TARGET_YEAR,
    fontes_processadas: resultados.length,
    novos_itens: totalNovos,
    documentos_enfileirados: totalEnfileirados,
    resultados,
  });
}
