/**
 * Etapa 152 (Fase 28, commit 6) — a prosa diz o tamanho REAL da certificação.
 *
 * ═══ Por que isto é um teste e não uma correção de texto ═══
 * "46 expectativas" estava em SEIS lugares do repositório (CLAUDE.md, MODULO-VOTOS-EXTRACAO,
 * consistency-checks, amostra-auditoria, etapa113, etapa124), e o número real é 164 em 16
 * documentos. O corpus cresceu de 6 para 16 PDFs em fases anteriores e a prosa ficou parada —
 * ninguém percebeu, porque nada liga o texto ao dado.
 *
 * Não é tautológico: a fonte da verdade é o GABARITO, o alvo é a PROSA, e a regra de contagem é a
 * do próprio harness (`vote-certification.test.ts`), replicada aqui. A mutação que ele mata é a
 * que ninguém lembra de evitar: acrescentar um documento ao corpus e deixar a doc mentindo.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const gabarito = JSON.parse(
  readFileSync(join(__dirname, "fixtures/votos/gabarito.json"), "utf-8"),
) as { docs: Array<Record<string, unknown>> };

/** As chaves que o harness asserta UMA vez cada (`vote-certification.test.ts`). */
const UMA_ASSERCAO = [
  "agencia_sigla", "tipo_documento", "data_reuniao", "numero_deliberacao_contem", "resultado",
  "unanimidade_detectada", "import_counts_as_final", "nomes_contra", "sem_votos",
  "ata_items_min", "itens_unanimidade_min",
];
/** …e as que ele asserta UMA VEZ POR ELEMENTO do array. */
const UMA_POR_ELEMENTO = [
  "nomes_presentes_incluem", "nomes_contra_nao_incluem", "resultado_nao_pode_ser",
  "texto_contem", "texto_nao_contem",
];

function expectativasDoGabarito(): number {
  let total = 0;
  for (const doc of gabarito.docs) {
    let n = 1; // o `expect(preview.status).not.toBe("error")`, que roda para todo documento
    for (const k of UMA_ASSERCAO) if (doc[k] !== undefined) n++;
    for (const k of UMA_POR_ELEMENTO) if (Array.isArray(doc[k])) n += (doc[k] as unknown[]).length;
    total += n;
  }
  return total;
}

describe("etapa152 · o número na prosa vem do gabarito, não da memória de quem escreveu", () => {
  const total = expectativasDoGabarito();

  it("a contagem replicada bate com o scorecard do harness (164 em 16 documentos)", () => {
    expect(gabarito.docs.length).toBe(16);
    expect(total).toBe(164);
  });

  it.each([
    "CLAUDE.md",
    "docs/MODULO-VOTOS-EXTRACAO.md",
    "src/lib/server/consistency-checks.ts",
    "src/lib/server/amostra-auditoria.ts",
    "src/lib/server/__tests__/etapa113-pauta-nao-vira-ata.test.ts",
    "src/lib/server/__tests__/etapa124-predicados-medidos.test.ts",
  ])("%s declara o número certo", (arquivo) => {
    const texto = readFileSync(join(RAIZ, arquivo), "utf-8");
    expect(texto, `${arquivo} cita a certificação`).toMatch(/certifica|vote-certification|expectativas/i);
    expect(texto, `${arquivo} ainda diz 46`).not.toMatch(/\b46 expectativas\b|\b46\/46\b/);
    expect(texto, `${arquivo} devia dizer ${total}`).toMatch(new RegExp(`\\b${total}\\b`));
  });

  it("o histórico em PENDENCIAS NÃO é reescrito — 'passou de 46 para' é verdade", () => {
    const p = readFileSync(join(RAIZ, "docs/PENDENCIAS.md"), "utf-8");
    expect(p).toMatch(/passou de \*\*46 expectativas em 6 documentos\*\* para/);
  });
});

describe("etapa152 · a METODOLOGIA declara o que a certificação NÃO cobre", () => {
  const metodologia = readFileSync(join(RAIZ, "docs/METODOLOGIA-METRICAS.md"), "utf-8");

  it("os três campos sem cobertura estão nomeados", () => {
    expect(metodologia).toMatch(/## 8\. O que a CERTIFICAÇÃO cobre/);
    for (const campo of ["relator", "processo", "interessado"]) {
      expect(metodologia, `§8 não nomeia ${campo}`).toMatch(new RegExp(`\`${campo}\``));
    }
    expect(metodologia).toMatch(/todo o ritual passa verde/);
  });

  it("e o gabarito REALMENTE não os cobre — a doc não pode virar verdade por decreto", () => {
    const chaves = new Set(gabarito.docs.flatMap((d) => Object.keys(d)));
    for (const campo of ["relator", "processo", "interessado"]) {
      expect(chaves.has(campo), `gabarito passou a cobrir ${campo} — atualizar §8`).toBe(false);
    }
  });

  it("`nomes_ausentes` está no gabarito e o harness não o asserta — registrado, não escondido", () => {
    const comAusentes = gabarito.docs.filter((d) => Array.isArray(d.nomes_ausentes)).length;
    expect(comAusentes).toBeGreaterThan(0);
    const harness = readFileSync(join(__dirname, "vote-certification.test.ts"), "utf-8");
    expect(harness).not.toMatch(/doc\.nomes_ausentes/);
    expect(metodologia).toMatch(/`nomes_ausentes` está no gabarito de \d+\s*\n?documentos e o harness \*\*nunca o asserta\*\*/);
  });
});

describe("etapa152 · `processo` ganhou o instrumento que a doc diz existir", () => {
  it("a amostra de auditoria seleciona e publica `processo`", () => {
    const rota = readFileSync(join(RAIZ, "src/app/api/v1/admin/auditoria/amostra/route.ts"), "utf-8");
    expect(rota).toMatch(/data_reuniao, interessado, processo, raw_extraction/);
    expect(rota).toMatch(/processo: d\.processo \?\? null/);
  });

  it("…e a tela o mostra — número publicado sem leitor não conta como entregue", () => {
    const tela = readFileSync(join(RAIZ, "src/app/dashboard/deliberacoes/votos-diretores/page.tsx"), "utf-8");
    expect(tela).toMatch(/processo: \{it\.processo \?\? "—"\}/);
  });
});
