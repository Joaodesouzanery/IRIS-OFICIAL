import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { demoData } from "@/lib/demo-data";
import {
  buildAssociadoDocument,
  DEMO_ASSOCIADOS,
} from "@/lib/server/associado-documents";
import type {
  Associado,
  Deliberacao,
  DocumentoAssociadoTipo,
  ListaTripliceItem,
  Mandato,
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
  const vp_paragrafos = normalizeStringArray(body.vp_paragrafos, 3, 1600);
  const observacoes_curadoria = typeof body.observacoes_curadoria === "string" && body.observacoes_curadoria.trim()
    ? body.observacoes_curadoria.trim().slice(0, 3000)
    : null;

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
      listaTripliceManual: normalizeManualListaTriplice(body.lista_triplice_manual),
      vp_paragrafos,
      observacoes_curadoria,
      baseUrl: req.nextUrl.origin,
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

  const agSiglas = (associado.agencia_siglas ?? []) as string[];
  const { data: agencias } = await db
    .from("agencias")
    .select("id, sigla")
    .in("sigla", agSiglas.length ? agSiglas : ["__none__"]);
  const agenciaIds = (agencias ?? []).map((a) => a.id);

  let delibsQuery = db
    .from("deliberacoes")
    .select(`*, agencia:agencias(sigla, nome), votos(id, tipo_voto, is_divergente, diretor_id, diretores(nome))`)
    .gte("data_reuniao", periodo_inicio)
    .lte("data_reuniao", periodo_fim)
    .order("data_reuniao", { ascending: false })
    .limit(200);
  if (agenciaIds.length) delibsQuery = delibsQuery.in("agencia_id", agenciaIds);
  const { data: delibsRaw } = await delibsQuery;

  const deliberacoes = (delibsRaw ?? []).map((d: any) => ({
    ...d,
    votos: (d.votos ?? []).map((v: any) => ({
      id: v.id,
      tipo_voto: v.tipo_voto,
      is_divergente: v.is_divergente,
      is_nominal: true,
      diretor_id: v.diretor_id,
      diretor_nome: v.diretores?.nome ?? null,
    })),
  })) as Deliberacao[];

  let mandatosQuery = db
    .from("mandatos")
    .select("*, diretores!inner(id, nome, agencia_id, agencias(sigla))")
    .order("data_inicio", { ascending: false })
    .limit(100);
  if (agenciaIds.length) mandatosQuery = mandatosQuery.in("diretores.agencia_id", agenciaIds);
  const { data: mandatosRaw } = await mandatosQuery;
  const mandatos = (mandatosRaw ?? []).map((m: any) => ({
    id: m.id,
    diretor_id: m.diretor_id,
    diretor_nome: m.diretores?.nome ?? "Diretor",
    agencia_id: m.diretores?.agencia_id,
    data_inicio: m.data_inicio,
    data_fim: m.data_fim,
    cargo: m.cargo,
    status: !m.data_fim || m.data_fim >= new Date().toISOString().slice(0, 10) ? "Ativo" : "Inativo",
    review_status: m.review_status,
    source_url: m.source_url,
    source_type: m.source_type,
    source_confidence: m.source_confidence,
  })) as Mandato[];

  const { data: noticiasRaw } = await db
    .from("monitoramento_itens")
    .select("*, site:monitoramento_sites(nome, url), agencia:agencias(sigla, nome)")
    .in("tipo", ["noticia", "politica_publica", "consulta_publica", "ata", "pauta", "deliberacao", "reuniao", "documento"])
    .gte("data_reuniao", periodo_inicio)
    .lte("data_reuniao", periodo_fim)
    .order("data_reuniao", { ascending: false })
    .limit(200);

  let listaQuery = db
    .from("lista_triplice")
    .select("*, agencia:agencias(sigla, nome)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (agenciaIds.length) listaQuery = listaQuery.in("agencia_id", agenciaIds);
  const { data: listaRaw } = await listaQuery;

  const preview = buildAssociadoDocument({
    associado: associado as Associado,
    tipo,
    periodo_inicio,
    periodo_fim,
    deliberacoes,
    mandatos,
    noticias: (noticiasRaw ?? []) as MonitoramentoItem[],
    listaTriplice: (listaRaw ?? []) as ListaTripliceItem[],
    listaTripliceManual: normalizeManualListaTriplice(body.lista_triplice_manual),
    vp_paragrafos,
    observacoes_curadoria,
    baseUrl: req.nextUrl.origin,
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
        inputs_manuais: {
          vp_paragrafos,
          lista_triplice_manual: normalizeManualListaTriplice(body.lista_triplice_manual),
          observacoes_curadoria,
        },
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

function normalizeStringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
}

function normalizeManualListaTriplice(value: unknown): ListaTripliceItem[] {
  if (!Array.isArray(value)) return [];
  const items: ListaTripliceItem[] = [];
  for (const [index, item] of value.entries()) {
      const raw = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const nome = typeof raw.nome_candidato === "string"
        ? raw.nome_candidato.trim()
        : typeof raw.nome === "string"
          ? raw.nome.trim()
          : "";
      if (!nome) continue;
      items.push({
        id: `manual-lista-${index}-${nome.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        agencia_id: typeof raw.agencia_id === "string" ? raw.agencia_id : null,
        cargo: typeof raw.cargo === "string" && raw.cargo.trim() ? raw.cargo.trim() : "Diretoria",
        etapa: "mapeamento",
        nome_candidato: nome.slice(0, 180),
        fonte_url: typeof raw.fonte_url === "string" && raw.fonte_url.trim() ? raw.fonte_url.trim() : null,
        fonte_tipo: "manual",
        confidence: 1,
        review_status: "aprovado",
        data_evento: typeof raw.data_evento === "string" ? raw.data_evento : null,
        agencia: null,
      });
      if (items.length >= 20) break;
  }
  return items;
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
