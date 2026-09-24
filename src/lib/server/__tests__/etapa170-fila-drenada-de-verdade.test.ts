/**
 * Etapa 170 (Fase 31, Bloco 2) — "fila drenada" só quando os QUATRO forem zero.
 *
 * ═══ O defeito, medido em produção ═══
 * O banner disse **"Esteira zero-toque concluída (fila drenada)"** com **8 documentos em
 * `processing`**, carimbados 11:39–11:40, dentro da própria run.
 *
 * Ele era transcrição literal de um booleano sobre o PLANO: `desfecho === "drenou"` ⟸
 * `!res.restantes` ⟸ `deveContinuar` (`esteira-run.ts:93-106`), que decide sobre trabalho
 * relatado / passos pulados / passos não tentados — e nunca leu o banco.
 *
 * E a rota **já media** `upload_jobs.pending` e jogava o número fora: `fila_extracao` viajava na
 * resposta sem um único consumidor. `processing` não era medido em lugar nenhum do caminho quente,
 * e o reaper só toca o que passou de 5 min — um item preso há 40 s ficava num ponto cego onde
 * nenhum reaper o tocava, nenhuma medição o via e nenhum passo o relatava.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  classificarFila, cabecalhoDoEstadoDaFila, medirFila, totalNaFila, emProcessamento,
  REAPER_JANELA_MS, type ContagensDaFila, type DepsDeMedicaoDaFila,
} from "@/lib/server/estado-da-fila";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const fila = (o: Partial<ContagensDaFila> = {}): ContagensDaFila => ({
  pending: 0, jobsProcessing: 0, queued: 0, docsProcessing: 0,
  maisAntigoProcessingMs: null, medicaoFalhou: false, ...o,
});

describe("etapa170 · «drenada» exige os QUATRO em zero", () => {
  it("os quatro zerados → drenada", () => {
    expect(classificarFila(fila())).toBe("drenada");
  });

  it.each([
    ["upload_jobs.pending", { pending: 1 }],
    ["upload_jobs.processing", { jobsProcessing: 1, maisAntigoProcessingMs: 1_000 }],
    ["documentos.queued", { queued: 1 }],
    ["documentos.processing", { docsProcessing: 1, maisAntigoProcessingMs: 1_000 }],
  ] as Array<[string, Partial<ContagensDaFila>]>)(
    "⚠️ %s > 0 já tira a palavra «drenada»", (_n, o) => {
      expect(classificarFila(fila(o))).not.toBe("drenada");
    },
  );

  it("⚠️ o caso REAL: 8 em processing e o resto zero — não é drenada", () => {
    const estado = classificarFila(fila({ docsProcessing: 8, maisAntigoProcessingMs: 40_000 }));
    expect(estado).toBe("entregue_aguardando");
    expect(cabecalhoDoEstadoDaFila(estado, fila({ docsProcessing: 8, maisAntigoProcessingMs: 40_000 })))
      .not.toContain("drenada");
  });
});

describe("etapa170 · a janela do reaper decide entre esperar e ressalvar", () => {
  it("dentro da janela é normal — o reaper ainda nem devia ter agido", () => {
    expect(classificarFila(fila({ docsProcessing: 1, maisAntigoProcessingMs: REAPER_JANELA_MS - 1 })))
      .toBe("entregue_aguardando");
  });

  it("EXATAMENTE na janela ainda é espera — o corte é estrito, e o limite importa", () => {
    expect(classificarFila(fila({ docsProcessing: 1, maisAntigoProcessingMs: REAPER_JANELA_MS })))
      .toBe("entregue_aguardando");
  });

  it("além da janela vira ressalva — aí o reaper falhou", () => {
    expect(classificarFila(fila({ docsProcessing: 1, maisAntigoProcessingMs: REAPER_JANELA_MS + 1 })))
      .toBe("com_ressalva");
  });

  it("⚠️ idade DESCONHECIDA com item em processamento assume o PIOR", () => {
    // Tratar "não sei há quanto tempo" como "é recente" é o mesmo otimismo que produziu o banner
    // mentiroso. Sem carimbo, ressalva.
    expect(classificarFila(fila({ docsProcessing: 1, maisAntigoProcessingMs: null })))
      .toBe("com_ressalva");
  });

  it("a janela é a MESMA do reaper — não uma cópia", () => {
    // `pipeline.ts` importa a constante em vez de repetir `5 * 60_000`. Um banner que fale em
    // "além dos 5min" com outra janela mentiria de um jeito novo.
    const pipeline = semComentarios(ler("src/lib/server/pipeline.ts"));
    expect(pipeline).toMatch(/staleCutoff = new Date\(Date\.now\(\) - REAPER_JANELA_MS\)/);
    expect(pipeline, "o literal voltou").not.toMatch(/Date\.now\(\) - 5 \* 60_000/);
  });
});

describe("etapa170 · ⚠️ medição que FALHOU não é zero", () => {
  it("uma contagem nula marca `medicaoFalhou` e o estado vira «nao_medida»", () => {
    expect(classificarFila(fila({ medicaoFalhou: true }))).toBe("nao_medida");
  });

  it("…mesmo com os quatro contadores parecendo zero — é aí que o engano aconteceria", () => {
    const c = fila({ medicaoFalhou: true });
    expect(totalNaFila(c)).toBe(0);
    expect(classificarFila(c), "leitura falha virou «drenada»").toBe("nao_medida");
    expect(cabecalhoDoEstadoDaFila("nao_medida", c)).not.toContain("drenada");
  });

  it("a guarda mora DENTRO de `classificarFila` — não no chamador", () => {
    // Deixar a checagem do lado de fora reabriria a falha silenciosa por outra porta: bastaria um
    // consumidor esquecer o `if`. A função recebe o flag e decide.
    const c = fila({ medicaoFalhou: true, pending: 5, docsProcessing: 3, maisAntigoProcessingMs: 1 });
    expect(classificarFila(c)).toBe("nao_medida");
  });

  it("`medirFila` propaga a falha de qualquer uma das quatro leituras", async () => {
    for (const qual of ["upload_jobs/pending", "upload_jobs/processing",
                        "documentos_regulatorios/queued", "documentos_regulatorios/processing"]) {
      const deps: DepsDeMedicaoDaFila = {
        contar: async (t, s) => (`${t}/${s}` === qual ? null : 0),
        maisAntigoProcessing: async () => null,
      };
      const c = await medirFila(deps);
      expect(c.medicaoFalhou, `falha em ${qual} passou despercebida`).toBe(true);
    }
  });
});

describe("etapa170 · a medição não paga round-trip à toa, e pega o PIOR carimbo", () => {
  it("sem nada em processamento, a idade nem é consultada", async () => {
    const espiao = vi.fn(async () => null);
    const c = await medirFila({ contar: async () => 0, maisAntigoProcessing: espiao });
    expect(espiao).not.toHaveBeenCalled();
    expect(c.maisAntigoProcessingMs).toBeNull();
  });

  it("⚠️ com dois carimbos, vale o MAIS ANTIGO — não o primeiro nem a média", async () => {
    // Basta UM item preso além da janela para o reaper ter falhado.
    const agora = Date.UTC(2026, 8, 24, 12, 0, 0);
    const c = await medirFila({
      contar: async (_t, s) => (s === "processing" ? 1 : 0),
      maisAntigoProcessing: async (t) =>
        new Date(agora - (t === "upload_jobs" ? 2 * 60_000 : 9 * 60_000)).toISOString(),
    }, agora);
    expect(c.maisAntigoProcessingMs).toBe(9 * 60_000);
    expect(classificarFila(c)).toBe("com_ressalva");
  });

  it("só consulta a tabela que TEM item em processamento", async () => {
    const vistas: string[] = [];
    await medirFila({
      contar: async (t, s) => (t === "documentos_regulatorios" && s === "processing" ? 1 : 0),
      maisAntigoProcessing: async (t) => { vistas.push(t); return null; },
    });
    expect(vistas).toEqual(["documentos_regulatorios"]);
  });
});

describe("etapa170 · o texto não infla o número", () => {
  it("⚠️ «N processamento(s)» conta só o que processa — não soma quem espera vez", () => {
    const c = fila({ pending: 20, queued: 5, docsProcessing: 2, maisAntigoProcessingMs: 1_000 });
    expect(emProcessamento(c)).toBe(2);
    expect(totalNaFila(c)).toBe(27);
    const txt = cabecalhoDoEstadoDaFila("entregue_aguardando", c);
    expect(txt).toContain("2 processamento(s)");
    // Os que esperam vez aparecem em cláusula PRÓPRIA, não somados no mesmo número.
    expect(txt).toContain("25 item(ns) na fila");
    expect(txt, "somou pending+queued no número de «processamento»").not.toContain("27 processamento");
  });

  it("«drenada» mantém o texto ORIGINAL, byte a byte", () => {
    // A tarefa não é escrever bonito: é parar de dizer essa frase quando ela é falsa.
    expect(cabecalhoDoEstadoDaFila("drenada", fila())).toBe("Esteira zero-toque concluída (fila drenada)");
  });

  it("os quatro estados têm texto próprio, e nenhum repete o outro", () => {
    const c = fila({ docsProcessing: 1, maisAntigoProcessingMs: 1 });
    const textos = (["drenada", "entregue_aguardando", "com_ressalva", "nao_medida"] as const)
      .map((e) => cabecalhoDoEstadoDaFila(e, c));
    expect(new Set(textos).size).toBe(4);
    for (const t of textos) expect(t.length).toBeGreaterThan(20);
  });
});

describe("etapa170 · a fiação: o número passou a ter consumidor", () => {
  const ROTA = semComentarios(ler("src/app/api/v1/pipeline/run/route.ts"));
  const TELA = semComentarios(ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx"));

  it("⚠️ a rota mede e PUBLICA — `fila_extracao` ficou 3 fases sem consumidor", () => {
    expect(ROTA).toMatch(/await medirFila\(/);
    expect(ROTA).toMatch(/fila_final:/);
  });

  it("mede só quando a rodada vai DECLARAR fim — numa que pede outra, seria desperdício", () => {
    expect(ROTA).toMatch(/const filaFinal = restantes\s*\?\s*null\s*:\s*await medirFila\(/);
  });

  it("⚠️ a rota não faz `count ?? 0` no caminho de erro — isso reabriria a falha silenciosa", () => {
    expect(ROTA).toMatch(/return error \? null : count \?\? 0;/);
  });

  it("⚠️ e a TELA consome — sem isso o banner continuaria transcrevendo o booleano do plano", () => {
    expect(TELA).toMatch(/cabecalhoDoEstadoDaFila\(classificarFila\(filaFinal\), filaFinal\)/);
    // A frase antiga não pode mais ser incondicional no ramo "drenou".
    expect(TELA).not.toMatch(/desfecho === "drenou"\s*\n?\s*\? "Esteira zero-toque concluída/);
  });
});
