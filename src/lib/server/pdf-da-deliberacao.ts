/**
 * A URL assinada do PDF de origem de uma deliberação (Fase 29) — extraído de `auditoria/amostra`.
 *
 * ═══ Por que isto vira módulo ═══
 * Duas telas de auditoria precisam do mesmo caminho, e ele tem uma regra que NÃO é óbvia: um ITEM
 * DE ATA não tem PDF próprio — o arquivo está no documento PAI. Sem o fallback
 * `documento_pai_id ?? id`, a busca devolve 404 para a maioria dos itens da ANM e da ARTESP, que
 * são exatamente as agências cujas atas trazem dezenas de deliberações cada.
 *
 * ⚠️ Não usar `deliberacoes/[id]/download` para isso: aquela rota passa por `upload_job_id`, com
 * bucket fixo e sem o fallback do pai — 404 garantido em item de ata.
 *
 * ⚠️ E a assinatura é em LOTE (`createSignedUrls`, plural): uma página de 50 votos tem no máximo
 * 50 deliberações distintas e na prática ~10-15, porque um colegiado tem 3-5 diretores e cada
 * deliberação rende uma linha por diretor. Assinar uma a uma seriam dezenas de round-trips por
 * clique de paginação.
 *
 * ⚠️ Fase 31 — A PREMISSA ACIMA ("no máximo 50 distintas") VALIA SÓ PARA A TELA, e o CSV a violou:
 * o ramo de exportação lê o universo e mandou **595 ids, 23.312 chars de URL** — três vezes o
 * `urlLengthLimit` default do postgrest-js (8.000). Ele passou por pouco, enquanto a consulta
 * irmã de 820 ids (32.087 chars) voltou VAZIA e zerou uma coluna inteira do CSV. Era defeito
 * latente esperando mais uma deliberação. A leitura agora é em lotes, com o erro checado.
 */

import { lerEmLotes } from "@/lib/server/ler-em-lotes";

/** O que a deliberação precisa carregar para o PDF dela ser encontrado. */
export interface DeliberacaoComPai {
  id: string;
  documento_pai_id?: string | null;
}

export interface PdfDaDeliberacao {
  url: string | null;
  arquivo: string | null;
}

/** Uma hora. O suficiente para conferir na tela; curto o bastante para não virar link vazado. */
export const TTL_DA_URL_ASSINADA_S = 60 * 60;

/**
 * Devolve, por `deliberacao.id`, a URL assinada e o nome do arquivo. Deliberação sem documento
 * ligado sai com `{ url: null, arquivo: null }` — a tela mostra "sem PDF", que é a verdade, em vez
 * de um link quebrado.
 */
export async function assinarPdfsDasDeliberacoes(
  db: any,
  deliberacoes: DeliberacaoComPai[],
  ttlSegundos: number = TTL_DA_URL_ASSINADA_S,
): Promise<Map<string, PdfDaDeliberacao>> {
  const saida = new Map<string, PdfDaDeliberacao>();
  if (deliberacoes.length === 0) return saida;

  // Item de ata aponta para o PDF do PAI. É esta linha que evita o 404 na maioria da ANM/ARTESP.
  const paiOuEla = deliberacoes.map((d) => String(d.documento_pai_id ?? d.id));
  const docsRes = await lerEmLotes<any>(db, {
    tabela: "documentos_regulatorios",
    select: "deliberacao_id, filename, storage_bucket, storage_path",
    coluna: "deliberacao_id", valores: paiOuEla, label: "pdf-da-deliberacao/docs",
  });
  // Sem PDF a tela mostra "sem PDF", que é a verdade. Mas FALHA de leitura não é "sem PDF": ela
  // vira `null` em todas as linhas e ninguém sabe a diferença. O erro sobe.
  if (docsRes.error) throw new Error(`Falha ao ler os documentos das deliberações: ${String(docsRes.error)}`);
  const docs = docsRes.data;

  const docPorDelib = new Map<string, any>();
  for (const doc of ((docs ?? []) as any[])) {
    if (!docPorDelib.has(doc.deliberacao_id)) docPorDelib.set(doc.deliberacao_id, doc);
  }

  const porBucket = new Map<string, string[]>();
  for (const doc of docPorDelib.values()) {
    if (!doc.storage_path) continue;
    const bucket = doc.storage_bucket ?? "pdfs";
    porBucket.set(bucket, [...(porBucket.get(bucket) ?? []), doc.storage_path]);
  }
  const assinadas = new Map<string, string>();
  for (const [bucket, paths] of porBucket) {
    const { data: lista } = await db.storage.from(bucket).createSignedUrls(paths, ttlSegundos);
    for (const s of (lista ?? []) as Array<{ path?: string; signedUrl?: string }>) {
      if (s?.path && s.signedUrl) assinadas.set(`${bucket}|${s.path}`, s.signedUrl);
    }
  }

  for (const d of deliberacoes) {
    const doc = docPorDelib.get(String(d.documento_pai_id ?? d.id));
    saida.set(String(d.id), {
      url: doc?.storage_path ? assinadas.get(`${doc.storage_bucket ?? "pdfs"}|${doc.storage_path}`) ?? null : null,
      arquivo: doc?.filename ?? null,
    });
  }
  return saida;
}
