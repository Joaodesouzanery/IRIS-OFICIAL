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
 * C21 — SINAL DE DELIBERAÇÃO (Fase 13).
 *
 * Produção gravou manuais do site institucional da ANM como `deliberacao` e os contou como
 * decisão final ("manual-de-sistema-dipem" com interessado "desejada para cadastrar os
 * colaboradores."). É o falso positivo da reordenação do classifyLinkType — do lado que a
 * certificação NÃO protege (ela valida extração, não quantos documentos entram).
 *
 * A regra, especificada pelo usuário: deliberação sem numero_deliberacao, sem processo, sem
 * relator, sem numero_reuniao e sem itens de ata NÃO é deliberação. Uma decisão colegiada real
 * sempre carrega ao menos UM desses sinais (as 46 expectativas do gabarito confirmam).
 *
 * Só se aplica ao rótulo "deliberacao": ata/pauta/voto_individual têm regras próprias.
 */
export function checarSinalDeDeliberacao(input: {
  tipoDocumento: string | null | undefined;
  numeroDeliberacao?: unknown;
  processo?: unknown;
  relator?: unknown;
  numeroReuniao?: unknown;
  ataItemsCount?: number;
}): Achado[] {
  if (input.tipoDocumento !== "deliberacao") return [];
  const temSinal = Boolean(input.numeroDeliberacao) || Boolean(input.processo)
    || Boolean(input.relator) || Boolean(input.numeroReuniao)
    || (typeof input.ataItemsCount === "number" && input.ataItemsCount > 0);
  if (temSinal) return [];
  return [{
    codigo: "C21_SEM_SINAL_DE_DELIBERACAO",
    nivel: "bloqueante",
    mensagem: "Classificado como deliberação, mas sem número, sem processo, sem relator, sem reunião e sem itens — provavelmente não é um documento de decisão (manual/página institucional).",
  }];
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

// ═══════════════════════════════════════════════════════════════════════════
// Etapa 65 — VALIDAÇÃO CRUZADA DE DATA
//
// `data_reuniao` é o que escolhe o roster em `getActiveDiretoresForVote`. Data errada não perde
// voto: ela infere voto para os DIRETORES ERRADOS, com aparência total de normalidade. Foi o pior
// defeito da rodada anterior (ata de 25/03/2026 lida como 02/05/2022), e a única validação que
// existia era uma janela `2020-01-01 .. hoje+60d` — larga demais para pegá-lo.
//
// Duas checagens independentes, ambas PURAS (rodam com `db: null`, logo são exercitáveis contra as
// 16 fixtures antes de ligar o nível bloqueante — a lição do C03 aplicada de saída).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Anos de protocolo citados no TEXTO. Dois formatos medidos no corpus:
 *   ANM/ANTT `48051.003447/2026-17`   (bloco central de 6 dígitos)
 *   ARTESP   `134.00000123/2023-45`   (bloco central de 8 dígitos)
 * O ano fica sempre logo após a barra nas três agências.
 *
 * ⚠️ Tem de varrer o TEXTO, não o campo `processo` já extraído: aquele é o PRIMEIRO match e
 * diverge do ano da reunião em até 6 anos (a 79ª tem campo 2019 e reunião em 2025).
 */
export function anosDeProcessoNoTexto(text: string): number[] {
  const anos = new Set<number>();
  const re = /\b\d{3,5}\.\d{6,8}\/((?:19|20)\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) anos.add(Number(m[1]));
  return [...anos].sort((a, b) => a - b);
}

/**
 * C17 — a reunião não pode ser ANTERIOR ao processo mais novo que ela julga.
 *
 * ⚠️ A regra é ASSIMÉTRICA, e isso foi MEDIDO. A versão simétrica ("divergiu mais de ~1 ano do
 * protocolo, é erro") daria falso positivo: o número do processo codifica quando ele foi ABERTO, e
 * processo minerário leva décadas — as atas da ANM misturam protocolos de 1935 a 2026, e a
 * `artesp-delib-22` sozinha tem delta +3. Seria o mesmo "8 de 8 atas recusadas" do C03.
 *
 * A direção POSTERIOR é livre; a ANTERIOR é impossível: não se decide um processo antes de ele
 * existir. Medido: `ano(data_reuniao) ≥ MAX(anos no texto)` vale em 16/16 fixtures, sem exceção.
 * O bug de 2022 cai nessa regra sozinho, sem depender do parser de data.
 */
export function checarDataAnteriorAoProcesso(input: {
  dataReuniao: string | null | undefined;
  texto: string;
}): Achado[] {
  const ano = Number(String(input.dataReuniao ?? "").slice(0, 4));
  if (!Number.isFinite(ano) || ano < 1900) return [];
  const anos = anosDeProcessoNoTexto(input.texto);
  if (anos.length === 0) return [];
  const maisNovo = anos[anos.length - 1];
  if (ano >= maisNovo) return [];
  return [{
    codigo: "C17_DATA_ANTERIOR_AO_PROCESSO",
    nivel: "bloqueante",
    mensagem: `Reunião datada de ${input.dataReuniao} julga processo protocolado em ${maisNovo} — `
      + "não se decide um processo antes de ele existir. A data provavelmente foi lida do CORPO do "
      + "documento em vez do cabeçalho, e com ela o roster de diretores sai errado.",
  }];
}

/**
 * C18 — o ano do protocolo da PRÓPRIA ata tem de bater com o ano da reunião.
 *
 * Sinal mais forte que o C17: não é um limite, é uma IGUALDADE. ANM e ANTT carimbam o protocolo do
 * próprio documento no rodapé SEI ("… SEI 48051.003447/2026-17 / pg. 1"), e medido pelo caminho
 * real de análise o ano bate em 9/9 das fixtures que têm o rodapé. A ARTESP não o tem — ali o
 * check fica silencioso em vez de inventar base.
 */
export function checarAnoProtocoloDaAta(input: {
  dataReuniao: string | null | undefined;
  protocoloSei: string | null | undefined;
}): Achado[] {
  const proto = input.protocoloSei;
  if (!proto) return [];
  const mAno = /\/((?:19|20)\d{2})-\d{2}$/.exec(proto);
  if (!mAno) return [];
  const anoProto = Number(mAno[1]);
  const anoReuniao = Number(String(input.dataReuniao ?? "").slice(0, 4));
  if (!Number.isFinite(anoReuniao) || anoReuniao < 1900) return [];
  if (anoProto === anoReuniao) return [];
  return [{
    codigo: "C18_ANO_PROTOCOLO_DIVERGE",
    nivel: "bloqueante",
    mensagem: `O documento é o processo SEI ${proto} (${anoProto}), mas a reunião foi lida como `
      + `${input.dataReuniao} (${anoReuniao}). O protocolo é do PRÓPRIO documento — a data extraída `
      + "está errada, e com ela o roster de diretores.",
  }];
}

// ═══════════════════════════════════════════════════════════════════════════
// Etapa 66 — MONOTONICIDADE DA SÉRIE
//
// Dentro da MESMA série, número maior não pode ter data anterior: a 83ª ROP não vem antes da 81ª.
// É o terceiro sinal independente sobre `data_reuniao`, ao lado do C17 (ano do processo) e do C18
// (protocolo da própria ata) — e o único que enxerga o documento no CONTEXTO dos vizinhos.
//
// ⚠️ Por que "série" e não `tipo_reuniao`: os contadores são INDEPENDENTES por série. Medido no
// corpus — a 1.024ª Reunião de Diretoria e a 264ª Reunião Deliberativa Eletrônica da ANTT
// compartilham a data 2026-01-19. Comparar sem separar a série dá alarme falso imediato, e
// `tipo_reuniao` colapsa as duas em "Ordinaria" (enum de duas cardinalidades). Ver `deriveSerie`.
//
// ⚠️ NÍVEL: **aviso**, não bloqueante — e isto é desvio deliberado do plano.
// A disciplina desta série exige provar ZERO falso positivo contra dado real ANTES de bloquear
// (a lição do C03, que recusava 8 de 8 atas). Aqui isso é impossível: as 16 fixtures são
// documentos ISOLADOS, sem vizinhos de série, e não tenho produção para medir. Remarcação de
// reunião e publicação fora de ordem são hipóteses plausíveis que não consigo descartar.
// Vira bloqueante quando alguém rodar contra a base e mostrar o número.
// ═══════════════════════════════════════════════════════════════════════════

/** Uma reunião vizinha, da MESMA agência e série. */
export interface ReuniaoVizinha {
  numeroReuniao: string | null;
  dataReuniao: string | null;
}

/**
 * C19 — a ordem dos NÚMEROS tem de concordar com a ordem das DATAS, dentro da série.
 *
 * Função PURA: quem busca as vizinhas é o caller (o confirm, onde há `db`). Isso é melhor que
 * receber o `db`: um check que só roda com banco fica inerte e silencioso no harness — foi
 * exatamente assim que o C16 entrou incapaz de disparar.
 */
export function checarSerieMonotonica(input: {
  numeroReuniao: string | null | undefined;
  dataReuniao: string | null | undefined;
  serie: string | null | undefined;
  vizinhas: ReuniaoVizinha[];
}): Achado[] {
  const ordinal = ordinalDe(input.numeroReuniao);
  const data = input.dataReuniao ?? null;
  if (ordinal === null || !data) return [];

  const conflitos: string[] = [];
  for (const v of input.vizinhas) {
    const vOrd = ordinalDe(v.numeroReuniao);
    if (vOrd === null || !v.dataReuniao || vOrd === ordinal) continue;
    const maior = ordinal > vOrd;
    // Número maior com data ANTERIOR (ou o inverso) quebra a monotonicidade da série.
    if (maior ? data < v.dataReuniao : data > v.dataReuniao) {
      conflitos.push(`${v.numeroReuniao} em ${v.dataReuniao}`);
    }
  }
  if (conflitos.length === 0) return [];

  return [{
    codigo: "C19_SERIE_NAO_MONOTONICA",
    nivel: "aviso",
    mensagem: `Reunião ${input.numeroReuniao} datada de ${data} conflita com a ordem da série `
      + `${input.serie ?? "(sem série)"}: ${conflitos.slice(0, 3).join("; ")}`
      + `${conflitos.length > 3 ? ` e mais ${conflitos.length - 3}` : ""}. `
      + "Número maior não deveria ter data anterior — conferir a data extraída antes de confirmar.",
  }];
}

/** Número da reunião como inteiro. "1.024" e "1024" valem 1024; o resto é ignorado. */
function ordinalDe(numero: string | null | undefined): number | null {
  if (!numero) return null;
  const limpo = String(numero).replace(/[.\s]/g, "");
  return /^\d+$/.test(limpo) ? Number(limpo) : null;
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
