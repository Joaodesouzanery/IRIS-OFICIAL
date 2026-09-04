/**
 * Etapa 104 (Fase 17, commit G) — os números do Dashboard passam a se explicar.
 *
 * O usuário comparou 1028 linhas no banco com 692 na tela e perguntou como confiar nas métricas.
 * A diferença NÃO é filtro de ano nem de agência (a tela não manda nenhum dos dois): é
 * inteiramente `isFinalDecisionRecord`. O número está certo — o que faltava era ele DIZER isso.
 *
 * Decisão do usuário (registrada): manter 692 e publicar a decomposição. Mexer no predicado
 * mudaria analytics, reuniões, microtemas, mandatos e o padrão-ouro de certificação.
 *
 * ═══ Os três defeitos de medição consertados junto ═══
 * · "Reuniões Únicas" era `DISTINCT data_reuniao` GLOBAL: duas agências que se reúnem no mesmo
 *   dia viravam UMA reunião, e a tabela `reunioes` materializada era ignorada.
 * · "100% por IA": constante — não há LLM nenhum na esteira de extração. O rótulo mentia sobre
 *   COMO o dado é produzido.
 * · O QUINTO estado: item de ata sem `resultado` some do "pautado" (o predicado exige
 *   `documento_pai_id && resultado`), mas a METODOLOGIA declara só quatro estados.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { classificarDescarte, reuniaoKey } from "@/lib/server/metricas-decomposicao";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const OVERVIEW = ler("src/app/api/v1/dashboard/overview/route.ts")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
const PAGE = ler("src/app/dashboard/page.tsx");
const VOTOS = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");
const METODO = ler("docs/METODOLOGIA-METRICAS.md");

describe("etapa104 · COMPORTAMENTO: cada linha descartada tem um porquê nomeado", () => {
  it("pauta/voto_individual/apoio → descarte por TIPO", () => {
    expect(classificarDescarte({ tipo_documento: "pauta", resultado: "Deferido" })).toBe("tipo_nao_final");
    expect(classificarDescarte({ tipo_documento: "voto_individual", resultado: null })).toBe("tipo_nao_final");
  });

  it("ata SEM item filho é ENVELOPE, não deliberação", () => {
    expect(classificarDescarte({ tipo_documento: "ata", documento_pai_id: null, resultado: "Deferido" }))
      .toBe("ata_envelope");
  });

  it("o QUINTO estado: item de ata com pai e SEM resultado tem nome próprio", () => {
    expect(classificarDescarte({ tipo_documento: "ata", documento_pai_id: "abc", resultado: null }))
      .toBe("sem_resultado_extraido");
  });

  it("o que ENTRA no total não é descarte", () => {
    expect(classificarDescarte({ tipo_documento: "deliberacao", resultado: "Deferido" })).toBeNull();
    expect(classificarDescarte({ tipo_documento: "ata", documento_pai_id: "abc", resultado: "Indeferido" })).toBeNull();
  });
});

describe("etapa104 · COMPORTAMENTO: reunião única é por AGÊNCIA, não por data", () => {
  it("mesma data em agências diferentes são DUAS reuniões", () => {
    const a = reuniaoKey({ agencia_id: "ag-1", data_reuniao: "2026-09-01", numero_reuniao: "10" });
    const b = reuniaoKey({ agencia_id: "ag-2", data_reuniao: "2026-09-01", numero_reuniao: "10" });
    expect(a).not.toBe(b);
  });

  it("mesma agência e data com números diferentes são DUAS (ordinária e extraordinária)", () => {
    const a = reuniaoKey({ agencia_id: "ag-1", data_reuniao: "2026-09-01", numero_reuniao: "10" });
    const b = reuniaoKey({ agencia_id: "ag-1", data_reuniao: "2026-09-01", numero_reuniao: "11" });
    expect(a).not.toBe(b);
  });

  it("a mesma reunião, lida de duas deliberações, é UMA", () => {
    const a = reuniaoKey({ agencia_id: "ag-1", data_reuniao: "2026-09-01", numero_reuniao: "10" });
    const b = reuniaoKey({ agencia_id: "ag-1", data_reuniao: "2026-09-01", numero_reuniao: "10" });
    expect(a).toBe(b);
  });
});

describe("etapa104 · a rota publica a decomposição, e a tela a mostra", () => {
  it("o payload traz total_linhas e o mapa de descartados", () => {
    expect(OVERVIEW).toMatch(/total_linhas:/);
    expect(OVERVIEW).toMatch(/descartados:/);
    expect(OVERVIEW).toMatch(/classificarDescarte\(/);
  });

  it("reuniões únicas usa a chave, não o Set de datas", () => {
    expect(OVERVIEW).toMatch(/reuniaoKey\(/);
    expect(OVERVIEW).not.toMatch(/new Set\(rows\.map\(\(r\) => r\.data_reuniao\)/);
  });

  it("a tela explica o total em vez de só exibi-lo", () => {
    expect(PAGE).toMatch(/total_linhas/);
  });
});

describe("etapa104 · rótulos que mentiam", () => {
  it("«por IA» sai: não há LLM na esteira de extração", () => {
    expect(PAGE).not.toMatch(/subvalue="por IA"/);
  });

  it("a lista de exceções avisa quando corta grupos", () => {
    expect(VOTOS).toMatch(/n[aã]o exibido/i);
  });
});

describe("etapa104 · a METODOLOGIA declara o quinto estado", () => {
  it("o item de ata sem resultado está documentado", () => {
    expect(METODO).toMatch(/quinto estado|sem_resultado_extraido/i);
    expect(METODO).toMatch(/1028|decomposi/i);
  });
});
