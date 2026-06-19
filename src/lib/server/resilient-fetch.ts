/**
 * resilient-fetch.ts
 * Fetch compartilhado com timeout, retry+backoff e classificação de falhas.
 *
 * Distingue dois tipos de falha para diagnóstico (ex.: 403 de egress do ARTESP):
 *  - "falha_rede": erro de transporte (timeout/abort/DNS/conexão) ou HTTP 403/429/5xx
 *    (bloqueio/transiente) — elegível a retry e, quando disponível, fallback headless.
 *  - "falha_conteudo": HTTP 404 e demais 4xx, ou conteúdo inesperado — não faz retry.
 */

export type FetchFailureKind = "falha_rede" | "falha_conteudo";

export class FetchFailureError extends Error {
  readonly kind: FetchFailureKind;
  readonly status?: number;
  readonly url: string;
  readonly attempts: number;

  constructor(
    message: string,
    opts: { kind: FetchFailureKind; url: string; status?: number; attempts?: number },
  ) {
    super(message);
    this.name = "FetchFailureError";
    this.kind = opts.kind;
    this.status = opts.status;
    this.url = opts.url;
    this.attempts = opts.attempts ?? 1;
  }
}

export interface ResilientFetchOptions {
  /** Timeout por tentativa em ms (default 12s). */
  timeoutMs?: number;
  /** Número de retentativas em falha_rede (total = retries + 1; default 2). */
  retries?: number;
  /** Backoff base em ms; cresce ~3x por tentativa (default 500 → 500, 1500). */
  backoffMs?: number;
  headers?: Record<string, string>;
  /** Rótulo curto para logs estruturados. */
  label?: string;
  /** Método HTTP (default GET). */
  method?: string;
  body?: BodyInit | null;
}

/**
 * Classifica um status HTTP. Retorna null se for sucesso (2xx/3xx).
 */
export function classifyHttpStatus(status: number): FetchFailureKind | null {
  if (status >= 200 && status < 400) return null;
  if (status === 403 || status === 429 || status >= 500) return "falha_rede";
  return "falha_conteudo";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logFailure(label: string | undefined, url: string, kind: FetchFailureKind, status: number | undefined, attempt: number) {
  console.warn(
    `[resilient-fetch]${label ? ` ${label}` : ""} ${kind}`,
    JSON.stringify({ url, kind, status: status ?? null, attempt: attempt + 1 }),
  );
}

/**
 * Faz fetch com retry em falhas de rede. Retorna a Response (status < 400) em sucesso.
 * Lança FetchFailureError classificado quando esgotam as tentativas ou em falha_conteudo.
 */
export async function resilientFetch(url: string, opts: ResilientFetchOptions = {}): Promise<Response> {
  const { timeoutMs = 12_000, retries = 2, backoffMs = 500, headers, label, method = "GET", body = null } = opts;
  let lastError: FetchFailureError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, body, headers, signal: controller.signal, next: { revalidate: 0 } });
      clearTimeout(timer);
      if (res.ok) return res;

      const kind = classifyHttpStatus(res.status) ?? "falha_conteudo";
      logFailure(label, url, kind, res.status, attempt);
      lastError = new FetchFailureError(`HTTP ${res.status}`, { kind, url, status: res.status, attempts: attempt + 1 });
      if (kind === "falha_conteudo") throw lastError; // 404/4xx não recupera com retry
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof FetchFailureError) {
        if (error.kind === "falha_conteudo") throw error;
        lastError = error;
      } else {
        const message = error instanceof Error ? error.message : "falha desconhecida";
        logFailure(label, url, "falha_rede", undefined, attempt);
        lastError = new FetchFailureError(message, { kind: "falha_rede", url, attempts: attempt + 1 });
      }
    }

    if (attempt < retries) await sleep(backoffMs * Math.pow(3, attempt));
  }

  throw lastError ?? new FetchFailureError("Falha de rede desconhecida", { kind: "falha_rede", url });
}

/**
 * Conveniência: faz resilientFetch e devolve o corpo como texto.
 */
export async function resilientFetchText(
  url: string,
  opts: ResilientFetchOptions = {},
): Promise<{ text: string; status: number; contentType: string }> {
  const res = await resilientFetch(url, opts);
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  return { text, status: res.status, contentType };
}
