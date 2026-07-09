// Dedup de deliberações na IMPORTAÇÃO (Etapa 14-E). A tabela deliberacoes não
// tem chave única (histórico), então a mesma ata confirmada duas vezes contava
// em dobro nas métricas. Aqui: antes de inserir, procura uma deliberação
// equivalente e a REUSA (votos upsertam por (deliberacao_id, diretor_id) —
// idempotente). Constraint única no banco fica para depois da limpeza.

type Db = any;

export interface DeliberacaoDedupKey {
  agenciaId: string;
  numeroDeliberacao?: string | null;
  processo?: string | null;
  dataReuniao?: string | null; // YYYY-MM-DD
  /** Reunião (ex.: "1036") — fallback voto×ata quando a data diverge/está ausente. */
  numeroReuniao?: string | null;
}

export interface DeliberacaoExistente {
  id: string;
  resultado: string | null;
  data_reuniao: string | null;
  reuniao_id: string | null;
}

// Números de deliberação podem se repetir entre ANOS (ex.: "487" em 2025 e 2026):
// só considera duplicata quando os anos são compatíveis (iguais, ou um dos lados
// sem data — documento ainda não datado).
function anosCompativeis(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  return a.slice(0, 4) === b.slice(0, 4);
}

// Normaliza número para comparação tolerante: minúsculas, remove não-alfanumérico
// e zeros à esquerda de cada grupo de dígitos. "0487"≡"487", "DFQ-043"≡"DFQ 43".
function normNumero(v: string | null | undefined): string {
  if (!v) return "";
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/0+(\d)/g, "$1");
}

// Processo tolerante a formatação/OCR: "50500.123/2026-11" ≡ "50500 123 2026 11".
function normProcesso(v: string | null | undefined): string {
  return normNumero(v);
}

export async function findDeliberacaoExistente(
  db: Db,
  key: DeliberacaoDedupKey,
): Promise<DeliberacaoExistente | null> {
  const numero = key.numeroDeliberacao?.trim() || null;
  const processo = key.processo?.trim() || null;

  try {
    if (numero) {
      const { data } = await db
        .from("deliberacoes")
        .select("id, resultado, data_reuniao, reuniao_id, numero_deliberacao")
        .eq("agencia_id", key.agenciaId)
        .eq("numero_deliberacao", numero)
        .order("created_at", { ascending: true })
        .limit(5);
      const match = (data ?? []).find((row: DeliberacaoExistente) =>
        anosCompativeis(row.data_reuniao, key.dataReuniao),
      );
      if (match) return match as DeliberacaoExistente;

      // Tolerante: mesma data + número equivalente ("487"≡"0487"), pega variações
      // de zeros/espaços que o .eq exato não casaria.
      if (key.dataReuniao) {
        const alvo = normNumero(numero);
        const { data: mesmaData } = await db
          .from("deliberacoes")
          .select("id, resultado, data_reuniao, reuniao_id, numero_deliberacao")
          .eq("agencia_id", key.agenciaId)
          .eq("data_reuniao", key.dataReuniao)
          .not("numero_deliberacao", "is", null)
          .limit(200);
        const eq = (mesmaData ?? []).find(
          (row: DeliberacaoExistente & { numero_deliberacao?: string | null }) =>
            normNumero(row.numero_deliberacao) === alvo,
        );
        if (eq) return eq as DeliberacaoExistente;
      }
    }

    // Fallback: mesmo processo decidido na mesma reunião (data exata).
    if (processo && key.dataReuniao) {
      const { data } = await db
        .from("deliberacoes")
        .select("id, resultado, data_reuniao, reuniao_id")
        .eq("agencia_id", key.agenciaId)
        .eq("processo", processo)
        .eq("data_reuniao", key.dataReuniao)
        .order("created_at", { ascending: true })
        .limit(1);
      if (data?.[0]) return data[0] as DeliberacaoExistente;
    }

    // Fallback voto×ata: mesmo processo (normalizado, tolera OCR/formatação) na
    // MESMA reunião (numero_reuniao) — a data do voto (assinatura) frequentemente
    // difere da data da reunião da ata; sem isto a mesma decisão duplicava.
    if (processo && key.numeroReuniao) {
      const alvoProc = normProcesso(processo);
      const { data: mesmaReuniao } = await db
        .from("deliberacoes")
        .select("id, resultado, data_reuniao, reuniao_id, processo")
        .eq("agencia_id", key.agenciaId)
        .eq("numero_reuniao", key.numeroReuniao)
        .not("processo", "is", null)
        .limit(200);
      const eq = (mesmaReuniao ?? []).find(
        (row: DeliberacaoExistente & { processo?: string | null }) =>
          normProcesso(row.processo) === alvoProc,
      );
      if (eq) return eq as DeliberacaoExistente;
    }
  } catch {
    // Falha de leitura nunca bloqueia a importação — segue como insert normal.
  }
  return null;
}

// Preenche na deliberação REUSADA apenas o que estava vazio (resultado/data/
// reuniao_id) — a versão nova de um documento pode trazer a decisão que a
// anterior (ex.: pauta importada como final) não tinha.
export async function enrichDeliberacaoExistente(
  db: Db,
  existente: DeliberacaoExistente,
  novo: { resultado?: string | null; dataReuniao?: string | null; reuniaoId?: string | null },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (!existente.resultado && novo.resultado) patch.resultado = novo.resultado;
  if (!existente.data_reuniao && novo.dataReuniao) patch.data_reuniao = novo.dataReuniao;
  if (!existente.reuniao_id && novo.reuniaoId) patch.reuniao_id = novo.reuniaoId;
  if (Object.keys(patch).length === 0) return;
  try {
    await db.from("deliberacoes").update(patch).eq("id", existente.id);
  } catch {
    // Enriquecimento é melhor-esforço.
  }
}
