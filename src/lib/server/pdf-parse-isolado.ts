/**
 * `pdf-parse` num WORKER, com terminação REAL no teto (Fase 27).
 *
 * ═══ Por que o Promise.race não bastava ═══
 * O teto de 25s do parser e a corrida contra a fatia da função (Fase 26) são `setTimeout`. Um
 * `setTimeout` só dispara quando o event loop está livre — e `pdf-parse` é SÍNCRONO: num PDF que
 * o faz girar em CPU, o loop fica bloqueado, nenhum timer roda e só o SIGKILL da plataforma
 * encerra. Foi isso que manteve 10 documentos (9 da ANM, todos `page_count: null`) presos por
 * semanas e derrubou a run com "90s sem resposta": cada retentativa consumia a rodada inteira.
 *
 * Num worker o parse tem o SEU event loop; `worker.terminate()` mata a thread mesmo em laço de
 * CPU. O teto passa a ser real, o documento vira `failed` com motivo e a run continua.
 *
 * Degrade declarado: se `worker_threads` não existir no runtime, cai no parse in-process com o
 * `Promise.race` de antes — pior, mas nunca pior do que era.
 */

import type { Buffer } from "node:buffer";

export interface PdfParseResultado {
  text: string;
  numpages: number;
}

/** `true` quando o parse rodou isolado (teto real); `false` no fallback in-process. */
export let ultimoParseIsolado = false;

export async function parsePdfComTeto(buffer: Buffer, tetoMs: number): Promise<PdfParseResultado> {
  try {
    const { Worker } = await import("node:worker_threads");
    const { join } = await import("node:path");
    const script = join(process.cwd(), "src", "lib", "server", "pdf-parse-worker.cjs");
    ultimoParseIsolado = true;
    return await new Promise<PdfParseResultado>((resolve, reject) => {
      const worker = new Worker(script, { workerData: { buffer } });
      const timer = setTimeout(() => {
        // `terminate()` mata a thread mesmo travada em CPU — é a diferença entre este caminho e o
        // `Promise.race` in-process, que nunca disparava nesses PDFs.
        void worker.terminate();
        reject(new Error(`Timeout ao processar PDF (>${Math.round(tetoMs / 1000)}s) — o parser travou; arquivo provavelmente corrompido ou mal formado.`));
      }, tetoMs);
      worker.on("message", (msg: { ok: boolean; text?: string; numpages?: number; erro?: string }) => {
        clearTimeout(timer);
        void worker.terminate();
        if (msg.ok) resolve({ text: String(msg.text ?? ""), numpages: Number(msg.numpages ?? 0) });
        else reject(new Error(msg.erro ?? "Falha ao processar PDF no worker"));
      });
      worker.on("error", (err) => { clearTimeout(timer); reject(err); });
      worker.on("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`Worker de PDF encerrou com código ${code}`));
      });
    });
  } catch (err) {
    // `worker_threads` indisponível (ou o script não existe no bundle): caminho antigo.
    if (err instanceof Error && /Timeout ao processar PDF|Worker de PDF|Falha ao processar PDF/.test(err.message)) throw err;
    ultimoParseIsolado = false;
    console.warn("[pdf] worker indisponível — parse in-process (teto não é garantido):", err instanceof Error ? err.message : err);
    const pdfParse = (await import("pdf-parse")).default;
    return await Promise.race([
      pdfParse(buffer) as Promise<PdfParseResultado>,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timeout ao processar PDF (>${Math.round(tetoMs / 1000)}s). O arquivo pode estar corrompido.`)), tetoMs)),
    ]);
  }
}
