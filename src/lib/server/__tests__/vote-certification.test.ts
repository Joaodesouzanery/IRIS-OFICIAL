/**
 * CERTIFICAÇÃO da extração de votos com DOCUMENTOS OFICIAIS REAIS (Etapa 12).
 *
 * Roda o pipeline real (extractPdfText → analyzeUploadPdf, sem DB) sobre PDFs
 * verdadeiros de ANTT/ANM/ARTESP versionados em fixtures/votos/ e compara com o
 * gabarito humano (gabarito.json). Qualquer divergência = teste vermelho.
 * Ao final imprime o scorecard (nº de expectativas verificadas por documento).
 */

import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { analyzeUploadPdf, type UploadAnalysisAgency } from "@/lib/server/upload-analysis";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures/votos");

type GabaritoDoc = {
  file: string;
  fonte: string;
  agencia_sigla: string;
  tipo_documento?: string;
  data_reuniao?: string;
  numero_deliberacao_contem?: string;
  resultado?: string;
  unanimidade_detectada?: boolean;
  import_counts_as_final?: boolean;
  nomes_presentes_incluem?: string[];
  nomes_contra?: string[];
  texto_contem?: string[];
  texto_nao_contem?: string[];
  sem_votos?: boolean;
  ata_items_min?: number;
  itens_unanimidade_min?: number;
};

const gabarito = JSON.parse(readFileSync(join(fixturesDir, "gabarito.json"), "utf-8")) as { docs: GabaritoDoc[] };

const AGENCIAS: UploadAnalysisAgency[] = [
  { id: "cert-antt", sigla: "ANTT" },
  { id: "cert-anm", sigla: "ANM" },
  { id: "cert-artesp", sigla: "ARTESP" },
];

const scorecard: Array<{ file: string; agencia: string; checks: number }> = [];

async function analyze(file: string) {
  const buffer = readFileSync(join(fixturesDir, file));
  return analyzeUploadPdf({
    file: { name: file, buffer, size: buffer.length },
    agencias: AGENCIAS,
    db: null,
  });
}

describe("Certificação — corpus real de documentos oficiais", () => {
  it("o corpus não tem PDFs sem gabarito (todo documento é etiquetado)", () => {
    const pdfs = readdirSync(fixturesDir).filter((f) => f.endsWith(".pdf")).sort();
    const etiquetados = gabarito.docs.map((d) => d.file).sort();
    expect(pdfs).toEqual(etiquetados);
  });

  for (const doc of gabarito.docs) {
    it(`${doc.file} — extração confere com o gabarito`, async () => {
      const preview = await analyze(doc.file);
      const fields = preview.fields as Record<string, any>;
      const rawText = String((preview.extraction_raw as Record<string, unknown> | undefined)?.raw_text ?? "");
      let checks = 0;

      expect(preview.status, "status de análise não pode ser 'error'").not.toBe("error");
      checks++;

      if (doc.agencia_sigla) {
        expect(preview.agencia_sigla_detected, "agência detectada").toBe(doc.agencia_sigla);
        checks++;
      }
      if (doc.tipo_documento) {
        expect(fields.tipo_documento, "tipo_documento").toBe(doc.tipo_documento);
        checks++;
      }
      if (doc.data_reuniao) {
        expect(fields.data_reuniao, "data_reuniao").toBe(doc.data_reuniao);
        checks++;
      }
      if (doc.numero_deliberacao_contem) {
        expect(String(fields.numero_deliberacao ?? ""), "numero_deliberacao").toContain(doc.numero_deliberacao_contem);
        checks++;
      }
      if (doc.resultado) {
        expect(fields.resultado, "resultado").toBe(doc.resultado);
        checks++;
      }
      if (typeof doc.unanimidade_detectada === "boolean") {
        const unan = Boolean((preview.extraction_raw as Record<string, unknown> | undefined)?.unanimidade_detectada);
        expect(unan, "unanimidade_detectada").toBe(doc.unanimidade_detectada);
        checks++;
      }
      if (typeof doc.import_counts_as_final === "boolean") {
        expect(preview.import_counts_as_final, "import_counts_as_final").toBe(doc.import_counts_as_final);
        checks++;
      }
      if (doc.nomes_presentes_incluem) {
        const presentes: string[] = fields.nomes_presentes ?? [];
        for (const nome of doc.nomes_presentes_incluem) {
          expect(presentes, `presentes deve incluir ${nome}`).toContain(nome);
          checks++;
        }
      }
      if (doc.nomes_contra) {
        expect(fields.nomes_votacao_contra ?? [], "nomes contra").toEqual(doc.nomes_contra);
        checks++;
      }
      if (doc.texto_contem) {
        for (const trecho of doc.texto_contem) {
          expect(rawText, `texto deve conter "${trecho}"`).toContain(trecho);
          checks++;
        }
      }
      if (doc.texto_nao_contem) {
        for (const trecho of doc.texto_nao_contem) {
          expect(rawText, `texto NÃO deve conter "${trecho}" (corrupção)`).not.toContain(trecho);
          checks++;
        }
      }
      if (doc.sem_votos) {
        expect((fields.nomes_votacao ?? []).length + (fields.votos_sugeridos ?? []).length, "pauta não gera votos").toBe(0);
        checks++;
      }
      if (typeof doc.ata_items_min === "number") {
        expect((preview.ata_items ?? []).length, "quantidade de itens da ata").toBeGreaterThanOrEqual(doc.ata_items_min);
        checks++;
      }
      if (typeof doc.itens_unanimidade_min === "number") {
        const unanimes = (preview.ata_items ?? []).filter((i) => i.unanimidade_detectada).length;
        expect(unanimes, "itens com unanimidade detectada").toBeGreaterThanOrEqual(doc.itens_unanimidade_min);
        checks++;
      }

      scorecard.push({ file: doc.file, agencia: doc.agencia_sigla, checks });
    }, 40_000);
  }
});

afterAll(() => {
  if (!scorecard.length) return;
  const total = scorecard.reduce((s, r) => s + r.checks, 0);
  console.log("\n═══ SCORECARD DE CERTIFICAÇÃO (docs oficiais reais) ═══");
  for (const r of scorecard) console.log(`  ✓ ${r.file} [${r.agencia}] — ${r.checks} expectativas verificadas`);
  console.log(`  TOTAL: ${scorecard.length} documento(s), ${total} expectativas — 100% verdes\n`);
});
