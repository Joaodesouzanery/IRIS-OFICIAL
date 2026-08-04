/**
 * name-matcher.ts
 * Port de worker/app/pipeline/name_matcher.py
 * Fuzzy matching de nomes de diretores sem dependência externa.
 */

// ─── Similaridade de strings (Jaro-Winkler simplificado) ─────────────────
// Implementação sem biblioteca — substitui rapidfuzz/token_sort_ratio
export function tokenSortRatio(a: string, b: string): number {
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

// Nome A é uma abreviação ESTRITA de B (mesmo diretor grafado com menos sobrenomes):
// todos os tokens de A (sem acento, sem conectores) aparecem em B, A é MENOR que B, e
// primeiro+último token coincidem. Ex.: "Felipe Queiroz" ⊂ "Felipe Fernandes Queiroz".
// Conservador de propósito — só funde duplicata óbvia, não pessoas distintas.
export function isStrictAbbreviation(shortName: string, longName: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/).filter(Boolean);
  const conectores = new Set(["de", "da", "do", "das", "dos", "e"]);
  const strip = (t: string[]) => t.filter((x) => !conectores.has(x));
  const a = strip(norm(shortName));
  const b = strip(norm(longName));
  if (a.length < 2 || b.length < 2 || a.length >= b.length) return false;
  if (a[0] !== b[0]) return false; // primeiro nome tem de bater
  const setB = new Set(b);
  if (!a.every((t) => setB.has(t))) return false; // A ⊆ B
  // Prefixo ("Severino Medeiros" ⊂ "Severino Medeiros Ramos Neto") OU mesmo último
  // sobrenome ("Felipe Queiroz" ⊂ "Felipe Fernandes Queiroz").
  const ehPrefixo = a.every((t, i) => t === b[i]);
  const mesmoUltimo = a[a.length - 1] === b[b.length - 1];
  return ehPrefixo || mesmoUltimo;
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

/**
 * Gera formas parciais de um nome completo (prefixo de tokens + primeiro+último +
 * primeiro+CADA sobrenome), para casar citações abreviadas com o nome completo do
 * diretor. "Alex Antonio de Azevedo Cruz" precisa casar "Alex Azevedo" (forma real
 * usada nas atas da ANTT — sem essa variante o match caía a ~0,60 e virava candidato).
 * Evita formas de 1 token (ambíguas demais).
 */
export function deriveNomeVariantes(nome: string): string[] {
  const tokens = nome.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return [];
  const conectores = new Set(["de", "da", "do", "das", "dos", "e"]);
  const variantes = new Set<string>();
  variantes.add(`${tokens[0]} ${tokens[1]}`);                 // primeiros dois
  variantes.add(`${tokens[0]} ${tokens[tokens.length - 1]}`); // primeiro + último
  variantes.add(tokens.slice(0, 3).join(" "));                // primeiros três
  // primeiro + cada sobrenome intermediário ("Alex Azevedo", "Alex Antonio"…)
  for (const sobrenome of tokens.slice(1)) {
    if (!conectores.has(sobrenome.toLowerCase())) variantes.add(`${tokens[0]} ${sobrenome}`);
  }
  // Variante "sem patronímico do meio": remove cada par (conector + palavra seguinte),
  // ex.: "José Fernando de Mendonça Gomes Júnior" → "José Fernando Gomes Júnior".
  // Casa o nome OFICIAL COMPLETO (seed) com a citação abreviada usada nos documentos —
  // sem isso o par ficava em 0.68 (faixa candidato) e criava um diretor DUPLICADO.
  const semPatronimico: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (conectores.has(tokens[i].toLowerCase()) && i + 1 < tokens.length) { i++; continue; }
    semPatronimico.push(tokens[i]);
  }
  if (semPatronimico.length >= 2 && semPatronimico.length < tokens.length) {
    variantes.add(semPatronimico.join(" "));
  }
  variantes.delete(nome);
  return [...variantes];
}

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
    // Compara com nome principal, variantes cadastradas e formas derivadas.
    const candidates = [dir.nome, ...dir.nome_variantes, ...deriveNomeVariantes(dir.nome)];
    for (const cand of candidates) {
      const score = tokenSortRatio(rawName, cand);
      if (score > bestScore) {
        bestScore = score;
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

// ─── Validação de nome de pessoa ──────────────────────────────────────────
// Palavras-função que NÃO são nome de pessoa (evita candidatos-lixo tipo "Diretor").
const ROLE_WORDS = new Set([
  "diretor", "diretora", "diretorgeral", "diretorpresidente", "diretorsubstituto",
  "diretorasubstituta", "presidente", "vicepresidente", "conselheiro", "conselheira",
  "relator", "relatora", "secretario", "secretaria", "procurador", "procuradora",
  "superintendente", "substituto", "substituta", "geral", "interino", "interina",
  "suplente", "membro", "representante", "coordenador", "coordenadora", "assessor",
]);
const NAME_CONNECTORS = new Set(["de", "da", "do", "das", "dos", "e"]);

function nameTokens(raw: string): string[] {
  return (raw ?? "")
    .replace(/[.\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, ""))
    .filter(Boolean);
}

/** true se o texto é APENAS palavra(s)-função/conector (ex.: "Diretor", "Diretor-Geral"). */
export function isRoleWordOnly(raw: string): boolean {
  const tokens = nameTokens(raw);
  const nonConnector = tokens.filter((t) => !NAME_CONNECTORS.has(t));
  if (nonConnector.length === 0) return true;
  return nonConnector.every((t) => ROLE_WORDS.has(t));
}

/**
 * Heurística: o texto parece um NOME DE PESSOA — ≥2 tokens de conteúdo (nome +
 * sobrenome), ≥5 chars, e não é só palavra-função. Gate para criar candidato de diretor.
 */
export function isLikelyPersonName(raw: string): boolean {
  const cleaned = (raw ?? "").replace(/[.\-]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 5) return false;
  const tokens = nameTokens(raw);
  const content = tokens.filter((t) => !NAME_CONNECTORS.has(t) && !ROLE_WORDS.has(t) && t.length >= 2);
  return content.length >= 2;
}

// Palavras que denunciam PROSA/instituição capturada como "nome" (QA ago/2026: a ata 32 da ANM
// gravava "Diretoria Colegiada da ANM pode" e "voto por" como dissidentes junto dos reais).
const NOT_A_NAME_WORDS = new Set([
  "diretoria", "colegiada", "colegiado", "agencia", "agência", "anm", "antt", "artesp",
  "voto", "votos", "votou", "pode", "sera", "será", "sendo", "processo", "reuniao", "reunião",
  "item", "pauta", "ata", "materia", "matéria", "decisao", "decisão", "pelo", "pela",
]);
const NAME_PARTICLES = new Set(["de", "da", "do", "das", "dos", "e", "d"]);
const NAME_SUFFIXES = new Set(["jr", "jr.", "junior", "júnior", "neto", "filho", "sobrinho", "segundo"]);

/**
 * Validação ESTRITA de nome de pessoa — usada onde o nome vira VOTO (dissidente/contra):
 * todo token precisa ser Capitalizado (ou partícula de/da/do/e, ou sufixo Jr/Neto/Filho),
 * e nenhum token pode ser palavra de prosa/instituição. Mais rígida que isLikelyPersonName
 * (que é só o gate de candidato). "Tasso Mendonça Jr" ✓ · "voto por" ✗ · "Diretoria
 * Colegiada da ANM pode" ✗.
 */
export function isStrictPersonName(raw: string): boolean {
  if (!isLikelyPersonName(raw)) return false;
  const tokens = (raw ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (tokens.length < 2 || tokens.length > 7) return false;
  let capitalized = 0;
  for (const t of tokens) {
    const lower = t.toLocaleLowerCase("pt-BR").replace(/[.,;]$/, "");
    if (NOT_A_NAME_WORDS.has(lower)) return false;
    if (NAME_PARTICLES.has(lower) || NAME_SUFFIXES.has(lower)) continue;
    // Token de conteúdo: precisa começar com maiúscula (aceita acento) e seguir minúsculas/acentos.
    if (!/^[A-ZÀ-Ý]/.test(t)) return false;
    capitalized++;
  }
  return capitalized >= 2;
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
