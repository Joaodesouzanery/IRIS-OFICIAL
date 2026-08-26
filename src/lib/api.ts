// URL relativa: funciona em dev e producao sem CORS.
const BASE_URL = "/api";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function buildUrl(path: string): string {
  return `${BASE_URL}/v1${path}`;
}

// Extrai uma mensagem LEGÍVEL do corpo de erro. Alguns endpoints devolvem
// `{ error: <objeto> }` (ex.: erro cru do Supabase) — sem isto, `new Error(obj)`
// coage para a string "[object Object]" e é o que o usuário vê na tela.
function extractErrorMessage(body: unknown, status: number, statusText: string): string {
  const pick = (v: unknown): string | null => {
    if (typeof v === "string" && v.trim()) return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const nested = o.message ?? o.error ?? o.detail ?? o.msg;
      if (typeof nested === "string" && nested.trim()) return nested;
      try {
        const json = JSON.stringify(v);
        if (json && json !== "{}") return json;
      } catch {
        /* objeto não serializável */
      }
    }
    return null;
  };
  const b = (body ?? {}) as Record<string, unknown>;
  return (
    pick(b.error) ??
    pick(b.detail) ??
    pick(b.message) ??
    (statusText && statusText.trim() ? statusText : `Erro ${status}`)
  );
}

/**
 * Teto de espera do cliente (Fase 7). O `fetch` não tinha timeout nenhum: quando a função morre
 * pelo SIGKILL do Hobby (60s) sem responder, a promessa ficava pendurada — a tela mostrava
 * "Rodada N…" para sempre e o usuário lia isso como "está processando". 90s fica ACIMA do SIGKILL
 * de propósito: a resposta legítima mais lenta é uma rodada da esteira, e cortá-la antes do
 * servidor terminar descartaria trabalho já feito.
 */
const REQUEST_TIMEOUT_MS = 90_000;

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = buildUrl(path);
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json",
    ...options.headers,
  });
  await attachRuntimeHeaders(headers);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers,
      signal: options.signal ?? controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ApiError(504, `A requisição passou de ${REQUEST_TIMEOUT_MS / 1000}s sem resposta (a função pode ter sido encerrada pelo limite de tempo).`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, extractErrorMessage(body, res.status, res.statusText));
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),

  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),

  upload: async <T>(path: string, formData: FormData): Promise<T> => {
    const url = buildUrl(path);
    const headers = new Headers();
    await attachRuntimeHeaders(headers);

    const res = await fetch(url, {
      method: "POST",
      body: formData,
      headers,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // Usa o helper compartilhado (etapa65). Esta cópia reimplementava a extração e perdia
      // justamente o caso que o helper existe para tratar — `{ error: <objeto> }`, o erro cru do
      // Supabase, que virava "[object Object]" na tela. E é aqui que ele é mais provável: upload
      // de PDF e de imagem de notícia falham com erro de storage, não com string.
      throw new ApiError(res.status, extractErrorMessage(body, res.status, res.statusText));
    }
    return res.json() as Promise<T>;
  },
};

/**
 * Guard de FORMA para payload que o consumidor agrega direto (etapa65).
 *
 * `request<T>` termina em `res.json() as Promise<T>` — um cast NÃO CHECADO. O `T` do call-site é
 * asserção, não verificação: se a rota mudar de forma, o `tsc` fica VERDE e a tela quebra em
 * runtime. Foi o que aconteceu com a Saúde dos Dados, tipada como array contra uma rota que devolve
 * `{ por_agencia: [...] }` — e `?? []` não protege, porque testa `undefined`, não forma: um objeto
 * é truthy, passa pelo `??` e chega vivo no primeiro `.reduce`.
 *
 * Uso: `listaDe<Linha>(resp)` em todo ponto que faz `.map`/`.reduce`/`.filter` imediato.
 */
export function listaDe<T>(payload: unknown, chave?: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (chave && payload && typeof payload === "object") {
    const v = (payload as Record<string, unknown>)[chave];
    if (Array.isArray(v)) return v as T[];
  }
  return [];
}

export { ApiError };

async function attachRuntimeHeaders(headers: Headers): Promise<void> {
  if (typeof window !== "undefined" && localStorage.getItem("iris_demo_enabled") === "1") {
    headers.set("x-iris-demo", "1");
  }

  const token = await getSupabaseAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
}

async function getSupabaseAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;

  try {
    const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
