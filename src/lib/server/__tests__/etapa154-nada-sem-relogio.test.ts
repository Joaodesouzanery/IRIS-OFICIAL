/**
 * Etapa 154 (Fase 29, commit 2) — nada no caminho quente roda sem relógio.
 *
 * ═══ Os dois buracos, medidos ═══
 * **1.** `createSupabaseServerClient` nunca configurou `global.fetch`. O `SupabaseClient` injeta
 * esse fetch no postgrest, no storage E no auth — então nenhum round-trip do caminho quente tinha
 * teto: nem os ~10 `db.auth.getUser` que cada rodada paga, nem os SELECT/UPDATE dos reapers, nem o
 * download do PDF. Qualquer um travando deixava a função viva, o cliente abortava aos 90 s e
 * disparava a rodada seguinte sobre a MESMA run.
 *
 * **2.** O download do Storage era feito SEM teto e FORA da corrida contra o relógio, e o
 * `restanteMs` do race era medido ANTES dele:
 *
 *     t_A          : restanteMs = deadlineAt − t_A − 1.500
 *     t_A → t_A+D  : download, sem teto
 *     dispara em   : deadlineAt + D − 1.500   ← a ultrapassagem É a duração do download
 *
 * Com 4 jobs em voo, cada onda partia atrasada da anterior: o atraso ACUMULAVA ao longo da fatia.
 * Era isso que fazia a rodada passar dos 90 s mesmo depois de o parser ganhar teto real na Fase 28.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fetchComTeto, SUPABASE_RPC_TIMEOUT_MS } from "@/lib/supabase/fetch-com-teto";
import {
  tetoDoDownload,
  tetoDoParse,
  TETO_DOWNLOAD_MS,
  TETO_DOWNLOAD_MIN_MS,
  CUSTO_DE_GRAVACAO_MS,
  CUSTO_FIXO_DO_JOB_MS,
  PARSE_MINIMO_MS,
  RESERVA_POR_JOB_MS,
} from "@/lib/server/orcamento-do-parse";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("etapa154 · o fetch do Supabase tem corte", () => {
  // ⚠️ O `fetch` real REJEITA quando o signal aborta. Um duplo que ignora o signal não modela o
  // contrato e faria o teste pendurar em vez de medir — exatamente o erro que ele existe para
  // pegar noutro lugar.
  const nuncaResolve: typeof fetch = (_e: any, init?: any) =>
    new Promise<Response>((_, reject) => {
      const s: AbortSignal | undefined = init?.signal;
      s?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
  const respondeJa: typeof fetch = async () => new Response("ok");

  it("passa reto quando o round-trip é normal", async () => {
    await expect(fetchComTeto(respondeJa, 10_000)("http://x")).resolves.toBeInstanceOf(Response);
  });

  it("corta o que trava, e diz quantos segundos esperou", async () => {
    vi.useFakeTimers();
    const p = fetchComTeto(nuncaResolve, 10_000)("http://x");
    const capturado = p.then(() => "resolveu", (e: unknown) => String((e as Error)?.message ?? e));
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await capturado).toMatch(/excedeu 10s/);
  });

  it("o abort do CHAMADOR vence e sobe como veio — não vira mensagem de teto", async () => {
    vi.useFakeTimers();
    const c = new AbortController();
    const p = fetchComTeto(nuncaResolve, 10_000)("http://x", { signal: c.signal });
    const capturado = p.then(() => "resolveu", (e: unknown) => String((e as Error)?.message ?? e));
    c.abort(new Error("cancelado pelo chamador"));
    await vi.advanceTimersByTimeAsync(1);
    expect(await capturado).not.toMatch(/Round-trip do Supabase/);
  });

  it("teto ≤ 0 devolve o fetch original — porta de saída sem ramo no chamador", () => {
    expect(fetchComTeto(respondeJa, 0)).toBe(respondeJa);
    expect(fetchComTeto(respondeJa, -1)).toBe(respondeJa);
  });

  it("⚠️ o client INJETA esse fetch — sem isso o módulo é decorativo", () => {
    const server = ler("src/lib/supabase/server.ts");
    expect(server).toMatch(/global: \{ fetch: fetchComTeto\(fetch, SUPABASE_RPC_TIMEOUT_MS\) \}/);
    expect(server).toMatch(/NÃO REMOVER/);
    // Piso de segurança, não orçamento: maior que a página de 1.000 linhas do `lerTudo`.
    expect(SUPABASE_RPC_TIMEOUT_MS).toBeGreaterThanOrEqual(5_000);
    expect(SUPABASE_RPC_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
  });
});

describe("etapa154 · o download tem teto derivado da fatia", () => {
  it.each([
    [undefined, TETO_DOWNLOAD_MS],              // upload avulso: teto absoluto
    [60_000, TETO_DOWNLOAD_MS],                 // fatia folgada: o absoluto ainda manda
    [RESERVA_POR_JOB_MS, TETO_DOWNLOAD_MIN_MS], // no piso de admissão: exatamente o mínimo
    [9_000, 0],                                 // só dá para o parse mínimo e a gravação
    [8_000, -1_000],                            // negativo: quem chama recusa o job
  ])("restante=%s → teto %i", (restante, esperado) => {
    const agora = 1_000_000;
    const deadline = restante === undefined ? undefined : agora + (restante as number);
    expect(tetoDoDownload(deadline, agora)).toBe(esperado);
  });

  it("a decomposição do custo fixo SOMA o mesmo de antes — a etapa140 não muda", () => {
    expect(TETO_DOWNLOAD_MIN_MS + CUSTO_DE_GRAVACAO_MS).toBe(CUSTO_FIXO_DO_JOB_MS);
    expect(RESERVA_POR_JOB_MS).toBe(13_000);
  });

  it("as duas invariantes fecham no piso de admissão, dos dois lados da conta", () => {
    const agora = 1_000_000;
    expect(tetoDoDownload(agora + RESERVA_POR_JOB_MS, agora)).toBe(TETO_DOWNLOAD_MIN_MS);
    expect(tetoDoParse(agora + RESERVA_POR_JOB_MS, agora)).toBe(PARSE_MINIMO_MS);
  });
});

describe("etapa154 · a corrida é medida DEPOIS do download, não antes", () => {
  const PIPELINE = ler("src/lib/server/pipeline.ts").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");

  it("a ordem no código: download → medição → corrida", () => {
    const iDownload = PIPELINE.indexOf('db.storage.from("pdfs").download(');
    const iMedicao = PIPELINE.indexOf("const restanteMs = deadlineAt !== undefined");
    const iCorrida = PIPELINE.indexOf("Promise.race([");
    expect(iDownload).toBeGreaterThan(-1);
    expect(iMedicao).toBeGreaterThan(iDownload); // ← o defeito era exatamente o contrário
    expect(iCorrida).toBeGreaterThan(iMedicao);
  });

  it("a aritmética do defeito, em número: medir antes empurra o timer pela duração do download", () => {
    const deadlineAt = 20_000;
    const D = 4_000; // duração do download
    const antes = deadlineAt - 0 - 1_500;                  // medido em t=0, como ERA
    const depois = deadlineAt - D - CUSTO_DE_GRAVACAO_MS;  // medido em t=D, como É
    // Medindo antes, o timer dispara 2.500 ms DEPOIS do deadline — e a ultrapassagem cresce com D.
    expect(D + antes).toBe(deadlineAt + D - 1_500);
    expect(D + antes).toBeGreaterThan(deadlineAt);
    // Medindo depois, ele dispara 2.000 ms ANTES — a folga exata que a gravação exige.
    expect(D + depois).toBe(deadlineAt - CUSTO_DE_GRAVACAO_MS);
    expect(D + depois).toBeLessThan(deadlineAt);
    expect(depois).toBe(14_000);
  });

  it("o download usa AbortSignal — o race não cancelaria o fetch, só deixaria de esperá-lo", () => {
    expect(PIPELINE).toMatch(/const abortarDownload = new AbortController\(\)/);
    expect(PIPELINE).toMatch(/\.download\(job\.storage_path, \{\}, \{ signal: abortarDownload\.signal \}\)/);
    expect(PIPELINE).toMatch(/const tetoDownload = tetoDoDownload\(deadlineAt\)/);
  });

  it("o estouro do download preserva o MOTIVO — senão o reaper marca SIGKILL sem causa", () => {
    expect(PIPELINE).toMatch(/Download do PDF excedeu \$\{Math\.round\(tetoDownload \/ 1000\)\}s/);
  });

  it("o literal 1_500 morreu — a gravação tem nome e mora com os irmãos", () => {
    expect(PIPELINE).toMatch(/deadlineAt - Date\.now\(\) - CUSTO_DE_GRAVACAO_MS/);
    expect(PIPELINE).not.toMatch(/deadlineAt - Date\.now\(\) - 1_500/);
  });
});

describe("etapa154 · o relógio da esteira nasce antes do auth", () => {
  it("`deadlineAt` vem ANTES de `requireAdminOrCron` — o round-trip entra no orçamento", () => {
    const run = ler("src/app/api/v1/pipeline/run/route.ts").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
    const iDeadline = run.indexOf("const deadlineAt = Date.now() + HOBBY_BUDGET_MS");
    const iGuard = run.indexOf('requireAdminOrCron(req, "pipeline/run")');
    expect(iDeadline).toBeGreaterThan(-1);
    expect(iGuard).toBeGreaterThan(iDeadline);
  });
});
