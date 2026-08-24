/**
 * Etapa 64 — o CONTRATO de `/dashboard/governanca-agencias`.
 *
 * Este teste existe por causa de um defeito específico e instrutivo: a página de Saúde dos Dados
 * tipou a resposta como `AgenciaGov[]` quando a rota devolve `{ por_agencia: [...] }`. O
 * `type-check` passou verde — porque `api.get` faz `res.json() as Promise<T>`, um cast NÃO
 * CHECADO. O erro só aparecia em runtime: o objeto (truthy) escapava do `?? []` e o primeiro
 * `.reduce()` derrubava a página inteira, sem error boundary para segurar.
 *
 * Lição que o teste codifica: onde há cast não checado, o compilador não é fiscal. O contrato
 * precisa de um teste, ou a próxima mudança de forma quebra a tela em silêncio.
 */

import { describe, it, expect } from "vitest";

/** Réplica do consumo real das duas telas (governanca e saude-dados). */
function derivarLinhas(resposta: unknown): unknown[] {
  const r = resposta as { por_agencia?: unknown } | null | undefined;
  return Array.isArray(r?.por_agencia) ? r!.por_agencia as unknown[] : [];
}

describe("etapa64 · a resposta é um OBJETO com `por_agencia`, não um array", () => {
  it("o formato correto produz as linhas", () => {
    const resposta = {
      por_agencia: [
        { agencia_id: "a1", sigla: "ANM", nome: "ANM", total: 10, total_decidido: 5, total_com_voto: 2, consenso: 50, cobertura_nominal: 20, deferimento: 60 },
      ],
    };
    expect(derivarLinhas(resposta)).toHaveLength(1);
  });

  it("tipar como ARRAY é o bug: `.reduce` sobre o objeto derruba a página", () => {
    const resposta: unknown = { por_agencia: [] };
    // O que a página fazia: `const linhas = agencias ?? []`. O objeto é truthy e passa.
    const errado = (resposta as unknown[] | null) ?? [];
    expect(Array.isArray(errado)).toBe(false);
    expect(() => (errado as unknown[]).reduce(() => 0, 0)).toThrow(TypeError);
    // O que ela faz agora:
    expect(derivarLinhas(resposta)).toEqual([]);
  });

  it("resposta vazia, nula ou de formato inesperado degrada para lista vazia", () => {
    expect(derivarLinhas(undefined)).toEqual([]);
    expect(derivarLinhas(null)).toEqual([]);
    expect(derivarLinhas({})).toEqual([]);
    expect(derivarLinhas({ por_agencia: null })).toEqual([]);
    expect(derivarLinhas([])).toEqual([]); // array cru (o formato que a página supunha)
  });

  it("`consenso` pode ser null e nenhum consumidor pode formatá-lo cegamente", () => {
    // Sem base de voto o valor é `null`, não 0 — publicar 0 faria "nenhum voto lido" parecer
    // "colegiado em conflito total", e o Score de Governança pondera consenso em 30%.
    const consenso: number | null = null;
    expect(() => (consenso as unknown as number).toFixed(0)).toThrow(TypeError);
    expect(consenso === null ? "—" : `${consenso}%`).toBe("—");
  });
});
