import { describe, it, expect } from "vitest";
import { extractSiteSignals, levelFromSignals } from "@/lib/server/qualidade-site-coletor";

const BASE = "https://www.gov.br/antt";
const HTML = `
  <html><body>
    <nav>
      <a href="/antt/pt-br/acesso-a-informacao/acoes-e-programas/agenda-regulatoria">Agenda Regulatória</a>
      <a href="/antt/pt-br/acesso-a-informacao/acoes-e-programas/agenda-regulatoria/air">AIR</a>
      <a href="/antt/pt-br/acesso-a-informacao/acoes-e-programas/agenda-regulatoria/arr">ARR</a>
      <a href="/antt/pt-br/acesso-a-informacao/participacao-social/consultas-publicas">Consultas Públicas</a>
    </nav>
    <p>Análise de Impacto Regulatório e Agenda Regulatória da agência.</p>
  </body></html>`;

describe("extractSiteSignals — detecta seções por dimensão no portal", () => {
  const sig = extractSiteSignals(HTML, BASE);
  it("detecta AIR (1), Participação Social (2), Agenda (4) e ARR (6)", () => {
    expect(sig[1].hasSection).toBe(true); // AIR
    expect(sig[2].hasSection).toBe(true); // Participação Social / consultas
    expect(sig[4].hasSection).toBe(true); // Agenda Regulatória
    expect(sig[6].hasSection).toBe(true); // ARR
  });
  it("não inventa seção de Estoque (3) quando não há link", () => {
    expect(sig[3].hasSection).toBe(false);
  });
  it("resolve URLs absolutas das seções", () => {
    expect(sig[4].sectionUrls[0]).toContain("https://www.gov.br/antt");
    expect(sig[4].sectionUrls[0]).toContain("agenda-regulatoria");
  });
});

describe("levelFromSignals — combina site + notícias num nível IMQN", () => {
  it("sem seção e sem notícia → inexistente", () => {
    expect(levelFromSignals({ hasSection: false, termFreq: 0, newsHits: 0, recentNews: 0 })).toBe("inexistente");
  });
  it("só a seção existe (ou só 1 notícia) → inicial", () => {
    expect(levelFromSignals({ hasSection: true, termFreq: 0, newsHits: 0, recentNews: 0 })).toBe("inicial");
    expect(levelFromSignals({ hasSection: false, termFreq: 0, newsHits: 1, recentNews: 0 })).toBe("inicial");
  });
  it("seção + atividade recente (>=3) ou termos ricos → gerenciado", () => {
    expect(levelFromSignals({ hasSection: true, termFreq: 6, newsHits: 4, recentNews: 3 })).toBe("gerenciado");
    expect(levelFromSignals({ hasSection: false, termFreq: 0, newsHits: 6, recentNews: 6 })).toBe("gerenciado");
  });
  it("seção + muita atividade recente + termos → melhoria contínua", () => {
    expect(levelFromSignals({ hasSection: true, termFreq: 10, newsHits: 12, recentNews: 8 })).toBe("melhoria_continua");
  });
});
