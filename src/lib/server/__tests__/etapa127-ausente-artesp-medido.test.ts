/**
 * Etapa 127 (Fase 22, commit 2) — MEDIR as ausências da ARTESP antes de mexer.
 *
 * ═══ O sintoma ═══
 * No card do Dashboard, André Isper Rodrigues Barnabé (Diretor-Presidente da ARTESP) aparece com
 * "+48 aus/abst" — dez vezes os outros três. O corpus certificado da ARTESP não tem NENHUMA
 * ausência dele.
 *
 * ═══ A suspeita, com endereço ═══
 * `upload-analysis.ts` (~365-377): para fonte que NÃO nomina voto (ARTESP) o código apaga os
 * baldes `nomes_votacao`, `_contra` e `_abstencao` — e deixa `_ausente` e `_impedido` intactos.
 * As mesmas regexes frouxas, sobre o mesmo texto ruidoso que o próprio código declarou incapaz
 * de nominar voto, continuam gerando linhas "Ausente". O nome do Diretor-Presidente é o que mais
 * aparece em cabeçalhos e assinaturas: é o perfil exato do falso positivo.
 *
 * ═══ O que este teste faz ═══
 * Roda o extrator real nas 6 fixtures da ARTESP e imprime, por documento, os ausentes COM
 * ORIGEM (rótulo × prosa), os impedidos e os presentes. O gabarito passa a declarar
 * `nomes_ausentes` (o que o PDF de fato diz); onde a extração discordar, é aqui que aparece.
 * Não se conserta o que ninguém mediu — e em produção o `docs/qa-fase22.sql` faz o mesmo.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import { extractFields, extractAusentesComOrigem } from "@/lib/server/nlp-extractor";

const FIXTURES = join(__dirname, "fixtures/votos");
const gabarito = JSON.parse(readFileSync(join(FIXTURES, "gabarito.json"), "utf-8")) as {
  docs: Array<{ file: string; agencia_sigla: string; nomes_ausentes?: string[]; nomes_presentes_incluem?: string[] }>;
};
const ARTESP = gabarito.docs.filter((d) => d.agencia_sigla === "ARTESP");

describe("etapa127 · ausências da ARTESP, medidas documento a documento", () => {
  it("há fixtures da ARTESP para medir", () => {
    expect(ARTESP.length).toBeGreaterThanOrEqual(5);
  });

  for (const doc of ARTESP) {
    it(`${doc.file} — os ausentes extraídos são os que o PDF declara`, async () => {
      const { text } = await extractPdfText(readFileSync(join(FIXTURES, doc.file)));
      const f = extractFields(text) as { nomes_votacao_ausente?: string[]; impedimentos?: string[]; nomes_presentes?: string[] };
      const comOrigem = extractAusentesComOrigem(text);
      console.log(`▶ ${doc.file}\n   ausentes=${JSON.stringify(comOrigem)}\n   impedidos=${JSON.stringify(f.impedimentos ?? [])}\n   presentes=${JSON.stringify(f.nomes_presentes ?? [])}`);

      // O refactor é PURO: o balde antigo é exatamente a lista com origem, na mesma ordem.
      expect(f.nomes_votacao_ausente ?? []).toEqual(comOrigem.map((a) => a.nome));

      // O gabarito diz o que o PDF diz. Sem a chave, o documento ainda não foi etiquetado.
      expect(doc.nomes_ausentes, `${doc.file} sem 'nomes_ausentes' no gabarito`).toBeDefined();
      expect(f.nomes_votacao_ausente ?? []).toEqual(doc.nomes_ausentes);

      // Presente E ausente no mesmo documento é a contradição que prova o artefato.
      const presentes = new Set(f.nomes_presentes ?? []);
      const contradicao = (f.nomes_votacao_ausente ?? []).filter((n) => presentes.has(n));
      expect(contradicao, "nome listado como presente virou ausente").toEqual([]);
    }, 30_000);
  }
});
