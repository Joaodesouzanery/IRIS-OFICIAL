// Entidade "reunião" materializada (tabela public.reunioes). Chave natural:
// (agencia_id, data_reuniao, coalesce(numero_reuniao,'')) — espelha o rollup em
// memória do analytics-engine. ensureReuniao é 23505-safe e DEGRADA para null
// se a tabela ainda não existir (deploy antes da migration é seguro: o caller
// só grava reuniao_id quando não-null).

type Db = any;

export interface EnsureReuniaoInput {
  agenciaId: string;
  dataReuniao: string | null | undefined; // YYYY-MM-DD
  numeroReuniao?: string | null;
  tipoReuniao?: string | null;
  urlFonte?: string | null;
  source?: string;
}

export async function ensureReuniao(db: Db, input: EnsureReuniaoInput): Promise<string | null> {
  if (!input.agenciaId || !input.dataReuniao) return null;
  const numero = input.numeroReuniao?.trim() || null;

  try {
    let select = db
      .from("reunioes")
      .select("id, tipo_reuniao, url_fonte")
      .eq("agencia_id", input.agenciaId)
      .eq("data_reuniao", input.dataReuniao);
    select = numero ? select.eq("numero_reuniao", numero) : select.is("numero_reuniao", null);
    const { data: existing, error: selectError } = await select.maybeSingle();
    if (selectError) return null; // tabela ausente (migration pendente) ou erro de leitura

    if (existing?.id) {
      // Enriquece campos vazios sem sobrescrever o que já foi curado.
      const patch: Record<string, unknown> = {};
      if (!existing.tipo_reuniao && input.tipoReuniao) patch.tipo_reuniao = input.tipoReuniao;
      if (!existing.url_fonte && input.urlFonte) patch.url_fonte = input.urlFonte;
      if (Object.keys(patch).length > 0) {
        await db.from("reunioes").update(patch).eq("id", existing.id);
      }
      return existing.id as string;
    }

    const { data: inserted, error: insertError } = await db
      .from("reunioes")
      .insert({
        agencia_id: input.agenciaId,
        numero_reuniao: numero,
        tipo_reuniao: input.tipoReuniao ?? null,
        data_reuniao: input.dataReuniao,
        url_fonte: input.urlFonte ?? null,
        source: input.source ?? "deliberacoes",
      })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        // Corrida: outro writer criou a mesma reunião entre o select e o insert.
        const { data: raced } = await (numero
          ? db.from("reunioes").select("id").eq("agencia_id", input.agenciaId).eq("data_reuniao", input.dataReuniao).eq("numero_reuniao", numero)
          : db.from("reunioes").select("id").eq("agencia_id", input.agenciaId).eq("data_reuniao", input.dataReuniao).is("numero_reuniao", null)
        ).maybeSingle();
        return (raced?.id as string | undefined) ?? null;
      }
      return null;
    }
    return (inserted?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
}
