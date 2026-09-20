/**
 * `pdf-parse` num WORKER, com terminação REAL no teto (Fase 27, consertado na Fase 28).
 *
 * ═══ Por que o Promise.race não bastava (Fase 27, e continua verdade) ═══
 * O teto do parser é um `setTimeout`, e um `setTimeout` só dispara quando o event loop está livre.
 * `pdf-parse` é SÍNCRONO: num PDF que o faz girar em CPU, o loop trava, nenhum timer roda e só o
 * SIGKILL da plataforma encerra. Foi isso que manteve 15 documentos presos por semanas e derrubou
 * a run com "90s sem resposta" — cada retentativa consumia a rodada inteira. Num worker o parse
 * tem o SEU event loop, e `worker.terminate()` mata a thread mesmo travada em CPU.
 *
 * ═══ Por que a Fase 27 não funcionou, e o que mudou (Fase 28) ═══
 * O worker era carregado por caminho de arquivo montado em runtime, e esse arquivo nunca chegou à
 * Lambda (ver `pdf-parse-worker-src.ts` para a medição). O `new Worker` falhava com
 * `MODULE_NOT_FOUND`, o catch externo não reconhecia a mensagem e caía no parse in-process — o
 * caminho que mata a run. Agora a fonte do worker é uma string no bundle e o módulo `pdf-parse` é
 * entregue por CAMINHO ABSOLUTO resolvido aqui no pai.
 *
 * ═══ O fallback in-process foi REMOVIDO, e isso é deliberado ═══
 * Ele não era degrade-gracioso no sentido do CLAUDE.md. O `Promise.race` não CONSEGUE cortar um
 * parse síncrono, então o fallback não era "um caminho mais lento": era um caminho SEM TETO, que
 * transformava a falha de UM documento na morte da run e dos jobs concorrentes. A assimetria
 * decide: falhar este documento com motivo nomeado custa um documento, visível no balde "Falhou" e
 * reprocessável; cair no fallback custa a run inteira, e sob SIGKILL nem sucesso nem erro gravam.
 * Sem fallback também não há `catch` externo — e, portanto, não há regex de exceções para ficar
 * desatualizada, que foi exatamente o que engoliu o `MODULE_NOT_FOUND`.
 */

import type { Buffer } from "node:buffer";
import { MOTIVO_SEM_ISOLAMENTO, PDF_PARSE_WORKER_SRC } from "@/lib/server/pdf-parse-worker-src";

export { MOTIVO_SEM_ISOLAMENTO };

export interface PdfParseResultado {
  text: string;
  numpages: number;
}

/** Resposta do worker. `infra: true` = o parse isolado não subiu; `false` = o PDF é que é ruim. */
interface MensagemDoWorker {
  ok: boolean;
  text?: string;
  numpages?: number;
  erro?: string;
  infra?: boolean;
}

let caminhoCacheado: string | null | undefined;

/**
 * Caminho ABSOLUTO do módulo `pdf-parse`, resolvido sem depender do `process.cwd()`.
 *
 * `process.argv[1]` é o launcher DENTRO de `/var/task` na Lambda e o binário do vitest dentro do
 * projeto em teste — os dois sobem a árvore até o `node_modules` certo. O cwd fica como segunda
 * tentativa, não como única. `null` quando nenhuma resolve: aí o worker tenta o specifier bare.
 */
export async function caminhoDoPdfParse(): Promise<string | null> {
  if (caminhoCacheado !== undefined) return caminhoCacheado;
  // ⚠️ NÃO REMOVER este import, mesmo parecendo inútil: ele é a ÚNICA aresta estática para
  // `pdf-parse` no grafo de módulos, e é por ela que o file-tracing do Vercel decide copiar o
  // pacote para dentro da função. Medido na Fase 28: ao tirar o fallback in-process eu removi
  // sem perceber a última referência estática, e o trace do build caiu de 23 rotas com
  // `pdf-parse` para ZERO — a função subiria sem a biblioteca, e todo documento falharia com
  // `parser_sem_isolamento`. O `require` que o worker faz é uma string em runtime: invisível
  // ao tracer. Carregar o módulo aqui é barato (só o require); o que era caro era EXECUTÁ-LO
  // na thread principal, e isso não acontece mais em lugar nenhum. Guardado por etapa147.
  await import("pdf-parse");
  const { createRequire } = await import("node:module");
  const { join } = await import("node:path");
  const bases = [process.argv[1], join(process.cwd(), "resolver-do-pdf-parse.js")].filter(Boolean) as string[];
  for (const base of bases) {
    try {
      caminhoCacheado = createRequire(base).resolve("pdf-parse");
      return caminhoCacheado;
    } catch {
      // próxima base
    }
  }
  caminhoCacheado = null;
  return null;
}

/** Só para teste: o cache é global e sobreviveria entre casos com `process.cwd()` falseado. */
export function esquecerCaminhoDoPdfParse(): void {
  caminhoCacheado = undefined;
}

export async function parsePdfComTeto(buffer: Buffer, tetoMs: number): Promise<PdfParseResultado> {
  const { Worker } = await import("node:worker_threads");
  const modulo = await caminhoDoPdfParse();

  return await new Promise<PdfParseResultado>((resolve, reject) => {
    let encerrado = false;
    const encerrar = (fn: () => void) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(timer);
      fn();
    };

    let worker: import("node:worker_threads").Worker;
    const timer = setTimeout(() => {
      // `terminate()` mata a thread mesmo travada em CPU — é a diferença entre este caminho e o
      // `Promise.race` in-process, que nunca disparava nesses PDFs.
      encerrar(() => {
        void worker?.terminate();
        reject(new Error(`Timeout ao processar PDF (>${Math.round(tetoMs / 1000)}s) — o parser travou; arquivo provavelmente corrompido ou mal formado.`));
      });
    }, tetoMs);

    try {
      worker = new Worker(PDF_PARSE_WORKER_SRC, { eval: true, workerData: { buffer, modulo } });
    } catch (err) {
      // Falha SÍNCRONA ao montar a thread (runtime sem `worker_threads`). É falha de plataforma.
      encerrar(() => reject(new Error(`${MOTIVO_SEM_ISOLAMENTO}: ${err instanceof Error ? err.message : String(err)}`)));
      return;
    }

    worker.on("message", (msg: MensagemDoWorker) => {
      encerrar(() => {
        void worker.terminate();
        if (msg.ok) {
          resolve({ text: String(msg.text ?? ""), numpages: Number(msg.numpages ?? 0) });
        } else if (msg.infra) {
          reject(new Error(`${MOTIVO_SEM_ISOLAMENTO}: ${msg.erro ?? "require(pdf-parse) falhou no worker"}`));
        } else {
          // A mensagem CRUA do pdf-parse ("Invalid PDF structure", "Invalid XRef stream header").
          // É ela que chega ao `error_message` do documento e diz ao operador o que houve.
          reject(new Error(msg.erro ?? "Falha ao processar PDF no worker"));
        }
      });
    });

    // Falha ASSÍNCRONA de criação/execução da thread. Era por aqui que o `MODULE_NOT_FOUND` da
    // Fase 27 passava para ser engolido pelo catch externo.
    worker.on("error", (err) => {
      encerrar(() => {
        void worker.terminate();
        reject(new Error(`${MOTIVO_SEM_ISOLAMENTO}: ${err.message}`));
      });
    });

    worker.on("exit", (code) => {
      encerrar(() => reject(new Error(`${MOTIVO_SEM_ISOLAMENTO}: worker de PDF encerrou com código ${code} sem responder`)));
    });
  });
}
