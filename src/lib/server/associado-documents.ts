import type {
  Associado,
  Deliberacao,
  Diretor,
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
    descricao: "Relatório trimestral e boletim mensal de temas metroviários e de mobilidade regulados pela ARTESP, com áreas correlatas na ANTT.",
    agencia_siglas: ["ARTESP", "ANTT"],
    ministerios: ["Ministério dos Transportes", "Secretaria de Parcerias em Investimentos do Estado de São Paulo"],
    ministerio_urls: ["https://www.gov.br/transportes/pt-br/assuntos/noticias", "https://www.artesp.sp.gov.br/artesp/noticias"],
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
  /** Curadoria da edição: sobrescreve a foto/minibio do associado só neste documento. */
  vp_foto_url?: string | null;
  vp_minibio?: string | null;
  observacoes_curadoria?: string | null;
  /** Diretoria das agências do associado (para composição + bios). */
  diretores?: Diretor[];
  /** Textos curados das seções analíticas (rascunho editável). */
  sumario_executivo?: string | null;
  perfis_influencias?: string | null;
  correlacao_forcas?: string | null;
  agendas?: string[];
  conclusao?: string | null;
  monitoramento?: string | null;
}

export interface ProspeccaoItem {
  tema: string;
  probabilidade: "alta" | "média" | "baixa";
  racional: string;
  horizonte: string;
}

export interface Prospeccao {
  itens: ProspeccaoItem[];
  confianca: number;
  /** "deterministico" hoje; "ia" quando o Claude for plugado em generateProspeccao(). */
  fonte: "deterministico" | "ia";
  resumo: string;
}

