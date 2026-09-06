/**
 * POST /api/v1/admin/votos/materializar-faltantes
 *
 * Backfill de votos (QA ago/2026): as correções na inferência (hasNominalNames por
 * nomes CASADOS, roster do pai em item ANTT unânime, retroativos destravados) só
 * valem para uploads futuros — as deliberações finais JÁ gravadas sem nenhum voto
 * continuariam zeradas. Esta rota relê o `raw_extraction` persistido (nomes_votacao*,
 * unanimidade_detectada, documento_antt_tipo) e reaplica `buildVotoRows` com as
 * regras atuais. NUNCA chuta: só materializa quando a evidência persistida sustenta
 * (unanimidade textual + roster de mandato/presentes, ou divergência nomeada).
 *
 * Body: { dry_run?: boolean (default TRUE), agencia_id?: string, year?: "2026" }.
 * Idempotente: upsert por (deliberacao_id, diretor_id); só toca deliberações com 0 votos.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { hasBudget, budgetFromRequest } from "@/lib/server/time-budget";
import { findBestMatch } from "@/lib/server/name-matcher";
import { conferirRoster } from "@/lib/server/roster-conferivel";
import { COLEGIADO_SIGLAS } from "@/lib/server/colegiado-sources";
import { RE_CONTESTADO, RE_CONTESTADO_AMPLO } from "@/lib/server/consistency-checks";
import {
  buildVotoRows,
  getActiveDiretoresForVote,
  shouldInferVotesFromMandate,
  type DiretorVoteRecord,
  type VotoInsertRow,
} from "@/lib/server/vote-inference";
import { upsertVotosProtegido } from "@/lib/server/votos-write";
import { foraDaJanelaDeMandatos, type JanelaDeMandato } from "@/lib/server/janela-de-mandatos";
import { TIPOS_NAO_FINAIS_SET } from "@/lib/server/regulatory-documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Fase 12 — 60 → 120: esta rota honra `budget_ms`/HOBBY_BUDGET_MS (70s); declarar 60 aqui
// pediria o kill da plataforma ANTES de o próprio orçamento parar o trabalho. 120 é o valor
// que pipeline/run e o vercel.json já declaram e que os builds já provaram.
export const maxDuration = 120;

const NAO_FINAL = TIPOS_NAO_FINAIS_SET; // fonte única (etapa65)
const YEAR_RE = /^(20)\d{2}$/;

function arr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Backfill indisponível em modo DEMO." }, { status: 403 });
  }
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as {
    dry_run?: unknown; agencia_id?: unknown; year?: unknown;
  };
  const dryRun = body.dry_run !== false; // default true — aplicar exige dry_run:false explícito
  const agenciaFiltro = typeof body.agencia_id === "string" && body.agencia_id ? body.agencia_id : null;
  const year = typeof body.year === "string" && YEAR_RE.test(body.year) ? body.year : null;

  const deadlineAt = Date.now() + Math.min(budgetFromRequest(req), 50_000);
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // Só agências COLEGIADAS têm esteira de votos — fora delas não se materializa nada.
  const { data: agRows } = await db.from("agencias").select("id, sigla");
  const colegiadaIds = new Set(
    ((agRows ?? []) as Array<{ id: string; sigla: string }>)
      .filter((a) => COLEGIADO_SIGLAS.has(String(a.sigla)))
      .map((a) => a.id),
  );

  let query = db
    .from("deliberacoes")
    // `resumo_pleito` entra no SELECT para MEDIR (Fase 20, commit 3a) — a regra vigente ainda
    // NÃO o lê. É onde mora o dispositivo dos itens de ata, e ler o dispositivo muda um número
    // exibido publicamente: a medição vem antes da mudança.
    .select("id, agencia_id, tipo_documento, documento_pai_id, resultado, data_reuniao, raw_extraction, fundamento_decisao, decisoes_todas, resumo_pleito")
    .not("resultado", "is", null)
    .order("id", { ascending: true })
    .limit(4000);
  if (agenciaFiltro) query = query.eq("agencia_id", agenciaFiltro);
  if (year) query = query.gte("data_reuniao", `${year}-01-01`).lte("data_reuniao", `${year}-12-31`);
  const { data: delibs, error } = await query;
  if (error) return NextResponse.json({ error: "Falha ao listar deliberações." }, { status: 500 });

  // Finais (mesma regra da Completude: ata só conta como filho com resultado).
  const finais = (delibs ?? []).filter((d: any) => {
    if (NAO_FINAL.has(String(d.tipo_documento))) return false;
    if (d.tipo_documento === "ata") return Boolean(d.documento_pai_id && d.resultado);
    return true;
  });

  // Quais já têm voto (consulta em chunks de 200 ids).
  const comVoto = new Set<string>();
  for (let i = 0; i < finais.length; i += 200) {
    const chunk = finais.slice(i, i + 200).map((d: any) => d.id);
    const { data: v } = await db.from("votos").select("deliberacao_id").in("deliberacao_id", chunk);
    for (const row of v ?? []) comVoto.add((row as { deliberacao_id: string }).deliberacao_id);
  }
  const semVoto = finais.filter((d: any) => !comVoto.has(d.id));

  // Cadastro de diretores por agência (cache) — nome mais longo primeiro (determinismo,
  // mesmo critério do confirm).
  const diretoresCache = new Map<string, DiretorVoteRecord[]>();
  async function diretoresDa(agenciaId: string): Promise<DiretorVoteRecord[]> {
    const hit = diretoresCache.get(agenciaId);
    if (hit) return hit;
    const { data } = await db.from("diretores").select("id, nome, nome_variantes").eq("review_status", "aprovado").eq("agencia_id", agenciaId);
    const lista = (data ?? []).map((dir: any) => ({
      id: dir.id,
      nome: dir.nome,
      nome_variantes: Array.isArray(dir.nome_variantes) ? dir.nome_variantes : [],
    })).sort((x: DiretorVoteRecord, y: DiretorVoteRecord) => y.nome.length - x.nome.length);
    diretoresCache.set(agenciaId, lista);
    return lista;
  }

  /**
   * Quantos `diretor_candidatos` PENDENTES a agência tem — o sinal da camada 3 do guard de
   * roster. Candidato pendente é um nome que os documentos conhecem e o cadastro não; com ele em
   * aberto, o roster daquela agência é sabidamente incompleto, mesmo que a ata não nomeie
   * ninguém. Cacheado por agência: são poucas, e a resposta não muda dentro da rodada.
   */
  const candidatosCache = new Map<string, number>();
  async function candidatosPendentesDa(agenciaId: string | null): Promise<number> {
    if (!agenciaId) return 0;
    const hit = candidatosCache.get(agenciaId);
    if (hit !== undefined) return hit;
    const { count, error } = await db
      .from("diretor_candidatos")
      .select("id", { count: "exact", head: true })
      .eq("agencia_id", agenciaId)
      // A coluna e `review_status` (005:151), com CHECK em pendente/aprovado/rejeitado/conflito.
      // `conflito` conta junto: cadastro em disputa tambem e cadastro nao-conferivel.
      .in("review_status", ["pendente", "conflito"]);
    // Sem o dado, o lado seguro é 0: bloquear tudo por causa de uma consulta que falhou seria
    // trocar um erro por outro. O veredito `roster_nao_conferivel` continua registrando a dúvida.
    const n = error ? 0 : (count ?? 0);
    candidatosCache.set(agenciaId, n);
    return n;
  }

  /**
   * As janelas de mandato conhecidas por agência (cache por agência, como o roster).
   * Mesmos filtros de `getActiveDiretoresForVote`: mandato FABRICADO não conta como conhecimento —
   * usar `fonte_dado='automatico'` aqui faria a janela se auto-ampliar a partir do próprio voto
   * inferido, e a plataforma passaria a afirmar que sabia quem votava justamente onde não sabia.
   */
  const janelasCache = new Map<string, JanelaDeMandato[]>();
  async function janelasDa(agenciaId: string): Promise<JanelaDeMandato[]> {
    const emCache = janelasCache.get(agenciaId);
    if (emCache) return emCache;
    const { data } = await db
      .from("mandatos")
      .select("data_inicio, data_fim, diretores!inner(agencia_id, review_status)")
      .eq("diretores.agencia_id", agenciaId)
      .neq("fonte_dado", "automatico")
      .eq("diretores.review_status", "aprovado");
    const janelas = ((data ?? []) as Array<{ data_inicio: string | null; data_fim: string | null }>)
      .map((m) => ({ data_inicio: m.data_inicio, data_fim: m.data_fim }));
    janelasCache.set(agenciaId, janelas);
    return janelas;
  }

  let materializaveis = 0;
  let votosCriados = 0;
  let semEvidencia = 0;
  let rosterNaoConferivel = 0;
  /** Fase 20 — itens ANTERIORES ao primeiro mandato conhecido. Não é falha: é falta de registro. */
  let foraDaJanela = 0;
  const foraDaJanelaPorAgencia: Record<string, number> = {};
  const detalheRoster: Array<{ deliberacao_id: string; motivo: string; nao_reconhecidos: string[] }> = [];
  let restantes = false;
  const detalhe: Array<{ deliberacao_id: string; votos: number; origem: string }> = [];
  /** Commit 3a — o delta da regra que LÊ O DISPOSITIVO, por agência. Medição, não comportamento. */
  const deltaPorAgencia: Record<string, { itens: number; votos: number }> = {};
  const deltaDetalhe: Array<{ deliberacao_id: string; agencia: string; resultado: string | null; trecho: string }> = [];
  /** Commit 3a — itens que o predicado AMPLO pegaria e o vigente deixa passar, por agência. */
  const deltaRegex: Record<string, number> = {};
  const siglaPorId = new Map(
    ((agRows ?? []) as Array<{ id: string; sigla: string }>).map((a) => [a.id, String(a.sigla)]),
  );
  const siglaDe = (id: string | null) => siglaPorId.get(String(id)) ?? "?";

  for (const d of semVoto as any[]) {
    if (!hasBudget(deadlineAt, 8_000)) { restantes = true; break; }
    if (!d.agencia_id || !colegiadaIds.has(d.agencia_id)) { semEvidencia++; continue; }
    const raw = (d.raw_extraction ?? {}) as Record<string, unknown>;
    const nomes = arr(raw.nomes_votacao);
    const nomesContra = arr(raw.nomes_votacao_contra);
    const nomesAusente = arr(raw.nomes_votacao_ausente);
    const nomesAbstencao = arr(raw.nomes_votacao_abstencao);
    // Impedimento persistido (etapa50). Materializar SEM ele reintroduziria o "Favoravel"
    // fabricado justamente nas deliberações que ainda não têm voto — o pior lugar para errar.
    const nomesImpedido = arr(raw.impedimentos).length
      ? arr(raw.impedimentos)
      : arr(raw.nomes_votacao_impedido);
    const unanime = Boolean(raw.unanimidade_detectada);
    const isAnttAtaItem = d.tipo_documento === "ata" && Boolean(raw.documento_antt_tipo);

    // ═══ Fase 20 — FORA DA JANELA ≠ CADASTRO INCOMPLETO ════════════════════
    // O mandato ANM verificado mais antigo começa em 05/12/2022 e a fonte nova da agência é o
    // acervo ANTIGO. Sem este gate, toda deliberação de 2019 cairia em `roster_nao_conferivel` —
    // o balde que diz "vá consertar o cadastro". Não há o que consertar: a plataforma não tem
    // registro de quem eram os diretores. Misturar as duas coisas manda o operador procurar um
    // defeito inexistente e faz a cobertura PARECER que piorou quando o acervo entra.
    const motivoFora = foraDaJanelaDeMandatos({
      dataReuniao: d.data_reuniao,
      janelas: await janelasDa(d.agencia_id),
    });
    if (motivoFora) {
      foraDaJanela++;
      const sigla = siglaDe(d.agencia_id);
      foraDaJanelaPorAgencia[sigla] = (foraDaJanelaPorAgencia[sigla] ?? 0) + 1;
      continue;
    }

    const diretoresList = await diretoresDa(d.agencia_id);
    if (diretoresList.length === 0) { semEvidencia++; continue; }

    // Roster: presentes persistidos casados ≥0.85; fallback mandatos na data (mesma
    // hierarquia do confirm). Em item ANTT, os nomes_votacao SÃO os presentes.
    const presentes = isAnttAtaItem ? nomes : arr(raw.nomes_presentes);
    const presentesRoster = presentes
      .map((nome) => {
        const m = findBestMatch(nome, diretoresList);
        return m.diretorId && !m.needsReview
          ? diretoresList.find((x) => x.id === m.diretorId) ?? null
          : null;
      })
      .filter((x): x is DiretorVoteRecord => Boolean(x));
    const activeDiretoresList = presentesRoster.length > 0
      ? presentesRoster
      : await getActiveDiretoresForVote(db, d.agencia_id, d.data_reuniao, diretoresList);

    // ═══ Fase 20 — NÃO ATRIBUIR VOTO A QUEM NÃO VOTOU ══════════════════════
    // Medido: os diretores da ANM Roger Romão Cabral e Tasso Mendonça Júnior aparecem nos
    // documentos e NÃO têm mandato verificado. Na 79ª ROP o preâmbulo nomeia os dois, e o roster
    // de mandato devolve Caio Mário no lugar deles. Inferir ali não é "cobertura parcial": é
    // gravar voto no nome ERRADO — e um voto errado se propaga por todas as métricas parecendo
    // legítimo, enquanto um voto ausente pelo menos se vê.
    //
    // Três camadas, porque comparar só quando a ata nomeia deixaria o mesmo erro passar em
    // silêncio nas atas de outro formato: presença → assinatura → cadastro (candidatos pendentes,
    // um sinal do CORPUS que funciona mesmo com a ata muda).
    const vereditoRoster = conferirRoster({
      roster: activeDiretoresList,
      nomesPresentes: presentes,
      signatarios: arr(raw.signatarios),
      candidatosPendentes: await candidatosPendentesDa(d.agencia_id),
    });
    if (!vereditoRoster.confiavel) {
      rosterNaoConferivel++;
      if (detalheRoster.length < 20) {
        detalheRoster.push({
          deliberacao_id: d.id,
          motivo: vereditoRoster.motivo,
          nao_reconhecidos: vereditoRoster.naoReconhecidos,
        });
      }
      continue;
    }

    // Fase 14 — o texto persistido para medir contestação: fundamento + dispositivo + raw. É
    // este ramo que fecha o estoque (136/160 da ANTT sem voto) SEM re-ingerir nada — inferência
    // por decisão, com "por maioria" sem nomes continuando 0 voto.
    const textoDecisao = [
      (d as { fundamento_decisao?: string | null }).fundamento_decisao,
      ...(((d as { decisoes_todas?: string[] | null }).decisoes_todas) ?? []),
      raw.assunto as string | undefined, raw.decisao as string | undefined,
    ].filter(Boolean).join(" ");
    const contestado = RE_CONTESTADO.test(textoDecisao);

    // ═══ Fase 20, commit 3a — MEDIR a regra que ainda não vale ═════════════
    // `resumo_pleito` é onde o dispositivo do item de ata é gravado (`ata-item-materializacao.ts`
    // grava a decisão ali, e `decisao` é omissão DECLARADA). Como `textoDecisao` não o lê, um item
    // decidido "por maioria" hoje passa por não-contestado e recebe "Favorável" fabricado para o
    // colegiado inteiro. Ler o dispositivo corrige isso — e DERRUBA a contagem de votos exibida.
    //
    // Número público não muda sem medição visível antes. Esta rodada computa as DUAS regras e
    // reporta o delta; o comportamento continua o da regra vigente.
    const textoComPleito = [textoDecisao, (d as { resumo_pleito?: string | null }).resumo_pleito]
      .filter(Boolean).join(" ");
    const contestadoComPleito = RE_CONTESTADO.test(textoComPleito);

    // A SEGUNDA medição, independente da primeira: o predicado vigente aqui não reconhece
    // "divergência" nem "voto vencedor" — o do extrator reconhece. Quem decide se o colegiado
    // inteiro ganha voto inferido é o daqui, o mais estreito. Medido antes de trocar.
    if (!contestado && RE_CONTESTADO_AMPLO.test(textoComPleito)) {
      const sigla = siglaDe(d.agencia_id);
      deltaRegex[sigla] = (deltaRegex[sigla] ?? 0) + 1;
    }

    if (contestadoComPleito !== contestado) {
      const sigla = siglaDe(d.agencia_id);
      deltaPorAgencia[sigla] = deltaPorAgencia[sigla] ?? { itens: 0, votos: 0 };
      deltaPorAgencia[sigla].itens++;
      if (deltaDetalhe.length < 20) {
        deltaDetalhe.push({
          deliberacao_id: d.id,
          agencia: sigla,
          resultado: d.resultado,
          trecho: String((d as { resumo_pleito?: string | null }).resumo_pleito ?? "").slice(0, 200),
        });
      }
    }
    const inferFromMandate = isAnttAtaItem
      ? Boolean((unanime || !contestado) && d.resultado && activeDiretoresList.length > 0)
      : shouldInferVotesFromMandate({
        sinaisContestacao: contestado,
        resultado: d.resultado,
        tipo_documento: d.tipo_documento,
        import_counts_as_final: d.tipo_documento === "ata" ? Boolean(d.resultado) : (raw.import_counts_as_final as boolean | null | undefined),
        unanimidadeDetectada: unanime,
        nomes,
        nomesContra,
        nomesAbstencao,
        dataReuniao: d.data_reuniao,
        diretoresList,
      });

    const rows: VotoInsertRow[] = buildVotoRows({
      deliberacao_id: d.id,
      nomes: isAnttAtaItem ? [] : nomes,
      nomesContra,
      nomesAusente,
      nomesAbstencao,
      nomesImpedido,
      diretoresList,
      activeDiretoresList,
      inferFromMandate,
      resultado: d.resultado,
      unanime,
    });

    if (rows.length === 0) { semEvidencia++; continue; }
    materializaveis++;
    // O delta em VOTOS: quantos destes deixariam de existir sob a regra que lê o dispositivo.
    // Só conta onde a inferência é a origem — voto NOMINAL não depende da detecção de contestação.
    if (contestadoComPleito && !contestado && inferFromMandate) {
      const sigla = siglaDe(d.agencia_id);
      deltaPorAgencia[sigla] = deltaPorAgencia[sigla] ?? { itens: 0, votos: 0 };
      deltaPorAgencia[sigla].votos += rows.length;
    }
    if (detalhe.length < 50) {
      detalhe.push({ deliberacao_id: d.id, votos: rows.length, origem: inferFromMandate ? "inferencia" : "nominal" });
    }
    if (!dryRun) {
      // Etapa58: write-path COMPARTILHADO. Antes era upsert cru — sem a proteção do voto nominal,
      // materializar podia REBAIXAR para inferido um voto lido do documento; e sem a sonda de
      // capacidade, gravar `proveniencia` quebraria enquanto a migration não fosse aplicada.
      const { error: upErr } = await upsertVotosProtegido(db, rows);
      if (upErr) console.error("[materializar-faltantes] upsert falhou:", upErr.message);
      else votosCriados += rows.length;
    } else {
      votosCriados += rows.length;
    }
  }

  return NextResponse.json({
    dry_run: dryRun,
    finais_analisadas: finais.length,
    sem_voto: semVoto.length,
    materializaveis,
    votos: votosCriados,
    sem_evidencia: semEvidencia,
    // Fase 20 — itens que NÃO viraram voto porque o roster não pôde ser conferido contra o
    // documento. Não é falha: é a recusa de gravar voto no nome errado. O detalhe diz QUEM o
    // cadastro não reconheceu, que é o que o operador precisa para consertar.
    roster_nao_conferivel: rosterNaoConferivel,
    /**
     * Fase 20 — itens anteriores ao primeiro mandato conhecido da agência. Contam em cobertura,
     * microtemas e histórico; ficam FORA do denominador de votação, porque ali a resposta honesta
     * não é "sem voto", é "fora do período em que sabemos quem votava". Separá-los de
     * `roster_nao_conferivel` é o que permite ingerir o acervo pré-2022 sem estragar a métrica.
     */
    fora_da_janela_de_mandatos: foraDaJanela,
    fora_da_janela_por_agencia: foraDaJanelaPorAgencia,
    detalhe_roster: detalheRoster,
    restantes,
    detalhe,
    /**
     * Commit 3a — o que MUDARIA se a regra lesse `resumo_pleito`, sem que nada tenha mudado.
     * `itens` = deliberações em que a detecção de contestação inverteria; `votos` = quantos votos
     * inferidos deixariam de ser gravados. `trecho` mostra o dispositivo que causou a inversão,
     * para conferir se a detecção está certa antes de a regra passar a valer.
     */
    delta_dispositivo: {
      por_agencia: deltaPorAgencia,
      itens_que_mudariam: Object.values(deltaPorAgencia).reduce((a, b) => a + b.itens, 0),
      votos_a_menos: Object.values(deltaPorAgencia).reduce((a, b) => a + b.votos, 0),
      amostra: deltaDetalhe,
      /**
       * Medição INDEPENDENTE: itens que o predicado da união (`RE_CONTESTADO_AMPLO`) marcaria
       * como contestados e o vigente deixa passar — "divergência" e "voto vencedor" são os termos
       * que só a outra implementação conhece. Cada um destes é um item onde o colegiado inteiro
       * pode estar recebendo voto inferido apesar de a decisão ter sido disputada.
       */
      por_regex_divergente: deltaRegex,
    },
    ...(dryRun ? { aviso: "Simulação — repita com dry_run:false para gravar." } : {}),
  });
}
