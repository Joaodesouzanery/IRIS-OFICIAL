import { NextResponse } from "next/server";
import { sanitizeNext } from "@/lib/next-seguro";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

type CookieWriteOptions = {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: boolean | "lax" | "strict" | "none";
  secure?: boolean;
};

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  /**
   * ⚠️ Rota PÚBLICA e server-side, no fluxo de magic link e de recuperação de senha. Sem sanear,
   * `?next=https://evil.com` redirecionava para fora: `new URL(next, base)` só usa a base quando
   * `next` é relativo. Ver `src/lib/next-seguro.ts` — a validação é por origem resolvida, porque
   * filtro por prefixo aceita `/\\evil.com` e `/<tab>/evil.com` (medido).
   */
  const destino = sanitizeNext(requestUrl.searchParams.get("next"), requestUrl.origin);

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: CookieWriteOptions) {
            cookieStore.set({ name, value, ...options });
          },
          remove(name: string, options: CookieWriteOptions) {
            cookieStore.set({ name, value: "", ...options });
          },
        },
      },
    );
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(destino, requestUrl.origin));
}
