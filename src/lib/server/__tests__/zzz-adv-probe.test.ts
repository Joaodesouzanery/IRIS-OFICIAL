import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import { splitAtaItemsWithStats, detectDocumentType } from "@/lib/server/ata-splitter";
import { checarAncorasItens } from "@/lib/server/consistency-checks";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");

describe("PROBE C03 ancoras x itens", () => {
  const out: string[] = [];
  beforeAll(async () => {
    for (const f of readdirSync(fixturesDir).filter((x) => x.endsWith(".pdf"))) {
      const text = (await extractPdfText(readFileSync(join(fixturesDir, f)))).text;
      const tipo = detectDocumentType(text);
      if (tipo !== "ata") { out.push(`${f}: tipo=${tipo} (nao ata)`); continue; }
      const s = splitAtaItemsWithStats(text);
      const ancoras = (text.match(/DELIBERA[ÇC][ÃA]O\s*:/gi) ?? []).length;
      const decisaoLit = (text.match(/Decis[aã]o\s*:/gi) ?? []).length;
      const achados = checarAncorasItens({
        ancoras, itens_pre_dedup: s.itens_pre_dedup, duplicatas_removidas: s.duplicatas_removidas,
      });
      out.push(`${f}: ancoras=${ancoras} decisaoLit=${decisaoLit} itens_pre=${s.itens_pre_dedup} pos=${s.items.length} dup=${s.duplicatas_removidas} => ${achados.map((a) => a.nivel + ":" + a.codigo).join("|") || "OK"}`);
    }
  }, 300_000);

  it("dump", () => {
    console.log("\n" + out.join("\n") + "\n");
    expect(true).toBe(true);
  });
});
