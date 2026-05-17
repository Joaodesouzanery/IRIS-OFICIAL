-- Migration 013: hardening e indice FK das noticias regulatorias

CREATE INDEX IF NOT EXISTS idx_regulatory_news_agencia_id
  ON regulatory_news(agencia_id);

REVOKE ALL ON regulatory_news FROM anon, authenticated;
REVOKE ALL ON regulatory_newsletter_schedules FROM anon, authenticated;
