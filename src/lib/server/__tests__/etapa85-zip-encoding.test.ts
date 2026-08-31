/**
 * Etapa 85 (Fase 14, commit A) — o nome da entrada do ZIP respeita a codificação declarada.
 *
 * ═══ O caso real ═══
 * Produção exibia "Delibera��o_652", "Notifica��o de Infra��o", "T�NEL SANTOS GUARUJ�" — U+FFFD
 * no lugar de Ç/Ã/º/Í. O extractor lia o nome SEMPRE como UTF-8; a spec do ZIP diz que o nome é
 * UTF-8 apenas quando o general-purpose flag tem o bit 11 — sem ele, é a página de código do
 * produtor. MEDIDO nos ZIPs reais da ARTESP:
 *  · os novos (reunião 1198ª) têm bit 11 LIGADO e UTF-8 válido — estes sempre funcionaram;
 *  · os antigos (Notificações de Infração 2023, deliberações 340/341/640-652) têm nomes
 *    LATIN-1 SEM o flag (Ç=0xC7, Ã=0xC3, º=0xBA — exatamente os bytes que viram � em UTF-8).
 * CP437, o default literal da spec, produziria OUTRO lixo (╟├║) — o fallback certo para o
 * corpus real é: tentar UTF-8 estrito; falhou → Latin-1 (que nunca falha e mapeia os bytes
 * observados corretamente).
 *
 * Por que importa além da estética: o `filename` alimenta a CHAVE SEMÂNTICA de dedup — o mesmo
 * documento com nome contaminado e nome limpo ganha chaves diferentes e vira duplicata.
 * Retroativo é irrecuperável (o U+FFFD destruiu o byte); re-download com este conserto dedupa
 * certo.
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

describe("etapa85 · a codificação do nome", () => {
  it("bit 11 ligado + UTF-8 (os ZIPs novos da ARTESP): decodifica certo — como sempre", () => {
    const zip = montarZipComNome(Buffer.from(NOME, "utf8"), 0x0800, PDF);
    const [e] = extractPdfEntriesFromZip(zip);
    expect(e.name).toBe(NOME);
  });

  it("SEM bit 11 + bytes LATIN-1 (os ZIPs de 2023): nada de U+FFFD — o caso do mojibake", () => {
    const zip = montarZipComNome(Buffer.from(NOME, "latin1"), 0x0000, PDF);
    const [e] = extractPdfEntriesFromZip(zip);
    expect(e.name).toBe(NOME);
    expect(e.name).not.toContain("�");
  });

  it("SEM bit 11 mas bytes que SÃO UTF-8 válido (produtor que esqueceu o flag): usa UTF-8", () => {
    // Tentar UTF-8 estrito primeiro preserva o produtor honesto-mas-esquecido; o fallback
    // Latin-1 só entra quando os bytes NÃO são UTF-8.
    const zip = montarZipComNome(Buffer.from(NOME, "utf8"), 0x0000, PDF);
    const [e] = extractPdfEntriesFromZip(zip);
    expect(e.name).toBe(NOME);
  });

  it("ASCII puro é idêntico pelos dois caminhos — o grosso do corpus não muda", () => {
    const zip = montarZipComNome(Buffer.from("Voto DFQ 043-2026.pdf", "latin1"), 0x0000, PDF);
    expect(extractPdfEntriesFromZip(zip)[0].name).toBe("Voto DFQ 043-2026.pdf");
  });

  it("o filtro .pdf continua funcionando com nome acentuado em latin1", () => {
    // O lowercase/endsWith roda sobre o nome DECODIFICADO — se rodasse sobre o contaminado,
    // um ".PDF" depois de byte inválido poderia escapar.
    const zip = montarZipComNome(Buffer.from("NOTIFICAÇÃO.PDF", "latin1"), 0x0000, PDF);
    expect(extractPdfEntriesFromZip(zip)).toHaveLength(1);
  });
});
