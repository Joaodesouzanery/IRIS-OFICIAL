/**
 * Etapa 136 (Fase 24b) — nenhuma migration chama uma função que não persiste.
 *
 * `20260909120000` falhou em produção: `iris_seed_director` não existe. A migration de maio que a
 * cria (`20260517195947`) a DERRUBA no fim dela mesma — a função só existiu dentro daquela
 * transação. É a regra "grep antes de afirmar que existe", aplicada ao SQL: o próximo arquivo
 * que chamar `iris_seed_*` cai aqui, não no SQL Editor do usuário.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const DIR = join(__dirname, "../../../../supabase/migrations");
/** Quem define E derruba a função na mesma transação: única chamada legítima. */
const CRIADORA = "20260517195947_expand_directors_schema.sql";
/** Supersedida e marcada — não aplicar; fica no repo porque migration é forward-only. */
const SUPERSEDIDAS = new Set(["20260909120000_reinserir_luiz_paniago_anm.sql"]);

describe("etapa136 · iris_seed_* só existe dentro da migration que a cria", () => {
  const arquivos = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

  it("a criadora de fato derruba a função no fim (a premissa deste teste)", () => {
    const s = readFileSync(join(DIR, CRIADORA), "utf-8");
    expect(s).toMatch(/CREATE OR REPLACE FUNCTION iris_seed_director/);
    expect(s).toMatch(/DROP FUNCTION IF EXISTS iris_seed_director/);
  });

  it("nenhuma outra migration chama iris_seed_director / iris_seed_lista_triplice", () => {
    const infratoras = arquivos.filter((f) => {
      if (f === CRIADORA) return false;
      const s = readFileSync(join(DIR, f), "utf-8").replace(/--[^\n]*/g, "");
      return /iris_seed_(?:director|lista_triplice)\s*\(/.test(s);
    });
    expect(infratoras.filter((f) => !SUPERSEDIDAS.has(f))).toEqual([]);
  });

  it("toda supersedida está marcada como tal no cabeçalho", () => {
    for (const f of SUPERSEDIDAS) {
      expect(readFileSync(join(DIR, f), "utf-8").slice(0, 400)).toMatch(/SUPERSEDIDA/);
    }
  });

  it("a v2 não depende de função e é idempotente pelos NOT EXISTS", () => {
    const s = readFileSync(join(DIR, "20260909130000_reinserir_luiz_paniago_anm_v2.sql"), "utf-8").replace(/--[^\n]*/g, "");
    expect(s).not.toMatch(/iris_seed_/); // o cabeçalho pode citá-la; o SQL não
    expect((s.match(/WHERE NOT EXISTS/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(s).toMatch(/NOTIFY pgrst/);
  });
});
