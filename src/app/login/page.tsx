"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Database, Loader2, Mail } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { origemDoNavegador, sanitizeNext } from "@/lib/next-seguro";

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
  /**
   * ⚠️ SANEADO na origem, não em cada uso. `next` vai para dois lugares (o `router.replace` do
   * efeito e o do botão), e validar em cada um deles seria a assimetria que sempre volta — basta
   * alguém acrescentar um terceiro. Validando aqui, os usos herdam um valor que já é relativo e
   * da própria origem. Ver `src/lib/next-seguro.ts`.
   */
  const nextCru = searchParams.get("next");
  const next = useMemo(() => sanitizeNext(nextCru, origemDoNavegador()), [nextCru]);
  const reason = searchParams.get("reason");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(initialReasonMessage(reason));
  // ⚠️ Era `accessDenied`, e significava "não é admin" — o que NÃO é motivo para barrar.
  // Agora significa o que o nome diz: a sessão não vale.
  const [sessaoInvalida, setSessaoInvalida] = useState(false);
  /**
   * ⚠️ ESPELHO EM `ref`, e ele é o conserto de um LAÇO INFINITO (Fase 35).
   *
   * O efeito abaixo tinha `sessaoInvalida` nas dependências, e o ramo do listener não tinha a guarda
   * que o ramo irmão tinha. Confirmei a peça que fechava o ciclo no `@supabase/auth-js` instalado
   * (`GoTrueClient.js`, `onAuthStateChange` → `_emitInitialSession(id)`): **cada subscribe novo
   * reemite `INITIAL_SESSION`** com a sessão do cookie. Com cookie presente e token recusado pelo
   * servidor (expirado sem renovação, refresh rotacionado, JWT de outro projeto):
   *
   *   INITIAL_SESSION → zera a flag → `entrar()` → 401 → liga a flag → o efeito RE-EXECUTA →
   *   re-subscribe → novo INITIAL_SESSION → … para sempre
   *
   * Uma chamada a `/api/v1/auth/me` por volta, e cada uma faz `getUser(token)` no servidor: um
   * round-trip ao Supabase por iteração, numa rota sem rate limit. Auto-DoS, e na tela a impressão
   * é de travamento.
   *
   * Lido por `ref`, o valor não entra nas dependências e o efeito assina UMA vez. O `ref` e o estado
   * andam juntos porque toda escrita passa por `marcarSessaoInvalida` — é isso que impede a
   * dessincronia que um `ref` solto convidaria.
   */
  const sessaoInvalidaRef = useRef(false);
  const marcarSessaoInvalida = useCallback((valor: boolean) => {
    sessaoInvalidaRef.current = valor;
    setSessaoInvalida(valor);
  }, []);

  /**
   * ⚠️ Fase 32 — ESTA FUNÇÃO ERA O BUG, e ele trancava exatamente quem o produto diz aceitar.
   *
   * A versão anterior fazia POST em `/api/v1/auth/bootstrap-owner` e **só redirecionava se ele
   * respondesse ok**. Mas o bootstrap devolve **403** para todo e-mail fora de
   * `IRIS_OWNER_EMAIL`/`ADMIN_EMAILS` — por desenho, é o gate que impede auto-promoção a owner.
   *
   * Resultado: o VIEWER autenticava com sucesso (o cookie era gravado, o middleware já o aceitava,
   * o `/auth/me` já lhe dava `role: "viewer"`), via *"Este e-mail não é o administrador global
   * autorizado"* e ficava com um único botão: "Usar outro e-mail". Não havia caminho para o
   * dashboard. O usuário criado no painel do Supabase simplesmente não entrava.
   *
   * É regressão do commit `9a25a0f` ("feat(auth): usuario VIEWER"): ele mexeu em 8 arquivos —
   * middleware, /auth/me, use-viewer, Sidebar, AuthControls — e aqui mudou **só o texto do
   * parágrafo**. A prosa prometeu o viewer; o portão não foi tocado.
   *
   * Agora quem decide é `/auth/me`, que é a rota que EXISTE para responder "quem é você":
   *   1. sessão válida? (se não, é aí que se nega — e só aí)
   *   2. `can_bootstrap_owner` (não há admin nenhum ainda)? então tenta promover — BEST-EFFORT
   *   3. entra, seja admin ou viewer
   *
   * ⚠️ O passo 2 não pode mais bloquear nada. Ele serve ao primeiro login do owner e a mais nada.
   */
  const entrar = useCallback(
    async (token: string) => {
      const auth = { Authorization: `Bearer ${token}` };

      const me = await fetch("/api/v1/auth/me", { headers: auth }).catch(() => null);
      if (!me || !me.ok) {
        /**
         * ⚠️ 401 e 5xx pedem AÇÕES DIFERENTES, e tratá-los igual foi parte do que confundiu aqui.
         *   · 401 → a sessão não vale: sair e entrar de novo resolve;
         *   · 5xx → o servidor está mal configurado: entrar de novo NÃO resolve, e mandar o
         *     usuário tentar de novo é fazê-lo repetir uma ação que não pode dar certo.
         * Só o primeiro caso invalida a sessão na tela.
         */
        const payload = (await me?.json().catch(() => null)) as { error?: string } | null;
        const problemaDeServidor = !me || me.status >= 500;
        setMessage(
          problemaDeServidor
            ? payload?.error ?? "O servidor não respondeu. Se persistir, confira /api/v1/system/status."
            : payload?.error ?? "Sua sessão não é mais válida. Entre novamente.",
        );
        marcarSessaoInvalida(!problemaDeServidor);
        return;
      }

      const perfil = (await me.json().catch(() => null)) as { can_bootstrap_owner?: boolean } | null;

      // Primeiro login do owner: promove. Falhar aqui é esperado para quem não está na allowlist,
      // e por isso o resultado é IGNORADO — o `catch` vazio é a correção, não um engolidor.
      if (perfil?.can_bootstrap_owner) {
        await fetch("/api/v1/auth/bootstrap-owner", { method: "POST", headers: auth }).catch(() => null);
      }

      router.replace(next);
    },
    // `marcarSessaoInvalida` é estável (`useCallback` com deps vazias), então `entrar` também é —
    // e é essa estabilidade que faz o efeito abaixo assinar uma vez só.
    [next, router, marcarSessaoInvalida],
  );

  useEffect(() => {
    if (!HAS_SUPABASE) return;
    const supabase = createSupabaseBrowserClient();
    /**
     * ⚠️ UMA assinatura, e SEM o `getSession()` que existia aqui.
     *
     * O `getSession()` era redundante: `onAuthStateChange` já reemite `INITIAL_SESSION` com a sessão
     * do cookie para cada subscriber novo. Os dois juntos chamavam `entrar()` EM PARALELO em toda
     * visita — dois `GET /auth/me`, dois `router.replace`, e no primeiro login do owner dois POST
     * concorrentes em `bootstrap-owner`, cuja corrida no `upsertAdminUser` (SELECT-depois-INSERT)
     * falha em silêncio porque o resultado é ignorado por desenho.
     */
    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUserEmail(session?.user.email ?? null);
      if (!session?.access_token) return;
      // A guarda que faltava neste ramo. Sem ela, a flag era zerada e o 401 se repetia sem fim.
      if (sessaoInvalidaRef.current) return;
      await entrar(session.access_token);
    });
    return () => listener.subscription.unsubscribe();
  }, [entrar]);

  async function signIn() {
    if (!email.trim() || !password) return;
    setBusy(true);
    setMessage(null);
    marcarSessaoInvalida(false);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      /**
       * ⚠️ O `else` FALTAVA, e a falha era silenciosa: quando o Supabase autentica mas não devolve
       * sessão (e-mail não confirmado, MFA pendente, identidade a vincular), `busy` voltava a
       * `false`, nenhuma mensagem aparecia, e o formulário ficava parado. Clicar em "Entrar" e não
       * acontecer nada é outro dos sintomas de "a autenticação está estranha".
       */
      if (data.session?.access_token) {
        await entrar(data.session.access_token);
      } else {
        setMessage(
          "Credenciais aceitas, mas a sessão não foi criada. Se o e-mail ainda não foi confirmado, " +
            "confirme-o e tente novamente.",
        );
      }
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
    marcarSessaoInvalida(false);
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
          {/* Sem fundo, mas SEM a classe `.brand-logo`: esta tela é escura por decisão fixa
              (bg-[#0f1117] / card #191b22) e não segue o tema. Com a troca de tinta ligada, um
              usuário de tema claro receberia a arte escura sobre o card escuro — invisível. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-iris.png"
            alt="IRIS — Instituto de Regulação, Inovação e Sustentabilidade"
            className="block w-full max-w-[280px]"
          />
          <h1 className="text-2xl font-semibold">Entrar no sistema</h1>
          <p className="text-sm leading-6 text-white/58">
            Acesso restrito a usuários cadastrados. Administradores gerenciam os dados; os demais entram em modo somente visualização.
          </p>
        </div>

        {userEmail ? (
          <div className="space-y-3">
            <div className="rounded-md border border-white/10 bg-white/[0.04] p-3 text-sm text-white/72">
              Sessão ativa como <span className="font-medium text-white">{userEmail}</span>.
            </div>
            {sessaoInvalida ? (
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
  /**
   * ⚠️ O ramo `forbidden` foi REMOVIDO porque era código morto que mentia.
   *
   * O middleware deixou de emitir `reason=forbidden` quando o papel VIEWER nasceu (ago/2026) —
   * lá sobrou só um comentário histórico. Mas a mensagem continuou aqui, então qualquer um que
   * chegasse com `?reason=forbidden` na URL lia "Este e-mail não é o administrador global
   * autorizado" — a mesma frase do bug que acabou de ser consertado, agora sem nenhuma causa real.
   */
  if (reason === "config") {
    return "Ambiente incompleto: faltam variáveis do Supabase em produção. Confira /api/v1/system/status.";
  }
  return null;
}
