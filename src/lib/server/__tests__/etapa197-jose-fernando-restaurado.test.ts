/**
 * Etapa 197 (Fase 34, Bloco 2) — o José Fernando, e por que a ANM não fechava.
 *
 * ═══ A cadeia, toda ela nas próprias migrations deste repositório ═══
 *  1. `20260517195947:323` o semeou como **"José Fernando Gomes Júnior"** (forma ABREVIADA), com
 *     mandato `verificado` de 2025-09-01 a 2028-12-04.
 *  2. `20260710120000` corrigiu o nome para a forma COMPLETA e guardou a abreviada em
 *     `nome_variantes` — porque as atas da ANM citam "José Fernando de Mendonça Gomes Júnior" e o
 *     casamento caía a 0.71 contra a forma abreviada.
 *  3. `20260821140000` + `20260821150000:39-51` o **apagaram**, sob a nota escrita
 *     *"José Fernando e Luiz Paniago voltam limpos (com votos) após «Rodar tudo» 2×"*.
 *  4. Essa premissa é falsa, e o repositório já sabia: `20260909130000:10-13` diz
 *     *"o extrator se recusa, por desenho, a criar diretor a partir de voto"*. O Luiz Paniago ganhou
 *     a migration de reinserção dele. **O José Fernando não.**
 *
 * ⚠️ E EU IA CONSERTAR A COISA ERRADA. Ofereci ao usuário "só o casamento de nome", supondo que o
 * defeito fosse a variante `Jr` × `Júnior`. Medi com o próprio `name-matcher`, e **não é**: com o
 * cadastro correto os três nomes casam. O que faltava era a LINHA.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { findBestMatch, MATCH_THRESHOLD } from "../name-matcher";
import { getCuratedAgenciaImport } from "../agencias-curated-import";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

const MIGRATION = "supabase/migrations/20260927120000_reinserir_jose_fernando_anm.sql";
const SQL = ler(MIGRATION);

const NOME_COMPLETO = "José Fernando de Mendonça Gomes Júnior";
const VARIANTE = "José Fernando Gomes Júnior";
/** Os três nomes que as atas da ANM usam, medidos no corpus. */
const NOMES_DAS_ATAS = [NOME_COMPLETO, "José Fernando de Mendonça Gomes Jr", VARIANTE];

