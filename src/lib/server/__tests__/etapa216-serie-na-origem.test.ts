/**
 * Etapa 216 (Fase 36, Bloco E) — a série nasce certa, em vez de só ser consertada uma vez.
 *
 * ═══ A causa raiz ═══
 * `reuniao_ordinaria = firstMatch(text, RE_REUNIAO)` devolve o **grupo 1 = só os dígitos**
 * (`nlp-extractor.ts:30` e `:1069`) — a palavra "Ordinária/Extraordinária" está no match e é
 * DESCARTADA. Só a ANTT tem título completo (o parser dela sobrescreve o campo). Logo
 * `deriveSerie("1178")` é `null`, e era isso que o confirm e o redatar gravavam: **toda reunião nova
 * de ARTESP e ANM nascia sem série**. Uma migration por faixa consertaria o passivo e a reunião
 * seguinte nasceria NULL de novo.
 *
 * E série errada não é cosmética: o índice único de `reunioes` inclui `COALESCE(serie,'')`, então
 * corrigir uma data com a série divergente religa a reunião à linha errada ou cria duplicata. É por
 * isso que este bloco vem ANTES da correção das 202 datas.
 *
 * ═══ A precedência, e as duas recusas ═══
 * título → `tipo_reuniao` → faixa (último recurso). ⚠️ A ANTT **nunca** usa faixa, e na ARTESP a
 * faixa **vence** o `tipo_reuniao`. Os dois porquês estão nos casos abaixo.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { serieDaReuniao, deriveSerie } from "@/lib/server/reunioes";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("etapa216 · o TÍTULO vem primeiro — não se infere o que está dito", () => {
  it("título completo da ANTT resolve as quatro séries", () => {
    const t = (titulo: string) => serieDaReuniao({ sigla: "ANTT", titulo });
    expect(t("264ª Reunião Deliberativa Eletrônica")).toEqual({ serie: "eletronica", origem: "titulo" });
    expect(t("1.024ª Reunião de Diretoria")).toEqual({ serie: "ordinaria", origem: "titulo" });
    expect(t("99ª Reunião Extraordinária")).toEqual({ serie: "extraordinaria", origem: "titulo" });
    expect(t("195ª Reunião Administrativa")).toEqual({ serie: "administrativa", origem: "titulo" });
  });

  it("e o título vence a faixa, inclusive quando a faixa diria outra coisa", () => {
    // 264 está na faixa "200–999", mas o título diz Diretoria: o título manda.
    expect(serieDaReuniao({ sigla: "ARTESP", titulo: "246ª Reunião Ordinária", numeroReuniao: "246" }))
      .toEqual({ serie: "ordinaria", origem: "titulo" });
  });
});

describe("etapa216 · ⚠️ a ANTT NUNCA usa faixa", () => {
  it("sem título reconhecível, a ANTT devolve null — presumir juntaria séries distintas", () => {
    /**
     * Três motivos medidos: a série Administrativa ocupa 193–199 **intercalada** com as de 2026;
     * número lido errado cai abaixo de 200 ("1.024" já virou "024", e o coletor gravou "1" para
     * "1.036ª" até o `ec6970c`); e `tipo_reuniao` colapsa RD e RDE em "Ordinaria".
     */
    expect(serieDaReuniao({ sigla: "ANTT", titulo: "195", numeroReuniao: "195" }))
      .toEqual({ serie: null, origem: null });
    expect(serieDaReuniao({ sigla: "ANTT", titulo: null, numeroReuniao: "1038" }))
      .toEqual({ serie: null, origem: null });
  });

  it("nem por `tipo_reuniao` — ele colapsa RD e RDE em «Ordinaria»", () => {
    expect(serieDaReuniao({ sigla: "ANTT", titulo: "264", tipoReuniao: "Ordinaria", numeroReuniao: "264" }))
      .toEqual({ serie: null, origem: null });
  });
});

