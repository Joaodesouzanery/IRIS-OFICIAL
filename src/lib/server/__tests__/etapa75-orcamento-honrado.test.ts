/**
 * Etapa 75 (Fase 10, commit 4) — a rodada para de estourar o relógio.
 *
 * ═══ O bug ═══
 * A esteira encadeia ~12 sub-rotas na MESMA invocação, repartindo um orçamento único. `call()`
 * grava a fatia de cada uma em `?budget_ms=` — mas **cinco rotas nunca leem esse parâmetro**:
 * `aprovar-lote` e as QUATRO métricas derivadas. A fatia era escrita e jogada fora; cada uma
 * trabalhava até acabar o que tinha para fazer.
 *
 * A pior era `mandatos/recalcular`: SELECT **sem limite nenhum** e DUAS escritas por linha, no
 * bloco final da rodada. Junto com `waitUntil(processQueue(...))` rodando com `deadlineAt`
 * **undefined** dentro do enfileiramento — até `MAX_PER_RUN` PDFs extraídos em background, com
 * pdf-parse (CPU síncrono) e às vezes OCR, fora de qualquer orçamento.
 *
 * É a explicação mecânica de "A requisição passou de 90s sem resposta" na rodada 26. O cliente
 * aborta em 90s (`api.ts`); a mensagem que o usuário viu é a do abort, não um 504 do gateway.
 *
 * ═══ A propriedade ═══
 * Toda rota chamada pelo orquestrador lê a própria fatia, para no saldo, e DIZ que parou — sem o
 * `restantes` o orquestrador daria a rodada por concluída com trabalho pela metade.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const RUN = ler("src/app/api/v1/pipeline/run/route.ts");

/** As cinco que ignoravam a fatia, com o laço serial que cada uma precisa interromper. */
const ROTAS = [
  "src/app/api/v1/diretores/candidatos/aprovar-lote/route.ts",
  "src/app/api/v1/empresas/backfill/route.ts",
  "src/app/api/v1/qualidade-regulatoria/coletas/derivadas/run/route.ts",
  "src/app/api/v1/mandatos/recalcular/route.ts",
  "src/app/api/v1/votos/recalcular-divergencia/route.ts",
];

describe("etapa75 · toda rota do orquestrador honra a própria fatia", () => {
  it.each(ROTAS)("%s lê budget_ms", (arquivo) => {
    const fonte = ler(arquivo);
    expect(fonte).toMatch(/budgetFromRequest\(req\)/);
    expect(fonte).toMatch(/const deadlineAt = Date\.now\(\) \+ budgetFromRequest\(req\)/);
  });

  it.each(ROTAS)("%s interrompe o laço no saldo", (arquivo) => {
    const fonte = ler(arquivo);
    // Ler o orçamento e não usá-lo seria a mesma inércia com outra roupa.
    expect(fonte).toMatch(/if \(!hasBudget\(deadlineAt, [A-Z_]+\)\) \{ parcial = true; break; \}/);
  });

  it.each(ROTAS)("%s DIZ que parou — senão o orquestrador não volta", (arquivo) => {
    const fonte = ler(arquivo);
    expect(fonte).toMatch(/parcial \? \{ parcial: true, restantes: true \}|parcial, restantes: true/);
  });

  it("TABULAR: nenhuma rota chamada pelo orquestrador ignora budget_ms", () => {
    // Consertar as cinco de hoje não impediria a sexta. A varredura sai do próprio orquestrador.
    const rotas = [...RUN.matchAll(/await call\(\s*[A-Za-z]+,\s*"(\/api\/v1\/[^"?]+)/g)].map((m) => m[1]);
    expect(rotas.length).toBeGreaterThan(8);
    for (const rota of new Set(rotas)) {
      const fonte = ler(`src/app${rota}/route.ts`);
      // A CHAMADA, não o símbolo: um import que ficou para trás satisfaz `/budgetFromRequest/`
      // mesmo com a rota tendo voltado a cravar um número.
      expect(fonte, `«${rota}» ignora budget_ms`).toMatch(/budgetFromRequest\(req\)/);
    }
  });
});

describe("etapa75 · o SELECT sem limite da rota de mandatos", () => {
  it("passou a ter teto e ordem estável", () => {
    // Lia a tabela inteira e escrevia 2× por linha, no bloco final da rodada.
    const fonte = ler("src/app/api/v1/mandatos/recalcular/route.ts");
    expect(fonte).toMatch(/\.select\("id, diretor_id, data_inicio, data_fim"\)[\s\S]{0,160}?\.limit\(\d+\)/);
    expect(fonte).toMatch(/\.order\("updated_at"/);
  });
});

describe("etapa75 · o background do enfileiramento respeita o mesmo relógio", () => {
  it("waitUntil(processQueue(...)) recebe o deadline que já existia na rota", () => {
    const fonte = ler("src/app/api/v1/deliberacoes/enqueue-pdfs/route.ts");
    expect(fonte).toMatch(/waitUntil\(processQueue\(jobsToProcess\.slice\(0, MAX_PER_RUN\), 2, deadlineAt\)\)/);
    // O caminho síncrono (cron/teste) idem — os dois liam o mesmo `undefined`.
    expect(fonte).toMatch(/await processQueue\(jobsToProcess\.slice\(0, MAX_PER_RUN\), 2, deadlineAt\)/);
    expect(fonte).not.toMatch(/processQueue\(jobsToProcess\.slice\(0, MAX_PER_RUN\), 2\)/);
  });
});

describe("etapa75 · o orquestrador retoma o que ficou pela metade", () => {
  it("derivada parcial pede outra rodada", () => {
    const codigo = RUN.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
    const i = codigo.indexOf('etapas[nome] = anotar(r, nome,');
    expect(i).toBeGreaterThan(-1);
    expect(codigo.slice(i, i + 260)).toMatch(/if \(r\.body\?\.restantes\) restantes = true;/);
  });

  it("candidatos parcial pede outra rodada", () => {
    expect(RUN).toMatch(/if \(r\.body\?\.restantes \|\| rec\.body\?\.restantes\) restantes = true;/);
  });
});
