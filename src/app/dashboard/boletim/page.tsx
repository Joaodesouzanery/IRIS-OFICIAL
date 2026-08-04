"use client";

import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  DashboardOverview, MicrotemaStats, DiretorOverviewItem,
  Deliberacao, DeliberacaoPaginada, Agencia, BoletimSchedule, MandatosAnalytics,
} from "@/types";
import { getMicrotemaLabel, getAreaRegulatoriaLabel, formatNumber, formatDate, escapeHtml, cn } from "@/lib/utils";
import {
  Mail, Copy, Printer, Plus, Trash2, CheckCircle,
  Calendar, Bell, FileText, Users, Tag, Building2, ShieldCheck,
  AlignLeft, Loader2, X, Scale, BookOpen, Layers,
} from "lucide-react";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { DELIBERACOES_TABS } from "@/lib/module-tabs";
import { useDataSyncContext } from "@/components/DataSyncProvider";

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

const PERIODOS = [
  { label: "Última semana",    value: "7d" },
  { label: "Último mês",      value: "30d" },
  { label: "Último trimestre",value: "90d" },
];

interface Section {
  id: string;
  label: string;
  icon: React.ElementType;
}

const SECTIONS: Section[] = [
  { id: "kpis",         label: "KPIs Principais",           icon: ShieldCheck },
  { id: "recentes",     label: "Deliberações Recentes",      icon: FileText },
  { id: "divergentes",  label: "Decisões Divergentes",       icon: Scale },
  { id: "publicacao",   label: "Publicadas no DOU/DOE",      icon: BookOpen },
  { id: "areas",        label: "Por Área Regulatória",       icon: Layers },
  { id: "setores",      label: "Setores Mais Afetados",      icon: Tag },
  { id: "diretores",    label: "Diretores em Destaque",      icon: Users },
  { id: "empresas",     label: "Empresas Reguladas (Top 5)", icon: Building2 },
  { id: "consenso",     label: "Análise de Consenso",        icon: AlignLeft },
  { id: "governanca",   label: "Taxa de Governança",         icon: ShieldCheck },
];

// ── Newsletter HTML builder ────────────────────────────────────────────────

// Mesma fórmula composta da Governança/Analytics Institucional (não deixar divergir).
function calcScore(consenso: number, deferimento: number, qualidade: number, sancao: number) {
  return Math.round(consenso * 0.3 + deferimento * 0.25 + qualidade * 0.25 + (100 - sancao) * 0.2);
}

