/**
 * A amostra ESTRATIFICADA da auditoria de votos (Fase 31).
 *
 * ═══ Por que a amostra simples não serve para conferir ═══
 * A amostra que já existe (`amostra-auditoria.ts`, aba "Votos dos Diretores") sorteia deliberações
 * ao acaso dentro da agência. Com ~98% dos votos sendo inferidos por unanimidade e favoráveis, um
 * sorteio uniforme devolve, quase sempre, cinco linhas do MESMO caso — e conferir cinco vezes o
 * caso fácil não diz nada sobre o difícil.
 *
 * Aqui a amostra é montada por COTAS: primeiro garante um exemplar de cada situação que o revisor
 * precisa ver (o raro antes do comum), depois completa com o resto. É a diferença entre "cinco
 * linhas" e "cinco linhas que cobrem o espaço".
 *
 * ⚠️ E ela DECLARA o que não conseguiu preencher. Uma cota vazia é informação — "não existe
 * divergência nominal na ARTESP" é um achado —, e devolver quatro linhas fingindo que são cinco
 * seria o silêncio que esta base inteira existe para não ter.
 *
 * Determinística por `seed`, como a irmã: o mesmo seed devolve a mesma amostra, então um achado
 * pode ser reaberto exatamente. Sem seed, o dia serve de semente.
 */

import { prng, seedDe } from "@/lib/server/amostra-auditoria";
import { tipoVotoInferido } from "@/lib/server/vote-inference";

/** O mínimo que uma linha precisa ter para ser estratificada. */
export interface LinhaAmostravel {
  voto_id: string;
  agencia: string | null;
  origem: "lido" | "inferido";
  resultado: string | null;
  motivo_nao_voto: string | null;
  is_divergente: boolean | null;
  /** `ata` | `deliberacao` | `voto` | … — de que documento a linha nasceu. */
  tipo_documento: string | null;
}

/**
 * As situações que a amostra tenta cobrir, EM ORDEM DE PRIORIDADE.
 *
 * A ordem não é estética: as primeiras são raras (um impedimento em mil votos), e preencher o
 * comum primeiro consumiria as vagas antes de o raro ter chance. Greedy pela cota mais escassa.
 */
export const COTAS = [
  "ausencia_ou_impedimento",
  "divergencia_nominal",
  "fonte_voto_individual",
  "fonte_deliberacao",
  "fonte_ata",
  "desfecho_indeferido",
  "desfecho_deferido",
  "origem_lido",
  "origem_inferido",
] as const;
export type Cota = (typeof COTAS)[number];

/** A que fonte a linha pertence. `documento_pai_id` vira `ata` no chamador; aqui é o tipo cru. */
function fonteDa(l: LinhaAmostravel): Cota | null {
  const t = (l.tipo_documento ?? "").toLowerCase();
  if (t.includes("ata")) return "fonte_ata";
  if (t.includes("voto")) return "fonte_voto_individual";
  if (t.includes("delibera")) return "fonte_deliberacao";
  return null;
}

/** Que cotas esta linha satisfaz. Uma linha pode servir a várias — e serve, de propósito. */
export function cotasDaLinha(l: LinhaAmostravel): Cota[] {
  const c: Cota[] = [];
  if (l.motivo_nao_voto) c.push("ausencia_ou_impedimento");
  // Divergência NOMINAL: divergir é interessante; divergir num voto que o documento nomeou é o
  // caso que de fato se confere contra o PDF. Divergência inferida é consequência de regra.
  if (l.is_divergente === true && l.origem === "lido") c.push("divergencia_nominal");
  const fonte = fonteDa(l);
  if (fonte) c.push(fonte);
  // Desfecho pela MESMA função que decide a direção do voto inferido — uma fonte, não duas.
  const direcao = tipoVotoInferido(l.resultado);
  if (direcao === "Desfavoravel") c.push("desfecho_indeferido");
  if (direcao === "Favoravel") c.push("desfecho_deferido");
  c.push(l.origem === "lido" ? "origem_lido" : "origem_inferido");
  return c;
}

export interface AmostraDaAgencia {
  agencia: string;
  linhas: LinhaAmostravel[];
  /** Cotas que NÃO existem no universo desta agência. Vazio é bom; não-vazio é achado. */
  cotas_sem_exemplar: Cota[];
  /** Cotas que existem mas não couberam em `n`. Diferente de não existir. */
  cotas_fora_do_tamanho: Cota[];
  universo: number;
}

/**
 * `n` linhas por agência, cobrindo o máximo de cotas.
 *
 * ⚠️ `cotas_sem_exemplar` e `cotas_fora_do_tamanho` são coisas DIFERENTES e por isso não se
 * fundem: a primeira diz "a agência não tem nenhum caso assim" (achado sobre o dado); a segunda
 * diz "tem, mas não coube em 5" (parâmetro da amostra). Achatá-las faria uma ausência real passar
 * por limitação de tamanho.
 */
export function amostrarEstratificado(
  linhas: LinhaAmostravel[],
  opcoes: { porAgencia?: number; seed?: string } = {},
): AmostraDaAgencia[] {
  const n = Math.max(1, Math.min(50, opcoes.porAgencia ?? 5));
  const semente = opcoes.seed ?? "sem-seed";

  const porAgencia = new Map<string, LinhaAmostravel[]>();
  for (const l of linhas) {
    const ag = l.agencia ?? "?";
    if (!porAgencia.has(ag)) porAgencia.set(ag, []);
    porAgencia.get(ag)!.push(l);
  }

  const saida: AmostraDaAgencia[] = [];
  for (const agencia of [...porAgencia.keys()].sort()) {
    const universo = porAgencia.get(agencia)!;
    // Embaralha com seed própria da agência: sem isso, agências diferentes receberiam a mesma
    // permutação de índices e a amostra teria viés de posição.
    const r = prng(seedDe(`${semente}|${agencia}`));
    const baralho = [...universo];
    for (let i = baralho.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [baralho[i], baralho[j]] = [baralho[j], baralho[i]];
    }

    const escolhidas: LinhaAmostravel[] = [];
    const jaEscolhido = new Set<string>();
    const existeNoUniverso = new Set<Cota>();
    for (const l of universo) for (const c of cotasDaLinha(l)) existeNoUniverso.add(c);

    // Greedy pela cota mais escassa primeiro.
    const cobertas = new Set<Cota>();
    for (const cota of COTAS) {
      if (escolhidas.length >= n) break;
      if (cobertas.has(cota)) continue;
      const alvo = baralho.find((l) => !jaEscolhido.has(l.voto_id) && cotasDaLinha(l).includes(cota));
      if (!alvo) continue;
      escolhidas.push(alvo);
      jaEscolhido.add(alvo.voto_id);
      for (const c of cotasDaLinha(alvo)) cobertas.add(c);
    }
    // Completa até `n` com o resto do baralho, na ordem já embaralhada.
    for (const l of baralho) {
      if (escolhidas.length >= n) break;
      if (jaEscolhido.has(l.voto_id)) continue;
      escolhidas.push(l);
      jaEscolhido.add(l.voto_id);
      for (const c of cotasDaLinha(l)) cobertas.add(c);
    }

    saida.push({
      agencia,
      linhas: escolhidas,
      cotas_sem_exemplar: COTAS.filter((c) => !existeNoUniverso.has(c)),
      cotas_fora_do_tamanho: COTAS.filter((c) => existeNoUniverso.has(c) && !cobertas.has(c)),
      universo: universo.length,
    });
  }
  return saida;
}
