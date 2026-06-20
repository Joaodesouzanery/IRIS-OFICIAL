/**
 * Fallback de renderização headless para portais que bloqueiam fetch simples
 * (ex.: ARTESP/Liferay) ou exigem JavaScript para montar o HTML.
 *
 * É opcional e tolerante a falhas: usa `import()` dinâmico de `@sparticuz/chromium`
 * + `puppeteer-core` (carregados só quando acionado), pode ser desligado por
 * `HEADLESS_FALLBACK=0` e retorna `null` em qualquer erro — nunca quebra a coleta.
 */

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const NAV_TIMEOUT_MS = 25_000;

function isHeadlessEnabled() {
  return process.env.HEADLESS_FALLBACK !== "0";
}

/**
 * Tenta renderizar a URL num Chromium headless e devolver o HTML resultante.
 * Retorna `null` se o fallback estiver desligado ou se algo falhar.
 */
export async function tryRenderHtmlFallback(url: string, label = "página"): Promise<string | null> {
  if (!isHeadlessEnabled()) return null;

  let browser: import("puppeteer-core").Browser | null = null;
  try {
    const chromiumModule = await import("@sparticuz/chromium");
    const chromium = chromiumModule.default ?? (chromiumModule as unknown as typeof chromiumModule.default);
    const puppeteer = (await import("puppeteer-core")).default;

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();
    await page.setUserAgent(BROWSER_USER_AGENT);
    await page.setExtraHTTPHeaders({ "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" });
    await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    const html = await page.content();
    return html && html.trim().length > 0 ? html : null;
  } catch (error) {
    console.warn(
      `[headless] fallback indisponível para ${label} (${url}): ${error instanceof Error ? error.message : "erro desconhecido"}`,
    );
    return null;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignora erro ao fechar o browser */
      }
    }
  }
}
