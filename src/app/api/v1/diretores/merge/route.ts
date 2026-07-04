/**
 * POST /api/v1/diretores/merge  { keep_id, merge_id }
 * Funde dois cadastros do MESMO diretor (duplicata): reaponta votos (sem violar
 * a unique (deliberacao_id, diretor_id) — onde os dois votaram, prevalece o do
 * keep), mandatos e candidatos; aprende o nome do duplicado como variante; e
 * remove o cadastro duplicado. Admin explícito — ação irreversível.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;
  if (isDemo()) {
    return NextResponse.json({ error: "Indisponível em modo DEMO." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { keep_id?: string; merge_id?: string };
  const keepId = body.keep_id?.trim();
  const mergeId = body.merge_id?.trim();
  if (!keepId || !mergeId || keepId === mergeId) {
    return NextResponse.json({ error: "Informe keep_id e merge_id distintos." }, { status: 400 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: diretores, error: diretoresErr } = await db
    .from("diretores")
    .select("id, nome, nome_variantes, agencia_id")
    .in("id", [keepId, mergeId]);
  if (diretoresErr || (diretores ?? []).length !== 2) {
    return NextResponse.json({ error: "Diretores não encontrados." }, { status: 404 });
  }
  const keep = diretores!.find((d) => d.id === keepId)!;
  const merged = diretores!.find((d) => d.id === mergeId)!;
  if (keep.agencia_id !== merged.agencia_id) {
    return NextResponse.json({ error: "Merge só é permitido dentro da mesma agência." }, { status: 400 });
  }

  // 1) Votos: onde SÓ o merge votou → reaponta; onde os DOIS votaram → apaga o
  // do merge (o do keep prevalece; a unique (deliberacao_id, diretor_id) impede update direto).
  const { data: votosKeep } = await db
    .from("votos").select("deliberacao_id").eq("diretor_id", keepId).limit(50000);
  const delibsComVotoDoKeep = new Set((votosKeep ?? []).map((v) => v.deliberacao_id));
  const { data: votosMerge } = await db
    .from("votos").select("id, deliberacao_id").eq("diretor_id", mergeId).limit(50000);

  let votosReapontados = 0;
  let votosDescartados = 0;
  for (const voto of votosMerge ?? []) {
    if (delibsComVotoDoKeep.has(voto.deliberacao_id)) {
      await db.from("votos").delete().eq("id", voto.id);
      votosDescartados++;
    } else {
      const { error: updErr } = await db.from("votos").update({ diretor_id: keepId }).eq("id", voto.id);
      if (!updErr) votosReapontados++;
    }
  }

  // 2) Mandatos e candidatos seguem o keep.
  await db.from("mandatos").update({ diretor_id: keepId }).eq("diretor_id", mergeId);
  await db.from("diretor_candidatos").update({ diretor_id: keepId }).eq("diretor_id", mergeId);

  // 3) Keep APRENDE o nome do duplicado (e as variantes dele) — futuras citações
  // casam 1.0 direto.
  const variantesKeep: string[] = Array.isArray(keep.nome_variantes) ? keep.nome_variantes : [];
  const variantesMerge: string[] = Array.isArray(merged.nome_variantes) ? merged.nome_variantes : [];
  const novas = [merged.nome, ...variantesMerge].filter(
    (n) => n && n !== keep.nome && !variantesKeep.includes(n),
  );
  if (novas.length > 0) {
    await db
      .from("diretores")
      .update({ nome_variantes: [...variantesKeep, ...novas].slice(0, 12) })
      .eq("id", keepId);
  }

  // 4) Remove o duplicado (mandatos/candidatos já foram reapontados acima).
  const { error: deleteErr } = await db.from("diretores").delete().eq("id", mergeId);
  if (deleteErr) {
    return NextResponse.json(
      { error: `Votos/mandatos migrados, mas falhou ao remover o duplicado: ${deleteErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    keep_id: keepId,
    merged_id: mergeId,
    votos_reapontados: votosReapontados,
    votos_descartados: votosDescartados,
    variantes_aprendidas: novas,
  });
}
