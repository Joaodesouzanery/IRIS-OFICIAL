/**
 * confirm-deliberacoes.ts
 * Núcleo de persistência de deliberações/votos confirmados.
 *
 * Extraído de app/api/v1/upload/confirm/route.ts para ser reutilizado tanto pela
 * confirmação humana (POST /upload/confirm) quanto pela auto-confirmação automática
 * (POST /upload/auto-confirm). O comportamento deve permanecer idêntico ao da rota original.
 */

import crypto from "crypto";
import { isAreaRegulatoria } from "@/lib/server/area-regulatoria";
import { findBestMatch, normalizeName } from "@/lib/server/name-matcher";
import {
  buildVotoRows,
  buildVotoRowsFromSuggestions,
  getActiveDiretoresForVote,
  shouldInferVotesFromMandate,
} from "@/lib/server/vote-inference";
import type { ConfirmDelib, ConfirmResult, Resultado } from "@/types";

export const RESULTADOS_VALIDOS = new Set<string>([
  "Deferido", "Indeferido", "Parcialmente Deferido", "Retirado de Pauta",
  "Ratificado", "Aprovado", "Aprovado com Ressalvas", "Aprovado por Unanimidade",
  "Recomendado", "Determinado", "Autorizado",
]);

export const MICROTEMAS_VALIDOS = new Set<string>([
  "tarifa", "obras", "multa", "contrato", "reequilibrio",
  "fiscalizacao", "seguranca", "ambiental", "desapropriacao",
  "adimplencia", "pessoal", "usuario",
  "lavra", "pesquisa", "licenciamento", "servidao", "cfem",
  "disponibilidade", "recursos",
  "outros",
]);

const RE_ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS_REUNIAO_VALIDOS = new Set(["Ordinaria", "Extraordinaria"]);
const TIPOS_DOCUMENTO_VALIDOS = new Set([
  "deliberacao",
  "ata",
  "resolucao",
  "portaria",
  "pauta",
  "voto_individual",
  "documento_apoio",
]);

export function sanitizeDelib(d: ConfirmDelib): ConfirmDelib {
  return {
    filename: String(d.filename ?? "").slice(0, 255),
    documento_id: d.documento_id ? String(d.documento_id).slice(0, 80) : null,
    upload_job_id: d.upload_job_id ? String(d.upload_job_id).slice(0, 80) : null,
    agencia_id: d.agencia_id ? String(d.agencia_id).slice(0, 80) : null,
    numero_deliberacao: d.numero_deliberacao ? String(d.numero_deliberacao).slice(0, 50) : null,
    numero_reuniao: d.numero_reuniao ? String(d.numero_reuniao).slice(0, 10) : null,
    reuniao_ordinaria: d.reuniao_ordinaria ? String(d.reuniao_ordinaria).slice(0, 100) : null,
    tipo_reuniao: d.tipo_reuniao && TIPOS_REUNIAO_VALIDOS.has(d.tipo_reuniao) ? d.tipo_reuniao : null,
    tipo_documento: d.tipo_documento && TIPOS_DOCUMENTO_VALIDOS.has(d.tipo_documento)
      ? d.tipo_documento : "deliberacao",
    data_reuniao: d.data_reuniao && RE_ISO_DATE.test(d.data_reuniao) ? d.data_reuniao : null,
    interessado: d.interessado ? String(d.interessado).slice(0, 255) : null,
    assunto: d.assunto ? String(d.assunto).slice(0, 500) : null,
    procedencia: d.procedencia ? String(d.procedencia).slice(0, 200) : null,
    relator: d.relator ? String(d.relator).slice(0, 200) : null,
    item_numero: d.item_numero ? String(d.item_numero).slice(0, 20) : null,
    processo: d.processo ? String(d.processo).slice(0, 100) : null,
    resultado: d.resultado && RESULTADOS_VALIDOS.has(d.resultado)
      ? (d.resultado as Resultado)
      : null,
    decisoes_todas: Array.isArray(d.decisoes_todas)
      ? d.decisoes_todas.filter((v) => RESULTADOS_VALIDOS.has(v)).slice(0, 10)
      : [],
    microtema: d.microtema && MICROTEMAS_VALIDOS.has(d.microtema) ? d.microtema : "outros",
    area_regulatoria: isAreaRegulatoria(d.area_regulatoria) ? d.area_regulatoria : "outros",
    pauta_interna: Boolean(d.pauta_interna),
    resumo_pleito: d.resumo_pleito ? String(d.resumo_pleito).slice(0, 2000) : null,
    fundamento_decisao: d.fundamento_decisao ? String(d.fundamento_decisao).slice(0, 2000) : null,
    nomes_votacao: Array.isArray(d.nomes_votacao)
      ? d.nomes_votacao.slice(0, 20).map((n) => String(n).slice(0, 100))
      : [],
    nomes_votacao_contra: Array.isArray(d.nomes_votacao_contra)
      ? d.nomes_votacao_contra.slice(0, 20).map((n) => String(n).slice(0, 100))
      : [],
    nomes_votacao_ausente: Array.isArray(d.nomes_votacao_ausente)
      ? d.nomes_votacao_ausente.slice(0, 20).map((n) => String(n).slice(0, 100))
      : [],
    votos_sugeridos: Array.isArray(d.votos_sugeridos) ? d.votos_sugeridos.slice(0, 30) : [],
    extraction_confidence:
      typeof d.extraction_confidence === "number" &&
      d.extraction_confidence >= 0 &&
      d.extraction_confidence <= 1
        ? d.extraction_confidence
        : 0,
    documento_antt_tipo: d.documento_antt_tipo ?? null,
    documento_subtipo: d.documento_subtipo ?? null,
    import_counts_as_final: d.import_counts_as_final === false ? false : true,
    semantic_duplicate_key: d.semantic_duplicate_key ?? null,
    warnings: Array.isArray(d.warnings) ? d.warnings.map(String).slice(0, 20) : [],
    extraction_raw: d.extraction_raw && typeof d.extraction_raw === "object" ? d.extraction_raw : undefined,
    ata_items: Array.isArray(d.ata_items) ? d.ata_items : undefined,
  };
}

