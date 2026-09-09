/**
 * Etapa 129 (Fase 22, commit 6) — a exceção diz POR QUÊ.
 *
 * A lista "Revisar" tinha 146 documentos e nenhum motivo. O auto-confirm grava o motivo em
 * `campos_detectados.auto_skip` (`upload/auto-confirm/route.ts`), a rota `/upload/documentos` o
 * devolve, e a tela descartava. Sem o motivo, a única ação possível era "revise 1-a-1" — o
 * oposto do zero-toque. Agora a tela mostra o motivo por documento e AGRUPA por causa: cada
 * causa é um conserto de extração, não N cliques.
 *
 * E os "reprocessáveis": o `reprocessarFalhados` tem teto de 3 ciclos e ninguém via o contador.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

describe("etapa129 · o motivo gravado chega à tela", () => {
  const TELA = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");
  const AUTO = ler("src/app/api/v1/upload/auto-confirm/route.ts");
  const DOCS = ler("src/app/api/v1/upload/documentos/route.ts");

  it("o auto-confirm GRAVA o motivo e a rota de documentos o DEVOLVE — a cadeia existe", () => {
    expect(AUTO).toMatch(/auto_skip/);
    expect(DOCS).toMatch(/campos_detectados/);
  });

  it("a tela lê `campos_detectados.auto_skip` por documento e agrupa por motivo", () => {
    expect(TELA).toMatch(/campos_detectados\?\.auto_skip/);
    expect(TELA).toMatch(/excecoes-por-motivo/);
    // O tipo da query DECLARA a chave — era o descarte silencioso: chegava e o tipo não a via.
    expect(TELA).toMatch(/campos_detectados\?: \{ auto_skip\?: string \| null \} \| null/);
  });

  it("documento sem motivo não some do agrupamento — vira a causa 'ainda não passou pelo auto-confirm'", () => {
    expect(TELA).toMatch(/sem motivo gravado/);
  });
});

describe("etapa129 · o reprocesso mostra o ciclo", () => {
  it("a rota de presos passa `ciclos_reprocesso` lido de `campos_detectados.reprocessos_falha`", () => {
    const ROTA = ler("src/app/api/v1/admin/monitoramento/nao-enfileirados/route.ts");
    expect(ROTA).toMatch(/\.select\("[^"]*campos_detectados[^"]*"\)/);
    expect(ROTA).toMatch(/ciclos_reprocesso: Number\(.*reprocessos_falha\)/);
  });

  it("a tela mostra 'ciclo N/3' nas falhas — o mesmo teto do reprocessarFalhados", () => {
    const TELA = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");
    const RUN = ler("src/app/api/v1/pipeline/run/route.ts");
    expect(TELA).toMatch(/ciclo \$\{f\.ciclos_reprocesso \?\? 0\}\/3/);
    expect(RUN).toMatch(/ciclos >= 3/); // se o teto mudar lá, este teste obriga a mudar aqui
  });
});
