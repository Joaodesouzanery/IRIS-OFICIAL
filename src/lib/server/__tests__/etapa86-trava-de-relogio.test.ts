/**
 * Etapa 86 (Fase 14, commit B) — o laço do cliente corre por TEMPO, não por contador.
 *
 * "40 rodadas" era um número arbitrário que não sabia se o trabalho acabou: com fila grande
 * parava cedo demais (a tela real de 31/08: "parou no teto de 40 rodadas — ainda há fila",
 * depois de 20min úteis extraindo 218 PDFs), e com fila vazia o `deveContinuar` da Fase 11 já
 * encerra por `drenou` em segundos. O teto de tempo (~25min) vira rede de segurança; o teto de
 * rodadas que sobra (300) é só anti-laço-infinito — o relógio dispara muito antes.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const TELA = readFileSync(
  join(RAIZ, "src/app/dashboard/deliberacoes/votos-diretores/page.tsx"), "utf-8");
const CODIGO = TELA.replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("etapa86 · a trava", () => {
  it("o laço checa o RELÓGIO a cada rodada, antes de chamar o servidor", () => {
    const iFor = CODIGO.indexOf("for (let rodada = 1; rodada <= 300; rodada++)");
    expect(iFor).toBeGreaterThan(-1);
    const corpo = CODIGO.slice(iFor, iFor + 400);
    expect(corpo).toMatch(/Date\.now\(\) - inicioLaco > TETO_LACO_MS/);
    // A checagem vem ANTES do POST — estourar o tempo no meio de uma rodada é inevitável,
    // mas começar uma rodada nova já estourado seria desperdício deliberado.
    expect(corpo.indexOf("TETO_LACO_MS")).toBeLessThan(corpo.indexOf("api.post"));
  });

  it("o teto de tempo é ~25min e o contador antigo de 40 sumiu", () => {
    expect(CODIGO).toMatch(/TETO_LACO_MS = 25 \* 60_000/);
    expect(CODIGO).not.toMatch(/rodada <= 40;/);
  });

  it("estourar o relógio ainda ENCERRA a run no servidor (o conserto da Fase 12 sobrevive)", () => {
    // O desfecho "teto" continua no ramo que chama {encerrar:true} — sem isso a run voltaria a
    // virar fantasma de 3 minutos.
    expect(CODIGO).toMatch(/desfecho === "teto" \|\| desfecho === "erros"/);
  });

  it("a mensagem diz TEMPO e diz o que fazer — não um número de rodadas sem contexto", () => {
    expect(TELA).toMatch(/teto de tempo \(~25min/);
    expect(TELA).toMatch(/rode de novo para continuar/);
  });
});
