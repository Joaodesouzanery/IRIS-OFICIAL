/**
 * GET /api/v1/admin/auditoria/amostra?n=5&ano=2026&seed=<opcional>
 *
 * Por agência colegiada, `n` deliberações FINAIS do ano escolhidas ao acaso (reproduzível por
 * dia, ou pelo `seed`), com o link assinado do PDF e o que a extração gravou — relator,
 * resultado, data, número, votos (tipo e nominal/inferido). Para conferência humana contra o
 * original. Read-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { COLEGIADO_SIGLAS } from "@/lib/server/colegiado-sources";
import { isFinalDecisionRecord } from "@/lib/server/regulatory-documents";
import { lerTudo } from "@/lib/server/select-all-paged";
import { amostrar, seedDe } from "@/lib/server/amostra-auditoria";
import { isVotoNominal } from "@/lib/votos-nominal";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) return NextResponse.json({ ano: 2026, seed: "demo", agencias: [] });
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const n = Math.max(1, Math.min(20, Number(req.nextUrl.searchParams.get("n") ?? 5) || 5));
  const anoParam = req.nextUrl.searchParams.get("ano") ?? "2026";
  const ano = /^20\d{2}$/.test(anoParam) ? anoParam : "2026";
  const seedTexto = req.nextUrl.searchParams.get("seed") || new Date().toISOString().slice(0, 10);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: agRows } = await db.from("agencias").select("id, sigla");
  const agencias = ((agRows ?? []) as Array<{ id: string; sigla: string }>).filter((a) => COLEGIADO_SIGLAS.has(String(a.sigla)));

  const { data: delibs } = await lerTudo<Record<string, any>>(() => db
    .from("deliberacoes")
    .select("id, agencia_id, numero_deliberacao, tipo_documento, documento_pai_id, resultado, relator, data_reuniao, interessado, raw_extraction")
    .gte("data_reuniao", `${ano}-01-01`).lte("data_reuniao", `${ano}-12-31`)
    .order("id"), "amostra/deliberacoes");

  const finais = (delibs ?? []).filter((d) => isFinalDecisionRecord({
    tipo_documento: d.tipo_documento, documento_pai_id: d.documento_pai_id, resultado: d.resultado, raw_extraction: d.raw_extraction,
  }));

  const escolhidas: Array<Record<string, any>> = [];
  for (const a of agencias) {
    const daAgencia = finais.filter((d) => d.agencia_id === a.id);
    for (const d of amostrar(daAgencia, n, seedDe(`${seedTexto}|${a.sigla}`))) escolhidas.push({ ...d, sigla: a.sigla, universo: daAgencia.length });
  }
  const ids = escolhidas.map((d) => String(d.id));
  if (ids.length === 0) return NextResponse.json({ ano, seed: seedTexto, agencias: [] });

  // O PDF de origem: o documento ligado à deliberação (ou ao PAI, para item de ata).
  const paiOuEla = escolhidas.map((d) => String(d.documento_pai_id ?? d.id));
  const [{ data: docs }, { data: votos }] = await Promise.all([
    db.from("documentos_regulatorios").select("deliberacao_id, filename, storage_bucket, storage_path").in("deliberacao_id", [...new Set(paiOuEla)]),
    db.from("votos").select("deliberacao_id, tipo_voto, is_nominal, proveniencia, diretores (nome)").in("deliberacao_id", ids),
  ]);
  const docPorDelib = new Map<string, any>();
  for (const doc of (docs ?? []) as any[]) if (!docPorDelib.has(doc.deliberacao_id)) docPorDelib.set(doc.deliberacao_id, doc);
  const porBucket = new Map<string, string[]>();
  for (const doc of docPorDelib.values()) if (doc.storage_path) porBucket.set(doc.storage_bucket ?? "pdfs", [...(porBucket.get(doc.storage_bucket ?? "pdfs") ?? []), doc.storage_path]);
  const signed = new Map<string, string>();
  for (const [bucket, paths] of porBucket) {
    const { data: lista } = await db.storage.from(bucket).createSignedUrls(paths, 60 * 60);
    for (const s of lista ?? []) if (s?.path && s.signedUrl) signed.set(`${bucket}|${s.path}`, s.signedUrl);
  }

  const porAgencia = new Map<string, any[]>();
  for (const d of escolhidas) {
    const doc = docPorDelib.get(String(d.documento_pai_id ?? d.id));
    const votosDela = ((votos ?? []) as any[]).filter((v) => v.deliberacao_id === d.id).map((v) => ({
      diretor: v.diretores?.nome ?? "?", tipo: v.tipo_voto, origem: isVotoNominal(v) ? "lido" : "inferido",
    }));
    const item = {
      id: d.id, numero: d.numero_deliberacao, tipo: d.tipo_documento, data: d.data_reuniao,
      relator: d.relator ?? null, resultado: d.resultado ?? null, interessado: d.interessado ?? null,
      pdf: doc?.storage_path ? signed.get(`${doc.storage_bucket ?? "pdfs"}|${doc.storage_path}`) ?? null : null,
      arquivo: doc?.filename ?? null,
      votos: votosDela,
      universo: d.universo,
    };
    porAgencia.set(d.sigla, [...(porAgencia.get(d.sigla) ?? []), item]);
  }

  return NextResponse.json({
    ano, seed: seedTexto, n,
    agencias: [...porAgencia.entries()].map(([sigla, itens]) => ({ sigla, universo: itens[0]?.universo ?? 0, itens })),
    notice: "Amostra ao acaso, reproduzível pelo seed do dia. Confira cada linha contra o PDF: relator, resultado e votos.",
  });
}
