/**
 * Etapa 66 — o teste FIM-A-FIM: PDF real → extração → linhas de voto → agregação.
 *
 * ═══ Por que ele faltava, e por que importa ═══
 *
 * A suíte tem 779 testes e 154 expectativas de certificação, mas o corte era limpo demais:
 *   · `analyzeUploadPdf` aparece em 4 arquivos de teste — nenhum importa `buildVotoRows`;
 *   · `buildVotoRows` aparece em 6 — nenhum lê um PDF;
 *   · `analytics-engine` aparece em 2 — nenhum lê um PDF.
 * Nenhum arquivo cruzava os três. E **a maior parte dos defeitos das últimas rodadas apareceu
 * justamente na COMPOSIÇÃO**: rota × engine, numerador × denominador, extração × projeção SQL.
 *
 * As invariantes da etapa65 rodam sobre corpus SINTÉTICO — dados que a própria suíte fabricou.
 * Aqui elas rodam sobre o que os 16 documentos oficiais realmente produzem, depois de atravessar
 * o pipeline inteiro. É a diferença entre "a função está certa" e "o sistema está certo".
 *
 * ⚠️ Limite honesto: o harness roda com `db: null`, então o roster de mandatos é SINTETIZADO a
 * partir dos nomes que o próprio documento nomeia. Isso é fiel ao que a produção faz (o roster sai
 * do preâmbulo da ata quando não há mandato cadastrado) e é o que torna `buildVotoRows`
 * exercitável — mas não substitui conferência contra o cadastro real.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Deliberacao } from "@/types";
import { analyzeUploadPdf } from "@/lib/server/upload-analysis";
import { buildVotoRows, type DiretorVoteRecord } from "@/lib/server/vote-inference";
import { buildRawExtractionDoItem } from "@/lib/server/ata-item-materializacao";
import { decisionStatus, isSancao } from "@/lib/server/regulatory-documents";
import {
  computeOverview, computeMandatosAnalytics, computeMicrotemas,
  computeConsensoTimeline, computeDiretoresOverview,
} from "@/lib/server/analytics-engine";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");
const AGENCIAS = [
  { id: "cert-antt", sigla: "ANTT" },
  { id: "cert-anm", sigla: "ANM" },
  { id: "cert-artesp", sigla: "ARTESP" },
];
const PDFS = readdirSync(fixturesDir).filter((f) => f.endsWith(".pdf")).sort();

type Ponta = {
  file: string;
  agenciaId: string;
  delibs: Deliberacao[];
  votos: ReturnType<typeof buildVotoRows>;
  roster: DiretorVoteRecord[];
  /**
   * Impedidos POR deliberação (= por item de ata), não por documento.
   * ⚠️ Foi o primeiro achado deste teste, e era ARTEFATO DA INVARIANTE, não do código: agregar
   * impedidos por DOCUMENTO acusa falso positivo, porque o diretor impedido no item 2.1.1 vota
   * legitimamente no item 4.3. Mesma classe do C03 — a semântica é do ITEM.
   */
  impedidosPorDelib: Map<string, string[]>;
};

/** Roster sintético a partir dos nomes que o PRÓPRIO documento cita — ver o limite no cabeçalho. */
function rosterDoDocumento(fields: Record<string, any>, itens: Array<Record<string, any>>): DiretorVoteRecord[] {
  const nomes = new Set<string>();
  const juntar = (v: unknown) => { for (const n of (v as string[]) ?? []) if (typeof n === "string") nomes.add(n); };
  juntar(fields.nomes_presentes); juntar(fields.nomes_votacao);
  juntar(fields.nomes_votacao_favor); juntar(fields.nomes_votacao_contra);
  juntar(fields.nomes_votacao_abstencao); juntar(fields.nomes_votacao_ausente);
  juntar(fields.nomes_votacao_impedido);
  for (const it of itens) {
    juntar(it.votos_detectados); juntar(it.votos_contra_detectados);
    juntar(it.votos_abstencao_detectados); juntar(it.votos_ausentes_detectados);
    juntar(it.votos_impedidos_detectados);
  }
  return [...nomes].map((nome, i) => ({ id: `d${i}-${nome.slice(0, 12)}`, nome, nome_variantes: [nome] }));
}

