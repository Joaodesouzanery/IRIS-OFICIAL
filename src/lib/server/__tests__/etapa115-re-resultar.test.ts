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

/**
 * ═══ Fase 20 — os três degraus (o commit anterior reparava ZERO) ═══
 *
 * A versão da Fase 19 lia os `ata_items` ARMAZENADOS no pai. Mas esse é o mesmo array que gerou
 * os filhos (`confirm/route.ts:870 resultado: item.resultado`), e documento `confirmed` nunca é
 * re-splitado — logo filho NULL ⇒ array NULL ⇒ patch null ⇒ **zero reparos**, devolvendo
 * `reparadas: 0, sem_fonte: 0`, que é o pior formato de zero porque parece saudável.
 */

import { repararItem } from "@/lib/server/re-resultar";

describe("etapa120 · os três degraus, do grátis ao caro", () => {
  const filho = (over: Record<string, unknown> = {}) => ({
    item_numero: "1.6.1",
    numero_deliberacao: "ATA-83-1.6.1",
    resultado: null,
    resumo_pleito: null,
    ...over,
  }) as any;

  it("degrau 1 — array armazenado com resultado (o pai que por acaso foi reprocessado)", () => {
    const r = repararItem(filho(), {
      itensDoArray: [{ item_numero: "1.6.1", resultado: "Deferido", decisao: "Voto aprovado." }],
      itensDoResplit: [],
    });
    expect(r?.degrau).toBe("array");
    expect(r?.patch.resultado).toBe("Deferido");
  });

  it("degrau 2 — LIGADURA: o dispositivo do próprio filho, com o «ti» consertado", () => {
    // O caso real medido na ANTT: o texto chega "Processo re%rado de pauta". `inferResultadoFromText`
    // devolve null no texto cru e "Retirado de Pauta" depois de `repairLigatures`. Zero I/O:
    // `resumo_pleito` já vem no SELECT do filho.
    const r = repararItem(filho({ resumo_pleito: "Processo re%rado de pauta pelo relator." }), {
      itensDoArray: [{ item_numero: "1.6.1", resultado: null, decisao: null }],
      itensDoResplit: [],
    });
    expect(r?.degrau).toBe("ligadura");
    expect(r?.patch.resultado).toBe("Retirado de Pauta");
  });

  it("degrau 3 — RE-SPLIT do texto do pai, quando o array está velho", () => {
    const r = repararItem(filho(), {
      itensDoArray: [{ item_numero: "1.6.1", resultado: null, decisao: null }],
      itensDoResplit: [{ item_numero: "1.6.1", resultado: "Aprovado por Unanimidade", decisao: "Voto aprovado." }],
    });
    expect(r?.degrau).toBe("resplit");
    expect(r?.patch.resultado).toBe("Aprovado por Unanimidade");
  });

  it("SEM CASAMENTO: o item_numero da safra velha não existe no re-split → null, e é CONTADO", () => {
    // É o risco que sobrou: se a numeração mudou entre as safras, o reparo devolve 0 com outra
    // cara. Distinguir "não casou" de "nada a fazer" é o que impede o zero silencioso de novo.
    const r = repararItem(filho({ item_numero: "9.9.9", numero_deliberacao: "ATA-83-9.9.9" }), {
      itensDoArray: [],
      itensDoResplit: [{ item_numero: "1.6.1", resultado: "Deferido", decisao: null }],
    });
    expect(r).toBeNull();
  });

  it("a ordem é do BARATO ao caro: com array bom, nem olha o re-split", () => {
    const r = repararItem(filho({ resumo_pleito: "Processo re%rado." }), {
      itensDoArray: [{ item_numero: "1.6.1", resultado: "Deferido", decisao: null }],
      itensDoResplit: [{ item_numero: "1.6.1", resultado: "Indeferido", decisao: null }],
    });
    expect(r?.degrau).toBe("array");
  });

  it("as três recusas valem em TODOS os degraus", () => {
    const fontes = {
      itensDoArray: [{ item_numero: "1.6.1", resultado: "Deferido", decisao: null }],
      itensDoResplit: [{ item_numero: "1.6.1", resultado: "Deferido", decisao: null }],
    };
    // resultado já preenchido
    expect(repararItem(filho({ resultado: "Indeferido" }), fontes)).toBeNull();
    // filho de PAUTA — seria fabricar voto de agenda
    expect(repararItem(filho({ numero_deliberacao: "PAUTA-1036-1.6.1" }), fontes)).toBeNull();
    // dispositivo que não permite inferir nada não vira chute
    expect(
      repararItem(filho({ resumo_pleito: "Assunto encaminhado." }), { itensDoArray: [], itensDoResplit: [] }),
    ).toBeNull();
  });
});
