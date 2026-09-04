/**
 * A decomposição que faz o número do Dashboard se explicar (Fase 17).
 *
 * ═══ Por que este arquivo existe ═══
 * O usuário comparou 1028 linhas em `deliberacoes` com 692 no "Total de deliberações" e
 * perguntou como confiar nas métricas. A diferença não é filtro de ano nem de agência — a tela
 * não manda nenhum dos dois: é inteiramente `isFinalDecisionRecord`. O número está CERTO; o que
 * faltava era ele dizer isso. Um número sem denominador declarado não é informação: é opinião
 * com aparência de dado (é o que abre o `docs/METODOLOGIA-METRICAS.md`).
 *
 * A decisão de produto foi manter o 692 e PUBLICAR a decomposição — mexer no predicado mudaria
 * analytics, reuniões, microtemas, mandatos e o padrão-ouro de certificação de votos.
 */

import { TIPOS_NAO_FINAIS_SET } from "@/lib/server/regulatory-documents";

/** Os motivos pelos quais uma linha de `deliberacoes` NÃO entra no total do Dashboard. */
export type MotivoDescarte =
  | "tipo_nao_final"
  | "ata_envelope"
  | "sem_resultado_extraido"
  | "outro";

/**
 * Por que esta linha ficou fora do total? `null` = ela ENTRA.
 *
 * Espelha `isFinalDecisionRecord` na ordem em que ele decide — e nomeia o QUINTO estado que a
 * METODOLOGIA não declarava: item de ata que tem pai mas não teve `resultado` extraído. Ele some
 * do "pautado" em silêncio; agora tem nome e contagem.
 */
export function classificarDescarte(row: {
  tipo_documento?: string | null;
  documento_pai_id?: string | null;
  resultado?: string | null;
}): MotivoDescarte | null {
  const tipo = String(row.tipo_documento ?? "");
  if (TIPOS_NAO_FINAIS_SET.has(tipo)) return "tipo_nao_final";
  if (tipo === "ata") {
    if (!row.documento_pai_id) return "ata_envelope";
    if (!row.resultado) return "sem_resultado_extraido";
    return null;
  }
  if (["deliberacao", "resolucao", "portaria"].includes(tipo)) {
    return row.resultado ? null : "sem_resultado_extraido";
  }
  return "outro";
}

/**
 * A identidade de uma REUNIÃO.
 *
 * "Reuniões Únicas" era um `DISTINCT data_reuniao` GLOBAL: duas agências que se reúnem no mesmo
 * dia viravam UMA — e a ANTT, que faz ordinária e extraordinária na mesma data, perdia uma
 * delas. A chave natural é a mesma que a tabela `reunioes` materializada usa desde a Fase 6:
 * agência + data + número.
 */
export function reuniaoKey(row: {
  agencia_id?: string | null;
  data_reuniao?: string | null;
  numero_reuniao?: string | null;
}): string {
  return `${row.agencia_id ?? "?"}|${row.data_reuniao ?? "?"}|${row.numero_reuniao ?? ""}`;
}
