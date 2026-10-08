// ANTAQ: tenta abrir SEI e Sophia (acervo das atas) num Chromium, UMA sessao, espera longa. NAO resolve captcha.
// Uso: node antaq_sei.cjs saida.json   (Playwright em /opt/node-tools; proxy do ambiente)
const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'], proxy: { server: process.env.HTTPS_PROXY } });
  const c = await b.newContext({ ignoreHTTPSErrors: true, locale: 'pt-BR', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const p = await c.newPage(); const out = [];
  const alvos = ['https://sei.antaq.gov.br/', 'https://sophia.antaq.gov.br/Terminal/acervo/detalhe/42844'];
  for (const u of alvos) {
    const r = { url: u, status: null, titulo: null, passou: false, amostra: '' };
    try {
      const resp = await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }); r.status = resp && resp.status();
      for (let i = 0; i < 12; i++) { await p.waitForTimeout(5000); const t = await p.title(); r.titulo = t; if (!/Just a moment|Attention|Verifique/i.test(t) && (await p.content()).length > 8000) { r.passou = true; break; } }
      r.amostra = (await p.content()).replace(/\s+/g, ' ').slice(0, 300);
    } catch (e) { r.erro = String(e).slice(0, 200); }
    out.push(r);
  }
  require('fs').writeFileSync(process.argv[2], JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1)); await b.close();
})();
