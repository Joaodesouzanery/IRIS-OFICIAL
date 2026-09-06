/**
 * POST /api/v1/admin/deliberacoes/re-resultar[?dry_run=0]
 *
 * Repara os itens de ata que ficaram sem `resultado` — 232 medidos em produção (232 ANM + 35 da
 * ANTT, sendo que os 35 são filhos de PAUTA e NÃO entram aqui).
 *
 * ═══ Por que existe, e por que NÃO é conserto de extrator ═══
 * Medi antes de escrever: `splitAtaItemsWithStats` sobre as 4 atas reais da ANM no repo dá 305
 * itens com `semResultado = 0`, e os 10 itens exatos da amostra de produção saem certos hoje.
 * O extrator está bom; os 232 são passivo de um build anterior às correções de 24/08. Reparo.
 *
 * ═══ Por que isso destrava VOTO ═══
 * `materializar-faltantes` exige `documento_pai_id && resultado` para um item de ata virar linha
 * em `votos`. Enquanto `resultado` for NULL eles são invisíveis para o materializador E para o
 * denominador das métricas. Preencher o campo é o que põe os votos no banco.
 *
 * Read-mostly: `dry_run` é o PADRÃO (só conta e devolve amostra). Admin ou cron.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { hasBudget, budgetFromRequest } from "@/lib/server/time-budget";
import {
  contarReparos,
  repararItem,
  type DegrauDeReparo,
  type ItemDaAta,
  type PatchDeReparo,
} from "@/lib/server/re-resultar";
import { splitAtaItemsWithStats } from "@/lib/server/ata-splitter";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Ler o pai, casar e gravar: 2-3 round-trips por lote de filhos do MESMO pai. */
const RESERVA_POR_PAI_MS = 4_000;

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    // Etapa65 — o ramo demo carrega TODAS as chaves do real; consumidor que lê `undefined` some.
    return NextResponse.json({
      modo: "demo", dry_run: true, candidatos: 0, reparadas: 0, falhas: 0,
      sem_fonte: 0, restantes: false, amostra: [],
    });
  }
  const guard = await requireAdminOrCron(req, "re-resultar");
  if (guard) return guard;

  const dryRun = req.nextUrl.searchParams.get("dry_run") !== "0";
  const deadlineAt = Date.now() + budgetFromRequest(req);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Os filhos reparáveis. `PAUTA-%` fora por predicado — cinto e suspensório com a recusa que
  // `casarResultadoDoItem` já faz: fabricar voto de agenda é o erro que esta fase acabou de matar.
  const { data: filhos, error } = await db
    .from("deliberacoes")
    .select("id, item_numero, numero_deliberacao, resultado, resumo_pleito, documento_pai_id")
    .eq("tipo_documento", "ata")
    .not("documento_pai_id", "is", null)
    .is("resultado", null)
    .not("numero_deliberacao", "like", "PAUTA-%")
    .limit(500);
  if (error) {
    return NextResponse.json({ error: `Falha ao listar itens: ${error.message}` }, { status: 500 });
  }

  const porPai = new Map<string, any[]>();
  for (const f of (filhos ?? []) as any[]) {
    const pai = String(f.documento_pai_id);
    porPai.set(pai, [...(porPai.get(pai) ?? []), f]);
  }

  let reparadas = 0;
  let falhas = 0;
  let semFonte = 0;
  let restantes = false;
  /**
   * Fase 20 — a rota vira a PRÓPRIA medição (não há MCP nesta sessão). O contador por degrau diz
   * qual fonte resolveu, e `semCasamento` isola o único risco que sobrou: se o `item_numero` da
   * safra velha não casar com o do splitter atual, o reparo volta a devolver 0 — e sem este
   * contador voltaria com a MESMA cara saudável de antes.
   */
  const porDegrau: Record<DegrauDeReparo, number> = { array: 0, ligadura: 0, resplit: 0 };
  let semCasamento = 0;
  const amostra: Array<{ id: string; numero: string | null; para: string; degrau: DegrauDeReparo }> = [];

  for (const [paiId, filhosDoPai] of porPai) {
    if (!hasBudget(deadlineAt, RESERVA_POR_PAI_MS)) { restantes = true; break; }

    // ⚠️ O join é pelo PAI: `documentos_regulatorios.deliberacao_id` aponta para a ata-MÃE, nunca
    // para o item. Buscar pelo id do filho devolveria "não há o que reparar" em 100% dos casos.
    //
    // Fase 20 — `texto_extraido` entra no SELECT. A versão anterior lia SÓ `ata_items`, que é o
    // mesmo array que gerou os filhos: filho sem resultado ⇒ array sem resultado ⇒ ZERO reparos,
    // devolvendo `reparadas: 0, sem_fonte: 0`. A coluna do texto é o que permite re-splitar com o
    // splitter ATUAL — e a blindagem do requeue (Fase 19) é o que garante que ela ainda existe.
    const { data: doc } = await db
      .from("documentos_regulatorios")
      .select("id, ata_items, texto_extraido")
      .eq("deliberacao_id", paiId)
      .maybeSingle();
    const itensDoArray = (Array.isArray(doc?.ata_items) ? doc?.ata_items : []) as ItemDaAta[];
    const texto = typeof doc?.texto_extraido === "string" ? doc.texto_extraido : "";
    if (itensDoArray.length === 0 && !texto) {
      semFonte += filhosDoPai.length;
      continue;
    }

    // Re-split UMA vez por pai (2,62 ms para 8 atas — o custo é ler a coluna, não splitar), e só
    // quando há texto. O resultado serve a todos os filhos deste pai.
    const itensDoResplit: ItemDaAta[] = texto
      ? (splitAtaItemsWithStats(texto).items as unknown as ItemDaAta[])
      : [];

    const comPatch: Array<{ filho: any; patch: PatchDeReparo; degrau: DegrauDeReparo }> = [];
    for (const f of filhosDoPai) {
      const r = repararItem(f, { itensDoArray, itensDoResplit });
      if (!r) {
        // Distinguir "não casou" de "nada a fazer" é o que impede o zero silencioso de voltar
        // com outra cara: se o `item_numero` da safra velha não existe no splitter atual, é AQUI
        // que aparece — e é o único risco que sobrou depois deste commit.
        if (!f.resultado && !(f.numero_deliberacao ?? "").startsWith("PAUTA-")) semCasamento++;
        continue;
      }
      comPatch.push({ filho: f, patch: r.patch, degrau: r.degrau });
      porDegrau[r.degrau]++;
      if (amostra.length < 20) {
        amostra.push({ id: f.id, numero: f.numero_deliberacao, para: r.patch.resultado, degrau: r.degrau });
      }
    }

    if (dryRun) { reparadas += comPatch.length; continue; }

    // O contador NÃO pode mentir para cima: `supabase-js` devolve {error} em vez de lançar.
    const r = await contarReparos(comPatch, async ({ filho, patch }) => {
      const { error: erroEscrita } = await db.from("deliberacoes").update(patch).eq("id", filho.id);
      return { error: erroEscrita ? { message: erroEscrita.message } : null };
    });
    reparadas += r.reparadas;
    falhas += r.falhas;
  }

  return NextResponse.json({
    dry_run: dryRun,
    candidatos: (filhos ?? []).length,
    reparadas,
    reparadas_por_array: porDegrau.array,
    reparadas_por_ligadura: porDegrau.ligadura,
    reparadas_por_resplit: porDegrau.resplit,
    /** Filho pendente que nenhum degrau alcançou — o veredito do risco de numeração. */
    sem_casamento: semCasamento,
    falhas,
    sem_fonte: semFonte,
    restantes,
    amostra,
    notice:
      "Repara `resultado` de item de ata casando `item_numero` contra os `ata_items` do documento PAI. " +
      "Nunca sobrescreve valor existente e nunca toca filho de PAUTA. Depois deste passo, " +
      "`materializar-faltantes` transforma os itens reparados em votos.",
  });
}