export function buildAssociadoDocument(input: BuildAssociadoDocumentInput): DocumentoAssociadoPreview {
  // Curadoria pode sobrescrever foto/minibio do VP só neste documento.
  const associado: Associado = {
    ...input.associado,
    vp_foto_url: input.vp_foto_url ?? input.associado.vp_foto_url,
    vp_minibio: input.vp_minibio ?? input.associado.vp_minibio,
  };

  const relevantDelibs = filterRelevantDelibs(input.deliberacoes, associado);
  const relevantNews = filterRelevantNews(input.noticias, associado);
  const concordancia = computeConcordancia(relevantDelibs);
  const cenarios = buildCenarios(relevantDelibs, relevantNews, associado);
  const prospeccao = generateProspeccao({
    associado,
    deliberacoes: relevantDelibs,
    mandatos: input.mandatos,
    listaTriplice: input.listaTriplice,
    noticias: relevantNews,
    periodo_fim: input.periodo_fim,
  });
  const listaTriplice = [...input.listaTriplice, ...(input.listaTripliceManual ?? [])];
  const fontes = buildFontes(relevantDelibs, relevantNews, listaTriplice);
  const metricas = {
    deliberacoes: relevantDelibs.length,
    noticias: relevantNews.length,
    mandatos: input.mandatos.length,
    lista_triplice: listaTriplice.length,
    confianca_cenarios: prospeccao.confianca,
  };
  const qualidade = assessQuality({
    tipo: input.tipo,
    associado,
    metricas,
    concordanciaCount: concordancia.length,
    vpParagrafos: input.vp_paragrafos,
  });
  const titulo = input.tipo === "relatorio_trimestral"
    ? `Relatório do Associado (Trimestral) - ${associado.nome}`
    : `Boletim Mensal (Deliberações) - ${associado.nome}`;

  const html = buildHtml({
    ...input,
    associado,
    listaTriplice,
    titulo,
    deliberacoes: relevantDelibs,
    noticias: relevantNews,
    concordancia,
    cenarios,
    prospeccao,
    fontes,
    qualidade,
  });

  return {
    associado,
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
  vpParagrafos?: string[];
}) {
  const pendencias: string[] = [];
  const minibio = input.associado.vp_minibio ?? "";
  const placeholderText = normalize(`${input.associado.vp_nome ?? ""} ${minibio}`).includes("a definir")
    || normalize(minibio).includes("pendente");
  const curatedParas = (input.vpParagrafos ?? []).map((p) => p.trim()).filter(Boolean);
  const vpOk = Boolean(input.associado.vp_foto_url)
    && (curatedParas.length >= 3 || (Boolean(minibio) && !placeholderText));

  if (input.metricas.deliberacoes === 0) pendencias.push("Sem deliberações relevantes no período.");
  if (input.metricas.noticias === 0) pendencias.push("Sem notícias ou atos monitorados correlatos no período.");
  if (input.concordanciaCount === 0) pendencias.push("Sem votos suficientes para calcular concordância dos diretores.");
  if (input.tipo === "relatorio_trimestral" && input.metricas.mandatos === 0) pendencias.push("Sem mandatos cadastrados para as agências do associado.");
  if (input.tipo === "relatorio_trimestral" && input.metricas.lista_triplice === 0) pendencias.push("Sem lista tríplice revisada/cadastrada.");
  if (!vpOk) pendencias.push("Visão VP: foto, mini bio e os 3 parágrafos ainda precisam de curadoria.");

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
  prospeccao: Prospeccao;
  fontes: Array<{ tipo: string; titulo: string; url?: string | null }>;
  qualidade: DocumentoAssociadoPreview["qualidade"];
}) {
  const periodo = `${formatDate(input.periodo_inicio)} a ${formatDate(input.periodo_fim)}`;
  const isQuarterly = input.tipo === "relatorio_trimestral";
  const vpParagraphs = buildVpParagraphs(input);
  const associado = input.associado;
  const diretores = input.diretores ?? [];
  const siglas = associado.agencia_siglas.join(" · ") || "—";
  const expirando = countExpiringMandatos(input.mandatos, input.periodo_fim);
  const concAvg = input.concordancia.length
    ? Math.round(input.concordancia.reduce((s, c) => s + c.pct, 0) / input.concordancia.length)
    : 0;
  const agendas = (input.agendas ?? []).map((a) => a.trim()).filter(Boolean);

  const coverTitle = isQuarterly
    ? "Análise Político-Regulatória"
    : "Boletim Mensal Regulatório";
  const docKind = isQuarterly ? "Relatório do Associado · Trimestral" : "Boletim de Deliberações · Mensal";

  const body = isQuarterly
    ? `
    ${section("Sumário Executivo", `${renderCurated(input.sumario_executivo) || `<p class="lead">${escapeHtml(associado.descricao ?? "Documento de inteligência institucional e regulatória gerado a partir de fontes oficiais monitoradas.")}</p>`}
      ${input.observacoes_curadoria ? `<p class="muted"><b>Observações de curadoria:</b> ${escapeHtml(input.observacoes_curadoria)}</p>` : ""}
      ${renderQuality(input.qualidade)}`)}
    ${section("Dashboard de Exposição Regulatória", renderDashboardExposicao(expirando, input.deliberacoes.length, concAvg))}
    ${section("Composição da Diretoria", renderComposicaoDiretoria(input.mandatos))}
    ${diretores.length ? section("Conheça os Diretores", renderBios(diretores)) : ""}
    ${section("Visão do Vice-Presidente", renderVpSection(associado, vpParagraphs))}
    ${input.perfis_influencias ? section("Mapeamento de Perfis e Influências", renderCurated(input.perfis_influencias)) : ""}
    ${input.correlacao_forcas ? section("Correlação de Forças Interna", renderCurated(input.correlacao_forcas)) : ""}
    ${section("Concordância dos Diretores", renderConcordancia(input.concordancia))}
    ${section("Mandatos e Lista Tríplice", renderMandatos(input.mandatos, input.listaTriplice))}
    ${agendas.length ? section("Principais Agendas Regulatórias", renderAgendas(agendas)) : ""}
    ${section("Prospecção das Principais Decisões", renderProspeccaoSection(input.prospeccao, input.cenarios))}
    ${section("Ministério Correlato e Política Pública", `${renderMinisterioCorrelato(associado, input.noticias)}${renderNoticias(input.noticias)}`)}
    ${input.conclusao ? section("Conclusão", renderCurated(input.conclusao)) : ""}
    ${input.monitoramento ? section("Monitoramento Regulatório e Jurídico", renderCurated(input.monitoramento)) : ""}
    ${section("Fontes", renderFontes(input.fontes))}`
    : `
    ${section("Sumário Executivo", `${renderCurated(input.sumario_executivo) || `<p class="lead">${escapeHtml(associado.descricao ?? "Boletim mensal das deliberações e atos que impactam o associado.")}</p>`}
      ${input.observacoes_curadoria ? `<p class="muted"><b>Observações de curadoria:</b> ${escapeHtml(input.observacoes_curadoria)}</p>` : ""}
      ${renderQuality(input.qualidade)}`)}
    ${section("Dashboard de Exposição Regulatória", renderDashboardExposicao(expirando, input.deliberacoes.length, concAvg))}
    ${section("Decisões, Pautas e Votos do Mês", renderMonthly(input.deliberacoes, input.noticias))}
    ${section("Concordância dos Diretores no Mês", renderConcordancia(input.concordancia))}
    ${section("Prospecção das Principais Decisões", renderProspeccaoSection(input.prospeccao, input.cenarios))}
    ${section("Ministério Correlato e Política Pública", `${renderMinisterioCorrelato(associado, input.noticias)}${renderNoticias(input.noticias)}`)}
    ${input.conclusao ? section("Conclusão", renderCurated(input.conclusao)) : ""}
    ${section("Fontes", renderFontes(input.fontes))}`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(input.titulo)}</title>
  <style>${REPORT_CSS}</style>
