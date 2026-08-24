/**
 * ata-splitter.ts
 * Divide o texto de uma Ata de Reunião Pública (ANM e similares)
 * em items individuais, cada um representando uma deliberação.
 *
 * Formatos suportados:
 *   - Romano: "I- Processo: ...", "II- Processo: ..."
 *   - Numerado: "1.1.1. Processo nº ...", "1.2.3. Processo nº ..."
 *   - Misto: ambos em um mesmo documento
 */

import type { TipoDocumento } from "@/types";

// ─── Detecção de tipo de documento ──────────────────────────────────────
export function detectDocumentType(text: string): TipoDocumento {
  // Olha o CABEÇALHO e checa os atos numerados ANTES da ata: um documento
  // "DELIBERAÇÃO Nº X ... ata da 5ª reunião" é uma deliberação, não uma ata.
  const head = text.slice(0, 400);
  if (/DELIBERA[ÇC][AÃ]O\s*(?:ARTESP\s*)?N[ºo°]/i.test(head)) return "deliberacao";
  if (/RESOLU[ÇC][AÃ]O\s*N[ºo°]/i.test(head)) return "resolucao";
  if (/PORTARIA\s*N[ºo°]/i.test(head)) return "portaria";
  // PAUTA antes de ATA: "Pauta da Xª Reunião" que mencione "ata" no cabeçalho não pode
  // virar ata — pauta é agenda (nada foi decidido) e viraria votos fabricados.
  if (/\bPAUTA\b(?:\s+(?:DA|DE|DO))?\s*(?:\d+\s*[ªa°º]?\s*)?REUNI[AÃ]O/i.test(head)) return "pauta";
  // Ata tolera conectores: "ATA DA 5ª REUNIÃO", "ATA Nº 3 REUNIÃO", "ATA DA REUNIÃO".
  if (/\bATA\b(?:\s+(?:DA|DE|DO|N[ºo°]?))?\s*\d+\s*[ªa°º]?\s*REUNI[AÃ]O/i.test(head) ||
      /\bATA\s+DA\s+REUNI[AÃ]O/i.test(head)) {
    return "ata";
  }
  return "deliberacao";
}

// ─── Item de ata extraído ───────────────────────────────────────────────
export interface AtaItem {
  item_numero: string;          // "I", "II", "1.1.1", etc.
  processo: string | null;
  assunto: string | null;
  interessado: string | null;
  relator: string | null;
  decisao: string | null;       // texto completo da decisão
  resultado: string | null;     // normalizado: "Aprovado", "Indeferido", etc.
  unanimidade: boolean;
  raw_text: string;             // texto bruto do item
  // Avisos de QUALIDADE do split (ex.: possível sangria de itens) — rebaixam
  // a confiança e mandam o documento para revisão manual.
  warnings?: string[];
}

// ─── Metadados globais da ata ───────────────────────────────────────────
export interface AtaMetadata {
  numero_reuniao: string | null;
  tipo_reuniao: "Ordinaria" | "Extraordinaria" | null;
  data_reuniao: string | null;   // ISO: "YYYY-MM-DD"
  agencia_nome: string | null;   // ex: "Agência Nacional de Mineração"
  signatarios: string[];
}

// ─── Números por extenso → dígito ──────────────────────────────────────
const NUMEROS_EXTENSO: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, três: 3, tres: 3, quatro: 4,
  cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14,
  quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18,
  dezenove: 19, vinte: 20, "vinte e um": 21, "vinte e uma": 21,
  "vinte e dois": 22, "vinte e duas": 22, "vinte e três": 23,
  "vinte e tres": 23, "vinte e quatro": 24, "vinte e cinco": 25,
  "vinte e seis": 26, "vinte e sete": 27, "vinte e oito": 28,
  "vinte e nove": 29, trinta: 30, "trinta e um": 31,
  primeiro: 1, segundo: 2, terceiro: 3, quarto: 4, quinto: 5,
  sexto: 6, sétimo: 7, setimo: 7, oitavo: 8, nono: 9, décimo: 10, decimo: 10,
};

