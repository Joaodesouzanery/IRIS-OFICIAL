/**
 * GET /api/v1/admin/monitoramento/nao-enfileirados
 *
 * Diagnóstico do elo coleta→fila (QA ago/2026, "208 detectados / 0 processados"):
 * responde ONDE os itens detectados estão parados, sem filtro de data:
 *  - monitoramento_itens por agência × tipo × status (novo/ignorado/importado…),
 *    com amostra de url_item + motivo (metadata.enqueue_motivo/captura_erro);
 *  - documentos_regulatorios `failed` com error_message (extração que quebrou).
 * Read-only, admin/cron.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { podeVirarVoto } from "@/lib/esteira-tipos";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    // Etapa65 — o ramo demo tem de ter TODOS os campos do real. Faltava `total_nao_enfileirados`,
    // e como o cast de `api.get<T>` não verifica nada, o consumidor lia `undefined` e o painel
    // sumia em silêncio. Os ramos demo são alcançáveis em produção: `attachRuntimeHeaders` injeta
    // `x-iris-demo: 1` a partir do localStorage.
    return NextResponse.json({
      modo: "demo",
      total_nao_enfileirados: 0,
      total_na_esteira_votos: 0,
      total_fora_da_esteira_votos: 0,
      total_arquivados: 0,
      total_arquivados_recuperaveis: 0,
      grupos: [],
      falhas_extracao: [],
    });
  }
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const [agenciasRes, itensRes, failedRes] = await Promise.all([
    db.from("agencias").select("id, sigla"),
    db.from("monitoramento_itens")
      .select("agencia_id, tipo, status, url_item, titulo, metadata, data_reuniao")
      .in("status", ["novo", "ignorado"])
      .order("last_seen_at", { ascending: false })
      .limit(4000),
    db.from("documentos_regulatorios")
      .select("id, agencia_id, filename, status, error_message, updated_at")
      .in("status", ["failed", "queued", "processing"])
      .order("updated_at", { ascending: false })
      .limit(300),
  ]);

  const sigla = new Map<string, string>((agenciasRes.data ?? []).map((a: any) => [a.id, a.sigla]));
  const nomeAg = (id: string | null) => (id ? sigla.get(id) ?? "?" : "?");

  // Agrupa agência × tipo × status × MOTIVO, com amostra de até 5 URLs por grupo.
  // Fase 8: o motivo entrou na CHAVE. Um item arquivado por `download_falhou` (falha transitória
  // de rede — recuperável) e um arquivado por `sem_pdf` (a página não tinha PDF de decisão) são
  // coisas diferentes, e somá-los num grupo só impedia justamente a pergunta que importa: quanto
  // do que saiu da fila dá para recuperar?
  type Grupo = { agencia: string; tipo: string; status: string; motivo: string | null; total: number; amostra: Array<{ url: string; titulo: string | null; motivo: string | null }> };
  const grupos = new Map<string, Grupo>();
  for (const it of (itensRes.data ?? []) as any[]) {
    const metaIt = (it.metadata ?? {}) as Record<string, unknown>;
    const motivoItem = typeof metaIt.enqueue_motivo === "string" ? metaIt.enqueue_motivo : null;
    const key = `${nomeAg(it.agencia_id)}|${it.tipo}|${it.status}|${motivoItem ?? "-"}`;
    const g = grupos.get(key) ?? { agencia: nomeAg(it.agencia_id), tipo: String(it.tipo), status: String(it.status), motivo: motivoItem, total: 0, amostra: [] };
    g.total += 1;
    if (g.amostra.length < 5) {
      const meta = (it.metadata ?? {}) as Record<string, unknown>;
      const motivo = typeof meta.enqueue_motivo === "string"
        ? meta.enqueue_motivo
        : typeof meta.captura_erro === "string" ? `erro: ${meta.captura_erro}` : null;
      g.amostra.push({ url: String(it.url_item ?? ""), titulo: it.titulo ?? null, motivo });
    }
    grupos.set(key, g);
  }

  const falhasExtracao = ((failedRes.data ?? []) as any[]).map((d) => ({
    documento_id: d.id,
    agencia: nomeAg(d.agencia_id),
    filename: d.filename,
    status: d.status,
    erro: d.error_message ?? null,
    atualizado_em: d.updated_at,
  }));

  const novos = [...grupos.values()].filter((g) => g.status === "novo");
  const totalNovo = novos.reduce((s, g) => s + g.total, 0);
  // Fase 7 — SEPARAR POR DESTINO (decisão do usuário). O número único misturava o que a esteira
  // de votos vai processar com o que ela NUNCA processará: `noticia`, `politica_publica` e
  // `consulta_publica` não são decisão colegiada, e `diretoria` é página institucional. Contá-los
  // juntos fazia "676 detectados" parecer trabalho pendente da esteira quando ~43% nunca seria.
  // ⚠️ Os itens NÃO são apagados: os de notícia alimentam o gerador de Documentos de Associados.
  // O que muda é o que o número SIGNIFICA — "trabalho de voto que falta", não "descoberto bruto".
  const naEsteira = novos.filter((g) => podeVirarVoto(g.tipo)).reduce((s, g) => s + g.total, 0);

  // Fase 8 — os ARQUIVADOS deixam de ser invisíveis. Esta rota sempre os buscou (`ignorado` está
  // no `.in(...)` acima) e a tela filtrava só `novo`: o motivo era gravado e ninguém via. É o
  // mesmo padrão que a fase anterior combateu — o dado existe, a tela não conta.
  const arquivados = [...grupos.values()].filter((g) => g.status === "ignorado");
  const totalArquivado = arquivados.reduce((s, g) => s + g.total, 0);
  // `download_falhou` é falha de REDE: o portal pode voltar, e o item volta a ser tentado.
  // `sem_pdf` é decisão de CONTEÚDO: a página não tinha PDF de decisão quando foi lida.
  const arquivadosRecuperaveis = arquivados
    // Fase 17 — `waf_desafio` é recuperável pela mesma razão: o portal pode liberar. ⚠️ Este
    // número SOBE no dia do deploy sem que nada novo tenha sido recuperado — é reclassificação
    // do que já estava arquivado, não recuperação.
    .filter((g) => g.motivo === "download_falhou" || g.motivo === "waf_desafio")
    .reduce((s, g) => s + g.total, 0);

  return NextResponse.json({
    total_nao_enfileirados: totalNovo,
    total_na_esteira_votos: naEsteira,
    total_fora_da_esteira_votos: totalNovo - naEsteira,
    total_arquivados: totalArquivado,
    total_arquivados_recuperaveis: arquivadosRecuperaveis,
    grupos: [...grupos.values()].sort((a, b) => b.total - a.total),
    falhas_extracao: falhasExtracao,
  });
}
