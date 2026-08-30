/**
 * Etapa 80 (Fase 12) — as pendências aprovadas da Fase 11, com as classes fechadas.
 *
 * (a) "97 reclassificado(s)" era número FALSO: dois passos gravavam a mesma chave numérica
 *     (`reenfileirados`) e o acumulador de `esteira_runs` soma toda chave homônima — o banner
 *     somava reclassificação com desarquivamento. Agora cada passo tem chave própria e a tela
 *     mostra os dois números.
 * (b) o guard anti-ping-pong disparava também quando a aprovação NEM FOI OFERECIDA (contador 0
 *     dos dois jeitos, sob o plano da rodada). Desarquivar rodava 28/40 rodadas contra 12 do
 *     arquivador — o moinho da Fase 7 por outra porta.
 * (c) quando o laço do cliente parava (teto/erros), a run ficava `running` por 3min e virava
 *     "erro" fantasma — os dois banners contraditórios. Agora o cliente ENCERRA.
 * (d) orçamento 70s: o teto de 60s nunca foi medido; o limite operante é o abort de 90s do
 *     CLIENTE (que não mata a função — acima de ~86s haveria duas invocações na mesma run).
 *     E a CLASSE: rota que honra o orçamento não pode declarar `maxDuration` MENOR que ele —
 *     pediria o kill da plataforma antes de o próprio orçamento parar o trabalho.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { HOBBY_BUDGET_MS } from "@/lib/server/time-budget";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const RUN = ler("src/app/api/v1/pipeline/run/route.ts");
const TELA = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");

describe("etapa80 · (a) o número falso virou dois números honestos", () => {
  it("nenhum passo do orquestrador grava mais a chave `reenfileirados` numa etapa", () => {
    const codigo = semComentarios(RUN);
    // A chave pode ser LIDA do corpo da sub-rota (r.body?.reenfileirados), nunca GRAVADA.
    expect(codigo).not.toMatch(/\{ reenfileirados[,:]|reenfileirados: requeued/);
    expect(codigo).toMatch(/reclassificados: requeued/);
    expect(codigo).toMatch(/desarquivados: reenfileirados/);
  });

  it("a tela mostra os dois, separados", () => {
    const codigo = semComentarios(TELA);
    expect(codigo).toMatch(/totais\.reclassificados[\s\S]{0,80}?reclassificado\(s\)/);
    expect(codigo).toMatch(/totais\.desarquivados[\s\S]{0,80}?desarquivado\(s\)/);
    expect(codigo).not.toMatch(/totais\.reenfileirados/);
  });
});

describe("etapa80 · (b) o guard anti-ping-pong exige aprovação TENTADA", () => {
  it("desarquivar só roda quando o arquivador foi tentado e não arquivou", () => {
    const codigo = semComentarios(RUN);
    expect(codigo).toMatch(/const aprovacaoFoiTentada = !\("fora_do_plano" in \(etapas\.aprovacao \?\? \{\}\)\)/);
    expect(codigo).toMatch(/aprovacaoFoiTentada && arquivouAgora === 0 && cabe\("recuperacao"\)/);
    // A forma antiga — só o contador — não pode voltar.
    expect(codigo).not.toMatch(/if \(arquivouAgora === 0 && cabe\("recuperacao"\)\)/);
  });
});

describe("etapa80 · (c) o cliente encerra a run ao parar", () => {
  it("a rota tem o ramo `encerrar`, idempotente e ANTES de iniciar run nova", () => {
    const codigo = semComentarios(RUN);
    const iEncerrar = codigo.indexOf("if (corpo.encerrar && corpo.run_id)");
    const iIniciar = codigo.indexOf("iniciarRun(db, origem)");
    expect(iEncerrar).toBeGreaterThan(-1);
    expect(iEncerrar).toBeLessThan(iIniciar);
    expect(codigo).toMatch(/fecharRun\(db, corpo\.run_id, "concluido"/);
  });

  it("o laço do cliente avisa nos desfechos em que o SERVIDOR não fechou (teto/erros)", () => {
    const codigo = semComentarios(TELA);
    expect(codigo).toMatch(/desfecho === "teto" \|\| desfecho === "erros"/);
    expect(codigo).toMatch(/encerrar: true/);
  });
});

describe("etapa80 · (d) orçamento 70s, e a CLASSE do maxDuration", () => {
  it("HOBBY_BUDGET_MS é 70s — sob os ~86s seguros do abort do cliente", () => {
    expect(HOBBY_BUDGET_MS).toBe(70_000);
    // O teto do cliente (api.ts) tem de ficar ACIMA do orçamento + folga de flush.
    const api = ler("src/lib/api.ts");
    const m = /REQUEST_TIMEOUT_MS = ([\d_]+)/.exec(api);
    expect(m).not.toBeNull();
    expect(Number(m![1].replace(/_/g, ""))).toBeGreaterThanOrEqual(HOBBY_BUDGET_MS + 15_000);
  });

  it("TABULAR: rota que honra o orçamento não declara maxDuration menor que ele", () => {
    // A classe: `maxDuration = 60` numa rota de orçamento 70s pede o kill da plataforma ANTES
    // de o próprio orçamento parar o trabalho — o SIGKILL não grava nem success nem error.
    const api = join(RAIZ, "src/app/api");
    const rotas: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (e === "route.ts") rotas.push(p);
      }
    };
    walk(api);
    expect(rotas.length).toBeGreaterThan(30);
    for (const p of rotas) {
      const fonte = readFileSync(p, "utf-8");
      if (!/budgetFromRequest\(|HOBBY_BUDGET_MS/.test(fonte)) continue;
      const m = /export const maxDuration = (\d+)/.exec(fonte);
      if (!m) continue; // sem declaração in-file, vale o vercel.json/plataforma
      expect(
        Number(m[1]) * 1000,
        `${p.slice(p.indexOf("api/"))} declara maxDuration ${m[1]}s < orçamento ${HOBBY_BUDGET_MS / 1000}s`,
      ).toBeGreaterThanOrEqual(HOBBY_BUDGET_MS + 10_000);
    }
  });
});
