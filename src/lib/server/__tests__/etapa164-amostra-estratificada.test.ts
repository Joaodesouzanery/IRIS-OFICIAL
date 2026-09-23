/**
 * Etapa 164 (Fase 31, Bloco 1) — a amostra que cobre o espaço, não a média.
 *
 * ═══ Por que a amostra simples não conferia nada ═══
 * Na base real, ~98% dos votos são inferidos e favoráveis (medido na tela: ARTESP 69 nominais
 * contra 1.768 inferidos). Um sorteio uniforme devolve cinco linhas do MESMO caso fácil. O revisor
 * confere cinco vezes a mesma coisa e não aprendeu nada sobre impedimento, divergência nominal ou
 * voto individual — que são exatamente onde a extração pode errar.
 *
 * A amostra por COTAS inverte a ordem: o raro primeiro, o comum depois. E declara o que faltou,
 * porque "não existe divergência nominal nesta agência" é achado, não defeito da amostra.
 */

import { describe, it, expect } from "vitest";
import {
  amostrarEstratificado, cotasDaLinha, COTAS,
  type LinhaAmostravel, type Cota,
} from "@/lib/server/amostra-estratificada";

let seq = 0;
const linha = (over: Partial<LinhaAmostravel> = {}): LinhaAmostravel => ({
  voto_id: `v${++seq}`, agencia: "ANM", origem: "inferido",
  resultado: "Deferido", motivo_nao_voto: null, is_divergente: false,
  tipo_documento: "ata", ...over,
});

describe("etapa164 · que cotas cada linha satisfaz", () => {
  it("impedimento e ausência entram pela MESMA cota — os dois são «não votou, e há motivo»", () => {
    expect(cotasDaLinha(linha({ motivo_nao_voto: "impedimento" }))).toContain("ausencia_ou_impedimento");
    expect(cotasDaLinha(linha({ motivo_nao_voto: "ausencia" }))).toContain("ausencia_ou_impedimento");
    expect(cotasDaLinha(linha({ motivo_nao_voto: null }))).not.toContain("ausencia_ou_impedimento");
  });

  it("⚠️ divergência só conta como NOMINAL quando foi lida do documento", () => {
    // Divergência inferida é consequência da regra de direção, não evidência do PDF: conferi-la
    // contra o documento não ensina nada sobre a extração.
    expect(cotasDaLinha(linha({ is_divergente: true, origem: "lido" }))).toContain("divergencia_nominal");
    expect(cotasDaLinha(linha({ is_divergente: true, origem: "inferido" }))).not.toContain("divergencia_nominal");
    expect(cotasDaLinha(linha({ is_divergente: null, origem: "lido" }))).not.toContain("divergencia_nominal");
  });

  it("o desfecho sai da MESMA função que decide a direção do voto inferido", () => {
    // `tipoVotoInferido`: só "Indeferido" é negativo; "Retirado de Pauta" e nulo não são desfecho.
    expect(cotasDaLinha(linha({ resultado: "Indeferido" }))).toContain("desfecho_indeferido");
    expect(cotasDaLinha(linha({ resultado: "Deferido" }))).toContain("desfecho_deferido");
    expect(cotasDaLinha(linha({ resultado: "Aprovado por Unanimidade" }))).toContain("desfecho_deferido");
    const semDesfecho = cotasDaLinha(linha({ resultado: "Retirado de Pauta" }));
    expect(semDesfecho).not.toContain("desfecho_deferido");
    expect(semDesfecho).not.toContain("desfecho_indeferido");
    expect(cotasDaLinha(linha({ resultado: null })).filter((c) => c.startsWith("desfecho"))).toEqual([]);
  });

  it("as três fontes são distinguidas, e tipo desconhecido não vira fonte nenhuma", () => {
    expect(cotasDaLinha(linha({ tipo_documento: "ata" }))).toContain("fonte_ata");
    expect(cotasDaLinha(linha({ tipo_documento: "deliberacao" }))).toContain("fonte_deliberacao");
    expect(cotasDaLinha(linha({ tipo_documento: "voto" }))).toContain("fonte_voto_individual");
    expect(cotasDaLinha(linha({ tipo_documento: "pauta" })).filter((c) => c.startsWith("fonte_"))).toEqual([]);
    expect(cotasDaLinha(linha({ tipo_documento: null })).filter((c) => c.startsWith("fonte_"))).toEqual([]);
  });

  it("origem é sempre uma das duas — nunca nenhuma", () => {
    expect(cotasDaLinha(linha({ origem: "lido" }))).toContain("origem_lido");
    expect(cotasDaLinha(linha({ origem: "inferido" }))).toContain("origem_inferido");
  });
});

