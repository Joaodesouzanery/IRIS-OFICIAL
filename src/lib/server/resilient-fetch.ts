/**
 * Fetch resiliente para coleta de portais regulatórios.
 *
 * Classifica falhas em duas categorias:
 *  - `falha_rede`     → bloqueio/instabilidade transitória (403, 408, 425, 429, 5xx, timeout,
 *                       erro de conexão). É retentável e, em última instância, candidata ao
 *                       fallback headless.
 *  - `falha_conteudo` → recurso ausente/definitivo (404 e demais 4xx). Não adianta retentar.
 *
 * Hardening: throttle por host (espaça requests ao mesmo domínio), backoff com jitter,
 * respeito ao header `Retry-After` em 429, e contadores drenáveis para telemetria.
 */

import { assertPublicUrl } from "@/lib/server/url-guard";

export type FetchFailureKind = "falha_rede" | "falha_conteudo";

export class FetchFailureError extends Error {
  readonly kind: FetchFailureKind;
  readonly status?: number;
  readonly url: string;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: { kind: FetchFailureKind; url: string; status?: number; retryAfterMs?: number; cause?: unknown },
  ) {
    super(message);
    this.name = "FetchFailureError";
    this.kind = options.kind;
    this.url = options.url;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Classifica um status HTTP em rede (retentável) ou conteúdo (definitivo). */
export function classifyHttpStatus(status: number): FetchFailureKind {
  if (status === 403 || status === 408 || status === 425 || status === 429) return "falha_rede";
  if (status >= 500) return "falha_rede";
  return "falha_conteudo";
}

export interface ResilientFetchOptions {
  headers?: Record<string, string>;
  /** Tentativas adicionais após a primeira (total = retries + 1). Padrão: 2. */
  retries?: number;
  /** Timeout por tentativa, em ms. Padrão: 12000. */
  timeoutMs?: number;
  /** Base do backoff exponencial (backoffMs × 3^tentativa), em ms. Padrão: 500. */
  backoffMs?: number;
  /** Teto do backoff por tentativa, em ms. Padrão: 8000. */
  maxBackoffMs?: number;
  /** Intervalo mínimo entre requests ao mesmo host, em ms. Padrão: env COLLECTOR_HOST_THROTTLE_MS ou 0. */
  hostThrottleMs?: number;
  /** Sinal externo de cancelamento. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 8_000;
// Teto para Retry-After: evita esperas longas que estourariam o orçamento de 120s da Vercel.
const MAX_RETRY_AFTER_MS = 15_000;
const ENV_HOST_THROTTLE_MS = Number(process.env.COLLECTOR_HOST_THROTTLE_MS ?? "0") || 0;

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ─── Redirects revalidados (anti-SSRF por redirect) ──────────────────────────
const MAX_REDIRECT_HOPS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * `fetch` que segue redirects MANUALMENTE, revalidando cada destino com
 * `assertPublicUrl`. Fecha o SSRF-por-redirect: com o `redirect: "follow"` default,
 * um host público que responda 302 → `169.254.169.254`/RFC1918 seria seguido e
 * vazaria metadata/serviços internos. Aqui cada `Location` (resolvido contra a URL
 * atual) passa pelo guard ANTES de ser seguido; destino bloqueado ou excesso de
 * hops vira `falha_conteudo` (definitivo, sem retry).
 */
async function fetchFollowingSafeRedirects(initialUrl: string, init: RequestInit): Promise<Response> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const res = await fetch(currentUrl, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(res.status)) return res;
    const location = res.headers.get("location");
    if (!location) return res; // 3xx sem Location: devolve como veio
    const nextUrl = new URL(location, currentUrl).toString();
    try {
      assertPublicUrl(nextUrl);
    } catch (cause) {
      throw new FetchFailureError(`Redirect para host bloqueado ao coletar ${initialUrl}: ${nextUrl}`, {
        kind: "falha_conteudo",
        url: initialUrl,
        cause,
      });
    }
    currentUrl = nextUrl;
  }
  throw new FetchFailureError(`Redirects em excesso (> ${MAX_REDIRECT_HOPS}) ao coletar ${initialUrl}`, {
    kind: "falha_conteudo",
    url: initialUrl,
  });
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

// ─── Telemetria (contadores drenáveis por execução) ─────────────────────────
export interface FetchStats {
  retries: number;
  http429: number;
  throttleWaitsMs: number;
}

const stats: FetchStats = { retries: 0, http429: 0, throttleWaitsMs: 0 };

/** Lê e zera os contadores acumulados de fetch (retries, 429, espera de throttle). */
export function drainFetchStats(): FetchStats {
  const snapshot = { ...stats };
  stats.retries = 0;
  stats.http429 = 0;
  stats.throttleWaitsMs = 0;
  return snapshot;
}

// ─── Throttle por host ──────────────────────────────────────────────────────
// Reserva slots espaçados por `minIntervalMs` para o mesmo host. A leitura+escrita
// do mapa é síncrona (single-thread), então chamadas concorrentes ao mesmo host
// recebem slots escalonados sem corrida. Hosts distintos não se bloqueiam.
const hostNextAllowed = new Map<string, number>();

export async function awaitHostSlot(host: string, minIntervalMs: number): Promise<number> {
  if (!minIntervalMs || minIntervalMs <= 0) return 0;
  const now = Date.now();
  const nextAllowed = hostNextAllowed.get(host) ?? 0;
  const wait = Math.max(0, nextAllowed - now);
  hostNextAllowed.set(host, Math.max(now, nextAllowed) + minIntervalMs);
  if (wait > 0) await delay(wait);
  return wait;
}

/**
 * Faz `fetch` com timeout, retry, backoff com jitter e throttle por host. Só retenta
 * falhas `falha_rede`; falhas `falha_conteudo` (404 etc.) sobem imediatamente.
 * Em 429, respeita `Retry-After` (limitado a MAX_RETRY_AFTER_MS). Lança `FetchFailureError`.
 */
export async function resilientFetch(url: string, options: ResilientFetchOptions = {}): Promise<Response> {
  // Guard anti-SSRF: bloqueia hosts internos/metadata em toda coleta.
  assertPublicUrl(url);

  const retries = options.retries ?? DEFAULT_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const hostThrottleMs = options.hostThrottleMs ?? ENV_HOST_THROTTLE_MS;
  const host = hostOf(url);

  let lastError: FetchFailureError | null = null;
  let retryAfterMs: number | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    // Throttle por host antes de cada tentativa.
    const waited = await awaitHostSlot(host, hostThrottleMs);
    if (waited > 0) stats.throttleWaitsMs += waited;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener("abort", onExternalAbort, { once: true });
    }

    try {
      const res = await fetchFollowingSafeRedirects(url, {
        headers: options.headers,
        next: { revalidate: 0 },
        signal: controller.signal,
      });
      if (!res.ok) {
        const kind = classifyHttpStatus(res.status);
        if (res.status === 429) {
          stats.http429 += 1;
          retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        }
        lastError = new FetchFailureError(`HTTP ${res.status} ao coletar ${url}`, {
          kind,
          url,
          status: res.status,
          retryAfterMs: retryAfterMs ?? undefined,
        });
        if (kind === "falha_conteudo") throw lastError;
        // falha_rede: cai para o retry/backoff abaixo.
      } else {
        return res;
      }
    } catch (error) {
      if (error instanceof FetchFailureError) {
        if (error.kind === "falha_conteudo") throw error;
        lastError = error;
      } else {
        const aborted = error instanceof Error && error.name === "AbortError";
        const message = aborted
          ? `Timeout (${timeoutMs}ms) ao coletar ${url}`
          : `Erro de rede ao coletar ${url}: ${error instanceof Error ? error.message : "desconhecido"}`;
        lastError = new FetchFailureError(message, { kind: "falha_rede", url, cause: error });
      }
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onExternalAbort);
    }

    if (attempt < retries) {
      stats.retries += 1;
      // Full jitter: random(0, min(maxBackoff, base·3^tentativa)). Em 429, respeita Retry-After.
      const ceiling = Math.min(maxBackoffMs, backoffMs * Math.pow(3, attempt));
      const jittered = Math.random() * ceiling;
      const wait = retryAfterMs != null ? Math.min(MAX_RETRY_AFTER_MS, retryAfterMs) : jittered;
      retryAfterMs = null;
      await delay(wait);
    }
  }

  throw lastError ?? new FetchFailureError(`Falha ao coletar ${url}`, { kind: "falha_rede", url });
}

