/**
 * Etapa 163 (Fase 31, Bloco 1) — quantos votos CADA DIRETOR tem, contra o PDF oficial.
 *
 * ═══ O buraco que este arquivo fecha ═══
 * A suíte tinha 164 expectativas de certificação e NENHUMA sobre voto por diretor:
 *
 *  · `vote-certification.test.ts` (o padrão-ouro) roda com `db: null`, e aí
 *    `getDiretoresList` devolve `[]` (`upload-analysis.ts:932-933`) — `votos_sugeridos` sai vazio.
 *    Ele certifica campos do documento, nunca a linha de voto.
 *  · `etapa29b-votos-por-diretor-certificacao.test.ts` tem o nome certo e o corpus errado: três
 *    diretores fictícios e quatro deliberações inventadas. Zero PDF.
 *  · `gabarito.json` afere itens com `ata_items_min` — um PISO (`>=`), que por construção não
 *    mede divergência para mais.
 *
 * Ou seja: a tela "Votos dos Diretores" nunca teve certificação. Este teste dá a ela o mesmo
 * padrão do resto do corpus — um gabarito contado À MÃO contra o PDF, e o pipeline REAL rodando
 * contra ele.
 *
 * ═══ ⚠️ O que a medição desmentiu, antes de eu escrever uma linha ═══
 * `predicados-baseline.json` mede 62 itens na 79ª ROP onde o gabarito manual conta 49, e eu quase
 * reportei isso como defeito do splitter. Não é: a diferença são os **"Retirado de Pauta"**, que
 * `tipoVotoInferido` (`vote-inference.ts:390-400`) não transforma em voto. Subtraindo-os, as CINCO
 * atas batem exatamente com a contagem manual — 49, 64, 49, 6, 2. O splitter está certo, e o teste
 * abaixo afere `itens_decididos`, não `itens`, justamente por isso.
 *
 * ═══ Como ele roda o pipeline de verdade ═══
 * Espelha `upload-analysis.ts:428-438` (roster de presentes) e `:468-484` (decisão de inferir POR
 * ITEM). O `etapa66-fim-a-fim` roda com `inferFromMandate: false` e por isso só enxerga voto
 * nominal — não serviria: nestas atas quase tudo é inferido por unanimidade.
 *
 * A diferença que importa em relação ao `etapa66`: lá o roster é SINTETIZADO dos nomes que o
 * documento cita; aqui ele é DECLARADO no baseline, com variantes, como o cadastro real seria.
 * Sem isso o teste mediria a si mesmo.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { analyzeUploadPdf } from "@/lib/server/upload-analysis";
import {
  buildVotoRows,
  shouldInferVotesFromMandate,
  type DiretorVoteRecord,
} from "@/lib/server/vote-inference";
import { resolverPresentesRoster } from "@/lib/server/presentes-roster";
import { RE_CONTESTADO_AMPLO } from "@/lib/server/consistency-checks";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");
const BASELINE = JSON.parse(readFileSync(join(FIXTURES, "votos-por-diretor-baseline.json"), "utf-8")) as
  Record<string, GabaritoDaAta | string[]>;

type DiretorEsperado = { nome: string; variantes: string[]; votos: number; impedido_em: string[] };
/** Uma lacuna MEDIDA entre o gabarito e o que o pipeline produz hoje, congelada item a item. */
type DivergenciaConhecida = { item: string; causa: string; evidencia: string; sem_voto: string[] };
type GabaritoDaAta = {
  agencia: string; reuniao: string; data_reuniao: string;
  itens_decididos: number; itens_sem_decisao: number; nota_itens_sem_decisao: string;
  colegiado: DiretorEsperado[];
  divergencias_conhecidas: DivergenciaConhecida[];
};

const ATAS = Object.keys(BASELINE).filter((k) => k.endsWith(".pdf"));

/** Quantos votos o gabarito prevê e o pipeline NÃO produz hoje, para este diretor nesta ata. */
function perdasDeclaradas(gab: GabaritoDaAta, nome: string): string[] {
  return gab.divergencias_conhecidas.filter((d) => d.sem_voto.includes(nome)).map((d) => d.item);
}
const AGENCIAS = [
  { id: "cert-antt", sigla: "ANTT" },
  { id: "cert-anm", sigla: "ANM" },
  { id: "cert-artesp", sigla: "ARTESP" },
];

