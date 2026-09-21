/**
 * O que o cliente FAZ com cada 409 da cerca (Fase 30, commit 3).
 *
 * ═══ Por que isto é um módulo, e puro ═══
 * O laço do "Rodar tudo" tratava todo 409 do mesmo jeito: esperar 10 s e repetir **com o mesmo
 * token**. E `rodadas` é monotônico — o token que já perdeu o compare-and-set nunca mais bate.
 * O retry era estruturalmente inútil: três esperas e um desfecho "erros" numa esteira saudável.
 *
 * Agora o servidor diz QUAL dos casos é (`codigo` no corpo do 409), e cada um pede uma ação
 * diferente. A decisão é pura e testável aqui; o laço só executa o que ela devolve.
 *
 * ⚠️ A ARITMÉTICA DA ESPERA. A rodada legítima mais longa é ~85 s: orçamento de 70 s
 * (HOBBY_BUDGET_MS) + o round-trip de auth (≤10 s) + o flush da resposta. Três esperas de 10 s
 * somam 30 s, então o cliente desistia com a rodada **ainda no ar** — garantido, não por azar.
 * 20 + 30 + 45 = 95 s cobre o pior caso, e são 6% do teto de 25 min do laço.
 */

/** As esperas, em ordem. Esgotadas, o laço para com motivo. */
export const ESPERAS_DA_CERCA = [20_000, 30_000, 45_000] as const;

/**
 * Quantas vezes o cliente pode ADOTAR (id ou token) antes de desistir.
 *
 * Adoção não espera, então sem teto um servidor em estado inesperado viraria laço quente. Três é
 * o suficiente para a sequência mais longa que existe: adotar o id da run alheia → adotar o token
 * corrente → rodar.
 */
export const TETO_DE_ADOCOES = 3;

export type AcaoDaCerca =
  /** Repetir a rodada. `adotar` null = manter o que o laço já tem. */
  | {
      tipo: "repetir";
      adotar: { runId: string | null; rodadasVistas: number | null } | null;
      esperaMs: number;
      motivo: string;
    }
  /** A cerca não cedeu no prazo: parar com motivo, sem contar como erro da esteira. */
  | { tipo: "desistir"; motivo: string }
  /** Não é concorrência — é falha de verdade, e o laço conta como falha. */
  | { tipo: "falha_real" };

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function numero(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * A decisão, dado o que o servidor respondeu e o que o laço já gastou.
 *
 * `esperasFeitas` e `adocoesFeitas` são contadores SEPARADOS de propósito: esperar é caro em
 * tempo e barato em requisições; adotar é o inverso. Um contador só faria uma adoção consumir
 * uma espera, e três adoções legítimas matariam o laço sem ele ter esperado nada.
 */
export function decidirAposCerca(entrada: {
  status: number;
  codigo?: unknown;
  runId?: unknown;
  rodadas?: unknown;
  esperasFeitas: number;
  adocoesFeitas: number;
}): AcaoDaCerca {
  // 503 é o banco recusando a reserva. Tratá-lo como concorrência faria o cliente ESPERAR por
  // uma vaga que não está ocupada — e reportar ao operador o diagnóstico errado.
  if (entrada.status !== 409) return { tipo: "falha_real" };

  const codigo = texto(entrada.codigo);
  const runId = texto(entrada.runId);
  const rodadas = numero(entrada.rodadas);

  const esperar = (motivo: string): AcaoDaCerca => {
    if (entrada.esperasFeitas >= ESPERAS_DA_CERCA.length) {
      return { tipo: "desistir", motivo };
    }
    return { tipo: "repetir", adotar: null, esperaMs: ESPERAS_DA_CERCA[entrada.esperasFeitas], motivo };
  };

  const adotar = (alvo: { runId: string | null; rodadasVistas: number | null }, motivo: string): AcaoDaCerca => {
    if (entrada.adocoesFeitas >= TETO_DE_ADOCOES) return { tipo: "desistir", motivo };
    return { tipo: "repetir", adotar: alvo, esperaMs: 0, motivo };
  };

  switch (codigo) {
    // Há rodada NO AR. É o único caso em que esperar é a resposta certa — adotar aqui seria o
    // roubo que a Fase 30 conserta.
    case "rodada_em_voo":
      return esperar("aguardando a rodada anterior terminar");

    // A run é de outra aba (ou desta, antes do reload). Assumir o acompanhamento é o que o
    // usuário quer ao clicar "Rodar tudo": uma esteira, não duas.
    case "run_alheia":
      return adotar({ runId, rodadasVistas: rodadas }, "assumindo a execução em andamento");

    // A rodada anterior JÁ TERMINOU — por isso espera zero. Era aqui que o laço perdia 30 s e
    // depois desistia, repetindo um token que nunca mais bateria.
    case "token_ausente":
    case "token_vencido":
      return adotar({ runId, rodadasVistas: rodadas }, "retomando a partir da rodada atual");

    // Fechada por baixo (disjuntor, encerrar de outra aba, reaper). Insistir nela é impossível;
    // abrir uma nova é o que o clique pediu.
    case "run_encerrada":
      return adotar({ runId: null, rodadasVistas: null }, "a execução anterior foi encerrada — abrindo outra");

    case "banco_indisponivel":
      return { tipo: "falha_real" };

    // ⚠️ 409 SEM código: servidor anterior a esta fase (a janela entre dois deploys), ou um 409
    // de outra rota. Não dá para adotar o que não veio, então resta o comportamento conservador —
    // esperar. Chutar uma adoção com `null` apagaria o run_id que o laço já tinha.
    default:
      return esperar("aguardando a execução anterior");
  }
}
