"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn, formatDateLong } from "@/lib/utils";
import { useDataSyncContext } from "@/components/DataSyncProvider";
import {
  NEWSLETTER_ARTICLE_TEXT_LIMITS,
  buildMinutoRegulacaoDraftText,
  buildNewsletterArticleTextDraft,
  buildRegulatoryNewsletterHtml,
  estimateNewsletterPageCount,
  type NewsletterArticleSlot,
} from "@/lib/newsletter-document";
import type {
  RegulatoryNews,
  RegulatoryNewsCollectResponse,
  RegulatoryNewsListResponse,
  RegulatoryNewsletterEditionCreateResponse,
  RegulatoryNewsletterSchedule,
  RegulatoryNewsStatus,
  NewsletterDocumentType,
} from "@/types";
import {
  CalendarClock,
  Check,
  Copy,
  ExternalLink,
  LayoutGrid,
  Link2,
  Loader2,
  Mail,
  Newspaper,
  Plus,
  RefreshCw,
  Rows,
  Search,
  X,
} from "lucide-react";

type PeriodFilter = "today" | "7d" | "month" | "all" | "custom";

// Agências com fonte de notícias monitorada (popula o filtro mesmo sem itens carregados).
const AGENCIAS_MONITORADAS = ["ANA", "ANAC", "ANATEL", "ANCINE", "ANEEL", "ANM", "ANP", "ANPD", "ANS", "ANTAQ", "ANTT", "ANVISA", "ARTESP"] as const;
type MinutoEditorialDraft = {
  titulo_geral: string;
  subtitulo_geral: string;
  itens: Array<Record<string, unknown>>;
  llm_used: boolean;
  review_required: boolean;
};
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
  documentoTipo: NewsletterDocumentType;
  templateVariant: "v1" | "v2";
  diaSemana: string;
  horaEnvio: string;
}

type NewsCollectRequest = {
  offset?: number;
  sourceId?: string | null;
  agenciaSigla?: string | null;
  tier?: "core" | "expanded" | "all";
  scope?: "priority" | "all";
  mode?: "discover" | "enrich";
  limit?: number;
};

const NEWSLETTER_CONFIG_KEY = "iris_newsletter_document_config";
const NEWS_VIEW_MODE_KEY = "iris_news_view_mode";
const EXPANDED_NEWS_AGENCIES = ["ANA", "ANAC", "ANATEL", "ANCINE", "ANEEL", "ANP", "ANPD", "ANS", "ANTAQ", "ANVISA"] as const;

const DEFAULT_NEWSLETTER_CONFIG: NewsletterDocumentConfig = {
  destinatarios: "",
  assunto: "Newsletter Regulatório - Atualização semanal",
  descricao: "Seleção das principais notícias regulatórias da semana, com fontes oficiais e contexto para acompanhamento dos associados.",
  temas: "",
  envioAutomatico: false,
  documentoTipo: "newsletter_regulatoria",
  templateVariant: "v1",
  diaSemana: "5",
  horaEnvio: "09:00",
};

async function collectNewsBatch({ offset = 0, sourceId, agenciaSigla, tier = "all", scope, mode, limit = 8 }: NewsCollectRequest = {}) {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    tier,
  });
  if (scope) query.set("scope", scope);
  if (mode) query.set("mode", mode);
  if (sourceId) query.set("source_id", sourceId);
  if (agenciaSigla) query.set("agencia_sigla", agenciaSigla);
  return api.post<RegulatoryNewsCollectResponse>(`/noticias/coletar?${query.toString()}`);
}

async function collectExpandedNewsBatch(onProgress: (message: string) => void) {
  const results: RegulatoryNewsCollectResponse[] = [];
  for (let index = 0; index < EXPANDED_NEWS_AGENCIES.length; index += 1) {
    const agenciaSigla = EXPANDED_NEWS_AGENCIES[index];
    onProgress(`Coletando ${agenciaSigla} ${index + 1}/${EXPANDED_NEWS_AGENCIES.length}`);
    try {
      results.push(await collectNewsBatch({
        agenciaSigla,
        tier: "expanded",
        scope: "all",
        mode: "enrich",
        limit: 3,
      }));
    } catch (error) {
      results.push({
        found: 0,
        upserted: 0,
        items: [],
        partial_success: false,
        failed_sources: [{
          agencia_sigla: agenciaSigla,
          fonte: agenciaSigla,
          source_url: "",
          error: error instanceof Error ? error.message : "Falha ao coletar fonte expandida",
        }],
        source_reports: [{
          agencia_sigla: agenciaSigla,
          fonte: agenciaSigla,
          tier: "expanded",
          source_url: "",
          status: "error",
          links_found: 0,
          items_collected: 0,
          items_processed: 0,
          items_pending: 0,
          batch_offset: 0,
          images_found: 0,
          images_absent: 0,
          images_failed: 0,
          latest_urls: [],
          error: error instanceof Error ? error.message : "Falha ao coletar fonte expandida",
        }],
      });
    }
  }
  return mergeCollectResponses(results);
}

