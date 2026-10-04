/**
 * BLOCO D (Fase 36) — as ausências que o documento DIZ e o banco não tem.
 *
 * ═══ O achado do usuário ═══
 * Raquel França aparece como ausente na 1198ª e não tem as 11 linhas; André Isper aparece na 1191ª
 * e na 1194ª. O conserto da Fase 23 (`extractAusentesComOrigem`, que separa o rótulo "Ausente:" da
 * prosa) passou a ler isso na INGESTÃO — e ingestão nova não alcança linha antiga. O passivo ficou.
 *
 * ═══ Por que dá para consertar sem baixar PDF ═══
 * A ARTESP é documento AVULSO: cada deliberação tem `documentos_regulatorios.texto_extraido` ligado
 * por `deliberacao_id` (o item de ata é que não tem — a linha é por PDF). Então o texto já está no
 * banco, e `extractAusentesComOrigem` é pura: o mesmo extrator da ingestão, rodando sobre o mesmo
 * texto. Nada aqui reinterpreta o documento de outro jeito.
 *
 * ═══ As três coisas que esta rota NÃO faz ═══
 *  1. **Não apaga.** Só insere quem não tem linha, ou promove uma linha INFERIDA para a ausência
 *     LIDA. `upsertVotosProtegido` garante que voto nominal existente nunca é rebaixado.
 *  2. **Não infere voto de ninguém.** `buildVotoRows` é chamado com `activeDiretoresList: []` e
 *     `inferFromMandate: false` — a única coisa que ele pode produzir é linha `Ausente` para os
 *     nomes casados. Quem não está no texto não recebe nada.
 *  3. **Não escreve por padrão.** `dry_run` é `true` até alguém dizer o contrário, e o relatório
 *     traz o TRECHO que casou, para conferência contra o PDF antes de aplicar.
 *
 * ⚠️ E ela não é passo da esteira. É uma correção de passivo, que se roda uma vez e se confere.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { lerTudo } from "@/lib/server/select-all-paged";
import { lerEmLotes } from "@/lib/server/ler-em-lotes";
import { budgetFromRequest, hasBudget } from "@/lib/server/time-budget";
import { isFinalDecisionRecord } from "@/lib/server/regulatory-documents";
import { extractAusentesComOrigem } from "@/lib/server/nlp-extractor";
import { buildVotoRows, type DiretorVoteRecord } from "@/lib/server/vote-inference";
import { findBestMatch } from "@/lib/server/name-matcher";
import { upsertVotosProtegido } from "@/lib/server/votos-write";
import { isVotoNominal } from "@/lib/votos-nominal";

/**
 * ⚠️ 120, como as irmãs que honram o orçamento (`materializar-faltantes`, `redatar`, `placar`).
 *
 * A regra é da `etapa80`: rota que lê `budgetFromRequest` NÃO pode declarar `maxDuration` menor que
 * o orçamento (70s) mais margem — o segment config do Next tem precedência sobre o `vercel.json`, e
 * um 60 aqui viraria SIGKILL incatchável no meio do laço, sem gravar sucesso nem erro.
 */
export const maxDuration = 120;

