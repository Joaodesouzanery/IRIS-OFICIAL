import crypto from "crypto";
import type { MonitoramentoTipoItem } from "@/types";
import { fetchAntt2026MonitoringItems } from "@/lib/server/antt-2026-collector";
import { resilientFetchText } from "@/lib/server/resilient-fetch";
import { tryRenderHtmlFallback } from "@/lib/server/headless";
import { budgetRetries, hasBudget } from "@/lib/server/time-budget";

// Teto de páginas seguidas por site na paginação ANM/ARTESP. O fim real é
// detectado quando uma página não traz nenhum item novo; este teto só limita o
// custo caso o portal tenha "próxima" cíclica.
const MAX_MONITORING_PAGES = 12;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface MonitoringSiteInput {
  id: string;
  agencia_id: string | null;
  nome: string;
  url: string;
  estrategia?: string | null;
  seletor_links?: string | null;
}

export interface DiscoveredMonitoringItem {
  tipo: MonitoramentoTipoItem;
  titulo: string;
  url_item: string;
  reuniao: string | null;
  data_reuniao: string | null;
  hash_item: string;
  metadata: Record<string, unknown>;
}

export interface MonitoringFetchResult {
  contentHash: string;
  needsHeadless: boolean;
  items: DiscoveredMonitoringItem[];
  // Orçamento de tempo esgotou no meio: itens coletados até ali são válidos,
  // o restante fica para a próxima rodada (retomada barata via dedup/skip-set).
  truncated?: boolean;
  skippedKnown?: number;
  /**
   * O portal respondeu 200 com uma PÁGINA DE DESAFIO (WAF) em vez do conteúdo — e nem o headless
   * resolveu. Sem isto, "zero itens" de um bloqueio era indistinguível de "zero novidades", e a
   * run ia para o banco como `ok`.
   */
  bloqueado?: boolean;
}

const DOC_LABEL_RE =
  /\b(reuniao|reunioes|pauta|ata|atas|voto|votos|votacao|sessao|colegiad[ao]|deliberacao|deliberacoes|diretoria|diretores?|mandato|nomeacao|exoneracao|composicao)\b/i;
