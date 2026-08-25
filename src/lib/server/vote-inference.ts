import type { TipoDocumento, VotoSugerido } from "@/types";
import { findBestMatch } from "@/lib/server/name-matcher";
import { isTipoNaoFinal } from "@/lib/server/regulatory-documents";

export type DiretorVoteRecord = {
  id: string;
  nome: string;
  nome_variantes: string[];
};

export type TipoVoto = "Favoravel" | "Desfavoravel" | "Abstencao" | "Ausente";

/**
 * De ONDE veio o voto (etapa58/59). `is_nominal` continua existindo, mas um booleano não distingue
 * inferido-por-unanimidade de inferido-por-decisão, nem — o pior caso — a CORREÇÃO HUMANA do
 * revisor, que era gravada como "inferida" e sumia. Métricas de comportamento usam
 * `nominal`/`revisao_humana`; matriz e consenso agregado seguem usando tudo.
 */
export type ProvenienciaVoto =
  | "revisao_humana"
  | "nominal"
  | "inferido_unanimidade"
  | "inferido_decisao";

export type VotoInsertRow = {
  deliberacao_id: string;
  diretor_id: string;
  tipo_voto: TipoVoto;
  is_divergente: boolean;
  is_nominal: boolean;
  /**
   * Colunas OPCIONAIS — só existem depois da migration `20260824120000`. O write-path
   * (`votos-write.ts`) as remove do payload enquanto o banco não as tiver, então gravá-las aqui é
   * seguro antes da migration.
   */
  proveniencia?: ProvenienciaVoto;
  /** Por que não votou. Separa ausência FÍSICA de impedimento — denominadores diferentes. */
  motivo_nao_voto?: "ausencia" | "impedimento" | "suspeicao" | "vista" | "sobrestamento" | "vacancia";
  /** Voto proferido em sessão ANTERIOR e só registrado nesta ata (etapa57). */
  voto_em_autos?: boolean;
  /**
   * Score do match nome→diretor quando a resolução foi AUTOMÁTICA SEM margem (etapa67 — o
   * fallback do auto-resolver). Fica na linha para auditoria: é o que permite revisar depois
   * exatamente os votos atribuídos com menor certeza. Coluna da migration 20260824120000;
   * `votos-write.ts` a remove do payload enquanto o banco não a tiver.
   */
  confianca_match?: number;
};

export function isFinalVoteDocument(input: {
  tipo_documento: TipoDocumento | string | null;
  import_counts_as_final?: boolean | null;
}) {
  if (input.import_counts_as_final === false) return false;
  return !isTipoNaoFinal(input.tipo_documento);
}

/**
 * Decide se devemos COMPLETAR os votos por mandato (diretores ativos sem voto
 * nominal recebem o voto da decisão). Conservador e baseado em evidência:
 *  - precisa de data_reuniao (sem ela não há como saber quem estava na diretoria);
 *  - infere apenas quando há divergência NOMEADA (completa o restante como a decisão)
 *    OU unanimidade TEXTUAL sem nomes extraídos.
 *  - quórum por assinatura NÃO é evidência de "todos a favor" → não infere.
 */
