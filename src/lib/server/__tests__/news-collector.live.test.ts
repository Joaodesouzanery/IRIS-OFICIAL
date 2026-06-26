/**
 * QA AO VIVO das 14 fontes de notícias (rede real). Pulado por padrão; rode com:
 *   LIVE_QA=1 npm run test
 * Mede, por fonte: status, links encontrados, itens, itens com data e com imagem.
 * Falha se uma fonte gov.br trouxer 0 itens. ARTESP depende de headless (pode faltar
 * no ambiente local) → apenas registrado, sem falhar.
 */
import { describe, it, expect } from "vitest";
import { collectRegulatoryNews, type NewsSourceConfig } from "@/lib/server/news-collector";

const LIVE = process.env.LIVE_QA === "1";

const SOURCES: NewsSourceConfig[] = [
  { agencia_sigla: "ARTESP", fonte: "ARTESP", url: "https://www.artesp.sp.gov.br/artesp/noticias", strategy: "artesp", tier: "core" },
  { agencia_sigla: "ANTT", fonte: "ANTT", url: "https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias", strategy: "govbr", tier: "core" },
  { agencia_sigla: "ANM", fonte: "ANM", url: "https://www.gov.br/anm/pt-br/assuntos/noticias", strategy: "govbr", tier: "core" },
  { agencia_sigla: "ANA", fonte: "ANA", url: "https://www.gov.br/ana/pt-br/assuntos/noticias-e-eventos/noticias", strategy: "govbr", tier: "expanded" },
  { agencia_sigla: "ANAC", fonte: "ANAC", url: "https://www.gov.br/anac/pt-br/noticias", strategy: "govbr", tier: "expanded" },
  { agencia_sigla: "ANATEL", fonte: "ANATEL", url: "https://www.gov.br/anatel/pt-br/assuntos/noticias", strategy: "govbr", tier: "expanded" },
  { agencia_sigla: "ANCINE", fonte: "ANCINE", url: "https://www.gov.br/ancine/pt-br/assuntos/noticias", strategy: "govbr", tier: "expanded" },
  { agencia_sigla: "ANEEL", fonte: "ANEEL", url: "https://www.gov.br/aneel/pt-br/assuntos/noticias", strategy: "govbr", tier: "expanded" },
  { agencia_sigla: "ANP", fonte: "ANP", url: "https://www.gov.br/anp/pt-br/canais_atendimento/imprensa/noticias-comunicados", strategy: "govbr", tier: "expanded" },
  { agencia_sigla: "ANPD", fonte: "ANPD", url: "https://www.gov.br/anpd/pt-br/assuntos/noticias", strategy: "govbr", tier: "expanded" },
  { agencia_sigla: "ANS", fonte: "ANS", url: "https://www.gov.br/ans/pt-br/assuntos/noticias", strategy: "govbr", tier: "expanded" },
  { agencia_sigla: "ANTAQ", fonte: "ANTAQ", url: "https://www.gov.br/antaq/pt-br/noticias", strategy: "govbr", tier: "expanded" },
  { agencia_sigla: "ANVISA", fonte: "ANVISA", url: "https://www.gov.br/anvisa/pt-br/assuntos/noticias-anvisa", strategy: "govbr", tier: "expanded" },
];

// dedup por sigla (defensivo)
const UNIQUE = [...new Map(SOURCES.map((s) => [s.agencia_sigla, s])).values()];

describe.skipIf(!LIVE)("QA ao vivo — coleta de notícias das 14 fontes (LIVE_QA=1)", () => {
  for (const src of UNIQUE) {
    it(`${src.agencia_sigla}: traz notícias (link + data + imagem)`, async () => {
      const res = await collectRegulatoryNews([src], 5, 0, { mode: "enrich" });
      const items = res.items;
      const comData = items.filter((i) => i.publicado_em).length;
      const comImagem = items.filter((i) => i.imagem_url).length;
      const rep = res.source_reports[0];
      // eslint-disable-next-line no-console
      console.log(
        `[QA] ${src.agencia_sigla.padEnd(7)} status=${rep?.status ?? "-"} links=${String(rep?.links_found ?? 0).padStart(3)} itens=${String(items.length).padStart(2)} comData=${comData} comImagem=${comImagem} ex=${items[0]?.url ?? "-"}`,
      );

      if (src.strategy === "artesp") return; // depende de headless; só registra

      expect(items.length, `${src.agencia_sigla}: 0 itens`).toBeGreaterThanOrEqual(1);
      expect(comData, `${src.agencia_sigla}: nenhum item com data`).toBeGreaterThanOrEqual(1);
    }, 120_000);
  }
});