const MESES_EXTENSO: Record<string, number> = {
  janeiro: 1, fevereiro: 2, março: 3, marco: 3, abril: 4,
  maio: 5, junho: 6, julho: 7, agosto: 8,
  setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const ANOS_EXTENSO: Record<string, number> = {
  "dois mil e dezenove": 2019, "dois mil e vinte": 2020,
  "dois mil e vinte e um": 2021, "dois mil e vinte e dois": 2022,
  "dois mil e vinte e três": 2023, "dois mil e vinte e tres": 2023,
  "dois mil e vinte e quatro": 2024, "dois mil e vinte e cinco": 2025,
  "dois mil e vinte e seis": 2026, "dois mil e vinte e sete": 2027,
  "dois mil e dezoito": 2018, "dois mil e dezessete": 2017,
  "dois mil e dezesseis": 2016,
};

/**
 * Parseia data no formato ANM por extenso:
 * "Aos dezenove dias do mês de fevereiro do ano de dois mil e dezenove"
 */
export function parseDataExtensoANM(text: string): string | null {
  // "dias" é opcional: atas reais da ANM também escrevem "Aos vinte e três do mês de
  // fevereiro do ano de dois mil e vinte e seis" (82ª ROP) — sem a palavra "dias".
  const re = /[Aa]os?\s+(.+?)(?:\s+dias?)?\s+do\s+m[eê]s\s+de\s+(\w+)\s+do\s+ano\s+de\s+(.+?)(?:[,.]|\s+[,.]|\s+às)/i;
  const match = re.exec(text);
  if (!match) return null;

  const diaRaw = match[1].toLowerCase().trim();
  const mesRaw = match[2].toLowerCase().trim();
  const anoRaw = match[3].toLowerCase().trim();

  const dia = NUMEROS_EXTENSO[diaRaw] ?? parseInt(diaRaw, 10);
  const mes = MESES_EXTENSO[mesRaw];
  const ano = ANOS_EXTENSO[anoRaw] ?? parseInt(anoRaw, 10);

  if (!dia || !mes || !ano || dia < 1 || dia > 31 || ano < 1990) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

// ─── Extração de metadados globais da ata ───────────────────────────────
export function extractAtaMetadata(text: string): AtaMetadata {
  // Número da reunião: "ATA 1ª REUNIÃO" ou "ATA 3ª REUNIÃO"
  const reNumero = /ATA\s+(\d+)[ªa°º]?\s*REUNI[AÃ]O/i;
  const numero_reuniao = reNumero.exec(text)?.[1] ?? null;

  // Tipo: Ordinária ou Extraordinária
  const reTipo = /REUNI[AÃ]O\s+(ORDIN[AÁ]RIA|EXTRAORDIN[AÁ]RIA)/i;
  const tipoMatch = reTipo.exec(text);
  let tipo_reuniao: "Ordinaria" | "Extraordinaria" | null = null;
  if (tipoMatch) {
    tipo_reuniao = tipoMatch[1].toLowerCase().startsWith("extraordin")
      ? "Extraordinaria" : "Ordinaria";
  }

  // Data: formato extenso ANM
  const data_reuniao = parseDataExtensoANM(text);

  // Nome da agência
  const reAgencia = /(?:AG[ÊE]NCIA\s+NACIONAL\s+DE\s+\w+(?:\s+\w+)?)/i;
  const agencia_nome = reAgencia.exec(text)?.[0] ?? null;

  // Signatários: formato "Nome - Cargo" (ANM) e "Nome\nCargo" (ARTESP)
  const signatarios: string[] = [];
  // Formato ANM: "Nome - Diretor(a)"
  const reSignDash = /^\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][a-záéíóúâêôãõçàü\s]+)\s*[-–]\s*(?:Diretor[a]?(?:[- ]Geral)?(?:\s*Substitut[oa])?|Conselheiro|Presidente)/gm;
  // Remove bloco de assinatura eletrônica antes
  const textSemSEI = text.replace(/Documento assinado eletronicamente[\s\S]*?(?=A autenticidade|$)/g, "");

  let sig: RegExpExecArray | null;
  while ((sig = reSignDash.exec(textSemSEI)) !== null) {
    const nome = sig[1].trim();
    if (nome.length > 4 && !signatarios.includes(nome)) signatarios.push(nome);
  }

  return { numero_reuniao, tipo_reuniao, data_reuniao, agencia_nome, signatarios };
}

