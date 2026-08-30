/**
 * nlp-extractor.ts
 * Extrai campos estruturados de texto de deliberações usando regex + varredura linha a linha.
 * Estratégia de dois estágios por campo:
 *   1. Regex globais cobrindo múltiplos rótulos e formatos
 *   2. Varredura linha a linha (extractLabeledFields) como segunda tentativa
 *
 * Suporta múltiplas agências:
 *   - ARTESP: Deliberações com verbos decisórios (RATIFICA, APROVA, etc.)
 *   - ANM: Atas de reunião com múltiplos items (split via ata-splitter.ts)
 *   - Genérico: DEFERIDO/INDEFERIDO de outras agências
 * Mantém retrocompatibilidade com padrão DEFERIDO/INDEFERIDO de outras agências.
 */

import { parseDataExtensoANM, RE_RETIRADA } from "./ata-splitter";
import { isRoleWordOnly, isLikelyPersonName, isStrictPersonName } from "./name-matcher";
import { flattenForMatch } from "./pdf-extractor";
import { detectJuizo } from "./regulatory-documents";

// ─── Regex patterns ────────────────────────────────────────────────────────
// Nome completo aceitando PREPOSIÇÕES internas (de/da/do/dos/das/e) entre tokens
// capitalizados — definido no topo para ser reusado pelos padrões de voto/ausência.
const NOME = "[A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][a-záéíóúâêôãõçàü]+(?:\\s+(?:d[aeo]s?|e|[A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][a-záéíóúâêôãõçàü]+)){1,5}";
// Traços/hífens usados como separador de voto em PDFs (hífen, en/em-dash, figure/horizontal bar).
// O hífen literal vem primeiro na classe para não ser interpretado como range.
const DASHES = "[-–—‒―]";

const RE_DELIBERACAO = /DELIBERA[ÇC][AÃ]O\s*N[ºo°]?\s*([\d\.]+)/gi;
const RE_REUNIAO     = /(\d{3,4})[ªa°º]?\s*(?:Reuni[aã]o\s*)?(?:Ordin[aá]ria|Extraordin[aá]ria)/gi;

// Processo: SEI, PA, Processo Adm., Proc. nº, Autos nº, Procedimento nº
// `Processos?` no PLURAL: a ANM escreve "PROCESSOS Nº: X; Y; Z" quando um item deliberado agrupa
// vários processos — medido na 79ª ROP, item 1.3.1, com 44 números num bloco só. Sem o plural o
// campo saía NULL, e `processo` null quebra o dedupe de item no confirm.
const RE_PROCESSO = /(?:SEI[!]?\s*n[ºo°]?|Processos?\s*(?:SEI\s*)?n[ºo°]?|PA\s*n[ºo°]?|Proc(?:esso)?\s*(?:Adm(?:inistrativo)?\s*)?n[ºo°]?|Procedimento\s*n[ºo°]?|Autos?\s*n[ºo°]?)\s*:?\s*([\d\.\/\-]+)/gi;

// Interessado: 13 rótulos cobrindo terminologia de todas as agências reguladoras
// `Interessados:` no plural, mesma razão.
const RE_INTERESSADO = /(?:Interessad[ao]s?[:\s]+|Requerente[:\s]+|Empresa[:\s]+|Solicitante[:\s]+|Demandante[:\s]+|Concession[aá]ri[ao][:\s]+|Permission[aá]ri[ao][:\s]+|Peticion[aá]rio[:\s]+|Proponente[:\s]+|Benefici[aá]ri[ao][:\s]+|Outorgad[ao][:\s]+|Postulante[:\s]+|Requerida[:\s]+)([^\n]{3,200})/gi;

const RE_ASSUNTO     = /Assunto[:\s]+([^\n]{3,300})/gi;
const RE_PROCEDENCIA = /Proced[eê]ncia[:\s]+([^\n]{3,150})/gi;

// Captura verbos de decisão reais das deliberações brasileiras.
// Inclui verbos extras: HOMOLOGA, ARQUIVA, ANULA, REVOGA, CANCELA, PREJUDICA.
// Prioridade de normalização definida em normalizeResultado().
// Cobre PRESENTE (INDEFERE/DEFERE/APROVA — dispositivo ARTESP "INDEFERE o pleito"),
// PARTICÍPIO (INDEFERIDO/APROVADO), PRETÉRITO (INDEFERIU/APROVOU) e INFINITIVO
// (APROVAR/AUTORIZAR — dispositivo ANTT "VOTO por Aprovar"). As formas -AR usam
// `(?:DO|R)?` para casar presente/particípio/infinitivo de uma vez. O presente dos
// verbos -IR (INDEFERE/DEFERE) precisa ser explícito — sua ausência fazia todo
// INDEFERE-por-unanimidade cair no fallback e virar "Aprovado por Unanimidade" (bug).
// `NEGA*`/`IMPROVID*`/`PROVID*` entram na etapa54: sem eles, um dispositivo "NEGA-LHE provimento"
// não casava NADA e caía no fallback de unanimidade, virando resultado POSITIVO — inversão total.
const RE_RESULTADO = /\b(INDEFERID[OA]|INDEFERIMENTO|INDEFERIU|INDEFERE|INDEFERIR|PARCIALMENTE\s*DEFERID[OA]|DEFERID[OA]|DEFERIMENTO|DEFERIU|DEFERE|DEFERIR|NEGAR|NEGA(?:-LHE)?|NEGOU|NEGARAM|IMPROVID[OA]S?|DESPROVID[OA]S?|PROVID[OA]S?|RETIRAD[OA]S?\s*(?:D[AEO]\s*)?(?:PAUTA|REUNI[ÃA]O|SESS[ÃA]O|JULGAMENTO|DELIBERA[ÇC][ÃA]O|ORDEM\s+DO\s+DIA)|RATIFICA(?:D[OA]|R)?|RATIFICOU|APROVA(?:D[OA]|R)?(?:\s*COM\s*RESSALVAS)?|APROVOU|RECOMENDA(?:D[OA]|R)?|RECOMENDOU|DETERMINA(?:D[OA]|R)?|DETERMINOU|AUTORIZA(?:D[OA]|R)?|AUTORIZOU|HOMOLOGA(?:D[OA]|R)?|HOMOLOGOU|ARQUIVA(?:D[OA]|R)?|ARQUIVOU|ANULA(?:D[OA]|R)?|ANULOU|REVOGA(?:D[OA]|R)?|REVOGOU|CANCELA(?:D[OA]|R)?|CANCELOU|PREJUDICA(?:D[OA]|R)?)(?![çÇ])\b/gi;

// Fórmula RITUAL da ARTESP — aparece em TODA deliberação, decida ela o que decidir: "Fica
// RATIFICADA toda a instrução processual e DETERMINADA a adoção das medidas pertinentes".
// Não é dispositivo, é fecho de estilo. Enquanto entrava no escopo de resultado, "Ratificado"
// vencia por prioridade um "Indeferido" REAL — a deliberação que INDEFERE era gravada como
// Ratificada. Removida SÓ do escopo de RESULTADO: `raw_text` e `fundamento_decisao` seguem íntegros.
const RE_ARTESP_FORMULA_RITUAL =
  /Fica[m]?\s+RATIFICAD[AO]S?\s+tod[ao]s?\s+a?\s*instru[çc][ãa]o\s+processual[\s\S]{0,160}?medidas\s+pertinentes[^.]{0,80}\.?/gi;

// Direção NEGATIVA explícita. Bloqueia o fallback "unanimidade → Aprovado": um recurso ao qual o
// colegiado NEGA provimento POR UNANIMIDADE é unânime e NEGATIVO — o fallback o tornava positivo.
const RE_DIRECAO_NEGATIVA =
  /\b(?:NEGA(?:-LHE|R|M|RAM|NDO)?|NEGOU|INDEFER\w*|IMPROVID[OA]S?|DESPROVID[OA]S?|N[ÃA]O\s+PROVID[OA]S?|N[ÃA]O\s+(?:SE\s+)?CONHEC\w*)\b/i;

// Unanimidade — qualquer das frases comuns em deliberações brasileiras
// Alternativas simples sem quantificadores aninhados (evita ReDoS)
// SEM flag /g: é usada com .test() — com /g o lastIndex persiste entre chamadas e
// documentos processados em sequência davam falso negativo (bug pego pelo corpus real).
const RE_UNANIMIDADE = /(?:por\s+unanimidade\s+dos?\s+votos?|por\s+unanimidade\s+dos?\s+presentes?|por\s+unanimidade|unanimidade\s+dos?\s+votos?|unanimidade\s+dos?\s+presentes?|aprovad[oa]\s+por\s+unanimidade)/i;

// Nega unanimidade: "não foi aprovado por unanimidade", "não houve unanimidade", "sem unanimidade".
// Janela curta ({0,3} palavras entre "não" e "unanimidade") p/ não capturar um "não" distante. Sem a
// guarda, "não ... por unanimidade" disparava default-favor/inferência de aprovação (falso). F5.
// Lookahead `(?!obstante)` exclui o concessivo "não obstante a unanimidade" (que AFIRMA a unanimidade).
const RE_UNANIMIDADE_NEGADA = /\bn[aã]o\s+(?!obstante\b)(?:\S+\s+){0,3}unanimidade|\bsem\s+unanimidade/i;
export function hasUnanimidade(text: string): boolean {
  return RE_UNANIMIDADE.test(text) && !RE_UNANIMIDADE_NEGADA.test(text);
}

// Voto dissidente / divergente — extrai o nome do diretor que votou contra.
// Cobre "voto divergente/dissidente/contrário/vencido do Diretor X" e "(restando) vencido o Diretor X".
// SEM flag 'i' (QA ago/2026): o 'i' anulava a Capitalização do macro NOME.
const RE_VOTO_DISSIDENTE = new RegExp(
  `(?:[Vv]enci[dn][oa](?:\\(a\\))?\\s+(?:[oa]\\s+)?(?:[Dd]iretor[a]?\\s+|[Cc]onselheiro[a]?\\s+)?` +
  `|(?:[Cc]om\\s+o\\s+|[Pp]elo\\s+)?[Vv]oto\\s+(?:dissidente|divergente|contr[aá]ri[ao]|vencido)\\s+d[oa]\\s+(?:[Dd]iretor[a]?\\s+|[Cc]onselheiro[a]?\\s+)?)(${NOME})`,
  "g",
);
// ALVO da divergência que vira VOTO (etapa51): tem de ser um membro do COLEGIADO.
// Medido nas duas atas ANM: as 4 ocorrências verbais de "divergir/divergindo" divergem de
// manifestação técnica, do posicionamento da Procuradoria ou de um Voto CS — nenhuma de um colega.
// Sem objeto obrigatório, cada uma viraria um "Desfavoravel" fabricado: o diretor que discordou da
// ÁREA TÉCNICA e teve o voto APROVADO POR UNANIMIDADE apareceria como dissidente do colegiado.
const ALVO_DIVERGENCIA_COLEGIADO =
  "(?:[Rr]elator[a]?|[Rr]evisor[a]?|[Dd]iretor[a]?(?:[-\\s]Geral)?|[Cc]onselheir[oa]|[Vv]oto\\s+d[oa]\\s+[Rr]e(?:lator|visor))";

// Forma verbal: "o Diretor X votou contrariamente/de forma divergente", "X divergiu/discordou".
// SEM flag 'i' (QA ago/2026): com 'i' o macro NOME vira case-insensitive e casa prosa
// minúscula ("os seguintes pontos") — literais com [Dd] explícito, padrão do RE_VOTO_AUSENTE.
// "votou contrariamente/de forma divergente" é inequívoco e dispensa objeto; "divergiu/discordou"
// EXIGE o objeto do colegiado (vide ALVO_DIVERGENCIA_COLEGIADO).
const RE_VOTO_DISSIDENTE_VERBAL = new RegExp(
  // `\.?` tolera a abreviação de sufixo ("Tasso Mendonça Jr. divergiu do Relator"), onipresente
  // nas atas ANM — sem ela o ponto separava o nome do verbo e o dissenso se perdia.
  `(?:[Dd]iretor[a]?\\s+|[Cc]onselheiro[a]?\\s+)?(${NOME})\\.?\\s+(?:` +
    `votou\\s+(?:de\\s+forma\\s+)?(?:contr[aá]ri[ao]|contrariamente|dissidente|divergente)` +
    `|(?:divergiu|discordou)\\s+d[oa]\\s+${ALVO_DIVERGENCIA_COLEGIADO}` +
  `)`,
  "g",
);
// Voto contrário citado só pelo CARGO: "DELIBERAÇÃO: Voto do revisor aprovado por maioria pelos
// diretores presentes, com voto contrário do Diretor-Geral, relator original da matéria" (32ª REP).
// O nome não aparece na linha. Sem resolver o cargo pelo preâmbulo, essa divergência REAL some — e
// como "por maioria" casa RE_CONTESTADO, o item ainda esvazia o pool: perde-se o item inteiro.
// Medido: 1 ocorrência na 32ª, 0 nas demais fixtures.
const RE_VOTO_CONTRARIO_CARGO = new RegExp(
  `(?:[Vv]enci[dn][oa](?:\\(a\\))?\\s+(?:[oa]\\s+)?` +
  `|(?:[Cc]om\\s+o\\s+|[Pp]elo\\s+)?[Vv]oto\\s+(?:dissidente|divergente|contr[aá]ri[ao]|vencido)\\s+d[oa]\\s+)` +
  `(Diretor[-\\s]Geral(?:\\s+Substitut[oa])?)(?![A-Za-zÀ-ÿ])`,
  "g",
);
// Divergência NOMEADA — padrão dominante das atas ANM: "aprovado por maioria ... COM DIVERGÊNCIA
// APRESENTADA PELO Diretor X" (substantivo "divergência" + "pelo", que RE_VOTO_DISSIDENTE não casa).
// Captura o rótulo a partir de "Diretor…" de forma LIMITADA (lazy) até uma fronteira de prosa
// (em/quanto/que/…) ou pontuação — evita agarrar "…pelo Diretor-Geral EM RELAÇÃO ao não…" como nome
// (backtracking traiçoeiro do macro NOME). O pós-processamento separa cargo puro de nome inline.
const RE_VOTO_DIVERGENCIA_NOMEADA = new RegExp(
  `diverg[êe]ncia\\s+(?:parcial\\s+)?(?:apresentada|manifestada|suscitada)\\s+pel[oa]\\s+` +
    `((?:Diretor|Diretora|Conselheir[oa]|Relator[a]?|Revisor[a]?)[A-Za-zÀ-ÿ.'\\s-]{0,70}?)` +
    `(?=\\s+(?:em|quanto|que|no|na|ao|aos|à|às|acerca|sobre|com|por|apenas|somente|referente|relativ)\\b|[,.;:)]|$)`,
  "gi",
);
// Tokens de cargo a remover do início do rótulo capturado (o resto é o nome, se houver).
const RE_CARGO_PREFIXO = /^(?:(?:Diretor(?:[-\s](?:Geral|Presidente))?|Diretora|Conselheir[oa]|Relator[a]?|Revisor[a]?|Substitut[oa])[\s-]*)+/i;
// Diretor-Geral nomeado no preâmbulo: "presidida pelo Diretor-Geral, NOME". Resolve o cargo→nome
// para atribuir a divergência quando a ata só cita "pelo Diretor-Geral" (sem nome).
const RE_DG_PREAMBULO = new RegExp(
  `presidid[ao][\\s\\S]{0,40}?pel[oa]\\s+Diretor[-\\s]Geral,?\\s+(${NOME})`,
  "i",
);

