import { describe, it, expect } from "vitest";
import { dedupeListingImages } from "@/lib/server/news-collector";
import type { CollectedRegulatoryNews } from "@/lib/server/news-collector";

function art(url: string, imagem_url: string | null): CollectedRegulatoryNews {
  return {
    agencia_sigla: "ANA", titulo: `t ${url}`, url, fonte: "ANA",
    imagem_url, resumo: null, conteudo: null, publicado_em: "2026-06-20",
    hash_item: url, metadata: {},
  };
}

describe("dedupeListingImages — não repetir a mesma foto entre artigos", () => {
  it("mantém a 1ª ocorrência e zera as repetidas (logo/banner compartilhado)", () => {
    const logo = "https://x/logo-ana.png";
    const out = dedupeListingImages([
      art("https://x/a", logo),
      art("https://x/b", logo),
      art("https://x/c", logo),
      art("https://x/d", "https://x/foto-real.png"),
    ]);
    expect(out[0].imagem_url).toBe(logo);          // 1ª mantém
    expect(out[1].imagem_url).toBeNull();          // repetida → sem foto
    expect(out[2].imagem_url).toBeNull();
    expect(out[1].metadata.image_deduped).toBe(true);
    expect(out[3].imagem_url).toBe("https://x/foto-real.png"); // distinta preservada
  });

  it("não mexe em artigos sem imagem", () => {
    const out = dedupeListingImages([art("https://x/a", null), art("https://x/b", null)]);
    expect(out.every((i) => i.imagem_url === null)).toBe(true);
  });

  it("re-coleta do mesmo artigo (mesma url) não zera a própria imagem", () => {
    const out = dedupeListingImages([art("https://x/a", "https://x/img.png"), art("https://x/a", "https://x/img.png")]);
    expect(out[0].imagem_url).toBe("https://x/img.png");
    expect(out[1].imagem_url).toBe("https://x/img.png"); // mesma url de artigo → não é duplicata
  });
});
