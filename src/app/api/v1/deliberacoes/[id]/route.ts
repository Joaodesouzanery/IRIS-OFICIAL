/**
 * GET /api/v1/deliberacoes/[id]    — detalhe
 * PATCH /api/v1/deliberacoes/[id]  — correção manual de campos
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeDelibById } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { RESULTADOS } from "@/lib/utils";
import { isAreaRegulatoria } from "@/lib/server/area-regulatoria";
import { repartirPorDivergencia } from "@/lib/server/vote-inference";

const ALLOWED_PATCH_FIELDS = new Set([
  "numero_deliberacao",
  "reuniao_ordinaria",
  "data_reuniao",
  "data_publicacao",
  "interessado",
  "assunto",
  "processo",
  "microtema",
  "area_regulatoria",
  "resultado",
  "pauta_interna",
  "resumo_pleito",
  "fundamento_decisao",
]);

const RE_ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RESULTADOS_SET = new Set<string>(RESULTADOS);
const TEXT_MAX: Record<string, number> = {
  numero_deliberacao: 50, reuniao_ordinaria: 100, interessado: 255, assunto: 500,
  processo: 100, microtema: 30, resumo_pleito: 2000, fundamento_decisao: 2000,
};

// Valida/sanitiza um campo do PATCH. Retorna { skip:true } para descartar valor inválido.
function sanitizePatchValue(key: string, value: unknown): { skip: boolean; value?: unknown } {
  if (value === null) return { skip: false, value: null };
  switch (key) {
    case "resultado":
      return typeof value === "string" && RESULTADOS_SET.has(value) ? { skip: false, value } : { skip: true };
    case "area_regulatoria":
      return isAreaRegulatoria(value) ? { skip: false, value } : { skip: true };
    case "data_reuniao":
    case "data_publicacao":
      return typeof value === "string" && RE_ISO_DATE.test(value) ? { skip: false, value } : { skip: true };
    case "pauta_interna":
      return { skip: false, value: Boolean(value) };
    default: {
      const max = TEXT_MAX[key];
      if (max && typeof value === "string") return { skip: false, value: value.trim().slice(0, max) };
      return { skip: true };
    }
  }
}


export async function GET(
  req: NextRequest,
  { params }: any
) {
  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      const found = computeDelibById(getSyncedDelibs(), params.id);
      if (!found) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });
      return NextResponse.json(found);
    }

    const delib = demoData.deliberacaoById(params.id);
    if (!delib) {
      return NextResponse.json({ error: "Deliberação não encontrada" }, { status: 404 });
    }
    return NextResponse.json(delib);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("deliberacoes")
    .select(
      `*, agencias (sigla, nome), votos (id, tipo_voto, is_divergente, is_nominal, diretor_id,
        diretores (nome))`
    )
    .eq("id", params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Deliberação não encontrada" }, { status: 404 });
  }

  // Payload enxuto + inspeção (QA ago/2026): tira o raw_text (até 50k chars que a UI
  // nunca renderizava) e expõe source_url/warnings/confiança no topo — é o que o card
  // "Como foi classificado" e o link para a fonte original usam no detalhe.
  const raw = (data.raw_extraction && typeof data.raw_extraction === "object"
    ? { ...(data.raw_extraction as Record<string, unknown>) }
    : null) as Record<string, unknown> | null;
  const rawText = raw && typeof raw.raw_text === "string" ? (raw.raw_text as string) : null;
  if (raw) delete raw.raw_text;

  const formatted = {
    ...data,
    raw_extraction: raw,
    source_url: typeof raw?.source_url === "string" ? raw.source_url : null,
    extraction_warnings: Array.isArray(raw?.warnings) ? raw!.warnings : [],
    texto_extraido_trecho: rawText ? rawText.slice(0, 4000) : null,
    agencia: data.agencias ?? null,
    agencias: undefined,
    votos: (data.votos ?? []).map((v: any) => ({
      id: v.id,
      tipo_voto: v.tipo_voto,
      is_divergente: v.is_divergente,
      is_nominal: v.is_nominal,
      diretor_id: v.diretor_id,
      diretor_nome: v.diretores?.nome ?? null,
    })),
  };

  return NextResponse.json(formatted);
}

export async function PATCH(
  req: NextRequest,
  { params }: any
) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json(
      { error: "Edição não disponível em modo demo" },
      { status: 403 }
    );
  }

  const body = await req.json();

  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_PATCH_FIELDS.has(key)) continue;
    const result = sanitizePatchValue(key, value);
    if (!result.skip) updates[key] = result.value;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nenhum campo válido para atualizar" }, { status: 400 });
  }

  updates.updated_at = new Date().toISOString();

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("deliberacoes")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Falha ao atualizar deliberação" }, { status: 500 });
  }

  // SEC-5: is_divergente é RELATIVO ao resultado (isDivergentVote). Se o resultado mudou na
  // correção manual, re-deriva os votos desta deliberação em lote — senão ficam stale até
  // alguém rodar recalcular-divergencia. Não toca tipo_voto/is_nominal.
  if ("resultado" in updates) {
    const novoResultado = (updates.resultado as string | null) ?? null;
    const { data: votos } = await db.from("votos").select("id, tipo_voto").eq("deliberacao_id", params.id);
    // Etapa65 — MESMO repartidor de `votos/recalcular-divergencia`. Antes esta porta chamava
    // `isDivergentVote(tipo, resultado)` com DOIS argumentos, omitindo `unanime`: uma edição manual
    // de resultado reintroduzia divergência falsa em item indeferido-por-unanimidade, e ela ficava
    // lá até o cron rodar. O mesmo recálculo dava respostas diferentes conforme a porta.
    const { data: delibUnan } = await db
      .from("deliberacoes")
      .select("unanimidade_detectada:raw_extraction->>unanimidade_detectada")
      .eq("id", params.id)
      .maybeSingle();
    const { idsDivergentes: idsDiv, idsNaoDivergentes: idsNaoDiv } = repartirPorDivergencia(
      (votos ?? []) as Array<{ id: string; tipo_voto: string }>,
      novoResultado,
      (delibUnan as { unanimidade_detectada?: unknown } | null)?.unanimidade_detectada,
    );
    const aplicar = async (ids: string[], valor: boolean) => {
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        if (chunk.length) await db.from("votos").update({ is_divergente: valor }).in("id", chunk);
      }
    };
    if (idsDiv.length) await aplicar(idsDiv, true);
    if (idsNaoDiv.length) await aplicar(idsNaoDiv, false);
  }

  return NextResponse.json(data);
}
