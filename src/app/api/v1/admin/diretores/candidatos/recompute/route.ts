/**
 * POST /api/v1/admin/diretores/candidatos/recompute[?dry_run=0][&agencia_id=...]
 *
 * Limpeza RETROATIVA dos candidatos de diretor pendentes. A dedup/matcher da
 * Etapa 13 é forward-only: candidatos legados ficaram com `confidence` congelada
 * (ex.: 6 cartões "Alex Azevedo" a 60% que o código atual nem criaria) e nunca
 * colapsam sozinhos. Aqui, por (agencia_id, nome_detectado):
 *   - recalcula findBestMatch com o matcher ATUAL;
 *   - grupos que agora casam >=0.85 → AUTO-APROVA (cascata + votos retroativos
 *     idempotentes) — destrava os diretores que apareciam zerados nas métricas;
 *   - grupos ainda ambíguos → atualiza confidence/diretor_id e COLAPSA os cartões
 *     duplicados num só (os votos vêm de raw_extraction na aprovação, não do
 *     cartão, então apagar duplicatas não perde voto).
 * dry_run (padrão) só relata. Admin explícito; votos são upsert idempotente.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { findBestMatch, tokenSortRatio, isStrictAbbreviation, isStrictPersonName } from "@/lib/server/name-matcher";
import { aprovarCandidato } from "@/lib/server/candidato-approval";
import { mergeDiretores } from "@/lib/server/diretor-merge";
import { hasBudget, HOBBY_BUDGET_MS, budgetFromRequest } from "@/lib/server/time-budget";

export const dynamic = "force-dynamic";
// Passo 4 do "Rodar tudo": trabalho pesado (aprovação em cascata + votos retroativos +
// auto-merge). Sem orçamento, o SIGKILL do Hobby (60s) deixava escrita PARCIAL.
export const maxDuration = 60;

type Candidato = {
  id: string;
  agencia_id: string;
  nome_detectado: string;
  cargo_detectado: string | null;
  diretor_id: string | null;
  confidence: number | null;
  source_url: string | null;
  source_type: string | null;
  source_hash: string | null;
  created_at: string;
};

type DiretorRec = { id: string; nome: string; nome_variantes: string[] };

// Mesmo clamp de confidence usado na criação (confirm/route.ts).
function clampConfidence(score: number): number {
  return Math.max(0.35, Math.min(score || 0.5, 0.94));
}

export async function POST(req: NextRequest) {
  // Fase 10 — passo 3 da esteira: sob o cron respondia 403 e era contado como sucesso.
  const guard = await requireAdminOrCron(req, "admin/diretores/candidatos/recompute");
  if (guard) return guard;
  if (isDemo()) {
    return NextResponse.json({ error: "Indisponível em modo DEMO." }, { status: 403 });
  }

  const dryRun = req.nextUrl.searchParams.get("dry_run") !== "0";
  const agenciaFilter = req.nextUrl.searchParams.get("agencia_id");

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let candQuery = db
    .from("diretor_candidatos")
    .select("id, agencia_id, nome_detectado, cargo_detectado, diretor_id, confidence, source_url, source_type, source_hash, created_at")
    .eq("review_status", "pendente")
    .limit(5000);
  if (agenciaFilter) candQuery = candQuery.eq("agencia_id", agenciaFilter);
  const { data: candidatos, error } = await candQuery;
  if (error) {
    return NextResponse.json({ error: "Erro ao listar candidatos" }, { status: 500 });
  }

  // Cache de diretores por agência (id, nome, nome_variantes).
  const diretoresPorAgencia = new Map<string, DiretorRec[]>();
  async function diretoresDe(agenciaId: string): Promise<DiretorRec[]> {
    const cached = diretoresPorAgencia.get(agenciaId);
    if (cached) return cached;
    const { data } = await db
      .from("diretores")
      .select("id, nome, nome_variantes")
      .eq("review_status", "aprovado") // rejeitado não casa (antirrecontaminação ago/2026)
      .eq("agencia_id", agenciaId);
    const lista = (data ?? []).map((d: { id: string; nome: string; nome_variantes?: unknown }) => ({
      id: d.id,
      nome: d.nome,
      nome_variantes: Array.isArray(d.nome_variantes) ? (d.nome_variantes as string[]) : [],
    }));
    diretoresPorAgencia.set(agenciaId, lista);
    return lista;
  }

  // Agrupa por (agencia_id, nome_detectado).
  const grupos = new Map<string, Candidato[]>();
  for (const c of (candidatos ?? []) as Candidato[]) {
    const key = `${c.agencia_id}|${c.nome_detectado}`;
    grupos.set(key, [...(grupos.get(key) ?? []), c]);
  }

  let autoAprovados = 0;
  let rejeitadosLixo = 0;
  let recomputados = 0;
  let cartoesColapsados = 0;
  let votosCriados = 0;
  const amostra: Array<{ nome: string; agencia_id: string; score: number; acao: string; cartoes: number }> = [];

  // Orçamento: para BETWEEN grupos, nunca no meio de uma aprovação (que é atômica por
  // grupo). O que não couber fica pendente → o próximo recompute continua (idempotente).
  // Fase 7 — honra o `budget_ms` do orquestrador. Com HOBBY_BUDGET_MS fixo, esta sub-rota
  // achava que tinha 50s inteiros mesmo quando a pipeline já gastara 40 — e seguia trabalhando
  // até o SIGKILL de 60s levar a FUNÇÃO INTEIRA, sem gravar sucesso nem erro.
  const deadlineAt = Date.now() + budgetFromRequest(req);
  let parcial = false;

  for (const [, grupo] of grupos) {
    if (!hasBudget(deadlineAt, 8_000)) { parcial = true; break; }
    // Canônico = maior confidence, desempate pelo mais antigo.
    const canonico = [...grupo].sort(
      (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || a.created_at.localeCompare(b.created_at),
    )[0];
    const lista = await diretoresDe(canonico.agencia_id);
    const match = findBestMatch(canonico.nome_detectado, lista);
    // Validação estrita (QA ago/2026): prosa capturada como "nome" não é auto-aprovada nem
    // vira nome_variante do diretor real — fica para revisão/limpeza.
    const aprovavel = Boolean(match.diretorId) && !match.needsReview && isStrictPersonName(canonico.nome_detectado); // >=0.85

    if (aprovavel) {
      if (amostra.length < 20) amostra.push({ nome: canonico.nome_detectado, agencia_id: canonico.agencia_id, score: Math.round(match.score * 100) / 100, acao: "auto-aprovar", cartoes: grupo.length });
      autoAprovados += 1;
      if (!dryRun) {
        // aprovarCandidato cascateia para TODOS os pendentes do mesmo nome + cria
        // votos retroativos idempotentes. Passa o diretor recomputado.
        const res = await aprovarCandidato(db, canonico, { diretorId: match.diretorId, reviewedBy: "recompute" });
        const votos = res.votosRetroativos as { criados?: number } | null;
        votosCriados += votos?.criados ?? 0;
      }
      continue;
    }

    // Etapa67 — DRENAGEM DO LIXO LEGADO. Nome que reprova em isStrictPersonName ("Agência
    // Utiliza As", "Você Pode"…) NUNCA vira pessoa: os write-paths atuais já o barram, mas o
    // legado anterior ao endurecimento ficava aqui para sempre — este ramo recomputava a
    // confidence e PRESERVAVA o cartão, e cada "Rodar tudo" reafirmava o lixo em vez de
    // drená-lo. Rejeita o grupo INTEIRO em cascata (padrão de candidatos/[id]/rejeitar).
    if (!isStrictPersonName(canonico.nome_detectado)) {
      rejeitadosLixo += 1;
      if (amostra.length < 20) amostra.push({ nome: canonico.nome_detectado, agencia_id: canonico.agencia_id, score: Math.round(match.score * 100) / 100, acao: "rejeitar-lixo", cartoes: grupo.length });
      if (!dryRun) {
        await db
          .from("diretor_candidatos")
          .update({
            review_status: "rejeitado",
            reviewed_at: new Date().toISOString(),
            reviewed_by: "recompute:nome-invalido",
          })
          .eq("agencia_id", canonico.agencia_id)
          .eq("nome_detectado", canonico.nome_detectado)
          .eq("review_status", "pendente");
      }
      continue;
    }

    // Ainda ambíguo/novo: recomputa confidence+diretor_id no canônico e colapsa duplicatas.
    recomputados += 1;
    if (amostra.length < 20) amostra.push({ nome: canonico.nome_detectado, agencia_id: canonico.agencia_id, score: Math.round(match.score * 100) / 100, acao: match.diretorId ? "revisar" : "novo", cartoes: grupo.length });
    if (!dryRun) {
      await db
        .from("diretor_candidatos")
        .update({ confidence: clampConfidence(match.score), diretor_id: match.diretorId })
        .eq("id", canonico.id);
      const duplicados = grupo.filter((c) => c.id !== canonico.id);
      if (duplicados.length > 0) {
        await db.from("diretor_candidatos").delete().in("id", duplicados.map((c) => c.id));
        cartoesColapsados += duplicados.length;
      }
    } else {
      cartoesColapsados += grupo.length - 1;
    }
  }

  // ── Auto-mesclagem de diretores DUPLICADOS 100% seguros (acento-only) ──────
  // Só funde pares acento-insensível-idênticos (tokenSortRatio ≥0.98), ex.:
  // "Alex Antônio de Azevedo Cruz" × "Alex Antonio de Azevedo Cruz". Mantém o de
  // MAIS votos (desempate: nome mais longo = forma oficial). Pares que exigem
  // julgamento (nome com token extra) ficam para o painel manual "Mesclar".
  let diretoresMesclados = 0;
  const agenciasTocadas = new Set<string>([...grupos.values()].map((g) => g[0].agencia_id));
  for (const ag of agenciasTocadas) {
    if (!hasBudget(deadlineAt, 5_000)) { parcial = true; break; }
    const lista = await diretoresDe(ag); // já em cache
    const contagemVotos = new Map<string, number>();
    if (!dryRun && lista.length > 1) {
      const { data: votosAg } = await db
        .from("votos")
        .select("diretor_id, diretores!inner(agencia_id)")
        .eq("diretores.agencia_id", ag)
        .limit(50000);
      for (const v of votosAg ?? []) contagemVotos.set(v.diretor_id, (contagemVotos.get(v.diretor_id) ?? 0) + 1);
    }
    const jaFundidos = new Set<string>();
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i], b = lista[j];
        if (jaFundidos.has(a.id) || jaFundidos.has(b.id)) continue;
        // Funde quando: (1) acento-only/idêntico (≥0.98) OU (2) um nome é abreviação
        // ESTRITA do outro ("Felipe Queiroz" ⊂ "Felipe Fernandes Queiroz") — a causa
        // do voto que rachava entre cadastros. Conservador (mesmo 1º+último sobrenome).
        const acentoOnly = tokenSortRatio(a.nome, b.nome) >= 0.98;
        const abrev = isStrictAbbreviation(a.nome, b.nome) || isStrictAbbreviation(b.nome, a.nome);
        if (!acentoOnly && !abrev) continue;
        // keep = nome mais LONGO (forma oficial completa); desempate por mais votos.
        const va = contagemVotos.get(a.id) ?? 0, vb = contagemVotos.get(b.id) ?? 0;
        const [keep, merge] = a.nome.length !== b.nome.length
          ? (a.nome.length > b.nome.length ? [a, b] : [b, a])
          : (va >= vb ? [a, b] : [b, a]);
        if (amostra.length < 20) amostra.push({ nome: `${keep.nome} ⇐ ${merge.nome}`, agencia_id: ag, score: 1, acao: "auto-mesclar", cartoes: 0 });
        diretoresMesclados += 1;
        if (!dryRun) {
          try { await mergeDiretores(db, keep.id, merge.id); jaFundidos.add(merge.id); }
          catch (e) { console.error("[recompute] auto-merge falhou:", e); }
        }
      }
    }
  }

  return NextResponse.json({
    dry_run: dryRun,
    candidatos_pendentes: (candidatos ?? []).length,
    grupos: grupos.size,
    grupos_auto_aprovados: autoAprovados,
    grupos_rejeitados_lixo: rejeitadosLixo,
    grupos_recomputados: recomputados,
    cartoes_colapsados: cartoesColapsados,
    diretores_mesclados: diretoresMesclados,
    votos_retroativos_criados: votosCriados,
    parcial,
    amostra,
    ...(parcial ? { notice_parcial: "Orçamento de tempo esgotado — rode novamente para concluir o restante (idempotente)." } : {}),
    ...(dryRun ? { notice: "Somente relatório. Repita com ?dry_run=0 para aplicar (auto-aprova >=0.85, colapsa e auto-mescla acento-only)." } : {}),
  });
}
