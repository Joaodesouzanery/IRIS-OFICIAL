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
import { isDemoRequest } from "@/lib/server/request-guards";

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

  // Votos deste diretor com join em deliberações.
  //
  // O SELECT pede as colunas da migration 20260824120000 (proveniencia/motivo_nao_voto/
  // voto_em_autos) e CAI PARA a versão sem elas se o PostgREST recusar. A regra do projeto é
  // explícita: o deploy vem ANTES da migration, e o código tem de degradar. Sem este retry, a
  // ficha de TODO diretor devolveria 500 num ambiente que ainda não aplicou o SQL — a tela mais
  // sensível do produto quebrando por causa de uma coluna que ainda vai existir.
  const JOIN_DELIB = `
      deliberacoes!inner(
        id, numero_deliberacao, data_reuniao, interessado,
        microtema, resultado
      )`;
  const buscarVotos = (colunas: string) => db
    .from("votos")
    .select(`${colunas},${JOIN_DELIB}`)
    .eq("diretor_id", id)
    .order("deliberacoes(data_reuniao)", { ascending: false });

  let { data: votos, error: erroVotos } = await buscarVotos(
    "tipo_voto, is_divergente, is_nominal, proveniencia, motivo_nao_voto, voto_em_autos",
  );
  if (erroVotos) {
    // PGRST204/42703 = coluna ainda não existe. Qualquer outro erro também cai aqui e degrada
    // para o conjunto mínimo — perder a granularidade nova é melhor que perder a ficha inteira.
    ({ data: votos } = await buscarVotos("tipo_voto, is_divergente, is_nominal"));
  }

  let favoravel = 0, desfavoravel = 0, abstencao = 0, divergente = 0, votos_inferidos = 0;
  let ausente = 0, impedido = 0, base_nominal = 0, divergente_nominal = 0, votos_em_autos = 0;
  const microtemaCount = new Map<string, number>();
  const microtemaDiv = new Map<string, number>();
  const mesMap = new Map<string, { total: number; favoravel: number; desfavoravel: number; divergente: number }>();
  const historico: DiretorProfile["historico"] = [];

  for (const v of votos ?? []) {
    const d = v as unknown as {
      tipo_voto: string; is_divergente: boolean; is_nominal: boolean;
      proveniencia?: string | null; motivo_nao_voto?: string | null; voto_em_autos?: boolean | null;
      deliberacoes: { id: string; numero_deliberacao: string | null; data_reuniao: string | null;
        interessado: string | null; microtema: string | null; resultado: string | null };
    };
    // Etapa61 — DENOMINADOR DO DIRETOR. O `else` catch-all jogava "Ausente" no balde de
    // ABSTENÇÃO e o contava no denominador: ausência física e IMPEDIMENTO viravam "absteve-se".
    // O efeito é perverso — impedimento é conduta de INTEGRIDADE (o diretor se declara impedido),
    // e ele derrubava o percentual do próprio diretor. Agora o não-voto sai do denominador DELE;
    // o item continua contando para o colegiado.
    const naoVotou = d.tipo_voto === "Ausente";
    if (d.tipo_voto === "Favoravel") favoravel++;
    else if (d.tipo_voto === "Desfavoravel") desfavoravel++;
    else if (naoVotou) {
      ausente++;
      if (d.motivo_nao_voto === "impedimento" || d.motivo_nao_voto === "suspeicao") impedido++;
    }
    else abstencao++;
    if (d.is_divergente) divergente++;
    if (!d.is_nominal) votos_inferidos++;
    // COMPORTAMENTO só se apoia em voto LIDO ou CORRIGIDO POR HUMANO. Voto inferido é, por
    // construção, não-divergente: medir divergência sobre ele é tautologia, não medida.
    const nominalOuHumano = d.proveniencia === "nominal" || d.proveniencia === "revisao_humana"
      || (d.proveniencia == null && d.is_nominal);
    if (nominalOuHumano && !naoVotou) {
      base_nominal++;
      if (d.is_divergente) divergente_nominal++;
    }
    // Voto proferido em sessão ANTERIOR não é presença nesta — sai da série temporal (etapa57).
    if (d.voto_em_autos) votos_em_autos++;
    if (d.deliberacoes.microtema) {
      microtemaCount.set(d.deliberacoes.microtema, (microtemaCount.get(d.deliberacoes.microtema) ?? 0) + 1);
      if (d.is_divergente) microtemaDiv.set(d.deliberacoes.microtema, (microtemaDiv.get(d.deliberacoes.microtema) ?? 0) + 1);
    }
    const periodo = d.deliberacoes.data_reuniao?.slice(0, 7);
    if (periodo) {
      const m = mesMap.get(periodo) ?? { total: 0, favoravel: 0, desfavoravel: 0, divergente: 0 };
      m.total++;
      if (d.tipo_voto === "Favoravel") m.favoravel++;
      else if (d.tipo_voto === "Desfavoravel") m.desfavoravel++;
      if (d.is_divergente) m.divergente++;
      mesMap.set(periodo, m);
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
      is_nominal: d.is_nominal,
    });
  }

  // `total` = votos EFETIVAMENTE PROFERIDOS por este diretor. "Ausente" (ausência, impedimento,
  // suspeição, vista) sai daqui: não votar não é votar de um jeito.
  const total = favoravel + desfavoravel + abstencao;
  const total_participacoes = total + ausente; // participação ≠ comportamento
  const pct_favoravel = total > 0 ? (favoravel / total) * 100 : 0;
  const pct_divergente = total > 0 ? (divergente / total) * 100 : 0;
  // Divergência sobre a base NOMINAL — a única que mede comportamento de verdade.
  const pct_divergente_nominal = base_nominal > 0 ? (divergente_nominal / base_nominal) * 100 : null;

  // O PERFIL passa a sair da base nominal quando ela existe. Com base inferida, "Consensual" era
  // tautologia: voto inferido nunca diverge. Sem base nominal nenhuma, não há perfil a declarar —
  // rotular alguém de "Consensual" sem ter lido um voto dele é inventar reputação.
  const perfil: DiretorProfile["tendencias"]["perfil"] | null =
    pct_divergente_nominal === null ? null
    : pct_divergente_nominal < 5 ? "Consensual"
    : pct_divergente_nominal < 15 ? "Moderadamente divergente"
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
    stats: { total_votos: total, favoravel, desfavoravel, abstencao, divergente, pct_favoravel, pct_divergente, votos_inferidos },
    por_microtema: [...microtemaCount.entries()]
      .map(([microtema, t]) => ({ microtema, total: t }))
      .sort((a, b) => b.total - a.total),
    serie_temporal: [...mesMap.entries()]
      .map(([period, m]) => ({ period, ...m }))
      .sort((a, b) => a.period.localeCompare(b.period)),
    divergencia_por_tema: [...microtemaCount.entries()]
      .map(([microtema, t]) => ({
        microtema, total: t, divergente: microtemaDiv.get(microtema) ?? 0,
        pct_divergente: t > 0 ? Math.round(((microtemaDiv.get(microtema) ?? 0) / t) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.pct_divergente - a.pct_divergente),
    historico,
    // Etapa61 — a BASE fica visível ao lado de todo número de comportamento. O plano decidiu
    // EXIBIR com `n` em vez de suprimir: o corte por base mínima puniria justamente quem mais se
    // declara impedido (impedimento tira voto do denominador dele), invertendo o incentivo.
    base: {
      votos_proferidos: total,
      participacoes: total_participacoes,
      nao_votou: ausente,
      impedido,
      votos_em_autos,
      /** Votos LIDOS do documento ou corrigidos por humano — a base de comportamento. */
      base_nominal,
      pct_divergente_nominal,
    },
    tendencias: {
      perfil,
      microtema_dominante,
      taxa_aprovacao: total > 0 ? `${pct_favoravel.toFixed(1)}%` : "—",
      descricao: base_nominal === 0
        ? (total > 0
            ? `Sem voto nominal lido: ${total} voto(s) inferido(s) da decisão do colegiado, que por construção não divergem — não há base para descrever comportamento.`
            : "Sem histórico de votos registrado")
        : (pct_divergente_nominal! < 5
            ? `Vota com a maioria em ${(100 - pct_divergente_nominal!).toFixed(0)}% dos ${base_nominal} voto(s) lidos`
            : `Apresentou voto divergente em ${pct_divergente_nominal!.toFixed(1)}% dos ${base_nominal} voto(s) lidos`),
    },
  };

  return NextResponse.json(profile);
}