/**
 * Igual a `resilientFetch`, retornando o corpo como texto com DETECÇÃO DE CHARSET.
 * Portais como ARTESP/Liferay podem servir latin1/iso-8859-1; `res.text()` assume
 * UTF-8 e gera mojibake. Aqui detectamos o charset (header → <meta charset> → utf-8)
 * e decodificamos os bytes com o TextDecoder correto.
 */
export async function resilientFetchText(url: string, options: ResilientFetchOptions = {}): Promise<string> {
  const res = await resilientFetch(url, options);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const headerCharset = /charset=["']?([\w-]+)/i.exec(res.headers.get("content-type") ?? "")?.[1];
  const charset = normalizeCharset(headerCharset) ?? sniffCharsetFromMeta(bytes) ?? "utf-8";
  return decodeBytes(bytes, charset);
}

function normalizeCharset(value?: string | null): string | null {
  if (!value) return null;
  const c = value.trim().toLowerCase();
  if (c === "utf8" || c === "utf-8") return "utf-8";
  // "latin1" não é label válido de TextDecoder; mapeia para windows-1252 (superset).
  if (c === "latin1" || c === "iso8859-1") return "windows-1252";
  return c; // "iso-8859-1", "windows-1252", "cp1252", etc. são aceitos pelo TextDecoder.
}

// Espia <meta charset>/<meta http-equiv> nos primeiros 2KB (decodificados como
// latin1, seguro para a parte ASCII do cabeçalho) quando o header não declara.
function sniffCharsetFromMeta(bytes: Uint8Array): string | null {
  const head = new TextDecoder("windows-1252").decode(bytes.subarray(0, 2048));
  const match =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head) ??
    /charset=["']?([\w-]+)/i.exec(head);
  return normalizeCharset(match?.[1]);
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
