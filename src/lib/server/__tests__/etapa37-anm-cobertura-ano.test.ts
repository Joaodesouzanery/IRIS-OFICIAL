import { describe, it, expect } from "vitest";
import { parseAnmReunioesComAno, anmNumerosDoAno } from "@/lib/server/anm-cobertura";

// QA ago/2026: a cobertura-ao-vivo da ANM não filtrava por ano (parse global sem contexto) e
// inflava faltando/extra com reuniões antigas. As páginas reais têm data adjacente a cada link
// ("31/07/2026 09h37" — verificado ao vivo); o parser pareia nº de reunião ↔ data mais próxima.

const HTML = `
<div class="item">
  <a href=".../atas-da-rop/sei_20223997_ata_86__reuniao_ordinaria_publica_da_dirc.pdf">Ata da 86ª Reunião Ordinária</a>
  <span class="date">31/07/2026 09h37</span>
</div>
<div class="item">
  <a href=".../sei_19975061_ata_85__reuniao_ordinaria_publica_da_dirc.pdf">Ata da 85ª Reunião Ordinária</a>
  <span class="date">21/07/2026 16h34</span>
</div>
<div class="item">
  <a href=".../atas-da-rop/ata-32-rep.pdf">Ata da 32ª Reunião Extraordinária</a>
  <span class="date">16/07/2025 12h13</span>
</div>
<div class="item">
  <a href=".../ata-77-sem-data.pdf">Ata da 77ª Reunião Ordinária</a>
</div>`;

describe("parseAnmReunioesComAno [C]", () => {
  const rs = parseAnmReunioesComAno(HTML);
  it("pareia cada reunião com o ano da data adjacente", () => {
    expect(rs.find((r) => r.numero === 86)?.ano).toBe(2026);
    expect(rs.find((r) => r.numero === 85)?.ano).toBe(2026);
    expect(rs.find((r) => r.numero === 32)?.ano).toBe(2025);
  });
  it("reunião sem data próxima fica com ano null (mantida, não some)", () => {
    expect(rs.find((r) => r.numero === 77)?.ano).toBeNull();
  });
});

describe("anmNumerosDoAno [C]", () => {
  it("filtra pelo ano pedido, mantendo as sem-data", () => {
    expect(anmNumerosDoAno([HTML], 2026)).toEqual([77, 85, 86]); // 32 (2025) sai; 77 (sem data) fica
    expect(anmNumerosDoAno([HTML], 2025)).toEqual([32, 77]);
  });
  it("HTML vazio → []", () => {
    expect(anmNumerosDoAno([""], 2026)).toEqual([]);
  });
});
