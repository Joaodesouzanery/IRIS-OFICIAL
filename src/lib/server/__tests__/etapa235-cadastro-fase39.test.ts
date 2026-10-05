/**
 * Etapa 235 (Fase 39, passo 6) — as limpezas de cadastro e os dois avisos que o `automatico` calava.
 *
 * O SQL B fechou o cadastro: os mandatos estão certos. Sobram limpezas, e cada uma tem uma
 * propriedade que não pode se perder: nada sai sem rastro, nenhum mandato é inventado, e o aviso
 * "diretores sem mandato" usa o MESMO filtro do motor de voto.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const semComentariosSql = (s: string) => s.replace(/--[^\n]*/g, " ");

describe("etapa235 · a migration do cadastro", () => {
  const MIG = semComentariosSql(ler("supabase/migrations/20261005120000_cadastro_fase39.sql"));

  it("o RASTRO é gravado ANTES do DELETE, com as mesmas condições", () => {
    const iRastro = MIG.indexOf("mandatos_automaticos_removidos_fase39");
    const iDelete = MIG.indexOf("DELETE FROM public.mandatos");
    expect(iRastro).toBeGreaterThan(-1);
    expect(iDelete).toBeGreaterThan(iRastro);
    const guarda = "EXISTS (SELECT 1 FROM public.mandatos v WHERE v.diretor_id = m.diretor_id AND v.fonte_dado = 'verificado')";
    expect(MIG.split(guarda).length - 1, "rastro e delete com condições diferentes").toBe(2);
  });

  it("só apaga `automatico`, só dos dois nomes do SQL B, só de quem tem um verificado", () => {
    const del = MIG.slice(MIG.indexOf("DELETE FROM public.mandatos"), MIG.indexOf("SET situacao = 'designado'"));
    expect(del).toMatch(/m\.fonte_dado = 'automatico'/);
    expect(del).toMatch(/di\.nome IN \('Alex Antonio de Azevedo Cruz', 'Guilherme Theo Rodrigues da Rocha Sampaio'\)/);
  });

  it("inativos SEM mandato inventado — e só se continuarem sem nenhum mandato", () => {
    expect(MIG).toMatch(/SET situacao = 'inativo'/);
    expect(MIG).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.mandatos m WHERE m\.diretor_id = d\.id\)/);
    expect(MIG).not.toMatch(/INSERT INTO public\.mandatos/);
  });

  it("idempotente e com o envelope do projeto", () => {
    expect(MIG).toMatch(/IS DISTINCT FROM 'designado'/);
    expect(MIG).toMatch(/IS DISTINCT FROM 'inativo'/);
    expect(MIG).toMatch(/BEGIN;[\s\S]*COMMIT;[\s\S]*NOTIFY pgrst, 'reload schema';/);
    expect(MIG).not.toMatch(/CREATE (OR REPLACE )?FUNCTION|CREATE TEMP/i);
  });
});

describe("etapa235 · o aviso 'sem mandato' usa o filtro do motor", () => {
  for (const rota of ["src/app/api/v1/admin/saude-dados/route.ts", "src/app/api/v1/admin/completude-2026/route.ts"]) {
    it(`${rota.split("/").slice(-2, -1)[0]}: mandato automático não conta, ex-diretor inativo não é lacuna`, () => {
      const R = semComentarios(ler(rota));
      expect(R).toMatch(/from\("mandatos"\)\.select\("id, diretor_id"\)\.neq\("fonte_dado", "automatico"\)/);
      expect(R).toMatch(/d\.situacao !== "inativo"/);
    });
  }
});

describe("etapa235 · o QA da fase só usa colunas que existem", () => {
  const QA = ler("docs/qa-fase39.sql");
  it("nenhum `criado_em` (o erro do qa-fase36) e só leitura", () => {
    expect(QA).not.toMatch(/criado_em/);
    expect(semComentariosSql(QA)).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
  });
});
