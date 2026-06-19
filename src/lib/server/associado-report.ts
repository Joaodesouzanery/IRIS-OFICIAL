/**
 * associado-report.ts
 * Coleta os dados do associado no Supabase e monta o preview do documento.
 * Compartilhado por POST /associados/documentos (gerar/salvar) e
 * PATCH /associados/documentos/[id] (editar rascunho / nova versão).
 */

import { buildAssociadoDocument } from "@/lib/server/associado-documents";
import type {
  Associado,
  Deliberacao,
  Diretor,
  DocumentoAssociadoPreview,
  DocumentoAssociadoTipo,
  ListaTripliceItem,
  Mandato,
  MonitoramentoItem,
} from "@/types";

export interface CuradoriaInput {
  vp_paragrafos?: string[];
  vp_foto_url?: string | null;
  vp_minibio?: string | null;
  observacoes_curadoria?: string | null;
  listaTripliceManual?: ListaTripliceItem[];
  sumario_executivo?: string | null;
  perfis_influencias?: string | null;
  correlacao_forcas?: string | null;
  agendas?: string[];
  conclusao?: string | null;
  monitoramento?: string | null;
}

const NEWS_TYPES = ["noticia", "politica_publica", "consulta_publica", "ata", "pauta", "deliberacao", "reuniao", "documento"];

export function curatedText(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

export function normalizeStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
}

export function normalizeManualListaTriplice(value: unknown): ListaTripliceItem[] {
  if (!Array.isArray(value)) return [];
  const items: ListaTripliceItem[] = [];
  for (const [index, item] of value.entries()) {
    const raw = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
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

/** Extrai e sanitiza os campos de curadoria de um body. `existing` (inputs_manuais salvos)
 *  serve de fallback para edições parciais. */
export function sanitizeCuradoria(body: Record<string, unknown>, existing?: Record<string, unknown>): CuradoriaInput {
  const prev = existing ?? {};
  const pick = (key: string, max: number) =>
    key in body ? curatedText(body[key], max) : (typeof prev[key] === "string" ? (prev[key] as string) : null);

  const vpFoto = "vp_foto_url" in body
    ? (typeof body.vp_foto_url === "string" && body.vp_foto_url.trim().startsWith("http") ? body.vp_foto_url.trim().slice(0, 1000) : null)
    : (typeof prev.vp_foto_url === "string" ? (prev.vp_foto_url as string) : null);

  return {
    vp_paragrafos: "vp_paragrafos" in body ? normalizeStringArray(body.vp_paragrafos, 3, 1600) : (Array.isArray(prev.vp_paragrafos) ? (prev.vp_paragrafos as string[]) : []),
    vp_foto_url: vpFoto,
    vp_minibio: pick("vp_minibio", 3000),
    observacoes_curadoria: pick("observacoes_curadoria", 3000),
    listaTripliceManual: "lista_triplice_manual" in body
      ? normalizeManualListaTriplice(body.lista_triplice_manual)
      : (Array.isArray(prev.lista_triplice_manual) ? (prev.lista_triplice_manual as ListaTripliceItem[]) : []),
    sumario_executivo: pick("sumario_executivo", 6000),
    perfis_influencias: pick("perfis_influencias", 8000),
    correlacao_forcas: pick("correlacao_forcas", 6000),
    agendas: "agendas" in body ? normalizeStringArray(body.agendas, 10, 200) : (Array.isArray(prev.agendas) ? (prev.agendas as string[]) : []),
    conclusao: pick("conclusao", 6000),
    monitoramento: pick("monitoramento", 8000),
  };
}

/** Converte a curadoria em objeto plano para persistir em qualidade.inputs_manuais. */
export function curadoriaToInputsManuais(c: CuradoriaInput) {
  return {
    vp_paragrafos: c.vp_paragrafos ?? [],
    vp_foto_url: c.vp_foto_url ?? null,
    vp_minibio: c.vp_minibio ?? null,
    observacoes_curadoria: c.observacoes_curadoria ?? null,
    lista_triplice_manual: c.listaTripliceManual ?? [],
    sumario_executivo: c.sumario_executivo ?? null,
    perfis_influencias: c.perfis_influencias ?? null,
    correlacao_forcas: c.correlacao_forcas ?? null,
    agendas: c.agendas ?? [],
    conclusao: c.conclusao ?? null,
    monitoramento: c.monitoramento ?? null,
  };
}

export async function buildAssociadoPreviewFromDb(
  db: any,
  params: {
    associado: Associado;
    tipo: DocumentoAssociadoTipo;
    periodo_inicio: string;
    periodo_fim: string;
    curadoria: CuradoriaInput;
  },
): Promise<DocumentoAssociadoPreview> {
  const { associado, tipo, periodo_inicio, periodo_fim, curadoria } = params;

  const agSiglas = (associado.agencia_siglas ?? []) as string[];
  const { data: agencias } = await db
    .from("agencias")
    .select("id, sigla")
    .in("sigla", agSiglas.length ? agSiglas : ["__none__"]);
  const agenciaIds = (agencias ?? []).map((a: { id: string }) => a.id);

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
  const today = new Date().toISOString().slice(0, 10);
  const mandatos = (mandatosRaw ?? []).map((m: any) => ({
    id: m.id,
    diretor_id: m.diretor_id,
    diretor_nome: m.diretores?.nome ?? "Diretor",
    agencia_id: m.diretores?.agencia_id,
    data_inicio: m.data_inicio,
    data_fim: m.data_fim,
    cargo: m.cargo,
    status: !m.data_fim || m.data_fim >= today ? "Ativo" : "Inativo",
    review_status: m.review_status,
  })) as Mandato[];

  const { data: noticiasRaw } = await db
    .from("monitoramento_itens")
    .select("*, site:monitoramento_sites(nome, url), agencia:agencias(sigla, nome)")
    .in("tipo", NEWS_TYPES)
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

  let diretoresQuery = db
    .from("diretores")
    .select("*, mandatos(id, data_inicio, data_fim, cargo)")
    .order("nome", { ascending: true });
  if (agenciaIds.length) diretoresQuery = diretoresQuery.in("agencia_id", agenciaIds);
  const { data: diretoresRaw } = await diretoresQuery;

  return buildAssociadoDocument({
    associado,
    tipo,
    periodo_inicio,
    periodo_fim,
    deliberacoes,
    mandatos,
    noticias: (noticiasRaw ?? []) as MonitoramentoItem[],
    listaTriplice: (listaRaw ?? []) as ListaTripliceItem[],
    listaTripliceManual: curadoria.listaTripliceManual,
    diretores: (diretoresRaw ?? []) as Diretor[],
    vp_paragrafos: curadoria.vp_paragrafos,
    vp_foto_url: curadoria.vp_foto_url,
    vp_minibio: curadoria.vp_minibio,
    observacoes_curadoria: curadoria.observacoes_curadoria,
    sumario_executivo: curadoria.sumario_executivo,
    perfis_influencias: curadoria.perfis_influencias,
    correlacao_forcas: curadoria.correlacao_forcas,
    agendas: curadoria.agendas,
    conclusao: curadoria.conclusao,
    monitoramento: curadoria.monitoramento,
  });
}