export interface PersistDelibContext {
  /** agencia_id global do envio, usado quando a deliberação não traz a própria. */
  globalAgenciaId: string | null;
  /** Anexos por filename (modo upload manual multipart). Ausente na auto-confirmação. */
  filesByName?: Map<string, File>;
  /** Marca a gravação como automática (auditoria). */
  autoConfirmed?: boolean;
}

/**
 * Persiste UMA deliberação (ata pai+filhos ou deliberação simples) com seus votos,
 * registrando candidatos de diretores e marcando o documento bruto como revisado.
 * Retorna o ConfirmResult equivalente ao da rota de confirmação.
 */
export async function persistConfirmedDeliberacao(
  db: any,
  rawConfirm: ConfirmDelib,
  ctx: PersistDelibContext,
): Promise<ConfirmResult> {
  const d = sanitizeDelib(rawConfirm);
  const effectiveAgenciaId = d.agencia_id || ctx.globalAgenciaId;

  if (!effectiveAgenciaId) {
    return { filename: d.filename, status: "error", error: "Agência não encontrada" };
  }

  try {
    const { data: agencia } = await db
      .from("agencias")
      .select("id")
      .eq("id", effectiveAgenciaId)
      .single();

    if (!agencia) {
      return { filename: d.filename, status: "error", error: "Agência não encontrada" };
    }

    const attachment = d.documento_id
      ? await getDocumentAttachment(db, d.documento_id)
      : await ensureUploadAttachment(db, ctx.filesByName?.get(d.filename), effectiveAgenciaId);
    if (attachment.error) {
      return { filename: d.filename, status: "error", error: attachment.error };
    }

    if (!d.import_counts_as_final || ["pauta", "voto_individual", "documento_apoio"].includes(d.tipo_documento ?? "")) {
      await markDocumentReviewed(db, d.documento_id, "ignored");
      return {
        filename: d.filename,
        status: "document_saved",
        documento_id: d.documento_id ?? null,
        message: "Documento mantido como apoio; nao entrou nos dashboards.",
      };
    }

    const { data: diretores } = await db
      .from("diretores")
      .select("id, nome, nome_variantes")
      .eq("agencia_id", effectiveAgenciaId);

    const diretoresList = (diretores ?? []).map((dir: { id: string; nome: string; nome_variantes?: unknown }) => ({
      id: dir.id,
      nome: dir.nome,
      nome_variantes: Array.isArray(dir.nome_variantes) ? (dir.nome_variantes as string[]) : [],
    }));
    const activeDiretoresList = await getActiveDiretoresForVote(
      db,
      effectiveAgenciaId,
      d.data_reuniao,
      diretoresList,
    );

    const autoRaw = (raw: Record<string, unknown> | undefined) =>
      ctx.autoConfirmed ? { ...(raw ?? {}), auto_confirmed: true } : raw;

    if (d.tipo_documento === "ata" && d.ata_items && d.ata_items.length > 0) {
      const documentPrefix = internalAnttDocumentPrefix(d);
      const documentLabel = documentPrefix === "ATA" ? "Ata" : "Pauta";
      const { data: ataPai, error: ataErr } = await db
        .from("deliberacoes")
        .insert({
          numero_deliberacao: d.numero_reuniao ? `${documentPrefix}-${d.numero_reuniao}` : d.numero_deliberacao,
          numero_reuniao: d.numero_reuniao,
          reuniao_ordinaria: d.reuniao_ordinaria,
          tipo_reuniao: d.tipo_reuniao,
          tipo_documento: "ata",
          assunto: `${documentLabel} da ${d.numero_reuniao ?? ""}ª Reunião - ${d.ata_items.length} processos`,
          procedencia: d.procedencia,
          pauta_interna: false,
          data_reuniao: d.data_reuniao,
          agencia_id: effectiveAgenciaId,
          auto_classified: true,
          extraction_confidence: d.extraction_confidence,
          upload_job_id: attachment.upload_job_id,
          raw_extraction: withAttachmentRaw(autoRaw(d.extraction_raw), attachment),
        })
        .select("id")
        .single();

      if (ataErr || !ataPai) {
        return { filename: d.filename, status: "error", error: "Erro ao inserir ata/pauta" };
      }

      const ataVotingNames = uniqueNamesFromItems(d.ata_items);
      await recordDirectorCandidates(db, ataVotingNames, diretoresList, {
        agencia_id: effectiveAgenciaId,
        filename: d.filename,
        source_type: "ata",
        source_url: extractSourceUrl(d.extraction_raw),
        source_hash: hashEvidence(`${d.filename}|${d.numero_reuniao ?? ""}|${documentPrefix.toLowerCase()}`),
        deliberacao_id: ataPai.id as string,
        numero_reuniao: d.numero_reuniao,
        tipo_documento: d.tipo_documento,
      });

      for (const item of d.ata_items) {
        const { data: child } = await db
          .from("deliberacoes")
          .insert({
            numero_deliberacao: d.numero_reuniao ? `${documentPrefix}-${d.numero_reuniao}-${item.item_numero}` : null,
            numero_reuniao: d.numero_reuniao,
            reuniao_ordinaria: d.reuniao_ordinaria,
            tipo_reuniao: d.tipo_reuniao,
            tipo_documento: "ata",
            item_numero: item.item_numero,
            documento_pai_id: ataPai.id,
            processo: item.processo,
            interessado: item.interessado,
            assunto: item.assunto,
            relator: item.relator,
            microtema: item.microtema,
            resultado: item.resultado,
            pauta_interna: false,
            data_reuniao: d.data_reuniao,
            agencia_id: effectiveAgenciaId,
            auto_classified: true,
            extraction_confidence: item.processo ? 0.8 : 0.4,
            resumo_pleito: item.decisao?.slice(0, 2000) ?? null,
            upload_job_id: attachment.upload_job_id,
            raw_extraction: withAttachmentRaw(autoRaw({
              documento_antt_tipo: d.documento_antt_tipo,
              documento_subtipo: d.documento_subtipo,
              import_counts_as_final: Boolean(item.resultado),
              item_numero: item.item_numero,
              votos_inferidos_por_mandato: shouldInferVotesFromMandate({
                resultado: item.resultado,
                tipo_documento: "ata",
                import_counts_as_final: Boolean(item.resultado),
                unanimidadeDetectada: item.unanimidade_detectada,
                nomes: item.votos_detectados ?? [],
                nomesContra: item.votos_contra_detectados ?? [],
              }),
              warnings: item.warnings ?? [],
            }), attachment),
          })
          .select("id")
          .single();

        const itemVotingNames = item.votos_detectados ?? [];
        if (child) {
          const votoRows = item.votos_sugeridos?.length
            ? buildVotoRowsFromSuggestions({
              deliberacao_id: child.id as string,
              votosSugeridos: item.votos_sugeridos,
            })
            : buildVotoRows({
              deliberacao_id: child.id as string,
              nomes: itemVotingNames,
              nomesContra: item.votos_contra_detectados ?? [],
              nomesAusente: item.votos_ausentes_detectados ?? [],
              diretoresList,
              activeDiretoresList,
              inferFromMandate: shouldInferVotesFromMandate({
                resultado: item.resultado,
                tipo_documento: "ata",
                import_counts_as_final: Boolean(item.resultado),
                unanimidadeDetectada: item.unanimidade_detectada,
                nomes: itemVotingNames,
                nomesContra: item.votos_contra_detectados ?? [],
              }),
            });

          if (votoRows.length > 0) await db.from("votos").upsert(votoRows, { onConflict: "deliberacao_id,diretor_id" });
        }
      }

      await markDocumentReviewed(db, d.documento_id, "confirmed");
      return { filename: d.filename, status: "created", deliberacao_id: ataPai.id as string, documento_id: d.documento_id ?? null };
    }

    const { data: delib, error: deliberacaoErr } = await db
      .from("deliberacoes")
      .insert({
        numero_deliberacao: d.numero_deliberacao,
        numero_reuniao: d.numero_reuniao,
        reuniao_ordinaria: d.reuniao_ordinaria,
        tipo_reuniao: d.tipo_reuniao,
        tipo_documento: d.tipo_documento ?? "deliberacao",
        processo: d.processo,
        interessado: d.interessado,
        assunto: d.assunto,
        procedencia: d.procedencia,
        relator: d.relator,
        item_numero: d.item_numero,
        microtema: d.microtema,
        resultado: d.resultado,
        decisoes_todas: d.decisoes_todas.length > 0 ? d.decisoes_todas : null,
        pauta_interna: d.pauta_interna,
        data_reuniao: d.data_reuniao,
        agencia_id: effectiveAgenciaId,
        auto_classified: true,
        extraction_confidence: d.extraction_confidence,
        resumo_pleito: d.resumo_pleito,
        fundamento_decisao: d.fundamento_decisao,
        upload_job_id: attachment.upload_job_id,
        raw_extraction: withAttachmentRaw(autoRaw({
          ...(d.extraction_raw ?? {}),
          votos_inferidos_por_mandato: shouldInferVotesFromMandate({
            resultado: d.resultado,
            tipo_documento: d.tipo_documento,
            import_counts_as_final: d.import_counts_as_final,
            unanimidadeDetectada: Boolean(d.extraction_raw?.unanimidade_detectada),
            nomes: d.nomes_votacao,
            nomesContra: d.nomes_votacao_contra,
          }),
        }), attachment),
      })
      .select("id")
      .single();

    if (deliberacaoErr || !delib) {
      console.error("[confirm-deliberacoes] Erro ao inserir deliberação:", deliberacaoErr);
      return { filename: d.filename, status: "error", error: "Erro ao inserir deliberação" };
    }

    const votingNames = d.nomes_votacao;
    if (votingNames.length > 0) {
      await recordDirectorCandidates(db, votingNames, diretoresList, {
        agencia_id: effectiveAgenciaId,
        filename: d.filename,
        source_type: d.tipo_documento === "ata" ? "ata" : "deliberacao",
        source_url: extractSourceUrl(d.extraction_raw),
        source_hash: hashEvidence(`${d.filename}|${d.numero_deliberacao ?? ""}|${d.processo ?? ""}`),
        deliberacao_id: delib.id as string,
        numero_deliberacao: d.numero_deliberacao,
        processo: d.processo,
        tipo_documento: d.tipo_documento,
      });
    }

    const votoRows = (d.votos_sugeridos ?? []).length
      ? buildVotoRowsFromSuggestions({
        deliberacao_id: delib.id as string,
        votosSugeridos: d.votos_sugeridos ?? [],
      })
      : buildVotoRows({
        deliberacao_id: delib.id as string,
        nomes: votingNames,
        nomesContra: d.nomes_votacao_contra,
        nomesAusente: d.nomes_votacao_ausente ?? [],
        diretoresList,
        activeDiretoresList,
        inferFromMandate: shouldInferVotesFromMandate({
          resultado: d.resultado,
          tipo_documento: d.tipo_documento,
          import_counts_as_final: d.import_counts_as_final,
          unanimidadeDetectada: Boolean(d.extraction_raw?.unanimidade_detectada),
          nomes: votingNames,
          nomesContra: d.nomes_votacao_contra,
        }),
      });
    if (votoRows.length > 0) await db.from("votos").upsert(votoRows, { onConflict: "deliberacao_id,diretor_id" });

    await markDocumentReviewed(db, d.documento_id, "confirmed");
    return { filename: d.filename, status: "created", deliberacao_id: delib.id as string, documento_id: d.documento_id ?? null };
  } catch (err) {
    console.error("[confirm-deliberacoes] Erro inesperado ao processar deliberação:", err);
    return { filename: d.filename, status: "error", error: "Erro interno ao processar deliberação" };
  }
}