describe("etapa216 · ⚠️ na ARTESP a FAIXA vence o `tipo_reuniao`", () => {
  it("a 1177ª: o tipo diz Extraordinária e está ERRADO — a própria ARTESP retificou", () => {
    /**
     * `tipo_reuniao` da ARTESP é a primeira palavra "Ordinária/Extraordinária" que aparece no texto
     * (`nlp-extractor.ts:1119-1124`). A retificação está no corpus: *"Onde se lê: 1177ª Reunião
     * Extraordinária… Leia-se: 1177ª Reunião Ordinária"*. As duas séries dela não se cruzam entre
     * 246 e 1146, então a faixa é mais confiável que o rótulo.
     */
    expect(serieDaReuniao({ sigla: "ARTESP", titulo: "1177", tipoReuniao: "Extraordinaria", numeroReuniao: "1177" }))
      .toEqual({ serie: "ordinaria", origem: "faixa" });
  });

  it("e abaixo de 1000 é extraordinária", () => {
    expect(serieDaReuniao({ sigla: "ARTESP", titulo: "230", numeroReuniao: "230" }))
      .toEqual({ serie: "extraordinaria", origem: "faixa" });
  });

  it("o número com ponto é normalizado — «1.177» e «1177» são a mesma reunião", () => {
    expect(serieDaReuniao({ sigla: "ARTESP", titulo: "1.177", numeroReuniao: "1.177" }).serie)
      .toBe("ordinaria");
  });
});

describe("etapa216 · a ANM usa `tipo_reuniao`, porque faixa é impossível lá", () => {
  it("ROP 79–87 e REP 31–34 convivem abaixo de 100 — só o tipo distingue", () => {
    expect(serieDaReuniao({ sigla: "ANM", titulo: "81", tipoReuniao: "Ordinaria", numeroReuniao: "81" }))
      .toEqual({ serie: "ordinaria", origem: "tipo_reuniao" });
    expect(serieDaReuniao({ sigla: "ANM", titulo: "32", tipoReuniao: "Extraordinaria", numeroReuniao: "32" }))
      .toEqual({ serie: "extraordinaria", origem: "tipo_reuniao" });
  });

  it("⚠️ e a ANM NÃO usa faixa — 81 não vira extraordinária por ser < 1000", () => {
    expect(serieDaReuniao({ sigla: "ANM", titulo: "81", numeroReuniao: "81" }))
      .toEqual({ serie: null, origem: null });
  });
});

describe("etapa216 · a ORIGEM viaja — a faixa tem de se declarar", () => {
  it("cada resposta diz de onde veio", () => {
    const origens = [
      serieDaReuniao({ sigla: "ANTT", titulo: "264ª Reunião Deliberativa Eletrônica" }).origem,
      serieDaReuniao({ sigla: "ANM", titulo: "81", tipoReuniao: "Ordinaria" }).origem,
      serieDaReuniao({ sigla: "ARTESP", titulo: "1177", numeroReuniao: "1177" }).origem,
      serieDaReuniao({ sigla: "ANTT", titulo: null }).origem,
    ];
    expect(origens).toEqual(["titulo", "tipo_reuniao", "faixa", null]);
  });

  it("⚠️ inferência sem marca é inferência que vira fato — a origem existe para isso", () => {
    // Quando a série sai da faixa, ela é um PALPITE defensável, não leitura. Quem grava precisa
    // poder marcar, e quem lê precisa poder distinguir.
    expect(serieDaReuniao({ sigla: "ARTESP", titulo: "230", numeroReuniao: "230" }).origem).toBe("faixa");
  });
});

