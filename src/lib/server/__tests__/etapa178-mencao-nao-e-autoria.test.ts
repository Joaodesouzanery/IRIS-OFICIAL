/**
 * Etapa 178 (Fase 31, Bloco 3) — autoria decidida por MAIORIA DE MENÇÕES.
 *
 * ═══ Medido em produção ═══
 * Duas Deliberações **da ARTESP** estão arquivadas como documentos **da ANTT**:
 *
 *   `"DELIBERAÇÃO ARTESP Nº 593_SEI - 134.00006135_2025-84_SUMEF_ACT_ANTT_AR…"`
 *   `"DELIBERAÇÃO ARTESP Nº 426_SEI - 134.00022795_2026-93_SUCOL_Reajuste Pe…"`
 *
 * O SEI `134.xxx` é da ARTESP; SUMEF e SUCOL são superintendências da ANTT, citadas porque o assunto
 * é um ACT entre as duas. O título diz ARTESP. O banco diz ANTT.
 *
 * ═══ ⚠️ A HIPÓTESE QUE EU AFIRMEI E QUE A MEDIÇÃO REFUTOU ═══
 * Eu escrevi que a causa era `isAntt` casando `\bantt\b` em `_ACT_ANTT_` porque `normalize` trocaria
 * `[^a-z0-9]+` por espaço, e que `upload-analysis.ts:186` então forçaria a sigla. **Medido: falso.**
 *
 * `antt-manual-parser.ts` tem um `normalize` **LOCAL** (`:1095`) que só faz lowercase e remove
 * diacrítico — o `_` **fica**, e `_` é `\w`, então não há fronteira `\b` ali. `isAntt` é `false`
 * nesses dois nomes. E `detectAgenciaSigla(filename)` devolve `"ARTESP"`, que é o certo.
 *
 * ═══ O mecanismo REAL ═══
 * Para a linha ter saído ANTT, `agencia_id_detected` foi ANTT (`pipeline.ts:164` só usa
 * `job.agencia_id` como fallback). Como o nome diz ARTESP, **só o TEXTO pode ter virado a contagem**.
 *
 * `detectAgenciaSigla` (`classifier.ts:218-226`) decide por **maioria de menções**. Num documento
 * interagências as menções à contraparte dominam o corpo. **O título é autoridade; o corpo é
 * assunto** — e a contagem não distingue os dois.
 *
 * Consertar isso é mudança de atribuição em massa e NÃO entrou nesta fase. Este arquivo trava o
 * mecanismo medido, para a próxima tentativa não recomeçar da hipótese errada.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseAnttManualDocument, isAnttVotoFilename } from "@/lib/server/antt-manual-parser";
import { detectAgenciaSigla } from "@/lib/server/classifier";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const SIGLAS = ["ANTT", "ARTESP", "ANM"];
const NOME_593 = "DELIBERAÇÃO ARTESP Nº 593_SEI - 134.00006135_2025-84_SUMEF_ACT_ANTT_ARTESP.pdf";
const NOME_426 = "DELIBERAÇÃO ARTESP Nº 426_SEI - 134.00022795_2026-93_SUCOL_Reajuste Pedagio.pdf";

describe("etapa178 · ⚠️ a hipótese refutada — `isAntt` NÃO é a causa", () => {
  it.each([["593", NOME_593], ["426", NOME_426]])("`isAntt` é FALSE em %s", (_r, nome) => {
    // Se fosse true, o override antigo explicaria o defeito. Não é.
    expect(parseAnttManualDocument("Deliberação da Diretoria da ARTESP.", nome).isAntt).toBe(false);
    expect(parseAnttManualDocument("", nome).isAntt).toBe(false);
  });

  it("o `normalize` do parser é LOCAL e PRESERVA o `_` — é por isso que não casa", () => {
    const PARSER = ler("src/lib/server/antt-manual-parser.ts");
    // O local: lowercase + NFD, sem `[^a-z0-9]`.
    expect(PARSER).toMatch(/function normalize\(value: string\) \{\s*return cleanText\(value\)\s*\.toLowerCase\(\)/);
    const local = PARSER.slice(PARSER.indexOf("function normalize(value: string)"));
    expect(local.slice(0, 260), "o normalize local passou a remover pontuação — reavalie a hipótese")
      .not.toMatch(/\[\^a-z0-9\]/);
    // E a aritmética do porquê: `_` é `\w`, então não há fronteira de palavra ao lado dele.
    expect(/\bantt\b/.test("_act_antt_artesp")).toBe(false);
    expect(/\bantt\b/.test(" act antt artesp ")).toBe(true);
  });

  it("⚠️ e o NOME, sozinho, diz ARTESP — o filename está correto", () => {
    expect(detectAgenciaSigla(NOME_593, SIGLAS)).toBe("ARTESP");
    expect(detectAgenciaSigla(NOME_426, SIGLAS)).toBe("ARTESP");
  });

  it("o nome também não é voto ANTT — o sinal específico do filename não confunde", () => {
    expect(isAnttVotoFilename(NOME_593)).toBe(false);
    expect(isAnttVotoFilename(NOME_426)).toBe(false);
    expect(isAnttVotoFilename("Voto DFQ 035-2026.pdf"), "o sinal legítimo parou de funcionar").toBe(true);
  });
});

describe("etapa178 · o mecanismo REAL: maioria de menções decide autoria", () => {
  it("⚠️ com o corpo citando a contraparte mais vezes, a contagem VIRA", () => {
    // É a única explicação que resta: o nome diz ARTESP, e a linha saiu ANTT.
    const corpoDeUmACT =
      "Deliberação sobre o Acordo de Cooperação Técnica. A ANTT e a concessionária. " +
      "Nos termos do ACT, a ANTT fiscaliza. A ANTT publicará. Manifestação da ANTT.";
    expect(detectAgenciaSigla(`${NOME_593}\n${corpoDeUmACT}`, SIGLAS)).toBe("ANTT");
  });

  it("e com o corpo falando da própria agência, a contagem acerta", () => {
    const corpoNormal = "A Diretoria da ARTESP delibera. A ARTESP autoriza o reajuste.";
    expect(detectAgenciaSigla(`${NOME_593}\n${corpoNormal}`, SIGLAS)).toBe("ARTESP");
  });

  it("a regra é literalmente «a mais frequente vence» — sem peso para o título", () => {
    const CLASS = semComentarios(ler("src/lib/server/classifier.ts"));
    expect(CLASS).toMatch(/\.sort\(\(a, b\) => b\.count - a\.count\)/);
    // Nenhum peso por posição/título. Se isso mudar, este teste tem de ser revisto junto.
    const i = CLASS.indexOf("export function detectAgenciaSigla");
    expect(CLASS.slice(i, i + 500), "detectAgenciaSigla passou a pesar posição — atualize o diagnóstico")
      .not.toMatch(/peso|weight|titulo|header/i);
  });
});

describe("etapa178 · o endurecimento que ENTROU, descrito pelo que ele é", () => {
  const ANALISE = semComentarios(ler("src/lib/server/upload-analysis.ts"));
  const ANALISE_RAW = ler("src/lib/server/upload-analysis.ts");

  it("o override da ANTT deixou de ser incondicional", () => {
    // Não conserta os dois documentos (a causa é outra), mas sobrescrever a contagem sem olhar o que
    // ela disse é errado em princípio: `isAntt` existe para LIGAR o parser, não para decidir autoria.
    expect(ANALISE).toMatch(
      /if \(antt\.isAntt && \(!agencia_sigla_detected \|\| agencia_sigla_detected === "ANTT"\)\) \{/,
    );
    expect(ANALISE, "voltou o override sem condição")
      .not.toMatch(/if \(antt\.isAntt\) agencia_sigla_detected = "ANTT";/);
  });

  it("⚠️ e o comentário NÃO atribui a ele o defeito dos dois documentos", () => {
    // A honestidade do registro é o que impede a próxima tentativa de recomeçar da hipótese errada.
    const i = ANALISE_RAW.indexOf("if (antt.isAntt && (!agencia_sigla_detected");
    const antes = ANALISE_RAW.slice(Math.max(0, i - 2400), i);
    expect(antes).toMatch(/NÃO É O MECANISMO DOS DOIS DOCUMENTOS/);
    expect(antes).toMatch(/MAIORIA DE MENÇÕES/);
    expect(antes).toMatch(/normalize` que o parser usa é LOCAL/);
  });

  it("`isAntt` continua ligando o parser — o endurecimento não tocou o detector", () => {
    // Mexer em `isAntt` faria um voto real da ANTT sem a sigla no texto voltar a virar
    // "? · documento_apoio" (o motivo pelo qual `RE_ANTT_VOTO_FILENAME` existe).
    expect(ANALISE).toMatch(/if \(antt\.isAntt\) confidence = Math\.max\(confidence, antt\.confidenceBoost\)/);
    const PARSER = semComentarios(ler("src/lib/server/antt-manual-parser.ts"));
    expect(PARSER).toMatch(/isAnttVotoFilename\(filename\)/);
  });
});

describe("etapa178 · ⚠️ o comentário do pipeline dizia algo que deixou de ser verdade", () => {
  const PIPE = ler("src/lib/server/pipeline.ts");

  it("a frase «só detecta agência a partir do TEXTO» saiu", () => {
    expect(PIPE, "a frase refutada voltou")
      .not.toMatch(/a análise só detecta agência a partir do TEXTO/);
  });

  it("e a precedência inferência-sobre-fonte fica REGISTRADA, não silenciosa", () => {
    const i = PIPE.indexOf("agencia_id: analysis.agencia_id_detected ?? job.agencia_id");
    expect(i).toBeGreaterThan(-1);
    const antes = PIPE.slice(Math.max(0, i - 1400), i);
    expect(antes).toMatch(/precedência/);
    expect(antes).toMatch(/PENDENCIAS\.md/);
  });
});

describe("etapa178 · a triagem em SQL se declara TRIAGEM", () => {
  const QA = ler("docs/qa-fase31.sql");

  it("o bloco existe e lista o par suspeito, com fronteira de palavra", () => {
    expect(QA).toMatch(/'6_agencia_citada_no_nome'/);
    // Sem `\m`/`\M`, "ANM" casaria dentro de outras palavras.
    expect(QA).toMatch(/'\\m' \|\| outra\.sigla \|\| '\\M'/);
  });

  it("⚠️ e o comentário registra o mecanismo MEDIDO, não a hipótese", () => {
    const i = QA.indexOf("'6_agencia_citada_no_nome'");
    const antes = QA.slice(Math.max(0, i - 1800), i);
    expect(antes).toMatch(/MAIORIA DE MENCOES/);
    expect(antes).toMatch(/da FALSE nesses nomes/);
    expect(antes).toMatch(/TRIAGEM, NAO VEREDITO/);
    expect(antes, "não avisa do falso positivo legítimo").toMatch(/falso positivo/);
  });
});