export function shouldInferVotesFromMandate(input: {
  resultado: string | null;
  tipo_documento: TipoDocumento | string | null;
  import_counts_as_final?: boolean | null;
  unanimidadeDetectada?: boolean | null;
  nomes?: string[];
  nomesContra?: string[];
  nomesAbstencao?: string[];
  /** Data da reunião (ISO). Sem ela não inferimos — não dá para saber a composição. */
  dataReuniao?: string | null;
  /**
   * Cadastro de diretores da agência. Quando presente, "nomes extraídos" só bloqueia a
   * inferência se algum nome CASA com alta confiança (vira voto nominal de fato). Nomes
   * que não casam (ex.: signatários do rodapé ARTESP) não produzem voto nominal — sem
   * isso, eles desligavam a inferência E não geravam voto: deliberação unânime ficava
   * com 0 votos (QA ago/2026: 35 finais ARTESP sem voto).
   */
  diretoresList?: DiretorVoteRecord[];
  /** @deprecated quórum por assinatura não é mais usado como gatilho de inferência. */
  signatariosCount?: number;
}) {
  if (!isFinalVoteDocument(input)) return false;
  if (!input.resultado || input.resultado === "Retirado de Pauta") return false;
  if (!input.dataReuniao) return false;
  const isUnanimous = Boolean(input.unanimidadeDetectada) || input.resultado === "Aprovado por Unanimidade";
  // Divergência/abstenção nomeada: a decisão prevaleceu → completa o restante por mandato.
  const hasDivergence = Boolean(input.nomesContra?.length) || Boolean(input.nomesAbstencao?.length);
  const hasNominalNames = input.diretoresList
    ? matchIds(input.nomes ?? [], input.diretoresList).size > 0
    : Boolean(input.nomes?.length);
  return hasDivergence || (isUnanimous && !hasNominalNames);
}

/**
 * Diretores que estavam na diretoria NA DATA da reunião (base para inferência).
 * Conservador: sem data ou sem mandato cadastrado na data → retorna [] (não infere),
 * evitando atribuir voto a quem não estava no colegiado (diretores fantasma).
 */
export async function getActiveDiretoresForVote(
  db: any,
  agenciaId: string,
  dataReuniao: string | null,
  _fallback: DiretorVoteRecord[],
): Promise<DiretorVoteRecord[]> {
  if (!dataReuniao) return [];

  const { data, error } = await db
    .from("mandatos")
    .select("diretor_id, data_inicio, data_fim, diretores!inner(id, nome, nome_variantes, agencia_id, review_status)")
    .eq("diretores.agencia_id", agenciaId)
    // Antirrecontaminação (ago/2026): mandato FABRICADO ('automatico', derivado de voto/1ª
    // aparição) nunca vira base para inferir MAIS voto — só mandato verificado/manual conta.
    // E diretor rejeitado não entra no roster mesmo que um mandato antigo tenha sobrado.
    .neq("fonte_dado", "automatico")
    .eq("diretores.review_status", "aprovado")
    .lte("data_inicio", dataReuniao)
    .or(`data_fim.is.null,data_fim.gte.${dataReuniao}`);

  if (error || !data?.length) return [];

  const unique = new Map<string, DiretorVoteRecord>();
  for (const row of data as any[]) {
    const diretor = row.diretores;
    if (!diretor?.id) continue;
    unique.set(diretor.id, {
      id: diretor.id,
      nome: diretor.nome,
      nome_variantes: Array.isArray(diretor.nome_variantes) ? diretor.nome_variantes : [],
    });
  }

  return [...unique.values()];
}

