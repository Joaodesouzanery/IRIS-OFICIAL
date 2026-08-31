/**
 * Etapa 96 (Fase 16, commit D) — "votos por diretor" passa a dizer VOTOS, e a auditoria explica
 * o resto.
 *
 * ═══ O que o número da tela era ═══
 * `COUNT(*)` de `votos` sem recorte de ano nem de finalidade — e `Ausente`/`Abstencao` contavam
 * +1 no total. Parte da "diferença entre diretores" que o usuário viu era ausência sendo contada
 * como voto. Correção, não regressão: os números da tela VÃO CAIR (registrado com data em
 * docs/METODOLOGIA-METRICAS.md, senão o relatório de setembro fica incomparável com o de agosto).
 *
 * ═══ O limite que NENHUM commit resolve ═══
 * A fonte da ARTESP nunca nomina voto (0 nominais; tudo inferido do roster). Diferença entre
 * diretores da ARTESP é diferença de JANELA DE MANDATO, não de comportamento — exibir, não
 * "corrigir". Fica na metodologia.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const ROTA = ler("src/app/api/v1/dashboard/diretores/overview/route.ts");
const PAGE = ler("src/app/dashboard/page.tsx");
const SQL = ler("docs/auditoria-votos-cobertura.sql");
const METODO = ler("docs/METODOLOGIA-METRICAS.md");

describe("etapa96 · a rota decompõe — efetivo é Favorável+Desfavorável", () => {
  it("conta ausências e abstenções SEPARADAS do efetivo", () => {
    expect(ROTA).toMatch(/ausentes: number/);
    expect(ROTA).toMatch(/abstencoes: number/);
    expect(ROTA).toMatch(/tipo_voto === "Ausente"\) s\.ausentes\+\+/);
    expect(ROTA).toMatch(/tipo_voto === "Abstencao"\) s\.abstencoes\+\+/);
  });

  it("efetivos = favoravel + desfavoravel — derivado, não um quarto contador que pode divergir", () => {
    expect(ROTA).toMatch(/efetivos: s\.favoravel \+ s\.desfavoravel/);
  });

  it("o ranking ordena por EFETIVOS — é o número que a tela compara", () => {
    expect(ROTA).toMatch(/\.sort\(\(a, b\) => b\.efetivos - a\.efetivos\)/);
  });

  it("pct_favor sobre o denominador efetivo — ausência não dilui taxa de deferimento", () => {
    const codigo = ROTA.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
    expect(codigo).toMatch(/s\.favoravel \+ s\.desfavoravel > 0[\s\S]{0,120}?s\.favoravel \/ \(s\.favoravel \+ s\.desfavoravel\)/);
  });
});

describe("etapa96 · o widget mostra o efetivo — e não esconde a ausência", () => {
  it("o número principal é d.efetivos (com fallback para payload antigo)", () => {
    expect(PAGE).toMatch(/formatNumber\(d\.efetivos \?\? d\.total\)/);
  });

  it("ausências/abstenções aparecem à parte quando existem", () => {
    expect(PAGE).toMatch(/d\.ausentes \?\? 0\) \+ \(d\.abstencoes \?\? 0/);
  });
});

describe("etapa96 · a auditoria explica a diferença — por dimensão, não por adjetivo", () => {
  it("bloco ① ganhou o recorte 2026 e a decomposição por desfecho", () => {
    for (const col of ["AS efetivos", "AS ausencias", "AS abstencoes", "AS votos_2026", "AS efetivos_2026"]) {
      expect(SQL, `coluna ${col} ausente do bloco ①`).toContain(col);
    }
  });

  it("bloco ① decompõe por proveniência — nominal × inferido_unanimidade × inferido_decisao × legado", () => {
    for (const col of ["AS prov_nominal", "AS prov_inferido_unanimidade", "AS prov_inferido_decisao", "AS prov_legado_null"]) {
      expect(SQL, `coluna ${col} ausente`).toContain(col);
    }
    // A forma é a GUARDADA (to_jsonb — roda sem a migration 20260824); legado = NULL.
    expect(SQL).toMatch(/to_jsonb\(v\)->>'proveniencia' IS NULL/);
  });

  it("o gap do match 0.6–0.85 é CONTADO: ausência declarada no raw sem linha `Ausente` gravada", () => {
    expect(SQL).toContain("'1b_ausencia_declarada_sem_linha'");
    expect(SQL).toMatch(/nomes_votacao_ausente/);
    expect(SQL).toMatch(/NOT EXISTS[\s\S]{0,200}?tipo_voto = 'Ausente'/);
  });

  it("relatoria por STRING limpa, por agência — o match fuzzy fica na rota, e o SQL diz isso", () => {
    expect(SQL).toContain("'1c_relatorias_por_relator'");
    expect(SQL).toMatch(/regexp_replace\(/);
  });
});

describe("etapa96 · a metodologia registra a mudança COM DATA", () => {
  it("a definição nova tem vigência declarada", () => {
    expect(METODO).toMatch(/01\/09\/2026/);
    expect(METODO).toMatch(/votos efetivos/i);
  });

  it("o limite da ARTESP está escrito: diferença ali é janela de mandato, não comportamento", () => {
    expect(METODO).toMatch(/ARTESP[\s\S]{0,400}?janela de mandato/i);
  });
});
