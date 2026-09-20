/**
 * O que `processPendingDocuments` vai fazer nesta chamada (Fase 29) — folha pura.
 *
 * ═══ O defeito que isto conserta ═══
 * A esteira chama `/upload/process` DUAS vezes por rodada: uma com `apenas_reaper=1`
 * (passo barato, cedo) e outra para extrair. Mas `processPendingDocuments` rodava os QUATRO
 * reapers INCONDICIONALMENTE e só depois consultava o modo — então a segunda chamada repetia
 * todo o reparo, e a conta saía da fatia da EXTRAÇÃO.
 *
 * Custo medido do que a extração pagava sem precisar: 1 SELECT de `queued` + 25 do N+1 (com os
 * 25 documentos da ARTESP presos em fila) + 2 UPDATEs cegos + o poço `em_revisao` + até 25
 * carimbos + 2 SELECTs da reconciliação = **33 a 58 round-trips**, até 51.000 ms de uma fatia de
 * 53.000 ms. É a explicação inteira de "a extração iniciou 2 jobs em 10 rodadas".
 *
 * ═══ Por que um MODO e não um early-return mais cedo ═══
 * Mover o `return` de `apenasReaper` para antes dos reapers quebraria o próprio passo `reaper`:
 * ele viraria no-op e nada mais repararia documento preso. O problema nunca foi ONDE o return
 * está — é que só existia UM modo. E um carimbo "já reparei nesta invocação" seria pior: o
 * escopo de módulo SOBREVIVE entre invocações no container quente da Vercel, então o carimbo
 * suprimiria os reapers pelo resto da vida do processo.
 *
 * ⚠️ O default é `"ambos"`. A tela de upload manual (`dashboard/upload/page.tsx`) chama
 * `/upload/process?limit=8` sem flag nenhuma e depende do reparo oportunista; mudar o default
 * tiraria isso dela em silêncio.
 */

export type ModoDoProcessamento = "reaper" | "extracao" | "ambos";

export interface PlanoDoProcessamento {
  modo: ModoDoProcessamento;
  reparar: boolean;
  extrair: boolean;
}

/**
 * Lê os dois sinalizadores da querystring. `apenas_reaper` vence quando os dois vêm juntos —
 * é o modo mais conservador (repara e não gasta a fila cara), e a combinação não é usada por
 * nenhum chamador real.
 */
export function modoDoProcessamento(params: {
  apenasReaper?: boolean;
  apenasExtracao?: boolean;
}): PlanoDoProcessamento {
  if (params.apenasReaper) return { modo: "reaper", reparar: true, extrair: false };
  if (params.apenasExtracao) return { modo: "extracao", reparar: false, extrair: true };
  return { modo: "ambos", reparar: true, extrair: true };
}