export function buildVotoRows(input: {
  deliberacao_id: string;
  nomes: string[];
  nomesContra: string[];
  nomesAusente?: string[];
  nomesAbstencao?: string[];
  /**
   * Impedidos/suspeitos (etapa50): estiveram na sessão mas NÃO votaram. Precedência máxima —
   * e, o mais importante, entram em `collectDivergentIntentIds` para que a inferência por
   * mandato jamais lhes fabrique um "Favoravel".
   */
  nomesImpedido?: string[];
  /**
   * Voto proferido em sessão ANTERIOR e só registrado neste documento (etapa57). Continua ligado
   * à deliberação — é ele que forma a maioria — mas não é presença nesta sessão.
   */
  nomesEmAutos?: string[];
  diretoresList: DiretorVoteRecord[];
  activeDiretoresList: DiretorVoteRecord[];
  inferFromMandate: boolean;
  /** Resultado da deliberação — define a direção da divergência. */
  resultado?: string | null;
  /** Texto indica votação unânime. Suprime divergência (ver `isDivergentVote`). */
  unanime?: boolean;
}): VotoInsertRow[] {
  const resultado = input.resultado ?? null;
  const contraIds = matchIds(input.nomesContra, input.diretoresList);
  const ausenteIds = matchIds(input.nomesAusente ?? [], input.diretoresList);
  const abstencaoIds = matchIds(input.nomesAbstencao ?? [], input.diretoresList);
  const impedidoIds = matchIds(input.nomesImpedido ?? [], input.diretoresList);
  const emAutosIds = matchIds(input.nomesEmAutos ?? [], input.diretoresList);
  // Só suprime divergência quando é unânime E não há dissidência EXTRAÍDA (contra/
  // abstenção). Se o texto diz "unanimidade" mas há contrários nomeados (inconsistência
  // já sinalizada no upload-analysis), mantém a lógica de polaridade por segurança.
  const unanime = Boolean(input.unanime) && contraIds.size === 0 && abstencaoIds.size === 0;
  const rows = new Map<string, VotoInsertRow>();

  for (const nome of input.nomes) {
    const match = findBestMatch(nome, input.diretoresList);
    // Só atribui voto nominal com alta confiança. Matches "needsReview"
    // (0.6–0.85) ficam de fora para não atribuir voto ao diretor errado —
    // o revisor humano resolve esses casos manualmente.
    if (!match.diretorId || match.needsReview) continue;
    // Precedência: Impedido > Ausente > Abstencao > Desfavoravel > Favoravel.
    // Impedimento vem primeiro porque é o único estado declarado pelo próprio colegiado como
    // AUSÊNCIA DE VOTO: o nome pode aparecer em qualquer outro balde por ruído de prosa, mas a
    // ata dizendo "não votou" prevalece sobre toda inferência de direção.
    if (impedidoIds.has(match.diretorId)) {
      rows.set(match.diretorId, rowFor(input.deliberacao_id, match.diretorId, "Ausente", true, resultado, unanime, undefined, { motivo_nao_voto: "impedimento" }));
    } else if (ausenteIds.has(match.diretorId)) {
      rows.set(match.diretorId, rowFor(input.deliberacao_id, match.diretorId, "Ausente", true, resultado, unanime));
    } else if (abstencaoIds.has(match.diretorId)) {
      rows.set(match.diretorId, rowFor(input.deliberacao_id, match.diretorId, "Abstencao", true, resultado, unanime));
    } else if (contraIds.has(match.diretorId)) {
      rows.set(match.diretorId, rowFor(input.deliberacao_id, match.diretorId, "Desfavoravel", true, resultado, unanime));
    } else {
      rows.set(match.diretorId, rowFor(input.deliberacao_id, match.diretorId, "Favoravel", true, resultado, unanime));
    }
  }

  for (const diretorId of contraIds) {
    if (impedidoIds.has(diretorId) || ausenteIds.has(diretorId) || abstencaoIds.has(diretorId)) continue;
    rows.set(diretorId, rowFor(input.deliberacao_id, diretorId, "Desfavoravel", true, resultado, unanime));
  }

  for (const diretorId of abstencaoIds) {
    if (impedidoIds.has(diretorId) || ausenteIds.has(diretorId)) continue;
    rows.set(diretorId, rowFor(input.deliberacao_id, diretorId, "Abstencao", true, resultado, unanime));
  }

  for (const diretorId of ausenteIds) {
    if (impedidoIds.has(diretorId)) continue; // o impedimento já classificou, com motivo próprio
    rows.set(diretorId, rowFor(input.deliberacao_id, diretorId, "Ausente", true, resultado, unanime, undefined, { motivo_nao_voto: "ausencia" }));
  }

  // Impedido é gravado como "Ausente" NOMINAL: o CHECK de `votos.tipo_voto` não comporta um valor
  // novo, e a distinção (impedimento × ausência física) vive em `raw_extraction.impedimentos` até a
  // coluna `motivo_nao_voto` existir (etapa59). O que importa aqui é não ser "Favoravel".
  for (const diretorId of impedidoIds) {
    // `motivo_nao_voto` é o que separa, no banco, o impedido do ausente FÍSICO: os dois são
    // tipo_voto "Ausente", mas só o impedido sai do denominador DELE na etapa61.
    rows.set(diretorId, rowFor(input.deliberacao_id, diretorId, "Ausente", true, resultado, unanime, undefined, { motivo_nao_voto: "impedimento" }));
  }

  if (input.inferFromMandate) {
    // Não fabricar "Favoravel" para diretores que o documento indica como
    // divergentes/ausentes, MESMO que o match tenha ficado na faixa de revisão
    // (0.6–0.85) e por isso não tenha virado voto nominal acima. Evita o pior
    // caso: perder um "Desfavoravel" real e ainda inventar um "Favoravel".
    // `nomesImpedido` entra AQUI, e é isso que fecha a fabricação: sem esta linha, um impedido
    // cujo nome casou apenas na faixa de revisão (0.6–0.85) escaparia do `rows` acima e o laço
    // de mandato logo abaixo lhe daria "Favoravel" — voto que a ata diz explicitamente não existir.
    const divergentIntent = collectDivergentIntentIds(
      [
        ...input.nomesContra,
        ...(input.nomesAbstencao ?? []),
        ...(input.nomesAusente ?? []),
        ...(input.nomesImpedido ?? []),
      ],
      input.diretoresList,
    );
    for (const diretor of input.activeDiretoresList) {
      if (rows.has(diretor.id)) continue;
      if (divergentIntent.has(diretor.id)) continue;
      rows.set(diretor.id, rowFor(input.deliberacao_id, diretor.id, "Favoravel", false, resultado, unanime));
    }
  }

  // VOTO EM AUTOS (etapa57) marca a linha seja qual for o ramo que a criou: o voto continua
  // ligado à deliberação — é ele que forma a maioria — mas a etapa61 precisa saber que ele NÃO é
  // presença nesta sessão, senão o diretor aparece numa reunião em que não esteve.
  if (emAutosIds.size > 0) {
    for (const [diretorId, row] of rows) {
      if (emAutosIds.has(diretorId)) rows.set(diretorId, { ...row, voto_em_autos: true });
    }
  }

  return [...rows.values()];
}