function mergeCollectResponses(results: RegulatoryNewsCollectResponse[]): RegulatoryNewsCollectResponse {
  const sumBatch = results.reduce((sum, item) => ({
    links_detectados: sum.links_detectados + (item.batch?.links_detectados ?? 0),
    itens_processados: sum.itens_processados + (item.batch?.itens_processados ?? 0),
    itens_pendentes: sum.itens_pendentes + (item.batch?.itens_pendentes ?? 0),
    imagens_encontradas: sum.imagens_encontradas + (item.batch?.imagens_encontradas ?? 0),
    imagens_ausentes: sum.imagens_ausentes + (item.batch?.imagens_ausentes ?? 0),
    imagens_com_falha: sum.imagens_com_falha + (item.batch?.imagens_com_falha ?? 0),
  }), {
    links_detectados: 0,
    itens_processados: 0,
    itens_pendentes: 0,
    imagens_encontradas: 0,
    imagens_ausentes: 0,
    imagens_com_falha: 0,
  });
  const sumAudit = results.reduce((sum, item) => ({
    imagens_alta_qualidade: sum.imagens_alta_qualidade + (item.audit?.imagens_alta_qualidade ?? 0),
    imagens_baixa_qualidade: sum.imagens_baixa_qualidade + (item.audit?.imagens_baixa_qualidade ?? 0),
    conteudo_completo: sum.conteudo_completo + (item.audit?.conteudo_completo ?? 0),
    conteudo_curto: sum.conteudo_curto + (item.audit?.conteudo_curto ?? 0),
    sem_conteudo: sum.sem_conteudo + (item.audit?.sem_conteudo ?? 0),
    proxy_pronto: sum.proxy_pronto + (item.audit?.proxy_pronto ?? 0),
  }), {
    imagens_alta_qualidade: 0,
    imagens_baixa_qualidade: 0,
    conteudo_completo: 0,
    conteudo_curto: 0,
    sem_conteudo: 0,
    proxy_pronto: 0,
  });
  const failed_sources = results.flatMap((item) => item.failed_sources ?? []);
  const source_reports = results.flatMap((item) => item.source_reports ?? []);
  const next_batch = results.find((item) => item.next_batch?.recommended)?.next_batch ?? null;
  const found = results.reduce((sum, item) => sum + (item.found ?? 0), 0);
  const upserted = results.reduce((sum, item) => sum + (item.upserted ?? 0), 0);
  return {
    found,
    upserted,
    items: results.flatMap((item) => item.items ?? []),
    partial_success: failed_sources.length > 0 && (found > 0 || upserted > 0),
    failed_sources,
    source_reports,
    batch: sumBatch,
    audit: sumAudit,
    next_batch,
    error: found === 0 && failed_sources.length ? "Nenhuma noticia foi salva no lote expandido completo." : undefined,
  };
}