function buildHtml(opts: {
  selectedSections: string[];
  periodo: string;
  overview: DashboardOverview | undefined;
  microtemas: MicrotemaStats[] | undefined;
  diretores: DiretorOverviewItem[] | undefined;
  deliberacoes: Deliberacao[];
  mandatos: MandatosAnalytics | undefined;
  agencia: string;
}) {
  const { selectedSections: sel, periodo, overview, microtemas, diretores, deliberacoes, mandatos, agencia } = opts;
  const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  const ag = agencia || "Todas as Agências";

  const sec = (id: string) => sel.includes(id);

  const kpisHtml = sec("kpis") && overview ? `
    <tr><td style="padding:16px 0">
      <h2 style="margin:0 0 12px;font-size:14px;color:#c2a24a;font-family:monospace;text-transform:uppercase;letter-spacing:1px">KPIs Principais</h2>
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="background:#121734;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:12px;text-align:center;width:25%">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.62);font-family:monospace;text-transform:uppercase">Total</p>
          <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#f4f4f5;font-family:monospace">${formatNumber(overview.total_deliberacoes)}</p>
        </td>
        <td width="8"></td>
        <td style="background:#121734;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:12px;text-align:center;width:25%">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.62);font-family:monospace;text-transform:uppercase">Favoráveis</p>
          <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#22c55e;font-family:monospace">${formatNumber(overview.deferidos)}</p>
        </td>
        <td width="8"></td>
        <td style="background:#121734;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:12px;text-align:center;width:25%">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.62);font-family:monospace;text-transform:uppercase">Taxa Def.</p>
          <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#c2a24a;font-family:monospace">${overview.taxa_deferimento}%</p>
        </td>
        <td width="8"></td>
        <td style="background:#121734;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:12px;text-align:center;width:25%">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.62);font-family:monospace;text-transform:uppercase">Reuniões</p>
          <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#f4f4f5;font-family:monospace">${formatNumber(overview.reunioes_unicas)}</p>
        </td>
      </tr></table>
    </td></tr>` : "";

  const recentesHtml = sec("recentes") && deliberacoes.length ? `
    <tr><td style="padding:16px 0;border-top:1px solid rgba(255,255,255,0.12)">
      <h2 style="margin:0 0 12px;font-size:14px;color:#c2a24a;font-family:monospace;text-transform:uppercase;letter-spacing:1px">Deliberações Recentes</h2>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${deliberacoes.slice(0, 5).map((d) => `
        <tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.12)">
          <p style="margin:0;font-size:13px;color:#f4f4f5;font-weight:600">${escapeHtml(d.numero_deliberacao ?? "—")} — ${escapeHtml(d.interessado ?? "Sem interessado")}</p>
          <p style="margin:2px 0 0;font-size:12px;color:rgba(255,255,255,0.62)">${escapeHtml(d.assunto ?? d.microtema ?? "")} · ${escapeHtml(d.resultado ?? "Sem resultado")}</p>
        </td></tr>`).join("")}
      </table>
    </td></tr>` : "";

  // Decisões com voto divergente registrado (transparência de dissenso).
  const divergentes = deliberacoes.filter((d) => Array.isArray(d.votos) && d.votos.some((v) => v.is_divergente));
  const divergentesHtml = sec("divergentes") && divergentes.length ? `
    <tr><td style="padding:16px 0;border-top:1px solid rgba(255,255,255,0.12)">
      <h2 style="margin:0 0 12px;font-size:14px;color:#c2a24a;font-family:monospace;text-transform:uppercase;letter-spacing:1px">Decisões Divergentes</h2>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${divergentes.slice(0, 5).map((d) => {
          const nomes = (d.votos ?? []).filter((v) => v.is_divergente).map((v) => v.diretor_nome).filter(Boolean).map((n) => escapeHtml(n)).join(", ");
          return `
        <tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.12)">
          <p style="margin:0;font-size:13px;color:#f4f4f5;font-weight:600">${escapeHtml(d.numero_deliberacao ?? "—")} — ${escapeHtml(d.interessado ?? "Sem interessado")}</p>
          <p style="margin:2px 0 0;font-size:12px;color:rgba(255,255,255,0.72)">${escapeHtml(d.resultado ?? "Sem resultado")}${nomes ? ` · <span style="color:#f59e0b">Voto divergente: ${nomes}</span>` : ""}</p>
        </td></tr>`;
        }).join("")}
      </table>
    </td></tr>` : "";

  // Deliberações publicadas no Diário Oficial (data_publicacao distinta da reunião).
  const publicadas = deliberacoes.filter((d) => d.data_publicacao).sort((a, b) => (b.data_publicacao ?? "").localeCompare(a.data_publicacao ?? ""));
  const publicacaoHtml = sec("publicacao") && publicadas.length ? `
    <tr><td style="padding:16px 0;border-top:1px solid rgba(255,255,255,0.12)">
      <h2 style="margin:0 0 12px;font-size:14px;color:#c2a24a;font-family:monospace;text-transform:uppercase;letter-spacing:1px">Publicadas no DOU/DOE</h2>
      <table width="100%" cellpadding="0" cellspacing="0">
        ${publicadas.slice(0, 5).map((d) => `
        <tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.12)">
          <p style="margin:0;font-size:13px;color:#f4f4f5;font-weight:600">${escapeHtml(d.numero_deliberacao ?? "—")} — ${escapeHtml(d.interessado ?? "Sem interessado")}</p>
          <p style="margin:2px 0 0;font-size:12px;color:rgba(255,255,255,0.62)">Publicado em ${formatDate(d.data_publicacao)} · Reunião ${formatDate(d.data_reuniao)}</p>
        </td></tr>`).join("")}
      </table>
    </td></tr>` : "";

  // Distribuição por área regulatória.
  const areaCounts = new Map<string, number>();
  for (const d of deliberacoes) {
    const label = getAreaRegulatoriaLabel(d.area_regulatoria);
    areaCounts.set(label, (areaCounts.get(label) ?? 0) + 1);
  }
  const areasOrdenadas = [...areaCounts.entries()].sort((a, b) => b[1] - a[1]);
  const areasHtml = sec("areas") && areasOrdenadas.length ? `
    <tr><td style="padding:16px 0;border-top:1px solid rgba(255,255,255,0.12)">
      <h2 style="margin:0 0 12px;font-size:14px;color:#c2a24a;font-family:monospace;text-transform:uppercase;letter-spacing:1px">Por Área Regulatória</h2>
      ${areasOrdenadas.slice(0, 6).map(([label, total], i) => `
      <div style="margin-bottom:8px">
        <p style="margin:0 0 3px;font-size:12px;color:rgba(255,255,255,0.72)">${i + 1}. ${label} — <span style="color:#f4f4f5">${formatNumber(total)}</span></p>
      </div>`).join("")}
    </td></tr>` : "";

  const setoresHtml = sec("setores") && microtemas?.length ? `
    <tr><td style="padding:16px 0;border-top:1px solid rgba(255,255,255,0.12)">
      <h2 style="margin:0 0 12px;font-size:14px;color:#c2a24a;font-family:monospace;text-transform:uppercase;letter-spacing:1px">Setores Mais Afetados</h2>
      ${[...(microtemas ?? [])].sort((a,b) => b.total - a.total).slice(0,5).map((m, i) => `
      <div style="margin-bottom:8px">
        <p style="margin:0 0 3px;font-size:12px;color:rgba(255,255,255,0.72)">${i+1}. ${getMicrotemaLabel(m.microtema)} — <span style="color:#f4f4f5">${formatNumber(m.total)}</span></p>
      </div>`).join("")}
    </td></tr>` : "";

  const diretoresHtml = sec("diretores") && diretores?.length ? `
    <tr><td style="padding:16px 0;border-top:1px solid rgba(255,255,255,0.12)">
      <h2 style="margin:0 0 12px;font-size:14px;color:#c2a24a;font-family:monospace;text-transform:uppercase;letter-spacing:1px">Diretores em Destaque</h2>
      ${diretores.slice(0,5).map((d) => `
      <div style="margin-bottom:6px">
        <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.72)">${escapeHtml(d.diretor_nome)} — <span style="color:#f4f4f5">${formatNumber(d.total)}</span> votos · <span style="color:#22c55e">${d.pct_favor.toFixed(0)}%</span> favoráveis</p>
      </div>`).join("")}
    </td></tr>` : "";

  // Empresas reguladas (Top 5) — derivadas do `interessado` das deliberações do período.
  const empresaCounts = new Map<string, number>();
  for (const d of deliberacoes) {
    const nome = (d.interessado ?? "").trim();
    if (nome) empresaCounts.set(nome, (empresaCounts.get(nome) ?? 0) + 1);
  }
  const empresasOrdenadas = [...empresaCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const empresasHtml = sec("empresas") && empresasOrdenadas.length ? `
    <tr><td style="padding:16px 0;border-top:1px solid rgba(255,255,255,0.12)">
      <h2 style="margin:0 0 12px;font-size:14px;color:#c2a24a;font-family:monospace;text-transform:uppercase;letter-spacing:1px">Empresas Reguladas (Top 5)</h2>
      ${empresasOrdenadas.map(([nome, total], i) => `
      <div style="margin-bottom:8px">
        <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.72)">${i + 1}. ${escapeHtml(nome)} — <span style="color:#f4f4f5">${formatNumber(total)}</span> deliberação(ões)</p>
      </div>`).join("")}
    </td></tr>` : "";

  // Análise de consenso — taxa de consenso vs litígio (mandatos/analytics).
  const consensoHtml = sec("consenso") && mandatos ? `
    <tr><td style="padding:16px 0;border-top:1px solid rgba(255,255,255,0.12)">
      <h2 style="margin:0 0 12px;font-size:14px;color:#c2a24a;font-family:monospace;text-transform:uppercase;letter-spacing:1px">Análise de Consenso</h2>
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="background:#121734;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:12px;text-align:center;width:50%">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.62);font-family:monospace;text-transform:uppercase">Consenso</p>
          <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#22c55e;font-family:monospace">${mandatos.taxa_consenso}</p>
        </td>
        <td width="8"></td>
        <td style="background:#121734;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:12px;text-align:center;width:50%">
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.62);font-family:monospace;text-transform:uppercase">Litígio</p>
          <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#c2a24a;font-family:monospace">${mandatos.taxa_litigio}</p>
        </td>
      </tr></table>
    </td></tr>` : "";

  // Taxa de governança — score composto (mesma fórmula da tela de Governança).
  const govScore = overview && mandatos
    ? calcScore(parseFloat(mandatos.taxa_consenso), parseFloat(overview.taxa_deferimento), (overview.avg_confidence ?? 0) * 100, parseFloat(mandatos.taxa_sancao))
    : null;
  const governancaHtml = sec("governanca") && govScore != null ? `
    <tr><td style="padding:16px 0;border-top:1px solid rgba(255,255,255,0.12)">
      <h2 style="margin:0 0 12px;font-size:14px;color:#c2a24a;font-family:monospace;text-transform:uppercase;letter-spacing:1px">Taxa de Governança</h2>
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.72)">Score institucional agregado: <span style="color:#22c55e;font-size:22px;font-weight:700;font-family:monospace">${govScore}</span><span style="color:rgba(255,255,255,0.62)">/100</span></p>
    </td></tr>` : "";

  // Logo absoluto (o HTML é copiado p/ e-mail — precisa resolver fora do app).
  const logoUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/brand/newsletter-logo-wide.png`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800;900&display=swap" rel="stylesheet">
<title>Boletim IRIS Regulação</title></head>
<body style="margin:0;padding:0;background:#eceae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eceae4;padding:24px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#0a0e2a;border:1px solid rgba(255,255,255,0.12);border-radius:12px;overflow:hidden">

  <!-- Header — identidade IRIS (navy + dourado + logo, como a newsletter) -->
  <tr><td style="background:#0a0e2a;border-bottom:2px solid #c2a24a;padding:22px 28px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle"><img src="${logoUrl}" alt="IRIS" width="140" style="display:block;width:140px;max-width:140px;height:auto"/></td>
      <td align="right" style="vertical-align:middle">
        <p style="margin:0;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#c2a24a;font-weight:700">Boletim Regulat&oacute;rio</p>
        <p style="margin:3px 0 0;font-size:11px;color:rgba(255,255,255,0.66)">${escapeHtml(ag)} · ${today}</p>
        <p style="margin:2px 0 0;font-size:11px;color:rgba(255,255,255,0.66)">${PERIODOS.find(p => p.value === periodo)?.label ?? periodo}</p>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:24px 28px 4px">
    <h1 style="margin:0;font-family:'Playfair Display',Georgia,serif;font-size:26px;font-weight:800;line-height:1.1;color:#ffffff">Boletim Regulat&oacute;rio</h1>
  </td></tr>

  <!-- Content -->
  <tr><td style="padding:0 28px">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${kpisHtml}
      ${recentesHtml}
      ${divergentesHtml}
      ${publicacaoHtml}
      ${areasHtml}
      ${setoresHtml}
      ${diretoresHtml}
      ${empresasHtml}
      ${consensoHtml}
      ${governancaHtml}
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.12);background:#07091d">
    <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:1px;color:#ffffff;text-align:center">IRIS Regula&ccedil;&atilde;o</p>
    <p style="margin:0;font-size:10px;color:rgba(255,255,255,0.55);text-align:center">
      Instituto de Regula&ccedil;&atilde;o, Inova&ccedil;&atilde;o e Sustentabilidade · Gerado automaticamente · ${today}
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

// ── Component ─────────────────────────────────────────────────────────────

export default function BoletimPage() {
  const queryClient = useQueryClient();
  const { demoEnabled } = useDataSyncContext();

  // Builder state
  const [selectedSections, setSelectedSections] = useState<string[]>(["kpis", "recentes", "setores"]);
  const [periodo, setPeriodo]                   = useState("30d");
  const [agenciaId, setAgenciaId]               = useState("");
  const [copied, setCopied]                     = useState(false);

  // Schedule form state
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [schedFreq, setSchedFreq]               = useState<BoletimSchedule["frequencia"]>("semanal");
  const [schedDiaSemana, setSchedDiaSemana]     = useState<number>(1);
  const [schedDiaMes, setSchedDiaMes]           = useState<number>(1);
  const [schedEmailInput, setSchedEmailInput]   = useState("");
  const [schedEmails, setSchedEmails]           = useState<string[]>([]);
  const [schedEmailError, setSchedEmailError]   = useState("");

  const previewRef = useRef<HTMLDivElement>(null);

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });
  const { data: overview } = useQuery({
    queryKey: ["dashboard", "overview", agenciaId],
    queryFn: () => api.get<DashboardOverview>(`/dashboard/overview${agenciaId ? `?agencia_id=${agenciaId}` : ""}`),
  });
  const { data: microtemas } = useQuery({
    queryKey: ["dashboard", "microtemas", agenciaId],
    queryFn: () => api.get<MicrotemaStats[]>(`/dashboard/microtemas${agenciaId ? `?agencia_id=${agenciaId}` : ""}`),
  });
  const { data: diretores } = useQuery({
    queryKey: ["dashboard", "diretores-overview", agenciaId],
    queryFn: () => api.get<DiretorOverviewItem[]>(`/dashboard/diretores/overview${agenciaId ? `?agencia_id=${agenciaId}` : ""}`),
  });
  const { data: deliberacoesPag } = useQuery({
    queryKey: ["deliberacoes-boletim", agenciaId],
    queryFn: () => api.get<DeliberacaoPaginada>(`/deliberacoes?limit=30${agenciaId ? `&agencia_id=${agenciaId}` : ""}`),
  });
  const deliberacoes: Deliberacao[] = deliberacoesPag?.data ?? [];
  const { data: mandatos } = useQuery({
    queryKey: ["mandatos-analytics", agenciaId],
    queryFn: () => api.get<MandatosAnalytics>(`/mandatos/analytics${agenciaId ? `?agencia_id=${agenciaId}` : ""}`),
  });

  const { data: schedulesData, isLoading: loadSchedules } = useQuery({
    queryKey: ["boletim", "schedules"],
    queryFn: () => api.get<{ schedules: BoletimSchedule[] }>("/boletim/schedule"),
  });
  const schedules = schedulesData?.schedules ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/boletim/schedule?id=${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["boletim", "schedules"] }),
  });

  const createMutation = useMutation({
    mutationFn: (body: Partial<BoletimSchedule>) =>
      api.post<{ schedule: BoletimSchedule }>("/boletim/schedule", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["boletim", "schedules"] });
      setShowScheduleForm(false);
      setSchedEmails([]);
      setSchedEmailInput("");
    },
  });

  // ── Derived HTML ──────────────────────────────────────────────────────────

  const html = buildHtml({
    selectedSections, periodo, overview, microtemas, diretores, deliberacoes, mandatos,
    agencia: (agencias ?? []).find((a) => a.id === agenciaId)?.sigla ?? "",
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  function toggleSection(id: string) {
    setSelectedSections((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function copyHtml() {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { /* clipboard blocked */ }
  }

  function openEmail() {
    const plain = [
      "Boletim IRIS Regulação",
      "=".repeat(40),
      overview ? `Total: ${overview.total_deliberacoes} deliberações | Taxa deferimento: ${overview.taxa_deferimento}%` : "",
      "",
      deliberacoes.slice(0, 5).map((d) => `• ${d.numero_deliberacao ?? "?"} — ${d.interessado ?? "—"}`).join("\n"),
    ].join("\n");
    window.location.href = `mailto:?subject=Boletim%20IRIS%20Regulação&body=${encodeURIComponent(plain)}`;
  }

  function printPreview() {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 500);
  }

  // ── Schedule form ─────────────────────────────────────────────────────────

  function addEmail() {
    const e = schedEmailInput.trim();
    if (!EMAIL_RE.test(e)) { setSchedEmailError("E-mail inválido"); return; }
    if (schedEmails.includes(e)) { setSchedEmailError("E-mail já adicionado"); return; }
    setSchedEmails((prev) => [...prev, e]);
    setSchedEmailInput("");
    setSchedEmailError("");
  }

  function nextSendDate(freq: BoletimSchedule["frequencia"], diaSemana: number, diaMes: number) {
    const d = new Date();
    if (freq === "semanal") {
      const diff = (diaSemana - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
    } else if (freq === "quinzenal") {
      d.setDate(d.getDate() + 14);
    } else if (freq === "mensal") {
      d.setMonth(d.getMonth() + 1, diaMes);
    } else {
      d.setDate(d.getDate() + 7);
    }
    return d.toISOString();
  }

  function submitSchedule() {
    if (!schedEmails.length) { setSchedEmailError("Adicione ao menos um destinatário"); return; }
    createMutation.mutate({
      frequencia:    schedFreq,
      dia_semana:    schedFreq === "semanal" ? (schedDiaSemana as 0|1|2|3|4|5|6) : undefined,
      dia_mes:       schedFreq === "mensal"  ? schedDiaMes    : undefined,
      proximo_envio: nextSendDate(schedFreq, schedDiaSemana, schedDiaMes),
      destinatarios: schedEmails,
      secoes:        selectedSections,
      agencia_id:    agenciaId || null,
      ativo:         true,
    });
  }

  const FREQ_LABELS: Record<BoletimSchedule["frequencia"], string> = {
    semanal: "Semanal", quinzenal: "Quinzenal", mensal: "Mensal", personalizado: "Personalizado",
  };
  const DIAS_SEMANA = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

  return (
    <div className="space-y-6 animate-fade-in">
      <ModuleTabs tabs={DELIBERACOES_TABS} />
      {demoEnabled && (
        <div className="card border-warning/30 bg-warning/10 py-2 px-3 text-sm text-warning">
          Modo DEMO ativo: agendamentos de boletim ficam bloqueados em somente leitura.
        </div>
      )}
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Boletim Regulatório</h1>
          <p className="text-sm text-text-muted mt-1">Crie e agende boletins com os dados que desejar</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="input text-sm h-9 py-0" value={agenciaId} onChange={(e) => setAgenciaId(e.target.value)}>
            <option value="">Todas as agências</option>
            {(agencias ?? []).map((a) => <option key={a.id} value={a.id}>{a.sigla}</option>)}
          </select>
          <select className="input text-sm h-9 py-0" value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {PERIODOS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* ── Builder Panel ──────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="card">
            <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-3">
              Seções do Boletim
            </p>
            <div className="space-y-2">
              {SECTIONS.map((s) => {
                const Icon = s.icon;
                const active = selectedSections.includes(s.id);
                return (
                  <label
                    key={s.id}
                    className={cn(
                      "flex items-center gap-3 p-2.5 rounded-md cursor-pointer transition-colors border",
                      active ? "bg-brand/10 border-brand/30" : "border-transparent hover:bg-bg-hover"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggleSection(s.id)}
                      className="w-4 h-4 accent-brand"
                    />
                    <Icon className={cn("w-4 h-4 shrink-0", active ? "text-brand" : "text-text-muted")} />
                    <span className={cn("text-sm", active ? "text-text-primary" : "text-text-secondary")}>
                      {s.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="card space-y-2">
            <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-2">Exportar</p>
            <button onClick={copyHtml} className={cn("btn-secondary w-full flex items-center justify-center gap-2", copied && "text-success")}>
              {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? "HTML copiado!" : "Copiar HTML"}
            </button>
            <button onClick={openEmail} className="btn-secondary w-full flex items-center justify-center gap-2">
              <Mail className="w-4 h-4" /> Abrir no Email
            </button>
            <button onClick={printPreview} className="btn-secondary w-full flex items-center justify-center gap-2">
              <Printer className="w-4 h-4" /> Baixar / Imprimir
            </button>
          </div>
        </div>

        {/* ── Preview Panel ──────────────────────────────────────────────── */}
        <div className="card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-hover">
            <p className="text-xs text-text-muted font-mono uppercase tracking-wider">Preview do Boletim</p>
            <span className="text-xs text-text-label font-mono">{selectedSections.length} seção(ões) selecionada(s)</span>
          </div>
          <div className="overflow-auto" style={{ maxHeight: "70vh" }}>
            <iframe
              srcDoc={html}
              className="w-full border-0"
              style={{ height: "65vh", minHeight: 400 }}
              title="preview"
              sandbox="allow-same-origin"
            />
          </div>
        </div>
      </div>

      {/* ── Schedule Section ───────────────────────────────────────────────── */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-brand" />
            <p className="text-sm font-medium text-text-secondary">Agendamentos</p>
          </div>
          <button
            onClick={() => setShowScheduleForm((v) => !v)}
            disabled={demoEnabled}
            className="btn-primary flex items-center gap-1.5 text-xs px-3 py-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo agendamento
          </button>
        </div>

        {/* Schedule Form */}
        {showScheduleForm && (
          <div className="border border-border/60 rounded-lg p-4 space-y-4 bg-bg-hover">
            <p className="text-xs text-text-muted font-mono uppercase tracking-wider">Novo Agendamento</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-text-label font-mono uppercase tracking-wider">Frequência</label>
                <select className="input" value={schedFreq} onChange={(e) => setSchedFreq(e.target.value as BoletimSchedule["frequencia"])}>
                  <option value="semanal">Semanal</option>
                  <option value="quinzenal">Quinzenal</option>
                  <option value="mensal">Mensal</option>
                </select>
              </div>
              {schedFreq === "semanal" && (
                <div className="space-y-1">
                  <label className="text-xs text-text-label font-mono uppercase tracking-wider">Dia da Semana</label>
                  <select className="input" value={schedDiaSemana} onChange={(e) => setSchedDiaSemana(+e.target.value)}>
                    {DIAS_SEMANA.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
              )}
              {schedFreq === "mensal" && (
                <div className="space-y-1">
                  <label className="text-xs text-text-label font-mono uppercase tracking-wider">Dia do Mês</label>
                  <select className="input" value={schedDiaMes} onChange={(e) => setSchedDiaMes(+e.target.value)}>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs text-text-label font-mono uppercase tracking-wider">Destinatários</label>
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  type="email"
                  placeholder="email@exemplo.com"
                  value={schedEmailInput}
                  onChange={(e) => { setSchedEmailInput(e.target.value); setSchedEmailError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && addEmail()}
                />
                <button onClick={addEmail} className="btn-secondary px-3">Adicionar</button>
              </div>
              {schedEmailError && <p className="text-xs text-error">{schedEmailError}</p>}
              <div className="flex flex-wrap gap-1.5">
                {schedEmails.map((e) => (
                  <span key={e} className="badge badge-gray flex items-center gap-1 text-xs">
                    {e}
                    <button onClick={() => setSchedEmails((prev) => prev.filter((x) => x !== e))}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowScheduleForm(false)} className="btn-secondary text-sm">Cancelar</button>
              <button
                onClick={submitSchedule}
                disabled={demoEnabled || createMutation.isPending}
                className="btn-primary text-sm flex items-center gap-1.5"
              >
                {createMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Salvar agendamento
              </button>
            </div>
          </div>
        )}

        {/* Schedules list */}
        {loadSchedules ? (
          <p className="text-sm text-text-muted">Carregando agendamentos...</p>
        ) : schedules.length === 0 ? (
          <div className="text-center py-8 text-text-muted">
            <Bell className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhum agendamento criado</p>
          </div>
        ) : (
          <div className="space-y-2">
            {schedules.map((s) => (
              <div key={s.id} className="flex items-center gap-3 p-3 border border-border rounded-md hover:bg-bg-hover transition-colors">
                <Calendar className="w-4 h-4 text-text-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary font-medium">{FREQ_LABELS[s.frequencia]}</p>
                  <p className="text-xs text-text-muted truncate">
                    Próximo: {new Date(s.proximo_envio).toLocaleDateString("pt-BR")} · {s.destinatarios.join(", ")} · {s.secoes.length} seção(ões)
                  </p>
                </div>
                <span className={cn("badge text-xs", s.ativo ? "badge-green" : "badge-gray")}>
                  {s.ativo ? "Ativo" : "Inativo"}
                </span>
                <button
                  onClick={() => deleteMutation.mutate(s.id)}
                  disabled={demoEnabled || deleteMutation.isPending}
                  className="w-7 h-7 flex items-center justify-center rounded text-text-label hover:text-error hover:bg-error/10 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