export function buildVotoRowsFromSuggestions(input: {
  deliberacao_id: string;
  votosSugeridos: VotoSugerido[];
  resultado?: string | null;
  unanime?: boolean;
}): VotoInsertRow[] {
  const resultado = input.resultado ?? null;
  // Espelha buildVotoRows: só suprime divergência se unânime E sem dissidência sugerida.
  const hasDissent = input.votosSugeridos.some(
    (v) => v.tipo_voto === "Desfavoravel" || v.tipo_voto === "Abstencao",
  );
  const unanime = Boolean(input.unanime) && !hasDissent;
  const rows = new Map<string, VotoInsertRow>();
  for (const voto of input.votosSugeridos) {
    if (!voto.diretor_id) continue;
    // CORREÇÃO HUMANA (etapa58): quando o revisor troca o voto na tela, isso é o dado de MAIOR
    // qualidade que existe — uma pessoa leu o documento. Era gravado como "inferido", indistinguível
    // de um chute do algoritmo, e o trabalho do revisor desaparecia na primeira métrica.
    const humano = voto.origem === "revisao_humana";
    rows.set(voto.diretor_id, rowFor(
      input.deliberacao_id,
      voto.diretor_id,
      voto.tipo_voto,
      humano ? true : voto.is_nominal,
      resultado,
      unanime,
      humano ? "revisao_humana" : undefined,
    ));
  }
  return [...rows.values()];
}

