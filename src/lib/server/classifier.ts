/**
 * classifier.ts
 * Classifica microtema e pauta interna por keywords determinísticas.
 * Keywords expandidas com base nas deliberações ARTESP reais (jan/2026).
 */

// ─── Dicionário de microtemas ─────────────────────────────────────────────
const MICROTEMA_KEYWORDS: Record<string, string[]> = {
  tarifa: [
    "tarifa", "reajuste tarifário", "revisão tarifária", "reajuste de tarifa",
    "reequilíbrio tarifário", "reequilibrio tarifario", "preço público",
    "taxa de pedágio", "pedágio", "tarifa de pedágio",
    "reajuste do pedágio", "impacto tarifário", "impacto proporcional",
    "passageiro equivalente", "linhas metropolitanas", "tarifa de transporte",
  ],
  obras: [
    "obra", "obras", "construção", "reforma", "ampliação", "duplicação",
    "pavimentação", "infraestrutura viária", "melhorias", "investimento em obra",
    "projeto executivo", "prazo de obra", "conservação de pavimento",
    "obras de ampliação", "obras de arte especiais", "conservação especial",
  ],
  multa: [
    "multa", "penalidade", "infração", "autuação", "auto de infração",
    "penalização", "sanção", "aplicação de multa", "recurso de multa",
  ],
  contrato: [
    "contrato", "concessão", "aditivo", "aditamento", "termo aditivo",
    "prorrogação de contrato", "rescisão", "subconcessão", "subconcessionária",
    "termo aditivo e modificativo", "modificativo", "prorrogar", "prorrogação",
    "vigência contratual", "consórcio supervisor", "contrato de concessão",
    "serviços técnicos especializados",
  ],
  reequilibrio: [
    "reequilíbrio econômico", "reequilibrio economico", "equilíbrio econômico-financeiro",
    "desequilíbrio", "fato imprevisível", "caso fortuito", "força maior",
    "revisão extraordinária", "desequilíbrio econômico-financeiro",
    "cronograma físico-financeiro", "adequação de cronograma",
  ],
  fiscalizacao: [
    "fiscalização", "vistoria", "inspeção", "auditoria", "relatório de fiscalização",
    "irregularidade", "notificação", "descumprimento", "inadimplemento",
    "coordenação", "monitoramento de pavimento", "inspeção de obras de artes",
  ],
  seguranca: [
    "segurança", "acidente", "risco", "sinalização", "capacete", "cinto",
    "segurança viária", "condições de tráfego", "manutenção preventiva",
    "saúde e segurança no trabalho",
  ],
  ambiental: [
    "ambiental", "meio ambiente", "licença ambiental", "impacto ambiental",
    "compensação ambiental", "fauna", "flora", "sustentabilidade",
    "programa ambiental",
  ],
  desapropriacao: [
    "desapropriação", "desapropriacao", "indenização", "faixa de domínio",
    "servidão administrativa", "área afetada", "proprietário",
  ],
  adimplencia: [
    "adimplência", "adimplencia", "adimplente", "declaração de adimplência",
    "adimplência contratual", "inadimplência contratual",
  ],
  pessoal: [
    "portaria", "designa", "designação", "substituição", "substitui",
    "cargo em comissão", "empregado", "servidor", "superintendência",
    "indicação para substituição", "cargo em comissão de comando",
    "impedimentos legais e temporários", "titular de cargo",
  ],
  usuario: [
    "usuário", "reclamação", "ouvidoria", "manifestação", "atendimento ao usuário",
    "queixa", "satisfação", "central de atendimento", "call center",
  ],
};

// ─── Microtemas ANM (mineração) ───────────────────────────────────────────
const MICROTEMA_KEYWORDS_ANM: Record<string, string[]> = {
  lavra: [
    "lavra", "concessão de lavra", "portaria de lavra", "requerimento de lavra",
    "requerimento de concessão de lavra", "prorrogação de prazo do requerimento de lavra",
    "caducidade de concessão de lavra", "caducidade da concessão",
    "requerimento de lavra", "requerimento de concessão",
  ],
  pesquisa: [
    "pesquisa", "alvará de pesquisa", "autorização de pesquisa",
    "relatório de pesquisa", "relatório final de pesquisa",
    "nulidade do alvará", "título autorizativo de pesquisa",
    "requerimento de autorização de pesquisa",
  ],
  licenciamento: [
    "registro de licença", "licenciamento", "guia de utilização",
    "registro de licenciamento", "renovação do registro de licença",
    "prorrogação de licenciamento", "prorrogação do registro de licença",
  ],
  servidao: [
    "servidão", "área de servidão", "laudo de servidão",
    "instituição de servidão", "servidão de solo",
    "requerimento de área de servidão",
  ],
  multa: [
    "multa", "auto de infração", "penalidade", "sanção",
    "recurso às multas", "imposição da multa",
  ],
  cfem: [
    "cfem", "compensação financeira", "royalties",
    "taxa anual por hectare", "tah", "refis",
  ],
  disponibilidade: [
    "disponibilidade de área", "disponibilidade", "caducidade",
    "decaimento", "bloqueio de área", "bloqueio parcial",
  ],
  recursos: [
    "recurso hierárquico", "recurso administrativo", "reconsideração",
    "pedido de reconsideração", "recurso contra", "análise de recurso",
  ],
  ambiental: [
    "ambiental", "unidade de conservação", "estação ecológica",
    "licenciamento ambiental", "meio ambiente",
  ],
};

