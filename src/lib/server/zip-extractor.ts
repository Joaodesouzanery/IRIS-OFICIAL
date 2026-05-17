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
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    cursor += 46 + nameLength + extraLength + commentLength;

    if (!name.toLowerCase().endsWith(".pdf") || name.endsWith("/")) continue;
    if (entries.length >= maxFiles) throw new Error(`ZIP excede o limite de ${maxFiles} PDFs`);

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > maxTotal) {
      throw new Error(`ZIP excede o limite de ${(maxTotal / 1024 / 1024).toFixed(0)} MB descompactados`);
    }

    const content = readLocalFile(buffer, localHeaderOffset, compressedSize, compressionMethod);
    entries.push({
      name: basenameFromZipPath(name),
      buffer: content,
      compressedSize,
      uncompressedSize,
    });
  }

  return entries;
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
  if (compressionMethod === 0) return Buffer.from(compressed);
  if (compressionMethod === 8) return inflateRawSync(compressed);
  throw new Error(`Metodo de compressao ZIP nao suportado: ${compressionMethod}`);
}

function basenameFromZipPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}
