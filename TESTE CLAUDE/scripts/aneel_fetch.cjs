// ANEEL: abre paginas anti-robo (www2.aneel.gov.br, reuniaodiretoria.aneel.gov.br, biblioteca) numa UNICA sessao Chromium:
// 1) "esquenta" no gov.br/aneel (cookies), 2) tenta cada URL esperando o desafio JS (titulo "Um momento..."), 3) salva HTML + log.
// NAO resolve captcha: "Attention Required / Sorry, you have been blocked" (Cloudflare) e registrado como bloqueio.
// Uso: [ANEEL_HEADED=1 xvfb-run -a] node aneel_fetch.cjs <saida_dir> <url1> [<url2> ...]  -> saida_dir/<n>.html + saida_dir/_log.json
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
(async () => {
  const [dir, ...urls] = process.argv.slice(2); fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: !process.env.ANEEL_HEADED, args: ['--no-sandbox'], proxy: { server: process.env.HTTPS_PROXY } });
  const c = await b.newContext({ ignoreHTTPSErrors: true, locale: 'pt-BR', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const p = await c.newPage(); const log = [];
  try { await p.goto('https://www.gov.br/aneel/pt-br/reunioes-publicas/pautas-e-atas', { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForTimeout(3000); } catch (e) {}
  let i = 0;
  for (const u of urls) {
    const r = { url: u, n: i, modo: process.env.ANEEL_HEADED ? 'headed(xvfb)' : 'headless' };
    try {
      const resp = await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 }); r.status = resp && resp.status();
      for (let k = 0; k < 8; k++) {
        await p.waitForTimeout(4000); const t = await p.title(); const h = await p.content();
        if (/Attention Required|Sorry, you have been blocked/i.test(t + h.slice(0, 3000))) { r.bloqueio = 'Cloudflare: Sorry, you have been blocked'; break; }
        if (!/Just a moment|Um momento/i.test(t) && h.length > 3000) break;
      }
      const h = await p.content(); r.title = await p.title(); r.bytes = h.length; fs.writeFileSync(`${dir}/${i}.html`, h);
    } catch (e) { r.erro = String(e).slice(0, 160).split('\n')[0]; }
    log.push(r); console.log(JSON.stringify(r)); i++;
  }
  fs.writeFileSync(`${dir}/_log.json`, JSON.stringify(log, null, 1)); await b.close();
})();
