/**
 * POST /api/v1/admin/votos/simular-revoto — a simulação do revoto contra o gabarito (Fase 39).
 *
 * SOMENTE LEITURA. Para cada ata do gabarito (ou só as da agência pedida em `{ agencia: "ANM" }`),
 * lê os itens finais e os votos de HOJE e simula, na data CERTIFICADA, o que o revoto apagaria e o
 * completar-parcial acrescentaria — e se o resultado bate com o gabarito item a item e voto a voto.
 * É o portão do revoto: se não reproduz, ligar a escrita produziria outro erro.
 *
 * POST (e não GET) porque é uma ferramenta de operação acionada pelo painel, guardada por admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { lerTudo } from "@/lib/server/select-all-paged";
import { lerEmLotes } from "@/lib/server/ler-em-lotes";
import { GABARITO_POR_ARQUIVO, DATAS_CONFERIDAS, numeroDaReuniao } from "@/lib/server/gabarito";
import { carregarMandatosJanela } from "@/lib/server/mandatos-janela";
import { isFinalDecisionRecord } from "@/lib/server/regulatory-documents";
import { RE_CONTESTADO_AMPLO } from "@/lib/server/consistency-checks";
import { findBestMatch, MATCH_THRESHOLD } from "@/lib/server/name-matcher";
import { simularRevotoDaAta, type ItemParaSimular } from "@/lib/server/simular-revoto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) return NextResponse.json({ modo: "demo", atas: [], agencias: {}, leitura_completa: true });
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const corpo = (await req.json().catch(() => ({}))) as { agencia?: unknown };
  const filtro = typeof corpo.agencia === "string" ? corpo.agencia.trim().toUpperCase() : null;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data: agRows, error: agErr } = await db.from("agencias").select("id, sigla");
  if (agErr) return NextResponse.json({ error: `Falha ao listar agências: ${agErr.message}` }, { status: 500 });
  const idPorSigla = new Map(((agRows ?? []) as Array<{ id: string; sigla: string }>).map((a) => [a.sigla.toUpperCase(), a.id]));

  const mand = await carregarMandatosJanela(db, "simular-revoto/mandatos");
  let leituraCompleta = mand.completa;
  const atas = [];
  const leves = new Map<string, Array<{ id: string; numero_reuniao: string | null }>>();

  for (const [arquivo, ata] of Object.entries(GABARITO_POR_ARQUIVO)) {
    const sigla = String(ata.agencia).trim().toUpperCase();
    if (filtro && sigla !== filtro) continue;
    const agenciaId = idPorSigla.get(sigla);
    if (!agenciaId) continue;
    const numero = numeroDaReuniao(ata.reuniao);
    // ⚠️ A data CERTIFICADA (contra o PDF), nunca a gravada — é o ponto inteiro da simulação.
    const dataCerta = DATAS_CONFERIDAS.find((d) => d.agencia === sigla && numeroDaReuniao(d.reuniao) === numero)?.data_reuniao
      ?? ata.data_reuniao;

    // Leitura LEVE da agência (cacheada), e a pesada só dos ids desta reunião.
    if (!leves.has(agenciaId)) {
      const r = await lerTudo<{ id: string; numero_reuniao: string | null }>(
        () => db.from("deliberacoes").select("id, numero_reuniao").eq("agencia_id", agenciaId).order("id"),
        `simular-revoto/leve/${sigla}`);
      if (r.error || r.truncated) leituraCompleta = false;
      leves.set(agenciaId, r.data ?? []);
    }
    const idsDaReuniao = (leves.get(agenciaId) ?? [])
      .filter((d) => numeroDaReuniao(d.numero_reuniao) === numero).map((d) => String(d.id));
    const pesadasRes = await lerEmLotes<any>(db, {
      tabela: "deliberacoes",
      select: "id, numero_reuniao, data_reuniao, tipo_documento, documento_pai_id, resultado, raw_extraction, " +
              "fundamento_decisao, decisoes_todas, resumo_pleito",
      coluna: "id", valores: idsDaReuniao, label: `simular-revoto/${arquivo}`,
    });
    if (pesadasRes.error || pesadasRes.truncated) leituraCompleta = false;
    const daReuniao = (pesadasRes.data as any[]).filter((d) => isFinalDecisionRecord(d));

    const votosRes = await lerEmLotes<any>(db, {
      tabela: "votos", select: "deliberacao_id, diretor_id, is_nominal, proveniencia, tipo_voto, motivo_nao_voto",
      coluna: "deliberacao_id", valores: daReuniao.map((d) => String(d.id)), label: `simular-revoto/votos/${arquivo}`,
    });
    if (votosRes.error || votosRes.truncated) leituraCompleta = false;
    const votosPorDelib = new Map<string, any[]>();
    for (const v of votosRes.data) {
      const k = String(v.deliberacao_id);
      votosPorDelib.set(k, [...(votosPorDelib.get(k) ?? []), v]);
    }

    const { data: dirs, error: dirErr } = await db.from("diretores")
      .select("id, nome, nome_variantes").eq("agencia_id", agenciaId).eq("review_status", "aprovado");
    if (dirErr) leituraCompleta = false;
    const diretores = ((dirs ?? []) as any[]).map((x) => ({ id: String(x.id), nome: String(x.nome), nome_variantes: (x.nome_variantes ?? []) as string[] }));

    const itens: ItemParaSimular[] = daReuniao.map((d) => {
      const raw = (d.raw_extraction ?? {}) as Record<string, unknown>;
      const nomesImpedidos = arr(raw.impedimentos).length ? arr(raw.impedimentos) : arr(raw.nomes_votacao_impedido);
      return {
        id: String(d.id),
        item_numero: (raw.item_numero as string | undefined) ?? null,
        tipo_documento: (d.tipo_documento as string | null) ?? null,
        resultado: (d.resultado as string | null) ?? null,
        // A MESMA regex e o MESMO texto do materializador e do placar.
        contestado: RE_CONTESTADO_AMPLO.test([
          d.fundamento_decisao, ...((d.decisoes_todas as string[] | null) ?? []),
          raw.assunto as string | undefined, raw.decisao as string | undefined, d.resumo_pleito,
        ].filter(Boolean).join(" ")),
        temPai: Boolean(d.documento_pai_id),
        impedidos: nomesImpedidos
          .map((n) => findBestMatch(n, diretores))
          .filter((m) => m.diretorId && m.score >= MATCH_THRESHOLD)
          .map((m) => String(m.diretorId)),
        votos: (votosPorDelib.get(String(d.id)) ?? []).map((v) => ({
          diretor_id: String(v.diretor_id), is_nominal: v.is_nominal ?? null, proveniencia: v.proveniencia ?? null,
          tipo_voto: v.tipo_voto ?? null, motivo_nao_voto: v.motivo_nao_voto ?? null,
        })),
      };
    });

    const datasGravadas = [...new Set(daReuniao.map((d) => String(d.data_reuniao ?? "").slice(0, 10)).filter(Boolean))].sort();
    atas.push({
      ...simularRevotoDaAta({ arquivo, ata, sigla, agenciaId, dataCerta, mandatos: mand.mandatos, diretores, itens }),
      datas_gravadas: datasGravadas,
    });
  }

  return NextResponse.json({
    modo: "real", leitura_completa: leituraCompleta, atas,
    // O painel aplica POR AGÊNCIA (o materializador exige `agencia_id` para aplicar).
    agencias: Object.fromEntries(idPorSigla),
  });
}