// ─── Helpers (movidos de upload/confirm/route.ts) ──────────────────────────

async function recordDirectorCandidates(
  db: any,
  nomes: string[],
  diretoresList: Array<{ id: string; nome: string; nome_variantes: string[] }>,
  evidence: {
    agencia_id: string;
    filename: string;
    source_type: "deliberacao" | "ata";
    source_url: string | null;
    source_hash: string;
    deliberacao_id?: string;
    numero_deliberacao?: string | null;
    numero_reuniao?: string | null;
    processo?: string | null;
    tipo_documento?: string | null;
  },
) {
  const uniqueNames = [...new Set(nomes.map((n) => normalizeName(String(n))).filter((n) => n.length >= 3))];
  if (uniqueNames.length === 0) return;

  const rows = uniqueNames
    .map((nome) => {
      const match = findBestMatch(nome, diretoresList);
      if (!match.needsReview && !match.isNew) return null;
      return {
        agencia_id: evidence.agencia_id,
        nome_detectado: nome,
        cargo_detectado: null,
        diretor_id: match.diretorId,
        source_type: evidence.source_type,
        source_url: evidence.source_url,
        source_hash: evidence.source_hash,
        confidence: Math.max(0.35, Math.min(match.score || 0.5, 0.94)),
        review_status: "pendente",
        evidence: {
          filename: evidence.filename,
          deliberacao_id: evidence.deliberacao_id,
          numero_deliberacao: evidence.numero_deliberacao,
          numero_reuniao: evidence.numero_reuniao,
          processo: evidence.processo,
          tipo_documento: evidence.tipo_documento,
          match_score: match.score,
          match_kind: match.isNew ? "new_director" : "weak_match",
          lgpd_note: "Dados limitados a função pública; sem CPF, contato ou endereço.",
        },
      };
    })
    .filter(Boolean);

  if (rows.length === 0) return;

  const { error } = await db
    .from("diretor_candidatos")
    .upsert(rows, { onConflict: "agencia_id,nome_detectado,source_hash", ignoreDuplicates: true });

  if (error) {
    console.warn("[confirm-deliberacoes] Não foi possível registrar candidatos de diretores:", error.message);
  }
}

