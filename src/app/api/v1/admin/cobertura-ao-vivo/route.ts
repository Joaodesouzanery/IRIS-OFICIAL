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
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { discoverAntt2026Meetings } from "@/lib/server/antt-2026-collector";
import { parseArtespReunioes } from "@/lib/server/monitoring";
import { resilientFetchText } from "@/lib/server/resilient-fetch";
import { looksLikeChallenge } from "@/lib/server/monitoring";
import { HOBBY_BUDGET_MS } from "@/lib/server/time-budget";
import { anmNumerosDoAno } from "@/lib/server/anm-cobertura";
import { lerTudo } from "@/lib/server/select-all-paged";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Fase 12 — 60 → 120: esta rota honra `budget_ms`/HOBBY_BUDGET_MS (70s); declarar 60 aqui
// pediria o kill da plataforma ANTES de o próprio orçamento parar o trabalho. 120 é o valor
// que pipeline/run e o vercel.json já declaram e que os builds já provaram.
export const maxDuration = 120;

const YEAR_RE = /^(20)\d{2}$/;
const ARTESP_URL = "https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria";
const ANM_URLS = [
  "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/atas-da-rop",
  "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/pautas-da-rop",
];

/**
 * Fase 28 — a ANM tem SEIS fontes monitoradas e esta conferência enumera DUAS. Fica de fora, entre
 * outras, o ARQUIVO de atas (`.../atas-da-rop/atas-reunioes-ordinarias`), que existe justamente
 * porque "tudo que sai do topo da listagem some da coleta para sempre" (migration 20260904130000).
 * A ANM é a única das três agências sem paginação e sem seguir arquivo: profundidade 1 por
 * construção. Pôr o arquivo no denominador AGORA seria generalizar sobre um layout que ninguém
 * mediu — sem fixture verbatim dessa página, se ela não tiver `<time>` todos os itens saem sem ano
 * e, pela regra vigente, entram em TODO ano: dezenas de reuniões pré-2022 virariam "faltando em
 * 2026", com alerta vermelho, na rota que é a prova. Trocaria subestimativa silenciosa por
 * superestimativa barulhenta. Até lá, o silêncio vira NÚMERO: a resposta diz o que foi consultado.
 */
const FONTES_DA_ANM_NAO_CONSULTADAS = 4;

/** Extrai os NÚMEROS de reunião distintos (1–4 dígitos) de uma lista de strings. */
function toNums(values: Array<string | null | undefined>): number[] {
  const set = new Set<number>();
  for (const v of values) {
    const m = String(v ?? "").match(/(\d{1,4})/);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (n > 0 && n < 10000) set.add(n);
    }
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
    return NextResponse.json({ modo: "demo", ano: 2026, por_agencia: [], alertas: [] });
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
  try {
    const disc = await discoverAntt2026Meetings({ maxMeetings: 200, maxPages: 20, deadlineAt });
    anttSite = toNums(disc.meetings.map((m) => m.numero));
    anttParcial = disc.truncated === true;
  } catch {
    anttErro = "falha ao enumerar a ANTT ao vivo";
  }

  // ARTESP: página única; filtra 2026 quando há data.
  const artespHtml = await fetchTextSafe(ARTESP_URL);
  const artespItems = parseArtespReunioes(artespHtml, ARTESP_URL).filter(
    (i) => !i.data_reuniao || (i.data_reuniao >= de && i.data_reuniao <= ate),
  );
  const artespSite = toNums(artespItems.map((i) => i.reuniao));
  const artespErro = erroDeBusca(artespHtml, "ARTESP");

  // ANM: PDFs estáticos das sub-páginas — nº vem do nome ("ata_85__reuniao", "ata-32-rep") ou
  // do heading ("85ª Reunião"), e o ANO vem da DATA adjacente ao link ("31/07/2026 09h37" —
  // verificado ao vivo). QA ago/2026: antes o parse global sem contexto inflava faltando/extra
  // com reuniões de anos antigos; agora filtra pelo ano (sem data próxima → mantém).
  const anmHtmls = await Promise.all(ANM_URLS.map(fetchTextSafe));
  const anmSite = anmNumerosDoAno(anmHtmls, Number(year));
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

  // A ANM é o caso em que a lacuna é conhecida e grande: avisar é mais honesto que somar zero.
  alertas.push(
    `ANM: esta conferência enumera ${ANM_URLS.length} das ${ANM_URLS.length + FONTES_DA_ANM_NAO_CONSULTADAS} fontes monitoradas — ` +
      "o arquivo de atas fica de fora, então \"faltando\" aqui é piso, não total.",
  );

  return NextResponse.json({
    modo: "real",
    ano: Number(year),
    gerado_em: new Date().toISOString(),
    por_agencia,
    fontes_consultadas,
    alertas,
  });
}
