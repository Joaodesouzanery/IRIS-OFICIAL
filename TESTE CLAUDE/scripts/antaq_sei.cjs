// ANTAQ/SEI: percorre os links "Resultado" das reunioes virtuais 2026 (gov.br) no SEI publico (pesquisa processual) numa UNICA sessao Chromium
// e registra a LISTA DE DOCUMENTOS de cada processo de votacao (tipo, data, unidade) + se o conteudo exige captcha. NAO resolve captcha; nao abre documentos
// protegidos. Uso: node antaq_sei.cjs fonte/antaq/govbr/virtuais.html antaq_sei.json
const { chromium } = require('/opt/node-tools/node_modules/playwright'); const fs = require('fs');
(async () => {
  const [src, out] = process.argv.slice(2);
  const h = fs.readFileSync(src, 'utf8').replace(/&amp;/g, '&');
  const tg = [...h.matchAll(/<a class="toggle[^"]*" href="[^"]*">([^<]*)<\/a>/g)];
  const links = [];
  tg.forEach((m, i) => {
    const seg = h.slice(m.index, i + 1 < tg.length ? tg[i + 1].index : h.length);
    const per = (seg.match(/Per[íi]odo:[^<]*?(\d\d\/\d\d\/\d{4})/) || [])[1];
    if (!per || !per.endsWith('2026')) return;
    for (const u of new Set([...seg.matchAll(/href="(https:\/\/sei\.antaq\.gov\.br\/sei\/modulos\/pesquisa\/md_pesq_processo_exibir\.php[^"]+)"/g)].map(x => x[1]))) links.push([m[1].trim(), u]);
  });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'], proxy: { server: process.env.HTTPS_PROXY } });
  const c = await b.newContext({ ignoreHTTPSErrors: true, locale: 'pt-BR', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const p = await c.newPage(); const res = {};
  if (fs.existsSync(out)) Object.assign(res, JSON.parse(fs.readFileSync(out, 'utf8')));
  for (const [reun, u] of links) {
    if (res[u]) continue;
    for (let t = 0; t < 3; t++) {
      try {
        await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 90000 }); await p.waitForTimeout(2500);
        const r = await p.evaluate(() => ({
          processo: (document.body.innerText.match(/Processo:\s*(\S+)/) || [])[1], tipo: (document.body.innerText.match(/Tipo:\s*([^\n]+)/) || [])[1],
          captcha: /Digite o código da imagem/.test(document.body.innerText), links_abrem: document.querySelectorAll('a[onclick*="md_pesq_documento_consulta_externa"]').length,
          docs: [...document.querySelectorAll('tr')].map(r => [...r.querySelectorAll('td')].map(td => td.innerText.trim())).filter(r => r.some(x => /^\d{6,8}$/.test(x)))
        }));
        res[u] = Object.assign({ reuniao: reun }, r); fs.writeFileSync(out, JSON.stringify(res)); console.log(reun, r.processo, r.docs.length, 'captcha', r.captcha, 'links', r.links_abrem); break;
      } catch (e) { await p.waitForTimeout(3000); }
    }
  }
  await b.close();
})();
