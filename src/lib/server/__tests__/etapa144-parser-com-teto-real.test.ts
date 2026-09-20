/**
 * Etapa 144 (Fase 27, commit 1) — o teto do parser é REAL, e o 3º ciclo tem desfecho.
 *
 * ═══ O mecanismo, medido ═══
 * 10 documentos presos (9 da ANM, pautas de 2023-2024; 1 da ARTESP), todos `page_count: null` —
 * nenhum chegou a completar um parse. O teto de 25s e a corrida contra a fatia (Fase 26) são
 * `setTimeout`, e `pdf-parse` é SÍNCRONO: com o event loop travado em CPU nenhum timer dispara.
 * Só o SIGKILL encerrava, e cada retentativa custava a rodada ("90s sem resposta" na rodada 10).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { Worker } from "node:worker_threads";
import { desfechoDoReprocesso, CICLOS_DE_REPROCESSO } from "@/lib/server/reprocesso-desfecho";

const RAIZ = join(__dirname, "../../../..");

describe("etapa144 · terminate() corta um laço de CPU; setTimeout não cortaria", () => {
  // Este caso prova a CAPACIDADE do runtime: `terminate()` corta um laço de CPU que nenhum
  // `setTimeout` cortaria. A partir da Fase 28 ele exercita o mesmo mecanismo de produção
  // (`{eval:true}`), o que na Fase 27 não era verdade — produção usava `new Worker(caminho)`.
  it("um worker em `while(true)` é encerrado dentro do teto", async () => {
    const worker = new Worker("while (true) {}", { eval: true });
    const t0 = Date.now();
    const desfecho = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => { void worker.terminate(); resolve("terminado"); }, 300);
      worker.on("exit", () => { clearTimeout(timer); resolve("saiu"); });
    });
    expect(desfecho).toBe("terminado");
    expect(Date.now() - t0).toBeLessThan(3_000);
  }, 10_000);

  // Fase 28 — o `it` que verificava `existsSync` do `.cjs` FOI REMOVIDO. Ele afirmava que o worker
  // existia NO CHECKOUT, e era exatamente isso que o tornava um falso-verde: o arquivo estava no
  // repositório e nunca chegou à Lambda, porque o caminho era montado em runtime e o file-tracing
  // do Vercel não rastreia string concatenada. Quem cobre o mecanismo de verdade é a etapa147, que
  // exercita o MESMO código que produção chama, com o cwd apontado para um diretório vazio.
  it("o extrator usa o parse isolado, com teto derivado da fatia", () => {
    const ext = readFileSync(join(RAIZ, "src/lib/server/pdf-extractor.ts"), "utf-8");
    expect(ext).toMatch(/parsePdfComTeto\(buffer, teto\)/);
    expect(ext).not.toMatch(/pdfParse\(buffer\)/);
    const iso = readFileSync(join(RAIZ, "src/lib/server/pdf-parse-isolado.ts"), "utf-8");
    expect(iso).toMatch(/worker\.terminate\(\)/);
  });
});

describe("etapa144 · o 3º ciclo tem desfecho, por tipo", () => {
  it.each([
    ["pauta", 3, "arquivar"],
    ["documento", 3, "arquivar"],
    ["ata", 3, "encerrar"],
    ["deliberacao", 3, "encerrar"],
    ["voto_individual", 3, "encerrar"],
    ["ata", 0, "retentar"],
    ["pauta", 2, "retentar"],
  ] as Array<[string, number, string]>)("%s no ciclo %i → %s", (tipo, ciclos, acao) => {
    expect(desfechoDoReprocesso({ tipo, ciclos }).acao).toBe(acao);
  });

  it("retentar diz o PRÓXIMO ciclo (o contador não pode repetir)", () => {
    const d = desfechoDoReprocesso({ tipo: "ata", ciclos: 1 });
    expect(d).toEqual({ acao: "retentar", ciclo: 2 });
    expect(CICLOS_DE_REPROCESSO).toBe(3);
  });

  it("encerrar diz o que FAZER — motivo sem instrução é silêncio com outro nome", () => {
    const d = desfechoDoReprocesso({ tipo: "ata", ciclos: 3 });
    expect(d.acao === "encerrar" && d.motivo).toMatch(/reenviar o PDF convertido ou dividido/);
  });

  it("o encerrado não volta ao laço, e os dois desfechos chegam ao banner", () => {
    const run = readFileSync(join(RAIZ, "src/app/api/v1/pipeline/run/route.ts"), "utf-8");
    expect(run).toMatch(/\.is\("campos_detectados->reprocesso_encerrado", null\)/);
    expect(run).toMatch(/arquivados_parser_travou/);
    const tela = readFileSync(join(RAIZ, "src/app/dashboard/deliberacoes/votos-diretores/page.tsx"), "utf-8");
    expect(tela).toMatch(/totais\.reprocessos_encerrados/);
    expect(tela).toMatch(/totais\.arquivados_parser_travou/);
  });
});
