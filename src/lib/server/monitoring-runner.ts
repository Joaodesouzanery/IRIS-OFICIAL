import { fetchMonitoringSite, tipoPrioridade } from "@/lib/server/monitoring";
import { resilientFetch, drainFetchStats } from "@/lib/server/resilient-fetch";
import { drainHeadlessOutcomes } from "@/lib/server/headless";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Tipos minimos compartilhados entre o check incremental e o backfill.
export type MonitoringSiteRow = {
  id: string;
  agencia_id: string | null;
  nome: string;
  url: string;
  estrategia?: string | null;
  seletor_links?: string | null;
  ativo?: boolean | null;
  tipo_fonte?: string | null;
  auto_enfileirar_pdf?: boolean | null;
};

export type ProcessSiteOptions = {
  /** Ano minimo aceito (ex.: 2026). Itens com ano detectavel anterior sao descartados. */
  yearFilter?: number;
  /** Limites de descoberta repassados ao coletor (usado pela estrategia antt-2026). */
  maxPages?: number;
  maxMeetings?: number;
  /** Origem da execucao para telemetria. Padrao: 'scheduled'. */
  triggerType?: "manual" | "scheduled" | "test" | "backfill";
};

export type ProcessSiteResult = {
  site_id: string;
  site_nome: string;
  status: string;
  itens_encontrados: number;
  novos_itens: number;
  documentos_enfileirados: number;
  ignorados_ano?: number;
  error?: string;
};

const YEAR_RE = /\b(19|20)\d{2}\b/g;

/** Retorna o menor ano (>= 1900) detectado em data_reuniao/titulo/url, ou null se nenhum. */
function detectYear(item: { titulo?: string | null; url_item?: string | null; data_reuniao?: string | null }): number | null {
  if (item.data_reuniao) {
    const y = Number(item.data_reuniao.slice(0, 4));
    if (Number.isFinite(y) && y >= 1900) return y;
  }
  const haystack = `${item.titulo ?? ""} ${item.url_item ?? ""}`;
  const matches = haystack.match(YEAR_RE);
  if (matches && matches.length) {
    return Math.max(...matches.map((m) => Number(m)).filter((y) => y >= 1900 && y <= 2100));
  }
  return null;
}

/**
 * Processa um site monitorado: descobre itens, aplica filtro de ano (opcional),
 * insere novos em monitoramento_itens, auto-enfileira PDFs e registra alertas/run.
 * Reusado pelo check incremental e pelo backfill da aba Votos dos Diretores.
 */
