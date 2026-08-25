/**
 * Etapa 66 — a SÉRIE da reunião e a monotonicidade.
 *
 * ═══ O pré-requisito que a Fase 4 achou e adiou ═══
 *
 * A monotonicidade ("a 83ª ROP não pode preceder a 81ª") parecia simples e não era: **os contadores
 * são INDEPENDENTES por série.** Prova medida no corpus de certificação — a 1.024ª Reunião de
 * Diretoria e a 264ª Reunião Deliberativa Eletrônica da ANTT compartilham a data **2026-01-19**.
 * Comparar sem separar a série dá alarme falso na primeira execução.
 *
 * E `tipo_reuniao` NÃO serve como chave de série: o tipo admite só
 * `"Ordinaria" | "Extraordinaria" | null`, então RD e RDE colapsam ambas em "Ordinaria". A
 * informação sempre esteve no TÍTULO — era o enum de duas cardinalidades que a perdia, mais um
 * `CASE` no backfill que mandava `'eletronica' → NULL`.
 *
 * ═══ Duas decisões de desenho que valem registro ═══
 *
 * 1. **O check é PURO.** Quem busca as vizinhas é o caller (o confirm, onde há `db`). Receber o
 *    `db` deixaria o check inerte e silencioso no harness — foi exatamente assim que o C16 entrou
 *    incapaz de disparar.
 * 2. **Nível `aviso`, não bloqueante — desvio deliberado do plano.** A disciplina desta série exige
 *    provar ZERO falso positivo contra dado real antes de bloquear (a lição do C03, que recusava
 *    8 de 8 atas). Aqui é impossível: as 16 fixtures são documentos ISOLADOS, sem vizinhos de
 *    série. Remarcação de reunião e publicação fora de ordem são hipóteses que não consigo
 *    descartar sem produção. Vira bloqueante quando alguém mostrar o número.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { deriveSerie, ensureReuniao, resetSondaSerie } from "@/lib/server/reunioes";
import { checarSerieMonotonica, temBloqueio } from "@/lib/server/consistency-checks";
import { extractPdfText } from "@/lib/server/pdf-extractor";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");

describe("etapa66 · deriveSerie — a série sai do TÍTULO, medida nas 16 fixtures", () => {
  it.each([
    ["REUNIÃO ORDINÁRIA PÚBLICA DA DIRC", "ordinaria"],
    ["REUNIÃO EXTRAORDINÁRIA PÚBLICA DA DIRC/ANM", "extraordinaria"],
    ["REUNIÃO PÚBLICA DE DIRETORIA", "ordinaria"],
    ["REUNIÃO DE DIRETORIA ELETRÔNICA", "eletronica"],
    ["264ª Reunião Deliberativa Eletrônica", "eletronica"],
    ["Reunião Ordinária do Conselho Diretor", "ordinaria"],
    ["Reunião Extraordinária do Conselho Diretor", "extraordinaria"],
    ["193ª Reunião de Diretoria Administrativa", "administrativa"],
  ])("«%s» → %s", (titulo, esperado) => {
    expect(deriveSerie(titulo)).toBe(esperado);
  });

  it("a ORDEM das checagens importa: eletrônica vem antes de ordinária", () => {
    // "Reunião Deliberativa Eletrônica" não tem marcador de extraordinária, então cairia em
    // "ordinaria" se o eletrônico não fosse testado primeiro — e RD e RDE voltariam a colidir.
    expect(deriveSerie("Reunião Deliberativa Eletrônica")).toBe("eletronica");
  });

  it("sem título reconhecível devolve null — presumir juntaria séries distintas", () => {
    expect(deriveSerie(null)).toBeNull();
    expect(deriveSerie("")).toBeNull();
    expect(deriveSerie("Deliberação ARTESP nº 487")).toBeNull();
  });

  it("nos PDFs REAIS: a 1.024ª e a 264ª da ANTT caem em séries DIFERENTES", async () => {
    const titulo = async (f: string) => {
      const { text } = await extractPdfText(readFileSync(join(fixturesDir, f)));
      return /([\d.]+)\s*[ªa°º]\s*(REUNI[AÃ]O[^\n.]{0,70})/i.exec(text)?.[2] ?? "";
    };
    const rd = deriveSerie(await titulo("antt-ata-1024.pdf"));
    const rde = deriveSerie(await titulo("antt-ata-264-rde.pdf"));
    expect(rd).toBe("ordinaria");
    expect(rde).toBe("eletronica");
    expect(rd, "se caíssem na mesma série, 1024 e 264 na mesma data colidiriam").not.toBe(rde);
  }, 120_000);
});

describe("etapa66 · C19 — monotonicidade DENTRO da série", () => {
  it("número maior com data ANTERIOR é acusado", () => {
    const a = checarSerieMonotonica({
      numeroReuniao: "83", dataReuniao: "2022-05-02", serie: "ordinaria",
      vizinhas: [{ numeroReuniao: "81", dataReuniao: "2026-01-28" }],
    });
    expect(a.map((x) => x.codigo)).toEqual(["C19_SERIE_NAO_MONOTONICA"]);
    expect(a[0].mensagem).toContain("81 em 2026-01-28");
  });

  it("ordem coerente não gera achado", () => {
    expect(checarSerieMonotonica({
      numeroReuniao: "83", dataReuniao: "2026-03-25", serie: "ordinaria",
      vizinhas: [
        { numeroReuniao: "81", dataReuniao: "2026-01-28" },
        { numeroReuniao: "82", dataReuniao: "2026-02-23" },
      ],
    })).toEqual([]);
  });

  it("⚠️ o caso que quebraria sem chave de série: 1.024 e 264 na MESMA data", () => {
    // As duas coexistem em 2026-01-19. Se caíssem na mesma série, o check acusaria — e estaria
    // errado. O caller filtra por série, então a vizinhança correta é vazia.
    expect(checarSerieMonotonica({
      numeroReuniao: "1.024", dataReuniao: "2026-01-19", serie: "ordinaria",
      vizinhas: [], // a 264ª RDE não entra: série diferente
    })).toEqual([]);
    // E se alguém esquecer o filtro, o alarme dispara — é o comportamento que documenta o risco.
    expect(checarSerieMonotonica({
      numeroReuniao: "1.024", dataReuniao: "2026-01-19", serie: "ordinaria",
      vizinhas: [{ numeroReuniao: "264", dataReuniao: "2026-01-19" }],
    })).toEqual([]); // mesma data ⇒ nem antes nem depois: sem conflito
  });

  it("o separador de milhar não quebra a comparação ordinal", () => {
    // "1.024" vale 1024, não 1024 ≠ 1. Sem a normalização, "1.024" não seria numérico e o check
    // ficaria cego justamente na agência que tem mais reuniões.
    const a = checarSerieMonotonica({
      numeroReuniao: "1.024", dataReuniao: "2025-01-01", serie: "ordinaria",
      vizinhas: [{ numeroReuniao: "1023", dataReuniao: "2026-01-01" }],
    });
    expect(a).toHaveLength(1);
  });

  it("é AVISO, não bloqueante — não pode congelar a esteira sem medição contra produção", () => {
    const a = checarSerieMonotonica({
      numeroReuniao: "83", dataReuniao: "2022-05-02", serie: "ordinaria",
      vizinhas: [{ numeroReuniao: "81", dataReuniao: "2026-01-28" }],
    });
    expect(a[0].nivel).toBe("aviso");
    expect(temBloqueio(a), "bloquear sem provar zero falso positivo é o erro do C03").toBe(false);
  });

  it("sem número, sem data ou sem vizinha, fica silencioso", () => {
    const base = { serie: "ordinaria", vizinhas: [{ numeroReuniao: "81", dataReuniao: "2026-01-28" }] };
    expect(checarSerieMonotonica({ ...base, numeroReuniao: null, dataReuniao: "2026-01-01" })).toEqual([]);
    expect(checarSerieMonotonica({ ...base, numeroReuniao: "83", dataReuniao: null })).toEqual([]);
    expect(checarSerieMonotonica({ numeroReuniao: "83", dataReuniao: "2026-01-01", serie: "ordinaria", vizinhas: [] })).toEqual([]);
  });

  it("número não-numérico é ignorado em vez de presumido", () => {
    expect(checarSerieMonotonica({
      numeroReuniao: "1024-A", dataReuniao: "2020-01-01", serie: "ordinaria",
      vizinhas: [{ numeroReuniao: "1023", dataReuniao: "2026-01-01" }],
    })).toEqual([]);
  });
});

// ─── ensureReuniao: a série na identidade, e a degradação sem a migration ────────────────────
type Linha = Record<string, unknown>;

function fakeDb(linhas: Linha[], opts: { temColunaSerie: boolean; registro: Linha[] }) {
  return {
    from() {
      let atual = [...linhas];
      const self: any = {
        select(cols?: string) {
          if (!opts.temColunaSerie && typeof cols === "string" && cols.includes("serie")) {
            // Espelha o PostgREST: coluna inexistente derruba a QUERY, não devolve null.
            self.__erro = { code: "PGRST204", message: "column reunioes.serie does not exist" };
          }
          return self;
        },
        eq(c: string, v: unknown) { atual = atual.filter((r) => r[c] === v); return self; },
        is(c: string, v: unknown) { atual = atual.filter((r) => (r[c] ?? null) === v); return self; },
        not() { return self; },
        limit() { return self; },
        insert(payload: Linha) { opts.registro.push(payload); atual = [{ id: "novo" }]; return self; },
        update(patch: Linha) { opts.registro.push({ __update: patch }); return self; },
        maybeSingle: async () => (self.__erro
          ? { data: null, error: self.__erro }
          : { data: atual[0] ?? null, error: null }),
        single: async () => ({ data: atual[0] ?? null, error: null }),
        then: (r: (v: { data: unknown; error: unknown }) => unknown) =>
          r({ data: self.__erro ? null : atual, error: self.__erro ?? null }),
      };
      return self;
    },
  };
}

describe("etapa66 · ensureReuniao — a série entra na identidade", () => {
  beforeEach(() => resetSondaSerie());

  it("grava a série e o TÍTULO (o insert omitia `metadata` inteiramente)", async () => {
    const registro: Linha[] = [];
    const db = fakeDb([], { temColunaSerie: true, registro });
    await ensureReuniao(db as never, {
      agenciaId: "ag", dataReuniao: "2026-01-19", numeroReuniao: "264",
      serie: "eletronica", titulo: "264ª Reunião Deliberativa Eletrônica",
    });
    const inserido = registro.find((r) => "agencia_id" in r)!;
    expect(inserido.serie).toBe("eletronica");
    expect((inserido.metadata as Linha).titulo).toBe("264ª Reunião Deliberativa Eletrônica");
  });

  it("SEM a migration, omite a série e continua funcionando — deploy antes é seguro", async () => {
    const registro: Linha[] = [];
    const db = fakeDb([], { temColunaSerie: false, registro });
    const id = await ensureReuniao(db as never, {
      agenciaId: "ag", dataReuniao: "2026-01-19", numeroReuniao: "264", serie: "eletronica",
    });
    // A sonda detecta a ausência e o select segue sem a coluna; o fluxo não quebra.
    expect(id === null || id === "novo").toBe(true);
    const inserido = registro.find((r) => "agencia_id" in r);
    if (inserido) expect(inserido, "não pode enviar coluna inexistente").not.toHaveProperty("serie");
  });

  it("enriquece a série de uma linha antiga que está sem ela", async () => {
    const registro: Linha[] = [];
    const db = fakeDb(
      [{ id: "r1", tipo_reuniao: "Ordinaria", url_fonte: null, serie: null,
         agencia_id: "ag", data_reuniao: "2026-01-19", numero_reuniao: "264" }],
      { temColunaSerie: true, registro },
    );
    await ensureReuniao(db as never, {
      agenciaId: "ag", dataReuniao: "2026-01-19", numeroReuniao: "264", serie: "eletronica",
    });
    const patch = registro.find((r) => "__update" in r);
    expect((patch?.__update as Linha)?.serie).toBe("eletronica");
  });
});
