/**
 * Etapa 110 (Fase 18, commit 3) — "deliberação final" quer dizer a MESMA coisa em todo lugar.
 *
 * ═══ A classe, não o par ═══
 * Esta é a TERCEIRA vez que dois sítios que contam a mesma coisa divergem: `taxa_sancao` entre
 * demo e produção (Fase 13), e agora "deliberação final" entre `cobertura-documentos` e os
 * outros três sítios. Corrigir par a par garante uma quarta — por isso o teste enumera TODOS os
 * sítios que decidem sozinhos o que é final e exige a mesma regra de cada um.
 *
 * ═══ A regra ═══
 * Item de ATA só é deliberação quando tem PAI **e** RESULTADO. Sem o `resultado`, é o quinto
 * estado (nomeado na Fase 17): existe, tem pai, e nenhum desfecho foi extraído. A medição de
 * produção mostrou 267 nessa situação contra 209 com resultado — mais da metade. Contá-los como
 * finais num painel e não nos outros produz dois números "certos" que não fecham.
 *
 * O predicado canônico é `isFinalDecisionRecord` (regulatory-documents.ts); quem não pode
 * importá-lo (rotas que filtram no SQL, por volume) tem de repetir a regra INTEIRA — e é isso
 * que este teste vigia.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { isFinalDecisionRecord } from "@/lib/server/regulatory-documents";
import { classificarDescarte } from "@/lib/server/metricas-decomposicao";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) =>
  readFileSync(join(RAIZ, p), "utf-8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");

/**
 * Sítios que decidem "é final?" por conta própria, sem chamar o predicado canônico — em geral
 * porque leem um recorte enxuto para caber no orçamento. Cada um precisa repetir a regra inteira.
 */
const SITIOS_COM_REGRA_PROPRIA = [
  "src/app/api/v1/admin/cobertura-documentos/route.ts",
  "src/app/api/v1/admin/votos/materializar-faltantes/route.ts",
  "src/app/api/v1/admin/completude-2026/route.ts",
  "src/app/api/v1/relatorios/votos-diretores/route.ts",
];

describe("etapa110 · a regra do item de ata é a MESMA em todos os sítios", () => {
  it.each(SITIOS_COM_REGRA_PROPRIA)("%s exige PAI **e** RESULTADO", (arquivo) => {
    const fonte = ler(arquivo);
    // As duas formas aceitas: `documento_pai_id && resultado` (positiva) ou
    // `!(documento_pai_id && resultado)` (negativa, com `continue`).
    expect(fonte, "decide 'ata é final' sem olhar o resultado").toMatch(
      /documento_pai_id[\s\S]{0,40}?&&[\s\S]{0,40}?resultado/,
    );
  });

  it.each(SITIOS_COM_REGRA_PROPRIA)("%s SELECIONA o resultado — senão a regra roda cega", (arquivo) => {
    // Verificar a regra sem trazer a coluna é pior que não verificar: `undefined` é falsy, e o
    // sítio passaria a descartar TUDO em silêncio.
    const fonte = ler(arquivo);
    expect(fonte).toMatch(/\.select\([^)]*resultado/);
  });
});

/**
 * ⚠️ Fase 31, Bloco 4 — O EIXO QUE ESTE TESTE NÃO COBRIA, e é ele que produz o «40 ≠ 45».
 *
 * As duas expectativas acima exigem que a regra da ATA coincida nos quatro sítios. Elas passam
 * verde — e passam EXATAMENTE SOBRE a divergência que confunde o operador:
 *
 *   "40 deliberações finais sem nenhum voto"  (Completude 2026)
 *   "45 ainda sem voto"                        (banner do materializador)
 *
 * Parecem a mesma frase. São populações diferentes, por três eixos:
 *
 *   eixo         | Completude          | materializador
 *   ano          | só o ano do param   | TODOS (a esteira chama sem `year`)
 *   `resultado`  | exigido só de `ata` | exigido de TODOS os tipos, no SQL
 *   `ativo`      | filtra agência      | não filtra
 *
 * ⚠️ O eixo do meio é o insidioso: uma deliberação de 2026 do tipo `deliberacao` com
 * `resultado IS NULL` CONTA nas 40 e é INVISÍVEL ao backfill — o `.not("resultado","is",null)` a
 * corta. São deliberações que o painel acusa e que o backfill JAMAIS tentará resolver.
 *
 * Não é defeito de nenhum dos dois: são recortes legítimos e diferentes. O defeito era **nenhum dos
 * dois declarar o seu**, e um teste verde por cima disso. Este bloco cobra a declaração.
 */