/** Quantas deliberações por chamada. O texto é o payload pesado — este é o teto que cabe no tempo. */
const LOTE = 120;

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({
      dry_run: true, deliberacoes_examinadas: 0, ausencias_no_texto: 0,
      linhas_a_inserir: 0, linhas_a_promover: 0, nominais_preservadas: 0,
      nao_reconhecidos: [], detalhe: [], demo: true,
    });
  }
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as {
    dry_run?: unknown; sigla?: unknown; ano?: unknown; limite?: unknown; offset?: unknown;
  };
  const dryRun = body.dry_run !== false;
  const sigla = typeof body.sigla === "string" && /^[A-Z]{2,10}$/.test(body.sigla) ? body.sigla : "ARTESP";
  const ano = typeof body.ano === "string" && /^\d{4}$/.test(body.ano) ? body.ano : null;
  const limiteBruto = Number(body.limite);
  const limite = Number.isFinite(limiteBruto) && limiteBruto > 0 ? Math.min(LOTE, Math.floor(limiteBruto)) : LOTE;
  /**
   * ⚠️ Sem `offset`, toda chamada examinava as MESMAS primeiras 120 candidatas — e `restantes`
   * dizia "há mais" sem haver como chegar nelas. Aplicar em lote reaplicava as mesmas 120 (inócuo,
   * é idempotente) e as demais nunca eram alcançadas.
   */
  const offsetBruto = Number(body.offset);
  const offset = Number.isFinite(offsetBruto) && offsetBruto > 0 ? Math.floor(offsetBruto) : 0;

  const deadlineAt = Date.now() + Math.min(budgetFromRequest(req), 50_000);
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: ags, error: erroAg } = await db.from("agencias").select("id, sigla").eq("sigla", sigla);
  if (erroAg) return NextResponse.json({ error: "Falha ao ler agências." }, { status: 500 });
  const agenciaId = (ags ?? [])[0]?.id as string | undefined;
  if (!agenciaId) return NextResponse.json({ error: `Agência ${sigla} não encontrada.` }, { status: 400 });

  const { data: dirRows, error: erroDir } = await db
    // Os MESMOS filtros de `getActiveDiretoresForVote`: cadastro não aprovado não casa nome.
    .from("diretores").select("id, nome, nome_variantes")
    .eq("agencia_id", agenciaId).eq("review_status", "aprovado");
  if (erroDir) return NextResponse.json({ error: "Falha ao ler diretores." }, { status: 500 });
  const diretoresList = (dirRows ?? []) as DiretorVoteRecord[];
  if (diretoresList.length === 0) {
    return NextResponse.json({ error: `Nenhum diretor aprovado em ${sigla}: sem cadastro não há a quem casar nome.` }, { status: 409 });
  }

  /**
   * ⚠️ `lerTudo` e não `.limit(N)`. O PostgREST corta em ~1000 e um `.limit(4000)` devolve 1000 em
   * silêncio — foi o que fez cinco telas subcontarem na Fase 24b.
   */
  const delibsRes = await lerTudo<any>(
    () => db.from("deliberacoes")
      .select("id, agencia_id, tipo_documento, documento_pai_id, resultado, data_reuniao, numero_reuniao")
      .eq("agencia_id", agenciaId).order("id"),
    "ausencias-artesp/deliberacoes");
  if (delibsRes.error) return NextResponse.json({ error: "Falha ao listar deliberações." }, { status: 500 });

  const candidatas = (delibsRes.data ?? []).filter((d: any) => {
    if (!isFinalDecisionRecord(d)) return false;
    if (ano && String(d.data_reuniao ?? "").slice(0, 4) !== ano) return false;
    return true;
  });

  // Os votos existentes, por par — para distinguir "não tem linha" de "tem linha inferida".
  const votosRes = await lerTudo<{ deliberacao_id: string; diretor_id: string; tipo_voto: string | null; is_nominal: boolean | null; proveniencia: string | null; motivo_nao_voto: string | null }>(
    () => db.from("votos").select("deliberacao_id, diretor_id, tipo_voto, is_nominal, proveniencia, motivo_nao_voto").order("id"),
    "ausencias-artesp/votos");
  if (votosRes.error) return NextResponse.json({ error: "Falha ao listar votos." }, { status: 500 });
  const votoPorPar = new Map<string, { tipo: string | null; nominal: boolean; motivo: string | null }>();
  for (const v of votosRes.data ?? []) {
    if (!v.deliberacao_id || !v.diretor_id) continue;
    votoPorPar.set(`${v.deliberacao_id}|${v.diretor_id}`, {
      tipo: v.tipo_voto, nominal: isVotoNominal(v), motivo: v.motivo_nao_voto,
    });
  }

  const lote = candidatas.slice(offset, offset + limite);
  const textos = new Map<string, string>();
  if (lote.length > 0) {
    const r = await lerEmLotes<any>(db, {
      tabela: "documentos_regulatorios",
      select: "deliberacao_id, texto_extraido",
      coluna: "deliberacao_id",
      valores: lote.map((d: any) => String(d.id)),
      label: "ausencias-artesp/textos",
    });
    for (const row of (r.data ?? []) as any[]) {
      if (!row.deliberacao_id || typeof row.texto_extraido !== "string") continue;
      textos.set(String(row.deliberacao_id), row.texto_extraido);
    }
  }

  let examinadas = 0;
  let semTexto = 0;
  let ausenciasNoTexto = 0;
  let aInserir = 0;
  let aPromover = 0;
  let nominaisPreservadas = 0;
  let jaCorretas = 0;
  let gravadas = 0;
  const falhas: string[] = [];
  const naoReconhecidos = new Map<string, number>();
  const detalhe: Array<{
    deliberacao_id: string; numero_reuniao: string | null;
    inserir: Array<{ nome: string; origem: string; trecho: string }>;
    promover: Array<{ nome: string; de: string | null; trecho: string }>;
    nominal_preservada: string[];
  }> = [];

  for (const d of lote as any[]) {
    if (!hasBudget(deadlineAt, 6_000)) break;
    examinadas++;
    const texto = textos.get(String(d.id));
    if (!texto) { semTexto++; continue; }

    const ausentes = extractAusentesComOrigem(texto);
    if (ausentes.length === 0) continue;

    const inserir: Array<{ nome: string; origem: string; trecho: string }> = [];
    const promover: Array<{ nome: string; de: string | null; trecho: string }> = [];
    const preservadas: string[] = [];
    /** Só estes nomes viram linha — e `buildVotoRows` não pode produzir mais que eles. */
    const nomesParaEscrever: string[] = [];

    for (const a of ausentes) {
      ausenciasNoTexto++;
      const m = findBestMatch(a.nome, diretoresList);
      if (!m.diretorId || m.needsReview) {
        // ⚠️ `needsReview` (0,6–0,85) conta como NÃO reconhecido: casou mal demais para virar voto.
        naoReconhecidos.set(a.nome, (naoReconhecidos.get(a.nome) ?? 0) + 1);
        continue;
      }
      const atual = votoPorPar.get(`${d.id}|${m.diretorId}`);
      const nome = diretoresList.find((x) => x.id === m.diretorId)?.nome ?? a.nome;
      if (!atual) {
        aInserir++;
        inserir.push({ nome, origem: a.origem, trecho: a.trecho });
        nomesParaEscrever.push(a.nome);
        continue;
      }
      if (atual.nominal) {
        // O documento já foi lido por alguém (ou por humano) para este par: não se toca.
        // ⚠️ Inclusive quando o nominal diz OUTRA coisa: divergir do nosso extrator não autoriza
        // sobrescrever leitura nominal — é caso de conferência humana, não de escrita automática.
        nominaisPreservadas++;
        preservadas.push(nome);
        continue;
      }
      if (atual.tipo === "Ausente" && atual.motivo) { jaCorretas++; continue; }
      // Linha INFERIDA (ou `Ausente` sem motivo): promover para a ausência LIDA é ganho de dado.
      aPromover++;
      promover.push({ nome, de: atual.tipo, trecho: a.trecho });
      nomesParaEscrever.push(a.nome);
    }

    if (detalhe.length < 40 && (inserir.length > 0 || promover.length > 0 || preservadas.length > 0)) {
      detalhe.push({
        deliberacao_id: String(d.id),
        numero_reuniao: (d.numero_reuniao as string | null) ?? null,
        inserir, promover, nominal_preservada: preservadas,
      });
    }

    if (dryRun || nomesParaEscrever.length === 0) continue;

    /**
     * ⚠️ A CHAMADA QUE NÃO PODE INFERIR NADA. `activeDiretoresList: []` e `inferFromMandate: false`
     * deixam `buildVotoRows` com um único caminho possível: linha `Ausente` para os nomes casados.
     * Se algum dia a assinatura mudar e isto passar a inferir, `etapa217` reprova.
     */
    const rows = buildVotoRows({
      deliberacao_id: String(d.id),
      nomes: [],
      nomesContra: [],
      nomesAusente: nomesParaEscrever,
      nomesAbstencao: [],
      nomesImpedido: [],
      diretoresList,
      activeDiretoresList: [],
      inferFromMandate: false,
      resultado: d.resultado ?? null,
      unanime: false,
    });
    const soAusentes = rows.filter((r) => r.tipo_voto === "Ausente");
    if (soAusentes.length !== rows.length) {
      // Recusa em voz alta em vez de gravar o que não foi pedido.
      falhas.push(`deliberação ${d.id}: buildVotoRows devolveu ${rows.length - soAusentes.length} linha(s) que não são Ausente`);
      continue;
    }
    const { error: upErr } = await upsertVotosProtegido(db, soAusentes);
    if (upErr) {
      if (falhas.length < 10) falhas.push(upErr.message);
      console.error("[ausencias-artesp] upsert falhou:", upErr.message);
    } else {
      gravadas += soAusentes.length;
    }
  }

  return NextResponse.json({
    dry_run: dryRun,
    sigla,
    ano,
    deliberacoes_candidatas: candidatas.length,
    deliberacoes_examinadas: examinadas,
    sem_texto_no_banco: semTexto,
    ausencias_no_texto: ausenciasNoTexto,
    linhas_a_inserir: aInserir,
    linhas_a_promover: aPromover,
    linhas_ja_corretas: jaCorretas,
    nominais_preservadas: nominaisPreservadas,
    linhas_gravadas: gravadas,
    falhas,
    /** Nome citado que o cadastro não reconhece — é o que o operador corrige antes de repetir. */
    nao_reconhecidos: [...naoReconhecidos.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 30).map(([nome, n]) => ({ nome, vezes: n })),
    detalhe,
    offset,
    // O próximo `offset` é o fim do que esta chamada EXAMINOU — se o orçamento cortou antes do fim
    // do lote, a continuação começa no primeiro não examinado, e nada é pulado.
    proximo_offset: offset + examinadas,
    restantes: candidatas.length > offset + examinadas,
    ...(dryRun ? { aviso: "Simulação — confira os trechos contra o PDF e repita com dry_run:false." } : {}),
  });
}
