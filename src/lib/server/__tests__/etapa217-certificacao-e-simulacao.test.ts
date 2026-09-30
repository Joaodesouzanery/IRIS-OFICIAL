/**
 * Etapa 217 (Fase 36, Bloco B.0) — o portão do revoto, e por que ele NÃO pode ser o banco.
 *
 * ═══ O erro de lógica que o usuário pegou ═══
 * Eu havia proposto: "o comparador banco × gabarito bate ANTES do revoto". Não pode — é justamente o
 * revoto que faz bater. O portão seria circular e nunca abriria.
 *
 * O portão é a **SIMULAÇÃO**: o roster que o motor USARIA na data certa, em memória, sem escrever.
 * Se ele reproduz o colegiado do gabarito, corrigir a data e refazer o voto produz o gabarito. Se não
 * reproduz, o revoto trocaria um erro por outro — e aí ele não liga.
 *
 * O comparador banco × gabarito continua existindo, como VERIFICAÇÃO depois de aplicar. Ele é o que
 * preenche `certificacao_no_banco`, hoje um zero fixo com `pendente: true` no placar.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  certificarContraGabarito,
  simularColegiadoNaDataCerta,
  votosEsperadosDe,
  itensEsperadosDe,
  type AtaDoGabarito,
} from "@/lib/server/certificacao-gabarito";

const RAIZ = join(__dirname, "../../../..");
const BASELINE = JSON.parse(
  readFileSync(join(RAIZ, "src/lib/server/__tests__/fixtures/votos/votos-por-diretor-baseline.json"), "utf-8"),
) as Record<string, AtaDoGabarito | unknown>;

/** Só as atas — o arquivo tem chaves de prosa (`_comment`, `_causas_das_divergencias`). */
const ATAS: Record<string, AtaDoGabarito> = Object.fromEntries(
  Object.entries(BASELINE).filter(([k, v]) => !k.startsWith("_") && Array.isArray((v as AtaDoGabarito)?.colegiado)),
) as Record<string, AtaDoGabarito>;

const ANM_81 = ATAS["anm-ata-81-rop.pdf"];
const ANM_83 = ATAS["anm-ata-83-rop.pdf"];

describe("etapa217 · o gabarito é internamente consistente — e isso se exercita", () => {
  it("as cinco atas estão lá", () => {
    expect(Object.keys(ATAS).sort()).toEqual([
      "anm-ata-79-rop.pdf", "anm-ata-81-rop.pdf", "anm-ata-83-rop.pdf",
      "antt-ata-1024.pdf", "antt-ata-264-rde.pdf",
    ]);
  });

  it("⚠️ `votos = itens_decididos − impedidos` vale em TODAS — se não valesse, a régua seria outra", () => {
    for (const [arquivo, ata] of Object.entries(ATAS)) {
      for (const d of ata.colegiado) {
        expect(d.votos, `${arquivo} · ${d.nome}`).toBe(votosEsperadosDe(ata, d));
      }
    }
  });

  it("e a contagem de ITENS é outra conta: decididos + sem decisão", () => {
    // "Retirado de Pauta" vira LINHA no banco e não gera voto. Misturar as duas contas faria o
    // comparador acusar item faltando onde só falta voto.
    expect(itensEsperadosDe(ANM_81)).toBe(68);
    expect(itensEsperadosDe(ANM_83)).toBe(55);
  });
});

describe("etapa217 · ⚠️ A SIMULAÇÃO — o portão, e ele roda ANTES de escrever", () => {
  const gabarito81 = ANM_81.colegiado.map((d) => ({ nome: d.nome, nome_variantes: d.variantes }));

  it("o roster da data certa reproduz o colegiado → o portão abre", () => {
    expect(simularColegiadoNaDataCerta(ANM_81, gabarito81)).toEqual({
      reproduz: true, faltando: [], sobrando: [],
    });
  });

  it("⚠️ o roster da data ERRADA (2 diretores) NÃO reproduz — é o estado de hoje", () => {
    // Os votos das 81ª/82ª/83ª foram gravados com a data errada, numa janela em que só dois tinham
    // mandato. É exatamente este caso que o portão tem de barrar antes de o revoto rodar.
    const r = simularColegiadoNaDataCerta(ANM_81, [
      { nome: "Mauro Henrique Moreira Sousa" },
      { nome: "José Fernando de Mendonça Gomes Júnior" },
    ]);
    expect(r.reproduz).toBe(false);
    expect(r.faltando.sort()).toEqual(["Fábio Fernando Borges", "Luiz Paniago Neves"]);
    expect(r.sobrando).toEqual([]);
  });

  it("⚠️ nome A MAIS reprova igual — é voto INVENTADO para quem a ata não põe na sala", () => {
    // O caso do Caio Mário na 79ª: o mandato dizia que ele estava, a ata dizia que não.
    const r = simularColegiadoNaDataCerta(ANM_81, [
      ...gabarito81, { nome: "Caio Mário Trivellato Seabra Filho" },
    ]);
    expect(r.reproduz).toBe(false);
    expect(r.faltando).toEqual([]);
    expect(r.sobrando).toEqual(["Caio Mário Trivellato Seabra Filho"]);
  });

  it("⚠️ roster VAZIO nunca reproduz — `getActiveDiretoresForVote` devolve [] também em ERRO", () => {
    /**
     * Esta é a guarda mais importante do arquivo. Um portão que aceitasse vazio liberaria o revoto
     * exatamente quando o banco não respondeu — e o revoto apaga.
     */
    const r = simularColegiadoNaDataCerta(ANM_81, []);
    expect(r.reproduz).toBe(false);
    expect(r.faltando.length).toBe(4);
  });

  it("⚠️ e o gabarito com colegiado VAZIO também não reproduz — o «0 de 0 = 100%»", () => {
    /**
     * Esta expectativa existe porque a mutação que remove a guarda SOBREVIVEU ao caso anterior: com
     * roster vazio o laço já devolvia `false`, mas com os DOIS lados vazios `faltando` e `sobrando`
     * saem vazios e a função diria `reproduz: true` — o portão do revoto abriria com nada dos dois
     * lados, liberando uma escrita que APAGA.
     */
    const vazio: AtaDoGabarito = { ...ANM_81, colegiado: [] };
    expect(simularColegiadoNaDataCerta(vazio, []).reproduz).toBe(false);
    expect(simularColegiadoNaDataCerta(vazio, [{ nome: "Qualquer Um" }]).reproduz).toBe(false);
  });

  it("casa por VARIANTE — o nome do cadastro raramente é o do PDF", () => {
    const r = simularColegiadoNaDataCerta(ANM_81, [
      { nome: "Mauro Sousa" }, { nome: "Luiz Paniago Neves" },
      { nome: "Fábio Borges" }, { nome: "José Fernando" },
    ]);
    expect(r.reproduz, `faltando=${r.faltando} sobrando=${r.sobrando}`).toBe(true);
  });
});

