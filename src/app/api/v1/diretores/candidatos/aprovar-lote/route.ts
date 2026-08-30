/**
 * POST /api/v1/diretores/candidatos/aprovar-lote
 * Aprova EM LOTE os candidatos de diretor pendentes com confiança ≥ limiar,
 * destravando os votos retroativos (matches fracos 0.6–0.85 eram o gargalo:
 * cada um exigia revisão 1-a-1 e os votos ficavam perdidos até lá).
 *
 * Conservador por padrão: só aprova candidatos JÁ CASADOS a um diretor
 * cadastrado (diretor_id preenchido). Criar diretores NOVOS a partir de nomes
 * extraídos continua 1-a-1 (ou explicitamente via incluir_novos=true). Admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin, requireAdminOrCron, getAuthenticatedUser } from "@/lib/server/request-guards";
import { aprovarCandidato } from "@/lib/server/candidato-approval";
import { findBestMatch, findBestMatchComMargem, isStrictPersonName } from "@/lib/server/name-matcher";
import { COLEGIADO_SIGLAS } from "@/lib/server/colegiado-sources";
import { getActiveDiretoresForVote } from "@/lib/server/vote-inference";
import { budgetFromRequest, hasBudget } from "@/lib/server/time-budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Fase 12 — 60 → 120: esta rota honra `budget_ms`/HOBBY_BUDGET_MS (70s); declarar 60 aqui
// pediria o kill da plataforma ANTES de o próprio orçamento parar o trabalho. 120 é o valor
// que pipeline/run e o vercel.json já declaram e que os builds já provaram.
export const maxDuration = 120;

const DEFAULT_MIN_CONFIDENCE = 0.8;

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Aprovação em lote indisponível em modo DEMO." }, { status: 403 });
  }
  // AdminOrCron: a pipeline zero-toque (/pipeline/run) também chama esta rota.
  const guard = await requireAdminOrCron(req, "candidatos/aprovar-lote");
  if (guard) return guard;

  const userResult = await getAuthenticatedUser(req);
  const reviewedBy = userResult instanceof NextResponse ? null : userResult.email;

  const body = (await req.json().catch(() => ({}))) as {
    min_confidence?: number;
    limit?: number;
    agencia_id?: string;
    incluir_novos?: boolean;
    ids?: string[];
  };
  const minConfidence = Math.min(0.94, Math.max(0.6, Number(body.min_confidence ?? DEFAULT_MIN_CONFIDENCE)));
  // Fase 10 — esta rota IGNORAVA o `budget_ms` que o orquestrador manda na URL. A esteira
  // encadeia ~12 sub-rotas na MESMA invocação repartindo um orçamento único; quem não lê a
  // própria fatia trabalha até acabar e a rodada estoura o relógio — foi o "passou de 90s
  // sem resposta" que a tela mostrou. Para no saldo e DIZ que ficou parcial.
  const deadlineAt = Date.now() + budgetFromRequest(req);
  /** Um candidato: resolução de nome + até 3 escritas. */
  const RESERVA_POR_CANDIDATO_MS = 700;

  const limit = Math.min(100, Math.max(1, Number(body.limit ?? 50)));
  const incluirNovos = body.incluir_novos === true;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let query = db
    .from("diretor_candidatos")
    .select("*")
    .eq("review_status", "pendente")
    .gte("confidence", minConfidence)
    .order("confidence", { ascending: false })
    .limit(limit);
  if (body.agencia_id) query = query.eq("agencia_id", body.agencia_id);
  if (Array.isArray(body.ids) && body.ids.length > 0) query = query.in("id", body.ids.slice(0, 100));

  const { data: candidatos, error } = await query;
  if (error) return NextResponse.json({ error: "Falha ao listar candidatos." }, { status: 500 });

  // Zero-toque (incluir_novos): também considera os candidatos SEM match forte (novos), que a
  // query acima (gte confidence) não traz. Política de 3 FAIXAS (anti grafia-errada):
  //   ≥0.8 → aprova como o diretor casado · 0.6–0.8 → provável VARIANTE de grafia, NÃO cria
  //   pessoa (fica pendente/exceção) · <0.6 + nome estrito → cria diretor novo.
  let candidatosNovos: any[] = [];
  if (incluirNovos) {
    let qNovos = db
      .from("diretor_candidatos")
      .select("*")
      .eq("review_status", "pendente")
      .is("diretor_id", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (body.agencia_id) qNovos = qNovos.eq("agencia_id", body.agencia_id);
    const { data } = await qNovos;
    candidatosNovos = (data ?? []).filter((c: any) => !(candidatos ?? []).some((x: any) => x.id === c.id));
  }

  const diretoresCache = new Map<string, Array<{ id: string; nome: string; nome_variantes: string[] }>>();
  async function diretoresDe(agenciaId: string) {
    const cached = diretoresCache.get(agenciaId);
    if (cached) return cached;
    const { data } = await db.from("diretores").select("id, nome, nome_variantes").eq("review_status", "aprovado").eq("agencia_id", agenciaId);
    const lista = (data ?? []).map((x: any) => ({
      id: x.id, nome: x.nome, nome_variantes: Array.isArray(x.nome_variantes) ? x.nome_variantes : [],
    }));
    diretoresCache.set(agenciaId, lista);
    return lista;
  }

  const aprovados: Array<{ id: string; nome: string; diretor_id: string }> = [];
  const pulados: Array<{ id: string; nome: string; reason: string }> = [];

  let parcial = false;
  for (const candidato of candidatos ?? []) {
    if (!hasBudget(deadlineAt, RESERVA_POR_CANDIDATO_MS)) { parcial = true; break; }
    if (!candidato.diretor_id) {
      // QA ago/2026: candidato NOVO com confidence alta caía aqui e o aprovarCandidato criava
      // diretor SEM os gates (nome estrito, agência colegiada, ≥2 docs) — origem do lixo
      // "José Fernando … Restituiu-lhe A Presidência" aprovado. Novo é SEMPRE tratado no
      // fluxo de novos abaixo (que tem os gates); sem incluir_novos, fica pendente.
      if (incluirNovos) {
        if (!candidatosNovos.some((c: any) => c.id === candidato.id)) candidatosNovos.push(candidato);
      } else {
        pulados.push({ id: candidato.id, nome: candidato.nome_detectado, reason: "sem diretor cadastrado (novo) — aprovar 1-a-1 ou incluir_novos=true" });
      }
      continue;
    }
    // Mesmo casado a diretor real: prosa capturada como "nome" não pode ser aprovada — viraria
    // nome_variante-lixo do diretor e realimentaria matches futuros. Rejeita o cartão.
    if (!isStrictPersonName(String(candidato.nome_detectado ?? ""))) {
      await db.from("diretor_candidatos").update({ review_status: "rejeitado", reviewed_at: new Date().toISOString(), reviewed_by: reviewedBy ?? "aprovar-lote" }).eq("id", candidato.id);
      pulados.push({ id: candidato.id, nome: candidato.nome_detectado, reason: "nome não passa na validação estrita (prosa) — cartão rejeitado" });
      continue;
    }
    try {
      const result = await aprovarCandidato(db, candidato, { reviewedBy });
      aprovados.push({ id: candidato.id, nome: candidato.nome_detectado, diretor_id: result.diretorId });
    } catch (e) {
      console.error("[candidatos/aprovar-lote] Falha:", e);
      pulados.push({ id: candidato.id, nome: candidato.nome_detectado, reason: "erro ao aprovar" });
    }
  }

  // Faixa 0.6–0.8 com trava de MARGEM (zero-toque ago/2026): quando o melhor diretor é
  // INEQUÍVOCO (margem ≥0.15 sobre o 2º), é variante de grafia da mesma pessoa → aprova
  // como ele (não cria ninguém). Dois diretores próximos → segue exceção humana.
  let aprovadosPorMargem = 0;
  let resolvidosPorMandato = 0;
  let resolvidosSemMargem = 0;
  if (incluirNovos) {
    let qFaixa = db
      .from("diretor_candidatos")
      .select("*")
      .eq("review_status", "pendente")
      .gte("confidence", 0.6)
      .lt("confidence", minConfidence)
      .not("diretor_id", "is", null)
      .order("confidence", { ascending: false })
      .limit(limit);
    if (body.agencia_id) qFaixa = qFaixa.eq("agencia_id", body.agencia_id);
    const { data: faixa } = await qFaixa;
    for (const candidato of (faixa ?? []) as any[]) {
      if (!hasBudget(deadlineAt, RESERVA_POR_CANDIDATO_MS)) { parcial = true; break; }
      if (!candidato.agencia_id) continue;
      // Prosa não vira variante de grafia do diretor real (QA ago/2026).
      if (!isStrictPersonName(String(candidato.nome_detectado ?? ""))) {
        pulados.push({ id: candidato.id, nome: candidato.nome_detectado, reason: "nome não passa na validação estrita (prosa) — não vira variante" });
        continue;
      }
      const nomeCand = String(candidato.nome_detectado ?? "");
      const listaCompleta = await diretoresDe(candidato.agencia_id);
      const m = findBestMatchComMargem(nomeCand, listaCompleta);
      if (m.diretorId && m.score >= 0.6 && m.margem >= 0.15) {
        try {
          const result = await aprovarCandidato(db, candidato, { reviewedBy, diretorId: m.diretorId });
          aprovados.push({ id: candidato.id, nome: candidato.nome_detectado, diretor_id: result.diretorId });
          aprovadosPorMargem++;
        } catch (e) {
          console.error("[candidatos/aprovar-lote] Falha (margem):", e);
          pulados.push({ id: candidato.id, nome: candidato.nome_detectado, reason: "erro ao aprovar (margem)" });
        }
        continue;
      }

      // ═══ AUTO-RESOLVER (etapa67) — nada espera humano ═══
      //
      // Passo 1 · MANDATO: a maioria das colisões reais é titular × ex-titular de épocas
      // diferentes. Filtrar pelos ativos na data da deliberação de origem desfaz a ambiguidade
      // sem heurística nova — o roster por data já é a espinha da inferência de voto.
      let resolvido = false;
      const delibId = (candidato.evidence as { deliberacao_id?: string } | null)?.deliberacao_id ?? null;
      if (delibId) {
        const { data: delib } = await db
          .from("deliberacoes").select("data_reuniao").eq("id", delibId).maybeSingle();
        const dataReuniao = (delib as { data_reuniao?: string | null } | null)?.data_reuniao ?? null;
        if (dataReuniao) {
          const ativos = await getActiveDiretoresForVote(db, candidato.agencia_id, dataReuniao, []);
          if (ativos.length > 0) {
            const mF = findBestMatchComMargem(nomeCand, ativos);
            if (mF.diretorId && mF.score >= 0.6 && mF.margem >= 0.15) {
              try {
                const result = await aprovarCandidato(db, candidato, { reviewedBy, diretorId: mF.diretorId });
                aprovados.push({ id: candidato.id, nome: candidato.nome_detectado, diretor_id: result.diretorId });
                resolvidosPorMandato++;
                resolvido = true;
              } catch (e) {
                console.error("[candidatos/aprovar-lote] Falha (mandato):", e);
              }
            }
          }
        }
      }
      if (resolvido) continue;

      // Passo 3 · FALLBACK (exceção, não fluxo — a instrumentação abaixo mede se ele é raro
      // como a hipótese prevê): aprova o melhor score e CARIMBA `confianca_match` em cada voto
      // retroativo criado, para auditoria posterior. Sem UI própria até o número justificar.
      if (m.diretorId && m.score >= 0.6) {
        try {
          const result = await aprovarCandidato(db, candidato, {
            reviewedBy: `${reviewedBy ?? "auto"}:sem-margem`,
            diretorId: m.diretorId,
            confiancaMatch: m.score,
          });
          aprovados.push({ id: candidato.id, nome: candidato.nome_detectado, diretor_id: result.diretorId });
          resolvidosSemMargem++;
        } catch (e) {
          console.error("[candidatos/aprovar-lote] Falha (sem-margem):", e);
          pulados.push({ id: candidato.id, nome: candidato.nome_detectado, reason: "erro ao aprovar (sem-margem)" });
        }
      } else {
        pulados.push({ id: candidato.id, nome: candidato.nome_detectado, reason: "score < 0.6 em qualquer conjunto — segue o fluxo de nome novo" });
      }
    }
  }

  // Gate anti-poluição (QA ago/2026 — "25 diretores na ANM"): criar uma PESSOA NOVA exige
  // (a) agência COLEGIADA (fora de ANTT/ANM/ARTESP a esteira de votos não cria diretor) e
  // (b) o mesmo nome aparecer em ≥2 DOCUMENTOS distintos — signatário/servidor citado numa
  // única ata não vira diretor (diretor de verdade reaparece a cada reunião).
  const { data: agRows } = await db.from("agencias").select("id, sigla");
  const colegiadaIds = new Set(
    ((agRows ?? []) as Array<{ id: string; sigla: string }>)
      .filter((a) => COLEGIADO_SIGLAS.has(String(a.sigla)))
      .map((a) => a.id),
  );
  const ocorrenciasPorNome = new Map<string, number>();
  if (candidatosNovos.length > 0) {
    const nomes = [...new Set(candidatosNovos.map((c: any) => String(c.nome_detectado ?? "")))];
    const { data: todosDoNome } = await db
      .from("diretor_candidatos")
      .select("nome_detectado, agencia_id, source_hash")
      .in("nome_detectado", nomes);
    for (const c of (todosDoNome ?? []) as any[]) {
      const k = `${c.agencia_id}|${c.nome_detectado}`;
      ocorrenciasPorNome.set(k, (ocorrenciasPorNome.get(k) ?? 0) + 1);
    }
  }

  for (const candidato of candidatosNovos) {
    const nome = String(candidato.nome_detectado ?? "");
    if (!isStrictPersonName(nome)) {
      // Etapa67 — era o ÚNICO lugar do sistema que identificava o lixo e apenas o IGNORAVA,
      // enquanto o ramo de cartões COM diretor_id (acima) rejeita de fato. A assimetria mantinha
      // "Você Pode" e "Agência Utiliza As" pendentes para sempre. Rejeita, simétrico.
      await db
        .from("diretor_candidatos")
        .update({ review_status: "rejeitado", reviewed_at: new Date().toISOString(), reviewed_by: "aprovar-lote:nome-invalido" })
        .eq("id", candidato.id);
      pulados.push({ id: candidato.id, nome, reason: "nome não passa na validação estrita — REJEITADO (prosa não vira pessoa)" });
      continue;
    }
    if (!candidato.agencia_id || !colegiadaIds.has(candidato.agencia_id)) {
      pulados.push({ id: candidato.id, nome, reason: "agência fora da esteira de votos (não-colegiada) — não cria diretor" });
      continue;
    }
    if ((ocorrenciasPorNome.get(`${candidato.agencia_id}|${nome}`) ?? 1) < 2) {
      pulados.push({ id: candidato.id, nome, reason: "nome visto em 1 documento só — aguarda reaparecer para virar diretor" });
      continue;
    }
    const match = candidato.agencia_id ? findBestMatch(nome, await diretoresDe(candidato.agencia_id)) : { diretorId: null, needsReview: false };
    if (match.diretorId && match.needsReview) {
      // Faixa 0.6–0.8: provável variante de grafia de alguém já cadastrado — criar duplicaria a pessoa.
      pulados.push({ id: candidato.id, nome, reason: "similaridade 0.6–0.8 com diretor existente (provável variante de grafia) — decidir manualmente" });
      continue;
    }
    try {
      // <0.6 (ninguém parecido) ou ≥0.85 (o aprovarCandidato reusa o cadastro): aprova.
      const result = await aprovarCandidato(db, candidato, { reviewedBy });
      aprovados.push({ id: candidato.id, nome, diretor_id: result.diretorId });
    } catch (e) {
      console.error("[candidatos/aprovar-lote] Falha (novo):", e);
      pulados.push({ id: candidato.id, nome, reason: "erro ao aprovar (novo)" });
    }
  }

  return NextResponse.json({
    // Parou no saldo: o orquestrador só volta na rodada seguinte se souber que sobrou.
    ...(parcial ? { parcial: true, restantes: true } : {}),
    min_confidence: minConfidence,
    analisados: (candidatos ?? []).length + candidatosNovos.length,
    aprovados: aprovados.length,
    // Etapa67 — a MEDIÇÃO do auto-resolver fica embutida: a primeira rodada de "Rodar tudo" em
    // produção diz se o fallback sem margem é raro (hipótese) ou frequente. Só com o número na
    // mão ele ganharia visibilidade própria.
    resolvidos_por_margem: aprovadosPorMargem,
    resolvidos_por_mandato: resolvidosPorMandato,
    resolvidos_sem_margem: resolvidosSemMargem,
    aprovados_por_margem: aprovadosPorMargem,
    pulados: pulados.length,
    aprovados_detalhe: aprovados,
    pulados_detalhe: pulados.slice(0, 30),
    legal_notice: "Aprovação em lote conservadora: só candidatos com match a diretor já cadastrado (≥ limiar). Votos retroativos aplicados de forma idempotente.",
  });
}
