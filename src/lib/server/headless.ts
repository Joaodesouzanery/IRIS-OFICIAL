/**
 * headless.ts
 * Renderização headless (puppeteer-core + @sparticuz/chromium) usada como FALLBACK
 * quando o fetch simples falha por rede (403/timeout) ou a página exige JavaScript.
 *
 * As dependências pesadas são importadas dinamicamente para não inflar bundles que
 * não usam headless, e ficam registradas em serverExternalPackages (next.config.mjs).
 *
 * IMPORTANTE: se o 403 do ARTESP for bloqueio de egress da própria Vercel (e não WAF do
 * site), o Chromium roda no mesmo egress e também falhará — nesse caso tryRenderHtmlFallback
 * loga "fallback FALHOU" sinalizando a necessidade de um proxy de saída.
 */

export async function fetchRenderedHtml(url: string, opts: { timeoutMs?: number } = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const chromium = (await import("@sparticuz/chromium")).default;
  const puppeteer = (await import("puppeteer-core")).default;

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent("IRIS-Regulacao-Headless/1.0 (+https://iris-oficial.vercel.app)");
    await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
    return await page.content();
  } finally {
    await browser.close();
  }
}

/**
 * Renderiza um HTML autocontido em PDF (A4) no servidor, sem depender da impressão do navegador.
 * Reusa o mesmo Chromium serverless (@sparticuz/chromium) já instalado.
 */
export async function renderPdfFromHtml(html: string, opts: { timeoutMs?: number } = {}): Promise<Buffer> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const chromium = (await import("@sparticuz/chromium")).default;
  const puppeteer = (await import("puppeteer-core")).default;

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: timeoutMs });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "12mm", right: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/**
 * Tenta renderizar via headless e devolve o HTML, ou null em qualquer falha.
 * Nunca lança — é um fallback. Desative com HEADLESS_FALLBACK=0.
 */
export async function tryRenderHtmlFallback(url: string, label: string): Promise<string | null> {
  if (process.env.HEADLESS_FALLBACK === "0") return null;
  try {
    const html = await fetchRenderedHtml(url);
    console.warn(`[headless] ${label} fallback OK`, JSON.stringify({ url, length: html.length }));
    return html;
  } catch (error) {
    console.warn(
      `[headless] ${label} fallback FALHOU (provável egress/IP bloqueado — avaliar proxy)`,
      JSON.stringify({ url, error: error instanceof Error ? error.message : String(error) }),
    );
    return null;
  }
}
