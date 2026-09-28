/**
 * GET /api/v1/admin/completude-2026?year=2026
 *
 * "Conferência completa" da esteira de votos para um ano: por agência, cruza
 * reuniões, documentos, deliberações, votos, diretores e empresas — respondendo
 * "já temos TUDO de 2026, por diretor, sem perder nada?". Complementa
 * cobertura-documentos (funil de scraper) e saude-dados (qualidade) com as duas
 * peças que ninguém calcula hoje: deliberações com interessado mas SEM empresa_id,
 * e diretores aprovados com 0 voto + votos órfãos.
 *
 * Read-only, admin (middleware + guard). Não filtra reuniões/docs de outras
 * fontes por ano quando a tabela não tem data; usa data_reuniao onde existe.
 */

import { lerTudo } from "@/lib/server/select-all-paged";
import { isVotoNominal } from "@/lib/server/vote-inference";
import { selectVotosComFallback } from "@/lib/server/votos-write";
import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { COLEGIADO_SIGLAS } from "@/lib/server/colegiado-sources";
import { TIPOS_NAO_FINAIS_SET } from "@/lib/server/regulatory-documents";

export const dynamic = "force-dynamic";

const NAO_FINAL = TIPOS_NAO_FINAIS_SET; // fonte única (etapa65)
const YEAR_RE = /^(20)\d{2}$/;

type Delib = {
  id: string;
  agencia_id: string | null;
  tipo_documento: string | null;
  documento_pai_id: string | null;
  numero_deliberacao: string | null;
  numero_reuniao: string | null;
  data_reuniao: string | null;
  resultado: string | null;
  interessado: string | null;
  empresa_id: string | null;
  reuniao_id: string | null;
};

/**
 * Deliberação FINAL — versão leve do predicado canônico `isFinalDecisionRecord`
 * (regulatory-documents.ts): exclui pauta/voto/apoio; ata só conta como filho COM
 * resultado (QA ago/2026: a regra antiga aceitava filho sem resultado, inflando a
 * Completude com itens que os demais dashboards descartam). Sem raw_extraction
 * aqui (40k linhas) — a checagem de subtipo fica de fora, delta desprezível.
 */
function isFinalDelib(d: Delib): boolean {
  if (NAO_FINAL.has(String(d.tipo_documento))) return false;
  if (d.tipo_documento === "ata") return Boolean(d.documento_pai_id && d.resultado);
  return true;
}

/**
 * O inteiro inicial de "08", "160", "15-A" → 8, 160, 15. `null` se não numérico.
 *
 * ⚠️ E de "1.028" → **1028**, não 1. O `^(\d+)` anterior parava no ponto; a alternativa com
 * separador de milhar vem primeiro, senão ela nunca é tentada. Aqui o campo é `numero_deliberacao`,
 * onde o milhar é raro — mas "1.028 vira 1" é errado em qualquer contexto, e era a terceira cópia
 * do mesmo defeito.
 */
