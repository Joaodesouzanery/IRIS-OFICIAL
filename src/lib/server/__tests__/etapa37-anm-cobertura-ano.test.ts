/**
 * Etapa 37 (reescrita na Fase 28) — o filtro de ano da ANM passa a FILTRAR.
 *
 * ═══ Por que esta reescrita ═══
 * A versão anterior deste arquivo usava HTML SINTÉTICO com ~150 caracteres entre o link e a data,
 * e passava verde há meses sobre um parser que, na página real, não acertava uma única reunião.
 * Medido contra a fixture verbatim do portal: a distância real entre link e data é de **731 a 799
 * caracteres em todos os 13 matches**, contra uma janela de 600. `parseAnmReunioesComAno` devolvia
 * `ano: null` para TODAS, e `anmNumerosDoAno(html, 2026)` e `(html, 2025)` retornavam a MESMA
 * lista. O instrumento que deveria provar cobertura da ANM não media nada — na rota que o operador
 * usa como prova.
 *
 * A asserção-chave deste arquivo é `2026 ≠ 2025` sobre a fixture verbatim. Ela é impossível de
 * passar por coincidência de setup, porque a fixture é o recorte literal da página publicada.
 *
 * ═══ Os dados, conferidos contra a listagem real ═══
 * ROP 87 = 21/08/2026 · ROP 86 = 31/07/2026 · ROP 85 = 21/07/2026 · ROP 84 = 08/06/2026
 * REP 34 = 16/01/2026 · REP 33 = 30/10/2025 · REP 32 = 12/08/2025
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  lerPaginaDaAnm,
  parseAnmReunioesComAno,
  anmNumerosDoAno,
  anmReunioesDoAno,
} from "@/lib/server/anm-cobertura";

const RAIZ = join(__dirname, "../../../..");
/** O recorte VERBATIM do portal. É ela que manda — não o HTML que eu inventaria. */
const REAL = readFileSync(join(RAIZ, "src/lib/server/__tests__/fixtures/anm/atas-da-rop.html"), "utf-8");

describe("etapa37 · a fixture VERBATIM do portal da ANM", () => {
  it("⚠️ 2026 e 2025 dão listas DIFERENTES — é isto que prova que o filtro filtra", () => {
    const de2026 = anmNumerosDoAno([REAL], 2026);
    const de2025 = anmNumerosDoAno([REAL], 2025);
    expect(de2026).not.toEqual(de2025);
    // Sem data continua entrando nos dois (a dúvida não apaga reunião): REP 31.
    expect(de2026).toEqual([31, 34, 84, 85, 86, 87]);
    expect(de2025).toEqual([31, 32, 33]);
  });

  it("cada reunião recebe o ano que o portal publica", () => {
    const porNumero = new Map(lerPaginaDaAnm(REAL).reunioes.map((r) => [r.numero, r]));
    expect(porNumero.get(87)?.ano).toBe(2026); // 21/08/2026
    expect(porNumero.get(86)?.ano).toBe(2026); // 31/07/2026
    expect(porNumero.get(85)?.ano).toBe(2026); // 21/07/2026
    expect(porNumero.get(84)?.ano).toBe(2026); // 08/06/2026
    expect(porNumero.get(34)?.ano).toBe(2026); // 16/01/2026
    expect(porNumero.get(33)?.ano).toBe(2025); // 30/10/2025
    expect(porNumero.get(32)?.ano).toBe(2025); // 12/08/2025
  });

  it("a página real É reconhecida — o degrade não pode virar o caminho normal", () => {
    expect(lerPaginaDaAnm(REAL).estruturaNaoReconhecida).toBe(false);
  });

  it("ROP e REP são distinguidas — hoje as faixas não cruzam, mas por sorte, não por desenho", () => {
    const porNumero = new Map(lerPaginaDaAnm(REAL).reunioes.map((r) => [r.numero, r]));
    expect(porNumero.get(87)?.serie).toBe("ROP");
    expect(porNumero.get(34)?.serie).toBe("REP");
    // ROP 84-87 e REP 31-34: a ROP avança ~4/ano e a REP também. O cruzamento é questão de tempo.
    // 31 entra em TODO ano: o bloco dela não tem data, e a dúvida não apaga reunião.
    expect(anmReunioesDoAno([REAL], 2026).filter((r) => r.serie === "REP").map((r) => r.numero)).toEqual([31, 34]);
    expect(anmReunioesDoAno([REAL], 2026).filter((r) => r.serie === "ROP").map((r) => r.numero)).toEqual([84, 85, 86, 87]);
  });

  it("reunião sem data no bloco fica com ano null — mantida, não some", () => {
    const porNumero = new Map(lerPaginaDaAnm(REAL).reunioes.map((r) => [r.numero, r]));
    expect(porNumero.get(31)?.ano).toBeNull();
  });
});

