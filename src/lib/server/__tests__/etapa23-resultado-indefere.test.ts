import { describe, it, expect } from "vitest";
import { extractFields } from "@/lib/server/nlp-extractor";

// Bug CRÍTICO (QA jul/2026, prova empírica nos 58 PDFs ARTESP reais): a RE_RESULTADO
// reconhecia INDEFERIDO/INDEFERIU (particípio/pretérito) mas NÃO "INDEFERE" (presente),
// que é a forma do dispositivo ARTESP ("INDEFERE o pleito de desequilíbrio..."). Sem
// match, o resultado caía no FALLBACK de unanimidade e virava "Aprovado por Unanimidade"
// (POSITIVO) → invertia a taxa de deferimento. Os testes etapa23 ANTERIORES passavam
// `resultado` hard-coded e não pegavam isto — estes rodam a EXTRAÇÃO REAL sobre o texto.

const DELIB_INDEFERE = `DELIBERAÇÃO ARTESP Nº 15, DE 13 DE JANEIRO DE 2026
1177ª Reunião Ordinária do Conselho Diretor. Processo SEI! nº 134.00023965/2023-12.
DELIBERA nos seguintes termos: INDEFERE o pleito de desequilíbrio de redução de investimento.
Houve aprovação dos presentes por unanimidade de votos.`;

const DELIB_RATIFICA = `DELIBERAÇÃO ARTESP Nº 08, DE 13 DE JANEIRO DE 2026
RATIFICA o Termo Aditivo Modificativo. Houve aprovação dos presentes por unanimidade de votos.`;

const DELIB_RECOMENDA_AUTORIZA = `DELIBERAÇÃO ARTESP Nº 32, DE 20 DE JANEIRO DE 2026
RECOMENDA ao PODER CONCEDENTE e AUTORIZA esta ARTESP a formalizar o Termo Aditivo.
Houve aprovação dos presentes por unanimidade de votos.`;

describe("extração de resultado — INDEFERE (presente) e infinitivos [bug crítico QA]", () => {
  it("INDEFERE (presente) → 'Indeferido', NÃO 'Aprovado por Unanimidade'", () => {
    const f = extractFields(DELIB_INDEFERE);
    expect(f.resultado).toBe("Indeferido");
    expect(f.resultado).not.toBe("Aprovado por Unanimidade");
    expect(f.decisoes_todas).toContain("Indeferido");
  });

  it("RATIFICA (presente) → 'Ratificado' (a 'aprovação' minúscula da unanimidade é descartada)", () => {
    expect(extractFields(DELIB_RATIFICA).resultado).toBe("Ratificado");
  });

  it("RECOMENDA + AUTORIZA (vários verbos positivos) → positivo, jamais 'Indeferido'", () => {
    const f = extractFields(DELIB_RECOMENDA_AUTORIZA);
    expect(f.resultado).not.toBe("Indeferido");
    expect(f.decisoes_todas).toEqual(expect.arrayContaining(["Recomendado", "Autorizado"]));
  });

  it("infinitivo no dispositivo — 'RESOLVE APROVAR' → 'Aprovado'", () => {
    expect(extractFields("Em face do exposto, a Diretoria RESOLVE APROVAR a matéria.").resultado).toBe("Aprovado");
  });

  it("infinitivo no dispositivo — 'RESOLVE INDEFERIR' → 'Indeferido'", () => {
    expect(extractFields("Em face do exposto, a Diretoria RESOLVE INDEFERIR o pleito.").resultado).toBe("Indeferido");
  });

  it("particípio FEMININO explícito é lido (não depende do fallback) — 'INDEFERIDA' → 'Indeferido'", () => {
    // "a solicitação foi INDEFERIDA por unanimidade" — sem o [OA], cairia no fallback
    // positivo. Reduz a superfície do fallback silencioso.
    expect(extractFields("Em face do exposto, a solicitação restou INDEFERIDA.").resultado).toBe("Indeferido");
    expect(extractFields("Em face do exposto, a matéria foi APROVADA.").resultado).toBe("Aprovado");
  });
});
