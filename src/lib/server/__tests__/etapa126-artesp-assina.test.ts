/**
 * Etapa 126 (Fase 21, commit 4) — a ARTESP passa a ter a camada 2 do guard de roster.
 *
 * ═══ O que a medição disse, contra o que o relatório dizia ═══
 * O relatório da exploração afirmava duas coisas sobre o risco de roster fora da ANM:
 *  (a) a 264ª RDE da ANTT perdia `nomes_presentes` por ligadura ("par,cipação");
 *  (b) a ARTESP tinha `signatarios = []` porque o bloco SEI era removido antes da extração.
 * Rodei o extrator real nas fixtures ANTES de mexer:
 *  (a) é FALSO — a 264ª devolve os 5 nomes; a ligadura só aparece na cauda. Nada a consertar.
 *  (b) o SINTOMA é verdadeiro e a CAUSA é outra: o padrão Title-Case exigia `[a-z\s]+` depois da
 *      inicial, e a segunda palavra de qualquer nome ("Isper", "Albert") começa em maiúscula. O
 *      padrão estava morto desde que nasceu; o bloco Title-Case vem ANTES do SEI.
 * Medir antes de generalizar, de novo — desta vez contra o meu próprio plano aprovado.
 *
 * ═══ Por que importa ═══
 * `conferirRoster` tem três camadas: presença → assinatura → candidatos pendentes. Sem
 * assinatura, uma ata da ARTESP que não nomeie no preâmbulo cai direto na camada 3 sem
 * checagem cruzada. Com isto, os quatro documentos reais passam a assinar.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import { extractFields } from "@/lib/server/nlp-extractor";

const FIXTURES = join(__dirname, "fixtures/votos");
const ARTESP = ["artesp-ata-1201.pdf", "artesp-delib-22.pdf", "artesp-delib-23.pdf", "artesp-delib-487.pdf"];
const DIRETORES = ["André Isper Rodrigues Barnabé", "Diego Albert Zanatto", "Fernanda Esbízaro Rodrigues Rudnik", "Raquel França Carneiro"];

describe("etapa126 · nos quatro documentos REAIS da ARTESP, o rodapé Title-Case assina", () => {
  it.each(ARTESP)("%s → os quatro diretores em `signatarios` (era [] em todos)", async (f) => {
    const { text } = await extractPdfText(readFileSync(join(FIXTURES, f)));
    const { signatarios } = extractFields(text) as { signatarios: string[] };
    for (const nome of DIRETORES) expect(signatarios, f).toContain(nome);
    // E só eles: o bloco SEI (que repete os nomes) continua removido; "Chefe da Secretaria" não
    // é cargo de assinatura; nada institucional entra.
    expect(signatarios.length).toBe(DIRETORES.length);
  }, 30_000);

  it("a 264ª RDE da ANTT continua com os 5 presentes — o item (a) do relatório era falso e fica registrado", async () => {
    const { text } = await extractPdfText(readFileSync(join(FIXTURES, "antt-ata-264-rde.pdf")));
    const { nomes_presentes } = extractFields(text) as { nomes_presentes: string[] };
    expect(nomes_presentes).toHaveLength(5);
    expect(nomes_presentes).toContain("Severino Medeiros Ramos Neto");
  }, 30_000);

  it("o padrão não engole cargo que não assina nem palavra institucional", () => {
    const { signatarios } = extractFields(
      "Fulano de Tal\nChefe da Secretaria-Geral\n \nConselho Diretor\nPresidente\n \nMaria da Silva Souza\nDiretora\n",
    ) as { signatarios: string[] };
    expect(signatarios).toEqual(["Maria da Silva Souza"]);
  });
});
