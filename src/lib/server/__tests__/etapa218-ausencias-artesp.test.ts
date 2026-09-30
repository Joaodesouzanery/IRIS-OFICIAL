/**
 * Etapa 218 (Fase 36, Bloco D) — a ausência que o documento DIZ e o banco não tem.
 *
 * ═══ (a) Uma fonte por conceito ═══
 * `buildVotoRows` grava `motivo_nao_voto: "ausencia"` para o ausente e `"impedimento"` para o
 * impedido. `buildVotoRowsFromSuggestions` gravava `Ausente` **sem motivo nenhum**, tendo a
 * informação em mãos (`origem` já distingue). Dependendo de qual construtor gravou, a mesma
 * ausência ficava indistinguível de um impedimento — o defeito que a Fase 21 catalogou como "duas
 * implementações do mesmo conceito, divergentes".
 *
 * ═══ (b) O backfill, e o que ele não pode fazer ═══
 * A ARTESP é documento AVULSO: o texto está em `documentos_regulatorios.texto_extraido` ligado por
 * `deliberacao_id`, então o passivo se conserta sem baixar PDF. O risco é a rota inferir voto em vez
 * de só registrar ausência — e é isso que estas expectativas prendem: `activeDiretoresList: []` e
 * `inferFromMandate: false` deixam `buildVotoRows` com um único desfecho possível.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildVotoRows, buildVotoRowsFromSuggestions, type DiretorVoteRecord } from "../vote-inference";
import { extractAusentesComOrigem } from "../nlp-extractor";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const ROTA = semComentarios(ler("src/app/api/v1/admin/votos/ausencias-artesp/route.ts"));

/**
 * ⚠️ `nome_variantes: []` e não `null`. `findBestMatch` espalha o array (`...dir.nome_variantes`) e
 * estoura com `null` — conferi o schema antes de "blindar" o matcher: a coluna é
 * `TEXT[] NOT NULL DEFAULT '{}'` (`001_initial_schema.sql:25`), então o banco não produz esse caso e
 * uma guarda ali seria código morto. Era o FIXTURE que estava errado.
 */
const DIRETORES: DiretorVoteRecord[] = [
  { id: "raquel", nome: "Raquel França Carneiro", nome_variantes: [] },
  { id: "andre", nome: "André Isper Bueno", nome_variantes: [] },
  { id: "milton", nome: "Milton Roberto Persoli", nome_variantes: [] },
];

describe("etapa218 · (a) a ausência tem MOTIVO nos dois construtores", () => {
  it("`buildVotoRowsFromSuggestions` grava `ausencia` — antes gravava nada", () => {
    const rows = buildVotoRowsFromSuggestions({
      deliberacao_id: "d1",
      votosSugeridos: [
        { nome: "Raquel França Carneiro", diretor_id: "raquel", tipo_voto: "Ausente", origem: "ausente", is_nominal: true },
      ],
    });
    expect(rows[0].tipo_voto).toBe("Ausente");
    expect(rows[0].motivo_nao_voto, "ausência sem motivo é indistinguível de impedimento no banco")
      .toBe("ausencia");
  });

  it("e `impedimento` quando a origem é impedido — a distinção existia e se perdia", () => {
    const rows = buildVotoRowsFromSuggestions({
      deliberacao_id: "d1",
      votosSugeridos: [
        { nome: "André Isper Bueno", diretor_id: "andre", tipo_voto: "Ausente", origem: "impedido", is_nominal: true },
      ],
    });
    expect(rows[0].motivo_nao_voto).toBe("impedimento");
  });

  it("⚠️ os DOIS construtores concordam para a mesma ausência", () => {
    const porSugestao = buildVotoRowsFromSuggestions({
      deliberacao_id: "d1",
      votosSugeridos: [
        { nome: "Raquel França Carneiro", diretor_id: "raquel", tipo_voto: "Ausente", origem: "ausente", is_nominal: true },
      ],
    });
    const direto = buildVotoRows({
      deliberacao_id: "d1",
      nomes: [], nomesContra: [], nomesAusente: ["Raquel França Carneiro"],
      nomesAbstencao: [], nomesImpedido: [],
      diretoresList: DIRETORES, activeDiretoresList: [], inferFromMandate: false,
      resultado: null, unanime: false,
    });
    expect(direto.length).toBe(1);
    expect(porSugestao[0].motivo_nao_voto).toBe(direto[0].motivo_nao_voto);
    expect(porSugestao[0].tipo_voto).toBe(direto[0].tipo_voto);
  });

  it("voto de DIREÇÃO não recebe motivo — o campo é sobre quem NÃO votou", () => {
    const rows = buildVotoRowsFromSuggestions({
      deliberacao_id: "d1",
      votosSugeridos: [
        { nome: "Milton Roberto Persoli", diretor_id: "milton", tipo_voto: "Favoravel", origem: "nominal", is_nominal: true },
      ],
    });
    expect(rows[0].motivo_nao_voto).toBeUndefined();
  });
});

