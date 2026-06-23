/**
 * Filtros compartilhados dos endpoints de votação (matrix/distribution/fidelidade/
 * timeline). Aplica filtros sobre a deliberação relacionada ao voto, no servidor.
 */

import type { Deliberacao } from "@/types";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MICROTEMA_RE = /^[a-z_]{2,30}$/;

export interface VotacaoFilters {
  agenciaId: string | null;
  microtema: string | null;
  area: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  numeroReuniao: string | null;
}

export function parseVotacaoFilters(searchParams: URLSearchParams): VotacaoFilters {
  const microtema = searchParams.get("microtema");
  const area = searchParams.get("area_regulatoria");
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");
  const numeroReuniao = searchParams.get("numero_reuniao");
  return {
    agenciaId: searchParams.get("agencia_id"),
    microtema: microtema && MICROTEMA_RE.test(microtema) ? microtema : null,
    area: area && MICROTEMA_RE.test(area) ? area : null,
    dateFrom: dateFrom && ISO_DATE_RE.test(dateFrom) ? dateFrom : null,
    dateTo: dateTo && ISO_DATE_RE.test(dateTo) ? dateTo : null,
    numeroReuniao: numeroReuniao ? numeroReuniao.slice(0, 10) : null,
  };
}

export function hasDeliberacaoFilter(f: VotacaoFilters): boolean {
  return Boolean(f.microtema || f.area || f.dateFrom || f.dateTo || f.numeroReuniao);
}

/** Aplica os filtros de deliberação a uma query de `votos` (Supabase). */
export function applyDeliberacaoFilters<T extends { eq: any; gte: any; lte: any }>(query: T, f: VotacaoFilters): T {
  let q: any = query;
  if (f.microtema) q = q.eq("deliberacoes.microtema", f.microtema);
  if (f.area) q = q.eq("deliberacoes.area_regulatoria", f.area);
  if (f.numeroReuniao) q = q.eq("deliberacoes.numero_reuniao", f.numeroReuniao);
  if (f.dateFrom) q = q.gte("deliberacoes.data_reuniao", f.dateFrom);
  if (f.dateTo) q = q.lte("deliberacoes.data_reuniao", f.dateTo);
  return q;
}

/** Filtra deliberações em memória (modo local/demo). */
export function filterDelibsForVotacao(delibs: Deliberacao[], f: VotacaoFilters): Deliberacao[] {
  return delibs.filter((d) => {
    if (f.agenciaId && d.agencia_id !== f.agenciaId) return false;
    if (f.microtema && d.microtema !== f.microtema) return false;
    if (f.area && d.area_regulatoria !== f.area) return false;
    if (f.numeroReuniao && d.numero_reuniao !== f.numeroReuniao) return false;
    if (f.dateFrom && (d.data_reuniao ?? "") < f.dateFrom) return false;
    if (f.dateTo && (d.data_reuniao ?? "") > f.dateTo) return false;
    return true;
  });
}
