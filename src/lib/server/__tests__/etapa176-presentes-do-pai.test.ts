/**
 * Etapa 176 (Fase 31, Bloco 3) — os presentes do PAI valem para o FILHO? Medido e DESLIGADO.
 *
 * ═══ A causa raiz, em uma frase ═══
 * `nomes_presentes` é chave do DOCUMENTO (o preâmbulo da ata), não do item. A propagação por padrão
 * de `buildRawExtractionDoItem` só alcança chaves do item, então **o filho nasce sem ela — e é o
 * filho que carrega `resultado` e recebe voto**.
 *
 * Sem presentes, `materializar-faltantes` cai em `getActiveDiretoresForVote`, que escolhe quem vota
 * pela tabela `mandatos` e nunca consulta o preâmbulo. Na 79ª ROP da ANM (26/11/2025) a ata nomeia
 * Mauro + Tasso + Roger + José Fernando; o mandato devolve Mauro + Caio Mário + José Fernando.
 * Produção tem Caio Mário com 18 votos que a ata não lhe dá, e Tasso e Roger com zero votos que a
 * ata lhes dá.
 *
 * ⚠️ POR QUE DESLIGADO: ligar não muda um total que sobe ou desce — muda **QUEM votou**, que é
 * atribuição nominal a agente público. O número vai à tela antes de a regra valer, no precedente da
 * Fase 20.
 *
 * ⚠️ E A MEDIÇÃO RODA COM A FLAG DESLIGADA. Se ela dependesse da flag, "medido e desligado" seria só
 * "desligado", e o número que decide nunca apareceria. É a asserção central deste arquivo.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  buildRawExtractionDoItem,
  PRESENTES_DO_PAI_VALEM,
} from "@/lib/server/ata-item-materializacao";
import { naturezaDaChave, CHAVES_PARCIAIS } from "@/lib/server/agregar-rodadas";
import { resumirBackfill } from "@/lib/server/resumo-do-backfill";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const MOTOR = semComentarios(ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts"));
const MATERIALIZACAO = semComentarios(ler("src/lib/server/ata-item-materializacao.ts"));

const PRESENTES_79 = [
  "Mauro Henrique Moreira Sousa", "Tasso Mendonça Júnior",
  "Roger Romão Cabral", "José Fernando de Mendonça Gomes Júnior",
];

const itemBase = () => ({
  item_numero: "2.1.1", resultado: "Aprovado", unanimidade_detectada: true,
  votos_detectados: [], votos_contra_detectados: [], votos_abstencao_detectados: [],
  votos_ausentes_detectados: [], votos_impedidos_detectados: [], votos_em_autos_detectados: [],
  warnings: [],
}) as never;

describe("etapa176 · a regra está DESLIGADA, e é a flag que decide", () => {
  it("⚠️ `PRESENTES_DO_PAI_VALEM` é false", () => {
    // Ligar muda QUEM votou. Só vira `true` depois de você ler o número.
    expect(PRESENTES_DO_PAI_VALEM).toBe(false);
  });

  it("com a flag desligada, o filho NÃO recebe `nomes_presentes` — comportamento de hoje, intacto", () => {
    const raw = buildRawExtractionDoItem({
      item: itemBase(), documentoAnttTipo: null, documentoSubtipo: null,
      votosInferidosPorMandato: false, nomesPresentesDoPai: PRESENTES_79,
    });
    expect(raw.nomes_presentes).toBeUndefined();
  });

  it("a propagação é GATED pela flag — não por presença do campo", () => {
    // Se bastasse o campo chegar, a mudança de comportamento entraria pela porta de trás: o
    // chamador passaria os presentes e o roster mudaria sem ninguém decidir.
    expect(MATERIALIZACAO).toMatch(
      /if \(PRESENTES_DO_PAI_VALEM && input\.nomesPresentesDoPai !== undefined\)/,
    );
  });

  it("e o campo herdado existe na interface, na fatia própria dos campos do pai", () => {
    expect(MATERIALIZACAO).toMatch(/nomesPresentesDoPai\?: unknown;/);
  });

  it("sem o campo, nada muda mesmo com a flag — a ausência não inventa lista", () => {
    const raw = buildRawExtractionDoItem({
      item: itemBase(), documentoAnttTipo: null, documentoSubtipo: null,
      votosInferidosPorMandato: false,
    });
    expect(raw.nomes_presentes).toBeUndefined();
  });

  it("o resto do `raw_extraction` do item continua igual — a mudança é cirúrgica", () => {
    const raw = buildRawExtractionDoItem({
      item: itemBase(), documentoAnttTipo: null, documentoSubtipo: null,
      votosInferidosPorMandato: false, nomesPresentesDoPai: PRESENTES_79,
    });
    expect(raw.item_numero).toBe("2.1.1");
    expect(raw.nomes_votacao).toEqual([]);
    expect(raw.unanimidade_detectada).toBe(true);
    expect(raw.import_counts_as_final).toBe(true);
  });
});

describe("etapa176 · ⚠️ a MEDIÇÃO roda com a flag desligada", () => {
  it("o bloco de medição NÃO depende de `PRESENTES_DO_PAI_VALEM`", () => {
    // É a asserção central: se a medição fosse gated, "medido e desligado" seria só "desligado".
    const i = MOTOR.indexOf("if (presentesDoPai.length > 0)");
    expect(i, "o bloco de medição sumiu").toBeGreaterThan(-1);
    const bloco = MOTOR.slice(i, i + 500);
    expect(bloco, "a medição ficou atrás da flag e o número nunca apareceria")
      .not.toMatch(/PRESENTES_DO_PAI_VALEM/);
    expect(bloco).toMatch(/rosterMudariaComPresentesDoPai\+\+/);
  });

  it("os presentes do pai são BUSCADOS independentemente da flag", () => {
    // A leitura tem de acontecer para haver o que medir; só o USO é que está desligado.
    expect(MOTOR).toMatch(/const presentesDoPai = presentesDoProprio\.length === 0 && !isAnttAtaItem\s*\?\s*await presentesDoPaiDe\(d\)/);
  });

  it("⚠️ e o USO fica atrás da flag — com ela off, `presentes` é vazio como antes", () => {
    expect(MOTOR).toMatch(/PRESENTES_DO_PAI_VALEM \? presentesDoPai : \[\]/);
  });

  it("a medição compara CONJUNTOS de id, não tamanhos", () => {
    // Dois rosters de 3 pessoas podem ser pessoas diferentes — foi exatamente o caso da 79ª.
    const i = MOTOR.indexOf("if (presentesDoPai.length > 0)");
    const bloco = MOTOR.slice(i, i + 500);
    expect(bloco).toMatch(/\[\.\.\.idsComPai\]\.some\(\(id\) => !idsHoje\.has\(id\)\)/);
  });
});

describe("etapa176 · ⚠️ a leitura do pai é CACHEADA, e falha pelo lado seguro", () => {
  it("existe cache por pai — uma ata rende dezenas de filhos", () => {
    // Sem cache, a rodada gastaria a fatia em round-trips do MESMO registro. É o precedente de
    // `diagnostico-direcao:108-118`.
    expect(MOTOR).toMatch(/presentesDoPaiCache/);
    expect(MOTOR).toMatch(/presentesDoPaiCache\.set\(paiId, presentes\)/);
    const i = MOTOR.indexOf("async function presentesDoPaiDe");
    expect(MOTOR.slice(i, i + 400)).toMatch(/const hit = presentesDoPaiCache\.get\(paiId\);/);
  });

  it("erro de leitura do pai vira lista VAZIA, não exceção nem «ninguém estava lá»", () => {
    // Vazio cai no caminho de hoje (roster de mandato). O que não pode é um erro virar afirmação
    // sobre quem estava na sala.
    expect(MOTOR).toMatch(/const presentes = error \? \[\] : arr\(/);
  });

  it("sem pai, não há leitura nenhuma", () => {
    expect(MOTOR).toMatch(/if \(!paiId\) return \[\];/);
  });
});

describe("etapa176 · ⚠️ o número tem CONSUMIDOR e carrega o rótulo", () => {
  it("é declarado PARCIAL — a janela rotativa faz o item repetir entre rodadas", () => {
    expect(naturezaDaChave("roster_mudaria_com_presentes_do_pai")).toBe("parcial");
    expect(CHAVES_PARCIAIS.has("roster_mudaria_com_presentes_do_pai")).toBe(true);
  });

  it("a rota publica, e declara o estado da flag junto", () => {
    expect(MOTOR).toMatch(/roster_mudaria_com_presentes_do_pai: rosterMudariaComPresentesDoPai/);
    expect(MOTOR).toMatch(/presentes_do_pai_valem: PRESENTES_DO_PAI_VALEM/);
  });

  it("o resumo repassa — e só quando MEDIU algo", () => {
    const r = resumirBackfill({ roster_mudaria_com_presentes_do_pai: 7 } as never);
    expect(r.roster_mudaria_com_presentes_do_pai).toBe(7);
    // Zero de rodada que não chamou o materializador apagaria a medição anterior da tela.
    expect(resumirBackfill({ roster_mudaria_com_presentes_do_pai: 0 } as never)
      .roster_mudaria_com_presentes_do_pai).toBeUndefined();
    expect(resumirBackfill({} as never).roster_mudaria_com_presentes_do_pai).toBeUndefined();
  });

  it("⚠️ e a TELA lê, com o rótulo de repetição e dizendo que a regra está DESLIGADA", () => {
    const TELA = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");
    /**
     * ⚠️ A asserção é sobre a CONDIÇÃO, não sobre o identificador aparecer em algum lugar.
     * A primeira versão media `indexOf("totais.roster_...") > -1` e **sobreviveu à mutação** que
     * trocava a condição por `false` — o nome seguia no template da mensagem, então o teste passava
     * com a linha nunca renderizando. É o terceiro caso deste tipo nesta fase, e o padrão é sempre
     * o mesmo: verificar presença de texto em vez de quem governa o comportamento.
     */
    expect(TELA, "a linha do banner não é mais governada pelo número")
      .toMatch(/\(totais\.roster_mudaria_com_presentes_do_pai \?\? 0\) > 0/);
    const i = TELA.indexOf("(totais.roster_mudaria_com_presentes_do_pai ?? 0) > 0");
    const linha = TELA.slice(i, i + 600);
    expect(linha, "número parcial sem o rótulo de repetição").toMatch(/ROTULO_PARCIAL/);
    expect(linha, "a tela não diz que a regra está desligada").toMatch(/DESLIGADA/);
    // E o número tem de ser IMPRESSO, não só testado.
    expect(linha).toMatch(/\$\{totais\.roster_mudaria_com_presentes_do_pai\}/);
  });
});
