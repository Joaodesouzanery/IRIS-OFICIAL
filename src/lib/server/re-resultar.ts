/**
 * O reparo dos filhos de ata que ficaram sem `resultado` (Fase 19).
 *
 * ═══ Por que é REPARO e não conserto ═══
 * A hipótese era "o extrator não captura a decisão dos itens de ata". Medi antes de escrever
 * código: `splitAtaItemsWithStats` sobre as 4 atas reais da ANM no repo dá **305 itens,
 * `semResultado = 0`** — e os 10 itens exatos da amostra de produção saem certos hoje
 * (1.6.1–1.6.6 = "Retirado de Pauta"). Os 232 do banco são passivo de um build anterior às
 * correções de 24/08 no `ata-splitter`. O extrator está bom; o dado velho é que está torto.
 *
 * ═══ Por que isso destrava VOTO ═══
 * `materializar-faltantes` exige `documento_pai_id && resultado` para um item de ata gerar linha
 * em `votos`. Sem `resultado` eles são invisíveis para o materializador — e para o denominador
 * das métricas. Reparar o campo é o que põe os votos no banco, sem código novo de inferência.
 */

/** O que o filho precisa ter para ser reparável, e o que se escreve nele. */
export interface FilhoDeAta {
  item_numero: string | null;
  numero_deliberacao: string | null;
  resultado: string | null;
  resumo_pleito: string | null;
}

export interface ItemDaAta {
  item_numero: string;
  resultado?: string | null;
  decisao?: string | null;
}

export interface PatchDeReparo {
  resultado: string;
  resumo_pleito?: string | null;
}

/**
 * O patch para UM filho, ou `null` quando não há o que reparar.
 *
 * As três recusas são a parte importante:
 *  · `resultado` já preenchido → reparo não reescreve história;
 *  · `numero_deliberacao` começando com `PAUTA-` → seriam votos fabricados a partir de uma
 *    AGENDA, o que `ata-splitter.ts:22-24` proíbe (e é a origem dos 35 filhos-fantasma da ANTT);
 *  · item correspondente sem desfecho → não se inventa dado que a ata não tem.
 */
export function casarResultadoDoItem(filho: FilhoDeAta, itensDaAta: ItemDaAta[]): PatchDeReparo | null {
  if (filho.resultado) return null;
  if ((filho.numero_deliberacao ?? "").startsWith("PAUTA-")) return null;
  if (!filho.item_numero) return null;

  const item = itensDaAta.find((i) => i.item_numero === filho.item_numero);
  if (!item?.resultado) return null;

  return {
    resultado: item.resultado,
    ...(filho.resumo_pleito ? {} : { resumo_pleito: item.decisao?.slice(0, 2000) ?? null }),
  };
}

/**
 * Conta reparos SEM mentir para cima.
 *
 * `supabase-js` devolve `{ error }` em vez de lançar: quem não desestrutura conta como gravado o
 * que não gravou. Medido no repo: ~47% das escritas não checam — e foi assim que o alarme da
 * Fase 18 ficou mudo por um dia inteiro. Seria contraditório inaugurar a skill `falha-silenciosa`
 * nesta fase e o código dela não passar pela própria regra.
 */
export async function contarReparos<T>(
  alvos: T[],
  gravar: (alvo: T) => Promise<{ error: { message: string } | null }>,
): Promise<{ reparadas: number; falhas: number }> {
  let reparadas = 0;
  let falhas = 0;
  for (const alvo of alvos) {
    const { error } = await gravar(alvo);
    if (error) {
      falhas++;
      console.warn(`[re-resultar] escrita falhou: ${error.message}`);
    } else {
      reparadas++;
    }
  }
  return { reparadas, falhas };
}
