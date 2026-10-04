/**
 * IMQN rev2022 — a Matriz de Maturidade da Qualidade Normativa como DADO versionado, e o motor
 * que reproduz a fórmula da planilha oficial (`docs/metodologia/Matriz Qualidade Normativa_rev2022.xlsx`,
 * aba INDICADOR).
 *
 * ═══ O que a planilha faz, e o módulo antigo NÃO fazia ═══
 *  1. **10 critérios, não 6.** AIR e ARR têm três subcritérios cada — Capacitação 30%,
 *     Metodologia 35%, Processo 35% (INDICADOR!C3:E3 e J3:L3). O módulo antigo só os nomeava.
 *  2. **A nota se DISTRIBUI entre níveis.** Para cada critério a planilha tem 4 células de fração
 *     (linhas 5/7/9/11) e calcula `Σ valor_do_nível × fração` com valores 1,0 / 0,7 / 0,35 / 0.
 *     Um critério pode estar "metade Gerenciado, metade Inicial" (0,525). O módulo antigo só tinha
 *     uma nota por dimensão, cravada num nível.
 *  3. **Nível = conjunto de condições I–IV.** As abas AIR/PS/Estoque/Agenda/Processo/ARR listam as
 *     condições de cada nível. É delas que sai o que é COMPROVÁVEL — e daí a nota comprovada.
 *
 * ═══ A regra para sair das condições para as frações (convenção IRIS, declarada) ═══
 * A planilha deixa a distribuição ao avaliador. Para torná-la computável a partir de condições:
 * os níveis são CUMULATIVOS (Inicial → Gerenciado → Melhoria Contínua); o nível-base é o mais alto
 * cujas condições estão TODAS atendidas, junto com as de todos os níveis abaixo; a fração do nível
 * imediatamente acima é a PROPORÇÃO das condições dele que estão atendidas. Σ = 1 por construção.
 * Ex.: Inicial completo e 2 de 4 condições do Gerenciado → {inicial: 0,5, gerenciado: 0,5} → 0,525.
 * Condição de um nível acima de uma LACUNA não conta — maturidade não pula degrau.
 *
 * ⚠️ O módulo é PURO e recebe a matriz por parâmetro: uma versão futura (rev2026…) entra como outro
 * JSON, sem tocar o motor.
 */

import dadoRev2022 from "@/lib/server/imqn/rev2022.json";

export type NivelImqn = "inexistente" | "inicial" | "gerenciado" | "melhoria_continua";
export type NivelComCondicao = Exclude<NivelImqn, "inexistente">;
/** Do menos ao mais maduro — a ordem da cascata. */
export const NIVEIS_COM_CONDICAO: readonly NivelComCondicao[] = ["inicial", "gerenciado", "melhoria_continua"];

export type VerificabilidadeCondicao = "publica" | "interna";
export type VerificabilidadeCriterio = "publica" | "parcial" | "interna";

export interface CondicaoImqn {
  id: string;
  nivel: NivelComCondicao;
  ordem: string;
  texto: string;
  verificabilidade: VerificabilidadeCondicao;
  /** Por que só um dado interno a comprova (presente quando `interna`). */
  motivo?: string;
}

export interface CriterioImqn {
  codigo: string;
  nome: string;
  /** Peso do critério DENTRO da dimensão (0,30/0,35/0,35 em AIR e ARR; 1 nas demais). */
  peso_na_dimensao: number;
  coluna_planilha: string;
  verificabilidade: VerificabilidadeCriterio;
  resumo_niveis: Record<NivelImqn, string>;
  condicoes: CondicaoImqn[];
}

export interface DimensaoImqn {
  /** Mesmo id das dimensões de `QUALIDADE_CRITERIOS` (1 AIR … 6 ARR). */
  id: number;
  codigo: string;
  nome: string;
  /** Pontos no IMQN (soma 100). */
  peso: number;
  base_legal: string;
  base_legal_conferida: boolean;
  nota_base_legal?: string;
  criterios: CriterioImqn[];
}

export interface MatrizImqn {
  versao: string;
  titulo: string;
  fonte: string;
  valores_nivel: Record<NivelImqn, number>;
  classificacao_verificabilidade: string;
  dimensoes: DimensaoImqn[];
}

export const IMQN_REV2022 = dadoRev2022 as unknown as MatrizImqn;

export type Fracoes = Partial<Record<NivelImqn, number>>;
export type FracoesPorCriterio = Record<string, Fracoes>;

const TOLERANCIA = 1e-9;

/** As frações de UM critério: cada uma em [0,1] e somando exatamente 1. */
export function validarFracoes(f: Fracoes): { ok: true } | { ok: false; motivo: string } {
  let soma = 0;
  for (const [nivel, valor] of Object.entries(f)) {
    if (!["inexistente", "inicial", "gerenciado", "melhoria_continua"].includes(nivel)) {
      return { ok: false, motivo: `nível desconhecido: ${nivel}` };
    }
    if (typeof valor !== "number" || !Number.isFinite(valor) || valor < 0 || valor > 1) {
      return { ok: false, motivo: `fração de ${nivel} fora de [0,1]: ${String(valor)}` };
    }
    soma += valor;
  }
  if (Math.abs(soma - 1) > TOLERANCIA) return { ok: false, motivo: `Σ frações = ${soma}, deveria ser 1` };
  return { ok: true };
}

