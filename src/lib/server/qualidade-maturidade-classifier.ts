/**
 * Auto-classificação de maturidade (Matriz IMQN) a partir dos dados do IRIS.
 *
 * Para cada agência × dimensão propõe um NÍVEL (Inexistente/Inicial/Gerenciado/Melhoria
 * Contínua → nota 0/35/70/100) com justificativa e evidências, SEM inventar: onde não há
 * sinal, marca Inexistente. É heurístico e PRELIMINAR (status_revisao='preliminar') —
 * a curadoria humana valida. Sinais:
 *  - Palavra-chave em regulatory_news (reusa scoreEvidenceRelevance) → dims 1,2,3,4,6.
 *  - Deliberações do IRIS (volume, datas, área classificada) → dims 5 (Processo) e 3 (Estoque).
 */

import {
  QUALIDADE_AGENCIAS,
  QUALIDADE_CRITERIOS,
  LEVEL_TO_NOTA,
  NIVEL_LABEL,
  scoreEvidenceRelevance,
  type QualidadeNivel,
} from "@/lib/server/qualidade-regulatoria";

// Relevância mínima (0-100) para uma notícia contar como sinal de uma dimensão.
const RELEVANCE_MIN = 50;
// Janela de recência (meses) para o sinal contar como "recente".
const RECENCY_MONTHS = 12;

export interface MaturidadeProposta {
  agencia_sigla: string;
  criterio_id: number;
  nivel: QualidadeNivel;
  nota: number;
  observacao: string;
  amostra_n: number;
  evidencias: Array<{ titulo: string; url: string | null; publicado_em: string | null }>;
}

export interface MaturidadeResultadoAgencia {
  agencia_sigla: string;
  status: "sucesso" | "parcial";
  dimensoes_classificadas: number;
  warnings: string[];
}

function nivelFromKeywordHits(recentHits: number, totalHits: number): QualidadeNivel {
  if (totalHits <= 0) return "inexistente";
  if (recentHits >= 8) return "melhoria_continua";
  if (recentHits >= 3) return "gerenciado";
  return "inicial";
}

type NewsRow = { titulo: string | null; resumo: string | null; conteudo: string | null; url: string | null; publicado_em: string | null };
type DelibRow = { data_reuniao: string | null; data_publicacao: string | null; area_regulatoria: string | null; tipo_documento: string | null; documento_pai_id: string | null };

/**
 * Classifica todas as agências elegíveis (as de QUALIDADE_AGENCIAS que existem em
 * `agencias`). Retorna propostas por dimensão + um resumo por agência.
 */