// ─── Split da ata em items ──────────────────────────────────────────────

// Padrões de separação de items
// Formato romano: "I- Processo:", "II- Interessado:", "XIII- Assunto:".
// Exige o RÓTULO de campo colado ao marcador → não casa prosa "I. Considerando que...".
const RE_ITEM_ROMANO = /^([IVXLC]+)\s*[-–.]\s*(?:Processo|Interessad[oa]|Assunto|Relat(?:or|ora))\b/i;
// Formato numerado: "1.1.1.", "1.2.3.", "2.4.1."
const RE_ITEM_NUMERADO = /^(\d+\.\d+(?:\.\d+)?)\s*[.)]?\s*/;
// Processo isolado com número romano prefixo: "I- Processo: 27214-848248/2014"
const RE_PROCESSO_LINE = /Processo(?:\s*n[ºo°]?)?\s*:?\s*([\d][\d\.\-\/]+)/i;
// Fronteira de SEÇÃO da ata (etapa53). O item só fechava quando o PRÓXIMO item abria, então o
// último item de cada seção absorvia a prosa de transição — medido: 12 itens nas duas atas ANM,
// de 2 a 4 linhas cada. O pior caso não é o ruído: os cabeçalhos "N. DIRETOR NOME" são o RELATOR
// da seção SEGUINTE, e esse nome entrando no item anterior atribui voto ao diretor errado.
// `\d+\.\s*DIRETOR` não colide com a numeração de item, que exige dois níveis (`\d+\.\d+`).
const RE_FIM_SECAO =
  /^(?:MAT[ÉE]RIAS?\b|APROVA[ÇC][ÃA]O\s+D[AE]\s+ATAS?\b|ENCERRAMENTO\b|\d+\.\s*DIRETOR(?:A|[-\s]GERAL)?\b)/i;

/**
 * Divide o texto de uma ata em items individuais.
 * Cada item corresponde a um processo/deliberação.
 */
function segmentAtaItems(text: string): AtaItem[] {
  const lines = text.split("\n");
  const items: AtaItem[] = [];
  let currentItem: { numero: string; lines: string[] } | null = null;

  // Fase 1: Segmentar por marcadores de item
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (currentItem) currentItem.lines.push("");
      continue;
    }

    // Fronteira de seção FECHA o item corrente (etapa53). As linhas seguintes, até o próximo
    // marcador de item, são prosa de transição da ata — não pertencem a item nenhum.
    if (RE_FIM_SECAO.test(trimmed)) {
      if (currentItem && currentItem.lines.length > 0) {
        const parsed = parseAtaItem(currentItem.numero, currentItem.lines.join("\n"));
        if (parsed) items.push(parsed);
      }
      currentItem = null;
      continue;
    }

    // Tenta detectar início de novo item
    let itemStart = false;
    let itemNumero = "";

    // Formato romano: "I- Processo:" / "VII- Interessado:" (rótulo já exigido na regex).
    const romanoMatch = RE_ITEM_ROMANO.exec(trimmed);
    if (romanoMatch) {
      itemStart = true;
      itemNumero = romanoMatch[1];
    }

    // Formato numerado: "1.1.1. Processo nº" / "2.3.1. Interessado:" / "...Relator:"
    if (!itemStart) {
      const numMatch = RE_ITEM_NUMERADO.exec(trimmed);
      if (numMatch) {
        const hasLabelInline = /processo|interessado|assunto|relat(?:or|ora)/i.test(trimmed);
        // Tolerância a WRAP do PDF: "1.2.3" sozinho na linha e o rótulo na linha
        // seguinte ("Processo nº ..."). Sem isso o item não abre e os votos dele
        // grudam no item anterior (sangria).
        const nextLine = (lines[i + 1] ?? "").trim();
        const hasLabelNextLine = trimmed.replace(numMatch[0], "").trim() === ""
          && /^(?:Processo|Interessad[oa]|Assunto|Relat(?:or|ora))\b/i.test(nextLine);
        if (hasLabelInline || hasLabelNextLine) {
          itemStart = true;
          itemNumero = numMatch[1];
        }
      }
    }

    if (itemStart) {
      // Salva item anterior se existir
      if (currentItem && currentItem.lines.length > 0) {
        const parsed = parseAtaItem(currentItem.numero, currentItem.lines.join("\n"));
        if (parsed) items.push(parsed);
      }
      currentItem = { numero: itemNumero, lines: [trimmed] };
    } else if (currentItem) {
      currentItem.lines.push(trimmed);
    }
  }

  // Último item
  if (currentItem && currentItem.lines.length > 0) {
    const parsed = parseAtaItem(currentItem.numero, currentItem.lines.join("\n"));
    if (parsed) items.push(parsed);
  }

  return normalizeNumericAtaHierarchy(items);
}