let cache: Ponta[] | null = null;
async function pipelineCompleto(): Promise<Ponta[]> {
  if (cache) return cache;
  const out: Ponta[] = [];
  for (const file of PDFS) {
    const buffer = readFileSync(join(fixturesDir, file));
    const preview = await analyzeUploadPdf({
      file: { name: file, buffer, size: buffer.length }, agencias: AGENCIAS, db: null,
    });
    const fields = preview.fields as unknown as Record<string, any>;
    const itens = (preview.ata_items ?? []) as unknown as Array<Record<string, any>>;
    const agenciaId = AGENCIAS.find((a) => a.sigla === preview.agencia_sigla_detected)?.id ?? "cert-anm";
    const roster = rosterDoDocumento(fields, itens);

    const delibs: Deliberacao[] = [];
    const votos: ReturnType<typeof buildVotoRows> = [];
    const impedidosPorDelib = new Map<string, string[]>();

    // Cada item de ata vira uma deliberação-FILHA, como o confirm materializa.
    const fontes = itens.length
      ? itens.map((it, i) => ({ id: `${file}#${i}`, item: it, ehItem: true }))
      : [{ id: `${file}#doc`, item: fields, ehItem: false }];

    for (const { id, item, ehItem } of fontes) {
      const raw = ehItem
        ? buildRawExtractionDoItem({ item: item as never, documentoAnttTipo: null, documentoSubtipo: null, votosInferidosPorMandato: false })
        : { juizo: item.juizo ?? null };
      const contra: string[] = (ehItem ? item.votos_contra_detectados : item.nomes_votacao_contra) ?? [];
      const nomes: string[] = (ehItem ? item.votos_detectados : item.nomes_votacao) ?? [];
      const imped: string[] = (ehItem ? item.votos_impedidos_detectados : item.nomes_votacao_impedido) ?? [];
      if (imped.length) impedidosPorDelib.set(id, imped);

      const linhas = buildVotoRows({
        deliberacao_id: id,
        nomes, nomesContra: contra, nomesImpedido: imped,
        nomesAbstencao: (ehItem ? item.votos_abstencao_detectados : item.nomes_votacao_abstencao) ?? [],
        nomesAusente: (ehItem ? item.votos_ausentes_detectados : item.nomes_votacao_ausente) ?? [],
        diretoresList: roster, activeDiretoresList: roster,
        inferFromMandate: false,
        resultado: item.resultado ?? null,
        unanime: Boolean(item.unanimidade_detectada),
      });
      votos.push(...linhas);

      delibs.push({
        id, agencia_id: agenciaId,
        tipo_documento: ehItem ? "ata" : (fields.tipo_documento ?? "deliberacao"),
        documento_pai_id: ehItem ? `${file}#pai` : null,
        resultado: item.resultado ?? null,
        microtema: item.microtema ?? null,
        data_reuniao: fields.data_reuniao ?? null,
        interessado: item.interessado ?? null,
        extraction_confidence: preview.confidence ?? null,
        raw_extraction: raw,
        votos: linhas.map((v) => ({
          diretor_id: v.diretor_id, tipo_voto: v.tipo_voto,
          is_divergente: v.is_divergente, is_nominal: v.is_nominal,
          diretor_nome: roster.find((r) => r.id === v.diretor_id)?.nome ?? v.diretor_id,
        })),
      } as unknown as Deliberacao);
    }
    out.push({ file, agenciaId, delibs, votos, roster, impedidosPorDelib });
  }
  cache = out;
  return out;
}

