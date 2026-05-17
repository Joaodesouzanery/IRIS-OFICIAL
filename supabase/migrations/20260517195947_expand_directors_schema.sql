-- Migration: schema institucional de agencias, diretores, mandatos e lista triplice.
-- Expande as tabelas existentes; nao cria modelo paralelo.

ALTER TABLE agencias
  ADD COLUMN IF NOT EXISTS tipo TEXT,
  ADD COLUMN IF NOT EXISTS esfera TEXT,
  ADD COLUMN IF NOT EXISTS ministerio_vinculado TEXT,
  ADD COLUMN IF NOT EXISTS url_institucional TEXT,
  ADD COLUMN IF NOT EXISTS url_diretores TEXT,
  ADD COLUMN IF NOT EXISTS estado TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ativa',
  ADD COLUMN IF NOT EXISTS dados_importados_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE agencias
  DROP CONSTRAINT IF EXISTS agencias_tipo_check;
ALTER TABLE agencias
  ADD CONSTRAINT agencias_tipo_check
  CHECK (tipo IS NULL OR tipo IN ('federal','estadual'));

ALTER TABLE agencias
  DROP CONSTRAINT IF EXISTS agencias_status_check;
ALTER TABLE agencias
  ADD CONSTRAINT agencias_status_check
  CHECK (status IN ('ativa','inativa'));

CREATE INDEX IF NOT EXISTS idx_agencias_sigla ON agencias(sigla);
CREATE INDEX IF NOT EXISTS idx_agencias_status_tipo ON agencias(status, tipo);

ALTER TABLE diretores
  ADD COLUMN IF NOT EXISTS situacao TEXT NOT NULL DEFAULT 'titular',
  ADD COLUMN IF NOT EXISTS data_posse DATE,
  ADD COLUMN IF NOT EXISTS data_fim_mandato DATE,
  ADD COLUMN IF NOT EXISTS data_saida DATE,
  ADD COLUMN IF NOT EXISTS ato_nomeacao TEXT,
  ADD COLUMN IF NOT EXISTS publicacao_dou DATE,
  ADD COLUMN IF NOT EXISTS foto_url TEXT,
  ADD COLUMN IF NOT EXISTS minibio TEXT,
  ADD COLUMN IF NOT EXISTS curriculo_url TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS telefone TEXT,
  ADD COLUMN IF NOT EXISTS percentual_mandato_concluido NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS fonte_dado TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS importado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE diretores
  DROP CONSTRAINT IF EXISTS diretores_situacao_check;
ALTER TABLE diretores
  ADD CONSTRAINT diretores_situacao_check
  CHECK (situacao IN ('titular','substituto','interino','inativo','designado'));

ALTER TABLE diretores
  DROP CONSTRAINT IF EXISTS diretores_fonte_dado_check;
ALTER TABLE diretores
  ADD CONSTRAINT diretores_fonte_dado_check
  CHECK (fonte_dado IN ('automatico','manual','verificado'));

CREATE INDEX IF NOT EXISTS idx_diretores_agencia_situacao ON diretores(agencia_id, situacao);
CREATE INDEX IF NOT EXISTS idx_diretores_agencia_ativo ON diretores(agencia_id, ativo);

ALTER TABLE mandatos
  ADD COLUMN IF NOT EXISTS ato_nomeacao TEXT,
  ADD COLUMN IF NOT EXISTS publicacao_dou DATE,
  ADD COLUMN IF NOT EXISTS fonte_dado TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS percentual_mandato_concluido NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE mandatos
  DROP CONSTRAINT IF EXISTS mandatos_fonte_dado_check;
ALTER TABLE mandatos
  ADD CONSTRAINT mandatos_fonte_dado_check
  CHECK (fonte_dado IN ('automatico','manual','verificado'));

CREATE INDEX IF NOT EXISTS idx_mandatos_periodo ON mandatos(data_inicio, data_fim);

ALTER TABLE lista_triplice
  ADD COLUMN IF NOT EXISTS cargo_vaga TEXT,
  ADD COLUMN IF NOT EXISTS candidatos JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'em_analise',
  ADD COLUMN IF NOT EXISTS data_publicacao DATE,
  ADD COLUMN IF NOT EXISTS fonte TEXT,
  ADD COLUMN IF NOT EXISTS observacoes TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE lista_triplice
  DROP CONSTRAINT IF EXISTS lista_triplice_status_check;
