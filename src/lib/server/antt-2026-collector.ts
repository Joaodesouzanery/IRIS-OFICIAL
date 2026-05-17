import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnttCollectResponse } from "@/types";
import type { DiscoveredMonitoringItem } from "@/lib/server/monitoring";

export const ANTT_2026_SOURCE_URL = "https://portal.antt.gov.br/web/guest/reunioes-da-diretoria";

const ALLOWED_HOSTS = new Set(["portal.antt.gov.br", "anttlegis.antt.gov.br"]);
const PDF_HOSTS = new Set(["portal.antt.gov.br", "anttlegis.antt.gov.br"]);
const YEAR = 2026;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

export type AnttMeetingType = "ordinaria" | "extraordinaria" | "eletronica";
export type AnttDocumentType = "pauta" | "voto" | "deliberacao" | "outro";

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
}

interface CollectOptions extends DiscoverOptions {
  agenciaId?: string | null;
  storageBucket?: string;
}

interface DownloadedPdf {
  buffer: Buffer;
  contentType: string | null;
  finalUrl: string;
  hash: string;
}

export async function fetchAntt2026MonitoringItems(): Promise<DiscoveredMonitoringItem[]> {
  const meetings = await discoverAntt2026Meetings({ maxPages: 3, maxMeetings: 40 });
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
        tipo: doc.tipo === "pauta" ? "pauta" : doc.tipo === "voto" ? "voto" : "documento",
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

  return dedupeBy(items, (item) => item.hash_item);
}

export async function collectAntt2026Documents(
  db: SupabaseClient,
  options: CollectOptions = {},
): Promise<AnttCollectResponse> {
  const bucket = options.storageBucket ?? "pdfs";
  const agenciaId = options.agenciaId ?? await ensureAnttAgency(db);
  const response: AnttCollectResponse = {
    reunioes_encontradas: 0,
    reunioes_salvas: 0,
    processos_salvos: 0,
    documentos_encontrados: 0,
    documentos_baixados: 0,
    documentos_duplicados: 0,
    documentos_rejeitados: 0,
    errors: [],
  };

  const meetings = await discoverAntt2026Meetings(options);
  response.reunioes_encontradas = meetings.length;

  for (const meeting of meetings) {
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
      const existing = await findExistingDocument(db, doc.url);
      if (existing) {
        response.documentos_duplicados++;
        continue;
      }

      try {
        const downloaded = await downloadPdfSecure(doc.url);
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
        const { error } = await db.from("documentos_coletados").insert({
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
        });

        if (error) {
          if (error.code === "23505") {
            response.documentos_duplicados++;
            continue;
          }
          throw new Error(error.message);
        }

        response.documentos_baixados++;
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
): Promise<AnttMeeting[]> {
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 12, 20));
  const maxMeetings = Math.max(1, Math.min(options.maxMeetings ?? 120, 200));
  const visited = new Set<string>();
  const listingQueue = [ANTT_2026_SOURCE_URL];
  const meetingLinks = new Map<string, { title: string; sourceUrl: string; sourceHtml: string }>();

  while (listingQueue.length > 0 && visited.size < maxPages && meetingLinks.size < maxMeetings) {
    const listingUrl = listingQueue.shift()!;
    if (visited.has(listingUrl)) continue;
    visited.add(listingUrl);

    const html = await fetchHtmlSecure(listingUrl);
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

  const meetings: AnttMeeting[] = [];
  for (const [url, listing] of meetingLinks) {
    const html = await fetchHtmlSecure(url);
    const meeting = parseAnttMeetingPage(html, url, listing.title, listing.sourceUrl, listing.sourceHtml);
    if (meeting && meeting.data_inicio?.startsWith(`${YEAR}-`)) {
      meetings.push(meeting);
    }
  }

  return meetings.sort((a, b) => (b.data_inicio ?? "").localeCompare(a.data_inicio ?? ""));
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
    if (docType !== "pauta") continue;
    documentos.push({
      tipo: "pauta",
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
    documentos.filter((doc) => doc.tipo === "pauta" || doc.tipo === "voto"),
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

async function fetchHtmlSecure(url: string): Promise<string> {
  const res = await fetchSecure(url, {
    accept: "text/html,application/xhtml+xml",
    allowedHosts: ALLOWED_HOSTS,
    maxBytes: MAX_HTML_BYTES,
  });
  return res.buffer.toString("utf8");
}

async function downloadPdfSecure(url: string): Promise<DownloadedPdf> {
  const res = await fetchSecure(url, {
    accept: "application/pdf",
    allowedHosts: PDF_HOSTS,
    maxBytes: MAX_PDF_BYTES,
  });

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

async function fetchSecure(
  rawUrl: string,
  options: { accept: string; allowedHosts: Set<string>; maxBytes: number },
  redirects = 0,
): Promise<{ buffer: Buffer; contentType: string | null; finalUrl: string }> {
  const url = assertAllowedUrl(rawUrl, options.allowedHosts);
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

function parseProcessos(html: string, pageUrl: string): AnttProcesso[] {
  const marker = /(?:<[^>]+>|\s)*(?:\d+\.\s*)?Processo\s+Deliberado:/i;
  const parts = html.split(marker).slice(1);
  const processos: AnttProcesso[] = [];

  parts.forEach((part, index) => {
    const block = part.split(/(?:<[^>]+>|\s)*(?:\d+\.\s*)?Processo\s+Deliberado:/i)[0];
    const text = cleanText(stripTags(`Processo Deliberado: ${block}`));
    const item_numero = String(index + 1);
    const processo = firstMatch(text, /Processo Deliberado:\s*([0-9.\-/]+)/i);
    const interessado = between(text, /Interessado\s+/i, /\s+Diretor\s+relator\s+/i);
    const relator = between(text, /Diretor\s+relator\s+/i, /\s+Assunto\s+/i);
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

function extractAnchors(html: string, baseUrl: string) {
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

function findNextPageUrl(html: string, baseUrl: string): string | null {
  const anchors = extractAnchors(html, baseUrl);
  const next = anchors.find((a) => /^proximo$/i.test(normalizeText(a.text)) || /next/i.test(a.text));
  return next?.href ?? null;
}

function isTargetMeetingTitle(title: string): boolean {
  const text = normalizeText(title);
  if (!text.includes("reuniao")) return false;
  if (text.includes("administrativa")) return false;
  return text.includes("reuniao de diretoria") || text.includes("reuniao deliberativa eletronica");
}

function classifyMeetingType(title: string): AnttMeetingType {
  const text = normalizeText(title);
  if (text.includes("deliberativa eletronica")) return "eletronica";
  if (text.includes("extraordinaria")) return "extraordinaria";
  return "ordinaria";
}

function classifyDocumentLink(text: string, href: string): AnttDocumentType {
  const value = normalizeText(`${text} ${decodeURIComponentSafe(href)}`);
  if (!/\.pdf(?:$|[/?#])/i.test(href)) return "outro";
  if (/\bpauta\b/.test(value)) return "pauta";
  if (/\bvoto\b/.test(value) || value.includes("declaracao de voto")) return "voto";
  if (value.includes("deliberacao")) return "deliberacao";
  return "outro";
}

function extractMeetingDates(text: string, tipo: AnttMeetingType) {
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
