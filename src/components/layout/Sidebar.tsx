"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { resolveActiveHref } from "@/lib/nav-active";
import { cn } from "@/lib/utils";
import { useDataSyncContext } from "@/components/DataSyncProvider";
import { useViewer } from "@/lib/use-viewer";
import {
  FileText,
  BarChart3,
  Users,
  TrendingUp,
  Building2,
  ChevronDown,
  Activity,
  Award,
  Radar,
  FlaskConical,
  Database,
  Newspaper,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

// Observatório em 1º (ago/2026): é a porta de entrada da plataforma — landing pós-login.
const NAV_ITEMS: NavItem[] = [
  { label: "Observatório da Regulação",  href: "/dashboard/painel-regulatorio", icon: TrendingUp },
  { label: "Deliberações", href: "/dashboard/deliberacoes", icon: FileText },
  { label: "Notícias", href: "/dashboard/noticias", icon: Newspaper },
  { label: "Monitoramento", href: "/dashboard/monitoramento", icon: Radar },
  { label: "Diretores",    href: "/dashboard/analytics/diretores", icon: Users },
  { label: "Análise",      href: "/dashboard/analytics", icon: BarChart3 },
  { label: "Qualidade Regulatória", href: "/dashboard/qualidade-regulatoria", icon: Award },
  { label: "Configurações",href: "/dashboard/agencias", icon: Building2 },
];

// Which URL prefixes activate each sidebar item
const MODULE_PATHS: Record<string, string[]> = {
  "/dashboard/deliberacoes": [
    "/dashboard",
    "/dashboard/upload",
    "/dashboard/deliberacoes",
    // Etapa67 — `/dashboard/reunioes` era rota ÓRFÃ: aba do módulo Deliberações sem dono na
    // sidebar, então visitar Reuniões apagava a navegação inteira.
    "/dashboard/reunioes",
    "/dashboard/boletim",
  ],
  "/dashboard/monitoramento": [
    "/dashboard/monitoramento",
    "/dashboard/documentos-antt-2026",
  ],
  "/dashboard/noticias": [
    "/dashboard/noticias",
  ],
  "/dashboard/analytics/diretores": [
    "/dashboard/analytics/diretores",
    // Etapa67 — o PERFIL do diretor (`/dashboard/diretores/[id]`) era rota órfã.
    "/dashboard/diretores",
    "/dashboard/mandatos",
    "/dashboard/votacao",
  ],
  "/dashboard/analytics": [
    "/dashboard/analytics",
    "/dashboard/analytics/temas",
    // Etapa67 — antes só acendia por ACIDENTE de prefixo; explícito, sobrevive à regra nova.
    "/dashboard/analytics/institucional",
    "/dashboard/360",
    "/dashboard/insights",
    "/dashboard/governanca",
    "/dashboard/saude-dados",
  ],
  "/dashboard/painel-regulatorio": [
    "/dashboard/painel-regulatorio",
    "/dashboard/empresas",
    "/dashboard/documentos-associados",
  ],
  "/dashboard/qualidade-regulatoria": [
    "/dashboard/qualidade-regulatoria",
  ],
  "/dashboard/agencias": [
    "/dashboard/agencias",
  ],
};

export function Sidebar() {
  const pathname = usePathname();
  const { demoEnabled, userDemoEnabled, serverDemo, toggleDemo } = useDataSyncContext();
  // Viewer (ago/2026): esconde Configurações e o toggle DEMO — somente visualização.
  const { isViewer } = useViewer();

  // Etapa67 — MELHOR CASAMENTO VENCE (ver nav-active.ts). A regra antiga de prefixo cru fazia
  // "Análise" e "Diretores" acenderem juntos: `/dashboard/analytics/diretores` casava os dois.
  // Exatamente um item fica ativo, sem caso especial por rota.
  const activeHref = resolveActiveHref(
    pathname,
    NAV_ITEMS.map((item) => ({ href: item.href, paths: MODULE_PATHS[item.href] ?? [item.href] })),
  );
  const isActive = (href: string) => href === activeHref;

  return (
    <aside className="flex flex-col w-60 h-screen sticky top-0 bg-bg-sidebar border-r border-border shrink-0">
      {/* Logo IRIS — arte neon branca transparente sobre chip PRETO (funciona em tema claro e
          escuro). NÃO reutilizar newsletter-logo-wide aqui: aquele lettering é para 140px e
          serrilha a 32px (o "erro de visualização" reportado em produção). */}
      <div className="px-4 pt-4">
        <div className="rounded-md bg-black px-2 py-2 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-iris.png" alt="IRIS — Instituto de Regulação, Inovação e Sustentabilidade" className="h-10 w-auto" />
        </div>
      </div>

      {/* Agency Selector */}
      <div className="p-4 border-b border-border">
        <button className="flex items-center justify-between w-full px-3 py-2.5 rounded-md bg-bg-card border border-border hover:border-brand/30 transition-colors group">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-brand flex items-center justify-center shrink-0">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <div className="text-left">
              <p className="text-xs font-mono font-medium text-text-muted uppercase tracking-wider">
                Agência
              </p>
              <p className="text-sm font-medium text-text-primary truncate max-w-[130px]">
                Todas
              </p>
            </div>
          </div>
          <ChevronDown className="w-4 h-4 text-text-muted group-hover:text-text-secondary transition-colors" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <ul className="space-y-0.5">
          {NAV_ITEMS.filter((item) => !(isViewer && item.href === "/dashboard/agencias")).map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn("sidebar-item", active && "active")}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border space-y-3">
        {!isViewer && <button
          type="button"
          onClick={toggleDemo}
          aria-pressed={userDemoEnabled || serverDemo}
          disabled={serverDemo && !userDemoEnabled}
          className={cn(
            "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-md border transition-colors",
            demoEnabled
              ? "bg-violet-500/10 border-violet-400/30 text-violet-300"
              : "bg-bg-card border-border text-text-secondary hover:border-brand/30 hover:text-brand",
          )}
        >
          <span className="flex items-center gap-2">
            {demoEnabled ? <FlaskConical className="w-4 h-4" /> : <Database className="w-4 h-4" />}
            <span className="text-xs font-mono font-semibold uppercase tracking-wider">DEMO</span>
          </span>
          <span className={cn(
            "h-5 w-9 rounded-full border p-0.5 transition-colors",
            demoEnabled ? "bg-violet-500/30 border-violet-300/40" : "bg-bg-hover border-border",
          )}>
            <span className={cn(
              "block h-3.5 w-3.5 rounded-full transition-transform",
              demoEnabled ? "translate-x-4 bg-violet-200" : "bg-text-label",
            )} />
          </span>
        </button>}
        {isViewer && (
          <p className="text-[10px] text-text-muted text-center uppercase tracking-wider">Somente visualização</p>
        )}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-brand/20 flex items-center justify-center">
            <Activity className="w-3 h-3 text-brand" />
          </div>
          <div>
            <p className="text-xs font-mono text-text-muted uppercase tracking-wider">
              IRIS Regulação
            </p>
            <p className="text-xs text-text-label">v1.0.0</p>
          </div>
        </div>
      </div>
    </aside>
  );
}