/** Toda taxa publicada por uma agregação, string "12.3%" ou número. */
function taxasDe(valor: unknown, caminho = "$"): Array<{ caminho: string; pct: number }> {
  const out: Array<{ caminho: string; pct: number }> = [];
  const visita = (v: unknown, path: string) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach((x, i) => visita(x, `${path}[${i}]`)); return; }
    if (typeof v !== "object") return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const p = `${path}.${k}`;
      const ehTaxa = /^(taxa_|pct_|percentual|cobertura_|indice_)/.test(k) || /_pct$/.test(k);
      if (ehTaxa && typeof val === "string" && /^-?[\d.]+%$/.test(val)) out.push({ caminho: p, pct: parseFloat(val) });
      else if (ehTaxa && typeof val === "number") out.push({ caminho: p, pct: val });
      else visita(val, p);
    }
  };
  visita(valor, caminho);
  return out;
}

describe("etapa66 · FIM-A-FIM — invariantes sobre o que os 16 PDFs REALMENTE produzem", () => {
  it("o pipeline atravessa: os 16 documentos produzem deliberações e linhas de voto", async () => {
    const pontas = await pipelineCompleto();
    expect(pontas).toHaveLength(16);
    expect(pontas.reduce((s, p) => s + p.delibs.length, 0), "nenhuma deliberação materializada")
      .toBeGreaterThan(300);
    expect(pontas.reduce((s, p) => s + p.votos.length, 0), "nenhuma linha de voto produzida")
      .toBeGreaterThan(0);
  }, 300_000);

  it("nenhuma taxa fora de [0,100] em NENHUMA agregação, sobre dado REAL", async () => {
    const todas = (await pipelineCompleto()).flatMap((p) => p.delibs);
    const agregacoes: Array<[string, unknown]> = [
      ["computeOverview", computeOverview(todas)],
      ["computeMandatosAnalytics", computeMandatosAnalytics(todas)],
      ["computeMicrotemas", computeMicrotemas(todas)],
      ["computeConsensoTimeline", computeConsensoTimeline(todas)],
      ["computeDiretoresOverview", computeDiretoresOverview(todas)],
    ];
    for (const [nome, resultado] of agregacoes) {
      for (const { caminho, pct } of taxasDe(resultado)) {
        expect(Number.isFinite(pct), `${nome}${caminho} = ${pct}`).toBe(true);
        expect(pct, `${nome}${caminho} = ${pct}% — numerador e divisor em universos diferentes`)
          .toBeLessThanOrEqual(100);
        expect(pct, `${nome}${caminho} = ${pct}% — taxa negativa`).toBeGreaterThanOrEqual(0);
      }
    }
  }, 300_000);

  it("soma dos QUATRO estados = pautado, por documento", async () => {
    for (const p of await pipelineCompleto()) {
      const c = { decidido: 0, admissibilidade: 0, retirado: 0, sem_resultado: 0 };
      for (const d of p.delibs) c[decisionStatus(d as never)] += 1;
      const soma = Object.values(c).reduce((s, n) => s + n, 0);
      expect(soma, `${p.file}: balde novo nasceu fora da conta`).toBe(p.delibs.length);
    }
  }, 300_000);

  it("a admissibilidade SOBREVIVE ao pipeline inteiro — não some entre a extração e a agregação", async () => {
    const pontas = await pipelineCompleto();
    const total = pontas.flatMap((p) => p.delibs).filter((d) => decisionStatus(d as never) === "admissibilidade");
    expect(total.length, "o corpus tem itens de não-conhecimento e eles precisam chegar até aqui")
      .toBeGreaterThan(0);
    // E o denominador de mérito EXCLUI todos eles.
    const a = computeMandatosAnalytics(pontas.flatMap((p) => p.delibs));
    expect(a.total_decidido).toBeLessThan(a.total_deliberacoes);
  }, 300_000);

  it("nenhum IMPEDIDO recebe voto diferente de Ausente NO MESMO ITEM", async () => {
    // ⚠️ O escopo é do ITEM, não do documento. A primeira versão desta invariante agregava por
    // documento e acusou a 81ª: "José Fernando … impedido com voto Favoravel". Medido, era falso
    // positivo DA INVARIANTE — ele está impedido no 2.1.1 (onde recebe `Ausente`, correto) e vota
    // em outro item. Um alarme que dispara pelo motivo errado treina o revisor a ignorá-lo.
    let itensComImpedimento = 0;
    for (const p of await pipelineCompleto()) {
      for (const [delibId, impedidos] of p.impedidosPorDelib) {
        itensComImpedimento++;
        const ids = new Set(p.roster.filter((r) => impedidos.includes(r.nome)).map((r) => r.id));
        for (const v of p.votos.filter((x) => x.deliberacao_id === delibId)) {
          if (!ids.has(v.diretor_id)) continue;
          expect(v.tipo_voto, `${p.file}/${delibId}: impedido com voto ${v.tipo_voto}`).toBe("Ausente");
          expect(v.is_divergente, `${p.file}/${delibId}: impedido marcado como divergente`).toBe(false);
        }
      }
    }
    expect(itensComImpedimento, "o corpus precisa ter impedimento para a invariante valer algo")
      .toBeGreaterThan(0);
  }, 300_000);

  it("nenhum voto para quem o documento não nomeia — sem fabricação por composição", async () => {
    for (const p of await pipelineCompleto()) {
      const idsValidos = new Set(p.roster.map((r) => r.id));
      for (const v of p.votos) {
        expect(idsValidos.has(v.diretor_id), `${p.file}: voto para diretor fora do roster`).toBe(true);
      }
    }
  }, 300_000);

  it("ninguém em CONTRA que o dispositivo declara vencedor — a trava sobrevive à composição", async () => {
    for (const p of await pipelineCompleto()) {
      const nomesContra = p.votos
        .filter((v) => v.tipo_voto === "Desfavoravel")
        .map((v) => p.roster.find((r) => r.id === v.diretor_id)?.nome)
        .filter(Boolean) as string[];
      // Nas 6 atas da ANM o Diretor-Geral venceu em 79ª/81ª/82ª/83ª — não pode figurar contra lá.
      if (["anm-ata-79-rop.pdf", "anm-ata-81-rop.pdf", "anm-ata-83-rop.pdf"].includes(p.file)) {
        expect(nomesContra, `${p.file}: sinal invertido sobreviveu à composição`)
          .not.toContain("Mauro Henrique Moreira Sousa");
      }
    }
  }, 300_000);

  it("a taxa de sanção do ENGINE bate com o cálculo independente sobre o mesmo universo", async () => {
    // ⚠️ Asserir só "sanção ≤ decididos" NÃO pega a regressão: o corpus REAL não contém o estado
    // adversarial que faz a taxa estourar (item retirado com `microtema='multa'`), então uma
    // versão do engine contando o numerador sobre TODAS as linhas passa verde aqui. Medido por
    // mutação. A trava tem de comparar o valor PUBLICADO com um cálculo independente.
    //
    // É também a razão de o corpus sintético da etapa65 continuar existindo: ele cobre estados
    // que os 16 documentos não têm, e este cobre a composição que o sintético não vê.
    const todas = (await pipelineCompleto()).flatMap((p) => p.delibs);
    const decididos = todas.filter((d) => decisionStatus(d as never) === "decidido");
    const sancaoEsperada = decididos.filter((d) => isSancao(d as never)).length;
    const esperado = decididos.length > 0
      ? `${((sancaoEsperada / decididos.length) * 100).toFixed(1)}%`
      : "0%";

    const a = computeMandatosAnalytics(todas);
    expect(a.total_decidido, "denominador de mérito divergiu").toBe(decididos.length);
    expect(a.taxa_sancao, "numerador e divisor em universos diferentes").toBe(esperado);
    expect(sancaoEsperada, "sanção acima do denominador de mérito").toBeLessThanOrEqual(decididos.length);
  }, 300_000);

  it("consenso: sem base o valor é null, e com base fecha a conta", async () => {
    const todas = (await pipelineCompleto()).flatMap((p) => p.delibs);
    for (const m of computeConsensoTimeline(todas)) {
      expect(m.consensuais + m.divergentes, `período ${m.period}`).toBe(m.total_com_voto);
      expect(m.total_com_voto).toBeLessThanOrEqual(m.total_itens);
      if (m.total_com_voto === 0) expect(m.pct_consenso, `período ${m.period}`).toBeNull();
    }
  }, 300_000);
});