describe("etapa110 · ⚠️ os dois recortes DIVERGEM de propósito — e cada um diz o seu", () => {
  it("o materializador exige `resultado` de TODOS os tipos, no SQL", () => {
    const fonte = ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts");
    // É este filtro que torna a deliberação sem `resultado` invisível ao backfill.
    expect(fonte).toMatch(/\.not\("resultado", "is", null\)/);
  });

  it("a Completude exige `resultado` SÓ de `ata` — e é por isso que ela conta mais", () => {
    const fonte = ler("src/app/api/v1/admin/completude-2026/route.ts");
    expect(fonte).toMatch(/if \(d\.tipo_documento === "ata"\) return Boolean\(d\.documento_pai_id && d\.resultado\);\s*return true;/);
  });

  it("⚠️ a Completude DECLARA o recorte na resposta — sem isso os dois números se leem como erro", () => {
    const fonte = ler("src/app/api/v1/admin/completude-2026/route.ts");
    expect(fonte).toMatch(/recorte: \{/);
    expect(fonte).toMatch(/por_que_difere_do_backfill:/);
    expect(fonte).toMatch(/resultado_exigido_de:/);
  });

  it("e a TELA mostra o recorte junto da tabela, não escondido no JSON", () => {
    const tela = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");
    // ⚠️ Ancorado no ELEMENTO: `/Recorte:/` solto sobrevive a renomear para `_Recorte:`, porque
    // casa como substring. Nona vez nesta fase.
    expect(tela).toMatch(/>\s*Recorte: <span className="font-mono">\{completude\.ano\}<\/span>/);
    expect(tela).toMatch(/exigido apenas de/);
    expect(tela).toMatch(/os números divergem sem que nenhum esteja errado/);
  });
});

/**
 * Fase 21 — os sítios que passaram a chamar o CANÔNICO em vez de repetir a regra. `mandatos/stats`
 * tinha uma aproximação SQL que conta filho de ata SEM resultado; o número estrito agora sai ao
 * lado do aproximado (`total_finais_estrito`) até o usuário aprovar a troca do card.
 */
const SITIOS_QUE_CHAMAM_O_CANONICO = ["src/app/api/v1/mandatos/stats/route.ts"];

describe("etapa110 · quem não repete a regra chama o canônico", () => {
  it.each(SITIOS_QUE_CHAMAM_O_CANONICO)("%s usa isFinalDecisionRecord e publica o número estrito", (arquivo) => {
    const fonte = ler(arquivo);
    expect(fonte).toMatch(/isFinalDecisionRecord\(/);
    expect(fonte).toMatch(/total_finais_estrito/);
    expect(fonte, "a regra roda cega sem o resultado").toMatch(/\.select\([^)]*resultado/);
  });
});

describe("etapa110 · COMPORTAMENTO: o predicado canônico e a decomposição concordam", () => {
  // Se estes dois divergirem, o Dashboard e a auditoria passam a contar coisas diferentes com o
  // mesmo nome — que é exatamente a classe de bug que este arquivo existe para matar.
  const casos = [
    { nome: "deliberação com resultado", row: { tipo_documento: "deliberacao", resultado: "Deferido" }, final: true },
    // Deliberação sem resultado É final: é o QUARTO estado (`sem_resultado`), dentro do
    // total. Não confundir com o QUINTO (item de ata com pai e sem resultado), que fica fora.
    { nome: "deliberação sem resultado", row: { tipo_documento: "deliberacao", resultado: null }, final: true },
    { nome: "item de ata com pai e resultado", row: { tipo_documento: "ata", documento_pai_id: "p", resultado: "Deferido" }, final: true },
    { nome: "item de ata com pai, SEM resultado", row: { tipo_documento: "ata", documento_pai_id: "p", resultado: null }, final: false },
    { nome: "ata envelope (sem pai)", row: { tipo_documento: "ata", documento_pai_id: null, resultado: "Deferido" }, final: false },
    { nome: "pauta", row: { tipo_documento: "pauta", resultado: "Deferido" }, final: false },
    { nome: "voto individual", row: { tipo_documento: "voto_individual", resultado: "Deferido" }, final: false },
  ];

  it.each(casos)("$nome → final=$final nos DOIS", ({ row, final }) => {
    expect(isFinalDecisionRecord(row as any), "predicado canônico").toBe(final);
    expect(classificarDescarte(row as any) === null, "decomposição do Dashboard").toBe(final);
  });
});
