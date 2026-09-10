/**
 * Etapa 138 (Fase 25, commit 3) — o período do card "Métricas por diretor" é visível e escolhível.
 *
 * Duas tabelas na mesma tela com denominadores diferentes e nenhum rótulo: a "Completude 2026"
 * é só 2026; "Métricas por diretor" era todo o histórico (a rota não filtrava data em lugar
 * nenhum). O usuário comparava as duas como se fossem a mesma base.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

describe("etapa138 · a rota filtra por ano só quando pedido", () => {
  const rota = ler("src/app/api/v1/dashboard/diretores/overview/route.ts");
  it("`ano` válido → join com deliberacoes e intervalo do ano; sem `ano` → sem join (todo o histórico)", () => {
    expect(rota).toMatch(/const ano = anoParam && \/\^20\\d\{2\}\$\/\.test\(anoParam\) \? anoParam : null/);
    expect(rota).toMatch(/\$\{ano \? ", deliberacoes!inner \(data_reuniao\)" : ""\}/);
    expect(rota).toMatch(/if \(ano\) q = q\.gte\("deliberacoes\.data_reuniao", `\$\{ano\}-01-01`\)\.lte\("deliberacoes\.data_reuniao", `\$\{ano\}-12-31`\)/);
  });
  it("as relatorias seguem o mesmo período — senão a coluna Relatorias fica de outro denominador", () => {
    expect(rota).toMatch(/if \(ano\) q = q\.gte\("data_reuniao", `\$\{ano\}-01-01`\)/);
  });
});

describe("etapa138 · a tela diz o período e explica «Divergentes»", () => {
  const tela = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");
  it("cabeçalho com o período e seletor todo o histórico / 2026", () => {
    expect(tela).toMatch(/Métricas por diretor · \{anoVotos \? anoVotos : "todo o histórico"\}/);
    expect(tela).toMatch(/<option value="2026">Só 2026<\/option>/);
    expect(tela).toMatch(/params\.set\("ano", anoVotos\)/);
  });
  it("«Divergentes» explica que é contra o desfecho, não dissenso entre colegas", () => {
    expect(tela).toMatch(/title="Votou contra o desfecho registrado/);
  });
});
