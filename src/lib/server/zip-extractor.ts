import { inflateRawSync } from "zlib";

export interface ZipPdfEntry {
  name: string;
  buffer: Buffer;
  compressedSize: number;
  uncompressedSize: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 66_000;

export function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;
}

export function extractPdfEntriesFromZip(
  buffer: Buffer,
  options?: {
    maxFiles?: number;
    maxTotalUncompressedBytes?: number;
  },
): ZipPdfEntry[] {
  if (!isZipBuffer(buffer)) {
    throw new Error("Arquivo ZIP invalido");
  }

  const maxFiles = options?.maxFiles ?? 100;
  const maxTotal = options?.maxTotalUncompressedBytes ?? 150 * 1024 * 1024;
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) throw new Error("ZIP sem diretorio central");

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipPdfEntry[] = [];
  let cursor = centralDirectoryOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < totalEntries; index++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Diretorio central ZIP corrompido");
    }

    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = decodeZipEntryName(buffer.subarray(cursor + 46, cursor + 46 + nameLength));

    cursor += 46 + nameLength + extraLength + commentLength;

    if (!name.toLowerCase().endsWith(".pdf") || name.endsWith("/")) continue;
    if (entries.length >= maxFiles) throw new Error(`ZIP excede o limite de ${maxFiles} PDFs`);

    // Zip-bomb: NÃO confiar no uncompressedSize DECLARADO no diretório central (o atacante
    // sub-declara p/ passar no cap). Descompacta com teto REAL (maxOutputLength) e acumula
    // pelo tamanho de fato inflado.
    const content = readLocalFile(buffer, localHeaderOffset, compressedSize, compressionMethod, maxTotal - totalUncompressed);
    totalUncompressed += content.length;
    if (totalUncompressed > maxTotal) {
      throw new Error(`ZIP excede o limite de ${(maxTotal / 1024 / 1024).toFixed(0)} MB descompactados`);
    }

    entries.push({
      name: basenameFromZipPath(name),
      buffer: content,
      compressedSize,
      uncompressedSize,
    });
  }

  return entries;
}

/**
 * Decodifica o nome da entrada escolhendo a página de código mais PLAUSÍVEL (Fase 31).
 *
 * ═══ ⚠️ A história deste trecho, porque ela é a lição ═══
 * Fase 14: o extractor lia tudo como UTF-8 e produção exibia "Delibera\uFFFD\uFFFDo_652". O
 * conserto foi "UTF-8 ESTRITO primeiro; falhou → Latin-1", e o docblock registrou a medição:
 * *"os antigos (2023) têm LATIN-1 sem flag — Ç=0xC7, Ã=0xC3, º=0xBA"*.
 *
 * **Produção refutou essa conclusão**: 623 nomes (23% do acervo, 100% ARTESP) saíram como
 * "DELIBERAÇO ARTESP N§ 646". Se os bytes fossem 0xC7/0xC3/0xBA, o `toString("latin1")` devolveria
 * `Ç Ã º` perfeitos e não haveria defeito. Os bytes são **CP850** (0x80=Ç, 0xC7=Ã, 0xA7=º,
 * 0xB5=Á). A Fase 14 acertou ao descartar CP437 — que produziria `╟├║`, e ela testou — e errou ao
 * concluir Latin-1, porque não testou a página DOS latina que os produtores brasileiros usam.
 * Ela trocou a IDENTIDADE do mojibake (U+FFFD → `§`/`µ`/U+0080) e o monitor, que conta só U+FFFD,
 * ficou cego.
 *
 * A lição não é "era CP850": é que **um palpite único calibrado num lote falha no lote seguinte**.
 * Por isso a escolha agora é por plausibilidade entre os candidatos, com a nota medida sobre o
 * conjunto ESPERADO num nome de documento — ver `decodificar-nome-de-arquivo.ts`.
 *
 * O bit 11 continua deliberadamente IGNORADO, e agora com razão mais forte: o try-estrito de UTF-8
 * já aceita todo UTF-8 legítimo (com ou sem flag), e a flag DESLIGADA não diz qual página é — que
 * é exatamente a pergunta que a plausibilidade responde.
 *
 * ⚠️ E o dano retroativo é REVERSÍVEL nesta classe, ao contrário do U+FFFD: `latin1` é identidade
 * byte↔codepoint, então o byte original sobrevive dentro do nome corrompido.
 */

import { decodificarNomeDeArquivo } from "@/lib/server/decodificar-nome-de-arquivo";
function decodeZipEntryName(bytes: Buffer): string {
  return decodificarNomeDeArquivo(bytes).nome;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - MAX_EOCD_SEARCH);
  for (let offset = buffer.length - 22; offset >= start; offset--) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function readLocalFile(
  zip: Buffer,
  localHeaderOffset: number,
  compressedSize: number,
  compressionMethod: number,
  maxOutputBytes: number,
): Buffer {
  if (localHeaderOffset + 30 > zip.length || zip.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error("Header local ZIP corrompido");
  }

  const nameLength = zip.readUInt16LE(localHeaderOffset + 26);
  const extraLength = zip.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > zip.length) throw new Error("Entrada ZIP truncada");

  const compressed = zip.subarray(dataStart, dataEnd);
  const cap = Math.max(1, maxOutputBytes);
  if (compressionMethod === 0) {
    if (compressed.length > cap) throw new Error("ZIP excede o limite descompactado");
    return Buffer.from(compressed);
  }
  if (compressionMethod === 8) {
    try {
      // maxOutputLength faz o inflate abortar (ERR_BUFFER_TOO_LARGE) antes de estourar a
      // memória com um stream que infla muito além do declarado (zip-bomb).
      return inflateRawSync(compressed, { maxOutputLength: cap });
    } catch {
      throw new Error("ZIP excede o limite descompactado ou está corrompido");
    }
  }
  throw new Error(`Metodo de compressao ZIP nao suportado: ${compressionMethod}`);
}

function basenameFromZipPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}
