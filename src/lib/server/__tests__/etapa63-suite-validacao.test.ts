/**
 * Etapa 63 — suíte de validação com nível BLOQUEANTE.
 *
 * Até aqui toda checagem era aviso: rebaixa confiança e manda para revisão, mas o documento entra.
 * Alguns defeitos não deveriam entrar de jeito nenhum — segmentação quebrada e voto que contradiz
 * o próprio dispositivo produzem dado que PARECE bom e está errado, que é a pior espécie.
 *
 * O ponto mais delicado é o C03, e ele foi desenhado a partir de uma correção específica: comparar
 * âncoras com a contagem PÓS-dedup transformaria uma dedup CORRETA em alarme permanente.
 */

import { describe, it, expect } from "vitest";
import {
  checarAncorasItens,
  checarCardinalidadeVotos,
  checarCoerenciaUnanimidade,
  checarVotoQualidadeDuplo,
  checarInteressadoNoDispositivo,
  checarAdmissibilidadeMalClassificada,
  checarLigaduraResidual,
  checarImpedidoComVoto,
  temBloqueio,
  formatarAchados,
} from "@/lib/server/consistency-checks";
import { INFO_WARNING_RE } from "@/lib/server/upload-analysis";

describe("etapa63 · C03 — reconciliação de âncoras", () => {
  it("a 81ª, com duplicata legítima, NÃO bloqueia", () => {
    // 70 âncoras, 70 itens pré-dedup, 2 duplicatas removidas → 68 itens finais. A diferença entre
    // âncoras e itens FINAIS é permanente e correta; comparar contra ela exigiria override em toda
    // reingestão, e alarme que sempre dispara é alarme que ninguém lê.
    const achados = checarAncorasItens({ ancoras: 70, itens_pre_dedup: 70, duplicatas_removidas: 2 });
    expect(temBloqueio(achados)).toBe(false);
    expect(achados.map((a) => a.codigo)).toEqual(["C04_DUPLICATA_INTRA_ATA"]);
    expect(achados[0].nivel).toBe("info");
  });

  it("itens EXCEDENDO âncoras bloqueia — segmentação quebrada", () => {
    const achados = checarAncorasItens({ ancoras: 30, itens_pre_dedup: 44, duplicatas_removidas: 0 });
    expect(temBloqueio(achados)).toBe(true);
    expect(achados[0].codigo).toBe("C03_ITENS_EXCEDEM_ANCORAS");
  });

  it("itens PERDIDOS (o caso «44 âncoras, 30 itens») bloqueia", () => {
    const achados = checarAncorasItens({ ancoras: 44, itens_pre_dedup: 30, duplicatas_removidas: 0 });
    expect(temBloqueio(achados)).toBe(true);
    expect(achados[0].codigo).toBe("C03_ITENS_PERDIDOS");
  });

  it("diferença de até 2 é tolerada — prosa e cabeçalho geram âncora sem item", () => {
    expect(temBloqueio(checarAncorasItens({ ancoras: 32, itens_pre_dedup: 30, duplicatas_removidas: 0 }))).toBe(false);
  });

  it("duplicata removida é SEMPRE registrada, nunca silenciosa", () => {
    const achados = checarAncorasItens({ ancoras: 35, itens_pre_dedup: 35, duplicatas_removidas: 1 });
    expect(achados.some((a) => a.codigo === "C04_DUPLICATA_INTRA_ATA")).toBe(true);
  });
});

describe("etapa63 · cardinalidade e coerência", () => {
  it("mais votos que cadeiras bloqueia", () => {
    const a = checarCardinalidadeVotos({ votos: 7, cadeiras: 5, decidido: true, item: "1.2.1" });
    expect(temBloqueio(a)).toBe(true);
    expect(a[0].mensagem).toMatch(/diretor errado ou item duplicado/);
  });

  it("colegiado desconhecido não inventa bloqueio", () => {
    expect(temBloqueio(checarCardinalidadeVotos({ votos: 9, cadeiras: null, decidido: true }))).toBe(false);
  });

  it("item decidido sem voto AVISA, não bloqueia — é o normal de quem não nomina voto", () => {
    const a = checarCardinalidadeVotos({ votos: 0, cadeiras: 5, decidido: true });
    expect(temBloqueio(a)).toBe(false);
    expect(a[0].nivel).toBe("aviso");
  });

  it("unanimidade declarada COM voto contrário bloqueia", () => {
    expect(temBloqueio(checarCoerenciaUnanimidade({ unanimidade: true, votosContra: 1, votosAbstencao: 0 }))).toBe(true);
    expect(temBloqueio(checarCoerenciaUnanimidade({ unanimidade: true, votosContra: 0, votosAbstencao: 2 }))).toBe(true);
  });

  it("unanimidade sem dissenso passa", () => {
    expect(checarCoerenciaUnanimidade({ unanimidade: true, votosContra: 0, votosAbstencao: 0 })).toEqual([]);
  });

  it("voto de qualidade não pode virar segundo voto do mesmo diretor", () => {
    const a = checarVotoQualidadeDuplo({
      votoQualidadePor: "Mauro Henrique Moreira Sousa",
      diretoresComVoto: ["Mauro Henrique Moreira Sousa", "Mauro Henrique Moreira Sousa", "Roger Romão Cabral"],
    });
    expect(temBloqueio(a)).toBe(true);
  });

  it("voto de qualidade contado UMA vez passa — quem desempata vota mesmo", () => {
    expect(checarVotoQualidadeDuplo({
      votoQualidadePor: "Mauro Henrique Moreira Sousa",
      diretoresComVoto: ["Mauro Henrique Moreira Sousa", "Roger Romão Cabral"],
    })).toEqual([]);
  });
});

