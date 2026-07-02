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
  it("ARTESP sem links (render JS) é transitório; gov.br sem links não é", () => {
    const msg = new Error("Nenhum link de noticia valido encontrado na fonte oficial");
    expect(isTransientCollectionError(msg, artesp)).toBe(true);
    expect(isTransientCollectionError(msg, govbr)).toBe(false);
  });
  it("erro definitivo (404) não é transitório", () => {
    expect(isTransientCollectionError(new Error("HTTP 404 ao coletar ..."), govbr)).toBe(false);
  });
});
