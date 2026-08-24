/**
 * Checagens de CONSISTÊNCIA da extração (fechadores QA ago/2026) — funções PURAS (texto → aviso),
 * separadas do orquestrador (upload-analysis) para serem testáveis sem PDF. Cada aviso é de
 * QUALIDADE: rebaixa o status e bloqueia a auto-confirmação → o documento vai à REVISÃO humana.
 * Nenhuma DESTROI ou FABRICA voto — só sinaliza (princípio null-não-chuta).
 */

// Sinais fortes de voto CONTESTADO (não "divergênci" solto, que casa "sem divergência").
const RE_CONTESTADO = /\bpor\s+maioria\b|voto\s+de\s+qualidade|\bempate\b|\bvencid[oa]s?\b|prevaleceu|maioria\s+de\s+votos/i;

/**
 * "Unanimidade" DECLARADA + sinais de contestação SEM dissidente nomeado é contraditório: o pool
 * viraria "unânime favorável" falso. Retorna o aviso (→ revisão) ou null. NÃO purga — no ramo de
 * unanimidade a inferência de mandato desfaria o esvaziamento; o aviso é o mecanismo correto.
 */
export function avisoUnanimidadeContestada(text: string, unanimidade: boolean, contraCount: number): string | null {
  if (unanimidade && contraCount === 0 && RE_CONTESTADO.test(text)) {
    return "Sinais contraditórios: texto indica unanimidade E maioria/voto de qualidade/voto vencido sem dissidente nomeado — revisar direção antes de confirmar.";
  }
  return null;
}

/**
 * Camada 4 do zero-toque (QA ago/2026): documento ILEGÍVEL (quase sem texto) e SEM NENHUM
 * campo útil extraído não pode virar deliberação — seria um registro vazio poluindo métrica.
 * A pipeline auto-ARQUIVA (ignored, recuperável via reprocesso) em vez de confirmar.
 */
export function isHardFailSemSinal(input: {
  charsPerPage: number | null | undefined;
  resultado?: unknown;
  numeroReuniao?: unknown;
  processo?: unknown;
  dataReuniao?: unknown;
  ataItemsCount?: number;
}): boolean {
  const ilegivel = (input.charsPerPage ?? 0) < 50;
  const semSinal = !input.resultado && !input.numeroReuniao && !input.processo && !input.dataReuniao
    && !(typeof input.ataItemsCount === "number" && input.ataItemsCount > 0);
  return ilegivel && semSinal;
}

/**
 * Item de ata que não parseou deixa de sumir em SILÊNCIO: se o texto tem bem mais rótulos
 * "Processo:" do que itens reconhecidos, algum item foi descartado. Retorna o aviso ou null.
 * Tolerância de 2 (rótulos em prosa / cabeçalho) para não gerar falso positivo.
 */