describe("etapa164 · ⚠️ o raro ganha a vaga do comum", () => {
  /** 40 linhas banais + uma de cada caso raro, tudo na mesma agência. */
  const universo = (): LinhaAmostravel[] => [
    ...Array.from({ length: 40 }, () => linha()),
    linha({ motivo_nao_voto: "impedimento", voto_id: "RARO-imped" }),
    linha({ is_divergente: true, origem: "lido", voto_id: "RARO-diverg" }),
    linha({ tipo_documento: "voto", voto_id: "RARO-voto" }),
    linha({ resultado: "Indeferido", voto_id: "RARO-indef" }),
  ];

  it("com 5 vagas e 44 linhas, os quatro casos raros entram", () => {
    const [a] = amostrarEstratificado(universo(), { porAgencia: 5, seed: "fixo" });
    const ids = a.linhas.map((l) => l.voto_id);
    expect(ids).toContain("RARO-imped");
    expect(ids).toContain("RARO-diverg");
    expect(ids).toContain("RARO-voto");
    expect(ids).toContain("RARO-indef");
    expect(a.linhas).toHaveLength(5);
  });

  it("…e isso vale para QUALQUER seed — não é sorte de uma semente", () => {
    // A garantia é do algoritmo (greedy pela cota escassa), não do embaralhamento. Se dependesse
    // do seed, o teste estaria medindo a sorte e não o desenho.
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const [a] = amostrarEstratificado(universo(), { porAgencia: 5, seed });
      const ids = a.linhas.map((l) => l.voto_id);
      for (const raro of ["RARO-imped", "RARO-diverg", "RARO-voto", "RARO-indef"]) {
        expect(ids, `seed=${seed} perdeu ${raro}`).toContain(raro);
      }
    }
  });

  it("⚠️ com vaga JUSTA, é a prioridade que decide quem entra", () => {
    // Com 5 vagas o greedy cobre tudo em qualquer ordem, então aquele caso não mede prioridade —
    // mede folga. Com 4 vagas a ordem passa a decidir: se as cotas comuns (`origem_*`,
    // `desfecho_*`) forem servidas primeiro, elas consomem vagas com linhas banais e o caso mais
    // raro do conjunto, o impedimento, fica de fora.
    const [a] = amostrarEstratificado(universo(), { porAgencia: 4, seed: "justo" });
    const ids = a.linhas.map((l) => l.voto_id);
    expect(ids, "a vaga justa perdeu um caso raro para uma linha banal").toEqual(
      expect.arrayContaining(["RARO-imped", "RARO-diverg", "RARO-voto", "RARO-indef"]),
    );
    expect(a.linhas).toHaveLength(4);
  });

  it("nenhuma linha entra duas vezes", () => {
    const [a] = amostrarEstratificado(universo(), { porAgencia: 8, seed: "x" });
    expect(new Set(a.linhas.map((l) => l.voto_id)).size).toBe(a.linhas.length);
  });
});

