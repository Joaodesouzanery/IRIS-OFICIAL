/**
 * Etapa 115 (Fase 19, commit 4) — os 232 filhos de ata recuperam o `resultado`, e viram VOTO.
 *
 * ═══ O que este commit repara, e o que ele NÃO é ═══
 * Eu ia consertar o extrator. Medi antes: o splitter roda perfeito hoje — 4 atas reais da ANM,
 * 305 itens, `semResultado = 0`, e os 10 itens exatos da amostra saem certos (1.6.1–1.6.6 =
 * "Retirado de Pauta"). Os 232 são passivo de um build anterior às correções de 24/08.
 * **Reparo por UPDATE, não conserto de extrator.**
 *
 * E é o que destrava os votos: `materializar-faltantes:86` exige
 * `documento_pai_id && resultado` para um item de ata gerar linha em `votos`. Sem `resultado`,
 * eles são invisíveis para o materializador — e para o denominador das métricas.
 *
 * ═══ As três guardas ═══
 * · nunca sobrescreve valor não-nulo (o reparo não pode reescrever história);
 * · nunca toca filho de PAUTA (senão fabrica voto de agenda — por isso o commit da pauta vem
 *   antes deste, e o predicado exclui `PAUTA-%` mesmo assim: cinto e suspensório);
 * · **checa `{error}` de cada escrita** — e isso é AUDITADO, não declarado (ver o último bloco).
 */

import { describe, it, expect } from "vitest";
import { casarResultadoDoItem, contarReparos } from "@/lib/server/re-resultar";

const ITENS_DA_ATA = [
  { item_numero: "1.6.1", resultado: "Retirado de Pauta", decisao: null },
  { item_numero: "2.1.1", resultado: "Aprovado por Unanimidade", decisao: "Voto referendado por unanimidade." },
  { item_numero: "3.1.1", resultado: "Deferido", decisao: "Voto aprovado." },
] as any[];

describe("etapa115 · o casamento por item_numero", () => {
  it("COMPORTAMENTO: filho sem resultado recebe o do item correspondente", () => {
    const patch = casarResultadoDoItem(
      { item_numero: "2.1.1", numero_deliberacao: "ATA-83-2.1.1", resultado: null, resumo_pleito: null } as any,
      ITENS_DA_ATA,
    );
    expect(patch).toEqual({
      resultado: "Aprovado por Unanimidade",
      resumo_pleito: "Voto referendado por unanimidade.",
    });
  });

  it("item RETIRADO também é reparado — «Retirado de Pauta» é desfecho, não ausência", () => {
    const patch = casarResultadoDoItem(
      { item_numero: "1.6.1", numero_deliberacao: "ATA-83-1.6.1", resultado: null, resumo_pleito: null } as any,
      ITENS_DA_ATA,
    );
    expect(patch?.resultado).toBe("Retirado de Pauta");
  });

  it("NUNCA sobrescreve resultado já preenchido — reparo não reescreve história", () => {
    const patch = casarResultadoDoItem(
      { item_numero: "2.1.1", numero_deliberacao: "ATA-83-2.1.1", resultado: "Indeferido", resumo_pleito: null } as any,
      ITENS_DA_ATA,
    );
    expect(patch).toBeNull();
  });

  it("NUNCA toca filho de PAUTA — seria fabricar voto de agenda", () => {
    const patch = casarResultadoDoItem(
      { item_numero: "2.1.1", numero_deliberacao: "PAUTA-1036-2.1.1", resultado: null, resumo_pleito: null } as any,
      ITENS_DA_ATA,
    );
    expect(patch).toBeNull();
  });

  it("item sem correspondente na ata não inventa nada", () => {
    const patch = casarResultadoDoItem(
      { item_numero: "9.9.9", numero_deliberacao: "ATA-83-9.9.9", resultado: null, resumo_pleito: null } as any,
      ITENS_DA_ATA,
    );
    expect(patch).toBeNull();
  });

  it("item cujo correspondente TAMBÉM não tem resultado não vira patch vazio", () => {
    const patch = casarResultadoDoItem(
      { item_numero: "5.5.5", numero_deliberacao: "ATA-83-5.5.5", resultado: null, resumo_pleito: null } as any,
      [{ item_numero: "5.5.5", resultado: null, decisao: null }] as any[],
    );
    expect(patch).toBeNull();
  });
});

describe("etapa115 · AUDITORIA da própria regra: escrita que falha NÃO é contada", () => {
  // Seria contraditório criar a skill `falha-silenciosa` nesta mesma fase e o código dela não
  // passar pela própria regra. `supabase-js` devolve {error} em vez de lançar: quem não checa
  // conta como gravado o que não gravou — e a próxima medição nasce envenenada.
  it("COMPORTAMENTO: 3 escritas, 1 falha → conta 2 reparadas e 1 falha", async () => {
    let n = 0;
    const gravar = async () => {
      n++;
      return n === 2 ? { error: { message: "23514 violação de check" } } : { error: null };
    };
    const r = await contarReparos([1, 2, 3], gravar as any);
    expect(r).toEqual({ reparadas: 2, falhas: 1 });
  });

  it("todas falhando → zero reparadas (o contador não pode mentir para cima)", async () => {
    const r = await contarReparos([1, 2], (async () => ({ error: { message: "x" } })) as any);
    expect(r).toEqual({ reparadas: 0, falhas: 2 });
  });
});
