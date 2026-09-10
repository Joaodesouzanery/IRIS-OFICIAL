/**
 * Etapa 143 (Fase 26, commit 5) — "os documentos estão certos?" vira uma pergunta com resposta.
 * Amostra ao acaso, reproduzível por dia, por agência, com o PDF e o que a extração gravou.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { amostrar, seedDe, prng } from "@/lib/server/amostra-auditoria";

describe("etapa143 · a amostra", () => {
  const universo = Array.from({ length: 100 }, (_, i) => i);
  it("é reproduzível: mesmo seed, mesma amostra; seed diferente, amostra diferente", () => {
    expect(amostrar(universo, 5, seedDe("2026-09-10|ARTESP"))).toEqual(amostrar(universo, 5, seedDe("2026-09-10|ARTESP")));
    expect(amostrar(universo, 5, seedDe("2026-09-10|ARTESP"))).not.toEqual(amostrar(universo, 5, seedDe("2026-09-11|ARTESP")));
  });
  it("sem repetição e sem estourar o universo", () => {
    const a = amostrar(universo, 5, 42);
    expect(new Set(a).size).toBe(5);
    expect(amostrar([1, 2], 5, 7)).toHaveLength(2);
    expect(amostrar([], 5, 7)).toEqual([]);
  });
  it("o PRNG cobre o intervalo [0,1) de forma razoável (não é constante)", () => {
    const r = prng(1); const xs = Array.from({ length: 50 }, () => r());
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0); expect(Math.max(...xs)).toBeLessThan(1);
    expect(new Set(xs.map((x) => x.toFixed(3))).size).toBeGreaterThan(40);
  });
});

describe("etapa143 · rota e tela", () => {
  const RAIZ = join(__dirname, "../../../..");
  it("a rota só amostra FINAIS (predicado canônico), lê tudo, e assina os PDFs em lote", () => {
    const rota = readFileSync(join(RAIZ, "src/app/api/v1/admin/auditoria/amostra/route.ts"), "utf-8");
    expect(rota).toMatch(/isFinalDecisionRecord\(/);
    expect(rota).toMatch(/lerTudo/);
    expect(rota).toMatch(/createSignedUrls\(/);
    expect(rota).toMatch(/requireAdmin\(req\)/);
  });
  it("a tela tem o bloco e o botão de outra amostra", () => {
    const tela = readFileSync(join(RAIZ, "src/app/dashboard/deliberacoes/votos-diretores/page.tsx"), "utf-8");
    expect(tela).toMatch(/Conferir 5 ao acaso/);
    expect(tela).toMatch(/setAmostraSeed\(String\(Date\.now\(\)\)\)/);
  });
});
