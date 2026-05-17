/**
 * GET /api/v1/deliberacoes
 * Lista deliberações com filtros, paginação e full-text search.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeDelibList } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";

const VALID_SORT_COLUMNS = new Set([
  "data_reuniao",
  "numero_deliberacao",
  "microtema",
  "area_regulatoria",
  "resultado",
  "interessado",
  "tipo_documento",
  "relator",
  "created_at",
]);


export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  if (isDemo() || isDemoRequest(req)) {
    const page = parseInt(searchParams.get("page") ?? "1", 10);
    const limit = parseInt(searchParams.get("limit") ?? "20", 10);
    const agencia_id = searchParams.get("agencia_id") ?? undefined;
    const microtema = searchParams.get("microtema") ?? undefined;
    const resultado = searchParams.get("resultado") ?? undefined;
    const search = searchParams.get("search") ?? undefined;
    const year = searchParams.get("year") ?? undefined;

    if (isLocalMode()) {
      return NextResponse.json(computeDelibList(getSyncedDelibs(), { page, limit, agencia_id, microtema, resultado, search, year }));
    }

    return NextResponse.json(
      demoData.deliberacoes({
        page,
        limit,
        agencia_id,
        microtema,
        resultado,
        search,
        year,
      })
    );
  }

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
  const offset = (page - 1) * limit;

  const sortBy = searchParams.get("sort_by") ?? "data_reuniao";
  const sortOrder = searchParams.get("sort_order") === "asc";

  if (!VALID_SORT_COLUMNS.has(sortBy)) {
    return NextResponse.json({ error: "Coluna de ordenação inválida" }, { status: 400 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  let query = db
    .from("deliberacoes")
    .select(
      `id, numero_deliberacao, reuniao_ordinaria, data_reuniao,
       interessado, processo, microtema, area_regulatoria, resultado, pauta_interna,
       extraction_confidence, agencia_id, created_at,
       tipo_documento, relator, item_numero, documento_pai_id, assunto,
       upload_job_id, raw_extraction,
       agencias (sigla, nome),
       votos (id, tipo_voto, is_divergente, diretor_id,
         diretores (nome))`,
      { count: "exact" }
    );

  // Validação de formatos para evitar injeção via query params
  const UUID_RE     = /^[0-9a-f-]{32,36}$/i;
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const YEAR_RE     = /^(19|20)\d{2}$/;

  const agenciaId = searchParams.get("agencia_id");
  if (agenciaId) {
    if (!UUID_RE.test(agenciaId)) {
      return NextResponse.json({ error: "agencia_id inválido" }, { status: 400 });
    }
    query = query.eq("agencia_id", agenciaId);
  }

  // Filtro de tipo de documento (ata, deliberacao, etc.)
  const tipoDoc = searchParams.get("tipo_documento");
  if (tipoDoc) query = query.eq("tipo_documento", tipoDoc);

  // Excluir ata-parents por padrão (evita double-counting)
  const includeParents = searchParams.get("include_parents") === "1";
  if (!includeParents) {
    // Ata-parents: tipo_documento="ata" AND documento_pai_id IS NULL AND item_numero IS NULL
    // Mantém items de ata (documento_pai_id preenchido) e deliberações normais
    query = query.or("tipo_documento.neq.ata,documento_pai_id.not.is.null");
  }

  const year = searchParams.get("year");
  if (year) {
    if (!YEAR_RE.test(year)) {
      return NextResponse.json({ error: "year deve ser um ano válido (ex: 2024)" }, { status: 400 });
    }
    query = query
      .gte("data_reuniao", `${year}-01-01`)
      .lte("data_reuniao", `${year}-12-31`);
  }

  const dateFrom = searchParams.get("date_from");
  const dateTo   = searchParams.get("date_to");
  if (dateFrom) {
    if (!ISO_DATE_RE.test(dateFrom)) {
      return NextResponse.json({ error: "date_from deve ser YYYY-MM-DD" }, { status: 400 });
    }
    query = query.gte("data_reuniao", dateFrom);
  }
  if (dateTo) {
    if (!ISO_DATE_RE.test(dateTo)) {
      return NextResponse.json({ error: "date_to deve ser YYYY-MM-DD" }, { status: 400 });
    }
    query = query.lte("data_reuniao", dateTo);
  }

  const microtema = searchParams.get("microtema");
  if (microtema) query = query.eq("microtema", microtema);

  const areaRegulatoria = searchParams.get("area_regulatoria");
  if (areaRegulatoria) query = query.eq("area_regulatoria", areaRegulatoria);

  const statusRevisao = searchParams.get("status_revisao");
  if (statusRevisao === "sem_anexo") query = query.is("upload_job_id", null);
  if (statusRevisao === "sem_resultado") query = query.is("resultado", null);

  const resultado = searchParams.get("resultado");
  if (resultado) query = query.eq("resultado", resultado);

  const pautaInterna = searchParams.get("pauta_interna");
  if (pautaInterna !== null) query = query.eq("pauta_interna", pautaInterna === "true");

  const search = searchParams.get("search");
  if (search && search.trim().length >= 2) {
    // Escapa wildcards do ILIKE para evitar wildcard injection
    const escaped = search.trim().replace(/[\\%_]/g, "\\$&");
    query = query.ilike("raw_text", `%${escaped}%`);
  }

  query = query
    .order(sortBy, { ascending: sortOrder })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    console.error("[deliberacoes] Erro:", error);
    return NextResponse.json({ error: "Erro ao buscar deliberações" }, { status: 500 });
  }

  const formatted = (data ?? []).map((d: any) => ({
    ...d,
    agencia: d.agencias ?? null,
    agencias: undefined,
    votos: (d.votos ?? []).map((v: any) => ({
      id: v.id,
      tipo_voto: v.tipo_voto,
      is_divergente: v.is_divergente,
      diretor_id: v.diretor_id,
      diretor_nome: v.diretores?.nome ?? null,
    })),
  }));

  return NextResponse.json({
    data: formatted,
    total: count ?? 0,
    page,
    limit,
    pages: Math.ceil((count ?? 0) / limit),
  });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    // Demo mode: client handles localStorage deletion
    return NextResponse.json({ deleted: 0, demo: true });
  }

  // Require explicit confirmation header — prevents accidental bulk deletes
  if (req.headers.get("x-confirm-delete") !== "yes") {
    return NextResponse.json(
      { error: "Envie o header x-confirm-delete: yes" },
      { status: 400 }
    );
  }

  const deleteAll = req.nextUrl.searchParams.get("all") === "1";

  if (deleteAll) {
    if (req.headers.get("x-confirm-scope") !== "all-test-data") {
      return NextResponse.json(
        { error: "Envie o header x-confirm-scope: all-test-data para exclusão global" },
        { status: 400 }
      );
    }

    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const db = createSupabaseServerClient();
    const { error, count } = await db
      .from("deliberacoes")
      .delete({ count: "exact" })
      .not("id", "is", null);

    if (error) {
      console.error("[deliberacoes DELETE all] Erro:", error);
      return NextResponse.json({ error: "Erro ao deletar deliberações" }, { status: 500 });
    }

    return NextResponse.json({ deleted: count ?? 0, scope: "all-test-data" });
  }

  // agencia_id obrigatório por padrão — evita delete global acidental
  const agencia_id = req.nextUrl.searchParams.get("agencia_id");
  if (!agencia_id) {
    return NextResponse.json(
      { error: "agencia_id é obrigatório no DELETE para evitar remoção global" },
      { status: 400 }
    );
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { error, count } = await db
    .from("deliberacoes")
    .delete()
    .eq("agencia_id", agencia_id);

  if (error) {
    console.error("[deliberacoes DELETE] Erro:", error);
    return NextResponse.json({ error: "Erro ao deletar deliberações" }, { status: 500 });
  }

  return NextResponse.json({ deleted: count ?? 0 });
}
