import { describe, it, expect } from "vitest";
import { isTransientCollectionError, type NewsSourceConfig } from "@/lib/server/news-collector";

const govbr: NewsSourceConfig = { agencia_sigla: "ANAC", fonte: "ANAC", url: "https://www.gov.br/anac/pt-br/noticias", strategy: "govbr" };
const artesp: NewsSourceConfig = { agencia_sigla: "ARTESP", fonte: "ARTESP", url: "https://www.artesp.sp.gov.br/artesp/noticias", strategy: "artesp" };

describe("isTransientCollectionError — não pintar vermelho por falha transitória", () => {
  it("rate-limit gov.br (403/429) é transitório", () => {
    expect(isTransientCollectionError(new Error("Falha ao coletar HTML oficial (HTTP 429 ao coletar ...): url"), govbr)).toBe(true);
    expect(isTransientCollectionError(new Error("HTTP 403 ao coletar ..."), govbr)).toBe(true);
  });
  it("timeout/5xx é transitório", () => {
    expect(isTransientCollectionError(new Error("Timeout (12000ms) ao coletar ..."), govbr)).toBe(true);
    expect(isTransientCollectionError(new Error("HTTP 503 ao coletar ..."), govbr)).toBe(true);
  });
  it("página degradada (200 magro): 'sem links' é transitório para gov.br E ARTESP", () => {
    const msg = new Error("Nenhum link de noticia valido encontrado na fonte oficial");
    expect(isTransientCollectionError(msg, artesp)).toBe(true);
    expect(isTransientCollectionError(msg, govbr)).toBe(true); // Etapa 9: gov.br também
  });
  it("detalhe/listagem vazios (página magra) são transitórios", () => {
    expect(isTransientCollectionError(new Error("Nenhuma noticia valida foi extraida dos links encontrados"), govbr)).toBe(true);
    expect(isTransientCollectionError(new Error("Detalhe indisponivel e listagem sem titulo ou data publicavel: https://x"), govbr)).toBe(true);
  });
  it("erro definitivo (404) não é transitório", () => {
    expect(isTransientCollectionError(new Error("HTTP 404 ao coletar ..."), govbr)).toBe(false);
    expect(isTransientCollectionError(new Error("Não é uma agência cadastrada"), govbr)).toBe(false);
  });
});
