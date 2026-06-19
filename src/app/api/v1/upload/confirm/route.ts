/**
 * POST /api/v1/upload/confirm
 * Recebe as deliberações revisadas pelo usuário e persiste no Supabase.
 * Escritas reais exigem admin; modo DEMO permanece somente leitura.
 *
 * A lógica de persistência real vive em lib/server/confirm-deliberacoes.ts (compartilhada
 * com a auto-confirmação). Aqui ficam apenas o guard, o parse do request e o modo DEMO.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";
import {
  internalAnttDocumentPrefix,
  persistConfirmedDeliberacao,
  sanitizeDelib,
} from "@/lib/server/confirm-deliberacoes";
import {
  buildVotoRows,
  shouldInferVotesFromMandate,
} from "@/lib/server/vote-inference";
import type {
  ConfirmDelib,
  BatchConfirmResponse,
  ConfirmResult,
  Resultado,
  Deliberacao,
  VotoEmbutido,
} from "@/types";

type ParsedConfirmBody = {
  body: { agencia_id?: unknown; deliberacoes?: unknown };
  filesByName: Map<string, File>;
};

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

      function buildVotos(
        nomes: string[],
        contra: string[] = [],
        ausente: string[] = [],
        inferFromMandate = false,
      ): VotoEmbutido[] {
        return buildVotoRows({
          deliberacao_id: "local",
          nomes,
          nomesContra: contra,
          nomesAusente: ausente,
          diretoresList,
          activeDiretoresList: diretoresList,
          inferFromMandate,
        }).map((row) => {
          const diretor = diretoresList.find((dir) => dir.id === row.diretor_id);
          return {
            id: `local-v-${Math.random().toString(36).slice(2, 9)}`,
            diretor_id: row.diretor_id,
            diretor_nome: diretor?.nome ?? row.diretor_id,
            tipo_voto: row.tipo_voto,
            is_divergente: row.is_divergente,
            is_nominal: row.is_nominal,
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
            votos: buildVotos(
              item.votos_detectados ?? [],
              item.votos_contra_detectados ?? [],
              item.votos_ausentes_detectados ?? [],
              shouldInferVotesFromMandate({
                resultado: item.resultado,
                tipo_documento: "ata",
                import_counts_as_final: Boolean(item.resultado),
                unanimidadeDetectada: item.unanimidade_detectada,
                nomes: item.votos_detectados ?? [],
                nomesContra: item.votos_contra_detectados ?? [],
              }),
            ),
            raw_extraction: null,
          });
        }

        results.push({ filename: d.filename, status: "created", deliberacao_id: paiId });
        continue;
      }

      const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const votos = buildVotos(
        d.nomes_votacao,
        d.nomes_votacao_contra,
        d.nomes_votacao_ausente ?? [],
        shouldInferVotesFromMandate({
          resultado: d.resultado,
          tipo_documento: d.tipo_documento,
          import_counts_as_final: d.import_counts_as_final,
          unanimidadeDetectada: Boolean(d.extraction_raw?.unanimidade_detectada),
          nomes: d.nomes_votacao,
          nomesContra: d.nomes_votacao_contra,
        }),
      );

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
      const result = await persistConfirmedDeliberacao(db, raw as ConfirmDelib, {
        globalAgenciaId,
        filesByName,
      });
      results.push(result);
    }

    const created = results.filter((r) => r.status === "created" || r.status === "document_saved").length;
    const errors = results.filter((r) => r.status === "error").length;

    const response: BatchConfirmResponse = { created, errors, results };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("[upload/confirm] Erro inesperado:", error);
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
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