/**
 * Divide o texto de uma ata em itens individuais, já deduplicados.
 * Cada item corresponde a um processo/deliberação.
 */
export function splitAtaItems(text: string): AtaItem[] {
  return splitAtaItemsWithStats(text).items;
}

/**
 * Igual a `splitAtaItems`, mas devolve também os números da dedup para gravar em `raw_extraction`.
 * `itens_pre_dedup` é o que a reconciliação de âncoras (etapa63) compara — comparar contra o
 * pós-dedup transformaria uma dedup CORRETA em alarme permanente.
 */
export function splitAtaItemsWithStats(text: string): AtaSplitStats {
  return dedupeIntraAta(normalizeNumericAtaHierarchy(segmentAtaItems(text)));
}

// ─── Parser de item individual ──────────────────────────────────────────

function parseAtaItem(numero: string, rawText: string): AtaItem | null {
  // Processo
  const processoMatch = RE_PROCESSO_LINE.exec(rawText);
  const processo = processoMatch?.[1]?.trim() ?? null;

  // Assunto
  const reAssunto = /Assunto:\s*([\s\S]+?)(?=\n\s*(?:Processo|Interessad[oa]|Relat(?:or|ora)|VOTO|Decis[aã]o)\b|$)/i;
  const assunto = cleanAtaField(reAssunto.exec(rawText)?.[1]) ?? null;

  // Interessado(a)
  const reInteressado = /Interessad[oa]\(?a?\)?\s*:\s*([\s\S]+?)(?=\n\s*(?:Relat(?:or|ora)|VOTO|Decis[aã]o|Processo)\b|$)/i;
  const interessado = cleanAtaField(reInteressado.exec(rawText)?.[1]) ?? null;

  // Relator(a) — vai até a próxima seção, sem truncar no "." de abreviações ("Dr.", "A.").
  const reRelator = /Relat(?:or|ora)\s*:\s*(?:Diretor[a]?(?:[- ]Geral)?\s+)?([\s\S]+?)(?=\n\s*(?:Processo|Interessad[oa]|Assunto|VOTO|Voto|Decis[aã]o)\b|$)/i;
  // Corte de PROSA (QA ago/2026): a captura preguiçosa ainda engolia frase inteira quando a
  // seção seguinte não vinha ("…Neves para a relatoria da matéria por ele pautada:") — o nome
  // termina na primeira palavra de prosa/":" e nunca passa de 8 tokens.
  const relatorBruto = cleanAtaField(reRelator.exec(rawText)?.[1]);
  const relator = relatorBruto
    ? relatorBruto
        .split(":")[0]
        .replace(/\s+(?:para|pela|pelo|que|com|por|restituiu\S*|passou|concedeu?|relatoria|presid[êe]ncia|mat[ée]ria\S*|pautad[ao]s?)\b[\s\S]*$/i, "")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .slice(0, 8)
        .join(" ") || null
    : relatorBruto;

  // Decisão (texto completo). `DELIBERAÇÃO:` é a âncora REAL das atas ANM — medido: 28 ocorrências
  // na 82ª e 43 na 32ª, contra ZERO de `Decisão:`. Sem ela, `item.decisao` saía null em 100% dos 89
  // itens das duas atas e o resultado era inferido do rawText INTEIRO, que carrega relatório,
  // sustentação oral e prosa histórica do item vizinho. A janela fecha no próximo rótulo forte.
  // A janela fecha no PARÁGRAFO (linha em branco) ou no próximo rótulo forte. O corte por parágrafo
  // é o que separa o DISPOSITIVO da narrativa que vem depois dele — e essa separação é material:
  // na 82ª/2.3.1 o parágrafo seguinte relata o pedido de vista da SESSÃO ANTERIOR, e enquanto ele
  // ficava dentro da "decisão" o item decidido por unanimidade era classificado como retirado.
  const reDecisao =
    /(?:Decis[aã]o|DELIBERA[ÇC][AÃ]O)\s*:\s*([\s\S]+?)(?=\n\s*\n|\n\s*(?:VOTO[^:\n]{0,40}:|Voto:|PROCESSO\s*N|ASSUNTO\s*:|INTERESSAD[OA])|$)/i;
  const decisao = reDecisao.exec(rawText)?.[1]?.trim() ?? null;

  // Resultado / Voto
  const reVoto = /Voto:\s*([\s\S]+?)(?=\n[A-Z]|\n\d|$)/i;
  const votoText = reVoto.exec(rawText)?.[1]?.trim() ?? null;

  let resultado: string | null = null;
  // Negação-aware (F5): "não/sem unanimidade" NÃO conta — senão o item indeferido-por-maioria
  // cairia no ramo de unanimidade e viraria "Aprovado por Unanimidade".
  const unanimidade =
    /unanimidade/i.test(rawText) &&
    !/\bn[aã]o\s+(?!obstante\b)(?:\S+\s+){0,3}unanimidade|\bsem\s+unanimidade/i.test(rawText);

  // Sobrestamento/retirada/pedido de vista valem sobre o item INTEIRO e têm PRECEDÊNCIA: mesmo que
  // o "Voto:" traga uma proposta positiva ("VOTO pela aprovação…"), a deliberação NÃO se concluiu
  // (foi sobrestada por pedido de vista) → não gera decisão nem voto final. Antes o "Voto:" era
  // avaliado primeiro e o item de maioria/sobrestado virava "Aprovado" (QA jul/2026). NÃO casa
  // "Voto Vista" (rótulo de ASSUNTO, item que ESTÁ sendo decidido) — só sobrest/retirada/pedido.
  const suspenso = RE_SUSPENSAO.test(rawText);
  // Voto VENCEDOR (ANM): tem precedência sobre o `Voto:` genérico e sobre o rawText, porque é o
  // único texto que corresponde ao que o colegiado efetivamente decidiu.
  const votoPrevalecente = pickVotoPrevalecente(rawText, decisao);

  // …MAS a menção a vista/sobrestamento é HISTÓRICA quando o próprio dispositivo conclui a matéria.
  // Medido na 82ª/2.3.1: "DELIBERAÇÃO: Voto do Relator … aprovado por unanimidade pelos membros da
  // Diretoria Colegiada" e, logo depois, o RELATO de que houve pedido de vista NA SESSÃO ANTERIOR
  // ("tendo o Diretor Tasso Mendonça Júnior pedido vista na ocasião"). O gate global lia esse
  // passado como presente e enterrava um item efetivamente DECIDIDO — com todos os seus votos.
  // Exige as DUAS condições: dispositivo conclusivo E nenhuma suspensão DENTRO do dispositivo —
  // senão "deliberação sobrestada … aprovado o pedido de vista" escaparia pelo verbo "aprovado".
  const decididoNoDispositivo =
    !!decisao && RE_DISPOSITIVO_CONCLUSIVO.test(decisao) && !RE_SUSPENSAO.test(decisao);

  if (suspenso && !decididoNoDispositivo) {
    resultado = "Retirado de Pauta";
  } else if (votoPrevalecente) {
    resultado = inferResultadoFromText(votoPrevalecente, unanimidade);
  } else if (votoText) {
    // Delega à fonte única (precedência: retirado → indeferido/negar provimento →
    // deferido → aprovado). Antes "aprovado" era testado ANTES de "indeferido",
    // invertendo "aprovado o voto que NEGA provimento" para Aprovado.
    resultado = inferResultadoFromText(votoText, unanimidade);
  }

  if (!resultado) {
    resultado = inferResultadoFromText(decisao ?? rawText, unanimidade);
  }

  // Pular items sem conteúdo útil (ex: "Aprovação das atas")
  if (!processo && !assunto && !interessado && !decisao) return null;

  // SANGRIA: mais de um rótulo "Processo:" dentro do mesmo item indica que um
  // cabeçalho de item falhou e o item vizinho foi engolido — os votos poderiam ser
  // atribuídos ao processo errado. Sinaliza para revisão manual (não auto-confirma).
  const processoLabels = rawText.match(/Processo(?:\s*n[ºo°]?)?\s*:/gi) ?? [];
  const warnings = processoLabels.length > 1
    ? [`Item ${numero}: ${processoLabels.length} rótulos "Processo" no mesmo item — possível sangria de itens; revisar divisão da ata.`]
    : undefined;

  return {
    item_numero: numero,
    processo,
    assunto,
    interessado,
    relator,
    decisao,
    resultado,
    unanimidade,
    raw_text: rawText,
    ...(warnings ? { warnings } : {}),
  };
}

