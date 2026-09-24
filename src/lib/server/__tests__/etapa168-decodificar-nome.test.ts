/**
 * Etapa 168 (Fase 31, Bloco 2) — a escolha da codificação por plausibilidade.
 *
 * ═══ O que este módulo existe para não repetir ═══
 * A Fase 14 escolheu UM fallback (Latin-1) medindo um lote de ZIPs, e acertou naquele lote. O lote
 * seguinte trouxe **623 nomes quebrados** (23% do acervo, 100% ARTESP), porque os bytes eram
 * CP850. Um palpite único calibrado numa amostra falha na amostra seguinte — e a resposta não é
 * trocar o palpite por outro, é medir cada candidato.
 *
 * ⚠️ E a nota é por conjunto ESPERADO, não por lista de caracteres ruins. Penalizar C1, NBSP e
 * box-drawing resolveria o CP850 e falharia na próxima página de código, porque a lista só conhece
 * o que alguém já encontrou. Medindo a fração de caracteres PLAUSÍVEIS, qualquer caractere
 * inesperado pontua mal sozinho.
 */

import { describe, it, expect } from "vitest";
import {
  decodificarNomeDeArquivo, notaDePlausibilidade, reinterpretarNomeGravado, reparoDoNome,
} from "@/lib/server/decodificar-nome-de-arquivo";

const bytes = (...b: number[]) => Uint8Array.from(b);
/** "DELIBERAÇÃO Nº 646" em CP850 — os bytes do caso real, escritos à mão. */
const CP850_REAL = bytes(0x44, 0x45, 0x4c, 0x49, 0x42, 0x45, 0x52, 0x41, 0x80, 0xc7, 0x4f,
                         0x20, 0x4e, 0xa7, 0x20, 0x36, 0x34, 0x36);
/** Os MESMOS caracteres em Latin-1 — bytes diferentes, e é essa diferença que decide. */
const LATIN1_REAL = bytes(0x44, 0x45, 0x4c, 0x49, 0x42, 0x45, 0x52, 0x41, 0xc7, 0xc3, 0x4f,
                          0x20, 0x4e, 0xba, 0x20, 0x36, 0x34, 0x36);

describe("etapa168 · a escolha, sobre bytes reais", () => {
  it("⚠️ bytes CP850 → CP850, com a acentuação inteira", () => {
    const r = decodificarNomeDeArquivo(CP850_REAL);
    expect(r.nome).toBe("DELIBERAÇÃO Nº 646");
    expect(r.codificacao).toBe("cp850");
  });

  it("bytes LATIN-1 → Latin-1 — o conserto não troca um erro por outro", () => {
    const r = decodificarNomeDeArquivo(LATIN1_REAL);
    expect(r.nome).toBe("DELIBERAÇÃO Nº 646");
    expect(r.codificacao).toBe("latin-1");
  });

  it("UTF-8 válido vence sem disputa — sequência multibyte válida não é outra coisa", () => {
    const r = decodificarNomeDeArquivo(new TextEncoder().encode("DELIBERAÇÃO Nº 646"));
    expect(r.nome).toBe("DELIBERAÇÃO Nº 646");
    expect(r.codificacao).toBe("utf-8");
    expect(r.candidatos, "nem chegou a disputar").toEqual([]);
  });

  it("ASCII puro atravessa idêntico — o grosso do corpus não pode mudar", () => {
    const r = decodificarNomeDeArquivo(new TextEncoder().encode("Voto DFQ 043-2026.pdf"));
    expect(r.nome).toBe("Voto DFQ 043-2026.pdf");
  });

  it("⚠️ empate mantém a ordem declarada — desempate não pode ser acidente", () => {
    // 0x80 é `Ç` tanto em CP850 quanto em CP437, e Latin-1 dá um controle invisível. As duas
    // páginas DOS empatam na nota; o desempate pela ORDEM tem de ser estável e declarado.
    const r = decodificarNomeDeArquivo(bytes(0x41, 0x80, 0x41));
    const notas = Object.fromEntries(r.candidatos.map((c) => [c.codificacao, c.nota]));
    expect(notas["cp850"]).toBe(notas["cp437"]);
    expect(r.codificacao).toBe("cp850");
  });

  it("todo candidato é publicado com a nota — a escolha é auditável, não um oráculo", () => {
    const r = decodificarNomeDeArquivo(CP850_REAL);
    expect(r.candidatos.map((c) => c.codificacao)).toEqual(["latin-1", "cp850", "cp437"]);
    for (const c of r.candidatos) expect(c.nota).toBeGreaterThanOrEqual(0);
  });
});