ALTER TABLE lista_triplice
  ADD CONSTRAINT lista_triplice_status_check
  CHECK (status IN ('em_analise','nomeado','arquivado'));

CREATE INDEX IF NOT EXISTS idx_lista_triplice_agencia_status ON lista_triplice(agencia_id, status);

CREATE OR REPLACE TRIGGER trg_mandatos_updated_at
  BEFORE UPDATE ON mandatos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_lista_triplice_updated_at
  BEFORE UPDATE ON lista_triplice
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON agencias TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON diretores TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON mandatos TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON lista_triplice TO service_role;

CREATE OR REPLACE FUNCTION iris_seed_director(
  p_agencia_id UUID,
  p_nome TEXT,
  p_cargo TEXT,
  p_situacao TEXT,
  p_data_posse DATE,
  p_data_fim DATE,
  p_ato_nomeacao TEXT
) RETURNS UUID
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_diretor_id UUID;
  v_percentual NUMERIC(5,2);
BEGIN
  IF p_data_posse IS NOT NULL AND p_data_fim IS NOT NULL AND p_data_fim > p_data_posse THEN
    v_percentual := LEAST(
      100,
      GREATEST(
        0,
        ROUND((((CURRENT_DATE - p_data_posse)::NUMERIC / NULLIF((p_data_fim - p_data_posse), 0)::NUMERIC) * 100), 2)
      )
    );
  ELSE
    v_percentual := NULL;
  END IF;

  SELECT id
    INTO v_diretor_id
  FROM diretores
  WHERE agencia_id = p_agencia_id
    AND lower(nome) = lower(p_nome)
  LIMIT 1;

  IF v_diretor_id IS NULL THEN
    INSERT INTO diretores (
      agencia_id, nome, cargo, ativo, situacao, data_posse, data_fim_mandato,
      ato_nomeacao, percentual_mandato_concluido, fonte_dado, importado_em,
      metadata
    )
    VALUES (
      p_agencia_id, p_nome, p_cargo, TRUE, p_situacao, p_data_posse, p_data_fim,
      p_ato_nomeacao, v_percentual, 'verificado', NOW(),
      jsonb_build_object('seed', 'agencias_iniciais_2026')
    )
    RETURNING id INTO v_diretor_id;
  ELSE
    UPDATE diretores SET
      cargo = p_cargo,
      ativo = TRUE,
      situacao = p_situacao,
      data_posse = p_data_posse,
      data_fim_mandato = p_data_fim,
      ato_nomeacao = p_ato_nomeacao,
      percentual_mandato_concluido = v_percentual,
      fonte_dado = 'verificado',
      importado_em = COALESCE(importado_em, NOW()),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('seed', 'agencias_iniciais_2026'),
      updated_at = NOW()
    WHERE id = v_diretor_id;
  END IF;

  IF p_data_posse IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM mandatos
      WHERE diretor_id = v_diretor_id
        AND data_inicio = p_data_posse
        AND COALESCE(data_fim, DATE '9999-12-31') = COALESCE(p_data_fim, DATE '9999-12-31')
    ) THEN
      UPDATE mandatos SET
        cargo = p_cargo,
        ato_nomeacao = p_ato_nomeacao,
        percentual_mandato_concluido = v_percentual,
        fonte_dado = 'verificado',
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('seed', 'agencias_iniciais_2026'),
        updated_at = NOW()
      WHERE diretor_id = v_diretor_id
        AND data_inicio = p_data_posse
        AND COALESCE(data_fim, DATE '9999-12-31') = COALESCE(p_data_fim, DATE '9999-12-31');
    ELSE
      INSERT INTO mandatos (
        diretor_id, data_inicio, data_fim, cargo, ato_nomeacao,
        percentual_mandato_concluido, fonte_dado, metadata
      )
      VALUES (
        v_diretor_id, p_data_posse, p_data_fim, p_cargo, p_ato_nomeacao,
        v_percentual, 'verificado', jsonb_build_object('seed', 'agencias_iniciais_2026')
      );
    END IF;
  END IF;

  RETURN v_diretor_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION iris_seed_lista_triplice(
  p_agencia_id UUID,
  p_cargo_vaga TEXT,
  p_status TEXT,
  p_observacoes TEXT
) RETURNS UUID
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_item_id UUID;
BEGIN
  SELECT id
    INTO v_item_id
  FROM lista_triplice
  WHERE agencia_id = p_agencia_id
    AND COALESCE(cargo_vaga, cargo) = p_cargo_vaga
  LIMIT 1;

  IF v_item_id IS NULL THEN
    INSERT INTO lista_triplice (
      agencia_id, cargo, cargo_vaga, nome_candidato, candidatos, etapa,
      status, observacoes, fonte, confidence, review_status, metadata
    )
    VALUES (
      p_agencia_id, p_cargo_vaga, p_cargo_vaga, 'A definir', '[]'::jsonb,
      'mapeamento', p_status, p_observacoes, 'Curadoria IRIS - dados verificados',
      1.000, 'aprovado', jsonb_build_object('seed', 'agencias_iniciais_2026')
    )
    RETURNING id INTO v_item_id;
  ELSE
    UPDATE lista_triplice SET
      cargo = p_cargo_vaga,
      cargo_vaga = p_cargo_vaga,
      status = p_status,
      observacoes = p_observacoes,
      fonte = 'Curadoria IRIS - dados verificados',
      confidence = 1.000,
      review_status = 'aprovado',
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('seed', 'agencias_iniciais_2026'),
      updated_at = NOW()
    WHERE id = v_item_id;
  END IF;

  RETURN v_item_id;
