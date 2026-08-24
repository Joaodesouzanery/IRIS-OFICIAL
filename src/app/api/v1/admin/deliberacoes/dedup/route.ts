/**
 * POST /api/v1/admin/deliberacoes/dedup[?dry_run=0]
 * Auditoria e limpeza de deliberações duplicadas ACUMULADAS (antes do dedup na
 * importação da Etapa 14): grupos com a MESMA (agencia, numero_deliberacao) no
 * mesmo ano — entre registros finais — ou (agencia, processo, data_reuniao).
 * dry_run (padrão) só LISTA; com dry_run=0 funde: mantém a mais antiga, migra
 * os votos (sem duplicar por diretor) e apaga as cópias. Admin explícito.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";
import { TIPOS_NAO_FINAIS_SET } from "@/lib/server/regulatory-documents";

export const dynamic = "force-dynamic";

const TIPOS_APOIO = TIPOS_NAO_FINAIS_SET; // fonte única (etapa65)

type DelibRow = {
  id: string;
  agencia_id: string;
  numero_deliberacao: string | null;
  processo: string | null;
  data_reuniao: string | null;
  tipo_documento: string | null;
  item_numero: string | null;
  created_at: string;
};

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;
  if (isDemo()) {
    return NextResponse.json({ error: "Indisponível em modo DEMO." }, { status: 403 });
  }

  const dryRun = req.nextUrl.searchParams.get("dry_run") !== "0";

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data, error } = await db
    .from("deliberacoes")
    .select("id, agencia_id, numero_deliberacao, processo, data_reuniao, tipo_documento, item_numero, created_at")
    .limit(20000);
  if (error) {
    return NextResponse.json({ error: "Erro ao listar deliberações" }, { status: 500 });
  }

  const finais = (data ?? []).filter(
    (d: DelibRow) => !TIPOS_APOIO.has(d.tipo_documento ?? ""),
  ) as DelibRow[];

  // Agrupamento por chave forte: numero (por ano) OU processo+data.
  const grupos = new Map<string, DelibRow[]>();
  for (const d of finais) {
    const ano = d.data_reuniao ? d.data_reuniao.slice(0, 4) : "?";
    const key = d.numero_deliberacao
      ? `n|${d.agencia_id}|${d.numero_deliberacao}|${ano}`
      : d.processo && d.data_reuniao
        ? `p|${d.agencia_id}|${d.processo}|${d.data_reuniao}`
        : null;
    if (!key) continue;
    grupos.set(key, [...(grupos.get(key) ?? []), d]);
  }

  const duplicados = [...grupos.entries()].filter(([, rows]) => rows.length > 1);
  const relatorio: Array<{ chave: string; mantida: string; removidas: string[]; votos_migrados?: number }> = [];
  let removidasTotal = 0;

  for (const [chave, rows] of duplicados) {
    const ordenadas = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const mantida = ordenadas[0];
    const copias = ordenadas.slice(1);
    const entry = { chave, mantida: mantida.id, removidas: copias.map((c) => c.id) } as (typeof relatorio)[number];

    if (!dryRun) {
      let votosMigrados = 0;
      const { data: votosMantida } = await db
        .from("votos").select("diretor_id").eq("deliberacao_id", mantida.id).limit(1000);
      const diretoresComVoto = new Set((votosMantida ?? []).map((v) => v.diretor_id));

      for (const copia of copias) {
        const { data: votosCopia } = await db
          .from("votos").select("id, diretor_id").eq("deliberacao_id", copia.id).limit(1000);
        for (const voto of votosCopia ?? []) {
          if (diretoresComVoto.has(voto.diretor_id)) {
            await db.from("votos").delete().eq("id", voto.id);
          } else {
            const { error: updErr } = await db
              .from("votos").update({ deliberacao_id: mantida.id }).eq("id", voto.id);
            if (!updErr) {
              diretoresComVoto.add(voto.diretor_id);
              votosMigrados++;
            }
          }
        }
        // Filhos de ata apontando para a cópia seguem a mantida.
        await db.from("deliberacoes").update({ documento_pai_id: mantida.id }).eq("documento_pai_id", copia.id);
        await db.from("deliberacoes").delete().eq("id", copia.id);
        removidasTotal++;
      }
      entry.votos_migrados = votosMigrados;
    }
    relatorio.push(entry);
  }

  return NextResponse.json({
    dry_run: dryRun,
    grupos_duplicados: duplicados.length,
    deliberacoes_em_dobro: duplicados.reduce((sum, [, rows]) => sum + rows.length - 1, 0),
    removidas: dryRun ? 0 : removidasTotal,
    relatorio: relatorio.slice(0, 200),
    ...(dryRun ? { notice: "Somente auditoria. Repita com ?dry_run=0 para fundir de verdade." } : {}),
  });
}