export async function processMonitoringSite(
  db: any,
  site: MonitoringSiteRow,
  options: ProcessSiteOptions = {},
): Promise<ProcessSiteResult> {
  const triggerType = options.triggerType ?? "scheduled";
  const startedAt = Date.now();
  const { data: run } = await db
    .from("monitoramento_runs")
    .insert({ site_id: site.id, status: "running", trigger_type: triggerType })
    .select("id")
    .single();

  // Zera os contadores globais para capturar apenas a atividade deste site
  // (os sites são processados em série pela rota de check).
  drainFetchStats();
  drainHeadlessOutcomes();

  try {
    const result = await fetchMonitoringSite(site, {
      maxPages: options.maxPages,
      maxMeetings: options.maxMeetings,
    });

    let novosItens = 0;
    let documentosEnfileirados = 0;
    let ignoradosAno = 0;

    for (const item of result.items) {
      if (options.yearFilter) {
        const year = detectYear(item);
        if (year !== null && year < options.yearFilter) {
          ignoradosAno++;
          continue;
        }
      }

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
          metadata: { ...item.metadata, prioridade: tipoPrioridade(item.tipo) },
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
          tipo: enqueued.enqueued
            ? "documento_enfileirado"
            : enqueued.error
              ? "falha_captura"
              : "novo_item",
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
    // Não troca a estratégia de fontes "html-static" (ANM/ARTESP): marcá-las como
    // "needs-headless" faria a ANM (gov.br) cair no parser de NOTÍCIAS no próximo
    // run. O fallback headless já é tentado dentro de fetchMonitoringSite.
    if (result.needsHeadless && site.estrategia !== "html-static") {
      sitePatch.estrategia = "needs-headless";
    }
    await db.from("monitoramento_sites").update(sitePatch).eq("id", site.id);

    if (run) {
      const fetchStats = drainFetchStats();
      const headlessStats = drainHeadlessOutcomes();
      await db.from("monitoramento_runs").update({
        finished_at: new Date().toISOString(),
        status,
        itens_encontrados: result.items.length,
        novos_itens: novosItens,
        documentos_enfileirados: documentosEnfileirados,
        duration_ms: Date.now() - startedAt,
        fetch_retries: fetchStats.retries,
        http_429_count: fetchStats.http429,
        throttle_wait_ms: fetchStats.throttleWaitsMs,
        headless_dependency_missing: headlessStats.dependency_missing,
        headless_launch_failed: headlessStats.launch_failed,
      }).eq("id", run.id);
    }

    return {
      site_id: site.id,
      site_nome: site.nome,
      status,
      itens_encontrados: result.items.length,
      novos_itens: novosItens,
      documentos_enfileirados: documentosEnfileirados,
      ignorados_ano: ignoradosAno,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro inesperado";
    await db.from("monitoramento_sites").update({
      ultimo_check: new Date().toISOString(),
      ultimo_status: "error",
      ultimo_erro: message.slice(0, 1000),
    }).eq("id", site.id);

    if (run) {
      const fetchStats = drainFetchStats();
      const headlessStats = drainHeadlessOutcomes();
      await db.from("monitoramento_runs").update({
        finished_at: new Date().toISOString(),
        status: "error",
        error_message: message.slice(0, 1000),
        duration_ms: Date.now() - startedAt,
        fetch_retries: fetchStats.retries,
        http_429_count: fetchStats.http429,
        throttle_wait_ms: fetchStats.throttleWaitsMs,
        headless_dependency_missing: headlessStats.dependency_missing,
        headless_launch_failed: headlessStats.launch_failed,
      }).eq("id", run.id);
    }

    return {
      site_id: site.id,
      site_nome: site.nome,
      status: "error",
      itens_encontrados: 0,
      novos_itens: 0,
      documentos_enfileirados: 0,
      error: message,
    };
  }
}

export async function tryAutoEnqueueMonitoredDocument(
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
): Promise<{ enqueued: boolean; error?: string }> {
  if (site.tipo_fonte === "noticias" || site.auto_enfileirar_pdf === false) return { enqueued: false };
  if (!["pauta", "ata", "voto", "deliberacao", "documento"].includes(item.tipo)) return { enqueued: false };

  const pdf = await downloadPdfIfAvailable(item.url_item);
  if (!pdf) return { enqueued: false };
  if ("error" in pdf) {
    // Falha real de download (não some em silêncio): registra no item para o
    // painel de Cobertura e sinaliza ao chamador para emitir alerta de falha.
    await db
      .from("monitoramento_itens")
      .update({ metadata: { ...item.metadata, captura_erro: pdf.error } })
      .eq("id", itemId);
    return { enqueued: false, error: pdf.error };
  }

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

  const ok = result.status !== "rejected" && result.status !== "error" && result.status !== "duplicate_confirmed";
  await db
    .from("monitoramento_itens")
    .update({
      upload_job_id: result.job_id,
      documento_id: result.document_id,
      enfileirado_em: ok ? new Date().toISOString() : null,
      status: ok ? "em_revisao" : "novo",
      metadata: {
        ...item.metadata,
        auto_enqueue_status: result.status,
        auto_enqueue_message: result.message ?? null,
      },
    })
    .eq("id", itemId);

  return { enqueued: ok };
}

type PdfDownload =
  | { filename: string; buffer: Buffer }
  | { error: string } // falha real de download (timeout/HTTP) — distinta de "não é PDF"
  | null;             // não é PDF (provável aviso só-HTML) — não conta como falha

async function downloadPdfIfAvailable(url: string): Promise<PdfDownload> {
  let res: Response;
  try {
    res = await resilientFetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/pdf,application/octet-stream,*/*",
      },
      timeoutMs: 20_000,
    });
  } catch (err) {
    return { error: (err instanceof Error ? err.message : "download falhou").slice(0, 300) };
  }
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
