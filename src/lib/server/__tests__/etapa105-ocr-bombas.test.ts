/**
 * Etapa 105 (Fase 17, commit H) — desarmar as bombas do OCR, SEM ligar a chave.
 *
 * ═══ A medição que decidiu a frente ═══
 * O usuário perguntou se o PaddleOCR resolveria. Não: os 16 PDFs oficiais reais das três
 * agências têm no MÍNIMO 1594 chars/página contra um limiar de escaneado de 80 — 20× de folga.
 * PDFs SEI têm camada de texto; escaneado é exceção. E o OCR que já existe (OCR.space) NUNCA
 * rodou: `OCR_SPACE_API_KEY` está em "Adiados por decisão", então `isOcrConfigured()` é falso e o
 * bloco inteiro é código morto hoje.
 *
 * ═══ Mas o código morto tem uma bomba armada ═══
 * `extractTextViaOcr(buffer, deadlineAt?)` aceita orçamento — e NENHUM chamador passa. São até
 * MAX_CHUNKS (10) chamadas de 40s = 400s numa função de 70s: SIGKILL incatchável, que não grava
 * nem sucesso nem erro e leva junto a run inteira e os jobs concorrentes. Isso não dói hoje
 * porque a chave não existe; dói no minuto em que alguém a criar sem saber.
 *
 * ═══ E uma mentira que dói HOJE ═══
 * `pipeline.ts` sobrescreve `agencia_id` com o que a análise detectou — apagando a agência que a
 * ESTEIRA já conhecia (o item de monitoramento sabe de que site veio). Documento escaneado, que
 * não tem texto para detectar nada, era arquivado como `sem_agencia`: um diagnóstico falso que
 * contamina a medição de todas as outras frentes.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
const OCR = ler("src/lib/server/ocr.ts");
const EXTRACTOR = semComentarios(ler("src/lib/server/pdf-extractor.ts"));
const ANALISE = semComentarios(ler("src/lib/server/upload-analysis.ts"));
const PIPELINE = semComentarios(ler("src/lib/server/pipeline.ts"));

describe("etapa105 · o orçamento chega até o OCR", () => {
  it("o chamador PASSA o deadline — o parâmetro existia e ninguém usava", () => {
    expect(EXTRACTOR).toMatch(/extractTextViaOcr\(buffer, deadlineAt\)/);
  });

  it("o deadline atravessa a cadeia inteira: pipeline → análise → extrator", () => {
    expect(EXTRACTOR).toMatch(/export async function extractPdfText\(\s*buffer: Buffer,\s*deadlineAt\?: number/);
    expect(ANALISE).toMatch(/extractPdfText\(file\.buffer, input\.deadlineAt\)|extractPdfText\(file\.buffer, deadlineAt\)/);
    expect(PIPELINE).toMatch(/deadlineAt/);
  });

  it("o teto de blocos cabe numa função de 70s — 3 × 40s, não 10 × 40s", () => {
    const m = OCR.match(/const MAX_CHUNKS = (\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(3);
  });
});

describe("etapa105 · a agência que a esteira já conhecia não é apagada", () => {
  it("o update mantém a agência do JOB quando a análise não detecta nenhuma", () => {
    expect(PIPELINE).toMatch(/agencia_id: analysis\.agencia_id_detected \?\? [A-Za-z.?]*agencia_id/);
  });
});

describe("etapa105 · os painéis param de culpar o OCR", () => {
  it("nem cobertura-documentos nem saude-dados atribuem `failed` a PDF escaneado", () => {
    // O caminho do escaneado NUNCA produz `failed`: ele segue com texto curto e um aviso.
    // `failed` vem de erro de download, PDF corrompido ou timeout de processamento.
    for (const rota of [
      "src/app/api/v1/admin/cobertura-documentos/route.ts",
      "src/app/api/v1/admin/saude-dados/route.ts",
    ]) {
      const fonte = semComentarios(ler(rota));
      expect(fonte, `${rota} ainda culpa o OCR`).not.toMatch(/PDF escaneado/);
    }
  });
});
