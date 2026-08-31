/**
 * Etapa 77 (Fase 12) — a auditoria SQL de votos/cobertura é o instrumento de medição.
 *
 * Não há Postgres no CI para validar o parse, então este arquivo trava as propriedades que
 * fizeram os diagnósticos anteriores funcionarem — e as que, quebradas, dariam um resultado
 * ERRADO em silêncio (pior que quebrar):
 *
 *  · UMA instrução só — o SQL Editor exibe apenas a última; foi a lição do diagnóstico original;
 *  · somente leitura;
 *  · o predicado de ROSTER tem de espelhar `getActiveDiretoresForVote` (vote-inference.ts) —
 *    inclusive o `fonte_dado <> 'automatico'`, senão a auditoria mediria um roster que a
 *    inferência não usa e "provaria" divergência onde não há;
 *  · o predicado de deliberação FINAL tem de espelhar regulatory-documents.ts, senão o
 *    denominador conta pauta/voto_individual e infla a divergência.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const SQL = readFileSync(join(RAIZ, "docs/auditoria-votos-cobertura.sql"), "utf-8");
/** Sem comentários e sem strings, para contagens estruturais. */
const CODE = SQL.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");

describe("etapa77 · o contrato do SQL Editor", () => {
  it("é UMA instrução só", () => {
    const stmts = CODE.split(";").filter((s) => s.trim().length > 0);
    expect(stmts.length).toBe(1);
  });

  it("é somente leitura", () => {
    expect(CODE).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT)\b/i);
  });

  it("parênteses balanceados", () => {
    let bal = 0;
    for (const ch of CODE) {
      if (ch === "(") bal++;
      else if (ch === ")") { bal--; expect(bal).toBeGreaterThanOrEqual(0); }
    }
    expect(bal).toBe(0);
  });

  it("os 9 blocos numerados existem", () => {
    for (const k of [
      "1_votos_por_diretor", "2_votos_x_roster_2026", "2b_piores_divergentes",
      "3_interessado_empresas", "4_cobertura_2026_banco", "4b_onde_parou",
      "5_amostras", "6_sondas", "7_migrations",
    ]) {
      expect(SQL, `bloco ${k} sumiu`).toContain(`'${k}'`);
    }
  });
});

describe("etapa77 · o roster do SQL espelha a inferência real", () => {
  it("exclui mandato fonte_dado='automatico' em TODO predicado de roster", () => {
    // A inferência usa o roster ESTRITO (vote-inference.ts). Medir com outro roster "provaria"
    // divergência onde não há — o falso positivo clássico desta auditoria.
    // Contagem EXATA, não piso: com `>= 5`, remover o filtro de UM predicado passava batido
    // (mutação M2). Se um bloco novo legitimamente adicionar um roster, atualize o número —
    // o custo de manutenção é o preço de a auditoria não medir um roster que a inferência
    // não usa.
    const ocorrencias = SQL.match(/fonte_dado <> 'automatico'/g) ?? [];
    expect(ocorrencias.length).toBe(8);
  });

  it("a janela do mandato cobre a data (inclusive) e trata data_fim NULL como aberto", () => {
    expect(SQL).toMatch(/data_inicio <= del\.data_reuniao/);
    expect(SQL).toMatch(/data_fim IS NULL OR m\.data_fim >= del\.data_reuniao/);
  });

  it("só diretor aprovado entra no roster", () => {
    const ocorrencias = SQL.match(/review_status = 'aprovado'/g) ?? [];
    expect(ocorrencias.length).toBe(6);
  });
});

describe("etapa77 · o denominador é deliberação FINAL, como no código", () => {
  it("exclui pauta/voto_individual/documento_apoio", () => {
    const ocorrencias = SQL.match(/NOT IN \('pauta','voto_individual','documento_apoio'\)/g) ?? [];
    // Fase 16 — 5 → 6: o bloco 1b (ausência declarada sem linha) usa o MESMO predicado FINAL.
    expect(ocorrencias.length).toBe(6);
  });

  it("ata só conta como item de ata (documento_pai_id preenchido)", () => {
    const ocorrencias = SQL.match(/tipo_documento <> 'ata' OR del\.documento_pai_id IS NOT NULL/g) ?? [];
    // Fase 16 — 5 → 6: o bloco 1b (ausência declarada sem linha) usa o MESMO predicado FINAL.
    expect(ocorrencias.length).toBe(6);
  });
});

describe("etapa77 · o que o usuário recebe é utilizável", () => {
  it("as amostras trazem a URL PÚBLICA do PDF (as duas chaves de metadata)", () => {
    // Os dois caminhos de ingestão gravam chaves DIFERENTES — sem o COALESCE metade das
    // amostras sairia sem link.
    expect(SQL).toMatch(/COALESCE\(dr\.metadata->>'source_url', dr\.metadata->>'monitoramento_url'\)/);
  });

  it("as divergentes nomeiam QUEM FALTA — é o que permite abrir o PDF e conferir", () => {
    expect(SQL).toMatch(/quem_falta/);
    expect(SQL).toMatch(/NOT EXISTS \(SELECT 1 FROM votos v2/);
  });

  it("nenhuma coluna CONDICIONAL fora da sonda ⑦ — a query não pode quebrar sem migration", () => {
    // `votos.proveniencia` e `deliberacoes.reuniao_id` podem não existir em produção; a query
    // só pode citá-los dentro da sonda de information_schema.
    // Fase 16 — o bloco ① decompõe por proveniência via `to_jsonb(v)->>'proveniencia'`, que RODA
    // sem a coluna (é literal de string, não identificador). O banimento vale para o
    // IDENTIFICADOR: strings entre aspas são apagadas antes do match.
    const foraDaSonda = CODE.replace(/information_schema[\s\S]*?\) m/g, "").replace(/'[^']*'/g, "''");
    expect(foraDaSonda).not.toMatch(/\bproveniencia\b/);
    expect(foraDaSonda).not.toMatch(/\breuniao_id\b/);
  });

  it("o motivo de arquivamento é agrupável (split_part corta o sufixo variável)", () => {
    expect(SQL).toMatch(/split_part\(COALESCE\(mi\.metadata->>'enqueue_motivo',''\), ':', 1\)/);
  });
});
