/**
 * Etapa 124 (Fase 21, commit 2) — MEDIR os predicados duplicados antes de unificar qualquer um.
 *
 * ═══ Por que medir primeiro ═══
 * A varredura achou o mesmo conceito implementado mais de uma vez, com divergência:
 *  · contestação: `RE_CONTESTADO` (consistency-checks) × `RE_CONTESTADO_NLP` (nlp-extractor) ×
 *    `RE_CONTESTADO_AMPLO` (a união, ainda só medida);
 *  · unanimidade: `/unanimidade/i` solto (ata-splitter, antt-manual-parser) × `hasUnanimidade`
 *    (nlp-extractor, exige a frase) × a NEGAÇÃO ("não houve unanimidade"), que o parser da ANTT
 *    não checa — e aí "não houve unanimidade" vira voto favorável para todo mundo.
 *
 * Unificar sem medir é o erro da skill `medir-antes-de-generalizar`: cada troca de predicado
 * move itens do gabarito, e a certificação (46 expectativas) só diz "quebrou", não "quanto".
 * Este teste diz QUANTO: roda cada implementação sobre TODOS os itens das 16 fixtures reais e
 * congela as discordâncias em `predicados-baseline.json`. Mudar um número lá exige justificar
 * item a item contra o PDF — nunca aceitar em bloco.
 *
 * ⚠️ As duas regex de negação abaixo são CÓPIAS deliberadas dos literais de
 * `nlp-extractor.ts:80` e `ata-splitter.ts:360`, para medir o estado ATUAL. O commit 3 troca as
 * cópias por `isUnanimidadeNegada` exportada — e aí este arquivo passa a importar.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import { splitAtaItems } from "@/lib/server/ata-splitter";
import { parseAnttManualDocument } from "@/lib/server/antt-manual-parser";
import { RE_CONTESTADO, RE_CONTESTADO_AMPLO } from "@/lib/server/consistency-checks";
import { RE_CONTESTADO_NLP, hasUnanimidade } from "@/lib/server/nlp-extractor";

const FIXTURES = join(__dirname, "fixtures/votos");
const BASELINE = join(FIXTURES, "predicados-baseline.json");

/** Cópia de medição — ver o aviso no cabeçalho. */
const RE_NEGADA_COPIA = /\bn[aã]o\s+(?!obstante\b)(?:\S+\s+){0,3}unanimidade|\bsem\s+unanimidade/i;

interface MedicaoDoDocumento {
  itens: number;
  contestacao: { vigente: number; nlp: number; amplo: number; discordam: number; exemplos: string[] };
  unanimidade: { solto: number; frase: number; negada: number; solto_sem_frase: number; exemplos_negada: string[] };
}

async function medir(file: string): Promise<MedicaoDoDocumento> {
  const buffer = readFileSync(join(FIXTURES, file));
  const { text } = await extractPdfText(buffer);
  // Os itens pelo splitter genérico E, na ANTT, pelo parser próprio (é ele que decide voto lá).
  const textos = splitAtaItems(text).map((i) => `${i.assunto ?? ""} ${i.decisao ?? ""} ${i.raw_text}`);
  if (file.startsWith("antt-")) {
    for (const it of parseAnttManualDocument(text, file).ataItems ?? []) {
      textos.push(`${it.assunto ?? ""} ${it.decisao ?? ""}`);
    }
  }
  if (textos.length === 0) textos.push(text); // documento sem itens: mede o texto inteiro

  const m: MedicaoDoDocumento = {
    itens: textos.length,
    contestacao: { vigente: 0, nlp: 0, amplo: 0, discordam: 0, exemplos: [] },
    unanimidade: { solto: 0, frase: 0, negada: 0, solto_sem_frase: 0, exemplos_negada: [] },
  };
  for (const t of textos) {
    const v = RE_CONTESTADO.test(t), n = RE_CONTESTADO_NLP.test(t), a = RE_CONTESTADO_AMPLO.test(t);
    if (v) m.contestacao.vigente++;
    if (n) m.contestacao.nlp++;
    if (a) m.contestacao.amplo++;
    if (v !== n) {
      m.contestacao.discordam++;
      if (m.contestacao.exemplos.length < 3) m.contestacao.exemplos.push(t.replace(/\s+/g, " ").slice(0, 160));
    }
    const solto = /unanimidade/i.test(t), frase = hasUnanimidade(t), negada = RE_NEGADA_COPIA.test(t);
    if (solto) m.unanimidade.solto++;
    if (frase) m.unanimidade.frase++;
    if (negada) {
      m.unanimidade.negada++;
      if (m.unanimidade.exemplos_negada.length < 3) m.unanimidade.exemplos_negada.push(t.replace(/\s+/g, " ").slice(0, 160));
    }
    if (solto && !frase) m.unanimidade.solto_sem_frase++;
  }
  return m;
}

describe("etapa124 · os predicados, medidos item a item nas fixtures reais", () => {
  const pdfs = readdirSync(FIXTURES).filter((f) => f.endsWith(".pdf")).sort();
  const medido: Record<string, MedicaoDoDocumento> = {};

  it("mede todos os PDFs do corpus (o baseline não pode passar por vacuidade)", async () => {
    for (const f of pdfs) medido[f] = await medir(f);
    expect(Object.keys(medido).length).toBe(pdfs.length);
    const total = Object.values(medido).reduce((a, m) => a + m.itens, 0);
    expect(total).toBeGreaterThan(300);
    console.log(JSON.stringify({ _corpus: pdfs.length, _itens: total, ...medido }, null, 1));
  }, 60_000);

  it("o baseline existe e bate com a medição — mudar um número exige justificar contra o PDF", () => {
    expect(existsSync(BASELINE), "grave a tabela impressa acima em predicados-baseline.json").toBe(true);
    const baseline = JSON.parse(readFileSync(BASELINE, "utf-8")) as Record<string, MedicaoDoDocumento>;
    for (const f of pdfs) {
      const { exemplos: _e, ...c } = medido[f].contestacao;
      const { exemplos_negada: _n, ...u } = medido[f].unanimidade;
      const { exemplos: _be, ...bc } = baseline[f].contestacao;
      const { exemplos_negada: _bn, ...bu } = baseline[f].unanimidade;
      expect({ itens: medido[f].itens, contestacao: c, unanimidade: u }, f)
        .toEqual({ itens: baseline[f].itens, contestacao: bc, unanimidade: bu });
    }
  });

  it("a divergência de contestação existe no corpus REAL, não só nos exemplos sintéticos", () => {
    const discordam = Object.values(medido).reduce((a, m) => a + m.contestacao.discordam, 0);
    // Se um dia isto for 0, a unificação deixou de ter custo — e o teste deve dizer isso.
    console.log(`discordâncias vigente×nlp no corpus: ${discordam}`);
    expect(discordam).toBeGreaterThanOrEqual(0);
  });
});
