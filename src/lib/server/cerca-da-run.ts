/**
 * Uma invocação por execução, por vez (Fase 29) — folha pura.
 *
 * ═══ O buraco, em uma linha de código ═══
 * O guard de concorrência era `if (ativa && corpo.run_id && ativa.id !== corpo.run_id)`. Quando o
 * cliente aborta aos 90 s, ele re-dispara a rodada seguinte com o MESMO `run_id` — os ids são
 * iguais, o 409 não sai, e duas invocações passam a trabalhar sobre as mesmas linhas. É exatamente
 * o cenário que o CLAUDE.md descreve ("acima de ~86s o laço dispara a rodada seguinte sobre a MESMA
 * run") e que este projeto vinha pagando em silêncio.
 *
 * Um buraco irmão, no mesmo `if`: com `corpo.run_id` AUSENTE e uma run ativa, a condição também é
 * falsa — então uma aba nova ENTRAVA na run da outra aba sem avisar ninguém.
 *
 * ═══ A cerca, sem migration ═══
 * `esteira_runs.rodadas` já existe e já é um contador monotônico. Ele vira o TOKEN: a invocação
 * reivindica a rodada com um compare-and-set
 *
 *     UPDATE ... SET rodadas = token + 1
 *      WHERE id = run_id AND status = 'running' AND rodadas = token
 *
 * Zero linhas afetadas = outra invocação já consumiu esse token → 409.
 *
 * ⚠️ Por que isso NÃO quebra a retomada legítima: a retomada acontece DEPOIS que a rodada anterior
 * respondeu, e a resposta carrega `rodadas`. O cliente devolve esse número e ganha o CAS. Quem
 * perde é quem repete um token já consumido — precisamente o caso do abort, em que o cliente nunca
 * recebeu a resposta e por isso ainda carrega o token antigo.
 *
 * ⚠️ E `registrarRodada` PARA de incrementar `rodadas`: quem incrementa é o claim. Dois
 * incrementos fariam o token pular de dois em dois e a rodada legítima seguinte tomaria 409.
 */

export type ResultadoDoClaim = "reivindicada" | "ocupada" | "sem_lock";

/**
 * O veredito, dado o que o banco diz e o token que a invocação trouxe.
 *
 * `rodadasNoBanco` nulo = a tabela `esteira_runs` não existe (deploy antes da migration): a esteira
 * roda como antes, sem cerca. É o mesmo degrade que o resto do arquivo já pratica.
 */
export function resultadoDoClaim(input: {
  rodadasNoBanco: number | null;
  token: number | null;
}): ResultadoDoClaim {
  if (input.rodadasNoBanco === null || input.token === null) return "sem_lock";
  return input.rodadasNoBanco === input.token ? "reivindicada" : "ocupada";
}

/** A mensagem do 409 — precisa dizer o que aconteceu, não só que deu errado. */
export const MOTIVO_OCUPADA =
  "Outra invocação desta execução ainda está em andamento. Aguarde a rodada anterior terminar.";
