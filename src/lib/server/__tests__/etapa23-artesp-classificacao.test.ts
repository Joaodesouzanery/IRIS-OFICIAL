import { describe, it, expect } from "vitest";
import { classifyRegulatoryDocument, isFinalDecisionRecord } from "@/lib/server/regulatory-documents";
import { isFinalVoteDocument } from "@/lib/server/vote-inference";

// Textos reais dos 58 PDFs ARTESP (recortes de cabeçalho/decisão).
const RETIFICACAO = `RETIFICAÇÃO DA PUBLICAÇÃO DO DIÁRIO OFICIAL DO ESTADO DE SÃO PAULO, DELIBERAÇÃO ARTESP Nº
27, DE 13 DE JANEIRO DE 2026 SEI! nº 0094591819 - Processo SEI! nº 134.00006784/2025-85
Onde se lê: "1177ª Reunião Extraordinária do Conselho Diretor" Leia-se: "1177ª Reunião Ordinária do Conselho Diretor."
Documento assinado eletronicamente por Lais Yamashita, Assessor Especial III, em 14/01/2026.`;

const DELIB_RERRATIFICACAO = `DELIBERAÇÃO ARTESP Nº 32, DE 20 DE JANEIRO DE 2026
1178ª Reunião Ordinária do Conselho Diretor. Processo SEI! nº 134.00013689/2025-38.
Assunto: Celebração do 1º Termo de Rerratificação ao 10º Termo Aditivo Modificativo ao Contrato de Concessão.
RECOMENDA ao PODER CONCEDENTE e AUTORIZA esta ARTESP a formalizar o 1º Termo de Rerratificação.
Houve aprovação dos presentes por unanimidade de votos.`;

const DELIB_INDEFERE = `DELIBERAÇÃO ARTESP Nº 15, DE 13 DE JANEIRO DE 2026
1177ª Reunião Ordinária do Conselho Diretor. Processo SEI! nº 134.00023965/2023-12.
INDEFERE o pleito de desequilíbrio de redução de investimento do item 02.01.02.43.
Houve aprovação dos presentes por unanimidade de votos.
André Isper Rodrigues Barnabé Diretor-Presidente Diego Albert Zanatto Diretor
Fernanda Esbízaro Rodrigues Rudnik Diretora Raquel França Carneiro Diretora`;

describe("classificação ARTESP — retificação vs deliberação real", () => {
  it("RETIFICAÇÃO do DOE → documento de apoio: NÃO conta como decisão nem gera voto", () => {
    const c = classifyRegulatoryDocument({
      text: RETIFICACAO,
      filename: "DELIBERAÇÃO ARTESP Nº 27_RETIFICAÇÃO_SEI - 134.00006784_2025-85.pdf",
      tipo_documento: "deliberacao",
      agencia_sigla: "ARTESP",
    });
    expect(c.import_counts_as_final).toBe(false);
    expect(c.documento_subtipo).toBe("retificacao");
    expect(c.tipo_documento).toBe("documento_apoio");
    // Espelha o efeito nos consumidores:
    expect(isFinalDecisionRecord({ tipo_documento: c.tipo_documento, import_counts_as_final: c.import_counts_as_final })).toBe(false);
    expect(isFinalVoteDocument({ tipo_documento: c.tipo_documento, import_counts_as_final: c.import_counts_as_final })).toBe(false);
  });

  it("deliberação real com 'Rerratificação' no assunto (Nº 32) NÃO é confundida com retificação", () => {
    const c = classifyRegulatoryDocument({
      text: DELIB_RERRATIFICACAO,
      filename: "DELIBERAÇÃO ARTESP Nº 32_SEI - 134.00013689_2025-38.pdf",
      tipo_documento: "deliberacao",
      agencia_sigla: "ARTESP",
    });
    expect(c.tipo_documento).toBe("deliberacao");
    expect(c.documento_subtipo).toBe("artesp_deliberacao");
    expect(c.import_counts_as_final).toBe(true);
    expect(isFinalDecisionRecord({ tipo_documento: "deliberacao", import_counts_as_final: true, resultado: "Recomendado" })).toBe(true);
  });

  it("deliberação INDEFERE (Nº 15) é decisão final que conta e vota", () => {
    const c = classifyRegulatoryDocument({
      text: DELIB_INDEFERE,
      filename: "DELIBERAÇÃO ARTESP Nº 15_SEI - 134.00023965_2023-12.pdf",
      tipo_documento: "deliberacao",
      agencia_sigla: "ARTESP",
    });
    expect(c.tipo_documento).toBe("deliberacao");
    expect(c.import_counts_as_final).toBe(true);
    expect(isFinalVoteDocument({ tipo_documento: "deliberacao", import_counts_as_final: true })).toBe(true);
  });
});
