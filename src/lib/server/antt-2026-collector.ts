import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnttCollectResponse } from "@/types";
import type { DiscoveredMonitoringItem } from "@/lib/server/monitoring";
import { awaitHostSlot } from "@/lib/server/resilient-fetch";
import { hasBudget, msLeft } from "@/lib/server/time-budget";

// Espaçamento mínimo entre requests ao portal da ANTT (evita 429/403). fetchSecure
// é preservado (whitelist de host, redirect manual, limites de bytes) — só ganha throttle.
const ANTT_THROTTLE_MS = Number(process.env.COLLECTOR_HOST_THROTTLE_MS ?? "0") || 800;

export const ANTT_2026_SOURCE_URL = "https://portal.antt.gov.br/web/guest/reunioes-da-diretoria";

const ALLOWED_HOSTS = new Set(["portal.antt.gov.br", "anttlegis.antt.gov.br"]);
const PDF_HOSTS = new Set(["portal.antt.gov.br", "anttlegis.antt.gov.br"]);
const YEAR = 2026;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

export type AnttMeetingType = "ordinaria" | "extraordinaria" | "eletronica";
export type AnttDocumentType = "pauta" | "voto" | "ata" | "deliberacao" | "outro";

export interface AnttDocumentLink {
  tipo: AnttDocumentType;
  titulo: string;
  url: string;
  processo?: AnttProcesso;
}

export interface AnttProcesso {
  item_numero: string | null;
  processo: string | null;
  interessado: string | null;
  relator: string | null;
  assunto: string | null;
  decisao: string | null;
  documentos: AnttDocumentLink[];
}

export interface AnttMeeting {
  numero: string;
  titulo: string;
  tipo: AnttMeetingType;
  data_inicio: string | null;
  data_fim: string | null;
  hora_inicio: string | null;
  hora_fim: string | null;
  url_reuniao: string;
  source_url: string;
  source_hash: string;
  documentos: AnttDocumentLink[];
  processos: AnttProcesso[];
  metadata: Record<string, unknown>;
}

interface DiscoverOptions {
  maxPages?: number;
  maxMeetings?: number;
  // Orçamento de tempo (epoch ms): nenhuma página nova é buscada sem saldo —
  // sem isso o crawl (até 200 reuniões × throttle 800ms) estoura o maxDuration
  // do Vercel e morre em SIGKILL sem gravar nada.
  deadlineAt?: number;
  // Reuniões cuja página NÃO precisa ser re-buscada (já têm ata/deliberação
  // capturada). É o que torna o re-run do backfill barato/retomável.
  skipMeetingUrls?: Set<string>;
}

interface CollectOptions extends DiscoverOptions {
  agenciaId?: string | null;
  storageBucket?: string;
}

export interface AnttDiscoveryResult {
  meetings: AnttMeeting[];
  truncated: boolean;
  skippedKnown: number;
  pagesFetched: number;
  meetingPagesFetched: number;
}

// Reserva por unidade de trabalho: 1 fetch ANTT no pior caso ≈ throttle 0,8s +
// timeout 20s + persistência — abaixo disso não se inicia unidade nova.
const ANTT_UNIT_RESERVE_MS = 25_000;

interface DownloadedPdf {
  buffer: Buffer;
  contentType: string | null;
  finalUrl: string;
  hash: string;
}

export async function fetchAntt2026MonitoringItems(
  options: DiscoverOptions = {},
): Promise<{ items: DiscoveredMonitoringItem[]; truncated: boolean; skippedKnown: number }> {
  // Sem teto baixo: o limitador real é o filtro de 2026 (a descoberta para de
  // paginar quando a listagem deixa de citar 2026). Os 3 págs/40 reuniões antigos
  // cortavam reuniões de 2026 em silêncio. Mantém-se YEAR=2026.
  const discovery = await discoverAntt2026Meetings(options);
  const meetings = discovery.meetings;
  const items: DiscoveredMonitoringItem[] = [];

  for (const meeting of meetings) {
    items.push({
      tipo: "reuniao",
      titulo: meeting.titulo,
      url_item: meeting.url_reuniao,
      reuniao: meeting.titulo,
      data_reuniao: meeting.data_inicio,
      hash_item: sha256(`antt-2026|reuniao|${meeting.url_reuniao}`),
      metadata: {
        connector: "antt-2026",
        meeting_type: meeting.tipo,
        source: meeting.source_url,
      },
    });

    for (const doc of meeting.documentos) {
      items.push({
        tipo: doc.tipo === "pauta" ? "pauta"
          : doc.tipo === "voto" ? "voto"
          : doc.tipo === "ata" ? "ata"
          : doc.tipo === "deliberacao" ? "deliberacao"
          : "documento",
        titulo: `${doc.titulo} - ${meeting.titulo}`.slice(0, 500),
        url_item: doc.url,
        reuniao: meeting.titulo,
        data_reuniao: meeting.data_inicio,
        hash_item: sha256(`antt-2026|${doc.tipo}|${doc.url}`),
        metadata: {
          connector: "antt-2026",
          meeting_type: meeting.tipo,
          meeting_url: meeting.url_reuniao,
          processo: doc.processo?.processo ?? null,
          relator: doc.processo?.relator ?? null,
        },
      });
    }
  }

  return {
    items: dedupeBy(items, (item) => item.hash_item),
    truncated: discovery.truncated,
    skippedKnown: discovery.skippedKnown,
  };
}

