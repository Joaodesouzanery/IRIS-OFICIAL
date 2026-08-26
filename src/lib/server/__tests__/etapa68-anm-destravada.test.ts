/**
 * Etapa 68 (Fase 7) — a ANM destravada.
 *
 * ═══ O bug ═══
 * `classifyLinkType` recebe `${texto} ${href}` com a URL ABSOLUTA, e testava
 * `/\b(diretoria|diretores?|composi)/` ANTES de voto/ata/deliberacao/pauta. As quatro fontes da
 * ANM vivem sob `/pt-br/composicao/diretoria-colegiada/…` — ou seja, casavam DUAS vezes naquele
 * teste, em TODO link, qualquer que fosse o texto. Resultado: toda ata da ANM virava
 * `tipo='diretoria'`, que está fora das DUAS portas de enfileiramento (`DECISION_TIPOS` do
 * enqueue-pdfs e a allowlist do auto-enqueue). Trava dupla: 0 reuniões, 0 deliberações, 0 votos,
 * e 326 itens "detectados" que não sairiam de `novo` em rodada nenhuma.
 *
 * ═══ Por que este arquivo tem DUAS baterias ═══
 * A certificação (16 docs / 164 expectativas) é sobre EXTRAÇÃO — ela ficaria verde mesmo se esta
 * mudança passasse a admitir centenas de páginas institucionais como ata, porque ela nunca vê
 * quantos documentos ENTRAM. Por isso o guard de falso positivo é tão obrigatório quanto o de
 * falso negativo: um prova que a ata entra, o outro prova que "Composição da Diretoria" não entra.
 */

import { describe, it, expect } from "vitest";
import { classifyLinkType } from "@/lib/server/monitoring";
import { podeVirarVoto } from "@/lib/esteira-tipos";

/** As quatro fontes REAIS da ANM, como estão semeadas na migration 20260518160356. */
const ANM = "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada";
const ANM_ROP = `${ANM}/reunioes-da-diretoria-colegiada`;

describe("etapa68 · FALSO NEGATIVO: a ata da ANM tem de entrar na esteira", () => {
  const casos: Array<[string, string, string]> = [
    ["Ata da 85ª ROP", `${ANM_ROP}/atas-da-rop/sei_ata_85_rop.pdf`, "ata"],
    ["Atas da ROP", `${ANM_ROP}/atas-da-rop`, "ata"],
    ["Ata da 32ª Reunião Extraordinária", `${ANM}/atas/ata-32-rep.pdf`, "ata"],
    ["Atas", `${ANM}/atas`, "ata"],
    ["Pauta da 86ª ROP", `${ANM_ROP}/pautas-da-rop/pauta-86.pdf`, "pauta"],
    ["Pautas", `${ANM}/pautas`, "pauta"],
    ["Voto do Diretor Relator", `${ANM_ROP}/votos/voto-dg-12-2026.pdf`, "voto"],
    ["Resolução deliberada na 85ª ROP", `${ANM_ROP}/deliberacoes/res-85.pdf`, "deliberacao"],
  ];

  it.each(casos)("«%s» → tipo «%s»", (texto, href, esperado) => {
    const tipo = classifyLinkType(texto, href);
    expect(tipo, `a URL contém /composicao/diretoria-colegiada/ e engolia tudo`).toBe(esperado);
  });

  it.each(casos)("«%s» é ENFILEIRÁVEL (senão a correção não serve para nada)", (texto, href) => {
    // O teste de tipo sozinho não bastaria: `diretoria` também é "um tipo". O que importa é o
    // documento atravessar a porta do enfileiramento.
    expect(podeVirarVoto(classifyLinkType(texto, href))).toBe(true);
  });
});

describe("etapa68 · FALSO POSITIVO: página institucional NÃO pode virar decisão", () => {
  // O outro lado do guard. Sem ele, a "correção" poderia encher a esteira de páginas que nunca
  // foram documento de decisão — e a certificação não perceberia.
  const institucionais: Array<[string, string]> = [
    ["Composição da Diretoria Colegiada", `${ANM}`],
    ["Diretoria Colegiada", `${ANM}/`],
    ["Quem é quem", `${ANM}/quem-e-quem`],
    ["Diretor-Geral", `${ANM}/diretor-geral`],
    ["Diretores", `${ANM}/diretores`],
    ["Competências da Diretoria", `${ANM}/competencias`],
    ["Reuniões da Diretoria Colegiada", ANM_ROP],
  ];

  it.each(institucionais)("«%s» continua FORA da esteira de votos", (texto, href) => {
    const tipo = classifyLinkType(texto, href);
    expect(podeVirarVoto(tipo), `«${texto}» (${tipo}) não é documento de decisão`).toBe(false);
  });

  it("os atos sobre PESSOAS continuam indo para Governança, não para a esteira", () => {
    expect(classifyLinkType("Portaria de nomeação do Diretor", `${ANM}/nomeacao.pdf`)).toBe("ato_nomeacao");
    expect(classifyLinkType("Exoneração", `${ANM}/exoneracao.pdf`)).toBe("ato_nomeacao");
    expect(classifyLinkType("Mandatos da Diretoria", `${ANM}/mandatos`)).toBe("mandato");
    for (const t of ["ato_nomeacao", "mandato"]) expect(podeVirarVoto(t)).toBe(false);
  });
});

describe("etapa68 · a ordem é a correção — e ela não pode voltar", () => {
  it("DECISÃO vence DIRETORIA quando os dois casam ao mesmo tempo", () => {
    // O caso mínimo do bug: um href que contém as duas palavras.
    expect(classifyLinkType("Ata", "https://x/composicao/diretoria-colegiada/ata-1.pdf")).toBe("ata");
  });

  it("DIRETORIA continua vencendo quando NENHUMA decisão casa", () => {
    expect(classifyLinkType("Composição", "https://x/composicao/diretoria-colegiada/")).toBe("diretoria");
  });

  it("as outras duas agências não regridem", () => {
    expect(classifyLinkType("Ata da 1036ª Reunião de Diretoria", "https://portal.antt.gov.br/ata-1036.pdf")).toBe("ata");
    expect(classifyLinkType("Voto DFQ 041/2026", "https://portal.antt.gov.br/voto-dfq-041.pdf")).toBe("voto");
    expect(classifyLinkType("Reunião de Diretoria 12/08", "https://www.artesp.sp.gov.br/reuniao-12-08")).toBe("reuniao");
  });
});
