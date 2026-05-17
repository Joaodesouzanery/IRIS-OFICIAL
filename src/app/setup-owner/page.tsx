"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { ArrowRight, Database, KeyRound, Loader2, ShieldCheck } from "lucide-react";

export default function SetupOwnerPage() {
  return (
    <Suspense fallback={<SetupShell message="Carregando setup..." />}>
      <SetupOwnerContent />
    </Suspense>
  );
}

function SetupOwnerContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    if (password !== confirmPassword) {
      setMessage("As senhas não coincidem.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/v1/auth/setup-owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          setup_token: setupToken,
        }),
      });
      const payload = (await res.json().catch(() => null)) as { error?: string; role?: string } | null;
      if (!res.ok) throw new Error(payload?.error ?? "Falha ao criar administrador global.");
      setCreated(true);
      setMessage(`Administrador global criado como ${payload?.role ?? "admin"}. Entre com e-mail e senha.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao criar administrador global.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0f1117] text-white">
      <div className="grid min-h-screen lg:grid-cols-[1fr_0.9fr]">
        <section className="relative flex min-h-[40vh] flex-col justify-between overflow-hidden border-b border-white/10 bg-[#111318] p-8 lg:border-b-0 lg:border-r lg:p-12">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(255,111,0,0.22),transparent_34%),linear-gradient(135deg,rgba(255,111,0,0.16),transparent_44%)]" />
          <div className="relative z-10 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-brand">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-white/55">IRIS Regulação</p>
              <h1 className="text-xl font-semibold">Cadastro global</h1>
            </div>
          </div>

          <div className="relative z-10 max-w-2xl space-y-6">
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-brand">Setup temporário</p>
            <h2 className="max-w-xl text-4xl font-semibold leading-tight md:text-5xl">
              Crie o administrador sem depender de convite por e-mail.
            </h2>
            <p className="max-w-xl text-base leading-7 text-white/68">
              Esta tela cria o usuário no Supabase já confirmado e registra o e-mail como responsável global da plataforma.
            </p>
          </div>

          <div className="relative z-10 text-sm text-white/55">
            Depois de cadastrar o e-mail global, esta página pode ser removida ou bloqueada por variável de ambiente.
          </div>
        </section>

        <section className="flex items-center justify-center p-6 lg:p-12">
          <form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-lg border border-white/10 bg-[#191b22] p-6 shadow-2xl shadow-black/30">
            <div className="space-y-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-brand/15 text-brand">
                <KeyRound className="h-5 w-5" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.26em] text-white/48">Administrador</p>
              <h3 className="text-2xl font-semibold">Cadastrar e-mail global</h3>
              <p className="text-sm leading-6 text-white/58">
                Use um e-mail definitivo. Depois, o login será feito com e-mail e senha.
              </p>
            </div>

            <SetupInput label="E-mail global" type="email" value={email} onChange={setEmail} placeholder="seu e-mail administrativo" />
            <SetupInput label="Senha" type="password" value={password} onChange={setPassword} placeholder="mínimo de 8 caracteres" />
            <SetupInput label="Confirmar senha" type="password" value={confirmPassword} onChange={setConfirmPassword} placeholder="repita a senha" />
            <SetupInput label="Código de setup" type="password" value={setupToken} onChange={setSetupToken} placeholder="opcional, se configurado" />

            <button className="btn-primary w-full justify-center" disabled={busy || created || !email || !password || !confirmPassword}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Criar administrador global
            </button>

            {message && (
              <div className="rounded-md border border-white/10 bg-white/[0.04] p-3 text-sm text-white/68">
                {message}
              </div>
            )}

            {created && (
              <Link href="/login" className="btn-secondary w-full justify-center">
                Ir para login
              </Link>
            )}
          </form>
        </section>
      </div>
    </main>
  );
}

function SetupInput({
  label,
  type,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/45">{label}</span>
      <input
        className="h-12 w-full rounded-md border border-white/10 bg-[#111318] px-3 text-sm text-white outline-none placeholder:text-white/32 focus:border-brand/70"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function SetupShell({ message }: { message: string }) {
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
