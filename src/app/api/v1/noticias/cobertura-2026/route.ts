/**
 * GET /api/v1/noticias/cobertura-2026
 * Painel de cobertura do backfill de 2026 (prova auditável de completude para o prêmio):
 * por agência → varreu até 01/01 (reached_since), notícias de 2026 coletadas, data mais
 * antiga, itens sem data (sinalizados), cursor do backfill + contagem de documentos
 * (deliberações/monitoramento) de 2026. Admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

const SINCE = "2026-01-01";
const JAN_LIMIT = "2026-01-15"; // se a mais antiga for depois disso, provavelmente não chegou a janeiro

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const [{ data: sites }, { data: agencias }] = await Promise.all([
    db.from("monitoramento_sites").select("url, estrategia, metadata, agencia:agencias(sigla, id)").eq("tipo_fonte", "noticias").eq("ativo", true),
    db.from("agencias").select("id, sigla"),
  ]);

  const idBySigla = new Map<string, string>((agencias ?? []).map((a: any) => [a.sigla, a.id]));
  const backfillBySigla = new Map<string, any>();
  const backfillableBySigla = new Map<string, boolean>();
  for (const s of sites ?? []) {
    const ag = Array.isArray((s as any).agencia) ? (s as any).agencia[0] : (s as any).agencia;
    if (!ag?.sigla) continue;
    const meta = (s as any).metadata && typeof (s as any).metadata === "object" ? (s as any).metadata : {};
    backfillBySigla.set(ag.sigla, meta.backfill_2026 ?? null);
    const strategy = (s as any).estrategia === "artesp-news" || String((s as any).url).includes("artesp.sp.gov.br") ? "artesp" : "govbr";
    backfillableBySigla.set(ag.sigla, strategy === "govbr");
  }

  const siglas = [...backfillBySigla.keys()].sort();
  const linhas = await Promise.all(siglas.map(async (sigla) => {
    const agenciaId = idBySigla.get(sigla) ?? null;
    const bf = backfillBySigla.get(sigla);
    const backfillavel = backfillableBySigla.get(sigla) ?? false;

    const [{ count: noticias2026 }, oldestRes, { count: undated }, delibRes] = await Promise.all([
      db.from("regulatory_news").select("id", { count: "exact", head: true }).eq("agencia_sigla", sigla).gte("publicado_em", SINCE),
      db.from("regulatory_news").select("publicado_em").eq("agencia_sigla", sigla).gte("publicado_em", SINCE).order("publicado_em", { ascending: true }).limit(1),
      db.from("regulatory_news").select("id", { count: "exact", head: true }).eq("agencia_sigla", sigla).eq("metadata->>undated", "true"),
      agenciaId
        ? db.from("deliberacoes").select("id", { count: "exact", head: true }).eq("agencia_id", agenciaId).gte("data_reuniao", SINCE)
        : Promise.resolve({ count: 0 } as any),
    ]);

    const oldest = (oldestRes.data?.[0] as any)?.publicado_em ?? null;
    const reachedSince = Boolean(bf?.reached_since);
    const gap = backfillavel && (!reachedSince || (oldest && oldest > JAN_LIMIT));

    return {
      agencia_sigla: sigla,
      backfillavel,
      reached_since: reachedSince,
      noticias_2026: noticias2026 ?? 0,
      oldest_date: oldest,
      undated: undated ?? 0,
      cursor: bf?.cursor ?? 0,
      last_run_at: bf?.last_run_at ?? null,
      deliberacoes_2026: (delibRes as any).count ?? 0,
      gap,
    };
  }));

  const totalNoticias = linhas.reduce((s, l) => s + l.noticias_2026, 0);
  const backfillaveis = linhas.filter((l) => l.backfillavel);
  const completos = backfillaveis.filter((l) => l.reached_since && !l.gap).length;

  return NextResponse.json({
    since: SINCE,
    linhas,
    resumo: {
      agencias: linhas.length,
      backfillaveis: backfillaveis.length,
      completos, // varreram até janeiro sem lacuna
      pendentes: backfillaveis.length - completos,
      noticias_2026: totalNoticias,
      undated_total: linhas.reduce((s, l) => s + l.undated, 0),
    },
    legal_notice: "ARTESP e portais JS não têm arquivo paginado estático (não backfilláveis por varredura); use 'colar link' para itens específicos.",
  });
}
