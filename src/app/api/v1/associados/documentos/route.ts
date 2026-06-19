import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { demoData } from "@/lib/demo-data";
import {
  buildAssociadoDocument,
  DEMO_ASSOCIADOS,
} from "@/lib/server/associado-documents";
import { buildAssociadoPreviewFromDb, sanitizeCuradoria, curadoriaToInputsManuais } from "@/lib/server/associado-report";
import type {
  Associado,
  Diretor,
  DocumentoAssociadoTipo,
  MonitoramentoItem,
} from "@/types";

const TIPO_VALIDO = new Set<DocumentoAssociadoTipo>(["relatorio_trimestral", "boletim_mensal"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) return NextResponse.json([]);

  const associadoId = req.nextUrl.searchParams.get("associado_id");
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  let query = db
    .from("documentos_associado")
    .select("id, associado_id, tipo, periodo_inicio, periodo_fim, titulo, fontes, metricas, qualidade, gerado_por, agendamento_id, status_revisao, versao, created_at, associado:associados(nome, setor)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (associadoId) query = query.eq("associado_id", associadoId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Erro ao buscar historico" }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const associadoId = typeof body.associado_id === "string" ? body.associado_id : "";
  const tipo = TIPO_VALIDO.has(body.tipo) ? body.tipo : "boletim_mensal";
  const periodo_inicio = typeof body.periodo_inicio === "string" && ISO_DATE_RE.test(body.periodo_inicio)
    ? body.periodo_inicio
    : defaultPeriod(tipo).inicio;
  const periodo_fim = typeof body.periodo_fim === "string" && ISO_DATE_RE.test(body.periodo_fim)
    ? body.periodo_fim
    : defaultPeriod(tipo).fim;
  const save = body.save !== false;
  const demoPreview = isDemo() || isDemoRequest(req);
  const curadoria = sanitizeCuradoria(body as Record<string, unknown>);

  if (!(demoPreview && !save)) {
    const guard = await requireAdminOrCron(req);
    if (guard) return guard;
  }

  if (demoPreview) {
    if (save) {
      return NextResponse.json({ error: "No modo DEMO, relatórios só podem ser gerados como preview." }, { status: 403 });
    }
    const associado = DEMO_ASSOCIADOS.find((a) => a.id === associadoId) ?? DEMO_ASSOCIADOS[0];
    const agenciaIds = new Set(associado.agencia_siglas.map((sigla) => demoData.agencias().find((a) => a.sigla === sigla)?.id).filter(Boolean));
    const delibs = demoData.deliberacoes({ limit: 100 }).data
      .filter((d) => !agenciaIds.size || agenciaIds.has(d.agencia_id ?? ""))
      .filter((d) => inPeriod(d.data_reuniao, periodo_inicio, periodo_fim));
    const mandatos = demoData.mandatos().filter((m) => agenciaIds.has(m.agencia_id ?? ""));
    const noticias = demoNoticias(associado, periodo_fim);
    const preview = buildAssociadoDocument({
      associado,
      tipo,
      periodo_inicio,
      periodo_fim,
      deliberacoes: delibs,
      mandatos,
      noticias,
      listaTriplice: [],
      diretores: demoData.diretores().filter((d) => agenciaIds.has(d.agencia_id ?? "")) as Diretor[],
      ...curadoria,
    });
    return NextResponse.json(preview);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: associado, error: assocError } = await db
    .from("associados")
    .select("*")
    .eq("id", associadoId)
    .single();
  if (assocError || !associado) {
    return NextResponse.json({ error: "Associado nao encontrado" }, { status: 404 });
  }

  const preview = await buildAssociadoPreviewFromDb(db, {
    associado: associado as Associado,
    tipo,
    periodo_inicio,
    periodo_fim,
    curadoria,
  });

  if (!save) return NextResponse.json(preview);

  const { data: saved, error: saveError } = await db
    .from("documentos_associado")
    .insert({
      associado_id: associado.id,
      tipo,
      periodo_inicio,
      periodo_fim,
      titulo: preview.titulo,
      html: preview.html,
      fontes: preview.fontes,
      metricas: preview.metricas,
      qualidade: {
        ...preview.qualidade,
        inputs_manuais: curadoriaToInputsManuais(curadoria),
      },
      gerado_por: typeof body.gerado_por === "string" ? body.gerado_por : "manual",
      agendamento_id: typeof body.agendamento_id === "string" ? body.agendamento_id : null,
      status_revisao: "rascunho",
    })
    .select("id")
    .single();

  if (saveError) return NextResponse.json({ error: "Erro ao salvar documento" }, { status: 500 });

  if (preview.fontes.length) {
    await db.from("documento_fontes").insert(preview.fontes.map((fonte) => ({
      documento_id: saved.id,
      fonte_tipo: fonte.tipo,
      titulo: fonte.titulo,
      url: fonte.url ?? null,
    })));
  }

  return NextResponse.json({ ...preview, documento_id: saved.id });
}

function defaultPeriod(tipo: DocumentoAssociadoTipo) {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - (tipo === "relatorio_trimestral" ? 3 : 1));
  return { inicio: start.toISOString().slice(0, 10), fim: end.toISOString().slice(0, 10) };
}

function inPeriod(value: string | null, from: string, to: string) {
  if (!value) return false;
  const date = value.slice(0, 10);
  return date >= from && date <= to;
}

function demoNoticias(associado: Associado, periodo_fim: string): MonitoramentoItem[] {
  const source = associado.ministerio_urls[0] ?? "";
  return [
    {
      id: `demo-news-${associado.id}`,
      site_id: "demo-govbr",
      agencia_id: null,
      tipo: "politica_publica",
      titulo: associado.setor === "Mineracao"
        ? "Politica de minerais criticos avanca na agenda publica"
        : "Ministerio dos Transportes anuncia novas medidas para infraestrutura e concessoes",
      url_item: source,
      reuniao: "Politica publica",
      data_reuniao: periodo_fim,
      status: "novo",
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      metadata: {
        source,
        resumo: "Item demonstrativo usado enquanto o monitoramento persistente nao estiver configurado.",
      },
      site: { nome: "Gov.br", url: source },
    },
  ];
}
