/**
 * Etapa 182 (Fase 31, Bloco 4) — o reparo dos 287 nomes entra no "Rodar tudo", e NÃO como passo.
 *
 * ═══ Por que entrar ═══
 * A rota que repara os nomes com mojibake existe desde o Commit C e **nunca foi chamada**. O usuário
 * disse *"não sei o que é isso e nem como fazer. Traga você isso pra mim."* — um reparo que só
 * existe atrás de um `curl` é `capacidade-sem-consumidor`: correto, medido, e inalcançável para
 * quem precisa dele.
 *
 * ═══ ⚠️ E por que NÃO como passo do plano — isto é medição, não preferência ═══
 * O desenho aprovado dizia "passo da esteira, no molde do `redatar`". Implementei, e o `etapa119`
 * reprovou: `reResultar` caiu de 7/24 para 4/24. Fui medir em vez de relaxar o piso:
 *
 *   · com a reserva em 500ms o `reResultar` cai IGUAL → a causa é o MÓDULO DO GIRO (a cabeça, que
 *     iria de 12 para 13), não o custo do passo;
 *   · quatro posições × três reservas = doze configurações: em todas, `reResultar` fica em 4-5;
 *   · cinco variantes do anel de privilégio: toda variante que devolve `reResultar` a ≥6 derruba
 *     `confirmLote` (5→3) e `enqueue` (6→4).
 *
 * O orçamento está saturado (~128s de reservas contra 66s), então um 13º passo de cabeça tira de
 * alguém necessariamente — e a vítima seria quem materializa VOTO. O `etapa119` existe justamente
 * para impedir esse trade, e a resposta certa era mudar o desenho, não afrouxar o teste.
 *
 * ═══ O desenho que sobrou ═══
 * O reparo não é trabalho RECORRENTE — é a drenagem de um passivo que se extingue. Então roda com a
 * SOBRA da rodada, depois de todos os passos planejados, e só quando a sobra cobre a reserva. Não
 * tira de ninguém; se não sobrar, não roda, e `restantes` o traz de volta.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ORDEM_DOS_PASSOS, RESERVA, planejarRodada, type PassoEsteira,
} from "../esteira-reservas";
import { naturezaDaChave } from "../agregar-rodadas";
import { reparoDoNome } from "../decodificar-nome-de-arquivo";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const RUN = semComentarios(ler("src/app/api/v1/pipeline/run/route.ts"));
const RUN_BRUTO = ler("src/app/api/v1/pipeline/run/route.ts");
const MOJI = semComentarios(ler("src/app/api/v1/admin/documentos/mojibake/route.ts"));
const RESERVAS_BRUTO = ler("src/lib/server/esteira-reservas.ts");
const TELA = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");

describe("etapa182 · o reparo é chamado pelo «Rodar tudo»", () => {
  it("a run importa o handler e o chama com `dry_run=0`", () => {
    /**
     * ⚠️ O handler e o caminho são exigidos JUNTOS, na mesma chamada.
     *
     * A primeira versão conferia o import numa expectativa e a URL noutra — e SOBREVIVEU à mutação
     * que trocava `mojibakePOST` por `redatarPOST` na chamada: o import continuava no arquivo, a
     * string da URL continuava no arquivo, e a esteira passava a chamar o `redatar` com o caminho do
     * mojibake. Oitava vez nesta fase que procurei texto em vez de medir a ligação.
     */
    expect(RUN).toMatch(/import \{ POST as mojibakePOST \} from "\.\.\/\.\.\/admin\/documentos\/mojibake\/route";/);
    expect(RUN).toMatch(
      /await chamarComSobra\(\s*mojibakePOST,\s*"\/api\/v1\/admin\/documentos\/mojibake\?dry_run=0",/,
    );
  });

  it("⚠️ e registra a etapa — capacidade que não aparece no banner é o defeito recorrente da fase", () => {
    expect(RUN).toMatch(/etapas\.reparar_nomes = anotar\(r, "reparo de nomes", \{/);
    expect(RUN).toMatch(/nomes_reparados: Number\(ap\.documentos \?\? 0\),/);
  });

  it("⚠️ publica o DENOMINADOR — «0 reparados» sem ele é o pior formato de zero", () => {
    // "0 reparados" é ambíguo entre "drenou" e "não achou nada por defeito". Com o passivo ao lado,
    // 0/0 é drenado e 0/287 é defeito — e são leituras opostas.
    expect(RUN).toMatch(/nomes_candidatos: Number\(esc\.no_escopo_zip \?\? 0\),/);
  });

  it("propaga `restantes` — sem isso a esteira não volta e o passivo fica pela metade", () => {
    const i = RUN.indexOf("etapas.reparar_nomes = anotar(");
    expect(RUN.slice(i, i + 700)).toMatch(/if \(r\.body\?\.restantes\) restantes = true;/);
  });

  it("falha não derruba a rodada — vira `erro`, que é o que o disjuntor conta", () => {
    expect(RUN).toMatch(/etapas\.reparar_nomes = \{ erro: "reparo de nomes falhou nesta rodada" \};/);
  });
});