export async function collectAntt2026Documents(
  db: SupabaseClient,
  options: CollectOptions = {},
): Promise<AnttCollectResponse> {
  const bucket = options.storageBucket ?? "pdfs";
  const agenciaId = options.agenciaId ?? await ensureAnttAgency(db);
  const { deadlineAt } = options;
  const response: AnttCollectResponse = {
    reunioes_encontradas: 0,
    reunioes_salvas: 0,
    processos_salvos: 0,
    documentos_encontrados: 0,
    documentos_baixados: 0,
    documentos_duplicados: 0,
    documentos_rejeitados: 0,
    parcial: false,
    errors: [],
  };

  const discovery = await discoverAntt2026Meetings(options);
  const meetings = discovery.meetings;
  response.reunioes_encontradas = meetings.length;
  response.parcial = discovery.truncated;

  for (const meeting of meetings) {
    if (!hasBudget(deadlineAt, ANTT_UNIT_RESERVE_MS)) {
      response.parcial = true;
      break;
    }
    let reuniaoId: string | null = null;
    try {
      const { data, error } = await db
        .from("antt_reunioes_coletadas")
        .upsert({
          agencia_id: agenciaId,
          ano: YEAR,
          numero: meeting.numero,
          titulo: meeting.titulo,
          tipo: meeting.tipo,
          data_inicio: meeting.data_inicio,
          data_fim: meeting.data_fim,
          hora_inicio: meeting.hora_inicio,
          hora_fim: meeting.hora_fim,
          url_reuniao: meeting.url_reuniao,
          source_url: meeting.source_url,
          source_hash: meeting.source_hash,
          status: "coletada",
          metadata: meeting.metadata,
        }, { onConflict: "url_reuniao" })
        .select("id")
        .single();

      if (error || !data) throw new Error(error?.message ?? "falha ao salvar reuniao");
      reuniaoId = data.id as string;
      response.reunioes_salvas++;
    } catch (error) {
      response.errors.push(`${meeting.titulo}: ${messageOf(error)}`);
      continue;
    }

    const processIdByKey = new Map<string, string>();
    for (const processo of meeting.processos) {
      try {
        const existing = await findExistingProcess(db, reuniaoId, processo);
        const row = {
          agencia_id: agenciaId,
          reuniao_id: reuniaoId,
          item_numero: processo.item_numero,
          processo: processo.processo,
          interessado: processo.interessado,
          relator: processo.relator,
          assunto: processo.assunto,
          decisao: processo.decisao,
          metadata: {
            documentos: processo.documentos.map((doc) => ({
              tipo: doc.tipo,
              titulo: doc.titulo,
              url: doc.url,
            })),
          },
        };

        const query = existing
          ? db.from("antt_processos_coletados").update(row).eq("id", existing.id)
          : db.from("antt_processos_coletados").insert(row);

        const { data, error } = await query.select("id").single();
        if (error || !data) throw new Error(error?.message ?? "falha ao salvar processo");

        processIdByKey.set(processKey(processo), data.id as string);
        response.processos_salvos++;
      } catch (error) {
        response.errors.push(`${meeting.titulo} / processo ${processo.processo ?? "sem numero"}: ${messageOf(error)}`);
      }
    }

    for (const doc of meeting.documentos) {
      response.documentos_encontrados++;
      if (!hasBudget(deadlineAt, ANTT_UNIT_RESERVE_MS)) {
        response.parcial = true;
        break;
      }
      const existing = await findExistingDocument(db, doc.url);
      if (existing) {
        response.documentos_duplicados++;
        continue;
      }

      try {
        const downloaded = await downloadPdfSecure(doc.url, deadlineAt);
        const existingHash = await findExistingDocumentByHash(db, downloaded.hash);
        if (existingHash) {
          response.documentos_duplicados++;
          continue;
        }

        const storagePath = buildStoragePath(agenciaId, meeting, doc, downloaded.hash);

        const { error: uploadError } = await db.storage
          .from(bucket)
          .upload(storagePath, downloaded.buffer, {
            contentType: "application/pdf",
            upsert: false,
          });

        if (uploadError && !/already exists/i.test(uploadError.message)) {
          throw new Error(`storage: ${uploadError.message}`);
        }

        const processoId = doc.processo ? processIdByKey.get(processKey(doc.processo)) ?? null : null;
        const { data: coletadoRow, error } = await db.from("documentos_coletados").insert({
          agencia_id: agenciaId,
          reuniao_id: reuniaoId,
          processo_id: processoId,
          tipo: doc.tipo,
          titulo: doc.titulo,
          url_original: downloaded.finalUrl,
          storage_bucket: bucket,
          storage_path: storagePath,
          file_hash: downloaded.hash,
          content_type: downloaded.contentType ?? "application/pdf",
          tamanho_bytes: downloaded.buffer.length,
          status: "em_revisao",
          validation_status: "ok",
          metadata: {
            connector: "antt-2026",
            original_url: doc.url,
            meeting_url: meeting.url_reuniao,
            meeting_title: meeting.titulo,
            meeting_type: meeting.tipo,
            processo: doc.processo?.processo ?? null,
            relator: doc.processo?.relator ?? null,
            collected_from: meeting.source_url,
            security: {
              allowed_hosts: [...ALLOWED_HOSTS],
              magic_bytes_checked: true,
              sha256: downloaded.hash,
            },
          },
        })
          .select("id")
          .single();

        if (error) {
          if (error.code === "23505") {
            response.documentos_duplicados++;
            continue;
          }
          throw new Error(error.message);
        }

        response.documentos_baixados++;
        const coletadoId = (coletadoRow?.id as string | undefined) ?? null;

        // Conecta os PDFs portadores de voto à fila de extração (entram no fluxo
        // de revisão de votos). Dedupe por hash dentro do enqueuePdfBuffer.
        if (["voto", "ata", "deliberacao"].includes(doc.tipo)) {
          try {
            const { enqueuePdfBuffer } = await import("@/lib/server/upload-queue");
            const enq = await enqueuePdfBuffer({
              db,
              filename: /\.pdf$/i.test(doc.titulo) ? doc.titulo : `${doc.titulo}.pdf`,
              buffer: downloaded.buffer,
              agenciaId,
              documentoColetadoId: coletadoId,
              metadata: {
                uploaded_via: "antt-2026-collector",
                documento_tipo: doc.tipo,
                meeting_url: meeting.url_reuniao,
                antt_file_hash: downloaded.hash,
              },
            });
            // Link reverso coletado→regulatório (rastreabilidade completa).
            if (coletadoId && enq.document_id) {
              await db
                .from("documentos_coletados")
                .update({ documento_regulatorio_id: enq.document_id })
                .eq("id", coletadoId);
            }
          } catch (enqueueError) {
            response.errors.push(`enfileirar ${doc.titulo}: ${messageOf(enqueueError)}`);
          }
        }
      } catch (error) {
        response.documentos_rejeitados++;
        response.errors.push(`${doc.titulo}: ${messageOf(error)}`);
        await db.from("documentos_coletados").insert({
          agencia_id: agenciaId,
          reuniao_id: reuniaoId,
          processo_id: doc.processo ? processIdByKey.get(processKey(doc.processo)) ?? null : null,
          tipo: doc.tipo,
          titulo: doc.titulo,
          url_original: doc.url,
          status: "erro",
          validation_status: "erro",
          error_message: messageOf(error).slice(0, 1000),
          metadata: {
            connector: "antt-2026",
            meeting_url: meeting.url_reuniao,
            meeting_title: meeting.titulo,
          },
        });
      }
    }
  }

  return response;
}

