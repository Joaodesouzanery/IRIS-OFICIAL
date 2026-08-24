/**
 * Etapa 49 — NORMALIZAÇÃO DE TEXTO é fundação, não correção.
 *
 * Roda sobre os PDFs binários reais: rodapé SEI, de-hifenização e ligadura mudam o texto sobre o
 * qual TODAS as regex das etapas seguintes casam. Calibrar regex antes de normalizar obriga a
 * recalibrar tudo depois — por isso esta etapa vem primeiro e é travada aqui.
 *
 * Os números deste arquivo foram MEDIDOS no corpus, não estimados.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  extractPdfText,
  probeLigatureDefects,
  flattenForMatch,
  type PdfExtractionResult,
} from "@/lib/server/pdf-extractor";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures/votos");

const docs: Record<string, PdfExtractionResult> = {};
const FIXTURES = [
  "anm-ata-82-ordinaria.pdf",
  "anm-ata-32-extraordinaria.pdf",
  "antt-pauta-1036.pdf",
  "artesp-delib-487.pdf",
] as const;

beforeAll(async () => {
  for (const f of FIXTURES) {
    docs[f] = await extractPdfText(readFileSync(join(fixturesDir, f)));
  }
}, 120_000);

describe("etapa49 · rodapé SEI removido do meio do fluxo", () => {
  // Medido no texto CRU do pdf-parse: 12 linhas na 82ª, 19 na 32ª, 2 na pauta ANTT, 0 na ARTESP.
  // O rodapé escapa do dedup por frequência porque a paginação muda a cada ocorrência.
  it.each([
    ["anm-ata-82-ordinaria.pdf", 12],
    ["anm-ata-32-extraordinaria.pdf", 19],
    ["antt-pauta-1036.pdf", 2],
  ])("%s tinha %i rodapés e agora tem zero", (file) => {
    const linhas = docs[file].text.split("\n").filter((l) => /\bpg\.\s*\d+/i.test(l));
    expect(linhas).toEqual([]);
    expect(docs[file].text).not.toMatch(/SEI\s+[\d.]+\/\d{4}-\d{2}\s*\/\s*pg\./);
  });

  it("remove o rodapé SEM comer o conteúdo decisório vizinho", () => {
    // O rodapé era injetado ENTRE frases do item; a remoção não pode levar a frase junto.
    const t = docs["anm-ata-82-ordinaria.pdf"].text;
    expect(t).toContain("DELIBERAÇÃO:");
    expect(t).toContain("unanimidade");
    expect(t.length).toBeGreaterThan(20_000);
  });

  it("ARTESP não tem esse rodapé e sai intacta", () => {
    const t = docs["artesp-delib-487.pdf"].text;
    expect(t).toContain("Fica RATIFICADA toda a instrução processual");
    expect(t).toContain("Houve aprovação dos presentes por unanimidade de votos");
  });
});

describe("etapa49 · de-hifenização preserva o hífen na continuação MAIÚSCULA", () => {
  it("siglas compostas sobrevivem (colar sem hífen destruiria todas)", () => {
    // Medido: 100% dos casos de hífen+quebra+maiúscula no corpus são siglas ou compostos.
    const t32 = docs["anm-ata-32-extraordinaria.pdf"].text;
    expect(t32).toContain("SDM-JA");
    expect(t32).toContain("PFE-ANM");
    expect(t32).not.toMatch(/SDM-\n/);
    expect(t32).not.toContain("SDMJA");
    expect(t32).not.toContain("PFEANM");

    const tArtesp = docs["artesp-delib-487.pdf"].text;
    expect(tArtesp).toContain("IP-BIM");
    expect(tArtesp).not.toContain("IPBIM");
  });

  it("continuação MINÚSCULA continua colando sem hífen (comportamento antigo preservado)", () => {
    // Nenhuma quebra hífen+minúscula pode sobrar: essa sim é hifenização tipográfica.
    for (const f of FIXTURES) {
      expect(docs[f].text).not.toMatch(/[A-Za-zÀ-ÿ]-\n[a-zà-ÿ]/);
    }
  });
});

describe("etapa49 · ligadura 'ti'", () => {
  it("as 8 ocorrências da pauta ANTT são reparadas (o substituto medido é '7')", () => {
    const t = docs["antt-pauta-1036.pdf"].text;
    expect(t).toContain("Instituição");
    expect(t).toContain("Política");
    expect(t).toContain("objetivo");
    expect(t).toContain("administrativo");
    expect(t).toContain("coletivo");
    // Nenhum "7" resta entre minúsculas — ali ele nunca é dígito legítimo.
    expect(t).not.toMatch(/[a-zà-ú]7[a-zà-ú]/);
  });

  it("o probe fica LIMPO nos três órgãos — e é esse zero que torna uma troca de fonte detectável", () => {
    for (const f of FIXTURES) {
      expect(probeLigatureDefects(docs[f].text).lemasQuebrados).toEqual([]);
      expect(docs[f].ligatureWarning).toBeUndefined();
    }
  });

  it("o probe ACUSA quando a fonte muda e o conserto deixa de valer", () => {
    // Cenário real da 1.024ª da ANTT em outro extrator: o substituto vira "%" e o parser perde
    // o cargo exercido, o roster e a retirada de pauta — hoje, em silêncio.
    const quebrado = probeLigatureDefects(
      "apresentada na condição de Diretor-Geral subs%tuto, com a par%cipação do Diretor-Geral " +
        "e o processo re%rado da Reunião pelo Relator."
    );
    expect(quebrado.lemasQuebrados).toContain("substitu…");
    expect(quebrado.lemasQuebrados).toContain("participa…");
    expect(quebrado.lemasQuebrados).toContain("retirad…");
    expect(quebrado.ocorrencias).toBe(3);
  });

  it("o probe NÃO acusa em URL e código SEI (o ruído que convive com o defeito)", () => {
    // Esses caracteres entre minúsculas existem legitimamente em todo rodapé do SEI.
    const limpo = probeLigatureDefects(
      "http://sei.antt.gov.br/sei/controlador_externo.php?acao=documento_conferir" +
        "&id_orgao_acesso_externo=0 informando o código verificador 43562478. " +
        "O processo foi retirado de pauta e a participação do substituto foi registrada."
    );
    expect(limpo.lemasQuebrados).toEqual([]);
    expect(limpo.ocorrencias).toBe(0);
  });
});

describe("etapa49 · flattenForMatch", () => {
  it("colapsa a quebra DENTRO da frase-gatilho — é o que salva 4 dos 7 impedimentos da 83ª", () => {
    const comQuebra =
      "Esclareceu, ainda, que o Diretor José Fernando de Mendonça\nGomes Júnior encontrava-se\nimpedido de votar, em razão de manifestação anterior.";
    expect(comQuebra).not.toMatch(/encontrava-se impedido de votar/);
    expect(flattenForMatch(comQuebra)).toMatch(/encontrava-se impedido de votar/);
  });

  it("é idempotente e não inventa nem come caractere", () => {
    const t = "  a\n\n b \t c  ";
    expect(flattenForMatch(t)).toBe(" a b c ");
    expect(flattenForMatch(flattenForMatch(t))).toBe(flattenForMatch(t));
  });

  it("destruiria as âncoras do splitter — por isso é só para janela de item", () => {
    // Guard executável do comentário: depois de achatar, `^` multiline não acha mais o item.
    const bloco = "1.1.1 PROCESSO Nº: 48062.972163/2021-21\nDELIBERAÇÃO: Voto aprovado.";
    expect(bloco).toMatch(/^DELIBERAÇÃO:/m);
    expect(flattenForMatch(bloco)).not.toMatch(/^DELIBERAÇÃO:/m);
  });
});
