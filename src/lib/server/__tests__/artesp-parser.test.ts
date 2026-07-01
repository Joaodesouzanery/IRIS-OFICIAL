import { describe, it, expect } from "vitest";
import { parseArtespReunioes, isArtespReunioesUrl } from "@/lib/server/monitoring";

// Fixture fiel à estrutura real (WebSphere Portal): blocos repetidos de
// tipo/número/data + <ul> com <a href=DAM ...?binary=true>rótulo</a>.
const HTML = `
<section class="componente componenteParagrafo">
  <h3 class="tit-area"> 2026 </h3>
  <p dir="ltr"><strong>Pauta</strong>&nbsp;|&nbsp;Ata&nbsp;|&nbsp;Deliberações&nbsp;|</p>
  <p dir="ltr"><span style="color:#c0392b;"><b>Reunião Ordinária</b></span></p>
  <p dir="ltr"><strong>1201ª Reunião do Conselho Diretor</strong></p>
  <p dir="ltr">01/07/2026</p>
  <ul dir="ltr">
    <li><a href="https://admin.cms.sp.gov.br/dx/api/dam/v1/collections/aaa/items/bbb/renditions/ccc?binary=true" target="_blank">Pauta</a></li>
    <li><a href="https://admin.cms.sp.gov.br/dx/api/dam/v1/collections/aaa/items/ddd/renditions/eee?binary=true">Ata</a></li>
    <li><a href="https://admin.cms.sp.gov.br/dx/api/dam/v1/collections/aaa/items/fff/renditions/ggg?binary=true">Deliberações</a></li>
  </ul>
  <p dir="ltr"><span style="color:#c0392b;"><b>Reunião Extraordinária</b></span></p>
  <p dir="ltr"><strong>239ª Reunião do Conselho Diretor</strong></p>
  <p dir="ltr">25/06/2026</p>
  <ul dir="ltr">
    <li><a href="https://admin.cms.sp.gov.br/dx/api/dam/v1/collections/xxx/items/yyy/renditions/zzz?binary=true">Ata</a></li>
  </ul>
</section>`;

const BASE = "https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria";

describe("parseArtespReunioes", () => {
  const items = parseArtespReunioes(HTML, BASE);

  it("reconhece a URL de reuniões ARTESP", () => {
    expect(isArtespReunioesUrl(BASE)).toBe(true);
    expect(isArtespReunioesUrl("https://www.gov.br/anm/reunioes")).toBe(false);
  });

  it("extrai os documentos DAM (pauta/ata/deliberações), sem .pdf", () => {
    expect(items.length).toBe(4); // 3 da 1201ª + 1 da 239ª
    expect(items.every((i) => /admin\.cms\.sp\.gov\.br\/dx\/api\/dam/.test(i.url_item))).toBe(true);
  });

  it("associa cada doc à reunião CERTA (sem embaralhar) + título limpo", () => {
    const ata1201 = items.find((i) => i.tipo === "ata" && i.reuniao?.includes("1201"));
    expect(ata1201).toBeTruthy();
    expect(ata1201!.titulo).toBe("1201ª Reunião do Conselho Diretor — Ata (01/07/2026)");
    expect(ata1201!.data_reuniao).toBe("2026-07-01");
    expect(ata1201!.titulo).not.toContain("|"); // sem lixo pipe

    const ata239 = items.find((i) => i.tipo === "ata" && i.reuniao?.includes("239"));
    expect(ata239!.data_reuniao).toBe("2026-06-25");
    expect(ata239!.metadata.meeting_type).toBe("Extraordinaria");
  });

  it("classifica Deliberações como deliberacao", () => {
    const delib = items.find((i) => i.tipo === "deliberacao");
    expect(delib).toBeTruthy();
    expect(delib!.reuniao).toContain("1201");
  });

  it("hash_item único por documento (dedup estável pela URL DAM)", () => {
    const hashes = new Set(items.map((i) => i.hash_item));
    expect(hashes.size).toBe(items.length);
  });
});
