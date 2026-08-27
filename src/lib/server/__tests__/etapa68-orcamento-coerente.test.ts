/**
 * Etapa 68 (Fase 7) — orçamento coerente, ordem da rodada, e fim do ping-pong.
 *
 * ═══ O bug ═══
 * Cada sub-rota decide quanto saldo precisa para começar uma unidade de trabalho. O orquestrador
 * decidia, por LITERAIS separados, quanto exigir antes de chamá-la — e em três passos o número do
 * orquestrador era MENOR que a reserva da sub-rota:
 *   coleta        fatia  8s × reserva 25s  → inseria ZERO itens por rodada
 *   auto-confirm  gate  14s × reserva 15s  → devolvia `restantes` sem confirmar nada
 *   confirm-lote  gate  11s × reserva 15s  → idem
 * O passo rodava, gastava o round-trip de autenticação e voltava vazio — sem erro nenhum. É a
 * explicação de "174 PDF(s) extraído(s) · 0 materializado(s)".
 *
 * ═══ Por que um teste TABULAR ═══
 * Consertar os três números resolveria as três instâncias de hoje. O teste abaixo percorre TODOS
 * os passos e falha se QUALQUER gate ficar abaixo da reserva correspondente — mata a classe.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  RESERVA,
  TETO_FATIA,
  fatiaDoPasso,
  podeRodar,
  gateDoPasso,
  FOLGA_ORQUESTRADOR_MS,
  type PassoEsteira,
} from "@/lib/server/esteira-reservas";
import { HOBBY_BUDGET_MS } from "@/lib/server/time-budget";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const PIPELINE = ler("src/app/api/v1/pipeline/run/route.ts");

describe("etapa68 · o gate NUNCA pode ser menor que a reserva (a classe do bug)", () => {
  const passos = Object.keys(RESERVA) as PassoEsteira[];

  it.each(passos)("gate de «%s» ≥ reserva de «%s»", (passo) => {
    expect(gateDoPasso(passo)).toBeGreaterThanOrEqual(RESERVA[passo]);
  });

  it("o gate inclui folga para o round-trip de auth e o flush da resposta", () => {
    expect(FOLGA_ORQUESTRADOR_MS).toBeGreaterThan(0);
    for (const p of passos) expect(gateDoPasso(p)).toBe(RESERVA[p] + FOLGA_ORQUESTRADOR_MS);
  });

  it("todo passo cabe, sozinho, no orçamento real de uma rodada", () => {
    // Um passo cuja reserva não cabe em HOBBY_BUDGET_MS jamais rodaria — seria código morto
    // silencioso, o mesmo sintoma por outra causa.
    for (const p of passos) {
      expect(gateDoPasso(p), `«${p}» não caberia numa rodada de ${HOBBY_BUDGET_MS}ms`).toBeLessThanOrEqual(HOBBY_BUDGET_MS);
    }
  });

  it("a soma das reservas NÃO cabe numa rodada — por isso a ordem importa", () => {
    // Este teste documenta a razão de existir a reordenação: não é possível fazer tudo numa
    // rodada, então o que vier por último é o que fica sem orçamento. Se um dia a soma couber,
    // a reordenação deixa de ser necessária e alguém deve revisitar este arquivo.
    const soma = passos.reduce((s, p) => s + RESERVA[p], 0);
    expect(soma).toBeGreaterThan(HOBBY_BUDGET_MS);
  });
});

describe("etapa68 · o orquestrador não usa mais literais de tempo", () => {
  it("os gates vêm do PLANO da rodada, a mesma fonte que calcula a fatia", () => {
    // Antes o portão (`gateDoPasso`) e a fatia (`maxSliceMs`, opcional) eram decididos
    // separadamente — e foi a divergência entre os dois que produziu as duas metades do bug.
    expect(PIPELINE).toContain("podeRodar");
    expect(PIPELINE).toContain("planejarRodada");
    expect(PIPELINE).toContain("@/lib/server/esteira-reservas");
  });

  it("os literais que causavam o descompasso sumiram", () => {
    // 8_000 como FATIA da coleta (contra reserva de 25s), e os gates de 14s/11s da aprovação.
    expect(PIPELINE).not.toMatch(/undefined,\s*8_000\)/);
    expect(PIPELINE).not.toMatch(/hasBudget\(deadlineAt,\s*14_000\)/);
    expect(PIPELINE).not.toMatch(/hasBudget\(deadlineAt,\s*11_000\)/);
  });

  it("a coleta recebe uma fatia do tamanho da reserva dela", () => {
    // Fase 10 — a fatia deixou de ser passada à mão em cada sítio: o passo se identifica e
    // `fatiaDoPasso` a calcula. Para a coleta o número é o mesmo (TETO_FATIA.coleta === a reserva),
    // e agora ele não pode divergir do portão, porque os dois saem da mesma função.
    expect(PIPELINE).toMatch(/monitoramento\/check",\s*"coleta"/);
    expect(TETO_FATIA.coleta).toBe(RESERVA.coleta);
  });
});

describe("etapa68 · APROVAR antes de INGERIR", () => {
  const pos = (marcador: string) => PIPELINE.indexOf(marcador);

  it("aprovação vem antes da coleta e da extração", () => {
    const autoConfirm = pos('"/api/v1/upload/auto-confirm"');
    const confirmLote = pos('"/api/v1/upload/confirm-lote"');
    const coleta = pos('"/api/v1/monitoramento/check"');
    const enqueue = pos('"/api/v1/deliberacoes/enqueue-pdfs"');
    for (const [nome, i] of [["auto-confirm", autoConfirm], ["confirm-lote", confirmLote]] as const) {
      expect(i, `${nome} não encontrado`).toBeGreaterThan(-1);
      expect(i, `${nome} precisa vir ANTES da coleta`).toBeLessThan(coleta);
      expect(i, `${nome} precisa vir ANTES do enfileiramento`).toBeLessThan(enqueue);
    }
  });

  it("o requeue em série ganhou checagem de saldo", () => {
    // Eram até 50 requeueDocument, 3 round-trips cada, sem NENHUM controle: quando tinha alvo,
    // consumia a rodada e todos os gates seguintes falhavam.
    expect(PIPELINE).toMatch(/for \(const d of alvo\)[\s\S]{0,200}?hasBudget\(deadlineAt/);
  });
});

describe("etapa68 · fim do ping-pong aprovar↔desarquivar", () => {
  it("a recuperação de ignorados não roda na rodada que acabou de arquivar", () => {
    expect(PIPELINE).toMatch(/const arquivouAgora\s*=/);
    expect(PIPELINE).toMatch(/arquivouAgora === 0 && cabe\("recuperacao"\)/);
  });

  it("quando adia, ela DIZ que adiou — não some em silêncio", () => {
    expect(PIPELINE).toMatch(/adiado_por_arquivamento_nesta_rodada/);
  });
});

describe("etapa68 · as métricas derivadas saíram de trás do !restantes", () => {
  it("rodam quando a rodada materializou algo, mesmo com fila restante", () => {
    expect(PIPELINE).toMatch(/const materializouAgora\s*=/);
    expect(PIPELINE).toMatch(/if \(materializouAgora > 0 \|\| !restantes\)/);
  });

  it("o gate antigo `if (!restantes)` envolvendo as derivadas não existe mais", () => {
    // A condição isolada era o que impedia Empresas/Qualidade/Mandatos/Divergência de rodarem em
    // TODA rodada que fizesse trabalho de verdade — e é por isso que o Observatório não se movia.
    const iDerivadas = PIPELINE.indexOf("empresas_backfill");
    const trechoAntes = PIPELINE.slice(Math.max(0, iDerivadas - 1500), iDerivadas);
    expect(trechoAntes).not.toMatch(/if \(!restantes\) \{/);
  });

  it("a rodada reporta quanto materializou — a medição vai junto", () => {
    expect(PIPELINE).toMatch(/materializados_nesta_rodada: materializouAgora/);
  });
});

describe("etapa68 · as sub-rotas leem a MESMA reserva", () => {
  it.each([
    ["src/lib/server/monitoring-runner.ts", "RESERVA.coleta"],
    ["src/app/api/v1/upload/auto-confirm/route.ts", "RESERVA.autoConfirm"],
    ["src/app/api/v1/upload/confirm-lote/route.ts", "RESERVA.confirmLote"],
    ["src/app/api/v1/deliberacoes/enqueue-pdfs/route.ts", "RESERVA.enqueue"],
  ])("%s usa %s", (arquivo, simbolo) => {
    const fonte = ler(arquivo);
    expect(fonte).toContain(simbolo);
    expect(fonte).toContain("@/lib/server/esteira-reservas");
  });
});

describe("etapa68 · as sub-rotas que ignoravam budget_ms passam a honrá-lo", () => {
  it("recompute deixa de assumir 50s inteiros", () => {
    const fonte = ler("src/app/api/v1/admin/diretores/candidatos/recompute/route.ts");
    expect(fonte).toMatch(/const deadlineAt = Date\.now\(\) \+ budgetFromRequest\(req\)/);
  });

  it("dedup ganhou orçamento e para entre grupos", () => {
    const fonte = ler("src/app/api/v1/admin/deliberacoes/dedup/route.ts");
    expect(fonte).toMatch(/budgetFromRequest\(req\)/);
    expect(fonte).toMatch(/hasBudget\(deadlineAt, 4_000\)[\s\S]{0,60}?parcial = true/);
  });
});
