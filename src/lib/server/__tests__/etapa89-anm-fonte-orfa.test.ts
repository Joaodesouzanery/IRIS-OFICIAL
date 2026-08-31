/**
 * Etapa 89 (Fase 15, commit A) — a QUINTA fonte da ANM e os 51 itens de menu.
 *
 * ═══ O bug ═══
 * O QA da Fase 14 devolveu os títulos dos 51 itens `diretoria`: "Ir para o Conteúdo 1",
 * "Abrir menu principal de navegação", 25 Gerências Regionais — menu e acessibilidade do
 * gov.br, nenhuma ata. E o bloco `seletor_dos_sites` mostrou a causa que três fases não viram:
 * a fonte "ANM - Reunioes da Diretoria Colegiada" ainda usa `a[href]`.
 *
 * Ela é uma linha ÓRFÃ: `ensureColegiadoSources` a criou quando `colegiado-sources.ts` apontava
 * para a página-índice; o commit 33ca7cf trocou a URL da constante para `atas-da-rop`, e como o
 * seed casa por `.eq("url", ...)` e a migration 20260830130000 lista as 4 URLs do seed SQL,
 * nenhum código nem migration alcança a órfã desde então.
 *
 * ═══ Por que ARQUIVAR os 51, e não deletar ═══
 * A migration 20260826120000 DELETOU essa classe uma vez — e o crawl re-inseriu (o hash não
 * existia mais, o insert volta a ter sucesso). `status='ignorado'` é terminal para
 * `tipo='diretoria'`: a fila de retry exige tipo da esteira, e a colisão de hash nunca toca
 * `status`. Arquivar é permanente; deletar é moinho.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const SQL = readFileSync(
  join(RAIZ, "supabase/migrations/20260831120000_anm_fonte_orfa_e_51.sql"),
  "utf-8",
);
// Asserções NEGATIVAS casam contra o SQL SEM comentários: o cabeçalho fala de "LIKE" e de
// "deletar" ao explicar por que NÃO os usa — prosa não pode reprovar código (lição repetida
// das etapas 73/75: assertion que casa comentário protege o bug errado).
const CODIGO = SQL.replace(/^\s*--.*$/gm, " ");
const URL_ORFA =
  "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada";

describe("etapa89 · a órfã ganha o seletor que as outras 4 já têm", () => {
  it("UPDATE por URL EXATA da página-índice, idempotente", () => {
    expect(SQL).toContain(`url = '${URL_ORFA}'`);
    expect(SQL).toMatch(/seletor_links = 'a:not\(\.state-published\)'/);
    expect(SQL).toMatch(/IS DISTINCT FROM 'a:not\(\.state-published\)'/);
  });

  it("sem LIKE — páginas de diretor individual moram sob o mesmo prefixo", () => {
    // `/composicao/diretoria-colegiada/<nome-do-diretor>` são fontes de DIRETOR
    // (agencias-curated-import.ts); um prefixo as capturaria junto.
    expect(CODIGO).not.toMatch(/\bLIKE\b/);
  });
});

describe("etapa89 · os 51 são ARQUIVADOS, não deletados", () => {
  it("vira `ignorado` com motivo declarado — e some do funil para sempre", () => {
    expect(SQL).toMatch(/SET status = 'ignorado'/);
    expect(SQL).toContain("pagina_institucional");
    expect(SQL).toMatch(/tipo = 'diretoria'/);
    expect(SQL).toMatch(/status = 'novo'/);
  });

  it("DELETE re-inseriria no próximo crawl — a migration não deleta nada", () => {
    expect(CODIGO).not.toMatch(/DELETE\s+FROM/i);
  });

  it("escopo: sites da ANM que não são notícia — 'ANM - Noticias' fica de fora", () => {
    expect(SQL).toMatch(/sigla = 'ANM'/);
    expect(SQL).toMatch(/tipo_fonte\s*<>\s*'noticias'/);
  });
});

describe("etapa89 · envelope das migrations do repo", () => {
  it("BEGIN/COMMIT + NOTIFY pgrst, sem INSERT", () => {
    expect(SQL).toContain("BEGIN;");
    expect(SQL).toContain("COMMIT;");
    expect(SQL).toMatch(/NOTIFY pgrst/);
    expect(CODIGO).not.toMatch(/INSERT INTO/i);
  });

  it("reporta o que fez — ROW_COUNT visível no SQL Editor", () => {
    expect(SQL).toMatch(/RAISE NOTICE/);
  });
});
