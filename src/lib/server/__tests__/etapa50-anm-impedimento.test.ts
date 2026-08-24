/**
 * Etapa 50 — IMPEDIMENTO: o diretor que a ata declara impedido não pode receber voto fabricado.
 *
 * Antes desta etapa, impedimento não existia em lugar nenhum do código. O impedido permanecia no
 * roster e a inferência por mandato lhe dava "Favoravel" — um voto que a ata diz expressamente
 * não ter existido. Casos reais: 7 na 83ª ROP, 1 na 81ª e 1 DENTRO do golden-set (82ª ROP).
 *
 * Os trechos abaixo são LITERAIS dos PDFs oficiais da ANM.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractImpedidos, extractFields } from "@/lib/server/nlp-extractor";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import { buildVotoRows, buildVoteSuggestions, type DiretorVoteRecord } from "@/lib/server/vote-inference";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");

const DIRETORES: DiretorVoteRecord[] = [
  { id: "d1", nome: "José Fernando de Mendonça Gomes Júnior", nome_variantes: [] },
  { id: "d2", nome: "Caio Mário Trivellato Seabra Filho", nome_variantes: [] },
  { id: "d3", nome: "Guilherme Santana Lopes Gomes", nome_variantes: [] },
  { id: "d4", nome: "Roger Romão Cabral", nome_variantes: [] },
];

describe("etapa50 · as quatro redações reais de impedimento", () => {
  it("«não votaria» — o caso que está DENTRO do golden-set (82ª ROP)", () => {
    expect(
      extractImpedidos(
        "Registrou o Diretor-Geral que o Diretor José Fernando de Mendonça Gomes Júnior não " +
          "votaria a matéria, por já ter se manifestado nos autos.",
      ),
    ).toEqual(["José Fernando de Mendonça Gomes Júnior"]);
  });

  it("«encontrava-se impedido de votar» — a fórmula mais frequente da 83ª", () => {
    expect(
      extractImpedidos(
        "Esclareceu que o Diretor Caio Mário Trivellato Seabra Filho encontrava-se impedido de " +
          "votar, em razão de manifestação anterior.",
      ),
    ).toEqual(["Caio Mário Trivellato Seabra Filho"]);
  });

  it("«declarou-se impedido» e «declarou-se suspeito»", () => {
    expect(extractImpedidos("O Diretor Roger Romão Cabral declarou-se impedido.")).toEqual([
      "Roger Romão Cabral",
    ]);
    expect(extractImpedidos("O Diretor Roger Romão Cabral declarou-se suspeito.")).toEqual([
      "Roger Romão Cabral",
    ]);
  });

  it("«não participaria da votação, nos termos regimentais»", () => {
    expect(
      extractImpedidos(
        "O Diretor Guilherme Santana Lopes Gomes não participaria da votação, nos termos regimentais.",
      ),
    ).toEqual(["Guilherme Santana Lopes Gomes"]);
  });

  it("forma invertida, com o rótulo antes do nome", () => {
    expect(
      extractImpedidos("Impedido de votar o Diretor Roger Romão Cabral, por suspeição declarada."),
    ).toEqual(["Roger Romão Cabral"]);
  });
});

describe("etapa50 · guards — o que NÃO pode virar impedimento", () => {
  it("«não havia impedimento» é o sentido INVERSO e não pode marcar ninguém (83ª/2.5.1)", () => {
    expect(
      extractImpedidos(
        "Por se tratar de matéria anteriormente relatada pelo Diretor Caio Mário Trivellato " +
          "Seabra Filho, não havia impedimento à participação dos demais Diretores na votação.",
      ),
    ).toEqual([]);
  });

  it("a negação não engole um impedimento REAL na frase seguinte", () => {
    // O guard remove só até o ponto final: um impedimento na frase seguinte tem de sobreviver.
    expect(
      extractImpedidos(
        "Não havia impedimento à participação dos demais Diretores. O Diretor Roger Romão " +
          "Cabral encontrava-se impedido de votar.",
      ),
    ).toEqual(["Roger Romão Cabral"]);
  });

  it("a armadilha dos DOIS nomes numa frase só (81ª): o impedido é o SEGUNDO", () => {
    // Conector curinga (`.{0,80}`) saltaria do primeiro nome para a fórmula e culparia o
    // diretor errado — atribuindo impedimento a quem votou e voto a quem estava impedido.
    const nomes = extractImpedidos(
      "Foi mantido o voto originalmente proferido pelo então Diretor Carlos Cordeiro, cujo " +
        "gabinete é atualmente ocupado pelo Diretor José Fernando de Mendonça Gomes Júnior, " +
        "este não participaria da votação.",
    );
    expect(nomes).toEqual(["José Fernando de Mendonça Gomes Júnior"]);
    expect(nomes).not.toContain("Carlos Cordeiro");
  });

  it("«não participa da Diretoria Colegiada» é biografia, não impedimento", () => {
    expect(
      extractImpedidos("O Diretor Roger Romão Cabral não participa da Diretoria Colegiada desde 2025."),
    ).toEqual([]);
  });

  it("prosa sem nome de pessoa não vira impedimento", () => {
    expect(extractImpedidos("A área técnica não participou da votação.")).toEqual([]);
  });
});

describe("etapa50 · quebra de linha do PDF (é o achatamento que salva metade dos casos)", () => {
  it("a fórmula partida em duas linhas é reconhecida", () => {
    const comQuebra =
      "Esclareceu, ainda, que o Diretor José Fernando de Mendonça\nGomes Júnior encontrava-se\n" +
      "impedido de votar, em razão de manifestação anterior.";
    expect(extractImpedidos(comQuebra)).toEqual(["José Fernando de Mendonça Gomes Júnior"]);
  });
});

describe("etapa50 · nos PDFs binários do corpus (trecho literal não prova extração)", () => {
  it("a 82ª ROP entrega o impedimento que está DENTRO do golden-set", async () => {
    const { text } = await extractPdfText(readFileSync(join(fixturesDir, "anm-ata-82-ordinaria.pdf")));
    expect(extractImpedidos(text)).toEqual(["José Fernando de Mendonça Gomes Júnior"]);
  }, 60_000);

  it.each([
    "anm-ata-32-extraordinaria.pdf",
    "antt-pauta-1036.pdf",
    "artesp-ata-1201.pdf",
    "artesp-delib-487.pdf",
    "artesp-pauta-1201.pdf",
  ])("%s não tem impedimento e não pode ganhar nenhum", async (file) => {
    // Zero falso-positivo em 5 documentos de 3 órgãos é o que autoriza a regex a remover
    // diretores do pool: um falso-positivo aqui APAGARIA um voto real.
    const { text } = await extractPdfText(readFileSync(join(fixturesDir, file)));
    expect(extractImpedidos(text)).toEqual([]);
  }, 60_000);
});

describe("etapa50 · o impedido sai do pool — fim da fabricação", () => {
  const TEXTO_ITEM =
    "DELIBERAÇÃO: A Diretoria Colegiada, por unanimidade, aprovou o voto do Relator. " +
    "O Diretor José Fernando de Mendonça Gomes Júnior não votaria a matéria, por já ter se " +
    "manifestado nos autos.";

  it("extractFields tira o impedido de TODOS os baldes, inclusive de nomes_votacao", () => {
    const f = extractFields(TEXTO_ITEM);
    expect(f.nomes_votacao_impedido).toEqual(["José Fernando de Mendonça Gomes Júnior"]);
    for (const balde of [
      f.nomes_votacao,
      f.nomes_votacao_favor,
      f.nomes_votacao_contra,
      f.nomes_votacao_abstencao,
      f.nomes_votacao_ausente,
    ]) {
      expect(balde).not.toContain("José Fernando de Mendonça Gomes Júnior");
    }
  });

  it("ASSERÇÃO DECISIVA: 4 diretores ativos, 1 impedido → 3 votos, e o impedido é «Ausente»", () => {
    const rows = buildVotoRows({
      deliberacao_id: "del-1",
      nomes: [],
      nomesContra: [],
      nomesImpedido: ["José Fernando de Mendonça Gomes Júnior"],
      diretoresList: DIRETORES,
      activeDiretoresList: DIRETORES,
      inferFromMandate: true,
      resultado: "Deferido",
      unanime: true,
    });

    const impedido = rows.find((r) => r.diretor_id === "d1");
    expect(impedido?.tipo_voto).toBe("Ausente");
    expect(impedido?.tipo_voto).not.toBe("Favoravel");
    expect(impedido?.is_nominal).toBe(true);

    // Os outros três seguem inferidos normalmente — o impedimento não derruba o item inteiro.
    const inferidos = rows.filter((r) => r.tipo_voto === "Favoravel");
    expect(inferidos).toHaveLength(3);
    expect(inferidos.every((r) => r.is_nominal === false)).toBe(true);
  });

  it("impedimento tem precedência sobre os demais baldes quando o nome cai em dois", () => {
    const rows = buildVotoRows({
      deliberacao_id: "del-2",
      nomes: ["Roger Romão Cabral"],
      nomesContra: ["Roger Romão Cabral"],
      nomesAbstencao: ["Roger Romão Cabral"],
      nomesImpedido: ["Roger Romão Cabral"],
      diretoresList: DIRETORES,
      activeDiretoresList: DIRETORES,
      inferFromMandate: false,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].tipo_voto).toBe("Ausente");
  });

  it("impedido com match de confiança MÉDIA também bloqueia a fabricação", () => {
    // Match 0.6–0.85 não vira voto nominal; sem entrar em `collectDivergentIntentIds` o laço de
    // mandato lhe daria "Favoravel" — o pior caso: perde o impedimento E inventa o voto.
    const rows = buildVotoRows({
      deliberacao_id: "del-3",
      nomes: [],
      nomesContra: [],
      nomesImpedido: ["José Fernando Mendonça Gomes"],
      diretoresList: DIRETORES,
      activeDiretoresList: DIRETORES,
      inferFromMandate: true,
      resultado: "Deferido",
      unanime: true,
    });
    expect(rows.find((r) => r.diretor_id === "d1")?.tipo_voto).not.toBe("Favoravel");
  });

  it("a sugestão exibida ao revisor distingue impedimento de ausência física", () => {
    const sugestoes = buildVoteSuggestions({
      nomes: [],
      nomesContra: [],
      nomesAusente: ["Roger Romão Cabral"],
      nomesImpedido: ["José Fernando de Mendonça Gomes Júnior"],
      diretoresList: DIRETORES,
      activeDiretoresList: DIRETORES,
      inferFromMandate: false,
    });
    expect(sugestoes.find((s) => s.diretor_id === "d1")?.origem).toBe("impedido");
    expect(sugestoes.find((s) => s.diretor_id === "d4")?.origem).toBe("ausente");
  });

  it("impedimento NÃO é divergência — o impedido não conta contra o consenso", () => {
    const rows = buildVotoRows({
      deliberacao_id: "del-4",
      nomes: [],
      nomesContra: [],
      nomesImpedido: ["Roger Romão Cabral"],
      diretoresList: DIRETORES,
      activeDiretoresList: DIRETORES,
      inferFromMandate: false,
      resultado: "Indeferido",
    });
    expect(rows[0].is_divergente).toBe(false);
  });
});
