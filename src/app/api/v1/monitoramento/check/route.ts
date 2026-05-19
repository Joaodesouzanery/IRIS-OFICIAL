import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { fetchMonitoringSite } from "@/lib/server/monitoring";
import type { MonitoramentoCheckResponse } from "@/types";
import { requireAdminOrCron } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

const DEMO_SITE = {
  id: "demo-monitor-artesp",
  agencia_id: "demo-agency-artesp",
  nome: "ARTESP - Reuniões da Diretoria",
  url: "https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria",
  seletor_links: "a[href]",
  tipo_fonte: "documentos_regulatorios",
  auto_enfileirar_pdf: true,
};

const DEMO_SITES = [DEMO_SITE];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  if (isDemo()) {
    const runs: MonitoramentoCheckResponse["runs"] = [];
    let novos = 0;
    for (const site of DEMO_SITES) {
      try {
        const result = await fetchMonitoringSite(site);
        novos += result.items.length;
        runs.push({
          site_id: site.id,
          site_nome: site.nome,
          status: result.needsHeadless ? "needs_headless" : "ok",
          itens_encontrados: result.items.length,
          novos_itens: result.items.length,
        });
      } catch (error) {
        runs.push({
          site_id: site.id,
          site_nome: site.nome,
          status: "error",
          itens_encontrados: 0,
          novos_itens: 0,
          error: error instanceof Error ? error.message : "Erro inesperado",
        });
      }
    }
    return NextResponse.json({
      checked: DEMO_SITES.length,
      novos_detectados: novos,
      runs,
    } satisfies MonitoramentoCheckResponse);
    /*
    try {
      const result = await fetchMonitoringSite(DEMO_SITE);
      return NextResponse.json({
        checked: 1,
        novos_detectados: result.items.length,
        runs: [{
          site_id: DEMO_SITE.id,
          site_nome: DEMO_SITE.nome,
          status: result.needsHeadless ? "needs_headless" : "ok",
          itens_encontrados: result.items.length,
          novos_itens: result.items.length,
        }],
      } satisfies MonitoramentoCheckResponse);
    } catch (error) {
      return NextResponse.json({
        checked: 1,
        novos_detectados: 0,
        runs: [{
          site_id: DEMO_SITE.id,
          site_nome: DEMO_SITE.nome,
          status: "error",
          itens_encontrados: 0,
          novos_itens: 0,
          error: error instanceof Error ? error.message : "Erro inesperado",
        }],
      } satisfies MonitoramentoCheckResponse);
    }
    */
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: sites, error } = await db
    .from("monitoramento_sites")
    .select("id, agencia_id, nome, url, estrategia, seletor_links, ativo, tipo_fonte, auto_enfileirar_pdf")
    .eq("ativo", true)
    .neq("tipo_fonte", "noticias");

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar sites monitorados" }, { status: 500 });
  }

  const runs: MonitoramentoCheckResponse["runs"] = [];
  let novosDetectados = 0;

  for (const site of sites ?? []) {
    const { data: run } = await db
      .from("monitoramento_runs")
      .insert({ site_id: site.id, status: "running" })
      .select("id")
      .single();

    try {
      const result = await fetchMonitoringSite(site);
      let novosItens = 0;
      let documentosEnfileirados = 0;

      for (const item of result.items) {
        const { data: inserted, error: insertError } = await db
          .from("monitoramento_itens")
          .insert({
            site_id: site.id,
            agencia_id: site.agencia_id,
            tipo: item.tipo,
            titulo: item.titulo,
            url_item: item.url_item,
            reuniao: item.reuniao,
            data_reuniao: item.data_reuniao,
            hash_item: item.hash_item,
            metadata: item.metadata,
          })
          .select("id, titulo, url_item")
          .single();

        if (insertError) {
          if (insertError.code === "23505") {
            await db
              .from("monitoramento_itens")
              .update({ last_seen_at: new Date().toISOString() })
              .eq("site_id", site.id)
              .eq("hash_item", item.hash_item);
          }
          continue;
        }

        if (inserted) {
          novosItens++;
          const enqueued = await tryAutoEnqueueMonitoredDocument(db, site, item, inserted.id as string);
          if (enqueued.enqueued) documentosEnfileirados++;
          await db.from("monitoramento_alertas").insert({
            item_id: inserted.id,
            site_id: site.id,
            agencia_id: site.agencia_id,
            tipo: enqueued.enqueued ? "documento_enfileirado" : "novo_item",
            titulo: inserted.titulo,
            url_item: inserted.url_item,
          });
        }
      }

      const status = result.needsHeadless ? "needs_headless" : "ok";
      const sitePatch: Record<string, unknown> = {
        ultimo_check: new Date().toISOString(),
        ultimo_hash: result.contentHash,
        ultimo_status: status,
        ultimo_erro: null,
      };
      if (result.needsHeadless) sitePatch.estrategia = "needs-headless";
      await db.from("monitoramento_sites").update(sitePatch).eq("id", site.id);

      if (run) {
        await db.from("monitoramento_runs").update({
          finished_at: new Date().toISOString(),
          status,
          itens_encontrados: result.items.length,
          novos_itens: novosItens,
          documentos_enfileirados: documentosEnfileirados,
        }).eq("id", run.id);
      }

      novosDetectados += novosItens;
      runs.push({
        site_id: site.id,
        site_nome: site.nome,
        status,
        itens_encontrados: result.items.length,
        novos_itens: novosItens,
        documentos_enfileirados: documentosEnfileirados,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro inesperado";
      await db.from("monitoramento_sites").update({
        ultimo_check: new Date().toISOString(),
        ultimo_status: "error",
        ultimo_erro: message.slice(0, 1000),
      }).eq("id", site.id);

      if (run) {
        await db.from("monitoramento_runs").update({
          finished_at: new Date().toISOString(),
          status: "error",
          error_message: message.slice(0, 1000),
        }).eq("id", run.id);
      }

      runs.push({
        site_id: site.id,
        site_nome: site.nome,
        status: "error",
        itens_encontrados: 0,
        novos_itens: 0,
        error: message,
      });
    }
  }

  return NextResponse.json({
    checked: sites?.length ?? 0,
    novos_detectados: novosDetectados,
    runs,
  } satisfies MonitoramentoCheckResponse);
}

async function tryAutoEnqueueMonitoredDocument(
  db: any,
  site: {
    id: string;
    agencia_id: string | null;
    nome: string;
    auto_enfileirar_pdf?: boolean | null;
    tipo_fonte?: string | null;
  },
  item: { tipo: string; titulo: string; url_item: string; hash_item: string; metadata: Record<string, unknown> },
  itemId: string,
): Promise<{ enqueued: boolean }> {
  if (site.tipo_fonte === "noticias" || site.auto_enfileirar_pdf === false) return { enqueued: false };
  if (!["pauta", "ata", "voto", "deliberacao", "documento"].includes(item.tipo)) return { enqueued: false };

  const pdf = await downloadPdfIfAvailable(item.url_item);
  if (!pdf) return { enqueued: false };

  const { ensurePdfStorageBucket, enqueuePdfBuffer } = await import("@/lib/server/upload-queue");
  const bucketErr = await ensurePdfStorageBucket(db);
  if (bucketErr) {
    await db
      .from("monitoramento_itens")
      .update({
        metadata: {
          ...item.metadata,
          auto_enqueue_error: bucketErr,
        },
      })
      .eq("id", itemId);
    return { enqueued: false };
  }

  const result = await enqueuePdfBuffer({
    db,
    filename: pdf.filename,
    buffer: pdf.buffer,
    agenciaId: site.agencia_id,
    metadata: {
      uploaded_via: "monitoramento",
      monitoramento_site_id: site.id,
      monitoramento_item_id: itemId,
      monitoramento_url: item.url_item,
      monitoramento_hash: item.hash_item,
      source_title: item.titulo,
    },
  });

  await db
    .from("monitoramento_itens")
    .update({
      upload_job_id: result.job_id,
      documento_id: result.document_id,
      enfileirado_em: result.status !== "rejected" && result.status !== "error" && result.status !== "duplicate_confirmed"
        ? new Date().toISOString()
        : null,
      status: result.status !== "rejected" && result.status !== "error" && result.status !== "duplicate_confirmed" ? "em_revisao" : "novo",
      metadata: {
        ...item.metadata,
        auto_enqueue_status: result.status,
        auto_enqueue_message: result.message ?? null,
      },
    })
    .eq("id", itemId);

  return { enqueued: result.status !== "rejected" && result.status !== "error" && result.status !== "duplicate_confirmed" };
}

async function downloadPdfIfAvailable(url: string): Promise<{ filename: string; buffer: Buffer } | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "IRIS-Regulacao-Monitor/1.0",
      Accept: "application/pdf,application/octet-stream,*/*",
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await res.arrayBuffer());
  const isPdf = contentType.includes("pdf") || buffer.subarray(0, 5).toString("utf8") === "%PDF-";
  if (!isPdf) return null;
  return {
    filename: filenameFromResponse(url, res.headers.get("content-disposition")),
    buffer,
  };
}

function filenameFromResponse(url: string, disposition: string | null) {
  const quoted = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(disposition ?? "")?.[1];
  if (quoted) return decodeURIComponentSafe(quoted).replace(/^"|"$/g, "");
  try {
    const path = new URL(url).pathname;
    const tail = decodeURIComponent(path.split("/").filter(Boolean).at(-1) ?? "");
    if (tail && tail.includes(".")) return tail;
  } catch {
    // Fallback below.
  }
  return `documento-monitorado-${Date.now()}.pdf`;
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
