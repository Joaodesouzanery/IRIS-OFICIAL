/**
 * Coletor de evidências DERIVADAS de dados internos do IRIS (deliberações, votos,
 * notícias) para Qualidade Regulatória. Gera apenas evidências factuais (sem inventar
 * nota), com gate de amostra mínima, marcadas como `origem='derivada_dados'` e
 * `status_revisao='pendente'` — a curadoria humana decide o que vira nota.
 *
 * Garantias: nunca sobrescreve evidências manuais/coleta_web (só toca derivadas, via
 * delete+insert por metric_key). Só agências presentes em QUALIDADE_AGENCIAS que têm
 * deliberações no IRIS (hoje, na prática, ANTT e ANM).
 */

import { QUALIDADE_AGENCIAS } from "@/lib/server/qualidade-regulatoria";

const AMOSTRA_MINIMA = 5;

export interface DerivedEvidence {
  agencia_sigla: string;
  criterio_id: number;
  titulo: string;
  trecho_publico: string;
  metric_key: string;
  metadata: Record<string, unknown>;
}

export interface DerivedCollectionResult {
  agencia_sigla: string;
  status: "sucesso" | "parcial";
  evidencias: number;
  warnings: string[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function isFinal(tipo: string | null, paiId: string | null): boolean {
  // Conta como decisão final: não-pauta/voto/apoio. Itens de ata (com pai) contam.
  if (["pauta", "voto_individual", "documento_apoio"].includes(String(tipo ?? ""))) return false;
  if (tipo === "ata" && !paiId) return false; // ata-mãe não conta (evita dupla contagem)
  return true;
}

/**
 * Calcula as evidências derivadas para todas as agências elegíveis.
 */
export async function collectDerivedEvidence(
  db: any,
  { ano }: { ano: number },
): Promise<{ evidencias: DerivedEvidence[]; results: DerivedCollectionResult[] }> {
  const evidencias: DerivedEvidence[] = [];
  const results: DerivedCollectionResult[] = [];

  // Mapa sigla -> agencia_id das agências reais com dados.
  const { data: agenciasReais } = await db.from("agencias").select("id, sigla");
  const siglaToId = new Map<string, string>((agenciasReais ?? []).map((a: any) => [a.sigla, a.id]));

  const elegiveis = QUALIDADE_AGENCIAS.filter((a) => siglaToId.has(a.sigla));
  const desde = `${ano}-01-01`;
  const ate = `${ano}-12-31`;

  for (const ag of elegiveis) {
    const agenciaId = siglaToId.get(ag.sigla)!;
    const warnings: string[] = [];
    const before = evidencias.length;

    // Deliberações finais do ano.
    const { data: delibs } = await db
      .from("deliberacoes")
      .select("id, data_reuniao, data_publicacao, area_regulatoria, tipo_documento, documento_pai_id")
      .eq("agencia_id", agenciaId)
      .gte("data_reuniao", desde)
      .lte("data_reuniao", ate)
      .limit(5000);
    const finais = (delibs ?? []).filter((d: any) => isFinal(d.tipo_documento, d.documento_pai_id));

    // Votos da agência (via join) para % nominal e divergência.
    const { data: votos } = await db
      .from("votos")
      .select("is_nominal, is_divergente, deliberacoes!inner(agencia_id)")
      .eq("deliberacoes.agencia_id", agenciaId)
      .limit(20000);
    const totalVotos = (votos ?? []).length;
    const nominais = (votos ?? []).filter((v: any) => v.is_nominal).length;

    // Notícias regulatórias da agência no ano (atividade).
    const { count: noticias } = await db
      .from("regulatory_news")
      .select("id", { count: "exact", head: true })
      .eq("agencia_id", agenciaId);

    // ── Dim. 5 (Gestão do Processo Normativo) — % de votação nominal ──
    if (totalVotos >= AMOSTRA_MINIMA) {
      const pct = Math.round((nominais / totalVotos) * 1000) / 10;
      evidencias.push({
        agencia_sigla: ag.sigla, criterio_id: 5,
        titulo: `Votação nominal registrada em ${pct}% dos votos (${ano})`,
        trecho_publico: `${nominais} de ${totalVotos} votos de diretores foram registrados nominalmente, indicador de publicidade do voto colegiado.`,
        metric_key: `transparencia_nominal_${ano}`,
        metadata: { amostra_n: totalVotos, valor: pct, periodo: ano, origem_calculo: "iris_interno" },
      });
    } else {
      warnings.push("amostra de votos insuficiente para % nominal");
    }

    // ── Dim. 5 (Gestão do Processo Normativo) — votos divergentes ──
    const delibsComDivergencia = new Set<string>();
    // Reconsulta leve: marca deliberações com voto divergente.
    const { data: divergentes } = await db
      .from("votos")
      .select("deliberacao_id, is_divergente, deliberacoes!inner(agencia_id)")
      .eq("deliberacoes.agencia_id", agenciaId)
      .eq("is_divergente", true)
      .limit(20000);
    for (const v of divergentes ?? []) delibsComDivergencia.add((v as any).deliberacao_id);
    if (totalVotos >= AMOSTRA_MINIMA && delibsComDivergencia.size > 0) {
      evidencias.push({
        agencia_sigla: ag.sigla, criterio_id: 5,
        titulo: `Votos divergentes registrados em ${delibsComDivergencia.size} deliberação(ões) (${ano})`,
        trecho_publico: `Registro de dissenso colegiado em ${delibsComDivergencia.size} deliberação(ões) — evidência de deliberação não-unânime.`,
        metric_key: `independencia_divergencia_${ano}`,
        metadata: { amostra_n: totalVotos, valor: delibsComDivergencia.size, periodo: ano, origem_calculo: "iris_interno" },
      });
    }

    // ── Dim. 5 (Gestão do Processo Normativo) — atividade decisória ──
    if (finais.length >= AMOSTRA_MINIMA) {
      evidencias.push({
        agencia_sigla: ag.sigla, criterio_id: 5,
        titulo: `${finais.length} deliberações finais e ${noticias ?? 0} itens regulatórios monitorados (${ano})`,
        trecho_publico: `Densidade de atividade decisória: ${finais.length} deliberações finais publicadas e ${noticias ?? 0} itens regulatórios monitorados no período.`,
        metric_key: `atividade_volume_${ano}`,
        metadata: { amostra_n: finais.length, deliberacoes: finais.length, noticias: noticias ?? 0, periodo: ano, origem_calculo: "iris_interno" },
      });
    } else {
      warnings.push("amostra de deliberações insuficiente para atividade");
    }

    // ── Dim. 5 (Gestão do Processo Normativo) — pontualidade de publicação ──
    const lags = finais
      .filter((d: any) => d.data_reuniao && d.data_publicacao)
      .map((d: any) => Math.round((new Date(d.data_publicacao).getTime() - new Date(d.data_reuniao).getTime()) / 86400000))
      .filter((n: number) => Number.isFinite(n) && n >= 0);
    if (lags.length >= AMOSTRA_MINIMA) {
      const lagMediano = median(lags);
      evidencias.push({
        agencia_sigla: ag.sigla, criterio_id: 5,
        titulo: `Prazo mediano de publicação: ${lagMediano} dia(s) (${ano})`,
        trecho_publico: `Intervalo mediano entre a reunião e a publicação no Diário Oficial: ${lagMediano} dia(s), em ${lags.length} deliberações com ambas as datas.`,
        metric_key: `pontualidade_publicacao_${ano}`,
        metadata: { amostra_n: lags.length, valor: lagMediano, periodo: ano, origem_calculo: "iris_interno" },
      });
    } else {
      warnings.push("amostra insuficiente de datas de publicação para pontualidade");
    }

    // ── Dim. 3 (Gestão de Estoque Regulatório) — cobertura de área ──
    if (finais.length >= AMOSTRA_MINIMA) {
      const classificadas = finais.filter((d: any) => d.area_regulatoria && d.area_regulatoria !== "outros").length;
      const pctArea = Math.round((classificadas / finais.length) * 1000) / 10;
      evidencias.push({
        agencia_sigla: ag.sigla, criterio_id: 3,
        titulo: `${pctArea}% das deliberações classificadas por área regulatória (${ano})`,
        trecho_publico: `${classificadas} de ${finais.length} deliberações têm área regulatória estruturada (cobertura de metadados).`,
        metric_key: `cobertura_area_${ano}`,
        metadata: { amostra_n: finais.length, valor: pctArea, periodo: ano, origem_calculo: "iris_interno" },
      });
    }

    const geradas = evidencias.length - before;
    results.push({
      agencia_sigla: ag.sigla,
      status: geradas > 0 ? "sucesso" : "parcial",
      evidencias: geradas,
      warnings,
    });
  }

  return { evidencias, results };
}
