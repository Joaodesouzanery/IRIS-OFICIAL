// Entidade "reunião" materializada (tabela public.reunioes). Chave natural:
// (agencia_id, data_reuniao, coalesce(numero_reuniao,'')) — espelha o rollup em
// memória do analytics-engine. ensureReuniao é 23505-safe e DEGRADA para null
// se a tabela ainda não existir (deploy antes da migration é seguro: o caller
// só grava reuniao_id quando não-null).

type Db = any;

/**
 * SÉRIE da reunião (etapa66). Os contadores são INDEPENDENTES por série — prova medida no corpus:
 * a 1.024ª Reunião de Diretoria e a 264ª Reunião Deliberativa Eletrônica da ANTT compartilham a
 * data 2026-01-19.
 *
 * Difere de `tipo_reuniao`, que só admite `"Ordinaria" | "Extraordinaria" | null` e por isso
 * colapsa RD e RDE em "Ordinaria" (`antt-manual-parser.ts`). A informação sempre esteve no TÍTULO;
 * era o enum de duas cardinalidades que a perdia.
 */
export type SerieReuniao = "ordinaria" | "extraordinaria" | "eletronica" | "administrativa";

/**
 * Deriva a série do TÍTULO do documento. Medido nas 16 fixtures — os títulos reais são:
 *   "REUNIÃO ORDINÁRIA PÚBLICA DA DIRC"            → ordinaria      (ANM)
 *   "REUNIÃO EXTRAORDINÁRIA PÚBLICA DA DIRC/ANM"   → extraordinaria (ANM)
 *   "REUNIÃO PÚBLICA DE DIRETORIA"                 → ordinaria      (ANTT RD)
 *   "REUNIÃO DE DIRETORIA ELETRÔNICA"              → eletronica     (ANTT RDE)
 *   "Reunião Ordinária do Conselho Diretor"        → ordinaria      (ARTESP)
 *   "Reunião Extraordinária do Conselho Diretor"   → extraordinaria (ARTESP)
 *
 * ⚠️ A ordem das checagens importa: "Reunião Deliberativa Eletrônica" também casaria "ordinária"
 * por ausência de marcador, então o eletrônico vem PRIMEIRO. Sem título reconhecível devolve
 * `null` — presumir "ordinaria" juntaria séries distintas na mesma chave.
 */
export function deriveSerie(titulo: string | null | undefined): SerieReuniao | null {
  if (!titulo) return null;
  const t = titulo.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!t.includes("reuni")) return null;
  if (t.includes("eletronic")) return "eletronica";
  if (t.includes("administrativ")) return "administrativa";
  if (t.includes("extraordinar")) return "extraordinaria";
  return "ordinaria";
}

/**
 * Número da reunião como INTEIRO, para comparação ordinal. Reexportado aqui porque a
 * monotonicidade é um assunto da entidade "reunião", e o campo armazenado convive em dois formatos
 * ("1.024" e "1024") — normalizar na GRAVAÇÃO quebraria o dedup por `.eq()`.
 */
export { numeroReuniaoOrdinal } from "@/lib/server/nlp-extractor";

export interface EnsureReuniaoInput {
  agenciaId: string;
  dataReuniao: string | null | undefined; // YYYY-MM-DD
  numeroReuniao?: string | null;
  tipoReuniao?: string | null;
  /** Série derivada do TÍTULO. Entra na chave natural desde a migration `20260825120000`. */
  serie?: SerieReuniao | null;
  /** Título completo da reunião — guardado em `metadata` para auditoria e re-derivação. */
  titulo?: string | null;
  urlFonte?: string | null;
  source?: string;
}

/**
 * `true` = a coluna `serie` existe · `false` = não · `null` = não sondado.
 * Memoizado por processo; a migration só ADICIONA, então o positivo nunca deixa de valer.
 */
let colunaSeriePresente: boolean | null = null;

/** Reseta a sonda (uso em teste). */
export function resetSondaSerie() {
  colunaSeriePresente = null;
}

