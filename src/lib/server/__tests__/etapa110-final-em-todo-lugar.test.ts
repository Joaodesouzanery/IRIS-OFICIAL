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
