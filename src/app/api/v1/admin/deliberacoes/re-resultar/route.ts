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
import { casarResultadoDoItem, contarReparos, type ItemDaAta } from "@/lib/server/re-resultar";

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
  const amostra: Array<{ id: string; numero: string | null; para: string }> = [];

  for (const [paiId, filhosDoPai] of porPai) {
    if (!hasBudget(deadlineAt, RESERVA_POR_PAI_MS)) { restantes = true; break; }

    // ⚠️ O join é pelo PAI: `documentos_regulatorios.deliberacao_id` aponta para a ata-MÃE, nunca
    // para o item. Buscar pelo id do filho devolveria "não há o que reparar" em 100% dos casos.
    const { data: doc } = await db
      .from("documentos_regulatorios")
      .select("id, ata_items")
      .eq("deliberacao_id", paiId)
      .maybeSingle();
    const itens = (doc?.ata_items ?? []) as ItemDaAta[];
    if (!Array.isArray(itens) || itens.length === 0) {
      semFonte += filhosDoPai.length;
      continue;
    }

    const comPatch = filhosDoPai
      .map((f) => ({ filho: f, patch: casarResultadoDoItem(f, itens) }))
      .filter((x) => x.patch !== null) as Array<{ filho: any; patch: NonNullable<ReturnType<typeof casarResultadoDoItem>> }>;

    for (const { filho, patch } of comPatch) {
      if (amostra.length < 20) {
        amostra.push({ id: filho.id, numero: filho.numero_deliberacao, para: patch.resultado });
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