describe("etapa197 · ⚠️ o casamento de nome NÃO era o defeito — a medição desfez a minha hipótese", () => {
  it("com o cadastro COMPLETO + variante, os três nomes das atas casam", () => {
    const cadastro = [{ id: "jf", nome: NOME_COMPLETO, nome_variantes: [VARIANTE], agencia_id: "anm" }];
    for (const nome of NOMES_DAS_ATAS) {
      const m = findBestMatch(nome, cadastro);
      expect(m.diretorId, `"${nome}" não casou`).toBe("jf");
      expect(m.needsReview, `"${nome}" caiu em revisão`).toBe(false);
      expect(m.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    }
  });

  it("⚠️ com o cadastro ABREVIADO, DOIS dos três caem abaixo do limiar", () => {
    /**
     * É por isso que a `20260710120000` existiu, e é por isso que o nome completo tem de ser o
     * gravado. `deriveNomeVariantes` gera a abreviada a partir da completa (tira o patronímico do
     * meio), mas não gera "de Mendonça" a partir da abreviada — a relação não é simétrica.
     */
    const abreviado = [{ id: "jf", nome: VARIANTE, nome_variantes: [], agencia_id: "anm" }];
    const reprovados = NOMES_DAS_ATAS.filter((n) => {
      const m = findBestMatch(n, abreviado);
      return !m.diretorId || m.needsReview;
    });
    expect(reprovados).toEqual([NOME_COMPLETO, "José Fernando de Mendonça Gomes Jr"]);
  });
});

describe("etapa197 · a migration de restauração", () => {
  it("⚠️ NÃO chama `iris_seed_director` — a criadora dela a derruba na mesma transação", () => {
    // A v1 do Luiz Paniago falhou em produção com `42883` por isso. O cabeçalho pode citá-la; o SQL não.
    const corpo = SQL.slice(SQL.indexOf("BEGIN;"));
    expect(corpo).not.toMatch(/iris_seed_/);
  });

  it("é idempotente: o mandato entra por NOT EXISTS e o diretor por busca prévia", () => {
    expect(SQL).toMatch(/WHERE NOT EXISTS \(\s*\n?\s*SELECT 1 FROM public\.mandatos m/);
    expect(SQL).toMatch(/IF v_diretor_id IS NULL THEN/);
    expect(SQL).toMatch(/ELSE\s*\n\s*UPDATE public\.diretores/);
    expect(SQL).toMatch(/NOTIFY pgrst, 'reload schema';/);
  });

  it("⚠️ grava o nome COMPLETO nos DOIS ramos — insert e update", () => {
    /**
     * ⚠️ A contagem é o ponto, e saiu de uma MUTAÇÃO SOBREVIVENTE: eu pedia `toContain` do nome
     * completo, e trocar só o ramo do UPDATE passava — porque o do INSERT continuava lá. O ramo do
     * UPDATE é justamente o que roda quando a limpeza deixou a forma abreviada viva, que é o caso
     * mais provável em produção.
     */
    expect(SQL).toMatch(/v_agencia_id, 'José Fernando de Mendonça Gomes Júnior',/);   // INSERT
    expect(SQL).toMatch(/SET nome = 'José Fernando de Mendonça Gomes Júnior',/);      // UPDATE
    expect(SQL, "a forma abreviada virou o nome gravado em algum ramo")
      .not.toMatch(/(?:SET nome|v_agencia_id,) 'José Fernando Gomes Júnior'/);
    expect(SQL).toMatch(/nome_variantes = CASE/);
    expect(SQL).toMatch(/array_append\(COALESCE\(nome_variantes, '\{\}'::text\[\]\), 'José Fernando Gomes Júnior'\)/);
  });

  it("⚠️ `fonte_dado='verificado'` e `metadata->>'seed'` — os dois são o que faz a linha CONTAR e DURAR", () => {
    /**
     * `verificado` porque todo predicado de colegiado exige `fonte_dado <> 'automatico'`: um mandato
     * `automatico` existiria e não poria ninguém no esperado — foi o que aconteceu com o Severino.
     * E `metadata->>'seed'` porque o predicado da limpeza de agosto era
     * `fonte_dado <> 'verificado' AND metadata->>'seed' = ''`.
     */
    expect(SQL).toMatch(/'Diretor', 'verificado',/);
    // ⚠️ O selo tem de estar no diretor E no mandato — três lugares. Uma mutação sobreviveu
    // trocando só um deles, porque `toMatch` acha qualquer ocorrência.
    expect((SQL.match(/'seed', 'fase34_reinsercao'/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(SQL, "voltou mandato automatico, que não entra no colegiado esperado")
      .not.toMatch(/mandatos[\s\S]{0,400}'automatico'/);
  });

  it("⚠️ procura pelas DUAS formas antes de inserir — criar pessoa duplicada seria pior", () => {
    expect(SQL).toMatch(/lower\(nome\) IN \('josé fernando de mendonça gomes júnior', 'josé fernando gomes júnior'\)/);
  });

  it("restaura o MESMO mandato que o seed institucional já declarava — não inventa dado", () => {
    // 2025-09-01 → 2028-12-04 é literalmente o que `20260517195947:323` semeava.
    const SEED = ler("supabase/migrations/20260517195947_expand_directors_schema.sql");
    expect(SEED).toMatch(/DATE '2025-09-01', DATE '2028-12-04'/);
    expect(SQL).toMatch(/DATE '2025-09-01', DATE '2028-12-04'/);
  });

  it("⚠️ e NÃO inventa os mandatos que dependem do DOU", () => {
    // Roger, Tasso, Severino e o afastamento do Caio Mário continuam fora — são dado do usuário.
    for (const nome of ["Roger", "Tasso", "Severino", "Caio Mário"]) {
      expect(SQL, `${nome} entrou na migration sem fonte do DOU`).not.toMatch(
        new RegExp(`INSERT[\\s\\S]{0,600}${nome}`),
      );
    }
  });
});

describe("etapa197 · ⚠️ o vetor de reincidência: o botão «Importar Dados»", () => {
  it("a lista curada declara o nome COMPLETO — a abreviada desfaria a migration com um clique", () => {
    /**
     * `agencias/[id]/importar/route.ts` faz `update({ nome: diretor.nome })` quando `findBestMatch`
     * casa, e a forma abreviada casa **1.00** com o registro completo (via `deriveNomeVariantes`).
     * Então um clique em "Importar Dados" na ANM reescrevia o nome para a forma abreviada e
     * derrubava o match das atas para 0.68. É uma SEGUNDA declaração do roster, em TypeScript, que
     * ninguém confrontava com os seeds SQL.
     */
    const anm = getCuratedAgenciaImport("ANM");
    expect(anm, "a ANM saiu da lista curada").toBeTruthy();
    const jf = anm!.diretores.find((d) => /Jos[ée] Fernando/.test(d.nome));
    expect(jf, "José Fernando saiu da lista curada").toBeTruthy();
    expect(jf!.nome).toBe(NOME_COMPLETO);
  });

  it("⚠️ e nenhum diretor curado da ANM está com nome que o cadastro não reconheceria", () => {
    // O teste vale para a lista inteira: qualquer nome curado tem de casar consigo mesmo no limiar.
    const anm = getCuratedAgenciaImport("ANM")!;
    const cadastro = anm.diretores.map((d, i) => ({
      id: String(i), nome: d.nome, nome_variantes: [], agencia_id: "anm",
    }));
    for (const d of anm.diretores) {
      const m = findBestMatch(d.nome, cadastro);
      expect(m.needsReview, `"${d.nome}" curado não casa consigo mesmo`).toBe(false);
    }
  });
});

describe("etapa197 · a migration está registrada e é a única do dia", () => {
  it("existe em `supabase/migrations/` com o carimbo de data", () => {
    const arquivos = readdirSync(join(RAIZ, "supabase/migrations"));
    expect(arquivos).toContain("20260927120000_reinserir_jose_fernando_anm.sql");
  });

  it("⚠️ e o `docs/PENDENCIAS.md` diz que ela precisa ser APLICADA à mão", () => {
    // Migration é aplicada pelo usuário no SQL Editor; uma que fique só no repo não conserta nada.
    expect(ler("docs/PENDENCIAS.md")).toMatch(/20260927120000/);
  });
});
