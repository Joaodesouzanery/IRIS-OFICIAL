/**
 * Etapa 55 — ANTT: CARGO não é PESSOA.
 *
 * `DG` estava na tabela de iniciais apontando para um nome FIXO. "DG" é a sigla do cargo
 * Diretor-Geral: com o mapa fixo, TODO "Voto DG" era gravado no mesmo diretor para sempre —
 * inclusive depois da troca de diretoria, e inclusive quando quem assinava era o Diretor-Geral
 * SUBSTITUTO. O voto do substituto virava voto do titular, e o do titular novo virava do antigo.
 *
 * Agora o cargo é resolvido por EVIDÊNCIA, em cascata: nome no próprio texto → cargo exercido
 * declarado → mandato vigente na data. Esgotada a cascata, o documento vai para revisão SEM autor.
 *
 * Depende da etapa49: sem o conserto da ligadura, "substituto" chega como "subs7tuto" e a fórmula
 * de cargo exercido não casa.
 *
 * NOTA DE COBERTURA: `antt-ata-1024.pdf`, `antt-ata-264-rde.pdf` e `antt-voto-dab-002.pdf`
 * dependem da Fase 0. O binário disponível (`antt-pauta-1036.pdf`) é usado como guard de
 * não-regressão; os casos de cargo usam trechos literais da estrutura medida.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import {
  parseAnttManualDocument,
  setAnttCargoMandatos,
  resolveCargoPorMandato,
} from "@/lib/server/antt-manual-parser";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");

const CORPO_VOTO =
  "\nPROCESSO: 50500.123456/2026-11\n" +
  "INTERESSADO: Concessionária Rodovias S.A.\n" +
  "Diante do exposto, VOTO por conhecer do recurso e, no mérito, dar provimento ao pedido.\n";

beforeEach(() => setAnttCargoMandatos({}));

describe("etapa55 · «DG» é cargo e não resolve para nome fixo", () => {
  it("sem NENHUMA evidência, o voto DG fica SEM autor — e avisa", () => {
    const r = parseAnttManualDocument(`VOTO DG 012/2026${CORPO_VOTO}`, "Voto DG 012-2026.pdf");
    expect(r.fields.relator ?? null).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/apenas o CARGO/i);
    // O ponto todo: não pode sair um nome inventado.
    expect(r.warnings.join(" ")).not.toMatch(/Guilherme Sampaio/);
  });

  it("o documento dizendo QUEM exercia o cargo resolve — inclusive o SUBSTITUTO", () => {
    const r = parseAnttManualDocument(
      `VOTO DG 012/2026\nApresentado na condição de Diretor-Geral substituto, Alessandro Baumgartner.${CORPO_VOTO}`,
      "Voto DG 012-2026.pdf",
    );
    expect(r.fields.relator).toMatch(/Alessandro Baumgartner/);
  });

  it("mandato vigente na data resolve quando o texto não diz", () => {
    setAnttCargoMandatos({
      "diretor-geral": [
        { nome: "Guilherme Sampaio", inicio: "2020-01-01", fim: "2025-12-31" },
        { nome: "Lucas Asfor", inicio: "2026-01-01", fim: null },
      ],
    });
    expect(resolveCargoPorMandato("diretor-geral", "2026-07-01")).toBe("Lucas Asfor");
    expect(resolveCargoPorMandato("diretor-geral", "2024-07-01")).toBe("Guilherme Sampaio");
  });

  it("DOIS mandatos vigentes na mesma data → nenhum: escolher seria o erro que a etapa corrige", () => {
    setAnttCargoMandatos({
      "diretor-geral": [
        { nome: "A A", inicio: "2026-01-01", fim: null },
        { nome: "B B", inicio: "2026-02-01", fim: null },
      ],
    });
    expect(resolveCargoPorMandato("diretor-geral", "2026-07-01")).toBeNull();
  });

  it("sem data não há mandato aplicável — nunca pega «o atual»", () => {
    setAnttCargoMandatos({ "diretor-geral": [{ nome: "A A", inicio: "2020-01-01", fim: null }] });
    expect(resolveCargoPorMandato("diretor-geral", null)).toBeNull();
  });
});

describe("etapa55 · códigos de PESSOA seguem funcionando", () => {
  it("«DGS» é pessoa (D+Guilherme+Sampaio), não cargo", () => {
    const r = parseAnttManualDocument(`VOTO DGS 012/2026${CORPO_VOTO}`, "Voto DGS 012-2026.pdf");
    expect(r.fields.relator).toMatch(/Guilherme Sampaio/);
  });

  it("«DAB» continua resolvendo, com o aviso de só-iniciais preservado", () => {
    const r = parseAnttManualDocument(`VOTO DAB 002/2026${CORPO_VOTO}`, "Voto DAB 002-2026.pdf");
    expect(r.fields.relator).toMatch(/Alessandro Baumgartner/);
    expect(r.warnings.join(" ")).toMatch(/SÓ pelas iniciais/i);
  });
});

describe("etapa55 · fronteira das iniciais (o `\\b` de JS é ASCII)", () => {
  it("«VOTO JOSÉ FERNANDO…» NÃO vira iniciais «JOS»", () => {
    // Em JS, `\b` só conhece [A-Za-z0-9_]: "É" contava como fronteira e o nome era truncado em
    // três letras, que então caíam no ramo de "iniciais desconhecidas".
    const r = parseAnttManualDocument(
      `VOTO JOSÉ FERNANDO DE MENDONÇA GOMES JÚNIOR${CORPO_VOTO}`,
      "Voto.pdf",
    );
    expect(r.warnings.join(" ")).not.toMatch(/"JOS"/);
  });

  it("sigla seguida de acento não é sigla", () => {
    const r = parseAnttManualDocument(`VOTO ANA PAULA SILVA${CORPO_VOTO}`, "Voto.pdf");
    expect(r.warnings.join(" ")).not.toMatch(/"ANA"/);
  });
});

describe("etapa55 · guard de não-regressão no binário disponível", () => {
  it("a pauta 1036 da ANTT continua sendo lida como antes", async () => {
    const { text } = await extractPdfText(readFileSync(join(fixturesDir, "antt-pauta-1036.pdf")));
    const r = parseAnttManualDocument(text, "antt-pauta-1036.pdf");
    expect(r.isAntt).toBe(true);
    expect(r.documentType).not.toBe("voto_individual");
  }, 60_000);
});