</head>
<body>
  <div class="page">
    <section class="cover">
      <div class="cover-logo">${LOGO_WORDMARK}</div>
      <div>
        <div class="cover-kicker">${escapeHtml(associado.nome.toUpperCase())} · Inteligência Institucional e Regulatória</div>
        <h1 class="cover-title">${escapeHtml(coverTitle)}</h1>
        <p class="cover-sub">${escapeHtml(siglas)} · ${escapeHtml(associado.setor)} · Período ${periodo}</p>
      </div>
      <div class="cover-meta">${escapeHtml(docKind)} · Documento gerado automaticamente a partir de fontes oficiais · Uso interno — confidencial</div>
    </section>

    ${section("Indicadores-chave", renderKpiStrip(input, expirando, agendas.length), true)}
    ${body}

    <div class="footer"><span>IRIS Regulação · Instituto de Regulação, Inovação e Sustentabilidade</span><span>Uso interno — confidencial</span></div>
  </div>
</body>
</html>`;
}

const LOGO_WORDMARK = `<span class="wm">IRIS</span><span class="wm-sub">INSTITUTO DE REGULAÇÃO</span>`;

const REPORT_CSS = `
*{box-sizing:border-box}
body{margin:0;background:#e9edf2;color:#1c2733;font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5}
.page{max-width:794px;margin:0 auto;background:#fff}
.cover{background:linear-gradient(160deg,#0f2741,#1b3a5c);color:#fff;min-height:1040px;padding:64px 56px;display:flex;flex-direction:column;justify-content:space-between;border:none}
.cover-logo{display:flex;flex-direction:column;gap:2px}
.wm{font-size:42px;font-weight:800;letter-spacing:.2em;color:#c9a84c;line-height:1}
.wm-sub{font-size:9px;letter-spacing:.34em;color:#9fb2c6}
.cover-kicker{font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:#c9a84c;font-weight:700}
.cover-title{font-size:40px;font-weight:800;line-height:1.08;margin:14px 0 0;color:#fff}
.cover-sub{font-size:14px;color:#c7d3e0;margin-top:14px}
.cover-meta{font-size:11px;color:#8ba0b6;letter-spacing:.03em}
section{padding:30px 56px;border-bottom:1px solid #eef1f5}
.sec-head{display:flex;align-items:center;gap:12px;margin:0 0 4px}
.sec-bar{width:6px;height:24px;background:#c9a84c;border-radius:2px;display:inline-block}
.sec-title{font-size:17px;font-weight:800;color:#0f2741;margin:0}
.sec-rule{height:3px;background:linear-gradient(90deg,#0f2741 0%,#c9a84c 38%,transparent 100%);margin:8px 0 16px;border-radius:2px}
.lead{font-size:13.5px;color:#374151;margin:0 0 8px}
.curated p{margin:0 0 9px;white-space:pre-wrap}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.kpi{background:#0f2741;color:#fff;border-radius:10px;padding:16px}
.kpi b{display:block;font-size:26px;font-weight:800;color:#fff}
.kpi span{font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:#9fb2c6}
.kpi.gold{background:#c9a84c}.kpi.gold b,.kpi.gold span{color:#0f2741}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.card{border:1px solid #e5e7eb;border-radius:10px;padding:14px;background:#fafbfc}
.card h4{margin:0 0 6px;font-size:12.5px;color:#0f2741}
.dots{letter-spacing:3px;color:#c9a84c;font-size:15px}
.dots .off{color:#cdd6e0}
.tag{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:999px}
.tag-alta{background:#fde2e1;color:#b42318}.tag-media{background:#fef0c7;color:#92610a}.tag-baixa{background:#e7f0e9;color:#256b3e}
table{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px}
th{background:#0f2741;color:#fff;text-align:left;padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
td{border-bottom:1px solid #e5e7eb;padding:8px 10px;vertical-align:top}
tbody tr:nth-child(even){background:#f7f9fb}
a{color:#1b4f8a;text-decoration:none}
.muted{color:#6b7280}.pill{display:inline-block;background:#0f2741;color:#fff;border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600}
h3{margin:16px 0 6px;font-size:13px;color:#0f2741}
.tl-row{display:flex;align-items:center;gap:10px;margin:6px 0;font-size:11px}
.tl-name{width:190px;font-weight:600;color:#0f2741}
.tl-track{flex:1;height:12px;background:#eef1f5;border-radius:6px;position:relative}
.tl-bar{position:absolute;top:0;height:12px;background:#1b3a5c;border-radius:6px}
.tl-bar.crit{background:#b42318}
.tl-range{width:96px;text-align:right;color:#6b7280}
.bios{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.bio{border:1px solid #e5e7eb;border-radius:10px;padding:14px;display:flex;gap:12px;background:#fafbfc}
.bio img,.bio .avatar{width:64px;height:64px;border-radius:8px;object-fit:cover;flex-shrink:0}
.bio .avatar{background:#0f2741;color:#c9a84c;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px}
.bio b{font-size:13px;color:#0f2741;display:block}.bio .role{font-size:11px;color:#6b7280}.bio p{margin:6px 0 0;font-size:11px;color:#374151}
.vp{display:flex;gap:18px;align-items:flex-start;background:#f7f9fb;border:1px solid #e5e7eb;border-radius:10px;padding:16px}
.vp img,.vp .avatar{width:108px;height:108px;border-radius:10px;object-fit:cover;flex-shrink:0}
.vp .avatar{background:#0f2741;color:#c9a84c;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:30px}
.scenario{border-left:3px solid #c9a84c;padding:2px 0 2px 12px;margin:8px 0;font-size:12px}
.sources{font-size:11px;color:#374151;padding-left:18px}.sources li{margin-bottom:4px}
.warning{border:1px solid #fde68a;background:#fffbeb;border-radius:8px;padding:12px;font-size:12px;margin-top:10px}.warning ul{margin:6px 0 0;padding-left:18px}
.footer{padding:16px 56px;background:#0f2741;color:#9fb2c6;font-size:10px;letter-spacing:.05em;text-transform:uppercase;display:flex;justify-content:space-between;border:none}
@media print{
  @page{size:A4;margin:0}
  body{background:#fff}
  .page{max-width:none;width:auto}
  .cover{min-height:100vh;break-after:page;page-break-after:always}
  section{break-inside:avoid}
}
`;

function section(title: string, content: string, kpis = false) {
  return `
    <section>
      <div class="sec-head"><span class="sec-bar"></span><h2 class="sec-title">${escapeHtml(title)}</h2></div>
      <div class="sec-rule"></div>
      ${kpis ? `<div class="kpis">${content}</div>` : content}
    </section>`;
}

function renderKpiStrip(
  input: { deliberacoes: Deliberacao[]; noticias: MonitoramentoItem[]; mandatos: Mandato[]; prospeccao: Prospeccao },
  expirando: number,
  agendasCount: number,
) {
  const cards = [
    { label: "Decisões no período", value: String(input.deliberacoes.length) },
    { label: "Mandatos críticos", value: String(expirando), gold: expirando > 0 },
    { label: "Agendas prioritárias", value: String(agendasCount || input.noticias.length) },
    { label: "Confiança da projeção", value: `${Math.round(input.prospeccao.confianca * 100)}%` },
  ];
  return cards.map((c) => `<div class="kpi${c.gold ? " gold" : ""}"><b>${escapeHtml(c.value)}</b><span>${escapeHtml(c.label)}</span></div>`).join("");
}

function renderCurated(text: string | null | undefined) {
  const value = (text ?? "").trim();
  if (!value) return "";
  const paras = value.split(/\n{2,}|\r\n\r\n/).map((p) => p.trim()).filter(Boolean);
  return `<div class="curated">${(paras.length ? paras : [value]).map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</div>`;
}

function dots(filled: number, total = 5) {
  const f = Math.max(0, Math.min(total, filled));
  return `<span class="dots">${"●".repeat(f)}<span class="off">${"○".repeat(total - f)}</span></span>`;
}

function renderDashboardExposicao(expirando: number, decisoes: number, concAvg: number) {
  const sucessao = expirando >= 2 ? 5 : expirando === 1 ? 3 : 1;
  const volume = decisoes >= 12 ? 5 : decisoes >= 6 ? 4 : decisoes >= 1 ? 2 : 1;
  const consenso = concAvg >= 85 ? 5 : concAvg >= 65 ? 4 : concAvg >= 40 ? 3 : concAvg > 0 ? 2 : 1;
  const cards = [
    { t: "Sucessão / Mandatos", d: sucessao, note: `${expirando} mandato(s) próximo(s) do fim` },
    { t: "Volume de decisões", d: volume, note: `${decisoes} decisão(ões) no período` },
    { t: "Consenso do colegiado", d: consenso, note: concAvg ? `${concAvg}% de concordância média` : "Sem dados de votação" },
  ];
  return `<div class="cards">${cards.map((c) => `<div class="card"><h4>${escapeHtml(c.t)}</h4>${dots(c.d)}<p class="muted" style="margin:6px 0 0;font-size:11px">${escapeHtml(c.note)}</p></div>`).join("")}</div>`;
}

function countExpiringMandatos(mandatos: Mandato[], periodoFim: string) {
  const fim = new Date(periodoFim).getTime();
  const janela = 180 * 86_400_000;
  return mandatos.filter((m) => {
    if (!m.data_fim) return false;
    const t = new Date(m.data_fim).getTime();
    return t >= fim && t - fim <= janela;
  }).length;
}

function renderComposicaoDiretoria(mandatos: Mandato[]) {
  if (!mandatos.length) {
    return `<p class="muted">Sem mandatos cadastrados para as agências do associado.</p>`;
  }
  const rows = mandatos.slice(0, 10).map((m) => {
    const status = m.status === "Ativo" ? "Ativo" : "Inativo";
    return `<tr><td>${escapeHtml(m.diretor_nome)}</td><td>${escapeHtml(m.cargo ?? "—")}</td><td>${formatDate(m.data_inicio)}</td><td>${m.data_fim ? formatDate(m.data_fim) : "em aberto"}</td><td>${escapeHtml(status)}</td></tr>`;
  }).join("");
  return `
    <table><thead><tr><th>Diretor</th><th>Cargo</th><th>Início</th><th>Fim</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
    <h3>Linha do tempo dos mandatos</h3>
    ${renderTimeline(mandatos)}
  `;
}

function renderTimeline(mandatos: Mandato[]) {
  const withDates = mandatos.filter((m) => m.data_inicio);
  if (!withDates.length) return `<p class="muted">Sem datas de mandato para montar a linha do tempo.</p>`;
  const years = withDates.flatMap((m) => [yearOf(m.data_inicio), m.data_fim ? yearOf(m.data_fim) : new Date().getFullYear()]);
  const min = Math.min(...years);
  const max = Math.max(...years) + 1;
  const span = Math.max(1, max - min);
  return withDates.slice(0, 10).map((m) => {
    const start = yearOf(m.data_inicio);
    const end = m.data_fim ? yearOf(m.data_fim) : new Date().getFullYear();
    const left = ((start - min) / span) * 100;
    const width = Math.max(4, ((end - start) / span) * 100);
    const crit = m.data_fim && new Date(m.data_fim).getTime() - Date.now() <= 180 * 86_400_000 && new Date(m.data_fim).getTime() >= Date.now();
    return `<div class="tl-row"><span class="tl-name">${escapeHtml(m.diretor_nome)}</span><span class="tl-track"><span class="tl-bar${crit ? " crit" : ""}" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></span></span><span class="tl-range">${start}–${m.data_fim ? end : "•"}</span></div>`;
  }).join("");
}

function yearOf(value: string) {
  return Number(value.slice(0, 4)) || new Date().getFullYear();
}

function renderBios(diretores: Diretor[]) {
  const cards = diretores.slice(0, 8).map((d) => {
    const initials = (d.nome || "?").split(" ").filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
    const avatar = d.foto_url
      ? `<img src="${escapeHtml(d.foto_url)}" alt="${escapeHtml(d.nome)}" />`
      : `<span class="avatar">${escapeHtml(initials)}</span>`;
    const mandato = d.data_posse || d.data_fim_mandato
      ? `${d.data_posse ? formatDate(d.data_posse) : "—"} a ${d.data_fim_mandato ? formatDate(d.data_fim_mandato) : "em aberto"}`
      : "";
    const contato = [d.email, d.telefone].filter(Boolean).join(" · ");
    const bio = (d.minibio ?? "").trim();
    return `<div class="bio">${avatar}<div><b>${escapeHtml(d.nome)}</b><span class="role">${escapeHtml(d.cargo ?? d.situacao ?? "Diretor(a)")}${mandato ? ` · ${escapeHtml(mandato)}` : ""}</span>${contato ? `<p class="muted">${escapeHtml(contato)}</p>` : ""}${bio ? `<p>${escapeHtml(bio.slice(0, 460))}</p>` : ""}</div></div>`;
  }).join("");
  return `<div class="bios">${cards}</div>`;
}

function renderVpSection(associado: Associado, vpParagraphs: string[]) {
  const initials = (associado.vp_nome || "VP").split(" ").filter((w) => w.length > 2).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "VP";
  const avatar = associado.vp_foto_url
    ? `<img src="${escapeHtml(associado.vp_foto_url)}" alt="${escapeHtml(associado.vp_nome ?? "VP")}" />`
    : `<span class="avatar">${escapeHtml(initials)}</span>`;
  return `
    <div class="vp">${avatar}<div>
      <p><span class="pill">${escapeHtml(associado.vp_nome ?? "VP a definir")}</span> ${escapeHtml(associado.vp_cargo ?? "")}</p>
      ${vpParagraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}
    </div></div>`;
}

function renderAgendas(agendas: string[]) {
  const cards = agendas.slice(0, 6).map((a) => {
    const [tema, prioridadeRaw] = a.split(/[;|]/).map((s) => s.trim());
    const prio = normalize(prioridadeRaw ?? "").includes("alta") ? "alta" : normalize(prioridadeRaw ?? "").includes("baix") ? "baixa" : "media";
    const tagClass = prio === "alta" ? "tag-alta" : prio === "baixa" ? "tag-baixa" : "tag-media";
    return `<div class="card"><h4>${escapeHtml(tema || a)}</h4><span class="tag ${tagClass}">${escapeHtml(prioridadeRaw || "Prioridade média")}</span></div>`;
  }).join("");
  return `<div class="cards">${cards}</div>`;
}

function renderProspeccaoSection(prospeccao: Prospeccao, cenarios: { provavel: string; alternativo: string; risco: string }) {
  return `
    ${renderProspeccao(prospeccao)}
    <h3>Leituras complementares</h3>
    <div class="scenario"><b>Provável.</b> ${escapeHtml(cenarios.provavel)}</div>
    <div class="scenario"><b>Alternativo.</b> ${escapeHtml(cenarios.alternativo)}</div>
    <div class="scenario"><b>Risco.</b> ${escapeHtml(cenarios.risco)}</div>`;
}

function renderFontes(fontes: Array<{ tipo: string; titulo: string; url?: string | null }>) {
  return `
    <ol class="sources">${fontes.length ? fontes.map((f) => `<li>${escapeHtml(f.tipo)} · ${f.url ? `<a href="${escapeHtml(f.url)}">${escapeHtml(f.titulo)}</a>` : escapeHtml(f.titulo)}</li>`).join("") : "<li>Nenhuma fonte específica encontrada no período.</li>"}</ol>
    <p class="muted">Projeções são cenários analíticos, não previsões determinísticas. Revisar antes de circular.</p>`;
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
  return `
    <h3>Decisões do mês</h3>
    ${renderDeliberacoes(delibs)}
    ${renderAtasPassadas(delibs, items)}
  `;
}

function renderAtasPassadas(delibs: Deliberacao[], items: MonitoramentoItem[]) {
  const ataDelibs = delibs.filter((d) => d.tipo_documento === "ata");
  const ataItems = items.filter((item) => item.tipo === "ata" || item.tipo === "pauta" || item.tipo === "deliberacao");
  const delibRows = ataDelibs.slice(0, 8).map((d) => `
    <tr><td>${escapeHtml(d.data_reuniao ? formatDate(d.data_reuniao) : "-")}</td><td>${escapeHtml(d.numero_deliberacao ?? d.assunto ?? d.processo ?? "Ata")}</td><td>deliberação</td></tr>
  `).join("");
  const itemRows = ataItems.slice(0, 8).map((item) => `
    <tr><td>${escapeHtml(item.data_reuniao ? formatDate(item.data_reuniao) : "-")}</td><td><a href="${escapeHtml(item.url_item)}">${escapeHtml(item.titulo)}</a></td><td>${escapeHtml(item.tipo)} (monitorado)</td></tr>
  `).join("");
  const body = `${delibRows}${itemRows}`;
  return `
    <h3>Atas passadas</h3>
    <table><thead><tr><th>Data</th><th>Documento</th><th>Origem</th></tr></thead><tbody>${body || `<tr><td colspan="3" class="muted">Sem atas no período.</td></tr>`}</tbody></table>
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

// Ministério federal correlato por agência reguladora (para o mapeamento do boletim).
const AGENCIA_PARA_MINISTERIO: Record<string, string> = {
  ANTT: "Ministério dos Transportes",
  ANTAQ: "Ministério dos Transportes",
  ARTESP: "Ministério dos Transportes",
  DNIT: "Ministério dos Transportes",
  ANM: "Ministério de Minas e Energia",
  ANEEL: "Ministério de Minas e Energia",
  ANP: "Ministério de Minas e Energia",
};

const SETOR_PARA_MINISTERIO: Record<string, string> = {
  "Metroviário": "Ministério dos Transportes",
  "Transportes": "Ministério dos Transportes",
  "Mineração": "Ministério de Minas e Energia",
  "Energia": "Ministério de Minas e Energia",
};

function resolveMinisteriosCorrelatos(associado: Associado): Array<{ ministerio: string; agencias: string[] }> {
  const map = new Map<string, Set<string>>();
  for (const sigla of associado.agencia_siglas) {
    const ministerio = AGENCIA_PARA_MINISTERIO[sigla.toUpperCase()]
      ?? SETOR_PARA_MINISTERIO[associado.setor]
      ?? associado.ministerios[0];
    if (!ministerio) continue;
    if (!map.has(ministerio)) map.set(ministerio, new Set());
    map.get(ministerio)!.add(sigla.toUpperCase());
  }
  for (const ministerio of associado.ministerios) {
    if (!map.has(ministerio)) map.set(ministerio, new Set());
  }
  return [...map.entries()].map(([ministerio, agencias]) => ({ ministerio, agencias: [...agencias] }));
}

function renderMinisterioCorrelato(associado: Associado, noticias: MonitoramentoItem[]) {
  const correlatos = resolveMinisteriosCorrelatos(associado);
  const linhas = correlatos.map((c) =>
    `<tr><td>${escapeHtml(c.ministerio)}</td><td>${escapeHtml(c.agencias.join(", ") || "—")}</td></tr>`,
  ).join("");
  const atos = noticias
    .filter((n) => n.tipo === "politica_publica" || n.tipo === "consulta_publica")
    .slice(0, 6)
    .map((n) => `<li><a href="${escapeHtml(n.url_item)}">${escapeHtml(n.titulo)}</a> <span class="muted">(${escapeHtml(n.tipo)})</span></li>`)
    .join("");
  return `
    <h3>Mapeamento do Ministério correlato</h3>
    <table><thead><tr><th>Ministério</th><th>Agência(s) correlata(s)</th></tr></thead><tbody>${linhas || `<tr><td colspan="2" class="muted">Nenhum ministério correlato resolvido.</td></tr>`}</tbody></table>
    <p class="muted" style="margin-top:8px">Atos e políticas públicas do período no ministério correlato:</p>
    <ul>${atos || "<li class=\"muted\">Nenhum ato ministerial correlato no período.</li>"}</ul>
  `;
}

// ─── Prospecção das principais decisões (determinística; seam para IA) ────────

/**
 * Ponto único de plug da IA. Hoje retorna a projeção determinística.
 * TODO IA Claude: quando ANTHROPIC_API_KEY/cliente estiver disponível, gerar a projeção
 * via Claude a partir do mesmo input e retornar { ...resultado, fonte: "ia" }.
 */
function generateProspeccao(input: {
  associado: Associado;
  deliberacoes: Deliberacao[];
  mandatos: Mandato[];
  listaTriplice: ListaTripliceItem[];
  noticias: MonitoramentoItem[];
  periodo_fim: string;
}): Prospeccao {
  return projectFutureDecisions(input);
}

function projectFutureDecisions(input: {
  associado: Associado;
  deliberacoes: Deliberacao[];
  mandatos: Mandato[];
  listaTriplice: ListaTripliceItem[];
  noticias: MonitoramentoItem[];
  periodo_fim: string;
}): Prospeccao {
  const delibs = input.deliberacoes;
  const total = delibs.length;
  const deferidos = delibs.filter((d) => d.resultado === "Deferido" || d.resultado === "Aprovado").length;
  const restritivos = delibs.filter((d) => d.resultado === "Indeferido" || d.resultado === "Retirado de Pauta").length;
  const tendencia = deferidos >= restritivos
    ? "tende ao deferimento quando há aderência documental"
    : "tende a maior cautela e a exigências adicionais";

  const freq = new Map<string, number>();
  for (const d of delibs) {
    if (d.microtema) freq.set(d.microtema, (freq.get(d.microtema) ?? 0) + 1);
  }
  const topMicrotemas = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  const itens: ProspeccaoItem[] = topMicrotemas.map(([microtema, count]) => ({
    tema: microtema,
    probabilidade: count >= 3 ? "alta" : count === 2 ? "média" : "baixa",
    racional: `${count} decisão(ões) sobre "${microtema}" no período; pauta recorrente que ${tendencia}.`,
    horizonte: "próximas reuniões deliberativas",
  }));

  // Sinal de mudança no colegiado: mandatos expirando + lista tríplice em andamento.
  const fim = new Date(input.periodo_fim).getTime();
  const janela = 120 * 86_400_000;
  const expirando = input.mandatos.filter((m) => {
    if (!m.data_fim) return false;
    const t = new Date(m.data_fim).getTime();
    return t >= fim && t - fim <= janela;
  });
  const listaAtiva = input.listaTriplice.filter((l) => !["nomeado", "arquivado"].includes(String(l.etapa)));
  if (expirando.length || listaAtiva.length) {
    itens.push({
      tema: "Composição do colegiado",
      probabilidade: expirando.length ? "alta" : "média",
      racional: `${expirando.length} mandato(s) próximos do fim e ${listaAtiva.length} indicação(ões) de lista tríplice em andamento podem alterar o colegiado e o padrão de votos.`,
      horizonte: "próximos meses",
    });
  }

  const confianca = Math.min(0.9, Math.max(0.3, total * 0.07 + input.noticias.length * 0.03));
  const resumo = total
    ? `Com base em ${total} decisões e ${input.noticias.length} sinais de política pública, o cenário ${tendencia}.`
    : "Dados insuficientes no período para uma projeção robusta — priorizar a coleta antes de circular.";

  return {
    itens: itens.slice(0, 5),
    confianca: Math.round(confianca * 100) / 100,
    fonte: "deterministico",
    resumo,
  };
}

function renderProspeccao(prospeccao: Prospeccao) {
  const rows = prospeccao.itens.map((item) => `
    <tr><td>${escapeHtml(item.tema)}</td><td><span class="pill">${escapeHtml(item.probabilidade)}</span></td><td>${escapeHtml(item.racional)}</td><td class="muted">${escapeHtml(item.horizonte)}</td></tr>
  `).join("");
  const metodo = prospeccao.fonte === "ia" ? "projeção assistida por IA" : "projeção determinística (heurística sobre o histórico)";
  return `
    <p>${escapeHtml(prospeccao.resumo)}</p>
    <table><thead><tr><th>Tema</th><th>Probabilidade</th><th>Racional</th><th>Horizonte</th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="muted">Sem base suficiente para projetar decisões no período.</td></tr>`}</tbody></table>
    <p class="muted" style="margin-top:8px">Método: ${metodo}. Não é previsão determinística; revisar antes de circular.</p>
  `;
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
