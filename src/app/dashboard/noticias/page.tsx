"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn, formatDateLong } from "@/lib/utils";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { NOTICIAS_TABS } from "@/lib/module-tabs";
import { useDataSyncContext } from "@/components/DataSyncProvider";
import { buildRegulatoryNewsletterHtml } from "@/lib/newsletter-document";
import type {
  RegulatoryNews,
  RegulatoryNewsCollectResponse,
  RegulatoryNewsListResponse,
  RegulatoryNewsletterEditionCreateResponse,
  RegulatoryNewsletterSchedule,
  RegulatoryNewsStatus,
} from "@/types";
import {
  CalendarClock,
  Check,
  Copy,
  ExternalLink,
  ImageIcon,
  Loader2,
  Mail,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

const AGENCIAS = ["ARTESP", "ANTT", "ANM"];
type PeriodFilter = "today" | "7d" | "month" | "all" | "custom";
const PERIODS: Array<{ value: PeriodFilter; label: string }> = [
  { value: "7d", label: "Últimos 7 dias" },
  { value: "today", label: "Hoje" },
  { value: "month", label: "Mensal" },
  { value: "all", label: "Todas recentes" },
  { value: "custom", label: "Data selecionável" },
];
const STATUS: Array<{ value: RegulatoryNewsStatus | ""; label: string }> = [
  { value: "", label: "Todas" },
  { value: "novo", label: "Novas" },
  { value: "selecionado", label: "Selecionadas" },
  { value: "ignorado", label: "Ignoradas" },
  { value: "arquivado", label: "Arquivadas" },
];

interface NewsletterDocumentConfig {
  destinatarios: string;
  assunto: string;
  descricao: string;
  temas: string;
  envioAutomatico: boolean;
}

const NEWSLETTER_CONFIG_KEY = "iris_newsletter_document_config";

const DEFAULT_NEWSLETTER_CONFIG: NewsletterDocumentConfig = {
  destinatarios: "",
  assunto: "Newsletter Regulatório - Atualização semanal",
  descricao: "Seleção das principais notícias regulatórias da semana, com fontes oficiais e contexto para acompanhamento dos associados.",
  temas: "",
  envioAutomatico: false,
};

export default function NoticiasPage() {
  const queryClient = useQueryClient();
  const { demoEnabled, runtimeStatus } = useDataSyncContext();
  const [agencia, setAgencia] = useState("");
  const [status, setStatus] = useState<RegulatoryNewsStatus | "">("");
  const [periodo, setPeriodo] = useState<PeriodFilter>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [documentConfig, setDocumentConfig] = useState<NewsletterDocumentConfig>(DEFAULT_NEWSLETTER_CONFIG);
  const [copied, setCopied] = useState(false);
  const [savedConfig, setSavedConfig] = useState(false);
  const [savedEditionId, setSavedEditionId] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");

  const params = new URLSearchParams();
  if (agencia) params.set("agencia", agencia);
  if (status) params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  params.set("periodo", periodo);
  if (periodo === "all") params.set("include_all_recent", "1");
  if (periodo === "custom") {
    if (customFrom) params.set("from", customFrom);
    if (customTo) params.set("to", customTo);
  }
  params.set("limit", "80");

  const { data, isLoading } = useQuery({
    queryKey: ["noticias", params.toString()],
    queryFn: () => api.get<RegulatoryNewsListResponse>(`/noticias?${params.toString()}`),
  });

  const { data: scheduleData } = useQuery({
    queryKey: ["noticias", "newsletter-schedule"],
    queryFn: () => api.get<{ schedules: RegulatoryNewsletterSchedule[]; due_tomorrow: boolean }>("/noticias/newsletter/schedule"),
  });

  const collectMutation = useMutation({
    mutationFn: () => api.post<RegulatoryNewsCollectResponse>("/noticias/coletar?limit=24"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["noticias"] }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: RegulatoryNewsStatus }) =>
      api.patch<RegulatoryNews>(`/noticias/${id}`, { status_curadoria: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["noticias"] }),
  });

  const scheduleMutation = useMutation({
    mutationFn: () => api.post<{ schedule: RegulatoryNewsletterSchedule }>("/noticias/newsletter/schedule", {
      nome: documentConfig.assunto || "Newsletter Regulatório",
      dia_semana: 5,
      hora_envio: "09:00",
      destinatarios: documentConfig.destinatarios
        .split(/[,\n;]/)
        .map((email) => email.trim())
        .filter(Boolean),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["noticias", "newsletter-schedule"] });
    },
  });

  const saveEditionMutation = useMutation({
    mutationFn: () => api.post<RegulatoryNewsletterEditionCreateResponse>("/newsletter/edicoes", {
      assunto: documentConfig.assunto,
      descricao: documentConfig.descricao,
      destinatarios: splitList(documentConfig.destinatarios),
      temas: splitList(documentConfig.temas),
      noticia_ids: selectedIds,
    }),
    onSuccess: (result) => setSavedEditionId(result.edition.id),
  });

  const noticias = useMemo(() => data?.data ?? [], [data?.data]);
  const selected = useMemo(
    () => selectedIds
      .map((id) => noticias.find((item) => item.id === id))
      .filter((item): item is RegulatoryNews => Boolean(item)),
    [noticias, selectedIds],
  );
  const html = useMemo(() => buildRegulatoryNewsletterHtml({
    assunto: documentConfig.assunto,
    descricao: documentConfig.descricao,
    destinatarios: splitList(documentConfig.destinatarios),
    temas: splitList(documentConfig.temas),
    noticias: selected,
    baseUrl,
  }), [baseUrl, documentConfig.assunto, documentConfig.descricao, documentConfig.destinatarios, documentConfig.temas, selected]);
  const documentHtml = html;

  useEffect(() => {
    setBaseUrl(window.location.origin);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(NEWSLETTER_CONFIG_KEY);
    if (!saved) return;
    try {
      setDocumentConfig({ ...DEFAULT_NEWSLETTER_CONFIG, ...JSON.parse(saved) });
    } catch {
      setDocumentConfig(DEFAULT_NEWSLETTER_CONFIG);
    }
  }, []);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  }

  async function copyHtml() {
    await navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function updateDocumentConfig<K extends keyof NewsletterDocumentConfig>(key: K, value: NewsletterDocumentConfig[K]) {
    setDocumentConfig((prev) => ({ ...prev, [key]: value }));
    setSavedConfig(false);
  }

  function saveDocumentConfig() {
    localStorage.setItem(NEWSLETTER_CONFIG_KEY, JSON.stringify(documentConfig));
    setSavedConfig(true);
    setTimeout(() => setSavedConfig(false), 2200);
  }

  async function copyDocumentHtml() {
    await navigator.clipboard.writeText(documentHtml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openPrintDocument() {
    const win = window.open("", "_blank", "width=980,height=900");
    if (!win) return;
    win.document.open();
    win.document.write(documentHtml);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 400);
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <ModuleTabs tabs={NOTICIAS_TABS} />
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-brand" />
            <h1 className="text-xl font-semibold text-text-primary">Notícias</h1>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Feed regulatório com curadoria para a Newsletter Regulatório semanal.
          </p>
        </div>
        <button
          onClick={() => collectMutation.mutate()}
          disabled={collectMutation.isPending || demoEnabled}
          className="btn-primary"
        >
          {collectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Coletar notícias
        </button>
      </div>

      {demoEnabled ? (
        <div className="border border-error/30 bg-error/10 rounded-card p-3 text-sm text-error">
          {runtimeStatus.mode_reason === "missing_service_role"
            ? "Coleta real indisponível: falta SUPABASE_SERVICE_ROLE_KEY no servidor. O sistema está em DEMO por configuração incompleta."
            : "Modo DEMO ativo: a coleta real e a curadoria persistente ficam bloqueadas em somente leitura."}
        </div>
      ) : null}

      {scheduleData?.due_tomorrow ? (
        <div className="border border-warning/30 bg-warning/10 rounded-card p-3 flex items-start gap-3">
          <CalendarClock className="w-4 h-4 text-warning mt-0.5" />
          <div>
            <p className="text-sm font-medium text-text-primary">A Newsletter Regulatório está prevista para amanhã.</p>
            <p className="text-xs text-text-muted mt-1">Revise as notícias selecionadas e copie o HTML final antes do envio manual.</p>
          </div>
        </div>
      ) : null}

      {collectMutation.data ? (
        <div className="border border-success/30 bg-success/10 rounded-card p-3 text-sm text-success space-y-2">
          <p>{collectMutation.data.upserted} notícias atualizadas de {collectMutation.data.found} encontradas.</p>
          {collectMutation.data.source_reports?.length ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
              {collectMutation.data.source_reports.map((report) => (
                <div key={report.agencia_sigla} className="rounded-md border border-success/20 p-2">
                  <p className="font-semibold">{report.agencia_sigla}: {report.items_collected}/{report.links_found}</p>
                  <p>{report.status === "ok" ? "Coleta concluída" : report.error}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {collectMutation.error ? (
        <div className="border border-error/30 bg-error/10 rounded-card p-3 text-sm text-error">
          {collectMutation.error instanceof Error ? collectMutation.error.message : "Erro ao coletar notícias"}
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6">
        <section className="space-y-4">
          <div className="card flex items-center gap-2 flex-wrap">
            <select className="select w-40" value={agencia} onChange={(e) => setAgencia(e.target.value)}>
              <option value="">Todas as agências</option>
              {AGENCIAS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select className="select w-40" value={status} onChange={(e) => setStatus(e.target.value as RegulatoryNewsStatus | "")}>
              {STATUS.map((item) => <option key={item.label} value={item.value}>{item.label}</option>)}
            </select>
            <select className="select w-44" value={periodo} onChange={(e) => setPeriodo(e.target.value as PeriodFilter)}>
              {PERIODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            {periodo === "custom" ? (
              <>
                <input className="input w-36" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                <input className="input w-36" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </>
            ) : null}
            <label className="relative min-w-[220px] flex-1">
              <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className="input pl-9 w-full"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por título, resumo ou tema"
              />
            </label>
            <p className="text-xs text-text-muted ml-auto">
              {data?.total ?? 0} notícias · {selected.length} selecionadas
            </p>
          </div>

          <div className="space-y-3">
            {isLoading ? (
              <div className="card text-sm text-text-muted">Carregando notícias...</div>
            ) : noticias.length === 0 ? (
              <div className="card text-sm text-text-muted">
                Nenhuma notícia encontrada no período selecionado. Use “Todas recentes” para ver publicações mais antigas da fonte.
              </div>
            ) : noticias.map((item) => (
              <article key={item.id} className="card p-0 overflow-hidden">
                <div className="grid grid-cols-[112px_minmax(0,1fr)]">
                  <NewsImage item={item} />
                  <div className="p-4 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="badge-orange">{item.agencia_sigla ?? item.fonte}</span>
                          <span className="text-xs text-text-muted">{formatDateLong(item.publicado_em ?? item.first_seen_at)}</span>
                          <StatusBadge status={item.status_curadoria} />
                        </div>
                        <h2 className="text-sm font-semibold text-text-primary line-clamp-2">{item.titulo}</h2>
                      </div>
                      <button
                        className={cn(
                          "w-8 h-8 rounded-md border flex items-center justify-center shrink-0",
                          selectedIds.includes(item.id) ? "border-brand bg-brand text-white" : "border-border text-text-muted hover:text-brand",
                        )}
                        onClick={() => toggleSelected(item.id)}
                        aria-label="Selecionar notícia"
                      >
                        {selectedIds.includes(item.id) ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-text-muted mt-2 line-clamp-2">{item.resumo ?? "Sem resumo disponível."}</p>
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        className="btn-secondary text-xs"
                        onClick={() => statusMutation.mutate({ id: item.id, next: "selecionado" })}
                        disabled={statusMutation.isPending || demoEnabled}
                      >
                        <Check className="w-3.5 h-3.5" />
                        Marcar
                      </button>
                      <button
                        className="btn-secondary text-xs"
                        onClick={() => statusMutation.mutate({ id: item.id, next: "ignorado" })}
                        disabled={statusMutation.isPending || demoEnabled}
                      >
                        <X className="w-3.5 h-3.5" />
                        Ignorar
                      </button>
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline inline-flex items-center gap-1 ml-auto">
                        Fonte <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <p className="section-label">Documento da Newsletter</p>
              <Mail className="w-4 h-4 text-text-muted" />
            </div>
            <div className="bg-bg-hover rounded-card p-2 h-[520px] overflow-hidden">
              <iframe
                title="Preview da Newsletter"
                srcDoc={html}
                className="w-full h-full rounded-md bg-white"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button className="btn-primary justify-center" onClick={openPrintDocument} disabled={selected.length === 0}>
                <Copy className="w-4 h-4" />
                Gerar PDF
              </button>
              <button className="btn-secondary justify-center" onClick={copyDocumentHtml} disabled={selected.length === 0}>
                <Copy className="w-4 h-4" />
                {copied ? "Copiado" : "Copiar doc."}
              </button>
            </div>
            <button className="btn-secondary w-full justify-center" onClick={copyHtml} disabled={selected.length === 0}>
              <Copy className="w-4 h-4" />
              Copiar HTML do e-mail
            </button>
            <button
              className="btn-secondary w-full justify-center"
              onClick={() => saveEditionMutation.mutate()}
              disabled={selected.length === 0 || saveEditionMutation.isPending || demoEnabled}
            >
              {saveEditionMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {savedEditionId ? "Edição salva" : "Salvar edição"}
            </button>
            {saveEditionMutation.error ? (
              <p className="text-xs text-error">
                {saveEditionMutation.error instanceof Error ? saveEditionMutation.error.message : "Erro ao salvar edição"}
              </p>
            ) : null}
          </section>

          <section className="card space-y-3">
            <p className="section-label">Configuração para associados</p>
            <input
              className="input"
              value={documentConfig.assunto}
              onChange={(e) => updateDocumentConfig("assunto", e.target.value)}
              placeholder="Assunto do e-mail"
            />
            <textarea
              className="input min-h-24"
              value={documentConfig.descricao}
              onChange={(e) => updateDocumentConfig("descricao", e.target.value)}
              placeholder="Descrição/contexto para os associados"
            />
            <textarea
              className="input min-h-20"
              value={documentConfig.temas}
              onChange={(e) => updateDocumentConfig("temas", e.target.value)}
              placeholder="Temas de interesse, separados por vírgula"
            />
            <textarea
              className="input min-h-20"
              value={documentConfig.destinatarios}
              onChange={(e) => updateDocumentConfig("destinatarios", e.target.value)}
              placeholder="emails dos associados separados por vírgula"
            />
            <label className="flex items-center gap-2 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={documentConfig.envioAutomatico}
                onChange={(e) => updateDocumentConfig("envioAutomatico", e.target.checked)}
                className="accent-brand"
              />
              Preparar para envio automático quando o e-mail remetente for configurado
            </label>
            <button className="btn-secondary w-full justify-center" onClick={saveDocumentConfig}>
              {savedConfig ? "Configuração salva" : "Salvar configuração local"}
            </button>
          </section>

          <section className="card space-y-3">
            <p className="section-label">Aviso semanal</p>
            {(scheduleData?.schedules ?? []).slice(0, 2).map((schedule) => (
              <div key={schedule.id} className="border border-border rounded-card p-3 text-xs text-text-muted">
                <p className="font-medium text-text-primary">{schedule.nome}</p>
                <p className="mt-1">Próximo envio: {schedule.proximo_envio ? formatDateLong(schedule.proximo_envio) : "não definido"}</p>
                <p>{schedule.destinatarios.length} destinatários cadastrados</p>
              </div>
            ))}
            <button
              className="btn-secondary w-full justify-center"
              onClick={() => scheduleMutation.mutate()}
              disabled={scheduleMutation.isPending || !documentConfig.destinatarios.trim() || demoEnabled}
            >
              {scheduleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
              Salvar aviso de sexta
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}

function NewsImage({ item }: { item: RegulatoryNews }) {
  const original = item.imagem_url;
  const [src, setSrc] = useState(original);

  useEffect(() => {
    setSrc(original);
  }, [original]);

  if (!src) {
    return (
      <div className="bg-bg-hover min-h-28 flex items-center justify-center">
        <ImageIcon className="w-6 h-6 text-text-label" />
      </div>
    );
  }

  return (
    <div className="bg-bg-hover min-h-28 flex items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="w-full h-full object-cover"
        onError={() => setSrc(src === original ? proxiedImageUrl(original) : null)}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: RegulatoryNewsStatus }) {
  return (
    <span className={cn(
      "badge text-xs",
      status === "selecionado" && "bg-success/10 text-success",
      status === "novo" && "bg-info/10 text-info",
      status === "ignorado" && "bg-warning/10 text-warning",
      status === "arquivado" && "bg-bg-hover text-text-muted",
    )}>
      {status}
    </span>
  );
}

function buildNewsletterHtml(items: RegulatoryNews[]) {
  const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const [highlight, ...others] = items;
  const heroImage = highlight?.imagem_url ? proxiedImageUrl(highlight.imagem_url, true) : null;

  if (!highlight) {
    return `<div style="font-family:Inter,Arial,sans-serif;color:#e4e4e7;background:#141414;border:1px solid #2a2a2a;border-radius:8px;padding:20px">
      <p style="margin:0;color:#f97316;font:600 11px monospace;letter-spacing:1px;text-transform:uppercase">Newsletter Regulatório</p>
      <h1 style="margin:8px 0 0;font-size:22px">Selecione notícias para montar a edição</h1>
    </div>`;
  }

  return `<div style="font-family:Inter,Arial,sans-serif;color:#f4f4f5;background:#111;border:1px solid #2a2a2a;border-radius:8px;overflow:hidden">
    ${heroImage ? `<img src="${escapeHtml(heroImage)}" alt="" style="display:block;width:100%;height:190px;object-fit:cover">` : ""}
    <div style="padding:22px">
      <p style="margin:0 0 8px;color:#f97316;font:700 11px monospace;letter-spacing:1.2px;text-transform:uppercase">Newsletter Regulatório · ${escapeHtml(today)}</p>
      <h1 style="margin:0;font-size:26px;line-height:1.15">${escapeHtml(highlight.titulo)}</h1>
      <p style="margin:10px 0 0;color:#a1a1aa;font-size:13px">${escapeHtml(highlight.fonte)} · ${escapeHtml(formatDateLong(highlight.publicado_em ?? highlight.first_seen_at))}</p>
      <p style="margin:14px 0 0;color:#d4d4d8;font-size:14px;line-height:1.55">${escapeHtml(highlight.resumo ?? "Sem resumo disponível.")}</p>
      <a href="${escapeHtml(highlight.url)}" style="display:inline-block;margin-top:14px;color:#f97316;font-size:13px;text-decoration:none">Ler fonte oficial</a>
      ${others.length ? `<hr style="border:0;border-top:1px solid #2a2a2a;margin:22px 0">
        ${others.map((item) => `<div style="margin:0 0 18px">
          <p style="margin:0 0 4px;color:#f97316;font:700 10px monospace;text-transform:uppercase">${escapeHtml(item.fonte)}</p>
          <h2 style="margin:0;font-size:17px;line-height:1.25">${escapeHtml(item.titulo)}</h2>
          <p style="margin:8px 0 0;color:#a1a1aa;font-size:13px;line-height:1.45">${escapeHtml(item.resumo ?? "")}</p>
          <a href="${escapeHtml(item.url)}" style="display:inline-block;margin-top:8px;color:#f97316;font-size:12px;text-decoration:none">Fonte oficial</a>
        </div>`).join("")}` : ""}
    </div>
  </div>`;
}

function buildAssociatesDocumentHtml(items: RegulatoryNews[], config: NewsletterDocumentConfig) {
  const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const recipients = config.destinatarios
    .split(/[,\n;]/)
    .map((email) => email.trim())
    .filter(Boolean);
  const themes = config.temas
    .split(/[,\n;]/)
    .map((tema) => tema.trim())
    .filter(Boolean);

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(config.assunto || "Newsletter Regulatório")}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #18181b; background: #f4f4f5; }
    main { max-width: 820px; margin: 0 auto; background: #fff; min-height: 100vh; }
    header { padding: 30px 34px; background: #111; color: #fff; }
    .eyebrow { margin: 0 0 12px; color: #f97316; font: 700 11px monospace; letter-spacing: 1.3px; text-transform: uppercase; }
    h1 { margin: 0; font-size: 30px; line-height: 1.12; }
    .date { margin: 12px 0 0; color: #d4d4d8; font-size: 13px; }
    section { padding: 26px 34px; border-bottom: 1px solid #e4e4e7; }
    h2 { margin: 0 0 12px; font-size: 18px; color: #18181b; }
    p { font-size: 14px; line-height: 1.58; }
    .muted { color: #71717a; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .chip { border: 1px solid #fed7aa; color: #c2410c; background: #fff7ed; border-radius: 999px; padding: 4px 9px; font-size: 11px; font-weight: 700; }
    article { break-inside: avoid; padding: 22px 0; border-top: 1px solid #e4e4e7; }
    article:first-child { border-top: 0; padding-top: 0; }
    .meta { margin: 0 0 8px; color: #f97316; font: 700 11px monospace; text-transform: uppercase; }
    article h3 { margin: 0; font-size: 20px; line-height: 1.25; }
    .news-img { width: 100%; max-height: 260px; object-fit: cover; border-radius: 8px; margin: 14px 0; border: 1px solid #e4e4e7; }
    a { color: #ea580c; text-decoration: none; font-weight: 700; }
    .recipients { font-size: 12px; color: #71717a; }
    footer { padding: 22px 34px; color: #71717a; font-size: 12px; }
    @media print {
      body { background: #fff; }
      main { max-width: none; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">Newsletter Regulatório</p>
      <h1>${escapeHtml(config.assunto || "Atualização semanal para associados")}</h1>
      <p class="date">${escapeHtml(today)}</p>
    </header>
    <section>
      <h2>Contexto</h2>
      <p>${escapeHtml(config.descricao || DEFAULT_NEWSLETTER_CONFIG.descricao)}</p>
      ${themes.length ? `<div class="chips">${themes.map((tema) => `<span class="chip">${escapeHtml(tema)}</span>`).join("")}</div>` : ""}
      ${recipients.length ? `<p class="recipients">Destinatários configurados: ${escapeHtml(recipients.join(", "))}</p>` : ""}
    </section>
    <section>
      <h2>Notícias selecionadas</h2>
      ${items.length ? items.map((item) => renderDocumentNewsItem(item)).join("") : "<p class=\"muted\">Nenhuma notícia selecionada.</p>"}
    </section>
    <footer>
      Documento gerado pelo IRIS Regulação com base nas fontes oficiais das agências reguladoras.
    </footer>
  </main>
</body>
</html>`;
}

function renderDocumentNewsItem(item: RegulatoryNews) {
  const image = item.imagem_url ? proxiedImageUrl(item.imagem_url, true) : null;
  return `<article>
    <p class="meta">${escapeHtml(item.fonte)} · ${escapeHtml(formatDateLong(item.publicado_em ?? item.first_seen_at))}</p>
    <h3>${escapeHtml(item.titulo)}</h3>
    ${image ? `<img class="news-img" src="${escapeHtml(image)}" alt="">` : ""}
    <p>${escapeHtml(item.resumo ?? "Sem resumo disponível.")}</p>
    <p><a href="${escapeHtml(item.url)}">Ler fonte oficial</a></p>
  </article>`;
}

function proxiedImageUrl(value: string | null, absolute = false) {
  if (!value) return null;
  const path = `/api/v1/noticias/imagem?url=${encodeURIComponent(value)}`;
  if (!absolute || typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

function splitList(value: string) {
  return value
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