/** Voto EFETIVO: o diretor se manifestou. Impedido vira `Ausente` e NÃO conta — é a aritmética do gabarito (49 − 2 = 47). */
const EFETIVOS = new Set(["Favoravel", "Desfavoravel", "Abstencao"]);

type Medicao = {
  itensDecididos: number;
  itensSemDecisao: number;
  /** diretor → votos efetivos */
  votos: Map<string, number>;
  /** diretor → itens em que ficou impedido */
  impedimentos: Map<string, string[]>;
  /** linhas de voto que não casaram com nenhum diretor do gabarito */
  forasteiros: string[];
  /** diretor → itens DECIDIDOS em que ele não recebeu linha nenhuma. É o "onde olhar". */
  semLinha: Map<string, string[]>;
  /** item → por que ele não completou o colegiado (para a tabela de divergências) */
  diagnostico: Map<string, string>;
};

const cache = new Map<string, Medicao>();

/** Roda o pipeline REAL sobre o PDF, com o roster DECLARADO do gabarito. */
async function medir(file: string): Promise<Medicao> {
  const cached = cache.get(file);
  if (cached) return cached;

  const gab = BASELINE[file] as GabaritoDaAta;
  const buffer = readFileSync(join(FIXTURES, file));
  const preview = await analyzeUploadPdf({
    file: { name: file, buffer, size: buffer.length }, agencias: AGENCIAS, db: null,
  });
  const fields = preview.fields as unknown as Record<string, any>;
  const itens = (preview.ata_items ?? []) as unknown as Array<Record<string, any>>;

  // O cadastro, como a produção o teria: nome canônico + variantes.
  const diretoresList: DiretorVoteRecord[] = gab.colegiado.map((d, i) => ({
    id: `dir-${i}`, nome: d.nome, nome_variantes: d.variantes,
  }));
  const porId = new Map(diretoresList.map((d) => [d.id, d.nome]));

  // `upload-analysis.ts:428-438` — presentes do documento casados com o cadastro; sem eles, o
  // roster inteiro. Não é atalho: é o mesmo fallback da produção.
  const presentes = resolverPresentesRoster(
    Array.isArray(fields.nomes_presentes) ? fields.nomes_presentes : [], diretoresList,
  );
  const activeDiretoresList = presentes.length > 0 ? presentes : diretoresList;

  const m: Medicao = {
    itensDecididos: 0, itensSemDecisao: 0,
    votos: new Map(gab.colegiado.map((d) => [d.nome, 0])),
    impedimentos: new Map(gab.colegiado.map((d) => [d.nome, []])),
    forasteiros: [],
    semLinha: new Map(gab.colegiado.map((d) => [d.nome, []])),
    diagnostico: new Map(),
  };

  for (const item of itens) {
    // `upload-analysis.ts:468-484`, por item, sem desvio.
    const inferFromMandate = shouldInferVotesFromMandate({
      resultado: item.resultado,
      tipo_documento: "ata",
      import_counts_as_final: Boolean(item.resultado),
      unanimidadeDetectada: item.unanimidade_detectada,
      nomes: item.votos_detectados ?? [],
      nomesContra: item.votos_contra_detectados ?? [],
      nomesAbstencao: item.votos_abstencao_detectados ?? [],
      dataReuniao: fields.data_reuniao,
      sinaisContestacao: RE_CONTESTADO_AMPLO.test(`${item.assunto ?? ""} ${item.decisao ?? ""}`),
      diretoresList,
    });

    const linhas = buildVotoRows({
      deliberacao_id: `${file}#${item.item_numero}`,
      nomes: item.votos_detectados ?? [],
      nomesContra: item.votos_contra_detectados ?? [],
      nomesAbstencao: item.votos_abstencao_detectados ?? [],
      nomesAusente: item.votos_ausentes_detectados ?? [],
      nomesImpedido: item.votos_impedidos_detectados ?? [],
      diretoresList, activeDiretoresList,
      inferFromMandate,
      resultado: item.resultado ?? null,
      unanime: Boolean(item.unanimidade_detectada),
    });

    if (linhas.length === 0) { m.itensSemDecisao++; continue; }
    m.itensDecididos++;

    const comLinha = new Set<string>();
    for (const l of linhas) {
      const nome = porId.get(l.diretor_id);
      if (!nome) { m.forasteiros.push(`${item.item_numero}:${l.diretor_id}`); continue; }
      comLinha.add(nome);
      if (EFETIVOS.has(l.tipo_voto)) m.votos.set(nome, (m.votos.get(nome) ?? 0) + 1);
      if (l.motivo_nao_voto === "impedimento") m.impedimentos.get(nome)!.push(String(item.item_numero));
    }
    // Quem do colegiado presente ficou de fora deste item decidido, e por quê.
    for (const d of activeDiretoresList) {
      const nome = porId.get(d.id)!;
      if (comLinha.has(nome)) continue;
      m.semLinha.get(nome)!.push(String(item.item_numero));
      if (!m.diagnostico.has(String(item.item_numero))) {
        m.diagnostico.set(String(item.item_numero),
          `resultado=${item.resultado} · unanime=${Boolean(item.unanimidade_detectada)}` +
          ` · inferFromMandate=${inferFromMandate}` +
          ` · nomes_extraidos=${JSON.stringify(item.votos_detectados ?? [])}`);
      }
    }
  }
  cache.set(file, m);
  return m;
}

