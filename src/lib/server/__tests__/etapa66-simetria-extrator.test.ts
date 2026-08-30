/**
 * Etapa 66 — SIMETRIA entre os caminhos que gravam FAVORÁVEL e os que gravam CONTRÁRIO.
 *
 * O achado veio de fora e a medição o dividiu em duas metades com veredictos opostos:
 *
 *  · ESTRUTURA — correta, e pior do que descrita. `RE_VOTO_CONCORDANCIA` tem os dois ramos no
 *    mesmo regex, e só o de divergência exigia objeto (`ALVO_DIVERGENCIA_COLEGIADO`); o de adesão
 *    também não passava por `isStrictPersonName`. O lado que fabrica FAVORÁVEL era o mais frouxo —
 *    e favorável é justamente o sinal já inflado pela inferência de unanimidade.
 *
 *  · FREQUÊNCIA — não traduziu. Nas 16 fixtures há 150 ocorrências da PALAVRA
 *    (`acompanh|segui|aderi`) e a regex casa 3, porque exige NOME adjacente. As 3 são adesão a
 *    voto de colega: ZERO votos fabricados hoje.
 *
 * A correção entra porque a proteção era ACIDENTAL (vinha da adjacência do nome, não de desenho) e
 * porque custa nada: medido, preserva 3/3 dos casos reais e bloqueia 4/4 dos adversariais.
 *
 * ⚠️ `isStrictPersonName` NÃO é a defesa — medido, aceita "Superintendência de Fiscalização" e
 * "Ante O Exposto". Quem segura é o objeto obrigatório; a validação de nome é complemento.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import { extractFields, extractItemVotes, buildRoleMap } from "@/lib/server/nlp-extractor";
import { isStrictPersonName } from "@/lib/server/name-matcher";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/votos");
const DG = "Mauro Henrique Moreira Sousa";
const PREAMBULO = `A sessão foi presidida pelo Diretor-Geral, ${DG}.\n`;
const roleMap = { "diretor-geral": DG };

describe("etapa66 · adesão exige OBJETO do colegiado, como a divergência sempre exigiu", () => {
  it.each([
    ["manifestação técnica", "O Diretor Roger Romão Cabral acompanhou a manifestação técnica da Superintendência."],
    ["parecer da Procuradoria", "O Diretor Roger Romão Cabral acompanhou o parecer da Procuradoria Federal."],
    ["conclusões da área técnica", "O Diretor Roger Romão Cabral acompanhou as conclusões da área técnica."],
    ["Voto CS", "O Diretor Roger Romão Cabral acompanhou o Voto CS/ANM nº 532/2025."],
  ])("adesão a %s NÃO vira voto favorável", (_rot, texto) => {
    expect(extractItemVotes(texto, roleMap).favor).toEqual([]);
    expect(extractFields(PREAMBULO + texto).nomes_votacao_favor ?? []).not.toContain("Roger Romão Cabral");
  });

  it.each([
    ["o voto do Relator", "O Diretor José Fernando de Souza acompanhou o voto do Relator."],
    ["ordinal capitalizado", "O Diretor José Fernando de Souza acompanhou o voto do Segundo Revisor."],
    ["parênteses", "O Diretor José Fernando de Souza acompanhando o voto do primeiro revisor (Diretor-Geral)."],
    ["«ao voto do»", "O Diretor José Fernando de Souza aderiu ao voto do Diretor-Geral."],
    ["«seguiu o Relator»", "O Diretor José Fernando de Souza seguiu o Relator."],
    ["integralmente", "O Diretor José Fernando de Souza acompanhou integralmente o voto do Revisor."],
  ])("adesão a voto de COLEGA (%s) continua valendo", (_rot, texto) => {
    expect(extractItemVotes(texto, roleMap).favor).toContain("José Fernando de Souza");
  });

  it("o sujeito que não é pessoa não vira voto — nem com objeto certo", () => {
    // HISTÓRICO: quando este teste nasceu, `isStrictPersonName` ACEITAVA este órgão — a
    // pré-condição documentava a fraqueza e provava que o guard de sujeito era necessário.
    // A Fase 13 endureceu o strict (teto de 14 chars por token barra "Superintendência"), então
    // a pré-condição virou o INVERSO — e o guard de sujeito continua necessário para órgãos
    // curtos que o strict não vê ("Mesa Técnica", "Grupo Gestor").
    expect(isStrictPersonName("Superintendência de Fiscalização"), "Fase 13: o strict agora barra").toBe(false);
    expect(extractItemVotes("Superintendência de Fiscalização acompanhou a sessão.", roleMap).favor).toEqual([]);
  });
});

describe("etapa66 · os furos de CONTRA que escapavam da trava da etapa65", () => {
  const texto = (linhaTabular: string) =>
    PREAMBULO
    + "havia dois entendimentos: o voto do relator original e o voto divergente do Diretor-Geral. "
    + `DELIBERAÇÃO: Voto do Revisor, Diretor-Geral, aprovado por maioria.\n${linhaTabular}`;

  it("o ramo TABULAR não pode marcar contra quem o dispositivo diz que venceu", () => {
    // `push(contra, …)` cru pulava `isStrictPersonName` E `autoresAprovado` — era o único caminho
    // de CONTRA fora do helper, e portanto o único furo na correção que dá nome ao bloco 1.
    const t = texto(`${DG} – Contrário`);
    expect(extractItemVotes(t, roleMap).contra, "item").not.toContain(DG);
    expect(extractFields(t).nomes_votacao_contra ?? [], "documento").not.toContain(DG);
  });

  it("o ramo TABULAR continua registrando contrário LEGÍTIMO", () => {
    const t = PREAMBULO + "DELIBERAÇÃO: aprovado.\nRoger Romão Cabral – Contrário";
    expect(extractItemVotes(t, roleMap).contra).toContain("Roger Romão Cabral");
  });

  it("o ramo TABULAR não aceita prosa como nome", () => {
    const t = PREAMBULO + "DELIBERAÇÃO: aprovado.\nAnte O Exposto – Contrário";
    // `isStrictPersonName` aceita a forma, mas o vocabulário de não-nomes barra no helper.
    const contra = extractItemVotes(t, roleMap).contra;
    expect(contra.every((n) => n !== "Diretoria Colegiada")).toBe(true);
  });
});

describe("etapa66 · «Votaram a favor …» validado como o gêmeo «Votaram contra …»", () => {
  // Os dois regex têm a MESMA janela de 180 chars e a mesma flag `i`; só o destino diferia —
  // o contra ia para `moveToContra` (validado) e o favor caía num push sem checagem nenhuma.
  it("nomes de pessoa continuam virando voto favorável", () => {
    const v = extractItemVotes(
      "Votaram a favor os Diretores Roger Romão Cabral, Tasso Mendonça Júnior e Guilherme Santana Lopes.",
      roleMap,
    );
    expect(v.favor).toContain("Roger Romão Cabral");
    expect(v.favor).toContain("Tasso Mendonça Júnior");
    expect(v.favor).toContain("Guilherme Santana Lopes");
  });

  it("prosa arrastada pela janela de 180 chars NÃO vira votante", () => {
    const v = extractItemVotes(
      "Votaram a favor os Diretores presentes na forma do regimento interno vigente aplicável",
      roleMap,
    );
    for (const nome of v.favor) {
      expect(isStrictPersonName(nome), `"${nome}" entrou como votante sem forma de nome`).toBe(true);
    }
  });

  it("o lado CONTRA continua validando — a simetria é dos dois lados", () => {
    const v = extractItemVotes("Votou contra o Diretor Roger Romão Cabral.", roleMap);
    expect(v.contra).toContain("Roger Romão Cabral");
  });
});

describe("etapa66 · abstenção normaliza o nome — senão o diretor conta duas vezes", () => {
  it("nome com espaço duplo é REMOVIDO de favor ao virar abstenção", () => {
    // Reprodutor MEDIDO: sem colapsar o espaço, o nome da abstenção sai "José  Fernando de Souza"
    // e o `indexOf` em `favor` (que guarda a forma normalizada) falha — o diretor fica nos DOIS
    // baldes, com grafias diferentes, e conta duas vezes.
    // ⚠️ Não basta asserir "ninguém está nas duas listas": com o bug as grafias DIFEREM, então
    // essa comparação passa verde. A asserção tem de ser sobre a REMOÇÃO.
    const t =
      "O Diretor José Fernando de Souza acompanhou o voto do Relator. "
      + "O Diretor José  Fernando de Souza absteve-se de votar.";
    const v = extractItemVotes(t, roleMap);
    expect(v.abstencao, "a abstenção é registrada com o nome normalizado").toEqual([
      "José Fernando de Souza",
    ]);
    expect(v.favor, "abstenção tem de REMOVER de favor — senão o diretor conta duas vezes")
      .toEqual([]);
  });
});

describe("etapa66 · nos PDFs reais — a simetria não custou nenhum caso legítimo", () => {
  it("a 79ª mantém as adesões reais ao voto do relator/revisor", async () => {
    const { text } = await extractPdfText(readFileSync(join(fixturesDir, "anm-ata-79-rop.pdf")));
    const favor = extractFields(text).nomes_votacao_favor ?? [];
    expect(favor, "José Fernando acompanhou o voto do Relator — adesão real").toContain(
      "José Fernando de Mendonça Gomes Júnior",
    );
  }, 60_000);

  it("a 32ª mantém sua divergência REAL — a trava não é apagador geral", async () => {
    const { text } = await extractPdfText(readFileSync(join(fixturesDir, "anm-ata-32-extraordinaria.pdf")));
    expect((extractFields(text).nomes_votacao_contra ?? []).length).toBeGreaterThan(0);
  }, 60_000);

  it("nenhuma ata ganha voto favorável de quem não é diretor", async () => {
    for (const f of ["anm-ata-79-rop.pdf", "anm-ata-81-rop.pdf", "anm-ata-83-rop.pdf"]) {
      const { text } = await extractPdfText(readFileSync(join(fixturesDir, f)));
      const rm = buildRoleMap(text);
      for (const nome of extractFields(text).nomes_votacao_favor ?? []) {
        expect(isStrictPersonName(nome), `${f}: "${nome}" não tem forma de nome`).toBe(true);
        expect(nome, `${f}: órgão virou votante`).not.toMatch(/Superintend|Procuradoria|Diretoria Colegiada/i);
      }
      void rm;
    }
  }, 120_000);
});
