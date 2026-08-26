/**
 * Etapa 68 (Fase 7) — a esteira ganha memória: retomar, travar, e PARAR sozinha.
 *
 * Queixa do usuário: "se enquanto tiver rodando eu sair da aba, ele perde tudo". O diagnóstico
 * corrigiu a frase: o TRABALHO nunca se perdia — cada rodada commita no banco. O que se perdia era
 * o LAÇO e toda a noção de progresso, porque `/pipeline/run` era 100% stateless e o estado do
 * "Rodar tudo" vivia num `useMutation` do navegador. Não havia nem como PERGUNTAR o que estava
 * acontecendo: a única rota, `GET /pipeline/run`, executava a esteira.
 *
 * E, com a vazão do commit 7 somada a um cron diário, faltava o freio que o usuário pediu: um erro
 * sistemático deixaria de ser uma rodada ruim e viraria centenas de documentos mal processados
 * antes de alguém abrir a tela. Registrar não basta — é preciso PARAR.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  contarPassos,
  deveAbrirDisjuntor,
  DISJUNTOR_MIN_PASSOS,
  DISJUNTOR_TAXA_ERRO,
  RUN_ORFAO_MS,
} from "@/lib/server/esteira-run";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const PIPELINE = ler("src/app/api/v1/pipeline/run/route.ts");

describe("etapa68 · o DISJUNTOR precisa de amostra E de taxa", () => {
  it("não dispara com amostra pequena, mesmo com 100% de erro", () => {
    // Só a taxa dispararia em "1 de 1 falhou" — que é ruído (um portal fora do ar por um
    // segundo), não erro sistemático. Parar a esteira aí seria pior que não parar.
    expect(deveAbrirDisjuntor(0, 1)).toBe(false);
    expect(deveAbrirDisjuntor(0, 3)).toBe(false);
  });

  it("dispara quando a maioria dos passos falha, com amostra suficiente", () => {
    expect(deveAbrirDisjuntor(2, 10)).toBe(true);
  });

  it("NÃO dispara quando a maioria dos passos vai bem", () => {
    // Uma rodada com um passo falhando (uma agência fora do ar) é normal e não pode parar tudo.
    expect(deveAbrirDisjuntor(20, 2)).toBe(false);
    expect(deveAbrirDisjuntor(10, 5)).toBe(false); // 33% — abaixo do limite
  });

  it("o limite é exatamente 'mais da metade', não 'metade'", () => {
    const metadeExata = deveAbrirDisjuntor(6, 6);
    expect(metadeExata, "empate não é sinal de erro sistemático").toBe(false);
    expect(deveAbrirDisjuntor(5, 7)).toBe(true);
  });

  it("os parâmetros são conservadores — o disjuntor não pode ser um estorvo", () => {
    expect(DISJUNTOR_MIN_PASSOS).toBeGreaterThanOrEqual(5);
    expect(DISJUNTOR_TAXA_ERRO).toBeGreaterThanOrEqual(0.4);
    expect(DISJUNTOR_TAXA_ERRO).toBeLessThan(1);
  });
});

describe("etapa68 · contarPassos lê o desfecho real de cada etapa", () => {
  it("uma etapa com `erro` conta como falha; as outras, como sucesso", () => {
    const etapas = {
      auto_confirm: { confirmados: 3 },
      aprovacao: { materializados: 1 },
      coleta: { erro: "coleta falhou nesta rodada" },
      dedup_final: { erro: "dedup falhou nesta rodada" },
    };
    expect(contarPassos(etapas)).toEqual({ ok: 2, erro: 2 });
  });

  it("rodada inteiramente bem-sucedida não acumula erro", () => {
    expect(contarPassos({ a: { x: 1 }, b: { y: 2 } })).toEqual({ ok: 2, erro: 0 });
  });

  it("etapa vazia conta como sucesso — ausência de erro é ausência de erro", () => {
    expect(contarPassos({ a: {} })).toEqual({ ok: 1, erro: 0 });
  });
});

describe("etapa68 · execução órfã não trava a esteira para sempre", () => {
  it("o corte de órfã é maior que uma rodada e menor que uma sessão", () => {
    // O SIGKILL de 60s mata a função sem rodar `finally`: uma execução PODE morrer sem fechar a
    // própria linha. Sem reaper, o lock viraria cadeado sem chave.
    expect(RUN_ORFAO_MS).toBeGreaterThan(60_000);
    expect(RUN_ORFAO_MS).toBeLessThanOrEqual(10 * 60_000);
  });

  it("a rota reapa órfãs ANTES de decidir se há execução ativa", () => {
    // Comparar por `indexOf` do NOME casaria com o bloco de imports (ordenado alfabeticamente),
    // não com a ordem de execução — foi assim que a primeira versão deste teste reprovou código
    // correto. O que importa são as CHAMADAS.
    const iReaper = PIPELINE.indexOf("await reaparRunsOrfas(db)");
    const iBusca = PIPELINE.indexOf("await buscarRunAtiva(db)");
    expect(iReaper, "chamada do reaper não encontrada").toBeGreaterThan(-1);
    expect(iBusca, "chamada da busca não encontrada").toBeGreaterThan(-1);
    expect(iReaper, "reapar depois de buscar deixaria a órfã travando o lock").toBeLessThan(iBusca);
  });
});

describe("etapa68 · o lock impede duas esteiras sobre as mesmas linhas", () => {
  it("execução conflitante recebe 409, não roda em paralelo", () => {
    expect(PIPELINE).toMatch(/ativa && corpo\.run_id && ativa\.id !== corpo\.run_id/);
    expect(PIPELINE).toMatch(/status: 409/);
  });

  it("o 409 devolve o run_id ativo — a aba pode PASSAR a acompanhar aquela execução", () => {
    expect(PIPELINE).toMatch(/run_id: ativa\.id/);
  });
});

describe("etapa68 · GET deixou de executar a esteira", () => {
  it("só o cron executa via GET; o resto recebe orientação", () => {
    expect(PIPELINE).toMatch(/export async function GET[\s\S]{0,220}?isCronRequest\(req\)/);
    expect(PIPELINE).toMatch(/GET não executa a esteira/);
  });

  it("o alias `GET = run` que disparava a esteira em qualquer prefetch não existe mais", () => {
    expect(PIPELINE).not.toMatch(/export async function GET\(req: NextRequest\) \{\s*return run\(req\);\s*\}/);
  });
});

describe("etapa68 · o disjuntor está ligado na rodada", () => {
  it("a rodada é registrada e a taxa avaliada", () => {
    expect(PIPELINE).toMatch(/registrarRodada\(db, execucao, etapas\)/);
    expect(PIPELINE).toMatch(/deveAbrirDisjuntor\(execucao\.passos_ok, execucao\.passos_erro\)/);
  });

  it("abrir o disjuntor PARA de verdade — não pede outra rodada", () => {
    expect(PIPELINE).toMatch(/abortadoPeloDisjuntor = true;\s*\n\s*restantes = false;/);
  });

  it("o motivo é gravado e devolvido — parar em silêncio seria outro modo de mentir", () => {
    expect(PIPELINE).toMatch(/fecharRun\([\s\S]{0,80}?"abortado"/);
    expect(PIPELINE).toMatch(/motivo_parada:/);
  });

  it("execução que drena normalmente é fechada como concluída", () => {
    expect(PIPELINE).toMatch(/fecharRun\(db, execucao\.id, "concluido", null\)/);
  });
});

describe("etapa68 · a rota de status e o cron", () => {
  it("existe GET /pipeline/status e ele NÃO executa a esteira", () => {
    const status = ler("src/app/api/v1/pipeline/status/route.ts");
    expect(status).toMatch(/buscarRunAtiva/);
    // A propriedade é sobre o que a rota IMPORTA e CHAMA — não sobre a palavra aparecer no
    // comentário que explica por que ela existe (foi o que reprovou a primeira versão).
    expect(status, "a rota de status não pode importar handlers da esteira")
      .not.toMatch(/^import .*(pipeline\/run|auto-confirm|enqueue-pdfs)/m);
    expect(status, "e não pode chamar nenhum deles").not.toMatch(/\b(run|autoConfirmPOST|enqueuePOST)\(/);
  });

  it("o ramo demo do status tem TODAS as chaves do real (lição da etapa65)", () => {
    const status = ler("src/app/api/v1/pipeline/status/route.ts");
    expect(status).toMatch(/modo: "demo", em_andamento: false, run: null, ultima: null/);
  });

  it("o cron passou a chamar a esteira COMPLETA, sem gastar slot novo", () => {
    const vercel = JSON.parse(ler("vercel.json")) as { crons: Array<{ path: string }> };
    const caminhos = vercel.crons.map((c) => c.path);
    expect(caminhos).toContain("/api/v1/pipeline/run");
    // auto-confirm é o passo 1 da esteira: manter os dois seria rodar o mesmo trabalho 2×/dia.
    expect(caminhos).not.toContain("/api/v1/upload/auto-confirm");
    expect(caminhos.length, "o plano Hobby só permite 2 crons").toBeLessThanOrEqual(2);
  });
});

describe("etapa68 · a tela retoma em vez de fingir que nada acontece", () => {
  const page = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");

  it("consulta o status e reconsulta enquanto algo roda", () => {
    expect(page).toMatch(/queryKey: \["pipeline-status"\]/);
    expect(page).toMatch(/refetchInterval/);
  });

  it("amarra as rodadas a UMA execução pelo run_id", () => {
    expect(page).toMatch(/runId \? \{ run_id: runId \} : \{\}/);
  });

  it("mostra a esteira rodando — inclusive quando quem a disparou foi o cron", () => {
    expect(page).toMatch(/esteiraStatus\?\.em_andamento/);
    expect(page).toMatch(/Pode fechar a aba/);
  });

  it("um disjuntor aberto continua visível para quem não estava na tela", () => {
    expect(page).toMatch(/ultima\?\.status === "abortado"/);
  });
});