export interface AtaSplitStats {
  items: AtaItem[];
  /** Itens ANTES da dedup — é este número que o C03 compara com a contagem de âncoras (etapa63). */
  itens_pre_dedup: number;
  duplicatas_removidas: number;
}

/**
 * Dedup INTRA-ATA: a MESMA matéria aparecendo duas vezes dentro do MESMO documento.
 *
 * Não é hipótese: a 82ª ROP traz o item 4.1.6, processo 48405.950567/2016-78, duas vezes — uma
 * ocorrência curta (979 caracteres, sem dispositivo completo) e uma longa (2.148). Sem dedup, o
 * processo entra duas vezes na base, o colegiado aparece votando duas vezes a mesma coisa e todo
 * denominador de "itens decididos" fica inflado.
 *
 * A chave exige PROCESSO: dois itens de mesmo número sem processo podem ser matérias distintas
 * (numeração reiniciada por seção), e fundi-las apagaria uma decisão real. Vence a ocorrência com
 * dispositivo; havendo dispositivo nas duas, a mais completa.
 */
export function dedupeIntraAta(items: AtaItem[]): AtaSplitStats {
  const resultado: AtaItem[] = [];
  const indicePorChave = new Map<string, number>();
  let duplicatas_removidas = 0;

  for (const item of items) {
    if (!item.processo) {
      resultado.push(item);
      continue;
    }
    const chave = `${item.item_numero}|${item.processo}`;
    const existente = indicePorChave.get(chave);
    if (existente === undefined) {
      indicePorChave.set(chave, resultado.length);
      resultado.push(item);
      continue;
    }
    duplicatas_removidas++;
    const atual = resultado[existente];
    const venceNovo = (!atual.decisao && !!item.decisao)
      || (!!atual.decisao === !!item.decisao && item.raw_text.length > atual.raw_text.length);
    if (venceNovo) resultado[existente] = item;
  }

  return { items: resultado, itens_pre_dedup: items.length, duplicatas_removidas };
}

