/**
 * GET /api/v1/admin/cobertura-ao-vivo?year=2026
 *
 * A ÚNICA conferência CONTRA o site: enumera AO VIVO as reuniões que cada agência
 * publica (ANTT via discovery, ARTESP via parseArtespReunioes, ANM via nome dos PDFs
 * estáticos) e compara com o que temos no banco POR NÚMERO DE REUNIÃO. Responde
 * "o site tem N, temos M, faltam: [83ª, 84ª]" — o completude-2026 só conta o banco.
 *
 * Read-only, admin (guard). Budget-safe (fetch leve; a discovery ANTT respeita o deadline).
 */

import { NextRequest, NextResponse } from "next/server";
import { ordinalDeTextoDeReuniao } from "@/lib/server/reunioes";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { discoverAntt2026Meetings } from "@/lib/server/antt-2026-collector";
import { parseArtespReunioes } from "@/lib/server/monitoring";
import { resilientFetchText } from "@/lib/server/resilient-fetch";
import { looksLikeChallenge } from "@/lib/server/monitoring";
import { HOBBY_BUDGET_MS } from "@/lib/server/time-budget";
import { lerTudo } from "@/lib/server/select-all-paged";
import {
  gravarReferencia, referenciaDaAnm, referenciaDaAntt, referenciaDaArtesp,
  type LinhaDeReferencia, type PaginaDaAnm, type ResultadoDaGravacao, type TentativaDeFonte,
} from "@/lib/server/referencia-site";
import { pertencaAoAno } from "@/lib/server/livro-razao";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Fase 12 — 60 → 120: esta rota honra `budget_ms`/HOBBY_BUDGET_MS (70s); declarar 60 aqui
// pediria o kill da plataforma ANTES de o próprio orçamento parar o trabalho. 120 é o valor
// que pipeline/run e o vercel.json já declaram e que os builds já provaram.
export const maxDuration = 120;

const YEAR_RE = /^(20)\d{2}$/;
const ARTESP_URL = "https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria";
const ANM_BASE = "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada";
/**
 * ═══ Fase 38 — as fontes da ANM, MEDIDAS ao vivo em 04/10 ═══
 * Das seis fontes monitoradas, três têm reuniões e três não acrescentam nada:
 *   · `atas-da-rop`  — atas recentes da ROP **e da REP** (REP 31–34, ROP 85–88);
 *   · `pautas-da-rop` — pautas recentes das duas séries (é por ela que se sabe da reunião cuja ata
 *     ainda não saiu);
 *   · `atas-da-rop/atas-reunioes-ordinarias` — o ARQUIVO, ROP 59–88. É o que sai do topo da
 *     listagem e sumia da conferência para sempre;
 *   · a raiz `reunioes-da-diretoria-colegiada` não lista reunião nenhuma, e `/atas` e `/pautas`
 *     repetem as páginas da ROP.
 *
 * ⚠️ A Fase 28 recusou o arquivo porque, sem ano confiável, ele poria dezenas de reuniões antigas
 * em 2026. O motivo se confirmou pior do que se pensava: o ano da página é o da PUBLICAÇÃO (a 79ª ROP,
 * de 26/11/2025, aparece com 2026). A saída não é o ano da página — é a ÂNCORA da série
 * (`pertencaAoAno`): a numeração é monotônica e a 81ª ROP é a primeira de 2026.
 */
const ANM_PAGINAS: Array<Omit<PaginaDaAnm, "html">> = [
  { url: `${ANM_BASE}/atas-da-rop`, documento: "ata" },
  { url: `${ANM_BASE}/pautas-da-rop`, documento: "pauta" },
  { url: `${ANM_BASE}/atas-da-rop/atas-reunioes-ordinarias`, documento: "ata", serie_padrao: "ordinaria" },
];
const ANM_URLS = ANM_PAGINAS.map((p) => p.url);

/** As três fontes da ANM que, medidas, não listam reunião nova (raiz, `/atas`, `/pautas`). */
const FONTES_DA_ANM_NAO_CONSULTADAS = 3;
const ANTT_FONTE = "discovery: www.gov.br/antt — reuniões de 2026";

