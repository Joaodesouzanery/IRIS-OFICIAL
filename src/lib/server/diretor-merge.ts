/**
 * Núcleo de MERGE de diretores duplicados (Etapa 19). Extraído de
 * /api/v1/diretores/merge para ser reusado pela auto-mesclagem do recompute.
 * Reaponta votos (respeitando a unique (deliberacao_id, diretor_id) — onde os dois
 * votaram, prevalece o keep), mandatos e candidatos; o keep aprende o nome do
 * duplicado como variante; e remove o duplicado. Irreversível.
 */

type Db = any;

export interface MergeResult {
  keep_id: string;
  merged_id: string;
  votos_reapontados: number;
  votos_descartados: number;
  variantes_aprendidas: string[];
}

export async function mergeDiretores(db: Db, keepId: string, mergeId: string): Promise<MergeResult> {
  if (!keepId || !mergeId || keepId === mergeId) {
    throw new Error("keep_id e merge_id devem ser distintos.");
  }

  const { data: diretores, error: diretoresErr } = await db
    .from("diretores")
    .select("id, nome, nome_variantes, agencia_id")
    .in("id", [keepId, mergeId]);
  if (diretoresErr || (diretores ?? []).length !== 2) {
    throw new Error("Diretores não encontrados.");
  }
  const keep = diretores!.find((d: any) => d.id === keepId)!;
  const merged = diretores!.find((d: any) => d.id === mergeId)!;
  if (keep.agencia_id !== merged.agencia_id) {
    throw new Error("Merge só é permitido dentro da mesma agência.");
  }

  // 1) Votos: onde SÓ o merge votou → reaponta; onde os DOIS votaram → apaga o do
  // merge (o do keep prevalece; a unique (deliberacao_id, diretor_id) impede update).
  const { data: votosKeep } = await db
    .from("votos").select("deliberacao_id").eq("diretor_id", keepId).limit(50000);
  const delibsComVotoDoKeep = new Set((votosKeep ?? []).map((v: any) => v.deliberacao_id));
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

  // 3) Keep APRENDE o nome do duplicado (e variantes) — futuras citações casam 1.0.
  const variantesKeep: string[] = Array.isArray(keep.nome_variantes) ? keep.nome_variantes : [];
  const variantesMerge: string[] = Array.isArray(merged.nome_variantes) ? merged.nome_variantes : [];
  const novas = [merged.nome, ...variantesMerge].filter(
    (n: string) => n && n !== keep.nome && !variantesKeep.includes(n),
  );
  if (novas.length > 0) {
    await db
      .from("diretores")
      .update({ nome_variantes: [...variantesKeep, ...novas].slice(0, 12) })
      .eq("id", keepId);
  }

  // 4) Remove o duplicado.
  const { error: deleteErr } = await db.from("diretores").delete().eq("id", mergeId);
  if (deleteErr) {
    throw new Error(`Votos/mandatos migrados, mas falhou ao remover o duplicado: ${deleteErr.message}`);
  }

  return {
    keep_id: keepId,
    merged_id: mergeId,
    votos_reapontados: votosReapontados,
    votos_descartados: votosDescartados,
    variantes_aprendidas: novas,
  };
}