function numeroInteiro(numero: string | null): number | null {
  if (!numero) return null;
  const m = numero.trim().match(/^(\d{1,3}(?:\.\d{3})+|\d+)/);
  if (!m) return null;
  const n = Number.parseInt(m[1].replace(/\./g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface AgenciaCompletude {
  agencia_id: string | null;
  sigla: string;
  nome: string;
  reunioes: { com_deliberacao: number };
  documentos_2026: { detectados: number; por_status: Record<string, number> };
  /**
   * Funil REAL de processamento (documentos_regulatorios por status). Sem ele, o
   * "detectados" acima (monitoramento_itens = links descobertos) era ambíguo entre
   * "nunca baixado", "arquivado" e "confirmado" (QA ago/2026 — caso ANM 17→0).
   */
  documentos_processados: { por_status: Record<string, number> };
  deliberacoes: { finais: number; sem_voto: number; so_inferidas: number; sem_empresa_id: number };
  votos: { total: number; nominais: number; inferidos: number };
  /**
   * ⚠️ `candidatos_pendentes` é candidato a DIRETOR, não documento — e a coluna se chamava só
   * "Pendentes", na mesma linha de números de documento. Grandezas diferentes com o mesmo rótulo:
   * era por isso que "Pendentes 0" convivia com "1 documento em revisão" sem parecer contradição.
   * `candidatos_em_conflito` é o subconjunto que a versão anterior NÃO contava.
   */
  diretores: { aprovados: number; com_voto: number; sem_mandato: number; candidatos_pendentes: number; candidatos_em_conflito: number };
  /**
   * Buraco de numeração: as deliberações de um ano/agência costumam ser sequenciais
   * (ARTESP 2026 = 08..62 contíguo). Um número pulado = documento provavelmente NÃO
   * capturado — invisível no funil de contagem. `faltantes` lista os números ausentes
   * dentro de [min,max] observados (capado); `range_suspeito` marca salto anômalo.
   */
  sequencia: { min: number | null; max: number | null; faltantes: number[]; range_suspeito: boolean };
  /**
   * ⚠️ NÃO é "quando capturamos" — é a DATA DE REUNIÃO mais recente que temos.
   *
   * Eu disse ao usuário "ANM 32 dias sem captura" lendo esta coluna, e estava errado. Os dois campos
   * são `MAX(data_reuniao)`: "ANM · 24/08 (32d)" significa *"a reunião mais recente que temos é de
   * 24/08"*, não que a coleta parou. As colunas `first_seen_at`/`last_seen_at` EXISTEM em
   * `monitoramento_itens` (`005_monitoramento_multiagency.sql`) e **nenhuma das duas é lida**.
   *
   * Efeito colateral do que é medido hoje: uma PAUTA publicada com data futura rejuvenesce o
   * indicador sem nada ter sido processado.
   *
   * Os nomes passam a dizer o que são, e `capturado_em` traz o dado que a coluna prometia.
   */
  ultima_captura: {
    /** `MAX(data_reuniao)` dos itens de monitoramento — reunião mais recente, não captura. */
    reuniao_mais_recente_no_monitoramento: string | null;
    /** `MAX(data_reuniao)` das deliberações — idem. */
    reuniao_mais_recente_com_deliberacao: string | null;
    /** ⚠️ ESTE é captura de verdade: `MAX(last_seen_at)` dos itens. Antes ninguém lia. */
    capturado_em: string | null;
  };
}

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    // Etapa65 — `totais: {}` fazia `completude.totais.documentos_2026_detectados` devolver
    // `undefined` no consumidor (votos-diretores/page.tsx), que o lê ENCADEADO e sem guard.
    return NextResponse.json({
      modo: "demo", ano: 2026, por_agencia: [], alertas: [],
      totais: {
        documentos_2026_detectados: 0, deliberacoes_finais: 0, deliberacoes_sem_voto: 0,
        deliberacoes_sem_empresa_id: 0, votos_total: 0, votos_nominais: 0, votos_inferidos: 0,
        votos_orfaos: 0, diretores_aprovados: 0, diretores_com_voto: 0, diretores_sem_mandato: 0,
        candidatos_pendentes: 0, deliberacoes_faltantes_sequencia: 0,
      },
    });
  }
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam && YEAR_RE.test(yearParam) ? yearParam : "2026";
  const de = `${year}-01-01`;
  const ate = `${year}-12-31`;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let votosTruncados = false;
  const [agenciasRes, delibsAllRes, itens2026Res, docsRegRes, votosRes, diretoresRes, mandatosRes, candidatosRes] =
    await Promise.all([
      db.from("agencias").select("id, sigla, nome").eq("ativo", true),
      // Acervo de deliberações (bounded); o subconjunto 2026 é filtrado em código
      // (também serve para detectar votos órfãos contra o universo real de ids).
      // Fase 25 — TUDO que agrega em JS lê a tabela inteira por `.range()`: `.limit(40000)` parava
      // nos ~1.000 do PostgREST, e a tela chamava de "órfão" o que ficou fora da fatia.
      lerTudo<Delib>(() => db.from("deliberacoes")
        .select("id, agencia_id, tipo_documento, documento_pai_id, numero_deliberacao, numero_reuniao, data_reuniao, resultado, interessado, empresa_id, reuniao_id")
        .order("id"), "completude/deliberacoes"),
      lerTudo(() => db.from("monitoramento_itens").select("id, agencia_id, status, data_reuniao, last_seen_at").gte("data_reuniao", de).lte("data_reuniao", ate).order("id"), "completude/itens"),
      lerTudo(() => db.from("documentos_regulatorios").select("id, agencia_id, status").order("id"), "completude/docs"),
      selectVotosComFallback<Array<{ deliberacao_id: string; diretor_id: string | null; is_nominal: boolean; proveniencia?: string | null }>>(
        async (c) => { const r = await lerTudo(() => db.from("votos").select(`id, ${c}`).order("id"), "completude/votos"); votosTruncados = r.truncated; return r; },
        "deliberacao_id, diretor_id, is_nominal, proveniencia", "deliberacao_id, diretor_id, is_nominal"),
      lerTudo(() => db.from("diretores").select("id, agencia_id").eq("review_status", "aprovado").order("id"), "completude/diretores"),
      lerTudo(() => db.from("mandatos").select("id, diretor_id").order("id"), "completude/mandatos"),
      /**
       * ⚠️ `pendente` OU `conflito` — porque é isso que BLOQUEIA voto.
       *
       * `materializar-faltantes` recusa materializar com qualquer dos dois ("cadastro em disputa
       * também é cadastro não-conferível"). A Completude contava só `pendente`, então um cadastro em
       * DISPUTA — que está impedindo voto agora — aparecia na tela como `0` verde. O painel dizia
       * "nada pendente" sobre a causa exata de o voto não existir.
       */
      lerTudo(() => db.from("diretor_candidatos").select("id, agencia_id, review_status")
        .in("review_status", ["pendente", "conflito"]).order("id"), "completude/candidatos"),
    ]);

  /**
   * ⚠️⚠️ AS LEITURAS QUE NINGUÉM CHECAVA — e por que isso é pior aqui que em qualquer outra tela.
   *
   * Das oito leituras acima, CINCO nunca tinham o `.error` olhado: `agencias`, `monitoramento_itens`,
   * `documentos_regulatorios`, `diretores`, `mandatos` e `diretor_candidatos`. Todas terminam em
   * `?? []` no consumo, e `?? []` não testa falha — testa `undefined`. Uma leitura que falhou vira
   * lista vazia, e lista vazia vira:
   *
   *   · agência com ZERO documentos (indistinguível de "a fonte não publicou nada");
   *   · ZERO diretores aprovados (indistinguível de "cadastro vazio");
   *   · **"Pendentes: 0" em verde** (indistinguível de "nada pendente").
   *
   * ⚠️ E `leitura_completa` só olhava `truncated`. `selectAllPaged` devolve `truncated: false` no
   * caminho de ERRO (`select-all-paged.ts`), então falha total produzia `leitura_completa: true` —
   * o painel afirmando que viu tudo justamente quando não viu nada. É o mesmo defeito que o Commit
   * G consertou em `cobertura-documentos`, num painel que se chama "Completude".
   */
  const LEITURAS: Array<[string, { error?: unknown; truncated?: boolean }]> = [
    ["agencias", agenciasRes as { error?: unknown }],
    ["deliberacoes", delibsAllRes],
    ["monitoramento_itens", itens2026Res],
    ["documentos_regulatorios", docsRegRes],
    ["votos", { error: votosRes.error, truncated: votosTruncados }],
    ["diretores", diretoresRes],
    ["mandatos", mandatosRes],
    ["diretor_candidatos", candidatosRes],
  ];
  const leiturasComErro = LEITURAS.filter(([, r]) => Boolean(r.error)).map(([n]) => n);
  const leiturasTruncadas = LEITURAS.filter(([, r]) => Boolean(r.truncated)).map(([n]) => n);

  // Só agências COLEGIADAS (esteira de votos configurada). As demais 10 foram semeadas para o
  // módulo de NOTÍCIAS e apareciam aqui zeradas — ou pior, com artefatos de misclassificação
  // de sigla (QA ago/2026: ANS/ANA "com deliberações e diretores votando").
  const agencias: Array<{ id: string; sigla: string; nome: string }> =
    (agenciasRes.data ?? []).filter((a: { sigla: string }) => COLEGIADO_SIGLAS.has(String(a.sigla)));
  const byId = new Map<string, AgenciaCompletude>();
  for (const a of agencias) {
    byId.set(a.id, {
      agencia_id: a.id, sigla: a.sigla, nome: a.nome,
      reunioes: { com_deliberacao: 0 },
      documentos_2026: { detectados: 0, por_status: {} },
      documentos_processados: { por_status: {} },
      deliberacoes: { finais: 0, sem_voto: 0, so_inferidas: 0, sem_empresa_id: 0 },
      votos: { total: 0, nominais: 0, inferidos: 0 },
      diretores: { aprovados: 0, com_voto: 0, sem_mandato: 0, candidatos_pendentes: 0, candidatos_em_conflito: 0 },
      sequencia: { min: null, max: null, faltantes: [], range_suspeito: false },
      ultima_captura: {
        reuniao_mais_recente_no_monitoramento: null,
        reuniao_mais_recente_com_deliberacao: null,
        capturado_em: null,
      },
    });
  }
  /**
   * ⚠️⚠️ ESTE `null` ERA UM SUMIDOURO MUDO, e todo laço abaixo fazia `if (!e) continue;`.
   *
   * Ele engole, sem contador e sem alerta, TRÊS populações distintas:
   *   1. `agencia_id IS NULL` — nullable por desenho, e há 19 documentos assim em produção;
   *   2. agência com `ativo = false` — o `.eq("ativo", true)` da leitura já a tirou do mapa;
   *   3. sigla fora de `COLEGIADO_SIGLAS` — as 10 agências semeadas para o módulo de notícias.
   *
   * E o cabeçalho da tela é `reduce` sobre as três linhas: **o que não tem agência não existe no
   * painel**. Num painel chamado "Completude", a população invisível é exatamente a que importa.
   *
   * Há o par honesto a poucos arquivos: `cobertura-documentos` conta o total global FORA do guard
   * de agência justamente para não perder ninguém. Aqui o guard fica (o recorte por agência é o
   * desenho da tela), mas passa a CONTAR o que descarta.
   */
  const descartadosSemAgencia = { deliberacoes: 0, itens: 0, documentos: 0, diretores: 0, votos: 0 };
  const descartadosForaDoRecorte = { deliberacoes: 0, itens: 0, documentos: 0, diretores: 0, votos: 0 };
  const contarDescarte = (id: string | null, onde: keyof typeof descartadosSemAgencia) => {
    if (id) descartadosForaDoRecorte[onde] += 1;
    else descartadosSemAgencia[onde] += 1;
  };
  const ag = (id: string | null) => (id ? byId.get(id) ?? null : null);

  // Universo de ids de deliberação (para votos órfãos) + subconjunto 2026.
  const allDelibIds = new Set<string>();
  /** Deliberações que o recorte descarta, pelas DUAS razões — que não são a mesma coisa. */
  let semDataDeReuniao = 0;
  let foraDoAno = 0;
  const delibs2026 = new Map<string, Delib>();
  const reunioesComDelib = new Set<string>();
  // Números de deliberação vistos por agência (só tipo "deliberacao" — atas usam
  // item_numero, que poluiria a sequência). Alimenta a detecção de buraco de numeração.
  const numerosPorAgencia = new Map<string, Set<number>>();
  for (const d of (delibsAllRes.data ?? []) as Delib[]) {
    allDelibIds.add(d.id);
    /**
     * ⚠️ Deliberação SEM `data_reuniao` some do painel INTEIRO — e os votos dela também, porque
     * `delibs2026` é a porta de entrada de toda contagem abaixo. Ela não entra em nenhuma coluna,
     * não entra em `votos.total`, e não aparece como ausência em lugar nenhum.
     *
     * É a MESMA população que o materializador conta e nomeia (`fora_da_janela_sem_data_de_reuniao`,
     * e o banner mostra 18). O painel chamado "Completude" era o único instrumento da tela incapaz
     * de dizer quanto ficou fora dele — então ele passa a contar, separando as duas razões, que são
     * diferentes: "de outro ano" é recorte; "sem data" é lacuna de dado.
     */
    const temData = typeof d.data_reuniao === "string" && d.data_reuniao.length >= 10;
    const dentro = temData && d.data_reuniao! >= de && d.data_reuniao! <= ate;
    if (!dentro) {
      if (!temData) semDataDeReuniao += 1;
      else foraDoAno += 1;
      continue;
    }
    delibs2026.set(d.id, d);
    const e = ag(d.agencia_id);
    if (!e) { contarDescarte(d.agencia_id, "deliberacoes"); continue; }
    if (!isFinalDelib(d)) continue;
    e.deliberacoes.finais += 1;
    if (d.agencia_id && d.tipo_documento === "deliberacao") {
      const n = numeroInteiro(d.numero_deliberacao);
      if (n != null) {
        const set = numerosPorAgencia.get(d.agencia_id) ?? new Set<number>();
        set.add(n);
        numerosPorAgencia.set(d.agencia_id, set);
      }
    }
    if (d.data_reuniao && (!e.ultima_captura.reuniao_mais_recente_com_deliberacao
        || d.data_reuniao > e.ultima_captura.reuniao_mais_recente_com_deliberacao)) {
      e.ultima_captura.reuniao_mais_recente_com_deliberacao = d.data_reuniao;
    }
    if (d.interessado && d.interessado.trim() && !d.empresa_id) e.deliberacoes.sem_empresa_id += 1;
    const chave = d.numero_reuniao
      ? `${d.agencia_id}|r|${d.numero_reuniao}`
      : d.data_reuniao ? `${d.agencia_id}|d|${d.data_reuniao}` : null;
    if (chave) reunioesComDelib.add(chave);
  }
  // Reuniões distintas com deliberação, por agência.
  for (const chave of reunioesComDelib) {
    const agenciaId = chave.split("|")[0];
    const e = ag(agenciaId);
    if (e) e.reunioes.com_deliberacao += 1;
  }

  // Buraco de numeração por agência: para cada [min,max] observado, quais inteiros faltam.
  // Range muito largo (> RANGE_MAX) é sinal de outlier (numeração antiga/atípica) e não de
  // "faltou 400 docs" → marca range_suspeito e NÃO explode a lista de faltantes.
  const RANGE_MAX = 400;
  const FALTANTES_CAP = 60;
  for (const [agenciaId, numeros] of numerosPorAgencia) {
    const e = ag(agenciaId);
    if (!e || numeros.size === 0) continue;
    // min/max por iteração (não `Math.min(...set)`) — sem risco de estourar argumentos.
    let min = Infinity;
    let max = -Infinity;
    for (const n of numeros) { if (n < min) min = n; if (n > max) max = n; }
    e.sequencia.min = min;
    e.sequencia.max = max;
    if (max - min > RANGE_MAX) { e.sequencia.range_suspeito = true; continue; }
    const faltantes: number[] = [];
    for (let n = min; n <= max && faltantes.length < FALTANTES_CAP; n++) {
      if (!numeros.has(n)) faltantes.push(n);
    }
    e.sequencia.faltantes = faltantes;
  }

  // Documentos 2026 detectados (monitoramento_itens com data_reuniao no ano).
  for (const it of itens2026Res.data ?? []) {
    const e = ag(it.agencia_id);
    if (!e) { contarDescarte(it.agencia_id, "itens"); continue; }
    e.documentos_2026.detectados += 1;
    const st = String(it.status ?? "?");
    e.documentos_2026.por_status[st] = (e.documentos_2026.por_status[st] ?? 0) + 1;
    const dt = typeof (it as { data_reuniao?: unknown }).data_reuniao === "string" ? (it as { data_reuniao: string }).data_reuniao : null;
    if (dt && (!e.ultima_captura.reuniao_mais_recente_no_monitoramento
        || dt > e.ultima_captura.reuniao_mais_recente_no_monitoramento)) {
      e.ultima_captura.reuniao_mais_recente_no_monitoramento = dt;
    }
    // ⚠️ A captura DE VERDADE. `last_seen_at` é gravado pelo monitoramento e nunca foi lido por
    // esta rota — então "parada há N dias" nunca pôde ser respondido, só parecia respondido.
    const visto = typeof (it as { last_seen_at?: unknown }).last_seen_at === "string"
      ? (it as { last_seen_at: string }).last_seen_at : null;
    if (visto && (!e.ultima_captura.capturado_em || visto > e.ultima_captura.capturado_em)) {
      e.ultima_captura.capturado_em = visto;
    }
  }

  // Funil real: documentos_regulatorios por status (queued/review_pending/confirmed/ignored/failed).
  for (const doc of docsRegRes.data ?? []) {
    const agenciaDoDoc = (doc as { agencia_id: string | null }).agencia_id;
    const e = ag(agenciaDoDoc);
    if (!e) { contarDescarte(agenciaDoDoc, "documentos"); continue; }
    const st = String((doc as { status?: unknown }).status ?? "?");
    e.documentos_processados.por_status[st] = (e.documentos_processados.por_status[st] ?? 0) + 1;
  }

  // Votos: total/nominais/inferidos por agência (só das deliberações de 2026),
  // deliberações com voto, e votos órfãos (deliberacao_id inexistente).
  const delibDaAgenciaComVoto = new Map<string, Set<string>>(); // agencia_id → set diretor_id
  const delibsComVoto = new Set<string>();
  const delibsComNominal = new Set<string>();
  // Órfão só existe contra o universo INTEIRO: se qualquer das duas leituras truncou, o número
  // seria mentira (era exatamente o 537). Com leitura completa, a FK em CASCADE torna o órfão
  // impossível — se aparecer, é o banco sem a FK, e aí o número é a prova.
  /**
   * ⚠️ `leitura_completa` passa a considerar ERRO, não só truncagem — e das OITO leituras, não de
   * duas. `selectAllPaged` devolve `truncated: false` no caminho de erro, então a versão anterior
   * dizia "completa" sobre uma leitura que falhou inteira.
   */
  const leituraCompleta = leiturasComErro.length === 0 && leiturasTruncadas.length === 0;
  let votosOrfaos = 0;
  for (const v of votosRes.data ?? []) {
    if (!allDelibIds.has(v.deliberacao_id)) { votosOrfaos += 1; continue; }
    const d = delibs2026.get(v.deliberacao_id);
    if (!d) continue; // voto de deliberação fora de 2026
    const e = ag(d.agencia_id);
    if (!e) { contarDescarte(d.agencia_id, "votos"); continue; }
    e.votos.total += 1;
    if (isVotoNominal(v)) e.votos.nominais += 1; else e.votos.inferidos += 1;
    delibsComVoto.add(v.deliberacao_id);
    if (isVotoNominal(v)) delibsComNominal.add(v.deliberacao_id);
    if (d.agencia_id && v.diretor_id) {
      const set = delibDaAgenciaComVoto.get(d.agencia_id) ?? new Set<string>();
      set.add(v.diretor_id);
      delibDaAgenciaComVoto.set(d.agencia_id, set);
    }
  }
  // Deliberações finais 2026 sem voto / só-inferidas.
  for (const [id, d] of delibs2026) {
    const e = ag(d.agencia_id);
    // ⚠️ AQUI o descarte NÃO é contado, e é de propósito: este laço reitera `delibs2026`, cujo
    // descarte por agência já foi contado no laço que a montou. Contar de novo dobraria o número —
    // e um contador que dobra é pior que contador nenhum, porque parece medição.
    if (!e) continue;
    if (!isFinalDelib(d)) continue;
    if (!delibsComVoto.has(id)) e.deliberacoes.sem_voto += 1;
    else if (!delibsComNominal.has(id)) e.deliberacoes.so_inferidas += 1;
  }

  // Diretores: aprovados, com ≥1 voto, sem mandato.
  const comMandato = new Set((mandatosRes.data ?? []).map((m: { diretor_id: string }) => m.diretor_id));
  for (const d of (diretoresRes.data ?? []) as Array<{ id: string; agencia_id: string | null }>) {
    const e = ag(d.agencia_id);
    if (!e) { contarDescarte(d.agencia_id, "diretores"); continue; }
    e.diretores.aprovados += 1;
    if (!comMandato.has(d.id)) e.diretores.sem_mandato += 1;
    if (d.agencia_id && delibDaAgenciaComVoto.get(d.agencia_id)?.has(d.id)) e.diretores.com_voto += 1;
  }
  for (const c of candidatosRes.data ?? []) {
    const e = ag((c as { agencia_id: string | null }).agencia_id);
    if (!e) { contarDescarte((c as { agencia_id: string | null }).agencia_id, "diretores"); continue; }
    e.diretores.candidatos_pendentes += 1;
    if (String((c as { review_status?: unknown }).review_status) === "conflito") {
      e.diretores.candidatos_em_conflito += 1;
    }
  }

  const por_agencia = [...byId.values()].sort((a, b) => b.deliberacoes.finais - a.deliberacoes.finais);
  const soma = (f: (a: AgenciaCompletude) => number) => por_agencia.reduce((s, a) => s + f(a), 0);
  const totais = {
    documentos_2026_detectados: soma((a) => a.documentos_2026.detectados),
    deliberacoes_finais: soma((a) => a.deliberacoes.finais),
    deliberacoes_sem_voto: soma((a) => a.deliberacoes.sem_voto),
    deliberacoes_sem_empresa_id: soma((a) => a.deliberacoes.sem_empresa_id),
    votos_total: soma((a) => a.votos.total),
    votos_nominais: soma((a) => a.votos.nominais),
    votos_inferidos: soma((a) => a.votos.inferidos),
    votos_orfaos: leituraCompleta ? votosOrfaos : null,
    /** Fase 25 — `false` = alguma leitura bateu no teto; os totais podem subcontar e o órfão não é medido. */
    leitura_completa: leituraCompleta,
    diretores_aprovados: soma((a) => a.diretores.aprovados),
    diretores_com_voto: soma((a) => a.diretores.com_voto),
    diretores_sem_mandato: soma((a) => a.diretores.sem_mandato),
    candidatos_pendentes: soma((a) => a.diretores.candidatos_pendentes),
    candidatos_em_conflito: soma((a) => a.diretores.candidatos_em_conflito),
    deliberacoes_faltantes_sequencia: soma((a) => a.sequencia.faltantes.length),
    /**
     * ⚠️ O RECORTE, declarado na própria resposta — porque ele explica o 40 ≠ 45.
     *
     * "40 deliberações finais sem nenhum voto" (aqui) e "45 ainda sem voto" (banner do
     * materializador) parecem a mesma frase e são populações diferentes, por TRÊS eixos:
     *
     *   eixo         | Completude         | materializador
     *   ano          | só o ano do param  | TODOS (a esteira chama sem `year`)
     *   `resultado`  | exigido só de `ata`| exigido de TODOS os tipos, em SQL
     *   `ativo`      | filtra agência     | não filtra
     *
     * ⚠️ O eixo do meio é o insidioso: uma deliberação de 2026 com `resultado IS NULL` e tipo
     * `deliberacao` CONTA nas 40 e é INVISÍVEL ao backfill (cortada pelo `.not("resultado","is",
     * null)`). São deliberações que este painel acusa e que o backfill JAMAIS tentará resolver — e
     * o painel não dizia isso.
     */
    recorte: {
      ano: Number(year),
      resultado_exigido_de: "apenas tipo 'ata' (filho com resultado); os outros tipos entram sem exigir resultado",
      agencias: "só colegiadas e ativas",
      por_que_difere_do_backfill:
        "O backfill roda sem filtro de ano, exige `resultado` de TODOS os tipos e não filtra `ativo` — " +
        "por isso os dois números divergem sem que nenhum esteja errado.",
    },
    /** O que o recorte por agência descartou — antes era invisível (nem contador, nem alerta). */
    descartados: {
      sem_agencia: descartadosSemAgencia,
      fora_do_recorte_de_agencia: descartadosForaDoRecorte,
    },
    /** O que o recorte de DATA descartou, pelas duas razões distintas. */
    deliberacoes_sem_data_de_reuniao: semDataDeReuniao,
    deliberacoes_de_outro_ano: foraDoAno,
    /** Quais leituras falharam ou truncaram — `leitura_completa` sozinha não diz ONDE. */
    leituras_com_erro: leiturasComErro,
    leituras_truncadas: leiturasTruncadas,
  };

  const alertas: string[] = [];
  if (totais.candidatos_pendentes > 0) {
    // ⚠️ O rótulo diz que é candidato a DIRETOR, e o conflito aparece separado: "pendente" e "em
    // disputa" pedem ações diferentes do operador.
    const emConflito = totais.candidatos_em_conflito > 0
      ? ` (${totais.candidatos_em_conflito} em CONFLITO — cadastro em disputa também bloqueia voto)` : "";
    alertas.push(`${totais.candidatos_pendentes} candidato(s) a DIRETOR pendente(s)${emConflito} — votos presos até aprovar (rode /admin/diretores/candidatos/recompute).`);
  }
  if (totais.diretores_sem_mandato > 0) alertas.push(`${totais.diretores_sem_mandato} diretor(es) sem mandato — inferência de voto desligada para eles.`);
  if (totais.deliberacoes_sem_empresa_id > 0) alertas.push(`${totais.deliberacoes_sem_empresa_id} deliberação(ões) com interessado mas SEM empresa_id (não entram nas visões por empresa).`);
  if (totais.deliberacoes_sem_voto > 0) alertas.push(`${totais.deliberacoes_sem_voto} deliberação(ões) final(is) sem nenhum voto.`);
  if (votosOrfaos > 0 && leituraCompleta) alertas.push(`${votosOrfaos} voto(s) órfão(s) (deliberação inexistente) — com FK em CASCADE isto não deveria existir; conferir a constraint em produção.`);
  /**
   * ⚠️ O que INVALIDA os números vai para o TOPO, com `unshift`.
   *
   * O aviso de leitura incompleta entrava no FIM da lista — depois dos números que ele invalida.
   * `cobertura-documentos` usa `unshift` exatamente por isso, e o Commit G já resolveu esta classe
   * ali. Um aviso que aparece embaixo é um aviso que se lê depois de já ter acreditado na tabela.
   */
  if (leiturasComErro.length > 0) {
    alertas.unshift(
      `⚠️ ${leiturasComErro.length} leitura(s) FALHARAM (${leiturasComErro.join(", ")}): ` +
      "os números abaixo estão INCOMPLETOS. Uma leitura que falha vira lista vazia, e lista vazia " +
      "vira zero — inclusive «Pendentes: 0» em verde. Não tome decisão por esta tela agora.",
    );
  }
  if (leiturasTruncadas.length > 0) {
    alertas.unshift(
      `⚠️ ${leiturasTruncadas.length} leitura(s) TRUNCADA(s) (${leiturasTruncadas.join(", ")}): ` +
      "os totais podem subcontar e os votos órfãos não são medidos.",
    );
  }
  // ⚠️ O sumidouro, com número. Antes era ausência: o que não tem agência não existia no painel.
  const somaDescarte = (o: Record<string, number>) => Object.values(o).reduce((x, y) => x + y, 0);
  const nSemAgencia = somaDescarte(descartadosSemAgencia);
  if (nSemAgencia > 0) {
    const detalhe = Object.entries(descartadosSemAgencia).filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`).join(", ");
    alertas.unshift(
      `⚠️ ${nSemAgencia} registro(s) SEM AGÊNCIA não entram em nenhuma linha desta tabela (${detalhe}) — ` +
      "e o cabeçalho é a soma das linhas, então eles não aparecem em total nenhum.",
    );
  }
  if (semDataDeReuniao > 0) {
    alertas.unshift(
      `⚠️ ${semDataDeReuniao} deliberação(ões) SEM data de reunião ficam fora deste painel inteiro — ` +
      "e os votos delas também, porque o recorte de data é a porta de entrada de toda contagem aqui. " +
      "É a mesma população que o banner da esteira chama de «fora da janela, sem data de reunião».",
    );
  }
  for (const a of por_agencia) {
    // Link descoberto que nunca virou documento processado (status "novo" no
    // monitoramento): era o buraco invisível do "17 ANM → 0 deliberações".
    const nuncaProcessados = a.documentos_2026.por_status["novo"] ?? 0;
    if (nuncaProcessados > 0) {
      alertas.push(`${a.sigla}: ${nuncaProcessados} documento(s) descoberto(s) e nunca enfileirado(s)/baixado(s) — rode "Buscar todas" ou verifique o tipo/URL no monitoramento.`);
    }
    const emRevisao = a.documentos_processados.por_status["review_pending"] ?? 0;
    if (emRevisao > 0) {
      alertas.push(`${a.sigla}: ${emRevisao} documento(s) em revisão (Exceções) — o próximo "Rodar tudo" tenta drenar.`);
    }
    if (a.sequencia.faltantes.length > 0) {
      const amostra = a.sequencia.faltantes.slice(0, 15).join(", ");
      const resto = a.sequencia.faltantes.length > 15 ? "…" : "";
      alertas.push(`${a.sigla}: ${a.sequencia.faltantes.length} nº de deliberação faltando na sequência ${a.sequencia.min}–${a.sequencia.max} (${amostra}${resto}) — possíveis documentos não capturados.`);
    }
  }

  return NextResponse.json({ modo: "real", ano: Number(year), gerado_em: new Date().toISOString(), por_agencia, totais, alertas });
}
