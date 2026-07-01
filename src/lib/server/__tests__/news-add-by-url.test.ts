import { describe, it, expect } from "vitest";
import { detectNewsSourceFromUrl } from "@/lib/server/news-collector";

describe("detectNewsSourceFromUrl — agência a partir do link (colar link)", () => {
  it("gov.br/<sigla> → detecta a sigla e a estratégia govbr", () => {
    const d = detectNewsSourceFromUrl(
      "https://www.gov.br/ana/pt-br/assuntos/noticias-e-eventos/noticias/dou-publica-abertura-de-prazo-para-comprovacao-das-normas-de-referencia-da-ana",
    );
    expect(d).not.toBeNull();
    expect(d!.agencia_sigla).toBe("ANA");
    expect(d!.strategy).toBe("govbr");
    // source.url = caminho-pai (listagem) → isNewsDetailUrl aceita a URL colada
    expect(d!.url).toBe("https://www.gov.br/ana/pt-br/assuntos/noticias-e-eventos/noticias");
  });

  it("outra agência gov.br (ANEEL) também é detectada", () => {
    const d = detectNewsSourceFromUrl("https://www.gov.br/aneel/pt-br/assuntos/noticias/alguma-noticia");
    expect(d!.agencia_sigla).toBe("ANEEL");
    expect(d!.strategy).toBe("govbr");
  });

  it("ARTESP é detectada pelo host, estratégia artesp", () => {
    const d = detectNewsSourceFromUrl("https://www.artesp.sp.gov.br/artesp/noticias/uma-noticia-qualquer");
    expect(d!.agencia_sigla).toBe("ARTESP");
    expect(d!.strategy).toBe("artesp");
  });

  it("URL inválida → null", () => {
    expect(detectNewsSourceFromUrl("não é uma url")).toBeNull();
    expect(detectNewsSourceFromUrl("ftp://x/y")).toBeNull();
  });
});
