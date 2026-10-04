/**
 * A VARREDURA de uma medição que a rota faz em pedaços — somada sem contar nada duas vezes.
 *
 * ═══ Por que isto existe ═══
 * As escritas da Fase 36 nasceram MEDIDAS E DESLIGADAS (colegiado parcial, revoto) ou com dry-run
 * por padrão (ausências da ARTESP). O número delas só existia atrás de um `POST` com corpo JSON —
 * e este projeto já registrou que "um reparo que só existe atrás de um curl é capacidade sem
 * consumidor". A tela passa a medir.
 *
 * ⚠️ Mas as rotas medem UM PEDAÇO por chamada: o materializador um bloco de 60 da janela rotativa,
 * as ausências 120 candidatas a partir de um offset. Mostrar o número de uma chamada como se fosse o
 * estoque seria o erro de "parcial lido como total" que a Fase 20 nomeou. Aqui cada pedaço é
 * somado UMA vez (bloco/offset explícito), e o resultado diz quantos pedaços foram medidos de
 * quantos existem — "parcial: 12 de 40 blocos" é diferente de "total".
 */

export type PorAgencia = Record<string, number>;

/** Soma dois mapas por agência (puro). */
export function somarPorAgencia(a: PorAgencia, b: PorAgencia | null | undefined): PorAgencia {
  const out: PorAgencia = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

export function textoPorAgencia(m: PorAgencia): string {
  const e = Object.entries(m).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
  return e.length ? e.map(([k, v]) => `${k} ${v}`).join(" · ") : "nenhum";
}

// ─── Colegiado parcial (Bloco A) ─────────────────────────────────────────────

export interface RespostaParcial {
  janela_bloco?: number;
  janela_blocos?: number;
  completar_parcial_ligado?: boolean;
  parcial_pares_autorizados?: number;
  parcial_pares_barrados?: number;
  parcial_barrados_por_motivo?: PorAgencia;
  parcial_por_agencia?: PorAgencia;
}

export interface AcumuladoParcial {
  blocos_medidos: number;
  blocos_total: number;
  ligado: boolean;
  autorizados: number;
  barrados: number;
  barrados_por_motivo: PorAgencia;
  por_agencia: PorAgencia;
  /** Blocos já somados — o mesmo bloco duas vezes NÃO soma de novo. */
  vistos: number[];
}

export const PARCIAL_VAZIO: AcumuladoParcial = {
  blocos_medidos: 0, blocos_total: 0, ligado: false, autorizados: 0, barrados: 0,
  barrados_por_motivo: {}, por_agencia: {}, vistos: [],
};

export function acumularParcial(acc: AcumuladoParcial, r: RespostaParcial): AcumuladoParcial {
  const bloco = Number(r.janela_bloco ?? -1);
  const total = Number(r.janela_blocos ?? 0);
  // ⚠️ Bloco repetido não soma: é a dupla contagem que a varredura existe para impedir.
  if (bloco < 0 || acc.vistos.includes(bloco)) return { ...acc, blocos_total: Math.max(acc.blocos_total, total) };
  return {
    blocos_medidos: acc.blocos_medidos + 1,
    blocos_total: Math.max(acc.blocos_total, total),
    ligado: Boolean(r.completar_parcial_ligado),
    autorizados: acc.autorizados + Number(r.parcial_pares_autorizados ?? 0),
    barrados: acc.barrados + Number(r.parcial_pares_barrados ?? 0),
    barrados_por_motivo: somarPorAgencia(acc.barrados_por_motivo, r.parcial_barrados_por_motivo),
    por_agencia: somarPorAgencia(acc.por_agencia, r.parcial_por_agencia),
    vistos: [...acc.vistos, bloco],
  };
}

// ─── Revoto (B.4) ────────────────────────────────────────────────────────────

export interface RespostaRevoto {
  janela_bloco?: number;
  janela_blocos?: number;
  revoto_ligado?: boolean;
  revoto_apagariam?: number;
  revoto_roster_suspeito?: number;
  revoto_faltando?: number;
  revoto_recusas_por_motivo?: PorAgencia;
  revoto_por_agencia?: PorAgencia;
}

export interface AcumuladoRevoto {
  blocos_medidos: number;
  blocos_total: number;
  ligado: boolean;
  apagariam: number;
  roster_suspeito: number;
  faltando: number;
  recusas: PorAgencia;
  por_agencia: PorAgencia;
  vistos: number[];
}

export const REVOTO_VAZIO: AcumuladoRevoto = {
  blocos_medidos: 0, blocos_total: 0, ligado: false, apagariam: 0, roster_suspeito: 0, faltando: 0,
  recusas: {}, por_agencia: {}, vistos: [],
};

export function acumularRevoto(acc: AcumuladoRevoto, r: RespostaRevoto): AcumuladoRevoto {
  const bloco = Number(r.janela_bloco ?? -1);
  const total = Number(r.janela_blocos ?? 0);
  if (bloco < 0 || acc.vistos.includes(bloco)) return { ...acc, blocos_total: Math.max(acc.blocos_total, total) };
  return {
    blocos_medidos: acc.blocos_medidos + 1,
    blocos_total: Math.max(acc.blocos_total, total),
    ligado: Boolean(r.revoto_ligado),
    apagariam: acc.apagariam + Number(r.revoto_apagariam ?? 0),
    roster_suspeito: acc.roster_suspeito + Number(r.revoto_roster_suspeito ?? 0),
    faltando: acc.faltando + Number(r.revoto_faltando ?? 0),
    recusas: somarPorAgencia(acc.recusas, r.revoto_recusas_por_motivo),
    por_agencia: somarPorAgencia(acc.por_agencia, r.revoto_por_agencia),
    vistos: [...acc.vistos, bloco],
  };
}

// ─── Ausências da ARTESP (Bloco D) ───────────────────────────────────────────

export interface DetalheAusencia {
  deliberacao_id: string;
  numero_reuniao: string | null;
  inserir: Array<{ nome: string; origem: string; trecho: string }>;
  promover: Array<{ nome: string; de: string | null; trecho: string }>;
  nominal_preservada: string[];
}

export interface RespostaAusencias {
  offset?: number;
  proximo_offset?: number;
  deliberacoes_candidatas?: number;
  deliberacoes_examinadas?: number;
  linhas_a_inserir?: number;
  linhas_a_promover?: number;
  linhas_ja_corretas?: number;
  nominais_preservadas?: number;
  linhas_gravadas?: number;
  nao_reconhecidos?: Array<{ nome: string; vezes: number }>;
  detalhe?: DetalheAusencia[];
  restantes?: boolean;
}

export interface AcumuladoAusencias {
  candidatas: number;
  examinadas: number;
  a_inserir: number;
  a_promover: number;
  ja_corretas: number;
  nominais_preservadas: number;
  gravadas: number;
  nao_reconhecidos: PorAgencia;
  detalhe: DetalheAusencia[];
  proximo_offset: number;
  concluido: boolean;
}

export const AUSENCIAS_VAZIO: AcumuladoAusencias = {
  candidatas: 0, examinadas: 0, a_inserir: 0, a_promover: 0, ja_corretas: 0, nominais_preservadas: 0,
  gravadas: 0, nao_reconhecidos: {}, detalhe: [], proximo_offset: 0, concluido: false,
};

/** Teto de exemplos guardados — a tela mostra amostra para conferir contra o PDF, não o estoque. */
export const TETO_DETALHE = 60;

export function acumularAusencias(acc: AcumuladoAusencias, r: RespostaAusencias): AcumuladoAusencias {
  const proximo = Number(r.proximo_offset ?? acc.proximo_offset);
  // ⚠️ Sem progresso (orçamento acabou antes da 1ª linha) não é "concluído": é "não avançou". O
  // chamador para o laço para não girar em falso, mas o resultado não afirma que terminou.
  const avancou = proximo > acc.proximo_offset;
  const naoReconhecidos: PorAgencia = { ...acc.nao_reconhecidos };
  for (const n of r.nao_reconhecidos ?? []) naoReconhecidos[n.nome] = (naoReconhecidos[n.nome] ?? 0) + n.vezes;
  return {
    candidatas: Math.max(acc.candidatas, Number(r.deliberacoes_candidatas ?? 0)),
    examinadas: acc.examinadas + Number(r.deliberacoes_examinadas ?? 0),
    a_inserir: acc.a_inserir + Number(r.linhas_a_inserir ?? 0),
    a_promover: acc.a_promover + Number(r.linhas_a_promover ?? 0),
    ja_corretas: acc.ja_corretas + Number(r.linhas_ja_corretas ?? 0),
    nominais_preservadas: acc.nominais_preservadas + Number(r.nominais_preservadas ?? 0),
    gravadas: acc.gravadas + Number(r.linhas_gravadas ?? 0),
    nao_reconhecidos: naoReconhecidos,
    detalhe: [...acc.detalhe, ...(r.detalhe ?? [])].slice(0, TETO_DETALHE),
    proximo_offset: avancou ? proximo : acc.proximo_offset,
    concluido: avancou && r.restantes === false,
  };
}

/** Continua a varredura? Só se a rota avançou E disse que há mais. */
export function continuarAusencias(antes: AcumuladoAusencias, depois: AcumuladoAusencias, r: RespostaAusencias): boolean {
  return depois.proximo_offset > antes.proximo_offset && r.restantes === true;
}
