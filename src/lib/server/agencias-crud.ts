import { calcularMandato } from "@/lib/mandatos";

export function normalizeDiretorPayload(body: Record<string, unknown>, agenciaId?: string) {
  const dataPosse = normalizeDate(body.data_posse);
  const dataFim = normalizeDate(body.data_fim_mandato ?? body.data_fim);
  const mandato = calcularMandato(dataPosse, dataFim);

  return {
    ...(agenciaId ? { agencia_id: agenciaId } : {}),
    nome: normalizeRequired(body.nome, 200),
    cargo: normalizeOptional(body.cargo, 120),
    situacao: normalizeEnum(body.situacao, ["titular", "substituto", "interino", "inativo", "designado"], "titular"),
    ativo: normalizeEnum(body.situacao, ["inativo"], "") !== "inativo",
    data_posse: dataPosse,
    data_fim_mandato: dataFim,
    data_saida: normalizeDate(body.data_saida),
    ato_nomeacao: normalizeOptional(body.ato_nomeacao, 500),
    publicacao_dou: normalizeDate(body.publicacao_dou),
    foto_url: normalizeOptional(body.foto_url, 500),
    minibio: normalizeOptional(body.minibio, 2000),
    curriculo_url: normalizeOptional(body.curriculo_url, 500),
    email: normalizeOptional(body.email, 200),
    telefone: normalizeOptional(body.telefone, 80),
    percentual_mandato_concluido: mandato.percentualConcluido,
    fonte_dado: normalizeEnum(body.fonte_dado, ["automatico", "manual", "verificado"], "manual"),
    metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
    updated_at: new Date().toISOString(),
  };
}

export function normalizeListaTriplicePayload(body: Record<string, unknown>, agenciaId?: string) {
  const cargoVaga = normalizeRequired(body.cargo_vaga ?? body.cargo, 200);
  return {
    ...(agenciaId ? { agencia_id: agenciaId } : {}),
    cargo: cargoVaga,
    cargo_vaga: cargoVaga,
    nome_candidato: normalizeOptional(body.nome_candidato, 200) ?? "A definir",
    candidatos: Array.isArray(body.candidatos) ? body.candidatos : [],
    status: normalizeEnum(body.status, ["em_analise", "nomeado", "arquivado"], "em_analise"),
    etapa: normalizeEnum(body.etapa, ["mapeamento", "indicacao", "sabatinado", "aprovado", "nomeado", "arquivado"], "mapeamento"),
    data_publicacao: normalizeDate(body.data_publicacao),
    data_evento: normalizeDate(body.data_evento ?? body.data_publicacao),
    fonte: normalizeOptional(body.fonte, 500),
    observacoes: normalizeOptional(body.observacoes, 2000),
    fonte_url: normalizeOptional(body.fonte_url, 500),
    confidence: Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : 1,
    review_status: normalizeEnum(body.review_status, ["pendente", "aprovado", "rejeitado", "conflito"], "aprovado"),
    metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
    updated_at: new Date().toISOString(),
  };
}

export async function upsertCurrentMandato(db: any, diretorId: string, diretor: ReturnType<typeof normalizeDiretorPayload>) {
  if (!diretor.data_posse) return null;

  const payload = {
    diretor_id: diretorId,
    data_inicio: diretor.data_posse,
    data_fim: diretor.data_fim_mandato,
    cargo: diretor.cargo,
    ato_nomeacao: diretor.ato_nomeacao,
    publicacao_dou: diretor.publicacao_dou,
    fonte_dado: diretor.fonte_dado,
    percentual_mandato_concluido: diretor.percentual_mandato_concluido,
    metadata: diretor.metadata,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await db
    .from("mandatos")
    .select("id")
    .eq("diretor_id", diretorId)
    .eq("data_inicio", diretor.data_posse)
    .maybeSingle();

  if (existing?.id) {
    const { data } = await db
      .from("mandatos")
      .update(payload)
      .eq("id", existing.id)
      .select()
      .single();
    return data ?? null;
  }

  const { data } = await db
    .from("mandatos")
    .insert(payload)
    .select()
    .single();
  return data ?? null;
}

function normalizeRequired(value: unknown, max: number) {
  const normalized = normalizeOptional(value, max);
  if (!normalized) throw new Error("Campo obrigatório ausente");
  return normalized;
}

function normalizeOptional(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T | "") {
  return allowed.includes(value as T) ? value as T : fallback;
}
