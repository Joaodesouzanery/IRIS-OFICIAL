import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { COLEGIADO_SOURCE_URLS, ensureColegiadoSources } from "@/lib/server/colegiado-sources";
import { processMonitoringSite } from "@/lib/server/monitoring-runner";
import { buildAnttMeetingSkipSet } from "@/lib/server/antt-2026-collector";
import { hasBudget, HOBBY_BUDGET_MS } from "@/lib/server/time-budget";

export const dynamic = "force-dynamic";

const TARGET_YEAR = 2026;

// Backfill das deliberacoes colegiadas de 2026 (ANTT/ANM/ARTESP).
// Descobre tudo que ja saiu em 2026, descarta acervo anterior e auto-enfileira
// os PDFs no pipeline existente (extracao -> votos). Reusa processMonitoringSite.

// Vercel Cron só emite GET (com Bearer CRON_SECRET): rede de segurança SEMANAL para
// qualquer reunião de 2026 que escape dos crons diários.
export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json({
      demo: true,
      ano: TARGET_YEAR,
      parcial: false,
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

  // Mais antigo primeiro (rotação justa) + orçamento REAL: deadlineAt desce até os
  // loops dos collectors — antes era checado só entre fontes e a ANTT sozinha
  // (200 reuniões × throttle 800ms ≈ 160s) estourava o limite Hobby (60s SIGKILL)
  // ("An error occurred with your deployment" no botão). O skip-set torna o
  // re-run barato: reuniões com ata já capturada não são re-buscadas.
  const startedAt = Date.now();
  const deadlineAt = startedAt + HOBBY_BUDGET_MS;
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  const { data: sites, error } = await db
    .from("monitoramento_sites")
    .select("id, agencia_id, nome, url, estrategia, seletor_links, ativo, tipo_fonte, auto_enfileirar_pdf, ultimo_check")
    .in("url", COLEGIADO_SOURCE_URLS)
    .order("ultimo_check", { ascending: true, nullsFirst: true });

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar fontes colegiadas" }, { status: 500 });
  }

  const anttSite = (sites ?? []).find((s) => s.estrategia === "antt-2026");
  const skipSet = !refresh && anttSite
    ? await buildAnttMeetingSkipSet(db, { siteId: anttSite.id })
    : undefined;

  const resultados = [];
  let totalEnfileirados = 0;
  let totalNovos = 0;
  let reunioesPuladas = 0;
  let pulados = 0;

  for (const site of sites ?? []) {
    if (!hasBudget(deadlineAt, 15_000)) {
      pulados += 1;
      continue;
    }
    // Cobertura ampla para a estrategia antt-2026; ANM/ARTESP usam a listagem HTML.
    const result = await processMonitoringSite(db, site, {
      yearFilter: TARGET_YEAR,
      maxPages: 20,
      maxMeetings: 200,
      deadlineAt,
      skipMeetingUrls: site.estrategia === "antt-2026" ? skipSet : undefined,
      triggerType: "backfill",
    });
    totalEnfileirados += result.documentos_enfileirados;
    totalNovos += result.novos_itens;
    reunioesPuladas += result.reunioes_puladas_conhecidas ?? 0;
    resultados.push(result);
  }

  if (pulados > 0) console.warn(`[votos-diretores/backfill] orçamento de tempo esgotado — ${pulados} fonte(s) ficaram para a próxima rodada.`);

  return NextResponse.json({
    ano: TARGET_YEAR,
    parcial: pulados > 0 || resultados.some((r) => r.parcial),
    fontes_processadas: resultados.length,
    fontes_puladas: pulados,
    novos_itens: totalNovos,
    documentos_enfileirados: totalEnfileirados,
    reunioes_puladas_conhecidas: reunioesPuladas,
    duracao_ms: Date.now() - startedAt,
    resultados,
  });
}
