import { describe, it, expect } from "vitest";
import { parseEventosFromHtml } from "@/lib/server/iris-eventos";

// Stage/eventos (out/2026): a seção final da newsletter puxa os próximos eventos do site do IRIS
// (irisregulacao.org/eventos/, "The Events Calendar"). Parseia JSON-LD Event (schema.org).

const HTML = `<!doctype html><html><head>
<script type="application/ld+json">
{ "@context":"https://schema.org", "@graph": [
  { "@type":"Event", "name":"Fórum Brasil Regulação", "startDate":"2026-03-05T09:00:00-03:00",
    "url":"https://irisregulacao.org/evento/bank-of-america/",
    "location":{ "@type":"Place", "name":"Bank of America Faria Lima", "address":{ "addressLocality":"São Paulo", "addressRegion":"SP" } } },
  { "@type":"WebPage", "name":"Página ignorada" }
]}
</script>
<script type="application/ld+json">
[ { "@type":["Event"], "name":"Seminário IRIS Free Flow", "startDate":"2026-03-26",
    "url":"https://irisregulacao.org/evento/seminario-iris-free-flow/",
    "location":{ "@type":"Place", "name":"Edifício CBS, Itaim Bibi" } } ]
</script>
</head><body></body></html>`;

describe("parseEventosFromHtml — JSON-LD Event do site do IRIS [eventos]", () => {
  const eventos = parseEventosFromHtml(HTML);

  it("extrai só objetos Event (ignora WebPage), com título/data/local/url", () => {
    expect(eventos.length).toBe(2);
    const forum = eventos.find((e) => e.titulo.includes("Fórum Brasil"));
    expect(forum).toBeTruthy();
    expect(forum?.data).toBe("2026-03-05"); // startDate truncado p/ ISO date
    expect(forum?.url).toBe("https://irisregulacao.org/evento/bank-of-america/");
    expect(forum?.local).toBe("Bank of America Faria Lima");
  });

  it("aceita @type array (['Event']) e location só com name", () => {
    const ff = eventos.find((e) => e.titulo.includes("Free Flow"));
    expect(ff?.data).toBe("2026-03-26");
    expect(ff?.local).toBe("Edifício CBS, Itaim Bibi");
  });

  it("HTML sem eventos → []", () => {
    expect(parseEventosFromHtml("<html><body>sem json-ld</body></html>")).toEqual([]);
  });
});
