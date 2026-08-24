/**
 * Etapa 52 — `DELIBERAÇÃO:` é a âncora das atas ANM, e é ela que diz qual voto PREVALECEU.
 *
 * Dois fatos medidos no corpus:
 *
 *  1. `Decisão:` aparece ZERO vezes nas duas atas ANM; `DELIBERAÇÃO:` aparece 28 e 43 vezes.
 *     Conhecendo só `Decisão:`, `item.decisao` saía null em 100% dos 89 itens e o resultado era
 *     inferido do rawText INTEIRO — que carrega relatório, sustentação oral e prosa do vizinho.
 *
 *  2. Ancorar não basta: a linha de deliberação usa o verbo PROCESSUAL ("voto do revisor aprovado
 *     por maioria"), que não diz o desfecho. O desfecho está no corpo do voto VENCEDOR — e quando
 *     o relator é vencido, ler o voto dele INVERTE o resultado.
 *
 * O `ata-resultado-baseline.json` congela o mapa {item → resultado} das duas atas: as etapas 53 e
 * 54 mexem neste mesmo código, e sem a caracterização uma regressão passaria despercebida.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import { splitAtaItems, pickVotoPrevalecente, type AtaItem } from "@/lib/server/ata-splitter";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");
type BaselineAta = {
  itens_pre_dedup: number;
  duplicatas_removidas: number;
  itens: Array<{ item_numero: string; processo: string | null; resultado: string | null; tem_decisao: boolean }>;
};
const baseline = JSON.parse(
  readFileSync(join(fixturesDir, "ata-resultado-baseline.json"), "utf8"),
) as Record<string, BaselineAta>;

const ATAS = ["anm-ata-82-ordinaria.pdf", "anm-ata-32-extraordinaria.pdf"] as const;
const itens: Record<string, AtaItem[]> = {};

beforeAll(async () => {
  for (const f of ATAS) {
    itens[f] = splitAtaItems((await extractPdfText(readFileSync(join(fixturesDir, f)))).text);
  }
}, 120_000);

describe("etapa52 · caracterização travada (guard das etapas 53/54)", () => {
  it.each(ATAS)("%s bate item a item com o baseline medido", (f) => {
    const atual = itens[f].map((it) => ({
      item_numero: it.item_numero,
      processo: it.processo,
      resultado: it.resultado,
      tem_decisao: Boolean(it.decisao),
    }));
    expect(atual).toEqual(baseline[f].itens);
  });

  it("`DELIBERAÇÃO:` deixou de ser invisível — cada âncora virou uma decisão", () => {
    // Medido: 43 âncoras na 32ª e 43 decisões; na 82ª, 28 âncoras e 27 decisões — a diferença é
    // exatamente a duplicata 4.1.6 removida pela dedup da etapa53.
    expect(itens["anm-ata-82-ordinaria.pdf"].filter((i) => i.decisao).length).toBe(27);
    expect(itens["anm-ata-32-extraordinaria.pdf"].filter((i) => i.decisao).length).toBe(43);
  });
});

describe("etapa52 · o voto que PREVALECEU decide o resultado", () => {
  const RELATOR_NEGA =
    "VOTO DO RELATOR (Diretor-Geral): Diante do exposto e acompanhando a manifestação técnica, " +
    "VOTO por: i) Conhecer e, no mérito, NEGAR PROVIMENTO ao recurso.\n";
  const REVISOR_DA =
    "VOTO DO REVISOR (Diretor Roger Romão Cabral): Diante do exposto, voto por acompanhar o " +
    "Diretor Relator para conhecer dos recursos e, no mérito, divirjo do Diretor Relator, para " +
    "dar provimento aos recursos.\n";

  it("relator vencido → o resultado sai do voto do REVISOR (32ª/4.4.1)", () => {
    const corpo = pickVotoPrevalecente(
      RELATOR_NEGA + REVISOR_DA,
      "Voto do revisor aprovado por maioria pelos diretores presentes, com voto contrário do " +
        "Diretor-Geral, relator original da matéria.",
    );
    expect(corpo).toMatch(/dar provimento/i);
    expect(corpo).not.toMatch(/NEGAR PROVIMENTO/);
  });

  it("sem menção a revisor na deliberação → vale o voto do RELATOR", () => {
    const corpo = pickVotoPrevalecente(
      RELATOR_NEGA + REVISOR_DA,
      "Voto aprovado por unanimidade pelos diretores presentes.",
    );
    expect(corpo).toMatch(/NEGAR PROVIMENTO/);
  });

  it("ordinal explícito manda: «Terceiro Revisor» não é o primeiro nem o último por acaso", () => {
    const texto =
      "VOTO DO RELATOR (Diretor A): voto por negar provimento.\n" +
      "VOTO DO PRIMEIRO REVISOR (Diretor B): voto por acompanhar o Voto GG/ANM nº 826.\n" +
      "VOTO DO TERCEIRO REVISOR (Diretor C): voto por dar provimento ao recurso.\n" +
      "VOTO DO QUARTO REVISOR (Diretor D): voto por indeferir.\n";
    const corpo = pickVotoPrevalecente(
      texto,
      "Voto do Terceiro Revisor, Diretor C, aprovado por unanimidade pelos diretores presentes.",
    );
    expect(corpo).toMatch(/dar provimento/i);
    expect(corpo).not.toMatch(/indeferir/i);
  });

  it("documento sem blocos por papel (ARTESP/ANTT) devolve null e não muda nada", () => {
    expect(pickVotoPrevalecente("Fica RATIFICADA toda a instrução processual.", null)).toBeNull();
  });
});

describe("etapa52 · as duas correções de desfecho, verificadas contra o PDF", () => {
  // Ambas eram "Indeferido" e ambas estavam ERRADAS: em cada uma, o voto que prevaleceu deu
  // provimento ao recurso. O antigo lia o voto do relator VENCIDO.
  it.each([
    ["4.4.1", "revisor venceu o relator, que havia votado NEGAR PROVIMENTO"],
    ["4.3.1", "Terceiro Revisor acompanhou o Relator para DAR PROVIMENTO, por unanimidade"],
  ])("32ª/%s agora é Deferido (%s)", (numero) => {
    const item = itens["anm-ata-32-extraordinaria.pdf"].find((i) => i.item_numero === numero);
    expect(item?.resultado).toBe("Deferido");
  });

  it("32ª/1.2.1 continua Indeferido — o revisor que venceu votou NEGAR PROVIMENTO", () => {
    // Guard da meia-correção: ancorar sem escolher o voto vencedor levava este item a "Aprovado",
    // trocando o desfecho pelo verbo processual da linha de deliberação.
    const item = itens["anm-ata-32-extraordinaria.pdf"].find((i) => i.item_numero === "1.2.1");
    expect(item?.resultado).toBe("Indeferido");
  });
});
