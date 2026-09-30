/**
 * O GABARITO das atas certificadas — agora um módulo, e não um fixture de teste.
 *
 * ═══ Por que ele saiu de `__tests__/fixtures` ═══
 * O placar precisa publicar `certificacao_no_banco`: a subtração entre o que o gabarito manual diz e
 * o que o banco tem. Para isso o dado tem de estar alcançável pela ROTA, e uma rota não lê fixture
 * de teste — ou pior, lê com um caminho montado em runtime, que é exatamente o que a Fase 28 mediu
 * como "o arquivo estava no repositório e NÃO no bundle: 0 dos 183 `.nft.json` o citavam".
 *
 * ⚠️ É UM arquivo só, importado estaticamente pelos dois lados. Duplicar o JSON — uma cópia para o
 * teste e outra para a rota — criaria duas verdades sobre a mesma ata, e a divergência apareceria
 * como "o banco bate com o gabarito" num lado e não no outro.
 *
 * O conteúdo é o gabarito MANUAL: conferido contra os PDFs oficiais, com os votos esperados por
 * diretor, os itens sem decisão e as divergências já conhecidas (com a causa). Ele não é derivado do
 * banco — se fosse, certificar o banco contra ele seria tautologia.
 */

import baseline from "./votos-por-diretor-baseline.json";
import type { AtaDoGabarito } from "@/lib/server/certificacao-gabarito";

/** As chaves de prosa do arquivo (`_comment`, `_causas_das_divergencias`) não são atas. */
function ehAta(valor: unknown): valor is AtaDoGabarito {
  return Boolean(valor) && typeof valor === "object"
    && Array.isArray((valor as AtaDoGabarito).colegiado);
}

/** As atas, por nome de arquivo do PDF. */
export const GABARITO_POR_ARQUIVO: Record<string, AtaDoGabarito> = Object.fromEntries(
  Object.entries(baseline as Record<string, unknown>)
    .filter(([chave, valor]) => !chave.startsWith("_") && ehAta(valor)),
) as Record<string, AtaDoGabarito>;

export const ATAS_CERTIFICADAS: AtaDoGabarito[] = Object.values(GABARITO_POR_ARQUIVO);

/**
 * A ata do gabarito que corresponde a uma reunião do banco, casada por (agência, número).
 *
 * ⚠️ NÃO casa por data: a data é justamente o que o Bloco B está consertando, e casar por ela faria
 * o gabarito deixar de reconhecer exatamente as reuniões cuja data está errada — as que mais
 * precisam ser conferidas.
 */
export function gabaritoDaReuniao(agencia: string, numeroReuniao: string | null): AtaDoGabarito | null {
  const numero = numeroDaReuniao(numeroReuniao);
  if (numero === null) return null;
  const sigla = String(agencia ?? "").trim().toUpperCase();
  for (const ata of ATAS_CERTIFICADAS) {
    if (String(ata.agencia).trim().toUpperCase() !== sigla) continue;
    if (numeroDaReuniao(ata.reuniao) === numero) return ata;
  }
  return null;
}

/** "81ª ROP" → 81 · "1.024ª" → 1024 · "264ª RDE" → 264. */
export function numeroDaReuniao(valor: string | null | undefined): number | null {
  const texto = String(valor ?? "").replace(/\./g, "");
  const m = /(\d{1,5})/.exec(texto);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