/**
 * A classificação de um critério (0..1) — linha a linha a fórmula da aba INDICADOR:
 * `M4·C5 + M6·C7 + M8·C9 + M10·C11`.
 *
 * ⚠️ Frações inválidas LANÇAM. Não há "melhor esforço" aqui: uma soma ≠ 1 produziria nota acima de
 * 100 ou abaixo do real, e o número iria para um ranking público.
 */
export function classificacaoDoCriterio(matriz: MatrizImqn, f: Fracoes): number {
  const v = validarFracoes(f);
  if (!v.ok) throw new Error(`frações inválidas: ${v.motivo}`);
  let total = 0;
  for (const [nivel, fracao] of Object.entries(f) as Array<[NivelImqn, number]>) {
    total += matriz.valores_nivel[nivel] * fracao;
  }
  return total;
}

/** Ver o cabeçalho: cascata cumulativa, fração do primeiro nível incompleto. Σ = 1. */
export function fracoesPelasCondicoes(criterio: CriterioImqn, atendidas: ReadonlySet<string>): Fracoes {
  let base: NivelImqn = "inexistente";
  for (const nivel of NIVEIS_COM_CONDICAO) {
    const doNivel = criterio.condicoes.filter((c) => c.nivel === nivel);
    const ok = doNivel.filter((c) => atendidas.has(c.id)).length;
    if (doNivel.length === 0 || ok === doNivel.length) {
      base = nivel;
      continue;
    }
    const p = ok / doNivel.length;
    return p > 0 ? { [base]: 1 - p, [nivel]: p } : { [base]: 1 };
  }
  return { [base]: 1 };
}

export interface ResultadoImqn {
  /** 0..100 */
  total: number;
  por_dimensao: Array<{ id: number; codigo: string; peso: number; classificacao: number; nota: number }>;
  por_criterio: Record<string, number>;
}

/**
 * IMQN a partir das frações de cada critério. Critério SEM frações conta como `inexistente` —
 * ausência de avaliação não é maturidade, e é isso que torna a nota comprovada honesta.
 */
export function imqnPorFracoes(matriz: MatrizImqn, fpc: FracoesPorCriterio): ResultadoImqn {
  const por_criterio: Record<string, number> = {};
  const por_dimensao = matriz.dimensoes.map((dim) => {
    let classificacao = 0;
    for (const crit of dim.criterios) {
      const c = classificacaoDoCriterio(matriz, fpc[crit.codigo] ?? { inexistente: 1 });
      por_criterio[crit.codigo] = c;
      classificacao += crit.peso_na_dimensao * c;
    }
    return { id: dim.id, codigo: dim.codigo, peso: dim.peso, classificacao, nota: classificacao * dim.peso };
  });
  const total = por_dimensao.reduce((s, d) => s + d.nota, 0);
  return { total, por_dimensao, por_criterio };
}

export function imqnPelasCondicoes(matriz: MatrizImqn, atendidas: ReadonlySet<string>): ResultadoImqn {
  const fpc: FracoesPorCriterio = {};
  for (const dim of matriz.dimensoes) {
    for (const crit of dim.criterios) fpc[crit.codigo] = fracoesPelasCondicoes(crit, atendidas);
  }
  return imqnPorFracoes(matriz, fpc);
}

/** Todas as condições que um documento PÚBLICO pode comprovar. */
export function condicoesPublicas(matriz: MatrizImqn): Set<string> {
  return new Set(matriz.dimensoes.flatMap((d) => d.criterios.flatMap((c) =>
    c.condicoes.filter((x) => x.verificabilidade === "publica").map((x) => x.id))));
}

export interface NotaComprovada {
  /** IMQN só com condições de evidência VALIDADA (0..100). */
  comprovada: number;
  /** O máximo que fontes PÚBLICAS conseguem provar: toda condição pública atendida, nenhuma interna. */
  maxima_verificavel_publica: number;
  maxima_teorica: 100;
  /** maxima_verificavel_publica / 100 — quanto da escala o público consegue provar. */
  cobertura_verificavel_pct: number;
  /** comprovada / 100. */
  cobertura_comprovada_pct: number;
  por_dimensao: Array<{ id: number; codigo: string; comprovada: number; maxima_verificavel_publica: number; peso: number }>;
}

/**
 * Nota comprovada × máxima possível.
 *
 * ⚠️ `comprovada` conta toda condição com evidência VALIDADA, inclusive interna (o órgão pode
 * fornecer o documento ao comitê do prêmio). Por isso ela PODE passar de
 * `maxima_verificavel_publica` — e quando passa, é porque houve evidência fornecida pelo órgão.
 */
export function notaComprovadaEMaxima(matriz: MatrizImqn, comprovadas: ReadonlySet<string>): NotaComprovada {
  const conhecidas = new Set(matriz.dimensoes.flatMap((d) => d.criterios.flatMap((c) => c.condicoes.map((x) => x.id))));
  const validas = new Set([...comprovadas].filter((id) => conhecidas.has(id)));
  const comp = imqnPelasCondicoes(matriz, validas);
  const max = imqnPelasCondicoes(matriz, condicoesPublicas(matriz));
  const arred = (n: number) => Math.round(n * 100) / 100;
  return {
    comprovada: arred(comp.total),
    maxima_verificavel_publica: arred(max.total),
    maxima_teorica: 100,
    cobertura_verificavel_pct: arred(max.total),
    cobertura_comprovada_pct: arred(comp.total),
    por_dimensao: matriz.dimensoes.map((d, i) => ({
      id: d.id,
      codigo: d.codigo,
      peso: d.peso,
      comprovada: arred(comp.por_dimensao[i].nota),
      maxima_verificavel_publica: arred(max.por_dimensao[i].nota),
    })),
  };
}
