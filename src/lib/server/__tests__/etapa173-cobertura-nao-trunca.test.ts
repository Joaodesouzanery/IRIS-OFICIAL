/**
 * Etapa 173 (Fase 31, Bloco 2) — as SEIS leituras da cobertura que truncavam em silêncio.
 *
 * ═══ O defeito ═══
 * `cobertura-documentos/route.ts` lia as seis tabelas num `Promise.all`, cinco delas com
 * `.limit(20000)`/`.limit(40000)` e **nenhuma com `.order()`**.
 *
 * `.limit(N)` grande NÃO é paginação: o PostgREST corta em ~1.000 e o limite grande é um teto que
 * a plataforma ignora. É o mesmo defeito que fez `Completude 2026`, `saude-dados` e
 * `governanca-agencias` subcontarem — e que chamou de "537 órfãos" o que era só o resto da fatia.
 *
 * ═══ A decisão principal: LINHAS ou CONTAGEM? ═══
 * `docs/PENDENCIAS.md:228` mandava medir `monitoramento_itens` antes de escolher entre
 * `count: "exact"` e `lerTudo` — trocar truncagem por 40 páginas de round-trip seria consertar
 * pelo lado errado. A leitura do código responde: **as seis precisam das LINHAS**, porque cada uma
 * agrega POR AGÊNCIA × status/tipo em JS, e um `count` total não produz esse recorte.
 *
 * Então é `lerTudo` — e a resposta passa a PUBLICAR quantas linhas leu de cada tabela. A medição
 * que o PENDENCIAS pedia deixa de ser pontual e passa a sair a cada chamada.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const ROTA_RAW = ler("src/app/api/v1/admin/cobertura-documentos/route.ts");
const ROTA = semComentarios(ROTA_RAW);

/** As seis tabelas, com o rótulo que cada leitura declara. */
const LEITURAS = [
  ["agencias", "cobertura/agencias"],
  ["antt_reunioes_coletadas", "cobertura/reunioes"],
  ["monitoramento_itens", "cobertura/itens"],
  ["documentos_coletados", "cobertura/coletados"],
  ["documentos_regulatorios", "cobertura/regulatorios"],
  ["deliberacoes", "cobertura/deliberacoes"],
] as const;

describe("etapa173 · nenhuma das seis trunca mais", () => {
  it.each(LEITURAS)("%s pagina com lerTudo, e com rótulo próprio", (tabela, rotulo) => {
    expect(ROTA, `${tabela} não passou a paginar`).toMatch(
      new RegExp(`lerTudo<any>\\(\\(\\) => db\\.from\\("${tabela}"\\)[\\s\\S]{0,260}?"${rotulo.replace("/", "\\/")}"\\)`),
    );
  });

  it("⚠️ o `.limit(N)` grande sumiu — ele nunca foi paginação", () => {
    expect(ROTA, "o teto que a plataforma ignora voltou").not.toMatch(/\.limit\(\d{4,}\)/);
  });

  it("⚠️ TODA leitura tem `.order` — sem ordem total, `.range()` repete e pula linhas", () => {
    // É o motivo de `selectAllPaged` exigir isso: a paginação sem ORDER BY não é estável.
    const chamadas = ROTA.match(/lerTudo<any>\(\(\) => db\.from\([\s\S]*?\), "cobertura\/[a-z]+"\)/g) ?? [];
    expect(chamadas.length, "as seis leituras sumiram").toBe(6);
    for (const c of chamadas) expect(c, `sem .order(): ${c.slice(0, 70)}`).toMatch(/\.order\("id"\)/);
  });
});

describe("etapa173 · ⚠️ a leitura parcial é DECLARADA, não engolida", () => {
  it("a bandeira considera o ERRO, não só `truncated`", () => {
    // `selectAllPaged` devolve `truncated: false` no caminho de erro, com as linhas que já tinha.
    // Olhar só a truncagem faria o relatório parecer completo justo quando a leitura falhou.
    expect(ROTA).toMatch(/parcial: r\.truncated \|\| Boolean\(r\.error\)/);
  });

  it("a resposta publica quantas linhas cada tabela rendeu", () => {
    expect(ROTA).toMatch(/leitura_por_tabela,/);
    expect(ROTA).toMatch(/leitura_completa: !leituraParcial/);
    expect(ROTA).toMatch(/linhas: r\.data\.length/);
  });

  it("⚠️ o alerta de leitura parcial vem PRIMEIRO na lista", () => {
    // Um alerta sobre "N failed" lido sem a ressalva manda alguém investigar um número que não é
    // o número. `unshift`, não `push`.
    expect(ROTA).toMatch(/alertas\.unshift\(/);
    expect(ROTA).toMatch(/LEITURA PARCIAL/);
  });

  it("o alerta NOMEIA as tabelas parciais — «algo truncou» não é acionável", () => {
    expect(ROTA).toMatch(/filter\(\(\[, x\]\) => x\.parcial\)/);
  });

  it("e o erro de cada tabela vai junto, não só o booleano", () => {
    expect(ROTA).toMatch(/erro: r\.error \?/);
  });
});

describe("etapa173 · as seis precisam de LINHAS — a decisão está justificada no código", () => {
  it("cada leitura é consumida por uma agregação POR AGÊNCIA, não por um total", () => {
    // É isto que descarta `count: "exact"`: o recorte por agência × status/tipo não sai de um
    // total. O teste ancora nos laços que fazem o recorte.
    expect(ROTA).toMatch(/for \(const r of reunioesRes\.data/);
    expect(ROTA).toMatch(/for \(const it of itensRes\.data/);
    expect(ROTA).toMatch(/for \(const c of coletadosRes\.data/);
    expect(ROTA).toMatch(/for \(const d of regsRes\.data/);
    expect(ROTA).toMatch(/e\.docs_por_tipo\[c\.tipo\]/);
    expect(ROTA).toMatch(/e\.regulatorios\[d\.status\]/);
  });

  it("⚠️ a justificativa de por que NÃO é `count` está escrita, não implícita", () => {
    // O PENDENCIAS pedia a medição antes da escolha; quem ler o arquivo daqui a três fases
    // precisa encontrar a resposta, e não refazer a pergunta.
    expect(ROTA_RAW).toMatch(/PRECISAM DAS LINHAS/);
    expect(ROTA_RAW).toMatch(/PENDENCIAS\.md:228/);
  });
});
