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
  /**
   * A fonte oficial mostra algo MAIS NOVO do que a notícia mais nova que temos?
   *
   * ⚠️ Já era calculado em `/noticias/health` e não era lido por ninguém — quinta vez de
   * "capacidade sem consumidor" no projeto. É o único campo que separa "a fonte não publicou"
   * (afirmação sobre a AGÊNCIA) de "nós não temos" (afirmação sobre NÓS), e é o que faltava
   * para o aviso não mentir.
   */
  is_stale?: boolean;
  latest_official_publicado_em?: string | null;
  /** A mais nova que NÓS temos — exibida ao lado da da fonte, para o atraso ser verificável. */
  latest_publicado_em?: string | null;
  /**
   * A fonte respondeu com uma página de VERIFICAÇÃO ANTI-ROBÔ (CAPTCHA/WAF) — ver
   * `looksLikeChallenge`. Verificado ao vivo contra a ANAC (01/10/2026): HTTP 200, sem título,
   * cookies de WAF, corpo de CAPTCHA de imagem. Dois sinais porque sobrevivem a lacunas diferentes:
   * `latest_blocked_at` persiste além da rotação de runs; `blocked_now` cobre a corrida entre a
   * rodada mais recente e a escrita do metadata.
   */
  latest_blocked_at?: string | null;
  blocked_now?: boolean;
};

export type FonteEstado = "bloqueada" | "erro" | "sem_itens" | "atrasada" | "nao_gravou" | "quieta" | "nunca" | "ok";

/**
 * Estado HONESTO de uma fonte:
 * - "erro":      coletor falhou (erro técnico recente) → NÃO é "sem notícia".
 * - "sem_itens": coletor respondeu mas achou 0 links COMPROVADOS (listagem movida/indisponível).
 * - "atrasada":  a FONTE publicou algo mais novo do que o que temos → o atraso é NOSSO.
 * - "nao_gravou": nada ingerido, mas o coletor ACHOU links → não é "nunca coletou".
 * - "quieta":    sem publicação nova há >7d e nenhuma evidência de que a fonte publicou.
 * - "nunca":     configurada, sem nenhuma notícia e sem link achado (pode nunca ter rodado).
 * - "ok":        saudável (não entra em aviso).
 *
 * ⚠️ O DEFEITO QUE ISTO CONSERTA (medido em 30/09/2026). O único teste era
 * `latest_links_found === 0`, e com qualquer número diferente de zero a saída era "quieta" — cujo
 * texto AFIRMA "a fonte simplesmente não publicou". A ANS aparecia com "89 dias" tendo publicado
 * em **28/09**: o coletor achava **1** link (a sub-listagem, ver `pareceSecaoDeNoticias`) e
 * `1 !== 0` bastava. A ANA, **7** links de julho, com matéria nova **do mesmo dia**.
 *
 * É a forma de erro da Fase 17 com o sinal trocado: lá um marcador que SEMPRE casa provava
 * "bloqueado"; aqui um número que quase nunca é zero prova "a fonte está quieta". Um número só
 * vira afirmação sobre a AGÊNCIA quando é comparado com a agência — é o que `is_stale` faz.
 */
export function classificarFonte(s: HealthSource): FonteEstado {
  /**
   * ⚠️ "bloqueada" é checada ANTES de "erro" e de "nunca". É a mais específica e a mais
   * ACIONÁVEL das classificações: diferente de "erro" (que soa como "nosso parser quebrou") e
   * diferente de "nunca" (que manda "rode Coletar Notícias" — reprocessar não resolve um CAPTCHA).
   * Vale tanto para o run mais recente (`blocked_now`) quanto para o metadata persistido
   * (`latest_blocked_at`), porque o metadata sobrevive a mais rodadas que a janela de runs.
   */
  if (s.blocked_now || s.latest_blocked_at) return "bloqueada";
  if (s.active_error) return "erro";
  if (s.total === 0) return (s.latest_links_found ?? 0) > 0 ? "nao_gravou" : "nunca";
  const dias = s.dias_sem_publicar;
  if (typeof dias === "number" && dias > 7) {
    // Ordem: o que a FONTE mostra vence o que nós contamos.
    if (s.is_stale) return "atrasada";
    return s.latest_links_found === 0 ? "sem_itens" : "quieta";
  }
  return "ok";
}

/**
 * A quietude foi CONFERIDA contra a fonte, ou é só ausência de notícia nossa?
 *
 * Sem `latest_official_publicado_em` não há comparação nenhuma, e o aviso não pode afirmar nada
 * sobre a agência — só que nós não temos nada novo. Com ele, "quieta" passa a significar que a
 * própria fonte não mostra nada mais recente.
 */
export function quietudeConferida(s: HealthSource): boolean {
  return Boolean(s.latest_official_publicado_em);
}

export function erroCurto(msg: string | null | undefined): string {
  if (!msg) return "erro";
  return msg.replace(/^\[transitorio\]\s*/i, "").replace(/^\[bloqueado_antirobo\]\s*/i, "").slice(0, 60);
}
