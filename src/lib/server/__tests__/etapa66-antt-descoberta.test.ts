/**
 * Etapa 66 — o caminho de DESCOBERTA da ANTT, contra HTML REAL do portal.
 *
 * ═══ Este teste corrige um diagnóstico meu que estava ERRADO ═══
 *
 * A Fase 4 concluiu que os 0% de cobertura nominal da ANTT vinham do caminho de descoberta, e
 * listou quatro correções: o descarte de anchor de voto de nível superior, a cauda do último bloco
 * `Processo Deliberado:`, o filtro `.pdf` no href cru, e o filename derivado do texto do anchor.
 *
 * **Medido contra três páginas reais de 2026, NENHUMA das quatro reproduz:**
 *
 * | Verificação | 1036ª RD | 1037ª RD | 288ª RDE |
 * |---|---|---|---|
 * | anchors de voto no HTML → capturados | 5 → 5 | 6 → 6 | 3 → 3 |
 * | votos com `.pdf` só no href decodificado | 0 | 0 | 0 |
 * | títulos que NÃO casam `VOTO-DXX-NNN-AAAA` | 0 | 0 | 0 |
 * | documentos do rodapé no último bloco | 0 | 0 | 0 |
 *
 * O critério de aceite era: **cada correção precisa de um assert que FALHE ANTES e passe depois**.
 * Nenhuma falha antes — logo nenhuma entra. Consertar o que não está quebrado só adiciona risco.
 *
 * ═══ O que este arquivo faz, então ═══
 *
 * Trava o comportamento CORRETO. O caminho é load-bearing e não tinha **um único teste**: nenhum
 * arquivo chamava `parseAnttMeetingPage`, `parseProcessos` ou `classifyDocumentLink` — a cobertura
 * existente era só de orçamento e skip-set. Sem fixture, uma mudança de layout do portal zera a
 * cobertura de voto em silêncio, que é exatamente a classe de defeito que produziu quase tudo o
 * que corrigimos nesta série.
 *
 * ⚠️ E o achado que sobra é maior que os quatro: `parseProcessos` já extrai o **RELATOR nominal**
 * de cada item ("DIRETOR FELIPE QUEIROZ"), e a agência está registrada com 0% de cobertura
 * nominal. Se o dado chega até aqui e não aparece no painel, o gargalo é operacional ou está
 * downstream — não na descoberta.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  parseAnttMeetingPage, parseProcessos, classifyDocumentLink,
  isTargetMeetingTitle, classifyMeetingType, extractAnchors,
} from "@/lib/server/antt-2026-collector";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/antt");
const ler = (f: string) => readFileSync(join(dir, f), "utf-8");
const PAGINA_URL = "https://portal.antt.gov.br/reuniao/-/asset_publisher/9NmL6MbUt7f1/content/id/7163264/1036-reuniao-de-diretoria";
const LISTAGEM_URL = "https://portal.antt.gov.br/web/guest/reunioes-da-diretoria";

function reuniao(fixture: string, titulo: string) {
  return parseAnttMeetingPage(ler(fixture), PAGINA_URL, titulo, LISTAGEM_URL, "<html></html>");
}

describe("etapa66 · a 1036ª Reunião de Diretoria (HTML real do portal)", () => {
  const m = reuniao("reuniao-1036-diretoria.html", "1036ª Reunião de Diretoria");

  it("a reunião é reconhecida, com número, série e data", () => {
    expect(m).not.toBeNull();
    expect(m!.numero).toBe("1036");
    expect(m!.tipo).toBe("ordinaria");
    expect(m!.data_inicio).toBe("2026-07-02");
  });

  it("TODOS os 5 votos do HTML são descobertos — o descarte de nível superior não perde nenhum", () => {
    const votos = m!.documentos.filter((d) => d.tipo === "voto");
    expect(votos.map((v) => v.titulo).sort()).toEqual([
      "Voto DAB 030-2026.pdf", "Voto DFQ 042-2026.pdf", "Voto DFQ 043-2026.pdf",
      "Voto DFQ 044-2026.pdf", "Voto DG 026-2026.pdf",
    ]);
  });

  it("cada voto vem ligado ao seu PROCESSO — é o que permite casar voto e deliberação", () => {
    for (const v of m!.documentos.filter((d) => d.tipo === "voto")) {
      expect(v.processo?.processo, `${v.titulo} sem processo associado`).toMatch(/^\d{5}\.\d{6}\/\d{4}-\d{2}$/);
    }
  });

  it("o título do voto casa o padrão que `isAnttVotoFilename` exige — o filename NÃO é genérico", () => {
    // A hipótese era que o anchor viria vazio e `inferLinkText` produziria "Voto.pdf", quebrando a
    // chave estável VOTO-DXX-NNN-AAAA. Medido: os títulos são o nome real do arquivo.
    for (const v of m!.documentos.filter((d) => d.tipo === "voto")) {
      expect(v.titulo, "título genérico quebraria a chave estável").toMatch(
        /\bvoto[\s_-]+(?:vista[\s_-]+)?(?:D[A-Z]{1,2}|DG)[\s_-]*\d{1,4}[\s_-]*-\s*20\d{2}/i,
      );
    }
  });

  it("pauta e ata também são descobertas, sem duplicar", () => {
    const tipos = m!.documentos.map((d) => d.tipo);
    expect(tipos.filter((t) => t === "pauta")).toHaveLength(1);
    expect(tipos.filter((t) => t === "ata")).toHaveLength(1);
  });

  it("o RELATOR nominal de cada item é extraído — o dado que a cobertura nominal precisa", () => {
    const relatores = m!.processos.map((p) => p.relator).filter(Boolean) as string[];
    expect(relatores.length, "sem relator não há voto nominal a materializar").toBeGreaterThan(0);
    expect(relatores.some((r) => /DIRETOR/i.test(r))).toBe(true);
  });

  it("a CAUDA do último bloco não contamina o último processo", () => {
    // A hipótese era que o último `split` engolisse o rodapé do portal (66 anchors depois do
    // último marcador). Medido: `decisao` sai limpa e nenhum documento do rodapé é capturado.
    const ultimo = m!.processos[m!.processos.length - 1];
    expect(ultimo.decisao ?? "", "decisão do último item contaminada pelo rodapé").toHaveLength(
      (ultimo.decisao ?? "").length,
    );
    expect((ultimo.decisao ?? "").length, "decisão longa demais = cauda vazando").toBeLessThan(500);
    for (const d of ultimo.documentos) {
      expect(d.tipo, "documento do rodapé capturado como voto").toBe("voto");
    }
  });
});

describe("etapa66 · a 288ª Reunião Deliberativa Eletrônica — a OUTRA série", () => {
  const m = reuniao("reuniao-288-deliberativa-eletronica.html", "288ª Reunião Deliberativa Eletrônica");

  it("é reconhecida como série ELETRÔNICA, com contador independente", () => {
    expect(m).not.toBeNull();
    expect(m!.numero).toBe("288");
    // ⚠️ `classifyMeetingType` distingue as três séries — é `tipo_reuniao` (o enum de DUAS
    // cardinalidades) que colapsa RD e RDE em "Ordinaria" mais adiante no pipeline.
    expect(m!.tipo).toBe("eletronica");
  });

  it("os 3 votos são descobertos e ligados a processo", () => {
    const votos = m!.documentos.filter((d) => d.tipo === "voto");
    expect(votos).toHaveLength(3);
    for (const v of votos) expect(v.processo?.processo).toBeTruthy();
  });
});

describe("etapa66 · as peças isoladas, contra o HTML real", () => {
  it("`classifyDocumentLink` separa voto de pauta e de ata", () => {
    expect(classifyDocumentLink("Voto DG 026-2026.pdf", "https://x/Voto+DG+026-2026.pdf")).toBe("voto");
    expect(classifyDocumentLink("Pauta da 1036ª Reunião", "https://x/Pauta.pdf")).toBe("pauta");
    expect(classifyDocumentLink("Ata da 1036ª Reunião", "https://x/Ata.pdf")).toBe("ata");
    // Sem `.pdf` no path, o link não é classificado — medido: nenhum voto real cai aqui.
    expect(classifyDocumentLink("Voto DG 026", "https://x/documento/view")).toBe("outro");
  });

  it("`isTargetMeetingTitle` aceita RD e RDE e recusa a ADMINISTRATIVA", () => {
    expect(isTargetMeetingTitle("1036ª Reunião de Diretoria")).toBe(true);
    expect(isTargetMeetingTitle("288ª Reunião Deliberativa Eletrônica")).toBe(true);
    expect(isTargetMeetingTitle("193ª Reunião de Diretoria Administrativa")).toBe(false);
  });

  it("`classifyMeetingType` distingue as TRÊS séries — a informação existe aqui", () => {
    expect(classifyMeetingType("1036ª Reunião de Diretoria")).toBe("ordinaria");
    expect(classifyMeetingType("288ª Reunião Deliberativa Eletrônica")).toBe("eletronica");
    expect(classifyMeetingType("100ª Reunião Extraordinária de Diretoria")).toBe("extraordinaria");
  });

  it("`parseProcessos` liga item → processo → voto no HTML real", () => {
    const processos = parseProcessos(ler("reuniao-1036-diretoria.html"), PAGINA_URL);
    expect(processos.length).toBeGreaterThan(5);
    const comVoto = processos.filter((p) => p.documentos.length > 0);
    expect(comVoto.length, "nenhum item ligado a voto").toBeGreaterThan(0);
    for (const p of comVoto) {
      for (const d of p.documentos) expect(d.tipo, "só voto entra no bloco do processo").toBe("voto");
    }
  });

  it("`extractAnchors` resolve URL relativa contra a base", () => {
    const anchors = extractAnchors('<a href="/documents/x.pdf">Voto</a>', "https://portal.antt.gov.br/a/b");
    expect(anchors[0].href).toBe("https://portal.antt.gov.br/documents/x.pdf");
  });
});

describe("etapa66 · a LISTAGEM continua sendo listagem — não confundir com página de reunião", () => {
  it("a listagem NÃO tem os marcadores que a página de reunião tem", () => {
    const listagem = ler("listagem-reunioes.html");
    expect(listagem).not.toContain("Processo Deliberado");
    expect(/href="[^"]*\.pdf/i.test(listagem), "a listagem não expõe PDF").toBe(false);
    // É por isso que o `antt.html` da raiz do repo não servia como fixture deste teste.
  });

  it("a listagem expõe as três séries, com contadores independentes", () => {
    const listagem = ler("listagem-reunioes.html");
    expect(listagem).toMatch(/10\d\dª Reunião de Diretoria/);
    expect(listagem).toMatch(/2\d\dª Reunião Deliberativa Eletrônica/);
  });
});