describe("etapa218 · (b) a chamada do backfill SÓ pode produzir ausência", () => {
  it("com roster vazio e sem inferência, `buildVotoRows` devolve apenas `Ausente`", () => {
    const rows = buildVotoRows({
      deliberacao_id: "d1",
      nomes: [], nomesContra: [], nomesAusente: ["Raquel França Carneiro", "André Isper Bueno"],
      nomesAbstencao: [], nomesImpedido: [],
      diretoresList: DIRETORES, activeDiretoresList: [], inferFromMandate: false,
      resultado: "Aprovado", unanime: true,
    });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.tipo_voto === "Ausente")).toBe(true);
    expect(rows.every((r) => r.motivo_nao_voto === "ausencia")).toBe(true);
    // ⚠️ Milton NÃO está no texto e NÃO recebe linha: a rota não completa colegiado.
    expect(rows.some((r) => r.diretor_id === "milton")).toBe(false);
  });

  it("⚠️ e nome que o cadastro não reconhece não vira linha nenhuma", () => {
    const rows = buildVotoRows({
      deliberacao_id: "d1",
      nomes: [], nomesContra: [], nomesAusente: ["Fulano de Tal Que Não Existe"],
      nomesAbstencao: [], nomesImpedido: [],
      diretoresList: DIRETORES, activeDiretoresList: [], inferFromMandate: false,
      resultado: null, unanime: false,
    });
    expect(rows).toEqual([]);
  });

  it("o extrator que a rota usa é o MESMO da ingestão, com a origem preservada", () => {
    const texto = "Ausência Justificada: Raquel França Carneiro - Diretora - Afastamento em Férias. "
      + "Registrou-se a ausência do Diretor André Isper Bueno na presente sessão.";
    const achados = extractAusentesComOrigem(texto);
    const nomes = achados.map((a) => a.nome);
    expect(nomes.some((n) => n.includes("Raquel"))).toBe(true);
    expect(nomes.some((n) => n.includes("André") || n.includes("Isper"))).toBe(true);
    // O trecho existe para o operador conferir contra o PDF antes de aplicar.
    expect(achados.every((a) => a.trecho.length > 0)).toBe(true);
    expect(new Set(achados.map((a) => a.origem)).size).toBeGreaterThanOrEqual(1);
  });
});

describe("etapa218 · a rota não apaga, não infere e não escreve por padrão", () => {
  it("dry_run é o padrão — aplicar exige dizer explicitamente", () => {
    expect(ROTA).toMatch(/const dryRun = body\.dry_run !== false;/);
    expect(ROTA).toMatch(/aviso: "Simulação/);
  });

  it("⚠️ a chamada de escrita é a que não pode inferir, e é conferida DEPOIS", () => {
    expect(ROTA).toMatch(/activeDiretoresList: \[\],\s*inferFromMandate: false,/);
    expect(ROTA, "a rota deixou de conferir que só saíram linhas Ausente")
      .toMatch(/const soAusentes = rows\.filter\(\(r\) => r\.tipo_voto === "Ausente"\)/);
    expect(ROTA).toMatch(/if \(soAusentes\.length !== rows\.length\)/);
    expect(ROTA, "passou a gravar `rows` em vez do subconjunto conferido")
      .not.toMatch(/upsertVotosProtegido\(db, rows\)/);
  });

  it("⚠️ voto NOMINAL existente é preservado, mesmo divergindo do nosso extrator", () => {
    expect(ROTA).toMatch(/if \(atual\.nominal\) \{/);
    expect(ROTA).toMatch(/nominaisPreservadas\+\+/);
    expect(ROTA).toMatch(/upsertVotosProtegido/);
    expect(ROTA, "a rota passou a apagar voto — ela só insere e promove")
      .not.toMatch(/\.delete\(\)/);
  });

  it("`needsReview` conta como NÃO reconhecido — casar mal não autoriza escrever", () => {
    expect(ROTA).toMatch(/if \(!m\.diretorId \|\| m\.needsReview\)/);
    expect(ROTA).toMatch(/naoReconhecidos\.set\(a\.nome/);
  });

  it("⚠️ o texto vem em LOTES e a lista em `lerTudo` — nem N+1, nem `.limit` que não pagina", () => {
    expect(ROTA).toMatch(/lerEmLotes<any>\(db, \{/);
    expect(ROTA).toMatch(/lerTudo<any>\(/);
    expect(ROTA, "voltou o `.limit(N)` grande, que o PostgREST corta em ~1000 sem avisar")
      .not.toMatch(/\.limit\(\d{4,}\)/);
  });

  it("e o cadastro vazio RECUSA em vez de casar nome contra lista vazia", () => {
    expect(ROTA).toMatch(/if \(diretoresList\.length === 0\)/);
    expect(ROTA).toMatch(/status: 409/);
  });

  it("segue as convenções: gate de demo, guard, import dinâmico, resposta crua", () => {
    expect(ROTA).toMatch(/if \(isDemo\(\) \|\| isDemoRequest\(req\)\)/);
    expect(ROTA).toMatch(/const guard = await requireAdminOrCron\(req\);\s*if \(guard\) return guard;/);
    expect(ROTA).toMatch(/await import\("@\/lib\/supabase\/server"\)/);
    expect(ROTA, "introduziu envelope {data} — a convenção do projeto é payload direto")
      .not.toMatch(/NextResponse\.json\(\{ data:/);
  });
});
