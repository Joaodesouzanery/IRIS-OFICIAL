/**
 * Etapa 133 (Fase 23, commit 5) — quantas escritas no Supabase ainda não checam `{ error }`?
 *
 * A skill `falha-silenciosa` nasceu na Fase 19 com a medição "~47% das escritas não checam". Desde
 * então cada fase consertou caso a caso — sem nunca remedir. Este teste é o instrumento: varre
 * TODAS as escritas (`.from("…")…insert|update|upsert|delete(`) fora de __tests__ e classifica
 * cada uma como CHECADA (o resultado é desestruturado/lido com `error`) ou NÃO. O número é
 * congelado em `falha-silenciosa-baseline.json` e a partir daqui **só pode cair**: quem adicionar
 * uma escrita sem checagem faz o teste cair.
 *
 * Heurística declarada (não é AST): a escrita é "checada" se, no mesmo statement (do início da
 * linha da atribuição até o `;`), aparece `error` — `const { error }`, `{ error: x }`,
 * `.error`, `res.error` — OU se o statement é `return` de uma função cujo chamador desestrutura
 * (helpers listados em CHECADO_PELO_CHAMADOR, cada um conferido à mão).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const BASELINE = join(__dirname, "fixtures/falha-silenciosa-baseline.json");

/** Escritas que são `return db.from(...)...` dentro de helpers cujo chamador SEMPRE lê `{error}`. */
const CHECADO_PELO_CHAMADOR = new Set<string>([
  "src/lib/server/votos-write.ts",
]);

function fontes(dir = join(RAIZ, "src")): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) { if (nome !== "__tests__") out.push(...fontes(p)); }
    else if (/\.tsx?$/.test(nome)) out.push(p);
  }
  return out;
}

interface Escrita { arquivo: string; linha: number; op: string; checada: boolean }

function varrer(): Escrita[] {
  const out: Escrita[] = [];
  const RE = /\.from\(\s*["'`][^"'`]+["'`]\s*\)[\s\S]{0,400}?\.(insert|update|upsert|delete)\(/g;
  for (const p of fontes()) {
    const rel = p.slice(RAIZ.length + 1);
    const txt = readFileSync(p, "utf-8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
    let m: RegExpExecArray | null;
    RE.lastIndex = 0;
    while ((m = RE.exec(txt)) !== null) {
      const ini = m.index;
      // O statement: do último ';' ou '{' antes até o próximo ';' depois do call.
      const antes = txt.lastIndexOf(";", ini);
      const abre = txt.lastIndexOf("{", ini);
      const inicio = Math.max(antes, abre) + 1;
      const fim = txt.indexOf(";", RE.lastIndex);
      const stmt = txt.slice(inicio, fim === -1 ? RE.lastIndex + 200 : fim + 1);
      // Depois do statement, os próximos 300 chars (checagem `if (res.error)` na linha seguinte).
      const depois = txt.slice(fim === -1 ? RE.lastIndex : fim, (fim === -1 ? RE.lastIndex : fim) + 300);
      const atribuido = /(?:const|let|var)\s+(?:\{[^}]*\}|\w+)\s*=/.test(stmt);
      const varNome = stmt.match(/(?:const|let|var)\s+(\w+)\s*=/)?.[1];
      const checada =
        /\berror\b/.test(stmt) ||
        (!!varNome && new RegExp(`\\b${varNome}\\??\\.error\\b`).test(depois)) ||
        (/^\s*return\b/.test(stmt) && CHECADO_PELO_CHAMADOR.has(rel)) ||
        (!atribuido && /\.then\(\s*\(\s*\{[^}]*error/.test(stmt));
      const linha = txt.slice(0, ini).split("\n").length;
      out.push({ arquivo: rel, linha, op: m[1], checada });
    }
  }
  return out;
}

describe("etapa133 · a medição", () => {
  const escritas = varrer();
  const total = escritas.length;
  const semChecagem = escritas.filter((e) => !e.checada);
  const porArquivo: Record<string, number> = {};
  for (const e of semChecagem) porArquivo[e.arquivo] = (porArquivo[e.arquivo] ?? 0) + 1;

  it("há escritas para medir", () => {
    expect(total).toBeGreaterThan(50);
    console.log(`escritas=${total} · sem checagem=${semChecagem.length} (${((semChecagem.length / total) * 100).toFixed(1)}%)`);
    console.log(JSON.stringify({ total, sem_checagem: semChecagem.length, por_arquivo: porArquivo }, null, 1));
  });

  it("o baseline existe e o número NÃO subiu — quem adicionar escrita sem checagem cai aqui", () => {
    expect(existsSync(BASELINE), "grave o JSON impresso acima em falha-silenciosa-baseline.json").toBe(true);
    const base = JSON.parse(readFileSync(BASELINE, "utf-8")) as { total: number; sem_checagem: number; por_arquivo: Record<string, number> };
    expect(semChecagem.length, "escritas sem checagem SUBIRAM").toBeLessThanOrEqual(base.sem_checagem);
    for (const [arq, n] of Object.entries(porArquivo)) {
      expect(n, `${arq}: escritas sem checagem subiram`).toBeLessThanOrEqual(base.por_arquivo[arq] ?? 0);
    }
  });
});
