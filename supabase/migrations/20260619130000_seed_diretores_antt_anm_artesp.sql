-- Seed best-effort de diretores/mandatos ANTT, ANM e ARTESP (atuais + alguns históricos).
-- Origem: páginas oficiais de "Diretoria Colegiada"/"Relação de autoridades" (jun/2026).
-- TODOS marcados needs_review = TRUE — confira/ajuste em /dashboard/diretores antes de confiar
-- nos matches automáticos. Idempotente: re-executável sem duplicar.
--
-- nome_variantes inclui grafias alternativas (sem acento, nome do meio omitido, abreviações)
-- para melhorar o match difuso (findBestMatch) contra os nomes extraídos dos PDFs.

DO $$
DECLARE
  rec RECORD;
  v_agencia_id UUID;
  v_diretor_id UUID;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      -- ── ANTT (posse da nova diretoria em 16/09/2025) ──────────────────────
      ('ANTT', 'Guilherme Theo Sampaio', 'Diretor-Geral', 'titular', TRUE,
        ARRAY['Guilherme Sampaio','Guilherme Theo']::text[], DATE '2025-09-16', DATE '2030-09-15'),
      ('ANTT', 'Alex Antônio de Azevedo Cruz', 'Diretor', 'titular', TRUE,
        ARRAY['Alex Antonio de Azevedo Cruz','Alex de Azevedo Cruz','Alex Cruz']::text[], DATE '2025-09-16', NULL::date),
      ('ANTT', 'Felipe Queiroz', 'Diretor', 'titular', TRUE,
        ARRAY['Felipe Queiroz']::text[], NULL::date, NULL::date),
      ('ANTT', 'Amaral Filho', 'Diretor', 'titular', TRUE,
        ARRAY['Amaral Filho']::text[], NULL::date, NULL::date),
      ('ANTT', 'Rafael Vitale Rodrigues', 'Diretor-Geral (anterior)', 'inativo', FALSE,
        ARRAY['Rafael Vitale','Rafael Vitale Rodrigues']::text[], NULL::date, NULL::date),

      -- ── ANM ───────────────────────────────────────────────────────────────
      ('ANM', 'Mauro Henrique Moreira Sousa', 'Diretor-Geral', 'titular', TRUE,
        ARRAY['Mauro Henrique Moreira Souza','Mauro Sousa','Mauro Souza']::text[], DATE '2022-12-05', DATE '2026-12-04'),
      ('ANM', 'Caio Mário Trivellato Seabra Filho', 'Diretor', 'titular', TRUE,
        ARRAY['Caio Mario Trivellato Seabra Filho','Caio Seabra Filho','Caio Seabra']::text[], DATE '2023-12-27', DATE '2026-12-04'),
      ('ANM', 'José Fernando de Mendonça Gomes Júnior', 'Diretor', 'titular', TRUE,
        ARRAY['Jose Fernando de Mendonca Gomes Junior','José Fernando Gomes Júnior','Jose Fernando Gomes Junior','José Fernando Gomes']::text[], DATE '2025-09-01', DATE '2028-12-04'),
      ('ANM', 'Luiz Paniago Neves', 'Diretor', 'substituto', TRUE,
        ARRAY['Luiz Paniago']::text[], DATE '2025-12-05', DATE '2026-06-02'),
      ('ANM', 'Fábio Fernando Borges', 'Diretor', 'substituto', TRUE,
        ARRAY['Fabio Fernando Borges','Fábio Borges','Fabio Borges']::text[], DATE '2025-12-05', DATE '2026-06-02'),
      ('ANM', 'Roger Romão Cabral', 'Diretor', 'titular', TRUE,
        ARRAY['Roger Romao Cabral','Roger Cabral']::text[], NULL::date, NULL::date),
      ('ANM', 'Tasso Mendonça Junior', 'Diretor', 'titular', TRUE,
        ARRAY['Tasso Mendonca Junior','Tasso Mendonça Júnior','Tasso Mendonca']::text[], NULL::date, NULL::date),

      -- ── ARTESP (Conselho Diretor) ─────────────────────────────────────────
      ('ARTESP', 'André Isper Rodrigues Barnabé', 'Diretor-Presidente', 'titular', TRUE,
        ARRAY['Andre Isper Rodrigues Barnabe','André Isper Barnabé','Andre Isper','André Barnabé']::text[], NULL::date, NULL::date),
      ('ARTESP', 'Diego Zanatto', 'Diretor', 'titular', TRUE,
        ARRAY['Diego Zanatto']::text[], NULL::date, NULL::date),
      ('ARTESP', 'Raquel França Carneiro', 'Diretora', 'titular', TRUE,
        ARRAY['Raquel Franca Carneiro','Raquel Carneiro','Raquel França']::text[], NULL::date, NULL::date),
      ('ARTESP', 'Fernanda Esbízaro Rodrigues Rudnik', 'Diretora', 'titular', TRUE,
        ARRAY['Fernanda Esbizaro Rodrigues Rudnik','Fernanda Rudnik','Fernanda Esbízaro']::text[], NULL::date, NULL::date)
    ) AS t(sigla, nome, cargo, situacao, ativo, variantes, data_inicio, data_fim)
  LOOP
    SELECT id INTO v_agencia_id FROM agencias WHERE sigla = rec.sigla LIMIT 1;
    IF v_agencia_id IS NULL THEN
      RAISE NOTICE 'Agência % não encontrada — pulando %', rec.sigla, rec.nome;
      CONTINUE;
    END IF;

    SELECT id INTO v_diretor_id FROM diretores WHERE agencia_id = v_agencia_id AND nome = rec.nome LIMIT 1;
    IF v_diretor_id IS NULL THEN
      INSERT INTO diretores (agencia_id, nome, cargo, situacao, ativo, needs_review, nome_variantes, fonte_dado)
      VALUES (v_agencia_id, rec.nome, rec.cargo, rec.situacao, rec.ativo, TRUE, rec.variantes, 'automatico')
      RETURNING id INTO v_diretor_id;
    ELSE
      UPDATE diretores
        SET nome_variantes = rec.variantes,
            needs_review = TRUE,
            situacao = rec.situacao,
            cargo = COALESCE(cargo, rec.cargo)
        WHERE id = v_diretor_id;
    END IF;

    IF rec.data_inicio IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM mandatos WHERE diretor_id = v_diretor_id AND data_inicio = rec.data_inicio) THEN
      INSERT INTO mandatos (diretor_id, data_inicio, data_fim, cargo, fonte_dado)
      VALUES (v_diretor_id, rec.data_inicio, rec.data_fim, rec.cargo, 'automatico');
    END IF;
  END LOOP;
END $$;
