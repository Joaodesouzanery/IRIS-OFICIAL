export function buildSimpleDocxFromHtml(input: {
  title: string;
  html: string;
  landscape?: boolean;
}) {
  const paragraphs = htmlToParagraphs(input.html);
  const documentXml = buildDocumentXml(input.title, paragraphs, input.landscape ?? false);
  return zipStore([
    { name: "[Content_Types].xml", data: xmlBuffer(contentTypesXml()) },
    { name: "_rels/.rels", data: xmlBuffer(relsXml()) },
    { name: "word/document.xml", data: xmlBuffer(documentXml) },
  ]);
}

/**
 * DOCX estrutural a partir do HTML: preserva headings (h1-h3), parágrafos, listas e TABELAS.
 * Imagens não são incluídas (o export .doc/HTML cobre a fidelidade visual).
 */
export function buildRichDocxFromHtml(input: { title: string; html: string; landscape?: boolean }) {
  const documentXml = buildRichDocumentXml(input.title, input.html, input.landscape ?? false);
  return zipStore([
    { name: "[Content_Types].xml", data: xmlBuffer(contentTypesXml()) },
    { name: "_rels/.rels", data: xmlBuffer(relsXml()) },
    { name: "word/document.xml", data: xmlBuffer(documentXml) },
  ]);
}

type DocxBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "table"; xml: string };

function buildRichDocumentXml(title: string, html: string, landscape: boolean) {
  const pageSize = landscape
    ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>'
    : '<w:pgSz w:w="11906" w:h="16838"/>';
  const blocks = htmlToBlocks(html);
  const body = [
    paragraphXml(title, true),
    ...blocks.map(renderBlockXml),
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr>${pageSize}<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`;
}

function renderBlockXml(block: DocxBlock) {
  if (block.kind === "table") return block.xml;
  if (block.kind === "heading") {
    const size = block.level <= 1 ? 34 : block.level === 2 ? 28 : 24;
    return `<w:p><w:pPr><w:spacing w:before="160" w:after="60"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="0F2741"/><w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(block.text)}</w:t></w:r></w:p>`;
  }
  if (block.kind === "bullet") {
    return `<w:p><w:pPr><w:ind w:left="360"/></w:pPr><w:r><w:t xml:space="preserve">• ${escapeXml(block.text)}</w:t></w:r></w:p>`;
  }
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(block.text)}</w:t></w:r></w:p>`;
}

function htmlToBlocks(rawHtml: string): DocxBlock[] {
  let html = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  // Extrai tabelas e troca por tokens, preservando a ordem.
  const tables: string[] = [];
  html = html.replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
    tables.push(tableToXml(tableHtml));
    return `\n@@TABLE${tables.length - 1}@@\n`;
  });

  // Marca headings e itens de lista antes de remover as tags.
  html = html
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, t) => `\n@@H1@@${stripInline(t)}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, t) => `\n@@H2@@${stripInline(t)}\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, t) => `\n@@H3@@${stripInline(t)}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t) => `\n@@LI@@${stripInline(t)}\n`)
    .replace(/<\/(p|div|section|header|footer|tr|br)>/gi, "\n");

  const text = decodeEntities(html.replace(/<[^>]+>/g, ""));
  const lines = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

  const blocks: DocxBlock[] = [];
  for (const line of lines) {
    const tableMatch = line.match(/^@@TABLE(\d+)@@$/);
    if (tableMatch) {
      blocks.push({ kind: "table", xml: tables[Number(tableMatch[1])] ?? "" });
    } else if (line.startsWith("@@H1@@")) {
      blocks.push({ kind: "heading", level: 1, text: line.slice(6) });
    } else if (line.startsWith("@@H2@@")) {
      blocks.push({ kind: "heading", level: 2, text: line.slice(6) });
    } else if (line.startsWith("@@H3@@")) {
      blocks.push({ kind: "heading", level: 3, text: line.slice(6) });
    } else if (line.startsWith("@@LI@@")) {
      blocks.push({ kind: "bullet", text: line.slice(6) });
    } else {
      blocks.push({ kind: "paragraph", text: line });
    }
  }
  return blocks.slice(0, 600);
}

function tableToXml(tableHtml: string) {
  const rows = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const rowXml = rows.map((row) => {
    const cells = row.match(/<(th|td)[\s\S]*?<\/\1>/gi) ?? [];
    const cellXml = cells.map((cell) => {
      const isHeader = /^<th/i.test(cell);
      const value = decodeEntities(stripInline(cell.replace(/^<(th|td)[^>]*>/i, "").replace(/<\/(th|td)>$/i, "")));
      const runProps = isHeader ? "<w:rPr><w:b/></w:rPr>" : "";
      const shading = isHeader ? '<w:shd w:val="clear" w:fill="0F2741"/>' : "";
      const headerColor = isHeader ? "<w:rPr><w:b/><w:color w:val=\"FFFFFF\"/></w:rPr>" : runProps;
      return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${shading}</w:tcPr><w:p><w:r>${headerColor}<w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r></w:p></w:tc>`;
    }).join("");
    return `<w:tr>${cellXml}</w:tr>`;
  }).join("");
  const borders = '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D0D7DE"/><w:left w:val="single" w:sz="4" w:color="D0D7DE"/><w:bottom w:val="single" w:sz="4" w:color="D0D7DE"/><w:right w:val="single" w:sz="4" w:color="D0D7DE"/><w:insideH w:val="single" w:sz="4" w:color="D0D7DE"/><w:insideV w:val="single" w:sz="4" w:color="D0D7DE"/></w:tblBorders>';
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${borders}</w:tblPr>${rowXml}</w:tbl>`;
}

function stripInline(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&middot;/g, "·");
}

function buildDocumentXml(title: string, paragraphs: string[], landscape: boolean) {
  const pageSize = landscape
    ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>'
    : '<w:pgSz w:w="11906" w:h="16838"/>';
  const body = [
    paragraphXml(title, true),
    ...paragraphs.map((paragraph) => paragraphXml(paragraph, false)),
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body}
    <w:sectPr>${pageSize}<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`;
}

function paragraphXml(text: string, bold: boolean) {
  const runProps = bold ? "<w:rPr><w:b/><w:sz w:val=\"32\"/></w:rPr>" : "";
  return `<w:p><w:r>${runProps}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function htmlToParagraphs(html: string) {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  const text = withoutNoise
    .replace(/<\/(h[1-6]|p|div|article|section|header|footer|li|br)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return [...new Set(text)].slice(0, 180);
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
}

function relsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function zipStore(files: { name: string; data: Buffer }[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, file.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + file.data.length;
  }
  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, end]);
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function xmlBuffer(value: string) {
  return Buffer.from(value, "utf8");
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
