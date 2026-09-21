/**
 * Etapa 158 (Fase 30, commit 1) — o cron da esteira sai, e a justificativa é MEDIDA.
 *
 * ═══ Motivo 1: ele adotava a run da tela ═══
 * O Vercel Cron dispara **GET**, e GET não tem corpo — `req.json().catch(() => ({}))` devolve `{}`,
 * então `run_id` e `rodadas_vistas` são ambos `undefined`. Esse é precisamente o padrão que a rota
 * trata como "abrir ou continuar": sem `run_id` o guard de identidade é falso e a invocação ADOTA
 * a run ativa; sem `rodadas_vistas` o token vem do valor corrente do banco e VENCE o
 * compare-and-set. A aba do usuário, segurando o token anterior, toma 409 até desistir.
 *
 * Em produção isso derrubou a run `72b4534a`, que tinha **32 passos ok e ZERO erros**, a 42,8 s por
 * rodada. O motivo gravado foi a mensagem da própria cerca.
 *
 * ═══ Motivo 2: ele nunca ingeriu nada — e isto deixa de ser frase ═══
 * `docs/PENDENCIAS.md` registrava "o cron diário nunca ingeriu nada" como prosa. Aqui vira
 * medição: uma invocação por dia é sempre a rodada 0, porque a run anterior morre de órfã em 3
 * minutos. E a rodada 0 SEM drenagem não planeja nenhum dos três passos de ingestão.
 *
 * ⚠️ A ROTA continua existindo e continua aceitando cron autenticado. Religar o agendamento é uma
 * linha no `vercel.json` — o que sai é o disparo, não a capacidade.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { planejarRodada, ORDEM_DOS_PASSOS } from "@/lib/server/esteira-reservas";
import { HOBBY_BUDGET_MS } from "@/lib/server/time-budget";
import { FOLGA_ORQUESTRADOR_MS } from "@/lib/server/esteira-reservas";
import { RUN_ORFAO_MS } from "@/lib/server/esteira-run";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const ORCAMENTO = HOBBY_BUDGET_MS - FOLGA_ORQUESTRADOR_MS;

describe("etapa158 · o agendamento saiu, a capacidade não", () => {
  it("`vercel.json` não agenda mais a esteira", () => {
    const vercel = JSON.parse(ler("vercel.json")) as { crons: Array<{ path: string; schedule: string }> };
    expect(vercel.crons.map((c) => c.path)).not.toContain("/api/v1/pipeline/run");
  });

  it("⚠️ e o JSON continua sem comentário e sem chave estranha — o schema rejeita e o build local não vê", () => {
    // A falha é de VALIDAÇÃO DE CONFIGURAÇÃO: quebra em 4-5 s, antes de qualquer build, então
    // `npm run build` passa verde e não enxerga nada. Isso derrubou 8 deploys seguidos em 26/08.
    const bruto = ler("vercel.json");
    expect(bruto).not.toMatch(/\/\//);
    expect(bruto).not.toMatch(/"_/);
    expect(Object.keys(JSON.parse(bruto)).sort()).toEqual(["crons", "framework", "functions", "regions"]);
  });

  it("a ROTA segue existindo e segue aceitando cron — religar é uma linha", () => {
    const rota = ler("src/app/api/v1/pipeline/run/route.ts");
    expect(rota).toMatch(/export async function GET/);
    expect(rota).toMatch(/requireAdminOrCron/);
    expect(rota).toMatch(/isCronRequest\(req\)/);
  });
});

describe("etapa158 · a medição que substitui a frase: o cron nunca ingeriu nada", () => {
  /** Os três passos que trazem MATERIAL NOVO para dentro da plataforma. */
  const PASSOS_DE_INGESTAO = ["coleta", "enqueue", "confirmLote"] as const;

  it("uma invocação isolada é SEMPRE a rodada 0 — a run anterior já morreu de órfã", () => {
    // O cron roda 1×/dia e não tem laço: ele reivindica uma rodada e vai embora. 24 h depois, a
    // run dele já foi reapada (3 min), então a próxima invocação recomeça do zero.
    expect(RUN_ORFAO_MS).toBeLessThan(24 * 60 * 60_000);
  });

  it("⚠️ a rodada 0 SEM drenagem não planeja NENHUM passo de ingestão", () => {
    const { passos } = planejarRodada(0, ORCAMENTO, { drenar: false });
    for (const passo of PASSOS_DE_INGESTAO) {
      expect(passos.has(passo as never), `rodada 0 planejou ${passo}`).toBe(false);
    }
  });

  it("…e os três só aparecem em rodadas que uma invocação única NUNCA alcança", () => {
    // Se algum deles entrasse na rodada 0, o cron teria serventia e a remoção seria perda.
    const primeira: Record<string, number> = {};
    for (const passo of PASSOS_DE_INGESTAO) {
      for (let r = 0; r < 24; r++) {
        if (planejarRodada(r, ORCAMENTO, { drenar: false }).passos.has(passo as never)) {
          primeira[passo] = r;
          break;
        }
      }
    }
    for (const passo of PASSOS_DE_INGESTAO) {
      expect(primeira[passo], `${passo} nunca entra em 24 rodadas`).toBeGreaterThan(0);
    }
  });

  it("o que a rodada 0 faz é DRENAR o que já está dentro, e só isso", () => {
    // Medido, não suposto: a rodada 0 SEM drenagem planeja
    //   reaper · extracao · derivada · autoConfirm · reclassificacao
    // `extracao` entra porque é CAUDA (semeada em rodada par), não porque haja o que extrair —
    // sem job pendente ela devolve zero. Nenhum dos cinco traz material novo para dentro.
    const semFila = [...planejarRodada(0, ORCAMENTO, { drenar: false }).passos];
    expect(semFila).toContain("extracao");
    expect(semFila).toContain("reaper");
    for (const passo of PASSOS_DE_INGESTAO) expect(semFila).not.toContain(passo);
    // E todo passo planejado existe na ordem canônica — sanidade do plano.
    for (const p of semFila) expect(ORDEM_DOS_PASSOS).toContain(p);
  });
});
