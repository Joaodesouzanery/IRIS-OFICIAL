/**
 * POST /api/v1/admin/deliberacoes/datas-a-corrigir — Medir → Aplicar (Fase 39).
 *
 * Body: `{ janela: "referencia" | "voto_antt" | "ata_anm", dry_run?: boolean }` (dry_run = true por
 * padrão). Medir devolve o DE/PARA com a fonte, as recusas e o portão de cada agência. Aplicar grava
 * só o que o portão aprovou, com RASTRO em `raw_extraction` (data anterior, janela, fonte, quando),
 * alinha os filhos à mãe e apaga a `reunioes` que ficou sem nenhuma deliberação.
 *
 * ⚠️ Decisão do usuário: nenhuma correção de data desta fase grava sozinha. Esta rota NÃO está no
 * Rodar Tudo; quem a chama é o painel "Datas a corrigir", depois de o usuário conferir a amostra.
 *
 * ⚠️ Trocar a data muda o colegiado esperado da linha. Os votos NÃO são tocados aqui: o revoto
 * (simulado contra o gabarito) e o completar-parcial vêm depois, com a data já certa.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { budgetFromRequest, hasBudget } from "@/lib/server/time-budget";
import { lerTudo } from "@/lib/server/select-all-paged";
import { lerEmLotes } from "@/lib/server/ler-em-lotes";
import { exigirEscrita } from "@/lib/server/escrita-checada";
import { ensureReuniao, serieDaReuniao, type SerieReuniao } from "@/lib/server/reunioes";
import { numeroDaListagem } from "@/lib/server/antt-data-da-listagem";
import { DATAS_CONFERIDAS } from "@/lib/server/gabarito";
import { carregarMandatosJanela } from "@/lib/server/mandatos-janela";
import { extractAnmMeetingMetadata } from "@/lib/server/regulatory-documents";
import { extractDataReuniaoAncorada } from "@/lib/server/nlp-extractor";
import {
  planejarAtasAnm, planejarPelaReferencia, planejarVotosAntt,
  type DelibParaData, type JanelaDeData, type PlanoDeDatas, type ReuniaoComData,
} from "@/lib/server/datas-a-corrigir";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const JANELAS: ReadonlySet<string> = new Set(["referencia", "voto_antt", "ata_anm"]);
/** Saldo mínimo para gravar UMA proposta (ensureReuniao + update + filhos). */
const RESERVA_POR_PROPOSTA_MS = 2_500;
/** Saldo guardado para conferir e apagar as reuniões órfãs no fim. */
const RESERVA_DE_FECHO_MS = 6_000;

