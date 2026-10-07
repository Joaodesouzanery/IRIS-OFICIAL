// ARTESP: baixa Ata (e Pauta) de cada reuniao de 2026 numa unica sessao de Chromium comum.
// Uso: node artesp_baixar.cjs artesp_inventario.json manifesto_artesp.json fonte/artesp [tipos: ata,pauta]
const { chromium } = require('/opt/node-tools/node_modules/playwright'); const fs = require('fs'), crypto = require('crypto');
const [inv, man, dest, tipos = 'ata'] = process.argv.slice(2); const want = tipos.split(',');
const R = JSON.parse(fs.readFileSync(inv)).filter(r => r.data.endsWith('2026'));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'], proxy: { server: process.env.HTTPS_PROXY } });
  const c = await b.newContext({ ignoreHTTPSErrors: true, locale: 'pt-BR', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const p = await c.newPage();
  await p.goto('https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria', { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForTimeout(8000);
  const q = await c.newPage(); const out = []; let warmed = false;
  for (const r of R) {
    const tag = (r.numero > 1000 ? 'ORD' : 'S230_') + r.numero; fs.mkdirSync(`${dest}/${tag}`, { recursive: true });
    for (const d of r.docs) {
      const k = d.rotulo.toLowerCase().startsWith('ata') ? 'ata' : d.rotulo.toLowerCase().startsWith('pauta') ? 'pauta' : d.rotulo.toLowerCase().startsWith('delib') ? 'delib' : 'outro';
      if (!want.includes(k)) continue;
      const rec = { tag, numero: r.numero, data: r.data, tipo: k, url: d.url.split('?')[0].slice(0, 160), ok: false };
      for (let t = 1; t <= 3 && !rec.ok; t++) {
        try {
          if (!warmed) { await q.goto(d.url, { timeout: 45000 }).catch(() => {}); await q.waitForTimeout(6000); warmed = true; }
          const res = await c.request.get(d.url, { timeout: 90000 }); const body = await res.body();
          const sig = body.slice(0, 4).toString();
          if (res.status() === 200 && (sig === '%PDF' || sig.startsWith('PK'))) {
            const ext = sig === '%PDF' ? 'pdf' : 'zip'; const f = `${dest}/${tag}/${k}.${ext}`; fs.writeFileSync(f, body);
            Object.assign(rec, { ok: true, arquivo: f, bytes: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex') });
          } else { rec.erro = `status ${res.status()} sig ${JSON.stringify(sig)}`; await q.goto(d.url, { timeout: 45000 }).catch(() => {}); await q.waitForTimeout(5000); }
        } catch (e) { rec.erro = String(e).slice(0, 100); await q.waitForTimeout(3000); }
      }
      out.push(rec); console.log(tag, k, rec.ok ? rec.bytes : 'FALHA ' + rec.erro); await q.waitForTimeout(400);
    }
  }
  fs.writeFileSync(man, JSON.stringify(out, null, 1));
  console.log('docs', out.length, 'ok', out.filter(x => x.ok).length, 'falhas', out.filter(x => !x.ok).map(x => x.tag + ':' + x.tipo));
  await b.close();
})();
