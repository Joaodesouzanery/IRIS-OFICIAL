// ANEEL: abre paginas anti-robo (www2.aneel.gov.br, reuniaodiretoria.aneel.gov.br) numa UNICA sessao Chromium, espera o desafio JS e salva o HTML.
// Uso: node aneel_fetch.cjs <saida_dir> <url1> [<url2> ...]   -> saida_dir/<n>.html + saida_dir/_log.json  (nao resolve captcha)
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
(async () => {
  const [dir, ...urls] = process.argv.slice(2); fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'], proxy: { server: process.env.HTTPS_PROXY } });
  const c = await b.newContext({ ignoreHTTPSErrors: true, locale: 'pt-BR', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const p = await c.newPage(); const log = [];
  let i = 0;
  for (const u of urls) {
    const r = { url: u, n: i };
    try {
      const resp = await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }); r.status = resp && resp.status();
      for (let k = 0; k < 8; k++) { await p.waitForTimeout(4000); const t = await p.title(); const h = await p.content(); if (!/Just a moment|Um momento|Access Denied|Forbidden|challenge/i.test(t + h.slice(0, 600)) && h.length > 3000) break; }
      const h = await p.content(); r.title = await p.title(); r.bytes = h.length; fs.writeFileSync(`${dir}/${i}.html`, h);
    } catch (e) { r.erro = String(e).slice(0, 200); }
    log.push(r); console.log(JSON.stringify(r)); i++;
  }
  fs.writeFileSync(`${dir}/_log.json`, JSON.stringify(log, null, 1)); await b.close();
})();