const SELECT_DELIB = "id, agencia_id, numero_reuniao, data_reuniao, documento_pai_id, tipo_reuniao, reuniao_ordinaria, reuniao_id";

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ modo: "demo", janela: null, propostas: [], propostas_total: 0, ja_certas: 0, recusas: {}, portoes: {}, barradas_pelo_portao: [], aplicadas: 0 });
  }
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const corpo = (await req.json().catch(() => ({}))) as { janela?: unknown; dry_run?: unknown };
  const janela = String(corpo.janela ?? "");
  if (!JANELAS.has(janela)) {
    return NextResponse.json({ error: "janela deve ser referencia, voto_antt ou ata_anm" }, { status: 400 });
  }
  const dryRun = corpo.dry_run !== false;
  const deadlineAt = Date.now() + budgetFromRequest(req);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: agRows, error: agErr } = await db.from("agencias").select("id, sigla");
  if (agErr) return NextResponse.json({ error: `Falha ao listar agências: ${agErr.message}` }, { status: 500 });
  const siglaPorId = new Map<string, string>();
  const idPorSigla = new Map<string, string>();
  for (const a of (agRows ?? []) as Array<{ id: string; sigla: string }>) {
    siglaPorId.set(a.id, a.sigla);
    idPorSigla.set(a.sigla, a.id);
  }

  // A série gravada de cada reunião — o casamento com a referência é por (agência, série, número).
  const reunioesRes = await lerTudo<{ id: string; serie: string | null }>(
    () => db.from("reunioes").select("id, serie").order("id"), "datas-a-corrigir/reunioes");
  const seriePorReuniao = new Map((reunioesRes.data ?? []).map((r) => [String(r.id), r.serie ?? null]));
  let leituraCompleta = !reunioesRes.error && !reunioesRes.truncated;

  const siglasDaJanela = janela === "ata_anm" ? ["ANM"] : janela === "voto_antt" ? ["ANTT"] : ["ANTT", "ARTESP"];
  const idsDaJanela = siglasDaJanela.map((s) => idPorSigla.get(s)).filter((x): x is string => Boolean(x));
  const delibsRes = await lerTudo<any>(
    () => {
      let q = db.from("deliberacoes").select(SELECT_DELIB).in("agencia_id", idsDaJanela);
      if (janela === "voto_antt") q = q.is("numero_reuniao", null);
      return q.order("id");
    },
    "datas-a-corrigir/deliberacoes");
  if (delibsRes.error || delibsRes.truncated) leituraCompleta = false;
  const brutas = (delibsRes.data ?? []) as any[];
  const porId = new Map(brutas.map((d) => [String(d.id), d]));
  const delibs: DelibParaData[] = brutas.map((d) => ({
    id: String(d.id),
    agencia: siglaPorId.get(d.agencia_id) ?? "?",
    agencia_id: String(d.agencia_id),
    numero_reuniao: (d.numero_reuniao as string | null) ?? null,
    serie: d.reuniao_id ? seriePorReuniao.get(String(d.reuniao_id)) ?? null : null,
    data_reuniao: d.data_reuniao ? String(d.data_reuniao).slice(0, 10) : null,
    documento_pai_id: (d.documento_pai_id as string | null) ?? null,
  }));
  // O portão: as datas conferidas contra os PDFs do harness (11 reuniões, as três agências).
  const atasDoGabarito = DATAS_CONFERIDAS
    .map((a) => ({ agencia: a.agencia, reuniao: a.reuniao, data_reuniao: a.data_reuniao, serie: a.serie }));

  // ─── O plano da janela ────────────────────────────────────────────────────
  let plano: PlanoDeDatas;
  if (janela === "referencia") {
    const [refRes, listagemRes] = await Promise.all([
      lerTudo<any>(() => db.from("reunioes_referencia").select("agencia_id, serie, numero, data_reuniao").order("id"), "datas-a-corrigir/referencia"),
      lerTudo<any>(() => db.from("antt_reunioes_coletadas").select("numero, tipo, data_inicio").order("id"), "datas-a-corrigir/antt-listagem"),
    ]);
    // ⚠️ Referência ilegível = portão sem testemunha. Não é "nenhuma correção": é "não dá para medir".
    if (refRes.error || refRes.truncated) leituraCompleta = false;
    const referencia: ReuniaoComData[] = [];
    for (const r of (refRes.data ?? []) as any[]) {
      const sigla = siglaPorId.get(r.agencia_id);
      if (!sigla) continue;
      referencia.push({ agencia: sigla, serie: r.serie || null, numero: Number(r.numero), data_reuniao: r.data_reuniao ?? null });
    }
    // A listagem que o coletor da ANTT já gravava entra junto — são a mesma fonte (o site).
    for (const l of (listagemRes.data ?? []) as any[]) {
      const numero = numeroDaListagem(l.numero);
      if (numero !== null) referencia.push({ agencia: "ANTT", serie: l.tipo ?? null, numero, data_reuniao: l.data_inicio ?? null });
    }
    plano = planejarPelaReferencia({ delibs, referencia, atasDoGabarito, agencias: ["ANTT", "ARTESP"] });
  } else if (janela === "voto_antt") {
    const anttId = idPorSigla.get("ANTT") ?? "";
    const [textosRes, mand, dirsRes] = await Promise.all([
      lerEmLotes<{ deliberacao_id: string; texto_extraido: string | null }>(db, {
        tabela: "documentos_regulatorios", select: "deliberacao_id, texto_extraido",
        coluna: "deliberacao_id", valores: delibs.map((d) => d.id), label: "datas-a-corrigir/textos-voto",
      }),
      carregarMandatosJanela(db, "datas-a-corrigir/mandatos"),
      db.from("diretores").select("id, nome, nome_variantes").eq("agencia_id", anttId).eq("review_status", "aprovado"),
    ]);
    if (textosRes.error || !mand.completa || dirsRes.error) leituraCompleta = false;
    const textos = new Map<string, string>();
    for (const t of textosRes.data) if (t.texto_extraido) textos.set(String(t.deliberacao_id), t.texto_extraido);
    plano = planejarVotosAntt({
      delibs, textos, mandatos: mand.mandatos,
      diretores: ((dirsRes.data ?? []) as any[]).map((x) => ({ id: String(x.id), nome: String(x.nome), nome_variantes: x.nome_variantes ?? [] })),
    });
  } else {
    // A mãe é a linha que algum filho aponta em `documento_pai_id`.
    const maesIds = new Set(delibs.map((d) => d.documento_pai_id).filter((x): x is string => Boolean(x)));
    const textosRes = await lerEmLotes<{ deliberacao_id: string; texto_extraido: string | null; filename: string | null }>(db, {
      tabela: "documentos_regulatorios", select: "deliberacao_id, texto_extraido, filename",
      coluna: "deliberacao_id", valores: [...maesIds], label: "datas-a-corrigir/textos-ata",
    });
    if (textosRes.error) leituraCompleta = false;
    const dataPorMae = new Map<string, string | null>();
    for (const t of textosRes.data) {
      const texto = String(t.texto_extraido ?? "");
      if (texto.trim().length < 200) continue;
      // Os MESMOS extratores do `redatar` (Janela C), na mesma ordem: uma fonte por conceito.
      const data = extractAnmMeetingMetadata(texto, String(t.filename ?? "")).data_reuniao ?? extractDataReuniaoAncorada(texto);
      dataPorMae.set(String(t.deliberacao_id), data ?? null);
    }
    plano = planejarAtasAnm({
      maes: delibs.filter((d) => maesIds.has(d.id)).map((d) => ({ ...d, dataDoTexto: dataPorMae.get(d.id) ?? null })),
      atasDoGabarito,
    });
  }

  const resposta = {
    modo: "real",
    janela: janela as JanelaDeData,
    dry_run: dryRun,
    propostas_total: plano.propostas.length,
    propostas: plano.propostas.slice(0, 200),
    ja_certas: plano.ja_certas,
    recusas: plano.recusas,
    portoes: plano.portoes,
    barradas_pelo_portao: plano.barradas_pelo_portao,
    leitura_completa: leituraCompleta,
  };
  if (dryRun) return NextResponse.json({ ...resposta, aplicadas: 0 });

  // ⚠️ Leitura incompleta não aplica: um portão julgado sobre metade da referência pode aprovar por
  // acidente, e uma proposta lida pela metade pode ser a de outra linha.
  if (!leituraCompleta) {
    return NextResponse.json({ ...resposta, aplicadas: 0, erro: "leitura incompleta — nada foi gravado; tente de novo" }, { status: 409 });
  }

  // ─── Aplicar ──────────────────────────────────────────────────────────────
  let aplicadas = 0;
  let filhosAlinhados = 0;
  let falhas = 0;
  let restantes = 0;
  const reunioesAntigas = new Set<string>();
  const reunioesNovas = new Set<string>();
  const agora = new Date().toISOString();
  const brutosRes = await lerEmLotes<{ id: string; raw_extraction: Record<string, unknown> | null }>(db, {
    tabela: "deliberacoes", select: "id, raw_extraction", coluna: "id",
    valores: plano.propostas.map((p) => p.id), label: "datas-a-corrigir/raw",
  });
  if (brutosRes.error) {
    return NextResponse.json({ ...resposta, aplicadas: 0, erro: "falha ao ler o rastro das linhas — nada foi gravado" }, { status: 500 });
  }
  const rawPorId = new Map(brutosRes.data.map((r) => [String(r.id), r.raw_extraction ?? {}]));

  for (const p of plano.propostas) {
    if (!hasBudget(deadlineAt, RESERVA_POR_PROPOSTA_MS + RESERVA_DE_FECHO_MS)) { restantes++; continue; }
    const d = porId.get(p.id);
    if (!d) { falhas++; continue; }
    const sigla = siglaPorId.get(d.agencia_id) ?? null;
    const serie = serieDaReuniao({
      sigla, titulo: d.reuniao_ordinaria ?? null, tipoReuniao: d.tipo_reuniao ?? null, numeroReuniao: d.numero_reuniao ?? null,
    }).serie ?? (d.reuniao_id ? seriePorReuniao.get(String(d.reuniao_id)) ?? null : null);
    const reuniaoId = await ensureReuniao(db, {
      agenciaId: String(d.agencia_id), numeroReuniao: d.numero_reuniao ?? null, dataReuniao: p.para,
      tipoReuniao: d.tipo_reuniao ?? null, titulo: d.reuniao_ordinaria ?? null, serie: serie as SerieReuniao | null,
    });
    // ⚠️ RASTRO: a data antiga nunca some — fica em `raw_extraction`, com a janela, a fonte e quando.
    const rastro = {
      ...(rawPorId.get(p.id) ?? {}),
      data_anterior: p.de, data_corrigida_por: p.janela, data_corrigida_fonte: p.fonte, data_corrigida_em: agora,
    };
    const ok = await exigirEscrita(
      db.from("deliberacoes").update({
        data_reuniao: p.para, raw_extraction: rastro, ...(reuniaoId ? { reuniao_id: reuniaoId } : {}),
      }).eq("id", p.id),
      `datas-a-corrigir ${p.janela} ${p.id}`,
    );
    if (!ok) { falhas++; continue; }
    aplicadas++;
    if (d.reuniao_id) reunioesAntigas.add(String(d.reuniao_id));
    if (reuniaoId) reunioesNovas.add(reuniaoId);

    // Os FILHOS seguem a mãe (é o B.1 do `redatar`, aqui no mesmo gesto).
    const { data: filhos } = await db.from("deliberacoes").select("id, reuniao_id").eq("documento_pai_id", p.id);
    if ((filhos ?? []).length > 0) {
      for (const f of filhos as Array<{ reuniao_id: string | null }>) if (f.reuniao_id) reunioesAntigas.add(String(f.reuniao_id));
      if (await exigirEscrita(
        db.from("deliberacoes").update({ data_reuniao: p.para, ...(reuniaoId ? { reuniao_id: reuniaoId } : {}) }).eq("documento_pai_id", p.id),
        `datas-a-corrigir filhos de ${p.id}`,
      )) filhosAlinhados += (filhos ?? []).length;
    }
  }

  // A reunião que ficou SEM deliberação nenhuma depois da troca é órfã: duplicata no placar e no
  // livro. ⚠️ Só se apaga com contagem ZERO conferida agora — nunca por suposição.
  const orfasRemovidas: string[] = [];
  for (const id of reunioesAntigas) {
    if (reunioesNovas.has(id) || !hasBudget(deadlineAt, 1_500)) continue;
    const { count, error } = await db.from("deliberacoes").select("id", { count: "exact", head: true }).eq("reuniao_id", id);
    if (error || (count ?? 1) > 0) continue;
    if (await exigirEscrita(db.from("reunioes").delete().eq("id", id), `datas-a-corrigir órfã ${id}`)) orfasRemovidas.push(id);
  }

  return NextResponse.json({
    ...resposta,
    aplicadas, filhos_alinhados: filhosAlinhados, falhas, restantes,
    reunioes_orfas_removidas: orfasRemovidas.length,
  });
}
