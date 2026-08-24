/**
 * Etapa 54 — Dispositivo: ritual, ementa e o TERCEIRO juízo.
 *
 * Quatro defeitos que, juntos, invertiam o desfecho de deliberações inteiras:
 *
 *  (a) A fórmula RITUAL da ARTESP — "Fica RATIFICADA toda a instrução processual e DETERMINADA a
 *      adoção das medidas pertinentes" — aparece em TODA deliberação, decida ela o que decidir, e
 *      entrava no escopo de resultado.
 *  (b) O escopo ignorava a EMENTA, que na deliberação ARTESP avulsa É o dispositivo: depois do
 *      "DELIBERA nos seguintes termos:" vem só o ritual.
 *  (c) `NEGA`/`IMPROVIDO` não existiam em RE_RESULTADO: um "NEGA-LHE provimento" não casava nada e
 *      caía no fallback de unanimidade, saindo POSITIVO.
 *  (e) `Ratificado`/`Determinado` estavam ACIMA de Deferido/Indeferido na prioridade.
 *
 *  (f) E o terceiro juízo: NÃO CONHECER é ADMISSIBILIDADE, não mérito.
 *
 * NOTA DE COBERTURA: `artesp-delib-22.pdf` e `artesp-delib-23.pdf` (os casos reais de regressão)
 * ainda não estão no repositório — dependem da Fase 0. Os trechos abaixo reproduzem a ESTRUTURA
 * medida na 487, que está no corpus; quando os PDFs chegarem, viram certificação binária.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import { extractFields, extractEmentaArtesp } from "@/lib/server/nlp-extractor";
import { detectJuizo } from "@/lib/server/regulatory-documents";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");

/** Estrutura REAL da deliberação ARTESP, medida na 487 (cabeçalho → ementa → ritual → unanimidade). */
function deliberacaoArtesp(ementa: string): string {
  return [
    "Governo do Estado de São Paulo",
    "Agência Reguladora de Serviços Públicos Delegados de Transporte do Estado de São Paulo",
    "",
    "DELIBERAÇÃO ARTESP Nº 22, DE 01 DE JULHO DE 2026",
    "",
    ementa,
    "",
    "O Diretor-Presidente da ARTESP, no uso de suas atribuições, e considerando os elementos que",
    "fundamentam a presente, DELIBERA nos seguintes termos: Fica RATIFICADA toda a instrução",
    "processual e DETERMINADA a adoção das medidas pertinentes. Houve aprovação dos presentes por",
    "unanimidade de votos. PUBLIQUE-SE.",
  ].join("\n");
}

describe("etapa54 · o ritual não é dispositivo", () => {
  it("INDEFERE na ementa vence o «Fica RATIFICADA … DETERMINADA» do ritual", () => {
    // O caso da artesp-delib-22: antes saía "Ratificado", porque o ritual entrava no escopo E
    // Ratificado tinha prioridade sobre Indeferido. As duas portas estão fechadas.
    const f = extractFields(
      deliberacaoArtesp("INDEFERE o pedido de reequilíbrio econômico-financeiro formulado pela concessionária."),
    );
    expect(f.resultado).toBe("Indeferido");
    expect(f.decisoes_todas).not.toContain("Ratificado");
    expect(f.decisoes_todas).not.toContain("Determinado");
  });

  it("mesmo COM o ritual no escopo, Ratificado não vence um desfecho de mérito", () => {
    // Guard da meia-correção: se só a remoção do ritual fosse feita e a prioridade ficasse,
    // qualquer outro "ratifica" do texto reabriria o problema.
    const f = extractFields(
      "Diante do exposto, a Diretoria RESOLVE: INDEFERIR o recurso e RATIFICAR os atos praticados.",
    );
    expect(f.resultado).toBe("Indeferido");
  });

  it("uma deliberação que SÓ ratifica continua sendo Ratificado", () => {
    const f = extractFields(deliberacaoArtesp("RATIFICA os atos praticados pela Superintendência."));
    expect(f.resultado).toBe("Ratificado");
  });

  it("o ritual sai do escopo de RESULTADO, nunca do texto do documento", () => {
    const doc = deliberacaoArtesp("APROVA a emissão da Portaria ARTESP nº 290.");
    expect(doc).toContain("Fica RATIFICADA toda a instrução");
    // O documento segue íntegro para raw_text/fundamento_decisao; só a classificação o ignora.
    expect(extractFields(doc).decisoes_todas).toEqual(["Aprovado"]);
  });
});