export async function ensureReuniao(db: Db, input: EnsureReuniaoInput): Promise<string | null> {
  if (!input.agenciaId || !input.dataReuniao) return null;
  const numero = input.numeroReuniao?.trim() || null;

  try {
    // Etapa66 — sonda a coluna `serie` UMA vez. Projetar coluna inexistente derruba a query
    // inteira (o PostgREST não devolve null), e deploy antes da migration tem de seguir seguro.
    if (colunaSeriePresente === null) {
      const probe = await db.from("reunioes").select("serie").limit(1);
      const code = String((probe as { error?: { code?: unknown } })?.error?.code ?? "");
      colunaSeriePresente = code !== "PGRST204" && code !== "42703";
    }
    const comSerie = colunaSeriePresente;

    const colunas = comSerie ? "id, tipo_reuniao, url_fonte, serie" : "id, tipo_reuniao, url_fonte";
    const base = () => {
      let q = db.from("reunioes").select(colunas)
        .eq("agencia_id", input.agenciaId).eq("data_reuniao", input.dataReuniao);
      q = numero ? q.eq("numero_reuniao", numero) : q.is("numero_reuniao", null);
      return q;
    };

    // A SÉRIE faz parte da identidade: sem ela, a 264ª RD e a 264ª RDE da mesma data colapsariam
    // numa linha só — e a monotonicidade ficaria impossível de checar.
    //
    // ⚠️ Busca em DOIS PASSOS, e a razão é uma linha legada. Filtrar direto por `serie` faria toda
    // reunião gravada ANTES da migration (`serie IS NULL`) deixar de casar — e `ensureReuniao`
    // criaria uma DUPLICATA para cada uma. O 2º passo acha a linha antiga e a ENRIQUECE, que é o
    // mesmo princípio já usado para `tipo_reuniao` e `url_fonte`.
    let existing: { id: string; tipo_reuniao?: string | null; url_fonte?: string | null; serie?: string | null } | null = null;
    if (comSerie && input.serie) {
      const exato = await base().eq("serie", input.serie).maybeSingle();
      if (exato.error) return null;
      existing = exato.data;
      if (!existing) {
        const legado = await base().is("serie", null).maybeSingle();
        if (legado.error) return null;
        existing = legado.data;
      }
    } else {
      const r = await base().maybeSingle();
      if (r.error) return null; // tabela ausente (migration pendente) ou erro de leitura
      existing = r.data;
    }

    if (existing?.id) {
      // Enriquece campos vazios sem sobrescrever o que já foi curado.
      const patch: Record<string, unknown> = {};
      if (!existing.tipo_reuniao && input.tipoReuniao) patch.tipo_reuniao = input.tipoReuniao;
      if (!existing.url_fonte && input.urlFonte) patch.url_fonte = input.urlFonte;
      if (comSerie && !existing.serie && input.serie) patch.serie = input.serie;
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
        // O insert omitia `metadata` INTEIRAMENTE: só o backfill SQL populava o título, e toda
        // reunião criada em runtime nascia com `{}`. Guardar o título permite re-derivar a série.
        ...(input.titulo ? { metadata: { titulo: input.titulo } } : {}),
        ...(comSerie && input.serie ? { serie: input.serie } : {}),
      })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        // Corrida: outro writer criou a mesma reunião entre o select e o insert.
        let q = db.from("reunioes").select("id")
          .eq("agencia_id", input.agenciaId).eq("data_reuniao", input.dataReuniao);
        q = numero ? q.eq("numero_reuniao", numero) : q.is("numero_reuniao", null);
        // Mesmo filtro de série do select acima — senão a corrida devolve a linha da OUTRA série.
        if (comSerie && input.serie) q = q.eq("serie", input.serie);
        const { data: raced } = await q.maybeSingle();
        return (raced?.id as string | undefined) ?? null;
      }
      return null;
    }
    return (inserted?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
}
