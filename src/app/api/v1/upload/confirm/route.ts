/**
 * POST /api/v1/upload/confirm
 * Recebe as deliberações revisadas pelo usuário e persiste no Supabase.
 * Escritas reais exigem admin; modo DEMO permanece somente leitura.
 */

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isAreaRegulatoria } from "@/lib/server/area-regulatoria";
import { findBestMatch, normalizeName } from "@/lib/server/name-matcher";
import { requireAdmin } from "@/lib/server/request-guards";
import type {
  ConfirmDelib,
  BatchConfirmResponse,
  ConfirmResult,
  Resultado,
  Deliberacao,
  VotoEmbutido,
} from "@/types";

const RESULTADOS_VALIDOS = new Set<string>([
  "Deferido", "Indeferido", "Parcialmente Deferido", "Retirado de Pauta",
  "Ratificado", "Aprovado", "Aprovado com Ressalvas", "Aprovado por Unanimidade",
  "Recomendado", "Determinado", "Autorizado",
]);

const MICROTEMAS_VALIDOS = new Set<string>([
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

type ParsedConfirmBody = {
  body: { agencia_id?: unknown; deliberacoes?: unknown };
  filesByName: Map<string, File>;
};

function sanitizeDelib(d: ConfirmDelib): ConfirmDelib {
  return {
    filename: String(d.filename ?? "").slice(0, 255),
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  let parsed: ParsedConfirmBody;
  try {
    parsed = await parseConfirmRequest(req);
  } catch {
    return NextResponse.json({ error: "Payload JSON inválido" }, { status: 400 });
  }

  const { body, filesByName } = parsed;
  const { agencia_id, deliberacoes } = body;

  if (!Array.isArray(deliberacoes) || deliberacoes.length === 0) {
    return NextResponse.json(
      { error: "deliberacoes deve ser um array não vazio" },
      { status: 400 },
    );
  }

  if (deliberacoes.length > 1000) {
    return NextResponse.json(
      { error: "Máximo de 1000 deliberações por envio" },
      { status: 400 },
    );
  }

  const globalAgenciaId = typeof agencia_id === "string" && agencia_id ? agencia_id : null;
  const missingAgency = deliberacoes.some((raw) => {
    const itemAgency = (raw as { agencia_id?: unknown }).agencia_id;
    return !(typeof itemAgency === "string" && itemAgency) && !globalAgenciaId;
  });

  if (missingAgency) {
    return NextResponse.json(
      { error: "agencia_id é obrigatório para cada deliberação sem agência detectada" },
      { status: 400 },
    );
  }

  if (isDemo()) {
    const { demoData } = await import("@/lib/demo-data");
    const createdDelibs: Deliberacao[] = [];
    const results: ConfirmResult[] = [];

    for (const raw of deliberacoes) {
      const d = sanitizeDelib(raw as ConfirmDelib);
      const rawConfirm = raw as ConfirmDelib;
      const effectiveAgenciaId = d.agencia_id || globalAgenciaId!;
      const diretoresList = demoData.mandatos()
        .filter((m) => m.agencia_id === effectiveAgenciaId)
        .map((m) => ({ id: m.diretor_id, nome: m.diretor_nome, nome_variantes: [] as string[] }));

      function buildVotos(nomes: string[], contra: Set<string>): VotoEmbutido[] {
        return nomes.map((nome) => {
          const match = findBestMatch(nome, diretoresList);
          const isContra = contra.has(nome);
          return {
            id: `local-v-${Math.random().toString(36).slice(2, 9)}`,
            diretor_id: match.diretorId ?? nome,
            diretor_nome: match.diretorId
              ? (diretoresList.find((dir) => dir.id === match.diretorId)?.nome ?? nome)
              : nome,
            tipo_voto: isContra ? "Desfavoravel" : "Favoravel",
            is_divergente: isContra,
            is_nominal: match.diretorId !== null,
          };
        });
      }

      if (d.tipo_documento === "ata" && rawConfirm.ata_items && rawConfirm.ata_items.length > 0) {
        const paiId = `local-ata-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const documentPrefix = internalAnttDocumentPrefix(d);
        const documentLabel = documentPrefix === "ATA" ? "Ata" : "Pauta";

        createdDelibs.push({
          id: paiId,
          agencia_id: effectiveAgenciaId,
          numero_deliberacao: d.numero_reuniao ? `${documentPrefix}-${d.numero_reuniao}` : d.numero_deliberacao,
          numero_reuniao: d.numero_reuniao,
          reuniao_ordinaria: d.reuniao_ordinaria,
          tipo_reuniao: d.tipo_reuniao as "Ordinaria" | "Extraordinaria" | null,
          tipo_documento: "ata",
          data_reuniao: d.data_reuniao,
          interessado: null,
          assunto: `${documentLabel} da ${d.numero_reuniao ?? ""}ª Reunião - ${rawConfirm.ata_items.length} processos`,
          procedencia: d.procedencia,
          relator: null,
          item_numero: null,
          documento_pai_id: null,
          processo: null,
          resultado: null,
          decisoes_todas: [],
          microtema: null,
          area_regulatoria: d.area_regulatoria,
          pauta_interna: false,
          resumo_pleito: null,
          fundamento_decisao: null,
          auto_classified: true,
          extraction_confidence: 1,
          created_at: new Date().toISOString(),
          votos: [],
          raw_extraction: d.extraction_raw ?? null,
        });

        for (const item of rawConfirm.ata_items) {
          const childId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          createdDelibs.push({
            id: childId,
            agencia_id: effectiveAgenciaId,
            numero_deliberacao: d.numero_reuniao ? `${documentPrefix}-${d.numero_reuniao}-${item.item_numero}` : null,
            numero_reuniao: d.numero_reuniao,
            reuniao_ordinaria: d.reuniao_ordinaria,
            tipo_reuniao: d.tipo_reuniao as "Ordinaria" | "Extraordinaria" | null,
            tipo_documento: "ata",
            data_reuniao: d.data_reuniao,
            interessado: item.interessado,
            assunto: item.assunto,
            procedencia: null,
            relator: item.relator,
            item_numero: item.item_numero,
            documento_pai_id: paiId,
            processo: item.processo,
            resultado: item.resultado as Resultado | null,
            decisoes_todas: [],
            microtema: item.microtema,
            area_regulatoria: item.area_regulatoria ?? d.area_regulatoria,
            pauta_interna: false,
            resumo_pleito: item.decisao?.slice(0, 2000) ?? null,
            fundamento_decisao: null,
            auto_classified: true,
            extraction_confidence: item.processo ? 0.8 : 0.4,
            created_at: new Date().toISOString(),
            votos: buildVotos(item.votos_detectados ?? [], new Set(item.votos_contra_detectados ?? [])),
            raw_extraction: null,
          });
        }

        results.push({ filename: d.filename, status: "created", deliberacao_id: paiId });
        continue;
      }

      const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const votos = buildVotos(d.nomes_votacao, new Set(d.nomes_votacao_contra));

      createdDelibs.push({
        id,
        agencia_id: effectiveAgenciaId,
        numero_deliberacao: d.numero_deliberacao,
        numero_reuniao: d.numero_reuniao,
        reuniao_ordinaria: d.reuniao_ordinaria,
        tipo_reuniao: d.tipo_reuniao as "Ordinaria" | "Extraordinaria" | null,
        tipo_documento: d.tipo_documento ?? "deliberacao",
        data_reuniao: d.data_reuniao,
        interessado: d.interessado,
        assunto: d.assunto,
        procedencia: d.procedencia,
        relator: d.relator ?? null,
        item_numero: d.item_numero ?? null,
        documento_pai_id: null,
        processo: d.processo,
        resultado: d.resultado as Resultado | null,
        decisoes_todas: d.decisoes_todas,
        microtema: d.microtema,
        area_regulatoria: d.area_regulatoria,
        pauta_interna: d.pauta_interna,
        resumo_pleito: d.resumo_pleito,
        fundamento_decisao: d.fundamento_decisao,
        auto_classified: true,
        extraction_confidence: d.extraction_confidence,
        created_at: new Date().toISOString(),
        votos,
        raw_extraction: d.extraction_raw ?? null,
      });

      results.push({ filename: d.filename, status: "created", deliberacao_id: id });
    }

    const response: BatchConfirmResponse = {
      created: createdDelibs.length,
      errors: 0,
      results,
      deliberacoes: createdDelibs,
    };
    return NextResponse.json(response, { status: 201 });
  }

  try {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const db = createSupabaseServerClient();
    const results: ConfirmResult[] = [];

    for (const raw of deliberacoes) {
      const d = sanitizeDelib(raw as ConfirmDelib);
      const rawConfirm = raw as ConfirmDelib;
      const effectiveAgenciaId = d.agencia_id || globalAgenciaId!;

      try {
        const { data: agencia } = await db
          .from("agencias")
          .select("id")
          .eq("id", effectiveAgenciaId)
          .single();

        if (!agencia) {
          results.push({ filename: d.filename, status: "error", error: "Agência não encontrada" });
          continue;
        }

        const attachment = await ensureUploadAttachment(db, filesByName.get(d.filename), effectiveAgenciaId);
        if (attachment.error) {
          results.push({ filename: d.filename, status: "error", error: attachment.error });
          continue;
        }

        const { data: diretores } = await db
          .from("diretores")
          .select("id, nome, nome_variantes")
          .eq("agencia_id", effectiveAgenciaId);

        const diretoresList = (diretores ?? []).map((dir) => ({
          id: dir.id,
          nome: dir.nome,
          nome_variantes: Array.isArray((dir as { nome_variantes?: unknown }).nome_variantes)
            ? (dir as { nome_variantes: string[] }).nome_variantes
            : [],
        }));

        if (d.tipo_documento === "ata" && rawConfirm.ata_items && rawConfirm.ata_items.length > 0) {
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
              assunto: `${documentLabel} da ${d.numero_reuniao ?? ""}ª Reunião - ${rawConfirm.ata_items.length} processos`,
              procedencia: d.procedencia,
              pauta_interna: false,
              data_reuniao: d.data_reuniao,
              agencia_id: effectiveAgenciaId,
              auto_classified: true,
              extraction_confidence: d.extraction_confidence,
              area_regulatoria: d.area_regulatoria,
              upload_job_id: attachment.upload_job_id,
              raw_extraction: withAttachmentRaw(d.extraction_raw, attachment),
            })
            .select("id")
            .single();

          if (ataErr || !ataPai) {
            results.push({ filename: d.filename, status: "error", error: "Erro ao inserir ata/pauta" });
            continue;
          }

          const ataVotingNames = uniqueNamesFromItems(rawConfirm.ata_items);
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

          for (const item of rawConfirm.ata_items) {
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
                area_regulatoria: item.area_regulatoria ?? d.area_regulatoria,
                resultado: item.resultado,
                pauta_interna: false,
                data_reuniao: d.data_reuniao,
                agencia_id: effectiveAgenciaId,
                auto_classified: true,
                extraction_confidence: item.processo ? 0.8 : 0.4,
                resumo_pleito: item.decisao?.slice(0, 2000) ?? null,
                upload_job_id: attachment.upload_job_id,
                raw_extraction: withAttachmentRaw({
                  documento_antt_tipo: d.documento_antt_tipo,
                  documento_subtipo: d.documento_subtipo,
                  import_counts_as_final: Boolean(item.resultado),
                  item_numero: item.item_numero,
                  warnings: item.warnings ?? [],
                }, attachment),
              })
              .select("id")
              .single();

            const itemVotingNames = item.votos_detectados ?? [];
            if (child && itemVotingNames.length > 0) {
              const nomesContra = new Set(item.votos_contra_detectados ?? []);
              const votoRows = itemVotingNames
                .map((nome) => {
                  const match = findBestMatch(nome, diretoresList);
                  const isContra = nomesContra.has(nome);
                  return {
                    deliberacao_id: child.id as string,
                    diretor_id: match.diretorId,
                    tipo_voto: isContra ? ("Desfavoravel" as const) : ("Favoravel" as const),
                    is_divergente: isContra,
                    is_nominal: match.diretorId !== null,
                  };
                })
                .filter((v) => v.diretor_id !== null);

              if (votoRows.length > 0) await db.from("votos").insert(votoRows);
            }
          }

          results.push({ filename: d.filename, status: "created", deliberacao_id: ataPai.id as string });
          continue;
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
            area_regulatoria: d.area_regulatoria,
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
            raw_extraction: withAttachmentRaw(d.extraction_raw, attachment),
          })
          .select("id")
          .single();

        if (deliberacaoErr || !delib) {
          console.error("[upload/confirm] Erro ao inserir deliberação:", deliberacaoErr);
          results.push({ filename: d.filename, status: "error", error: "Erro ao inserir deliberação" });
          continue;
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

          const nomesContra = new Set(d.nomes_votacao_contra);
          const votoRows = votingNames
            .map((nome) => {
              const match = findBestMatch(nome, diretoresList);
              const isContra = nomesContra.has(nome);
              return {
                deliberacao_id: delib.id as string,
                diretor_id: match.diretorId,
                tipo_voto: isContra ? ("Desfavoravel" as const) : ("Favoravel" as const),
                is_divergente: isContra,
                is_nominal: match.diretorId !== null,
              };
            })
            .filter((v) => v.diretor_id !== null);

          if (votoRows.length > 0) await db.from("votos").insert(votoRows);
        }

        results.push({ filename: d.filename, status: "created", deliberacao_id: delib.id as string });
      } catch (err) {
        console.error("[upload/confirm] Erro inesperado ao processar deliberação:", err);
        results.push({ filename: d.filename, status: "error", error: "Erro interno ao processar deliberação" });
      }
    }

    const created = results.filter((r) => r.status === "created").length;
    const errors = results.filter((r) => r.status === "error").length;

    const response: BatchConfirmResponse = { created, errors, results };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("[upload/confirm] Erro inesperado:", error);
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
}

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
    console.warn("[upload/confirm] Não foi possível registrar candidatos de diretores:", error.message);
  }
}

function extractSourceUrl(raw: Record<string, unknown> | undefined): string | null {
  const value = raw?.source_url ?? raw?.url ?? raw?.monitoramento_url;
  return typeof value === "string" && value.startsWith("http") ? value.slice(0, 1000) : null;
}

function hashEvidence(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function uniqueNamesFromItems(items: Array<{ votos_detectados?: string[] }> | undefined) {
  return [...new Set((items ?? []).flatMap((item) => item.votos_detectados ?? []))];
}

function internalAnttDocumentPrefix(d: ConfirmDelib) {
  const anttType = d.documento_antt_tipo ?? d.extraction_raw?.documento_antt_tipo;
  return anttType === "ata" ? "ATA" : anttType ? "PAUTA" : "ATA";
}

async function parseConfirmRequest(req: NextRequest): Promise<ParsedConfirmBody> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const payload = formData.get("payload");
    if (typeof payload !== "string") throw new Error("payload ausente");
    const filesByName = new Map<string, File>();
    const { isPdfBuffer } = await import("@/lib/server/pdf-extractor");
    const { isZipBuffer, extractPdfEntriesFromZip } = await import("@/lib/server/zip-extractor");
    for (const entry of formData.getAll("files")) {
      if (!(entry instanceof File)) continue;
      const buffer = Buffer.from(await entry.arrayBuffer());
      if (isPdfBuffer(buffer)) {
        filesByName.set(entry.name, entry);
      } else if (isZipBuffer(buffer)) {
        const pdfs = extractPdfEntriesFromZip(buffer, {
          maxFiles: 500,
          maxTotalUncompressedBytes: 150 * 1024 * 1024,
        });
        for (const pdf of pdfs) {
          filesByName.set(pdf.name, new File([new Uint8Array(pdf.buffer)], pdf.name, { type: "application/pdf" }));
        }
      }
    }
    return { body: JSON.parse(payload), filesByName };
  }

  return {
    body: await req.json(),
    filesByName: new Map(),
  };
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