describe("etapa217 · o comparador BANCO × GABARITO — a verificação depois de aplicar", () => {
  const bancoPerfeito = (ata: AtaDoGabarito) => ({
    itens: itensEsperadosDe(ata),
    votosPorDiretor: ata.colegiado.map((d) => ({ nome: d.nome, votos: votosEsperadosDe(ata, d) })),
  });

  it("banco igual ao gabarito: tudo bate, zero divergências", () => {
    const r = certificarContraGabarito(ATAS, Object.fromEntries(
      Object.entries(ATAS).map(([k, a]) => [k, bancoPerfeito(a)]),
    ));
    expect(r).toEqual({ conferidas: 5, batem: 5, divergem: [] });
  });

  it("⚠️ o estado de HOJE na 81ª: 61 linhas de 68, e dois diretores sem voto", () => {
    // É o retrato que o usuário mediu. O comparador tem de nomear as duas coisas separadamente:
    // item faltando é falha de COLETA (corrigir data não traz item que nunca entrou); diretor sem
    // voto é o revoto.
    const r = certificarContraGabarito({ "anm-ata-81-rop.pdf": ANM_81 }, {
      "anm-ata-81-rop.pdf": {
        itens: 61,
        votosPorDiretor: [
          { nome: "Mauro Henrique Moreira Sousa", votos: 61 },
          { nome: "José Fernando de Mendonça Gomes Júnior", votos: 61 },
        ],
      },
    });
    expect(r.batem).toBe(0);
    const tipos = r.divergem.map((d) => d.tipo).sort();
    expect(tipos).toEqual(["contagem_de_votos", "contagem_de_votos", "diretor_sem_voto", "diretor_sem_voto", "itens_faltando"]);
    const itens = r.divergem.find((d) => d.tipo === "itens_faltando")!;
    expect(itens).toEqual({ ata: "anm-ata-81-rop.pdf", tipo: "itens_faltando", esperado: 68, encontrado: 61 });
    expect(r.divergem.filter((d) => d.tipo === "diretor_sem_voto").map((d) => d.diretor).sort())
      .toEqual(["Fábio Fernando Borges", "Luiz Paniago Neves"]);
  });

  it("⚠️ ata AUSENTE do banco não conta como acerto", () => {
    // Contar ausência como "bate" é o formato de zero que este projeto mede desde a Fase 17
    // ("cobertura dizia completa com site=0").
    const r = certificarContraGabarito({ "anm-ata-81-rop.pdf": ANM_81 }, {});
    expect(r.batem).toBe(0);
    expect(r.conferidas).toBe(1);
    expect(r.divergem.find((d) => d.tipo === "itens_faltando")?.encontrado).toBe(0);
  });

  it("votante que a ata NÃO põe no colegiado sai como `diretor_a_mais`", () => {
    const banco = bancoPerfeito(ANM_83);
    banco.votosPorDiretor.push({ nome: "Caio Mário Trivellato Seabra Filho", votos: 49 });
    const r = certificarContraGabarito({ "anm-ata-83-rop.pdf": ANM_83 }, { "anm-ata-83-rop.pdf": banco });
    expect(r.divergem.map((d) => d.tipo)).toEqual(["diretor_a_mais"]);
    expect(r.divergem[0].diretor).toBe("Caio Mário Trivellato Seabra Filho");
  });

  it("linha a MAIS no banco é duplicata, e sai nomeada", () => {
    const banco = { ...bancoPerfeito(ANM_83), itens: 60 };
    const r = certificarContraGabarito({ "anm-ata-83-rop.pdf": ANM_83 }, { "anm-ata-83-rop.pdf": banco });
    expect(r.divergem).toEqual([
      { ata: "anm-ata-83-rop.pdf", tipo: "itens_a_mais", esperado: 55, encontrado: 60 },
    ]);
  });

  it("⚠️ o IMPEDIMENTO é respeitado: 44 votos do José Fernando na 83ª é ACERTO, não falta", () => {
    // Ele é impedido em 5 dos 49 itens decididos. Um comparador que exigisse 49 acusaria falta onde
    // a ata declara impedimento — e mandaria alguém "consertar" um voto que não deve existir.
    const banco = bancoPerfeito(ANM_83);
    expect(banco.votosPorDiretor.find((v) => v.nome.startsWith("José Fernando"))?.votos).toBe(44);
    const r = certificarContraGabarito({ "anm-ata-83-rop.pdf": ANM_83 }, { "anm-ata-83-rop.pdf": banco });
    expect(r.divergem).toEqual([]);
  });
});
