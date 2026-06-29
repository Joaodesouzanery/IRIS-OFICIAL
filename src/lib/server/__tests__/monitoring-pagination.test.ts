import { describe, it, expect } from "vitest";
import { parseMonitoringHtml, findNextMonitoringPageUrl } from "@/lib/server/monitoring";

// HTML sintético no estilo ANM (Plone): listagem de reuniões/atas com paginação
// por "Próximo" (b_start). Antes só a 1ª página era lida; o teste fixa que a
// detecção de próxima página e o parser de documentos funcionam.
const PAGINA_1 = `
<html><body>
  <a href="/reunioes/123a-reuniao-de-diretoria/view">123ª Reunião de Diretoria - 10/03/2026</a>
  <a href="/reunioes/ata-123/@@download/file">Ata da 123ª Reunião</a>
  <a href="/reunioes/voto-123/@@download/file">Voto - Processo 0001/2026</a>
  <nav>
    <a href="/reunioes?b_start:int=0">Anterior</a>
    <a href="/reunioes?b_start:int=20" rel="next">Próximo</a>
  </nav>
</body></html>`;

const PAGINA_LIFERAY = `
<html><body>
  <a href="/atas">Página inicial</a>
  <a class="pager" href="/reunioes/p/2">Próxima</a>
</body></html>`;

const PAGINA_SEM_PROXIMA = `
<html><body>
  <a href="/reunioes/124a-reuniao/view">124ª Reunião de Diretoria - 20/03/2026</a>
  <a href="/reunioes?b_start:int=0">Anterior</a>
</body></html>`;

describe("paginação de monitoramento", () => {
  const base = "https://www.gov.br/anm/reunioes";

  it("detecta a próxima página via rel=next / texto 'Próximo'", () => {
    // href é caminho absoluto (/reunioes...) → resolve na raiz do host, como o navegador faria.
    const next = findNextMonitoringPageUrl(PAGINA_1, base);
    expect(next).toBe("https://www.gov.br/reunioes?b_start:int=20");
  });

  it("detecta 'Próxima' (Liferay) e mantém o mesmo host", () => {
    const next = findNextMonitoringPageUrl(PAGINA_LIFERAY, "https://www.artesp.sp.gov.br/reunioes");
    expect(next).toBe("https://www.artesp.sp.gov.br/reunioes/p/2");
  });

  it("retorna null quando não há próxima (só 'Anterior')", () => {
    expect(findNextMonitoringPageUrl(PAGINA_SEM_PROXIMA, base)).toBeNull();
  });

  it("não segue link de página para outro host", () => {
    const html = `<a href="https://malicioso.example/reunioes?p=2" rel="next">Próximo</a>`;
    expect(findNextMonitoringPageUrl(html, base)).toBeNull();
  });

  it("o parser de documentos extrai ata e voto da listagem (não vira notícia)", () => {
    const items = parseMonitoringHtml(PAGINA_1, base);
    const tipos = items.map((i) => i.tipo);
    expect(tipos).toContain("ata");
    expect(tipos).toContain("voto");
  });
});
