"""Gera votos_2026.html (arquivo unico, offline) a partir de votos_2026.xlsx: mesma fonte, contagens identicas."""
import json, sys, openpyxl
xlsx = sys.argv[1] if len(sys.argv) > 1 else 'votos_2026.xlsx'; out = sys.argv[2] if len(sys.argv) > 2 else 'votos_2026.html'
wb = openpyxl.load_workbook(xlsx, read_only=True)
def tab(n, lim=None):
    r = [list(x) for x in wb[n].iter_rows(values_only=True)]
    return r[0], [[('' if c is None else c) for c in x] for x in r[1:]]
D = {}
for n in ('Votos', 'Deliberações', 'Controle', 'Reuniões'):
    c, l = tab(n); D[n] = {'c': c, 'l': l}
D['Controle']['l'] = [x for x in D['Controle']['l'] if x[0]]
dados = json.dumps(D, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
HTML = r'''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Votos dos diretores 2026</title><style>
:root{--bg:#f6f7f9;--fg:#1d2430;--mu:#5d6778;--card:#fff;--bd:#d9dee6;--pri:#1f3a5f;--nom:#2e7d32;--inf:#c58a00;--rev:#c62828}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#12161d;--fg:#e6e9ef;--mu:#98a2b3;--card:#1b212b;--bd:#2c3442;--pri:#7fa8e0;--nom:#66bb6a;--inf:#e0b13a;--rev:#ef6b6b;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#12161d;--fg:#e6e9ef;--mu:#98a2b3;--card:#1b212b;--bd:#2c3442;--pri:#7fa8e0;--nom:#66bb6a;--inf:#e0b13a;--rev:#ef6b6b;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif}
header{padding:14px 16px;background:var(--card);border-bottom:1px solid var(--bd)}h1{margin:0;font-size:18px}.sub{color:var(--mu);font-size:12px;margin-top:2px}
nav{display:flex;gap:4px;padding:8px 16px;flex-wrap:wrap}nav button{border:1px solid var(--bd);background:var(--card);color:var(--fg);padding:7px 12px;border-radius:6px;cursor:pointer}nav button.on{background:var(--pri);color:var(--bg);border-color:var(--pri)}
.filtros{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;padding:0 16px 8px}.filtros label{font-size:11px;color:var(--mu);display:flex;flex-direction:column;gap:2px}
input,select{padding:6px;border:1px solid var(--bd);border-radius:6px;background:var(--card);color:var(--fg);font:inherit;min-width:0}
main{padding:0 16px 24px}.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0;color:var(--mu)}.bar button{padding:5px 10px;border:1px solid var(--bd);background:var(--card);color:var(--fg);border-radius:6px;cursor:pointer}
.tw{overflow:auto;border:1px solid var(--bd);border-radius:8px;background:var(--card);max-height:70vh}table{border-collapse:collapse;width:100%}th,td{padding:5px 8px;border-bottom:1px solid var(--bd);text-align:left;vertical-align:top;font-size:12.5px}th{position:sticky;top:0;background:var(--pri);color:var(--bg);white-space:nowrap}td.n{text-align:right}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:8px 0}.card{background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:10px}.card b{display:block;font-size:22px}.card span{color:var(--mu);font-size:12px}
.aviso{background:var(--card);border-left:4px solid var(--inf);padding:8px 12px;margin:8px 0;border-radius:4px;font-size:12.5px}
.barra{display:flex;height:12px;border-radius:3px;overflow:hidden;background:var(--bd);min-width:120px}.barra i{display:block}
.tag{padding:1px 6px;border-radius:10px;font-size:11px;color:#fff}.t-nominal{background:var(--nom)}.t-inferido{background:var(--inf)}.t-REVISAR{background:var(--rev)}.t-na{background:var(--mu)}
</style></head><body>
<header><h1>Votos dos diretores em 2026 — ANM · ANTT · ARTESP</h1><div class="sub" id="sub"></div></header>
<nav id="nav"></nav><div class="filtros" id="fil"></div><main id="main"></main>
<script id="d" type="application/json">__DADOS__</script>
<script>
const D=JSON.parse(document.getElementById('d').textContent);
const V=D['Votos'],DL=D['Deliberações'],CT=D['Controle'];
const ix=(T,n)=>T.c.indexOf(n);
const vi={};V.c.forEach((c,i)=>vi[c]=i);
const di={};DL.c.forEach((c,i)=>di[c]=i);
const esc=s=>String(s).replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
const norm=s=>String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
V.n=V.l.map(r=>norm(r.join(' ')));DL.n=DL.l.map(r=>norm(r.join(' ')));
document.getElementById('sub').textContent=V.l.length.toLocaleString('pt-BR')+' linhas de voto · '+DL.l.length.toLocaleString('pt-BR')+' itens de ata · gerado a partir de votos_2026.xlsx (mesmos números)';
const F={q:'',ag:'',dir:'',mes:'',modal:'',tema:'',micro:'',papel:'',evid:'',tipo:''};
const campos=[['ag','Agência','Agência'],['dir','Diretor','Diretor'],['mes','Mês','Mês'],['modal','Modal','Modal'],['tema','Tema','Tema'],['micro','Microtema (IRIS)','Microtema (IRIS)'],['papel','Papel','Papel'],['evid','Evidência','Evidência'],['tipo','Tipo de item','Tipo de item']];
let aba='perfil',pg=0;const PG=100;
function vals(col,pre){const s=new Set();V.l.forEach((r,i)=>{if(ok(r,i,col))s.add(r[vi[col]])});return[...s].filter(x=>x!=='').sort()}
function ok(r,i,except){if(F.q){for(const t of norm(F.q).split(/\s+/)){if(t&&!V.n[i].includes(t))return false}}
 for(const[k,l,c]of campos){if(c===except||!F[k])continue;if(r[vi[c]]!==F[k])return false}return true}
function filtros(){const el=document.getElementById('fil');
 let h='<label>Busca livre (assunto, processo, relator, diretor...)<input id="q" value="'+esc(F.q)+'" placeholder="ex.: 48051.011270/2025 ou CFEM"></label>';
 campos.forEach(([k,l,c])=>{h+='<label>'+l+'<select data-k="'+k+'"><option value="">(todos)</option>'+vals(c).map(x=>'<option'+(F[k]===x?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select></label>'});
 h+='<label>&nbsp;<button id="lim">Limpar filtros</button></label>';el.innerHTML=h;
 el.querySelector('#q').oninput=e=>{F.q=e.target.value;pg=0;desenha(true)};
 el.querySelectorAll('select').forEach(s=>s.onchange=e=>{F[e.target.dataset.k]=e.target.value;pg=0;desenha()});
 el.querySelector('#lim').onclick=()=>{Object.keys(F).forEach(k=>F[k]='');pg=0;desenha()}}
function filt(){const o=[];V.l.forEach((r,i)=>{if(ok(r,i,null))o.push(r)});return o}
function csv(cols,rows,nome){const q=x=>'"'+String(x).replace(/"/g,'""')+'"';const t=[cols.map(q).join(';')].concat(rows.map(r=>r.map(q).join(';'))).join('\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+t],{type:'text/csv'}));a.download=nome;a.click()}
function tabela(cols,rows,show){const idx=show.map(n=>cols.indexOf(n));
 return '<div class="tw"><table><thead><tr>'+show.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+idx.map(i=>{const v=r[i];return '<td'+(typeof v==='number'?' class="n"':'')+'>'+esc(v)+'</td>'}).join('')+'</tr>').join('')+'</tbody></table></div>'}
function pager(n){const tp=Math.max(1,Math.ceil(n/PG));return '<span>Página '+(pg+1)+' de '+tp+'</span><button data-p="-1">◀</button><button data-p="1">▶</button>'}
function perfil(rows){
 const dirs=[...new Set(rows.map(r=>r[vi['Agência']]+'|'+r[vi['Diretor']]))].sort();
 if(!F.dir)return '<div class="aviso">Escolha um <b>Diretor</b> no filtro acima para ver o perfil (temas e microtemas em que votou). Hoje o filtro cobre '+dirs.length+' diretor(es).</div>'+resumoDiretores(rows);
 const n=rows.length;if(!n)return'<div class="aviso">Nenhuma linha para este filtro.</div>';
 const c=x=>rows.filter(r=>r[vi['Papel']]===x).length,nom=rows.filter(r=>r[vi['Proveniência']]==='nominal').length,inf=rows.filter(r=>r[vi['Proveniência']]==='inferido').length,rev=rows.filter(r=>r[vi['Proveniência']]==='REVISAR').length;
 let h='<h2>'+esc(F.dir)+(F.ag?' — '+F.ag:'')+'</h2><div class="cards">'+[['Linhas de voto',n],['Relator/proponente',c('Relator/proponente')],['Acompanhou',c('Votante (acompanhou)')],['Divergiu',c('Votante (divergiu)')],['Pediu vista',c('Pediu vista')],['Ausente',c('Ausente')],['Evidência individual',Math.round(nom*100/n)+'%'],['Inferida',Math.round(inf*100/n)+'%'],['A revisar',rev]].map(([a,b])=>'<div class="card"><b>'+b+'</b><span>'+a+'</span></div>').join('')+'</div>';
 h+='<div class="aviso"><b>Como ler com confiança:</b> as contagens (presença, relatoria, vista, divergência citada) vêm direto da ata. Onde a evidência é <i>inferida</i> a ata só diz “por unanimidade”: o diretor <b>acompanhou</b>, mas não há voto individual escrito. '+Math.round(inf*100/n)+'% das linhas deste recorte são inferidas, portanto o perfil de temas mostra <b>onde o diretor participou</b>, não uma posição própria sobre o tema.</div>';
 const agg=(cols)=>{const m=new Map();rows.forEach(r=>{if(r[vi['Tipo de item']]==='Aprovação de ata')return;const k=cols.map(x=>r[vi[x]]||'—').join(' › ');let o=m.get(k);if(!o){o={n:0,nom:0,inf:0,rel:0,div:0,vis:0};m.set(k,o)}o.n++;const p=r[vi['Proveniência']];if(p==='nominal')o.nom++;else if(p==='inferido')o.inf++;const pa=r[vi['Papel']];if(pa==='Relator/proponente')o.rel++;if(pa==='Votante (divergiu)')o.div++;if(pa==='Pediu vista')o.vis++});return[...m.entries()].sort((a,b)=>b[1].n-a[1].n)};
 const bloco=(tit,cols)=>{const a=agg(cols),mx=a.length?a[0][1].n:1;return '<h3>'+tit+'</h3><div class="tw"><table><thead><tr><th>'+cols.join(' › ')+'</th><th>Votos</th><th>Distribuição</th><th>Individual</th><th>Inferida</th><th>Relator</th><th>Divergiu</th><th>Vista</th></tr></thead><tbody>'+a.slice(0,60).map(([k,o])=>'<tr><td>'+esc(k)+'</td><td class="n">'+o.n+'</td><td><div class="barra" style="width:'+Math.max(8,o.n*100/mx)+'%"><i style="width:'+o.nom*100/o.n+'%;background:var(--nom)"></i><i style="width:'+o.inf*100/o.n+'%;background:var(--inf)"></i></div></td><td class="n">'+o.nom+'</td><td class="n">'+o.inf+'</td><td class="n">'+o.rel+'</td><td class="n">'+o.div+'</td><td class="n">'+o.vis+'</td></tr>').join('')+'</tbody></table></div>'};
 return h+bloco('Por modal',['Modal'])+bloco('Por modal › tema',['Modal','Tema'])+bloco('Por microtema (IRIS)',['Microtema (IRIS)'])+bloco('Por tema › subtema',['Tema','Subtema'])+bloco('Por área (IRIS)',['Área (IRIS)'])}
function resumoDiretores(rows){const m=new Map();rows.forEach(r=>{const k=r[vi['Agência']]+'|'+r[vi['Diretor']];let o=m.get(k);if(!o){o={n:0,nom:0,rel:0,div:0,vis:0};m.set(k,o)}o.n++;if(r[vi['Proveniência']]==='nominal')o.nom++;const p=r[vi['Papel']];if(p==='Relator/proponente')o.rel++;if(p==='Votante (divergiu)')o.div++;if(p==='Pediu vista')o.vis++});
 return '<div class="tw"><table><thead><tr><th>Agência</th><th>Diretor</th><th>Linhas</th><th>Individual</th><th>Relator</th><th>Divergiu</th><th>Vista</th></tr></thead><tbody>'+[...m.entries()].sort().map(([k,o])=>{const[a,d]=k.split('|');return'<tr><td>'+a+'</td><td>'+esc(d)+'</td><td class="n">'+o.n+'</td><td class="n">'+Math.round(o.nom*100/o.n)+'%</td><td class="n">'+o.rel+'</td><td class="n">'+o.div+'</td><td class="n">'+o.vis+'</td></tr>'}).join('')+'</tbody></table></div>'}
function desenha(foco){filtros();const main=document.getElementById('main');let h='';
 const rows=filt();
 if(aba==='perfil'){h=perfil(rows)}
 else if(aba==='votos'){const sh=['Agência','Data','Reunião','Processo','Deliberação nº / item','Diretor','Voto','Papel','Evidência','Resultado da deliberação','Relator','Modal','Tema','Microtema (IRIS)','Assunto'];
  h='<div class="bar"><b>'+rows.length.toLocaleString('pt-BR')+' linhas</b>'+pager(rows.length)+'<button id="csv">Exportar CSV do filtro</button></div>'+tabela(V.c,rows.slice(pg*PG,pg*PG+PG),sh)}
 else if(aba==='delib'){const ps=new Set(rows.map(r=>r[vi['Agência']]+'|'+r[vi['Reunião']]+'|'+r[vi['Processo']]+'|'+r[vi['Deliberação nº / item']]));
  const dr=DL.l.filter(r=>ps.has(r[di['Agência']]+'|'+r[di['Reunião']]+'|'+r[di['Processo']]+'|'+r[di['Deliberação nº / item']]));
  const sh=['Agência','Data','Reunião','Processo','Deliberação nº / item','Tipo de item','Relator','Interessado','Assunto','Resultado','Modal','Tema','Microtema (IRIS)','Confiança'];
  h='<div class="bar"><b>'+dr.length.toLocaleString('pt-BR')+' itens de ata</b>'+pager(dr.length)+'<button id="csv">Exportar CSV</button></div>'+tabela(DL.c,dr.slice(pg*PG,pg*PG+PG),sh);window._dr=dr}
 else{const ft=aba==='pend'?CT.l.filter(r=>r[0]==='Pendência da fonte'):aba==='nf'?CT.l.filter(r=>r[0]==='Não feito'):CT.l.filter(r=>r[0]==='Cobertura'||r[0]==='Qualidade');
  h='<div class="bar"><b>'+ft.length+' linhas</b> (filtros acima não se aplicam)</div>'+tabela(CT.c,ft,['Tipo','Agência','Item','Valor / data / esperado','Observado','Status','Detalhe','Como resolver'])}
 main.innerHTML=h;
 main.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{pg=Math.max(0,pg+ +b.dataset.p);desenha()});
 const cb=document.getElementById('csv');if(cb)cb.onclick=()=>aba==='votos'?csv(V.c,rows,'votos_filtrados.csv'):csv(DL.c,window._dr,'deliberacoes_filtradas.csv');
 if(foco){const q=document.getElementById('q');q.focus();q.setSelectionRange(q.value.length,q.value.length)}}
const abas=[['perfil','Perfil do diretor'],['votos','Votos'],['delib','Deliberações'],['ctrl','Cobertura e qualidade'],['pend','Pendências da fonte'],['nf','Não feito / limites']];
const nav=document.getElementById('nav');
function navDesenha(){nav.innerHTML=abas.map(([k,l])=>'<button data-a="'+k+'" class="'+(aba===k?'on':'')+'">'+l+'</button>').join('');nav.querySelectorAll('button').forEach(b=>b.onclick=()=>{aba=b.dataset.a;pg=0;navDesenha();desenha()})}
navDesenha();desenha();
</script></body></html>'''
full = HTML.replace('__DADOS__', dados)
open(out, 'w', encoding='utf-8').write(full)
import re
art = re.sub(r'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport"[^>]*>', '', full).replace('</head><body>', '').replace('</body></html>', '')
open(out.replace('.html', '_artifact.html'), 'w', encoding='utf-8').write(art); print('ok', out, len(HTML) + len(dados), 'bytes')
