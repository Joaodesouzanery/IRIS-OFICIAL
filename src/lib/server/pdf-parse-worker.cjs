/**
 * Worker de `pdf-parse` (Fase 27) — CommonJS de propósito: `new Worker(path)` carrega o arquivo
 * direto, sem passar pelo bundler. Ver `pdf-parse-isolado.ts` para o porquê do isolamento.
 */
const { parentPort, workerData } = require("node:worker_threads");
const pdfParse = require("pdf-parse");

(async () => {
  try {
    const data = await pdfParse(workerData.buffer);
    parentPort.postMessage({ ok: true, text: String(data.text ?? ""), numpages: Number(data.numpages ?? 0) });
  } catch (err) {
    parentPort.postMessage({ ok: false, erro: err instanceof Error ? err.message : String(err) });
  }
})();
