import { createClient } from "@supabase/supabase-js";
import { fetchComTeto, SUPABASE_RPC_TIMEOUT_MS } from "@/lib/supabase/fetch-com-teto";

/**
 * Cliente Supabase para server-side (API Routes, Server Components).
 * Usa a SERVICE_ROLE_KEY que nunca é exposta ao browser.
 * Bypassa Row Level Security — use apenas em código servidor confiável.
 */
export function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios. " +
        "Configure-os em .env.local ou nas Vercel Environment Variables."
    );
  }

  return createClient(url, key, {
    auth: {
      // No server, não há sessão de usuário
      persistSession: false,
      autoRefreshToken: false,
    },
    // ⚠️ Fase 29 — NÃO REMOVER. Este `fetch` é injetado no postgrest, no storage E no auth. Sem
    // ele, nenhum round-trip do caminho quente tinha teto: os ~10 `auth.getUser` por rodada, os
    // SELECT/UPDATE dos reapers e o download do PDF podiam pendurar a função indefinidamente, o
    // cliente abortava aos 90s e disparava a rodada seguinte sobre a MESMA run. Ver
    // `fetch-com-teto.ts` para por que 10s é piso de segurança e não orçamento.
    global: { fetch: fetchComTeto(fetch, SUPABASE_RPC_TIMEOUT_MS) },
  });
}