describe("etapa182 · ⚠️ NÃO é passo do plano, e a medição que decidiu está travada", () => {
  it("`repararNomes` não está em `RESERVA` — logo não é `PassoEsteira`", () => {
    expect(Object.keys(RESERVA)).not.toContain("repararNomes");
    expect([...ORDEM_DOS_PASSOS] as string[]).not.toContain("repararNomes");
  });

  it("⚠️ a cabeça continua com DOZE passos — é o módulo do giro", () => {
    // Mutação a matar: acrescentar qualquer passo à cabeça. `reResultar` cai de 7 para 4 sem que
    // nada no código diga por quê, e o teste tabular do etapa119 é quem pega — mas só se alguém
    // rodar a suíte inteira. Aqui a invariante é nominal.
    const CAUDA = 3; // reaper, extracao, derivada
    expect(ORDEM_DOS_PASSOS.length - CAUDA, "a cabeça mudou de tamanho — REFAÇA a medição do anel")
      .toBe(12);
  });

  it("⚠️ e o piso que a medição protege continua de pé: `reResultar` ≥ 6/24", () => {
    // A mesma conta do etapa119, repetida aqui de propósito: é este número que o desenho de passo
    // teria custado, e é ele que justifica o carona da sobra existir.
    const f: Record<string, number> = {};
    for (const p of ORDEM_DOS_PASSOS) f[p] = 0;
    for (let r = 0; r < 24; r++) {
      for (const p of planejarRodada(r, 66_000, { drenar: true }).passos) f[p as PassoEsteira]++;
    }
    expect(f.reResultar, "reResultar regrediu — quem materializa voto está pagando a conta")
      .toBeGreaterThanOrEqual(6);
    expect(f.confirmLote).toBeGreaterThanOrEqual(5);
    expect(f.enqueue).toBeGreaterThanOrEqual(6);
  });

  it("a ausência está DOCUMENTADA com o número, no lugar onde alguém tentaria acrescentar", () => {
    // Sem isto, o próximo a olhar `ORDEM_DOS_PASSOS` conclui que foi esquecimento e "conserta".
    const i = RESERVAS_BRUTO.indexOf("export const ORDEM_DOS_PASSOS");
    const bloco = RESERVAS_BRUTO.slice(i, RESERVAS_BRUTO.indexOf("] as const;", i));
    expect(bloco).toMatch(/NÃO ESTÁ AQUI, e a ausência é medida/);
    expect(bloco).toMatch(/7\/24 para\s*\n?\s*\/\/ 4\/24|7\/24 para 4\/24/);
    expect(bloco).toMatch(/MÓDULO DO GIRO/);
  });

  it("e o `chamarComSobra` explica por que existe, com a medição do anel", () => {
    expect(RUN_BRUTO).toMatch(/Por que não é um passo \(e a medição que decidiu\)/);
    expect(RUN_BRUTO).toMatch(/`confirmLote` \(5→3\)/);
  });
});

