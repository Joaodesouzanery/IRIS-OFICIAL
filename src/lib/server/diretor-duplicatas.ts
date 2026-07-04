// Auditoria de DIRETORES possivelmente duplicados no cadastro (Etapa 14-E).
// diretores não tem unique de nome; a esteira de candidatos pode ter criado
// "Alex Azevedo" ao lado de "Alex Antonio de Azevedo Cruz" antes da prevenção.
// Compara par a par (fuzzy do name-matcher) os aprovados de cada agência.
// Reusada pelo endpoint de auditoria, pelo alerta do saude-dados e pelo card da UI.

import { findBestMatch, tokenSortRatio, deriveNomeVariantes } from "@/lib/server/name-matcher";

type Db = any;

export interface DiretorDuplicataPar {
  agencia_id: string;
  agencia_sigla: string | null;
  score: number;
  // "keep" = o cadastro mais completo (nome mais longo/mais antigo); "dup" = suspeito.
  keep: { id: string; nome: string; votos?: number };
  dup: { id: string; nome: string; votos?: number };
}

export async function findDiretorDuplicatas(db: Db, opts: { agenciaId?: string | null } = {}): Promise<DiretorDuplicataPar[]> {
  let query = db
    .from("diretores")
    .select("id, nome, nome_variantes, agencia_id, created_at, agencia:agencias(sigla)")
    .eq("review_status", "aprovado")
    .limit(2000);
  if (opts.agenciaId) query = query.eq("agencia_id", opts.agenciaId);
  const { data: diretores, error } = await query;
  if (error || !diretores) return [];

  const porAgencia = new Map<string, Array<{ id: string; nome: string; nome_variantes: string[]; created_at: string | null; sigla: string | null }>>();
  for (const d of diretores) {
    const agenciaRel = (d as { agencia?: { sigla?: string } | { sigla?: string }[] }).agencia;
    const sigla = Array.isArray(agenciaRel) ? agenciaRel[0]?.sigla ?? null : agenciaRel?.sigla ?? null;
    const lista = porAgencia.get(d.agencia_id) ?? [];
    lista.push({
      id: d.id,
      nome: d.nome,
      nome_variantes: Array.isArray(d.nome_variantes) ? d.nome_variantes : [],
      created_at: d.created_at ?? null,
      sigla,
    });
    porAgencia.set(d.agencia_id, lista);
  }

  const pares: DiretorDuplicataPar[] = [];
  const vistos = new Set<string>();

  for (const [agenciaId, lista] of porAgencia) {
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i];
        const b = lista[j];
        const score = melhorScore(a, b);
        if (score < 0.85) continue;
        const parKey = [a.id, b.id].sort().join("|");
        if (vistos.has(parKey)) continue;
        vistos.add(parKey);
        // keep = nome mais completo (mais tokens); empate → o mais antigo.
        const aTokens = a.nome.trim().split(/\s+/).length;
        const bTokens = b.nome.trim().split(/\s+/).length;
        const keepA = aTokens !== bTokens
          ? aTokens > bTokens
          : (a.created_at ?? "") <= (b.created_at ?? "");
        const keep = keepA ? a : b;
        const dup = keepA ? b : a;
        pares.push({
          agencia_id: agenciaId,
          agencia_sigla: a.sigla,
          score: Math.round(score * 100) / 100,
          keep: { id: keep.id, nome: keep.nome },
          dup: { id: dup.id, nome: dup.nome },
        });
      }
    }
  }

  return pares.sort((x, y) => y.score - x.score);
}

function melhorScore(
  a: { nome: string; nome_variantes: string[] },
  b: { nome: string; nome_variantes: string[] },
): number {
  // Mesmo critério do matcher de ingestão: nome × (nome, variantes cadastradas,
  // variantes derivadas), nas duas direções.
  const viaMatcher = Math.max(
    findBestMatch(a.nome, [{ id: "b", nome: b.nome, nome_variantes: b.nome_variantes }]).score,
    findBestMatch(b.nome, [{ id: "a", nome: a.nome, nome_variantes: a.nome_variantes }]).score,
  );
  // Variante × variante (ex.: os dois cadastros são apelidos do mesmo nome real).
  let viaVariantes = 0;
  const varsA = [a.nome, ...a.nome_variantes, ...deriveNomeVariantes(a.nome)];
  const varsB = [b.nome, ...b.nome_variantes, ...deriveNomeVariantes(b.nome)];
  for (const va of varsA) {
    for (const vb of varsB) {
      const s = tokenSortRatio(va, vb);
      if (s > viaVariantes) viaVariantes = s;
    }
  }
  return Math.max(viaMatcher, viaVariantes);
}
