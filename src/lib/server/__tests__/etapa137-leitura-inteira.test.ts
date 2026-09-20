/**
 * Etapa 137 (Fase 25, commit 1) — leitura que agrega em JS lê a tabela INTEIRA.
 *
 * `.limit(40000)` não é paginação: o PostgREST corta em ~1.000 e devolve sem aviso. A tela
 * "Completude 2026" via 1.000 deliberações e 1.000 votos, chamava de "órfão" todo voto cuja
 * deliberação ficou fora da fatia (537 em produção — impossível no banco, a FK é CASCADE) e
 * SUBCONTAVA todas as colunas. `saude-dados`, `governanca-agencias` e o "estrito" do
 * `mandatos/stats` (que eu mesmo pus na Fase 21) tinham o mesmo defeito.
 *
 * Regra: nas rotas que agregam a tabela inteira, nenhum `.limit(N ≥ 1000)` — só `lerTudo`
 * /`selectAllPaged` (`.range()` até esgotar, com aviso de truncagem). E "órfão" só é publicado
 * quando a leitura foi completa; truncou → `null`, nunca um número.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");

/** Rotas que carregam tabelas inteiras para agregar em JS. */
const ROTAS_QUE_AGREGAM = [
  "src/app/api/v1/admin/completude-2026/route.ts",
  "src/app/api/v1/admin/saude-dados/route.ts",
  "src/app/api/v1/dashboard/governanca-agencias/route.ts",
  "src/app/api/v1/mandatos/stats/route.ts",
  "src/app/api/v1/dashboard/diretores/overview/route.ts",
  // Fase 28 — as duas que ficaram de fora na Fase 25, e eram as que mais doíam:
  // `cobertura-ao-vivo` é a rota que o operador usa como PROVA de que nada se perdeu, e calculava
  // `banco_total`/`faltando`/`extra` sobre uma fatia de ~1.000 linhas; `materializar-faltantes`
  // filtrava "sem voto" DEPOIS da fatia, então materializar não liberava vaga e deliberação além
  // da milésima NUNCA recebia voto, em run nenhuma.
  "src/app/api/v1/admin/cobertura-ao-vivo/route.ts",
  "src/app/api/v1/admin/votos/materializar-faltantes/route.ts",
];

describe("etapa137 · nenhum `.limit(N ≥ 1000)` onde a rota agrega a tabela inteira", () => {
  it.each(ROTAS_QUE_AGREGAM)("%s", (rota) => {
    const fonte = ler(rota);
    const grandes = [...fonte.matchAll(/\.limit\(\s*(\d[\d_]*)\s*\)/g)]
      .map((m) => Number(m[1].replace(/_/g, "")))
      .filter((n) => n >= 1000);
    expect(grandes, `limits ≥ 1000 sem paginação: ${grandes.join(", ")}`).toEqual([]);
    // Fase 28 — o guard aceita `lerTudo<T>(` além de `lerTudo(`: a chamada com parâmetro de tipo
    // é a MESMA leitura paginada, e exigir o parêntese colado rejeitaria uma tipagem melhor.
    expect(fonte).toMatch(/lerTudo\s*[<(]|selectAllPaged\s*[<(]/);
  });
});

describe("etapa137 · órfão só com leitura completa", () => {
  it("a completude publica `votos_orfaos: null` quando qualquer leitura truncou", () => {
    const fonte = ler("src/app/api/v1/admin/completude-2026/route.ts");
    expect(fonte).toMatch(/votos_orfaos: leituraCompleta \? votosOrfaos : null/);
    expect(fonte).toMatch(/leitura_completa: leituraCompleta/);
    expect(fonte).toMatch(/const leituraCompleta = !delibsAllRes\.truncated && !votosTruncados/);
  });
});

describe("etapa137 · o banner não chama de «resolvida» a duplicata que só seguiu adiante", () => {
  it("`fundidos_semanticos` não entra na soma de duplicatas; tem linha própria", () => {
    const tela = readFileSync(join(RAIZ, "src/app/dashboard/deliberacoes/votos-diretores/page.tsx"), "utf-8");
    expect(tela).not.toMatch(/duplicatas_arquivadas \?\? 0\) \+ \(totais\.fundidos_semanticos/);
    expect(tela).toMatch(/seguiram para o confirm/);
  });
});
