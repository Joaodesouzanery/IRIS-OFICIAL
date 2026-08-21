"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Database, Loader2, Mail } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const HAS_SUPABASE = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell message="Carregando login..." />}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard/painel-regulatorio";
  const reason = searchParams.get("reason");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(initialReasonMessage(reason));
  const [accessDenied, setAccessDenied] = useState(reason === "forbidden");

  const bootstrapOwner = useCallback(
    async (token: string) => {
      const res = await fetch("/api/v1/auth/bootstrap-owner", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        router.replace(next);
        return;
      }

      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      const text = payload?.error ?? "Este e-mail não tem permissão administrativa.";
      setMessage(text);
      setAccessDenied(res.status === 403);
    },
    [next, router],
  );

  useEffect(() => {
    if (!HAS_SUPABASE) return;
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      setUserEmail(session?.user.email ?? null);
      if (session?.access_token && !accessDenied) await bootstrapOwner(session.access_token);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUserEmail(session?.user.email ?? null);
      if (session?.access_token) {
        setAccessDenied(false);
        await bootstrapOwner(session.access_token);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [accessDenied, bootstrapOwner]);

  async function signIn() {
    if (!email.trim() || !password) return;
    setBusy(true);
    setMessage(null);
    setAccessDenied(false);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      if (data.session?.access_token) await bootstrapOwner(data.session.access_token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao entrar.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    setUserEmail(null);
    setAccessDenied(false);
    setPassword("");
    setMessage("Sessão encerrada. Informe o e-mail global para entrar.");
  }

  if (!HAS_SUPABASE) {
    return <LoginShell message="Configure as variáveis do Supabase para ativar o login administrativo." />;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0f1117] p-6 text-white">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-white/10 bg-[#191b22] p-8 shadow-2xl shadow-black/30">
        <div className="space-y-2">
          <div className="rounded-md bg-[#0a0e2a] border border-[#c2a24a]/40 px-4 py-3 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/newsletter-logo-wide.png" alt="IRIS — Instituto de Regulação, Inovação e Sustentabilidade" className="h-10 w-auto" />
          </div>
          <h1 className="text-2xl font-semibold">Entrar no sistema</h1>
          <p className="text-sm leading-6 text-white/58">
            Acesso restrito a usuários cadastrados. Administradores gerenciam os dados; demais usuários entram em modo somente visualização.
          </p>
        </div>

        {userEmail ? (
          <div className="space-y-3">
            <div className="rounded-md border border-white/10 bg-white/[0.04] p-3 text-sm text-white/72">
              Sessão ativa como <span className="font-medium text-white">{userEmail}</span>.
            </div>
            {accessDenied ? (
              <button className="btn-secondary w-full justify-center" onClick={signOut}>
                Usar outro e-mail
              </button>
            ) : (
              <button className="btn-primary w-full justify-center" onClick={() => router.replace(next)}>
                Ir para o dashboard
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">E-mail global</span>
              <div className="flex items-center gap-2 rounded-md border border-white/10 bg-[#111318] px-3">
                <Mail className="h-4 w-4 text-white/38" />
                <input
                  className="h-12 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/32"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="seu e-mail administrativo"
                />
              </div>
            </label>
            <label className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">Senha</span>
              <input
                className="h-12 w-full rounded-md border border-white/10 bg-[#111318] px-3 text-sm text-white outline-none placeholder:text-white/32 focus:border-brand/70"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="sua senha"
              />
            </label>
            <button className="btn-primary w-full justify-center" onClick={signIn} disabled={busy || !email.trim() || !password}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Entrar
            </button>
            <Link href="/setup-owner" className="block text-center text-xs font-medium uppercase tracking-[0.18em] text-white/38 hover:text-brand">
              cadastrar e-mail global
            </Link>
          </div>
        )}

        {message && (
          <div className="rounded-md border border-white/10 bg-white/[0.04] p-3 text-sm text-white/68">
            {message}
          </div>
        )}
      </div>
    </main>
  );
}

function LoginShell({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0f1117] p-6 text-white">
      <section className="w-full max-w-md space-y-3 rounded-lg border border-white/10 bg-[#191b22] p-6">
        <Database className="h-6 w-6 text-brand" />
        <h1 className="text-xl font-semibold">IRIS Regulação</h1>
        <p className="text-sm text-white/60">{message}</p>
      </section>
    </main>
  );
}

function initialReasonMessage(reason: string | null): string | null {
  if (reason === "forbidden") return "Este e-mail não é o administrador global autorizado.";
  if (reason === "config") return "Ambiente Supabase incompleto. Verifique as variáveis de produção.";
  return null;
}
