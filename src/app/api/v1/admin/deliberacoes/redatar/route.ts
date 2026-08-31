/**
 * POST /api/v1/admin/deliberacoes/redatar[?dry_run=0]
 *
 * Re-deriva a `data_reuniao` das deliberações cuja data é IMPOSSÍVEL para a agência — anterior ao
 * ano em que ela foi criada.
 *
 * ═══ Por que existe ═══
 * Produção tinha 38 deliberações da ANM datadas de antes de 2017 (32 delas em 1996, numa única
 * "reunião"). A causa era um fallback sem âncora que pescava a data da LEI citada no preâmbulo
 * ("Lei nº 9.314, de 14 de novembro de 1996") — corrigido no commit anterior. Este passo cuida do
 * PASSIVO: o parser novo já não erra, mas as linhas erradas continuam lá.
 *
 * ═══ Por que RE-DERIVAR, e não anular ═══
 * O PDF continua no Storage e o texto extraído continua na coluna. Anular a data seria PIOR que
 * deixar 1996: `year-filter` conta deliberação sem data em TODOS os anos, então as 38 sairiam de
 * um limbo silencioso para inflar todo exercício. Re-derivar é a única opção que devolve dado
 * certo em vez de espalhar o erro. Só o resíduo irrecuperável vira NULL — e nunca NULL sozinho:
 * sempre com marcador de revisão.
 *
 * Read-mostly e idempotente: `dry_run` (padrão) só conta. Admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { hasBudget, budgetFromRequest } from "@/lib/server/time-budget";
import { dataReuniaoPlausivel } from "@/lib/server/colegiado-sources";
import { extractAnmMeetingMetadata } from "@/lib/server/regulatory-documents";
import { extractDataReuniaoAncorada } from "@/lib/server/nlp-extractor";
import { ensureReuniao } from "@/lib/server/reunioes";

export const dynamic = "force-dynamic";
// Fase 12 — 60 → 120: esta rota honra `budget_ms`/HOBBY_BUDGET_MS (70s); declarar 60 aqui
// pediria o kill da plataforma ANTES de o próprio orçamento parar o trabalho. 120 é o valor
// que pipeline/run e o vercel.json já declaram e que os builds já provaram.
export const maxDuration = 120;

/** Saldo para tratar UMA deliberação (buscar texto, reparsear, gravar, reconciliar a reunião). */
const RESERVA_POR_LINHA_MS = 4_000;

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    // Etapa65 — o ramo demo carrega TODAS as chaves do real; consumidor que lê `undefined` some.
    return NextResponse.json({
      modo: "demo", dry_run: true, candidatas: 0, corrigidas: 0,
      sem_data_recuperavel: 0, reunioes_orfas_removidas: 0, restantes: false, amostra: [],
      nulas_candidatas: 0, nulas_corrigidas: 0, nulas_marcadas_revisao: 0,
    });
  }
  const guard = await requireAdminOrCron(req, "redatar");
  if (guard) return guard;

  const dryRun = req.nextUrl.searchParams.get("dry_run") !== "0";
  const deadlineAt = Date.now() + budgetFromRequest(req);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: agencias } = await db.from("agencias").select("id, sigla");
  const siglaPorId = new Map(((agencias ?? []) as Array<{ id: string; sigla: string }>).map((a) => [a.id, a.sigla]));

  // A janela é pequena por construção — data implausível é exceção, não regra.
  const { data: linhas, error } = await db
    .from("deliberacoes")
    .select("id, agencia_id, numero_reuniao, tipo_reuniao, data_reuniao, raw_extraction")
    .not("data_reuniao", "is", null)
    .order("data_reuniao", { ascending: true })
    .limit(500);
  if (error) {
    return NextResponse.json({ error: `Falha ao listar deliberações: ${error.message}` }, { status: 500 });
  }

  const candidatas = ((linhas ?? []) as any[]).filter((d) => {
    const sigla = d.agencia_id ? siglaPorId.get(d.agencia_id) ?? null : null;
    return !dataReuniaoPlausivel(sigla, d.data_reuniao).plausivel;
  });

  let corrigidas = 0;
  let semDataRecuperavel = 0;
  let restantes = false;
  const amostra: Array<{ id: string; agencia: string | null; de: string; para: string | null }> = [];

  for (const d of candidatas) {
    if (!hasBudget(deadlineAt, RESERVA_POR_LINHA_MS)) { restantes = true; break; }
    const sigla = d.agencia_id ? siglaPorId.get(d.agencia_id) ?? null : null;

    // Fonte do texto, em ordem de qualidade: o documento (texto íntegro) e, se ele não existir
    // mais, o que a própria deliberação guardou.
    let texto = "";
    const { data: doc } = await db
      .from("documentos_regulatorios")
      .select("texto_extraido, filename")
      .eq("deliberacao_id", d.id)
      .maybeSingle();
    if (doc?.texto_extraido) texto = String(doc.texto_extraido);
    if (!texto) {
      const raw = (d.raw_extraction ?? {}) as Record<string, unknown>;
      texto = String(raw.raw_text ?? raw.texto_trecho ?? "");
    }

    // SÓ o caminho ancorado — DE VERDADE (Fase 15). A primeira versão dizia isso e chamava
    // `extractFields`, cujos parsers têm fallback "primeira data do documento": o mecanismo
    // exato do 1996, e `dataReuniaoPlausivel` não segura uma lei de 2019 citada num ato de 2026.
    let nova: string | null = null;
    if (texto) {
      const anm = extractAnmMeetingMetadata(texto, String(doc?.filename ?? ""));
      nova = anm.data_reuniao ?? extractDataReuniaoAncorada(texto) ?? null;
      // A data re-derivada passa pelo MESMO guard: se ela também for impossível, não serve.
      if (nova && !dataReuniaoPlausivel(sigla, nova).plausivel) nova = null;
    }

    if (amostra.length < 20) {
      amostra.push({ id: d.id as string, agencia: sigla, de: String(d.data_reuniao), para: nova });
    }
    if (dryRun) { nova ? corrigidas++ : semDataRecuperavel++; continue; }

    if (nova) {
      const reuniaoId = await ensureReuniao(db, {
        agenciaId: (d.agencia_id as string | null) ?? "",
        numeroReuniao: (d.numero_reuniao as string | null) ?? null,
        dataReuniao: nova,
        tipoReuniao: (d.tipo_reuniao as string | null) ?? null,
      });
      await db.from("deliberacoes").update({
        data_reuniao: nova,
        ...(reuniaoId ? { reuniao_id: reuniaoId } : {}),
      }).eq("id", d.id);
      corrigidas++;
    } else {
      // NULL nunca sozinho: sem o marcador, a linha entraria silenciosamente em TODOS os anos
      // (`year-filter` trata data ausente como "serve para qualquer filtro").
      const raw = (d.raw_extraction ?? {}) as Record<string, unknown>;
      await db.from("deliberacoes").update({
        data_reuniao: null,
        raw_extraction: {
          ...raw,
          data_invalidada_em: new Date().toISOString(),
          data_invalidada_valor: d.data_reuniao,
          data_invalidada_motivo: "anterior à criação da agência; texto não permitiu re-derivar",
          precisa_revisao_data: true,
        },
      }).eq("id", d.id);
      semDataRecuperavel++;
    }
  }

  // ═══ Fase 15 — a SEGUNDA janela: `data_reuniao` NULL ═══════════════════════
  // O QA da Fase 14 mediu 74 (66 ANTT + 8 ARTESP). Elas estavam fora desta rota POR CONSTRUÇÃO
  // (o `.not(...is null)` acima) — e são o pior dos dois mundos na tela: somem da listagem e
  // das reuniões, e INFLAM as agregações de todo ano (year-filter deixa passar quem não tem
  // data nenhuma). Fontes ANCORADAS, em ordem de confiança: a reunião já vinculada → a data que
  // o crawl leu na PÁGINA de listagem (monitoramento_itens, mantida fresca pelo auto-reparador)
  // → o texto do documento pelo caminho ancorado. Nada de fallback; quem continuar sem data
  // ganha `precisa_revisao_data` UMA vez e sai da janela (idempotência).
  let nulasCandidatas = 0;
  let nulasCorrigidas = 0;
  let nulasMarcadas = 0;
  {
    const { data: nulasRaw } = await db
      .from("deliberacoes")
      .select("id, agencia_id, numero_reuniao, tipo_reuniao, reuniao_id, raw_extraction")
      .is("data_reuniao", null)
      .limit(300);
    const nulas = ((nulasRaw ?? []) as any[]).filter(
      (d) => !((d.raw_extraction ?? {}) as Record<string, unknown>).precisa_revisao_data,
    );
    nulasCandidatas = nulas.length;

    for (const d of nulas) {
      if (!hasBudget(deadlineAt, RESERVA_POR_LINHA_MS)) { restantes = true; break; }
      const sigla = d.agencia_id ? siglaPorId.get(d.agencia_id) ?? null : null;
      let nova: string | null = null;

      // (a) A reunião já vinculada — se o vínculo existe, a data dele é a melhor evidência.
      if (d.reuniao_id) {
        const { data: r } = await db.from("reunioes").select("data_reuniao").eq("id", d.reuniao_id).maybeSingle();
        nova = (r?.data_reuniao as string | null) ?? null;
      }

      // (b) O item de monitoramento que originou o documento — a data veio do parse da página.
      const { data: doc } = await db
        .from("documentos_regulatorios")
        .select("id, texto_extraido, filename")
        .eq("deliberacao_id", d.id)
        .maybeSingle();
      if (!nova && doc?.id) {
        const { data: itens } = await db
          .from("monitoramento_itens")
          .select("data_reuniao")
          .eq("documento_id", doc.id)
          .not("data_reuniao", "is", null)
          .limit(1);
        nova = ((itens ?? [])[0]?.data_reuniao as string | null) ?? null;
      }

      // (c) O texto, SÓ pelo caminho ancorado — mesmo contrato da janela de implausíveis.
      if (!nova) {
        let texto = doc?.texto_extraido ? String(doc.texto_extraido) : "";
        if (!texto) {
          const raw = (d.raw_extraction ?? {}) as Record<string, unknown>;
          texto = String(raw.raw_text ?? raw.texto_trecho ?? "");
        }
        if (texto) {
          const anm = extractAnmMeetingMetadata(texto, String(doc?.filename ?? ""));
          nova = anm.data_reuniao ?? extractDataReuniaoAncorada(texto) ?? null;
        }
      }

      if (nova && !dataReuniaoPlausivel(sigla, nova).plausivel) nova = null;

      if (amostra.length < 20) {
        amostra.push({ id: d.id as string, agencia: sigla, de: "(sem data)", para: nova });
      }
      if (dryRun) { nova ? nulasCorrigidas++ : nulasMarcadas++; continue; }

      if (nova) {
        const reuniaoId = await ensureReuniao(db, {
          agenciaId: (d.agencia_id as string | null) ?? "",
          numeroReuniao: (d.numero_reuniao as string | null) ?? null,
          dataReuniao: nova,
          tipoReuniao: (d.tipo_reuniao as string | null) ?? null,
        });
        await db.from("deliberacoes").update({
          data_reuniao: nova,
          ...(reuniaoId ? { reuniao_id: reuniaoId } : {}),
        }).eq("id", d.id);
        nulasCorrigidas++;
      } else {
        // Marcador UMA vez: sem ele a linha voltaria a esta janela em toda rodada da esteira.
        const raw = (d.raw_extraction ?? {}) as Record<string, unknown>;
        await db.from("deliberacoes").update({
          raw_extraction: {
            ...raw,
            data_ausente_motivo: "sem data na origem; nenhuma fonte ancorada permitiu derivar",
            precisa_revisao_data: true,
          },
        }).eq("id", d.id);
        nulasMarcadas++;
      }
    }
  }

  // As linhas de `reunioes` com data impossível nunca foram reunião: são artefato do mesmo parse,
  // e são o que faz a tela de Reuniões listar "reunião da ANM em 1996". É tabela de rollup
  // derivada, não dado primário — aqui o DELETE é o certo, e só depois de as deliberações terem
  // sido religadas (acima) para nenhuma ficar apontando para o que vai sumir.
  let reunioesOrfas = 0;
  if (!dryRun && hasBudget(deadlineAt, 3_000)) {
    const { data: rs } = await db.from("reunioes").select("id, agencia_id, data_reuniao").limit(2000);
    const alvo = ((rs ?? []) as any[]).filter((r) => {
      const sigla = r.agencia_id ? siglaPorId.get(r.agencia_id) ?? null : null;
      return r.data_reuniao && !dataReuniaoPlausivel(sigla, r.data_reuniao).plausivel;
    });
    for (const r of alvo) {
      const { count } = await db
        .from("deliberacoes")
        .select("id", { count: "exact", head: true })
        .eq("reuniao_id", r.id);
      if ((count ?? 0) > 0) continue; // ainda tem filho: não é órfã, não se apaga
      await db.from("reunioes").delete().eq("id", r.id);
      reunioesOrfas++;
    }
  }

  return NextResponse.json({
    dry_run: dryRun,
    candidatas: candidatas.length,
    corrigidas,
    sem_data_recuperavel: semDataRecuperavel,
    reunioes_orfas_removidas: reunioesOrfas,
    nulas_candidatas: nulasCandidatas,
    nulas_corrigidas: nulasCorrigidas,
    nulas_marcadas_revisao: nulasMarcadas,
    restantes,
    amostra,
    notice:
      "Re-deriva a data SÓ pelo caminho ancorado. Data não recuperável vira NULL com marcador de revisão — nunca NULL silencioso, porque deliberação sem data é contada em todos os anos.",
  });
}
