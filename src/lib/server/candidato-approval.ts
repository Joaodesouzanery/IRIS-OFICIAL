/**
 * Núcleo compartilhado de APROVAÇÃO de diretor_candidato (Etapa 11).
 * Usado pela rota individual (candidatos/[id]/aprovar) e pela rota em lote
 * (candidatos/aprovar-lote) — mesma lógica, sem duplicação: cria/atualiza o
 * diretor, registra mandato (se datas informadas), marca o candidato aprovado
 * e aplica os votos retroativos das deliberações onde o nome aparece.
 */

import { applyRetroactiveVotes } from "@/lib/server/retroactive-votes";

export interface CandidatoRow {
  id: string;
  agencia_id: string;
  nome_detectado: string;
  cargo_detectado?: string | null;
  diretor_id?: string | null;
  confidence?: number | null;
  source_url?: string | null;
  source_type?: string | null;
  source_hash?: string | null;
}

export interface AprovarCandidatoOpts {
  cargo?: string | null;
  diretorId?: string | null;
  dataInicio?: string | null; // ISO yyyy-mm-dd → cria mandato
  dataFim?: string | null;
  reviewedBy?: string | null;
}

export interface AprovarCandidatoResult {
  diretorId: string;
  mandatoId: string | null;
  votosRetroativos: unknown;
}

export async function aprovarCandidato(
  db: any,
  candidato: CandidatoRow,
  opts: AprovarCandidatoOpts = {},
): Promise<AprovarCandidatoResult> {
  const cargo = opts.cargo && opts.cargo.trim()
    ? opts.cargo.trim().slice(0, 120)
    : candidato.cargo_detectado ?? null;

  let diretorId = opts.diretorId ?? candidato.diretor_id ?? null;
  if (!diretorId) {
    const { data: diretor, error: diretorErr } = await db
      .from("diretores")
      .insert({
        agencia_id: candidato.agencia_id,
        nome: candidato.nome_detectado,
        cargo,
        needs_review: false,
        review_status: "aprovado",
        source_url: candidato.source_url,
        source_type: candidato.source_type,
        source_hash: candidato.source_hash,
        source_confidence: candidato.confidence,
        lgpd_basis: "public_official_function",
        last_verified_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (diretorErr || !diretor) throw new Error("Erro ao criar diretor");
    diretorId = diretor.id as string;
  } else {
    await db
      .from("diretores")
      .update({
        needs_review: false,
        review_status: "aprovado",
        cargo,
        source_url: candidato.source_url,
        source_type: candidato.source_type,
        source_hash: candidato.source_hash,
        source_confidence: candidato.confidence,
        last_verified_at: new Date().toISOString(),
      })
      .eq("id", diretorId);
  }

  let mandatoId: string | null = null;
  if (opts.dataInicio) {
    const { data: mandato } = await db
      .from("mandatos")
      .insert({
        diretor_id: diretorId,
        data_inicio: opts.dataInicio,
        data_fim: opts.dataFim ?? null,
        cargo,
        review_status: "aprovado",
        source_url: candidato.source_url,
        source_type: candidato.source_type,
        source_hash: candidato.source_hash,
        source_confidence: candidato.confidence,
        lgpd_basis: "public_official_function",
        last_verified_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    mandatoId = mandato?.id ?? null;
  }

  await db
    .from("diretor_candidatos")
    .update({
      diretor_id: diretorId,
      review_status: "aprovado",
      reviewed_at: new Date().toISOString(),
      reviewed_by: opts.reviewedBy ?? null,
    })
    .eq("id", candidato.id);

  // Votos retroativos das deliberações onde este nome aparece (idempotente).
  let votosRetroativos: unknown = null;
  try {
    votosRetroativos = await applyRetroactiveVotes(db, {
      candidato: { id: candidato.id, agencia_id: candidato.agencia_id, nome_detectado: candidato.nome_detectado },
      diretorId,
      reviewedBy: opts.reviewedBy ?? null,
    });
  } catch (e) {
    console.error("[candidato-approval] Falha ao criar votos retroativos:", e);
  }

  return { diretorId, mandatoId, votosRetroativos };
}