describe("etapa216 · e a origem do defeito ficou fechada: os quatro pontos usam a função única", () => {
  const CONFIRM = semComentarios(ler("src/app/api/v1/upload/confirm/route.ts"));
  const REDATAR = semComentarios(ler("src/app/api/v1/admin/deliberacoes/redatar/route.ts"));

  it("nenhum ponto de gravação usa `deriveSerie` sozinho", () => {
    expect(CONFIRM, "voltou a gravar série por `deriveSerie`: ARTESP e ANM nascem NULL de novo")
      .not.toMatch(/deriveSerie\(/);
    expect(REDATAR).not.toMatch(/deriveSerie\(/);
  });

  it("os três `ensureReuniao` do redatar e o do confirm usam `serieDaReuniao`", () => {
    expect((REDATAR.match(/serieDaReuniao\(\{/g) ?? []).length).toBe(3);
    expect((CONFIRM.match(/serieDaReuniao\(\{/g) ?? []).length).toBe(2);
  });

  it("⚠️ a checagem de monotonicidade usa a MESMA derivação da gravação", () => {
    // Antes ela usava `deriveSerie` e a gravação usava outra coisa: a série que BUSCA as vizinhas
    // divergia da que GRAVA a reunião — duas verdades sobre o mesmo conceito.
    const i = CONFIRM.indexOf("const serieDoc =");
    expect(i, "o serieDoc sumiu").toBeGreaterThan(-1);
    expect(CONFIRM.slice(i, i + 260)).toMatch(/serieDaReuniao\(\{/);
  });

  it("e `deriveSerie` continua exportada — ela é a camada do TÍTULO, não foi removida", () => {
    expect(deriveSerie("264ª Reunião Deliberativa Eletrônica")).toBe("eletronica");
    expect(deriveSerie("1178")).toBeNull();
  });
});

describe("etapa216 · a migration do passivo: preenche, e NUNCA apaga", () => {
  const MIG_CRU = ler("supabase/migrations/20260930120000_reunioes_serie_passivo.sql");
  const MIG = MIG_CRU.replace(/--[^\n]*/g, " ");

  it("⚠️ não apaga nem funde reunião — colisão vira LISTA, não DELETE", () => {
    /**
     * `deliberacoes.reuniao_id` aponta para estas linhas. Fundir é decisão do usuário: apagar aqui
     * seria escolher por ele, em silêncio, dentro de uma migration que ele cola no editor.
     */
    expect(MIG, "a migration passou a apagar reunião").not.toMatch(/DELETE\s+FROM/i);
    expect(MIG, "nem a religar reuniao_id por conta própria").not.toMatch(/UPDATE\s+public\.deliberacoes/i);
  });

  it("os três UPDATEs só tocam `serie IS NULL` — idempotência por construção", () => {
    const updates = (MIG.match(/UPDATE public\.reunioes r/g) ?? []).length;
    expect(updates).toBe(3);
    expect((MIG.match(/WHERE r\.serie IS NULL/g) ?? []).length).toBe(3);
  });

  it("⚠️ cada um tem guarda de DESTINO OCUPADO — senão o índice único aborta a migration", () => {
    const guardas = (MIG.match(/COALESCE\(irma\.serie, ''\) = e\.alvo/g) ?? []).length;
    expect(guardas, "sem a guarda, uma duplicata antiga derruba tudo com 23505").toBe(3);
  });

  it("⚠️ a ANTT fica FORA da faixa e do tipo — só título decide lá", () => {
    // Os três UPDATEs, um a um: contar no arquivo inteiro não diz QUAL bloco tem qual filtro.
    const blocos = MIG.split("WITH evidencia AS (").slice(1);
    expect(blocos.length, "a migration deixou de ter três blocos de evidência").toBe(3);
    const [porTitulo, porFaixa, porTipo] = blocos;
    expect(porTitulo, "o título vale para todas — é o que a fonte escreveu").not.toMatch(/a\.sigla/);
    expect(porFaixa, "a faixa passou a valer fora da ARTESP").toMatch(/a\.sigla = 'ARTESP'/);
    expect(porTipo, "a ANTT passou a ser resolvida por tipo_reuniao").toMatch(/a\.sigla <> 'ANTT'/);
  });

  it("⚠️ a série vinda da FAIXA é marcada como inferida", () => {
    // Inferência sem marca vira fato: quem ler a tabela depois não distingue o que a fonte disse do
    // que nós deduzimos.
    expect(MIG).toMatch(/'serie_inferida_por', 'faixa'/);
  });

  it("é transacional, recarrega o schema e não cria função nem temp table", () => {
    expect(MIG).toMatch(/^BEGIN;$/m);
    expect(MIG).toMatch(/^COMMIT;$/m);
    expect(MIG).toMatch(/NOTIFY pgrst, 'reload schema'/);
    expect(MIG, "a lição do iris_seed_director").not.toMatch(/CREATE (OR REPLACE )?FUNCTION/i);
    expect(MIG, "a lição da v1 da Fase 35").not.toMatch(/CREATE\s+(?:TEMP|TEMPORARY)\s+TABLE/i);
  });

  it("e a CONFERÊNCIA cobra o aceite ligado ao teto do código", () => {
    expect(MIG_CRU).toMatch(/SALTO_MAXIMO_DA_SERIE/);
    expect(MIG_CRU, "as colisões precisam de consulta própria").toMatch(/HAVING COUNT\(\*\) > 1/);
    expect(MIG_CRU, "e o que ficou sem série tem de ser contado").toMatch(/sem_serie/);
  });
});