export async function discoverAntt2026Meetings(
  options: DiscoverOptions = {},
): Promise<AnttDiscoveryResult> {
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 12, 20));
  const maxMeetings = Math.max(1, Math.min(options.maxMeetings ?? 120, 200));
  const { deadlineAt, skipMeetingUrls } = options;
  const visited = new Set<string>();
  const listingQueue = [ANTT_2026_SOURCE_URL];
  const meetingLinks = new Map<string, { title: string; sourceUrl: string; sourceHtml: string }>();
  let truncated = false;
  let skippedKnown = 0;
  let meetingPagesFetched = 0;

  while (listingQueue.length > 0 && visited.size < maxPages && meetingLinks.size < maxMeetings) {
    if (!hasBudget(deadlineAt, ANTT_UNIT_RESERVE_MS)) {
      truncated = true;
      break;
    }
    const listingUrl = listingQueue.shift()!;
    if (visited.has(listingUrl)) continue;
    visited.add(listingUrl);

    const html = await fetchHtmlSecure(listingUrl, deadlineAt);
    const normalized = normalizeText(stripTags(html));
    if (!normalized.includes("2026") && visited.size > 1) break;

    for (const link of extractAnchors(html, listingUrl)) {
      const title = cleanText(link.text);
      if (!isTargetMeetingTitle(title)) continue;
      if (!normalizeText(contextAround(html, link.index, 1200)).includes("2026")) continue;
      meetingLinks.set(link.href, { title, sourceUrl: listingUrl, sourceHtml: html });
      if (meetingLinks.size >= maxMeetings) break;
    }

    const next = findNextPageUrl(html, listingUrl);
    if (next && !visited.has(next) && normalizeText(stripTags(html)).includes("2026")) {
      listingQueue.push(next);
    }
  }

  // Fase 7 — parar por TETO também é enumeração incompleta. Este É o bug real da cobertura da
  // ANTT (o do paginador não era). `truncated` só era marcado por esgotamento de ORÇAMENTO; sair
  // do laço com página pendente na fila (teto `maxPages`) ou com o teto de reuniões batido
  // devolvia `truncated: false`, e a conferência de cobertura lia isso como "enumerei o portal
  // inteiro" — era o que produzia "✓ Cobertura completa" comparando o banco contra uma fração.
  // E não é hipotético: o portal tem 82 páginas e `maxPages` é no máximo 20 (5 na coleta leve).
  if (listingQueue.length > 0 || meetingLinks.size >= maxMeetings) truncated = true;

  const meetings: AnttMeeting[] = [];
  for (const [url, listing] of meetingLinks) {
    if (skipMeetingUrls?.has(url)) {
      skippedKnown++;
      continue;
    }
    if (!hasBudget(deadlineAt, ANTT_UNIT_RESERVE_MS)) {
      truncated = true;
      break;
    }
    const html = await fetchHtmlSecure(url, deadlineAt);
    meetingPagesFetched++;
    const meeting = parseAnttMeetingPage(html, url, listing.title, listing.sourceUrl, listing.sourceHtml);
    if (meeting && meeting.data_inicio?.startsWith(`${YEAR}-`)) {
      meetings.push(meeting);
    }
  }

  return {
    meetings: meetings.sort((a, b) => (b.data_inicio ?? "").localeCompare(a.data_inicio ?? "")),
    truncated,
    skippedKnown,
    pagesFetched: visited.size,
    meetingPagesFetched,
  };
}

