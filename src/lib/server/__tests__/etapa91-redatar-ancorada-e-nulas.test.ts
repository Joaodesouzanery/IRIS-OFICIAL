/**
 * Etapa 91 (Fase 15, commit C) — a re-derivação fica honesta, completa, e dentro da esteira.
 *
 * ═══ Os três consertos ═══
 * 1. HONESTA: a `redatar` dizia "SÓ o caminho ancorado" e chamava `extractFields`, cujos
 *    `parseDataExtenso`/`parseDataNumerica` têm fallback "primeira data do documento" — o MESMO
 *    mecanismo que gravou 32 deliberações da ANM em 1996 (a data da Lei nº 9.314 citada no
 *    preâmbulo). O guard `dataReuniaoPlausivel` só reprova ano ANTERIOR à criação da agência:
 *    uma lei de 2019 citada num ato de 2026 passaria e seria gravada com convicção de conserto.
 *    Agora existe `extractDataReuniaoAncorada` — sem nenhum fallback — e a rota usa ELA.
 * 2. COMPLETA: 74 deliberações com `data_reuniao NULL` (66 ANTT + 8 ARTESP, QA da Fase 14)
 *    estavam fora da rota POR CONSTRUÇÃO (`.not("data_reuniao","is",null)`). Elas somem da
 *    listagem e das reuniões E inflam as agregações de todo ano (`year-filter` deixa passar
 *    quem não tem data nenhuma). Ganharam janela própria, com fontes ANCORADAS em ordem de
 *    confiança: reunião vinculada → item de monitoramento (parse da listagem, mantido fresco
 *    pelo crawl auto-reparador) → texto do documento pelo caminho ancorado.
 * 3. NA ESTEIRA: a rota existia desde a Fase 9 e nunca foi chamada — sem botão, sem cron, sem
 *    passo. Passivo sem dono não fecha. Vira passo planejável do "Rodar tudo".
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { extractDataReuniaoAncorada, extractFields } from "@/lib/server/nlp-extractor";
import { RESERVA, ORDEM_DOS_PASSOS, PASSOS_CAUDA, TETO_FATIA } from "@/lib/server/esteira-reservas";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
const ROTA = ler("src/app/api/v1/admin/deliberacoes/redatar/route.ts");
const RUN = ler("src/app/api/v1/pipeline/run/route.ts");
const CODIGO_ROTA = semComentarios(ROTA);

// O preâmbulo real que produziu o bug: a única data do texto é a da LEI citada.
const PREAMBULO_1996 =
  "A DIRETORIA COLEGIADA DA ANM, no uso das atribuições que lhe confere a Lei nº 9.314, " +
  "de 14 de novembro de 1996, e considerando o disposto no processo em epígrafe, decide:";

describe("etapa91 · extractDataReuniaoAncorada não chuta", () => {
  it("texto SÓ com a data da lei citada → null (o fallback devolveria 1996)", () => {
    expect(extractDataReuniaoAncorada(PREAMBULO_1996)).toBeNull();
    // A prova de que a variante ancorada DIFERE do caminho cheio: o extractFields (extração
    // fresca, onde a primeira data do doc costuma ser a do próprio ato) ainda pesca 1996 aqui.
    // Se alguém "simplificar" a ancorada para delegar no caminho cheio, este par quebra.
    expect(extractFields(PREAMBULO_1996).data_reuniao).toBe("1996-11-14");
  });

  it("com âncora de reunião, extrai — extenso e numérico", () => {
    expect(
      extractDataReuniaoAncorada(`${PREAMBULO_1996} Reunião realizada em 12 de março de 2026.`),
    ).toBe("2026-03-12");
    expect(extractDataReuniaoAncorada("Reunião: 05/06/2026 — pauta anexa.")).toBe("2026-06-05");
  });

  it("cabeçalho de deliberação continua valendo (é âncora por natureza)", () => {
    expect(
      extractDataReuniaoAncorada("DELIBERAÇÃO ARTESP Nº 403, DE 10 DE JULHO DE 2026 " + PREAMBULO_1996),
    ).toBe("2026-07-10");
  });
});

describe("etapa91 · a rota usa a variante ancorada — na CHAMADA, não no comentário", () => {
  it("extractFields sumiu da rota", () => {
    expect(CODIGO_ROTA).toMatch(/extractDataReuniaoAncorada\(texto\)/);
    expect(CODIGO_ROTA).not.toMatch(/extractFields\(/);
  });
});

describe("etapa91 · a janela das NULAS", () => {
  it("existe, e não re-processa quem já foi marcado para revisão", () => {
    expect(CODIGO_ROTA).toMatch(/\.is\("data_reuniao", null\)/);
    expect(CODIGO_ROTA).toMatch(/precisa_revisao_data/);
  });

  it("fontes ancoradas na ordem de confiança: reunião vinculada → item de monitoramento → texto", () => {
    const janela = CODIGO_ROTA.slice(CODIGO_ROTA.indexOf('.is("data_reuniao", null)'));
    const iReuniao = janela.indexOf('from("reunioes")');
    const iItem = janela.indexOf('from("monitoramento_itens")');
    const iTexto = janela.indexOf("extractDataReuniaoAncorada");
    expect(iReuniao).toBeGreaterThan(-1);
    expect(iItem).toBeGreaterThan(iReuniao);
    expect(iTexto).toBeGreaterThan(iItem);
  });

  it("a data derivada das nulas passa pelo MESMO guard de plausibilidade", () => {
    const janela = CODIGO_ROTA.slice(CODIGO_ROTA.indexOf('.is("data_reuniao", null)'));
    expect(janela).toMatch(/dataReuniaoPlausivel\(sigla, nova\)/);
  });

  it("o ramo demo carrega TODAS as chaves novas (regra da etapa65)", () => {
    // Fim do recorte em `const guard` — "requireAdminOrCron" solto casaria primeiro na linha
    // de IMPORT (antes do ramo demo) e o slice sairia vazio: a armadilha da âncora-no-import.
    const demo = ROTA.slice(ROTA.indexOf('modo: "demo"'), ROTA.indexOf("const guard"));
    for (const chave of ["nulas_candidatas", "nulas_corrigidas", "nulas_marcadas_revisao"]) {
      expect(demo, `demo sem a chave ${chave}`).toContain(chave);
    }
  });
});

describe("etapa91 · redatar é um passo planejável da esteira", () => {
  it("tem reserva própria, barata — é hygiene, não ingestão", () => {
    expect(RESERVA.redatar).toBeGreaterThan(0);
    expect(RESERVA.redatar).toBeLessThanOrEqual(RESERVA.extracao / 2);
    expect(TETO_FATIA.redatar).toBeGreaterThanOrEqual(RESERVA.redatar);
  });

  it("está na ORDEM, mas NÃO na cauda — a cauda é o mínimo vital e já custa 32s", () => {
    expect(ORDEM_DOS_PASSOS).toContain("redatar");
    expect(PASSOS_CAUDA).not.toContain("redatar");
  });

  it("o orquestrador o chama com dry_run=0 — o passo da esteira GRAVA", () => {
    expect(RUN).toMatch(/call\(redatarPOST, "\/api\/v1\/admin\/deliberacoes\/redatar\?dry_run=0", "redatar"/);
  });

  it("fora do plano se declara, e parcial pede outra rodada — como todos os passos", () => {
    expect(RUN).toMatch(/etapas\.redatar = foraDoPlano\("redatar"\)/);
    const bloco = RUN.slice(RUN.indexOf('redatar?dry_run=0'), RUN.indexOf('foraDoPlano("redatar")'));
    expect(bloco).toMatch(/if \(r\.body\?\.restantes\) restantes = true;/);
  });

  it("o que foi redatado vira número no relatório", () => {
    expect(RUN).toMatch(/redatadas:/);
  });
});
