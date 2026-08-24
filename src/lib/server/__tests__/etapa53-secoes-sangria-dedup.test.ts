/**
 * Etapa 53 — Seções, gate de suspensão e dedup intra-ata.
 *
 * Três defeitos de SEGMENTAÇÃO, todos medidos nas duas atas ANM:
 *
 *  1. O gate de suspensão tinha precedência GLOBAL: bastava a palavra "pedido de vista" em
 *     qualquer ponto do item para ele virar "Retirado de Pauta". A 82ª/2.3.1 diz
 *     "DELIBERAÇÃO: Voto do Relator … aprovado por unanimidade" e, no parágrafo seguinte, RELATA
 *     que houve pedido de vista NA SESSÃO ANTERIOR. Um item decidido — com todos os seus votos —
 *     era enterrado por um fato do passado.
 *
 *  2. O item só fechava quando o próximo abria, então o último item de cada seção absorvia a
 *     prosa de transição: 12 itens nas duas atas. O pior não é o ruído — os cabeçalhos
 *     "N. DIRETOR NOME" são o RELATOR da seção SEGUINTE, e esse nome dentro do item anterior
 *     atribui voto ao diretor errado.
 *
 *  3. A 82ª repete o item 4.1.6 (mesmo processo) duas vezes. Sem dedup o processo entra duplicado,
 *     o colegiado aparece decidindo duas vezes a mesma matéria e todo denominador infla.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import { splitAtaItemsWithStats, dedupeIntraAta, type AtaItem } from "@/lib/server/ata-splitter";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");
const ATAS = ["anm-ata-82-ordinaria.pdf", "anm-ata-32-extraordinaria.pdf"] as const;
const split: Record<string, ReturnType<typeof splitAtaItemsWithStats>> = {};

beforeAll(async () => {
  for (const f of ATAS) {
    split[f] = splitAtaItemsWithStats((await extractPdfText(readFileSync(join(fixturesDir, f)))).text);
  }
}, 120_000);

const item = (arg: Partial<AtaItem>): AtaItem => ({
  item_numero: "1.1.1",
  processo: "48405.950567/2016-78",
  assunto: null,
  interessado: null,
  relator: null,
  decisao: null,
  resultado: null,
  unanimidade: false,
  raw_text: "",
  ...arg,
});

describe("etapa53 · o passado não sobrescreve o dispositivo", () => {
  it("82ª/2.3.1 era «Retirado de Pauta» e é «Aprovado por Unanimidade»", () => {
    // A ÚNICA mudança de resultado desta etapa em 88 itens — e é uma correção.
    const alvo = split["anm-ata-82-ordinaria.pdf"].items.find((i) => i.item_numero === "2.3.1");
    expect(alvo?.resultado).toBe("Aprovado por Unanimidade");
    // O relato do pedido de vista continua no texto: o que mudou foi a leitura, não o documento.
    expect(alvo?.raw_text).toMatch(/pedido vista na ocasião/);
  });

  it("suspensão DENTRO do dispositivo continua valendo — o gate não foi desligado", () => {
    // 26 itens da 32ª são "Retirado de Pauta" por dizerem, no próprio dispositivo,
    // "DELIBERAÇÃO: deliberação sobrestada pelo pedido de vistas".
    const retirados = split["anm-ata-32-extraordinaria.pdf"].items.filter(
      (i) => i.resultado === "Retirado de Pauta",
    );
    expect(retirados.length).toBe(26);
  });

  it("«sobrestado … aprovado o pedido de vista» NÃO escapa pelo verbo «aprovado»", () => {
    // Guard da meia-correção: exigir só o verbo conclusivo deixaria este caso passar.
    const s = dedupeIntraAta([]);
    expect(s.items).toEqual([]); // sanity do helper
    const { items } = splitAtaItemsWithStats(
      "1.1.1. Processo nº: 48405.950567/2016-78\nInteressado: Empresa X\n" +
      "DELIBERAÇÃO: deliberação sobrestada, aprovado o pedido de vista do Diretor Y.\n",
    );
    expect(items[0]?.resultado).toBe("Retirado de Pauta");
  });
});

describe("etapa53 · fronteira de seção fecha o item", () => {
  it.each(ATAS)("%s: nenhum item carrega cabeçalho de seção", (f) => {
    const RE = /^(?:MAT[ÉE]RIAS?\b|APROVA[ÇC][ÃA]O\s+D[AE]\s+ATAS?\b|ENCERRAMENTO\b|\d+\.\s*DIRETOR)/i;
    for (const it of split[f].items) {
      const linhas = it.raw_text.split("\n").map((l) => l.trim());
      expect(linhas.slice(1).filter((l) => RE.test(l))).toEqual([]);
    }
  });

  it("o nome do relator da seção seguinte não entra no item anterior", () => {
    // 82ª/1.2.1 absorvia "3. DIRETOR FÁBIO FERNANDO BORGES", que relata a seção SEGUINTE.
    const alvo = split["anm-ata-82-ordinaria.pdf"].items.find((i) => i.item_numero === "1.2.1");
    expect(alvo?.raw_text).not.toMatch(/FÁBIO FERNANDO BORGES/);
  });

  it("fechar a seção não descarta item: as contagens seguem 34 e 54", () => {
    expect(split["anm-ata-82-ordinaria.pdf"].items.length).toBe(34);
    expect(split["anm-ata-32-extraordinaria.pdf"].items.length).toBe(54);
  });
});

describe("etapa53 · dedup intra-ata", () => {
  it("a 82ª tinha o 4.1.6 duas vezes e passa a ter uma — a COMPLETA", () => {
    const s = split["anm-ata-82-ordinaria.pdf"];
    expect(s.itens_pre_dedup).toBe(35);
    expect(s.duplicatas_removidas).toBe(1);
    const q = s.items.filter((i) => i.item_numero === "4.1.6");
    expect(q).toHaveLength(1);
    // Vence a ocorrência com dispositivo (2.148 caracteres), não a truncada (979).
    expect(q[0].resultado).toBe("Aprovado por Unanimidade");
    expect(q[0].raw_text.length).toBeGreaterThan(2000);
  });

  it("a 32ª não tem duplicata e sai intacta — dedup não pode inventar fusão", () => {
    expect(split["anm-ata-32-extraordinaria.pdf"].duplicatas_removidas).toBe(0);
    expect(split["anm-ata-32-extraordinaria.pdf"].itens_pre_dedup).toBe(54);
  });

  it("vence quem TEM dispositivo, mesmo sendo o texto mais curto", () => {
    const s = dedupeIntraAta([
      item({ raw_text: "x".repeat(5000), decisao: null }),
      item({ raw_text: "curto", decisao: "DELIBERAÇÃO: aprovado por unanimidade." }),
    ]);
    expect(s.items).toHaveLength(1);
    expect(s.items[0].decisao).toMatch(/aprovado/);
    expect(s.duplicatas_removidas).toBe(1);
  });

  it("MESMO número e processos DIFERENTES são matérias distintas — não funde", () => {
    const s = dedupeIntraAta([
      item({ processo: "48405.111111/2020-11" }),
      item({ processo: "48405.222222/2020-22" }),
    ]);
    expect(s.items).toHaveLength(2);
    expect(s.duplicatas_removidas).toBe(0);
  });

  it("item SEM processo nunca é deduplicado — não há identidade suficiente", () => {
    // Numeração reiniciada por seção produziria fusão de matérias distintas, apagando decisão real.
    const s = dedupeIntraAta([item({ processo: null }), item({ processo: null })]);
    expect(s.items).toHaveLength(2);
    expect(s.duplicatas_removidas).toBe(0);
  });

  it("itens_pre_dedup é o número que a reconciliação de âncoras compara (etapa63)", () => {
    // Comparar âncoras contra o PÓS-dedup faria de uma dedup CORRETA um alarme permanente.
    const s = split["anm-ata-82-ordinaria.pdf"];
    expect(s.itens_pre_dedup).toBe(s.items.length + s.duplicatas_removidas);
  });
});
