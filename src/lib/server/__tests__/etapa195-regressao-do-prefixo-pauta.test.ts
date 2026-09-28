/**
 * Etapa 195 (Fase 34, Bloco 0) — ⚠️ UMA REGRESSÃO QUE EU MESMO INTRODUZI NA FASE 33.
 *
 * ═══ O que o `a4cd15f` consertou, e o que ele quebrou junto ═══
 * O conserto da ANTT fez `documento_antt_tipo` voltar a viajar no payload da esteira. Isso devolve
 * os quatro votos que o relator engolia. **E, pela mesma linha, muda duas outras coisas:**
 *
 *   const anttType = d.documento_antt_tipo;
 *   return anttType === "ata" ? "ATA" : anttType ? "PAUTA" : "ATA";
 *
 *  · ANTES, na esteira, `anttType` era `undefined` ⇒ último ramo ⇒ prefixo **`ATA-`**.
 *  · DEPOIS, uma RDE chega como `reuniao_deliberativa_eletronica` ⇒ truthy e ≠ "ata" ⇒ **`PAUTA-`**.
 *
 * E o filho HERDA o subtipo (`ata-item-materializacao.ts:159-160`), o que aciona a exclusão de
 * `isFinalDecisionRecord`: a deliberação some de todo denominador de decisão final **enquanto os
 * votos dela continuam gravados**. Métrica e tabela `votos` passariam a discordar.
 *
 * ⚠️ Não produziu linha ainda só porque as duas rodadas de "Rodar tudo" depois do deploy deram
 * `0 PDF(s) extraído(s) · 0 materializado(s)`. Foi sorte, não desenho.
 *
 * ═══ E o defeito é mais velho que o meu commit ═══
 * O prefixo `PAUTA-` sempre saiu para os tipos `reuniao_*`. É por isso que a 1.028ª tem filhos
 * `PAUTA-1.028-*` COM voto e COM resultado, enquanto a `ATA-1.028` existe sem filho nenhum. São
 * decisões de verdade carimbadas como agenda — e `re-resultar` as exclui por predicado
 * (`.not(… like 'PAUTA-%')`), então nem o reparo as alcança.
 *
 * ⚠️ A distinção que o código não fazia: `pauta` e `voto_individual` são documentos que NÃO contêm
 * decisão (o filho de pauta é fantasma, lição da `etapa113`). Já `reuniao_*` é o CONTINENTE de uma
 * sessão — a mãe não é decisão, mas o item com `resultado` é. Tratar os cinco subtipos igual
 * apagava decisão real junto com item fantasma.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { isFinalDecisionRecord } from "../regulatory-documents";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const CONFIRM = semComentarios(ler("src/app/api/v1/upload/confirm/route.ts"));

/** Os três tipos que descrevem uma SESSÃO da ANTT. A mãe é envelope; os itens são decisão. */
const CONTINENTES = [
  "reuniao_deliberativa_eletronica",
  "reuniao_diretoria_publica",
  "reuniao_extraordinaria",
] as const;

/** O filho de ata como `buildRawExtractionDoItem` o monta, com o subtipo herdado do pai. */
function filhoDeAta(subtipo: string | null) {
  return {
    tipo_documento: "ata",
    documento_pai_id: "mae-1",
    resultado: "Aprovado",
    raw_extraction: {
      import_counts_as_final: true,
      item_numero: "1.4.4",
      ...(subtipo ? { documento_antt_tipo: subtipo, documento_subtipo: subtipo } : {}),
    },
  };
}

describe("etapa195 · ⚠️ o item de uma sessão da ANTT é DECISÃO, não agenda", () => {
  it("filho com `resultado` conta como decisão final, com o subtipo de sessão herdado", () => {
    for (const subtipo of CONTINENTES) {
      expect(isFinalDecisionRecord(filhoDeAta(subtipo)), `${subtipo} derrubou a decisão`).toBe(true);
    }
  });

  it("e continuava contando antes do meu commit — quando o subtipo não viajava", () => {
    // É a comparação que prova a REGRESSÃO: mesmo documento, só muda o campo que o `a4cd15f` restaurou.
    expect(isFinalDecisionRecord(filhoDeAta(null))).toBe(true);
  });

  it("⚠️ mas a MÃE da sessão continua fora — ela é envelope, não decisão", () => {
    for (const subtipo of CONTINENTES) {
      expect(isFinalDecisionRecord({
        tipo_documento: "ata",
        documento_pai_id: null,
        resultado: null,
        raw_extraction: { documento_antt_tipo: subtipo, documento_subtipo: subtipo },
      }), `a mãe ${subtipo} passou a contar`).toBe(false);
    }
  });

  it("⚠️⚠️ e o filho de PAUTA continua fora — essa é a lição da etapa113, e ela não muda", () => {
    /**
     * Pauta e voto individual são outra coisa: o filho de pauta é FANTASMA (item de agenda que
     * ninguém decidiu ainda), e o voto individual tem 1 voto por desenho. Afrouxar para eles
     * ressuscitaria os 35 filhos-fantasma que o projeto já mediu e arquivou.
     */
    for (const subtipo of ["pauta", "voto_individual"]) {
      expect(isFinalDecisionRecord(filhoDeAta(subtipo)), `${subtipo} passou a contar`).toBe(false);
    }
  });

  it("e `import_counts_as_final: false` continua tendo a última palavra", () => {
    const f = filhoDeAta("reuniao_deliberativa_eletronica");
    (f.raw_extraction as Record<string, unknown>).import_counts_as_final = false;
    expect(isFinalDecisionRecord(f)).toBe(false);
  });

  it("filho SEM resultado não é decisão, com ou sem subtipo", () => {
    for (const subtipo of [null, ...CONTINENTES]) {
      const f = filhoDeAta(subtipo);
      f.resultado = null as unknown as string;
      expect(isFinalDecisionRecord(f), `${subtipo} sem resultado passou`).toBe(false);
    }
  });
});

describe("etapa195 · ⚠️ o PREFIXO: `PAUTA-` só para quem é pauta de verdade", () => {
  it("o leitor do prefixo compara com `pauta`, não com «é diferente de ata»", () => {
    /**
     * A forma antiga (`anttType === "ata" ? "ATA" : anttType ? "PAUTA" : "ATA"`) chamava de PAUTA
     * tudo o que não fosse exatamente "ata" — incluindo os três tipos de sessão, que o próprio
     * classificador mapeia para `tipo = "ata"` (`regulatory-documents.ts:59-64`). Contradição
     * interna: o documento é ata para o classificador e pauta para o número.
     */
    expect(CONFIRM).toMatch(/return anttType === "pauta" \? "PAUTA" : "ATA";/);
    expect(CONFIRM, "voltou a forma que chama de PAUTA tudo o que não é ata")
      .not.toMatch(/anttType === "ata" \? "ATA" : anttType \? "PAUTA" : "ATA"/);
  });

  it("⚠️ e a lista de subtipos separa CONTINENTE de documento-sem-decisão", () => {
    const RD = semComentarios(ler("src/lib/server/regulatory-documents.ts"));
    // Os dois conjuntos existem e são distintos — tratá-los igual foi o defeito.
    expect(RD).toMatch(/SUBTIPOS_SEM_DECISAO/);
    expect(RD).toMatch(/SUBTIPOS_DE_SESSAO/);
    for (const c of CONTINENTES) {
      expect(RD, `${c} saiu do conjunto de sessão`).toMatch(
        new RegExp(`SUBTIPOS_DE_SESSAO[\\s\\S]{0,400}?"${c}"`),
      );
    }
  });
});
