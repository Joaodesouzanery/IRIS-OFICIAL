// ANTAQ/SEI: percorre os links "Resultado" das reunioes virtuais 2026 (gov.br) no SEI publico (pesquisa processual) numa UNICA sessao Chromium
// e registra a LISTA DE DOCUMENTOS de cada processo de votacao (tipo, data, unidade) + se o conteudo exige captcha. NAO resolve captcha; nao abre documentos
// protegidos (sem link = restrito = nao baixa). FASE 2: nas paginas com documentos abertos ao publico, baixa as 'Declaração de Voto-<iniciais>', 'Voto do Revisor',
// 'Voto Complementar' e 'Declaração de Impedimento' (HTML publico, sem captcha) para fonte/antaq/sei/<nº>.html.
// Uso: node antaq_sei.cjs fonte/antaq/govbr/virtuais.html antaq_sei.json fonte/antaq/sei
const { chromium } = require('/opt/node-tools/node_modules/playwright'); const fs = require('fs');
(async () => {
  const [src, out, dest] = process.argv.slice(2);
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
    if (res[u] && res[u].declarado !== undefined) continue;
    const prev = res[u];
    for (let t = 0; t < 3; t++) {
      try {
        await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 90000 }); await p.waitForTimeout(2500);
        const r = await p.evaluate(() => ({
          declarado: +((document.body.innerText.match(/Lista de Protocolos \((\d+) registros/) || [])[1] || 0), processo: (document.body.innerText.match(/Processo:\s*(\S+)/) || [])[1], tipo: (document.body.innerText.match(/Tipo:\s*([^\n]+)/) || [])[1],
          captcha: /Digite o código da imagem/.test(document.body.innerText), links_abrem: document.querySelectorAll('a[onclick*="md_pesq_documento_consulta_externa"]').length,
          docs: [...document.querySelectorAll('tr')].map(r => [...r.querySelectorAll('td')].map(td => td.innerText.trim())).filter(r => r.some(x => /^\d{6,8}$/.test(x)))
        }));
        res[u] = Object.assign({ reuniao: reun }, r, prev ? { abertos: prev.abertos, fase2: prev.fase2 } : {}); fs.writeFileSync(out, JSON.stringify(res)); console.log(reun, r.processo, r.docs.length, 'captcha', r.captcha, 'links', r.links_abrem); break;
      } catch (e) { await p.waitForTimeout(3000); }
    }
  }
  // ---- fase 2: documentos de voto abertos
  if (dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const [u, v] of Object.entries(res)) {
      if (!v.links_abrem || v.fase2) continue;
      try {
        await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 90000 }); await p.waitForTimeout(2000);
        const docs = await p.evaluate(() => [...document.querySelectorAll('tr')].map(r => { const a = r.querySelector('a[onclick*="md_pesq_documento_consulta_externa"]'); if (!a) return null; const m = /window\.open\('([^']+)'/.exec(a.getAttribute('onclick')); const td = [...r.querySelectorAll('td')].map(t => t.innerText.trim()); return { num: a.innerText.trim(), tipo: td[2], url: m && m[1] }; }).filter(Boolean));
        v.abertos = [];
        for (const d of docs) {
          if (!/Declara[çc][ãa]o de (Voto|Impedimento)|Voto do Revisor|Voto Complementar|Voto Divergente|Voto Vista|Declara/i.test(d.tipo || '')) continue;
          const f = `${dest}/${d.num}.html`;
          if (!fs.existsSync(f)) {
            const o = await p.evaluate(async (uu) => { const r = await fetch(uu, { credentials: 'include' }); const ab = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < ab.length; i += 8192) s += String.fromCharCode.apply(null, ab.subarray(i, i + 8192)); return { st: r.status, ct: r.headers.get('content-type'), b: btoa(s) }; }, d.url);
            if (o.st === 200 && /html/.test(o.ct || '')) fs.writeFileSync(f, Buffer.from(o.b, 'base64'));
          }
          v.abertos.push({ num: d.num, tipo: d.tipo, arquivo: fs.existsSync(f) ? f : null });
        }
        v.fase2 = true; fs.writeFileSync(out, JSON.stringify(res)); console.log('fase2', v.reuniao, v.processo, v.abertos.length);
      } catch (e) { console.log('erro fase2', String(e).slice(0, 80)); }
    }
  }
  await b.close();
})();