export function avisoAtaItensFaltando(text: string, itensParseados: number): string | null {
  const labels = (text.match(/Processo(?:\s*n[ºo°]?)?\s*:/gi) ?? []).length;
  if (labels >= itensParseados + 2) {
    return `Possível item de ata não reconhecido: ${labels} rótulos "Processo" no texto, mas ${itensParseados} item(ns) parseado(s) — revisar a divisão da ata.`;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Etapa 63 — SUÍTE DE VALIDAÇÃO com nível BLOQUEANTE
//
// Até aqui toda checagem era AVISO: rebaixa confiança, manda para revisão, mas o documento entra.
// Alguns defeitos, porém, não deveriam entrar de jeito nenhum — segmentação quebrada e voto que
// contradiz o próprio dispositivo produzem dado que parece bom e está errado, que é a pior espécie.
//
// Nível `bloqueante` RECUSA o confirm, salvo `override_motivo` explícito do revisor. O override é
// parte do desenho: o operador que vê o documento sabe coisas que o parser não sabe — o que não
// pode é a decisão dele ser INVISÍVEL.
// ═══════════════════════════════════════════════════════════════════════════

export type NivelChecagem = "info" | "aviso" | "bloqueante";

export interface Achado {
  codigo: string;
  nivel: NivelChecagem;
  mensagem: string;
}

/**
 * C03 — RECONCILIAÇÃO DE ÂNCORAS.
 *
 * ⚠️ Este check NÃO pode comparar âncoras com a contagem PÓS-dedup. A 81ª ROP tem duas ocorrências
 * legítimas do mesmo item (mesmo processo, repetido dentro da ata): depois da dedup da etapa53 a
 * diferença entre âncoras e itens é PERMANENTE e CORRETA. Comparar contra o pós-dedup faria toda
 * reingestão exigir override — e um alarme que sempre dispara é um alarme que ninguém lê.
 *
 * A comparação é contra `itens_pre_dedup`, e em duas direções distintas:
 *  · itens EXCEDENDO âncoras  → segmentação quebrada (bloqueante);
 *  · âncoras excedendo itens por mais de 2 → itens PERDIDOS (bloqueante) — é o caso real
 *    "44 âncoras, 30 itens";
 *  · duplicatas removidas     → informativo, SEMPRE logado, nunca bloqueia.
 */
export function checarAncorasItens(input: {
  ancoras: number;
  itens_pre_dedup: number;
  duplicatas_removidas: number;
}): Achado[] {
  const out: Achado[] = [];
  const { ancoras, itens_pre_dedup, duplicatas_removidas } = input;

  // ⚠️ MEDIDO, e contra a hipótese original: "itens excedendo âncoras" é o estado NORMAL de uma
  // ata. Item retirado de pauta não tem linha de dispositivo, e a ANTT usa "Decisão:" no lugar de
  // "DELIBERAÇÃO:". Nas 8 atas reais do corpus a diferença vai de 0 a 4 — bloquear nessa direção
  // recusaria 8 de 8 atas e CONGELARIA a esteira inteira. Vira aviso, e só quando é gritante.
  if (itens_pre_dedup > ancoras * 1.5 && itens_pre_dedup - ancoras > 5) {
    out.push({
      codigo: "C03_ITENS_MUITO_ACIMA_DAS_ANCORAS",
      nivel: "aviso",
      mensagem: `${itens_pre_dedup} itens para ${ancoras} âncoras de dispositivo — diferença grande `
        + "demais para ser só item retirado de pauta; conferir a divisão da ata.",
    });
  }
  // A direção INVERSA continua bloqueando: toda âncora deveria ter produzido um item, então âncora
  // sobrando é item PERDIDO na segmentação. É o caso que motivou o check ("44 âncoras, 30 itens").
  if (ancoras - itens_pre_dedup > 2) {
    out.push({
      codigo: "C03_ITENS_PERDIDOS",
      nivel: "bloqueante",
      mensagem: `${ancoras} âncoras de dispositivo e apenas ${itens_pre_dedup} itens reconhecidos: `
        + `${ancoras - itens_pre_dedup} item(ns) perdido(s) na segmentação.`,
    });
  }

  if (duplicatas_removidas > 0) {
    out.push({
      codigo: "C04_DUPLICATA_INTRA_ATA",
      nivel: "info",
      mensagem: `${duplicatas_removidas} item(ns) repetido(s) dentro da própria ata — mantida a `
        + "ocorrência com dispositivo. Comportamento esperado; registrado para auditoria.",
    });
  }
  return out;
}

/**
 * C05/C06 — CARDINALIDADE do colegiado e item decidido sem voto.
 *
 * Mais votos do que cadeiras é impossível e denuncia atribuição ao diretor errado ou item
 * duplicado. Item DECIDIDO sem nenhum voto é lacuna real — não bloqueia (é o estado normal de
 * agência que não nomina voto), mas precisa ser visível.
 */
export function checarCardinalidadeVotos(input: {
  votos: number;
  cadeiras: number | null;
  decidido: boolean;
  item?: string | null;
}): Achado[] {
  const out: Achado[] = [];
  const onde = input.item ? ` (item ${input.item})` : "";
  if (input.cadeiras != null && input.cadeiras > 0 && input.votos > input.cadeiras) {
    out.push({
      codigo: "C05_VOTOS_ACIMA_DO_COLEGIADO",
      nivel: "bloqueante",
      mensagem: `${input.votos} votos para um colegiado de ${input.cadeiras} cadeiras${onde}: `
        + "voto atribuído ao diretor errado ou item duplicado.",
    });
  }
  if (input.decidido && input.votos === 0) {
    out.push({
      codigo: "C06_DECIDIDO_SEM_VOTO",
      nivel: "aviso",
      mensagem: `Item decidido sem nenhum voto registrado${onde} — normal em órgão que não nomina `
        + "voto, mas o item não entra em nenhuma métrica de comportamento.",
    });
  }
  return out;
}

/**
 * C07 — COERÊNCIA entre o que o dispositivo DIZ e os votos que existem.
 *
 * "Aprovado por unanimidade" com voto contrário registrado é contradição direta: ou o dispositivo
 * foi lido errado, ou o voto foi atribuído errado. Qualquer dos dois envenena a taxa de consenso.
 */
export function checarCoerenciaUnanimidade(input: {
  unanimidade: boolean;
  votosContra: number;
  votosAbstencao: number;
}): Achado[] {
  if (input.unanimidade && (input.votosContra > 0 || input.votosAbstencao > 0)) {
    return [{
      codigo: "C07_UNANIMIDADE_COM_DISSENSO",
      nivel: "bloqueante",
      mensagem: `Dispositivo declara UNANIMIDADE mas há ${input.votosContra} voto(s) contrário(s) e `
        + `${input.votosAbstencao} abstenção(ões) registrados — o dispositivo ou a atribuição está errado.`,
    }];
  }
  return [];
}

/**
 * C08 — o voto de QUALIDADE não pode virar um segundo voto do mesmo diretor.
 * Quem desempata já votou; contar duas vezes infla a participação dele e distorce o quórum.
 */
export function checarVotoQualidadeDuplo(input: {
  votoQualidadePor: string | null;
  diretoresComVoto: string[];
}): Achado[] {
  if (!input.votoQualidadePor) return [];
  const ocorrencias = input.diretoresComVoto.filter((n) => n === input.votoQualidadePor).length;
  if (ocorrencias > 1) {
    return [{
      codigo: "C08_VOTO_QUALIDADE_DUPLICADO",
      nivel: "bloqueante",
      mensagem: `O voto de qualidade de "${input.votoQualidadePor}" foi contado ${ocorrencias} vezes — `
        + "quem desempata já votou; a segunda linha é dupla contagem.",
    }];
  }
  return [];
}

/**
 * C09 — INTERESSADO citado no dispositivo × interessado do campo.
 *
 * Pega erro de copy-paste NA FONTE: a 83ª ROP, item 3.10.1, tem no dispositivo o nome de outra
 * empresa. É defeito do documento oficial, não nosso — por isso AVISO, não bloqueio: bloquear
 * obrigaria override em todo documento com erro de digitação da própria agência.
 */
export function checarInteressadoNoDispositivo(input: {
  interessado: string | null;
  dispositivo: string | null;
}): Achado[] {
  const { interessado, dispositivo } = input;
  if (!interessado || !dispositivo) return [];
  const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ");
  const alvo = norm(interessado);
  const corpo = norm(dispositivo);
  // Só checa quando o dispositivo NOMEIA alguma empresa (tem "Ltda"/"S.A."/"S/A"); do contrário a
  // ausência do nome não significa nada.
  if (!/\b(ltda|s a|sa|eireli|me|epp)\b/.test(corpo)) return [];
  const tokens = alvo.split(/\s+/).filter((t) => t.length >= 4);
  if (tokens.length === 0) return [];
  const encontrados = tokens.filter((t) => corpo.includes(t)).length;
  if (encontrados / tokens.length < 0.34) {
    return [{
      codigo: "C09_INTERESSADO_DIVERGENTE",
      nivel: "aviso",
      mensagem: `O dispositivo nomeia empresa diferente do campo Interessado ("${interessado}") — `
        + "possível copy-paste no documento oficial; conferir antes de vincular à empresa.",
    }];
  }
  return [];
}

/**
 * C11 — ADMISSIBILIDADE classificada como negativa de mérito.
 * Não-conhecimento que chegou com `resultado = "Indeferido"` e sem `juizo` contamina a taxa de
 * deferimento com prazo processual.
 */
export function checarAdmissibilidadeMalClassificada(input: {
  juizo: string | null | undefined;
  resultado: string | null | undefined;
  texto: string;
}): Achado[] {
  const naoConheceu = /\bn[ãa]o\s+(?:se\s+)?conhec(?:er|e|eu|ido|imento)\b/i.test(input.texto);
  if (naoConheceu && input.juizo !== "admissibilidade" && input.resultado === "Indeferido") {
    return [{
      codigo: "C11_ADMISSIBILIDADE_COMO_MERITO",
      nivel: "aviso",
      mensagem: "O texto indica NÃO CONHECIMENTO mas o registro está como Indeferido de mérito — "
        + "a taxa de deferimento passaria a medir prazo processual junto com jurisprudência.",
    }];
  }
  return [];
}

/**
 * C13 — LIGADURA residual: o conserto ancorado em vocabulário deixou lema quebrado.
 * Sinal de que a fonte embutida do PDF mudou e o parser está lendo palavras erradas em silêncio.
 */
export function checarLigaduraResidual(lemasQuebrados: string[]): Achado[] {
  if (lemasQuebrados.length === 0) return [];
  return [{
    codigo: "C13_LIGADURA_RESIDUAL",
    nivel: "aviso",
    mensagem: `Lema(s) com ligadura não reparada: ${lemasQuebrados.join(", ")}. A fonte embutida do `
      + "PDF provavelmente mudou — roster, retirada de pauta e cargo exercido podem estar ilegíveis.",
  }];
}

/**
 * C16 — IMPEDIMENTO com guard de negação.
 * Impedido que ainda aparece com voto proferido é contradição: ou o impedimento foi lido de uma
 * frase que o AFASTAVA ("não havia impedimento"), ou o voto foi fabricado.
 */
export function checarImpedidoComVoto(input: {
  impedidos: string[];
  diretoresQueVotaram: string[];
}): Achado[] {
  const conflito = input.impedidos.filter((n) => input.diretoresQueVotaram.includes(n));
  if (conflito.length === 0) return [];
  return [{
    codigo: "C16_IMPEDIDO_COM_VOTO",
    nivel: "bloqueante",
    mensagem: `Declarado(s) impedido(s) mas com voto registrado: ${conflito.join(", ")}. `
      + 'Ou a frase lida era "não havia impedimento", ou o voto foi fabricado.',
  }];
}

/** Há algum achado que RECUSA o confirm? */
export function temBloqueio(achados: Achado[]): boolean {
  return achados.some((a) => a.nivel === "bloqueante");
}

/**
 * Mensagens em uma linha para o revisor.
 *
 * ⚠️ GUARD OBRIGATÓRIO: nenhum texto daqui pode casar `INFO_WARNING_RE` (upload-analysis), senão o
 * achado é classificado como informativo e deixa de rebaixar o status — um bloqueio que não
 * bloqueia. O teste `etapa63` trava isso.
 */
export function formatarAchados(achados: Achado[]): string[] {
  return achados.map((a) => `[${a.nivel.toUpperCase()}·${a.codigo}] ${a.mensagem}`);
}
