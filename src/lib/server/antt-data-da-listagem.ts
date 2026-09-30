/**
 * B.3 (Fase 36) — a data da reunião da ANTT, e o PORTÃO que decide se dá para confiar nela.
 *
 * ═══ Por que a ANTT é um caso separado ═══
 * A Janela C do `redatar` re-deriva a data pelo TEXTO, e a ANTT está fora de
 * `AGENCIAS_COM_ANCORA_CERTIFICADA`: o preâmbulo dela não foi conferido contra os PDFs, então a rota
 * não opina. Mas a ANTT tem uma fonte que as outras não têm: a própria listagem do site, coletada em
 * `antt_reunioes_coletadas`, com `numero`, `tipo` e `data_inicio`.
 *
 * ═══ O portão, e por que ele não é opcional ═══
 * Usar `data_inicio` sem conferir seria trocar uma data que eu não sei se está certa por outra que eu
 * também não sei. O gabarito tem DUAS atas da ANTT conferidas à mão contra os PDFs — a 1.024ª e a
 * 264ª RDE, **ambas de 2026-01-19**. Se a listagem reproduz essas duas, ela é testemunha; se não
 * reproduz, o erro está nela e aplicá-la espalharia o defeito por centenas de linhas.
 *
 * ⚠️ E o portão é FALSIFICÁVEL de propósito: duas atas de datas diferentes seriam um teste mais
 * forte, e não existem no gabarito. Então o resultado do portão sai publicado com quantas atas ele
 * conferiu — um "aprovado" sobre duas atas não pode ser lido como "a listagem está certa".
 */

export interface ReuniaoDaListagem {
  numero: string | null;
  tipo: string | null;
  data_inicio: string | null;
}

/** O que o gabarito afirma sobre uma reunião da ANTT. */
export interface AtaConferida {
  reuniao: string;
  data_reuniao: string;
}

export interface VereditoDoPortao {
  aprovado: boolean;
  conferidas: number;
  batem: number;
  divergem: Array<{ reuniao: string; no_gabarito: string; na_listagem: string | null }>;
  /** Por que reprovou, quando reprovou. */
  motivo: "aprovado" | "listagem_vazia" | "sem_ata_para_conferir" | "divergencia";
}

/** "1.024ª" → 1024 · "264ª RDE" → 264 · "1024" → 1024. */
export function numeroDaListagem(valor: string | null | undefined): number | null {
  const texto = String(valor ?? "").replace(/\./g, "");
  const m = /(\d{1,5})/.exec(texto);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A data que a listagem dá para um número de reunião.
 *
 * ⚠️ Devolve `null` quando MAIS DE UMA linha da listagem casa o número com datas diferentes. Escolher
 * uma delas seria adivinhar, e este é o caminho que vai ESCREVER data — o lado seguro é não saber.
 */
export function dataDaListagem(
  listagem: readonly ReuniaoDaListagem[],
  numeroReuniao: string | null,
): string | null {
  const alvo = numeroDaListagem(numeroReuniao);
  if (alvo === null) return null;
  const datas = new Set<string>();
  for (const r of listagem) {
    if (numeroDaListagem(r.numero) !== alvo) continue;
    const data = String(r.data_inicio ?? "").slice(0, 10);
    if (data) datas.add(data);
  }
  return datas.size === 1 ? [...datas][0] : null;
}

/**
 * O PORTÃO: a listagem reproduz as atas que o gabarito conferiu à mão?
 *
 * ⚠️ Listagem vazia REPROVA. Uma leitura que não trouxe nada não é evidência de nada, e o `every` de
 * um conjunto vazio devolveria `true` — é o formato de zero que este projeto mede desde a Fase 17
 * ("o que a coleta prova é `items.length === 0`").
 */
export function portaoDaListagemAntt(
  listagem: readonly ReuniaoDaListagem[],
  atasConferidas: readonly AtaConferida[],
): VereditoDoPortao {
  if (listagem.length === 0) {
    return { aprovado: false, conferidas: 0, batem: 0, divergem: [], motivo: "listagem_vazia" };
  }
  if (atasConferidas.length === 0) {
    return { aprovado: false, conferidas: 0, batem: 0, divergem: [], motivo: "sem_ata_para_conferir" };
  }
  const divergem: VereditoDoPortao["divergem"] = [];
  let batem = 0;
  for (const ata of atasConferidas) {
    const naListagem = dataDaListagem(listagem, ata.reuniao);
    if (naListagem !== null && naListagem === ata.data_reuniao) batem++;
    else divergem.push({ reuniao: ata.reuniao, no_gabarito: ata.data_reuniao, na_listagem: naListagem });
  }
  return {
    aprovado: divergem.length === 0,
    conferidas: atasConferidas.length,
    batem,
    divergem,
    motivo: divergem.length === 0 ? "aprovado" : "divergencia",
  };
}