export async function classifyMaturidade(
  db: any,
  { ano }: { ano: number },
): Promise<{ propostas: MaturidadeProposta[]; resultados: MaturidadeResultadoAgencia[] }> {
  const propostas: MaturidadeProposta[] = [];
  const resultados: MaturidadeResultadoAgencia[] = [];

  const { data: agenciasReais } = await db.from("agencias").select("id, sigla");
  const siglaToId = new Map<string, string>((agenciasReais ?? []).map((a: any) => [a.sigla, a.id]));
  const elegiveis = QUALIDADE_AGENCIAS.filter((a) => siglaToId.has(a.sigla));

  const recencyCutoff = Date.parse(`${ano - 1}-07-01`); // ~12 meses antes do fim do ano
  const isRecent = (publicado_em: string | null) => {
    if (!publicado_em) return false;
    const t = Date.parse(publicado_em);
    return Number.isFinite(t) && t >= recencyCutoff;
  };

  for (const ag of elegiveis) {
    const agenciaId = siglaToId.get(ag.sigla)!;
    const warnings: string[] = [];

    const { data: newsRows } = await db
      .from("regulatory_news")
      .select("titulo, resumo, conteudo, url, publicado_em")
      .eq("agencia_id", agenciaId)
      .order("publicado_em", { ascending: false, nullsFirst: false })
      .limit(500);
    const news: NewsRow[] = newsRows ?? [];
    if (news.length === 0) warnings.push("sem notícias no IRIS para detecção por palavra-chave");

    const { data: delibRows } = await db
      .from("deliberacoes")
      .select("data_reuniao, data_publicacao, area_regulatoria, tipo_documento, documento_pai_id")
      .eq("agencia_id", agenciaId)
      .limit(5000);
    const delibs: DelibRow[] = delibRows ?? [];
    const finais = delibs.filter((d) => {
      if (["pauta", "voto_individual", "documento_apoio"].includes(String(d.tipo_documento ?? ""))) return false;
      if (d.tipo_documento === "ata" && !d.documento_pai_id) return false;
      return true;
    });
    const comArea = finais.filter((d) => d.area_regulatoria && d.area_regulatoria !== "outros").length;
    const pctArea = finais.length ? Math.round((comArea / finais.length) * 1000) / 10 : 0;
    const comDatas = finais.filter((d) => d.data_reuniao && d.data_publicacao).length;

    let classificadas = 0;
    for (const criterio of QUALIDADE_CRITERIOS) {
      let nivel: QualidadeNivel = "inexistente";
      let observacao = "";
      let amostra = 0;
      const evidencias: MaturidadeProposta["evidencias"] = [];

      if (criterio.id === 5) {
        // Gestão do Processo Normativo: sinal a partir das deliberações estruturadas.
        amostra = finais.length;
        if (finais.length === 0) {
          nivel = "inexistente";
          observacao = "Sem deliberações estruturadas no IRIS — processo normativo não observável nos dados.";
        } else if (finais.length >= 20 && comDatas >= 10) {
          nivel = "gerenciado";
          observacao = `Processo normativo observável e estruturado: ${finais.length} deliberações finais, ${comDatas} com datas de reunião e publicação.`;
        } else {
          nivel = "inicial";
          observacao = `Há deliberações registradas (${finais.length}), indicando processo normativo em funcionamento; estruturação parcial nos dados.`;
        }
      } else {
        // Dimensões por palavra-chave em notícias (1 AIR, 2 PS, 3 Estoque, 4 Agenda, 6 ARR).
        const matches = news.filter((n) => scoreEvidenceRelevance(criterio.id, `${n.titulo ?? ""} ${n.resumo ?? ""} ${n.conteudo ?? ""}`) >= RELEVANCE_MIN);
        const recent = matches.filter((n) => isRecent(n.publicado_em));
        amostra = matches.length;
        nivel = nivelFromKeywordHits(recent.length, matches.length);

        // Dimensão 3 (Estoque) também considera a % de área regulatória classificada.
        if (criterio.id === 3) {
          const nivelArea: QualidadeNivel = pctArea >= 70 ? "gerenciado" : pctArea >= 30 ? "inicial" : "inexistente";
          if (LEVEL_TO_NOTA[nivelArea] > LEVEL_TO_NOTA[nivel]) nivel = nivelArea;
        }

        for (const n of (recent.length ? recent : matches).slice(0, 3)) {
          evidencias.push({ titulo: n.titulo ?? "(sem título)", url: n.url, publicado_em: n.publicado_em });
        }
        observacao = matches.length
          ? `${matches.length} item(ns) de notícia relacionados a "${criterio.nome}" (${recent.length} nos últimos ${RECENCY_MONTHS} meses).`
          : `Nenhum sinal público relacionado a "${criterio.nome}" nos dados do IRIS.`;
      }

      propostas.push({
        agencia_sigla: ag.sigla,
        criterio_id: criterio.id,
        nivel,
        nota: LEVEL_TO_NOTA[nivel],
        observacao: `${NIVEL_LABEL[nivel]} — ${observacao} Classificação preliminar (auto), sujeita a revisão humana.`,
        amostra_n: amostra,
        evidencias,
      });
      classificadas += 1;
    }

    resultados.push({
      agencia_sigla: ag.sigla,
      status: classificadas > 0 ? "sucesso" : "parcial",
      dimensoes_classificadas: classificadas,
      warnings,
    });
  }

  return { propostas, resultados };
}
