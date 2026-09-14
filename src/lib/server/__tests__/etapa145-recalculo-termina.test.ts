/**
 * Etapa 145 (Fase 27, commit 2) — o recálculo da direção seleciona O QUE PRECISA, e diz quanto falta.
 *
 * ═══ Por que não terminava ═══
 * A rota paginava TODAS as deliberações por `created_at desc` + `offset`, e o pipeline a chamava
 * uma vez por run SEM offset: toda run reprocessava as mesmas 300 (as mais novas). Medido depois
 * de várias runs: 606 votos inferidos ainda "Favoravel" em Indeferido (533 ARTESP, 63 ANM, 10
 * ANTT). O % Favorável caiu (100 → 93,6 na ARTESP) mas parou longe dos 73,1 medidos.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

describe("etapa145 · a seleção é pelo ALVO, não pelas primeiras N", () => {
  const rota = ler("src/app/api/v1/votos/recalcular-divergencia/route.ts");

  it("no modo direção, busca os votos inferidos Favorável em deliberação Indeferida", () => {
    expect(rota).toMatch(/\.eq\("is_nominal", false\)/);
    expect(rota).toMatch(/\.eq\("tipo_voto", "Favoravel"\)/);
    expect(rota).toMatch(/\.eq\("deliberacoes\.resultado", "Indeferido"\)/);
  });

  it("o modo antigo (sem direção) segue paginando por offset — não foi trocado por acidente", () => {
    expect(rota).toMatch(/\.range\(offset, offset \+ limit - 1\)/);
  });

  it("publica `pendentes_direcao` e pede outra rodada enquanto sobrar alvo", () => {
    expect(rota).toMatch(/pendentes_direcao: pendentesDirecao/);
    expect(rota).toMatch(/const sobraramAlvos = direcao && pendentesDirecao !== null && pendentesDirecao > processados/);
    expect(rota).toMatch(/parcial \|\| sobraramAlvos \? \{ parcial: true, restantes: true \}/);
  });
});

describe("etapa145 · o número chega ao banner (capacidade-sem-consumidor)", () => {
  it("o pipeline carrega e a tela lê os dois", () => {
    const run = ler("src/app/api/v1/pipeline/run/route.ts");
    expect(run).toMatch(/pendentes_direcao: b\.pendentes_direcao/);
    expect(run).toMatch(/direcao_corrigida: b\.direcao_corrigida/);
    const tela = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");
    expect(tela).toMatch(/totais\.pendentes_direcao/);
    expect(tela).toMatch(/totais\.direcao_corrigida/);
  });
});
