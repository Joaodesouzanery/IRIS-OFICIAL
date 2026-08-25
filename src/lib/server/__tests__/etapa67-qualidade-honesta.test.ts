/**
 * Etapa 67 — "parar de mentir": os três estados desonestos do módulo Qualidade Regulatória.
 *
 * Este é o Commit 0 da fase, antes de qualquer estética — porque estes furos produziam RANKING
 * PÚBLICO ERRADO a cada rodada:
 *
 *  1. Falha de persistência era ENGOLIDA (catch que só logava) e a UI mostrava banner VERDE de
 *     sucesso com o banco sem receber nada.
 *  2. Falha de FETCH do portal era indistinguível de "portal não publica": um timeout de rede
 *     rebaixava a agência para `inexistente` (nota 0) — e isso virava posição de ranking.
 *  3. A UI afirmava "apenas evidencias validadas alimentam a pontuacao" — FALSO: a nota vem de
 *     `qualidade_regulatoria_avaliacoes`; validar/rejeitar evidência não muda um ponto.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { classifyMaturidade } from "@/lib/server/qualidade-maturidade-classifier";
import { emptySiteSignals, type SiteSignals } from "@/lib/server/qualidade-site-coletor";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf-8");

// ─── Banco falso mínimo para o classificador ─────────────────────────────────
function fakeDb(opts: { agencias: Array<{ id: string; sigla: string }> }) {
  return {
    from(tabela: string) {
      const linhas: unknown[] =
        tabela === "agencias" ? opts.agencias : [];
      const self: any = {
        select() { return self; },
        eq() { return self; },
        order() { return self; },
        limit() { return self; },
        then: (r: (v: { data: unknown[]; error: null }) => unknown) => r({ data: linhas, error: null }),
      };
      return self;
    },
  };
}

describe("etapa67 · fetch_failed ≠ inexistente — timeout de rede não vira ranking", () => {
  const db = fakeDb({ agencias: [{ id: "a1", sigla: "ANEEL" }] });

  it("portal INACESSÍVEL (null) gera warning e a observação diz a verdade", async () => {
    const siteSignals = new Map<string, SiteSignals | null>([["ANEEL", null]]);
    const { propostas, resultados } = await classifyMaturidade(db as never, { ano: 2026, siteSignals });

    const r = resultados.find((x) => x.agencia_sigla === "ANEEL")!;
    expect(r.warnings.join(" ")).toMatch(/inacess[íi]vel/i);

    // Nenhuma proposta pode alegar "nem no portal" — o portal não foi VISTO.
    for (const p of propostas.filter((x) => x.agencia_sigla === "ANEEL")) {
      expect(p.site_fetch_failed, "o flag tem de viajar na proposta").toBe(true);
      expect(p.observacao, "não se afirma ausência do que não se conseguiu olhar")
        .not.toMatch(/nem no portal/i);
    }
  });

  it("sinais VAZIOS por desenho (ARTESP/no-op) continuam sendo ausência real — sem flag", async () => {
    const siteSignals = new Map<string, SiteSignals | null>([["ANEEL", emptySiteSignals()]]);
    const { propostas, resultados } = await classifyMaturidade(db as never, { ano: 2026, siteSignals });
    expect(resultados[0].warnings.join(" ")).not.toMatch(/inacess[íi]vel/i);
    for (const p of propostas) expect(p.site_fetch_failed).toBe(false);
  });

  it("agência FORA do mapa de sinais não é tratada como falha", async () => {
    const { propostas } = await classifyMaturidade(db as never, { ano: 2026, siteSignals: new Map() });
    for (const p of propostas) expect(p.site_fetch_failed).toBe(false);
  });
});

describe("etapa67 · a regra 'inacessível não rebaixa' está LIGADA na rota", () => {
  // A rota compara `p.nota < anterior` sob `site_fetch_failed` e pula o upsert. Sem acesso a
  // banco real aqui, travamos o CONTRATO no código-fonte — é o que impede a regra de ser
  // silenciosamente removida (mesma técnica dos testes de paridade da etapa65).
  it("classificar/run pula rebaixamento sob fetch falho e reporta a contagem", () => {
    const src = ler("src/app/api/v1/qualidade-regulatoria/coletas/classificar/run/route.ts");
    expect(src).toContain("p.site_fetch_failed && anterior !== undefined && p.nota < anterior");
    expect(src).toContain("rebaixamentos_evitados_por_portal_inacessivel");
  });
});

describe("etapa67 · persistência não é mais engolida", () => {
  it("a rota de coletas propaga `persist_error` e o sucesso é condicionado a ele", () => {
    const src = ler("src/app/api/v1/qualidade-regulatoria/coletas/run/route.ts");
    // O catch antigo que só logava não pode voltar:
    expect(src).not.toMatch(/persistResults\(results\)\.catch/);
    expect(src).toContain("persist_error: persistError");
    expect(src).toContain("!persistError && results.some");
    // E os DOIS inserts checam `error` (FK viola em silêncio sem isto):
    expect(src.match(/if \(error\) return `/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("o status degradado é distinguível de 'nunca coletei'", () => {
    const src = ler("src/app/api/v1/qualidade-regulatoria/coletas/status/route.ts");
    expect(src).toContain("degraded: true");
    expect(src).toContain("degraded_reason");
  });
});

describe("etapa67 · o texto falso saiu da UI", () => {
  it("nenhuma tela afirma que evidência validada alimenta pontuação", () => {
    const src = ler("src/components/qualidade/QualidadeRegulatoriaPage.tsx");
    expect(src).not.toContain("Apenas evidencias validadas alimentam a pontuacao");
    // O substituto diz o que o sistema FAZ:
    expect(src).toContain("a pontuação vem das avaliações por critério");
  });

  it("o banner de coleta não pode ser verde quando a gravação falhou", () => {
    const src = ler("src/components/qualidade/QualidadeRegulatoriaPage.tsx");
    expect(src).toContain("fullResult.persistErrors?.length");
    expect(src).toContain("a GRAVAÇÃO falhou");
  });
});
