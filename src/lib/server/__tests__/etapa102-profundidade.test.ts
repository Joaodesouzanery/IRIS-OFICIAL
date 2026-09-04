/**
 * Etapa 102 (Fase 17, commit E) — profundidade: a janela da ANTT desliza, e a ANM enxerga o arquivo.
 *
 * ═══ ANTT: o skip-set agia DEPOIS dos tetos ═══
 * `discoverAntt2026Meetings` enche `meetingLinks` até `maxMeetings` (:390, :408) e só no SEGUNDO
 * laço (:427) pula as reuniões já conhecidas. Com o passe diário limitado a ~30 e as 30 do topo
 * já no banco, a coleta gastava a cota inteira redescobrindo o que já tinha e devolvia ZERO
 * reuniões novas — a janela nunca deslizava. O crawl profundo existe só no botão manual, fora do
 * cron.
 *
 * ⚠️ E o conserto tem uma armadilha (X4): pular na PRIMEIRA volta faz `meetingLinks.size` deixar
 * de bater o teto, e `truncated` passaria a dizer COMPLETO quando não é — alimentando exatamente
 * a mentira que o commit D acabou de consertar em `cobertura-ao-vivo`. Por isso o que conta para
 * "enumeração parcial" é o total VISTO (novos + pulados), não o total coletado.
 *
 * ═══ ANM: profundidade 1 por construção ═══
 * A página real de atas da ROP tem, no rodapé, `<a ...>More…</a>` apontando para o arquivo
 * (`fixtures/anm/atas-da-rop.html:858`) — e nada no repo o segue. Consertado pelo mecanismo que
 * o projeto já tem: o arquivo vira uma FONTE monitorada, com `ultimo_check`, histórico de runs e
 * o alarme de queda do commit D de graça. Ensinar o crawler a seguir link de paginação genérico
 * custaria orçamento e risco de laço; uma linha em `monitoramento_sites` não custa nenhum dos dois.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { enumeracaoFoiParcial } from "@/lib/server/antt-2026-collector";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const COLETOR = ler("src/lib/server/antt-2026-collector.ts")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
const FIXTURE_ANM = ler("src/lib/server/__tests__/fixtures/anm/atas-da-rop.html");
const MIGRATION = ler("supabase/migrations/20260904130000_anm_arquivo_das_atas.sql");

describe("etapa102 · ANTT: o conhecido não consome mais a cota", () => {
  it("o skip acontece na PRIMEIRA volta — antes de ocupar vaga em meetingLinks", () => {
    const iSkip = COLETOR.indexOf("skipMeetingUrls?.has(link.href)");
    const iSet = COLETOR.indexOf("meetingLinks.set(link.href");
    expect(iSkip, "o skip precisa existir no laço de coleta de links").toBeGreaterThan(-1);
    expect(iSkip).toBeLessThan(iSet);
  });

  it("COMPORTAMENTO: a enumeração se declara parcial pelo total VISTO, não pelo coletado", () => {
    // O caso que a armadilha X4 criaria: teto de 30, 28 pulados por já conhecidos e 2 novos.
    // Contando só os coletados (2 < 30) a enumeração se diria COMPLETA — mentira, porque paramos
    // de olhar ao bater o teto.
    expect(enumeracaoFoiParcial({ filaPendente: 0, coletados: 2, pulados: 28, maxMeetings: 30 })).toBe(true);
    // Sem nada pulado e longe do teto, com a fila vazia: enumeração completa de verdade.
    expect(enumeracaoFoiParcial({ filaPendente: 0, coletados: 2, pulados: 0, maxMeetings: 30 })).toBe(false);
    // Página pendente na fila é parcial, independentemente da contagem (regra da Fase 7).
    expect(enumeracaoFoiParcial({ filaPendente: 1, coletados: 0, pulados: 0, maxMeetings: 30 })).toBe(true);
    // Teto batido só com novos: parcial, como sempre foi.
    expect(enumeracaoFoiParcial({ filaPendente: 0, coletados: 30, pulados: 0, maxMeetings: 30 })).toBe(true);
  });

  it("o coletor USA a função — não recalcula a regra por dentro", () => {
    expect(COLETOR).toMatch(/truncated = enumeracaoFoiParcial\(|enumeracaoFoiParcial\(\{/);
  });
});

describe("etapa102 · ANM: o arquivo de atas vira fonte monitorada", () => {
  it("a fixture REAL tem o «More…» que ninguém seguia — a lacuna é factual", () => {
    expect(FIXTURE_ANM).toMatch(/>More…</);
    expect(FIXTURE_ANM).toContain("/atas-da-rop/atas-reunioes-ordinarias");
  });

  it("a migration cadastra o arquivo com o seletor certo e sem duplicar", () => {
    expect(MIGRATION).toContain("/atas-da-rop/atas-reunioes-ordinarias");
    expect(MIGRATION).toMatch(/a:not\(\.state-published\)/);
    // Idempotente: rodar 2× não cria uma segunda linha. Contra o SQL SEM comentários — o
    // cabeçalho cita "NOT EXISTS por URL" ao explicar, e prosa não prova conduta.
    const codigo = MIGRATION.replace(/^\s*--.*$/gm, " ");
    expect(codigo).toMatch(/NOT EXISTS\s*\(/);
  });

  it("entra na esteira de votos: tipo_fonte de documentos e auto-enfileiramento ligado", () => {
    expect(MIGRATION).toMatch(/documentos_regulatorios/);
    expect(MIGRATION).toMatch(/auto_enfileirar_pdf/);
  });
});
