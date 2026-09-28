/**
 * Etapa 207 (Fase 35, Bloco D) — por que o placar dizia 3 buracos e o usuário contou 12.
 *
 * ═══ A causa, encontrada no código e não adivinhada ═══
 * `buracosDaSerie` agrupa por `(agencia, serie)` e só confia na faixa se `max - min <= 400`
 * (`SALTO_MAXIMO_DA_SERIE`). O QA do usuário mostrou a 295ª (eletrônica) e a 1.038ª (pública) **as
 * duas com `serie: "ordinaria"`** — mesmo balde, salto de ~768, e a detecção SE CALA.
 *
 * A origem é minha: o commit `f8c9a6f` (Fase 34) consertou o mojibake que fazia `deriveSerie`
 * devolver `"ordinaria"` para toda RDE — **mas só para escritas novas**. O backfill da migration
 * `20260825120000` rodou `WHERE serie IS NULL`, e estas linhas não eram nulas: tinham `'ordinaria'`,
 * escrito errado. Nunca foram revisitadas.
 *
 * ═══ E o segundo limite, que o usuário também nomeou ═══
 * O que falta **depois** do último número é invisível por construção: a série termina no `max` do
 * acervo, então uma reunião que ninguém coletou não aparece como buraco — aparece como se não
 * existisse (a 87ª ROP da ANM). Contra uma LISTAGEM da fonte não há inferência: é diferença de
 * conjuntos, não precisa de teto de salto, e alcança o fim.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  buracosDaSerie,
  faltandoContraListagem,
  SALTO_MAXIMO_DA_SERIE,
  type EntradaDeNumeracao,
  type ItemDaListagem,
} from "@/lib/server/placar";
import { deriveSerie } from "@/lib/server/reunioes";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentariosSql = (t: string) => t.replace(/--[^\n]*/g, " ");

const e = (numero: string, data: string, serie: string | null): EntradaDeNumeracao => ({
  agencia: "ANTT", serie, numero_reuniao: numero, data_reuniao: data,
});

describe("etapa207 · ⚠️ a CAUSA: duas séries no mesmo balde calam a detecção", () => {
  it("com as duas séries misturadas, o salto passa de 400 e nada é reportado", () => {
    /**
     * A forma exata do que o QA mostrou: a eletrônica (270..295) e a de Diretoria (1.027..1.038)
     * gravadas as duas como "ordinaria". Falta a 275 e a 1.033, e nenhuma das duas aparece.
     */
    const misturado = [
      e("270", "2026-01-12", "ordinaria"), e("271", "2026-03-09", "ordinaria"),
      e("295", "2026-08-24", "ordinaria"),
      e("1.027", "2026-02-05", "ordinaria"), e("1.038", "2026-07-30", "ordinaria"),
    ];
    const r = buracosDaSerie(misturado, "2026-01-01", "2026-12-31");
    const doBalde = r.find((b) => b.serie === "ordinaria");
    expect(doBalde, "o balde único deveria existir").toBeDefined();
    expect((doBalde!.max ?? 0) - (doBalde!.min ?? 0), "o salto é o que passa do teto")
      .toBeGreaterThan(SALTO_MAXIMO_DA_SERIE);
    expect(doBalde!.ausentes, "com o salto acima do teto a detecção se cala — e foi o que aconteceu")
      .toEqual([]);
  });

  it("⚠️ SEPARADAS, as mesmas linhas acusam os buracos de cada série", () => {
    const separado = [
      e("270", "2026-01-12", "eletronica"), e("271", "2026-03-09", "eletronica"),
      e("273", "2026-03-23", "eletronica"),
      e("1.027", "2026-02-05", "ordinaria"), e("1.029", "2026-03-12", "ordinaria"),
    ];
    const r = buracosDaSerie(separado, "2026-01-01", "2026-12-31");
    const eletronica = r.find((b) => b.serie === "eletronica");
    const ordinaria = r.find((b) => b.serie === "ordinaria");
    expect(eletronica?.ausentes, "a 272 tem de aparecer").toEqual([272]);
    expect(ordinaria?.ausentes, "a 1.028 tem de aparecer").toEqual([1028]);
  });

  it("e `deriveSerie` distingue as quatro — o problema nunca foi a função, foi o passivo no banco", () => {
    expect(deriveSerie("Reunião Deliberativa Eletrônica nº 295")).toBe("eletronica");
    expect(deriveSerie("Reuniao Deliberativa Eletronica no 295")).toBe("eletronica");
    expect(deriveSerie("Reunião Extraordinária nº 99")).toBe("extraordinaria");
    expect(deriveSerie("Reunião Administrativa")).toBe("administrativa");
    expect(deriveSerie("1.038ª Reunião de Diretoria")).toBe("ordinaria");
    // ⚠️ E devolve null sem título reconhecível: presumir "ordinaria" é exatamente o que juntou as
    // séries. O docblock de `reunioes.ts` diz isso com estas palavras.
    expect(deriveSerie("Ata de algo")).toBeNull();
    expect(deriveSerie(null)).toBeNull();
  });
});