END;
$fn$;

DO $$
DECLARE
  v_agencia_id UUID;
BEGIN
  INSERT INTO agencias (
    sigla, nome, nome_completo, tipo, esfera, ministerio_vinculado,
    url_institucional, url_diretores, estado, status, ativo,
    dados_importados_em, metadata
  )
  VALUES
    (
      'ANTT', 'ANTT', 'Agência Nacional de Transportes Terrestres', 'federal',
      'Transportes', 'Ministério dos Transportes',
      'https://www.gov.br/antt',
      'https://www.gov.br/antt/pt-br/acesso-a-informacao/servidores/diretores',
      NULL, 'ativa', TRUE, NOW(),
      jsonb_build_object(
        'alertas', ARRAY['Vaga permanente número 5 ainda não nomeada pelo Presidente. Alessandro Baumgartner consta como diretor designado.'],
        'fonte_dado', 'verificado'
      )
    ),
    (
      'ANM', 'ANM', 'Agência Nacional de Mineração', 'federal',
      'Mineração', 'Ministério de Minas e Energia',
      'https://www.gov.br/anm',
      'https://www.gov.br/anm/pt-br/acesso-a-informacao/institucional/quem-e-quem/diretores',
      NULL, 'ativa', TRUE, NOW(),
      jsonb_build_object(
        'alertas', ARRAY['Dois diretores substitutos vencem em junho de 2026; Diretor-Geral e Caio vencem em dezembro de 2026.'],
        'fonte_dado', 'verificado'
      )
    ),
    (
      'ARTESP', 'ARTESP', 'Agência de Transporte do Estado de São Paulo', 'estadual',
      'Transportes', 'Governo do Estado de São Paulo',
      'https://www.artesp.sp.gov.br',
      'https://www.artesp.sp.gov.br/artesp/institucional/relacao-de-autoridades',
      'SP', 'ativa', TRUE, NOW(),
      jsonb_build_object(
        'alertas', ARRAY['Quinta cadeira vaga; Fernanda Esbízaro Rodrigues Rudnik tem datas exatas pendentes de confirmação no DOE-SP.'],
        'fonte_dado', 'verificado'
      )
    )
  ON CONFLICT (sigla) DO UPDATE SET
    nome = EXCLUDED.nome,
    nome_completo = EXCLUDED.nome_completo,
    tipo = EXCLUDED.tipo,
    esfera = EXCLUDED.esfera,
    ministerio_vinculado = EXCLUDED.ministerio_vinculado,
    url_institucional = EXCLUDED.url_institucional,
    url_diretores = EXCLUDED.url_diretores,
    estado = EXCLUDED.estado,
    status = EXCLUDED.status,
    ativo = EXCLUDED.ativo,
    dados_importados_em = EXCLUDED.dados_importados_em,
    metadata = agencias.metadata || EXCLUDED.metadata,
    updated_at = NOW();

  -- ANTT
  SELECT id INTO v_agencia_id FROM agencias WHERE sigla = 'ANTT';
  PERFORM iris_seed_director(v_agencia_id, 'Guilherme Theo Rodrigues da Rocha Sampaio', 'Diretor-Geral', 'titular', DATE '2025-08-29', DATE '2030-02-18', NULL);
  PERFORM iris_seed_director(v_agencia_id, 'Lucas Asfor Rocha Lima', 'Diretor', 'titular', DATE '2023-02-20', DATE '2028-02-18', NULL);
  PERFORM iris_seed_director(v_agencia_id, 'Felipe Fernandes Queiroz', 'Diretor', 'titular', DATE '2022-12-23', DATE '2027-02-18', NULL);
  PERFORM iris_seed_director(v_agencia_id, 'Alex Antonio de Azevedo Cruz', 'Diretor', 'titular', DATE '2025-08-29', DATE '2030-02-18', NULL);
  PERFORM iris_seed_director(v_agencia_id, 'Alessandro Baumgartner', 'Diretor', 'designado', DATE '2026-02-23', NULL, 'Portaria DG nº 35, de 20/02/2026');
  PERFORM iris_seed_lista_triplice(v_agencia_id, 'Diretor Vaga 5', 'em_analise', 'Não há lista tríplice pública vigente para nomeação permanente; processo federal segue indicação presidencial e aprovação pelo Senado. Lista tríplice usada apenas para substitutos interinos.');

  -- ANM
  SELECT id INTO v_agencia_id FROM agencias WHERE sigla = 'ANM';
  PERFORM iris_seed_director(v_agencia_id, 'Mauro Henrique Moreira Sousa', 'Diretor-Geral', 'titular', DATE '2022-12-05', DATE '2026-12-04', NULL);
  PERFORM iris_seed_director(v_agencia_id, 'Caio Mário Trivellato Seabra Filho', 'Diretor', 'titular', DATE '2023-12-27', DATE '2026-12-04', NULL);
  PERFORM iris_seed_director(v_agencia_id, 'José Fernando Gomes Júnior', 'Diretor', 'titular', DATE '2025-09-01', DATE '2028-12-04', NULL);
  PERFORM iris_seed_director(v_agencia_id, 'Luiz Paniago Neves', 'Diretor Substituto', 'interino', DATE '2025-12-05', DATE '2026-06-02', NULL);
  PERFORM iris_seed_director(v_agencia_id, 'Fábio Fernando Borges', 'Diretor Substituto', 'interino', DATE '2025-12-05', DATE '2026-06-02', NULL);
  PERFORM iris_seed_lista_triplice(v_agencia_id, 'Diretores substitutos', 'em_analise', 'Luiz Paniago Neves e Fábio Fernando Borges constam como substitutos eleitos em lista tríplice interna para cobrir vagas de mandatos encerrados em 04/12/2025.');

  -- ARTESP
  SELECT id INTO v_agencia_id FROM agencias WHERE sigla = 'ARTESP';
  PERFORM iris_seed_director(v_agencia_id, 'André Isper Rodrigues Barnabé', 'Diretor-Presidente', 'titular', DATE '2024-10-07', DATE '2029-06-30', 'Decreto publicado no DOE-SP em 07/10/2024');
  PERFORM iris_seed_director(v_agencia_id, 'Diego Albert Zanatto', 'Diretor de Controle Econômico e Financeiro', 'titular', DATE '2024-10-07', DATE '2030-06-30', 'Decreto publicado no DOE-SP em 07/10/2024');
  PERFORM iris_seed_director(v_agencia_id, 'Raquel França Carneiro', 'Diretora de Investimentos', 'titular', DATE '2025-05-14', DATE '2029-05-14', 'Aprovada pela ALESP em 14/05/2025');
  PERFORM iris_seed_director(v_agencia_id, 'Fernanda Esbízaro Rodrigues Rudnik', 'Diretora', 'titular', NULL, NULL, 'Datas exatas de posse e fim de mandato pendentes de confirmação no DOE-SP');
  PERFORM iris_seed_lista_triplice(v_agencia_id, 'Conselho Diretor - 5ª cadeira', 'em_analise', 'Não existe lista tríplice; processo estadual segue indicação do Governador e aprovação pela ALESP. Quinta cadeira está vaga.');
END $$;

DROP FUNCTION IF EXISTS iris_seed_director(UUID, TEXT, TEXT, TEXT, DATE, DATE, TEXT);
DROP FUNCTION IF EXISTS iris_seed_lista_triplice(UUID, TEXT, TEXT, TEXT);