function normalizeNumericAtaHierarchy(items: AtaItem[]): AtaItem[] {
  const parentSubjects = new Map<string, string>();
  const parentDecisions = new Map<string, string>();
  const normalized: AtaItem[] = [];

  for (const item of items) {
    if (isNumericParentHeader(item)) {
      if (item.assunto) parentSubjects.set(item.item_numero, item.assunto);
      if (item.decisao) parentDecisions.set(item.item_numero, item.decisao);
      continue;
    }

    const parentKey = findParentKey(item.item_numero);
    const inheritedSubject = parentKey ? parentSubjects.get(parentKey) : undefined;
    const inheritedDecision = parentKey ? parentDecisions.get(parentKey) : undefined;

    const merged: AtaItem = {
      ...item,
      assunto: item.assunto ?? inheritedSubject ?? null,
      decisao: item.decisao ?? inheritedDecision ?? null,
      raw_text: inheritedSubject && !item.raw_text.includes(inheritedSubject)
        ? `${inheritedSubject}\n${item.raw_text}`
        : item.raw_text,
    };

    // Só deriva resultado da decisão PRÓPRIA do item. Decisão HERDADA do cabeçalho-pai
    // não vira resultado do filho (o filho pode ter sido decidido diferente) — fica
    // null e o item vai para revisão em vez de receber o desfecho do vizinho.
    if (!merged.resultado && item.decisao) {
      merged.resultado = inferResultadoFromText(item.decisao, merged.unanimidade);
    }

    if (merged.processo || merged.assunto || merged.interessado || merged.decisao) {
      normalized.push(merged);
    }
  }

  return normalized;
}