// Janela de frescor: reuniões dos últimos ~45 dias ainda podem ganhar uma ata
// publicada com atraso, então continuam sendo revisitadas mesmo que já tenham
// itens. Passado esse prazo, a página da reunião é estável e não precisa re-fetch.
const ANTT_SKIP_FRESHNESS_MS = 45 * 24 * 60 * 60 * 1000;

// Reuniões cuja página NÃO precisa de re-fetch (o que torna o backfill DEFINITIVO,
// não "parcial eterno"). Uma reunião entra no skip quando:
//   (a) já tem ata/deliberação capturada (decisão final — qualquer idade), OU
//   (b) já tem QUALQUER item capturado E é antiga (data_reuniao além da janela de
//       frescor) — a página do passado não muda, então re-buscá-la é desperdício.
// Reuniões recentes só-com-voto/pauta continuam sendo revisitadas até a ata sair.
// Fontes baratas: monitoramento_itens (via metadata.meeting_url + data_reuniao) e
// o staging do cron (documentos_coletados ⋈ antt_reunioes_coletadas). Falha ⇒ Set
// vazio (degrada p/ crawl completo, nunca bloqueia).
export async function buildAnttMeetingSkipSet(
  db: SupabaseClient,
  opts: { siteId?: string | null; nowMs?: number } = {},
): Promise<Set<string>> {
  const skip = new Set<string>();
  const cutoff = new Date((opts.nowMs ?? Date.now()) - ANTT_SKIP_FRESHNESS_MS)
    .toISOString()
    .slice(0, 10); // YYYY-MM-DD
  try {
    let itensQuery = db
      .from("monitoramento_itens")
      .select("tipo, data_reuniao, metadata")
      .in("tipo", ["ata", "deliberacao", "voto", "pauta", "documento"])
      .limit(8000);
    if (opts.siteId) itensQuery = itensQuery.eq("site_id", opts.siteId);
    const { data: itens } = await itensQuery;
    for (const item of itens ?? []) {
      const row = item as { tipo?: string; data_reuniao?: string | null; metadata?: { meeting_url?: unknown } };
      const meetingUrl = row.metadata?.meeting_url;
      if (typeof meetingUrl !== "string" || !meetingUrl) continue;
      const isDecisaoFinal = row.tipo === "ata" || row.tipo === "deliberacao";
      const isAntiga = typeof row.data_reuniao === "string" && row.data_reuniao !== "" && row.data_reuniao < cutoff;
      if (isDecisaoFinal || isAntiga) skip.add(meetingUrl);
    }

    const { data: coletados } = await db
      .from("documentos_coletados")
      .select("tipo, reuniao:antt_reunioes_coletadas!inner(url_reuniao)")
      .in("tipo", ["ata", "deliberacao"])
      .limit(5000);
    for (const doc of coletados ?? []) {
      const reuniao = (doc as { reuniao?: { url_reuniao?: unknown } | { url_reuniao?: unknown }[] }).reuniao;
      const urlReuniao = Array.isArray(reuniao) ? reuniao[0]?.url_reuniao : reuniao?.url_reuniao;
      if (typeof urlReuniao === "string" && urlReuniao) skip.add(urlReuniao);
    }
  } catch (error) {
    console.warn(`[antt-2026] skip-set indisponível (${messageOf(error)}) — crawl completo.`);
  }
  return skip;
}

