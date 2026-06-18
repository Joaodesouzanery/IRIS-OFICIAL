-- Alinha o CHECK de status_revisao das evidencias de qualidade com os valores usados pelo codigo
-- (endpoint PATCH/POST em src/app/api/v1/qualidade-regulatoria/evidencias/route.ts).
-- Antes: ('pendente', 'validada', 'rejeitada'); Agora: ('pendente', 'em_revisao', 'validado', 'rejeitado').

ALTER TABLE public.qualidade_regulatoria_evidencias
  DROP CONSTRAINT IF EXISTS qualidade_regulatoria_evidencias_status_revisao_check;

UPDATE public.qualidade_regulatoria_evidencias
  SET status_revisao = CASE status_revisao
    WHEN 'validada'  THEN 'validado'
    WHEN 'rejeitada' THEN 'rejeitado'
    ELSE status_revisao
  END
  WHERE status_revisao IN ('validada', 'rejeitada');

ALTER TABLE public.qualidade_regulatoria_evidencias
  ADD CONSTRAINT qualidade_regulatoria_evidencias_status_revisao_check
  CHECK (status_revisao IN ('pendente', 'em_revisao', 'validado', 'rejeitado'));