describe("etapa168 · a nota mede o conjunto ESPERADO, não uma lista de proibidos", () => {
  it("nome plausível de deliberação brasileira tira nota cheia", () => {
    for (const n of ["DELIBERAÇÃO ARTESP Nº 646 - Anuência.pdf", "Ata 83ª ROP (2026).pdf",
                     "Voto_DFQ 043-2026.pdf", "Resolução nº 5.999/2026.pdf"]) {
      expect(notaDePlausibilidade(n), n).toBe(1);
    }
  });

  it("⚠️ `º` e `ª` são PLAUSÍVEIS — «Nº 646» e «83ª ROP» são a norma, não exceção", () => {
    expect(notaDePlausibilidade("Nº")).toBe(1);
    expect(notaDePlausibilidade("83ª")).toBe(1);
  });

  it("o mojibake pontua pior que o original, que é o que decide a escolha", () => {
    expect(notaDePlausibilidade("DELIBERAÇO ARTESP N§ 646"))
      .toBeLessThan(notaDePlausibilidade("DELIBERAÇÃO ARTESP Nº 646"));
  });

  it("⚠️ caractere que NENHUMA lista minha previu também pontua mal", () => {
    // É a prova de que a nota generaliza: nada aqui está numa lista de proibidos. Se a
    // implementação trocasse o conjunto esperado por uma lista de suspeitos, estes passariam.
    for (const exotico of ["Ω", "╬", "文", "¤", ""]) {
      expect(notaDePlausibilidade(`Ata ${exotico} 2026`), JSON.stringify(exotico)).toBeLessThan(1);
    }
  });

  it("string vazia vale 0 — não é nome", () => {
    expect(notaDePlausibilidade("")).toBe(0);
  });
});

describe("etapa168 · o reparo do que já está gravado", () => {
  it("⚠️ o nome corrompido CARREGA os bytes — por isso o reparo não exige re-download", () => {
    // `latin1` no Node é identidade byte↔codepoint. É a propriedade que separa esta classe do
    // mojibake de U+FFFD da era pré-Fase-14, onde o byte se perdeu de verdade.
    const corrompido = "DELIBERAÇO ARTESP N§ 646";
    expect(reparoDoNome(corrompido)?.reparado).toBe("DELIBERAÇÃO ARTESP Nº 646");
    expect(reparoDoNome(corrompido)?.codificacao).toBe("cp850");
  });

  it("⚠️ o caso SEM controle nenhum — um detector de C1 perderia este inteiro", () => {
    // "Ata ordinária" em CP850 tem o `á` como 0xA0, que em Latin-1 é NBSP: parece espaço comum,
    // não dispara alarme de caractere de controle, e mesmo assim está corrompido.
    const corrompido = "Ata ordin ria";
    expect(corrompido, "este caso não tem C1 — é o ponto").not.toMatch(/[-]/);
    expect(reparoDoNome(corrompido)?.reparado).toBe("Ata ordinária");
  });

  it("⚠️⚠️ nome SADIO não é tocado — sem esta guarda o conserto corromperia 2.103 nomes", () => {
    // Aplicar o reparo a "DELIBERAÇÃO" produziria "DELIBERAÃ├O". A guarda é o ganho ESTRITO de
    // plausibilidade, não a ausência de caractere suspeito.
    for (const sadio of ["DELIBERAÇÃO ARTESP Nº 646", "Ata 83ª ROP.pdf", "Voto DFQ 043-2026.pdf",
                         "Resolução nº 5.999/2026"]) {
      expect(reparoDoNome(sadio), sadio).toBeNull();
    }
  });

  it("nome com caractere acima de U+00FF não tem bytes a reinterpretar", () => {
    // Travessão e aspas tipográficas vieram de UTF-8 legítimo, não de leitura Latin-1.
    expect(reinterpretarNomeGravado("Ata 1.024ª — ANTT")).toBeNull();
    expect(reparoDoNome("Ata 1.024ª — ANTT")).toBeNull();
  });

  it("⚠️ o round-trip é SEM PERDA, e é por isso que não há re-download", () => {
    const original = "DELIBERAÇÃO ARTESP Nº 646 - Á É Í Ó Ú";
    // Como a gravação errada aconteceu: bytes CP850 lidos byte a byte como Latin-1.
    const bytesCp850 = Uint8Array.from(
      [...original].map((ch) => {
        const i = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ".indexOf(ch);
        return ch.charCodeAt(0) < 0x80 ? ch.charCodeAt(0) : 0x80 + i;
      }),
    );
    const corrompido = Array.from(bytesCp850, (b) => String.fromCharCode(b)).join("");
    expect(corrompido, "a simulação não corrompeu nada").not.toBe(original);
    expect(reparoDoNome(corrompido)?.reparado).toBe(original);
  });
});

