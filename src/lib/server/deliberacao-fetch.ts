/**
 * Select + mapping compartilhado de deliberações com votos embutidos, para
 * endpoints que reusam as agregações de `analytics-engine` (reuniões etc.).
 */

import type { Deliberacao } from "@/types";

export const DELIB_SELECT =
  `id, numero_deliberacao, reuniao_ordinaria, numero_reuniao, tipo_reuniao,
   data_reuniao, data_publicacao, interessado, processo, microtema, area_regulatoria,
   resultado, pauta_interna, agencia_id, tipo_documento, documento_pai_id, empresa_id,
   agencias (sigla, nome),
   votos (id, tipo_voto, is_divergente, is_nominal, diretor_id, diretores (nome))`;

export function mapDeliberacaoRows(rows: any[]): Deliberacao[] {
  return (rows ?? []).map((d: any) => ({
    ...d,
    agencia: d.agencias ?? null,
    agencias: undefined,
    votos: (d.votos ?? []).map((v: any) => ({
      id: v.id,
      tipo_voto: v.tipo_voto,
      is_divergente: v.is_divergente,
      is_nominal: v.is_nominal,
      diretor_id: v.diretor_id,
      diretor_nome: v.diretores?.nome ?? null,
    })),
  })) as Deliberacao[];
}
