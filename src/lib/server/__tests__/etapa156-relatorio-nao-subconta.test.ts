/**
 * Etapa 156 (Fase 29, commit 4) — o relatório que o operador usa para de subcontar.
 *
 * ═══ O defeito, com o tamanho medido ═══
 * `relatorios/votos-diretores` lia `votos` com `.limit(20000)`, `deliberacoes` com `.limit(10000)`,
 * `diretores` com `.limit(5000)` e `mandatos` com `.limit(20000)`. `.limit(N)` grande NÃO é
 * paginação: o PostgREST corta em ~1.000 e devolve sem aviso — é o mesmo defeito que
 * `select-all-paged.ts` documenta em quatro outras rotas e que fabricou os "537 órfãos".
 *
 * Como `blocoReal` roda POR AGÊNCIA, o teto era 3.000 dos 4.009 votos do banco: **~25% do acervo
 * estava fora do PDF, do Word e do CSV que o operador usa**, e a fatia perdida cresce a cada
 * rodada de coleta.
 *
 * Pior: `mandatos` é uma query GLOBAL única. Um diretor cujo mandato caiu fora dos 1.000 E cujos
 * votos caíram fora dos 1.000 da agência dele SUMIA INTEIRO do relatório, porque o filtro de
 * `linhas` exige mandato OU votos — e os dois vinham de fatias truncadas.
 *
 * ⚠️ Este commit vem ANTES da aba de auditoria por voto, de propósito: o operador está prestes a
 * ver uma tela dizendo 4.009 votos. Um relatório dizendo ~3.000 faria um dos dois parecer
 * inventado, e a diferença viraria pergunta de suporte em vez de mensagem de commit.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ROTA = readFileSync(join(RAIZ, "src/app/api/v1/relatorios/votos-diretores/route.ts"), "utf-8");
const SEM_COMENTARIO = ROTA.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("etapa156 · as quatro leituras paginam", () => {
  it("nenhum `.limit(N ≥ 1000)` sobrou", () => {
    const grandes = [...SEM_COMENTARIO.matchAll(/\.limit\(\s*(\d[\d_]*)\s*\)/g)]
      .map((m) => Number(m[1].replace(/_/g, "")))
      .filter((n) => n >= 1000);
    expect(grandes, `limits ≥ 1000 sem paginação: ${grandes.join(", ")}`).toEqual([]);
  });

  it.each(["diretores", "votos", "delibs", "mandatos"])("a leitura de %s usa `lerTudo`", (qual) => {
    // Os rótulos são template literals (`relatorio/${sigla}/votos`), então casar por substring é
    // mais honesto que uma regex que teria de modelar a interpolação.
    const rotulo = qual === "mandatos" ? "relatorio/mandatos" : `}/${qual}`;
    const i = SEM_COMENTARIO.indexOf(rotulo);
    expect(i, `rótulo ${rotulo} não encontrado`).toBeGreaterThan(-1);
    // …e o rótulo tem de ser argumento de `lerTudo`, não de outra coisa.
    expect(SEM_COMENTARIO.slice(Math.max(0, i - 400), i)).toMatch(/lerTudo\(/);
  });

  it("⚠️ cada `lerTudo` tem `.order(\"id\")` — `.range()` sem ordem total repete e pula linhas", () => {
    const chamadas = [...SEM_COMENTARIO.matchAll(/lerTudo\(\(\) =>([\s\S]*?), `?"?relatorio\//g)];
    expect(chamadas.length).toBeGreaterThanOrEqual(3);
    for (const c of chamadas) {
      expect(c[1], `sem .order("id"): ${c[1].slice(0, 90)}`).toMatch(/\.order\("id"\)/);
    }
  });
});

describe("etapa156 · o relatório DECLARA o que cobriu", () => {
  it("a bandeira de truncagem existe e é a conjunção das três leituras", () => {
    expect(SEM_COMENTARIO).toMatch(
      /const leituraCompleta = !diretoresRes\.truncated && !votosRes\.truncated && !delibsRes\.truncated/,
    );
  });

  it("…e tem LEITOR no rodapé — bandeira sem consumidor não conta como entregue", () => {
    expect(SEM_COMENTARIO).toMatch(/blocos\.every\(\(b\) => b\.leituraCompleta\)/);
    expect(ROTA).toMatch(/LEITURA INCOMPLETA — os números abaixo subcontam/);
  });

  it("o rodapé publica o DENOMINADOR — número sem base não é auditável", () => {
    expect(SEM_COMENTARIO).toMatch(/blocos\.reduce\(\(n, b\) => n \+ b\.votosLidos, 0\)/);
    expect(ROTA).toMatch(/Cobertura: \$\{/);
  });

  it("o bloco vazio (demo/local) não finge truncagem", () => {
    const i = SEM_COMENTARIO.indexOf("const BLOCO_VAZIO");
    expect(i).toBeGreaterThan(-1);
    expect(SEM_COMENTARIO.slice(i, i + 300)).toMatch(/leituraCompleta: true/);
  });
});

describe("etapa156 · a leitura ampla aqui é DECISÃO registrada, não descuido", () => {
  /**
   * ⚠️ Fase 32 — este bloco mudou de significado, e a mudança é o ponto.
   *
   * Até aqui ele apenas exigia que o docstring parasse de AFIRMAR um gate inexistente ("Admin-gated",
   * que nunca foi verdade). Isso consertava a prosa e deixava a autorização em aberto — o teste
   * acabava **congelando a ausência do gate** sem que ninguém tivesse decidido nada.
   *
   * Agora há decisão: o usuário determinou que quem ele cria no Supabase lê o acervo inteiro, porque
   * são atos públicos de agentes públicos e o acesso é concedido a dedo, no painel. Então a leitura
   * ampla aqui é escolha — e o que a sustenta não é este teste, é a SUPERFÍCIE DECLARADA do
   * `etapa187`: a rota está listada como `viewer`, e rota que mude de lado sem a lista mudar junto
   * reprova.
   */
  it("o docstring não AFIRMA um gate que não existe", () => {
    expect(ROTA).not.toMatch(/csv \(Excel\)\. Admin-gated/);
    expect(SEM_COMENTARIO).not.toMatch(/requireAdmin/);
  });

  it("⚠️ e declara que a leitura por viewer é decisão, dizendo o porquê", () => {
    // Prosa que só diz "não tem gate" convida o próximo a "consertar". Prosa que diz "não tem gate
    // PORQUE foi decidido, e o teste X segura" faz a pessoa procurar a decisão antes de mexer.
    expect(ROTA).toMatch(/AUTORIZAÇÃO/);
    expect(ROTA).toMatch(/DECISÃO/);
    expect(ROTA).toMatch(/etapa187/);
  });

  it("⚠️ e a rota está DE FATO na lista declarada do etapa187 — a promessa é conferida", () => {
    // Sem isto, o docstring poderia apontar para um teste que não a cobre.
    const SUPERFICIE = readFileSync(
      join(__dirname, "etapa187-superficie-de-autorizacao.test.ts"), "utf-8",
    );
    expect(SUPERFICIE).toContain('"/api/v1/relatorios/votos-diretores",');
  });
});