describe("etapa207 · ⚠️ o FIM da série: diferença de conjuntos, sem inferência", () => {
  const listagem = (numeros: string[], serie: string | null): ItemDaListagem[] =>
    numeros.map((n) => ({ agencia: "ANTT", serie, numero_reuniao: n }));

  it("o que a listagem tem DEPOIS do nosso último aparece — `buracosDaSerie` não vê isso", () => {
    const acervo = [e("270", "2026-01-12", "eletronica"), e("271", "2026-03-09", "eletronica")];
    // `buracosDaSerie` não enxerga a 272 e a 273: elas estão fora da faixa do acervo.
    expect(buracosDaSerie(acervo, "2026-01-01", "2026-12-31")[0]?.ausentes).toEqual([]);

    const r = faltandoContraListagem(acervo, listagem(["270", "271", "272", "273"], "eletronica"));
    expect(r[0].ausentes, "é justamente o fim da série que a outra medição perde").toEqual([272, 273]);
    expect(r[0].ultimo_no_acervo).toBe(271);
    expect(r[0].ultimo_na_listagem).toBe(273);
  });

  it("e acha o buraco do MEIO também, sem depender de teto de salto", () => {
    const acervo = [e("270", "2026-01-12", "eletronica"), e("1.038", "2026-07-30", "eletronica")];
    const r = faltandoContraListagem(acervo, listagem(["270", "275", "1.038"], "eletronica"));
    // O salto 270→1038 passa de 400 e calaria `buracosDaSerie`; aqui não há faixa a inferir.
    expect(r[0].ausentes).toEqual([275]);
  });

  it("acervo em dia com a listagem não reporta nada", () => {
    const acervo = [e("270", "2026-01-12", "eletronica"), e("271", "2026-03-09", "eletronica")];
    expect(faltandoContraListagem(acervo, listagem(["270", "271"], "eletronica"))[0].ausentes).toEqual([]);
  });

  it("⚠️ a comparação é DENTRO da série — e o resultado diz quando o problema é o casamento", () => {
    /**
     * O caso que importa não errar: a listagem diz `eletronica`, o acervo gravou `ordinaria` (o
     * passivo do mojibake). Os conjuntos não se encontram e TODA a série sai como ausente. Reportar
     * isso como "faltam 3 reuniões" mandaria recoletar o que já está no banco — por isso
     * `ultimo_no_acervo` vem NULO, e é esse sinal que a rota usa para dizer "confira `reunioes.serie`
     * antes de tratar como coleta faltando".
     */
    const acervo = [
      e("270", "2026-01-12", "ordinaria"),
      e("271", "2026-03-09", "ordinaria"),
      e("272", "2026-03-16", "ordinaria"),
    ];
    const r = faltandoContraListagem(acervo, listagem(["270", "271", "272"], "eletronica"));
    expect(r[0].ausentes, "sem casar a série, tudo parece ausente").toEqual([270, 271, 272]);
    expect(r[0].ultimo_no_acervo, "o NULO é o sinal de «é casamento de série, não coleta»").toBeNull();
  });

  it("listagem vazia não inventa ausência", () => {
    expect(faltandoContraListagem([e("270", "2026-01-12", "eletronica")], [])).toEqual([]);
  });

  it("número ilegível é ignorado nos dois lados — não vira buraco", () => {
    const r = faltandoContraListagem(
      [e("270", "2026-01-12", "eletronica")],
      [...listagem(["270"], "eletronica"), { agencia: "ANTT", serie: "eletronica", numero_reuniao: "s/n" }],
    );
    expect(r[0].ausentes).toEqual([]);
  });
});

