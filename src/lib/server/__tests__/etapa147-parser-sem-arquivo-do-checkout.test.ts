/**
 * Etapa 147 (Fase 28, commit 1) — o parse isolado não depende de NENHUM arquivo do checkout.
 *
 * ═══ O bug que este teste existe para pegar ═══
 * A Fase 27 pôs `pdf-parse` num worker para o teto virar real. O worker era carregado por caminho
 * montado em runtime — `join(process.cwd(), "src", "lib", "server", "pdf-parse-worker.cjs")` — e
 * para o webpack e o `@vercel/nft` isso são três strings, não uma dependência. Medido no build:
 * dos 183 `.nft.json`, NENHUM cita o `.cjs`, enquanto o trace da rota da esteira (895 arquivos)
 * inclui os 11 de `node_modules/pdf-parse`. O arquivo estava no repositório e não na função.
 *
 * O `new Worker` falhava com `MODULE_NOT_FOUND` num evento ASSÍNCRONO, o catch externo testava uma
 * regex que essa mensagem não casa, e o código caía no parse in-process — o caminho que trava a
 * CPU e mata a run. Em produção: 15 documentos presos, "90s sem resposta" na rodada 10, e
 * `encerrados: 0`. Silencioso do começo ao fim.
 *
 * ═══ Por que o teste da Fase 27 passou verde sobre isso ═══
 * `etapa144` verificava `existsSync` do `.cjs` NO CHECKOUT — nunca no deploy — e exercitava
 * `terminate()` com `{eval:true}`, um caminho DIFERENTE do que produção usava. Mecanismo testado
 * ≠ mecanismo em produção é o defeito de fundo, e é por isso que aqui os testes importam as MESMAS
 * funções que a rota chama.
 *
 * ═══ O sentinela ═══
 * Todo este arquivo roda com `pdf-parse` mockado para EXPLODIR. O worker é uma thread Node com
 * registro de módulos próprio: `vi.mock` não o alcança. Essa assimetria é o que discrimina "rodou
 * isolado" de "rodou in-process" — sem flag, sem grep, sem confiar em log.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, existsSync, mkdtempSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parsePdfComTeto,
  caminhoDoPdfParse,
  esquecerCaminhoDoPdfParse,
  MOTIVO_SEM_ISOLAMENTO,
} from "@/lib/server/pdf-parse-isolado";
import {
  tetoDoParse,
  TETO_PARSE_MS,
  PARSE_MINIMO_MS,
  CUSTO_FIXO_DO_JOB_MS,
  RESERVA_POR_JOB_MS,
} from "@/lib/server/orcamento-do-parse";
import { TETO_FATIA, MARGEM_PARTIDA_MS } from "@/lib/server/esteira-reservas";
import { analyzeUploadPdf } from "@/lib/server/upload-analysis";

vi.mock("pdf-parse", () => ({
  default: async () => {
    throw new Error("FALLBACK_IN_PROCESS: o parse rodou no processo principal, sem teto real");
  },
}));

const RAIZ = join(__dirname, "../../../..");
const ATA_ANM = readFileSync(join(RAIZ, "src/lib/server/__tests__/fixtures/votos/anm-ata-82-ordinaria.pdf"));
/** PDF com header válido e miolo destruído: os guards de magic bytes e de streams o deixam passar. */
const TRUNCADO = Buffer.concat([ATA_ANM.subarray(0, 200), Buffer.from("%%EOF")]);

const DIRETORIO_VAZIO = mkdtempSync(join(tmpdir(), "iris-sem-checkout-"));

afterEach(() => {
  vi.restoreAllMocks();
  esquecerCaminhoDoPdfParse();
});