export default function NoticiasPage() {
  const queryClient = useQueryClient();
  const { demoEnabled, runtimeStatus } = useDataSyncContext();
  const [agencia, setAgencia] = useState("");
  const [status, setStatus] = useState<RegulatoryNewsStatus | "">("");
  const [periodo, setPeriodo] = useState<PeriodFilter>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [search, setSearch] = useState("");
  const [newsletterSelectedIds, setNewsletterSelectedIds] = useState<string[]>([]);
  const [minutoSelectedIds, setMinutoSelectedIds] = useState<string[]>([]);
  const [selectedNewsCache, setSelectedNewsCache] = useState<Record<string, RegulatoryNews>>({});
  const [newsletterArticleTexts, setNewsletterArticleTexts] = useState<Record<string, string>>({});
  const [documentConfig, setDocumentConfig] = useState<NewsletterDocumentConfig>(DEFAULT_NEWSLETTER_CONFIG);
  const [minutoDraftStatus, setMinutoDraftStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedConfig, setSavedConfig] = useState(false);
  const [savedEditionId, setSavedEditionId] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [minutoTextos, setMinutoTextos] = useState("");
  const [collectProgress, setCollectProgress] = useState<string | null>(null);
  const [addUrl, setAddUrl] = useState("");
  const [addUrlFeedback, setAddUrlFeedback] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [pageView, setPageView] = useState<"feed" | "documento">("feed");
  const lastMinutoSelectionKey = useRef("");

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
  const [visibleCount, setVisibleCount] = useState(80);
  // Reseta a paginação ao trocar de filtro (senão pediria uma página maior de outro recorte).
  useEffect(() => { setVisibleCount(80); }, [agencia, status, search, periodo, customFrom, customTo]);
  params.set("limit", String(Math.min(visibleCount, 100)));

  const { data, isLoading } = useQuery({
    queryKey: ["noticias", params.toString()],
    queryFn: () => api.get<RegulatoryNewsListResponse>(`/noticias?${params.toString()}`),
  });

  const { data: scheduleData } = useQuery({
    queryKey: ["noticias", "newsletter-schedule"],
    queryFn: () => api.get<{
      schedules: RegulatoryNewsletterSchedule[];
      due_today: boolean;
      due_tomorrow: boolean;
      due_schedules: RegulatoryNewsletterSchedule[];
    }>("/noticias/newsletter/schedule"),
  });

  const collectMutation = useMutation({
    mutationFn: async (request: NewsCollectRequest = {}) => {
      const isSingleSource = Boolean(request.sourceId || request.agenciaSigla || request.offset);
      if (isSingleSource) {
        return collectNewsBatch({ ...request, tier: request.tier ?? "all", limit: request.limit ?? 8 });
      }
      if (request.scope === "all" && request.tier === "all") {
        setCollectProgress("Coletando ANTT, ANM e ARTESP...");
        const priority = await collectNewsBatch({
          offset: 0,
          tier: "core",
          scope: "priority",
          mode: "enrich",
          limit: request.limit ?? 8,
        });
        const expanded = await collectExpandedNewsBatch(setCollectProgress);
        setCollectProgress(null);
        return mergeCollectResponses([priority, expanded]);
      }
      if (request.scope === "all" && request.tier === "expanded") {
        const result = await collectExpandedNewsBatch(setCollectProgress);
        setCollectProgress(null);
        return result;
      }

      setCollectProgress(request.scope === "all" || request.tier === "expanded" ? "Coletando lote expandido..." : "Coletando ANTT, ANM e ARTESP...");
      const result = await collectNewsBatch({
        offset: 0,
        tier: request.tier ?? "all",
        scope: request.scope ?? "priority",
        mode: request.mode ?? "enrich",
        limit: request.limit ?? 8,
      });
      setCollectProgress(null);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["noticias"] });
      queryClient.invalidateQueries({ queryKey: ["noticias", "health"] });
    },
    onSettled: () => setCollectProgress(null),
  });

  const addByUrlMutation = useMutation({
    mutationFn: (url: string) =>
      api.post<{ ok: boolean; agencia_detectada: string; agencia_cadastrada: boolean }>("/noticias/adicionar", { url }),
    onSuccess: (res) => {
      // Mostra "Todas recentes" para a notícia adicionada aparecer na hora, mesmo
      // que seja antiga (fora do filtro de data atual). Antes a mensagem prometia
      // "já aparece" mas o filtro Mensal/7d podia escondê-la.
      setPeriodo("all");
      setAgencia("");
      setStatus("");
      setAddUrlFeedback(
        `Notícia adicionada (${res.agencia_detectada}${res.agencia_cadastrada ? "" : " — agência não cadastrada"}). Mostrando em "Todas recentes".`,
      );
      setAddUrl("");
      queryClient.invalidateQueries({ queryKey: ["noticias"] });
    },
    onError: (err) => {
      setAddUrlFeedback(err instanceof Error ? err.message : "Falha ao adicionar a notícia.");
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: RegulatoryNewsStatus }) =>
      api.patch<RegulatoryNews>(`/noticias/${id}`, { status_curadoria: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["noticias"] }),
  });

  // Re-resolve imagens de notícias já coletadas sem foto (a coleta normal pula URLs
  // conhecidas). Re-chama enquanto sobrar (orçamento de tempo). Filtra pela agência
  // selecionada quando houver, senão todas.
  const [imagensFeedback, setImagensFeedback] = useState<string | null>(null);
  const reprocessarImagensMutation = useMutation({
    mutationFn: () => {
      const qs = agencia ? `?agencia_sigla=${encodeURIComponent(agencia)}` : "";
      return api.post<{ encontrados: number; recuperadas: number; sem_imagem: number; falhas: number; restantes: number }>(
        `/noticias/reprocessar-imagens${qs}`, {},
      );
    },
    onSuccess: (res) => {
      setImagensFeedback(
        `${res.recuperadas} imagem(ns) recuperada(s)${res.restantes ? ` · ${res.restantes} restante(s), clique de novo` : ""}${res.sem_imagem ? ` · ${res.sem_imagem} sem foto na origem` : ""}.`,
      );
      queryClient.invalidateQueries({ queryKey: ["noticias"] });
    },
    onError: (err) => setImagensFeedback(err instanceof Error ? err.message : "Falha ao recuperar imagens."),
  });

  const scheduleMutation = useMutation({
    mutationFn: () => api.post<{ schedule: RegulatoryNewsletterSchedule }>("/noticias/newsletter/schedule", {
      nome: documentConfig.assunto || "Newsletter Regulatório",
      dia_semana: Number(documentConfig.diaSemana),
      hora_envio: documentConfig.horaEnvio,
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
      documento_tipo: documentConfig.documentoTipo,
      template_variant: documentConfig.templateVariant,
      newsletter_textos: newsletterTextOverrides,
      minuto_textos: splitMinutoTextos(minutoTextos),
      minuto_items: documentConfig.documentoTipo === "minuto_regulacao" ? minutoItems : [],
    }),
    onSuccess: (result) => setSavedEditionId(result.edition.id),
  });

  const minutoDraftMutation = useMutation({
    mutationFn: () => api.post<MinutoEditorialDraft>("/newsletter/minuto/draft", {
      noticia_ids: minutoSelectedIds,
    }),
    onSuccess: (result) => {
      setDocumentConfig((prev) => ({
        ...prev,
        assunto: result.titulo_geral || prev.assunto,
        descricao: result.subtitulo_geral || prev.descricao,
      }));
      setMinutoTextos(formatMinutoDraftForTeleprompter(result.itens));
      setMinutoDraftStatus(result.llm_used
        ? "Roteiro gerado pelo provedor editorial configurado."
        : "Roteiro gerado pelo fallback local; revise a fala antes de gravar.");
      setSavedEditionId(null);
    },
  });

  const noticias = useMemo(() => data?.data ?? [], [data?.data]);
  const agencias = useMemo(
    () => Array.from(new Set([
      ...AGENCIAS_MONITORADAS,
      ...noticias.map((item) => item.agencia_sigla).filter((sigla): sigla is string => Boolean(sigla)),
    ])),
    [noticias],
  );
  const selectedIds = documentConfig.documentoTipo === "minuto_regulacao" ? minutoSelectedIds : newsletterSelectedIds;
  const newsletterSelected = useMemo(
    () => newsletterSelectedIds
      .map((id) => selectedNewsCache[id] ?? noticias.find((item) => item.id === id))
      .filter((item): item is RegulatoryNews => Boolean(item)),
    [noticias, newsletterSelectedIds, selectedNewsCache],
  );
  const minutoSelected = useMemo(
    () => minutoSelectedIds
      .map((id) => selectedNewsCache[id] ?? noticias.find((item) => item.id === id))
      .filter((item): item is RegulatoryNews => Boolean(item)),
    [noticias, minutoSelectedIds, selectedNewsCache],
  );
  const selected = useMemo(
    () => selectedIds
      .map((id) => selectedNewsCache[id] ?? noticias.find((item) => item.id === id))
      .filter((item): item is RegulatoryNews => Boolean(item)),
    [noticias, selectedIds, selectedNewsCache],
  );
  const minutoItems = useMemo(
    () => parseMinutoItemsForSelection(minutoTextos, minutoSelected),
    [minutoTextos, minutoSelected],
  );
  const newsletterTextOverrides = useMemo(() => {
    if (documentConfig.documentoTipo !== "newsletter_regulatoria") return {};
    return newsletterSelected.reduce<Record<string, string>>((acc, item, index) => {
      const value = newsletterArticleTexts[item.id]?.trim();
      if (!value) return acc;
      acc[item.id] = value.slice(0, newsletterTextLimitForIndex(index));
      return acc;
    }, {});
  }, [documentConfig.documentoTipo, newsletterArticleTexts, newsletterSelected]);
  const html = useMemo(() => buildRegulatoryNewsletterHtml({
    assunto: documentConfig.assunto,
    descricao: documentConfig.descricao,
    destinatarios: splitList(documentConfig.destinatarios),
    temas: splitList(documentConfig.temas),
    noticias: selected,
    newsletter_textos: newsletterTextOverrides,
    baseUrl,
    documento_tipo: documentConfig.documentoTipo,
    template_version: templateVersionFor(documentConfig.documentoTipo, documentConfig.templateVariant),
    minuto_textos: splitMinutoTextos(minutoTextos),
    minuto_items: documentConfig.documentoTipo === "minuto_regulacao" ? minutoItems : [],
  }), [baseUrl, documentConfig.assunto, documentConfig.descricao, documentConfig.destinatarios, documentConfig.documentoTipo, documentConfig.templateVariant, documentConfig.temas, minutoItems, minutoTextos, newsletterTextOverrides, selected]);
  const documentHtml = html;
  const documentLabel = documentConfig.documentoTipo === "minuto_regulacao" ? "Minuto da Regulação" : "Newsletter Regulatória";
  const minutoDraft = useMemo(() => buildMinutoRegulacaoDraftText(minutoSelected), [minutoSelected]);
  const dueTodaySchedules = scheduleData?.due_schedules ?? [];
  const previewPage = documentConfig.documentoTipo === "minuto_regulacao"
    ? { width: 1123, height: 794, scale: 0.43 }
    : { width: 960, height: 1357, scale: 0.49 };
  const previewPageCount = documentConfig.documentoTipo === "minuto_regulacao"
    ? Math.max(1, selected.length)
    : estimateNewsletterPageCount(selected);

  useEffect(() => {
    setBaseUrl(window.location.origin);
    const savedView = localStorage.getItem(NEWS_VIEW_MODE_KEY);
    if (savedView === "grid" || savedView === "list") setViewMode(savedView);
  }, []);

  useEffect(() => {
    localStorage.setItem(NEWS_VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (!noticias.length) return;
    setSelectedNewsCache((previous) => {
      const next = { ...previous };
      for (const item of noticias) next[item.id] = item;
      return next;
    });
  }, [noticias]);

  useEffect(() => {
    const saved = localStorage.getItem(NEWSLETTER_CONFIG_KEY);
    if (!saved) return;
    try {
      setDocumentConfig({ ...DEFAULT_NEWSLETTER_CONFIG, ...JSON.parse(saved) });
    } catch {
      setDocumentConfig(DEFAULT_NEWSLETTER_CONFIG);
    }
  }, []);

  useEffect(() => {
    if (documentConfig.documentoTipo !== "minuto_regulacao") return;
    const key = minutoSelectedIds.join("|");
    if (key === lastMinutoSelectionKey.current) return;
    lastMinutoSelectionKey.current = key;
    setMinutoTextos(minutoSelected.length > 0 ? minutoDraft : "");
    setSavedEditionId(null);
  }, [documentConfig.documentoTipo, minutoDraft, minutoSelected.length, minutoSelectedIds]);

  function toggleSelected(item: RegulatoryNews, target: NewsletterDocumentType) {
    setSelectedNewsCache((previous) => ({ ...previous, [item.id]: item }));
    const setter = target === "minuto_regulacao" ? setMinutoSelectedIds : setNewsletterSelectedIds;
    setter((prev) => toggleId(prev, item.id));
    setSavedEditionId(null);
  }

  function toggleSelectAllVisible() {
    const visibleIds = noticias.map((item) => item.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => newsletterSelectedIds.includes(id));
    setSelectedNewsCache((previous) => {
      const next = { ...previous };
      for (const item of noticias) next[item.id] = item;
      return next;
    });
    setNewsletterSelectedIds((prev) => {
      if (allSelected) return prev.filter((id) => !visibleIds.includes(id));
      const merged = new Set(prev);
      for (const id of visibleIds) merged.add(id);
      return Array.from(merged);
    });
    setSavedEditionId(null);
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

  function updateNewsletterArticleText(id: string, value: string, limit: number) {
    setNewsletterArticleTexts((prev) => ({ ...prev, [id]: value.slice(0, limit) }));
    setSavedEditionId(null);
  }

  function resetNewsletterArticleText(id: string) {
    setNewsletterArticleTexts((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSavedEditionId(null);
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
    let printed = false;
    const printWhenReady = async () => {
      if (printed) return;
      printed = true;
      try {
        await win.document.fonts?.ready;
      } catch {
        // Fonts are best effort in the print window.
      }
      const images = Array.from(win.document.images);
      await Promise.all(images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
      }));
      win.focus();
      win.print();
    };
    win.addEventListener("load", () => {
      window.setTimeout(printWhenReady, 150);
    }, { once: true });
    window.setTimeout(printWhenReady, 1800);
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-end justify-between gap-4 flex-wrap pt-2">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Newspaper className="w-4 h-4 text-brand" />
            <span className="news-eyebrow">Feed Regulatório</span>
          </div>
          <h1 className="news-hero-title">As últimas notícias</h1>
          <p className="text-sm text-text-muted mt-2">
            Marque as notícias para selecioná-las e gerar a Newsletter Regulatório.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={toggleSelectAllVisible}
            disabled={noticias.length === 0}
            className="btn-secondary"
            title="Seleciona todas as notícias listadas para a Newsletter"
          >
            <Check className="w-4 h-4" />
            Selecionar todas ({noticias.length})
          </button>
          <button
            onClick={() => reprocessarImagensMutation.mutate()}
            disabled={reprocessarImagensMutation.isPending || demoEnabled}
            className="btn-secondary"
            title="Recupera a foto das notícias já coletadas que ficaram sem imagem (a coleta normal não reprocessa URLs já conhecidas)"
          >
            {reprocessarImagensMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Recuperar imagens
          </button>
          <button
            onClick={() => collectMutation.mutate({ scope: "all", tier: "all" })}
            disabled={collectMutation.isPending || demoEnabled}
            className="btn-primary"
            title="Coleta notícias de todas as agências reguladoras (com fotos)"
          >
            {collectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {collectProgress ?? "Coletar Notícias"}
          </button>
        </div>
      </div>
      {imagensFeedback && (
        <p className={cn("text-xs", reprocessarImagensMutation.isError ? "text-error" : "text-success")}>{imagensFeedback}</p>
      )}

      {/* Adicionar notícia por LINK: o crawler não pega tudo (páginas antigas, fontes sem API).
          Cole a URL e o sistema ingere a notícia direto no feed (selecionável no Minuto/Newsletter). */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Link2 className="w-4 h-4 text-brand shrink-0" />
          <input
            type="url"
            value={addUrl}
            onChange={(e) => { setAddUrl(e.target.value); setAddUrlFeedback(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && addUrl.trim() && !demoEnabled) addByUrlMutation.mutate(addUrl.trim()); }}
            placeholder="Colar link de uma notícia (gov.br, ARTESP...) para adicionar ao feed"
            className="input flex-1 min-w-[240px]"
            disabled={addByUrlMutation.isPending || demoEnabled}
          />
          <button
            onClick={() => addUrl.trim() && addByUrlMutation.mutate(addUrl.trim())}
            disabled={!addUrl.trim() || addByUrlMutation.isPending || demoEnabled}
            className="btn-secondary"
            title="Ingere uma única notícia a partir do link colado"
          >
            {addByUrlMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Adicionar por link
          </button>
        </div>
        {addUrlFeedback && (
          <p className={cn("text-xs", addByUrlMutation.isError ? "text-error" : "text-success")}>{addUrlFeedback}</p>
        )}
      </div>

      {/* Sub-abas internas: Feed (lista de notícias) x Documento (preview Newsletter/Minuto). */}
      <div className="flex items-center gap-6 border-b border-border">
        {([
          { value: "feed", label: "Feed" },
          { value: "documento", label: "Documento" },
        ] as const).map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setPageView(tab.value)}
            className={cn(
              "relative -mb-px px-1 py-2.5 text-sm transition-colors duration-200",
              pageView === tab.value
                ? "text-text-primary font-medium border-b-2 border-brand"
                : "text-text-muted border-b-2 border-transparent hover:text-text-primary",
            )}
          >
            {tab.label}
            {tab.value === "documento" && selected.length > 0 ? (
              <span className="ml-1.5 badge-gray text-[10px]">{selected.length}</span>
            ) : null}
          </button>
        ))}
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

      {scheduleData?.due_today ? (
        <div className="border border-brand/30 bg-brand/10 rounded-card p-3 flex items-start gap-3">
          <CalendarClock className="w-4 h-4 text-brand mt-0.5" />
          <div>
            <p className="text-sm font-medium text-text-primary">
              Hoje e dia de enviar a Newsletter para {dueTodaySchedules.reduce((sum, schedule) => sum + (schedule.recipient_count ?? schedule.destinatarios.length), 0)} associados/destinatarios.
            </p>
            <p className="text-xs text-text-muted mt-1">Revise as noticias selecionadas, gere o PDF e envie pelo canal configurado.</p>
          </div>
        </div>
      ) : null}

      {collectMutation.data ? (
        <div className="border border-success/30 bg-success/10 rounded-card p-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-success inline-flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>
              {collectMutation.data.upserted} notícias coletadas
              {typeof collectMutation.data.batch?.imagens_encontradas === "number"
                ? ` · ${collectMutation.data.batch.imagens_encontradas} com foto`
                : ""}
              {collectMutation.data.partial_success ? " · algumas fontes falharam" : ""}
            </span>
          </p>
          {collectMutation.data.next_batch?.recommended ? (
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={collectMutation.isPending || demoEnabled}
              onClick={() => {
                const nextBatch = collectMutation.data?.next_batch;
                if (nextBatch) collectMutation.mutate(nextBatch);
              }}
            >
              Buscar mais notícias
            </button>
          ) : null}
        </div>
      ) : null}
      {collectMutation.error ? (
        <div className="border border-error/30 bg-error/10 rounded-card p-3 text-sm text-error">
          {collectMutation.error instanceof Error ? collectMutation.error.message : "Erro ao coletar notícias"}
        </div>
      ) : null}

      <div className="w-full">
        <section className={cn("space-y-4", pageView === "documento" && "hidden")}>
          <div className="card flex items-center gap-2 flex-wrap">
            <select className="select w-40" value={agencia} onChange={(e) => setAgencia(e.target.value)}>
              <option value="">Todas as agências</option>
              {agencias.map((item) => <option key={item} value={item}>{item}</option>)}
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
              {data?.total ?? 0} notícias · Newsletter {newsletterSelected.length} ({estimateNewsletterPageCount(newsletterSelected)} pág.) · Minuto {minutoSelected.length}
            </p>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={cn("px-2.5 py-1.5 text-xs inline-flex items-center gap-1", viewMode === "list" ? "bg-brand/10 text-brand" : "text-text-muted hover:bg-bg-hover")}
                title="Lista (uma embaixo da outra)"
              >
                <Rows className="w-3.5 h-3.5" /> Lista
              </button>
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={cn("px-2.5 py-1.5 text-xs inline-flex items-center gap-1 border-l border-border", viewMode === "grid" ? "bg-brand/10 text-brand" : "text-text-muted hover:bg-bg-hover")}
                title="Grade (estilo newsroom)"
              >
                <LayoutGrid className="w-3.5 h-3.5" /> Grade
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="card text-sm text-text-muted">Carregando notícias...</div>
          ) : noticias.length === 0 ? (
            <div className="card text-sm text-text-muted">
              Nenhuma notícia encontrada no período selecionado. Use “Todas recentes” para ver publicações mais antigas da fonte.
            </div>
          ) : (
            <div className={cn(viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-8 gap-y-12 items-start" : "divide-y divide-border")}>
              {noticias.map((item) => (
                <article key={item.id} className={cn("news-card group", viewMode === "list" ? "sm:flex-row sm:gap-5 sm:items-start py-7 first:pt-0" : "")}>
                  {viewMode === "list" ? (
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-brand cursor-pointer"
                      checked={newsletterSelectedIds.includes(item.id)}
                      onChange={() => toggleSelected(item, "newsletter_regulatoria")}
                      title="Selecionar para a Newsletter"
                    />
                  ) : null}
                  <div className={cn(viewMode === "list" ? "sm:w-52 sm:shrink-0 sm:mt-0.5" : "")}>
                    <NewsImage item={item} cover />
                  </div>
                  <div className={cn("min-w-0 flex flex-col flex-1", viewMode === "list" ? "" : "pt-3")}>
                    <p className="news-eyebrow">
                      {(item.agencia_sigla ?? item.fonte)}, {formatDateLong(item.publicado_em ?? item.first_seen_at)}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 mb-2">
                      <StatusBadge status={item.status_curadoria} />
                    </div>
                    <h2 className={cn("news-title", viewMode === "grid" ? "news-title-grid" : "news-title-list")}>{item.titulo}</h2>
                    <p className={cn("text-sm text-text-secondary mt-2.5 leading-relaxed", viewMode === "grid" ? "line-clamp-3" : "line-clamp-2")}>
                      {item.resumo ?? "Sem resumo disponível."}
                    </p>
                    <div className="flex items-center gap-2 mt-4 flex-wrap">
                      <a href={item.url} target="_blank" rel="noreferrer" className="news-readhere mr-2">
                        ↳ Saiba Mais <ExternalLink className="w-3 h-3" />
                      </a>
                      <button
                        className="btn-secondary text-xs whitespace-nowrap"
                        onClick={() => statusMutation.mutate({ id: item.id, next: "selecionado" })}
                        disabled={statusMutation.isPending || demoEnabled}
                      >
                        <Check className="w-3.5 h-3.5" />
                        Marcar
                      </button>
                      <button
                        className="btn-secondary text-xs whitespace-nowrap"
                        onClick={() => statusMutation.mutate({ id: item.id, next: "ignorado" })}
                        disabled={statusMutation.isPending || demoEnabled}
                      >
                        <X className="w-3.5 h-3.5" />
                        Ignorar
                      </button>
                      <button
                        className={cn("btn-secondary text-xs whitespace-nowrap", newsletterSelectedIds.includes(item.id) && "border-brand text-brand")}
                        onClick={() => toggleSelected(item, "newsletter_regulatoria")}
                      >
                        {newsletterSelectedIds.includes(item.id) ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        Newsletter
                      </button>
                      <button
                        className={cn("btn-secondary text-xs whitespace-nowrap", minutoSelectedIds.includes(item.id) && "border-brand text-brand")}
                        onClick={() => toggleSelected(item, "minuto_regulacao")}
                      >
                        {minutoSelectedIds.includes(item.id) ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        Minuto
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {!isLoading && (data?.total ?? 0) > noticias.length && (
            <div className="pt-4 text-center">
              {visibleCount < 100 ? (
                <button type="button" className="btn-secondary text-sm" onClick={() => setVisibleCount(100)}>
                  Carregar mais ({(data?.total ?? 0) - noticias.length} restante{(data?.total ?? 0) - noticias.length > 1 ? "s" : ""})
                </button>
              ) : (
                <p className="text-xs text-text-muted">
                  Mostrando {noticias.length} de {data?.total ?? 0}. Refine por agência, período ou busca para ver as demais.
                </p>
              )}
            </div>
          )}
        </section>

        <aside className={cn("self-start", pageView === "feed" && "hidden")}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Coluna esquerda: pré-visualização + exportação. */}
          <div className="space-y-4 lg:sticky lg:top-4">
            {savedEditionId ? (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <a className="btn-secondary justify-center text-xs" href={`/api/v1/newsletter/edicoes/${savedEditionId}/html`} target="_blank" rel="noreferrer">
                  HTML
                </a>
                <a className="btn-secondary justify-center text-xs" href={`/api/v1/newsletter/edicoes/${savedEditionId}/pdf`} target="_blank" rel="noreferrer">
                  PDF / imprimir
                </a>
                <a className="btn-secondary justify-center text-xs" href={`/api/v1/newsletter/edicoes/${savedEditionId}/word`}>
                  Word .doc
                </a>
                <a className="btn-secondary justify-center text-xs" href={`/api/v1/newsletter/edicoes/${savedEditionId}/docx`}>
                  DOCX
                </a>
              </div>
            ) : null}
          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <p className="section-label">Pré-visualização: {documentLabel}</p>
              <Mail className="w-4 h-4 text-text-muted" />
            </div>
            <div className="bg-bg-hover rounded-card p-3 overflow-auto">
              <div
                className="mx-auto overflow-hidden rounded-md shadow-sm bg-white"
                style={{
                  width: previewPage.width * previewPage.scale,
                  height: previewPage.height * previewPage.scale * previewPageCount,
                }}
              >
                <iframe
                  title={`Preview do documento ${documentLabel}`}
                  srcDoc={html}
                  style={{
                    width: previewPage.width,
                    height: previewPage.height * previewPageCount,
                    transform: `scale(${previewPage.scale})`,
                    transformOrigin: "top left",
                    border: 0,
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button className="btn-primary justify-center" onClick={openPrintDocument} disabled={selected.length === 0}>
                <Copy className="w-4 h-4" />
                Imprimir PDF
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
          </div>
          {/* Coluna direita: configuração do documento e dos associados. */}
          <div className="space-y-4">
          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <p className="section-label">Documento: {documentLabel}</p>
              <Mail className="w-4 h-4 text-text-muted" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                className={cn("btn-secondary justify-center", documentConfig.documentoTipo === "newsletter_regulatoria" && "border-brand text-brand")}
                onClick={() => updateDocumentConfig("documentoTipo", "newsletter_regulatoria")}
              >
                Newsletter
              </button>
              <button
                className={cn("btn-secondary justify-center", documentConfig.documentoTipo === "minuto_regulacao" && "border-brand text-brand")}
                onClick={() => updateDocumentConfig("documentoTipo", "minuto_regulacao")}
              >
                Minuto da Regulação
              </button>
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] text-text-muted">
                Modelo de design — mesma logo, nome e contatos; muda só o layout.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={cn("btn-secondary justify-center text-xs", documentConfig.templateVariant === "v1" && "border-brand text-brand")}
                  onClick={() => updateDocumentConfig("templateVariant", "v1")}
                >
                  {documentConfig.documentoTipo === "minuto_regulacao" ? "Minuto 1 (escuro)" : "Newsletter 1 (escuro)"}
                </button>
                <button
                  className={cn("btn-secondary justify-center text-xs", documentConfig.templateVariant === "v2" && "border-brand text-brand")}
                  onClick={() => updateDocumentConfig("templateVariant", "v2")}
                >
                  {documentConfig.documentoTipo === "minuto_regulacao" ? "Minuto 2 (claro)" : "Newsletter 2 (claro)"}
                </button>
              </div>
            </div>
            {documentConfig.documentoTipo === "minuto_regulacao" ? (
              <div className="space-y-2">
                <div className="rounded-card border border-border bg-surface-secondary p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-text-primary">Notícias do Minuto</p>
                      <p className="text-[11px] text-text-muted mt-0.5">Selecao independente da Newsletter.</p>
                    </div>
                    <span className="badge-gray text-xs">{minutoSelected.length} selecionadas</span>
                  </div>
                  <div className="max-h-56 overflow-auto space-y-1 pr-1">
                    {noticias.length ? noticias.map((item) => (
                      <label
                        key={`minuto-${item.id}`}
                        className={cn(
                          "flex items-start gap-2 rounded-md border px-2 py-2 cursor-pointer",
                          minutoSelectedIds.includes(item.id)
                            ? "border-brand/50 bg-brand/10"
                            : "border-border bg-surface hover:border-brand/40",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-brand"
                          checked={minutoSelectedIds.includes(item.id)}
                          onChange={() => {
                            setMinutoSelectedIds((prev) => toggleId(prev, item.id));
                            setSavedEditionId(null);
                          }}
                        />
                        <span className="min-w-0">
                          <span className="block text-[11px] font-semibold text-text-primary line-clamp-2">{item.titulo}</span>
                          <span className="block text-[10px] text-text-muted mt-0.5">
                            {item.agencia_sigla ?? item.fonte} · {formatDateLong(item.publicado_em ?? item.first_seen_at)}
                          </span>
                        </span>
                      </label>
                    )) : (
                      <p className="text-xs text-text-muted">Nenhuma noticia carregada para selecionar.</p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className="btn-secondary justify-center text-xs"
                      onClick={() => {
                        setMinutoSelectedIds(newsletterSelectedIds);
                        setSavedEditionId(null);
                      }}
                      disabled={newsletterSelectedIds.length === 0}
                    >
                      Usar Newsletter
                    </button>
                    <button
                      className="btn-secondary justify-center text-xs"
                      onClick={() => {
                        setMinutoSelectedIds([]);
                        setMinutoTextos("");
                        setSavedEditionId(null);
                      }}
                      disabled={minutoSelectedIds.length === 0 && !minutoTextos.trim()}
                    >
                      Limpar Minuto
                    </button>
                  </div>
                </div>
                <p className="text-xs text-text-muted">
                  Roteiro de teleprompter para video curto. Edite livremente antes de gravar.
                </p>
                <textarea
                  className="input min-h-56"
                  value={minutoTextos}
                  onChange={(event) => {
                    setMinutoTextos(event.target.value);
                    setMinutoDraftStatus(null);
                    setSavedEditionId(null);
                  }}
                  placeholder="Edite aqui o roteiro falado. Separe noticias com --- quando quiser manter blocos independentes."
                />
                <button
                  className="btn-secondary w-full justify-center"
                  onClick={() => {
                    minutoDraftMutation.mutate();
                  }}
                  disabled={minutoSelected.length === 0 || minutoDraftMutation.isPending}
                >
                  {minutoDraftMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Gerar roteiro para video
                </button>
                {minutoDraftMutation.error ? (
                  <p className="text-xs text-error">
                    {minutoDraftMutation.error instanceof Error ? minutoDraftMutation.error.message : "Erro ao gerar rascunho"}
                  </p>
                ) : null}
                {minutoDraftStatus ? (
                  <p className="text-xs text-text-label">{minutoDraftStatus}</p>
                ) : null}
              </div>
            ) : null}
            {documentConfig.documentoTipo === "newsletter_regulatoria" ? (
              <div className="rounded-card border border-border bg-surface-secondary p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-text-primary">Textos da Newsletter</p>
                    <p className="text-[11px] text-text-muted mt-0.5">Limites calibrados para uma pagina sem corte visual.</p>
                  </div>
                  <span className="badge-gray text-xs">
                    {newsletterSelected.length} notícia{newsletterSelected.length === 1 ? "" : "s"} · {estimateNewsletterPageCount(newsletterSelected)} pág.
                  </span>
                </div>
                {newsletterSelected.length ? (
                  <div className="max-h-[520px] overflow-auto pr-1 space-y-3">
                    {newsletterSelected.map((item, index) => {
                      const slot = newsletterArticleSlotForIndex(index);
                      const limit = NEWSLETTER_ARTICLE_TEXT_LIMITS[slot];
                      const fallback = buildNewsletterArticleTextDraft(item, slot);
                      const value = newsletterArticleTexts[item.id] ?? fallback;
                      const remaining = limit - value.length;
                      return (
                        <div key={`newsletter-editor-${item.id}`} className="space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[11px] font-semibold text-text-primary">
                                {newsletterArticlePositionLabel(index)}
                              </p>
                              <p className="text-[10px] text-text-muted truncate">
                                {item.agencia_sigla ?? item.fonte} · {item.titulo}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="btn-secondary px-2 py-1 text-[10px]"
                              onClick={() => resetNewsletterArticleText(item.id)}
                            >
                              Restaurar
                            </button>
                          </div>
                          <textarea
                            className="input min-h-28 text-xs leading-relaxed"
                            value={value}
                            maxLength={limit}
                            onChange={(event) => updateNewsletterArticleText(item.id, event.target.value, limit)}
                          />
                          <div className="flex items-center justify-between text-[10px] text-text-muted">
                            <span>Limite da pagina: {limit} caracteres</span>
                            <span className={cn(remaining < 80 && "text-warning")}>{remaining} restantes</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-text-muted">Selecione noticias para editar os textos de cada pagina.</p>
                )}
              </div>
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
                <p>{schedule.recipient_count ?? schedule.destinatarios.length} destinatários cadastrados</p>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <select
                className="select"
                value={documentConfig.diaSemana}
                onChange={(e) => updateDocumentConfig("diaSemana", e.target.value)}
              >
                <option value="1">Segunda</option>
                <option value="2">Terca</option>
                <option value="3">Quarta</option>
                <option value="4">Quinta</option>
                <option value="5">Sexta</option>
                <option value="6">Sabado</option>
                <option value="0">Domingo</option>
              </select>
              <input
                className="input"
                type="time"
                value={documentConfig.horaEnvio}
                onChange={(e) => updateDocumentConfig("horaEnvio", e.target.value)}
              />
            </div>
            <button
              className="btn-secondary w-full justify-center"
              onClick={() => scheduleMutation.mutate()}
              disabled={scheduleMutation.isPending || !documentConfig.destinatarios.trim() || demoEnabled}
            >
              {scheduleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />}
              Salvar aviso semanal
            </button>
          </section>
          </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function NewsImagePlaceholder({ item }: { item: RegulatoryNews }) {
  const label = (item.agencia_sigla ?? item.fonte ?? "IRIS").slice(0, 6);
  return (
    <div className="news-figure flex items-center justify-center bg-gradient-to-br from-brand/15 to-bg-hover">
      <span className="font-mono text-xs uppercase tracking-[0.18em] text-text-muted">{label}</span>
    </div>
  );
}

function NewsImage({ item, cover = false }: { item: RegulatoryNews; cover?: boolean }) {
  const original = item.imagem_url;
  const [src, setSrc] = useState(original);

  useEffect(() => {
    setSrc(original);
  }, [original]);

  if (!src) {
    // Nunca deixar a notícia sem imagem: usa um placeholder com a sigla da agência.
    return <NewsImagePlaceholder item={item} />;
  }

  if (cover) {
    return (
      <div className="news-figure">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          onError={() => setSrc(src === original ? proxiedImageUrl(original) : null)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-28 flex items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="w-full h-auto max-h-40 object-contain"
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
    ${heroImage ? `<img src="${escapeHtml(heroImage)}" alt="" style="display:block;width:100%;height:190px;object-fit:contain;object-position:center;background:#18181b">` : ""}
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
    .news-img { width: 100%; max-height: 260px; object-fit: contain; object-position: center; border-radius: 8px; margin: 14px 0; border: 1px solid #e4e4e7; background: #f4f4f5; }
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

function templateVersionFor(tipo: NewsletterDocumentType, variant: "v1" | "v2") {
  if (tipo === "minuto_regulacao") {
    return variant === "v2" ? "iris_minuto_retrospectiva_v2" : "iris_minuto_retrospectiva_v1";
  }
  return variant === "v2" ? "iris_newsletter_layout_v2" : "iris_newsletter_layout_v1";
}

function splitList(value: string) {
  return value
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatMinutoDraftForTeleprompter(items: Array<Record<string, unknown>>) {
  return items
    .map((item) => {
      const script = stringifyOptional(item.texto_minuto) ?? stringifyOptional(item.roteiro) ?? stringifyOptional(item.texto);
      if (script) return script;
      const agency = stringifyOptional(item.agencia);
      const title = stringifyOptional(item.titulo_minuto) ?? stringifyOptional(item.titulo);
      const subtitle = stringifyOptional(item.subtitulo_minuto) ?? stringifyOptional(item.subtitulo);
      return [agency, title, subtitle].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function splitMinutoTextos(value: string) {
  return value
    .split(/\n-{3,}\n|---/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function newsletterArticleSlotForIndex(index: number): NewsletterArticleSlot {
  const position = index % 3;
  if (position === 0) return "main";
  if (position === 1) return "side_1";
  return "side_2";
}

function newsletterTextLimitForIndex(index: number) {
  return NEWSLETTER_ARTICLE_TEXT_LIMITS[newsletterArticleSlotForIndex(index)];
}

function newsletterArticlePositionLabel(index: number) {
  const page = Math.floor(index / 3) + 1;
  const position = index % 3;
  const label = position === 0 ? "Principal esquerda" : position === 1 ? "Lateral 1" : "Lateral 2";
  return `Pagina ${page} · ${label}`;
}

function parseMinutoItemsForSelection(value: string, selected: RegulatoryNews[]) {
  const allowedIds = new Set(selected.map((item) => item.id));
  const allowedUrls = new Set(selected.map((item) => item.url));
  const selectedByUrl = new Map(selected.map((item) => [item.url, item]));
  const raw = value.trim();
  if (!raw || selected.length === 0) return [];

  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : parsed.itens;
      if (Array.isArray(items)) {
        return items
          .map((item) => normalizeMinutoItemForSelection(item, selectedByUrl))
          .filter((item) => {
            if (!item) return false;
            if (item.noticia_id && allowedIds.has(item.noticia_id)) return true;
            if (item.fonte_url && allowedUrls.has(item.fonte_url)) return true;
            return false;
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item));
      }
    } catch {
      // Abaixo tratamos texto livre/separado por blocos.
    }
  }

  return splitMinutoTextos(value)
    .slice(0, selected.length)
    .map((text, index) => ({
      noticia_id: selected[index]?.id ?? null,
      data: selected[index]?.publicado_em ?? selected[index]?.first_seen_at ?? null,
      agencia: selected[index]?.agencia?.nome || selected[index]?.agencia_sigla || selected[index]?.fonte || null,
      titulo_minuto: selected[index]?.titulo ?? null,
      subtitulo_minuto: null,
      ato: selected[index]?.titulo ?? null,
      ato_titulo: selected[index]?.titulo ?? null,
      texto_minuto: text,
      texto_institucional: text,
      editorial_model: null,
      review_status: "revisado" as const,
      fonte_url: selected[index]?.url ?? null,
    }))
    .filter((item) => Boolean(item.noticia_id));
}

function normalizeMinutoItemForSelection(value: unknown, selectedByUrl: Map<string, RegulatoryNews>) {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const fonteUrl = typeof row.fonte_url === "string" ? row.fonte_url : typeof row.url === "string" ? row.url : null;
  const selected = fonteUrl ? selectedByUrl.get(fonteUrl) : null;
  const noticiaId = typeof row.noticia_id === "string"
    ? row.noticia_id
    : typeof row.id === "string"
      ? row.id
      : selected?.id ?? null;
  return {
    noticia_id: noticiaId,
    data: stringifyOptional(row.data) ?? selected?.publicado_em ?? selected?.first_seen_at ?? null,
    agencia: stringifyOptional(row.agencia) ?? selected?.agencia?.nome ?? selected?.agencia_sigla ?? selected?.fonte ?? null,
    titulo_minuto: stringifyOptional(row.titulo_minuto) ?? stringifyOptional(row.titulo),
    subtitulo_minuto: stringifyOptional(row.subtitulo_minuto) ?? stringifyOptional(row.subtitulo),
    ato: stringifyOptional(row.ato) ?? stringifyOptional(row.titulo),
    ato_titulo: stringifyOptional(row.ato_titulo) ?? stringifyOptional(row.ato) ?? stringifyOptional(row.titulo),
    texto_minuto: stringifyOptional(row.texto_minuto) ?? stringifyOptional(row.texto),
    texto_institucional: stringifyOptional(row.texto_institucional) ?? stringifyOptional(row.texto_minuto) ?? stringifyOptional(row.texto),
    editorial_model: stringifyOptional(row.editorial_model),
    review_status: (row.review_status === "aprovado" || row.review_status === "revisado" ? row.review_status : "pendente") as "pendente" | "revisado" | "aprovado",
    fonte_url: fonteUrl ?? selected?.url ?? null,
  };
}

function stringifyOptional(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toggleId(items: string[], id: string) {
  return items.includes(id) ? items.filter((item) => item !== id) : [...items, id];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