/** Nome do Diretor-Geral pelo preâmbulo da ata (null se não achar). */
export function extractDiretorGeralName(text: string): string | null {
  const m = RE_DG_PREAMBULO.exec(text);
  if (!m) return null;
  const nome = m[1].replace(/\s+e\s+.*$/i, "").replace(/\s+/g, " ").trim();
  return nome && !isRoleWordOnly(nome) && nome.split(/\s+/).length >= 2 ? nome : null;
}

/** Mapa cargo→nome (hoje: Diretor-Geral) para resolver divergências citadas só por cargo. */
export function buildRoleMap(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  const dg = extractDiretorGeralName(text);
  if (dg) map["diretor-geral"] = dg;
  return map;
}

function normalizeRoleKey(role: string): string {
  return role.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, "-");
}

/** Nomes dos diretores que APRESENTARAM divergência (nome inline OU cargo resolvido pelo roleMap). */
export function extractDivergentesNomeados(text: string, roleMap: Record<string, string> = {}): string[] {
  const out: string[] = [];
  RE_VOTO_DIVERGENCIA_NOMEADA.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_VOTO_DIVERGENCIA_NOMEADA.exec(text)) !== null) {
    const rotulo = m[1].trim(); // ex.: "Diretor-Geral" ou "Diretor Revisor José Fernando de Mendonça…"
    // Remove os tokens de cargo do início; o que sobrar é o nome inline (se houver).
    const nome = rotulo.replace(RE_CARGO_PREFIXO, "").replace(/\s+/g, " ").trim();
    if (nome && !isRoleWordOnly(nome) && nome.split(/\s+/).length >= 2) {
      if (!out.includes(nome)) out.push(nome);
      continue;
    }
    // Só o cargo → resolve pelo preâmbulo ("Diretor-Geral" é o único mapeado hoje).
    const key = normalizeRoleKey(rotulo);
    const resolved = roleMap[key] ?? (key.startsWith("diretor-geral") ? roleMap["diretor-geral"] : undefined);
    if (resolved && !out.includes(resolved)) out.push(resolved);
  }
  return out;
}

// ─── Voto em AUTOS (etapa57) ──────────────────────────────────────────────
// Voto proferido em sessão ANTERIOR e apenas REGISTRADO nesta ata. Não é presença: o diretor não
// estava lá. Medido nas duas atas ANM:
//   82ª — "já havia sido proferido o voto do relator original, Diretor Caio Mário Trivellato
//         Seabra Filho, acompanhado pelo ENTÃO Diretor Guilherme Santana Lopes Gomes"
//   32ª — "antecipação de voto realizada pelo Diretor Luiz Paniago Neves na 73ª Reunião Ordinária"
// Sem distinguir isso, o voto entra na série temporal do diretor na data ERRADA, conta como
// presença numa sessão em que ele não esteve, e dispara o alarme de "voto fora do mandato" em
// toda ata com voto vista — ruído que treina o revisor a ignorar o alarme.
// SEM a flag `i` — vide RE_VOTO_AUSENTE: com ela o macro NOME vira case-insensitive, casa prosa
// minúscula e o nome capturado é rejeitado depois por isStrictPersonName, perdendo o caso real.
const RE_AUTOS_JA_PROFERIDO = new RegExp(
  `[Jj][áa]\\s+havia\\s+sido\\s+proferido\\s+o\\s+voto\\s+d[oa]\\s+relator[^,]{0,30},\\s*(?:[Dd]iretor[a]?(?:[-\\s]Geral)?\\s+)?(${NOME})`,
  "g",
);
// "então Diretor X" — ex-diretor cujo voto está sendo apenas registrado.
const RE_AUTOS_ENTAO_DIRETOR = new RegExp(
  `ent[ãa]o\\s+[Dd]iretor[a]?(?:[-\\s](?:Geral|Substitut[oa]))?\\s+(${NOME})`,
  "g",
);
const RE_AUTOS_ANTECIPACAO = new RegExp(
  `[Aa]ntecip(?:a[çc][ãa]o|ou|ado)[^.]{0,80}?pel[oa]\\s+[Dd]iretor[a]?(?:[-\\s]Geral)?\\s+(${NOME})`,
  "g",
);
const RE_AUTOS_ADESAO_ANTERIOR = new RegExp(
  `ader(?:iu|iram)\\s+ao\\s+voto[^.]{0,80}?por\\s+ocasi[ãa]o\\s+d[ao]\\s+\\d+`,
  "i",
);
// A sessão em que o voto foi proferido, quando o texto a nomeia.
const RE_SESSAO_DO_VOTO = /(?:n[ao]|por\s+ocasi[ãa]o\s+d[ao])\s+(\d+[ªa°º]\s*Reuni[ãa]o[^,.;]{0,45})/i;
// GUARD: "aderiram ao voto vista apresentado pelo Diretor-Geral NA PRESENTE SESSÃO" (32ª) é voto
// da própria sessão — o oposto de voto em autos.
const RE_PRESENTE_SESSAO = /n[ao]\s+presente\s+sess[ãa]o|nesta\s+sess[ãa]o|na\s+presente\s+reuni[ãa]o/i;

export interface VotoEmAutos {
  nome: string;
  /** Sessão em que o voto foi efetivamente proferido, quando o documento a nomeia. */
  sessao: string | null;
}

/** Diretores cujo voto foi proferido em sessão ANTERIOR e só registrado neste documento. */
export function extractVotosEmAutos(text: string): VotoEmAutos[] {
  const flat = flattenForMatch(text);
  const out: VotoEmAutos[] = [];
  const push = (nomeRaw: string, janela: string) => {
    const nome = nomeRaw.replace(/\s+/g, " ").trim();
    if (nome.length <= 4 || !isStrictPersonName(nome)) return;
    if (out.some((v) => v.nome === nome)) return;
    const sessao = RE_PRESENTE_SESSAO.test(janela) ? null : RE_SESSAO_DO_VOTO.exec(janela)?.[1]?.trim() ?? null;
    out.push({ nome, sessao });
  };

  for (const re of [RE_AUTOS_JA_PROFERIDO, RE_AUTOS_ENTAO_DIRETOR, RE_AUTOS_ANTECIPACAO]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(flat)) !== null) {
      // Janela ao redor do casamento para achar a sessão citada e o guard de "presente sessão".
      const janela = flat.slice(Math.max(0, m.index - 120), m.index + m[0].length + 160);
      if (RE_PRESENTE_SESSAO.test(flat.slice(m.index, m.index + m[0].length + 60))) continue;
      push(m[1] ?? "", janela);
    }
  }
  return out;
}

/** O documento registra adesão a voto proferido em sessão anterior (sem nomear o aderente). */
export function hasAdesaoVotoAnterior(text: string): boolean {
  return RE_AUTOS_ADESAO_ANTERIOR.test(flattenForMatch(text));
}

// AUTOR e FUNDAMENTO da retirada (etapa56). "Processo retirado de pauta pelo Diretor X, nos termos
// do art. 55 do Regimento Interno": saber QUEM retirou e COM QUE BASE é o que separa uma retirada
// regimental de uma retirada sem justificativa — e hoje nada disso era guardado.
const RE_RETIRADA_AUTOR = new RegExp(
  `(?:${RE_RETIRADA.source})[^.]{0,140}?\\bpel[oa]\\s+(?:[Dd]iretor[a]?(?:[-\\s](?:Geral|Substitut[oa]))?\\s+|[Cc]onselheir[oa]\\s+|[Rr]elator[a]?\\s+)(${NOME})`,
  "i",
);
const RE_RETIRADA_FUNDAMENTO =
  /\bart(?:igo)?\.?\s*(\d+)(?:\s*,?\s*[^.]{0,40}?)?\bd[oa]\s+Regimento\s+Interno/i;

export interface RetiradaInfo {
  autor: string | null;
  fundamento: string | null;
}

/** Autor e fundamento da retirada de pauta/reunião (null quando não há retirada no trecho). */
export function extractRetirada(text: string): RetiradaInfo | null {
  const flat = flattenForMatch(text);
  if (!RE_RETIRADA.test(flat)) return null;
  const autorRaw = RE_RETIRADA_AUTOR.exec(flat)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
  const autor = autorRaw && isStrictPersonName(autorRaw) ? autorRaw : null;
  const artigo = RE_RETIRADA_FUNDAMENTO.exec(flat)?.[1] ?? null;
  return { autor, fundamento: artigo ? `art. ${artigo} do Regimento Interno` : null };
}

/**
 * Nomes de diretores com VOTO CONTRÁRIO citado apenas pelo CARGO, resolvidos pelo preâmbulo.
 * Só resolve o que o roleMap conhece: cargo sem nome no documento não vira voto (seria adivinhar
 * quem exercia a função). Mesma disciplina de `extractDivergentesNomeados`.
 */
export function extractContrariosPorCargo(text: string, roleMap: Record<string, string> = {}): string[] {
  const out: string[] = [];
  RE_VOTO_CONTRARIO_CARGO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_VOTO_CONTRARIO_CARGO.exec(text)) !== null) {
    const key = normalizeRoleKey(m[1]);
    const resolved = roleMap[key] ?? (key.startsWith("diretor-geral") ? roleMap["diretor-geral"] : undefined);
    if (resolved && !out.includes(resolved)) out.push(resolved);
  }
  return out;
}

// ─── Autor do voto APROVADO (etapa65) ─────────────────────────────────────────────────────
// Na ANM, "divergente" qualifica divergência DO RELATOR — e essa posição frequentemente é a que
// VENCE. As regexes de dissenso tratam `divergente|dissidente|contrário|vencido` como sinônimos, e
// por isso gravavam voto CONTRÁRIO para quem ganhou. É o pior erro possível nesta base: inverte o
// sinal do diretor no painel inteiro. Dois casos medidos, com o dispositivo literal:
//   79ª/2.2.1 — "teve divergência apresentada pelo Diretor-Geral […] este foi APROVADO por maioria"
//   83ª       — "o voto divergente do Diretor-Geral […] Voto do Revisor, Diretor-Geral, APROVADO"
// Medido nas 16 fixtures: o dispositivo credita o voto aprovado por um padrão único — "Voto do
// <RÓTULO> … aprovado" — presente nas 6 atas da ANM (22 ocorrências) e em nenhuma ARTESP/ANTT. O
// rótulo é um cargo ("Relator", "Revisor", "Diretor-Geral"), um nome, ou os dois.
const RE_AUTOR_VOTO_APROVADO = /[Vv]oto\s+d[oa]\s+([^.;]{0,90}?)\baprovad[oa]\b/g;

/**
 * Nomes que o DISPOSITIVO credita como autores do voto APROVADO. Quem venceu não é dissidente.
 * Mesma disciplina dos outros resolvedores: cargo só vira nome quando o preâmbulo o nomeia —
 * cargo sem nome no documento não vira voto nem exclusão.
 */
export function extractAutoresDoVotoAprovado(text: string, roleMap: Record<string, string> = {}): string[] {
  const out: string[] = [];
  RE_AUTOR_VOTO_APROVADO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_AUTOR_VOTO_APROVADO.exec(text)) !== null) {
    const span = m[1].replace(/\s+/g, " ").trim();
    // "voto do relator NÃO foi aprovado" não credita ninguém.
    if (/\bn[ãa]o\b/i.test(span)) continue;
    // (a) nome inline: "Voto do Relator, Diretor Caio Mário Trivellato Seabra Filho, aprovado".
    RE_ROSTER_DIRETOR.lastIndex = 0;
    let nm: RegExpExecArray | null;
    while ((nm = RE_ROSTER_DIRETOR.exec(span)) !== null) {
      const nome = nm[1].replace(/\s+/g, " ").trim();
      if (isStrictPersonName(nome) && !out.includes(nome)) out.push(nome);
    }
    // (b) cargo resolvido pelo preâmbulo: "Voto do Revisor, Diretor-Geral, aprovado".
    if (/Diretor[-\s]Geral/i.test(span)) {
      const dg = roleMap["diretor-geral"];
      if (dg && !out.includes(dg)) out.push(dg);
    }
  }
  return out;
}

/**
 * O item declara dissenso (maioria/vencido/divergência) mas NENHUM dissidente foi atribuído.
 * Não vira voto — vira AVISO, para o revisor humano decidir. É o caso do "voto por divergir"
 * sem sujeito e da "terceira via": há divergência no texto, mas não há a quem imputá-la.
 */
export function detectDivergenciaNaoAtribuida(text: string, contraCount: number): string | null {
  if (contraCount > 0) return null;
  if (!RE_CONTESTADO.test(text) && !/\bdivergi(?:r|ndo|u|ram)\b/i.test(text)) return null;
  return "Divergência declarada no texto sem dissidente identificável — atribuir manualmente.";
}

