/**
 * Etapa 65 — TESTES DE PARIDADE para as cópias que ainda estão idênticas.
 *
 * A dívida de duplicação foi medida antes de mexer, e a decisão foi: **unificar só o que JÁ
 * divergiu; o que ainda está idêntico ganha um teste que quebra quando divergir.** Refatorar tudo
 * de uma vez custa risco sem pagar nada — mas deixar cópias sem amarra nenhuma foi exatamente como
 * a "sanção" acumulou TRÊS semânticas diferentes sem ninguém perceber (achada pela invariante da
 * etapa65, não por leitura de código).
 *
 * Duas cópias JÁ divergiram e foram unificadas neste mesmo commit: a definição de sanção
 * (`isSancao`), o conjunto de tipos não-finais (`TIPOS_NAO_FINAIS`) e o repartidor de divergência
 * (`repartirPorDivergencia`). As que sobram aqui estavam byte-a-byte iguais.
 *
 * ⚠️ Estes testes leem o CÓDIGO-FONTE de propósito. Duas das três cópias do Score vivem dentro de
 * componentes client não exportados — não há como importá-las. Comparar o texto é o único
 * mecanismo que ata as três, e é melhor que o comentário "(não deixar divergir)" que existe hoje
 * em cada uma delas e não impede nada.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { calcGovScore } from "@/lib/boletim-document";
import { repartirPorDivergencia, deriveUnanime } from "@/lib/server/vote-inference";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const ler = (rel: string) => readFileSync(join(raiz, rel), "utf-8");
/** Normaliza espaço e quebra de linha: a comparação é de ARITMÉTICA, não de formatação. */
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("etapa65 · paridade — fórmula do Score de Governança (3 cópias)", () => {
  const ARQUIVOS = [
    "src/app/dashboard/governanca/page.tsx",
    "src/app/dashboard/analytics/institucional/page.tsx",
    "src/lib/boletim-document.ts",
  ];

  it("as três cópias calculam a MESMA coisa", () => {
    const expressoes = ARQUIVOS.map((rel) => {
      const src = ler(rel);
      const m = /consenso\s*\*\s*0\.3[\s\S]{0,120}?\(100\s*-\s*sancao\)\s*\*\s*0\.2/.exec(src);
      expect(m, `${rel}: fórmula do Score não encontrada — foi renomeada ou movida?`).not.toBeNull();
      return norm(m![0]);
    });
    expect(new Set(expressoes).size,
      `Score divergiu entre as cópias:\n${ARQUIVOS.map((f, i) => `  ${f}\n    ${expressoes[i]}`).join("\n")}`,
    ).toBe(1);
  });

  it("a cópia exportada continua produzindo o valor de referência", () => {
    // O mesmo caso do teste da etapa48 — se este número mudar, os TRÊS painéis mudaram juntos.
    expect(calcGovScore(88, 72.1, 90, 4)).toBe(86);
  });

  it("os pesos somam 1.0 — se não somarem, o Score deixa de ser 0..100", () => {
    expect(0.3 + 0.25 + 0.25 + 0.2).toBeCloseTo(1, 10);
    expect(calcGovScore(100, 100, 100, 0)).toBe(100);
    expect(calcGovScore(0, 0, 0, 100)).toBe(0);
  });
});

describe("etapa65 · paridade — RuntimeStatus declarado duas vezes", () => {
  it("as duas declarações têm exatamente os mesmos campos", () => {
    const corpo = (rel: string) => {
      const src = ler(rel);
      const m = /export interface RuntimeStatus \{([\s\S]*?)\n\}/.exec(src);
      expect(m, `${rel}: RuntimeStatus não encontrado`).not.toBeNull();
      // Campos, ignorando comentários e formatação — é a FORMA que precisa bater.
      return m![1]
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"))
        .map(norm)
        .sort();
    };
    const a = corpo("src/lib/server/runtime-status.ts");
    const b = corpo("src/types/index.ts");
    expect(b, "RuntimeStatus divergiu entre runtime-status.ts e types/index.ts").toEqual(a);
  });
});

describe("etapa65 · os dois write-paths de is_divergente agora concordam", () => {
  // A divergência era real e silenciosa: `deliberacoes/[id]` (PATCH manual) chamava
  // `isDivergentVote(tipo, resultado)` com DOIS argumentos, omitindo `unanime`, enquanto
  // `votos/recalcular-divergencia` passava o terceiro. Uma edição manual de resultado reintroduzia
  // divergência FALSA num item indeferido-por-unanimidade, e ela ficava lá até o cron rodar.
  const votos = [
    { id: "v1", tipo_voto: "Favoravel" },
    { id: "v2", tipo_voto: "Favoravel" },
  ];

  it("item unânime NÃO produz divergente, venha o flag como boolean ou como texto do PostgREST", () => {
    for (const flag of [true, "true"]) {
      const r = repartirPorDivergencia(votos, "Indeferido", flag);
      expect(r.idsDivergentes, `flag=${JSON.stringify(flag)}`).toEqual([]);
      expect(r.idsNaoDivergentes).toEqual(["v1", "v2"]);
    }
  });

  it("sem o flag, o favorável a um INDEFERIDO é divergente — a polaridade continua valendo", () => {
    expect(repartirPorDivergencia(votos, "Indeferido", null).idsDivergentes).toEqual(["v1", "v2"]);
  });

  it("dissidência GRAVADA vence a unanimidade declarada no texto", () => {
    const comDissidente = [...votos, { id: "v3", tipo_voto: "Desfavoravel" }];
    expect(deriveUnanime("true", comDissidente)).toBe(false);
    expect(deriveUnanime("true", votos)).toBe(true);
  });

  it("nenhum voto se perde: divergentes + não divergentes = total", () => {
    const r = repartirPorDivergencia(votos, "Deferido", null);
    expect(r.idsDivergentes.length + r.idsNaoDivergentes.length).toBe(votos.length);
  });

  it("nenhuma das duas rotas chama mais isDivergentVote direto", () => {
    // Só CÓDIGO — os comentários dos dois arquivos citam `isDivergentVote(tipo, resultado)` de
    // propósito, para registrar qual era o defeito.
    const semComentarios = (rel: string) =>
      ler(rel)
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");
    for (const rel of [
      "src/app/api/v1/deliberacoes/[id]/route.ts",
      "src/app/api/v1/votos/recalcular-divergencia/route.ts",
    ]) {
      expect(semComentarios(rel), `${rel} voltou a chamar isDivergentVote direto`)
        .not.toContain("isDivergentVote(");
      expect(semComentarios(rel)).toContain("repartirPorDivergencia(");
    }
  });
});

describe("etapa65 · a exceção que NÃO pode ser unificada", () => {
  it("pendencias-voto omite voto_individual do resíduo DE PROPÓSITO", () => {
    // Unificação cega quebraria a tela: a rota classifica `voto_individual` numa categoria própria
    // ANTES de consultar os sets. O teste existe para que a próxima limpeza não a "conserte".
    const src = ler("src/app/api/v1/admin/upload/pendencias-voto/route.ts");
    const m = /const RESIDUO = new Set\(\[([^\]]*)\]\)/.exec(src);
    expect(m, "RESIDUO sumiu de pendencias-voto").not.toBeNull();
    expect(m![1]).not.toContain("voto_individual");
    expect(src).toContain('tipo === "voto_individual"');
  });
});