describe("etapa147 · o parse isolado sobrevive a um checkout que não existe", () => {
  it("com o cwd apontado para um diretório VAZIO, a ata da ANM ainda é lida", async () => {
    // É o cenário da Lambda: `src/` não existe, e `process.cwd()` não leva a lugar nenhum útil.
    //
    // O QUE ESTE CASO NÃO PROVA, para não ser lido como mais do que é: `vi.spyOn(process,"cwd")`
    // vale só na thread PAI. A thread do worker enxerga o cwd de verdade, então um
    // `require("pdf-parse")` bare ainda resolveria aqui. O que ele prova é o bug da Fase 27 —
    // o PAI não precisa mais de nenhum arquivo de `src/` — e é o caso "caminho ABSOLUTO", abaixo,
    // que cobre a resolução do módulo. O layout de `/var/task` na Lambda não é testável localmente:
    // a defesa lá é o motivo nomeado `parser_sem_isolamento` chegando ao banco.
    esquecerCaminhoDoPdfParse();
    vi.spyOn(process, "cwd").mockReturnValue(DIRETORIO_VAZIO);
    const r = await parsePdfComTeto(ATA_ANM, 20_000);
    expect(r.numpages).toBe(12);
    expect(r.text).toContain("AGÊNCIA NACIONAL DE MINERAÇÃO");
  }, 30_000);

  it("`pdf-parse` é resolvido por caminho ABSOLUTO, sem passar pelo cwd", async () => {
    esquecerCaminhoDoPdfParse();
    vi.spyOn(process, "cwd").mockReturnValue(DIRETORIO_VAZIO);
    const caminho = await caminhoDoPdfParse();
    expect(caminho).toBeTruthy();
    expect(existsSync(caminho as string)).toBe(true);
  });

  it("nenhum arquivo do projeto é procurado em disco no caminho de produção", () => {
    const iso = readFileSync(join(RAIZ, "src/lib/server/pdf-parse-isolado.ts"), "utf-8");
    // `new Worker(<caminho>)` é a forma que o bundler não rastreia. A fonte vem do bundle.
    expect(iso).toMatch(/new Worker\(PDF_PARSE_WORKER_SRC, \{ eval: true/);
    expect(iso).not.toMatch(/pdf-parse-worker\.cjs/);
    expect(existsSync(join(RAIZ, "src/lib/server/pdf-parse-worker.cjs"))).toBe(false);
  });
});

describe("etapa147 · o motivo REAL chega a quem decide, em vez de virar frase genérica", () => {
  it("erro de DENTRO do worker sobe com a mensagem do pdf-parse", async () => {
    // Medido: `pdf-parse` devolve exatamente "Invalid PDF structure" neste buffer.
    await expect(parsePdfComTeto(TRUNCADO, 20_000)).rejects.toThrow(/Invalid PDF structure/);
  }, 30_000);

  it("…e não é confundido com falha do parse isolado", async () => {
    // A distinção importa: "o PDF é ruim" encerra o documento; "o worker não subiu" é falha de
    // plataforma e põe a RUN em risco. Na Fase 27 as duas viravam a mesma coisa.
    await expect(parsePdfComTeto(TRUNCADO, 20_000)).rejects.not.toThrow(
      new RegExp(MOTIVO_SEM_ISOLAMENTO),
    );
  }, 30_000);

  it("a análise repassa o motivo em vez de apagá-lo", async () => {
    const r = await analyzeUploadPdf({
      file: { name: "truncado.pdf", buffer: TRUNCADO, source_archive: null, size: TRUNCADO.length },
      agencias: [],
    });
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/Invalid PDF structure/);
  }, 30_000);

  it("o teto é cobrável — e a mensagem diz que foi o parser que travou", async () => {
    await expect(parsePdfComTeto(ATA_ANM, 1)).rejects.toThrow(/Timeout ao processar PDF/);
  }, 30_000);
});

describe("etapa147 · a fatia cobre a reserva interna do parse (regra de orçamento do CLAUDE.md)", () => {
  it.each([
    [undefined, TETO_PARSE_MS],           // upload avulso: teto absoluto
    [60_000, TETO_PARSE_MS],              // fatia folgada: o teto absoluto ainda manda
    [RESERVA_POR_JOB_MS, PARSE_MINIMO_MS], // no piso de admissão: exatamente o mínimo
    [CUSTO_FIXO_DO_JOB_MS, 0],            // só dá para o custo fixo: parse nenhum
    [3_000, -3_000],                      // negativo: quem chama recusa e devolve o job
  ])("restante=%s → teto %i", (restante, esperado) => {
    const agora = 1_000_000;
    const deadline = restante === undefined ? undefined : agora + (restante as number);
    expect(tetoDoParse(deadline, agora)).toBe(esperado);
  });

  it("a reserva de partida é EXATAMENTE o que um job precisa — nem menos (o bug) nem mais", () => {
    // Piso: admitir um job com menos que isto é admiti-lo para não terminar. Era 9_000 para um
    // parse de teto 25_000 — a violação que a Fase 7 nomeou e que sobreviveu 21 fases.
    expect(RESERVA_POR_JOB_MS).toBeGreaterThanOrEqual(CUSTO_FIXO_DO_JOB_MS + PARSE_MINIMO_MS);
    // Teto: 4 jobs em voo (`processQueue(selected, 4, …)`) têm de caber na fatia da extração.
    expect(4 * RESERVA_POR_JOB_MS).toBeLessThanOrEqual(TETO_FATIA.extracao + MARGEM_PARTIDA_MS);
    // E o piso de admissão entrega exatamente a reserva interna: a invariante, não a coincidência.
    expect(tetoDoParse(1_000_000 + RESERVA_POR_JOB_MS, 1_000_000)).toBe(PARSE_MINIMO_MS);
  });

  it("o piso do parse tem folga sobre o pior PDF real do corpus (199 ms nas 16 fixtures)", () => {
    expect(PARSE_MINIMO_MS).toBeGreaterThanOrEqual(199 * 30);
  });
});

/**
 * ═══ O SEGUNDO buraco da mesma família, achado medindo o build ═══
 * Ao remover o fallback in-process eu removi, sem perceber, a ÚLTIMA referência estática a
 * `pdf-parse` no grafo de módulos — o `await import("pdf-parse")` que só existia lá. Medido:
 * o trace do build caiu de **23 rotas com `pdf-parse` para ZERO**. A função subiria sem a
 * biblioteca e TODO documento falharia com `parser_sem_isolamento`, porque o `require` do worker
 * é uma string em runtime, invisível ao file-tracing.
 *
 * Nenhum teste de unidade pega isso: `pdf-parse` está no `node_modules` local, então tudo passa
 * verde aqui e quebra só no deploy. O único instrumento possível é ler o artefato do build.
 */
describe("etapa147 · a biblioteca de PDF chega à função — o que só o BUILD pode dizer", () => {
  const NEXT = join(RAIZ, ".next/server");

  function tracesDoBuild(): string[] {
    const achados: string[] = [];
    const andar = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) andar(caminho);
        else if (nome.endsWith(".nft.json")) achados.push(caminho);
      }
    };
    andar(NEXT);
    return achados;
  }

  it.runIf(existsSync(NEXT))("o build empacota `pdf-parse` nas rotas que parseiam PDF", () => {
    const traces = tracesDoBuild();
    expect(traces.length).toBeGreaterThan(50); // sanidade: o build é deste projeto
    const comPdfParse = traces.filter((t) =>
      (JSON.parse(readFileSync(t, "utf-8")).files as string[])
        .some((f) => f.includes("node_modules/pdf-parse")),
    );
    // Medido no baseline (HEAD da Fase 27) e depois do conserto: 23 de 183.
    expect(comPdfParse.length).toBeGreaterThanOrEqual(20);
  });

  it("a aresta estática que o tracer segue está declarada e comentada", () => {
    // Guard de forma, não prova de comportamento — a prova é o caso acima, sobre o build. Este
    // existe porque o `import` parece inútil na leitura e some num "limpar imports não usados".
    const iso = readFileSync(join(RAIZ, "src/lib/server/pdf-parse-isolado.ts"), "utf-8");
    expect(iso).toMatch(/await import\("pdf-parse"\)/);
    expect(iso).toMatch(/NÃO REMOVER/);
  });
});
