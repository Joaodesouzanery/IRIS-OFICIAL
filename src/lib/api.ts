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

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body.error ?? body.detail ?? body.message ?? res.statusText;
    throw new ApiError(res.status, msg);
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
      const msg = body.error ?? body.detail ?? body.message ?? res.statusText;
      throw new ApiError(res.status, msg);
    }
    return res.json() as Promise<T>;
  },
};

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