export function buildVoteSuggestions(input: {
  nomes: string[];
  nomesContra: string[];
  nomesAusente?: string[];
  nomesAbstencao?: string[];
  nomesImpedido?: string[];
  nomesEmAutos?: string[];
  diretoresList: DiretorVoteRecord[];
  activeDiretoresList: DiretorVoteRecord[];
  inferFromMandate: boolean;
  resultado?: string | null;
  unanime?: boolean;
}): VotoSugerido[] {
  const rows = buildVotoRows({
    deliberacao_id: "preview",
    ...input,
  });

  // A linha gravada é "Ausente" para os dois casos; só a ORIGEM distingue impedimento de
  // ausência física — é ela que o revisor lê na tela e que a etapa59 promoverá a coluna.
  const impedidoIds = matchIds(input.nomesImpedido ?? [], input.diretoresList);
  const emAutosIds = matchIds(input.nomesEmAutos ?? [], input.diretoresList);

  return rows.map((row) => {
    const diretor = input.diretoresList.find((dir) => dir.id === row.diretor_id)
      ?? input.activeDiretoresList.find((dir) => dir.id === row.diretor_id);
    return {
      nome: diretor?.nome ?? row.diretor_id,
      diretor_id: row.diretor_id,
      tipo_voto: row.tipo_voto,
      origem: row.tipo_voto === "Ausente"
        ? (impedidoIds.has(row.diretor_id) ? "impedido" : "ausente")
        : row.tipo_voto === "Abstencao"
          ? "abstencao"
          : row.tipo_voto === "Desfavoravel"
            ? "contrario"
            : row.is_nominal
              ? "nominal"
              : "inferido_mandato",
      is_nominal: row.is_nominal,
    };
  });
}

function matchIds(names: string[], diretoresList: DiretorVoteRecord[]) {
  const ids = new Set<string>();
  for (const nome of names) {
    const match = findBestMatch(nome, diretoresList);
    // Apenas matches de alta confiança contam como voto contra/ausente/abstenção.
    if (match.diretorId && !match.needsReview) ids.add(match.diretorId);
  }
  return ids;
}

/**
 * IDs de diretores com INTENÇÃO divergente no documento, incluindo matches de
 * confiança média (faixa 0.6–0.85). Usado só para BLOQUEAR a inferência de
 * "Favoravel" sobre eles — nunca para gravar voto (isso exige revisão humana).
 */
function collectDivergentIntentIds(names: string[], diretoresList: DiretorVoteRecord[]) {
  const ids = new Set<string>();
  for (const nome of names) {
    const match = findBestMatch(nome, diretoresList);
    if (match.diretorId && match.score >= 0.6) ids.add(match.diretorId);
  }
  return ids;
}

/** Resultado "positivo" (decisão prevaleceu), negativo (Indeferido) ou neutro/desconhecido. */
function isPositiveResult(resultado: string | null): boolean | null {
  if (!resultado || resultado === "Retirado de Pauta") return null;
  if (resultado === "Indeferido") return false;
  return true;
}

/**
 * Divergência relativa ao RESULTADO da maioria:
 *  - `unanime` (votação unânime, sem dissidência extraída) → NINGUÉM é divergente,
 *    independentemente do `resultado`. Fecha a colisão semântica em que, para a ARTESP,
 *    `resultado="Indeferido"` é o desfecho do PLEITO da concessionária (indeferido por
 *    unanimidade), NÃO uma divisão do colegiado — sem isso, os 4 diretores que aprovaram
 *    o indeferimento por unanimidade eram marcados como "Favoravel divergente" (falso).
 *  - Abstenção sempre conta como não-consenso (divergente).
 *  - Resultado positivo → divergente quem votou Desfavorável.
 *  - Resultado negativo (Indeferido) → divergente quem votou Favorável (relator vencido,
 *    caso NÃO-unânime: ANTT/ANM).
 *  - Sem resultado conhecido → cai no comportamento anterior (Desfavorável).
 */
