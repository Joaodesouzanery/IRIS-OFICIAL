/**
 * name-matcher.ts
 * Port de worker/app/pipeline/name_matcher.py
 * Fuzzy matching de nomes de diretores sem dependência externa.
 */

// ─── Similaridade de strings (Jaro-Winkler simplificado) ─────────────────
// Implementação sem biblioteca — substitui rapidfuzz/token_sort_ratio
function tokenSortRatio(a: string, b: string): number {
  const tokensA = a
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)
    .sort()
    .join(" ");
  const tokensB = b
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)
    .sort()
    .join(" ");

  return levenshteinSimilarity(tokensA, tokensB);
}

function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] =
          1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
      }
    }
  }

  const distance = matrix[a.length][b.length];
  return 1 - distance / Math.max(a.length, b.length);
}

// ─── Tipos ────────────────────────────────────────────────────────────────
export interface DiretorRecord {
  id: string;
  nome: string;
  nome_variantes: string[];
}

export interface MatchResult {
  diretorId: string | null;
  score: number;
  needsReview: boolean;
  isNew: boolean;
}

// ─── Matching ─────────────────────────────────────────────────────────────
const MATCH_THRESHOLD = 0.85; // equivalente ao 85 do rapidfuzz

export function findBestMatch(
  rawName: string,
  diretores: DiretorRecord[]
): MatchResult {
  if (!rawName || rawName.trim().length < 3) {
    return { diretorId: null, score: 0, needsReview: true, isNew: true };
  }

  let bestScore = 0;
  let bestId: string | null = null;

  for (const dir of diretores) {
    // Compara com nome principal
    const score = tokenSortRatio(rawName, dir.nome);
    if (score > bestScore) {
      bestScore = score;
      bestId = dir.id;
    }

    // Compara com variantes
    for (const variante of dir.nome_variantes) {
      const varScore = tokenSortRatio(rawName, variante);
      if (varScore > bestScore) {
        bestScore = varScore;
        bestId = dir.id;
      }
    }
  }

  if (bestScore >= MATCH_THRESHOLD) {
    return { diretorId: bestId, score: bestScore, needsReview: false, isNew: false };
  }

  // Score alto mas abaixo do limiar — precisa revisão manual
  if (bestScore >= 0.6) {
    return { diretorId: bestId, score: bestScore, needsReview: true, isNew: false };
  }

  // Não encontrou — é um novo diretor
  return { diretorId: null, score: bestScore, needsReview: true, isNew: true };
}

// ─── Normalização de nome ─────────────────────────────────────────────────
export function normalizeName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// ─── Matching de empresas (interessado) ────────────────────────────────────
export interface EmpresaRecord {
  id: string;
  nome_normalizado: string;
  nome_variantes: string[];
}

/**
 * Chave canônica de uma razão social: remove acentos, caixa, pontuação e sufixos
 * societários (S.A., LTDA, EIRELI...) para colapsar variantes da mesma empresa.
 */
export function canonicalizeEmpresa(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,/\\()'"]+/g, " ")
    .replace(/\b(s\s*\/?\s*a|sa|ltda|eireli|epp|mei|me|cia|companhia|concessionaria|holding|participacoes|empreendimentos)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Igual a findBestMatch, mas comparando chaves canônicas de razão social. */
export function findBestEmpresaMatch(rawName: string, empresas: EmpresaRecord[]): MatchResult {
  const target = canonicalizeEmpresa(rawName);
  if (!target || target.length < 3) {
    return { diretorId: null, score: 0, needsReview: true, isNew: true };
  }
  let bestScore = 0;
  let bestId: string | null = null;
  for (const emp of empresas) {
    const candidates = [emp.nome_normalizado, ...emp.nome_variantes.map(canonicalizeEmpresa)];
    for (const c of candidates) {
      const score = tokenSortRatio(target, c);
      if (score > bestScore) { bestScore = score; bestId = emp.id; }
    }
  }
  if (bestScore >= MATCH_THRESHOLD) return { diretorId: bestId, score: bestScore, needsReview: false, isNew: false };
  if (bestScore >= 0.6) return { diretorId: bestId, score: bestScore, needsReview: true, isNew: false };
  return { diretorId: null, score: bestScore, needsReview: true, isNew: true };
}
