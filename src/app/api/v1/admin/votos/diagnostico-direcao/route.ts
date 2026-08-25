/**
 * GET /api/v1/admin/votos/diagnostico-direcao
 *
 * READ-ONLY. Não escreve nada, não tem `?dry_run`, não tem ramo de aplicação.
 *
 * ═══ Por que existe ═══
 *
 * A etapa65 corrigiu uma INVERSÃO DE SINAL: nas atas da ANM, "divergente" qualifica divergência
 * DO RELATOR, e essa posição frequentemente VENCE — o extrator gravava voto CONTRÁRIO de quem
 * ganhou. A correção (`extractAutoresDoVotoAprovado`) vale para reprocessamento e **não retroage**:
 * as linhas já no banco seguem com o sinal invertido.
 *
 * Esta rota não é só prudência antes de escrever — **é a VERIFICAÇÃO de que a correção funciona em
 * dado real**, que teste de unidade não dá:
 *  · se listar exatamente as deliberações que o gabarito prevê (79ª e 83ª ROP da ANM), a correção
 *    está provada contra produção;
 *  · se listar MUITO mais, ela mexeu em algo não previsto — e é melhor descobrir agora.
 *
 * ⚠️ O número ENVELHECE. Qualquer mudança nos caminhos que gravam `contra` muda este resultado, e
 * a rodada seguinte mexe justamente neles. Rodar duas vezes: uma como verificação, outra (depois)
 * como base da decisão de retroação. Registrar as duas contagens lado a lado.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { buildRoleMap, extractAutoresDoVotoAprovado } from "@/lib/server/nlp-extractor";

export const dynamic = "force-dynamic";

interface ItemAfetado {
  deliberacao_id: string;
  agencia_sigla: string | null;
  numero_reuniao: string | null;
  item_numero: string | null;
  data_reuniao: string | null;
  /** Diretores hoje gravados como CONTRA que o dispositivo credita com o voto APROVADO. */
  invertidos: string[];
  /** Trecho do dispositivo que sustenta a conclusão — para conferência humana. */
  evidencia: string | null;
}

/** Texto do próprio documento (o pai, no caso de item de ata). */
function textoDoRaw(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const t = (raw as Record<string, unknown>).raw_text;
  return typeof t === "string" ? t : "";
}

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({
      modo: "demo", total_deliberacoes_com_contra: 0, total_afetadas: 0,
      total_votos_invertidos: 0, por_agencia: [], itens: [],
    });
  }

  const guard = await requireAdmin(req);
  if (guard) return guard;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Só o que interessa: deliberações que TÊM voto contrário registrado.
  const { data: votosContra, error: errVotos } = await db
    .from("votos")
    .select("deliberacao_id, diretor_id, tipo_voto, diretores(nome)")
    .eq("tipo_voto", "Desfavoravel")
    .limit(20000);

  if (errVotos) {
    return NextResponse.json({ error: "Falha ao listar votos contrários." }, { status: 500 });
  }

  const porDeliberacao = new Map<string, string[]>();
  for (const v of (votosContra ?? []) as Array<{ deliberacao_id: string; diretores: { nome?: string } | null }>) {
    const nome = v.diretores?.nome;
    if (!v.deliberacao_id || !nome) continue;
    const lista = porDeliberacao.get(v.deliberacao_id) ?? [];
    lista.push(nome);
    porDeliberacao.set(v.deliberacao_id, lista);
  }

  const ids = [...porDeliberacao.keys()];
  if (ids.length === 0) {
    return NextResponse.json({
      modo: "real", total_deliberacoes_com_contra: 0, total_afetadas: 0,
      total_votos_invertidos: 0, por_agencia: [], itens: [],
      nota: "Nenhum voto Desfavoravel registrado — nada a diagnosticar.",
    });
  }

  const itens: ItemAfetado[] = [];
  const cachePai = new Map<string, string>();

  // Lotes de 200 para não estourar o tamanho da URL do PostgREST.
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    const { data: delibs } = await db
      .from("deliberacoes")
      .select("id, item_numero, numero_reuniao, data_reuniao, documento_pai_id, resumo_pleito, raw_extraction, agencias(sigla)")
      .in("id", lote);

    for (const d of (delibs ?? []) as Array<Record<string, any>>) {
      const contra = porDeliberacao.get(d.id) ?? [];
      if (!contra.length) continue;

      // O roleMap (cargo → nome) vem do PREÂMBULO da ata, que vive no documento PAI: o filho não
      // persiste `raw_text` (omissão por tamanho, ver ata-item-materializacao.ts).
      let textoRoster = textoDoRaw(d.raw_extraction);
      if (!textoRoster && d.documento_pai_id) {
        if (!cachePai.has(d.documento_pai_id)) {
          const { data: pai } = await db
            .from("deliberacoes").select("raw_extraction").eq("id", d.documento_pai_id).maybeSingle();
          cachePai.set(d.documento_pai_id, textoDoRaw(pai?.raw_extraction));
        }
        textoRoster = cachePai.get(d.documento_pai_id) ?? "";
      }

      // O DISPOSITIVO do item é o `resumo_pleito` (a `decisao` truncada em 2000 chars); para
      // deliberação avulsa, o próprio texto serve.
      const dispositivo = String(d.resumo_pleito ?? "") || textoRoster;
      if (!dispositivo) continue;

      const roleMap = buildRoleMap(textoRoster || dispositivo);
      const venceram = new Set(extractAutoresDoVotoAprovado(dispositivo, roleMap));
      const invertidos = contra.filter((nome) => venceram.has(nome));
      if (!invertidos.length) continue;

      itens.push({
        deliberacao_id: d.id,
        agencia_sigla: d.agencias?.sigla ?? null,
        numero_reuniao: d.numero_reuniao ?? null,
        item_numero: d.item_numero ?? null,
        data_reuniao: d.data_reuniao ?? null,
        invertidos,
        evidencia: dispositivo.replace(/\s+/g, " ").slice(0, 300),
      });
    }
  }

  const agrupado = new Map<string, { agencia: string; deliberacoes: number; votos: number; reunioes: Set<string> }>();
  for (const it of itens) {
    const chave = it.agencia_sigla ?? "—";
    const acc = agrupado.get(chave) ?? { agencia: chave, deliberacoes: 0, votos: 0, reunioes: new Set<string>() };
    acc.deliberacoes += 1;
    acc.votos += it.invertidos.length;
    if (it.numero_reuniao) acc.reunioes.add(it.numero_reuniao);
    agrupado.set(chave, acc);
  }

  return NextResponse.json({
    modo: "real",
    gerado_em: new Date().toISOString(),
    total_deliberacoes_com_contra: ids.length,
    total_afetadas: itens.length,
    total_votos_invertidos: itens.reduce((s, i) => s + i.invertidos.length, 0),
    por_agencia: [...agrupado.values()]
      .map((a) => ({ agencia: a.agencia, deliberacoes: a.deliberacoes, votos: a.votos, reunioes: [...a.reunioes].sort() }))
      .sort((a, b) => b.votos - a.votos),
    itens: itens.slice(0, 500),
    legal_notice: "Diagnóstico READ-ONLY. Nenhuma linha é alterada. `invertidos` são diretores hoje "
      + "gravados como CONTRA cujo voto o DISPOSITIVO declara APROVADO — o sinal está invertido.",
  });
}
