/**
 * O que fazer com o documento que o parser NÃO conseguiu ler em 3 ciclos (Fase 27).
 *
 * Até aqui ele ficava `failed` para sempre, invisível: o `reprocessarFalhados` o contava em
 * `desistidos` e seguia. Medido em produção: 10 documentos assim — 9 da ANM (pautas de 2023-2024)
 * e 1 deliberação da ARTESP, todos com `page_count: null`, retentados por semanas e derrubando a
 * run a cada vez.
 *
 * A regra depende do que o documento VALE: pauta e apoio não geram voto — arquivam com motivo,
 * e a fila fica limpa. Ata, deliberação e voto são acervo: ficam `failed` TERMINAL, com um motivo
 * que diz o que fazer (reenviar convertido/dividido) e param de ser retentados.
 */

export type DesfechoDoReprocesso =
  | { acao: "retentar"; ciclo: number }
  | { acao: "arquivar"; motivo: "parser_travou" }
  | { acao: "encerrar"; motivo: string };

export const CICLOS_DE_REPROCESSO = 3;

const TIPOS_SEM_VALOR_DE_VOTO = new Set(["pauta", "documento", "documento_apoio", "reuniao"]);

export function desfechoDoReprocesso(input: {
  tipo: string | null | undefined;
  ciclos: number;
  erro?: string | null;
}): DesfechoDoReprocesso {
  if (input.ciclos < CICLOS_DE_REPROCESSO) return { acao: "retentar", ciclo: input.ciclos + 1 };
  if (TIPOS_SEM_VALOR_DE_VOTO.has(String(input.tipo ?? ""))) return { acao: "arquivar", motivo: "parser_travou" };
  return {
    acao: "encerrar",
    motivo: `Parser travou em ${CICLOS_DE_REPROCESSO} ciclos — reenviar o PDF convertido ou dividido (Upload de PDFs).`,
  };
}
