/**
 * Resolve o `empresa_id` de uma deliberação a partir do `interessado` (razão social
 * em texto livre), reusando matching fuzzy canônico. Cria a empresa se não existir.
 * Usado na ingestão (upload/confirm) e no backfill.
 */

import { canonicalizeEmpresa, findBestEmpresaMatch, type EmpresaRecord } from "@/lib/server/name-matcher";

export type EmpresaCache = Map<string, EmpresaRecord[]>;

async function loadEmpresas(db: any, agenciaId: string, cache?: EmpresaCache): Promise<EmpresaRecord[]> {
  const cached = cache?.get(agenciaId);
  if (cached) return cached;
  const { data } = await db
    .from("empresas")
    .select("id, nome_normalizado, nome_variantes")
    .eq("agencia_id", agenciaId);
  const list: EmpresaRecord[] = (data ?? []).map((e: any) => ({
    id: e.id,
    nome_normalizado: e.nome_normalizado,
    nome_variantes: Array.isArray(e.nome_variantes) ? e.nome_variantes : [],
  }));
  cache?.set(agenciaId, list);
  return list;
}

export async function resolveEmpresaId(
  db: any,
  interessado: string | null | undefined,
  agenciaId: string | null,
  options: { cache?: EmpresaCache; setor?: string | null } = {},
): Promise<string | null> {
  if (!interessado || !interessado.trim() || !agenciaId) return null;
  const nomeNorm = canonicalizeEmpresa(interessado);
  if (!nomeNorm || nomeNorm.length < 3) return null;

  const empresas = await loadEmpresas(db, agenciaId, options.cache);
  const match = findBestEmpresaMatch(interessado, empresas);

  if (match.diretorId && !match.needsReview) {
    const emp = empresas.find((e) => e.id === match.diretorId);
    if (emp && !emp.nome_variantes.includes(interessado)) {
      emp.nome_variantes.push(interessado);
      await db.from("empresas").update({ nome_variantes: emp.nome_variantes }).eq("id", emp.id);
    }
    return match.diretorId;
  }

  const novo = {
    agencia_id: agenciaId,
    nome_normalizado: nomeNorm,
    nome_exibicao: interessado.slice(0, 300),
    nome_variantes: [interessado],
    setor: options.setor ?? null,
    fonte_dado: "automatico" as const,
    needs_review: match.score >= 0.6 && match.score < 0.85,
  };

  const { data: created, error } = await db.from("empresas").insert(novo).select("id").single();
  if (created?.id) {
    empresas.push({ id: created.id, nome_normalizado: nomeNorm, nome_variantes: [interessado] });
    return created.id;
  }
  // Corrida: outro insert criou a mesma (agencia, nome_normalizado) — busca o existente.
  if (error?.code === "23505") {
    const { data: existing } = await db
      .from("empresas")
      .select("id, nome_normalizado, nome_variantes")
      .eq("agencia_id", agenciaId)
      .eq("nome_normalizado", nomeNorm)
      .single();
    if (existing?.id) {
      empresas.push({ id: existing.id, nome_normalizado: existing.nome_normalizado, nome_variantes: existing.nome_variantes ?? [] });
      return existing.id;
    }
  }
  return null;
}
