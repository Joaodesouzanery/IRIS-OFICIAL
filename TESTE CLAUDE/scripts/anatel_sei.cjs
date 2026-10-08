// ANATEL: lista as Publicacoes Eletronicas do SEI (https://sei.anatel.gov.br, publico, sem captcha) por serie e periodo,
// paginando ate o fim ("Exibindo a - b de N" confere com as linhas lidas). Uma sessao Chromium.
// Uso: node anatel_sei.cjs <saida.json> <ini dd/mm/aaaa> <fim dd/mm/aaaa> <serie[:rotulo]> [<serie[:rotulo]> ...]
// Saida: { "<serie>": {rotulo, declarado, linhas:[{protocolo,id_documento,descricao,data_pub,unidade,resumo,snippet}], paginas:n} }
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
const BASE = 'https://sei.anatel.gov.br/sei/publicacoes/controlador_publicacoes.php?acao=publicacao_pesquisar&acao_origem=publicacao_pesquisar&id_orgao_publicacao=0';
(async () => {
  const [out, ini, fim, ...series] = process.argv.slice(2);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'], proxy: { server: process.env.HTTPS_PROXY } });
  const c = await b.newContext({ ignoreHTTPSErrors: true, locale: 'pt-BR', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const p = await c.newPage(); const res = {};
  const extrai = () => p.evaluate(() => {
    const cap = document.querySelector('.pesquisaBarraD'); const decl = cap ? cap.textContent.trim() : '';
    const linhas = [];
    document.querySelectorAll('tr[id^="trPublicacaoA"]').forEach(tr => {
      const td = tr.querySelectorAll('td.tdDados'); const a = tr.querySelector('a.ancoraPadraoAzul');
      const sn = document.getElementById(tr.id.replace('PublicacaoA', 'PublicacaoB'));
      linhas.push({ protocolo: a ? a.textContent.trim() : '', id_documento: a ? (a.href.match(/id_documento=(\d+)/) || [])[1] : '', descricao: td[1] ? td[1].textContent.trim() : '',
        data_pub: td[3] ? td[3].textContent.trim() : '', unidade: td[4] ? td[4].textContent.trim() : '', resumo: td[6] ? td[6].textContent.trim() : '', snippet: sn ? sn.textContent.trim() : '' });
    });
    return { decl, linhas };
  });
  for (const s of series) {
    const [serie, rotulo] = s.split(':'); let r = null;
    for (let t = 0; t < 5 && !r; t++) {
      try {
        await p.goto(BASE + '&rdo_data_publicacao=I', { waitUntil: 'networkidle', timeout: 90000 });
        await p.selectOption('#selSerie', serie); await p.selectOption('#selUnidadeResponsavel', '');
        await p.check('#optPeriodoExplicito'); await p.fill('#txtDataInicio', ini); await p.fill('#txtDataFim', fim);
        await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle', timeout: 90000 }), p.evaluate(() => { document.getElementById('frmPublicacaoPesquisa').submit(); })]);
        r = { rotulo: rotulo || serie, declarado: null, linhas: [], paginas: 0 };
        for (let pg = 0; pg < 200; pg++) {
          const e = await extrai(); r.paginas++; r.linhas.push(...e.linhas);
          const m = e.decl.match(/Exibindo\s+(\d+)\s*-\s*(\d+)\s+de\s+(\d+)/); if (m) r.declarado = +m[3];
          fs.writeFileSync(out.replace(/\.json$/, '') + `_s${serie}_p${pg}.html`, await p.content());
          if (!m || +m[2] >= +m[3]) break;
          await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle', timeout: 90000 }), p.evaluate((n) => navegar(String(n)), +m[2])]);
        }
        if (!r.declarado && !r.linhas.length) { const tx = await p.evaluate(() => document.body.innerText); r.declarado = /Nenhum resultado/i.test(tx) ? 0 : null; }
      } catch (e) { console.log('retry', serie, String(e).slice(0, 100)); r = null; await p.waitForTimeout(3000); }
    }
    res[serie] = r || { rotulo, erro: 'falhou' };
    console.log(serie, rotulo, 'declarado', r && r.declarado, 'lidas', r && r.linhas.length, 'paginas', r && r.paginas);
  }
  fs.writeFileSync(out, JSON.stringify(res, null, 1)); await b.close();
})();
