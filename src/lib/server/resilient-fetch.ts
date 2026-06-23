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
      const res = await fetch(url, {
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

/** Igual a `resilientFetch`, retornando diretamente o corpo como texto. */
export async function resilientFetchText(url: string, options: ResilientFetchOptions = {}): Promise<string> {
  const res = await resilientFetch(url, options);
  return res.text();
}