// Marcadores de item CONTESTADO (maioria/empate/qualidade/divergência/vencido) — quando presentes e
// o dissidente NÃO pôde ser atribuído, é desonesto gravar todos como favoráveis (fabricaria
// unanimidade). O item vai para revisão em vez de inventar voto. Usado no ramo default-favor.
// (não inclui "vencid[oa]" isolado p/ evitar "prazo vencido"; só as formas ligadas a voto).
const RE_CONTESTADO = /\bpor\s+maioria\b|maioria\s+de\s+votos|voto\s+de\s+qualidade|voto\s+vencedor|voto\s+vencid[oa]|restando\s+vencid[oa]|\bprevaleceu\b|\bempate\b|diverg[êe]nci/i;

// ─── Voto de QUALIDADE (etapa62) ──────────────────────────────────────────
// "aprovado por maioria dos diretores presentes com cômputo do voto de qualidade proferido pelo
// Diretor-Geral" (79ª ROP, item 1.4.1, empate desempatado pelo DG).
//
// Este é o ÚNICO voto que a ata declara com CERTEZA — e era o único que o sistema apagava: o item
// casa RE_CONTESTADO ("voto de qualidade"), o pool era esvaziado inteiro e o item ia para revisão
// com ZERO voto. Esvaziar os demais está certo (não dá para saber quem votou o quê num empate);
// apagar justamente o voto NOMEADO é que não.
const RE_VOTO_QUALIDADE_NOME = new RegExp(
  `voto\\s+de\\s+qualidade[^.]{0,60}?pel[oa]\\s+(?:[Dd]iretor[a]?(?:[-\\s]Geral)?\\s+|[Pp]residente\\s+)(${NOME})`,
  "i",
);
const RE_VOTO_QUALIDADE_CARGO =
  /voto\s+de\s+qualidade[^.]{0,60}?pel[oa]\s+(Diretor[-\s]Geral|Presidente)(?![A-Za-zÀ-ÿ])/i;

/** Quem proferiu o voto de qualidade (nome inline ou cargo resolvido pelo preâmbulo). */
export function extractVotoQualidade(text: string, roleMap: Record<string, string> = {}): string | null {
  const flat = flattenForMatch(text);
  const inline = RE_VOTO_QUALIDADE_NOME.exec(flat)?.[1]?.replace(/\s+/g, " ").trim();
  if (inline && isStrictPersonName(inline)) return inline;
  const cargo = RE_VOTO_QUALIDADE_CARGO.exec(flat)?.[1];
  if (!cargo) return null;
  const key = normalizeRoleKey(cargo);
  return roleMap[key] ?? (key.startsWith("diretor-geral") ? roleMap["diretor-geral"] ?? null : null);
}

// ─── Datas ─────────────────────────────────────────────────────────────────
// Ausência: "ausente o Diretor X", "ausência do Diretor X", "X (esteve) ausente". Usa NOME (acentos OK).
// Dois grupos de captura (forma-prefixo OU forma-sufixo) — o consumidor usa aus[1] ?? aus[2].
// SEM flag 'i': com 'i', o NOME (classes maiúsculas/minúsculas) viraria case-insensitive
// e engoliria palavras minúsculas como "esteve" antes de "ausente". Os literais são
// casados explicitamente com [Aa]/[Dd]/[Oo].
const RE_VOTO_AUSENTE = new RegExp(
  `(?:[Aa]usente[:\\s]+(?:[Oo]\\s+|[Aa]\\s+)?(?:[Dd]iretor[a]?\\s+)?|[Aa]us[êe]ncia\\s+d[oa]\\s+(?:[Dd]iretor[a]?\\s+)?)(${NOME})` +
  `|(?:[Dd]iretor[a]?\\s+)?(${NOME})\\s+(?:esteve\\s+)?[Aa]usente`,
  "g",
);
// Fase 13 — o rótulo REAL das deliberações da ARTESP ("Ausência Justificada: Raquel França
// Carneiro - Diretora - Afastamento em Férias."): sem ele a diretora virava OMISSÃO — a mesma
// aparência de voto perdido. Exige o rótulo com ':' — "ausência de impugnações" em prosa não
// casa (a alternativa antiga de 'Ausência d[oa]' continua no RE_VOTO_AUSENTE).
const RE_AUSENTE_LABEL = /(?:Ausente[s]?|Aus[êe]ncia[s]?\s+Justificada[s]?):\s*([^\n.]{5,180})/gi;
// Abstenção narrativa: "Fulano absteve-se" / "Fulano se absteve" / "Fulano votou pela abstenção".
// SEM flag 'i' — vide RE_VOTO_AUSENTE (o 'i' anula a exigência de Capitalização do NOME).
const RE_VOTO_ABSTENCAO = new RegExp(
  `(?:[Dd]iretor[a]?\\s+)?(${NOME})\\s*(?:absteve-se|se\\s+absteve|(?:votou\\s+(?:pela\\s+|em\\s+)?)?[Aa]bsten[çc][aã]o)`,
  "g",
);

// ─── Impedimento / não-participação ───────────────────────────────────────
// O diretor ESTAVA na sessão mas NÃO votou este item. Sem isto ele permanecia no roster e a
// inferência por mandato FABRICAVA um "Favoravel" (vote-inference: activeDiretoresList sem voto
// nominal → Favoravel). Casos reais: 7 na 83ª ROP, 1 na 81ª, 1 na 82ª (dentro do golden-set).
//
// O CONECTOR entre o nome e a fórmula é ENUMERADO, nunca curinga. Com `.{0,80}` a regex saltaria
// do nome de um diretor para a fórmula de OUTRO — e a 81ª tem exatamente essa armadilha:
// "…voto originalmente proferido pelo então Diretor Carlos Cordeiro, cujo gabinete é atualmente
// ocupado pelo Diretor José Fernando de Mendonça Gomes Júnior, este não participaria da votação".
// O impedido é o SEGUNDO nome; um curinga atribuiria o impedimento ao primeiro.
//
// SEM flag 'i' — vide RE_VOTO_AUSENTE (o 'i' anula a Capitalização exigida pelo macro NOME).
const CONECTOR_IMPEDIMENTO = "(?:\\s*,?\\s*(?:este|esta|o\\s+qual|a\\s+qual))?";
const FORMULA_IMPEDIMENTO =
  "(?:encontrava-se\\s+impedid[oa]" +
  "|(?:se\\s+)?declarou[-\\s]se\\s+(?:impedid[oa]|suspeit[oa])" +
  "|est(?:á|a|ava)\\s+impedid[oa]" +
  "|impedid[oa]\\s+de\\s+votar" +
  "|n[ãa]o\\s+(?:votaria|votou)" +
  // "participar" exige OBJETO de votação: "não participa da Diretoria Colegiada" é biografia,
  // não impedimento. Sem o objeto, a fórmula marcaria quem apenas deixou o colegiado.
  "|n[ãa]o\\s+(?:participaria|participou|participa)\\s+(?:d[aeo]|n[ao])\\s+" +
  "(?:vota[çc][ãa]o|delibera[çc][ãa]o|aprecia[çc][ãa]o|discuss[ãa]o|julgamento)" +
  ")";
const RE_VOTO_IMPEDIDO = new RegExp(
  `(?:[Dd]iretor[a]?(?:[-\\s](?:Geral|Substitut[oa]))?\\s+|[Cc]onselheir[oa]\\s+)(${NOME})` +
  `${CONECTOR_IMPEDIMENTO}\\s+${FORMULA_IMPEDIMENTO}`,
  "g",
);
// Forma invertida, com o rótulo antes do nome: "Impedido de votar o Diretor X".
const RE_IMPEDIMENTO_LABEL = new RegExp(
  `[Ii]mpedid[oa]s?\\s+de\\s+votar\\s+(?:[oa]\\s+)?(?:[Dd]iretor[a]?(?:[-\\s](?:Geral|Substitut[oa]))?\\s+|[Cc]onselheir[oa]\\s+)(${NOME})`,
  "g",
);
// GUARD OBRIGATÓRIO — impedimento EXPRESSAMENTE AFASTADO. A 83ª/2.5.1 diz "por se tratar de
// matéria anteriormente relatada pelo Diretor Caio Mário Trivellato Seabra Filho, NÃO HAVIA
// IMPEDIMENTO à participação dos demais Diretores na votação". A janela é removida antes de
// procurar impedimento: marcar alguém ali seria inverter o sentido do documento.
const RE_IMPEDIMENTO_NEGADO = /n[ãa]o\s+h(?:avia|á|ouve)\s+impedimento[^.]{0,200}\.?/gi;

/**
 * Nomes de diretores IMPEDIDOS de votar no trecho.
 * Roda sobre o texto ACHATADO: medido na 83ª, "encontrava-se impedido de votar" aparece 3× com as
 * quebras de linha do PDF e 7× com os espaços colapsados — mais da metade dos impedimentos se
 * perderia, e cada um perdido vira um "Favoravel" fabricado.
 */
export function extractImpedidos(text: string): string[] {
  const flat = flattenForMatch(text).replace(RE_IMPEDIMENTO_NEGADO, " ");
  const nomes: string[] = [];
  for (const re of [RE_VOTO_IMPEDIDO, RE_IMPEDIMENTO_LABEL]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(flat)) !== null) {
      const nome = (m[1] ?? "").replace(/\s+/g, " ").trim();
      // Mesma validação estrita de quem grava voto: impedimento remove o diretor do pool.
      if (nome.length > 4 && isStrictPersonName(nome) && !nomes.includes(nome)) nomes.push(nome);
    }
  }
  return nomes;
}

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, março: 3, marco: 3, abril: 4,
  maio: 5, junho: 6, julho: 7, agosto: 8,
  setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};
const RE_DATA_EXTENSO  = /(\d{1,2})\s+de\s+([a-záéíóúâêôãõçàü]+)\s+de\s+(\d{4})/gi;
const RE_DATA_NUMERICA = /(\d{2})\/(\d{2})\/(\d{4})/g;
// Data numérica próxima a contexto de reunião (mais confiável que a primeira data do documento)
const RE_DATA_NUMERICA_CTX = /(?:Reuni[aã]o|realizada?\s+em|São\s+Paulo)\s*[,:]?\s*(\d{2})\/(\d{2})\/(\d{4})/gi;

// Data específica do cabeçalho da deliberação — prioridade máxima
// Ex: "DELIBERAÇÃO ARTESP Nº 66, DE 22 DE JANEIRO DE 2026"
const RE_DATA_CABECALHO = /DELIBERA[ÇC][AÃ]O\s*(?:ARTESP\s*)?N[ºo°]?\s*[\d\.]+[,\s]+DE\s+(\d{1,2})\s+DE\s+([a-zA-ZáéíóúâêôãõçàüÁÉÍÓÚÂÊÔÃÕÇÀÜ]+)\s+DE\s+(\d{4})/i;

// ─── Extração de nomes de diretores ───────────────────────────────────────
// (macro NOME definida no topo do arquivo)

// Padrões A/B/C: contexto de voto em frases narrativas.
// SEM flag 'i' (QA ago/2026): o 'i' anulava a Capitalização do macro NOME e casava prosa
// minúscula. Literais com [Dd]/[Cc]/[Ff] explícitos, padrão do RE_VOTO_AUSENTE.
const RE_VOTO_CONTEXTO = [
  new RegExp(`(?:[Dd]iretor[a]?\\s+|[Cc]onselheiro[a]?\\s+)(${NOME})\\s*(?:votou|vot[ao]|manifestou)`, "g"),
  new RegExp(`(?:[Vv]oto\\s+d[oa]\\s+(?:[Dd]iretor[a]?\\s+|[Cc]onselheiro[a]?\\s+))(${NOME})`, "g"),
  new RegExp(`\\b(${NOME})\\s*${DASHES}\\s*(?:[Ff]avor[aá]vel|[Cc]ontr[aá]ri[ao]|[Aa]bsten[çc][aã]o|[Aa]usente)`, "g"),
];

// Pattern D extendido: captura nome E direção do voto para split favor/contra
const RE_VOTO_DIRECAO = new RegExp(`\\b(${NOME})\\s*${DASHES}\\s*([Ff]avor[aá]vel|[Cc]ontr[aá]ri[ao]|[Aa]bsten[çc][aã]o|[Aa]usente)`, "g");

// Adesão ao relator: "X acompanhou/seguiu/aderiu" → favor; "X divergiu/discordou" → contra.
// Padrão DIRECIONAL dedicado (não entra em RE_VOTO_CONTEXTO para não perder a direção).
// Verbos CONJUGADOS com fronteira (\b): os radicais soltos (`segui\w*`, `acompanh\w*`)
// casavam "seguintes"/"acompanhamento" e criavam candidatos-lixo ("Ou Acesse Os").
// Ordinal do revisor — o corpus escreve CAPITALIZADO ("acompanhou o voto do Segundo Revisor").
const ORDINAL_REVISOR = "(?:[Pp]rimeir|[Ss]egund|[Tt]erceir|[Qq]uart)[oa]";
/**
 * Objeto obrigatório da ADESÃO (etapa66) — o voto de um COLEGA, nunca uma manifestação técnica.
 *
 * Simetria com o ramo de divergência, que já exigia `ALVO_DIVERGENCIA_COLEGIADO`. Sem isto, o lado
 * que grava FAVORÁVEL ficava mais frouxo que o que grava CONTRÁRIO — e favorável é justamente o
 * sinal que já vem inflado pela inferência de unanimidade.
 *
 * ⚠️ Medido nas 16 fixtures antes de entrar: das 150 ocorrências da PALAVRA
 * (`acompanh|segui|aderi`), a regex casa apenas 3 (ela exige NOME adjacente), e as 3 são adesão a
 * voto de colega — nenhum voto fabricado hoje. Mas essa proteção é ACIDENTAL, vem da adjacência do
 * nome. Com o objeto: preserva 3/3 e bloqueia 4/4 das frases adversariais
 * ("acompanhou a manifestação técnica", "o parecer da Procuradoria", "as conclusões da área
 * técnica", "Superintendência … acompanhou a sessão").
 *
 * As formas de artigo vão da mais longa para a mais curta: `aderiu AO voto do X` precisa de "ao"
 * como token único, senão o "a" isolado casa e o "o voto" seguinte não fecha.
 */
const OBJETO_ADESAO_COLEGIADO =
  `(?:integralmente\\s+|parcialmente\\s+|na\\s+[íi]ntegra\\s+)?` +
  `(?:(?:aos|ao|às|as|os|à|a|o)\\s+)?` +
  `(?:voto\\s+(?:d[oa]s?\\s+)?)?(?:\\(\\s*)?(?:${ORDINAL_REVISOR}\\s+)?` +
  `(?:[Rr]elator[a]?|[Rr]evisor[a]?|[Dd]iretor[a]?(?:[-\\s]Geral)?|[Cc]onselheir[oa])`;

