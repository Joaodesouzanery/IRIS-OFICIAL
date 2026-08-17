/**
 * Núcleo compartilhado de APROVAÇÃO de diretor_candidato (Etapa 11).
 * Usado pela rota individual (candidatos/[id]/aprovar) e pela rota em lote
 * (candidatos/aprovar-lote) — mesma lógica, sem duplicação: cria/atualiza o
 * diretor, registra mandato (se datas informadas), marca o candidato aprovado
 * e aplica os votos retroativos das deliberações onde o nome aparece.
 */

import { applyRetroactiveVotes } from "@/lib/server/retroactive-votes";
import { findBestMatch } from "@/lib/server/name-matcher";

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
  let criouComSuspeita = false;
  if (!diretorId) {
    // PREVENÇÃO DE DUPLICATA: antes de criar, confere se o nome já casa com um
    // diretor da agência ("Alex Azevedo" ≥0.85 "Alex Antonio de Azevedo Cruz"
    // ⇒ REUSA o cadastro em vez de criar um segundo diretor). Faixa 0.6–0.85:
    // cria, mas marcado needs_review — a auditoria de duplicatas pega.
    const { data: existentes } = await db
      .from("diretores")
      .select("id, nome, nome_variantes")
      .eq("agencia_id", candidato.agencia_id);
    const lista = (existentes ?? []).map((dir: { id: string; nome: string; nome_variantes?: unknown }) => ({
      id: dir.id,
      nome: dir.nome,
      nome_variantes: Array.isArray(dir.nome_variantes) ? (dir.nome_variantes as string[]) : [],
    }));
    const match = findBestMatch(candidato.nome_detectado, lista);
    if (match.diretorId && !match.needsReview) {
      diretorId = match.diretorId;
    } else {
      criouComSuspeita = Boolean(match.diretorId); // houve match fraco (0.6–0.85)
    }
  }
  if (!diretorId) {
    const { data: diretor, error: diretorErr } = await db
      .from("diretores")
      .insert({
        agencia_id: candidato.agencia_id,
        nome: candidato.nome_detectado,
        cargo,
        needs_review: criouComSuspeita,
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
    // APRENDE a variante: o nome como o documento cita ("Alex Azevedo") entra em
    // nome_variantes do diretor ("Alex Antonio de Azevedo Cruz") → próximas citações
    // casam 1.0 direto (voto nominal automático, sem candidato).
    const { data: diretorAtual } = await db
      .from("diretores")
      .select("nome, nome_variantes")
      .eq("id", diretorId)
      .single();
    const variantes: string[] = Array.isArray(diretorAtual?.nome_variantes) ? diretorAtual.nome_variantes : [];
    const detectado = candidato.nome_detectado.trim();
    const novaVariante = detectado && detectado !== diretorAtual?.nome && !variantes.includes(detectado)
      ? [...variantes, detectado].slice(0, 12)
      : variantes;

    await db
      .from("diretores")
      .update({
        needs_review: false,
        review_status: "aprovado",
        cargo,
        nome_variantes: novaVariante,
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

  // CASCATA por nome: o mesmo nome detectado gera 1 cartão por documento (source_hash
  // por doc) — aprovar um resolve todos (os votos retroativos são por nome, idempotentes).
  // Também evita que aprovar uma duplicata "new_director" crie um segundo diretor.
  await db
    .from("diretor_candidatos")
    .update({
      diretor_id: diretorId,
      review_status: "aprovado",
      reviewed_at: new Date().toISOString(),
      reviewed_by: opts.reviewedBy ?? null,
    })
    .eq("agencia_id", candidato.agencia_id)
    .eq("nome_detectado", candidato.nome_detectado)
    .eq("review_status", "pendente");
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
  let votosRetroativos: Awaited<ReturnType<typeof applyRetroactiveVotes>> | null = null;
  try {
    votosRetroativos = await applyRetroactiveVotes(db, {
      candidato: { id: candidato.id, agencia_id: candidato.agencia_id, nome_detectado: candidato.nome_detectado },
      diretorId,
      reviewedBy: opts.reviewedBy ?? null,
    });
  } catch (e) {
    console.error("[candidato-approval] Falha ao criar votos retroativos:", e);
  }

  // MANDATO AUTOMÁTICO: se a aprovação não informou datas (caso do recompute) e o diretor
  // ficou SEM mandato, a inferência de voto por mandato fica DESLIGADA para ele
  // (getActiveDiretoresForVote → []). Cria um mandato a partir da data da 1ª deliberação
  // que ele votou — ou, sem voto ainda, da 1ª em que o NOME aparece (primeira_data dos
  // retroativos), quebrando o círculo "sem mandato → sem voto → sem mandato". QA Etapa 19/ago-2026.
  if (!mandatoId) {
    try {
      const { data: jaTem } = await db.from("mandatos").select("id").eq("diretor_id", diretorId).limit(1);
      if (!jaTem?.length) {
        const { data: votoRows } = await db
          .from("votos")
          .select("deliberacoes(data_reuniao)")
          .eq("diretor_id", diretorId)
          .limit(500);
        const datas = (votoRows ?? [])
          .map((r: any) => (Array.isArray(r.deliberacoes) ? r.deliberacoes[0]?.data_reuniao : r.deliberacoes?.data_reuniao))
          .filter((d: unknown): d is string => typeof d === "string" && d.length >= 10)
          .sort();
        if (!datas.length && votosRetroativos?.primeira_data) datas.push(votosRetroativos.primeira_data);
        if (datas.length) {
          const { data: mandatoAuto } = await db
            .from("mandatos")
            .insert({
              diretor_id: diretorId,
              data_inicio: datas[0],
              data_fim: null,
              cargo,
              review_status: "aprovado",
              source_type: candidato.source_type,
              source_confidence: candidato.confidence,
              lgpd_basis: "public_official_function",
              last_verified_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          mandatoId = mandatoAuto?.id ?? null;
        }
      }
    } catch (e) {
      console.error("[candidato-approval] Falha ao criar mandato automático:", e);
    }
  }

  return { diretorId, mandatoId, votosRetroativos };
}
