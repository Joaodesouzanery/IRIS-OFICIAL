import { NextRequest, NextResponse } from "next/server";
import { calcularMandato } from "@/lib/mandatos";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { isDemo } from "@/lib/server/is-demo";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { budgetFromRequest, hasBudget } from "@/lib/server/time-budget";

export async function POST(req: NextRequest) {
  return recalculate(req);
}

export async function GET(req: NextRequest) {
  return recalculate(req);
}

async function recalculate(req: NextRequest) {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;
  if (isDemo()) return NextResponse.json({ error: "Recálculo indisponível em modo demo" }, { status: 403 });

  // Fase 10 — esta rota IGNORAVA o `budget_ms` que o orquestrador manda na URL, e era a que
  // ignorava mais caro: o SELECT não tinha limite nenhum e o laço escrevia DUAS vezes por linha.
  //
  // A esteira encadeia ~12 sub-rotas na MESMA invocação, repartindo um orçamento único. Uma
  // sub-rota que não lê a própria fatia trabalha até acabar o que tem para fazer, e a rodada
  // estoura o relógio — o "A requisição passou de 90s sem resposta" que a tela mostrou. Agora
  // ela para no saldo e DIZ que ficou parcial, para o orquestrador voltar.
  const deadlineAt = Date.now() + budgetFromRequest(req);
  // Duas escritas por mandato: ~600ms no pior caso realista.
  const RESERVA_POR_MANDATO_MS = 800;

  const db = createSupabaseServerClient();
  // O SELECT não tinha limite nenhum — a rota lia a tabela inteira e escrevia 2× por linha.
  const { data: mandatos, error } = await db
    .from("mandatos")
    .select("id, diretor_id, data_inicio, data_fim")
    .order("updated_at", { ascending: true, nullsFirst: true })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: "Erro ao listar mandatos" }, { status: 500 });
  }

  let updated = 0;
  let parcial = false;
  for (const mandato of mandatos ?? []) {
    if (!hasBudget(deadlineAt, RESERVA_POR_MANDATO_MS)) { parcial = true; break; }
    const calc = calcularMandato(mandato.data_inicio, mandato.data_fim);
    await db
      .from("mandatos")
      .update({
        percentual_mandato_concluido: calc.percentualConcluido,
        updated_at: new Date().toISOString(),
      })
      .eq("id", mandato.id);

    await db
      .from("diretores")
      .update({
        percentual_mandato_concluido: calc.percentualConcluido,
        updated_at: new Date().toISOString(),
      })
      .eq("id", mandato.diretor_id);
    updated++;
  }

  return NextResponse.json({ updated, ...(parcial ? { parcial, restantes: true } : {}) });
}
