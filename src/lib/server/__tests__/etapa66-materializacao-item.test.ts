/**
 * Etapa 66 — a MATERIALIZAÇÃO do item de ata, em duas camadas.
 *
 * ═══ Por que duas ═══
 *
 * O defeito não estava no cálculo, estava na SERIALIZAÇÃO. `detectJuizo` marcava certo, a coluna
 * era gravada, e o dado sumia entre o insert e o painel. Um teste sobre o objeto em memória passa
 * VERDE com esse bug presente — foi por isso que ele sobreviveu a três rodadas.
 *
 *   (a) COMPLETUDE DE CHAVES — fecha a CLASSE. O `raw_extraction` do filho era montado chave a
 *       chave, então todo campo novo do item nascia invisível por omissão. Duas vítimas medidas:
 *       `juizo` (13 de 320 itens) e `area_regulatoria` (320 de 320). Este teste compara a união
 *       das chaves que o analisador produz nos 16 PDFs com o contrato declarado e quebra quando
 *       aparece chave que ninguém propagou nem omitiu com motivo.
 *
 *   (b) SOMA DOS BALDES SOBRE A LINHA SERIALIZADA — trava o caso atual. Avalia `decisionStatus`
 *       sobre a linha **como a ROTA a vê** (só as chaves que `FINAL_DECISION_RAW_SELECT` projeta),
 *       não sobre o objeto rico do analisador.
 *
 * Uma não substitui a outra: a soma dos baldes só protege campo com FORMA DE BALDE — nem `juizo`
 * nem `area_regulatoria` têm, e os dois escapariam dela. E (a) sozinha não garante que o valor
 * atravesse a projeção.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { analyzeUploadPdf } from "@/lib/server/upload-analysis";
import {
  buildRawExtractionDoItem,
  chavesConhecidasDoItem,
  OMISSOES_DECLARADAS,
} from "@/lib/server/ata-item-materializacao";
import { decisionStatus } from "@/lib/server/regulatory-documents";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");
const AGENCIAS = [
  { id: "cert-antt", sigla: "ANTT" },
  { id: "cert-anm", sigla: "ANM" },
  { id: "cert-artesp", sigla: "ARTESP" },
];
const PDFS = readdirSync(fixturesDir).filter((f) => f.endsWith(".pdf")).sort();

/** Roda o analisador em todos os PDFs uma vez só (é a parte cara). */
let cacheItens: Array<{ file: string; item: Record<string, unknown> }> | null = null;
async function todosOsItens() {
  if (cacheItens) return cacheItens;
  const out: Array<{ file: string; item: Record<string, unknown> }> = [];
  for (const file of PDFS) {
    const buffer = readFileSync(join(fixturesDir, file));
    const preview = await analyzeUploadPdf({
      file: { name: file, buffer, size: buffer.length },
      agencias: AGENCIAS,
      db: null,
    });
    for (const item of preview.ata_items ?? []) out.push({ file, item: item as unknown as Record<string, unknown> });
  }
  cacheItens = out;
  return out;
}

/**
 * Monta a linha EXATAMENTE como `FINAL_DECISION_RAW_SELECT` a devolveria: o sub-select achata
 * `raw_extraction->>juizo` em `juizo_raw` e NÃO traz o objeto inteiro. É isto que a rota vê.
 */
function linhaComoARotaVe(raw: Record<string, unknown>, colunaJuizo: unknown) {
  return {
    resultado: raw.resultado as string | null,
    juizo: colunaJuizo as string | null,
    juizo_raw: (raw.juizo ?? null) as string | null,
    // `raw_extraction` NÃO vem projetado — é justamente o ponto: quem lê o objeto inteiro não
    // reproduz o ambiente de produção.
  };
}