export function parseAnttMeetingPage(
  html: string,
  pageUrl: string,
  fallbackTitle: string,
  sourceUrl: string,
  sourceHtml: string,
): AnttMeeting | null {
  const pageText = cleanText(stripTags(html));
  const title = extractTitle(pageText) ?? fallbackTitle;
  if (!isTargetMeetingTitle(title)) return null;

  const tipo = classifyMeetingType(title);
  const numero = extractMeetingNumber(title);
  const dates = extractMeetingDates(pageText, tipo);
  const pageAnchors = extractAnchors(html, pageUrl);
  const documentos: AnttDocumentLink[] = [];

  for (const anchor of pageAnchors) {
    const docType = classifyDocumentLink(anchor.text, anchor.href);
    // Mantém os documentos DECISÓRIOS da página da reunião: pauta, ata e deliberação.
    // (voto costuma vir dos processos, abaixo.) Antes só "pauta" passava → as ~28 atas
    // da ANTT, onde ficam as decisões colegiadas, eram descartadas.
    if (docType !== "pauta" && docType !== "ata" && docType !== "deliberacao") continue;
    documentos.push({
      tipo: docType,
      titulo: cleanText(anchor.text).slice(0, 500),
      url: anchor.href,
    });
  }

  const processos = parseProcessos(html, pageUrl);
  for (const processo of processos) {
    for (const doc of processo.documentos) {
      documentos.push({ ...doc, processo });
    }
  }

  const uniqueDocs = dedupeBy(
    documentos.filter((doc) => ["pauta", "voto", "ata", "deliberacao"].includes(doc.tipo)),
    (doc) => `${doc.tipo}|${doc.url}|${doc.processo?.processo ?? ""}`,
  );

  return {
    numero,
    titulo: title,
    tipo,
    data_inicio: dates.data_inicio,
    data_fim: dates.data_fim,
    hora_inicio: dates.hora_inicio,
    hora_fim: dates.hora_fim,
    url_reuniao: pageUrl,
    source_url: sourceUrl,
    source_hash: sha256(sourceHtml),
    documentos: uniqueDocs,
    processos,
    metadata: {
      connector: "antt-2026",
      documentos_count: uniqueDocs.length,
      processos_count: processos.length,
    },
  };
}

