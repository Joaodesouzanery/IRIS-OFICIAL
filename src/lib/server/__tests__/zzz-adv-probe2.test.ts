import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { analyzeUploadPdf } from "@/lib/server/upload-analysis";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");

describe("PROBE bloqueado end-to-end", () => {
  it("ata real", async () => {
    for (const f of ["anm-ata-79-rop.pdf", "anm-ata-82-ordinaria.pdf", "antt-ata-264-rde.pdf"]) {
      const p = join(fixturesDir, f);
      const buffer = readFileSync(p);
      const r: any = await analyzeUploadPdf({
        file: { name: f, buffer, source_archive: null, size: statSync(p).size },
        agencias: [{ id: "a1", sigla: "ANM" }, { id: "a2", sigla: "ANTT" }, { id: "a3", sigla: "ARTESP" }],
        db: null,
      });
      console.log(`\n### ${f} status=${r.status} bloqueado=${r.bloqueado} achados=${JSON.stringify(r.achados_bloqueantes)}`);
      console.log((r.warnings ?? []).filter((w: string) => w.startsWith("[")).join("\n"));
    }
    expect(true).toBe(true);
  }, 300_000);
});
