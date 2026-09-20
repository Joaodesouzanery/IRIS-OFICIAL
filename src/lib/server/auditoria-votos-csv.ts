/**
 * O CSV da auditoria por voto (Fase 29) — folha pura, uma linha por VOTO.
 *
 * ═══ Por que não a URL assinada do PDF ═══
 * Ela expira em 1 hora. O operador abre a planilha na semana seguinte e TODO link dá erro — o que
 * ele leria como "o PDF sumiu", que é pior do que não ter link nenhum. Em troca vão duas colunas
 * estáveis: o NOME do arquivo (que ele procuraria no bucket) e um link para a PLATAFORMA.
 *
 * ⚠️ O link é de caminho de APP, nunca `/api/v1/...`: o middleware exige header `Bearer` em toda
 * rota de API, então um endereço de API colado no Excel devolveria "Login obrigatório" em vez do
 * documento. Caminho de app passa pelo gate de cookie e abre a página já filtrada.
 *
 * ⚠️ `voto_em_autos` nulo NÃO vira "Nao". A migration que criou a coluna é explícita: NULL é
 * legado (o voto é anterior ao campo), nunca FALSE. Achatar os dois apagaria a diferença entre
 * "sabemos que não foi em autos" e "não sabemos".
 */

export const CABECALHO_CSV = [
  "Agencia", "NumeroDeliberacao", "DataReuniao", "Microtema", "Resultado",
  "Diretor", "TipoVoto", "Origem", "Proveniencia", "Divergente",
  "MotivoNaoVoto", "VotoEmAutos", "ColegiadoEsperado", "VotosNaDeliberacao",
  "ArquivoPDF", "DeliberacaoId", "VotoId", "LinkNaPlataforma",
] as const;

export interface LinhaDeVoto {
  agencia: string | null;
  numero_deliberacao: string | null;
  data_reuniao: string | null;
  microtema: string | null;
  resultado: string | null;
  diretor: string | null;
  tipo_voto: string | null;
  origem: "lido" | "inferido";
  proveniencia: string | null;
  is_divergente: boolean | null;
  motivo_nao_voto: string | null;
  voto_em_autos: boolean | null;
  colegiado_esperado: number | null;
  votos_na_deliberacao: number | null;
  pdf_arquivo: string | null;
  deliberacao_id: string;
  voto_id: string;
}

/** Escapa um campo para CSV com separador `;` (o padrão do Excel pt-BR, já usado no repo). */
export function celulaCsv(valor: unknown): string {
  // `null`/`undefined` viram campo VAZIO. `String(null)` daria a palavra "null" na planilha.
  if (valor === null || valor === undefined) return "";
  const texto = String(valor);
  if (/[;"\r\n]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

export function linhaCsvDeVoto(linha: LinhaDeVoto, origemDaPlataforma: string): string {
  const campos = [
    linha.agencia,
    linha.numero_deliberacao,
    linha.data_reuniao,
    linha.microtema,
    linha.resultado,
    linha.diretor,
    linha.tipo_voto,
    linha.origem,
    linha.proveniencia,
    linha.is_divergente === null || linha.is_divergente === undefined ? null : linha.is_divergente ? "Sim" : "Nao",
    linha.motivo_nao_voto,
    linha.voto_em_autos === null || linha.voto_em_autos === undefined ? null : linha.voto_em_autos ? "Sim" : "Nao",
    linha.colegiado_esperado,
    linha.votos_na_deliberacao,
    linha.pdf_arquivo,
    linha.deliberacao_id,
    linha.voto_id,
    `${origemDaPlataforma}/dashboard/deliberacoes/auditoria-votos?deliberacao_id=${linha.deliberacao_id}`,
  ];
  return campos.map(celulaCsv).join(";");
}

/**
 * Monta o arquivo. BOM + CRLF é o que o Excel pt-BR espera — o resto do repo já faz assim.
 *
 * ⚠️ `truncado` vira uma LINHA no arquivo, não só um log: `console.warn` não chega ao operador, e
 * um CSV curto em silêncio é exatamente o que ele está tentando detectar.
 */
export function montarCsv(linhas: LinhaDeVoto[], origemDaPlataforma: string, truncado: boolean): string {
  const corpo = linhas.map((l) => linhaCsvDeVoto(l, origemDaPlataforma));
  if (truncado) {
    corpo.push(`# AVISO: exportacao TRUNCADA em ${linhas.length} linha(s) — o acervo tem mais votos que este arquivo`);
  }
  return `﻿${[CABECALHO_CSV.join(";"), ...corpo].join("\r\n")}`;
}