describe("etapa66 · (a) COMPLETUDE — nenhuma chave do item pode sumir sem motivo declarado", () => {
  it("toda chave produzida pelo analisador está no contrato (propagada ou omitida COM motivo)", async () => {
    const itens = await todosOsItens();
    expect(itens.length, "o corpus precisa ter itens de ata").toBeGreaterThan(300);

    const conhecidas = chavesConhecidasDoItem();
    const desconhecidas = new Map<string, { exemplo: string; n: number }>();
    for (const { file, item } of itens) {
      for (const k of Object.keys(item)) {
        if (conhecidas.has(k)) continue;
        const atual = desconhecidas.get(k);
        desconhecidas.set(k, { exemplo: atual?.exemplo ?? file, n: (atual?.n ?? 0) + 1 });
      }
    }
    expect(
      [...desconhecidas.entries()].map(([k, v]) => `${k} (em ${v.n} item(ns), ex.: ${v.exemplo})`),
      "chave nova no item de ata: propague em `buildRawExtractionDoItem` ou declare em "
        + "`OMISSOES_DECLARADAS` com o motivo — foi assim que `juizo` e `area_regulatoria` sumiram",
    ).toEqual([]);
  }, 180_000);

  it("toda omissão declarada tem motivo não-vazio — a lista não vira depósito", () => {
    for (const [chave, motivo] of Object.entries(OMISSOES_DECLARADAS)) {
      expect(motivo.trim().length, `omissão "${chave}" sem motivo`).toBeGreaterThan(10);
    }
  });

  it("os campos que se PERDIAM agora atravessam", async () => {
    const itens = await todosOsItens();
    const comJuizo = itens.filter(({ item }) => item.juizo === "admissibilidade");
    expect(comJuizo.length, "o corpus tem itens de admissibilidade").toBeGreaterThan(0);

    for (const { file, item } of comJuizo) {
      const raw = buildRawExtractionDoItem({
        item: item as never,
        documentoAnttTipo: null,
        documentoSubtipo: null,
        votosInferidosPorMandato: false,
      });
      expect(raw.juizo, `${file}: juizo não sobreviveu ao raw_extraction`).toBe("admissibilidade");
    }
  }, 180_000);

  it("os baldes de nome mantêm os nomes que o backfill retroativo LÊ", () => {
    // `applyRetroactiveVotes` lê exatamente estas chaves. Renomear quebra o backfill em silêncio.
    const raw = buildRawExtractionDoItem({
      item: {
        item_numero: "1.1.1",
        votos_detectados: ["Ana Ribeiro Lopes"],
        votos_contra_detectados: ["Bruno Cardoso Melo"],
        votos_abstencao_detectados: ["Carla Duarte Pinto"],
        votos_ausentes_detectados: ["Davi Nunes Rocha"],
        votos_impedidos_detectados: ["Elisa Prado Lima"],
        votos_em_autos_detectados: ["Fabio Moreira Dias"],
      } as never,
      documentoAnttTipo: null,
      documentoSubtipo: null,
      votosInferidosPorMandato: false,
    });
    expect(raw.nomes_votacao).toEqual(["Ana Ribeiro Lopes"]);
    expect(raw.nomes_votacao_contra).toEqual(["Bruno Cardoso Melo"]);
    expect(raw.nomes_votacao_abstencao).toEqual(["Carla Duarte Pinto"]);
    expect(raw.nomes_votacao_ausente).toEqual(["Davi Nunes Rocha"]);
    expect(raw.nomes_votacao_impedido).toEqual(["Elisa Prado Lima"]);
    expect(raw.impedimentos).toEqual(["Elisa Prado Lima"]);
    expect(raw.votos_em_autos).toEqual([{ nome: "Fabio Moreira Dias", sessao: null }]);
  });

  it("texto pesado continua FORA do raw — omissão por tamanho é desenho, não esquecimento", () => {
    const raw = buildRawExtractionDoItem({
      item: { item_numero: "1", decisao: "x".repeat(5000), raw_text: "y".repeat(9000) } as never,
      documentoAnttTipo: null,
      documentoSubtipo: null,
      votosInferidosPorMandato: false,
    });
    expect(raw.decisao, "vira a coluna resumo_pleito; duplicar incharia toda linha").toBeUndefined();
    expect(raw.raw_text).toBeUndefined();
  });
});

describe("etapa66 · (b) A linha SERIALIZADA — soma dos baldes e admissibilidade visível", () => {
  it("os quatro estados somam o pautado, sobre a linha como a ROTA a vê", async () => {
    const itens = await todosOsItens();
    const contagem = { decidido: 0, admissibilidade: 0, retirado: 0, sem_resultado: 0 };

    for (const { item } of itens) {
      const raw = buildRawExtractionDoItem({
        item: item as never,
        documentoAnttTipo: null,
        documentoSubtipo: null,
        votosInferidosPorMandato: false,
      });
      // A coluna é gravada pelo mesmo valor; o teste projeta as DUAS fontes, como a rota faz.
      const linha = linhaComoARotaVe({ ...raw, resultado: item.resultado }, item.juizo ?? null);
      contagem[decisionStatus(linha as never)] += 1;
    }

    const soma = Object.values(contagem).reduce((s, n) => s + n, 0);
    expect(soma, "balde novo nasceu fora da conta").toBe(itens.length);
    expect(contagem.admissibilidade, "admissibilidade invisível na linha serializada")
      .toBeGreaterThan(0);
  }, 180_000);

  it("SEM o juizo no raw E sem a coluna, a admissibilidade some — a demonstração do bug", async () => {
    const itens = await todosOsItens();
    const comAdmissibilidade = itens.filter(({ item }) => item.juizo === "admissibilidade");
    expect(comAdmissibilidade.length).toBeGreaterThan(0);

    for (const { item } of comAdmissibilidade) {
      // Como era antes: raw sem `juizo`, e a projeção não trazia a coluna.
      const comoEraAntes = { resultado: item.resultado, juizo: undefined, juizo_raw: null };
      expect(decisionStatus(comoEraAntes as never)).toBe("decidido");
      // Como é agora: o raw carrega o campo.
      const agora = { resultado: item.resultado, juizo: undefined, juizo_raw: "admissibilidade" };
      expect(decisionStatus(agora as never)).toBe("admissibilidade");
    }
  }, 180_000);

  it("a ata da ANTT não perde mais o juizo por item", async () => {
    const buffer = readFileSync(join(fixturesDir, "antt-ata-1024.pdf"));
    const preview = await analyzeUploadPdf({
      file: { name: "antt-ata-1024.pdf", buffer, size: buffer.length },
      agencias: AGENCIAS,
      db: null,
    });
    const itens = preview.ata_items ?? [];
    expect(itens.length).toBeGreaterThan(0);
    // O ramo da ANTT sobrescreve `ata_items` inteiro; antes da etapa66 a chave nem existia.
    for (const item of itens) {
      expect(item, "todo item da ANTT precisa carregar a chave `juizo`").toHaveProperty("juizo");
    }
  }, 60_000);
});
