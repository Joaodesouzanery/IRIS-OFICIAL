/**
 * Etapa 85 (Fase 14, commit A · reescrita na Fase 31) — a codificação do nome da entrada do ZIP.
 *
 * ═══ O caso real ═══
 * Produção exibia "Delibera��o_652", "T�NEL SANTOS GUARUJ�" — U+FFFD no lugar de Ç/Ã/º/Í. O
 * extractor lia o nome SEMPRE como UTF-8; a spec do ZIP diz que o nome é UTF-8 apenas quando o
 * general-purpose flag tem o bit 11 — sem ele, é a página de código do produtor.
 *
 * ═══ ⚠️ POR QUE ESTE ARQUIVO FOI REESCRITO, e é a parte que ensina ═══
 * A versão da Fase 14 montava as fixtures com `Buffer.from(NOME, "latin1")` — **a mesma suposição
 * que o código fazia**. O fixture nascia da crença que o teste deveria verificar, então ele não
 * podia discordar dela. Passou verde enquanto produção acumulava **623 nomes quebrados** (23% do
 * acervo, 100% ARTESP): "DELIBERAÇO ARTESP N§ 646".
 *
 * Os bytes reais são **CP850**, não Latin-1:
 *   0x80 → `Ç` (em Latin-1 vira U+0080, um controle INVISÍVEL — daí "o Ã sumiu")
 *   0xC7 → `Ã` (em Latin-1 vira `Ç`)
 *   0xA7 → `º` (em Latin-1 vira `§`)
 *   0xB5 → `Á` (em Latin-1 vira `µ`)  ← o discriminador: CP437 não tem `Á`
 *
 * A conclusão registrada no docblock antigo — *"os antigos (2023) têm LATIN-1 sem flag — Ç=0xC7,
 * Ã=0xC3, º=0xBA"* — é refutada pelo próprio dado: se os bytes fossem esses, `toString("latin1")`
 * devolveria `Ç Ã º` perfeitos e não haveria defeito nenhum.
 *
 * Agora as fixtures são **SEQUÊNCIAS DE BYTES**, escritas byte a byte. Um teste cujo fixture é
 * gerado pela hipótese não pode reprovar a hipótese.
 */

import { describe, it, expect } from "vitest";
import { extractPdfEntriesFromZip } from "@/lib/server/zip-extractor";

