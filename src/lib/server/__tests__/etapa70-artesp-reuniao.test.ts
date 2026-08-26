/**
 * Etapa 70 (Fase 9) — a ARTESP e a reunião certa.
 *
 * ═══ O bug ═══
 * `HEAD_RE` exigia "Reunião" IMEDIATAMENTE seguido de "do Conselho Diretor". O texto real das
 * extraordinárias é `246ª Reunião Extraordinária​​&nbsp;do Conselho Diretor` — qualificador no
 * meio, DOIS zero-width spaces e um `&nbsp;` literal. Medido na página real: **45 cabeçalhos, 23
 * casavam**. Como cada documento é ligado ao cabeçalho casado mais próximo ANTES dele, os 22
 * perdidos faziam **217 de 284 links (76%) herdarem número e data da reunião errada** — e a ARTESP
 * tem DUAS séries de numeração (ordinárias 1146-1209, extraordinárias 204-246), então o erro não é
 * de um item, é de série inteira.
 *
 * ═══ Sobre a fixture ═══
 * ⚠️ Ela é RECONSTRUÍDA, não capturada. Ao tentar baixar a página real eu recebi o desafio do
 * Imperva (ver `etapa70-waf-bloqueio.test.ts`, que versiona a resposta literal). A ESTRUTURA
 * reproduz o que foi medido ao vivo em 26/08/2026, e as sequências que causam o bug estão em bytes
 * reais — os dois U+200B e o `&nbsp;`. Um teste guarda isso: se um formatador "limpar" a fixture,
 * ele falha em vez de passar a verde por ter apagado o próprio caso de teste.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseArtespReunioes } from "@/lib/server/monitoring";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures/artesp");
const PAGINA = readFileSync(join(fixtures, "reunioes-diretoria.html"), "utf-8");
const BASE = "https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria";
const RAIZ = join(__dirname, "../../../..");

describe("etapa70 · a fixture preserva o que causa o bug", () => {
  it("tem os DOIS zero-width spaces em bytes reais", () => {
    expect(PAGINA, "um formatador apagou o ZWSP — o caso de teste virou fumaça").toContain("​​");
  });

  it("tem o `&nbsp;` literal entre o qualificador e `do Conselho Diretor`", () => {
    expect(PAGINA).toMatch(/Extraordin[áa]ria[​]*&nbsp;do\s+Conselho\s+Diretor/);
  });

  it("o regex ANTIGO enxergaria só as ordinárias — é a prova do bug", () => {
    const antigo = /(\d{1,4})\s*[ªaº°]?\s*Reuni[ãa]o\s+do\s+Conselho\s+Diretor/gi;
    expect([...PAGINA.matchAll(antigo)].map((m) => m[1])).toEqual(["1209", "1208"]);
  });
});

describe("etapa70 · a extraordinária deixa de ser invisível", () => {
  const itens = parseArtespReunioes(PAGINA, BASE);

  it("os documentos da 246ª ficam com a 246ª — não com a 1209ª", () => {
    const daExtraordinaria = itens.filter((i) => i.url_item.includes("/bbb"));
    expect(daExtraordinaria.length).toBeGreaterThan(0);
    for (const item of daExtraordinaria) {
      expect(item.reuniao, `${item.url_item} herdou a reunião errada`).toContain("246");
    }
  });

  it("nenhum documento da ordinária vaza para a extraordinária, e vice-versa", () => {
    for (const item of itens) {
      const esperado = item.url_item.includes("/aaa") ? "1209"
        : item.url_item.includes("/bbb") ? "246"
        : "1208";
      expect(item.reuniao).toContain(esperado);
    }
  });

  it("o tipo vem do PRÓPRIO cabeçalho, não de uma janela de 260 chars atrás", () => {
    const extra = itens.find((i) => i.url_item.includes("/bbb"));
    expect((extra!.metadata as Record<string, unknown>).meeting_type).toBe("Extraordinaria");
  });

  it("…e acerta MESMO SEM a linha de rótulo antes — que é o que a janela lia", () => {
    // Na fixture completa há um `<b>Reunião Extraordinária</b>` antes do cabeçalho, então o
    // fallback da janela de 260 chars também acertaria: o teste acima não distinguia os dois
    // caminhos. Aqui o qualificador existe SÓ dentro do cabeçalho — e na página real ele vem
    // DEPOIS do número, que é exatamente onde a janela "antes" não olha.
    const semRotulo = `<html><body>
      <p><strong>246ª Reunião Extraordinária​​&nbsp;do Conselho Diretor</strong></p>
      <p>01/07/2026</p>
      <a href="https://admin.cms.sp.gov.br/dx/api/dam/z1?binary=true">Ata</a>
    </body></html>`;
    const [item] = parseArtespReunioes(semRotulo, BASE);
    expect(item, "o cabeçalho com qualificador precisa ser reconhecido").toBeTruthy();
    expect((item.metadata as Record<string, unknown>).meeting_type).toBe("Extraordinaria");
    expect(item.reuniao).toContain("246");
  });

  it("a data também acompanha a reunião certa", () => {
    const extra = itens.find((i) => i.url_item.includes("/bbb"));
    expect(extra!.data_reuniao).toBe("2026-07-01");
    const ord = itens.find((i) => i.url_item.includes("/aaa"));
    expect(ord!.data_reuniao).toBe("2026-07-17");
  });
});

describe("etapa70 · guard de falso positivo: o que NÃO pode virar cabeçalho", () => {
  it("a linha de rótulo `<b>Reunião Ordinária</b>` não é cabeçalho", () => {
    // Se `do Conselho Diretor` virasse opcional, essas linhas — que a própria página usa como
    // rótulo de seção — virariam cabeçalhos sem número, e a associação inteira se desfaria.
    const numeros = [...new Set(parseArtespReunioes(PAGINA, BASE).map((i) => i.reuniao ?? ""))];
    expect(numeros.every((r) => /\d/.test(r)), "cabeçalho sem número entrou").toBe(true);
  });

  it("texto solto com 'Reunião' não gera item", () => {
    const html = `<html><body><p>A próxima Reunião será em breve</p>
      <a href="https://admin.cms.sp.gov.br/dx/api/dam/x?binary=true">Ata</a></body></html>`;
    expect(parseArtespReunioes(html, BASE)).toEqual([]);
  });

  it("a normalização preserva o COMPRIMENTO — senão as associações deslizam em silêncio", () => {
    const fonte = readFileSync(join(RAIZ, "src/lib/server/monitoring.ts"), "utf-8");
    expect(fonte).toMatch(/if \(scan\.length !== html\.length\)/);
    expect(fonte).toMatch(/&nbsp;\/gi, "      "/);
  });
});

describe("etapa70 · o crawl passa a se curar", () => {
  const RUNNER = readFileSync(join(RAIZ, "src/lib/server/monitoring-runner.ts"), "utf-8");
  const bloco = RUNNER.slice(RUNNER.indexOf('insertError.code === "23505"'), RUNNER.indexOf('.eq("hash_item", item.hash_item)'));

  it("a colisão de hash reescreve reunião, data e título", () => {
    // Sem isto, consertar o parser não conserta NADA do que já está no banco: as 451 linhas da
    // ARTESP ficariam com o conteúdo que a primeira passagem produziu, para sempre.
    for (const campo of ["titulo: item.titulo", "reuniao: item.reuniao", "data_reuniao: item.data_reuniao"]) {
      expect(bloco).toContain(campo);
    }
  });

  it("NÃO toca no progresso da esteira nem no livro-caixa do retry", () => {
    for (const proibido of ["status:", "tentativas:", "proxima_tentativa_em:", "documento_id:", "upload_job_id:"]) {
      expect(bloco, `o reparo mexeu em ${proibido}`).not.toContain(proibido);
    }
  });

  it("NÃO sobrescreve `metadata` — apagaria o motivo de arquivamento", () => {
    // `item` é o item recém-parseado: o metadata dele não tem `enqueue_motivo`, `captura_erro` nem
    // `auto_enqueue_status`, que a linha do banco acumulou. Escrever apagaria o que o retry
    // consulta e o painel exibe.
    expect(bloco).not.toMatch(/metadata:/);
  });
});