// ─── Classificação de microtema ───────────────────────────────────────────
export interface ClassificationResult {
  microtema: string;
  confidence: number;
}

/**
 * Classifica microtema do texto.
 * @param text - texto do documento
 * @param agenciaSigla - sigla da agência (opcional) para usar dicionário específico
 */
export function classifyMicrotema(text: string, agenciaSigla?: string | null): ClassificationResult {
  const textLower = text.toLowerCase();

  // Selecionar dicionário baseado na agência
  const dictionaries: Record<string, string[]>[] = [MICROTEMA_KEYWORDS];
  if (agenciaSigla?.toUpperCase() === "ANM") {
    dictionaries.unshift(MICROTEMA_KEYWORDS_ANM); // ANM tem prioridade
  } else {
    dictionaries.push(MICROTEMA_KEYWORDS_ANM); // fallback
  }

  const scores = new Map<string, number>();
  for (const dict of dictionaries) {
    for (const [tema, keywords] of Object.entries(dict)) {
      let score = 0;
      for (const kw of keywords) {
        if (textLower.includes(kw.toLowerCase())) {
          // Frases mais específicas (mais palavras) valem mais — evita falso-positivo por palavras genéricas
          const wordCount = kw.trim().split(/\s+/).length;
          score += wordCount;
        }
      }
      if (score > 0) {
        scores.set(tema, (scores.get(tema) ?? 0) + score);
      }
    }
  }

  if (scores.size === 0) return { microtema: "outros", confidence: 0 };

  const totalScore = [...scores.values()].reduce((a, b) => a + b, 0);
  const [[bestTema, bestScore]] = [...scores.entries()].sort((a, b) => b[1] - a[1]);

  return { microtema: bestTema, confidence: bestScore / totalScore };
}

// ─── Classificação de pauta interna ──────────────────────────────────────
const PAUTA_INTERNA_KEYWORDS = [
  "pauta interna",
  "expediente interno",
  "assunto administrativo",
  "remuneração de diretores",
  "recursos humanos",
  "contratação de pessoal",
  "orçamento interno",
  "regimento interno",
  "resolução interna",
  "designação de empregado",
  "indicação para substituição",
  "cargo em comissão de comando",
  "empregado/servidor",
];

/**
 * Classifica se a deliberação é pauta interna.
 * @param text - texto completo do PDF
 * @param interessado - interessado extraído (se disponível)
 * @param agenciaSigla - sigla da agência (ex: "ARTESP") para detectar auto-referência
 */
export function classifyPautaInterna(
  text: string,
  interessado?: string | null,
  agenciaSigla?: string | null,
): boolean {
  const textLower = text.toLowerCase();

  // Keywords explícitas de pauta interna
  if (PAUTA_INTERNA_KEYWORDS.some((kw) => textLower.includes(kw))) return true;

  // Sem interessado externo → pauta interna
  if (!interessado) return true;

  // Interessado é a própria agência (ex: "ARTESP" como interessado)
  if (agenciaSigla) {
    const interessadoUpper = interessado.toUpperCase();
    const siglaUpper = agenciaSigla.toUpperCase();
    if (interessadoUpper.includes(siglaUpper) || interessadoUpper.includes("AGÊNCIA REGULADORA")) {
      return true;
    }
  }

  return false;
}

// ─── Detecção de agência reguladora no texto do PDF ───────────────────────
// Conta ocorrências de cada sigla conhecida e retorna a mais frequente.
// siglas: lista vinda da DB (produção) ou do modo demo.
export function detectAgenciaSigla(text: string, siglas: string[]): string | null {
  if (!text || siglas.length === 0) return null;
  const upper = text.toUpperCase();
  const scores = siglas
    .map((s) => ({ sigla: s, count: countOccurrences(upper, s.toUpperCase()) }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);
  return scores[0]?.sigla ?? null;
}

// QA ago/2026: fronteira de PALAVRA obrigatória — o indexOf puro fazia "ANS" casar dentro
// de "TRANSPORTES" e "ANA" dentro de "ANAC/SEMANA", e documentos ANTT/ARTESP eram gravados
// como ANS/ANA (agências fora do escopo de votos apareciam na Completude com deliberações).
function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let idx = 0;
  const isWordChar = (ch: string | undefined) => ch !== undefined && /[A-Z0-9À-Ü]/i.test(ch);
  while ((idx = text.indexOf(needle, idx)) !== -1) {
    const antes = text[idx - 1];
    const depois = text[idx + needle.length];
    if (!isWordChar(antes) && !isWordChar(depois)) count++;
    idx++; // avança para evitar loop infinito
  }
  return count;
}
