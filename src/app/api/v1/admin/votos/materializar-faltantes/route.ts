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

import { resolverPresentesRoster } from "@/lib/server/presentes-roster";
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
import { lerTudo } from "@/lib/server/select-all-paged";
import { janelaRotativa } from "@/lib/server/varredura-rotativa";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Fase 12 — 60 → 120: esta rota honra `budget_ms`/HOBBY_BUDGET_MS (70s); declarar 60 aqui
// pediria o kill da plataforma ANTES de o próprio orçamento parar o trabalho. 120 é o valor
// que pipeline/run e o vercel.json já declaram e que os builds já provaram.
export const maxDuration = 120;

const NAO_FINAL = TIPOS_NAO_FINAIS_SET; // fonte única (etapa65)

/**
 * Quantos itens uma rodada examina. O passo `backfillVotos` tem 12s de fatia; a 8s por item (a
 * reserva de antes) isso dava ~1 item por rodada, o que não fecha uma volta nunca. 60 é o tamanho
 * que a janela rotativa cobre o estoque em poucos minutos sem que a preparação domine a fatia.
 */
const LOTE_POR_RODADA = 60;
/** Reserva por item dentro do laço — o mesmo 8s que já estava lá, agora nomeado e reusado. */
const RESERVA_POR_ITEM_MS = 8_000;
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

  /**
   * O roster ativo, memoizado por (agência, data). `getActiveDiretoresForVote` é um round-trip com
   * join em `mandatos`+`diretores`, e uma reunião rende DEZENAS de itens que compartilham agência
   * e data: sem cache, a mesma consulta ia ao banco uma vez por item. Numa fatia de 50s isso é
   * orçamento gasto para receber a resposta que já tínhamos.
   */
  const rosterCache = new Map<string, DiretorVoteRecord[]>();
  async function rosterAtivoEm(
    agenciaId: string,
    dataReuniao: string | null,
    fallback: DiretorVoteRecord[],
  ): Promise<DiretorVoteRecord[]> {
    const chave = `${agenciaId}|${dataReuniao ?? ""}`;
    const emCache = rosterCache.get(chave);
    if (emCache) return emCache;
    const roster = await getActiveDiretoresForVote(db, agenciaId, dataReuniao, fallback);
    rosterCache.set(chave, roster);
    return roster;
  }

  let materializaveis = 0;
  /** Quantos itens o laço de FATO olhou — o denominador dos contadores PARCIAIS. */
  let examinados = 0;
  let votosCriados = 0;
  let semEvidencia = 0;
  let rosterNaoConferivel = 0;
  let upsertFalhas = 0;
  const upsertErros: string[] = [];
  /** Fase 20 — itens ANTERIORES ao primeiro mandato conhecido. Não é falha: é falta de registro. */
  let foraDaJanela = 0;
  /**
   * Fase 28 — deliberação de agência NÃO-colegiada (ou sem agência). Era contada em
   * `sem_evidencia`, e não é ausência de evidência: é fora do escopo da esteira de votos, o
   * conceito que `COLEGIADO_SIGLAS` existe para nomear. Rotular fora-de-escopo como "sem
   * evidência" manda o operador procurar num documento um voto que nunca deveria estar lá.
   */
  let foraDeEscopo = 0;
  const foraDaJanelaPorAgencia: Record<string, number> = {};
  const detalheRoster: Array<{ deliberacao_id: string; motivo: string; nao_reconhecidos: string[] }> = [];
  let restantes = false;
  const detalhe: Array<{ deliberacao_id: string; votos: number; origem: string }> = [];
  /** Commit 3a — o delta da regra que LÊ O DISPOSITIVO, por agência. Medição, não comportamento. */
  const deltaPorAgencia: Record<string, { itens: number; votos: number }> = {};
  const deltaDetalhe: Array<{ deliberacao_id: string; agencia: string; resultado: string | null; trecho: string }> = [];
  /** Commit 3a — itens que o predicado AMPLO pegaria e o vigente deixa passar, por agência. */
  const deltaRegex: Record<string, number> = {};
  const deltaFalsoPositivo: Record<string, number> = {};
  const siglaPorId = new Map(
    ((agRows ?? []) as Array<{ id: string; sigla: string }>).map((a) => [a.id, String(a.sigla)]),
  );
  const siglaDe = (id: string | null) => siglaPorId.get(String(id)) ?? "?";

  // ═══ Fase 28 — a leitura em DUAS FASES, e por que o `lerTudo` ingênuo seria pior ═══
  //
  // O defeito: `.limit(4000)` que o PostgREST corta em ~1.000, e o filtro "sem voto" aplicado
  // DEPOIS, em JS. Materializar não liberava vaga — a linha continuava ocupando seu lugar nas
  // 1.000. Deliberação com `id` além da milésima NUNCA era materializada, em run nenhuma.
  //
  // Mas trocar por `lerTudo` sobre o SELECT de antes regride PIOR que o bug: o passo `backfillVotos`
  // tem 12s de fatia e o laço abaixo só roda com mais de 8s de saldo. O SELECT de antes traz
  // `raw_extraction` (jsonb grande); paginar isso gasta a janela inteira ANTES do laço, e
  // `restantes` só vira `true` DENTRO do laço — passo verde, zero trabalho, para sempre.
  //
  // Por isso: projeção LEVE paginada (6 colunas escalares, 2-3 páginas), e o payload pesado
  // buscado só para o lote que a rodada vai de fato examinar.
  const candidatos = () => {
    let q = db
      .from("deliberacoes")
      .select("id, agencia_id, tipo_documento, documento_pai_id, resultado, data_reuniao")
      .not("resultado", "is", null)
      // `.order` não é cosmético: `selectAllPaged` pagina com `.range()`, e `.range()` sem
      // `ORDER BY` pode repetir e pular linhas entre páginas.
      .order("id", { ascending: true });
    if (agenciaFiltro) q = q.eq("agencia_id", agenciaFiltro);
    if (year) q = q.gte("data_reuniao", `${year}-01-01`).lte("data_reuniao", `${year}-12-31`);
    return q;
  };
  const levesRes = await lerTudo<any>(candidatos, "materializar/candidatos");
  if (levesRes.error) return NextResponse.json({ error: "Falha ao listar deliberações." }, { status: 500 });
  const leves = levesRes.data;

  // Finais (mesma regra da Completude: ata só conta como filho com resultado).
  const finais = leves.filter((d: any) => {
    if (NAO_FINAL.has(String(d.tipo_documento))) return false;
    if (d.tipo_documento === "ata") return Boolean(d.documento_pai_id && d.resultado);
    return true;
  });

  // Quais já têm voto. Era um laço de chunks de 200 `in()`, que cresce junto com `finais`; uma
  // leitura paginada de UMA coluna uuid é ~4 páginas e não depende do tamanho do outro lado.
  const votosRes = await lerTudo<{ deliberacao_id: string }>(
    () => db.from("votos").select("deliberacao_id").order("id"), "materializar/votos-ids");
  // ⚠️ `lerTudo` devolve `{error}` em vez de lançar, e no caminho de ERRO devolve
  // `truncated: false` com as linhas que já tinha (`select-all-paged.ts:23`). Ignorar o erro aqui
  // seria pior que truncar: `comVoto` sairia INCOMPLETO, deliberação que já tem voto voltaria para
  // `pendentes` e seria re-materializada — e `leitura_completa` afirmaria que estava tudo certo.
  if (votosRes.error) {
    return NextResponse.json({ error: "Falha ao listar votos existentes." }, { status: 500 });
  }
  const comVoto = new Set<string>((votosRes.data ?? []).map((r) => r.deliberacao_id));
  const semVotoTotal = finais.filter((d: any) => !comVoto.has(d.id));
  const leituraCompleta = !levesRes.truncated && !votosRes.truncated;

  // ═══ PARTIÇÃO antes de gastar orçamento ═══
  // Duas categorias são PERMANENTEMENTE irresolvíveis e custam quase nada para calcular: fora de
  // escopo (zero query) e fora da janela de mandatos (`janelasDa` é cacheado por agência, 3
  // queries). Computá-las sobre TODOS os candidatos as transforma em ESTOQUE completo, em vez de
  // "o que o laço alcançou nesta rodada" — que era o número que a tela vinha somando a cada
  // rodada, recontando os mesmos itens.
  const semVoto: any[] = [];
  for (const d of semVotoTotal as any[]) {
    if (!d.agencia_id || !colegiadaIds.has(d.agencia_id)) { foraDeEscopo++; continue; }
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
    semVoto.push(d);
  }

  // ═══ A JANELA da rodada, e o payload pesado só dela ═══
  const janela = janelaRotativa(semVoto.length, LOTE_POR_RODADA, Math.floor(Date.now() / 60_000));
  const loteBruto = semVoto.slice(janela.inicio, janela.fim);
  /**
   * ⚠️⚠️ O PIOR DEFEITO POSSÍVEL NESTE ARQUIVO, e foi assim que quase entrou.
   *
   * O laço decide inferir voto para o colegiado inteiro a partir de `raw_extraction`: sem nomes
   * nominais e sem sinal de contestação, ele infere. Um documento cujo payload pesado NÃO chegou
   * tem `raw_extraction` UNDEFINED — que o laço lê como "nada contestado, ninguém nomeado" e
   * infere voto para todo mundo. Uma falha de LEITURA viraria voto FABRICADO, gravado no banco, e
   * o banner diria "N voto(s) recuperado(s)".
   *
   * `lerTudo` devolve `{error}` em vez de lançar. Então: erro → a rodada não examina nada; e o
   * item que o `.in()` não devolveu é DESCARTADO do lote, nunca processado com o campo vazio.
   */
  let lotePesadoFalhou = false;
  let semPayload = 0;
  let lote: any[] = [];
  if (loteBruto.length > 0) {
    const pesadosRes = await lerTudo<any>(
      () => db.from("deliberacoes")
        // `resumo_pleito` entra no SELECT para MEDIR (Fase 20, commit 3a) — a regra vigente ainda
        // NÃO o lê. É onde mora o dispositivo dos itens de ata, e ler o dispositivo muda um número
        // exibido publicamente: a medição vem antes da mudança.
        .select("id, raw_extraction, fundamento_decisao, decisoes_todas, resumo_pleito")
        .in("id", loteBruto.map((d: any) => d.id))
        .order("id"),
      "materializar/lote-pesado");
    if (pesadosRes.error) {
      lotePesadoFalhou = true;
      console.error("[materializar-faltantes] leitura do lote pesado falhou:", pesadosRes.error);
    } else {
      const pesadoPorId = new Map<string, any>((pesadosRes.data ?? []).map((r: any) => [r.id, r]));
      for (const d of loteBruto) {
        const pesado = pesadoPorId.get(d.id);
        if (!pesado) { semPayload++; continue; }
        Object.assign(d, pesado);
        lote.push(d);
      }
    }
  }

  // ═══ PORTÃO DE ORÇAMENTO, antes do laço ═══
  // Hoje `restantes` só é setado DENTRO do laço: uma rodada que não coube era indistinguível de
  // uma rodada sem trabalho, e o passo reportava sucesso vazio. É a lição da Fase 21, registrada
  // em `resumo-do-backfill.ts`: zero com cara de saúde é o pior formato de zero.
  const preparacaoConsumiuAFatia = loteBruto.length > 0 && !hasBudget(deadlineAt, RESERVA_POR_ITEM_MS);
  const rodadaNaoExaminou = preparacaoConsumiuAFatia || lotePesadoFalhou;

  for (const d of (rodadaNaoExaminou ? [] : lote) as any[]) {
    if (!hasBudget(deadlineAt, RESERVA_POR_ITEM_MS)) { restantes = true; break; }
    examinados++;
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

    // ⚠️ Fase 28 — a checagem de janela de mandatos e a de escopo SAÍRAM daqui para a partição,
    // antes do laço. Não é reorganização: dentro do laço elas só contavam o que a rodada alcançava,
    // e a tela SOMAVA esse parcial a cada rodada, recontando os mesmos itens. Na partição elas são
    // estoque completo — um número que quer dizer alguma coisa.

    const diretoresList = await diretoresDa(d.agencia_id);
    if (diretoresList.length === 0) { semEvidencia++; continue; }

    // Roster: presentes persistidos casados ≥0.85; fallback mandatos na data (mesma
    // hierarquia do confirm). Em item ANTT, os nomes_votacao SÃO os presentes.
    const presentes = isAnttAtaItem ? nomes : arr(raw.nomes_presentes);
    const presentesRoster = resolverPresentesRoster(presentes, diretoresList);
    const activeDiretoresList = presentesRoster.length > 0
      ? presentesRoster
      : await rosterAtivoEm(d.agencia_id, d.data_reuniao, diretoresList);

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
    // ═══ Fase 22 — a regra do dispositivo VALE (aprovada com os números do banner) ═════
    // `textoDecisao` sozinho não lia `resumo_pleito` (onde `ata-item-materializacao` grava o
    // dispositivo), e `RE_CONTESTADO` confundia "taxa vencida" com contestação (etapa124: 10
    // falsos positivos) e não via "divergência" (2 falsos negativos). Agora: predicado corrigido
    // sobre decisão + dispositivo. Na virada, medido em produção: −4 votos em 2 itens.
    const textoComPleito = [textoDecisao, (d as { resumo_pleito?: string | null }).resumo_pleito]
      .filter(Boolean).join(" ");
    const contestado = RE_CONTESTADO_AMPLO.test(textoComPleito);

    // A medição INVERTE de papel: agora mede a regra ANTIGA contra a vigente — o que voltaria a
    // ser fabricado (ou suprimido) se alguém revertesse. Mesmas chaves no payload; o banner lê.
    const contestadoAntigo = RE_CONTESTADO.test(textoDecisao);
    if (contestado && !contestadoAntigo) {
      // Só a regra nova vê: "divergência", ou dispositivo que a antiga não lia.
      const sigla = siglaDe(d.agencia_id);
      deltaRegex[sigla] = (deltaRegex[sigla] ?? 0) + 1;
    }
    if (contestadoAntigo && !contestado) {
      // A antiga suprimia ("taxa vencida"): item unânime que VOLTA a ter voto.
      const sigla = siglaDe(d.agencia_id);
      deltaFalsoPositivo[sigla] = (deltaFalsoPositivo[sigla] ?? 0) + 1;
    }
    const contestadoComPleito = contestado; // nome mantido para o bloco de detalhe abaixo
    const contestadoRef = contestadoAntigo;

    if (contestadoComPleito !== contestadoRef) {
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

    // O delta em VOTOS, invertido: quantos votos a regra antiga teria fabricado neste item
    // (o roster inteiro), onde a nova recusou inferir. Voto NOMINAL não entra — não depende disto.
    if (contestado && !contestadoAntigo && !inferFromMandate && rows.length === 0) {
      const sigla = siglaDe(d.agencia_id);
      deltaPorAgencia[sigla] = deltaPorAgencia[sigla] ?? { itens: 0, votos: 0 };
      deltaPorAgencia[sigla].votos += activeDiretoresList.length;
    }
    if (rows.length === 0) { semEvidencia++; continue; }
    materializaveis++;
    if (detalhe.length < 50) {
      detalhe.push({ deliberacao_id: d.id, votos: rows.length, origem: inferFromMandate ? "inferencia" : "nominal" });
    }
    if (!dryRun) {
      // Etapa58: write-path COMPARTILHADO. Antes era upsert cru — sem a proteção do voto nominal,
      // materializar podia REBAIXAR para inferido um voto lido do documento; e sem a sonda de
      // capacidade, gravar `proveniencia` quebraria enquanto a migration não fosse aplicada.
      const { error: upErr } = await upsertVotosProtegido(db, rows);
      if (upErr) {
        // `supabase-js` devolve {error} em vez de lançar. O contador já não mentia para cima —
        // mas a falha só existia no console, invisível para quem lê a resposta da rodada. Uma
        // escrita que falha em silêncio é indistinguível de "não havia nada a gravar".
        upsertFalhas++;
        if (upsertErros.length < 10) upsertErros.push(upErr.message);
        console.error("[materializar-faltantes] upsert falhou:", upErr.message);
      } else {
        votosCriados += rows.length;
      }
    } else {
      votosCriados += rows.length;
    }
  }

  return NextResponse.json({
    dry_run: dryRun,
    finais_analisadas: finais.length,
    /**
     * Fase 28 — o ESTOQUE de deliberações finais sem voto, completo. Antes era a fatia de ~1.000
     * linhas que o PostgREST devolvia, e materializar não liberava vaga: o que estava além da
     * milésima nunca entrava. Agora `pendentes` é o que resta depois de tirar o que é
     * permanentemente irresolvível, e é ele que tem de CAIR a cada rodada.
     */
    sem_voto: semVotoTotal.length,
    pendentes: semVoto.length,
    examinados,
    /** A rodada olhou o bloco `bloco` de `blocos` — a varredura fecha uma volta em `blocos` min. */
    janela_bloco: janela.bloco,
    janela_blocos: janela.blocos,
    /** Leitura truncada = os números abaixo subcontam. Nunca deixar isso implícito. */
    leitura_completa: leituraCompleta,
    ...(preparacaoConsumiuAFatia ? { preparacao_consumiu_a_fatia: true } : {}),
    ...(lotePesadoFalhou ? { lote_pesado_falhou: true } : {}),
    ...(semPayload > 0 ? { sem_payload_descartados: semPayload } : {}),
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
    /** Escritas que FALHARAM. Zero aqui e `votos > 0` é a única leitura honesta de sucesso. */
    upsert_falhas: upsertFalhas,
    ...(upsertErros.length > 0 ? { upsert_erros: upsertErros } : {}),
    fora_da_janela_de_mandatos: foraDaJanela,
    /** Fase 28 — fora do ESCOPO da esteira (agência não-colegiada), que era contado em sem_evidencia. */
    fora_de_escopo: foraDeEscopo,
    fora_da_janela_por_agencia: foraDaJanelaPorAgencia,
    detalhe_roster: detalheRoster,
    /**
     * ⚠️ `restantes` NÃO pode ser `janela.blocos > 1`, por mais tentador que pareça.
     * O estoque `pendentes` inclui itens PERMANENTEMENTE irresolvíveis (sem evidência de voto,
     * roster não conferível). Eles nunca saem, então `blocos > 1` seria verdade para sempre e a
     * esteira nunca pararia — a "fila que nunca esvazia" que já custou uma fase a este projeto.
     * O sinal honesto é: o laço quebrou por orçamento, a preparação não coube, ou esta rodada
     * GRAVOU algo (e então a próxima pode achar mais). Bloco só de irresolvíveis devolve
     * zero e a esteira segue em frente, que é o desfecho certo.
     */
    restantes: restantes || rodadaNaoExaminou || (!dryRun && votosCriados > 0),
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
      /** Itens que o vigente marca como contestados e o corrigido não — voto suprimido por "taxa vencida". */
      por_regex_falso_positivo: deltaFalsoPositivo,
    },
    ...(dryRun ? { aviso: "Simulação — repita com dry_run:false para gravar." } : {}),
  });
}
