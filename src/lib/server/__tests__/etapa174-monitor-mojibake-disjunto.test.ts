/**
 * Etapa 174 (Fase 31, Bloco 3) — o monitor de mojibake para de medir a mesma coisa duas vezes.
 *
 * ═══ O defeito, medido em produção ═══
 * O QA de produção devolveu, nos TRÊS grupos de agência, `cp850_controle_c1` e `cp850_sem_controle`
 * com **valores idênticos** (286 e 286 na ARTESP). Não era coincidência: o segundo contador não
 * tinha `AND NOT [C1]`.
 *
 *     cp850_controle_c1  = filename ~ '[\u0080-\u009f]'
 *     cp850_sem_controle = filename ~ '[ §µ¶·¤]'        ← sem excluir C1
 *
 * O comentário na linha prometia *"o caso SEM controle nenhum"* e o predicado não prometia isso. O
 * rótulo mentia — e, pior, **o ponto cego que aquele contador existe para cobrir continuava cego**:
 * `"Ata ordinária"` → `"Ata ordin ria"` não tem C1 algum, e ficava indistinguível dentro dos 286.
 *
 * Por que os dois deram o MESMO número em produção: quase todo nome de deliberação da ARTESP traz
 * `nº` (do número SEI), que em CP850 é `0xA7` e vira `§`; e traz `ção`, cujo `ç` (`0x87`) vira o
 * controle C1 `U+0087`. Ou seja, o corpus inteiro tem as duas assinaturas ao mesmo tempo. A
 * igualdade era acidente do acervo; o rótulo estava errado de qualquer jeito.
 *
 * ⚠️ AS FIXTURES SÃO BYTES REAIS, produzidos pelo codec CP850 e lidos como Latin-1 — não strings
 * escritas à mão. Cada uma reproduz, byte a byte, um nome que apareceu na amostra de produção.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

const QA31 = ler("docs/qa-fase31.sql");
const QA14 = ler("docs/qa-fase14.sql");

/**
 * As classes de caractere são LIDAS DO SQL, não copiadas para cá.
 *
 * ⚠️ Reescrevê-las neste arquivo criaria uma segunda verdade — exatamente o defeito que esta base
 * já pagou com `RE_CONTESTADO` e com a chave de dedup. Se alguém trocar a classe no SQL, este teste
 * passa a medir a classe nova.
 */
function classeDoSql(sql: string, rotulo: string): RegExp {
  // A linha do contador, e a classe que ela usa.
  const bloco = sql.slice(sql.indexOf(rotulo) - 600, sql.indexOf(rotulo));
  const achadas = bloco.match(/\[\\u00a0[^\]]*\]|\[\\u0080-\\u009f\]/g);
  expect(achadas, `não achei classe de caractere perto de ${rotulo}`).toBeTruthy();
  const classe = achadas![achadas!.length - 1];
  // `\uXXXX` é entendido igual por Postgres (ARE) e por JS RegExp.
  return new RegExp(classe);
}

const C1 = classeDoSql(QA31, "AS cp850_controle_c1");
const ALTO = classeDoSql(QA31, "AS cp850_sem_controle");
const FFFD = "�";

/** Os três baldes, exatamente como o SQL os declara: disjuntos, e o FFFD fora dos dois CP850. */
function classificar(nome: string): "c1" | "sem_controle" | "fffd" | "sadio" {
  if (nome.includes(FFFD)) return "fffd";
  if (C1.test(nome)) return "c1";
  if (ALTO.test(nome)) return "sem_controle";
  return "sadio";
}

/** Nome real → bytes CP850 → lidos como Latin-1. É o caminho que o defeito percorreu. */
const comoCp850 = (bytes: number[]) => Buffer.from(bytes).toString("latin1");

/** `"Deliberação nº 571"` — da amostra de produção do grupo ARTESP. Tem C1 (0x87) E `§` (0xA7). */
const DELIBERACAO_571 = comoCp850([
  0x44, 0x65, 0x6c, 0x69, 0x62, 0x65, 0x72, 0x61, 0x87, 0xc6, 0x6f,
  0x20, 0x6e, 0xa7, 0x20, 0x35, 0x37, 0x31,
]);

