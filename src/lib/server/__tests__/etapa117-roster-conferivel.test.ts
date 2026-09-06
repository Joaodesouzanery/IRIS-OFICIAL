/**
 * Etapa 117 (Fase 20, commit 1) — não atribuir voto a quem não votou.
 *
 * ═══ O achado ═══
 * Os diretores da ANM Roger Romão Cabral e Tasso Mendonça Júnior aparecem em allow-list de nomes
 * e como "mandatos findos", mas **nenhuma migration lhes dá mandato verificado**. Na 79ª ROP
 * (26/11/2025) o preâmbulo REAL da ata nomeia Mauro + Tasso + Roger + José Fernando, e
 * `getActiveDiretoresForVote` devolve Mauro + Caio Mário + José Fernando.
 *
 * Isso não é lacuna de cobertura: é **voto gravado no nome errado**. Numa plataforma de
 * inteligência regulatória, atribuir um voto a um diretor que não estava na sala é o pior erro
 * possível — pior que não ter o voto.
 *
 * ═══ Três camadas, porque comparar só quando a ata nomeia deixaria o erro passar ═══
 * O guard óbvio (comparar preâmbulo × roster) cobre a 79ª ROP e falha em silêncio nas atas de
 * outro formato — que é exatamente onde o erro sobreviveria sem ninguém ver. Então:
 *   1. a ata NOMEIA          → compara com o roster;
 *   2. não nomeia, mas ASSINA → compara com `signatarios` (já extraído hoje);
 *   3. nem uma coisa nem outra → o sinal vem do CORPUS: se a agência tem `diretor_candidatos`
 *      PENDENTES na janela, o roster é sabidamente incompleto (Roger e Tasso são exatamente isso).
 *
 * O resíduo irredutível — agência sem candidato pendente E ata muda — é DECLARADO
 * (`roster_nao_conferivel`), não escondido.
 */

import { describe, it, expect } from "vitest";
import { conferirRoster } from "@/lib/server/roster-conferivel";

const ROSTER = [
  { id: "d1", nome: "Mauro Henrique Moreira Sousa", nome_variantes: [] },
  { id: "d2", nome: "Caio Mário Trivellato Seabra Filho", nome_variantes: [] },
  { id: "d3", nome: "José Fernando Coura", nome_variantes: [] },
];

describe("etapa117 · camada 1 — a ata NOMEIA os presentes", () => {
  it("COMPORTAMENTO: preâmbulo com nome que o roster não tem → BLOQUEIA", () => {
    // O caso real da 79ª ROP: a ata diz Tasso e Roger; o cadastro devolve Caio Mário.
    const r = conferirRoster({
      roster: ROSTER,
      nomesPresentes: [
        "Mauro Henrique Moreira Sousa",
        "Tasso Mendonça Júnior",
        "Roger Romão Cabral",
        "José Fernando Coura",
      ],
    });
    expect(r.confiavel).toBe(false);
    expect(r.motivo).toBe("roster_diverge_da_presenca");
    // E diz QUEM não foi reconhecido — sem isso ninguém consegue consertar o cadastro.
    expect(r.naoReconhecidos).toEqual(
      expect.arrayContaining(["Tasso Mendonça Júnior", "Roger Romão Cabral"]),
    );
  });

  it("presença que bate com o roster → confiável", () => {
    const r = conferirRoster({
      roster: ROSTER,
      nomesPresentes: ["Mauro Henrique Moreira Sousa", "José Fernando Coura"],
    });
    expect(r.confiavel).toBe(true);
  });

  it("variação de grafia não é divergência — o match usa as variantes", () => {
    const r = conferirRoster({
      roster: [{ id: "d1", nome: "José Fernando Coura", nome_variantes: ["Jose F. Coura"] }],
      nomesPresentes: ["Jose F. Coura"],
    });
    expect(r.confiavel).toBe(true);
  });
});

describe("etapa117 · camada 2 — a ata não nomeia, mas ASSINA", () => {
  it("COMPORTAMENTO: signatário fora do roster → BLOQUEIA (mesmo sem preâmbulo)", () => {
    const r = conferirRoster({
      roster: ROSTER,
      nomesPresentes: [],
      signatarios: ["Mauro Henrique Moreira Sousa", "Roger Romão Cabral"],
    });
    expect(r.confiavel).toBe(false);
    expect(r.motivo).toBe("roster_diverge_da_assinatura");
  });

  it("assinaturas todas no roster → confiável", () => {
    const r = conferirRoster({
      roster: ROSTER,
      nomesPresentes: [],
      signatarios: ["Mauro Henrique Moreira Sousa", "José Fernando Coura"],
    });
    expect(r.confiavel).toBe(true);
  });
});

describe("etapa117 · camada 3 — a ata é muda, mas o CORPUS fala", () => {
  it("COMPORTAMENTO: agência com candidato pendente → roster incompleto, BLOQUEIA", () => {
    // Roger e Tasso são exatamente isto: nomes detectados nos documentos, sem cadastro.
    // O sinal não vem da ata — vem do corpus —, e por isso funciona quando a ata não diz nada.
    const r = conferirRoster({
      roster: ROSTER,
      nomesPresentes: [],
      signatarios: [],
      candidatosPendentes: 2,
    });
    expect(r.confiavel).toBe(false);
    expect(r.motivo).toBe("cadastro_incompleto");
  });

  it("sem candidato pendente e ata muda → o resíduo é DECLARADO, não escondido", () => {
    const r = conferirRoster({ roster: ROSTER, nomesPresentes: [], signatarios: [], candidatosPendentes: 0 });
    // Continua inferindo (bloquear tudo mataria a ARTESP, que nunca nomina por desenho) —
    // mas a proveniência carrega que ninguém conseguiu conferir aquele roster.
    expect(r.confiavel).toBe(true);
    expect(r.motivo).toBe("roster_nao_conferivel");
  });

  it("roster vazio nunca é confiável — não há em quem inferir", () => {
    const r = conferirRoster({ roster: [], nomesPresentes: ["Fulano"] });
    expect(r.confiavel).toBe(false);
  });
});

describe("etapa117 · a ordem das camadas importa", () => {
  it("presença VENCE assinatura: quem estava na sala é o preâmbulo", () => {
    const r = conferirRoster({
      roster: ROSTER,
      nomesPresentes: ["Mauro Henrique Moreira Sousa"],
      signatarios: ["Roger Romão Cabral"],
      candidatosPendentes: 5,
    });
    expect(r.motivo).toBe("roster_confere_com_presenca");
    expect(r.confiavel).toBe(true);
  });
});