describe("etapa207 · a migration re-deriva o passivo, e não repete erros conhecidos", () => {
  /**
   * ⚠️ APONTA PARA A v2. A v1 (`20260928120000`) FALHOU no SQL Editor com
   * `relation "_iris_serie_evidencia" does not exist` e está marcada como NÃO RODAR — manter as
   * expectativas sobre ela seria guardar a qualidade de um arquivo que ninguém deve executar.
   * A `etapa213` cobre o par v1/v2 e a remoção da dependência entre instruções.
   */
  const MIG = semComentariosSql(ler("supabase/migrations/20260928140000_reunioes_serie_rederivar_v2.sql"));

  it("o ALVO é quem tem 'ordinaria' e cuja evidência discorda — não mexe em outra série", () => {
    expect(MIG).toMatch(/e\.serie_atual = 'ordinaria'/);
    expect(MIG).toMatch(/e\.serie_da_evidencia <> 'ordinaria'/);
  });

  it("⚠️ tem GUARDA DE COLISÃO contra o índice único, senão uma duplicata antiga derruba tudo", () => {
    // O índice é (agencia_id, data_reuniao, COALESCE(numero_reuniao,''), COALESCE(serie,'')).
    // Sem a guarda, uma linha irmã que já tenha o valor de destino faria a migration INTEIRA falhar.
    const ocorrencias = (MIG.match(/NOT EXISTS \(\s*SELECT 1 FROM public\.reunioes irma/g) ?? []).length;
    expect(ocorrencias, "os DOIS updates precisam da guarda — um sem ela basta para quebrar")
      .toBeGreaterThanOrEqual(2);
  });

  it("não cria função auxiliar — a lição do `iris_seed_director` é inline", () => {
    expect(MIG, "função criada numa migration pode ser derrubada por outra; a Fase 24b pagou por isso")
      .not.toMatch(/CREATE (OR REPLACE )?FUNCTION/i);
  });

  it("é idempotente por construção: o WHERE exige que o valor atual DISCORDE da evidência", () => {
    expect(MIG).toMatch(/BEGIN;/);
    expect(MIG).toMatch(/COMMIT;/);
    expect(MIG).toMatch(/NOTIFY pgrst, 'reload schema'/);
  });

  it("⚠️ o MAX() no título da deliberação é determinismo, não descuido", () => {
    // Duas deliberações da mesma reunião podem ter títulos diferentes; sem um critério fixo,
    // reaplicar a migration poderia dar outro resultado — e aí ela deixa de ser idempotente.
    expect(MIG).toMatch(/MAX\(d\.reuniao_ordinaria\)/);
  });

  it("usa as TRÊS fontes de evidência, com a listagem do portal na frente", () => {
    expect(MIG).toMatch(/antt_reunioes_coletadas/);
    expect(MIG).toMatch(/metadata ->> 'titulo'/);
    expect(MIG).toMatch(/d\.reuniao_ordinaria/);
    // A precedência: o `tipo` da listagem vence o título.
    const i = MIG.indexOf("CASE");
    const bloco = MIG.slice(i, i + 700);
    expect(bloco.indexOf("arc.tipo"), "a listagem tem de vir ANTES do título no CASE")
      .toBeLessThan(bloco.indexOf("ILIKE '%eletr%'"));
  });

  it("os padrões são CURTOS, para casar com e sem acento sem depender de `unaccent`", () => {
    expect(MIG).toMatch(/ILIKE '%eletr%'/);
    expect(MIG, "'%eletronic%' não casaria «eletrônica» com acento").not.toMatch(/ILIKE '%eletronic%'/);
  });

  it("e traz CONFERÊNCIA com critério de aceite ligado ao teto do código", () => {
    const CRU = ler("supabase/migrations/20260928140000_reunioes_serie_rederivar_v2.sql");
    // A v1 escrevia sem acento, a v2 com — a propriedade é existir o bloco, não a grafia.
    expect(CRU).toMatch(/CONFER[EÊ]NCIA/);
    expect(CRU, "o aceite tem de citar o teto que causa o silêncio").toMatch(/SALTO_MAXIMO_DA_SERIE/);
    expect(CRU, "as linhas puladas pela guarda precisam de consulta própria").toMatch(/series_na_mesma_chave/);
  });
});