const PDF_RE = /\.pdf(?:$|[/?#])|\/@@download\/file(?:$|[/?#])/i;
// PDFs de SEÇÕES GENÉRICAS do gov.br (manuais/guias/sistemas do rodapé/sidebar) que NÃO são
// documento de reunião. Sem isto a ANM (Volto) "coletava" só manuais (manual-de-vistas-anm.pdf,
// sistema-de-dados-minerarios…pdf) como documento_apoio → 0 deliberação, e o headless nunca
// disparava (só dispara com items.length===0). As atas reais ficam (têm "ata"/"reuniao"). QA jul/2026.
const GENERIC_DOC_PATH_RE =
  /\/(?:manuais?|guias?|cartilhas?|tutoriais?|modelos?|formul[aá]rios?|instruc\w*|sistemas?[^"'/]*|sdm)[^"'/]*\.pdf|\/(?:assuntos|acesso-a-\w+|canais[_-]atendimento|requerimentos?|servicos)\/[^"']*\.pdf/i;
const DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const REUNIAO_RE = /(\d{1,4})\s*(?:a|o|ª|º)?\s*reuniao[^<\n\r]*/i;

export async function fetchMonitoringSite(
  site: MonitoringSiteInput,
  options: { maxPages?: number; maxMeetings?: number; deadlineAt?: number; skipMeetingUrls?: Set<string> } = {},
): Promise<MonitoringFetchResult> {
  const { deadlineAt } = options;
  if (site.estrategia === "antt-2026") {
    const { items, truncated, skippedKnown } = await fetchAntt2026MonitoringItems(options);
    return {
      contentHash: sha256(JSON.stringify(items.map((item) => item.hash_item).sort())),
      needsHeadless: false,
      items,
      truncated,
      skippedKnown,
    };
  }

  // Respeita a estrategia explicita: fontes "html-static" (ex.: ANM/ARTESP de
  // reunioes colegiadas) usam o parser de documentos mesmo estando em gov.br.
  // Sem isso, a pagina de reunioes da ANM caía no parser de NOTICIAS (filtra
  // apenas links /noticias/) e nao encontrava pautas/atas/votos.
  const isArtesp = isArtespReunioesUrl(site.url);
  const isDocStatic = site.estrategia === "html-static";
  const parseFor = (pageHtml: string, pageUrl: string): DiscoveredMonitoringItem[] =>
    isArtesp
      ? parseArtespReunioes(pageHtml, pageUrl) // parser dedicado: DAM URLs + estrutura por reunião
      : isDocStatic
        ? parseMonitoringHtml(pageHtml, pageUrl, site.seletor_links)
        : site.estrategia === "govbr-news" || /gov\.br\//i.test(site.url)
          ? parseGovBrNewsHtml(pageHtml, pageUrl, site.seletor_links)
          : parseMonitoringHtml(pageHtml, pageUrl, site.seletor_links);

  // Paginação: segue "próxima"/rel=next até o teto, parando quando uma página
  // não traz item novo. Antes só a 1ª página era lida (perdia 2+ de ANM/ARTESP).
  const maxPages = Math.max(1, Math.min(options.maxPages ?? MAX_MONITORING_PAGES, 30));
  const visited = new Set<string>();
  const collected = new Map<string, DiscoveredMonitoringItem>();
  let pageUrl: string | null = site.url;
  let firstHtml = "";
  let usedHeadless = false;
  let pageCount = 0;
  let truncated = false;

  while (pageUrl && pageCount < maxPages && !visited.has(pageUrl)) {
    // Página nova só com saldo (fetch 12s + retries): parada graciosa preserva
    // o coletado; sem isso o SIGKILL do Vercel descarta a rodada inteira.
    if (pageCount > 0 && !hasBudget(deadlineAt, 15_000)) {
      truncated = true;
      break;
    }
    visited.add(pageUrl);
    pageCount += 1;

    let html: string;
    try {
      // UA de navegador + retry/backoff/throttle (reduz 403/429 de portais como ARTESP).
      html = await resilientFetchText(pageUrl, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
        retries: budgetRetries(deadlineAt, 12_000),
      });
    } catch (err) {
      if (pageCount === 1) throw err; // 1ª página falhou → erro real do site (sobe para o runner)
      break; // páginas seguintes: encerra a paginação sem descartar o já coletado
    }

    let items = parseFor(html, pageUrl);

    // O gov.br serve intermitentemente uma página DEGRADADA (HTTP 200 mas "magra",
    // 0 itens) ao IP de datacenter — mesmo sintoma tratado nas notícias (Etapa 9).
    // Uma 2ª tentativa após pausa costuma trazer a página completa; só então o
    // fallback headless (que renderizaria a mesma página magra) faz sentido.
    if (items.length === 0 && pageCount === 1 && hasBudget(deadlineAt, 20_000)) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        const retried = await resilientFetchText(pageUrl, {
          headers: {
            "User-Agent": BROWSER_UA,
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
          },
          retries: budgetRetries(deadlineAt, 12_000),
        });
        const retriedItems = parseFor(retried, pageUrl);
        if (retriedItems.length > 0) {
          html = retried;
          items = retriedItems;
        }
      } catch {
        // mantém o fluxo original (headless/erro) se o retry falhar
      }
    }

    // Fallback headless quando o estático não rende NENHUM doc (ARTESP/ANM atrás
    // de iframe/JS). Só para html-static (evita acionar render nas fontes de
    // notícia) e só adota o resultado se ele realmente trouxer itens.
    // Reserva 35s (launch do chromium + navegação 25s): sem saldo, pula — o
    // rodízio por ultimo_check garante que a fonte abre a próxima rodada.
    // Fase 9 — um DESAFIO de WAF força a tentativa headless mesmo fora do gate de `isDocStatic`:
    // um Chromium de verdade costuma resolver o JS do Imperva, e é a única chance de a coleta
    // acontecer. Sem isto, a ARTESP dependeria de `items.length === 0 && isDocStatic`, que é
    // verdadeiro por acaso — qualquer fonte não-estática atrás de WAF ficaria de fora.
    const pareceDesafio = pageCount === 1 && looksLikeChallenge(html);
    if (items.length === 0 && pageCount === 1 && (isDocStatic || pareceDesafio) && hasBudget(deadlineAt, 35_000)) {
      const rendered = await tryRenderHtmlFallback(pageUrl, site.nome);
      if (rendered) {
        const headlessItems = parseFor(rendered, pageUrl);
        if (headlessItems.length > 0) {
          usedHeadless = true;
          html = rendered;
          items = headlessItems;
        }
      }
    }

    if (pageCount === 1) firstHtml = html;

    let added = 0;
    for (const item of items) {
      if (!collected.has(item.hash_item)) {
        collected.set(item.hash_item, item);
        added += 1;
      }
    }
    // Fim da lista: página seguinte sem novidade encerra a paginação.
    if (pageCount > 1 && added === 0) break;

    // ARTESP: página ÚNICA — VERIFICADO ao vivo 22/07/2026 (QA robusto): HTML estático de ~188KB
    // lista TODAS as reuniões recentes numa página só (1146→1204, 258 links DAM, 43 menções a 2026,
    // sem paginador). Não há "próxima" dentro de 2026 → não pagina (o alerta de buraco de numeração
    // do completude-2026 é a rede de segurança se algo escapar).
    const next: string | null = isArtesp ? null : findNextMonitoringPageUrl(html, pageUrl);
    pageUrl = next && !visited.has(next) ? next : null;
  }

  const items = [...collected.values()];
  const hasAnchors = /<a\b/i.test(firstHtml);
  // ⚠️ `hasAnchors` é o que fazia o detector de headless falhar aqui: a página do Imperva tem
  // EXATAMENTE uma âncora, e uma única âncora derrota a heurística inteira. Por isso o bloqueio
  // é detectado pelo conteúdo, não pela ausência de links.
  const bloqueado = items.length === 0 && looksLikeChallenge(firstHtml);

  return {
    contentHash: sha256(firstHtml),
    needsHeadless:
      items.length === 0 && !usedHeadless &&
      (!hasAnchors || /javascript is disabled|requires javascript|__next|webpackJsonp/i.test(firstHtml)),
    items,
    truncated,
    ...(bloqueado ? { bloqueado: true } : {}),
  };
}