describe("etapa168 · ⚠️ a propriedade que o reparo nunca pode violar", () => {
  /** Nomes sadios de verdade + os mesmos corrompidos por CP850 lido como Latin-1. */
  const SADIOS = [
    "DELIBERAÇÃO ARTESP Nº 646", "Ata 83ª ROP.pdf", "Resolução nº 5.999/2026",
    "Voto DFQ 043-2026.pdf", "Notificação de Infração 2023", "TÚNEL SANTOS GUARUJÁ",
    "Anuência prévia — não", "Deliberacao sem acento 123", "ÍNDICE Óbito Ação",
  ];
  const CP850 =
    "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤" +
    "ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";
  /** Simula a gravação errada: cada caractere vira seu byte CP850, lido depois como Latin-1. */
  const corromper = (nome: string): string | null => {
    let out = "";
    for (const ch of nome) {
      if (ch.charCodeAt(0) < 0x80) { out += ch; continue; }
      const i = CP850.indexOf(ch);
      if (i === -1) return null; // o caractere não existe em CP850 — este nome não corromperia
      out += String.fromCharCode(0x80 + i);
    }
    return out;
  };

  it("⚠️ quando repara, a plausibilidade SOBE — nunca empata, nunca cai", () => {
    let reparados = 0;
    for (const sadio of SADIOS) {
      const corrompido = corromper(sadio);
      if (corrompido === null || corrompido === sadio) continue;
      const r = reparoDoNome(corrompido);
      expect(r, `não reparou «${corrompido}»`).not.toBeNull();
      expect(r!.reparado).toBe(sadio);
      expect(
        notaDePlausibilidade(r!.reparado),
        `o reparo de «${corrompido}» não melhorou a plausibilidade`,
      ).toBeGreaterThan(notaDePlausibilidade(corrompido));
      reparados++;
    }
    expect(reparados, "o corpus não exercitou nenhum reparo — o teste seria vazio").toBeGreaterThan(4);
  });

  it("⚠️ e NENHUM nome sadio é tocado — a guarda vale para o corpus inteiro", () => {
    for (const sadio of SADIOS) {
      expect(reparoDoNome(sadio), sadio).toBeNull();
    }
  });

  it("reparar duas vezes não muda mais nada — a operação é idempotente", () => {
    for (const sadio of SADIOS) {
      const corrompido = corromper(sadio);
      if (corrompido === null || corrompido === sadio) continue;
      const uma = reparoDoNome(corrompido)!.reparado;
      expect(reparoDoNome(uma), `reparou de novo «${uma}»`).toBeNull();
    }
  });
});
