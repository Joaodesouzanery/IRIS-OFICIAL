/**
 * GET /api/v1/deliberacoes/export
 * Exporta deliberações filtradas como CSV.
 */

import { NextRequest, NextResponse } from "next/server";
import { demoData } from "@/lib/demo-data";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeDelibList } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";


// CSV padronizado (QA ago/2026): `;` + BOM + \r\n em TODOS os exports do IRIS —
// o Excel pt-BR abre direto (o formato antigo com `,` sem BOM quebrava acentos).
const escape = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[";,\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// UMA função de linha para os 3 ramos (demo/local/real) — o ramo demo emitia 12 valores
// para 16 headers (colunas desalinhadas no Excel).
const toRow = (r: any) => [
  escape(r.numero_deliberacao),
  escape(r.reuniao_ordinaria),
  escape(r.data_reuniao),
  escape(r.data_publicacao),
  escape(r.interessado),
  escape(r.processo),
  escape(r.microtema),
  escape(r.area_regulatoria),
  escape(r.resultado),
  escape(r.pauta_interna ? "Sim" : "Não"),
  escape(r.extraction_confidence != null ? `${(r.extraction_confidence * 100).toFixed(0)}%` : ""),
  escape(r.created_at),
  escape(r.tipo_documento),
  escape(r.relator),
  escape(r.item_numero),
  escape(r.assunto),
].join(";");

const toCsv = (rows: string[]) => `\ufeff${[HEADERS.join(";"), ...rows].join("\r\n")}`;

const HEADERS = [
  "Numero", "Reuniao", "Data", "Publicacao", "Interessado", "Processo",
  "Microtema", "Area", "Resultado", "Pauta Interna", "Confiança IA", "Criado Em",
  "Tipo Documento", "Relator", "Item", "Assunto",
];

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) {
      const all = computeDelibList(getSyncedDelibs(), { limit: 5000 }).data;
      const csv = toCsv(all.map(toRow));
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="deliberacoes_local_${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    const all = demoData.deliberacoes({ limit: 5000 }).data;
    const csv = toCsv(all.map(toRow));
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="deliberacoes_demo_${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let query = db.from("deliberacoes").select(
    `numero_deliberacao, reuniao_ordinaria, data_reuniao, data_publicacao,
     interessado, processo, microtema, area_regulatoria, resultado,
     pauta_interna, extraction_confidence, created_at,
     tipo_documento, relator, item_numero, assunto, documento_pai_id,
     agencias (sigla)`
  );

  const agenciaId = searchParams.get("agencia_id");
  if (agenciaId) query = query.eq("agencia_id", agenciaId);

  // Excluir ata-parents por padrão
  query = query.or("tipo_documento.neq.ata,documento_pai_id.not.is.null");

  const year = searchParams.get("year");
  if (year) {
    query = query.gte("data_reuniao", `${year}-01-01`).lte("data_reuniao", `${year}-12-31`);
  }

  const microtema = searchParams.get("microtema");
  if (microtema) query = query.eq("microtema", microtema);

  const resultado = searchParams.get("resultado");
  if (resultado) query = query.eq("resultado", resultado);

  query = query.order("data_reuniao", { ascending: false }).limit(5000);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Erro ao exportar" }, { status: 500 });
  }

  const csv = toCsv((data ?? []).map(toRow));

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="deliberacoes_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