const RE_VOTO_CONCORDANCIA = new RegExp(
  `(?:[Dd]iretor[a]?\\s+|[Cc]onselheiro[a]?\\s+)?(${NOME})\\s+(?:` +
    `(acompanh(?:ou|a|am|aram|ando)|segui(?:u|ram|ndo)|aderi(?:u|ram|ndo))\\s+${OBJETO_ADESAO_COLEGIADO}` +
    // Mesma exigência de objeto do RE_VOTO_DISSIDENTE_VERBAL: este ramo grava CONTRA, e
    // "divergiu das manifestações técnicas" não é dissenso do colegiado.
    `|(divergi(?:u|ram)|discord(?:ou|a|am|aram|ando))\\s+d[oa]\\s+${ALVO_DIVERGENCIA_COLEGIADO}\\b` +
  `)`,
  "g",
);

// Número ordinal da reunião — apenas o dígito "1176"
// A alternativa COM separador de milhar vem primeiro (etapa65). Sem ela, "ATA DA 1.024ª REUNIÃO"
// casava só os três últimos dígitos e o número saía "024" — a reunião 1.024 virava a 24. O parser
// dedicado da ANTT já devolvia "1.024", então o defeito ficava latente: só aparece quando o parser
// dedicado não assume (documento da ANTT que não dispare `isAntt`, ou agência nova com milhar).
// ⚠️ O FORMATO com ponto é preservado de propósito: `numero_reuniao` é chave de dedup
// (`deliberacao-dedup.ts`, `reunioes.ts` comparam com `.eq()`), então normalizá-lo aqui faria a
// mesma reunião deixar de casar com a linha já persistida. Ordenação usa `numeroReuniaoOrdinal`.
const RE_NUMERO_REUNIAO = /(\d{1,3}(?:\.\d{3})+|\d{3,4})[ªa°º]?\s*Reuni[aã]o/gi;

/**
 * Número da reunião como INTEIRO, para comparação ordinal. Não substitui o campo armazenado —
 * "1.024" e "1024" convivem em produção e ambos valem 1024 aqui.
 */
export function numeroReuniaoOrdinal(numero: string | null | undefined): number | null {
  if (!numero) return null;
  const limpo = String(numero).replace(/[.\s]/g, "");
  if (!/^\d+$/.test(limpo)) return null;
  return Number(limpo);
}

// Tipo de reunião: Ordinária ou Extraordinária
const RE_TIPO_REUNIAO = /\b(Ordin[aá]ria|Extraordin[aá]ria)\b/i;

// Padrão D: bloco de assinatura em Title Case — "Nome Completo\nDiretor-Presidente"
const RE_ASSINATURA = /^([A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][a-záéíóúâêôãõçàü][a-záéíóúâêôãõçàü\s]+)\s*\n\s*(?:Diretor(?:-Presidente)?|Diretora(?:-Presidente)?|Conselheiro(?:-Presidente)?|Conselheira|Presidente)/gm;

// Padrão E: bloco de assinatura ARTESP em CAIXA ALTA — "NOME COMPLETO\nDiretor-Presidente"
// Necessário porque deliberações ARTESP usam nomes em maiúsculas no rodapé.
const RE_ASSINATURA_CAPS = /^([A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ]{2}[A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ\s]+)\s*\n\s*(?:Diretor(?:-Presidente)?|Diretora(?:-Presidente)?|Conselheiro(?:-Presidente)?|Conselheira|Presidente)/gm;

// Bloco de atestação eletrônica SEI — deve ser removido antes de extrair signatários
// para evitar duplicação de nomes (o SEI repete os nomes dos diretores nesse bloco)
const RE_BLOCO_SEI_ASSINATURA = /Documento assinado eletronicamente[\s\S]*?(?=A autenticidade|$)/g;

// Padrão F: assinatura ANM com dash — "Nome - Diretor(a)" ou "Nome - Diretor-Geral"
const RE_ASSINATURA_DASH = new RegExp(`^\\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][a-záéíóúâêôãõçàü\\s]+)\\s*${DASHES}\\s*(?:Diretor[a]?(?:[- ]Geral)?(?:\\s*Substitut[oa])?|Conselheiro[a]?(?:-Presidente)?|Presidente)`, "gm");

// Padrão G: assinatura ARTESP INLINE — o rodapé das DELIBERAÇÕES vem numa linha corrida,
// "Nome Completo Diretor-Presidente Outro Nome Diretor Terceiro Nome Diretor", então os
// padrões Nome\nCargo (A/B/E) e Nome-Cargo (F) NÃO casam e `signatarios` ficava vazio — os
// 4 votos dependiam 100% do seed de mandato (frágil). Captura pares Nome+Cargo na MESMA
// linha. O lookahead nega que uma palavra do NOME seja o próprio cargo (senão o "Diretor"
// do par anterior viraria início do próximo nome). Cada captura ainda passa por
// isLikelyPersonName + findBestMatch a jusante, então um falso-positivo não vira voto.
const RE_CARGO_ASSINATURA = "(?:Diretor(?:a)?(?:[- ]Presidente)?|Conselheir[oa](?:[- ]Presidente)?|Presidente)";
const RE_ASSINATURA_INLINE = new RegExp(
  `((?!${RE_CARGO_ASSINATURA}\\b)[A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][a-záéíóúâêôãõçàü.'-]+` +
    `(?:\\s+(?:d[aeo]s?\\s+)?(?!${RE_CARGO_ASSINATURA}\\b)[A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][a-záéíóúâêôãõçàü.'-]+){1,5})` +
    `\\s+${RE_CARGO_ASSINATURA}\\b`,
  "g",
);

// Palavras INSTITUCIONAIS que nenhum nome de pessoa contém — bloqueiam o falso-positivo
// clássico "Conselho Diretor" (a INSTITUIÇÃO, onde "Diretor" é adjetivo e não cargo de
// assinatura): sem isto, "Reunião Ordinária do Conselho Diretor" virava "nome" e gerava
// voto numa pauta. isLikelyPersonName não pega (são 2+ tokens de conteúdo).
const RE_NOME_INSTITUCIONAL = /\b(?:Reuni[aã]o|Conselho|Ordin[aá]ria|Extraordin[aá]ria|Diretoria|Superintend[eê]ncia|Ag[eê]ncia|C[aâ]mara|Comiss[aã]o|Presid[eê]ncia|Sistema|Processo|Assunto|Interessad[oa]|Pauta|Sess[aã]o|Colegiad[oa]|Secretaria|Ger[eê]ncia|Coordena[cç][aã]o|N[uú]cleo|Ata|Estado)\b/i;

/**
 * Extrai o roster do rodapé de assinaturas ARTESP inline ("Nome Cargo Nome Cargo…").
 * Cada nome é validado (isLikelyPersonName, não é palavra-função, não é institucional) e a
 * lista é capada — a validação forte contra diretores reais acontece a jusante (findBestMatch).
 */
export function extractSignatariosInline(text: string): string[] {
  const nomes: string[] = [];
  RE_ASSINATURA_INLINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_ASSINATURA_INLINE.exec(text)) !== null && nomes.length < 12) {
    const nome = m[1].replace(/\s+/g, " ").trim();
    const tokens = nome.split(/\s+/).length;
    if (tokens < 2 || tokens > 6) continue;
    if (!isLikelyPersonName(nome) || isRoleWordOnly(nome)) continue;
    if (RE_NOME_INSTITUCIONAL.test(nome)) continue;
    if (!nomes.some((n) => n.toLocaleLowerCase("pt-BR") === nome.toLocaleLowerCase("pt-BR"))) {
      nomes.push(nome);
    }
  }
  return nomes;
}

// Pauta ANM: "1. DIRETOR-GERAL MAURO HENRIQUE MOREIRA SOUSA".
// Isso identifica o diretor responsavel/relator do item, mas nao prova voto nominal.
// Alternativa SUBSTITUT[OA] primeiro: senão "DIRETOR SUBSTITUTO X" casa só "DIRETOR" e
// "SUBSTITUTO" gruda no nome capturado.
const RE_DIRETOR_HEADING_CAPS = /^\s*(?:\d+(?:\.\d+)*\.?\s*)?(?:DIRETOR(?:A)?\s+SUBSTITUT[OA]|DIRETOR(?:A)?(?:[- ]GERAL)?|RELATOR(?:A)?)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ\s.'-]{5,})\s*$/gm;

// Número da reunião para atas ANM: "ATA 1ª REUNIÃO"
const RE_NUMERO_ATA = /ATA\s+(\d+)[ªa°º]?\s*REUNI[AÃ]O/i;

// Relator rotulado: "Relator: Conselheiro João Pedro de Almeida" (linha ancorada, exige ":").
// Não casa prosa ("O relator do processo...") nem "Voto: pela procedência".
const RE_RELATOR_LABEL = /^\s*Relator(?:a)?\s*:\s*(?:Conselheir[oa]\s+|Diretor[a]?(?:[- ]Geral)?\s+)?([A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][A-Za-zÁÉÍÓÚÂÊÔÃÕÇÀÜáéíóúâêôãõçàü.'-]+(?:\s+[A-Za-zÁÉÍÓÚÂÊÔÃÕÇÀÜáéíóúâêôãõçàü.'-]+){1,6})\s*$/im;

// ─── Utilitários ───────────────────────────────────────────────────────────
function firstMatch(text: string, pattern: RegExp, group = 1): string | null {
  pattern.lastIndex = 0;
  const match = pattern.exec(text);
  return match ? match[group].trim() : null;
}

function uniquePush(list: string[], value: string | null | undefined) {
  const clean = value?.replace(/\s+/g, " ").trim();
  if (!clean || clean.length < 5) return;
  if (!list.some((item) => item.toLocaleLowerCase("pt-BR") === clean.toLocaleLowerCase("pt-BR"))) {
    list.push(clean);
  }
}

function splitDirectorNames(value: string): string[] {
  return value
    .replace(/\b(?:Diretor(?:a)?|Diretor-Geral|Conselheiro(?:a)?|Presidente)\b/gi, "")
    // Fase 13 — o " - " também separa ("Raquel França Carneiro - Diretora - Afastamento em
    // Férias"). Só HÍFEN COM ESPAÇOS: nome composto real ("Sá-Carvalho") não tem espaços em volta.
    .split(/\s*(?:,|;|\se\s)\s*|\s+[-–—]\s+/i)
    .map((name) => name.replace(/\s+/g, " ").trim())
    .filter((name) => name.split(/\s+/).length >= 2 && name.length <= 100);
}

// Corte de PROSA no fim do heading (QA ago/2026): as capturas `(.+)$`/caps engoliam a frase
// seguinte ("…GOMES JÚNIOR restituiu-lhe a presidência…", "…NEVES para a relatoria da matéria
// por ele pautada:") e o lixo virava "diretor" Title-Case no cadastro. Tudo a partir da
// primeira palavra de prosa (qualquer caixa) — ou de ":" — é descartado.
const RE_HEADING_PROSA_CORTE = new RegExp(
  "\\s+(?:PARA|PELA|PELO|QUE|COM|AO|AOS|NA|NO|NAS|NOS|POR|RESTITUIU\\S*|PASSOU|CONCEDEU?|CONCEDENDO|RELATORIA|PRESID[EÊ]NCIA|MAT[EÉ]RIA\\S*|SESS[AÃ]O|PAUTAD[AO]S?|APRESENTOU|INFORMOU|AGRADECEU|INICIOU|ENCERROU|PROP[ÔO]S)\\b[\\s\\S]*$",
  "i",
);
function trimHeadingNome(raw: string): string {
  return raw
    .split(":")[0]
    .replace(RE_HEADING_PROSA_CORTE, "")
    .replace(/\b(?:PROCESSO|INTERESSAD[AO]|ASSUNTO|VOTO|VISTA|RECURSO)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 8) // nome de pessoa nunca passa de 8 tokens — o resto é prosa
    .join(" ");
}

function extractDiretorHeadings(text: string): string[] {
  const names: string[] = [];
  RE_DIRETOR_HEADING_CAPS.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RE_DIRETOR_HEADING_CAPS.exec(text)) !== null) {
    uniquePush(names, trimHeadingNome(match[1]));
  }

  const lines = text.split("\n");
  const roleLine = /^\s*(?:\d+(?:\.\d+)*\.?\s*)?(?:DIRETOR(?:A)?\s+SUBSTITUT[OA]|DIRETOR(?:A)?(?:[- ]GERAL)?|RELATOR(?:A)?)\s+(.+)$/;
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i].trim();
    const lineMatch = roleLine.exec(current);
    if (!lineMatch) continue;

    let nome = lineMatch[1].trim();
    const next = lines[i + 1]?.trim() ?? "";
    if (
      next &&
      /^[A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ\s.'-]{5,}$/.test(next) &&
      !/^(PROCESSO|INTERESSAD[AO]|ASSUNTO|VOTO|MAT[EÉ]RIAS|APROVA)/i.test(next)
    ) {
      nome = `${nome} ${next}`;
    }
    uniquePush(names, trimHeadingNome(nome));
  }
  return names;
}

// ─── Extrator linha a linha (segunda estratégia) ──────────────────────────
// Faz varredura linha a linha buscando padrão "Rótulo: Valor".
// Mais tolerante a variações de espaçamento/pontuação que regex de largura fixa.
const LABEL_PATTERNS: [string, RegExp][] = [
  ["interessado", /^(?:Interessad[ao]|Requerente|Empresa|Solicitante|Concession[aá]ri[ao]|Outorgad[ao]|Peticion[aá]rio|Proponente|Benefici[aá]ri[ao]|Permission[aá]ri[ao]|Demandante|Postulante|Requerida)\s*:/i],
  ["processo",    /^(?:SEI[!]?|Processo(?:\s*SEI)?|PA|Proc(?:esso)?(?:\s*Adm(?:inistrativo)?)?)\s*n[ºo°]?\s*(?:[:–]|$)/i],
  ["assunto",     /^(?:Assunto|Ementa|Tema)\s*:/i],
  ["resultado",   /^(?:Resultado|Decis[aã]o)\s*:/i],
];

