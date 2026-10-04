/**
 * Etapa 227 — Qualidade Regulatória: o prêmio só com evidência validada (④), a matriz versionada em
 * tabela (⑤) e a nota curada FORA da medição (⑥).
 *
 * ⑥ — o que estava errado, MEDIDO no código antes de mexer:
 *  (a) `buildDiagnosticsFromRows` preenchia dimensão sem avaliação com a nota de `CURATED_NOTES`,
 *      dentro de um conjunto rotulado `source: "database"`;
 *  (b) o `score_geral` gravado em `qualidade_regulatoria_diagnosticos` era PREFERIDO ao calculado —
 *      e a única coisa que já gravou nessa tabela é o SEED CURADO de 2026 (escala de 10 critérios),
 *      que a migration IMQN não apagou. O ranking mostrava a ordem curada;
 *  (c) o fallback curado elegia vencedora do prêmio.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  COBERTURA_MINIMA_PREMIO,
  buildInitialDiagnostics,
  buildPremioWinners,
  coberturaDaCategoria,
  diagnosticoMedido,
  rankDiagnostics,
  type QualidadeDiagnostico,
  type OrigemNota,
} from "../qualidade-regulatoria";
import { IMQN_REV2022 } from "../imqn";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ").replace(/^--.*$/gm, " ");

const SERVICO = semComentarios(ler("src/lib/server/qualidade-regulatoria-service.ts"));
const MIGRATION = ler("supabase/migrations/20261004120000_qualidade_imqn_rev2022.sql");

function diag(sigla: string, score: number, origem: OrigemNota = "auto"): QualidadeDiagnostico {
  return {
    agencia_sigla: sigla,
    notas: [1, 2, 3, 4, 5, 6].map((id) => ({
      agencia_sigla: sigla, criterio_id: id, nota: score, nivel: "gerenciado", observacao: "",
      evidencias: [], data_avaliacao: "2026-10-01", fonte_avaliacao: "x", status_revisao: "preliminar",
      origem_nota: origem,
    })),
    score_geral: score, posicao_ranking: null, destaques_positivos: [], areas_melhoria: [],
    ultima_atualizacao: "2026-10-01", status_revisao: "preliminar",
  };
}
const todas = new Set([1, 2, 3, 4, 5, 6]);

describe("etapa227 · ⑥ CURATED_NOTES não aparece como nota medida", () => {
  it("o fallback curado marca TODA nota como 'curada'", () => {
    for (const d of buildInitialDiagnostics(2026)) {
      for (const n of d.notas) expect(n.origem_nota, `${d.agencia_sigla}/${n.criterio_id}`).toBe("curada");
    }
  });

  it("⚠️ e por isso o fallback NÃO recebe posição de ranking", () => {
    for (const d of buildInitialDiagnostics(2026)) expect(d.posicao_ranking, d.agencia_sigla).toBeNull();
  });

  it("⚠️ nem vencedora de prêmio — mesmo com cobertura validada total", () => {
    const cobertura = new Map(buildInitialDiagnostics(2026).map((d) => [d.agencia_sigla, todas]));
    for (const p of buildPremioWinners(buildInitialDiagnostics(2026), undefined, cobertura)) {
      expect(p.vencedora, p.categoria.id).toBeNull();
    }
  });

  it("ranking: medidos recebem posição; curado/ausente ficam com null, depois", () => {
    const r = rankDiagnostics([diag("A", 50), diag("B", 90, "curada"), diag("C", 70), diag("D", 99, "ausente")]);
    expect(r.map((x) => [x.agencia_sigla, x.posicao_ranking])).toEqual([["C", 1], ["A", 2], ["B", null], ["D", null]]);
  });

  it("uma única dimensão curada tira a agência do ranking", () => {
    const d = diag("A", 80);
    d.notas[3] = { ...d.notas[3], origem_nota: "curada" };
    expect(diagnosticoMedido(d)).toBe(false);
  });

  it("⚠️ o serviço NÃO preenche lacuna com nota curada — a dimensão sai 'ausente'", () => {
    expect(SERVICO, "voltou o preenchimento com fallbackNote").not.toMatch(/if \(!row\) return fallbackNote/);
    expect(SERVICO).toMatch(/origem_nota: "ausente"/);
  });

  it("⚠️ o serviço SEMPRE calcula o score — nunca o `score_geral` gravado pelo seed curado", () => {
    expect(SERVICO, "voltou a preferir o score_geral gravado").not.toMatch(/diagnostic \? Number\(Number\(diagnostic\.score_geral\)/);
    expect(SERVICO).toMatch(/score_geral: calculateWeightedScore\(notes\),/);
  });

  it("a origem da linha do banco sai do `fonte_avaliacao` — curada nunca vira medida", () => {
    expect(SERVICO).toMatch(/if \(fonte === "iris_auto_classificacao"\) return "auto";/);
    expect(SERVICO).toMatch(/fonte === "base_curada_2026"/);
  });
});

describe("etapa227 · ④ prêmio só com cobertura mínima de evidência VALIDADA", () => {
  it("o mínimo é declarado: TODOS os critérios da categoria", () => {
    expect(COBERTURA_MINIMA_PREMIO).toBe(1);
  });

  it("cobertura = fração dos critérios da categoria com evidência validada", () => {
    expect(coberturaDaCategoria([1, 6], new Set([1]))).toBe(0.5);
    expect(coberturaDaCategoria([1, 6], new Set([1, 6]))).toBe(1);
    expect(coberturaDaCategoria([1], undefined)).toBe(0);
    expect(coberturaDaCategoria([], new Set([1]))).toBe(0);
  });

  it("sem cobertura, NÃO há vencedora — e o status diz por quê", () => {
    const p = buildPremioWinners([diag("A", 90), diag("B", 50)]);
    for (const x of p.filter((y) => y.categoria.tipo !== "evolucao")) {
      expect(x.vencedora, x.categoria.id).toBeNull();
      expect(x.status).toBe("cobertura_insuficiente");
    }
  });

  it("⚠️ a de MAIOR nota sem cobertura perde para a de menor nota COM cobertura", () => {
    const p = buildPremioWinners([diag("A", 90), diag("B", 50)], undefined, new Map([["B", todas]]));
    expect(p.find((x) => x.categoria.id === "geral")?.vencedora).toBe("B");
  });

  it("cobertura parcial não basta: AIR coberto, ARR não → fora de 'agenda_arr' (critérios 4 e 6)", () => {
    const p = buildPremioWinners([diag("A", 90)], undefined, new Map([["A", new Set([1, 4])]]));
    expect(p.find((x) => x.categoria.id === "air")?.vencedora).toBe("A");
    expect(p.find((x) => x.categoria.id === "agenda_arr")?.vencedora).toBeNull();
  });

  it("a melhor cobertura observada é publicada para 'ninguém venceu' não parecer defeito", () => {
    const p = buildPremioWinners([diag("A", 90)], undefined, new Map([["A", new Set([4])]]));
    const x = p.find((y) => y.categoria.id === "agenda_arr")!;
    expect(x).toMatchObject({ status: "cobertura_insuficiente", melhor_cobertura: 0.5, cobertura_minima: 1 });
  });

  it("⚠️ o serviço lê a evidência validada PAGINADA — o `.limit(500)` da lista não é o portão", () => {
    expect(SERVICO).toMatch(/"qualidade\/evidencias-validadas"/);
    expect(SERVICO).toMatch(/\.eq\("status_revisao", "validado"\)/);
    expect(SERVICO).toMatch(/buildPremioWinners\(ranking, undefined, extras\.coberturaValidada\)/);
  });
});

describe("etapa227 · ⑤ matriz versionada em tabela — o SQL é o MESMO dado do JSON", () => {
  const condicoes = IMQN_REV2022.dimensoes.flatMap((d) => d.criterios.flatMap((c) => c.condicoes));
  const sql = (s: string) => s.replace(/'/g, "''");

  it("cria as 5 tabelas, com RLS service_role", () => {
    for (const t of ["matrizes", "dimensoes", "criterios", "condicoes", "condicoes_avaliadas"]) {
      expect(MIGRATION).toContain(`CREATE TABLE IF NOT EXISTS public.qualidade_imqn_${t}`);
      expect(MIGRATION).toContain(`ALTER TABLE public.qualidade_imqn_${t} ENABLE ROW LEVEL SECURITY`);
      expect(MIGRATION).toContain(`qualidade_imqn_${t}_service_role_all`);
    }
  });

  it("⚠️ cada uma das 73 condições está no SQL com o MESMO texto e a mesma verificabilidade", () => {
    expect(condicoes).toHaveLength(73);
    for (const c of condicoes) {
      expect(MIGRATION, c.id).toContain(`'${c.id}'`);
      expect(MIGRATION, c.id).toContain(`'${sql(c.texto)}', '${c.verificabilidade}'`);
    }
  });

  it("os 10 critérios com o peso na dimensão, e as 6 dimensões com peso e base legal", () => {
    // O SQL foi escrito pelo gerador (repr de número do Python: 1.0, 0.35) — formatamos igual.
    const num = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
    for (const d of IMQN_REV2022.dimensoes) {
      expect(MIGRATION).toContain(`('rev2022', ${d.id}, '${d.codigo}', '${sql(d.nome)}', ${num(d.peso)}, '${sql(d.base_legal)}', FALSE`);
      for (const c of d.criterios) expect(MIGRATION).toContain(`('rev2022', '${c.codigo}', ${d.id}, '${sql(c.nome)}', ${num(c.peso_na_dimensao)},`);
    }
  });

  it("⚠️ reaplicar a migration NÃO sobrescreve base legal que o usuário já conferiu", () => {
    expect(MIGRATION).toMatch(/base_legal = CASE WHEN qualidade_imqn_dimensoes\.base_legal_conferida THEN qualidade_imqn_dimensoes\.base_legal ELSE EXCLUDED\.base_legal END/);
  });

  it("idempotente e no padrão do projeto: transação, ON CONFLICT, NOTIFY, sem função nem tabela temporária", () => {
    expect(MIGRATION).toMatch(/^BEGIN;/m);
    expect(MIGRATION).toMatch(/^COMMIT;/m);
    expect(MIGRATION).toMatch(/NOTIFY pgrst, 'reload schema';/);
    const codigo = MIGRATION.replace(/^--.*$/gm, "");
    expect(codigo).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION/i);
    expect(codigo).not.toMatch(/CREATE TEMP/i);
    expect((codigo.match(/INSERT INTO/g) ?? []).length).toBe((codigo.match(/ON CONFLICT/g) ?? []).length);
  });

  it("a avaliação por condição tem UNIQUE por (agência, ano, versão, condição) e CHECK de status", () => {
    expect(MIGRATION).toContain("UNIQUE (agencia_sigla, ano, versao, condicao_id)");
    expect(MIGRATION).toMatch(/status_revisao IN \('preliminar','pendente','em_revisao','validado','rejeitado'\)/);
  });

  it("⚠️ o serviço degrada SEM a migration: tabela ausente = comprovada 0 com o flag dizendo isso", () => {
    expect(SERVICO).toMatch(/avaliacaoPorCondicaoDisponivel = true;/);
    expect(SERVICO).toMatch(/avaliacao_por_condicao_disponivel: extras\.avaliacaoPorCondicaoDisponivel/);
  });

  it("e a nota comprovada só conta condição atendida, validada e COM evidência", () => {
    const i = SERVICO.indexOf('"qualidade/condicoes-comprovadas"');
    const bloco = SERVICO.slice(Math.max(0, i - 500), i);
    expect(bloco).toMatch(/\.eq\("atendida", true\)/);
    expect(bloco).toMatch(/\.eq\("status_revisao", "validado"\)/);
    expect(bloco).toMatch(/\.not\("evidencia_url", "is", null\)/);
  });
});
