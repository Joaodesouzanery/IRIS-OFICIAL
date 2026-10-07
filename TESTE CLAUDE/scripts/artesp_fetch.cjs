// ARTESP: abre a pagina de reunioes num Chromium comum e espera o desafio normal do Imperva. Salva o HTML.
// Uso: node artesp_fetch.cjs saida.html   (Playwright em /opt/node-tools; proxy do ambiente)
const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'], proxy: { server: process.env.HTTPS_PROXY } });
  const c = await b.newContext({ ignoreHTTPSErrors: true, locale: 'pt-BR', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const p = await c.newPage();
  await p.goto('https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria', { waitUntil: 'domcontentloaded', timeout: 60000 });
  let n = 0;
  for (let i = 0; i < 6 && n < 20; i++) { await p.waitForTimeout(5000); n = ((await p.content()).match(/dx\/api\/dam/g) || []).length; }
  require('fs').writeFileSync(process.argv[2], await p.content()); console.log('links DAM:', n); await b.close();
})();
