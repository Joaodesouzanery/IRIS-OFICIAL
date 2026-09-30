/**
 * Etapa 216 (Fase 36, Bloco A) — a ESCRITA do colegiado parcial, desligada, e os dois filtros
 * sem os quais ela DANIFICA em vez de completar.
 *
 * ═══ Filtro 1 — `apenasQuemFalta`, e por que a ausência dele não é inofensiva ═══
 * `buildVotoRows` devolve linha para o roster INTEIRO. Num item parcial isso inclui quem já
 * respondeu. O upsert do `postgrest` usa a **união das colunas do lote com `defaultToNull`**: uma
 * coluna ausente em qualquer linha do lote vira **NULL na linha existente**. Reenviar quem já
 * respondeu apaga o `motivo_nao_voto` de um `Ausente` lido do documento e o transforma em ausência
 * sem motivo. Foi a correção 4 do usuário, e a mutação que ela pede é a remoção deste filtro.
 *
 * ═══ Filtro 2 — o PORTÃO, e por que ele não é o gabarito ═══
 * O gabarito certificado cobre 79ª/81ª/83ª e 1.024ª/264ª. Os primeiros alvos desta escrita são a
 * **84ª e a 86ª** — que gabarito nenhum confere. Um portão que consulta gabarito vazio é um portão
 * aberto. O portão é o PREÂMBULO: só recebe voto quem o documento nomeia como presente. A Fase 20
 * mediu o preço de inferir pelo mandato — na 79ª ROP o preâmbulo nomeia Roger e Tasso e o mandato
 * devolve Caio Mário no lugar deles, ou seja, voto no nome ERRADO.
 *
 * ⚠️ E a recusa (a) era mais LARGA que o reparo que ela invocava — ver `etapa210`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  COMPLETAR_PARCIAL,
  apenasQuemFalta,
  paresAutorizadosPeloDocumento,
} from "../completar-colegiado";
import { ehVotoDeDirecao } from "../../votos-nominal";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const MAT = semComentarios(ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts"));
const PLACAR = semComentarios(ler("src/app/api/v1/admin/placar/route.ts"));

describe("etapa216 · ⚠️ a escrita nasce DESLIGADA", () => {
  it("a constante é false, e mora no LIB — `export const` em route.ts quebra o next build", () => {
    expect(COMPLETAR_PARCIAL).toBe(false);
    expect(MAT).toMatch(/import \{[\s\S]{0,200}COMPLETAR_PARCIAL/);
    expect(MAT, "a constante voltou para a rota — o App Router só aceita nomes reservados")
      .not.toMatch(/export const COMPLETAR_PARCIAL/);
  });

  it("e com ela desligada o lote a escrever é ESVAZIADO, não apenas 'não gravado'", () => {
    expect(MAT).toMatch(/if \(!COMPLETAR_PARCIAL\) rowsParaEscrever = \[\];/);
  });

  it("a resposta declara o estado da constante ao lado do número", () => {
    // Um "pares planejados" sem dizer se a escrita está ligada se lê como "já aconteceu".
    expect(MAT).toMatch(/completar_parcial_ligado: COMPLETAR_PARCIAL/);
    expect(MAT).toMatch(/parcial_pares_autorizados: parcialPlanejados/);
  });
});

describe("etapa216 · ⚠️ FILTRO 1: só quem falta (a correção 4 do usuário)", () => {
  const linhas = [
    { diretor_id: "mauro", tipo_voto: "Favoravel" },
    { diretor_id: "fabio", tipo_voto: "Favoravel" },
    { diretor_id: "jose", tipo_voto: "Favoravel" },
    { diretor_id: "luiz", tipo_voto: "Favoravel" },
  ];

  it("quem já respondeu NÃO volta no lote", () => {
    const fora = apenasQuemFalta(linhas, ["mauro", "luiz"]).map((l) => l.diretor_id);
    expect(fora).toEqual(["fabio", "jose"]);
  });

  it("com todos respondidos, o lote fica VAZIO — e vazio é o resultado certo", () => {
    expect(apenasQuemFalta(linhas, ["mauro", "fabio", "jose", "luiz"])).toEqual([]);
  });

  it("sem ninguém respondido, passa tudo", () => {
    expect(apenasQuemFalta(linhas, []).length).toBe(4);
  });

  it("não muta a entrada — o chamador reusa `rows` para o delta", () => {
    const copia = [...linhas];
    apenasQuemFalta(linhas, ["mauro"]);
    expect(linhas).toEqual(copia);
  });

  it("⚠️ e o materializador USA o filtro antes de montar o lote", () => {
    expect(MAT, "o filtro `apenasQuemFalta` saiu do caminho da escrita parcial")
      .toMatch(/const faltando = apenasQuemFalta\(rows, jaResponderam\)\.map\(\(r\) => r\.diretor_id\)/);
    // E o lote é construído a partir dos AUTORIZADOS, não de `rows`.
    expect(MAT).toMatch(/rowsParaEscrever = rows\.filter\(\(r\) => autorizados\.has\(r\.diretor_id\)\)/);
    expect(MAT, "a escrita parcial voltou a mandar `rows` cru para o upsert")
      .not.toMatch(/completarParcial[\s\S]{0,600}upsertVotosProtegido\(db, rows\)/);
  });
});

describe("etapa216 · ⚠️ FILTRO 2: o portão é o preâmbulo, não o mandato", () => {
  it("só passa quem o documento nomeia como presente", () => {
    const r = paresAutorizadosPeloDocumento({
      faltando: ["jose", "caio"],
      presentesNoDocumento: ["mauro", "fabio", "jose"],
    });
    expect(r.autorizados).toEqual(["jose"]);
    expect(r.barrados, "Caio não está no preâmbulo — é o caso REAL da 79ª ROP").toEqual(["caio"]);
  });

  it("⚠️ documento SEM preâmbulo casado barra TODOS — voto ausente se vê, voto errado não", () => {
    const r = paresAutorizadosPeloDocumento({ faltando: ["jose", "caio"], presentesNoDocumento: [] });
    expect(r.autorizados).toEqual([]);
    expect(r.barrados).toEqual(["jose", "caio"]);
  });

  it("nada a completar devolve nada — não inventa autorização nem barra o inexistente", () => {
    const r = paresAutorizadosPeloDocumento({ faltando: [], presentesNoDocumento: ["mauro"] });
    expect(r.autorizados).toEqual([]);
    expect(r.barrados).toEqual([]);
  });

  it("autorizados + barrados fecha com o que faltava — nenhum par evapora", () => {
    const faltando = ["a", "b", "c", "d"];
    const r = paresAutorizadosPeloDocumento({ faltando, presentesNoDocumento: ["b", "d", "z"] });
    expect([...r.autorizados, ...r.barrados].sort()).toEqual([...faltando].sort());
  });

  it("⚠️ o portão usa o preâmbulo do PAI mesmo com PRESENTES_DO_PAI_VALEM desligado", () => {
    // Aquela flag decide quem compõe o ROSTER; aqui a pergunta é se o documento nomeia a pessoa.
    // Sem isto o portão barraria 100% dos itens de ata da ANM — a população que o Bloco A visa.
    const i = MAT.indexOf("const nomesParaPortao =");
    expect(i, "o portão perdeu a fonte de presentes").toBeGreaterThan(-1);
    const bloco = MAT.slice(i, i + 400);
    expect(bloco).toMatch(/presentesDoProprio\.length > 0 \? presentesDoProprio : presentesDoPai/);
    expect(bloco, "um laço de match próprio faria o portão discordar do motor")
      .toMatch(/resolverPresentesRoster\(nomesParaPortao, diretoresList\)/);
  });

  it("e o barramento tem MOTIVO separado — 'sem preâmbulo' ≠ 'não estava na sala'", () => {
    expect(MAT).toMatch(/presentesNoDocumento\.length === 0 \? "sem_presentes_no_documento" : "presente_nao_nomeado"/);
  });
});

describe("etapa216 · o modo é EXCLUSIVO, e o motivo é de orçamento", () => {
  it("troca a população em vez de somar trabalho", () => {
    expect(MAT).toMatch(/const semVotoTotal = completarParcial/);
    expect(MAT).toMatch(/const completarParcial = body\.completar_parcial === true/);
  });

  it("⚠️ e o reparo de artefato NÃO roda — era ele que faria `restantes` ficar eterno", () => {
    expect(MAT).toMatch(/if \(!completarParcial\) \{[\s\S]{0,400}artefato/i);
  });

  it("⚠️ nem o DIAGNÓSTICO é gravado: `motivo_sem_voto` é afirmação sobre quem NÃO tem voto", () => {
    expect(MAT).toMatch(/if \(!dryRun && !completarParcial && patchPorDeliberacao\.size > 0\)/);
    expect(MAT).toMatch(/for \(const d of \(completarParcial \? \[\] : semVoto\) as any\[\]\)/);
    expect(MAT).toMatch(/for \(const d of \(completarParcial \? \[\] : loteBruto\) as any\[\]\)/);
  });

  it("a população parcial exige voto E menos votantes que o cadastro", () => {
    const i = MAT.indexOf("const semVotoTotal = completarParcial");
    const bloco = MAT.slice(i, i + 900);
    expect(bloco).toMatch(/if \(!votantes \|\| votantes\.size === 0\) continue;/);
    expect(bloco).toMatch(/if \(cadastro\.length === 0 \|\| votantes\.size >= cadastro\.length\) continue;/);
  });

  it("e `votantesPorDelib` existe porque sem `diretor_id` não há como saber QUEM falta", () => {
    expect(MAT).toMatch(/db\.from\("votos"\)\.select\("deliberacao_id, diretor_id"\)/);
  });
});

describe("etapa216 · o número do placar é TETO, e ele diz isso", () => {
  it("o alerta declara que o roster dali é de MANDATO e que o motor planeja menos", () => {
    const i = PLACAR.indexOf("par(es) (deliberação × diretor) poderiam receber voto inferido");
    expect(i).toBeGreaterThan(-1);
    const bloco = PLACAR.slice(i, i + 700);
    expect(bloco, "o número voltou a ser publicado sem o rótulo de teto").toMatch(/É TETO/);
    expect(bloco).toMatch(/PRESENTES do documento/);
    expect(bloco).toMatch(/DESLIGADA/);
  });

  it("⚠️ e o placar passa a ler nominalidade pela fonte única + tipo de voto", () => {
    expect(PLACAR).toMatch(/select\("deliberacao_id, diretor_id, is_nominal, proveniencia, tipo_voto"\)/);
    expect(PLACAR, "voltou a ler `is_nominal` cru — voto revisao_humana contaria como inferido")
      .not.toMatch(/if \(v\.is_nominal === true\) temNominalPorDelib\.add/);
    expect(PLACAR).toMatch(/if \(ehVotoDeDirecao\(v\.tipo_voto\)\) temNominalDeDirecaoPorDelib\.add/);
  });

  it("e `Ausente` não é voto de direção — era o falso positivo da ARTESP", () => {
    expect(ehVotoDeDirecao("Ausente")).toBe(false);
    expect(ehVotoDeDirecao("Favoravel")).toBe(true);
    expect(ehVotoDeDirecao("Desfavoravel")).toBe(true);
    expect(ehVotoDeDirecao("Abstencao")).toBe(true);
    expect(ehVotoDeDirecao(null)).toBe(false);
    expect(ehVotoDeDirecao(undefined)).toBe(false);
  });
});
