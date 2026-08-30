import type { ModuleTab } from "@/components/ui/ModuleTabs";

export const DELIBERACOES_TABS: ModuleTab[] = [
  { label: "Dashboard", href: "/dashboard" },
  // Fase 12 — "Upload de PDFs" saiu do MENU a pedido do usuário; a PÁGINA /dashboard/upload
  // continua servida. Ela é a válvula de escape da esteira: única porta para revisão humana
  // com edição de campos, `origem: "revisao_humana"`, rejeitar/reprocessar 1-a-1 e upload
  // manual — e o botão "Revisar →" de Votos dos Diretores aponta para ela (?doc=<id>).
  // Remover a PÁGINA exigiria mover tudo isso antes.
  { label: "Deliberações", href: "/dashboard/deliberacoes" },
  { label: "Reuniões", href: "/dashboard/reunioes" },
  { label: "Votos dos Diretores", href: "/dashboard/deliberacoes/votos-diretores" },
  { label: "Boletim", href: "/dashboard/boletim" },
];

export const DIRETORES_TABS: ModuleTab[] = [
  { label: "Diretores", href: "/dashboard/analytics/diretores" },
  { label: "Mandatos", href: "/dashboard/mandatos" },
  { label: "Votação", href: "/dashboard/votacao" },
];

export const ANALISE_TABS: ModuleTab[] = [
  { label: "Analytics", href: "/dashboard/analytics" },
  { label: "Temas", href: "/dashboard/analytics/temas" },
  { label: "Institucional", href: "/dashboard/analytics/institucional" },
  { label: "Dashboard 360°", href: "/dashboard/360" },
  { label: "Insights", href: "/dashboard/insights" },
  { label: "Governança", href: "/dashboard/governanca" },
  // Etapa64: o painel que mostra SOBRE O QUÊ cada número é calculado. Fica ao lado de Governança
  // de propósito — é lá que o Score é lido, e é lá que a pergunta "com que base?" aparece.
  { label: "Saúde dos dados", href: "/dashboard/saude-dados" },
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
];