/**
 * Deriva o flag de unanimidade EFETIVO de uma deliberação (etapa65) — fonte única.
 *
 * A regra existia só dentro de `votos/recalcular-divergencia`, e o PATCH manual de
 * `deliberacoes/[id]` chamava `isDivergentVote` com DOIS argumentos, omitindo o terceiro. Resultado
 * medido: o mesmo recálculo dava respostas diferentes conforme a porta — uma edição manual de
 * resultado reintroduzia divergência falsa num item indeferido-por-unanimidade, e ela ficava lá até
 * alguém rodar o cron.
 *
 * `unanimidade_detectada` chega como texto ("true") quando vem de `->>` do PostgREST, e como
 * boolean quando vem do JSON — os dois são aceitos.
 */
export function deriveUnanime(
  unanimidadeDetectada: unknown,
  votos: Array<{ tipo_voto: string }>,
): boolean {
  const flag = unanimidadeDetectada === true || unanimidadeDetectada === "true";
  if (!flag) return false;
  // Dissidência GRAVADA vence a declaração de unanimidade do texto: se há voto contrário ou
  // abstenção registrado, o item não foi unânime, o que a ata diga.
  return !votos.some((v) => v.tipo_voto === "Desfavoravel" || v.tipo_voto === "Abstencao");
}

/**
 * Reparte os votos de uma deliberação em (divergentes, não divergentes). Usado pelos DOIS
 * write-paths que re-derivam `is_divergente`, para que não voltem a divergir.
 */
export function repartirPorDivergencia<T extends { id: string; tipo_voto: string }>(
  votos: T[],
  resultado: string | null,
  unanimidadeDetectada: unknown,
): { idsDivergentes: string[]; idsNaoDivergentes: string[] } {
  const unanime = deriveUnanime(unanimidadeDetectada, votos);
  const idsDivergentes: string[] = [];
  const idsNaoDivergentes: string[] = [];
  for (const v of votos) {
    (isDivergentVote(v.tipo_voto as TipoVoto, resultado, unanime) ? idsDivergentes : idsNaoDivergentes)
      .push(v.id);
  }
  return { idsDivergentes, idsNaoDivergentes };
}

export function isDivergentVote(tipoVoto: TipoVoto, resultado: string | null, unanime = false): boolean {
  if (unanime) return false;
  if (tipoVoto === "Ausente") return false;
  if (tipoVoto === "Abstencao") return true;
  const positive = isPositiveResult(resultado);
  if (positive === null) return tipoVoto === "Desfavoravel";
  return positive ? tipoVoto === "Desfavoravel" : tipoVoto === "Favoravel";
}

function rowFor(
  deliberacaoId: string,
  diretorId: string,
  tipoVoto: TipoVoto,
  isNominal: boolean,
  resultado: string | null = null,
  unanime = false,
  proveniencia?: ProvenienciaVoto,
  extra?: Pick<VotoInsertRow, "motivo_nao_voto" | "voto_em_autos">,
): VotoInsertRow {
  return {
    deliberacao_id: deliberacaoId,
    diretor_id: diretorId,
    tipo_voto: tipoVoto,
    is_divergente: isDivergentVote(tipoVoto, resultado, unanime),
    is_nominal: isNominal,
    ...(extra?.motivo_nao_voto ? { motivo_nao_voto: extra.motivo_nao_voto } : {}),
    ...(extra?.voto_em_autos ? { voto_em_autos: true } : {}),
    // Voto LIDO do documento é "nominal". Voto INFERIDO se distingue pela evidência que o
    // sustenta: texto de unanimidade × direção da decisão. Sem essa distinção, "convergência
    // ≈ 100%" é tautologia — voto inferido é, por construção, não-divergente.
    proveniencia: proveniencia ?? (isNominal ? "nominal" : unanime ? "inferido_unanimidade" : "inferido_decisao"),
  };
}
