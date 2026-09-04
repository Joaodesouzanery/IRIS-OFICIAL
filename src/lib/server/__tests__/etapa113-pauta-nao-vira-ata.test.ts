/**
 * Etapa 113 (Fase 19, commit 2) — a PAUTA da ANTT para de virar ata e de fabricar deliberação.
 *
 * ═══ O defeito, e o ponto cego que o escondia ═══
 * `ata-splitter.ts:22-24` proíbe explicitamente materializar itens de pauta: "pauta é agenda
 * (nada foi decidido) e viraria votos fabricados". Mesmo assim há 35 filhos `PAUTA-` no banco.
 *
 * A cadeia: `classifyAnttDocument` testa "pauta" DEPOIS dos ramos `reuniao_*`, então uma pauta
 * cujo cabeçalho diz "REUNIÃO DE DIRETORIA PÚBLICA" sai como `reuniao_diretoria_publica`;
 * `regulatory-documents.ts:41` só reconhece pauta pelo NOME do arquivo; e o nome que chega do
 * portal é o fallback `documento-monitorado-<ts>.pdf` (o href da ANTT termina em UUID, sem
 * extensão reconhecível), que não contém "pauta". Resultado: `tipo = "ata"`, itens expostos,
 * confirm materializa — com prefixo `PAUTA-`, que é a confissão do próprio bug.
 *
 * ⚠️ **Por que a certificação (46/46) não pega**: a suíte alimenta `file: { name: <nome do nosso
 * fixture> }`, e o nosso fixture se chama `antt-pauta-1036.pdf`. O teste passa por COINCIDÊNCIA
 * DE SETUP — o mesmo PDF, com o nome que a produção realmente usa, falha. É por isso que este
 * teste roda o MESMO arquivo por TRÊS nomes.
 *
 * ═══ Por que head-300 do TEXTO ═══
 * Medido nas 16 fixtures oficiais: "pauta" nos primeiros 300 chars do texto → 2/2 pautas
 * detectadas, 0/14 falsos positivos. Em 5000 chars → 8/14 falsos positivos, porque as atas da ANM
 * dizem "retirado de pauta". A pauta se anuncia no cabeçalho ("PAUTA 1.036ª REUNIÃO…"); a ata
 * abre com "ATA DA 1.024ª REUNIÃO…". A janela curta é o que separa os dois.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import { parseAnttManualDocument } from "@/lib/server/antt-manual-parser";
import { classifyRegulatoryDocument, declaraSerPauta } from "@/lib/server/regulatory-documents";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");
const ler = (nome: string) => readFileSync(join(fixtures, nome));

/** Classifica como a esteira classifica: texto do PDF + nome do arquivo. */
async function classificar(arquivo: string, nomeNaEsteira: string) {
  const { text } = await extractPdfText(ler(arquivo));
  const antt = parseAnttManualDocument(text, nomeNaEsteira);
  const cls = classifyRegulatoryDocument({
    filename: nomeNaEsteira,
    text,
    documento_antt_tipo: antt?.documentType ?? null,
  } as any);
  return { tipo: cls.tipo_documento, anttTipo: antt?.documentType ?? null, itens: antt?.ataItems ?? [] };
}

describe("etapa113 · a pauta é pauta com QUALQUER nome de arquivo", () => {
  /**
   * Os três nomes que o MESMO PDF recebe na vida real:
   *  1. o nome do nosso fixture (o único que a certificação exercita — e o único com "pauta");
   *  2. o nome REAL do href do portal, tirado de fixtures/antt/reuniao-1036-diretoria.html;
   *  3. o fallback do crawler, que é o que de fato chega no banco (o href termina em UUID).
   */
  const NOMES = [
    "antt-pauta-1036.pdf",
    "1.036ª REUNIÃO DE DIRETORIA PÚBLICA, DE 2.7.2026 (1).pdf",
    "documento-monitorado-1757000000000.pdf",
  ];

  it.each(NOMES)("com o nome «%s» → tipo_documento = pauta", async (nome) => {
    const { tipo } = await classificar("antt-pauta-1036.pdf", nome);
    expect(tipo).toBe("pauta");
  }, 30_000);

  it("a ARTESP também: pauta com nome neutro continua pauta", async () => {
    const { tipo } = await classificar("artesp-pauta-1201.pdf", "documento-monitorado-1757000000001.pdf");
    expect(tipo).toBe("pauta");
  }, 30_000);
});