describe("etapa182 · o carona respeita o orçamento — a lição da Fase 7 e da Fase 10", () => {
  it("⚠️ só roda com SOBRA mínima — fatia menor que a reserva gasta o auth e devolve zero", () => {
    expect(RUN).toMatch(/const SOBRA_MINIMA_REPARAR_NOMES_MS = \d[\d_]*;/);
    expect(RUN).toMatch(/if \(sobraParaNomes >= SOBRA_MINIMA_REPARAR_NOMES_MS\) \{/);
  });

  it("e tem TETO — sobra grande não vira licença para comer a rodada", () => {
    expect(RUN).toMatch(/Math\.min\(sobraParaNomes, TETO_REPARAR_NOMES_MS\)/);
  });

  it("⚠️ passa `budget_ms` — cinco rotas que o ignoravam foram a causa do «90s» na Fase 10", () => {
    const i = RUN.indexOf("async function chamarComSobra");
    const bloco = RUN.slice(i, i + 1200);
    expect(bloco).toMatch(/url\.searchParams\.set\("budget_ms", String\(Math\.round\(sliceMs\)\)\)/);
  });

  it("⚠️ e OLHA o status HTTP — ignorá-lo fez o cron reportar sucesso com 403", () => {
    const i = RUN.indexOf("async function chamarComSobra");
    const bloco = RUN.slice(i, i + 1600);
    expect(bloco).toMatch(/ok: res\.status >= 200 && res\.status < 300/);
  });

  it("a sobra é lida DEPOIS das derivadas — o carona não passa na frente de ninguém", () => {
    const derivadas = RUN.indexOf('["divergencia_votos", divergenciaPOST');
    const carona = RUN.indexOf("const sobraParaNomes = saldo();");
    expect(derivadas).toBeGreaterThan(-1);
    expect(carona, "o carona subiu na ordem e passou a competir com os passos planejados")
      .toBeGreaterThan(derivadas);
  });
});

describe("etapa182 · a rota honra o orçamento e é idempotente por construção", () => {
  it("lê `budget_ms` e usa `hasBudget` nos DOIS laços de escrita", () => {
    expect(MOJI).toMatch(/const deadlineAt = Date\.now\(\) \+ budgetFromRequest\(req\);/);
    const usos = (MOJI.match(/if \(!hasBudget\(deadlineAt, RESERVA_POR_DOCUMENTO_MS\)\) \{ restantes = true; break; \}/g) ?? []).length;
    expect(usos, "um dos dois laços de escrita não recheca o orçamento").toBe(2);
  });

  it("⚠️ o lote sai do ESCOPO, não do total — senão `restantes` nunca fica falso", () => {
    /**
     * Cortar antes do filtro de procedência faria o passo "drenar" enquanto sobrasse candidato FORA
     * do escopo — que nunca é tocado. `restantes` ficaria eternamente true e a esteira voltaria
     * todas as rodadas para não fazer nada, até o teto do cliente.
     */
    expect(MOJI).toMatch(/const lote = noEscopo\.slice\(0, LOTE_POR_RODADA\);/);
    expect(MOJI).toMatch(/if \(noEscopo\.length > lote\.length\) restantes = true;/);
    expect(MOJI, "o lote voltou a sair do total, ignorando o escopo")
      .not.toMatch(/const lote = m\.candidatos\.slice/);
  });

  it("os dois laços iteram o LOTE, não o escopo inteiro", () => {
    expect((MOJI.match(/for \(const c of lote\) \{/g) ?? []).length).toBe(2);
    expect(MOJI, "um laço voltou a percorrer o escopo inteiro, furando o lote")
      .not.toMatch(/for \(const c of noEscopo\) \{/);
  });

  it("⚠️ a idempotência é COMPORTAMENTO, medido: reparar o reparado devolve `null`", () => {
    /**
     * ⚠️ Esta é a expectativa que sustenta o passo inteiro, e ela é BEHAVIORAL de propósito.
     *
     * Não há carimbo no banco dizendo "este nome já foi reparado". O que impede a rodada seguinte de
     * reparar de novo é `reparoDoNome` devolver `null` quando não há página de código que pontue
     * melhor. Se essa propriedade cair, o lote se reenche todas as rodadas, `restantes` nunca fica
     * falso, e a esteira fica presa até o teto do cliente — gravando o mesmo nome eternamente.
     *
     * Uma versão anterior deste teste procurava a expressão do `>` no arquivo. Ela estava ERRADA
     * (a guarda real é `escolha.nome === nome`, e há um comentário longo explicando por que a
     * segunda guarda foi REMOVIDA por ser inalcançável) e, pior, mediria texto onde só o
     * comportamento importa. Sétima vez nesta fase.
     */
    // "DELIBERAÇÃO ARTESP Nº 646" gravado como CP850 lido como Latin-1.
    const cru = "DELIBERA\u0080\u00c7O ARTESP N\u00a7 646";
    const primeiro = reparoDoNome(cru);
    expect(primeiro, "o corpus de reparo mudou — reveja a fixture").not.toBeNull();
    expect(reparoDoNome(primeiro!.reparado), "reparar o reparado voltou a devolver reparo: o lote se reenche toda rodada")
      .toBeNull();
    // E o nome SADIO nunca é tocado — o mesmo reparo aplicado a ele o destruiria.
    expect(reparoDoNome("DELIBERAÇÃO ARTESP Nº 646")).toBeNull();
  });

  it("publica `restantes` e o tamanho do lote da rodada", () => {
    expect(MOJI).toMatch(/lote_desta_rodada: lote\.length,/);
    expect(MOJI).toMatch(/lote_maximo: LOTE_POR_RODADA,/);
    expect(MOJI).toMatch(/\n    restantes,/);
  });

  it("o guard aceita cron — `requireAdmin` sozinho daria 403 na esteira", () => {
    expect(MOJI).toMatch(/const guard = await requireAdminOrCron\(req\);/);
  });

  it("e o GET continua sem caminho de escrita nenhum", () => {
    const i = MOJI.indexOf("export async function GET(");
    const j = MOJI.indexOf("export async function POST(");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    const getBloco = MOJI.slice(i, j);
    expect(getBloco, "o GET ganhou escrita").not.toMatch(/\.update\(|exigirEscrita\(/);
  });
});

describe("etapa182 · as DUAS naturezas na tela, e o sinal de aceite", () => {
  it("⚠️ `nomes_candidatos` é ESTOQUE — somá-lo daria 741 num acervo de 287", () => {
    expect(naturezaDaChave("nomes_candidatos")).toBe("estoque");
  });

  it("e `nomes_reparados` é EVENTO — ele conta o que as rodadas fizeram", () => {
    expect(naturezaDaChave("nomes_reparados")).toBe("evento");
    expect(naturezaDaChave("jobs_reparados")).toBe("evento");
  });

  it("a linha do banner mostra o feito E o que resta", () => {
    expect(TELA).toMatch(/nome\(s\) de arquivo reparados/);
    expect(TELA).toMatch(/restam \$\{totais\.nomes_candidatos \?\? 0\} candidato\(s\) de ZIP no acervo/);
  });

  it("⚠️ a linha aparece mesmo com ZERO reparados, se ainda houver passivo", () => {
    // Mutação a matar: gatear só por `nomes_reparados > 0`. Uma rodada em que todas as escritas
    // falharam mostraria o mesmo banner de uma rodada drenada — o defeito da Fase 21.
    expect(TELA).toMatch(
      /\(totais\.nomes_reparados \?\? 0\) > 0 \|\| \(totais\.nomes_candidatos \?\? 0\) > 0/,
    );
  });
});
