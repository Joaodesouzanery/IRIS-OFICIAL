/**
 * POST /api/v1/admin/votos/materializar-faltantes
 *
 * Backfill de votos (QA ago/2026): as correções na inferência (hasNominalNames por
 * nomes CASADOS, roster do pai em item ANTT unânime, retroativos destravados) só
 * valem para uploads futuros — as deliberações finais JÁ gravadas sem nenhum voto
 * continuariam zeradas. Esta rota relê o `raw_extraction` persistido (nomes_votacao*,
 * unanimidade_detectada, documento_antt_tipo) e reaplica `buildVotoRows` com as
 * regras atuais. NUNCA chuta: só materializa quando a evidência persistida sustenta
 * (unanimidade textual + roster de mandato/presentes, ou divergência nomeada).
 *
 * Body: { dry_run?: boolean (default TRUE), agencia_id?: string, year?: "2026" }.
 * Idempotente: upsert por (deliberacao_id, diretor_id); só toca deliberações com 0 votos.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { hasBudget, budgetFromRequest } from "@/lib/server/time-budget";
import { findBestMatch } from "@/lib/server/name-matcher";
import { COLEGIADO_SIGLAS } from "@/lib/server/colegiado-sources";
import {
  buildVotoRows,
  getActiveDiretoresForVote,
  shouldInferVotesFromMandate,
  type DiretorVoteRecord,
  type VotoInsertRow,
} from "@/lib/server/vote-inference";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NAO_FINAL = new Set(["pauta", "voto_individual", "documento_apoio"]);
const YEAR_RE = /^(20)\d{2}$/;

function arr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Backfill indisponível em modo DEMO." }, { status: 403 });
  }
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as {
    dry_run?: unknown; agencia_id?: unknown; year?: unknown;
  };
  const dryRun = body.dry_run !== false; // default true — aplicar exige dry_run:false explícito
  const agenciaFiltro = typeof body.agencia_id === "string" && body.agencia_id ? body.agencia_id : null;
  const year = typeof body.year === "string" && YEAR_RE.test(body.year) ? body.year : null;

  const deadlineAt = Date.now() + Math.min(budgetFromRequest(req), 50_000);
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Só agências COLEGIADAS têm esteira de votos — fora delas não se materializa nada.
  const { data: agRows } = await db.from("agencias").select("id, sigla");
  const colegiadaIds = new Set(
    ((agRows ?? []) as Array<{ id: string; sigla: string }>)
      .filter((a) => COLEGIADO_SIGLAS.has(String(a.sigla)))
      .map((a) => a.id),
  );

  let query = db
    .from("deliberacoes")
    .select("id, agencia_id, tipo_documento, documento_pai_id, resultado, data_reuniao, raw_extraction")
    .not("resultado", "is", null)
    .order("id", { ascending: true })
    .limit(4000);
  if (agenciaFiltro) query = query.eq("agencia_id", agenciaFiltro);
  if (year) query = query.gte("data_reuniao", `${year}-01-01`).lte("data_reuniao", `${year}-12-31`);
  const { data: delibs, error } = await query;
  if (error) return NextResponse.json({ error: "Falha ao listar deliberações." }, { status: 500 });

  // Finais (mesma regra da Completude: ata só conta como filho com resultado).
  const finais = (delibs ?? []).filter((d: any) => {
    if (NAO_FINAL.has(String(d.tipo_documento))) return false;
    if (d.tipo_documento === "ata") return Boolean(d.documento_pai_id && d.resultado);
    return true;
  });

  // Quais já têm voto (consulta em chunks de 200 ids).
  const comVoto = new Set<string>();
  for (let i = 0; i < finais.length; i += 200) {
    const chunk = finais.slice(i, i + 200).map((d: any) => d.id);
    const { data: v } = await db.from("votos").select("deliberacao_id").in("deliberacao_id", chunk);
    for (const row of v ?? []) comVoto.add((row as { deliberacao_id: string }).deliberacao_id);
  }
  const semVoto = finais.filter((d: any) => !comVoto.has(d.id));

  // Cadastro de diretores por agência (cache) — nome mais longo primeiro (determinismo,
  // mesmo critério do confirm).
  const diretoresCache = new Map<string, DiretorVoteRecord[]>();
  async function diretoresDa(agenciaId: string): Promise<DiretorVoteRecord[]> {
    const hit = diretoresCache.get(agenciaId);
    if (hit) return hit;
    const { data } = await db.from("diretores").select("id, nome, nome_variantes").eq("review_status", "aprovado").eq("agencia_id", agenciaId);
    const lista = (data ?? []).map((dir: any) => ({
      id: dir.id,
      nome: dir.nome,
      nome_variantes: Array.isArray(dir.nome_variantes) ? dir.nome_variantes : [],
    })).sort((x: DiretorVoteRecord, y: DiretorVoteRecord) => y.nome.length - x.nome.length);
    diretoresCache.set(agenciaId, lista);
    return lista;
  }

  let materializaveis = 0;
  let votosCriados = 0;
  let semEvidencia = 0;
  let restantes = false;
  const detalhe: Array<{ deliberacao_id: string; votos: number; origem: string }> = [];

  for (const d of semVoto as any[]) {
    if (!hasBudget(deadlineAt, 8_000)) { restantes = true; break; }
    if (!d.agencia_id || !colegiadaIds.has(d.agencia_id)) { semEvidencia++; continue; }
    const raw = (d.raw_extraction ?? {}) as Record<string, unknown>;
    const nomes = arr(raw.nomes_votacao);
    const nomesContra = arr(raw.nomes_votacao_contra);
    const nomesAusente = arr(raw.nomes_votacao_ausente);
    const nomesAbstencao = arr(raw.nomes_votacao_abstencao);
    // Impedimento persistido (etapa50). Materializar SEM ele reintroduziria o "Favoravel"
    // fabricado justamente nas deliberações que ainda não têm voto — o pior lugar para errar.
    const nomesImpedido = arr(raw.impedimentos).length
      ? arr(raw.impedimentos)
      : arr(raw.nomes_votacao_impedido);
    const unanime = Boolean(raw.unanimidade_detectada);
    const isAnttAtaItem = d.tipo_documento === "ata" && Boolean(raw.documento_antt_tipo);

    const diretoresList = await diretoresDa(d.agencia_id);
    if (diretoresList.length === 0) { semEvidencia++; continue; }

    // Roster: presentes persistidos casados ≥0.85; fallback mandatos na data (mesma
    // hierarquia do confirm). Em item ANTT, os nomes_votacao SÃO os presentes.
    const presentes = isAnttAtaItem ? nomes : arr(raw.nomes_presentes);
    const presentesRoster = presentes
      .map((nome) => {
        const m = findBestMatch(nome, diretoresList);
        return m.diretorId && !m.needsReview
          ? diretoresList.find((x) => x.id === m.diretorId) ?? null
          : null;
      })
      .filter((x): x is DiretorVoteRecord => Boolean(x));
    const activeDiretoresList = presentesRoster.length > 0
      ? presentesRoster
      : await getActiveDiretoresForVote(db, d.agencia_id, d.data_reuniao, diretoresList);

    const inferFromMandate = isAnttAtaItem
      ? Boolean(unanime && d.resultado && activeDiretoresList.length > 0)
      : shouldInferVotesFromMandate({
        resultado: d.resultado,
        tipo_documento: d.tipo_documento,
        import_counts_as_final: d.tipo_documento === "ata" ? Boolean(d.resultado) : (raw.import_counts_as_final as boolean | null | undefined),
        unanimidadeDetectada: unanime,
        nomes,
        nomesContra,
        nomesAbstencao,
        dataReuniao: d.data_reuniao,
        diretoresList,
      });

    const rows: VotoInsertRow[] = buildVotoRows({
      deliberacao_id: d.id,
      nomes: isAnttAtaItem ? [] : nomes,
      nomesContra,
      nomesAusente,
      nomesAbstencao,
      nomesImpedido,
      diretoresList,
      activeDiretoresList,
      inferFromMandate,
      resultado: d.resultado,
      unanime,
    });

    if (rows.length === 0) { semEvidencia++; continue; }
    materializaveis++;
    if (detalhe.length < 50) {
      detalhe.push({ deliberacao_id: d.id, votos: rows.length, origem: inferFromMandate ? "inferencia" : "nominal" });
    }
    if (!dryRun) {
      const { error: upErr } = await db.from("votos").upsert(rows, { onConflict: "deliberacao_id,diretor_id" });
      if (upErr) console.error("[materializar-faltantes] upsert falhou:", upErr.message);
      else votosCriados += rows.length;
    } else {
      votosCriados += rows.length;
    }
  }

  return NextResponse.json({
    dry_run: dryRun,
    finais_analisadas: finais.length,
    sem_voto: semVoto.length,
    materializaveis,
    votos: votosCriados,
    sem_evidencia: semEvidencia,
    restantes,
    detalhe,
    ...(dryRun ? { aviso: "Simulação — repita com dry_run:false para gravar." } : {}),
  });
}