/**
 * Acha o link da PRÓXIMA página de listagem (paginação ANM Plone / ARTESP Liferay).
 * Prioriza rel="next"; senão, âncora cujo texto seja "próxima/seguinte/next/»/›".
 * Só segue links no MESMO host (evita sair do portal) e diferentes da URL atual.
 */
export function findNextMonitoringPageUrl(html: string, baseUrl: string): string | null {
  let baseHost: string;
  try {
    baseHost = new URL(baseUrl).host;
  } catch {
    return null;
  }
  const anchors = extractAnchors(html, baseUrl);
  const relNext = anchors.find((a) => /\brel\s*=\s*["'][^"']*\bnext\b/i.test(a.attrs));
  const NEXT_TEXT = /^(proxim[oa]|seguinte|next|»|›|>>?)$/;
  const textNext = anchors.find((a) => {
    const t = normalizeText(a.text);
    return NEXT_TEXT.test(t) || /\b(proxim[oa]|seguinte)\b/.test(t);
  });

  for (const candidate of [relNext, textNext]) {
    if (!candidate) continue;
    try {
      const u = new URL(candidate.href, baseUrl);
      if (u.host === baseHost && u.toString() !== baseUrl) return u.toString();
    } catch {
      // ignora href inválido
    }
  }
  return null;
}

export function parseMonitoringHtml(
  html: string,
  baseUrl: string,
  linkSelector?: string | null,
): DiscoveredMonitoringItem[] {
  const anchors = applyLinkSelector(extractAnchors(html, baseUrl), linkSelector, baseUrl)
    .filter((a) => {
      const combined = normalizeText(`${a.text} ${decodeURIComponentSafe(a.href)}`);
      // Descarta PDF de seção genérica (manual/guia/sistema/assuntos…) SEM rótulo de reunião —
      // senão o rodapé do gov.br entra como documento e mascara a ausência das atas reais.
      if (PDF_RE.test(a.href) && GENERIC_DOC_PATH_RE.test(a.href) && !DOC_LABEL_RE.test(combined)) return false;
      return DOC_LABEL_RE.test(combined) || PDF_RE.test(a.href) || /\/view(?:$|[/?#])|sei|deliber|pauta|ata|voto|reunio|colegiad|sessao/.test(combined);
    });

  const seen = new Set<string>();
  const items: DiscoveredMonitoringItem[] = [];

  for (const anchor of anchors) {
    const context = contextAround(html, anchor.index, 900);
    const normalizedContext = normalizeText(context);
    const tipo = classifyLinkType(anchor.text, anchor.href);
    const reuniao = extractReuniao(normalizedContext);
    const data_reuniao = extractIsoDate(normalizedContext);
    const titleParts = [anchor.text];
    if (reuniao) titleParts.push(reuniao);
    if (data_reuniao) titleParts.push(formatPtDate(data_reuniao));

    const hash_item = sha256(`${tipo}|${anchor.href}|${reuniao ?? ""}|${data_reuniao ?? ""}`);
    if (seen.has(hash_item)) continue;
    seen.add(hash_item);

    items.push({
      tipo,
      titulo: cleanText(titleParts.join(" - ")).slice(0, 500),
      url_item: anchor.href,
      reuniao,
      data_reuniao,
      hash_item,
      metadata: {
        link_text: anchor.text,
        source: baseUrl,
      },
    });
  }

  return items;
}

// URLs de documento da ARTESP (WebSphere Portal): o PDF é servido pelo DAM do
// CMS-SP, sem extensão .pdf. Ex.: .../dx/api/dam/v1/collections/.../renditions/...?binary=true
/**
 * A resposta é uma PÁGINA DE DESAFIO (WAF), e não a página pedida? — Fase 9.
 *
 * ═══ Por que isto precisa existir ═══
 * O portal da ARTESP está atrás do Imperva. Ele responde **HTTP 200** com uma página de ~6 KB que
 * não é a listagem de reuniões — e, como qualquer 2xx é sucesso para o `resilientFetch`, o coletor
 * seguia adiante, encontrava zero itens e a run era gravada como **`ok`**. Uma agência inteira
 * parou de ser coletada e o painel dizia que estava tudo bem.
 *
 * A heurística de `needs_headless` também não pega: ela exige `!hasAnchors`, e a página do Imperva
 * tem exatamente UMA âncora. **Uma única âncora derrota o detector inteiro.**
 *
 * ═══ O que é medido, não suposto ═══
 * Capturado ao vivo em 26/08/2026 (a fixture `fixtures/artesp/imperva-desafio.html` é a resposta
 * literal): 6.183 bytes, `<title>Pardon Our Interruption</title>`, `_Incapsula_Resource`,
 * `robots: noindex, nofollow`, 1 âncora, zero cabeçalhos de reunião.
 */
export function looksLikeChallenge(html: string): boolean {
  if (!html) return false;
  // Marcadores de produto — os dois primeiros foram VERIFICADOS na resposta real da ARTESP.
  if (/Pardon Our Interruption/i.test(html)) return true;
  if (/Request unsuccessful\.?\s*Incapsula incident ID|Attention Required!\s*\|\s*Cloudflare/i.test(html)) return true;
  if (/\bcf-browser-verification\b|\bchallenge-platform\b/i.test(html)) return true;
  // ═══ Fase 17 — o marcador de SENSOR não é marcador de DESAFIO ════════════
  // MEDIDO em 04/09/2026 contra o portal ao vivo: a listagem de reuniões da ARTESP responde 200
  // com 196 KB de conteúdo real (129× "Deliberação", 264 itens extraídos pelo nosso parser,
  // incluindo a 1210ª Reunião de 02/09/2026) — e mesmo assim carrega
  //   <script src="/_Incapsula_Resource?SWJIYLWA=…">
  // O `_Incapsula_Resource` é o script SENSOR do Imperva: roda em TODA página do portal,
  // bloqueada ou não. Tratá-lo como prova de bloqueio dava `true` para a página inteira — e
  // sustentou por três fases o diagnóstico "a ARTESP está bloqueada". O que a coleta prova é
  // `items.length === 0`; a CAUSA vinha de um marcador que sempre casa.
  // (A fixture antiga da listagem tinha 1,6 KB recortados à mão e não continha o sensor, então o
  // falso positivo nunca apareceu em teste.)
  //
  // Agora o sensor só conta COM corroboração: página sem conteúdo de listagem.
  const semConteudo = !/<(?:li|article|table|h2|h3)\b/i.test(html);
  if (/_Incapsula_Resource|\bIncapsula\b/i.test(html) && semConteudo) return true;

  // Genérico: corpo minúsculo, marcado como não-indexável e sem NENHUM conteúdo de listagem.
  // Página institucional legítima não é as três coisas ao mesmo tempo.
  const minuscula = html.length < 15_000;
  const naoIndexavel = /noindex/i.test(html);
  return minuscula && naoIndexavel && semConteudo;
}

export function isArtespReunioesUrl(url: string): boolean {
  return /(^|\.)artesp\.sp\.gov\.br/i.test(url) && /reuni(?:o|õ|õe|oe)es-diretoria/i.test(url);
}

function classifyArtespDocLabel(label: string): MonitoramentoTipoItem | null {
  const v = normalizeText(label);
  if (/\bdeliberac/.test(v)) return "deliberacao";
  if (/\bata\b/.test(v)) return "ata";
  if (/\bvoto/.test(v)) return "voto";
  if (/\bpauta/.test(v)) return "pauta";
  return null;
}

/**
 * Parser DEDICADO da página de reuniões da ARTESP. A estrutura é regular:
 *   <p><b>Reunião Ordinária</b></p>
 *   <p><strong>1201ª Reunião do Conselho Diretor</strong></p>
 *   <p>01/07/2026</p>
 *   <ul><li><a href="DAM...binary=true">Ata</a></li>...</ul>
 * Cada documento (link DAM) é associado à reunião imediatamente ANTERIOR. Isso
 * elimina o vazamento de contexto (títulos embaralhados) do parser genérico e
 * captura os PDFs que não têm extensão .pdf.
 */
export function parseArtespReunioes(html: string, baseUrl: string): DiscoveredMonitoringItem[] {
  // 1) Reuniões: heading "Nª Reunião [Ordinária|Extraordinária] do Conselho Diretor".
  //
  // ═══ Fase 9 — 22 de 45 cabeçalhos eram INVISÍVEIS ═══
  // O regex exigia "Reunião" IMEDIATAMENTE seguido de "do Conselho Diretor", e o texto real das
  // extraordinárias é `246ª Reunião Extraordinária​​&nbsp;do Conselho Diretor` — com o qualificador
  // no meio, DOIS zero-width spaces (U+200B) e um `&nbsp;` literal. Medido na página real: 45
  // cabeçalhos, 23 casavam. Como cada documento é associado ao cabeçalho casado mais próximo
  // ANTES dele, os 22 perdidos faziam **217 de 284 links (76%) herdarem número e data da reunião
  // errada** — e a ARTESP tem DUAS séries de numeração (ordinárias 1146-1209, extraordinárias
  // 204-246), então o erro não é de um item, é de série inteira.
  //
  // ⚠️ A NORMALIZAÇÃO PRECISA PRESERVAR O COMPRIMENTO. O casamento é feito sobre o HTML e as
  // âncoras são ligadas por ÍNDICE DE BYTE (`m.index <= am.index`, mais abaixo). Trocar `&nbsp;`
  // por um espaço encurtaria a string e deslocaria TODAS as associações — em silêncio, que é o
  // pior modo de falhar. Por isso cada substituição repõe a mesma contagem de caracteres.
  const scan = html
    .replace(/[\u200b\u200c\u200d\ufeff]/g, " ")          // 1 char → 1 char
    .replace(/&nbsp;/gi, "      ")                          // 6 chars → 6 chars
    .replace(/&#160;/gi, "      ")                          // 6 → 6
    .replace(/&#xa0;/gi, "      ");                         // 6 → 6
  if (scan.length !== html.length) {
    // Nunca deve acontecer; se acontecer, é melhor perder cabeçalho do que associar errado.
    return parseArtespReunioesSemNormalizar(html, baseUrl);
  }

  // `do Conselho Diretor` continua OBRIGATÓRIO: sem ele, as linhas de rótulo `<b>Reunião
  // Ordinária</b>` da própria página virariam cabeçalhos sem número.
  const HEAD_RE = /(\d{1,4})\s*[ªaº°]?\s*Reuni[ãa]o\s+(?:(Ordin|Extraordin)[áa]ria\s+)?d[oe]\s+Conselho\s+Diretor/gi;
  type Meeting = { index: number; numero: string; tipo: string | null; dataIso: string | null };
  const meetings: Meeting[] = [];
  let hm: RegExpExecArray | null;
  while ((hm = HEAD_RE.exec(scan)) !== null) {
    // O tipo agora sai do PRÓPRIO cabeçalho quando ele o declara. A janela de 260 chars anteriores
    // continua como último recurso — ela lia um `<p>` que podia estar centenas de bytes antes, e
    // na página real "Extraordinária" vem DEPOIS do número, dentro do heading.
    const doGrupo = hm[2] ? (/^extraordin/i.test(hm[2]) ? "Extraordinaria" : "Ordinaria") : null;
    const before = stripTags(scan.slice(Math.max(0, hm.index - 260), hm.index));
    const tipo = doGrupo ?? (/extraordin/i.test(before) ? "Extraordinaria" : /ordin[aá]ria/i.test(before) ? "Ordinaria" : null);
    const after = stripTags(scan.slice(hm.index, hm.index + 400));
    const dm = DATE_RE.exec(after);
    meetings.push({
      index: hm.index,
      numero: hm[1],
      tipo,
      dataIso: dm ? extractIsoDate(after) : null,
    });
  }

  // 2) Documentos: cada <a href=DAM> associado à reunião mais próxima antes dele.
  const A_RE = /<a\b[^>]*href=["']([^"']*admin\.cms\.sp\.gov\.br\/dx\/api\/dam\/[^"']*binary=true)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const items: DiscoveredMonitoringItem[] = [];
  const seen = new Set<string>();
  let am: RegExpExecArray | null;
  let descartadosSemRotulo = 0;
  while ((am = A_RE.exec(html)) !== null) {
    const label = cleanText(stripTags(am[2]));
    const tipoDoc = classifyArtespDocLabel(label);
    if (!tipoDoc) {
      // Fase 9 — 25 âncoras DAM da página real têm por conteúdo apenas `&nbsp;`, então o rótulo
      // sai vazio e o item some. Sumir em silêncio é o que fazia "25 documentos invisíveis" ser
      // uma descoberta em vez de um número na tela.
      if (!label) descartadosSemRotulo++;
      continue;
    }

    let meeting: Meeting | null = null;
    for (const m of meetings) {
      if (m.index <= am.index) meeting = m;
      else break;
    }
    if (!meeting) continue;

    let url: string;
    try {
      url = new URL(decodeHtml(am[1]), baseUrl).toString();
    } catch {
      continue;
    }

    const hash_item = sha256(`artesp|${tipoDoc}|${url}`);
    if (seen.has(hash_item)) continue;
    seen.add(hash_item);

    const dataPt = meeting.dataIso ? formatPtDate(meeting.dataIso) : "";
    const reuniao = `${meeting.numero}ª Reunião do Conselho Diretor`;
    items.push({
      tipo: tipoDoc,
      titulo: cleanText(`${reuniao} — ${label}${dataPt ? ` (${dataPt})` : ""}`).slice(0, 300),
      url_item: url,
      reuniao,
      data_reuniao: meeting.dataIso,
      hash_item,
      metadata: {
        connector: "artesp-reunioes",
        meeting_type: meeting.tipo,
        doc_label: label,
        source: baseUrl,
      },
    });
  }

  if (descartadosSemRotulo > 0) {
    console.warn(`[artesp] ${descartadosSemRotulo} âncora(s) DAM sem rótulo legível — documentos não capturados.`);
  }
  return items;
}

/**
 * Caminho de segurança: se a normalização mudar o comprimento (nunca deveria), casar sobre o HTML
 * cru é pior em cobertura mas SEGURO em associação — perder um cabeçalho é melhor do que ligar
 * cada documento à reunião errada.
 */
function parseArtespReunioesSemNormalizar(html: string, baseUrl: string): DiscoveredMonitoringItem[] {
  return parseArtespReunioes(html.replace(/&nbsp;/gi, " ").replace(/[\u200b\u200c\u200d\ufeff]/g, ""), baseUrl);
}

export function parseGovBrNewsHtml(
  html: string,
  baseUrl: string,
  linkSelector?: string | null,
): DiscoveredMonitoringItem[] {
  const anchors = applyLinkSelector(extractAnchors(html, baseUrl), linkSelector, baseUrl)
    .filter((a) => /\/noticias\//i.test(a.href) || /\/assuntos\/noticias\//i.test(a.href))
    .filter((a) => normalizeText(a.text).length >= 18);

  const seen = new Set<string>();
  const items: DiscoveredMonitoringItem[] = [];

  for (const anchor of anchors) {
    const context = contextAround(html, anchor.index, 700);
    const data_reuniao = extractIsoDate(context);
    const categoria = extractGovBrCategory(context);
    const resumo = extractGovBrSummary(context, anchor.text);
    const tipo = classifyGovBrType(`${anchor.text} ${context}`);
    const hash_item = sha256(`${tipo}|${anchor.href}|${data_reuniao ?? ""}|${anchor.text}`);
    if (seen.has(hash_item)) continue;
    seen.add(hash_item);

    items.push({
      tipo,
      titulo: cleanText(anchor.text).slice(0, 500),
      url_item: anchor.href,
      reuniao: categoria,
      data_reuniao,
      hash_item,
      metadata: {
        link_text: anchor.text,
        source: baseUrl,
        categoria,
        resumo,
        connector: "govbr-news",
      },
    });
  }

  return items;
}

interface ExtractedAnchor {
  href: string;
  text: string;
  index: number;
  attrs: string;
}

function extractAnchors(html: string, baseUrl: string): ExtractedAnchor[] {
  const anchors: ExtractedAnchor[] = [];
  const re = /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    const hrefRaw = decodeHtml(match[2]);
    const text = cleanText(stripTags(match[4])) || inferLinkText(hrefRaw);
    if (!text) continue;
    try {
      anchors.push({
        href: new URL(hrefRaw, baseUrl).toString(),
        text,
        index: match.index,
        attrs: `${match[1]} ${match[3]}`,
      });
    } catch {
      // Ignore malformed links from government CMS fragments.
    }
  }

  return anchors;
}

// Seletor de links configurável via banco (monitoramento_sites.seletor_links).
// Suporta formas restritas: ".classe", "[atributo]", "tag.classe". Quando vazio,
// "a[href]" ou não-parseável, mantém todos os anchors. Se o seletor zerar a lista
// (provável regressão de config), faz fallback para a lista completa e loga.
function applyLinkSelector(
  anchors: ExtractedAnchor[],
  selector: string | null | undefined,
  baseUrl: string,
): ExtractedAnchor[] {
  const sel = selector?.trim();
  if (!sel || sel === "a[href]" || sel === "a") return anchors;

  const filtered = anchors.filter((a) => matchesLinkSelector(a, sel));
  if (filtered.length === 0 && anchors.length > 0) {
    console.warn(`[monitoring] seletor "${sel}" não casou nenhum link em ${baseUrl}; usando todos os links`);
    return anchors;
  }
  return filtered;
}

function matchesLinkSelector(anchor: { attrs: string; href: string }, selector: string): boolean {
  const attrs = anchor.attrs;

  // Fase 13 — sufixo `[attr$="valor"]` (ex.: a[href$=".pdf"]) AVALIADO PRIMEIRO e com retorno
  // próprio. Duas armadilhas já mordidas nesta própria implementação:
  //  · o ".pdf" entre aspas casa o matcher de CLASSE (`\.pdf` → exigiria class="pdf"), zerava a
  //    lista e o FALLBACK devolvia TODOS os links — o seletor "funcionava" deixando tudo passar;
  //  · `attrs` NÃO contém o href (extractAnchors o extrai à parte) — para `href$=` o valor certo
  //    é `anchor.href`, já normalizado como URL absoluta.
  // A ANM precisava disto para separar conteúdo (ata-87-rop.pdf, sem classe) das ~760 âncoras do
  // MENU do gov.br — foi por `a[href]` pegar tudo que manual de sistema virou "deliberação".
  const suffixMatch = selector.match(/\[([\w-]+)\$="([^"]+)"\]/);
  if (suffixMatch) {
    const [, attr, sufixo] = suffixMatch;
    const valor = attr.toLowerCase() === "href"
      ? anchor.href
      : (attrs.match(new RegExp(`${attr}=["']([^"']*)["']`, "i"))?.[1] ?? "");
    // Compara contra a URL SEM query/fragment (href real pode ter ?t=123).
    return valor.split(/[?#]/)[0].toLowerCase().endsWith(sufixo.toLowerCase());
  }

  // Fase 13 — negação `:not(.classe)`: a assinatura da ANM é NEGATIVA (âncora de conteúdo não
  // tem classe; TODA âncora de menu do gov.br tem class="state-published"). E `.pdf` como sufixo
  // perderia conteúdo real: 2 das 8 atas apontam para PÁGINA (o ramo HTML→PDF do enfileiramento
  // resolve), não para o arquivo.
  const notMatch = selector.match(/:not\(\.([\w-]+)\)/);
  if (notMatch) {
    const cls = notMatch[1];
    const classAttr = attrs.match(/class=["']([^"']*)["']/i)?.[1] ?? "";
    if (new RegExp(`(^|\\s)${cls}(\\s|$)`).test(classAttr)) return false;
    return true;
  }

  const classMatch = selector.match(/\.([\w-]+)/);
  if (classMatch) {
    const cls = classMatch[1];
    const classAttr = attrs.match(/class=["']([^"']*)["']/i)?.[1] ?? "";
    if (!new RegExp(`(^|\\s)${cls}(\\s|$)`).test(classAttr)) return false;
  }
  const attrMatch = selector.match(/\[([\w-]+)/);
  if (attrMatch) {
    const attr = attrMatch[1];
    if (!new RegExp(`(^|\\s)${attr}(=|\\s|$)`, "i").test(attrs)) return false;
  }
  return true;
}

function inferLinkText(href: string) {
  const decoded = decodeURIComponentSafe(href);
  const lower = normalizeText(decoded);
  if (lower.includes("pauta")) return "Pauta";
  if (/\bata\b/.test(lower)) return "Ata";
  if (lower.includes("deliber")) return "Deliberacoes";
  if (lower.includes("reunio")) return "Reuniao";
  if (lower.includes(".pdf")) return decoded.split("/").pop() ?? "PDF";
  return "";
}

function contextAround(html: string, index: number, radius: number) {
  return cleanText(stripTags(html.slice(Math.max(0, index - radius), index + radius)));
}

/**
 * Exportada na Fase 7 para que o teste LOCALIZE a regressao em vez de so sinaliza-la: este
 * classificador decide, sozinho, se um documento entra ou nao na esteira de votos — e por meses
 * ele decidiu errado para uma agencia inteira sem que nenhum teste o tocasse.
 */
export function classifyLinkType(text: string, href: string): MonitoramentoTipoItem {
  const value = normalizeText(`${text} ${href}`);
  // Governanca primeiro: nomeacao/exoneracao e mandato sao atos sobre PESSOAS, nao decisoes
  // colegiadas — alimentam Mandatos/Governanca e nunca a esteira de votos.
  if (/\b(nomea|exonera)/.test(value)) return "ato_nomeacao";
  if (/\bmandato/.test(value)) return "mandato";

  // ─── Fase 7: DECISAO antes de DIRETORIA — a trava que matou a ANM ───────────
  // O teste de `diretoria|diretores?|composi` vinha ANTES destes e vencia sempre, porque `value`
  // inclui a URL ABSOLUTA e as quatro fontes da ANM vivem sob
  // `/pt-br/composicao/diretoria-colegiada/...` — casando DUAS vezes (`composi` e `diretoria`)
  // em TODO link daquelas paginas, qualquer que fosse o texto. Como `diretoria` esta fora das
  // duas portas de enfileiramento (DECISION_TIPOS e a allowlist do auto-enqueue), toda ata da ANM
  // parava em status 'novo' para sempre: 0 reunioes, 0 deliberacoes, 0 votos, e 326 itens
  // "detectados" que nunca sairiam dali. O comentario abaixo ja prometia esta ordem desde sempre;
  // era o codigo que discordava dele.
  // Decisoes tem prioridade sobre pautas: voto > ata > deliberacao > pauta.
  // Uma pauta e a agenda do que sera discutido; voto/ata sao a decisao em si.
  if (/\bvoto\b|\bvotos\b/.test(value)) return "voto";
  if (/\bata\b|\batas\b/.test(value)) return "ata";
  if (value.includes("delibera")) return "deliberacao";
  if (value.includes("pauta")) return "pauta";
  if (value.includes("reuniao")) return "reuniao";

  // `diretoria` e o que sobra: pagina INSTITUCIONAL do colegiado ("Composicao da Diretoria",
  // "Quem e quem", bio de diretor). Continua fora da esteira de propósito — admiti-la ali encheria
  // a fila de paginas que nunca foram documento de decisao.
  if (/\b(diretoria|diretores?|composi)/.test(value)) return "diretoria";
  return "documento";
}

// Prioridade de processamento/exibicao: decisoes antes de agendas.
export function tipoPrioridade(tipo: string): number {
  switch (tipo) {
    case "voto": return 5;
    case "ata": return 4;
    case "deliberacao": return 3;
    case "pauta": return 2;
    case "documento": return 1;
    default: return 0;
  }
}

function classifyGovBrType(value: string): MonitoramentoTipoItem {
  const text = normalizeText(value);
  if (/consulta publica|audiencia publica|tomada de subsidios/.test(text)) return "consulta_publica";
  if (/politica|programa|plano|diretriz|portaria|resolucao|decreto|marco regulatorio/.test(text)) {
    return "politica_publica";
  }
  return "noticia";
}

function extractReuniao(text: string): string | null {
  const match = REUNIAO_RE.exec(text);
  return match ? cleanText(match[0]).slice(0, 180) : null;
}

function extractIsoDate(text: string): string | null {
  const match = DATE_RE.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1990 || year > 2099) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractGovBrCategory(text: string): string | null {
  const cleaned = cleanText(text);
  const parts = cleaned.split(/\s{2,}|##|Publicado|publicado|\d{2}\/\d{2}\/\d{4}/i)
    .map((p) => cleanText(p))
    .filter(Boolean);
  const category = parts.find((p) => p.length >= 3 && p.length <= 60 && p === p.toUpperCase());
  return category ?? null;
}

function extractGovBrSummary(context: string, title: string): string | null {
  const cleaned = cleanText(context).replace(cleanText(title), " ");
  const sentences = cleaned.split(/(?<=[.!?])\s+/).map((s) => cleanText(s)).filter((s) => s.length > 40);
  return sentences[0]?.slice(0, 500) ?? null;
}

function formatPtDate(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function stripTags(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ccedil;/g, "c")
    .replace(/&atilde;/g, "a")
    .replace(/&otilde;/g, "o")
    .replace(/&aacute;/g, "a")
    .replace(/&eacute;/g, "e")
    .replace(/&iacute;/g, "i")
    .replace(/&oacute;/g, "o")
    .replace(/&uacute;/g, "u");
}

function decodeURIComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanText(value: string) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function normalizeText(value: string) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
