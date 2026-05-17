"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Database, Loader2, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
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
  const next = searchParams.get("next") ?? "/dashboard";
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
    <main className="min-h-screen bg-[#0f1117] text-white">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative flex min-h-[42vh] flex-col justify-between overflow-hidden border-b border-white/10 bg-[#111318] p-8 lg:border-b-0 lg:border-r lg:p-12">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,111,0,0.22),transparent_34%),linear-gradient(135deg,rgba(255,111,0,0.16),transparent_44%)]" />
          <div className="relative z-10 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-brand">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-white/55">IRIS Regulação</p>
              <h1 className="text-xl font-semibold">Observatório da Regulação</h1>
            </div>
          </div>

          <div className="relative z-10 max-w-2xl space-y-6">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-brand">Acesso restrito</p>
            <h2 className="max-w-xl text-4xl font-semibold leading-tight md:text-5xl">
              Eficiência, inovação, estabilidade e segurança regulatória.
            </h2>
            <p className="max-w-xl text-base leading-7 text-white/68">
              Plataforma administrativa para monitoramento regulatório, curadoria de notícias, newsletters e gestão de documentos.
            </p>
          </div>

          <div className="relative z-10 grid gap-3 text-sm text-white/70 sm:grid-cols-3">
            <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">Análise regulatória</div>
            <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">Governança e dados</div>
            <div className="rounded-md border border-white/10 bg-white/[0.04] p-4">Newsletter associativa</div>
          </div>
        </section>

        <section className="flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-md space-y-6 rounded-lg border border-white/10 bg-[#191b22] p-6 shadow-2xl shadow-black/30">
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand/15 text-brand">
                <LockKeyhole className="h-5 w-5" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-white/48">Login global</p>
              <h3 className="text-2xl font-semibold">Entrar antes do sistema</h3>
              <p className="text-sm leading-6 text-white/58">
                Use apenas o e-mail global cadastrado. Ele é o administrador responsável por coletar notícias,
                confirmar uploads e gerar documentos oficiais.
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
        </section>
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
