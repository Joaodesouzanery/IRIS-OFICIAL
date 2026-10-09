// Sessão ÚNICA de Chromium (passa o desafio JS do F5/TSPD como um navegador comum; NÃO resolve captcha).
// uso: node anac_fetch.cjs <saida_dir> <arquivo_lista_urls> [--pdf]
// cada linha da lista: URL [TAB nome_arquivo]. Salva corpo cru (html/json/pdf). Retry em reset de proxy.
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const exe = fs.readdirSync('/opt/pw-browsers').filter(x => x.startsWith('chromium-')).map(x => `/opt/pw-browsers/${x}/chrome-linux/chrome`)[0];
const [outDir, listFile] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'], proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined });
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, locale: 'pt-BR', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36' });
  const p = await ctx.newPage();
  const warm = async () => { for (let i = 0; i < 4; i++) { try { await p.goto('https://www.gov.br/anac/pt-br/acesso-a-informacao/institucional/reunioes-da-diretoria', { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForTimeout(4000); return true; } catch (e) { await sleep(3000); } } return false; };
  if (!(await warm())) { console.log('FALHA warm'); process.exit(2); }
  const lines = fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean);
  const log = [];
  for (const ln of lines) {
    const [url, nome] = ln.split('\t');
    const dest = path.join(outDir, nome || encodeURIComponent(url).slice(0, 180));
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0 && !process.env.REFAZ) { log.push({ url, status: 'cache' }); continue; }
    let ok = false, st = 0, why = '';
    for (let t = 0; t < 5 && !ok; t++) {
      try {
        const r = await p.evaluate(async (u) => {
          const x = await fetch(u, { credentials: 'include', headers: { 'Accept': u.includes('++api++') ? 'application/json' : '*/*' } });
          const buf = new Uint8Array(await x.arrayBuffer()); let s = ''; const CH = 0x8000;
          for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
          return { st: x.status, ct: x.headers.get('content-type'), b64: btoa(s) };
        }, url);
        st = r.st; const body = Buffer.from(r.b64, 'base64');
        const isChallenge = body.slice(0, 400).toString('latin1').includes('bobcmn') || body.slice(0, 2000).toString('latin1').includes('TSPD');
        if (st === 200 && !isChallenge) { fs.writeFileSync(dest, body); ok = true; why = r.ct; }
        else { why = isChallenge ? 'desafio' : 'http' + st; if (st === 429 || isChallenge) { await warm(); await sleep(5000 * (t + 1)); } else if (st === 404) break; else await sleep(2000); }
      } catch (e) { why = 'erro ' + e.message.slice(0, 80); await sleep(2500); if (/closed|Target|context/i.test(e.message)) await warm(); }
    }
    log.push({ url, status: ok ? 'ok' : 'falha', http: st, why });
    console.log(ok ? 'OK ' : 'XX ', st, why, url);
    await sleep(400);
  }
  fs.writeFileSync(path.join(outDir, '_log.json'), JSON.stringify(log, null, 1));
  await b.close();
})();