describe("etapa54 · ementa é o dispositivo da deliberação ARTESP", () => {
  it("a 487 real entrega a ementa, e o ritual some das decisões", async () => {
    // Medido: `decisoes_todas` era ["Aprovado","Ratificado","Determinado"] e passa a ["Aprovado"].
    const { text } = await extractPdfText(readFileSync(join(fixturesDir, "artesp-delib-487.pdf")));
    const ementa = extractEmentaArtesp(text);
    expect(ementa).toMatch(/^APROVA a emissão e a publicação da Portaria ARTESP/);
    const f = extractFields(text);
    expect(f.resultado).toBe("Aprovado");
    expect(f.decisoes_todas).toEqual(["Aprovado"]);
  }, 60_000);

  it("a ATA não é sequestrada pela ementa de uma deliberação CITADA no corpo", async () => {
    // Uma ata da ARTESP cita várias "Deliberação ARTESP nº". Sem limitar ao CABEÇALHO, o escopo de
    // resultado da ata virava a ementa de uma citação — medido: casava 1.100 caracteres do corpo.
    const { text } = await extractPdfText(readFileSync(join(fixturesDir, "artesp-ata-1201.pdf")));
    expect(extractEmentaArtesp(text)).toBeNull();
    expect(extractFields(text).resultado).toBe("Aprovado");
  }, 60_000);

  it("pauta não tem dispositivo e continua sem resultado", async () => {
    const { text } = await extractPdfText(readFileSync(join(fixturesDir, "artesp-pauta-1201.pdf")));
    expect(extractEmentaArtesp(text)).toBeNull();
    expect(extractFields(text).resultado).toBeNull();
  }, 60_000);
});

describe("etapa54 · direção negativa não vira positiva pelo fallback de unanimidade", () => {
  it("«NEGA-LHE provimento», aprovado por unanimidade, é INDEFERIDO", () => {
    const f = extractFields(
      deliberacaoArtesp("CONHECE do recurso interposto e NEGA-LHE provimento, mantendo a decisão recorrida."),
    );
    expect(f.resultado).toBe("Indeferido");
  });

  it("«recurso IMPROVIDO» não é lido como provimento", () => {
    expect(extractFields("Diante do exposto, RESOLVE: recurso conhecido e IMPROVIDO.").resultado)
      .toBe("Indeferido");
  });

  it("«PROVIDO» segue positivo — a correção do improvido não pode derrubar o provido", () => {
    expect(extractFields("Diante do exposto, RESOLVE: recurso conhecido e PROVIDO.").resultado)
      .toBe("Deferido");
  });

  it("CONHECER isolado é pré-requisito, nunca desfecho", () => {
    // Sem verbo de mérito e com direção só de admissibilidade, o item vai para revisão.
    expect(extractFields("Diante do exposto, RESOLVE: CONHECER do recurso.").resultado).toBeNull();
  });

  it("unanimidade sem direção negativa continua aprovando — o fallback não foi desligado", () => {
    expect(extractFields("A matéria foi acolhida por unanimidade de votos dos presentes.").resultado)
      .toBe("Aprovado por Unanimidade");
  });
});

describe("etapa54 · não-conhecimento é ADMISSIBILIDADE, não mérito", () => {
  it.each([
    "voto por não conhecer do recurso, por intempestivo.",
    "Diante do exposto, VOTO pelo NÃO CONHECIMENTO do recurso, por intempestividade.",
    "Decide-se por não se conhecer do pedido, ante a ausência de legitimidade.",
  ])("«%s» → admissibilidade", (trecho) => {
    expect(detectJuizo(trecho)).toBe("admissibilidade");
  });

  it("quando o MESMO dispositivo julga o mérito, o mérito prevalece", () => {
    // "não conhecer E, no mérito, negar provimento" é decisão de mérito — não pode sair da conta.
    expect(detectJuizo("voto por não conhecer o recurso e, no mérito, negar provimento.")).toBeNull();
    expect(
      extractFields("Diante do exposto, RESOLVE: não conhecer e, no mérito, NEGAR provimento.").resultado,
    ).toBe("Indeferido");
  });

  it("mérito comum não é marcado como admissibilidade", () => {
    expect(detectJuizo("Conheço do recurso e a ele nego provimento.")).toBeNull();
    expect(detectJuizo("VOTO pelo deferimento do pleito.")).toBeNull();
  });

  it("o campo `juizo` chega ao consumidor", () => {
    const f = extractFields("Diante do exposto, RESOLVE: NÃO CONHECER do recurso, por intempestividade.");
    expect(f.juizo).toBe("admissibilidade");
    // E o resultado NÃO é "Indeferido": a taxa de deferimento pararia de medir jurisprudência.
    expect(f.resultado).not.toBe("Indeferido");
  });
});