/** `"DELIBERAÇÃO ARTESP Nº 593"` — da amostra do grupo rotulado ANTT. C1 é 0x80 (o `Ç`). */
const DELIBERACAO_593 = comoCp850([
  0x44, 0x45, 0x4c, 0x49, 0x42, 0x45, 0x52, 0x41, 0x80, 0xc7, 0x4f, 0x20,
  0x41, 0x52, 0x54, 0x45, 0x53, 0x50, 0x20, 0x4e, 0xa7, 0x20, 0x35, 0x39, 0x33,
]);

/** ⚠️ `"Ata ordinária"` — o caso que o contador existe para pegar: `á` = 0xA0 = NBSP, ZERO C1. */
const ATA_ORDINARIA = comoCp850([
  0x41, 0x74, 0x61, 0x20, 0x6f, 0x72, 0x64, 0x69, 0x6e, 0xa0, 0x72, 0x69, 0x61,
]);

/** `"Início da Operação"` — tem C1 (0x87) e NENHUM símbolo alto. O espelho do caso acima. */
const INICIO_OPERACAO = comoCp850([
  0x49, 0x6e, 0xa1, 0x63, 0x69, 0x6f, 0x20, 0x64, 0x61, 0x20,
  0x4f, 0x70, 0x65, 0x72, 0x61, 0x87, 0xc6, 0x6f,
]);

describe("etapa174 · as fixtures reproduzem a produção byte a byte", () => {
  it("⚠️ `Deliberação nº 571` em CP850 rende exatamente o que o QA mostrou", () => {
    // Produção: "DeliberaÆo_571_Proc. SEI! n§ 134.00013420_2025_51 (In¡cio da OperaÆo"
    expect(DELIBERACAO_571).toContain("Æo");
    expect(DELIBERACAO_571).toContain("n§ 571");
    expect(DELIBERACAO_571).toContain("\u0087");
  });

  it("⚠️ `DELIBERAÇÃO ARTESP Nº 593`: o Ç fica e o Ã SOME — e é o Ç que virou invisível", () => {
    // O sintoma relatado era "o Ã some". Não some: Ç(0x80)→U+0080 invisível, e Ã(0xC7)→Ç.
    expect(DELIBERACAO_593).toContain("\u0080ÇO");
    expect(DELIBERACAO_593.replace(/[\u0080-\u009f]/g, "")).toContain("DELIBERAÇO");
    expect(DELIBERACAO_593).not.toContain("Ã");
  });

  it("⚠️ `Ata ordinária` NÃO tem controle C1 nenhum — é o ponto cego inteiro", () => {
    expect(ATA_ORDINARIA).toBe("Ata ordin ria");
    expect(/[\u0080-\u009f]/.test(ATA_ORDINARIA), "tem C1, então não é o caso cego").toBe(false);
  });

  it("e `Início da Operação` é o espelho: tem C1 e NENHUM símbolo alto", () => {
    expect(/[\u0080-\u009f]/.test(INICIO_OPERACAO)).toBe(true);
    expect(/[ §µ¶·¤]/.test(INICIO_OPERACAO)).toBe(false);
  });
});

describe("etapa174 · os três baldes são MUTUAMENTE EXCLUSIVOS", () => {
  it.each([
    ["Deliberação nº 571 (C1 + §)", DELIBERACAO_571, "c1"],
    ["DELIBERAÇÃO ARTESP Nº 593 (C1 + §)", DELIBERACAO_593, "c1"],
    ["Início da Operação (C1, sem símbolo)", INICIO_OPERACAO, "c1"],
    ["⚠️ Ata ordinária (NBSP puro)", ATA_ORDINARIA, "sem_controle"],
    ["nome sadio", "Deliberação ARTESP 646.pdf", "sadio"],
    ["U+FFFD (pré-Fase-14)", "Delibera��o 687", "fffd"],
  ] as Array<[string, string, string]>)("%s → %s", (_n, nome, esperado) => {
    expect(classificar(nome)).toBe(esperado);
  });

  it("⚠️ o caso que produziu 286/286: com C1 E §, conta em c1 e NÃO em sem_controle", () => {
    // Antes, este nome contava nos DOIS — e era 100% do acervo ARTESP.
    expect(C1.test(DELIBERACAO_571)).toBe(true);
    expect(ALTO.test(DELIBERACAO_571), "o § está lá, e é por isso que os dois empatavam").toBe(true);
    expect(classificar(DELIBERACAO_571), "voltou a contar duas vezes").toBe("c1");
  });

  it("nenhum nome cai em dois baldes — a soma pode fechar com o total", () => {
    const corpus = [DELIBERACAO_571, DELIBERACAO_593, ATA_ORDINARIA, INICIO_OPERACAO,
                    "Deliberação 646", "Delibera�o"];
    const contagem = { c1: 0, sem_controle: 0, fffd: 0, sadio: 0 };
    for (const n of corpus) contagem[classificar(n)]++;
    const somaDosBaldes = contagem.c1 + contagem.sem_controle + contagem.fffd;
    const comAlgumaAssinatura = corpus.filter((n) => classificar(n) !== "sadio").length;
    expect(somaDosBaldes).toBe(comAlgumaAssinatura);
  });
});

