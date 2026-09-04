/**
 * Etapa 100 (Fase 17, commit C) — a página de desafio do WAF deixa de queimar o item.
 *
 * ═══ O defeito ═══
 * A Fase 9 ensinou a COLETA a reconhecer o desafio do Imperva (`looksLikeChallenge`, em
 * monitoring.ts) — mas o ENFILEIRAMENTO nunca soube. Quando o portal da ARTESP responde HTTP 200
 * com a página "Pardon Our Interruption", `resolvePdfLinks` acha zero links, o item cai no ramo
 * terminal e é arquivado como `sem_pdf` com `proxima_tentativa_em: null`. Sem carimbo, o retry
 * (`:149`) nunca mais o alcança: uma janela de bloqueio queima itens PARA SEMPRE. É a assinatura
 * provável dos chips `67 ARTESP·deliberacao·sem_pdf` + `45 ARTESP·pauta·sem_pdf` da tela.
 *
 * ═══ Por que não basta mandar para `download_falhou` ═══
 * Mandaria o item para o backoff certo (1/3/7/14 dias, teto de MAX_CICLOS_RETRY), mas o estado
 * terminal diria `download_falhou_desistido` — que é mentira por imprecisão: não houve falha de
 * download, houve bloqueio. E é essa imprecisão que impede uma migration futura de selecionar
 * exatamente os itens bloqueados no dia em que a ARTESP liberar. Por isso o motivo é próprio nos
 * DOIS estágios: `waf_desafio` enquanto tenta, `waf_persistente` ao desistir.
 *
 * O teto NÃO é reinventado: é o mesmo `MAX_CICLOS_RETRY` que já existe. A sangria para em ~25
 * dias — o item para de voltar, mas para com o rótulo verdadeiro.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
const ENQUEUE = ler("src/app/api/v1/deliberacoes/enqueue-pdfs/route.ts");
const CODIGO = semComentarios(ENQUEUE);
const NAO_ENFILEIRADOS = semComentarios(ler("src/app/api/v1/admin/monitoramento/nao-enfileirados/route.ts"));

describe("etapa100 · o enfileiramento passa a reconhecer o desafio", () => {
  it("REUSA o detector da coleta por import — não reescreve a assinatura", () => {
    // ⚠️ `etapa70-waf-bloqueio` assere o TEXTO-FONTE de monitoring.ts:167/:205. Duplicar a
    // heurística aqui criaria duas verdades sobre o que é um desafio.
    expect(CODIGO).toMatch(/import \{[^}]*looksLikeChallenge[^}]*\} from "@\/lib\/server\/monitoring"/);
  });

  it("a checagem acontece no ramo HTML, ANTES de decidir que a página não tem PDF", () => {
    const iChallenge = CODIGO.indexOf("looksLikeChallenge(");
    const iTerminal = CODIGO.indexOf('valor.motivo ?? "sem_pdf"');
    expect(iChallenge).toBeGreaterThan(-1);
    expect(iTerminal).toBeGreaterThan(-1);
    expect(iChallenge).toBeLessThan(iTerminal);
  });

  it("desafio vira motivo PRÓPRIO, nunca `sem_pdf`", () => {
    expect(CODIGO).toMatch(/motivo: "waf_desafio"/);
  });
});

describe("etapa100 · o item bloqueado entra no retry — e o teto é o que já existe", () => {
  it("recebe PRAZO (backoff), não `proxima_tentativa_em: null`", () => {
    const bloco = CODIGO.slice(CODIGO.indexOf('=== "waf_desafio"'));
    expect(bloco).toMatch(/proximaTentativaEm\(/);
  });

  it("o teto é o MAX_CICLOS_RETRY existente — nada de contador novo", () => {
    const bloco = CODIGO.slice(CODIGO.indexOf('=== "waf_desafio"'));
    expect(bloco).toMatch(/MAX_CICLOS_RETRY/);
  });

  it("ao desistir, o motivo diz a VERDADE sobre a causa", () => {
    expect(CODIGO).toMatch(/"waf_persistente"/);
    // E não pode terminar como falha de download: seria a imprecisão que impede a reabertura.
    const bloco = CODIGO.slice(CODIGO.indexOf('=== "waf_desafio"'), CODIGO.indexOf('=== "waf_desafio"') + 1400);
    expect(bloco).not.toMatch(/download_falhou_desistido/);
  });

  it("a fila de retry ACEITA o motivo novo — senão o carimbo é escrito e ninguém o lê", () => {
    // O predicado de `:163` é a outra metade: sem ele, o item ganha prazo e mesmo assim é
    // filtrado fora. Foi assim que 95 itens ficaram inalcançáveis na Fase 16.
    expect(CODIGO).toMatch(/enqueue_motivo === "waf_desafio"/);
  });
});

describe("etapa100 · o painel conta o bloqueado como recuperável", () => {
  it("`arquivados_recuperaveis` inclui waf_desafio", () => {
    // X5: o número sobe sem nada novo ter sido recuperado — é esperado e está no commit.
    expect(NAO_ENFILEIRADOS).toMatch(/g\.motivo === "download_falhou" \|\| g\.motivo === "waf_desafio"/);
  });
});
