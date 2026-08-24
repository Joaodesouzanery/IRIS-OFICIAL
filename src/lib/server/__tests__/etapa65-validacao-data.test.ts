/**
 * Etapa 65 — VALIDAÇÃO CRUZADA DE DATA (C17/C18).
 *
 * `data_reuniao` é o que escolhe o roster em `getActiveDiretoresForVote`. Data errada não perde
 * voto: ela infere voto para os DIRETORES ERRADOS, com aparência total de normalidade. Foi o pior
 * defeito da rodada anterior — a 83ª ROP, de 25/03/2026, era lida como 02/05/2022 — e a única
 * validação existente era uma janela `2020-01-01 .. hoje+60d`, larga demais para pegá-lo.
 *
 * Dois sinais INDEPENDENTES, ambos de graça no próprio documento:
 *   C17  o ano da reunião nunca é ANTERIOR ao processo mais novo que ela julga;
 *   C18  o ano do protocolo SEI do PRÓPRIO documento é IGUAL ao ano da reunião.
 *
 * ⚠️ A regra do C17 é ASSIMÉTRICA por MEDIÇÃO, não por gosto. A versão simétrica ("divergiu mais de
 * ~1 ano do protocolo, é erro") daria falso positivo em série: as atas da ANM misturam protocolos
 * de 1935 a 2026 (36 anos distintos só na 79ª), porque o número do processo diz quando ele foi
 * ABERTO e processo minerário leva décadas. Bloquear nessa direção seria o "8 de 8 atas recusadas"
 * do C03 outra vez.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractPdfText, extractProtocoloSei } from "@/lib/server/pdf-extractor";
import { analyzeUploadPdf } from "@/lib/server/upload-analysis";
import { extractFields, numeroReuniaoOrdinal } from "@/lib/server/nlp-extractor";
import {
  anosDeProcessoNoTexto,
  checarDataAnteriorAoProcesso,
  checarAnoProtocoloDaAta,
  temBloqueio,
} from "@/lib/server/consistency-checks";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");
const AGENCIAS = [
  { id: "cert-antt", sigla: "ANTT" },
  { id: "cert-anm", sigla: "ANM" },
  { id: "cert-artesp", sigla: "ARTESP" },
];

describe("etapa65 · anos de processo no texto", () => {
  it("lê o formato ANM/ANTT (bloco central de 6 dígitos)", () => {
    expect(anosDeProcessoNoTexto("PROCESSO Nº: 48051.003447/2026-17")).toEqual([2026]);
  });

  it("lê o formato ARTESP (bloco central de 8 dígitos) — regex de 6 não casaria", () => {
    expect(anosDeProcessoNoTexto("Processo 134.00000123/2023-45")).toEqual([2023]);
  });

  it("devolve os anos ORDENADOS e sem repetição", () => {
    expect(anosDeProcessoNoTexto(
      "27205.851966/1992-13 e 48403.831223/2005-11 e 48051.003447/2026-17 e 48051.000001/1992-99",
    )).toEqual([1992, 2005, 2026]);
  });

  it("id de documento SEM ano não é confundido com processo", () => {
    // O voto DAB 002 traz "37115746", que não tem barra nem ano — presumir seria fabricar base.
    expect(anosDeProcessoNoTexto("documento 37115746 e SEI 0095528423")).toEqual([]);
  });
});

describe("etapa65 · C17 — reunião anterior ao processo é impossível", () => {
  it("bloqueia quando a reunião precede o processo mais novo", () => {
    const a = checarDataAnteriorAoProcesso({
      dataReuniao: "2022-05-02",
      texto: "PROCESSO Nº: 48051.003447/2026-17",
    });
    expect(a.map((x) => x.codigo)).toEqual(["C17_DATA_ANTERIOR_AO_PROCESSO"]);
    expect(temBloqueio(a)).toBe(true);
  });

  it("NÃO bloqueia posterior — e é isto que a versão simétrica quebraria", () => {
    // Direito minerário leva décadas: protocolo de 1935 julgado em 2025 é o caso NORMAL.
    expect(checarDataAnteriorAoProcesso({
      dataReuniao: "2025-11-26",
      texto: "PROCESSO Nº: 27205.851966/1935-13",
    })).toEqual([]);
  });

  it("usa o MAIS NOVO, não o primeiro citado", () => {
    // O campo `processo` guarda o PRIMEIRO match; usá-lo deixaria o check cego.
    expect(checarDataAnteriorAoProcesso({
      dataReuniao: "2024-01-10",
      texto: "48403.831223/2005-11 ... 48051.003447/2026-17",
    }).map((x) => x.codigo)).toEqual(["C17_DATA_ANTERIOR_AO_PROCESSO"]);
  });

  it("sem data ou sem processo, fica silencioso — não presume", () => {
    expect(checarDataAnteriorAoProcesso({ dataReuniao: null, texto: "48051.003447/2026-17" })).toEqual([]);
    expect(checarDataAnteriorAoProcesso({ dataReuniao: "2026-03-25", texto: "sem processo aqui" })).toEqual([]);
  });
});

describe("etapa65 · C18 — o protocolo do próprio documento", () => {
  it("captura o rodapé SEI federal", () => {
    expect(extractProtocoloSei(
      "Ata 83ª Reunião Ordinária Pública da DIRC (19543269)  SEI 48051.003447/2026-17 / pg. 1",
    )).toBe("48051.003447/2026-17");
  });

  it("bloqueia quando o ano do protocolo diverge do ano da reunião", () => {
    const a = checarAnoProtocoloDaAta({ dataReuniao: "2022-05-02", protocoloSei: "48051.003447/2026-17" });
    expect(a.map((x) => x.codigo)).toEqual(["C18_ANO_PROTOCOLO_DIVERGE"]);
    expect(temBloqueio(a)).toBe(true);
  });

  it("sem rodapé (ARTESP) fica silencioso em vez de inventar base", () => {
    expect(checarAnoProtocoloDaAta({ dataReuniao: "2026-01-13", protocoloSei: null })).toEqual([]);
  });

  it("ano igual não gera achado", () => {
    expect(checarAnoProtocoloDaAta({ dataReuniao: "2026-03-25", protocoloSei: "48051.003447/2026-17" })).toEqual([]);
  });
});

describe("etapa65 · número da reunião com separador de milhar", () => {
  it("«1.024ª REUNIÃO» não pode virar a 24 — o separador truncava o número", () => {
    expect(extractFields("ATA DA 1.024ª REUNIÃO PÚBLICA DE DIRETORIA").numero_reuniao).toBe("1.024");
  });

  it("o formato sem separador continua funcionando", () => {
    expect(extractFields("ATA DA 264ª REUNIÃO DELIBERATIVA").numero_reuniao).toBe("264");
    expect(extractFields("Ata da 1201ª Reunião Ordinária").numero_reuniao).toBe("1201");
  });

  it("a ordinal normaliza os dois formatos SEM mexer no valor armazenado", () => {
    // O campo é chave de dedup (`.eq()` contra o já persistido): normalizá-lo na gravação faria a
    // mesma reunião deixar de casar. A normalização vive só na comparação.
    expect(numeroReuniaoOrdinal("1.024")).toBe(1024);
    expect(numeroReuniaoOrdinal("1024")).toBe(1024);
    expect(numeroReuniaoOrdinal("83")).toBe(83);
    expect(numeroReuniaoOrdinal(null)).toBeNull();
    expect(numeroReuniaoOrdinal("1024-A")).toBeNull();
  });

  it("a 83ª vem DEPOIS da 81ª e ANTES da 1.024ª quando comparadas por ordinal", () => {
    const ord = ["81", "83", "1.024"].map(numeroReuniaoOrdinal);
    expect(ord).toEqual([81, 83, 1024]);
    expect([...ord].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(ord);
  });
});

describe("etapa65 · contra os PDFs reais", () => {
  const pdfs = readdirSync(fixturesDir).filter((f) => f.endsWith(".pdf")).sort();

  it.each(pdfs)("%s — documento sadio NÃO pode ser bloqueado por C17/C18", async (file) => {
    const buffer = readFileSync(join(fixturesDir, file));
    const extraction = await extractPdfText(buffer);
    const preview = await analyzeUploadPdf({
      file: { name: file, buffer, size: buffer.length },
      agencias: AGENCIAS,
      db: null,
    });
    const dataReuniao = preview.fields.data_reuniao ?? null;
    const achados = [
      ...checarDataAnteriorAoProcesso({ dataReuniao, texto: extraction.text }),
      ...checarAnoProtocoloDaAta({ dataReuniao, protocoloSei: extraction.protocoloSei }),
    ];
    expect(achados.map((a) => `${a.codigo}: ${a.mensagem}`), "falso positivo em documento sadio").toEqual([]);
  }, 60_000);

  it("a 83ª com a data ERRADA é pega pelos DOIS validadores, independentemente", async () => {
    const buffer = readFileSync(join(fixturesDir, "anm-ata-83-rop.pdf"));
    const extraction = await extractPdfText(buffer);
    // O valor exato que o parser produzia antes do conserto de "março" (etapa Fase 0).
    const dataBugada = "2022-05-02";
    expect(checarDataAnteriorAoProcesso({ dataReuniao: dataBugada, texto: extraction.text }))
      .toHaveLength(1);
    expect(checarAnoProtocoloDaAta({ dataReuniao: dataBugada, protocoloSei: extraction.protocoloSei }))
      .toHaveLength(1);
  }, 60_000);

  it("ANM e ANTT expõem o protocolo; ARTESP não tem o rodapé", async () => {
    const comRodape: string[] = [];
    const semRodape: string[] = [];
    for (const file of pdfs) {
      const { protocoloSei } = await extractPdfText(readFileSync(join(fixturesDir, file)));
      (protocoloSei ? comRodape : semRodape).push(file);
    }
    expect(comRodape).toEqual([
      "anm-ata-32-extraordinaria.pdf", "anm-ata-34-rep.pdf", "anm-ata-79-rop.pdf",
      "anm-ata-81-rop.pdf", "anm-ata-82-ordinaria.pdf", "anm-ata-83-rop.pdf",
      "antt-ata-1024.pdf", "antt-ata-264-rde.pdf", "antt-pauta-1036.pdf",
    ]);
    expect(semRodape.every((f) => f.startsWith("artesp-") || f === "antt-voto-dab-002.pdf")).toBe(true);
  }, 120_000);
});
