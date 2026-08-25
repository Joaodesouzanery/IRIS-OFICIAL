/**
 * GET /api/v1/admin/antt/diagnostico-coleta
 *
 * READ-ONLY. Responde a UMA pergunta, sem SQL: **por que a ANTT aparece com 0% de cobertura
 * nominal, se o parser extrai os votos corretamente?**
 *
 * ═══ Por que esta rota existe ═══
 *
 * A Fase 4 concluiu que o gargalo estava no caminho de DESCOBERTA e listou quatro correções.
 * Medido contra três páginas REAIS de 2026 do portal, **nenhuma das quatro reproduz**: o coletor
 * captura 5 de 5, 6 de 6 e 3 de 3 votos, cada um ligado ao seu processo, e ainda extrai o RELATOR
 * NOMINAL de cada item (`etapa66-antt-descoberta.test.ts` trava isso contra a fixture).
 *
 * Se o dado chega íntegro ao fim do parser e a agência aparece com 0% nominal, o gargalo está a
 * JUSANTE ou é OPERACIONAL. Esta rota mede o funil inteiro e mostra em qual degrau ele para:
 *
 *   1. descoberta  — reuniões coletadas, e QUANDO foi a última
 *   2. download    — documentos por tipo/status
 *   3. extração    — quantos viraram `voto_individual` em `deliberacoes`
 *   4. voto        — quantos produziram linha de voto NOMINAL
 *
 * O degrau em que o número cai é a resposta. Se (1) está velho, o coletor não está rodando — o
 * candidato nº 1, porque o plano Hobby da Vercel permite 2 crons/dia e a Etapa 21 moveu tudo para
 * botão.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

const VAZIO = {
  modo: "demo" as const,
  agencia: null,
  funil: { reunioes_coletadas: 0, documentos_baixados: 0, votos_baixados: 0, votos_extraidos: 0, votos_nominais: 0 },
  ultima_coleta: null,
  reunioes_por_serie: [],
  documentos_por_tipo_status: [],
  degrau_que_para: null,
  diagnostico: [] as string[],
};

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) return NextResponse.json(VAZIO);

  const guard = await requireAdmin(req);
  if (guard) return guard;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: ag } = await db.from("agencias").select("id, sigla").eq("sigla", "ANTT").maybeSingle();
  const agenciaId = (ag as { id?: string } | null)?.id ?? null;
  if (!agenciaId) {
    return NextResponse.json({ ...VAZIO, modo: "real", diagnostico: ["Agência ANTT não cadastrada."] });
  }

  // ── Degrau 1: DESCOBERTA ───────────────────────────────────────────────
  const { data: reunioes } = await db
    .from("antt_reunioes_coletadas")
    .select("id, numero, tipo, data_inicio, status, coletado_em")
    .eq("agencia_id", agenciaId)
    .order("coletado_em", { ascending: false })
    .limit(1000);
  const rs = (reunioes ?? []) as Array<{ tipo: string; data_inicio: string | null; status: string; coletado_em: string }>;

  const porSerie = new Map<string, { serie: string; total: number; ultima_data: string | null }>();
  for (const r of rs) {
    const acc = porSerie.get(r.tipo) ?? { serie: r.tipo, total: 0, ultima_data: null };
    acc.total += 1;
    if (r.data_inicio && (!acc.ultima_data || r.data_inicio > acc.ultima_data)) acc.ultima_data = r.data_inicio;
    porSerie.set(r.tipo, acc);
  }
  const ultimaColeta = rs[0]?.coletado_em ?? null;

  // ── Degrau 2: DOWNLOAD ─────────────────────────────────────────────────
  const { data: docs } = await db
    .from("documentos_coletados")
    .select("tipo, status, validation_status")
    .eq("agencia_id", agenciaId)
    .limit(20000);
  const ds = (docs ?? []) as Array<{ tipo: string; status: string }>;

  const porTipoStatus = new Map<string, { tipo: string; status: string; total: number }>();
  for (const d of ds) {
    const k = `${d.tipo}|${d.status}`;
    const acc = porTipoStatus.get(k) ?? { tipo: d.tipo, status: d.status, total: 0 };
    acc.total += 1;
    porTipoStatus.set(k, acc);
  }
  const votosBaixados = ds.filter((d) => d.tipo === "voto").length;

  // ── Degrau 3: EXTRAÇÃO ─────────────────────────────────────────────────
  const { count: votosExtraidos } = await db
    .from("deliberacoes")
    .select("id", { count: "exact", head: true })
    .eq("agencia_id", agenciaId)
    .eq("tipo_documento", "voto_individual");

  // ── Degrau 4: VOTO NOMINAL ─────────────────────────────────────────────
  // Conta linhas de voto NOMINAL ligadas a deliberações desta agência.
  const { data: delibIds } = await db
    .from("deliberacoes").select("id").eq("agencia_id", agenciaId).limit(20000);
  const ids = ((delibIds ?? []) as Array<{ id: string }>).map((d) => d.id);
  let votosNominais = 0;
  for (let i = 0; i < ids.length; i += 300) {
    const { count } = await db
      .from("votos")
      .select("id", { count: "exact", head: true })
      .in("deliberacao_id", ids.slice(i, i + 300))
      .eq("is_nominal", true);
    votosNominais += count ?? 0;
  }

  const funil = {
    reunioes_coletadas: rs.length,
    documentos_baixados: ds.length,
    votos_baixados: votosBaixados,
    votos_extraidos: votosExtraidos ?? 0,
    votos_nominais: votosNominais,
  };

  // ── A leitura: em qual degrau o número cai ─────────────────────────────
  const diagnostico: string[] = [];
  let degrau: string | null = null;
  const diasDesde = ultimaColeta
    ? Math.floor((Date.now() - Date.parse(ultimaColeta)) / 86_400_000)
    : null;

  if (funil.reunioes_coletadas === 0) {
    degrau = "1_descoberta";
    diagnostico.push(
      "Nenhuma reunião coletada. O coletor NUNCA rodou para esta agência — dispare "
      + "`POST /api/v1/antt/2026/collect` (ou o botão da tela de documentos ANTT).",
    );
  } else if (diasDesde !== null && diasDesde > 7) {
    degrau = "1_descoberta";
    diagnostico.push(
      `Última coleta há ${diasDesde} dias. No plano Hobby da Vercel só 2 crons/dia rodam, e a `
      + "Etapa 21 moveu a coleta para botão: provavelmente ninguém a dispara desde então.",
    );
  } else if (funil.votos_baixados === 0) {
    degrau = "2_download";
    diagnostico.push(
      "Reuniões coletadas, mas NENHUM documento de voto baixado. O parser captura votos em página "
      + "real (ver etapa66-antt-descoberta.test.ts) — conferir o download e o filtro de host.",
    );
  } else if (funil.votos_extraidos === 0) {
    degrau = "3_extracao";
    diagnostico.push(
      `${funil.votos_baixados} voto(s) baixado(s) e nenhum virou \`voto_individual\`. O gargalo `
      + "está no enfileiramento ou na classificação — conferir `/admin/upload/pendencias-voto`.",
    );
  } else if (funil.votos_nominais === 0) {
    degrau = "4_voto_nominal";
    diagnostico.push(
      `${funil.votos_extraidos} voto(s) individual(is) extraído(s) e nenhuma linha NOMINAL. O `
      + "gargalo é o CONFIRM: o gate não materializa, ou o relator não casa o cadastro. Conferir "
      + "`/admin/upload/pendencias-voto` e os candidatos de diretor pendentes.",
    );
  } else {
    diagnostico.push(`Funil íntegro: ${funil.votos_nominais} voto(s) nominal(is) materializado(s).`);
  }

  if (porSerie.size > 0 && !porSerie.has("eletronica")) {
    diagnostico.push(
      "Nenhuma reunião da série ELETRÔNICA (RDE) coletada. A ANTT publica nas duas séries — "
      + "se a listagem tem RDE e ela não aparece aqui, o filtro de título está descartando.",
    );
  }

  return NextResponse.json({
    modo: "real",
    agencia: "ANTT",
    gerado_em: new Date().toISOString(),
    funil,
    ultima_coleta: ultimaColeta,
    dias_desde_ultima_coleta: diasDesde,
    reunioes_por_serie: [...porSerie.values()].sort((a, b) => b.total - a.total),
    documentos_por_tipo_status: [...porTipoStatus.values()].sort((a, b) => b.total - a.total),
    degrau_que_para: degrau,
    diagnostico,
    legal_notice: "Diagnóstico READ-ONLY do funil de coleta. Nenhuma linha é alterada. O degrau em "
      + "que o número cai é a resposta — se for o 1, o coletor não está rodando.",
  });
}