// Suspensão da deliberação (retirada/sobrestamento/pedido de vista). NÃO casa "Voto Vista", que é
// rótulo de ASSUNTO — item que ESTÁ sendo decidido, não suspenso.
const RE_SUSPENSAO = /retirad[oa]\s+de\s+pauta|sobrest|ped(?:iu|ido)\s+(?:de\s+)?vistas?/i;
// Dispositivo CONCLUSIVO: a matéria foi decidida NESTA sessão. Usado só para tirar a precedência
// GLOBAL do gate de suspensão (etapa53) — nunca para inferir resultado, que continua saindo do
// voto vencedor.
const RE_DISPOSITIVO_CONCLUSIVO =
  /\b(?:aprovad[oa]|indeferid[oa]|deferid[oa]|providos?|improvidos?|ratificad[oa]|homologad[oa])\b|(?:dar|negar|deu|negou)\s+provimento/i;

// Bloco de voto por PAPEL. A ata ANM traz o voto do relator e, havendo dissenso, os votos dos
// revisores (primeiro/segundo/terceiro) — e é a linha `DELIBERAÇÃO:` que diz qual PREVALECEU.
const RE_BLOCO_VOTO_PAPEL =
  /VOTO\s+D[OA]\s+((?:PRIMEIR|SEGUND|TERCEIR|QUART)[OA])?\s*(RELATOR[A]?|REVISOR[A]?)[^:\n]{0,80}:\s*([\s\S]+?)(?=\n?\s*VOTO\s+D[OA]\s+(?:PRIMEIR|SEGUND|TERCEIR|QUART|RELATOR|REVISOR)|DELIBERA[ÇC][ÃA]O\s*:|$)/gi;
// "Voto do revisor aprovado por maioria" / "Voto do Terceiro Revisor … aprovado por unanimidade".
const RE_PREVALECEU_REVISOR = /\bvoto\s+d[oa]\s+((?:primeir|segund|terceir|quart)[oa]\s+)?revisor/i;

/**
 * Texto do voto que PREVALECEU, escolhido pela linha `DELIBERAÇÃO:`.
 *
 * Sem isto o resultado sai do voto do RELATOR mesmo quando ele foi VENCIDO — e o desfecho inverte.
 * Medido na 32ª REP: 4.4.1 tem "voto do revisor aprovado por maioria, com voto contrário do
 * Diretor-Geral, relator original"; o relator votou NEGAR PROVIMENTO e o revisor, que venceu, votou
 * DAR PROVIMENTO. Ler o relator ali grava "Indeferido" num recurso que foi PROVIDO.
 *
 * Devolve `null` quando o item não tem blocos de voto por papel (ARTESP/ANTT) — aí o caminho
 * antigo segue valendo, intacto.
 */