describe("etapa163 · os itens que geram voto batem com a contagem manual", () => {
  it.each(ATAS)("%s", async (file) => {
    const gab = BASELINE[file] as GabaritoDaAta;
    const m = await medir(file);
    // ⚠️ `itens_decididos`, não `itens`: "Retirado de Pauta" não gera linha de voto, e o gabarito
    // manual também não o conta. Aferir `itens` puro reprovaria o pipeline por estar certo.
    expect({ decididos: m.itensDecididos, sem_decisao: m.itensSemDecisao }, gab.reuniao).toEqual({
      decididos: gab.itens_decididos, sem_decisao: gab.itens_sem_decisao,
    });
  }, 120_000);
});

describe("etapa163 · ⚠️ quantos votos cada diretor tem, e em que itens ficou impedido", () => {
  it.each(ATAS)("%s", async (file) => {
    const gab = BASELINE[file] as GabaritoDaAta;
    const m = await medir(file);

    // A tabela de divergências. Um `expected 49 to be 47` não diz onde olhar; isto diz.
    const divergencias: string[] = [];
    for (const d of gab.colegiado) {
      const perdas = perdasDeclaradas(gab, d.nome);
      const esperadoHoje = d.votos - perdas.length;
      const obtido = m.votos.get(d.nome) ?? 0;
      if (obtido !== esperadoHoje) {
        const faltando = m.semLinha.get(d.nome) ?? [];
        divergencias.push(
          `  ${gab.agencia} ${gab.reuniao} · ${d.nome}\n` +
          `      votos: gabarito ${d.votos} − ${perdas.length} lacuna(s) declarada(s) = ${esperadoHoje}, obtido ${obtido}  (Δ ${obtido - esperadoHoje})\n` +
          `      SEM LINHA em: ${faltando.join(", ") || "(nenhum — o déficit é de tipo de voto, não de ausência de linha)"}\n` +
          faltando.slice(0, 4).map((i) => `        item ${i}: ${m.diagnostico.get(i) ?? "?"}`).join("\n"),
        );
      }
      const impObtidos = (m.impedimentos.get(d.nome) ?? []).slice().sort();
      const impEsperados = d.impedido_em.slice().sort();
      if (JSON.stringify(impObtidos) !== JSON.stringify(impEsperados)) {
        divergencias.push(
          `  ${gab.agencia} ${gab.reuniao} · ${d.nome}\n` +
          `      impedimentos: esperado [${impEsperados.join(", ")}], obtido [${impObtidos.join(", ")}]`,
        );
      }
    }
    if (m.forasteiros.length) {
      divergencias.push(`  ${gab.agencia} ${gab.reuniao} · linhas de voto sem diretor no gabarito: ${m.forasteiros.join(", ")}`);
    }

    expect(divergencias.join("\n"), `\n${gab.agencia} ${gab.reuniao} (${gab.data_reuniao})\n`).toBe("");
  }, 120_000);
});

