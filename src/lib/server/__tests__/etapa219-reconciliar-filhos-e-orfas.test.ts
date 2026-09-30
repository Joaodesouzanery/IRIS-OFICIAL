/**
 * Etapa 219 (Fase 36, Bloco B.1/B.2/B.5) — a data da mãe, os filhos que nunca a seguiam, e a órfã
 * que era apagada sem ninguém ver.
 *
 * ═══ B.2 · O achado que muda a leitura do número ═══
 * Um ITEM de ata **não tem** `documentos_regulatorios` próprio: a linha é por PDF
 * (`UNIQUE(file_hash)`) e o único escritor de `deliberacao_id` é `markDocumentReviewed`, que no ramo
 * de ata recebe `ataPai.id`. A Janela C busca o texto POR `deliberacao_id` → todo filho cai em
 * `divergenteSemTexto`, **sempre, por construção**. A "1 corrigida" da 80ª era a MÃE.
 *
 * O custo era a janela: 120 linhas por chamada, passo sorteado ~4 vezes em 18 rodadas. Encher o lote
 * de filhos é gastar a janela em candidatos que não podem mudar.
 *
 * ⚠️ E o cabeçalho da minha `etapa208` leu isto AO CONTRÁRIO.
 *
 * ═══ B.1 · Por que RECONCILIAÇÃO e não evento de escrita ═══
 * O desenho inicial disparava a propagação "após escrita de data da mãe". A 80ª da ANM **nunca recebe
 * escrita**: a data dela já está certa, a re-derivação vê igual e segue. Os 27 filhos ficariam
 * desalinhados para sempre. A reconciliação é independente: roda sobre as mães VALIDADAS.
 *
 * "Validada" aqui é verificável: o próprio documento ancora a data que a mãe já tem.
 *
 * ═══ B.5 · Três defeitos, e o pior era o silêncio ═══
 * O bloco da órfã rodava só com `!dryRun` — então a simulação dava ZERO e não havia o que conferir
 * antes de apagar. Somava-se a isso `.limit(2000)` (que o PostgREST corta em ~1000 em silêncio) e um
 * `count` por reunião candidata (o N+1 da Fase 29).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const R = semComentarios(ler("src/app/api/v1/admin/deliberacoes/redatar/route.ts"));
const CONFIRM = semComentarios(ler("src/app/api/v1/upload/confirm/route.ts"));

describe("etapa219 · B.2 — o filho de ata sai do universo da Janela C", () => {
  it("o universo passa a saber quem é filho, e os filhos são excluídos", () => {
    expect(R, "o select perdeu `documento_pai_id` — sem ele não há como excluir filho")
      .toMatch(/\.select\("id, agencia_id, numero_reuniao, reuniao_ordinaria, tipo_reuniao, data_reuniao, reuniao_id, documento_pai_id"\)/);
    expect(R).toMatch(/const plausiveis = semAsTratadas\.filter\(\(d\) => !d\.documento_pai_id\);/);
  });

  it("⚠️ e o número dos excluídos é PUBLICADO — exclusão silenciosa é omissão", () => {
    expect(R).toMatch(/divergenteFilhosFora = semAsTratadas\.length - plausiveis\.length;/);
    expect(R).toMatch(/divergente_filhos_fora: divergenteFilhosFora/);
  });

  it("⚠️ a premissa é verificável no confirm: o item de ata recebe o id da MÃE", () => {
    // Se isto mudar, filho passa a ter texto próprio e a exclusão acima deixa de fazer sentido.
    expect(CONFIRM, "o confirm parou de ligar o documento à ata MÃE — reavalie a exclusão de filhos")
      .toMatch(/markDocumentReviewed\([\s\S]{0,200}ataPai\.id/);
  });
});

describe("etapa219 · B.1 — a reconciliação sai da MÃE VALIDADA", () => {
  it("a mãe validada é a que RE-DERIVA para a própria data", () => {
    const i = R.indexOf("if (rederivada === String(d.data_reuniao)) {");
    expect(i, "o ramo da mãe validada desapareceu").toBeGreaterThan(-1);
    const ramo = R.slice(i, R.indexOf("continue;", i));
    expect(ramo).toMatch(/maesValidadas\+\+/);
    expect(ramo).toMatch(/maesParaReconciliar\.push\(\{/);
    expect(ramo, "a mãe entra na reconciliação sem levar a própria reunião").toMatch(/reuniaoId:/);
  });

  it("⚠️ e ela roda DEPOIS do laço, em LOTE — um round-trip por mãe era o N+1 da Fase 29", () => {
    const iLaco = R.indexOf("for (const d of lote) {");
    const iRecon = R.indexOf("redatar/filhos-para-reconciliar");
    expect(iLaco).toBeGreaterThan(-1);
    expect(iRecon).toBeGreaterThan(iLaco);
    expect(R).toMatch(/lerEmLotes<any>\(db, \{[\s\S]{0,260}coluna: "documento_pai_id"/);
  });

  it("⚠️ a ANTT fica FORA até o portão B.3 — a âncora dela não é certificada", () => {
    expect(R).toMatch(/maesParaReconciliar\.filter\(\(m\) => m\.sigla\.toUpperCase\(\) !== "ANTT"\)/);
  });

  it("alinha por data OU por reuniao_id — religar só a data deixaria o rollup errado", () => {
    expect(R).toMatch(/const dataDifere = String\(filho\.data_reuniao \?\? ""\) !== mae\.data;/);
    expect(R).toMatch(/const reuniaoDifere = mae\.reuniaoId !== null/);
    expect(R).toMatch(/if \(!dataDifere && !reuniaoDifere\) continue;/);
  });

  it("⚠️ leitura incompleta dos filhos NÃO vira escrita parcial", () => {
    // Alinhar metade dos itens deixaria a ata metade num ano e metade noutro — pior que o desalinho.
    const i = R.indexOf("redatar/filhos-para-reconciliar");
    const bloco = R.slice(i, i + 1_800);
    expect(bloco).toMatch(/if \(r\.error\) divergenteLeituraCompleta = false;\s*else \{/);
  });

  it("dry_run mede e não escreve", () => {
    const i = R.indexOf("filhosDesalinhados++");
    expect(i).toBeGreaterThan(-1);
    const bloco = R.slice(i, i + 900);
    expect(bloco).toMatch(/if \(dryRun\) continue;/);
    expect(bloco, "a escrita do filho deixou de passar por `exigirEscrita`").toMatch(/exigirEscrita\(/);
  });

  it("⚠️ os três números viajam juntos — 'alinhados: 0' sozinho é ambíguo", () => {
    for (const chave of ["maes_validadas: maesValidadas", "filhos_desalinhados: filhosDesalinhados", "filhos_alinhados: filhosAlinhados"]) {
      expect(R, `${chave} não é publicado`).toContain(chave);
    }
    expect(R).toMatch(/amostra_filhos: amostraFilhos/);
  });
});

describe("etapa219 · B.5 — a órfã é contada e listada ANTES de apagar", () => {
  it("o bloco roda nos dois modos; só o delete é guardado", () => {
    expect(R, "o bloco da órfã voltou a rodar só fora do dry_run")
      .not.toMatch(/if \(!dryRun && hasBudget\(deadlineAt, 3_000\)\)/);
    const iDelete = R.indexOf('from("reunioes").delete()');
    const antes = R.slice(Math.max(0, iDelete - 300), iDelete);
    expect(antes).toMatch(/if \(dryRun\) continue;/);
  });

  it("⚠️ `lerTudo` no lugar do `.limit(2000)`, que o PostgREST corta em ~1000 sem avisar", () => {
    expect(R, "voltou o `.limit(2000)` sobre `reunioes` — subcontagem silenciosa")
      .not.toMatch(/from\("reunioes"\)\.select\("id, agencia_id, data_reuniao"\)\.limit\(2000\)/);
    expect(R).toMatch(/"redatar\/reunioes-orfas"/);
    expect(R).toMatch(/"redatar\/vinculos-de-reuniao"/);
  });

  it("e a contagem de filhos sai de UMA leitura, não de um count por reunião", () => {
    expect(R, "voltou o `count` por reunião — o N+1 que a Fase 29 mediu")
      .not.toMatch(/\{ count: "exact", head: true \}\)\s*\.eq\("reuniao_id"/);
    expect(R).toMatch(/const filhosPorReuniao = new Map<string, number>\(\);/);
    expect(R).toMatch(/if \(filhos > 0\) continue;/);
  });

  it("⚠️ sem a lista COMPLETA de vínculos, não apaga nada", () => {
    const i = R.indexOf("redatar/vinculos-de-reuniao");
    const bloco = R.slice(i, i + 700);
    expect(bloco).toMatch(/if \(vinculos\.error \|\| vinculos\.truncated\) \{\s*divergenteLeituraCompleta = false;/);
  });

  it("o apagamento deixa RASTRO nomeado, via `exigirEscrita`", () => {
    const i = R.indexOf('from("reunioes").delete()');
    const bloco = R.slice(Math.max(0, i - 200), i + 300);
    expect(bloco).toMatch(/exigirEscrita\(/);
    expect(bloco).toMatch(/reunião órfã/);
    expect(bloco).toMatch(/0 deliberações/);
  });

  it("e o critério NÃO mudou: só data impossível para a agência", () => {
    expect(R).toMatch(/!dataReuniaoPlausivel\(sigla, r\.data_reuniao\)\.plausivel/);
  });

  it("continua apagando só `reunioes`, nunca deliberação", () => {
    expect(R).toMatch(/from\("reunioes"\)\.delete\(\)/);
    expect(R).not.toMatch(/from\("deliberacoes"\)\.delete\(\)/);
  });
});