export function pickVotoPrevalecente(rawText: string, deliberacao: string | null): string | null {
  const blocos: { ordinal: string; papel: string; corpo: string }[] = [];
  RE_BLOCO_VOTO_PAPEL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_BLOCO_VOTO_PAPEL.exec(rawText)) !== null) {
    blocos.push({
      ordinal: (m[1] ?? "").toLowerCase(),
      papel: m[2].toLowerCase(),
      corpo: m[3],
    });
  }
  if (blocos.length === 0) return null;

  const relator = blocos.find((b) => b.papel.startsWith("relator")) ?? blocos[0];
  const mRev = deliberacao ? RE_PREVALECEU_REVISOR.exec(deliberacao) : null;
  if (!mRev) return relator.corpo;

  const revisores = blocos.filter((b) => b.papel.startsWith("revisor"));
  if (revisores.length === 0) return relator.corpo;

  // Ordinal explícito na deliberação ("Terceiro Revisor") manda; sem ele, o ÚLTIMO revisor é o
  // que fechou a votação.
  const ord = (mRev[1] ?? "").trim().toLowerCase().replace(/[oa]$/, "");
  const alvo = ord ? revisores.find((b) => b.ordinal.startsWith(ord)) : undefined;
  return (alvo ?? revisores[revisores.length - 1]).corpo;
}

function isNumericParentHeader(item: AtaItem): boolean {
  return /^\d+\.\d+$/.test(item.item_numero) && !item.processo && !!item.assunto;
}

function findParentKey(itemNumero: string): string | null {
  const match = /^(\d+\.\d+)\.\d+$/.exec(itemNumero);
  return match?.[1] ?? null;
}

export function inferResultadoFromText(text: string, unanimidade: boolean): string | null {
  // "ped(iu|ido) (de) vista(s)" cobre singular+plural; "voto vistas" mantido no PLURAL de
  // propósito (não casar o rótulo de assunto "Voto Vista", que é item EM decisão, não suspenso).
  if (/retirad[oa]\s+de\s+pauta|ped(?:iu|ido)\s+(?:de\s+)?vistas?|voto\s+vistas|sobrest/i.test(text)) {
    return "Retirado de Pauta";
  }
  // NEGATIVO antes do positivo. `\bindefer\w*` cobre indeferido/indeferida E as formas que o
  // particípio isolado deixava escapar — indeferi(mento|u|r) e o presente INDEFERE — que caíam no
  // ramo aprovado/unanimidade e INVERTIAM o resultado (item indeferido virava "Aprovado por
  // Unanimidade"). Alinha com o RE_RESULTADO do nlp-extractor (que já cobre essas formas).
  if (/\bindefer\w*|negad[oa]|improcedente|n[aã]o\s+dar\s+provimento|negar\s+provimento/i.test(text)) {
    return "Indeferido";
  }
  // `\bdefer\w*` (defere/deferir/deferimento/deferid[oa]); o indefer- já saiu no bloco negativo acima
  // e não casa aqui (sem \b antes de "defer" em "indeferido").
  if (/\bdefer\w*|dar\s+provimento|provimento\s+ao/i.test(text)) {
    return "Deferido";
  }
  if (/aprovad[oa]/i.test(text) || unanimidade) {
    return unanimidade ? "Aprovado por Unanimidade" : "Aprovado";
  }
  return null;
}

function cleanAtaField(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/\bVOTO\s*:.*$/i, "")
    .replace(/\bRelat(?:or|ora)\s*:.*$/i, "")
    .replace(/\bDecis[aã]o\s*:.*$/i, "")
    .trim()
    .replace(/[;,.]\s*$/, "");
  return cleaned.length >= 3 ? cleaned : null;
}
