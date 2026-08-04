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
import { HOBBY_BUDGET_MS } from "@/lib/server/time-budget";
import { anmNumerosDoAno } from "@/lib/server/anm-cobertura";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const YEAR_RE = /^(20)\d{2}$/;
const ARTESP_URL = "https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria";
const ANM_URLS = [
  "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/atas-da-rop",
  "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/pautas-da-rop",
];

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
  try {
    const disc = await discoverAntt2026Meetings({ maxMeetings: 200, maxPages: 20, deadlineAt });
    anttSite = toNums(disc.meetings.map((m) => m.numero));
  } catch {
    anttErro = "falha ao enumerar a ANTT ao vivo";
  }

  // ARTESP: página única; filtra 2026 quando há data.
  const artespHtml = await fetchTextSafe(ARTESP_URL);
  const artespItems = parseArtespReunioes(artespHtml, ARTESP_URL).filter(
    (i) => !i.data_reuniao || (i.data_reuniao >= de && i.data_reuniao <= ate),
  );
  const artespSite = toNums(artespItems.map((i) => i.reuniao));
  const artespErro = artespHtml ? null : "falha ao buscar a página ARTESP";

  // ANM: PDFs estáticos das sub-páginas — nº vem do nome ("ata_85__reuniao", "ata-32-rep") ou
  // do heading ("85ª Reunião"), e o ANO vem da DATA adjacente ao link ("31/07/2026 09h37" —
  // verificado ao vivo). QA ago/2026: antes o parse global sem contexto inflava faltando/extra
  // com reuniões de anos antigos; agora filtra pelo ano (sem data próxima → mantém).
  const anmHtmls = await Promise.all(ANM_URLS.map(fetchTextSafe));
  const anmSite = anmNumerosDoAno(anmHtmls, Number(year));
  const anmErro = anmHtmls.some((h) => h) ? null : "falha ao buscar as páginas ANM";

  // ─── Reuniões NO BANCO (deliberações do ano) por agência ──────────────────
  const { data: agencias } = await db.from("agencias").select("id, sigla").in("sigla", ["ANTT", "ARTESP", "ANM"]);
  const idBySigla = new Map((agencias ?? []).map((a) => [a.sigla as string, a.id as string]));
  const { data: delibs } = await db
    .from("deliberacoes")
    .select("agencia_id, numero_reuniao, data_reuniao")
    .limit(40000);
  const bancoNums = (sigla: string) =>
    toNums(
      (delibs ?? [])
        .filter(
          (d) =>
            d.agencia_id === idBySigla.get(sigla) &&
            (!d.data_reuniao || (d.data_reuniao >= de && d.data_reuniao <= ate)),
        )
        .map((d) => d.numero_reuniao as string | null),
    );

  const build = (sigla: string, site: number[], erro: string | null) => {
    const banco = bancoNums(sigla);
    const bancoSet = new Set(banco);
    const siteSet = new Set(site);
    return {
      sigla,
      erro,
      site_total: site.length,
      banco_total: banco.length,
      faltando: site.filter((n) => !bancoSet.has(n)), // no site e NÃO no banco → NÃO temos
      extra: banco.filter((n) => !siteSet.has(n)), // no banco e fora da listagem atual do site
      site,
      banco,
    };
  };

  const por_agencia = [
    build("ANTT", anttSite, anttErro),
    build("ARTESP", artespSite, artespErro),
    build("ANM", anmSite, anmErro),
  ];

  const alertas: string[] = [];
  for (const a of por_agencia) {
    if (a.erro) {
      alertas.push(`${a.sigla}: ${a.erro} — não deu para conferir agora (tente de novo).`);
    } else if (a.faltando.length > 0) {
      const amostra = a.faltando.slice(0, 15).join(", ");
      const resto = a.faltando.length > 15 ? "…" : "";
      alertas.push(
        `${a.sigla}: o site publica ${a.site_total} reuniões, temos ${a.banco_total} — faltam ${a.faltando.length} (nº ${amostra}${resto}).`,
      );
    }
  }

  return NextResponse.json({ modo: "real", ano: Number(year), gerado_em: new Date().toISOString(), por_agencia, alertas });
}