export function extractSourceUrl(raw: Record<string, unknown> | undefined): string | null {
  const value = raw?.source_url ?? raw?.url ?? raw?.monitoramento_url;
  return typeof value === "string" && value.startsWith("http") ? value.slice(0, 1000) : null;
}

function hashEvidence(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function uniqueNamesFromItems(items: Array<{ votos_detectados?: string[] }> | undefined) {
  return [...new Set((items ?? []).flatMap((item) => item.votos_detectados ?? []))];
}

export function internalAnttDocumentPrefix(d: ConfirmDelib) {
  const anttType = d.documento_antt_tipo ?? d.extraction_raw?.documento_antt_tipo;
  return anttType === "ata" ? "ATA" : anttType ? "PAUTA" : "ATA";
}

async function ensureUploadAttachment(
  db: any,
  file: File | undefined,
  agenciaId: string,
): Promise<{ upload_job_id: string | null; file_hash: string | null; storage_path: string | null; error?: string }> {
  if (!file) return { upload_job_id: null, file_hash: null, storage_path: null };

  const { isPdfBuffer, sha256Hex } = await import("@/lib/server/pdf-extractor");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!isPdfBuffer(buffer)) return { upload_job_id: null, file_hash: null, storage_path: null, error: "Arquivo anexado não é PDF válido" };

  const fileHash = await sha256Hex(buffer);
  const { data: existing } = await db
    .from("upload_jobs")
    .select("id, storage_path, file_hash")
    .eq("file_hash", fileHash)
    .maybeSingle();

  if (existing) {
    return {
      upload_job_id: existing.id as string,
      file_hash: (existing.file_hash as string | null) ?? fileHash,
      storage_path: (existing.storage_path as string | null) ?? null,
    };
  }

  const storagePath = `${agenciaId}/${fileHash}.pdf`;
  const bucketErr = await ensurePdfStorageBucket(db);
  if (bucketErr) {
    return { upload_job_id: null, file_hash: fileHash, storage_path: storagePath, error: bucketErr };
  }

  const { error: uploadErr } = await db.storage
    .from("pdfs")
    .upload(storagePath, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadErr) {
    return { upload_job_id: null, file_hash: fileHash, storage_path: storagePath, error: `Falha ao salvar PDF: ${uploadErr.message}` };
  }

  const { data: job, error: jobErr } = await db
    .from("upload_jobs")
    .insert({
      filename: file.name,
      file_hash: fileHash,
      status: "done",
      agencia_id: agenciaId,
      storage_path: storagePath,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    return { upload_job_id: null, file_hash: fileHash, storage_path: storagePath, error: "Falha ao registrar anexo no banco" };
  }

  return { upload_job_id: job.id as string, file_hash: fileHash, storage_path: storagePath };
}

async function getDocumentAttachment(
  db: any,
  documentoId: string,
): Promise<{ upload_job_id: string | null; file_hash: string | null; storage_path: string | null; error?: string }> {
  const { data: doc, error } = await db
    .from("documentos_regulatorios")
    .select("id, upload_job_id, file_hash, storage_path, storage_bucket")
    .eq("id", documentoId)
    .maybeSingle();

  if (error || !doc) {
    return { upload_job_id: null, file_hash: null, storage_path: null, error: "Documento bruto nao encontrado" };
  }

  return {
    upload_job_id: (doc.upload_job_id as string | null) ?? null,
    file_hash: (doc.file_hash as string | null) ?? null,
    storage_path: (doc.storage_path as string | null) ?? null,
  };
}

export async function markDocumentReviewed(
  db: any,
  documentoId: string | null | undefined,
  status: "confirmed" | "ignored",
) {
  if (!documentoId) return;
  const { error } = await db
    .from("documentos_regulatorios")
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentoId);
  if (error) console.warn("[confirm-deliberacoes] Falha ao atualizar documento bruto:", error.message);
}

async function ensurePdfStorageBucket(db: any): Promise<string | null> {
  const { data: bucket } = await db.storage.getBucket("pdfs");
  if (bucket) return null;

  const { error } = await db.storage.createBucket("pdfs", {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: ["application/pdf"],
  });

  if (!error) return null;
  if (/already exists|duplicate/i.test(error.message ?? "")) return null;
  return `Bucket de PDFs ausente e nao foi possivel cria-lo automaticamente: ${error.message}`;
}

function withAttachmentRaw(raw: Record<string, unknown> | undefined, attachment: { upload_job_id: string | null; file_hash: string | null; storage_path: string | null }) {
  return {
    ...(raw ?? {}),
    upload_job_id: attachment.upload_job_id,
    file_hash: attachment.file_hash,
    storage_path: attachment.storage_path,
  };
}
