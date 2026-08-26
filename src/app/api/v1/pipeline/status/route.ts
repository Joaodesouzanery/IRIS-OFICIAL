/**
 * GET /api/v1/pipeline/status — o andamento da esteira, sem executá-la (Fase 7).
 *
 * Existia um buraco simples e caro: não havia como PERGUNTAR o que a esteira está fazendo. O
 * estado do "Rodar tudo" vivia num `useMutation` do navegador, então fechar a aba não perdia o
 * trabalho (cada rodada commita no banco) mas perdia toda a noção de progresso — e era isso que o
 * usuário via como "perde tudo". Pior: a única rota existente, `GET /pipeline/run`, EXECUTAVA a
 * esteira, então "consultar" era impossível sem disparar trabalho.
 *
 * Com esta rota a tela reabre, pergunta, e retoma o acompanhamento de onde parou.
 * Read-only por construção — a única escrita é o reaper de execuções órfãs, que é justamente o que
 * torna a leitura honesta (uma execução morta no SIGKILL não pode ficar para sempre como "em
 * andamento").
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { buscarRunAtiva, reaparRunsOrfas } from "@/lib/server/esteira-run";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    // Etapa65 — o ramo demo tem de ter TODAS as chaves do real; um consumidor que lê
    // `undefined` some em silêncio, porque o cast de `api.get<T>` não verifica nada.
    return NextResponse.json({ modo: "demo", em_andamento: false, run: null, ultima: null });
  }
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  await reaparRunsOrfas(db);
  const ativa = await buscarRunAtiva(db);

  // Última execução encerrada — é o que a tela mostra quando não há nada rodando (inclusive o
  // desfecho de um disjuntor aberto, que o usuário precisa ver mesmo tendo fechado a aba).
  let ultima = null;
  try {
    const { data } = await db
      .from("esteira_runs")
      .select("id, status, origem, rodadas, contadores, passos_ok, passos_erro, motivo_parada, iniciado_em, concluido_em")
      .neq("status", "running")
      .order("iniciado_em", { ascending: false })
      .limit(1)
      .maybeSingle();
    ultima = data ?? null;
  } catch {
    // Sem a migration `20260826130000`, não há histórico — a esteira roda, só não lembra.
  }

  return NextResponse.json({
    em_andamento: Boolean(ativa),
    run: ativa,
    ultima,
  });
}
