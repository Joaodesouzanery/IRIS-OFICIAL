import { describe, it, expect } from "vitest";
import { inferResultado } from "@/lib/server/antt-manual-parser";

// PR-P (QA jul/2026): 147 votos ANTT presos em revisão, parte por "sem direção do voto" —
// inferResultado devolvia null para dispositivos direcionais comuns (desprover, rejeitar,
// acolher, prover, referendar, provimento parcial). Ampliamos a cobertura MANTENDO o
// princípio null-não-chuta: fórmula ambígua ("manter/reformar a decisão") continua null.
// Armadilha coberta: as formas NEGATIVAS ("não provido", "desprovido", "improvido",
// "não acolher") têm de sair como Indeferido ANTES do positivo "provido"/"acolher".

describe("inferResultado ANTT — dispositivos direcionais [PR-P]", () => {
  it("nega provimento em suas várias formas → Indeferido", () => {
    expect(inferResultado("Voto: nego provimento ao recurso.")).toBe("Indeferido");
    expect(inferResultado("Decido por negar provimento ao recurso interposto.")).toBe("Indeferido");
    expect(inferResultado("Recurso conhecido e desprovido.")).toBe("Indeferido");
    expect(inferResultado("Nos termos do voto, pelo desprovimento do recurso.")).toBe("Indeferido");
    expect(inferResultado("Recurso conhecido e improvido.")).toBe("Indeferido");
    expect(inferResultado("Conheço do recurso para, no mérito, negar-lhe provimento.")).not.toBe("Deferido");
  });

  it("'não provido' NÃO vira Deferido pela presença de 'provido' (negativo tem precedência)", () => {
    expect(inferResultado("Recurso não provido.")).toBe("Indeferido");
    expect(inferResultado("Voto pelo não provimento do recurso.")).toBe("Indeferido");
    expect(inferResultado("Conheço do recurso e a ele nego provimento.")).toBe("Indeferido");
  });

  it("rejeitar / reprovar → Indeferido", () => {
    expect(inferResultado("Voto por rejeitar os embargos de declaração.")).toBe("Indeferido");
    expect(inferResultado("A matéria foi rejeitada pela Diretoria.")).toBe("Indeferido");
    expect(inferResultado("Voto pela reprovação da prestação de contas.")).toBe("Indeferido");
  });

  it("não acolher → Indeferido; acolher → Deferido", () => {
    expect(inferResultado("Voto por não acolher a pretensão da recorrente.")).toBe("Indeferido");
    expect(inferResultado("Deixo de acolher o pedido de reconsideração.")).toBe("Indeferido");
    expect(inferResultado("Voto por acolher o pedido de revisão tarifária.")).toBe("Deferido");
    expect(inferResultado("Acolhimento integral do recurso administrativo.")).toBe("Deferido");
  });

  it("dar/prover provimento → Deferido", () => {
    expect(inferResultado("Conheço do recurso e dou provimento.")).toBe("Deferido");
    expect(inferResultado("Recurso conhecido e provido.")).toBe("Deferido");
    expect(inferResultado("Voto por prover o recurso interposto.")).toBe("Deferido");
  });

  it("provimento parcial → Parcialmente Deferido (não 'Deferido' cheio)", () => {
    expect(inferResultado("Dou parcial provimento ao recurso.")).toBe("Parcialmente Deferido");
    expect(inferResultado("Voto pelo deferimento parcial do pleito.")).toBe("Parcialmente Deferido");
    expect(inferResultado("Recurso julgado procedente em parte.")).toBe("Parcialmente Deferido");
    expect(inferResultado("Acolho parcialmente a impugnação apresentada.")).toBe("Parcialmente Deferido");
  });

  it("referendar → Ratificado (junto de homologar/ratificar)", () => {
    expect(inferResultado("Voto por referendar o ato do Diretor-Geral.")).toBe("Ratificado");
    expect(inferResultado("Referendo a decisão ad referendum.")).toBe("Ratificado");
    expect(inferResultado("Homologo o resultado da licitação.")).toBe("Ratificado");
  });

  it("RETIRADO tem precedência sobre indeferimento CITADO (QA ago/2026 — invertia p/ Indeferido)", () => {
    expect(inferResultado("Recurso contra a decisão que indeferiu o pedido. Item retirado de pauta a pedido do relator.")).toBe("Retirado de Pauta");
    expect(inferResultado("Sobrestado o processo que trata do indeferimento anterior.")).toBe("Retirado de Pauta");
    expect(inferResultado("Pediu vistas o Diretor, sobre a matéria indeferida em 1ª instância.")).toBe("Retirado de Pauta");
  });

  it("adjacência: 'pauta' e 'retirada' LONGE um do outro NÃO viram Retirado", () => {
    expect(inferResultado("Item da pauta ordinária. A concessionária pleiteou a retirada das obrigações acessórias. Voto pelo indeferimento.")).toBe("Indeferido");
  });

  it("null-não-chuta preservado: dispositivo ambíguo/sem verbo → null (vai para revisão)", () => {
    expect(inferResultado("Voto por manter a decisão recorrida.")).toBeNull();
    expect(inferResultado("Proponho a reforma da decisão de primeira instância.")).toBeNull();
    expect(inferResultado("O Diretor apresentou seu relatório sobre o tema.")).toBeNull();
    expect(inferResultado("")).toBeNull();
  });
});
