/**
 * Um voto é NOMINAL (lido do documento ou corrigido por humano), ou INFERIDO? (Fase 21)
 *
 * Módulo-folha, sem imports, porque tem leitor dos DOIS lados: rotas de servidor e a tela de
 * Reuniões (cliente). Havia ONZE leitores de `is_nominal` e só um honrava `proveniencia`: um voto
 * `revisao_humana` contava como nominal na ficha do diretor e como inferido em saúde-dados,
 * completude, governança, overview, relatório, consenso e qualidade. `buildVotoRows` grava
 * `is_nominal=true` para revisão humana, então o delta esperado hoje é zero — mas a regra tem de
 * viver num lugar só, senão a próxima proveniência nova diverge de novo.
 *
 * `proveniencia` ausente (coluna não migrada, ou SELECT sem ela) degrada para `is_nominal`.
 */
export function isVotoNominal(v: { is_nominal?: boolean | null; proveniencia?: string | null }): boolean {
  if (v.proveniencia === "nominal" || v.proveniencia === "revisao_humana") return true;
  if (v.proveniencia == null) return Boolean(v.is_nominal);
  return false;
}

/**
 * O voto é uma MANIFESTAÇÃO (Favorável / Desfavorável / Abstenção), ou o registro de que a pessoa
 * NÃO votou (`Ausente`, que é também como o impedimento é gravado, com `motivo_nao_voto`)?
 *
 * ⚠️ Vive aqui, ao lado de `isVotoNominal`, porque é a mesma pergunta: como se LÊ uma linha de
 * `votos`. E porque a distinção decide uma recusa: `Ausente` nominal numa fonte que não nomina
 * votantes é leitura legítima (a ata diz quem faltou sem dizer quem votou como) e NÃO é o voto
 * artefato — tratá-lo como artefato deixava a deliberação parcial para sempre.
 */
export function ehVotoDeDirecao(tipoVoto: string | null | undefined): boolean {
  return Boolean(tipoVoto) && tipoVoto !== "Ausente";
}