describe("etapa63 · C16 — impedido com voto", () => {
  it("impedido que aparece votando bloqueia", () => {
    const a = checarImpedidoComVoto({
      impedidos: ["José Fernando de Mendonça Gomes Júnior"],
      diretoresQueVotaram: ["José Fernando de Mendonça Gomes Júnior", "Mauro Henrique Moreira Sousa"],
    });
    expect(temBloqueio(a)).toBe(true);
    expect(a[0].mensagem).toMatch(/não havia impedimento|fabricado/);
  });

  it("impedido SEM voto é o estado correto", () => {
    expect(checarImpedidoComVoto({
      impedidos: ["José Fernando de Mendonça Gomes Júnior"],
      diretoresQueVotaram: ["Mauro Henrique Moreira Sousa"],
    })).toEqual([]);
  });
});

describe("etapa63 · checagens de conteúdo", () => {
  it("C09 avisa (não bloqueia) o copy-paste da FONTE — 83ª/3.10.1", () => {
    // É defeito do documento oficial. Bloquear obrigaria override em todo erro de digitação da
    // própria agência — e o operador aprenderia a dar override sem ler.
    const a = checarInteressadoNoDispositivo({
      interessado: "Companhia Brasileira de Alumínio",
      dispositivo: "Defiro o pleito da empresa Vale Fosfatados S.A., nos termos do voto.",
    });
    expect(a[0]?.nivel).toBe("aviso");
  });

  it("C09 fica quieto quando o dispositivo não nomeia empresa nenhuma", () => {
    expect(checarInteressadoNoDispositivo({
      interessado: "Companhia Brasileira de Alumínio",
      dispositivo: "Diante do exposto, voto por dar provimento ao recurso.",
    })).toEqual([]);
  });

  it("C09 aceita o mesmo interessado escrito de forma diferente", () => {
    expect(checarInteressadoNoDispositivo({
      interessado: "Vale Fosfatados S.A.",
      dispositivo: "Defiro o pleito da Vale Fosfatados S.A. nos termos do voto.",
    })).toEqual([]);
  });

  it("C11 pega não-conhecimento gravado como Indeferido de mérito", () => {
    const a = checarAdmissibilidadeMalClassificada({
      juizo: null, resultado: "Indeferido",
      texto: "VOTO por NÃO CONHECER do recurso, por intempestividade.",
    });
    expect(a[0].codigo).toBe("C11_ADMISSIBILIDADE_COMO_MERITO");
  });

  it("C11 fica quieto quando o juízo já está correto", () => {
    expect(checarAdmissibilidadeMalClassificada({
      juizo: "admissibilidade", resultado: "Indeferido",
      texto: "VOTO por NÃO CONHECER do recurso.",
    })).toEqual([]);
  });

  it("C13 acusa ligadura residual — sinal de que a fonte do PDF mudou", () => {
    const a = checarLigaduraResidual(["substitu…", "participa…"]);
    expect(a[0].codigo).toBe("C13_LIGADURA_RESIDUAL");
    expect(checarLigaduraResidual([])).toEqual([]);
  });
});

describe("etapa63 · o guard que faz o bloqueio bloquear de verdade", () => {
  it("NENHUMA mensagem pode casar INFO_WARNING_RE", () => {
    // Se casar, o achado é classificado como informativo lá no upload-analysis e deixa de rebaixar
    // o status: um bloqueio que não bloqueia. É o tipo de defeito que só aparece em produção.
    const todos = [
      ...checarAncorasItens({ ancoras: 30, itens_pre_dedup: 44, duplicatas_removidas: 1 }),
      ...checarCardinalidadeVotos({ votos: 7, cadeiras: 5, decidido: true, item: "1.2.1" }),
      ...checarCardinalidadeVotos({ votos: 0, cadeiras: 5, decidido: true }),
      ...checarCoerenciaUnanimidade({ unanimidade: true, votosContra: 1, votosAbstencao: 1 }),
      ...checarVotoQualidadeDuplo({ votoQualidadePor: "X Y", diretoresComVoto: ["X Y", "X Y"] }),
      ...checarInteressadoNoDispositivo({ interessado: "Alfa Beta", dispositivo: "Defiro à Gama Delta Ltda." }),
      ...checarAdmissibilidadeMalClassificada({ juizo: null, resultado: "Indeferido", texto: "não conhecer" }),
      ...checarLigaduraResidual(["substitu…"]),
      ...checarImpedidoComVoto({ impedidos: ["X Y"], diretoresQueVotaram: ["X Y"] }),
    ];
    expect(todos.length).toBeGreaterThan(8);
    for (const a of todos) {
      expect(INFO_WARNING_RE.test(a.mensagem), `"${a.mensagem}" casa INFO_WARNING_RE`).toBe(false);
    }
  });

  it("o formato carrega nível e código — o revisor precisa saber POR QUE está bloqueado", () => {
    const linhas = formatarAchados(checarCoerenciaUnanimidade({ unanimidade: true, votosContra: 1, votosAbstencao: 0 }));
    expect(linhas[0]).toMatch(/^\[BLOQUEANTE·C07_UNANIMIDADE_COM_DISSENSO\]/);
  });

  it("sem achados não há bloqueio", () => {
    expect(temBloqueio([])).toBe(false);
  });
});
