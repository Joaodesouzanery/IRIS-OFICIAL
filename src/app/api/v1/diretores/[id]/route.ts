/**
 * GET /api/v1/diretores/[id]
 * Perfil completo de um diretor: mandato, estatísticas de voto, tendências, histórico.
 * Segurança: id validado com allowlist de caracteres antes de qualquer query.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeDiretorProfile } from "@/lib/server/analytics-engine";
import type { DiretorProfile } from "@/types";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { sanitizeNomeVariantes, VALID_SITUACAO } from "@/lib/server/diretores-admin";

const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;


export async function GET(
  req: NextRequest,
  { params }: any
) {
  const { id } = params;

  // Validação de entrada — rejeita qualquer id suspeito
  if (!id || !SAFE_ID_RE.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      const profile = computeDiretorProfile(getSyncedDelibs(), id);
      if (!profile) return NextResponse.json({ error: "Diretor não encontrado" }, { status: 404 });
      return NextResponse.json(profile);
    }

    const profile = demoData.diretorProfile(id);
    if (!profile) {
      return NextResponse.json({ error: "Diretor não encontrado" }, { status: 404 });
    }
    return NextResponse.json(profile);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Busca diretor + mandatos
  const { data: diretor, error: dirErr } = await db
    .from("diretores")
    .select("id, nome, cargo, agencia_id, agencias(sigla)")
    .eq("id", id)
    .single();

  if (dirErr || !diretor) {
    return NextResponse.json({ error: "Diretor não encontrado" }, { status: 404 });
  }

  // Mandato atual
  const { data: mandatos } = await db
    .from("mandatos")
    .select("data_inicio, data_fim")
    .eq("diretor_id", id)
    .order("data_inicio", { ascending: false })
    .limit(1);

  const now = new Date().toISOString().slice(0, 10);
  const mandato = mandatos?.[0] ?? null;
  const status = mandato?.data_fim && mandato.data_fim < now ? "Inativo" : "Ativo";
  let dias_restantes: number | null = null;
  if (mandato?.data_fim && status === "Ativo") {
    dias_restantes = Math.max(0, Math.round(
      (new Date(mandato.data_fim).getTime() - Date.now()) / 86400000
    ));
  }

  // Votos deste diretor com join em deliberações
  const { data: votos } = await db
    .from("votos")
    .select(`
      tipo_voto, is_divergente,
      deliberacoes!inner(
        id, numero_deliberacao, data_reuniao, interessado,
        microtema, resultado
      )
    `)
    .eq("diretor_id", id)
    .order("deliberacoes(data_reuniao)", { ascending: false });

  let favoravel = 0, desfavoravel = 0, abstencao = 0, divergente = 0;
  const microtemaCount = new Map<string, number>();
  const historico: DiretorProfile["historico"] = [];

  for (const v of votos ?? []) {
    const d = v as unknown as {
      tipo_voto: string; is_divergente: boolean;
      deliberacoes: { id: string; numero_deliberacao: string | null; data_reuniao: string | null;
        interessado: string | null; microtema: string | null; resultado: string | null };
    };
    if (d.tipo_voto === "Favoravel") favoravel++;
    else if (d.tipo_voto === "Desfavoravel") desfavoravel++;
    else abstencao++;
    if (d.is_divergente) divergente++;
    if (d.deliberacoes.microtema) {
      microtemaCount.set(d.deliberacoes.microtema, (microtemaCount.get(d.deliberacoes.microtema) ?? 0) + 1);
    }
    historico.push({
      deliberacao_id: d.deliberacoes.id,
      numero_deliberacao: d.deliberacoes.numero_deliberacao,
      data_reuniao: d.deliberacoes.data_reuniao,
      interessado: d.deliberacoes.interessado,
      microtema: d.deliberacoes.microtema,
      resultado: d.deliberacoes.resultado,
      tipo_voto: d.tipo_voto,
      is_divergente: d.is_divergente,
    });
  }

  const total = favoravel + desfavoravel + abstencao;
  const pct_favoravel = total > 0 ? (favoravel / total) * 100 : 0;
  const pct_divergente = total > 0 ? (divergente / total) * 100 : 0;

  const perfil: DiretorProfile["tendencias"]["perfil"] =
    pct_divergente < 5 ? "Consensual"
    : pct_divergente < 15 ? "Moderadamente divergente"
    : "Divergente";

  const microtema_dominante = microtemaCount.size > 0
    ? [...microtemaCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  const agencia = diretor as unknown as { agencias: { sigla: string } | null };

  const profile: DiretorProfile = {
    id: diretor.id,
    nome: diretor.nome,
    cargo: diretor.cargo,
    agencia_id: diretor.agencia_id,
    agencia_sigla: agencia.agencias?.sigla ?? null,
    mandato: {
      data_inicio: mandato?.data_inicio ?? "",
      data_fim: mandato?.data_fim ?? null,
      status: status as "Ativo" | "Inativo",
      dias_restantes,
    },
    stats: { total_votos: total, favoravel, desfavoravel, abstencao, divergente, pct_favoravel, pct_divergente },
    por_microtema: [...microtemaCount.entries()]
      .map(([microtema, t]) => ({ microtema, total: t }))
      .sort((a, b) => b.total - a.total),
    historico,
    tendencias: {
      perfil,
      microtema_dominante,
      taxa_aprovacao: total > 0 ? `${pct_favoravel.toFixed(1)}%` : "—",
      descricao: total > 0
        ? (pct_divergente < 5
            ? `Vota com a maioria em ${(100 - pct_divergente).toFixed(0)}% dos casos`
            : `Apresentou voto divergente em ${pct_divergente.toFixed(1)}% das deliberações`)
        : "Sem histórico de votos registrado",
    },
  };

  return NextResponse.json(profile);
}

/**
 * PATCH /api/v1/diretores/[id] — atualiza dados editáveis do diretor (admin).
 * Campos suportados: nome, cargo, nome_variantes, situacao, ativo, needs_review.
 */
export async function PATCH(req: NextRequest, { params }: any) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const { id } = params;
  if (!id || !SAFE_ID_RE.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.nome === "string" && body.nome.trim()) patch.nome = body.nome.trim().slice(0, 200);
  if ("cargo" in body) patch.cargo = body.cargo ? String(body.cargo).slice(0, 100) : null;
  if ("nome_variantes" in body) patch.nome_variantes = sanitizeNomeVariantes(body.nome_variantes);
  if (typeof body.situacao === "string" && VALID_SITUACAO.has(body.situacao)) patch.situacao = body.situacao;
  if ("ativo" in body) patch.ativo = Boolean(body.ativo);
  if ("needs_review" in body) patch.needs_review = Boolean(body.needs_review);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("diretores")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

/**
 * DELETE /api/v1/diretores/[id] — remove o diretor (admin).
 * Falha se houver votos vinculados (FK); nesse caso prefira desativar (ativo=false).
 */
export async function DELETE(req: NextRequest, { params }: any) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const { id } = params;
  if (!id || !SAFE_ID_RE.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const { error } = await db.from("diretores").delete().eq("id", id);
  if (error) {
    return NextResponse.json(
      { error: `Não foi possível excluir (há votos vinculados?). Considere desativar. Detalhe: ${error.message}` },
      { status: 409 },
    );
  }
  return NextResponse.json({ deleted: true, id });
}
