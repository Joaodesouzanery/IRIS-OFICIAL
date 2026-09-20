/**
 * `fetch` com corte, para o client Supabase do servidor (Fase 29).
 *
 * ═══ O buraco ═══
 * `createSupabaseServerClient` nunca configurou `global.fetch`. O `SupabaseClient` injeta esse
 * fetch no postgrest, no storage **e** no auth — então, sem ele, NENHUM round-trip do caminho
 * quente tinha teto: nem os ~10 `db.auth.getUser(token)` que cada rodada paga (um por `call()` do
 * orquestrador, fora da fatia do passo), nem os SELECT/UPDATE dos quatro reapers, nem o
 * `db.storage.download()` de um PDF.
 *
 * Se qualquer um deles travasse, a função ficava viva indefinidamente, o cliente abortava aos 90 s
 * e disparava a rodada seguinte sobre a MESMA run — duas invocações concorrentes sobre as mesmas
 * linhas. É o cenário que o CLAUDE.md descreve e que produziu "A requisição passou de 90s sem
 * resposta" por semanas.
 *
 * ═══ Por que 10 s, e por que isso NÃO é um orçamento ═══
 * É piso de segurança, não fatia: maior que qualquer round-trip legítimo (a página de 1.000 linhas
 * que o `lerTudo` busca é a mais cara e fica muito abaixo disso) e menor que a folga de qualquer
 * passo. O corte por ORÇAMENTO de cada chamada continua sendo o do passo que a faz — quem tem
 * custo fixo declarado (o download, `orcamento-do-parse.ts`) ganha o seu próprio, mais apertado.
 *
 * ⚠️ Abortar uma ESCRITA deixa estado ambíguo: ela pode ter sido aplicada antes do corte. Todas as
 * escritas do caminho quente são UPDATE idempotente por `id`, então a rodada seguinte converge —
 * mas isso é propriedade do chamador, não desta função, e é por isso que está escrito aqui.
 */

/** Piso de segurança de um round-trip do Supabase. Não é orçamento — ver o cabeçalho. */
export const SUPABASE_RPC_TIMEOUT_MS = 10_000;

/**
 * Envolve um `fetch` com um teto. `tetoMs <= 0` devolve o fetch original (sem corte) — é a porta
 * de saída para quem precisar do comportamento legado sem um ramo condicional no chamador.
 */
export function fetchComTeto(base: typeof fetch, tetoMs: number): typeof fetch {
  if (!Number.isFinite(tetoMs) || tetoMs <= 0) return base;

  return async function fetchComCorte(entrada: any, init?: any): Promise<Response> {
    const controlador = new AbortController();
    const doChamador: AbortSignal | null | undefined = init?.signal;
    // O signal do chamador continua valendo: quem cancela primeiro ganha.
    const seguir = () => controlador.abort(doChamador?.reason);
    if (doChamador) {
      if (doChamador.aborted) seguir();
      else doChamador.addEventListener("abort", seguir, { once: true });
    }
    const relogio = setTimeout(() => controlador.abort(new Error("__teto__")), tetoMs);

    try {
      return await base(entrada, { ...(init ?? {}), signal: controlador.signal });
    } catch (err) {
      // Só reescreve a mensagem quando o corte foi NOSSO. Abort do chamador sobe como veio.
      const foiOTeto = controlador.signal.aborted && !doChamador?.aborted;
      if (foiOTeto) {
        throw new Error(`Round-trip do Supabase excedeu ${Math.round(tetoMs / 1000)}s — reprocessável na próxima rodada.`);
      }
      throw err;
    } finally {
      clearTimeout(relogio);
      doChamador?.removeEventListener("abort", seguir);
    }
  } as typeof fetch;
}
