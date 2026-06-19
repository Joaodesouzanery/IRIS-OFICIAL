import type { ModuleTab } from "@/components/ui/ModuleTabs";

export const DELIBERACOES_TABS: ModuleTab[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Upload de PDFs", href: "/dashboard/upload" },
  { label: "Deliberações", href: "/dashboard/deliberacoes" },
];

export const DIRETORES_TABS: ModuleTab[] = [
  { label: "Diretores", href: "/dashboard/analytics/diretores" },
  { label: "Mandatos", href: "/dashboard/mandatos" },
  { label: "Votação", href: "/dashboard/votacao" },
  { label: "Cadastro", href: "/dashboard/diretores" },
];

export const ANALISE_TABS: ModuleTab[] = [
  { label: "Analytics", href: "/dashboard/analytics" },
  { label: "Temas", href: "/dashboard/analytics/temas" },
  { label: "Dashboard 360°", href: "/dashboard/360" },
  { label: "Insights", href: "/dashboard/insights" },
  { label: "Governança", href: "/dashboard/governanca" },
];

export const REGULATORIO_TABS: ModuleTab[] = [
  { label: "Visão Geral", href: "/dashboard/painel-regulatorio" },
  { label: "Setores", href: "/dashboard/painel-regulatorio/setores" },
  { label: "Microtemas", href: "/dashboard/painel-regulatorio/microtemas" },
  { label: "Empresas", href: "/dashboard/empresas" },
  { label: "Associados", href: "/dashboard/empresas/associados" },
  { label: "Relatórios", href: "/dashboard/painel-regulatorio/relatorios" },
];

export const CONFIG_TABS: ModuleTab[] = [
  { label: "Agências", href: "/dashboard/agencias" },
];

export const NOTICIAS_TABS: ModuleTab[] = [
  { label: "Feed", href: "/dashboard/noticias" },
  { label: "Newsletter", href: "/dashboard/boletim" },
];
