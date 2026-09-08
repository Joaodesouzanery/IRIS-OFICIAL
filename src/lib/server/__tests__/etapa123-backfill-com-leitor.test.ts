/**
 * Etapa 123 (Fase 21, commit 1) — o que o materializador mede CHEGA a alguém.
 *
 * ═══ O achado ═══
 * `materializar-faltantes` publicava `roster_nao_conferivel`, `fora_da_janela_de_mandatos`,
 * `upsert_falhas` e `delta_dispositivo`. O único chamador (`pipeline/run`) lia três chaves:
 * `materializaveis`, `votos`, `restantes`. O resto era calculado toda noite e descartado.
 *
 * Consequência concreta: uma run em que TODAS as escritas de voto falharam mostrava o mesmo
 * banner verde de uma run sem nada a fazer — `votos = 0` nos dois casos. E o número que o usuário
 * pediu para ver antes de mudar a regra do dispositivo nunca chegava à tela.
 *
 * É a skill `capacidade-sem-consumidor`, aplicada ao commit da véspera. Por isso o teste é
 * TRANSVERSAL: cada chave numérica do payload precisa de um leitor fora da própria rota, e cada
 * chave do resumo precisa de um leitor na tela. Quem esquecer da próxima vez cai aqui.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  CHAVES_NUMERICAS_DO_MATERIALIZADOR,
  resumirBackfill,
} from "@/lib/server/resumo-do-backfill";

const RAIZ = join(__dirname, "../../../..");
const ROTA_MATERIALIZAR = "src/app/api/v1/admin/votos/materializar-faltantes/route.ts";
const ROTA_RUN = "src/app/api/v1/pipeline/run/route.ts";
const TELA = "src/app/dashboard/deliberacoes/votos-diretores/page.tsx";
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf-8");

/** Todos os .ts/.tsx de src/, fora de __tests__ — o universo onde um leitor pode morar. */
function fontes(dir = join(RAIZ, "src")): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) { if (nome !== "__tests__") out.push(...fontes(p)); }
    else if (/\.tsx?$/.test(nome)) out.push(p);
  }
  return out;
}

const PAYLOAD_COMPLETO = {
  materializaveis: 7, votos: 21, sem_evidencia: 3,
  roster_nao_conferivel: 4, fora_da_janela_de_mandatos: 9, upsert_falhas: 2,
  detalhe_roster: [
    { nao_reconhecidos: ["Roger Romão Cabral", "Tasso Mendonça Júnior"] },
    { nao_reconhecidos: ["Roger Romão Cabral"] },
  ],
  delta_dispositivo: { itens_que_mudariam: 5, votos_a_menos: 13, por_regex_divergente: { ANM: 2, ANTT: 1 } },
};

describe("etapa123 · COMPORTAMENTO: o resumo carrega tudo que o materializador mediu", () => {
  const r = resumirBackfill(PAYLOAD_COMPLETO);

  it.each([
    ["deliberacoes", 7], ["votos", 21], ["sem_evidencia", 3],
    ["roster_nao_conferivel", 4], ["fora_da_janela", 9], ["upsert_falhas", 2],
    ["votos_a_menos", 13], ["itens_que_mudariam", 5], ["regex_divergente", 3],
  ])("«%s» = %i", (chave, valor) => {
    expect(r[chave]).toBe(valor);
  });

  it("os nomes não reconhecidos viram UMA string, deduplicada — array seria descartado pelos consumidores", () => {
    expect(r.nao_reconhecidos).toBe("Roger Romão Cabral; Tasso Mendonça Júnior");
  });

  it("corpo vazio (rota respondeu {} ou pulou) dá zeros, nunca undefined — a soma da tela precisa de número", () => {
    const vazio = resumirBackfill(undefined);
    for (const [k, v] of Object.entries(vazio)) expect(typeof v, k).toBe("number");
    expect(vazio.upsert_falhas).toBe(0);
    expect("nao_reconhecidos" in vazio).toBe(false);
  });

  it("uma run em que TODAS as escritas falharam é distinguível de uma run vazia", () => {
    const falhou = resumirBackfill({ materializaveis: 5, votos: 0, upsert_falhas: 5 });
    const vazia = resumirBackfill({ materializaveis: 0, votos: 0, upsert_falhas: 0 });
    expect(falhou).not.toEqual(vazia);
    expect(falhou.upsert_falhas).toBe(5);
  });
});

describe("etapa123 · TRANSVERSAL: toda medição tem leitor (capacidade-sem-consumidor)", () => {
  const rotaMaterializar = ler(ROTA_MATERIALIZAR);
  const outros = fontes().filter((p) => !p.endsWith(ROTA_MATERIALIZAR));
  const textos = new Map(outros.map((p) => [p, readFileSync(p, "utf-8")]));

  for (const chave of CHAVES_NUMERICAS_DO_MATERIALIZADOR) {
    it(`«${chave}» é publicada pela rota E lida fora dela`, () => {
      expect(rotaMaterializar, `a rota não publica ${chave}`).toMatch(new RegExp(`\\b${chave}\\s*[:,]`));
      const leitores = [...textos.entries()].filter(([, t]) => t.includes(chave)).map(([p]) => p);
      expect(leitores.length, `${chave} é calculada e ninguém lê`).toBeGreaterThan(0);
    });
  }

  it("cada chave do RESUMO chega à tela — senão o passo vira o novo lugar onde o número morre", () => {
    const tela = ler(TELA);
    for (const chave of Object.keys(resumirBackfill(PAYLOAD_COMPLETO))) {
      expect(tela, `a tela não lê «${chave}»`).toMatch(new RegExp(`\\b${chave}\\b`));
    }
  });

  it("o passo backfillVotos usa o resumo, não a cópia de duas chaves", () => {
    const run = ler(ROTA_RUN);
    expect(run).toMatch(/anotar\(r, "backfill de votos", resumirBackfill\(r\.body\)\)/);
    expect(run).not.toMatch(/deliberacoes: r\.body\?\.materializaveis/);
  });
});