/** ZIP "stored" em memória, com CONTROLE do flag e dos bytes crus do nome. */
function montarZipComNome(nomeBytes: Buffer, flag: number, conteudo: Buffer): Buffer {
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flag, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(conteudo.length, 18);
  local.writeUInt32LE(conteudo.length, 22);
  local.writeUInt16LE(nomeBytes.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(flag, 8);       // general-purpose flag (offset 8 no diretório central)
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(conteudo.length, 20);
  central.writeUInt32LE(conteudo.length, 24);
  central.writeUInt16LE(nomeBytes.length, 28);
  central.writeUInt32LE(0, 42);

  const corpoLocal = Buffer.concat([local, nomeBytes, conteudo]);
  const corpoCentral = Buffer.concat([central, nomeBytes]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(corpoCentral.length, 12);
  eocd.writeUInt32LE(corpoLocal.length, 16);
  return Buffer.concat([corpoLocal, corpoCentral, eocd]);
}

const PDF = Buffer.from("%PDF-1.4\nx\n%%EOF", "latin1");
const NOME = "DELIBERAÇÃO ARTESP Nº 341.pdf";

/**
 * ⚠️ Os bytes de "DELIBERAÇÃO ARTESP Nº 341.pdf" em CP850, escritos À MÃO.
 *
 * Nada de `Buffer.from(NOME, "cp850")` — o Node nem suporta, e se suportasse o fixture voltaria a
 * nascer da hipótese. Cada byte alto está anotado com o que ele é em CP850 e no que ele virava
 * quando lido como Latin-1.
 */
const NOME_EM_CP850 = Buffer.from([
  0x44, 0x45, 0x4c, 0x49, 0x42, 0x45, 0x52, 0x41,  // DELIBERA
  0x80,                                            // Ç   (Latin-1 leria U+0080, invisível)
  0xc7,                                            // Ã   (Latin-1 leria Ç)
  0x4f, 0x20,                                      // O␣
  0x41, 0x52, 0x54, 0x45, 0x53, 0x50, 0x20,        // ARTESP␣
  0x4e,                                            // N
  0xa7,                                            // º   (Latin-1 leria §)
  0x20, 0x33, 0x34, 0x31,                          // ␣341
  0x2e, 0x70, 0x64, 0x66,                          // .pdf
]);

/** Os MESMOS caracteres em Latin-1 — bytes diferentes, e é essa diferença que decide. */
const NOME_EM_LATIN1 = Buffer.from([
  0x44, 0x45, 0x4c, 0x49, 0x42, 0x45, 0x52, 0x41,  // DELIBERA
  0xc7,                                            // Ç
  0xc3,                                            // Ã
  0x4f, 0x20,
  0x41, 0x52, 0x54, 0x45, 0x53, 0x50, 0x20,
  0x4e,
  0xba,                                            // º
  0x20, 0x33, 0x34, 0x31,
  0x2e, 0x70, 0x64, 0x66,
]);

describe("etapa85 · a codificação do nome, medida em bytes", () => {
  it("bit 11 ligado + UTF-8 (os ZIPs novos da ARTESP): decodifica certo — como sempre", () => {
    const zip = montarZipComNome(Buffer.from(NOME, "utf8"), 0x0800, PDF);
    expect(extractPdfEntriesFromZip(zip)[0].name).toBe(NOME);
  });

  it("⚠️ bytes CP850 sem flag: o caso REAL dos 623 — e o que a Fase 14 nunca testou", () => {
    const zip = montarZipComNome(NOME_EM_CP850, 0x0000, PDF);
    const [e] = extractPdfEntriesFromZip(zip);
    expect(e.name).toBe(NOME);
    // As três assinaturas do defeito, nomeadas: nenhuma pode sobrar.
    expect(e.name, "o Ç virou controle invisível").not.toMatch(/[\u0080-\u009f]/);
    expect(e.name, "o º virou §").not.toContain("§");
    expect(e.name, "o Á virou µ").not.toContain("µ");
  });

  it("bytes LATIN-1 sem flag continuam certos — o conserto não trocou um erro por outro", () => {
    // É o que a Fase 14 acreditava ser o corpus inteiro. Continua funcionando: a escolha é por
    // plausibilidade, então quem É Latin-1 ganha como Latin-1.
    const zip = montarZipComNome(NOME_EM_LATIN1, 0x0000, PDF);
    expect(extractPdfEntriesFromZip(zip)[0].name).toBe(NOME);
  });

  it("SEM bit 11 mas bytes que SÃO UTF-8 válido (produtor que esqueceu o flag): usa UTF-8", () => {
    const zip = montarZipComNome(Buffer.from(NOME, "utf8"), 0x0000, PDF);
    expect(extractPdfEntriesFromZip(zip)[0].name).toBe(NOME);
  });

  it("ASCII puro atravessa idêntico — o grosso do corpus não pode mudar", () => {
    const zip = montarZipComNome(Buffer.from("Voto DFQ 043-2026.pdf", "latin1"), 0x0000, PDF);
    expect(extractPdfEntriesFromZip(zip)[0].name).toBe("Voto DFQ 043-2026.pdf");
  });

  it("o filtro .pdf continua funcionando com nome acentuado", () => {
    // O lowercase/endsWith roda sobre o nome DECODIFICADO — se rodasse sobre o contaminado, um
    // ".PDF" depois de byte inválido poderia escapar.
    const bytes = Buffer.from([0x4e, 0x4f, 0x54, 0x49, 0x46, 0x49, 0x43, 0x41, 0x80, 0xc7, 0x4f,
                               0x2e, 0x50, 0x44, 0x46]); // NOTIFICAÇÃO.PDF em CP850
    expect(extractPdfEntriesFromZip(montarZipComNome(bytes, 0x0000, PDF))).toHaveLength(1);
  });
});
