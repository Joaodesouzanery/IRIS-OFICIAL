import type {
  Associado,
  Deliberacao,
  DocumentoAssociadoPreview,
  DocumentoAssociadoTipo,
  ListaTripliceItem,
  Mandato,
  MonitoramentoItem,
} from "@/types";

export const DEMO_ASSOCIADOS: Associado[] = [
  {
    id: "assoc-metroviario-artesp",
    nome: "Metroviário ARTESP",
    setor: "Metroviário",
    descricao: "Relatório trimestral para acompanhamento de temas metroviários e mobilidade regulados pela ARTESP.",
    agencia_siglas: ["ARTESP"],
    ministerios: ["Secretaria de Parcerias em Investimentos do Estado de São Paulo"],
    ministerio_urls: ["https://www.artesp.sp.gov.br/artesp/noticias"],
    microtemas: ["metroviário", "mobilidade", "concessão", "tarifa", "contrato", "segurança", "obras"],
    palavras_chave: ["metro", "metroviario", "metroviário", "trem", "trilhos", "mobilidade", "transporte metropolitano", "concessao", "concessão"],
    vp_nome: "VP a definir",
    vp_cargo: "Vice-presidência",
    vp_minibio: "Visão VP pendente de curadoria. Preencher os três parágrafos no momento de gerar o relatório.",
    vp_foto_url: null,
    ativo: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "assoc-metro-sp",
    nome: "Metrô de São Paulo",
    setor: "Metroviário",
    descricao: "Mapeamento regulatório para temas metroviários em ARTESP/ANTT.",
    agencia_siglas: ["ARTESP", "ANTT"],
    ministerios: ["Ministério dos Transportes"],
    ministerio_urls: ["https://www.gov.br/transportes/pt-br/assuntos/noticias"],
    microtemas: ["tarifa", "contrato", "obras", "fiscalizacao", "usuario", "seguranca"],
    palavras_chave: ["metrô", "metroviário", "ferrovia", "trilhos", "transporte público", "concessão", "mobilidade"],
    vp_nome: "VP a definir",
    vp_cargo: "Vice-presidência",
    vp_minibio: "Mini bio pendente de curadoria. Preencher com fonte oficial antes de distribuir o relatório.",
    vp_foto_url: null,
    ativo: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: "assoc-simineral",
    nome: "Simineral",
    setor: "Mineração",
    descricao: "Mapeamento regulatório para mineração, ANM e política pública mineral.",
    agencia_siglas: ["ANM"],
    ministerios: ["Ministério de Minas e Energia"],
    ministerio_urls: ["https://www.gov.br/mme/pt-br/assuntos/noticias"],
    microtemas: ["lavra", "pesquisa", "licenciamento", "servidao", "cfem", "disponibilidade", "recursos"],
    palavras_chave: ["mineração", "mineral", "minerais críticos", "lavra", "pesquisa mineral", "pará", "simineral"],
    vp_nome: "VP a definir",
    vp_cargo: "Vice-presidência",
    vp_minibio: "Mini bio pendente de curadoria. Preencher com fonte oficial antes de distribuir o relatório.",
    vp_foto_url: null,
    ativo: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export interface BuildAssociadoDocumentInput {
  associado: Associado;
  tipo: DocumentoAssociadoTipo;
  periodo_inicio: string;
  periodo_fim: string;
  deliberacoes: Deliberacao[];
  mandatos: Mandato[];
  noticias: MonitoramentoItem[];
  listaTriplice: ListaTripliceItem[];
  listaTripliceManual?: ListaTripliceItem[];
  vp_paragrafos?: string[];
  observacoes_curadoria?: string | null;
}

export function buildAssociadoDocument(input: BuildAssociadoDocumentInput): DocumentoAssociadoPreview {
  const relevantDelibs = filterRelevantDelibs(input.deliberacoes, input.associado);
  const relevantNews = filterRelevantNews(input.noticias, input.associado);
  const concordancia = computeConcordancia(relevantDelibs);
  const cenarios = buildCenarios(relevantDelibs, relevantNews, input.associado);
  const listaTriplice = [...input.listaTriplice, ...(input.listaTripliceManual ?? [])];
  const fontes = buildFontes(relevantDelibs, relevantNews, listaTriplice);
  const metricas = {
    deliberacoes: relevantDelibs.length,
    noticias: relevantNews.length,
    mandatos: input.mandatos.length,
    lista_triplice: listaTriplice.length,
    confianca_cenarios: cenarios.confianca,
  };
  const qualidade = assessQuality({
    tipo: input.tipo,
    associado: input.associado,
    metricas,
    concordanciaCount: concordancia.length,
  });
  const titulo = input.tipo === "relatorio_trimestral"
    ? `Relatório do Associado trimestral - ${input.associado.nome}`
    : `Relatório Mensal regulatório - ${input.associado.nome}`;

  const html = buildHtml({
    ...input,
    listaTriplice,
    titulo,
    deliberacoes: relevantDelibs,
    noticias: relevantNews,
    concordancia,
    cenarios,
    fontes,
    qualidade,
  });

  return {
    associado: input.associado,
    tipo: input.tipo,
    periodo_inicio: input.periodo_inicio,
    periodo_fim: input.periodo_fim,
    titulo,
    html,
    fontes,
    metricas,
    qualidade,
  };
}

function filterRelevantDelibs(delibs: Deliberacao[], associado: Associado) {
  const keywords = associado.palavras_chave.map(normalize);
  const microtemas = new Set(associado.microtemas);
  const siglas = new Set(associado.agencia_siglas);
  return delibs.filter((d) => {
    if (!isFinalDecisionDelib(d)) return false;
    const agencyOk = !d.agencia?.sigla || siglas.has(d.agencia.sigla);
    const microtemaOk = d.microtema ? microtemas.has(d.microtema) : false;
    const haystack = normalize([d.interessado, d.assunto, d.processo, d.resumo_pleito, d.fundamento_decisao].filter(Boolean).join(" "));
    const keywordOk = keywords.some((k) => haystack.includes(k));
    return agencyOk && (microtemaOk || keywordOk);
  });
}

function isFinalDecisionDelib(delib: Deliberacao) {
  const rawType = String(delib.raw_extraction?.documento_antt_tipo ?? delib.raw_extraction?.documento_anttl_tipo ?? "");
  const isAnttAgenda = [
    "pauta",
    "reuniao_deliberativa_eletronica",
    "reuniao_diretoria_publica",
    "reuniao_extraordinaria",
  ].includes(rawType);
  if (isAnttAgenda && !delib.resultado && !(delib.votos?.length)) return false;
  if (delib.tipo_documento === "ata" && !delib.resultado && !(delib.votos?.length)) return false;
  return true;
}

function filterRelevantNews(items: MonitoramentoItem[], associado: Associado) {
  const keywords = associado.palavras_chave.map(normalize);
  const ministryUrls = associado.ministerio_urls.map(normalize);
  const siglas = new Set(associado.agencia_siglas);
  const agencyDocumentTypes = new Set(["ata", "pauta", "deliberacao", "reuniao", "documento", "mandato", "diretoria"]);
  return items.filter((item) => {
    const source = normalize(String(item.metadata?.source ?? item.site?.url ?? item.url_item));
    const sourceOk = ministryUrls.some((url) => source.includes(url) || normalize(item.url_item).includes(url));
    const agencyOk = item.agencia?.sigla ? siglas.has(item.agencia.sigla) : false;
    const haystack = normalize(`${item.titulo} ${item.reuniao ?? ""} ${String(item.metadata?.resumo ?? "")}`);
    const keywordOk = keywords.some((k) => haystack.includes(k));
    const policyOk = sourceOk && (keywordOk || item.tipo === "politica_publica" || item.tipo === "consulta_publica");
    const agencyDocOk = agencyOk && agencyDocumentTypes.has(item.tipo);
    return policyOk || agencyDocOk;
  });
}

function computeConcordancia(delibs: Deliberacao[]) {
  const pairs = new Map<string, { nomes: string; concordam: number; total: number }>();
  for (const delib of delibs) {
    const votos = delib.votos ?? [];
    for (let i = 0; i < votos.length; i++) {
      for (let j = i + 1; j < votos.length; j++) {
        const a = votos[i];
        const b = votos[j];
        if (!a.diretor_id || !b.diretor_id) continue;
        const key = [a.diretor_id, b.diretor_id].sort().join("|");
        const nomes = [a.diretor_nome ?? a.diretor_id, b.diretor_nome ?? b.diretor_id].sort().join(" / ");
        const entry = pairs.get(key) ?? { nomes, concordam: 0, total: 0 };
        entry.total++;
        if (a.tipo_voto === b.tipo_voto) entry.concordam++;
        pairs.set(key, entry);
      }
    }
  }
  return [...pairs.values()]
    .map((p) => ({ ...p, pct: p.total > 0 ? Math.round((p.concordam / p.total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
}

function buildCenarios(delibs: Deliberacao[], noticias: MonitoramentoItem[], associado: Associado) {
  const deferidos = delibs.filter((d) => d.resultado === "Deferido" || d.resultado === "Aprovado").length;
  const restritivos = delibs.filter((d) => d.resultado === "Indeferido" || d.resultado === "Retirado de Pauta").length;
  const confidence = Math.min(0.9, Math.max(0.35, (delibs.length * 0.08) + (noticias.length * 0.04)));
  const base = `${delibs.length} decisões regulatório-administrativas e ${noticias.length} notícias de política pública monitoradas.`;
  const tendency = deferidos >= restritivos ? "continuidade regulatória com viés de aprovação quando há aderência documental" : "maior cautela decisória e risco de exigências adicionais";

  return {
    provavel: `Cenário provável: ${tendency} para ${associado.setor.toLowerCase()}, considerando ${base}`,
    alternativo: "Cenário alternativo: mudanças de prioridade ministerial ou agenda de fiscalização podem deslocar o foco para temas correlatos antes de novas decisões finais.",
    risco: "Cenário de risco: baixa cobertura documental, ausência de ata recente ou conflito de fonte reduz a confiabilidade e exige revisão humana antes de circular.",
    confianca: Math.round(confidence * 100) / 100,
  };
}

function assessQuality(input: {
  tipo: DocumentoAssociadoTipo;
  associado: Associado;
  metricas: DocumentoAssociadoPreview["metricas"];
  concordanciaCount: number;
}) {
  const pendencias: string[] = [];
  const vpPlaceholder = normalize(`${input.associado.vp_nome ?? ""} ${input.associado.vp_minibio ?? ""}`).includes("a definir")
    || normalize(input.associado.vp_minibio ?? "").includes("pendente");

  if (input.metricas.deliberacoes === 0) pendencias.push("Sem deliberações relevantes no período.");
  if (input.metricas.noticias === 0) pendencias.push("Sem notícias ou atos monitorados correlatos no período.");
  if (input.concordanciaCount === 0) pendencias.push("Sem votos suficientes para calcular concordância dos diretores.");
  if (input.tipo === "relatorio_trimestral" && input.metricas.mandatos === 0) pendencias.push("Sem mandatos cadastrados para as agências do associado.");
  if (input.tipo === "relatorio_trimestral" && input.metricas.lista_triplice === 0) pendencias.push("Sem lista tríplice revisada/cadastrada.");
  if (vpPlaceholder) pendencias.push("Visão VP, mini bio ou foto ainda precisam de curadoria.");

  const penalty = Math.min(80, pendencias.length * 18);
  const dataBonus = Math.min(20, input.metricas.deliberacoes * 4 + input.metricas.noticias * 2);
  const score = Math.max(0, Math.min(100, 82 - penalty + dataBonus));
  return {
    score,
    status: score >= 75 && pendencias.length <= 1 ? "pronto" as const : score >= 45 ? "revisar" as const : "bloqueado" as const,
    pendencias,
  };
}

function buildFontes(delibs: Deliberacao[], noticias: MonitoramentoItem[], listaTriplice: ListaTripliceItem[]) {
  return [
    ...delibs.slice(0, 8).map((d) => ({
      tipo: d.tipo_documento,
      titulo: d.numero_deliberacao ?? d.assunto ?? d.processo ?? "Deliberacao",
      url: null,
    })),
    ...noticias.slice(0, 8).map((n) => ({
      tipo: n.tipo,
      titulo: n.titulo,
      url: n.url_item,
    })),
    ...listaTriplice.slice(0, 5).map((l) => ({
      tipo: "lista_triplice",
      titulo: l.nome_candidato,
      url: l.fonte_url,
    })),
  ];
}

function buildHtml(input: BuildAssociadoDocumentInput & {
  titulo: string;
  deliberacoes: Deliberacao[];
  noticias: MonitoramentoItem[];
  concordancia: Array<{ nomes: string; concordam: number; total: number; pct: number }>;
  cenarios: { provavel: string; alternativo: string; risco: string; confianca: number };
  fontes: Array<{ tipo: string; titulo: string; url?: string | null }>;
  qualidade: DocumentoAssociadoPreview["qualidade"];
}) {
  const periodo = `${formatDate(input.periodo_inicio)} a ${formatDate(input.periodo_fim)}`;
  const isQuarterly = input.tipo === "relatorio_trimestral";
  const vpParagraphs = buildVpParagraphs(input);

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(input.titulo)}</title>
  <style>
    body{margin:0;background:#f5f5f4;color:#1c1917;font-family:Arial,Helvetica,sans-serif}
    .page{max-width:920px;margin:0 auto;background:#fff;min-height:100vh}
    header{background:#1f2937;color:#fff;padding:28px 36px}
    h1{margin:0;font-size:26px}.meta{margin-top:8px;color:#d1d5db;font-size:13px}
    section{padding:24px 36px;border-bottom:1px solid #e7e5e4}
    h2{margin:0 0 12px;font-size:15px;color:#ea580c;text-transform:uppercase;letter-spacing:.04em}
    h3{margin:14px 0 6px;font-size:14px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
    .metric{border:1px solid #e7e5e4;border-radius:8px;padding:12px;background:#fafaf9}
    .metric b{display:block;font-size:22px}.metric span{font-size:11px;color:#78716c;text-transform:uppercase}
    table{width:100%;border-collapse:collapse;font-size:13px}td,th{border-bottom:1px solid #e7e5e4;padding:8px;text-align:left;vertical-align:top}
    th{font-size:11px;color:#78716c;text-transform:uppercase;background:#fafaf9}.muted{color:#78716c}.pill{display:inline-block;border:1px solid #fed7aa;color:#c2410c;border-radius:999px;padding:2px 8px;font-size:11px}
    .scenario{border-left:3px solid #ea580c;padding-left:12px;margin:10px 0}.sources li{margin-bottom:6px}
    .warning{border:1px solid #fde68a;background:#fffbeb;border-radius:8px;padding:12px}.warning li{margin-bottom:4px}.vp{display:flex;gap:16px;align-items:flex-start}.vp img{width:96px;height:96px;object-fit:cover;border-radius:8px;border:1px solid #e7e5e4}
    @media print{body{background:#fff}.page{max-width:none}.no-print{display:none}}
  </style>
</head>
<body>
  <div class="page">
    <header>
      <h1>${escapeHtml(input.titulo)}</h1>
      <div class="meta">${escapeHtml(input.associado.nome)} · ${escapeHtml(input.associado.setor)} · ${periodo}</div>
    </header>

    <section>
      <h2>Resumo Executivo</h2>
      <div class="grid">
        <div class="metric"><span>Decisões</span><b>${input.deliberacoes.length}</b></div>
        <div class="metric"><span>Notícias</span><b>${input.noticias.length}</b></div>
        <div class="metric"><span>Mandatos</span><b>${input.mandatos.length}</b></div>
        <div class="metric"><span>Confiança IA</span><b>${Math.round(input.cenarios.confianca * 100)}%</b></div>
      </div>
      <p>${escapeHtml(input.associado.descricao ?? "Documento gerado a partir das fontes regulatorio-institucionais monitoradas.")}</p>
      <p class="muted">Temas acompanhados: ${escapeHtml(input.associado.microtemas.join(", ") || "nao informados")}.</p>
      ${input.observacoes_curadoria ? `<p class="muted"><b>Observacoes de curadoria:</b> ${escapeHtml(input.observacoes_curadoria)}</p>` : ""}
      ${renderQuality(input.qualidade)}
    </section>

    <section>
      <h2>${isQuarterly ? "Mandatos e Lista Tríplice" : "Decisões, Pautas e Votos do Mês"}</h2>
      ${isQuarterly ? renderMandatos(input.mandatos, input.listaTriplice) : renderMonthly(input.deliberacoes, input.noticias)}
    </section>

    <section>
      <h2>Concordancia dos Diretores</h2>
      ${renderConcordancia(input.concordancia)}
    </section>

    <section>
      <h2>Política Pública e Notícias Correlatas</h2>
      ${renderNoticias(input.noticias)}
      ${renderMinisterios(input.associado)}
    </section>

    <section>
      <h2>Visão VP</h2>
      <div class="vp">
        ${input.associado.vp_foto_url ? `<img src="${escapeHtml(input.associado.vp_foto_url)}" alt="${escapeHtml(input.associado.vp_nome ?? "VP")}" />` : ""}
        <div>
          <p><span class="pill">${escapeHtml(input.associado.vp_nome ?? "VP a definir")}</span> ${escapeHtml(input.associado.vp_cargo ?? "")}</p>
          ${vpParagraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}
        </div>
      </div>
    </section>

    <section>
      <h2>Cenários Cautelosos</h2>
      <div class="scenario"><b>Provável.</b> ${escapeHtml(input.cenarios.provavel)}</div>
      <div class="scenario"><b>Alternativo.</b> ${escapeHtml(input.cenarios.alternativo)}</div>
      <div class="scenario"><b>Risco.</b> ${escapeHtml(input.cenarios.risco)}</div>
    </section>

    <section>
      <h2>Fontes</h2>
      <ol class="sources">${input.fontes.length ? input.fontes.map((f) => `<li>${escapeHtml(f.tipo)} · ${f.url ? `<a href="${escapeHtml(f.url)}">${escapeHtml(f.titulo)}</a>` : escapeHtml(f.titulo)}</li>`).join("") : "<li>Nenhuma fonte específica encontrada no período.</li>"}</ol>
      <p class="muted">Projeções são cenários analíticos, não previsões determinísticas. Revisar antes de circular.</p>
    </section>
  </div>
</body>
</html>`;
}

function renderQuality(qualidade: DocumentoAssociadoPreview["qualidade"]) {
  if (!qualidade.pendencias.length) {
    return `<p class="muted">Qualidade operacional: ${qualidade.score}/100. Sem pendências críticas detectadas.</p>`;
  }
  return `
    <div class="warning">
      <b>Pendências antes de circular (${qualidade.score}/100 - ${escapeHtml(qualidade.status)}).</b>
      <ul>${qualidade.pendencias.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderMandatos(mandatos: Mandato[], lista: ListaTripliceItem[]) {
  const mandatoRows = mandatos.slice(0, 8).map((m) => `
    <tr><td>${escapeHtml(m.diretor_nome)}</td><td>${escapeHtml(m.cargo ?? "-")}</td><td>${formatDate(m.data_inicio)}</td><td>${m.data_fim ? formatDate(m.data_fim) : "em aberto"}</td><td>${escapeHtml(m.review_status ?? "aprovado")}</td></tr>
  `).join("");
  const listaRows = lista.slice(0, 8).map((l) => `
    <tr><td>${escapeHtml(l.nome_candidato)}</td><td>${escapeHtml(l.cargo)}</td><td>${escapeHtml(l.etapa)}</td><td>${Math.round(l.confidence * 100)}%</td></tr>
  `).join("");
  return `
    <h3>Mandatos</h3>
    <table><thead><tr><th>Diretor</th><th>Cargo</th><th>Início</th><th>Fim</th><th>Status</th></tr></thead><tbody>${mandatoRows || `<tr><td colspan="5" class="muted">Sem mandatos cadastrados para o recorte.</td></tr>`}</tbody></table>
    <h3>Lista tríplice</h3>
    <table><thead><tr><th>Candidato</th><th>Cargo</th><th>Etapa</th><th>Confiança</th></tr></thead><tbody>${listaRows || `<tr><td colspan="4" class="muted">Sem lista tríplice revisada/cadastrada.</td></tr>`}</tbody></table>
  `;
}

function renderDeliberacoes(delibs: Deliberacao[]) {
  const rows = delibs.slice(0, 10).map((d) => `
    <tr><td>${escapeHtml(d.data_reuniao ? formatDate(d.data_reuniao) : "-")}</td><td>${escapeHtml(d.numero_deliberacao ?? d.item_numero ?? "-")}</td><td>${escapeHtml(d.interessado ?? "-")}</td><td>${escapeHtml(d.assunto ?? d.microtema ?? "-")}</td><td>${escapeHtml(d.resultado ?? "-")}</td></tr>
  `).join("");
  return `<table><thead><tr><th>Data</th><th>Doc</th><th>Interessado</th><th>Tema</th><th>Resultado</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="muted">Sem decisões relevantes no período.</td></tr>`}</tbody></table>`;
}

function renderMonthly(delibs: Deliberacao[], items: MonitoramentoItem[]) {
  const atas = items.filter((item) => item.tipo === "ata" || item.tipo === "pauta" || item.tipo === "deliberacao");
  const ataRows = atas.slice(0, 8).map((item) => `
    <tr><td>${escapeHtml(item.data_reuniao ? formatDate(item.data_reuniao) : "-")}</td><td><a href="${escapeHtml(item.url_item)}">${escapeHtml(item.titulo)}</a></td><td>${escapeHtml(item.tipo)}</td></tr>
  `).join("");
  return `
    <h3>Decisões do período</h3>
    ${renderDeliberacoes(delibs)}
    <h3>Atas, pautas e atos monitorados</h3>
    <table><thead><tr><th>Data</th><th>Documento</th><th>Tipo</th></tr></thead><tbody>${ataRows || `<tr><td colspan="3" class="muted">Sem atas ou pautas monitoradas no período.</td></tr>`}</tbody></table>
  `;
}

function renderConcordancia(rows: Array<{ nomes: string; concordam: number; total: number; pct: number }>) {
  const body = rows.map((r) => `<tr><td>${escapeHtml(r.nomes)}</td><td>${r.concordam}/${r.total}</td><td>${r.pct}%</td></tr>`).join("");
  return `<table><thead><tr><th>Par</th><th>Concordam</th><th>Taxa</th></tr></thead><tbody>${body || `<tr><td colspan="3" class="muted">Sem votos suficientes para matriz de concordancia.</td></tr>`}</tbody></table>`;
}

function renderNoticias(items: MonitoramentoItem[]) {
  const rows = items
    .filter((n) => n.tipo === "noticia" || n.tipo === "politica_publica" || n.tipo === "consulta_publica")
    .slice(0, 10)
    .map((n) => `<tr><td>${escapeHtml(n.data_reuniao ? formatDate(n.data_reuniao) : "-")}</td><td><a href="${escapeHtml(n.url_item)}">${escapeHtml(n.titulo)}</a><br/><span class="muted">${escapeHtml(String(n.metadata?.resumo ?? ""))}</span></td><td>${escapeHtml(n.tipo)}</td></tr>`).join("");
  return `<table><thead><tr><th>Data</th><th>Notícia</th><th>Tipo</th></tr></thead><tbody>${rows || `<tr><td colspan="3" class="muted">Sem notícias correlatas no período.</td></tr>`}</tbody></table>`;
}

function renderMinisterios(associado: Associado) {
  const rows = associado.ministerios.map((ministerio, index) => {
    const url = associado.ministerio_urls[index];
    return `<li>${escapeHtml(ministerio)}${url ? ` - <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>` : ""}</li>`;
  }).join("");
  return `<h3>Ministérios correlatos</h3><ul>${rows || "<li class=\"muted\">Nenhum ministério correlato cadastrado.</li>"}</ul>`;
}

function buildVpParagraphs(input: BuildAssociadoDocumentInput & { deliberacoes: Deliberacao[]; noticias: MonitoramentoItem[] }) {
  const manual = (input.vp_paragrafos ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 3);
  if (manual.length) {
    return [
      ...manual,
      ...Array.from({ length: Math.max(0, 3 - manual.length) }, () => "Parágrafo VP pendente de curadoria."),
    ].slice(0, 3);
  }

  return [
    `No período, o recorte de ${input.associado.nome} reuniu ${input.deliberacoes.length} decisões e ${input.noticias.length} sinais de política pública, com foco em ${input.associado.microtemas.slice(0, 4).join(", ")}.`,
    `A leitura executiva sugere acompanhar os temas com maior recorrência e priorizar revisão das fontes oficiais antes de qualquer posicionamento institucional.`,
    input.associado.vp_minibio ?? "Mini bio pendente de curadoria. Preencher com fonte oficial antes de distribuir o relatório.",
  ];
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