function extractLabeledFields(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 4) continue;
    for (const [key, re] of LABEL_PATTERNS) {
      if (map.has(key)) continue;
      if (re.test(trimmed)) {
        // Remove o rótulo + separadores e pega o valor restante
        const value = trimmed.replace(re, "").replace(/^[\s:–\-]+/, "").trim();
        if (value.length >= 3) map.set(key, value.slice(0, 250));
      }
    }
  }
  return map;
}

function allMatches(text: string, pattern: RegExp, group = 1): string[] {
  pattern.lastIndex = 0;
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    results.push(match[group].trim());
  }
  return results;
}

/** Extrai data do cabeçalho "DELIBERAÇÃO Nº X, DE DD DE MÊS DE AAAA" */
function parseDataCabecalho(text: string): string | null {
  const match = RE_DATA_CABECALHO.exec(text);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const mesNome = match[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const year = parseInt(match[3], 10);
  const month = MESES[mesNome];
  if (!month || day < 1 || day > 31 || year < 1990 || year > 2099) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseOneDateExtenso(match: RegExpExecArray): string | null {
  const day     = parseInt(match[1], 10);
  const mesNome = match[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const year    = parseInt(match[3], 10);
  const month   = MESES[mesNome];
  if (!month || day < 1 || day > 31 || year < 1990 || year > 2099) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDataExtenso(text: string): string | null {
  // Primeiro: busca data próxima a contextos de reunião (mais confiável)
  const RE_DATA_REUNIAO_CTX = /(?:Reuni[aã]o|realizada?\s+em|data\s+da\s+reuni[aã]o|São\s+Paulo,?)\s*[,:]?\s*(\d{1,2})\s+de\s+([a-záéíóúâêôãõçàü]+)\s+de\s+(\d{4})/gi;
  RE_DATA_REUNIAO_CTX.lastIndex = 0;
  let m = RE_DATA_REUNIAO_CTX.exec(text);
  if (m) {
    const result = parseOneDateExtenso([m[0], m[1], m[2], m[3]] as unknown as RegExpExecArray);
    if (result) return result;
  }

  // Fallback: primeira data em extenso encontrada no documento
  RE_DATA_EXTENSO.lastIndex = 0;
  m = RE_DATA_EXTENSO.exec(text);
  if (!m) return null;
  return parseOneDateExtenso(m);
}

function parseOneDateNumerica(d: string, m: string, y: string): string | null {
  const day   = parseInt(d, 10);
  const month = parseInt(m, 10);
  const year  = parseInt(y, 10);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2099) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDataNumerica(text: string): string | null {
  // Primeiro: data numérica próxima a contexto de reunião
  RE_DATA_NUMERICA_CTX.lastIndex = 0;
  const ctxMatch = RE_DATA_NUMERICA_CTX.exec(text);
  if (ctxMatch) {
    const result = parseOneDateNumerica(ctxMatch[1], ctxMatch[2], ctxMatch[3]);
    if (result) return result;
  }
  // Fallback: primeira data numérica do documento
  RE_DATA_NUMERICA.lastIndex = 0;
  const match = RE_DATA_NUMERICA.exec(text);
  if (!match) return null;
  return parseOneDateNumerica(match[1], match[2], match[3]);
}

// Data de publicação no Diário Oficial (DOU/DOE), distinta da data da reunião.
// Ex: "Publicado no DOU em 25/01/2026", "publicada no D.O.E. de 25 de janeiro de 2026".
const RE_DATA_PUBLICACAO_NUM =
  /(?:publicad[oa]|publica[çc][ãa]o|D\.?O\.?[UE]\.?|di[áa]rio\s+oficial)[^\d]{0,40}(\d{2})\/(\d{2})\/(\d{4})/gi;
const RE_DATA_PUBLICACAO_EXT =
  /(?:publicad[oa]|publica[çc][ãa]o|D\.?O\.?[UE]\.?|di[áa]rio\s+oficial)[^\d]{0,40}(\d{1,2})\s+de\s+([a-záéíóúâêôãõçàü]+)\s+de\s+(\d{4})/gi;

// Âncora FORTE de publicação ("publicado em/no", "DOU de", "D.O.E. nº") — distingue
// a data de publicação real de uma data solta que coincide com a da reunião.
const RE_PUBLICACAO_STRONG =
  /(?:publicad[oa]\s+(?:em|no|na)|public(?:a[çc][ãa]o)\s+(?:em|no|na)|D\.?O\.?[UE]\.?\s*(?:de|em|n[º°o]))/i;

function parseDataPublicacao(text: string, dataReuniao: string | null = null): string | null {
  const strong = RE_PUBLICACAO_STRONG.test(text);
  // Sem âncora forte, uma data igual à da reunião é provável falso positivo → descarta.
  const accept = (iso: string | null) =>
    iso && !(iso === dataReuniao && !strong) ? iso : null;

  // Primeiro por extenso (mais específico), depois numérico.
  RE_DATA_PUBLICACAO_EXT.lastIndex = 0;
  const ext = RE_DATA_PUBLICACAO_EXT.exec(text);
  if (ext) {
    const result = accept(parseOneDateExtenso([ext[0], ext[1], ext[2], ext[3]] as unknown as RegExpExecArray));
    if (result) return result;
  }
  RE_DATA_PUBLICACAO_NUM.lastIndex = 0;
  const num = RE_DATA_PUBLICACAO_NUM.exec(text);
  if (num) {
    const result = accept(parseOneDateNumerica(num[1], num[2], num[3]));
    if (result) return result;
  }
  return null;
}

// EMENTA da deliberação ARTESP avulsa: bloco em CAIXA ALTA que abre logo abaixo do cabeçalho
// "DELIBERAÇÃO ARTESP Nº …, DE …", começando pelo verbo decisório. É o dispositivo REAL do
// documento — o que vem depois do "DELIBERA" é ritual.
const RE_ARTESP_EMENTA_HEAD = /DELIBERA[ÇC][ÃA]O\s+ARTESP\s+N[ºo°]\s*[\d.]+[^\n]*\n/i;
const RE_VERBO_EMENTA =
  /^\s*(APROVA|INDEFERE|DEFERE|RATIFICA|RECOMENDA|DETERMINA|AUTORIZA|HOMOLOGA|REVOGA|ANULA|ARQUIVA|CONHECE|NEGA)\b/;

/**
 * Ementa da deliberação ARTESP (null quando o documento não é desse formato).
 * A janela vai do verbo até o fim do parágrafo — o suficiente para o dispositivo e curto o
 * bastante para não alcançar o ritual nem os "considerandos".
 */
export function extractEmentaArtesp(text: string): string | null {
  // Só o CABEÇALHO do documento (primeiros 900 caracteres). Uma ATA da ARTESP CITA várias
  // "Deliberação ARTESP nº" no corpo; sem este limite, o escopo de resultado da ata passava a ser
  // a ementa de uma deliberação CITADA — a mesma armadilha que `isArtespDeliberacao` já evita na
  // classificação de tipo. Medido: a 1201ª casava uma ementa de 1.100 caracteres do corpo.
  const cabecalho = text.slice(0, 900);
  const head = RE_ARTESP_EMENTA_HEAD.exec(cabecalho);
  if (!head) return null;
  const depois = text.slice(head.index + head[0].length);
  const linhas = depois.split("\n");
  for (let i = 0; i < Math.min(linhas.length, 12); i++) {
    if (!RE_VERBO_EMENTA.test(linhas[i])) continue;
    const bloco: string[] = [];
    for (let j = i; j < linhas.length && bloco.length < 12; j++) {
      if (j > i && linhas[j].trim() === "") break; // fim do parágrafo da ementa
      bloco.push(linhas[j]);
    }
    return bloco.join("\n");
  }
  return null;
}

// Prioridade para resultado principal quando há múltiplos verbos decisórios
const RESULTADO_PRIORIDADE: Record<string, number> = {
  // Etapa56: RETIRADO vem PRIMEIRO. Retirada é sobre o ANDAMENTO, não sobre o mérito — se a
  // matéria saiu de pauta/reunião, ela NÃO foi decidida, e nenhum verbo de mérito no texto muda
  // isso. Estava por último, então o vetor real "processo retirado da reunião cujo ASSUNTO cita
  // 'indeferiu'" era gravado como Indeferido: um processo não decidido entrava na base como
  // decisão negativa. O `inferResultadoFromText` do ata-splitter já testava retirada primeiro —
  // os dois motores discordavam sobre o mesmo documento.
  "Retirado de Pauta": 0,
  "Aprovado com Ressalvas": 1,
  "Aprovado": 2,
  "Autorizado": 3,
  "Recomendado": 4,
  "Deferido": 5,
  "Indeferido": 6,
  "Parcialmente Deferido": 7,
  // Etapa54: RATIFICAR e DETERMINAR são atos ANCILARES — instruem o processo, não decidem o
  // pleito. Estavam ACIMA de Deferido/Indeferido e por isso o ritual da ARTESP ("Fica RATIFICADA
  // toda a instrução processual e DETERMINADA a adoção das medidas pertinentes"), presente em toda
  // deliberação, vencia o desfecho REAL. Agora só valem quando são a única coisa que o
  // documento decide. A remoção do ritual do escopo (RE_ARTESP_FORMULA_RITUAL) e esta ordem
  // resolvem o mesmo problema por dois lados — corrigir só um dos dois deixaria a outra porta.
  "Ratificado": 9,
  "Determinado": 10,
};

function normalizeResultado(raw: string): string | null {
  const upper = raw.toUpperCase().replace(/\s+/g, " ").trim();
  // Casamento por RADICAL para cobrir particípio, substantivo e pretérito
  // (DEFERIDO/DEFERIMENTO/DEFERIU). Ordem importa: INDEFER antes de DEFER, e
  // as formas mais específicas primeiro.
  if (upper.includes("PARCIALMENTE"))   return "Parcialmente Deferido";
  if (upper.includes("RETIRAD") || upper.startsWith("ARQUIV") || upper.startsWith("CANCEL") || upper.startsWith("PREJUDIC")) {
    return "Retirado de Pauta"; // arquivamento/cancelamento = sem decisão de mérito
  }
  if (upper.includes("INDEFER")) return "Indeferido";        // INDEFERIDO/INDEFERIMENTO/INDEFERIU
  // NEGA*/IMPROVIDO/DESPROVIDO → negativo. Vêm ANTES de "PROVID" para que "IMPROVIDO" não seja
  // lido como provimento (o mesmo cuidado que o parser da ANTT já tomava).
  if (upper.startsWith("NEGA") || upper.startsWith("NEGOU")) return "Indeferido";
  if (upper.startsWith("IMPROVID") || upper.startsWith("DESPROVID")) return "Indeferido";
  if (upper.startsWith("PROVID")) return "Deferido";
  if (upper.startsWith("ANUL") || upper.startsWith("REVOG")) return "Indeferido"; // anulação/revogação ~ indeferimento
  if (upper.includes("RESSALVAS")) return "Aprovado com Ressalvas";
  if (upper.includes("DEFER"))   return "Deferido";          // DEFERIDO/DEFERIMENTO/DEFERIU
  if (upper.startsWith("RATIFIC")) return "Ratificado";
  if (upper.startsWith("APROV") || upper.startsWith("HOMOLOG")) return "Aprovado"; // homologação = aprovação
  if (upper.startsWith("RECOMEND")) return "Recomendado";
  if (upper.startsWith("DETERMIN")) return "Determinado";
  if (upper.startsWith("AUTORIZ")) return "Autorizado";
  return null;
}

// ─── Tipo de retorno ───────────────────────────────────────────────────────
function extractNumeroDeliberacao(text: string): string | null {
  const patterns = [
    /DELIBERAÇÃO\s*(?:ARTESP\s*)?N[º°o]?\s*([\d.]+)/iu,
    /DELIBERACAO\s*(?:ARTESP\s*)?N[º°o]?\s*([\d.]+)/iu,
    RE_DELIBERACAO,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export interface ExtractedFields {
  numero_deliberacao: string | null;
  reuniao_ordinaria: string | null;
  numero_reuniao: string | null;    // apenas o número ordinal "1176"
  tipo_reuniao: string | null;      // "Ordinaria" | "Extraordinaria"
  data_reuniao: string | null;      // ISO: "YYYY-MM-DD"
  data_publicacao: string | null;   // ISO: data de publicação no DOU/DOE (distinta da reunião)
  interessado: string | null;
  processo: string | null;
  assunto: string | null;           // campo "Assunto:" das deliberações ARTESP
  procedencia: string | null;       // campo "Procedência:" (departamento de origem)
  relator: string | null;
  resultado: string | null;
  /** "admissibilidade" quando o dispositivo NÃO CONHECE; null = mérito (etapa54). */
  juizo: "admissibilidade" | null;
  /** Diretor que proferiu o voto de QUALIDADE (desempate). null quando não houve (etapa62). */
  voto_qualidade_por: string | null;
  decisoes_todas: string[];         // todos os verbos decisórios únicos normalizados
  pauta_interna: boolean;
  resumo_pleito: string | null;
  fundamento_decisao: string | null;
  nomes_votacao: string[];          // todos os nomes (compatibilidade)
  nomes_votacao_favor: string[];    // nomes que votaram a favor
  nomes_votacao_contra: string[];   // nomes que votaram contra/dissidentes
  nomes_votacao_abstencao: string[];// nomes que se abstiveram
  nomes_votacao_ausente: string[];  // nomes explicitamente ausentes
  nomes_votacao_impedido: string[]; // impedidos/suspeitos — presentes, mas SEM voto (etapa50)
  signatarios: string[];            // diretores identificados no bloco de assinatura
  diretores_detectados: string[];   // diretores identificados em cabecalhos/relatoria
  unanimidade_detectada: boolean;   // true se "por unanimidade" encontrado no texto
  // Diretores PRESENTES declarados no próprio documento ("Constituição:"/"Presentes:",
  // padrão real das atas ARTESP). Fonte primária para atribuir votos em unanimidade —
  // mais fiel que o roster de mandatos.
  nomes_presentes: string[];
}

// ─── Extração principal ───────────────────────────────────────────────────
export function extractFields(text: string): ExtractedFields {
  const numero_deliberacao = extractNumeroDeliberacao(text);
  const reuniao_ordinaria  = firstMatch(text, RE_REUNIAO);
  const procedencia        = firstMatch(text, RE_PROCEDENCIA);

  // Estágio 1: regex globais
  let interessado = firstMatch(text, RE_INTERESSADO);
  let processo    = firstMatch(text, RE_PROCESSO);
  // Assunto: tenta "Assunto:" → "Ementa:" → "Tema:" → "Objeto:" (ANEEL e outras)
  let assunto =
    firstMatch(text, RE_ASSUNTO) ??
    firstMatch(text, /Ementa[:\s]+([^\n]{3,300})/gi) ??
    firstMatch(text, /Tema[:\s]+([^\n]{3,300})/gi) ??
    firstMatch(text, /Objeto[:\s]+([^\n]{3,300})/gi);
  const diretores_detectados = extractDiretorHeadings(text);
  // Relator rotulado tem prioridade; senão cai nos cabeçalhos de relatoria detectados.
  const relator =
    firstMatch(text, RE_RELATOR_LABEL) ??
    (diretores_detectados.length > 0 ? diretores_detectados.join(", ") : null);

  // Estágio 2: varredura linha a linha para campos ainda null
  if (!interessado || !processo || !assunto) {
    const labeled = extractLabeledFields(text);
    if (!interessado && labeled.has("interessado")) interessado = labeled.get("interessado")!;
    if (!processo    && labeled.has("processo"))    processo    = labeled.get("processo")!;
    if (!assunto     && labeled.has("assunto"))     assunto     = labeled.get("assunto")!;
  }

  // Trunca interessado no primeiro separador de cláusula após mínimo 5 chars
  // Ex: "Empresa XYZ Ltda., que solicita autorização..." → "Empresa XYZ Ltda."
  if (interessado && interessado.length > 5) {
    // Normaliza espaços ANTES de truncar: PDFs trazem espaços duplos no meio do
    // nome ("Rodovias  do  Tiete"), então NÃO usamos \s{2,} como separador.
    interessado = interessado.replace(/\s+/g, " ").trim();
    const sepMatch = interessado.match(/^(.{5,}?)(?:,\s*(?:que|a qual|cujo|cujos|cujas|por meio|através|representad)|;\s*|$)/);
    if (sepMatch && sepMatch[1].length < interessado.length) {
      // [,;] (não [,;.]) preserva o ponto de abreviações como "S.A."
      interessado = sepMatch[1].trim().replace(/[,;]\s*$/, "");
    }
  }

  // Data: prioriza cabeçalho ARTESP, depois extenso ANM, depois extenso genérico, depois numérico
  const data_reuniao =
    parseDataCabecalho(text) ??
    parseDataExtensoANM(text) ??
    parseDataExtenso(text) ??
    parseDataNumerica(text);

  // Data de publicação no DOU/DOE (opcional, distinta da reunião)
  const data_publicacao = parseDataPublicacao(text, data_reuniao);

  // Tipo de reunião
  const tipoMatch = RE_TIPO_REUNIAO.exec(text);
  let tipo_reuniao: string | null = null;
  if (tipoMatch) {
    const raw = tipoMatch[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    tipo_reuniao = raw.startsWith("extraordin") ? "Extraordinaria" : "Ordinaria";
  }

  // Resultado: escopa a detecção ao DISPOSITIVO (após marcadores decisórios),
  // evitando que verbos incidentais da prosa ("a empresa aprova", "o relator
  // recomenda") sobreponham a decisão real (que invertia o resultado).
  const dispMatch = text.match(/(?:Em\s+face\s+do\s+exposto|Diante\s+do\s+exposto|Pelo\s+exposto|Ante\s+(?:a?o\s+)?exposto|Por\s+todo\s+o?\s*exposto|DECIDE\s+A\s+DIRETORIA|A\s+DIRETORIA(?:\s+DA\s+[\wÀ-ÿ]+)?\s+(?:DECIDE|DELIBEROU|RESOLVE)|Decide-se|RESOLVE)[\s\S]{0,800}/i);
  // Escopo em CASCATA (etapa54): ementa → dispositivo → documento.
  // Na deliberação ARTESP avulsa o dispositivo REAL é a EMENTA em caixa alta do topo ("APROVA a
  // emissão e a publicação da Portaria…"); depois do "DELIBERA" vem só o ritual. Foi por isso que
  // ancorar em "DELIBERA nos seguintes termos" foi rejeitado — regrediria a 487 de "Aprovado"
  // para "Ratificado". Com a ementa no topo da cascata, o desfecho vem de onde ele está escrito.
  const ementaMatch = extractEmentaArtesp(text);
  const escopoBruto = ementaMatch ?? (dispMatch ? dispMatch[0] : text);
  // O ritual sai só AQUI (escopo de resultado). O texto original permanece intacto para
  // `raw_text`/`fundamento_decisao` — remover de lá apagaria conteúdo real do documento.
  const resultadoScope = escopoBruto.replace(RE_ARTESP_FORMULA_RITUAL, " ");
  const temEscopoDecisorio = Boolean(ementaMatch || dispMatch);
  const resultadoRaw = allMatches(resultadoScope, RE_RESULTADO);
  const decisoesSet = new Set<string>();
  for (const r of resultadoRaw) {
    // Sem dispositivo claro, descarta conjugações MINÚSCULAS de prosa
    // ("aprova"/"recomenda"/"deferimento"); aceita CAIXA ALTA / particípio / pretérito.
    if (!temEscopoDecisorio && r === r.toLowerCase()) continue;
    const norm = normalizeResultado(r);
    if (norm) decisoesSet.add(norm);
  }
  const decisoes_todas = [...decisoesSet];

  // Resultado principal: por prioridade (APROVA > AUTORIZA > RECOMENDA > ...)
  let resultado: string | null = null;
  if (decisoes_todas.length > 0) {
    resultado = decisoes_todas.sort(
      (a, b) => (RESULTADO_PRIORIDADE[a] ?? 99) - (RESULTADO_PRIORIDADE[b] ?? 99)
    )[0];
  }

  // Juízo do dispositivo: admissibilidade não é desfecho de mérito (etapa54).
  const juizo = detectJuizo(resultadoScope);

  // Fallback: "unanimidade de votos" → aprovação implícita (exceto "não/sem unanimidade" — F5).
  // BLOQUEADO quando o dispositivo tem direção NEGATIVA ou é juízo de admissibilidade: um recurso
  // ao qual se NEGA provimento POR UNANIMIDADE é unânime e negativo, e um "não conhecer por
  // intempestividade" não aprovou coisa nenhuma. Sem resultado, o item vai para revisão — que é
  // honesto; inventar o positivo é que não era.
  if (!resultado && hasUnanimidade(text)
      && !juizo && !RE_DIRECAO_NEGATIVA.test(resultadoScope)) {
    resultado = "Aprovado por Unanimidade";
    decisoes_todas.push("Aprovado por Unanimidade");
  }

  // Pauta interna: keywords administrativas ou ausência de interessado externo
  const PAUTA_INTERNA_KEYWORDS = [
    "pauta interna", "expediente interno", "assunto administrativo",
    "remuneração", "recursos humanos",
    "designação de empregado", "indicação para substituição",
    "cargo em comissão de comando", "empregado/servidor",
  ];
  const textLower = text.toLowerCase();
  const pauta_interna =
    !interessado ||
    PAUTA_INTERNA_KEYWORDS.some((kw) => textLower.includes(kw));

  // Resumo do pleito
  // Estratégia 1: seção com rótulo explícito (Resumo:, Objeto:, Ementa:)
  // Estratégia 2: parágrafo iniciado por marcador narrativo (Trata-se, Cuida-se, etc.)
  const RE_RESUMO_LABEL = /(?:Resumo[:\s]+|Objeto[:\s]+)([\s\S]{20,600}?)(?=\n\n|\f|$)/im;
  const RE_RESUMO_PRINCIPAL = /(?:Trata-se|Cuida-se|Versa\s+o\s+presente|A\s+presente\s+delibera[çc][aã]o|O\s+presente\s+(?:caso|processo|requerimento|pedido)|A\s+empresa\s+requer|O\s+requerente\s+solicita|Refere-se\s+ao?\s+requerimento)([\s\S]{30,800}?)(?=\n\n|\f|$)/im;

  let resumo_pleito: string | null = null;
  const resumoMatch = RE_RESUMO_LABEL.exec(text) ?? RE_RESUMO_PRINCIPAL.exec(text);
  if (resumoMatch) {
    const raw = resumoMatch[0].trim();
    resumo_pleito = raw.length >= 20 ? raw.slice(0, 800) : null;
  }
  // Fallback: usa o campo assunto como resumo curto
  if (!resumo_pleito && assunto && assunto.length >= 15) {
    resumo_pleito = assunto;
  }

  // Fundamento da decisão: marcadores expandidos para cobrir ARTESP e outras agências
  // [\s\S] limitado a 800 chars (greedy) para evitar backtracking excessivo
  const RE_FUNDAMENTO = /(?:Fundamento[:\s]+|Em face do exposto|Considerando\s+o\s+exposto|Diante\s+do\s+exposto|Pelo\s+exposto|Tendo\s+em\s+vista[^,\n]{0,30},\s*decide[:\s]+|DECIDE\s+A\s+DIRETORIA[:\s]+|A\s+DIRETORIA(?:\s+DA\s+\w+)?\s+DECIDE[:\s]+|DECIDE[:\s]+|Decide-se[:\s]+|RESOLVE[:\s]+)([\s\S]{20,800}?)(?:\n\n|\n[A-Z]{3}|$)/i;
  const fundamento_decisao = RE_FUNDAMENTO.exec(text)?.[1]?.trim() ?? null;

  // Número da reunião: tenta formato deliberação (1176ª), depois ata (ATA 1ª)
  const numero_reuniao = firstMatch(text, RE_NUMERO_REUNIAO) ?? firstMatch(text, RE_NUMERO_ATA);

  // ─── Bloco de assinatura: coleta signatários ──────────────────────────────
  // Suporta 3 formatos:
  //   A) Title-case + newline: "Nome Completo\nDiretor" (ARTESP)
  //   B) ALL-CAPS + newline: "NOME COMPLETO\nDiretor" (ARTESP)
  //   C) Dash: "Nome Completo - Diretor" (ANM)
  // Remove bloco de atestação eletrônica SEI para evitar duplicação de nomes
  const textSemSEI = text.replace(RE_BLOCO_SEI_ASSINATURA, "");

  const signatarios: string[] = [];

  // Padrão A: title-case + newline
  RE_ASSINATURA.lastIndex = 0;
  let sig: RegExpExecArray | null;
  while ((sig = RE_ASSINATURA.exec(textSemSEI)) !== null) {
    const nome = sig[1].trim();
    if (nome.length > 4 && !signatarios.includes(nome)) signatarios.push(nome);
  }

  // Padrão F: dash (ANM) — "Nome - Diretor(a)"
  RE_ASSINATURA_DASH.lastIndex = 0;
  let sigDash: RegExpExecArray | null;
  while ((sigDash = RE_ASSINATURA_DASH.exec(textSemSEI)) !== null) {
    const nome = sigDash[1].trim();
    if (nome.length > 4 && !signatarios.includes(nome)) signatarios.push(nome);
  }

  RE_ASSINATURA_CAPS.lastIndex = 0;
  let sigCaps: RegExpExecArray | null;
  while ((sigCaps = RE_ASSINATURA_CAPS.exec(textSemSEI)) !== null) {
    const nome = sigCaps[1].trim();
    if (nome.length > 4 && !signatarios.includes(nome)) signatarios.push(nome);
  }

  // Padrão G: rodapé ARTESP inline ("Nome Cargo Nome Cargo") — só quando os padrões
  // Nome\nCargo/Nome-Cargo não acharam nada, para não duplicar nem sobrepor o formato
  // já reconhecido. Sem isto, as deliberações ARTESP ficavam com signatarios=[].
  if (signatarios.length === 0) {
    for (const nome of extractSignatariosInline(textSemSEI)) {
      if (!signatarios.includes(nome)) signatarios.push(nome);
    }
  }

  // ─── Unanimidade ──────────────────────────────────────────────────────────
  // Negação-aware (F5): "não/sem unanimidade" NÃO conta como unânime.
  const unanimidade_detectada = hasUnanimidade(text);

  // ─── Nomes de diretores: contexto + bloco de assinatura ─────────────────
  const nomes_votacao: string[] = [];
  const nomes_votacao_favor: string[] = [];
  const nomes_votacao_contra: string[] = [];
  const nomes_votacao_abstencao: string[] = [];
  const nomes_votacao_ausente: string[] = [];

  // QA ago/2026: validação ESTRITA do nome — os regex de divergência pescavam fragmentos de
  // prosa ("voto por", "Diretoria Colegiada da ANM pode") como "dissidente" junto dos reais.
  // Contra grava VOTO → só entra o que tem forma de nome de pessoa (Capitalizado + partículas).
  // Etapa65 — quem o DISPOSITIVO credita com o voto APROVADO não é dissidente: venceu. Se a ata
  // diz as duas coisas, o dispositivo é a que decide. Sem esta trava, "divergente DO RELATOR"
  // (padrão da ANM, e frequentemente a posição vencedora) virava voto CONTRÁRIO do vencedor.
  const roleMapDoc = buildRoleMap(text);
  const autoresAprovado = new Set(extractAutoresDoVotoAprovado(text, roleMapDoc));

  const markContra = (rawNome: string) => {
    const nome = rawNome.replace(/\s+/g, " ").trim();
    if (nome.length <= 4) return;
    if (!isStrictPersonName(nome)) return;
    if (autoresAprovado.has(nome)) return;
    if (!nomes_votacao.includes(nome)) nomes_votacao.push(nome);
    const idxFavor = nomes_votacao_favor.indexOf(nome);
    if (idxFavor !== -1) nomes_votacao_favor.splice(idxFavor, 1);
    if (!nomes_votacao_contra.includes(nome)) nomes_votacao_contra.push(nome);
  };

  // Detecção direcional explícita ("Nome – Favorável/Contrário/Abstenção/Ausente").
  // SEMPRE roda, inclusive sob unanimidade: uma divergência tabular sobrepõe o default.
  RE_VOTO_DIRECAO.lastIndex = 0;
  let vd: RegExpExecArray | null;
  while ((vd = RE_VOTO_DIRECAO.exec(text)) !== null) {
    const nome = vd[1].replace(/\s+/g, " ").trim();
    const tipo = vd[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (nome.length > 4) {
      if (!nomes_votacao.includes(nome)) nomes_votacao.push(nome);
      if (tipo.includes("ausente")) {
        if (!nomes_votacao_ausente.includes(nome)) nomes_votacao_ausente.push(nome);
      } else if (tipo.startsWith("absten")) {
        if (!nomes_votacao_abstencao.includes(nome)) nomes_votacao_abstencao.push(nome);
      } else if (tipo.startsWith("favor")) {
        if (!nomes_votacao_favor.includes(nome)) nomes_votacao_favor.push(nome);
      } else {
        // Contra grava VOTO → validação estrita do nome (QA ago/2026: prosa pescada como
        // dissidente) E a trava da etapa65 (quem o dispositivo diz que venceu não é dissidente).
        // Este ramo NÃO passava por `markContra`, então escapava da segunda — um furo dentro da
        // própria correção. Etapa66.
        markContra(nome);
      }
    }
  }

  // Adesão/divergência ao relator (padrão direcional dedicado).
  RE_VOTO_CONCORDANCIA.lastIndex = 0;
  let vc: RegExpExecArray | null;
  while ((vc = RE_VOTO_CONCORDANCIA.exec(text)) !== null) {
    const nome = vc[1].replace(/\s+/g, " ").trim();
    // vc[2] = adesão (acompanhou/seguiu/aderiu) · vc[3] = divergência COM objeto do colegiado.
    const verbo = (vc[2] ?? vc[3] ?? "").toLowerCase();
    if (nome.length <= 4) continue;
    if (!nomes_votacao.includes(nome)) nomes_votacao.push(nome);
    if (/^(?:divergi|discord)/.test(verbo)) {
      // Contra grava VOTO → validação estrita (QA ago/2026).
      if (isStrictPersonName(nome) && !nomes_votacao_contra.includes(nome)) nomes_votacao_contra.push(nome);
    } else if (isStrictPersonName(nome)
               && !nomes_votacao_favor.includes(nome) && !nomes_votacao_contra.includes(nome)) {
      // Etapa66 — favor TAMBÉM grava voto; a validação de nome deixou de ser privilégio do lado
      // contrário. (A defesa principal é o objeto obrigatório, na própria regex: medido,
      // `isStrictPersonName` aceita "Superintendência de Fiscalização".)
      nomes_votacao_favor.push(nome);
    }
  }

  // Padrões A / B / C (frases narrativas — apenas nomes sem direção)
  for (const pattern of RE_VOTO_CONTEXTO) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const nome = m[1].replace(/\s+/g, " ").trim();
      if (nome.length > 4 && !nomes_votacao.includes(nome)) nomes_votacao.push(nome);
    }
  }

  // Adiciona signatários ao pool geral se ainda não encontrados
  for (const nome of signatarios) {
    if (!nomes_votacao.includes(nome)) nomes_votacao.push(nome);
  }

  // ─── Impedimento (etapa50) ─────────────────────────────────────────────
  // Vem ANTES de `favorPorDefault`: o impedido tem de sair do pool `nomes_votacao` também, senão
  // o ramo de unanimidade/default o transforma em "Favorável" — exatamente a fabricação que esta
  // etapa existe para eliminar. Quem a ata declara impedido não votou; não há default para ele.
  const nomes_votacao_impedido = extractImpedidos(text);
  if (nomes_votacao_impedido.length > 0) {
    const baldes = [
      nomes_votacao, nomes_votacao_favor, nomes_votacao_contra,
      nomes_votacao_abstencao, nomes_votacao_ausente,
    ];
    for (const nome of nomes_votacao_impedido) {
      for (const balde of baldes) {
        const i = balde.indexOf(nome);
        if (i !== -1) balde.splice(i, 1);
      }
    }
  }

  const semDirecaoExplicita =
    nomes_votacao_contra.length === 0 &&
    nomes_votacao_abstencao.length === 0 &&
    nomes_votacao_ausente.length === 0;

  let favorPorDefault = false;
  if (unanimidade_detectada && signatarios.length > 0) {
    // Unanimidade: signatários ainda não classificados → favor (idempotente; não
    // duplica nem sobrescreve divergências tabulares detectadas acima).
    const jaClassificado = new Set([
      ...nomes_votacao_favor, ...nomes_votacao_contra,
      ...nomes_votacao_abstencao, ...nomes_votacao_ausente,
      // O impedido ASSINA a ata (esteve na sessão) — sem esta linha a unanimidade o traria de
      // volta como favorável pelo bloco de assinatura, desfazendo a remoção acima.
      ...nomes_votacao_impedido,
    ]);
    for (const nome of signatarios) {
      if (!jaClassificado.has(nome)) nomes_votacao_favor.push(nome);
    }
  } else if (semDirecaoExplicita && nomes_votacao_favor.length === 0 && nomes_votacao.length > 0) {
    // Sem QUALQUER direção explícita → todos considerados a favor (comportamento anterior).
    nomes_votacao_favor.push(...nomes_votacao);
    favorPorDefault = true;
  }

  // ─── Voto dissidente / divergente / divergente ─────────────────────────────────────────
  // Move o diretor dissidente de _favor para _contra (se estava em favor).
  RE_VOTO_DISSIDENTE.lastIndex = 0;
  let diss: RegExpExecArray | null;
  while ((diss = RE_VOTO_DISSIDENTE.exec(text)) !== null) markContra(diss[1]);

  // Forma verbal: "X votou contrariamente", "X divergiu/discordou".
  RE_VOTO_DISSIDENTE_VERBAL.lastIndex = 0;
  let dissV: RegExpExecArray | null;
  while ((dissV = RE_VOTO_DISSIDENTE_VERBAL.exec(text)) !== null) markContra(dissV[1]);

  // Divergência NOMEADA — "aprovado por maioria ... com divergência apresentada pelo Diretor X"
  // (padrão dominante das atas ANM). Resolve cargo→nome pelo preâmbulo ("pelo Diretor-Geral").
  for (const nome of extractDivergentesNomeados(text, roleMapDoc)) markContra(nome);
  // Contrário citado só pelo cargo ("voto contrário do Diretor-Geral") — etapa51.
  for (const nome of extractContrariosPorCargo(text, roleMapDoc)) markContra(nome);

  RE_VOTO_AUSENTE.lastIndex = 0;
  let aus: RegExpExecArray | null;
  while ((aus = RE_VOTO_AUSENTE.exec(text)) !== null) {
    const nome = (aus[1] ?? aus[2] ?? "").replace(/\s+/g, " ").trim();
    if (nome.length > 4) {
      if (!nomes_votacao.includes(nome)) nomes_votacao.push(nome);
      const idxFavor = nomes_votacao_favor.indexOf(nome);
      if (idxFavor !== -1) nomes_votacao_favor.splice(idxFavor, 1);
      if (!nomes_votacao_ausente.includes(nome)) nomes_votacao_ausente.push(nome);
    }
  }

  RE_AUSENTE_LABEL.lastIndex = 0;
  let ausLabel: RegExpExecArray | null;
  while ((ausLabel = RE_AUSENTE_LABEL.exec(text)) !== null) {
    for (const nome of splitDirectorNames(ausLabel[1])) {
      if (!nomes_votacao.includes(nome)) nomes_votacao.push(nome);
      const idxFavor = nomes_votacao_favor.indexOf(nome);
      if (idxFavor !== -1) nomes_votacao_favor.splice(idxFavor, 1);
      if (!nomes_votacao_ausente.includes(nome)) nomes_votacao_ausente.push(nome);
    }
  }

  // Abstenção narrativa: "Fulano absteve-se" / "votou pela abstenção".
  RE_VOTO_ABSTENCAO.lastIndex = 0;
  let abs: RegExpExecArray | null;
  while ((abs = RE_VOTO_ABSTENCAO.exec(text)) !== null) {
    const nome = abs[1].replace(/\s+/g, " ").trim();
    if (nome.length > 4) {
      if (!nomes_votacao.includes(nome)) nomes_votacao.push(nome);
      const idxFavor = nomes_votacao_favor.indexOf(nome);
      if (idxFavor !== -1) nomes_votacao_favor.splice(idxFavor, 1);
      const idxContra = nomes_votacao_contra.indexOf(nome);
      if (idxContra !== -1) nomes_votacao_contra.splice(idxContra, 1);
      if (!nomes_votacao_abstencao.includes(nome)) nomes_votacao_abstencao.push(nome);
    }
  }

  // Contestado sem atribuição de dissidente → NÃO fabricar unanimidade. Item de maioria/empate/
  // voto de qualidade/vencido/prevaleceu em que o favor veio SÓ do default e nenhum contra foi
  // resolvido: esvazia o pool para o item ir à REVISÃO em vez de gravar todos como favoráveis (que
  // seria falso). SÓ o ramo default-favor (não o de unanimidade DECLARADA, que preserva votos
  // explícitos e cujo esvaziamento seria desfeito pela inferência de mandato). QA jul/2026 (F2).
  const voto_qualidade_por = extractVotoQualidade(text, roleMapDoc);
  if (favorPorDefault && nomes_votacao_contra.length === 0 && RE_CONTESTADO.test(text)) {
    nomes_votacao.length = 0;
    nomes_votacao_favor.length = 0;
  }
  // O voto de QUALIDADE entra DEPOIS do esvaziamento e INDEPENDE dele (etapa62). Ele é nomeado
  // pela própria ata e alinhado ao resultado que prevaleceu — é o voto de que temos MAIS certeza
  // no item inteiro. Prendê-lo ao ramo `favorPorDefault` o perdia justamente no caso em que
  // nenhum outro nome foi extraído, que é o item de empate típico.
  if (voto_qualidade_por && !nomes_votacao_contra.includes(voto_qualidade_por)) {
    if (!nomes_votacao.includes(voto_qualidade_por)) nomes_votacao.push(voto_qualidade_por);
    if (!nomes_votacao_favor.includes(voto_qualidade_por)) nomes_votacao_favor.push(voto_qualidade_por);
  }

  // Remove palavra-função ("Diretor", "Presidente"…) que vaza como nome em alguns
  // blocos de assinatura → não vira voto nem candidato-lixo.
  const semRole = (arr: string[]) => arr.filter((n) => !isRoleWordOnly(n));

  const nomes_presentes = extractPresentes(text);

  return {
    numero_deliberacao,
    reuniao_ordinaria,
    numero_reuniao,
    tipo_reuniao,
    data_reuniao,
    data_publicacao,
    interessado,
    processo,
    assunto,
    procedencia,
    relator,
    resultado,
    juizo,
    voto_qualidade_por,
    decisoes_todas,
    pauta_interna,
    resumo_pleito,
    fundamento_decisao,
    nomes_votacao: semRole(nomes_votacao),
    nomes_votacao_favor: semRole(nomes_votacao_favor),
    nomes_votacao_contra: semRole(nomes_votacao_contra),
    nomes_votacao_abstencao: semRole(nomes_votacao_abstencao),
    nomes_votacao_ausente: semRole(nomes_votacao_ausente),
    nomes_votacao_impedido: semRole(nomes_votacao_impedido),
    signatarios: semRole(signatarios),
    diretores_detectados: semRole(diretores_detectados),
    unanimidade_detectada,
    nomes_presentes: semRole(nomes_presentes),
  };
}

// ─── Presentes declarados no documento ("Constituição:"/"Presentes:") ──────
// Padrão real das atas ARTESP: "Constituição: Presidência-PRE - Diretor-Presidente
// André Isper Rodrigues Barnabé, Diretoria 2 - DIR-DZ - Diretor Diego Albert Zanatto, …".
// Quem estava presente é o registro mais fiel de quem votou em unanimidade — melhor
// que o roster de mandatos (que pode estar vazio/errado).
const RE_PRESENTES_BLOCO = /(?:Constitui[cç][aã]o|Presentes?)\s*:\s*([\s\S]{0,700}?)(?:\n\s*\n|\.\s*\n|$)/i;

export function extractPresentes(text: string): string[] {
  const bloco = RE_PRESENTES_BLOCO.exec(text)?.[1];
  if (bloco) {
    const nomes: string[] = [];
    const re = new RegExp(`Diretor(?:a)?(?:[- ](?:Presidente|Geral))?\\s+(${NOME})`, "g");
    for (const match of bloco.matchAll(re)) {
      // O macro NOME aceita o conector "e" + palavra capitalizada — corta o rabo
      // institucional ("… Rudnik e Diretoria 4" → "… Rudnik").
      const nome = match[1].replace(/\s+e\s+(?:Diretoria|Presid[êe]ncia|Superintend[êe]ncia).*$/i, "").trim();
      if (nome && !nomes.includes(nome)) nomes.push(nome);
    }
    if (nomes.length) return nomes;
  }
  // Fallback ANM: as atas da ANM não têm bloco "Constituição:" — o roster está em
  // prosa no preâmbulo ("…presidida pelo Diretor-Geral, NOME, e contou com a presença
  // do Diretor Substituto NOME e do Diretor NOME…"). Sem ler isto, a ATA ANM ficava
  // sem roster e produzia 0 voto (dependia 100% do mandato). QA Etapa 19.
  const narrativo = extractPresentesNarrativo(text);
  if (narrativo.length) return narrativo;
  // Último recurso (deliberações ARTESP): sem bloco Constituição e sem preâmbulo
  // narrativo, o único roster no documento é o rodapé de assinaturas inline. Alimenta
  // presentesRoster e tira os votos da dependência exclusiva do seed de mandato. QA jul/2026.
  return extractSignatariosInline(text);
}

// Zona do preâmbulo onde a ANM lista quem presidiu/compareceu (limita o escopo para
// não pescar "o Diretor relator X" dos itens lá embaixo).
// `sob a presidência` e `presentes os Diretores` são as fórmulas da ANTT — sem elas o roster das
// atas da ANTT saía VAZIO, e sem roster não há inferência de voto nenhuma naquela agência.
const RE_ROSTER_ZONA = /(?:presidid[ao][\s\S]{0,40}?Diretor|sob\s+a\s+presid[êe]ncia|contou\s+com\s+a\s+presen[cç]a|estiveram\s+presentes|presentes\s+os\s+[Dd]iretores|compareceram|com\s+a\s+participa[cç][aã]o)[\s\S]{0,600}/i;
// Forma de LISTA da ANTT: um único rótulo "Diretores" seguido de vários nomes separados por
// vírgula e "e". O RE_ROSTER_DIRETOR exige o rótulo colado a CADA nome, então via só o primeiro.
// A janela fecha no ";" porque logo depois vêm Procurador, Ouvidor e Secretaria — que não votam.
// Duas formas reais: "presentes os Diretores A, B, C e D" (1.024ª) e "…do Diretor-Geral X, dos
// Diretores A, B, C e D" (264ª RDE).
const RE_ROSTER_LISTA_ANTT = /(?:presentes\s+os|d[oa]s)\s+[Dd]iretores\s+([^;.]{10,400})/i;
// "sob a presidência do Diretor-Geral, NOME" — quem preside também é diretor presente.
// "sob a presidência do Diretor-Geral, NOME" (1.024ª) e "com a participação do Diretor-Geral
// NOME" (264ª) — quem preside/participa também é diretor presente.
const RE_ROSTER_PRESIDENTE = new RegExp(
  `(?:sob\\s+a\\s+presid[êe]ncia|com\\s+a\\s+participa[çc][ãa]o)\\s+d[oa]\\s+[Dd]iretor[a]?(?:[-\\s]Geral)?,?\\s+(${NOME})`,
  "i",
);
// Nome SEM o conector "e" isolado (o macro NOME global o inclui e mesclaria dois
// diretores adjacentes: "…Neves e do Diretor Caio…"). Aceita só "de/da/do/dos/das".
// {1,6} p/ não truncar nomes longos ("José Fernando de Mendonça Gomes Júnior" = 6 tokens).
const NOME_SEM_E = "[A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][a-záéíóúâêôãõçàü]+(?:\\s+(?:d[aeo]s?|[A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][a-záéíóúâêôãõçàü]+)){1,6}";
// Modificador de cargo tolera QUEBRA DE LINHA ([-\s] em vez de [- ]): no PDF da ANM
// vem "Diretor\nSubstituto Luiz…" — sem isto "Substituto" vazava para dentro do nome
// capturado ("Substituto Luiz Paniago Neves" casava só 0.62). QA Etapa 21.
const RE_ROSTER_DIRETOR = new RegExp(`Diretor(?:a)?(?:[-\\s](?:Geral|Presidente|Substitut[oa]))?\\s*,?\\s+(${NOME_SEM_E})`, "g");

export function extractPresentesNarrativo(text: string): string[] {
  const zona = RE_ROSTER_ZONA.exec(text)?.[0];
  if (!zona) return [];
  const nomes: string[] = [];

  // ANTT: presidente + lista de diretores. Vem ANTES do laço genérico para que a ordem do
  // documento seja preservada (o Diretor-Geral primeiro).
  const presidente = RE_ROSTER_PRESIDENTE.exec(zona)?.[1];
  if (presidente) {
    const limpo = presidente.replace(/\s+/g, " ").trim();
    if (isLikelyPersonName(limpo) && !nomes.includes(limpo)) nomes.push(limpo);
  }
  const lista = RE_ROSTER_LISTA_ANTT.exec(zona)?.[1];
  if (lista) {
    for (const nome of splitDirectorNames(lista)) {
      if (!nomes.includes(nome)) nomes.push(nome);
    }
  }
  for (const match of zona.matchAll(RE_ROSTER_DIRETOR)) {
    const nome = match[1]
      // Rede: remove palavra-função à esquerda que possa ter vazado (Substituto/Geral…).
      .replace(/^(?:substitut[oa]|geral|presidente|adjunt[oa])\s+/i, "")
      .replace(/\s+(?:na|no|em|ao)\s.*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (nome && nome.split(/\s+/).length >= 2 && !isRoleWordOnly(nome) && !nomes.includes(nome)) nomes.push(nome);
  }
  return nomes;
}

// ─── Votos explícitos por item de ata ─────────────────────────────────────
export interface ItemVotes {
  favor: string[];
  contra: string[];
  abstencao: string[];
  ausente: string[];
  /** Diretores presentes que NÃO votaram este item (impedimento/suspeição). */
  impedido: string[];
  /** Avisos ao revisor — divergência declarada sem dissidente imputável (etapa51). */
  avisos: string[];
  /** Diretor que proferiu o voto de qualidade neste item (etapa62). */
  voto_qualidade_por: string | null;
}

const RE_VOTARAM_FAVOR = new RegExp(
  `Vot(?:aram|ou)\\s+(?:a\\s+)?favor(?:avelmente|[aá]ve(?:l|is))?(?:\\s+(?:os?|as?))?\\s+(?:Diretor(?:es|as)?\\s+|Conselheiro(?:s|as)?\\s+)?([^.\\n;]{4,180})`,
  "gi",
);
const RE_VOTARAM_CONTRA = new RegExp(
  `Vot(?:aram|ou)\\s+(?:contr[aá]ri(?:amente|os?|as?)?|contra)(?:\\s+(?:os?|as?))?\\s+(?:Diretor(?:es|as)?\\s+|Conselheiro(?:s|as)?\\s+)?([^.\\n;]{4,180})`,
  "gi",
);

/**
 * Extrai votos EXPLÍCITOS de um item de ata (favor/contra/abstenção/ausente).
 * Conservador de propósito: NÃO aplica default-favor nem pool de signatários
 * (que só fazem sentido no documento inteiro) — a inferência por mandato fica
 * downstream (vote-inference). Antes os votos por item eram sempre [], fazendo a
 * inferência inverter votos contrários reais.
 */
export function extractItemVotes(text: string, roleMap: Record<string, string> = {}): ItemVotes {
  const favor: string[] = [];
  const contra: string[] = [];
  const abstencao: string[] = [];
  const ausente: string[] = [];
  const push = (arr: string[], raw: string) => {
    const nome = raw.replace(/\s+/g, " ").trim();
    if (nome.length > 4 && !arr.includes(nome)) arr.push(nome);
  };
  /**
   * Favor TAMBÉM grava voto (etapa66) — `buildVotoRows` transforma esta lista em linhas
   * `tipo_voto: "Favoravel"`. A validação de nome deixou de ser privilégio do lado contrário:
   * `RE_VOTARAM_FAVOR` aceita 180 chars de complemento livre com flag `i` (que anula a
   * capitalização exigida pelo macro NOME) e o destino não checava nada, enquanto o gêmeo
   * `RE_VOTARAM_CONTRA`, com a MESMA janela, ia para `moveToContra` e era validado.
   * ⚠️ Latente: medido, nenhuma das duas dispara nas 16 fixtures. Entra pela simetria.
   */
  const pushFavorValidado = (raw: string) => {
    const nome = raw.replace(/\s+/g, " ").trim();
    if (!isStrictPersonName(nome)) return;
    push(favor, nome);
  };

  // Etapa65 — mesma trava do documento, e AQUI ela é precisa: o texto do item traz a frase de
  // divergência e o dispositivo juntos, então "venceu" e "foi vencido" se referem ao MESMO item.
  const autoresAprovado = new Set(extractAutoresDoVotoAprovado(text, roleMap));
  const moveToContra = (raw: string) => {
    const nome = raw.replace(/\s+/g, " ").trim();
    if (nome.length <= 4) return;
    // Mesma validação estrita do markContra do documento: contra grava VOTO (QA ago/2026).
    if (!isStrictPersonName(nome)) return;
    if (autoresAprovado.has(nome)) return;
    const i = favor.indexOf(nome);
    if (i !== -1) favor.splice(i, 1);
    if (!contra.includes(nome)) contra.push(nome);
  };

  // Tabular direcional "Nome – Favorável/Contrário/Abstenção/Ausente"
  RE_VOTO_DIRECAO.lastIndex = 0;
  let vd: RegExpExecArray | null;
  while ((vd = RE_VOTO_DIRECAO.exec(text)) !== null) {
    const nome = vd[1].replace(/\s+/g, " ").trim();
    const tipo = vd[2].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (tipo.includes("ausente")) push(ausente, nome);
    else if (tipo.startsWith("absten")) push(abstencao, nome);
    else if (tipo.startsWith("favor")) pushFavorValidado(nome);
    // Etapa66 — `push(contra, …)` cru pulava `isStrictPersonName` E `autoresAprovado`: era o
    // único caminho de CONTRA fora do helper, e portanto o único furo na trava da etapa65.
    else moveToContra(nome);
  }

  // "Votaram a favor os Diretores X, Y e Z" / "Votou contra o Diretor W"
  RE_VOTARAM_FAVOR.lastIndex = 0;
  let vf: RegExpExecArray | null;
  while ((vf = RE_VOTARAM_FAVOR.exec(text)) !== null) {
    for (const nome of splitDirectorNames(vf[1])) pushFavorValidado(nome);
  }
  RE_VOTARAM_CONTRA.lastIndex = 0;
  let vcc: RegExpExecArray | null;
  while ((vcc = RE_VOTARAM_CONTRA.exec(text)) !== null) {
    for (const nome of splitDirectorNames(vcc[1])) moveToContra(nome);
  }

  // Dissidente/divergente/vencido (nominal e verbal) → contra
  for (const re of [RE_VOTO_DISSIDENTE, RE_VOTO_DISSIDENTE_VERBAL]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) moveToContra(m[1]);
  }

  // Divergência NOMEADA ("com divergência apresentada pelo Diretor X"). O cargo ("Diretor-Geral")
  // é resolvido pelo roleMap montado do PREÂMBULO da ata (o texto do item não o tem). Sem isto, os
  // itens ANM de maioria com divergência ficavam SEM voto nenhum (esteira de votos QA jul/2026).
  for (const nome of extractDivergentesNomeados(text, roleMap)) moveToContra(nome);

  // Voto contrário citado só pelo CARGO ("com voto contrário do Diretor-Geral, relator original").
  // Mesma resolução pelo preâmbulo — sem ela a divergência real do DG na 32ª REP é perdida.
  for (const nome of extractContrariosPorCargo(text, roleMap)) moveToContra(nome);

  // Adesão/divergência ao relator
  RE_VOTO_CONCORDANCIA.lastIndex = 0;
  let vc: RegExpExecArray | null;
  while ((vc = RE_VOTO_CONCORDANCIA.exec(text)) !== null) {
    if (/^(?:divergi|discord)/.test((vc[2] ?? vc[3] ?? "").toLowerCase())) moveToContra(vc[1]);
    else push(favor, vc[1]);
  }

  // Ausência narrativa (dois grupos de captura)
  RE_VOTO_AUSENTE.lastIndex = 0;
  let au: RegExpExecArray | null;
  while ((au = RE_VOTO_AUSENTE.exec(text)) !== null) push(ausente, au[1] ?? au[2] ?? "");

  // Abstenção narrativa (move de favor/contra para abstenção)
  RE_VOTO_ABSTENCAO.lastIndex = 0;
  let ab: RegExpExecArray | null;
  while ((ab = RE_VOTO_ABSTENCAO.exec(text)) !== null) {
    // Etapa66 — MESMA normalização do doc-level. Sem colapsar o espaço, um nome quebrado por wrap
    // do PDF não casa o `indexOf` abaixo e NÃO é removido de favor/contra: o mesmo diretor passa a
    // contar duas vezes, como favorável E como abstenção.
    const nome = ab[1].replace(/\s+/g, " ").trim();
    if (nome.length <= 4) continue;
    const i = favor.indexOf(nome);
    if (i !== -1) favor.splice(i, 1);
    const j = contra.indexOf(nome);
    if (j !== -1) contra.splice(j, 1);
    if (!abstencao.includes(nome)) abstencao.push(nome);
  }

  // Impedimento tem PRECEDÊNCIA sobre todos os baldes: quem não votou não pode figurar como
  // favorável, contrário, abstenção nem ausente. É essa remoção que impede a fabricação — o
  // diretor sai do pool inteiro e a inferência por mandato não o alcança.
  // Voto de QUALIDADE (etapa62): quem desempata vota, e vota com o lado que prevaleceu. É o voto
  // mais bem documentado de um item de empate — e o único que a ata NOMEIA.
  const qualidadePor = extractVotoQualidade(text, roleMap);
  if (qualidadePor && !favor.includes(qualidadePor) && !contra.includes(qualidadePor)) {
    favor.push(qualidadePor);
  }

  const impedido = extractImpedidos(text);
  const removeImpedido = (arr: string[]) => {
    for (const nome of impedido) {
      const i = arr.indexOf(nome);
      if (i !== -1) arr.splice(i, 1);
    }
  };
  for (const arr of [favor, contra, abstencao, ausente]) removeImpedido(arr);

  const semRole = (arr: string[]) => arr.filter((n) => !isRoleWordOnly(n));
  const contraFinal = semRole(contra);
  const aviso = detectDivergenciaNaoAtribuida(text, contraFinal.length);
  return {
    favor: semRole(favor),
    contra: contraFinal,
    abstencao: semRole(abstencao),
    ausente: semRole(ausente),
    impedido: semRole(impedido),
    avisos: aviso ? [aviso] : [],
    voto_qualidade_por: qualidadePor,
  };
}

// ─── Confiança de extração (ponderada) ───────────────────────────────────
// Pesos refletem a importância de cada campo para identificar a deliberação.
// Soma dos pesos = 1.0 quando todos os campos estão presentes.
export function calcConfidence(fields: ExtractedFields): number {
  const weights: [boolean, number][] = [
    [fields.numero_deliberacao !== null, 0.20], // campo identificador central
    [fields.data_reuniao       !== null, 0.16], // data sempre presente em deliberações
    [fields.resultado          !== null, 0.16], // decisão final
    [fields.interessado        !== null, 0.12], // quem fez o requerimento
    [fields.assunto            !== null, 0.10], // tema da deliberação
    [fields.processo           !== null, 0.10], // número do processo SEI
    [fields.resumo_pleito      !== null, 0.04], // resumo do pleito
    [fields.fundamento_decisao !== null, 0.02], // fundamento jurídico
    [fields.signatarios.length > 0,     0.06], // diretores no bloco de assinatura
    [fields.reuniao_ordinaria !== null,  0.04], // reunião identificada
  ];
  return weights.reduce((sum, [present, weight]) => sum + (present ? weight : 0), 0);
}
