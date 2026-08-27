/**
 * GET /api/v1/admin/diagnostico/teto-tempo?ms=110000 — MEDE o teto real de execução da função.
 *
 * ═══ Por que uma rota só para dormir ═══
 *
 * Todo o orçamento da esteira está apoiado num número que NINGUÉM mediu. O `CLAUDE.md` afirma que
 * no Hobby o SIGKILL vem aos 60s; `HOBBY_BUDGET_MS` vale 50s por causa disso. As duas "provas" que
 * circulavam não provam:
 *
 *  · "os deploys passam com `maxDuration: 120`" — o Vercel em vários casos ACEITA o valor e rebaixa
 *    silenciosamente em runtime. O build verde não diz nada sobre o teto efetivo.
 *  · "a função chegou viva aos 90s" (o abort do cliente em `api.ts`, e não um 504 do gateway) —
 *    isso prova que AQUELA invocação passou dos 90s, e é compatível com um teto de 100s tanto
 *    quanto com um de 300.
 *
 * A doc do Vercel hoje dá 300s para Hobby SOB FLUID COMPUTE, que é configuração e não padrão
 * universal. Medir custa dois minutos; inferir custou três fases.
 *
 * ═══ Como usar ═══
 *
 * Logado como admin, abra a URL no navegador com `ms` crescente — `55000`, depois `110000`:
 *   · HTTP 200 com `decorrido_ms ≈ pedido_ms`  → a função sobreviveu; o teto é ≥ esse valor.
 *   · HTTP 504 (FUNCTION_INVOCATION_TIMEOUT)   → morreu; o teto está abaixo.
 * Duas medições emparedam o teto, e o número entra no código sabendo o que é.
 *
 * ⚠️ `maxDuration` aqui é 120 DE PROPÓSITO, não 300: é o valor que as outras 20 rotas do
 * `vercel.json` já declaram e que portanto já passou por 10 builds. Declarar 300 introduziria
 * risco NOVO de validação de configuração — exatamente o que derrubou 8 deploys em 26/08 — e o
 * commit que depende desta medição só precisa saber se 100s cabe. Se um dia a medição de 250s
 * for necessária, ela é um experimento à parte, com o risco assumido.
 *
 * Não escreve nada. Não toca no banco. O único efeito é consumir tempo de função.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Teto do parâmetro. Fica ABAIXO do maior teto que a doc do Vercel documenta (300s) para que uma
 * medição jamais seja abortada pelo próprio limite da plataforma sem que o número tenha sentido.
 */
const MAX_MS = 290_000;

/** Padrão conservador: cabe folgado sob qualquer teto plausível, então serve de controle. */
const PADRAO_MS = 55_000;

export async function GET(req: NextRequest) {
  // `requireAdmin` já embute o gate de demo (bloqueia demo antes de qualquer coisa).
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const bruto = Number(req.nextUrl.searchParams.get("ms") ?? PADRAO_MS);
  if (!Number.isFinite(bruto) || bruto <= 0) {
    return NextResponse.json(
      { error: "Parâmetro `ms` inválido: informe um número de milissegundos maior que zero." },
      { status: 400 },
    );
  }
  const pedido_ms = Math.min(Math.round(bruto), MAX_MS);

  const inicio = Date.now();
  await new Promise((resolve) => setTimeout(resolve, pedido_ms));
  const decorrido_ms = Date.now() - inicio;

  return NextResponse.json({
    pedido_ms,
    decorrido_ms,
    teto_ms_do_parametro: MAX_MS,
    max_duration_declarado: maxDuration,
    // O que este 200 autoriza a concluir — escrito aqui para não depender de quem lê lembrar.
    veredito: `A função sobreviveu a ${Math.round(decorrido_ms / 1000)}s. O teto efetivo desta conta é ≥ ${Math.round(decorrido_ms / 1000)}s.`,
    proximo_passo:
      pedido_ms >= 110_000
        ? "Suficiente para orçar 100s na esteira (HOBBY_BUDGET_MS)."
        : `Repita com ms=110000 para saber se 100s de orçamento cabem.`,
  });
}
