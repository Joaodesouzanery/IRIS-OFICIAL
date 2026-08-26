/**
 * Etapa 71 — o `vercel.json` é validado ANTES do push.
 *
 * ═══ Por que este arquivo existe ═══
 * Em 26/08/2026, OITO deploys seguidos falharam em 4-5 segundos, durante ~4 horas, porque eu
 * escrevi uma chave `"_comentario"` dentro de uma entrada de `crons`. JSON não tem comentários e
 * eu quis explicar a mudança ali mesmo — mas o schema do `vercel.json` REJEITA propriedade
 * desconhecida, e a falha é de validação de configuração: acontece antes de qualquer build, então
 * `npm run build` local passa verde e não vê nada.
 *
 * Esse é o ponto: o ritual (type-check, test, build, lint) não cobre o `vercel.json`, porque ele
 * não é código — é contrato com a plataforma. Estes testes fecham o vão. Cada um deles
 * corresponde a um erro que derruba o deploy inteiro sem aparecer localmente.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const BRUTO = readFileSync(join(RAIZ, "vercel.json"), "utf-8");
const CFG = JSON.parse(BRUTO) as {
  framework?: string;
  regions?: string[];
  functions?: Record<string, { maxDuration?: number; memory?: number }>;
  crons?: Array<Record<string, unknown>>;
};

/** As chaves que o schema do Vercel aceita no topo. Qualquer outra derruba o deploy. */
const CHAVES_TOPO = new Set([
  "$schema", "framework", "regions", "functions", "crons", "buildCommand", "devCommand",
  "installCommand", "outputDirectory", "ignoreCommand", "headers", "redirects", "rewrites",
  "cleanUrls", "trailingSlash", "images", "public", "git", "github",
]);

describe("etapa71 · o JSON é válido e só tem chaves conhecidas", () => {
  it("parseia", () => {
    expect(() => JSON.parse(BRUTO)).not.toThrow();
  });

  it("nenhuma chave de topo desconhecida", () => {
    for (const k of Object.keys(CFG)) {
      expect(CHAVES_TOPO.has(k), `chave de topo "${k}" não é do schema do Vercel`).toBe(true);
    }
  });

  it("não há tentativa de comentário em lugar nenhum", () => {
    // JSON não tem comentários. A tentação de explicar a decisão no próprio arquivo foi
    // exatamente o que quebrou 8 deploys — a explicação vai para o commit e para PENDENCIAS.
    expect(BRUTO, "`//` num JSON quebra o parse").not.toMatch(/^\s*\/\//m);
    expect(BRUTO).not.toMatch(/"_[a-z]/i);
    expect(BRUTO).not.toMatch(/"(comentario|comment|nota|obs)"\s*:/i);
  });
});

describe("etapa71 · crons", () => {
  const crons = CFG.crons ?? [];

  it("cada entrada tem EXATAMENTE `path` e `schedule` — nada mais", () => {
    // Foi aqui que o `_comentario` entrou. Propriedade extra = deploy recusado na validação.
    for (const c of crons) {
      expect(new Set(Object.keys(c)), `cron com chaves ${Object.keys(c)}`).toEqual(
        new Set(["path", "schedule"]),
      );
    }
  });

  it("o plano Hobby permite no máximo 2 crons por dia", () => {
    expect(crons.length).toBeLessThanOrEqual(2);
  });

  it("todo `path` é uma rota que existe e responde a GET (o cron dispara GET)", () => {
    for (const c of crons) {
      const rota = join(RAIZ, "src/app", String(c.path), "route.ts");
      expect(existsSync(rota), `cron aponta para rota inexistente: ${c.path}`).toBe(true);
      expect(readFileSync(rota, "utf-8"), `${c.path} não exporta GET`).toMatch(/export async function GET/);
    }
  });

  it("todo `schedule` é um cron de 5 campos", () => {
    for (const c of crons) {
      expect(String(c.schedule).trim().split(/\s+/), `schedule inválido: ${c.schedule}`).toHaveLength(5);
    }
  });
});

describe("etapa71 · functions", () => {
  const fns = CFG.functions ?? {};

  it("toda entrada aponta para um arquivo que EXISTE", () => {
    // Padrão que não casa nenhuma função também é erro de configuração no Vercel — e também
    // invisível no build local.
    for (const caminho of Object.keys(fns)) {
      expect(existsSync(join(RAIZ, caminho)), `functions aponta para arquivo inexistente: ${caminho}`).toBe(true);
    }
  });

  it("`maxDuration` é um inteiro plausível", () => {
    for (const [caminho, cfg] of Object.entries(fns)) {
      if (cfg.maxDuration === undefined) continue;
      expect(Number.isInteger(cfg.maxDuration), `${caminho}: maxDuration não é inteiro`).toBe(true);
      expect(cfg.maxDuration).toBeGreaterThan(0);
      expect(cfg.maxDuration).toBeLessThanOrEqual(900);
    }
  });

  it("cada entrada só usa chaves que o schema aceita", () => {
    const ok = new Set(["maxDuration", "memory", "runtime", "includeFiles", "excludeFiles"]);
    for (const [caminho, cfg] of Object.entries(fns)) {
      for (const k of Object.keys(cfg)) {
        expect(ok.has(k), `${caminho}: chave "${k}" não é do schema`).toBe(true);
      }
    }
  });
});