describe("etapa164 · ⚠️ «não existe» é diferente de «não coube»", () => {
  it("agência sem impedimento nenhum declara a cota como SEM EXEMPLAR", () => {
    const [a] = amostrarEstratificado(
      Array.from({ length: 10 }, () => linha({ agencia: "ARTESP" })), { porAgencia: 5, seed: "s" },
    );
    expect(a.cotas_sem_exemplar).toContain("ausencia_ou_impedimento");
    expect(a.cotas_sem_exemplar).toContain("divergencia_nominal");
    // …e não mente dizendo que "não coube": ela não existe.
    expect(a.cotas_fora_do_tamanho).not.toContain("ausencia_ou_impedimento");
  });

  it("cota que EXISTE mas não coube em `n` é declarada no outro balde", () => {
    // 1 vaga, universo que cobre as NOVE cotas: o greedy pega o primeiro da ordem e os outros
    // ficam registrados como "existe, não coube" — nunca como "não existe".
    // ⚠️ O universo precisa mesmo cobrir tudo: a primeira versão deste caso esquecia
    // `fonte_deliberacao` e o teste acusou o CÓDIGO por uma falha da própria fixture.
    const linhas = [
      linha({ motivo_nao_voto: "impedimento", tipo_documento: "ata", resultado: "Deferido", origem: "inferido" }),
      linha({ is_divergente: true, origem: "lido", tipo_documento: "voto", resultado: "Indeferido" }),
      linha({ tipo_documento: "deliberacao", resultado: "Deferido", origem: "inferido" }),
    ];
    const [a] = amostrarEstratificado(linhas, { porAgencia: 1, seed: "s" });
    expect(a.linhas).toHaveLength(1);
    expect(a.cotas_sem_exemplar).toEqual([]);
    expect(a.cotas_fora_do_tamanho.length).toBeGreaterThan(0);
    // ⚠️ Os dois baldes são DISJUNTOS por construção: uma cota não pode faltar pelos dois motivos.
    for (const c of a.cotas_fora_do_tamanho) expect(a.cotas_sem_exemplar).not.toContain(c);
  });

  it("⚠️ cota JÁ COBERTA por uma linha escolhida não pode ser reportada como lacuna", () => {
    // Três linhas que, juntas, cobrem as NOVE cotas. Com três vagas, a cobertura é total e
    // `cotas_fora_do_tamanho` tem de ficar VAZIO.
    //
    // O que este caso mata: marcar como coberta apenas a cota que MOTIVOU a escolha, em vez de
    // todas as que a linha satisfaz. O efeito seria um relatório acusando seis lacunas que a
    // própria amostra já cobre — alarme falso, que é a versão barulhenta da mentira silenciosa.
    const linhas = [
      linha({ motivo_nao_voto: "impedimento", tipo_documento: "ata", resultado: "Deferido", origem: "inferido" }),
      linha({ is_divergente: true, origem: "lido", tipo_documento: "voto", resultado: "Indeferido" }),
      linha({ tipo_documento: "deliberacao", resultado: "Deferido", origem: "inferido" }),
    ];
    const [a] = amostrarEstratificado(linhas, { porAgencia: 3, seed: "s" });
    expect(a.linhas).toHaveLength(3);
    expect(a.cotas_sem_exemplar).toEqual([]);
    expect(a.cotas_fora_do_tamanho, "acusou lacuna em cota que as linhas escolhidas cobrem").toEqual([]);
  });

  it("toda cota declarada existe no vocabulário — nenhuma string solta", () => {
    const [a] = amostrarEstratificado([linha()], { porAgencia: 5, seed: "s" });
    for (const c of [...a.cotas_sem_exemplar, ...a.cotas_fora_do_tamanho]) {
      expect(COTAS as readonly string[]).toContain(c as Cota);
    }
  });
});

describe("etapa164 · determinismo e separação por agência", () => {
  const misto = (): LinhaAmostravel[] => [
    ...Array.from({ length: 12 }, () => linha({ agencia: "ANM" })),
    ...Array.from({ length: 12 }, () => linha({ agencia: "ANTT" })),
    ...Array.from({ length: 12 }, () => linha({ agencia: "ARTESP" })),
  ];

  it("o mesmo seed devolve a MESMA amostra — um achado pode ser reaberto", () => {
    const base = misto();
    const a = amostrarEstratificado(base, { porAgencia: 3, seed: "reproduzivel" });
    const b = amostrarEstratificado(base, { porAgencia: 3, seed: "reproduzivel" });
    expect(a.map((x) => x.linhas.map((l) => l.voto_id))).toEqual(b.map((x) => x.linhas.map((l) => l.voto_id)));
  });

  it("⚠️ agências diferentes não recebem a mesma permutação — senão a amostra tem viés de posição", () => {
    // O seed é `${semente}|${agencia}`. Com seed global único, as três agências escolheriam os
    // MESMOS índices do próprio baralho, e a amostra deixaria de ser independente entre elas.
    const base = misto().map((l, i) => ({ ...l, voto_id: `${l.agencia}-${i % 12}` }));
    const r = amostrarEstratificado(base, { porAgencia: 3, seed: "z" });
    const posicoes = r.map((a) => a.linhas.map((l) => l.voto_id.split("-")[1]).join(","));
    expect(new Set(posicoes).size, `as três agências pegaram as mesmas posições: ${posicoes}`).toBeGreaterThan(1);
  });

  it("uma agência por grupo, ordenadas, com o universo declarado", () => {
    const r = amostrarEstratificado(misto(), { porAgencia: 3, seed: "s" });
    expect(r.map((a) => a.agencia)).toEqual(["ANM", "ANTT", "ARTESP"]);
    for (const a of r) expect(a.universo).toBe(12);
  });

  it("universo menor que `n` devolve o universo inteiro, sem repetir e sem quebrar", () => {
    const r = amostrarEstratificado([linha({ agencia: "ANM" }), linha({ agencia: "ANM" })], { porAgencia: 5, seed: "s" });
    expect(r[0].linhas).toHaveLength(2);
  });

  it("lista vazia não quebra e não inventa agência", () => {
    expect(amostrarEstratificado([], { porAgencia: 5, seed: "s" })).toEqual([]);
  });

  it("agência nula vira «?» em vez de sumir da amostra", () => {
    const r = amostrarEstratificado([linha({ agencia: null })], { porAgencia: 5, seed: "s" });
    expect(r[0].agencia).toBe("?");
  });
});
