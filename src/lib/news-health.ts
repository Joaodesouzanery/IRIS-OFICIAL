/**
 * Saúde do coletor de notícias — funções PURAS compartilhadas entre a rota de coleta
 * (scoring por fonte) e o painel (classificação honesta do aviso). QA jul/2026.
 *
 * Motivação: o aviso antigo dizia "sem notícia nova" e mandava "rode Coletar" para qualquer
 * fonte parada há >7d, sem distinguir FONTE QUIETA de COLETOR QUEBRADO (o dia contava desde a
 * última notícia salva, não desde a última coleta bem-sucedida). Aqui centralizamos a verdade.
 */

// ─── Scoring por fonte (usado no coletar/route.ts) ──────────────────────────
// Um report é o resultado de uma FASE (fresh/backlog) de uma fonte. status ∈ ok|empty|error:
//   "ok" = trouxe itens · "empty" = respondeu sem item novo · "error" = falha real.
export type SourceReportLike = { status: string; links_found?: number };

export interface SourceScore {
  hadItems: boolean; // alguma fase trouxe item novo
  hadError: boolean; // alguma fase falhou
  allEmpty: boolean; // rodou, respondeu, mas 0 item novo em todas as fases
  status: "ok" | "error"; // valor p/ monitoramento_sites.ultimo_status (CHECK sem 'empty')
  linksFound: number; // total de links achados nesta rodada (0 = listagem provável quebrada)
}

export function scoreSourceReports(reports: SourceReportLike[]): SourceScore {
  const hadItems = reports.some((r) => r.status === "ok");
  const hadError = reports.some((r) => r.status === "error");
  const allEmpty = !hadItems && !hadError;
  // 'empty' vira 'ok' no enum de ultimo_status (a fonte respondeu sem erro); a distinção
  // vazio-vs-com-itens vive no metadata (news_last_empty_at / news_last_success_at).
  const status: "ok" | "error" = hadItems ? "ok" : hadError ? "error" : "ok";
  const linksFound = reports.reduce((sum, r) => sum + (r.links_found ?? 0), 0);
  return { hadItems, hadError, allEmpty, status, linksFound };
}

// ─── Classificação do aviso (usado no painel de notícias) ───────────────────
// Só os campos usados na classificação; vindos de /noticias/health.
export type HealthSource = {
  agencia_sigla: string;
  total: number;
  dias_sem_publicar: number | null;
  active_error?: boolean;
  latest_error?: string | null;
  // Links achados no último run: número quando SABIDO, null quando desconhecido (sem histórico
  // de run e sem metadata). Distinguir "0 comprovado" de "desconhecido" é o que evita chamar
  // uma fonte quieta de "coletor quebrado" sem evidência.
  latest_links_found?: number | null;
};

export type FonteEstado = "erro" | "sem_itens" | "quieta" | "nunca" | "ok";

/**
 * Estado HONESTO de uma fonte — separa problema técnico de fonte quieta:
 * - "erro":     coletor falhou (erro técnico recente) → NÃO é "sem notícia".
 * - "sem_itens": coletor respondeu mas achou 0 links COMPROVADOS (listagem movida/indisponível).
 * - "quieta":   listagem OK (ou desconhecida) e sem publicação nova há >7d (recesso/defeso).
 * - "nunca":    configurada e sem NENHUMA notícia ingerida (pode nunca ter coletado).
 * - "ok":       saudável (não entra em aviso).
 * Conservador: só acusa "sem_itens" com 0 links COMPROVADO; sem evidência de links, assume quieta.
 */
export function classificarFonte(s: HealthSource): FonteEstado {
  if (s.active_error) return "erro";
  if (s.total === 0) return "nunca";
  const dias = s.dias_sem_publicar;
  if (typeof dias === "number" && dias > 7) {
    return s.latest_links_found === 0 ? "sem_itens" : "quieta";
  }
  return "ok";
}

export function erroCurto(msg: string | null | undefined): string {
  if (!msg) return "erro";
  return msg.replace(/^\[transitorio\]\s*/i, "").slice(0, 60);
}
