/**
 * A FONTE do worker de `pdf-parse`, como string literal (Fase 28).
 *
 * ═══ Por que string e não arquivo ═══
 * A Fase 27 pôs o worker num `.cjs` e o carregou por caminho montado em runtime:
 * `new Worker(join(process.cwd(), "src", "lib", "server", "pdf-parse-worker.cjs"))`. Para o
 * webpack e para o `@vercel/nft` isso são três strings concatenadas, não uma dependência — não há
 * aresta no grafo, logo não há arquivo a copiar. Medido no build: dos 183 `.nft.json` gerados,
 * NENHUM cita `pdf-parse-worker.cjs`, enquanto o trace da rota da esteira (895 arquivos) inclui os
 * 11 de `node_modules/pdf-parse` e até dois `.ts` do nosso `src/`. O arquivo estava no repositório
 * e não estava na função. O `new Worker` falhava com `MODULE_NOT_FOUND`, o catch caía no parse
 * in-process e a run voltava a morrer com "90s sem resposta" — sem um ruído sequer.
 *
 * Uma string literal o bundler copia verbatim. Não há o que resolver em runtime, então não há o
 * que falhar. E o teste importa ESTA constante, que é a mesma que produção usa: o erro central do
 * etapa144 foi testar `while(true)` com `{eval:true}` enquanto produção usava `new Worker(path)` —
 * dois mecanismos diferentes, teste verde sobre bug em produção.
 *
 * ═══ Por que o pai entrega o caminho do módulo ═══
 * Dentro de um worker `{eval:true}` não há `__filename` (vale `[worker eval]`), então um
 * `require("pdf-parse")` BARE resolve a partir do `process.cwd()` — medido: com cwd fora do
 * projeto, `MODULE_NOT_FOUND`. Trocar arquivo por texto embutido moveria a dependência de cwd de
 * `src/` para `node_modules/`, não a eliminaria. `require(<caminho absoluto>)` resolve sempre, e é
 * por isso que `workerData.modulo` existe. O bare fica como última tentativa.
 *
 * ═══ `infra` no retorno ═══
 * Distingue "o PDF é ruim" (defeito do documento, encerra o documento) de "o parse isolado não
 * subiu" (defeito da plataforma, e a run inteira está em risco). Sem essa distinção as duas coisas
 * viravam a mesma mensagem genérica e o 3º ciclo do reprocesso decidia no escuro.
 */

/** Sinaliza que o parse isolado não pôde ser montado — é falha de PLATAFORMA, não do PDF. */
export const MOTIVO_SEM_ISOLAMENTO = "parser_sem_isolamento";

export const PDF_PARSE_WORKER_SRC = `
const { parentPort, workerData } = require("node:worker_threads");

let pdfParse;
try {
  pdfParse = require(workerData.modulo || "pdf-parse");
  if (pdfParse && pdfParse.default) pdfParse = pdfParse.default;
} catch (err) {
  parentPort.postMessage({ ok: false, infra: true, erro: String((err && err.message) || err) });
}

if (pdfParse) {
  Promise.resolve()
    .then(function () { return pdfParse(workerData.buffer); })
    .then(function (d) {
      parentPort.postMessage({
        ok: true,
        text: String((d && d.text) || ""),
        numpages: Number((d && d.numpages) || 0),
      });
    })
    .catch(function (err) {
      parentPort.postMessage({ ok: false, infra: false, erro: String((err && err.message) || err) });
    });
}
`;