/**
 * Os NÚMEROS de reunião distintos de uma lista de strings.
 *
 * ⚠️ A regex própria daqui era `/(\d{1,4})/`, que PARA NO PONTO: `"1.028"` virava **1**. Como
 * `toNums` é aplicada dos DOIS lados — ao que o site publica e ao que o banco tem — a 1.028ª, a
 * 1.029ª e a 1.030ª colapsavam no número 1, três reuniões viravam uma, e o `faltando: 0` da ANTT
 * casava por coincidência. Esta rota é a que o operador usa como PROVA de que nada se perdeu.
 *
 * Agora usa `ordinalDeTextoDeReuniao`, a fonte única — o projeto já tinha o parser certo
 * (`numeroReuniaoOrdinal`) e três lugares o reimplementaram errado.
 */
function toNums(values: Array<string | null | undefined>): number[] {
  const set = new Set<number>();
  for (const v of values) {
    const n = ordinalDeTextoDeReuniao(v);
    if (n !== null && n > 0 && n < 10000) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

async function fetchTextSafe(url: string): Promise<string> {
  try {
    return await resilientFetchText(url, { timeoutMs: 20_000, retries: 1 });
  } catch {
    return "";
  }
}

/**
 * Fase 17 — HTML de desafio (WAF) não é "página vazia".
 *
 * Sem isto, o portal bloqueado devolvia 200 com "Pardon Our Interruption", o parser achava zero
 * reuniões e a conferência imprimia "✓ Cobertura completa" — o instrumento afirmando exatamente
 * o que não sabe. O detector é o MESMO da coleta, por import.
 */
function erroDeBusca(html: string, nomeDaFonte: string): string | null {
  if (!html) return `falha ao buscar a página ${nomeDaFonte}`;
  if (looksLikeChallenge(html)) {
    return `o portal ${nomeDaFonte} respondeu com página de desafio (WAF) — não deu para conferir`;
  }
  return null;
}

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ modo: "demo", ano: 2026, por_agencia: [], referencia_gravada: {}, alertas: [] });
  }
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam && YEAR_RE.test(yearParam) ? yearParam : "2026";
  const de = `${year}-01-01`;
  const ate = `${year}-12-31`;
  const deadlineAt = Date.now() + HOBBY_BUDGET_MS;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // ─── Reuniões DO SITE (ao vivo) ───────────────────────────────────────────
  // ANTT: discovery já filtra 2026 e pagina o portal.
  let anttSite: number[] = [];
  let anttErro: string | null = null;
  // Fase 7 — o `truncated` era DESCARTADO aqui. Enumeração pela metade + banco pela metade dava
  // "✓ Cobertura completa": a prova de completude afirmava exatamente o que não sabia. Agora o
  // flag sobe até a tela, e uma enumeração parcial nunca pode ser lida como prova.
  let anttParcial = false;
  let anttLinhas: LinhaDeReferencia[] = [];
  try {
    const disc = await discoverAntt2026Meetings({ maxMeetings: 200, maxPages: 20, deadlineAt });
    anttSite = toNums(disc.meetings.map((m) => m.numero));
    anttLinhas = referenciaDaAntt(disc.meetings, ANTT_FONTE);
    anttParcial = disc.truncated === true;
  } catch {
    anttErro = "falha ao enumerar a ANTT ao vivo";
  }

  // ARTESP: página única; filtra 2026 quando há data.
  const artespHtml = await fetchTextSafe(ARTESP_URL);
  const artespTodos = parseArtespReunioes(artespHtml, ARTESP_URL);
  const artespItems = artespTodos.filter(
    (i) => !i.data_reuniao || (i.data_reuniao >= de && i.data_reuniao <= ate),
  );
  const artespSite = toNums(artespItems.map((i) => i.reuniao));
  const artespErro = erroDeBusca(artespHtml, "ARTESP");

  // ANM: as três páginas que listam reunião. O ano NÃO vem da página (é o da publicação) — vem da
  // âncora da série; a série vem do item ("Reunião Extraordinária") ou da página (o arquivo é ROP).
  const anmHtmls = await Promise.all(ANM_URLS.map(fetchTextSafe));
  const anmLinhas = referenciaDaAnm(ANM_PAGINAS.map((p, i) => ({ ...p, html: anmHtmls[i] })));
  const anmSite = toNums(
    anmLinhas
      .filter((l) => pertencaAoAno(l, Number(year)) !== "nao")
      .map((l) => String(l.numero)),
  );
  const anmErro = anmHtmls.some((h) => h && !looksLikeChallenge(h))
    ? null
    : erroDeBusca(anmHtmls.find((h) => h) ?? "", "ANM");

  // ─── Reuniões NO BANCO (deliberações do ano) por agência ──────────────────
  const { data: agencias } = await db.from("agencias").select("id, sigla").in("sigla", ["ANTT", "ARTESP", "ANM"]);
  const idBySigla = new Map((agencias ?? []).map((a) => [a.sigla as string, a.id as string]));
  // Fase 28 — era `.limit(40000)` SEM `order`, e `.limit(N)` grande não é paginação: o PostgREST
  // corta em ~1.000 e devolve sem aviso. Com ARTESP 467 + ANTT 308 + ANM 125 só em 2026, esta rota
  // — a que o operador usa como PROVA de que nada se perdeu — calculava `banco_total`, `faltando`
  // e `extra` sobre uma fatia arbitrária de mil linhas. O `.order("id")` não é higiene: `.range()`
  // sem `ORDER BY` pode repetir e pular linhas entre páginas.
  const delibsRes = await lerTudo<{ agencia_id: string; numero_reuniao: string | null; data_reuniao: string | null }>(
    () => db.from("deliberacoes").select("agencia_id, numero_reuniao, data_reuniao").order("id"),
    "cobertura-ao-vivo/delibs");
  const delibs = delibsRes.data;
  // ⚠️ `truncated` NÃO basta: no caminho de ERRO, `selectAllPaged` devolve
  // `{ rows, error, truncated: false }` — as linhas que já tinha, marcadas como leitura completa.
  // Olhar só `truncated` deixaria a bandeira `false` justamente quando a leitura falhou, que é o
  // caso que ela foi criada para cobrir.
  if (delibsRes.error) console.error("[cobertura-ao-vivo] leitura do banco falhou:", delibsRes.error);
  const leituraDoBancoParcial = delibsRes.truncated || Boolean(delibsRes.error);
  const bancoNums = (sigla: string) =>
    toNums(
      delibs
        .filter(
          (d) =>
            d.agencia_id === idBySigla.get(sigla) &&
            (!d.data_reuniao || (d.data_reuniao >= de && d.data_reuniao <= ate)),
        )
        .map((d) => d.numero_reuniao as string | null),
    );

  const build = (sigla: string, site: number[], erro: string | null, parcial = false) => {
    const banco = bancoNums(sigla);
    const bancoSet = new Set(banco);
    const siteSet = new Set(site);
    // ═══ Fase 17 — o silêncio que virava "✓ Cobertura completa" ═══════════════
    // `faltando` é `site.filter(...)`: com a listagem vazia ele é SEMPRE `[]`, e nenhum alerta
    // disparava. O instrumento existe para PROVAR cobertura, e ficava mais verde quanto menos
    // enxergava. Zero reuniões no site com deliberações no banco é falha de LEITURA, nunca prova.
    const erroFinal =
      erro ??
      (site.length === 0 && banco.length > 0
        ? `a listagem de ${sigla} não devolveu reunião nenhuma, mas o banco tem ${banco.length} — ` +
          "conferência inválida (fonte fora do ar, bloqueada ou com layout novo)"
        : null);
    return {
      sigla,
      erro: erroFinal,
      // `enumeracao_parcial`: a listagem do site foi cortada (paginação incompleta ou orçamento
      // esgotado). Com ela `true`, "faltando: 0" NÃO significa cobertura completa — significa
      // apenas que nada do PEDAÇO que conseguimos enumerar está ausente.
      enumeracao_parcial: parcial,
      /**
       * O gêmeo de `enumeracao_parcial`, para o lado do BANCO. A rota sempre soube dizer "não
       * consegui ler o site inteiro" e não sabia dizer "não li o banco inteiro" — e era justamente
       * o lado do banco que vinha truncado em silêncio. Com isto `true`, `faltando` pode acusar
       * ausência de coisa que temos.
       */
      leitura_do_banco_parcial: leituraDoBancoParcial,
      site_total: site.length,
      banco_total: banco.length,
      faltando: site.filter((n) => !bancoSet.has(n)), // no site e NÃO no banco → NÃO temos
      extra: banco.filter((n) => !siteSet.has(n)), // no banco e fora da listagem atual do site
      site,
      banco,
    };
  };

  /** O que esta conferência de fato enumerou. Sem isto, "faltando: 0" na ANM esconde 4 fontes. */
  const fontes_consultadas = {
    ANTT: ["discovery de reuniões de 2026"],
    ARTESP: [ARTESP_URL],
    ANM: ANM_URLS,
  };

  const por_agencia = [
    build("ANTT", anttSite, anttErro, anttParcial),
    // ARTESP e ANM são páginas únicas por desenho: ou a página veio inteira, ou virou `erro`.
    build("ARTESP", artespSite, artespErro),
    build("ANM", anmSite, anmErro),
  ];

  const alertas: string[] = [];
  for (const a of por_agencia) {
    if (a.erro) {
      alertas.push(`${a.sigla}: ${a.erro} — não deu para conferir agora (tente de novo).`);
    } else if (a.enumeracao_parcial) {
      alertas.push(
        `${a.sigla}: a enumeração do site ficou INCOMPLETA nesta conferência (${a.site_total} reuniões lidas) — ` +
          `este resultado não prova cobertura, só compara o pedaço que deu para ler.`,
      );
    }
    if (a.leitura_do_banco_parcial) {
      alertas.push(
        `${a.sigla}: a leitura do BANCO ficou incompleta nesta conferência — "faltam N" abaixo pode ` +
          "acusar ausência de reunião que na verdade temos.",
      );
    }
    if (!a.erro && !a.enumeracao_parcial && a.extra.length > 0) {
      // Divergência ao CONTRÁRIO: o banco tem reunião que a listagem atual não mostra. Era
      // calculado e morria no payload. Pode ser listagem que encolheu (o caso que interessa) ou
      // numeração que migrou — nos dois casos alguém precisa olhar.
      alertas.push(
        `${a.sigla}: temos ${a.extra.length} reunião(ões) que a listagem do site NÃO mostra hoje ` +
          `(nº ${a.extra.slice(0, 15).join(", ")}${a.extra.length > 15 ? "…" : ""}) — a fonte pode ter encolhido.`,
      );
    }
    if (!a.erro && !a.enumeracao_parcial && a.faltando.length > 0) {
      const amostra = a.faltando.slice(0, 15).join(", ");
      const resto = a.faltando.length > 15 ? "…" : "";
      alertas.push(
        `${a.sigla}: o site publica ${a.site_total} reuniões, temos ${a.banco_total} — faltam ${a.faltando.length} (nº ${amostra}${resto}).`,
      );
    }
  }

  alertas.push(
    `ANM: esta conferência enumera ${ANM_URLS.length} fontes (atas e pautas da ROP/REP e o arquivo de atas); as ` +
      `outras ${FONTES_DA_ANM_NAO_CONSULTADAS} monitoradas foram medidas e não listam reunião nova. O ano vem da ` +
      "âncora da série, não da página (que mostra o ano de PUBLICAÇÃO). ⚠️ Com o arquivo e a REP no denominador, " +
      "o \"faltando\" da ANM pode CRESCER antes de cair — é o denominador ficando honesto, não regressão.",
  );

  /**
   * ═══ Fase 38 — a referência GRAVADA (portão 1 do livro-razão) ═══
   * Cada fonte é gravada só quando a leitura dela foi boa; vazia ou bloqueada registra a tentativa e
   * o erro, e a referência anterior continua valendo com a data dela. Falha de gravação não derruba
   * a conferência: vira um campo da resposta, nomeado.
   */
  const referencia_gravada: Record<string, ResultadoDaGravacao> = {};
  const gravar = async (sigla: string, linhas: LinhaDeReferencia[], tentativas: TentativaDeFonte[]) => {
    const agenciaId = idBySigla.get(sigla);
    if (!agenciaId) { referencia_gravada[sigla] = { gravada: false, motivo: "agência não cadastrada" }; return; }
    referencia_gravada[sigla] = await gravarReferencia(db, { agenciaId, linhas, tentativas });
  };
  await gravar("ANTT", anttLinhas, [
    { fonte: ANTT_FONTE, erro: anttErro, parcial: anttParcial, itens: anttLinhas.length },
  ]);
  const artespLinhas = artespErro ? [] : referenciaDaArtesp(artespTodos, ARTESP_URL);
  await gravar("ARTESP", artespLinhas, [
    { fonte: ARTESP_URL, erro: artespErro, parcial: false, itens: artespLinhas.length },
  ]);
  await gravar("ANM", anmLinhas, ANM_PAGINAS.map((p, i) => ({
    fonte: p.url,
    erro: erroDeBusca(anmHtmls[i], `ANM (${p.url.split("/").pop()})`),
    parcial: false,
    itens: anmLinhas.filter((l) => l.fonte === p.url).length,
  })));
  for (const [sigla, r] of Object.entries(referencia_gravada)) {
    if (!r.gravada) alertas.push(`${sigla}: a referência do livro-razão NÃO foi gravada — ${r.motivo}.`);
  }

  return NextResponse.json({
    modo: "real",
    ano: Number(year),
    gerado_em: new Date().toISOString(),
    por_agencia,
    fontes_consultadas,
    referencia_gravada,
    alertas,
  });
}