describe("etapa163 · ⚠️ a LACUNA congelada — nem cresce nem some em silêncio", () => {
  it.each(ATAS)("%s", async (file) => {
    const gab = BASELINE[file] as GabaritoDaAta;
    const m = await medir(file);

    // O conjunto REAL de (item decidido, diretor sem linha), medido agora.
    const observado: string[] = [];
    for (const [nome, itens] of m.semLinha) {
      for (const item of itens) observado.push(`${item} · ${nome}`);
    }
    // O conjunto DECLARADO no baseline.
    const declarado: string[] = [];
    for (const d of gab.divergencias_conhecidas) {
      for (const nome of d.sem_voto) declarado.push(`${d.item} · ${nome}`);
    }

    // ⚠️ Igualdade EXATA, nos dois sentidos, e é isso que a torna não-tautológica:
    //  · lacuna NOVA reprova — a regressão não passa despercebida;
    //  · lacuna que SUMIU reprova — alguém consertou a inferência e o baseline ficou velho,
    //    e um gabarito velho mentindo de verde é pior do que nenhum gabarito.
    expect(
      observado.slice().sort(),
      `\n${gab.agencia} ${gab.reuniao}: a lacuna medida divergiu da declarada em ` +
      `fixtures/votos/votos-por-diretor-baseline.json\n`,
    ).toEqual(declarado.slice().sort());
  }, 120_000);

  it("toda lacuna declarada tem causa NOMEADA no dicionário de causas", () => {
    const causas = BASELINE["_causas_das_divergencias"] as unknown as Record<string, string>;
    for (const file of ATAS) {
      for (const d of (BASELINE[file] as GabaritoDaAta).divergencias_conhecidas) {
        expect(causas[d.causa], `${file}/${d.item}: causa «${d.causa}» sem verbete`).toBeTruthy();
        expect(d.evidencia.length, `${file}/${d.item} sem evidência`).toBeGreaterThan(20);
      }
    }
  });

  it("⚠️ a ANTT não tem lacuna — as duas atas dela fecham com o gabarito", () => {
    for (const file of ATAS.filter((f) => f.startsWith("antt-"))) {
      expect((BASELINE[file] as GabaritoDaAta).divergencias_conhecidas, file).toEqual([]);
    }
  });
});

describe("etapa163 · as invariantes que sobrevivem a qualquer ata", () => {
  it.each(ATAS)("%s — ninguém vota mais que o número de itens decididos", async (file) => {
    const gab = BASELINE[file] as GabaritoDaAta;
    const m = await medir(file);
    for (const [nome, n] of m.votos) {
      expect(n, `${nome} votou mais vezes do que houve item decidido`).toBeLessThanOrEqual(gab.itens_decididos);
    }
  }, 120_000);

  it.each(ATAS)("%s — votos = decididos − impedimentos, por diretor", async (file) => {
    // A identidade que o gabarito assume. Se ela quebrar, ou há ausência física (que o gabarito
    // não previu) ou o item não gerou linha para aquele diretor — os dois são achado, não ruído.
    const gab = BASELINE[file] as GabaritoDaAta;
    const m = await medir(file);
    for (const d of gab.colegiado) {
      const imped = (m.impedimentos.get(d.nome) ?? []).length;
      const perdas = perdasDeclaradas(gab, d.nome).length;
      expect(m.votos.get(d.nome) ?? 0, `${d.nome}`).toBe(gab.itens_decididos - imped - perdas);
    }
  }, 120_000);

  it("⚠️ o gabarito cobre TODA ata da pasta que ele diz cobrir — e o inverso", () => {
    // Trava estrutural, no espírito de `vote-certification.test.ts:68-72`: acrescentar fixture e
    // esquecer o gabarito deixaria o buraco voltar em silêncio.
    for (const file of ATAS) {
      expect(() => readFileSync(join(FIXTURES, file)), `${file} declarado no baseline mas ausente`).not.toThrow();
      const gab = BASELINE[file] as GabaritoDaAta;
      expect(gab.colegiado.length, `${file} sem colegiado`).toBeGreaterThan(0);
      for (const d of gab.colegiado) {
        // O gabarito continua sendo a VERDADE contada à mão: votos = decididos − impedimentos.
        // As lacunas do pipeline não entram aqui — elas são medidas à parte, de propósito.
        expect(d.votos, `${file}/${d.nome}`).toBe(gab.itens_decididos - d.impedido_em.length);
      }
    }
  });
});
