/**
 * O que fazer com cada documento preso em `queued` (Fase 29) — folha pura, decidida em lote.
 *
 * ═══ O defeito ═══
 * O reaper decidia documento a documento, com DUAS consultas por item: uma para achar o job
 * candidato pelo `file_hash` e outra para ler o status do job já vinculado. Com 25 documentos da
 * ARTESP presos em fila, isso são ~26 round-trips por passada — e o reaper roda duas vezes por
 * rodada. Os mesmos 25 que tornavam o reaper caro eram os que a extração nunca alcançava, porque
 * o reaper comia a fatia dela. Um laço que se alimenta.
 *
 * Aqui a decisão vira pura: quem chama faz DUAS consultas em lote (`.in()`, o padrão que o reaper
 * do poço já usa) e esta função diz o desfecho de cada documento.
 *
 * ⚠️ Comportamento que TEM de sobreviver: a versão anterior usava `.maybeSingle()` na busca por
 * `file_hash`. Quando dois jobs compartilham o hash, o PostgREST devolve erro e o resultado vira
 * `null` — ou seja, o documento **não** é adotado. Em lote isso não acontece sozinho: é preciso
 * tratar "hash com mais de um candidato" como SEM candidato, explicitamente. Sem isso o reaper
 * passaria a adotar um job arbitrário entre dois, e `documentos_regulatorios.upload_job_id` é
 * UNIQUE — a escrita estouraria a constraint, ou pior, roubaria o job do dono certo.
 */

export type DesfechoDaReligacao = "adotar" | "religar" | "falhar" | "segue";

export interface DocumentoPreso {
  id: string;
  upload_job_id: string | null;
  file_hash: string | null;
}

export interface JobConhecido {
  id: string;
  status: string;
  documento_id?: string | null;
}

export interface PlanoDaReligacao {
  doc: DocumentoPreso;
  desfecho: DesfechoDaReligacao;
  /** Para `adotar`: o job a vincular. Para `religar`: o job a devolver para `pending`. */
  jobId: string | null;
  motivo: string;
}

/**
 * @param docs       os documentos presos em `queued` (janela do reaper, no máximo 50)
 * @param jobsPorId  jobs já vinculados, lidos em UMA consulta por `.in("id", …)`
 * @param jobsPorHash candidatos por `file_hash`, lidos em UMA consulta; a LISTA por hash, não um
 *                    único job — é o que permite detectar o hash ambíguo
 */
export function planejarReligacao(
  docs: DocumentoPreso[],
  jobsPorId: Map<string, JobConhecido>,
  jobsPorHash: Map<string, JobConhecido[]>,
): PlanoDaReligacao[] {
  return docs.map((doc) => {
    if (doc.upload_job_id) {
      const job = jobsPorId.get(doc.upload_job_id);
      // Job que não existe mais: o vínculo aponta para o vazio. Não é "segue" — é preso.
      if (!job) return { doc, desfecho: "falhar", jobId: null, motivo: "vinculo aponta para job inexistente" };
      // `pending` está legitimamente na fila; `processing` é do reaper #1, que roda antes nesta
      // mesma passada e o devolve para `pending`. Religar aqui brigaria com ele.
      if (job.status === "pending" || job.status === "processing") {
        return { doc, desfecho: "segue", jobId: job.id, motivo: `job ${job.status}` };
      }
      return { doc, desfecho: "religar", jobId: job.id, motivo: `job ${job.status} → pending` };
    }

    const candidatos = doc.file_hash ? jobsPorHash.get(doc.file_hash) ?? [] : [];
    // Hash ambíguo = SEM candidato. Ver o ⚠️ do cabeçalho: era o que o `.maybeSingle()` produzia.
    if (candidatos.length !== 1) {
      return {
        doc, desfecho: "falhar", jobId: null,
        motivo: candidatos.length === 0 ? "sem job e sem candidato" : `file_hash ambiguo (${candidatos.length} jobs)`,
      };
    }
    const cand = candidatos[0];
    // `upload_job_id` é UNIQUE: adotar job de outro dono estouraria a constraint.
    if (cand.documento_id !== null && cand.documento_id !== undefined && cand.documento_id !== doc.id) {
      return { doc, desfecho: "falhar", jobId: null, motivo: "candidato ja tem outro dono" };
    }
    return { doc, desfecho: "adotar", jobId: cand.id, motivo: "adotado pelo file_hash" };
  });
}
