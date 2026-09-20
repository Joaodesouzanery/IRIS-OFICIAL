/**
 * Etapa 155 (Fase 29, commit 3) — uma invocação por execução, e o cliente espera a rodada inteira.
 *
 * ═══ O buraco, em uma linha ═══
 * O guard de concorrência era `if (ativa && corpo.run_id && ativa.id !== corpo.run_id)`. Quando o
 * cliente aborta aos 90 s, ele re-dispara a rodada seguinte com o MESMO `run_id`: os ids batem, o
 * 409 não sai, e duas invocações passam a trabalhar sobre as mesmas linhas. É o cenário que o
 * CLAUDE.md descreve e que a esteira vinha pagando em silêncio há fases.
 *
 * Buraco irmão no mesmo `if`: com `corpo.run_id` AUSENTE e uma run ativa, a condição também é
 * falsa — uma aba nova ENTRAVA na run da outra aba, sem avisar ninguém.
 *
 * ⚠️ Os dois consertos vão no MESMO commit de propósito. Subir o teto do cliente sem a cerca é
 * afrouxamento sem rede: a rodada que passar de 110 s voltaria a produzir duas invocações, só que
 * 20 s mais tarde.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { resultadoDoClaim, MOTIVO_OCUPADA } from "@/lib/server/cerca-da-run";
import { timeoutDaRota } from "@/lib/api";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

describe("etapa155 · o veredito da cerca", () => {
  it.each([
    ["token igual ao banco — é a vez desta invocação", 7, 7, "reivindicada"],
    ["token já consumido (o caso do abort)", 8, 7, "ocupada"],
    ["token à frente do banco — não existe", 7, 9, "ocupada"],
    ["sem tabela de execuções: degrada, roda como antes", null, 3, "sem_lock"],
    ["sem token: degrada", 3, null, "sem_lock"],
  ] as Array<[string, number | null, number | null, string]>)(
    "%s", (_nome, rodadasNoBanco, token, esperado) => {
      expect(resultadoDoClaim({ rodadasNoBanco, token })).toBe(esperado);
    },
  );

  it("o 409 diz o que aconteceu — «erro» sem causa manda o operador adivinhar", () => {
    expect(MOTIVO_OCUPADA).toMatch(/Outra invocação desta execução/);
  });
});

describe("etapa155 · a cerca é um compare-and-set, e só ela incrementa o token", () => {
  const ESTEIRA = ler("src/lib/server/esteira-run.ts");
  const ROTA = ler("src/app/api/v1/pipeline/run/route.ts");

  it("o UPDATE filtra pelo token — sem isso as duas invocações ganham", () => {
    const claim = ESTEIRA.slice(ESTEIRA.indexOf("export async function reivindicarRodada"));
    expect(claim).toMatch(/\.eq\("id", runId\)/);
    expect(claim).toMatch(/\.eq\("status", "running"\)/);
    expect(claim).toMatch(/\.eq\("rodadas", token\)/);
    expect(claim).toMatch(/rodadas: token \+ 1/);
  });

  it("⚠️ `registrarRodada` NÃO incrementa mais — dois incrementos fariam o token pular", () => {
    const registrar = ESTEIRA.slice(ESTEIRA.indexOf("export async function registrarRodada"));
    expect(registrar).not.toMatch(/rodadas: \(run\.rodadas \?\? 0\) \+ 1/);
    expect(registrar).toMatch(/NÃO é incrementado aqui/);
  });

  it("a rota reivindica ANTES de trabalhar, e devolve 409 quando perde", () => {
    expect(ROTA).toMatch(/rodadaReivindicada = await reivindicarRodada\(db, execucao\.id, tokenDaRodada\)/);
    expect(ROTA).toMatch(/MOTIVO_OCUPADA[\s\S]{0,140}?status: 409/);
    // O claim vem antes do planejamento da rodada: reivindicar depois de trabalhar não serve.
    const iClaim = ROTA.indexOf("reivindicarRodada(db, execucao.id");
    const iPlano = ROTA.indexOf("const { passos: planoDaRodada, protecao } = planejarRodada(");
    expect(iClaim).toBeGreaterThan(-1);
    expect(iPlano).toBeGreaterThan(iClaim);
  });

  it("o plano e o desfecho usam o TOKEN, não o contador do banco — o giro não muda", () => {
    // `planejarRodada(rodada, …)` é pura: com o token seguindo 0,1,2,… as medições de 24 rodadas
    // da etapa119 e as da etapa94 continuam descrevendo o mesmo sistema.
    expect(ROTA).toMatch(/planejarRodada\(\s*\n?\s*rodadaAtual,/);
    expect(ROTA).toMatch(/rodada: rodadaAtual,/);
  });

  it("a resposta devolve o token — sem isso o cliente não tem como fechar a cerca", () => {
    expect(ROTA).toMatch(/rodadas: rodadaReivindicada \?\? execucao\?\.rodadas \?\? null/);
  });
});

describe("etapa155 · o cliente espera a rodada inteira, e só na esteira", () => {
  it.each([
    ["/pipeline/run", 110_000],
    ["/pipeline/run?x=1", 110_000],
    ["/pipeline/status", 90_000],
    ["/deliberacoes", 90_000],
  ])("%s → %i ms", (path, esperado) => {
    expect(timeoutDaRota(path)).toBe(esperado);
  });

  it("a mensagem diz o número que ELA esperou, não um fixo", () => {
    const API = ler("src/lib/api.ts");
    expect(API).toMatch(/const tetoMs = timeoutDaRota\(path\)/);
    expect(API).toMatch(/A requisição passou de \$\{tetoMs \/ 1000\}s sem resposta/);
    expect(API).not.toMatch(/passou de \$\{REQUEST_TIMEOUT_MS \/ 1000\}s/);
  });

  it("110s fica ABAIXO do maxDuration declarado — nunca disputa com o kill da plataforma", () => {
    const vercel = JSON.parse(ler("vercel.json")) as { functions: Record<string, { maxDuration?: number }> };
    const daEsteira = vercel.functions["src/app/api/v1/pipeline/run/route.ts"]?.maxDuration;
    expect(daEsteira).toBe(120);
    expect(timeoutDaRota("/pipeline/run")).toBeLessThan(daEsteira! * 1000);
    // …e ACIMA da rodada legítima mais longa: auth (≤10s) + HOBBY_BUDGET_MS (70s) + flush.
    expect(timeoutDaRota("/pipeline/run")).toBeGreaterThan(10_000 + 70_000 + 5_000);
  });
});

describe("etapa155 · 409 não é falha — é a cerca trabalhando", () => {
  const TELA = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");

  it("o cliente devolve o token na chamada seguinte", () => {
    expect(TELA).toMatch(/rodadas_vistas: rodadasVistas/);
    expect(TELA).toMatch(/rodadasVistas = typeof res\.rodadas === "number"/);
  });

  it("409 não incrementa `falhasSeguidas` — senão a esteira fecharia trabalhando", () => {
    // ⚠️ Ancorar no laço DA ESTEIRA: o arquivo tem outros `catch (err)`, e pegar o primeiro
    // mediria outro bloco.
    const inicio = TELA.indexOf("const corpoDaRodada");
    const captura = TELA.slice(inicio, inicio + 3_000);
    expect(inicio, "laço da esteira não encontrado").toBeGreaterThan(-1);
    expect(captura).toMatch(/err instanceof ApiError && err\.status === 409/);
    const i409 = captura.indexOf("err.status === 409");
    const iFalhas = captura.indexOf("falhasSeguidas++");
    expect(i409).toBeLessThan(iFalhas); // o ramo do 409 sai antes de contar falha
    expect(captura).toMatch(/rodada--;/); // a rodada que não aconteceu não consome o laço
  });

  it("…mas não insiste para sempre: três 409 seguidos param com motivo", () => {
    expect(TELA).toMatch(/tentativasDeCerca >= 3/);
  });
});
