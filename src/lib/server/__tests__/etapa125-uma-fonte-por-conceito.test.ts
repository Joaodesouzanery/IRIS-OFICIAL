/**
 * Etapa 125 (Fase 21, commit 3) — UMA implementação por conceito, e o teste que impede a segunda.
 *
 * A varredura achou o mesmo conceito implementado 2-7 vezes, com divergência (etapa124 mediu).
 * Cada bloco abaixo faz duas coisas: prova o COMPORTAMENTO da fonte única, e varre o código por
 * literais que a reimplementariam — o mesmo desenho da etapa110, que pegou a divergência da
 * Fase 17 no meu próprio código.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import { parseAnttManualDocument } from "@/lib/server/antt-manual-parser";
import { splitAtaItems } from "@/lib/server/ata-splitter";
import { isUnanimidadeNegada } from "@/lib/server/unanimidade";
import { hasUnanimidade } from "@/lib/server/nlp-extractor";
import { resolverPresentesRoster } from "@/lib/server/presentes-roster";
import { type DiretorVoteRecord } from "@/lib/server/vote-inference";
import { isVotoNominal } from "@/lib/votos-nominal";
import { selectVotosComFallback } from "@/lib/server/votos-write";
import { MATCH_THRESHOLD, MATCH_REVIEW_THRESHOLD } from "@/lib/server/name-matcher";

const RAIZ = join(__dirname, "../../../..");
const FIXTURES = join(__dirname, "fixtures/votos");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
function fontes(dir = join(RAIZ, "src")): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) { if (nome !== "__tests__") out.push(...fontes(p)); }
    else if (/\.tsx?$/.test(nome)) out.push(p);
  }
  return out;
}
const CODIGO = fontes().map((p) => ({ p: p.slice(RAIZ.length + 1), t: semComentarios(readFileSync(p, "utf-8")) }));
const ondeAparece = (re: RegExp, exceto: string[] = []) =>
  CODIGO.filter(({ p, t }) => !exceto.some((e) => p.endsWith(e)) && re.test(t)).map(({ p }) => p);

// ═══ 1 · UNANIMIDADE NEGADA — a bomba da ANTT ═══════════════════════════════
describe("etapa125 · «não houve unanimidade» não fabrica voto em NENHUM motor", () => {
  it("a negação é reconhecida com e sem acento (o parser da ANTT normaliza)", () => {
    expect(isUnanimidadeNegada("não houve unanimidade")).toBe(true);
    expect(isUnanimidadeNegada("nao houve unanimidade")).toBe(true);
    expect(isUnanimidadeNegada("sem unanimidade")).toBe(true);
    expect(isUnanimidadeNegada("não obstante a unanimidade")).toBe(false); // concessivo AFIRMA
    expect(isUnanimidadeNegada("aprovado por unanimidade")).toBe(false);
  });

  it("ANTT, ata REAL da 1.024ª com UM item negado sinteticamente: esse item perde os votos, os outros não", async () => {
    // O corpus não tem "não houve unanimidade" (etapa124: negada = 0). A negação é sintética,
    // o formato é real — é o que separa "testei a regex" de "testei o parser".
    const { text } = await extractPdfText(readFileSync(join(FIXTURES, "antt-ata-1024.pdf")));
    const original = parseAnttManualDocument(text, "antt-ata-1024.pdf").ataItems ?? [];
    const comVoto = original.filter((i) => (i.votos_detectados ?? []).length > 0);
    expect(comVoto.length, "a fixture precisa ter itens unânimes com voto, senão o teste não prova nada").toBeGreaterThan(0);

    const alvo = comVoto[0];
    // O parser normaliza espaços; no texto cru a decisão tem quebras de linha. A troca é feita
    // no TEXTO: o primeiro "por unanimidade" depois do número do processo deste item.
    const inicio = text.indexOf(alvo.processo!);
    expect(inicio, "o processo do item precisa estar no texto").toBeGreaterThan(-1);
    const resto = text.slice(inicio).replace(/por\s+unanimidade/i, "não houve unanimidade");
    const mutado = text.slice(0, inicio) + resto;
    expect(mutado).not.toBe(text);

    const depois = parseAnttManualDocument(mutado, "antt-ata-1024.pdf").ataItems ?? [];
    const alvoDepois = depois.find((i) => i.processo === alvo.processo && i.assunto === alvo.assunto);
    expect(alvoDepois, "o item mutado sumiu do parse").toBeDefined();
    expect(alvoDepois!.votos_detectados ?? []).toEqual([]);
    expect(alvoDepois!.unanimidade_detectada ?? false).toBe(false);
    // Os OUTROS itens continuam com voto: a guarda é por item, não por documento.
    const outrosDepois = depois.filter((i) => i !== alvoDepois && (i.votos_detectados ?? []).length > 0);
    expect(outrosDepois.length).toBe(comVoto.length - 1);
  }, 30_000);

  it("splitter: item com 'não houve unanimidade' não sai como unânime", () => {
    const [item] = splitAtaItems("1.1.1 PROCESSO Nº: 48403.000001/2020-11 Interessado: Fulano. Decisão: indeferido; não houve unanimidade, vencido o Diretor Relator.");
    expect(item).toBeDefined();
    expect(item.unanimidade).toBe(false);
    expect(hasUnanimidade(item.raw_text)).toBe(false);
  });

  it("o literal da negação existe UMA vez no código", () => {
    expect(ondeAparece(/sem\\s\+unanimidade/, ["unanimidade.ts"])).toEqual([]);
  });
});

// ═══ 2 · ROSTER DE PRESENTES ════════════════════════════════════════════════
describe("etapa125 · o roster de presentes vem de UMA função", () => {
  const diretores: DiretorVoteRecord[] = [
    { id: "a", nome: "Mauro Henrique Moreira Sousa", nome_variantes: [] },
    { id: "b", nome: "Caio Mário Trivellato Seabra Filho", nome_variantes: [] },
  ];

  it("deduplica: o mesmo diretor citado duas vezes entra UMA vez (duas cópias antigas não deduplicavam)", () => {
    const r = resolverPresentesRoster(["Mauro Henrique Moreira Sousa", "MAURO HENRIQUE MOREIRA SOUSA", "Caio Mário Trivellato Seabra Filho"], diretores);
    expect(r.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("presente sem match confiável NÃO entra — sem certeza, sem voto", () => {
    expect(resolverPresentesRoster(["Roger Romão Cabral"], diretores)).toEqual([]);
    expect(resolverPresentesRoster([null, 42, ""], diretores)).toEqual([]);
  });

  it("nenhum dos três chamadores reimplementa o laço", () => {
    // O laço antigo: `findBestMatch(...)` seguido de `needsReview` num map/for sobre nomes.
    const reimplementa = /findBestMatch\([^)]*\)[\s\S]{0,120}?needsReview[\s\S]{0,120}?diretoresList\.find/;
    expect(ondeAparece(reimplementa, ["presentes-roster.ts"])).toEqual([]);
  });
});

// ═══ 3 · LIMIARES ═══════════════════════════════════════════════════════════
describe("etapa125 · os limiares de casamento têm nome, não número", () => {
  it("os valores são os de sempre", () => {
    expect(MATCH_THRESHOLD).toBe(0.85);
    expect(MATCH_REVIEW_THRESHOLD).toBe(0.6);
  });

  // Os arquivos que TINHAM o literal. Aqui o número é proibido em qualquer forma — a mutação
  // `const X = 0.85;` (sem "score" na linha) sobreviveu à regra por proximidade, então o teste
  // ficou mais duro, não o código mais frouxo.
  const ARQUIVOS_QUE_TINHAM_O_LITERAL = [
    "src/lib/server/roster-conferivel.ts",
    "src/app/api/v1/admin/saude-dados/route.ts",
    "src/lib/server/diretor-duplicatas.ts",
    "src/lib/server/empresa-resolver.ts",
    "src/lib/server/vote-inference.ts",
    "src/app/api/v1/diretores/candidatos/aprovar-lote/route.ts",
  ];

  it.each(ARQUIVOS_QUE_TINHAM_O_LITERAL)("%s não tem NENHUM 0.85 / 0.6 numérico", (arquivo) => {
    const fonte = CODIGO.find(({ p }) => p === arquivo)?.t ?? "";
    expect(fonte.length, "arquivo sumiu — atualize a lista").toBeGreaterThan(0);
    expect(fonte).not.toMatch(/\b0\.(?:85|6)\b/);
  });

  it("no resto do código, nenhum 0.85 / 0.6 perto de score/confidence — a rede para o próximo arquivo", () => {
    const literal = /(?:score|confidence|confianca|CONF_)[^\n]{0,30}?\b0\.(?:85|6)\b|\b0\.(?:85|6)\b[^\n]{0,30}?(?:score|confidence|confianca)/;
    expect(ondeAparece(literal, ["name-matcher.ts", "demo-data.ts"])).toEqual([]); // demo-data: valores de exemplo, não limiar
  });
});

// ═══ 4 · CONTESTAÇÃO CO-LOCALIZADA ══════════════════════════════════════════
describe("etapa125 · os predicados de contestação vivem no mesmo arquivo", () => {
  it("nenhuma regex de contestação é definida fora de consistency-checks", () => {
    expect(ondeAparece(/=\s*\/[^\n]*por\\s\+maioria/, ["consistency-checks.ts"])).toEqual([]);
  });
});

// ═══ 5 · NOMINAL HONRA PROVENIÊNCIA ═════════════════════════════════════════
describe("etapa125 · «nominal» é decidido por isVotoNominal em todo leitor", () => {
  it.each([
    [{ is_nominal: false, proveniencia: "revisao_humana" }, true],
    [{ is_nominal: false, proveniencia: "nominal" }, true],
    [{ is_nominal: true, proveniencia: "inferido_unanimidade" }, false],
    [{ is_nominal: true, proveniencia: null }, true],
    [{ is_nominal: true }, true],
    [{ is_nominal: false }, false],
  ] as Array<[{ is_nominal: boolean; proveniencia?: string | null }, boolean]>)("%o → %s", (v, esperado) => {
    expect(isVotoNominal(v)).toBe(esperado);
  });

  it("nenhum leitor testa `is_nominal` cru (fora do próprio helper e da escrita)", () => {
    // `if (v.is_nominal)`, `.some((v) => v.is_nominal)`, `!v.is_nominal`, `?.is_nominal ?`…
    const cru = /(?:if\s*\(|=>\s*|!|&&\s*|\|\|\s*)\s*\(?[a-zA-Z_.)]*\.is_nominal\b(?!\s*[:=])/;
    expect(ondeAparece(cru, ["votos-nominal.ts", "vote-inference.ts", "votos-write.ts", "regulatory-documents.ts"])).toEqual([]);
  });

  it("o SELECT degrada para o mínimo quando a coluna não existe — sem 500", async () => {
    const chamadas: string[] = [];
    const r = await selectVotosComFallback<Array<{ x: number }>>(async (c) => {
      chamadas.push(c);
      return c.includes("proveniencia") ? { data: null, error: { code: "42703" } } : { data: [{ x: 1 }], error: null };
    }, "x, proveniencia", "x");
    expect(chamadas).toEqual(["x, proveniencia", "x"]);
    expect(r.data).toEqual([{ x: 1 }]);
    expect(r.degradou).toBe(true);
  });
});