describe("etapa113 · GUARDA DE FALSO POSITIVO: ata continua ata", () => {
  // A janela de 5000 chars daria 8 falsos positivos em 14 — as atas da ANM dizem "retirado de
  // pauta" no corpo. Estes casos são a rede que prova que a janela curta não pegou ata nenhuma.
  const ATAS = ["antt-ata-1024.pdf", "antt-ata-264-rde.pdf", "artesp-ata-1201.pdf", "anm-ata-83-rop.pdf"];

  it.each(ATAS)("«%s» NÃO é classificada como pauta", async (arquivo) => {
    const { tipo } = await classificar(arquivo, "documento-monitorado-1757000000002.pdf");
    expect(tipo).not.toBe("pauta");
  }, 30_000);
});

describe("etapa113 · a regra é INÍCIO DE LINHA, não «pauta em qualquer lugar»", () => {
  // A primeira versão deste conserto procurava "pauta" nos 300 primeiros chars e REPROVOU em dois
  // testes existentes — com razão. Estes casos são a rede que impede a volta:
  it("um VOTO que menciona pauta no meio da frase NÃO é pauta", () => {
    const voto =
      "AGÊNCIA NACIONAL DE TRANSPORTES TERRESTRES\nVOTO DAB\n" +
      "Assunto: retirada de interferências. O processo consta da pauta da 1.036ª Reunião.";
    expect(declaraSerPauta(voto)).toBe(false);
  });

  it("«voto pela retirada de pauta» NÃO é pauta (o caso da etapa18)", () => {
    expect(declaraSerPauta("VOTO DG 12/2026\nVoto pela retirada de pauta do presente processo.")).toBe(false);
  });

  it("…mas o TÍTULO em linha própria é, nas duas formas medidas", () => {
    // ANTT: "PAUTA" sozinha na linha. ARTESP: "Pauta da 1201ª Reunião…".
    expect(declaraSerPauta("AGÊNCIA NACIONAL DE TRANSPORTES TERRESTRES\n \nPAUTA\n1.036ª REUNIÃO")).toBe(true);
    expect(declaraSerPauta("Pauta da 1201ª Reunião Ordinária do Conselho Diretor")).toBe(true);
  });
});

describe("etapa113 · o cinto: envelope sem UM dispositivo sequer não materializa", () => {
  it("os itens da pauta vêm todos sem resultado e sem decisão — a assinatura da agenda", async () => {
    const { itens } = await classificar("antt-pauta-1036.pdf", "documento-monitorado-1757000000003.pdf");
    expect(itens.length).toBeGreaterThan(0);
    const semDispositivo = itens.filter((i: any) => !i.resultado && !i.decisao).length;
    expect(semDispositivo).toBe(itens.length);
  }, 30_000);

  it("…e uma ATA real da MESMA agência nunca é 100% sem dispositivo (pior caso medido: 17%)", async () => {
    // Fica na ANTT de propósito: `parseAnttManualDocument` é específico dela, e comparar dois
    // documentos do MESMO parser é o que torna o contraste honesto.
    const { itens } = await classificar("antt-ata-1024.pdf", "documento-monitorado-1757000000004.pdf");
    expect(itens.length).toBeGreaterThan(0);
    const comDispositivo = itens.filter((i: any) => i.resultado || i.decisao).length;
    expect(comDispositivo).toBeGreaterThan(itens.length * 0.5);
  }, 30_000);
});
