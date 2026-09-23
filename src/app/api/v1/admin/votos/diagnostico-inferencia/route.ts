/**
 * GET /api/v1/admin/votos/diagnostico-inferencia — quantos votos o `!hasNominalNames` custa.
 *
 * ═══ A pergunta, e por que ela precisa de base inteira ═══
 * A certificação da `etapa163` mediu 17 votos que o gabarito manual prevê e o pipeline não produz,
 * em 3 atas, todos por `shouldInferVotesFromMandate:111`. Antes de mexer numa função que governa
 * TODO documento da base, três coisas precisam de número: volume, se o nome que bloqueia é mesmo
 * de votante, e se o efeito se concentra numa agência.
 *
 * ⚠️ SOMENTE LEITURA. Esta rota é dry-run por construção: não existe caminho de escrita nela.
 *
 * ⚠️ O ESCOPO É MAIOR DO QUE "DELIBERAÇÃO SEM VOTO", e essa foi a minha primeira leitura errada.
 * Na 83ª ROP, os itens 2.3.1/2.4.1/2.7.2 TÊM voto — a linha de impedimento de José Fernando. Eles
 * nunca entram na população "sem voto" que o materializador examina, e mesmo assim faltam três
 * diretores em cada. A conta certa é `votos < colegiado esperado na data`, que pega os dois casos:
 * a deliberação com zero voto e a com colegiado incompleto.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { lerTudo } from "@/lib/server/select-all-paged";
import { colegiadoNaData, type MandatoJanela } from "@/lib/server/colegiado-na-data";
import { motivoSemInferencia, nomesQueBloqueiam, type MotivoSemInferencia } from "@/lib/server/motivo-sem-inferencia";
import { RE_CONTESTADO_AMPLO } from "@/lib/server/consistency-checks";
import type { DiretorVoteRecord } from "@/lib/server/vote-inference";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** Ata sem pai não é decisão final; pauta e apoio nunca são. Mesma regra da Completude. */
const NAO_FINAL = new Set(["pauta", "documento_apoio", "noticia", "consulta_publica"]);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ modo: "demo", por_motivo: {}, por_agencia: {}, amostra: [] });
  }
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const ano = req.nextUrl.searchParams.get("ano");
  const tamanhoDaAmostra = Math.max(1, Math.min(30, Number(req.nextUrl.searchParams.get("amostra")) || 10));

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // ── 1. O universo: finais, com projeção LEVE (o payload pesado vem depois) ──
  const levesRes = await lerTudo<any>(() => {
    let q = db
      .from("deliberacoes")
      .select("id, agencia_id, tipo_documento, documento_pai_id, resultado, data_reuniao, numero_reuniao")
      .not("resultado", "is", null)
      .order("id", { ascending: true });
    if (ano) q = q.gte("data_reuniao", `${ano}-01-01`).lte("data_reuniao", `${ano}-12-31`);
    return q;
  }, "diagnostico-inferencia/leves");
  // ⚠️ `lerTudo` devolve `{error}` em vez de lançar, e no caminho de erro `truncated` fica FALSE
  // com as linhas que já tinha. Medir sobre leitura parcial e chamar de "base inteira" seria
  // exatamente o tipo de número que este diagnóstico existe para não produzir.
  if (levesRes.error) return NextResponse.json({ error: "Falha ao listar deliberações." }, { status: 500 });

  const finais = levesRes.data.filter((d: any) => {
    if (NAO_FINAL.has(String(d.tipo_documento))) return false;
    if (d.tipo_documento === "ata") return Boolean(d.documento_pai_id && d.resultado);
    return true;
  });

  const [votosRes, mandatosRes, agRes] = await Promise.all([
    lerTudo<any>(() => db.from("votos").select("deliberacao_id, diretor_id").order("id"), "diagnostico-inferencia/votos"),
    lerTudo<any>(() => db
      .from("mandatos")
      .select("diretor_id, data_inicio, data_fim, diretores!inner(agencia_id, review_status)")
      .neq("fonte_dado", "automatico")
      .eq("diretores.review_status", "aprovado")
      .order("id"), "diagnostico-inferencia/mandatos"),
    db.from("agencias").select("id, sigla"),
  ]);
  if (votosRes.error || mandatosRes.error) {
    return NextResponse.json({ error: "Falha ao listar votos ou mandatos." }, { status: 500 });
  }

  const votantesPor = new Map<string, Set<string>>();
  for (const v of votosRes.data as Array<{ deliberacao_id: string; diretor_id: string }>) {
    if (!votantesPor.has(v.deliberacao_id)) votantesPor.set(v.deliberacao_id, new Set());
    votantesPor.get(v.deliberacao_id)!.add(String(v.diretor_id));
  }
  const mandatos: MandatoJanela[] = (mandatosRes.data as any[]).map((m) => ({
    diretor_id: String(m.diretor_id),
    agencia_id: String(m.diretores?.agencia_id ?? ""),
    data_inicio: m.data_inicio ?? null,
    data_fim: m.data_fim ?? null,
  }));
  const sigla = new Map(((agRes.data ?? []) as any[]).map((a) => [String(a.id), String(a.sigla)]));

  // ── 2. Quem está INCOMPLETO: votos < colegiado esperado na data ──
  const incompletas = finais.filter((d: any) => {
    const esperado = colegiadoNaData(mandatos, d.agencia_id ? String(d.agencia_id) : null, d.data_reuniao ?? null);
    if (esperado.length === 0) return false; // roster desconhecido: outra categoria, não esta
    return (votantesPor.get(String(d.id))?.size ?? 0) < esperado.length;
  });

  // ── 3. O payload pesado, só das incompletas ──
  const ids = incompletas.map((d: any) => String(d.id));
  const pesadosRes = ids.length
    ? await lerTudo<any>(() => db
        .from("deliberacoes")
        .select("id, raw_extraction, fundamento_decisao, resumo_pleito")
        .in("id", ids)
        .order("id"), "diagnostico-inferencia/pesados")
    : { data: [] as any[], error: null, truncated: false };
  if (pesadosRes.error) return NextResponse.json({ error: "Falha ao ler o payload." }, { status: 500 });
  const pesadoPor = new Map(((pesadosRes.data ?? []) as any[]).map((p) => [String(p.id), p]));

  // O cadastro de diretores por agência — o mesmo que `hasNominalNames` consulta.
  const dirRes = await lerTudo<any>(() => db
    .from("diretores").select("id, nome, nome_variantes, agencia_id, review_status")
    .eq("review_status", "aprovado").order("id"), "diagnostico-inferencia/diretores");
  const cadastroPor = new Map<string, DiretorVoteRecord[]>();
  for (const d of (dirRes.data ?? []) as any[]) {
    const ag = String(d.agencia_id);
    if (!cadastroPor.has(ag)) cadastroPor.set(ag, []);
    cadastroPor.get(ag)!.push({ id: String(d.id), nome: String(d.nome), nome_variantes: arr(d.nome_variantes) });
  }

  // ── 4. A classificação ──
  const porMotivo: Record<string, number> = {};
  const porAgencia: Record<string, { incompletas: number; bloqueadas: number; votos_que_entrariam: number }> = {};
  const amostra: unknown[] = [];
  const amostraNomes: unknown[] = [];
  let semPayload = 0;
  let votosQueEntrariam = 0;

  for (const d of incompletas as any[]) {
    const pesado = pesadoPor.get(String(d.id));
    // ⚠️ Sem payload, NÃO classificar. Foi assim que a Fase 28 quase inferiu voto para o colegiado
    // inteiro: `raw_extraction` ausente lido como "ninguém nomeado, nada contestado".
    if (!pesado) { semPayload++; continue; }

    const raw = (pesado.raw_extraction ?? {}) as Record<string, unknown>;
    const ag = String(d.agencia_id);
    const sg = sigla.get(ag) ?? "?";
    const cadastro = cadastroPor.get(ag) ?? [];
    const esperado = colegiadoNaData(mandatos, ag, d.data_reuniao ?? null);
    const faltando = esperado.length - (votantesPor.get(String(d.id))?.size ?? 0);

    porAgencia[sg] = porAgencia[sg] ?? { incompletas: 0, bloqueadas: 0, votos_que_entrariam: 0 };
    porAgencia[sg].incompletas++;

    // As MESMAS entradas que `materializar-faltantes` monta — inclusive o texto da contestação.
    const textoComPleito = [
      pesado.fundamento_decisao, raw.assunto as string | undefined,
      raw.decisao as string | undefined, pesado.resumo_pleito,
    ].filter(Boolean).join(" ");
    const nomes = arr(raw.nomes_votacao);
    const motivo: MotivoSemInferencia = motivoSemInferencia({
      resultado: d.resultado,
      tipo_documento: d.tipo_documento,
      import_counts_as_final: Boolean(d.resultado),
      unanimidadeDetectada: Boolean(raw.unanimidade_detectada),
      nomes,
      nomesContra: arr(raw.nomes_votacao_contra),
      nomesAbstencao: arr(raw.nomes_votacao_abstencao),
      dataReuniao: d.data_reuniao,
      sinaisContestacao: RE_CONTESTADO_AMPLO.test(textoComPleito),
      diretoresList: cadastro,
    });
    porMotivo[motivo] = (porMotivo[motivo] ?? 0) + 1;

    if (motivo === "bloqueado_por_nome_de_diretor") {
      porAgencia[sg].bloqueadas++;
      porAgencia[sg].votos_que_entrariam += Math.max(0, faltando);
      votosQueEntrariam += Math.max(0, faltando);
      const quem = nomesQueBloqueiam(nomes, cadastro);
      if (amostra.length < tamanhoDaAmostra) {
        amostra.push({
          deliberacao_id: String(d.id), agencia: sg, numero_reuniao: d.numero_reuniao,
          item: raw.item_numero ?? null, data_reuniao: d.data_reuniao, resultado: d.resultado,
          unanime: Boolean(raw.unanimidade_detectada),
          colegiado_esperado: esperado.length, votos_hoje: votantesPor.get(String(d.id))?.size ?? 0,
          faltando, nomes_no_documento: quem,
        });
      }
      // ⚠️ A amostra que responde "o nome é votante ou terceiro?": casos em que ALGUM nome do
      // documento NÃO casou com o cadastro convivendo com outro que casou. Se a lista vier vazia,
      // é sinal de que a regra só é acionada por nome de diretor — que é o desenho declarado.
      if (quem.some((q) => q.diretor_casado === null) && amostraNomes.length < tamanhoDaAmostra) {
        amostraNomes.push({
          deliberacao_id: String(d.id), agencia: sg, item: raw.item_numero ?? null,
          nomes_no_documento: quem,
        });
      }
    }
  }

  return NextResponse.json({
    parametros: { ano: ano ?? "todos", amostra: tamanhoDaAmostra },
    universo: {
      finais: finais.length,
      incompletas: incompletas.length,
      sem_payload: semPayload,
      leitura_truncada: levesRes.truncated || votosRes.truncated || mandatosRes.truncated || pesadosRes.truncated,
    },
    por_motivo: porMotivo,
    por_agencia: porAgencia,
    votos_que_entrariam: votosQueEntrariam,
    amostra_bloqueados: amostra,
    amostra_nome_nao_casado: amostraNomes,
    notice:
      "SOMENTE LEITURA — nada é gravado. `bloqueado_por_nome_de_diretor` é EXATAMENTE o conjunto " +
      "que remover o `!hasNominalNames` de shouldInferVotesFromMandate:111 destravaria; item " +
      "contestado e não-unânime não entra porque o conserto não o alcança. " +
      "`votos_que_entrariam` é a soma dos diretores faltantes nesses itens. " +
      "`amostra_nome_nao_casado` vazia significa que só nome de DIRETOR aciona a regra — que é o " +
      "desenho declarado (advogado e signatário de rodapé não casam com o cadastro).",
  });
}
