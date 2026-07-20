import { describe, it, expect } from "vitest";
import { scoreSourceReports, classificarFonte, erroCurto } from "@/lib/news-health";

// QA jul/2026: o aviso de notícias confundia "fonte quieta" com "coletor quebrado" (o dia
// contava desde a última notícia SALVA, não desde a última coleta bem-sucedida). Estas
// funções puras centralizam a verdade — scoring por fonte + classificação honesta do aviso.

describe("scoreSourceReports — 3 estados por fonte (itens/erro/vazio)", () => {
  it("alguma fase com itens → hadItems, status ok, não é allEmpty", () => {
    const s = scoreSourceReports([{ status: "ok", links_found: 10 }, { status: "empty", links_found: 3 }]);
    expect(s.hadItems).toBe(true);
    expect(s.allEmpty).toBe(false);
    expect(s.status).toBe("ok");
    expect(s.linksFound).toBe(13);
  });

  it("todas as fases vazias → allEmpty, status ok (respondeu), hadItems=false", () => {
    const s = scoreSourceReports([{ status: "empty", links_found: 0 }]);
    expect(s.allEmpty).toBe(true);
    expect(s.hadItems).toBe(false);
    expect(s.hadError).toBe(false);
    expect(s.status).toBe("ok");
    expect(s.linksFound).toBe(0);
  });

  it("erro sem nenhum item → hadError, status error", () => {
    const s = scoreSourceReports([{ status: "error" }, { status: "empty", links_found: 2 }]);
    expect(s.hadError).toBe(true);
    expect(s.hadItems).toBe(false);
    expect(s.status).toBe("error");
  });

  it("itens VENCEM erro (uma fase deu certo) → status ok, sem marcar erro", () => {
    const s = scoreSourceReports([{ status: "error" }, { status: "ok", links_found: 5 }]);
    expect(s.hadItems).toBe(true);
    expect(s.status).toBe("ok");
  });
});

describe("classificarFonte — separa problema técnico de fonte quieta", () => {
  const base = { agencia_sigla: "ANA", total: 5, dias_sem_publicar: 20, latest_links_found: 4 };

  it("erro técnico recente → 'erro' (prioridade máxima, mesmo sem itens)", () => {
    expect(classificarFonte({ ...base, total: 0, active_error: true })).toBe("erro");
  });

  it("respondeu mas 0 links há >7d → 'sem_itens' (listagem quebrada/indisponível)", () => {
    expect(classificarFonte({ ...base, latest_links_found: 0 })).toBe("sem_itens");
  });

  it("listagem OK (achou links) mas parada há >7d → 'quieta' (recesso/defeso)", () => {
    expect(classificarFonte({ ...base, latest_links_found: 8 })).toBe("quieta");
  });

  it("links DESCONHECIDOS (sem histórico) e parada há >7d → 'quieta', NÃO 'sem_itens' (conservador)", () => {
    expect(classificarFonte({ ...base, latest_links_found: undefined })).toBe("quieta");
    expect(classificarFonte({ ...base, latest_links_found: null })).toBe("quieta");
  });

  it("configurada sem nenhuma notícia → 'nunca'", () => {
    expect(classificarFonte({ agencia_sigla: "X", total: 0, dias_sem_publicar: null })).toBe("nunca");
  });

  it("publicou dentro de 7d → 'ok' (não entra em aviso)", () => {
    expect(classificarFonte({ ...base, dias_sem_publicar: 3 })).toBe("ok");
  });

  it("sem data de dias (null) mas com itens → 'ok' (não marca parada)", () => {
    expect(classificarFonte({ ...base, dias_sem_publicar: null })).toBe("ok");
  });
});

describe("erroCurto — limpa o prefixo transitório e corta", () => {
  it("remove '[transitorio]' e limita o tamanho", () => {
    expect(erroCurto("[transitorio] 429 Too Many Requests")).toBe("429 Too Many Requests");
    expect(erroCurto(null)).toBe("erro");
    expect(erroCurto("x".repeat(100)).length).toBe(60);
  });
});