async function ensureAnttAgency(db: SupabaseClient): Promise<string> {
  const { data: existing } = await db
    .from("agencias")
    .select("id")
    .eq("sigla", "ANTT")
    .maybeSingle();

  if (existing?.id) return existing.id as string;

  const { data, error } = await db
    .from("agencias")
    .insert({
      sigla: "ANTT",
      nome: "ANTT",
      nome_completo: "Agencia Nacional de Transportes Terrestres",
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(error?.message ?? "nao foi possivel criar agencia ANTT");
  return data.id as string;
}

async function findExistingDocument(db: SupabaseClient, url: string) {
  const { data } = await db
    .from("documentos_coletados")
    .select("id")
    .eq("url_original", url)
    .maybeSingle();
  return data;
}

async function findExistingDocumentByHash(db: SupabaseClient, hash: string) {
  const { data } = await db
    .from("documentos_coletados")
    .select("id")
    .eq("file_hash", hash)
    .maybeSingle();
  return data;
}

async function findExistingProcess(db: SupabaseClient, reuniaoId: string, processo: AnttProcesso) {
  let query = db
    .from("antt_processos_coletados")
    .select("id")
    .eq("reuniao_id", reuniaoId);

  if (processo.item_numero) query = query.eq("item_numero", processo.item_numero);
  else query = query.is("item_numero", null);

  if (processo.processo) query = query.eq("processo", processo.processo);
  else query = query.is("processo", null);

  const { data } = await query.maybeSingle();
  return data;
}

async function fetchHtmlSecure(url: string, deadlineAt?: number): Promise<string> {
  const res = await fetchSecureWithRetry(url, {
    accept: "text/html,application/xhtml+xml",
    allowedHosts: ALLOWED_HOSTS,
    maxBytes: MAX_HTML_BYTES,
  }, 2, deadlineAt);
  return res.buffer.toString("utf8");
}

async function downloadPdfSecure(url: string, deadlineAt?: number): Promise<DownloadedPdf> {
  const res = await fetchSecureWithRetry(url, {
    accept: "application/pdf",
    allowedHosts: PDF_HOSTS,
    maxBytes: MAX_PDF_BYTES,
  }, 2, deadlineAt);

  if (!isPdfBuffer(res.buffer)) {
    throw new Error("arquivo rejeitado: magic bytes de PDF ausentes");
  }

  return {
    buffer: res.buffer,
    contentType: res.contentType,
    finalUrl: res.finalUrl,
    hash: sha256Buffer(res.buffer),
  };
}

// Retry para falhas TRANSITÓRIAS (429/5xx/timeout/reset): o portal da ANTT cai
// intermitentemente e, sem retry, o doc virava `status='erro'` em silêncio (sem
// nova tentativa). 2 tentativas com backoff; o throttle por host já espaça.
async function fetchSecureWithRetry(
  rawUrl: string,
  options: { accept: string; allowedHosts: Set<string>; maxBytes: number },
  attempts = 2,
  deadlineAt?: number,
): Promise<{ buffer: Buffer; contentType: string | null; finalUrl: string }> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    // Sem saldo para uma tentativa inteira (timeout 20s + margem), não a inicia:
    // a cadeia completa de retries (3×20s + backoff) sozinha estouraria o maxDuration.
    if (i > 0 && msLeft(deadlineAt) < FETCH_TIMEOUT_MS + 5_000) throw lastError;
    try {
      return await fetchSecure(rawUrl, options);
    } catch (error) {
      lastError = error;
      const msg = messageOf(error);
      const transient = /HTTP (429|5\d\d)|abort|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network/i.test(msg);
      if (!transient || i === attempts - 1) throw error;
      await sleep(700 * (i + 1));
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSecure(
  rawUrl: string,
  options: { accept: string; allowedHosts: Set<string>; maxBytes: number },
  redirects = 0,
): Promise<{ buffer: Buffer; contentType: string | null; finalUrl: string }> {
  const url = assertAllowedUrl(rawUrl, options.allowedHosts);
  await awaitHostSlot(url.host, ANTT_THROTTLE_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Accept: options.accept,
        "User-Agent": "IRIS-Regulacao-ANTT-Collector/1.0",
      },
    });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      if (redirects >= 3) throw new Error("redirecionamentos demais");
      const location = res.headers.get("location");
      if (!location) throw new Error("redirect sem location");
      return fetchSecure(new URL(location, url).toString(), options, redirects + 1);
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentLength = Number(res.headers.get("content-length") ?? "0");
    if (contentLength > options.maxBytes) {
      throw new Error(`arquivo excede limite de ${Math.round(options.maxBytes / 1024 / 1024)} MB`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > options.maxBytes) {
      throw new Error(`arquivo excede limite de ${Math.round(options.maxBytes / 1024 / 1024)} MB`);
    }

    return {
      buffer,
      contentType: res.headers.get("content-type"),
      finalUrl: url.toString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function assertAllowedUrl(rawUrl: string, allowedHosts: Set<string>): URL {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();

  if (url.protocol !== "https:") throw new Error("URL rejeitada: apenas HTTPS");
  if (!allowedHosts.has(host)) throw new Error(`URL rejeitada: dominio nao permitido (${host})`);
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error("URL rejeitada: endereco interno");
  }

  return url;
}

// Exportada na etapa66 para que o teste contra a fixture de HTML real LOCALIZE a regressão
// em vez de só sinalizá-la — este caminho não tinha teste nenhum até agora.
export function parseProcessos(html: string, pageUrl: string): AnttProcesso[] {
  const marker = /(?:<[^>]+>|\s)*(?:\d+\.\s*)?Processo\s+Deliberado:/i;
  const parts = html.split(marker).slice(1);
  const processos: AnttProcesso[] = [];

  parts.forEach((part, index) => {
    const block = part.split(/(?:<[^>]+>|\s)*(?:\d+\.\s*)?Processo\s+Deliberado:/i)[0];
    const text = cleanText(stripTags(`Processo Deliberado: ${block}`));
    const item_numero = String(index + 1);
    const processo = firstMatch(text, /Processo Deliberado:\s*([0-9.\-/]+)/i);
    // Âncora de relator tolerante a hífen/":"/variantes ("Diretor-Relator:", "Diretor Relatora").
    const relatorAnchor = /\s+(?:Diretor[\s-]*)?Relator(?:ia|a)?\s*:?\s+/i;
    const interessado = between(text, /Interessado\s*:?\s+/i, relatorAnchor);
    const relator = between(text, relatorAnchor, /\s+Assunto\s+/i);
    const assunto = between(text, /Assunto\s+/i, /\s+Documentos\s+Relacionados|\s+Decis[aã]o\s+/i);
    const decisao = between(text, /Decis[aã]o\s+/i, /Formul[aá]rio|Empresa:|Processo Deliberado:/i);
    const documentos = extractAnchors(block, pageUrl)
      .map((anchor): AnttDocumentLink | null => {
        const tipo = classifyDocumentLink(anchor.text, anchor.href);
        if (tipo !== "voto") return null;
        return {
          tipo,
          titulo: cleanText(anchor.text).slice(0, 500),
          url: anchor.href,
        };
      })
      .filter((doc): doc is AnttDocumentLink => Boolean(doc));

    if (processo || interessado || assunto || documentos.length > 0) {
      processos.push({
        item_numero,
        processo,
        interessado,
        relator,
        assunto,
        decisao,
        documentos,
      });
    }
  });

  return processos;
}

// Exportada na etapa66 para que o teste contra a fixture de HTML real LOCALIZE a regressão
// em vez de só sinalizá-la — este caminho não tinha teste nenhum até agora.
export function extractAnchors(html: string, baseUrl: string) {
  const anchors: Array<{ href: string; text: string; index: number }> = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const hrefRaw = decodeHtml(match[1]);
    const text = cleanText(stripTags(match[2])) || inferLinkText(hrefRaw);
    if (!text) continue;
    try {
      const href = new URL(hrefRaw, baseUrl).toString();
      anchors.push({ href, text, index: match.index });
    } catch {
      // Ignore CMS fragments that are not valid URLs.
    }
  }

  return anchors;
}

/**
 * Rótulo "Página N de M" do paginador do Liferay. É a única fonte no HTML que diz onde estamos e
 * quantas páginas existem — sem ele não dá para saber qual âncora numérica é a PRÓXIMA.
 */
export function parseLiferayPageLabel(html: string): { atual: number; total: number } | null {
  const m = normalizeText(stripTags(html)).match(/pagina\s+(\d{1,4})\s+de\s+(\d{1,4})/);
  if (!m) return null;
  const atual = Number(m[1]);
  const total = Number(m[2]);
  if (!Number.isFinite(atual) || !Number.isFinite(total) || total < 1) return null;
  return { atual, total };
}

/**
 * Fase 7 — paginação com REDUNDÂNCIA (defesa em profundidade, não conserto de bug ativo).
 *
 * ⚠️ Registro honesto: a Fase 7 começou com o diagnóstico de que "a ANTT nunca sai da página 1
 * porque só reconhecemos 'próximo'/'next'". **Isso estava ERRADO** — testado contra a fixture real
 * do portal (`listagem-reunioes.html`, 227 KB), existe sim uma âncora "Próximo" e o casamento
 * antigo a encontra. O limite real de cobertura da ANTT não é este: são `maxPages` (≤20 contra as
 * 82 páginas do portal), `maxMeetings` e o orçamento de tempo.
 *
 * O que se ganha aqui, então: o portal também expõe o paginador numérico do Liferay (âncoras cujo
 * texto é o NÚMERO da página, com `..._cur=N` / `..._delta=20`). Reconhecê-lo é um segundo caminho
 * para o mesmo destino — se o rótulo "Próximo" mudar de texto, for traduzido ou virar só um ícone,
 * a descoberta continua andando em vez de parar em silêncio na página 1. Custo: ~10 linhas.
 *
 * A ordem importa: "próximo"/"next" primeiro (é o caminho que funciona hoje), numérico como rede.
 */
export function findNextPageUrl(html: string, baseUrl: string): string | null {
  const anchors = extractAnchors(html, baseUrl);

  const explicito = anchors.find((a) => /^proximo$/i.test(normalizeText(a.text)) || /next/i.test(a.text));
  if (explicito) return explicito.href;

  const label = parseLiferayPageLabel(html);
  if (!label) return null;
  if (label.atual >= label.total) return null; // última página: acabou de verdade

  // A âncora cujo texto é exatamente o número da próxima página. Há dois paginadores (topo e
  // rodapé) com as mesmas âncoras — a primeira serve.
  const alvo = String(label.atual + 1);
  const proxima = anchors.find((a) => a.text.trim() === alvo);
  return proxima?.href ?? null;
}

// Exportada na etapa66 para que o teste contra a fixture de HTML real LOCALIZE a regressão
// em vez de só sinalizá-la — este caminho não tinha teste nenhum até agora.
export function isTargetMeetingTitle(title: string): boolean {
  const text = normalizeText(title);
  if (!text.includes("reuniao")) return false;
  // "Reunião de Diretoria ADMINISTRATIVA" é outro colegiado (gestão interna), não decisão
  // regulatória. A exclusão vem antes de tudo e continua valendo.
  if (text.includes("administrativa")) return false;
  // Fase 7 — o teste era por substring CONTÍGUA ("reuniao de diretoria"), então
  // "Reunião Extraordinária de Diretoria" era rejeitada mesmo com `classifyMeetingType` sabendo
  // classificá-la ("extraordinaria" está lá, explicitamente). A ampliação é do tamanho exato
  // dessa contradição: só os qualificadores que a função irmã já declara conhecer — nada mais.
  // (Na listagem real de hoje a ANTT nomeia "NNNª Reunião de Diretoria", sem qualificador; isto
  // é seguro contra o dia em que ela publicar uma extraordinária.)
  if (/reuniao (?:ordinaria |extraordinaria )?de diretoria/.test(text)) return true;
  return text.includes("reuniao deliberativa eletronica");
}

// Exportada na etapa66 para que o teste contra a fixture de HTML real LOCALIZE a regressão
// em vez de só sinalizá-la — este caminho não tinha teste nenhum até agora.
export function classifyMeetingType(title: string): AnttMeetingType {
  const text = normalizeText(title);
  if (text.includes("deliberativa eletronica")) return "eletronica";
  if (text.includes("extraordinaria")) return "extraordinaria";
  return "ordinaria";
}

// Exportada na etapa66 para que o teste contra a fixture de HTML real LOCALIZE a regressão
// em vez de só sinalizá-la — este caminho não tinha teste nenhum até agora.
export function classifyDocumentLink(text: string, href: string): AnttDocumentType {
  const value = normalizeText(`${text} ${decodeURIComponentSafe(href)}`);
  if (!/\.pdf(?:$|[/?#])/i.test(href)) return "outro";
  if (/\bpauta\b/.test(value)) return "pauta";
  if (/\bvoto\b/.test(value) || value.includes("declaracao de voto")) return "voto";
  if (value.includes("deliberacao")) return "deliberacao";
  if (/\bata(?:s)?\b/.test(value)) return "ata"; // as atas trazem as decisões colegiadas
  return "outro";
}

// Exportada na etapa66 para que o teste contra a fixture de HTML real LOCALIZE a regressão
// em vez de só sinalizá-la — este caminho não tinha teste nenhum até agora.
export function extractMeetingDates(text: string, tipo: AnttMeetingType) {
  const dates = [...text.matchAll(/\b(\d{2})\/(\d{2})\/(2026)\b/g)]
    .map((m) => toIsoDate(m[1], m[2], m[3]))
    .filter(Boolean) as string[];
  const times = [...text.matchAll(/\b(\d{2}):(\d{2})\b/g)].map((m) => `${m[1]}:${m[2]}:00`);

  if (tipo === "eletronica") {
    return {
      data_inicio: dates[0] ?? null,
      data_fim: dates[1] ?? dates[0] ?? null,
      hora_inicio: times[0] ?? null,
      hora_fim: times[1] ?? null,
    };
  }

  return {
    data_inicio: dates[0] ?? null,
    data_fim: dates[0] ?? null,
    hora_inicio: times[0] ?? null,
    hora_fim: null,
  };
}

function extractTitle(text: string): string | null {
  const match = text.match(/(?:^|\s)((?:\d{1,4}|[0-9]{1,3})[ªº]?\s+Reuni[aã]o(?:\s+Deliberativa\s+Eletr[oô]nica|\s+Extraordin[aá]ria\s+de\s+Diretoria|\s+de\s+Diretoria))/i);
  return match ? cleanText(match[1]) : null;
}

function extractMeetingNumber(title: string) {
  return firstMatch(title, /(\d{1,4})/) ?? title;
}

function buildStoragePath(agenciaId: string, meeting: AnttMeeting, doc: AnttDocumentLink, hash: string) {
  const meetingSlug = slugify(`${meeting.numero}-${meeting.tipo}`);
  const docSlug = slugify(doc.titulo).slice(0, 80) || doc.tipo;
  return `${agenciaId}/antt/2026/${meetingSlug}/${hash}-${doc.tipo}-${docSlug}.pdf`;
}

function processKey(processo: AnttProcesso) {
  return `${processo.item_numero ?? ""}|${processo.processo ?? ""}`;
}

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d;
}

function contextAround(html: string, index: number, radius: number) {
  return cleanText(stripTags(html.slice(Math.max(0, index - radius), index + radius)));
}

function between(text: string, start: RegExp, end: RegExp) {
  const startMatch = start.exec(text);
  if (!startMatch) return null;
  const rest = text.slice(startMatch.index + startMatch[0].length);
  const endMatch = end.exec(rest);
  return cleanText((endMatch ? rest.slice(0, endMatch.index) : rest)).slice(0, 2000) || null;
}

function firstMatch(text: string, re: RegExp) {
  const match = re.exec(text);
  return match?.[1] ? cleanText(match[1]) : null;
}

function toIsoDate(day: string, month: string, year: string) {
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function stripTags(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ccedil;/g, "ç")
    .replace(/&atilde;/g, "ã")
    .replace(/&otilde;/g, "õ")
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú");
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanText(value: string) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function normalizeText(value: string) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function inferLinkText(href: string) {
  const decoded = decodeURIComponentSafe(href);
  const lower = normalizeText(decoded);
  if (lower.includes("pauta")) return "Pauta";
  if (lower.includes("voto")) return "Voto";
  if (lower.includes("deliber")) return "Deliberacao";
  if (lower.includes(".pdf")) return decoded.split("/").pop() ?? "PDF";
  return "";
}

function slugify(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256Buffer(value: Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function dedupeBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = getKey(item);
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