describe("etapa174 · ⚠️ as guardas estão NO SQL — é isto que a mutação apaga", () => {
  /**
   * ⚠️ As asserções abaixo ancoram no FILTRO INTEIRO, não numa janela de N caracteres antes do
   * rótulo. A primeira versão deste teste media uma janela de 300 chars e **sobreviveu à mutação**
   * que tirava o `position(chr(65533)…) = 0` do `cp850_controle_c1` — porque a janela alcançava o
   * `position(...)` de OUTRO filtro (o `reparavel`, logo acima) e passava pelo motivo errado.
   * É o mesmo defeito que esta fase inteira persegue, cometido dentro do próprio teste.
   */
  it("`cp850_sem_controle` exclui C1 — e a asserção é o filtro inteiro, não uma vizinhança", () => {
    // Sem o `!~`, o contador mede o mesmo conjunto do `controle_c1` e o rótulo mente.
    expect(QA31, "qa-fase31 perdeu o !~ [C1] no filtro de cp850_sem_controle").toMatch(
      /COUNT\(\*\) FILTER \(WHERE position\(chr\(65533\) IN dr\.filename\) = 0\s+AND dr\.filename !~ '\[\\u0080-\\u009f\]'\s+AND dr\.filename ~ '\[\\u00a0[^\]]*\]'\)\s+AS cp850_sem_controle/,
    );
    expect(QA14, "qa-fase14 perdeu o !~ [C1]").toMatch(
      /'documentos_com_nbsp_sem_c1',[\s\S]{0,200}?AND filename !~ '\[\\u0080-\\u009f\]'/,
    );
  });

  it("⚠️ os dois contadores CP850 excluem o U+FFFD, senão um nome contaria em três baldes", () => {
    expect(QA31, "cp850_controle_c1 parou de excluir o U+FFFD").toMatch(
      /COUNT\(\*\) FILTER \(WHERE position\(chr\(65533\) IN dr\.filename\) = 0\s+AND dr\.filename ~ '\[\\u0080-\\u009f\]'\)\s+AS cp850_controle_c1/,
    );
    expect(QA14, "documentos_com_c1_cp850 parou de excluir o U+FFFD").toMatch(
      /'documentos_com_c1_cp850',[\s\S]{0,260}?position\(chr\(65533\) in filename\) = 0/,
    );
  });

  it("⚠️ a DATA é por assinatura — agregada, ela culpa o decoder novo por resíduo antigo", () => {
    for (const [nome, sql] of [["qa-fase31", QA31], ["qa-fase14", QA14]] as const) {
      expect(sql, `${nome} sem mais_recente_cp850`).toMatch(/mais_recente_cp850/);
      expect(sql, `${nome} sem mais_recente_fffd`).toMatch(/mais_recente_fffd/);
    }
    // O campo agregado não pode voltar: ele existia e não sabia de qual família era a data.
    expect(QA31).not.toMatch(/MAX\(dr\.created_at\)::date AS mais_recente,/);
  });

  it("`?sem-id` e `?fk-orfa` são distinguidos — consertos diferentes", () => {
    for (const [nome, sql] of [["qa-fase31", QA31], ["qa-fase14", QA14]] as const) {
      expect(sql, `${nome} não separa NULL de FK órfã`).toMatch(/'\?sem-id'/);
      expect(sql, `${nome} não separa NULL de FK órfã`).toMatch(/'\?fk-orfa'/);
    }
  });

  it("o reparável é PUBLICADO — é o número que foi lido errado como 538", () => {
    // 287 dos 538 são reparáveis; os 251 com U+FFFD só voltam do ZIP no Storage.
    expect(QA31).toMatch(/AS reparavel,/);
    expect(QA31).toMatch(/AS fffd_irreparavel,/);
  });
});