describe("etapa37 · layout ALTERNATIVO (span.date em vez de <time>) continua lido", () => {
  // Este era o ÚNICO caso do arquivo antigo. Ele fica — o que ele deixa de ser é a única prova.
  const SINTETICO = `
<div class="item">
  <a href=".../atas-da-rop/sei_20223997_ata_86__reuniao_ordinaria_publica_da_dirc.pdf">Ata da 86ª Reunião Ordinária</a>
  <span class="date">31/07/2026 09h37</span>
</div>
<div class="item">
  <a href=".../atas-da-rop/ata-32-rep.pdf">Ata da 32ª Reunião Extraordinária</a>
  <span class="date">16/07/2025 12h13</span>
</div>
<div class="item">
  <a href=".../ata-77-sem-data.pdf">Ata da 77ª Reunião Ordinária</a>
</div>`;

  it("pareia pelo bloco, não por distância em caracteres", () => {
    const rs = parseAnmReunioesComAno(SINTETICO);
    expect(rs.find((r) => r.numero === 86)?.ano).toBe(2026);
    expect(rs.find((r) => r.numero === 32)?.ano).toBe(2025);
    expect(rs.find((r) => r.numero === 77)?.ano).toBeNull();
  });

  it("filtra pelo ano, mantendo as sem-data", () => {
    expect(anmNumerosDoAno([SINTETICO], 2026)).toEqual([77, 86]);
    expect(anmNumerosDoAno([SINTETICO], 2025)).toEqual([32, 77]);
  });

  it("HTML vazio → [] (e não estoura)", () => {
    expect(anmNumerosDoAno([""], 2026)).toEqual([]);
  });
});

describe("etapa37 · layout DESCONHECIDO avisa em vez de devolver lista vazia", () => {
  it("sem âncora reconhecível, o scan assume e a leitura vem MARCADA", () => {
    // Uma origem que muda de layout não pode virar "cobertura completa" em silêncio (etapa101).
    const semAncora = "Ata da 91ª Reunião Ordinária Pública ... publicada em 10/03/2026 às 9h";
    const r = lerPaginaDaAnm(semAncora);
    expect(r.estruturaNaoReconhecida).toBe(true);
    expect(r.reunioes.find((x) => x.numero === 91)?.ano).toBe(2026);
  });

  it("o bloco do scan termina no próximo número DIFERENTE, não numa janela fixa", () => {
    // A janela fixa era o defeito: com marcação entre o link e a data, ela nunca chega lá.
    const recheio = "x".repeat(2000);
    const html = `Ata da 91ª Reunião Ordinária ${recheio} 10/03/2026 ${recheio} Ata da 90ª Reunião Ordinária ${recheio} 05/02/2025`;
    const r = lerPaginaDaAnm(html);
    expect(r.reunioes.find((x) => x.numero === 91)?.ano).toBe(2026);
    expect(r.reunioes.find((x) => x.numero === 90)?.ano).toBe(2025);
  });
});
