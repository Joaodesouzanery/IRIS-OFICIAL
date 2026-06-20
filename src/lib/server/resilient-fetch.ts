/**
 * Fetch resiliente para coleta de portais regulatórios.
 *
 * Classifica falhas em duas categorias:
 *  - `falha_rede`     → bloqueio/instabilidade transitória (403, 408, 425, 429, 5xx, timeout,
 *                       erro de conexão). É retentável e, em última instância, candidata ao
 *                       fallback headless.
 *  - `falha_conteudo` → recurso ausente/definitivo (404 e demais 4xx). Não adianta retentar.
 */

export type FetchFailureKind = "falha_rede" | "falha_conteudo";

export class FetchFailureError extends Error {
  readonly kind: FetchFailureKind;
  readonly status?: number;
  readonly url: string;

  constructor(message: string, options: { kind: FetchFailureKind; url: string; status?: number; cause?: unknown }) {
    super(message);
    this.name = "FetchFailureError";
    this.kind = options.kind;
    this.url = options.url;
    this.status = options.status;
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
  /** Sinal externo de cancelamento. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 500;

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Faz `fetch` com timeout, retry e backoff exponencial. Só retenta falhas `falha_rede`;
 * falhas `falha_conteudo` (404 etc.) sobem imediatamente. Lança `FetchFailureError`.
 */
export async function resilientFetch(url: string, options: ResilientFetchOptions = {}): Promise<Response> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;

  let lastError: FetchFailureError | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
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
        lastError = new FetchFailureError(`HTTP ${res.status} ao coletar ${url}`, {
          kind,
          url,
          status: res.status,
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
      await delay(backoffMs * Math.pow(3, attempt));
    }
  }

  throw lastError ?? new FetchFailureError(`Falha ao coletar ${url}`, { kind: "falha_rede", url });
}

/** Igual a `resilientFetch`, retornando diretamente o corpo como texto. */
export async function resilientFetchText(url: string, options: ResilientFetchOptions = {}): Promise<string> {
  const res = await resilientFetch(url, options);
  return res.text();
}
