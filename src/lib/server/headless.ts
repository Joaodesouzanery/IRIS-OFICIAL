/**
 * Fallback de renderização headless para portais que bloqueiam fetch simples
 * (ex.: ARTESP/Liferay) ou exigem JavaScript para montar o HTML.
 *
 * É opcional e tolerante a falhas: usa `import()` dinâmico de `@sparticuz/chromium`
 * + `puppeteer-core` (carregados só quando acionado) e pode ser desligado por
 * `HEADLESS_FALLBACK=0`. Nunca quebra a coleta — em erro, devolve um resultado
 * estruturado com a causa, registra um contador para telemetria e loga com nível
 * adequado (erro de dependência/launch vira `console.error`; navegação/HTML vazio,
 * `console.warn`).
 */

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const NAV_TIMEOUT_MS = 25_000;

function isHeadlessEnabled() {
  return process.env.HEADLESS_FALLBACK !== "0";
}

export type HeadlessReason =
  | "disabled"
  | "dependency_missing"
  | "launch_failed"
  | "navigation_failed"
  | "empty";

export type HeadlessOutcome =
  | { ok: true; html: string }
  | { ok: false; reason: HeadlessReason; message: string };

// Contador de causas por execução, drenado pelos routes de cron para telemetria.
const outcomeCounts = new Map<HeadlessReason, number>();

function recordHeadlessOutcome(reason: HeadlessReason) {
  outcomeCounts.set(reason, (outcomeCounts.get(reason) ?? 0) + 1);
}

export interface HeadlessStats {
  dependency_missing: number;
  launch_failed: number;
  navigation_failed: number;
  empty: number;
  disabled: number;
}

/** Lê e zera os contadores acumulados de falhas do fallback headless. */
export function drainHeadlessOutcomes(): HeadlessStats {
  const snapshot: HeadlessStats = {
    dependency_missing: outcomeCounts.get("dependency_missing") ?? 0,
    launch_failed: outcomeCounts.get("launch_failed") ?? 0,
    navigation_failed: outcomeCounts.get("navigation_failed") ?? 0,
    empty: outcomeCounts.get("empty") ?? 0,
    disabled: outcomeCounts.get("disabled") ?? 0,
  };
  outcomeCounts.clear();
  return snapshot;
}

/**
 * Renderiza a URL num Chromium headless e devolve um resultado estruturado,
 * distinguindo a causa quando falha (dependência ausente, launch, navegação ou
 * HTML vazio). Registra a causa para telemetria.
 */
export async function renderHtmlFallback(url: string, label = "página"): Promise<HeadlessOutcome> {
  if (!isHeadlessEnabled()) {
    recordHeadlessOutcome("disabled");
    return { ok: false, reason: "disabled", message: "HEADLESS_FALLBACK desligado" };
  }

  let browser: import("puppeteer-core").Browser | null = null;
  let phase: "deps" | "launch" | "navigate" = "deps";
  try {
    const chromiumModule = await import("@sparticuz/chromium");
    const chromium = chromiumModule.default ?? (chromiumModule as unknown as typeof chromiumModule.default);
    const puppeteer = (await import("puppeteer-core")).default;

    phase = "launch";
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    phase = "navigate";
    const page = await browser.newPage();
    await page.setUserAgent(BROWSER_USER_AGENT);
    await page.setExtraHTTPHeaders({ "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" });
    await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    const html = await page.content();
    if (html && html.trim().length > 0) return { ok: true, html };

    recordHeadlessOutcome("empty");
    return { ok: false, reason: "empty", message: "HTML vazio" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro desconhecido";
    let reason: HeadlessReason;
    if (phase === "deps" || /Cannot find module|ERR_MODULE_NOT_FOUND/i.test(message)) {
      reason = "dependency_missing";
    } else if (phase === "launch") {
      reason = "launch_failed";
    } else {
      reason = "navigation_failed";
    }
    recordHeadlessOutcome(reason);
    const log = reason === "dependency_missing" || reason === "launch_failed" ? console.error : console.warn;
    log(`[headless] ${reason} para ${label} (${url}): ${message}`);
    return { ok: false, reason, message };
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

/**
 * Compatível com os callers existentes: tenta renderizar e devolve o HTML, ou
 * `null` se o fallback estiver desligado ou falhar (a causa já foi logada e contada).
 */
export async function tryRenderHtmlFallback(url: string, label = "página"): Promise<string | null> {
  const outcome = await renderHtmlFallback(url, label);
  return outcome.ok ? outcome.html : null;
}
