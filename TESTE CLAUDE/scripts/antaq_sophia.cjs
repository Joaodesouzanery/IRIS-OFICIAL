// ANTAQ: busca no acervo Sophia (https://sophia.antaq.gov.br, Cloudflare: exige Chromium) e baixa os PDFs.
// Uso: node antaq_sophia.cjs <termo> <ano> <saida.html> [<pasta_pdf> <codigos separados por virgula | all>]
// 1) preenche a busca de Legislacao; 2) clica "Mais resultados" ate acabar; 3) salva o HTML completo; 4) baixa PDFs (mesma sessao).
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
(async () => {
  const [kw, ano, out, dest, cods] = process.argv.slice(2);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'], proxy: { server: process.env.HTTPS_PROXY } });
  const c = await b.newContext({ ignoreHTTPSErrors: true, locale: 'pt-BR', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const p = await c.newPage();
  for (let t = 0; t < 4; t++) { try { await p.goto('https://sophia.antaq.gov.br/Terminal/Busca/legislacao', { waitUntil: 'networkidle', timeout: 90000 }); break; } catch (e) { await p.waitForTimeout(3000); } }
  for (let i = 0; i < 10 && /Just a moment/i.test(await p.title()); i++) await p.waitForTimeout(5000);
  await p.fill('#PalavraChave', kw); if (ano && ano !== '-') await p.fill('#Ano', ano);
  await p.click('#btnBuscaRapidaBuscar'); await p.waitForTimeout(8000);
  let prev = -1;
  for (let i = 0; i < 80; i++) {
    const n = await p.evaluate(() => document.querySelectorAll('a[href*="/Terminal/acervo/detalhe/"]').length);
    const btn = await p.$('#btn-mostrar-mais-resultados'); const vis = btn && await btn.isVisible();
    if (!vis || n === prev) break; prev = n; await btn.click(); await p.waitForTimeout(4000);
  }
  fs.writeFileSync(out, await p.content());
  console.log('html salvo', out, (await p.content()).length);
  if (dest && cods) {
    fs.mkdirSync(dest, { recursive: true });
    let lista = cods === 'all' ? [...new Set([...(await p.content()).matchAll(/Download\?codigoArquivo=(\d+)/g)].map(m => m[1]))] : cods.split(',');
    for (const cod of lista) {
      const f = `${dest}/${cod}.pdf`;
      if (fs.existsSync(f) && fs.statSync(f).size > 1000) continue;
      for (let t = 0; t < 5; t++) {
        try { const r = await c.request.get(`https://sophia.antaq.gov.br/Terminal/Busca/Download?codigoArquivo=${cod}&tipoMidia=0`, { timeout: 90000 }); const buf = await r.body();
          if (r.status() === 200 && buf.slice(0, 4).toString() === '%PDF') { fs.writeFileSync(f, buf); break; } else console.log('falha', cod, r.status(), t); } catch (e) { console.log('erro', cod, String(e).slice(0, 80)); }
        await p.waitForTimeout(2000 * (t + 1));
      }
    }
    console.log('pdfs na pasta:', fs.readdirSync(dest).length);
  }
  await b.close();
})();
