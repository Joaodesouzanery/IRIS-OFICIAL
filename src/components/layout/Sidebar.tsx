"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useDataSyncContext } from "@/components/DataSyncProvider";
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

const NAV_ITEMS: NavItem[] = [
  { label: "Deliberações", href: "/dashboard/deliberacoes", icon: FileText },
  { label: "Notícias", href: "/dashboard/noticias", icon: Newspaper },
  { label: "Monitoramento", href: "/dashboard/monitoramento", icon: Radar },
  { label: "Diretores",    href: "/dashboard/analytics/diretores", icon: Users },
  { label: "Análise",      href: "/dashboard/analytics", icon: BarChart3 },
  { label: "Observatório da Regulação",  href: "/dashboard/painel-regulatorio", icon: TrendingUp },
  { label: "Qualidade Regulatória", href: "/dashboard/qualidade-regulatoria", icon: Award },
  { label: "Configurações",href: "/dashboard/agencias", icon: Building2 },
];

// Which URL prefixes activate each sidebar item
const MODULE_PATHS: Record<string, string[]> = {
  "/dashboard/deliberacoes": [
    "/dashboard",
    "/dashboard/upload",
    "/dashboard/deliberacoes",
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
    "/dashboard/mandatos",
    "/dashboard/votacao",
  ],
  "/dashboard/analytics": [
    "/dashboard/analytics",
    "/dashboard/analytics/temas",
    "/dashboard/360",
    "/dashboard/insights",
    "/dashboard/governanca",
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

  const isActive = (href: string) => {
    const paths = MODULE_PATHS[href] ?? [href];
    return paths.some((p) =>
      p === "/dashboard"
        ? pathname === "/dashboard"
        : pathname === p || pathname.startsWith(p + "/")
    );
  };

  return (
    <aside className="flex flex-col w-60 h-screen sticky top-0 bg-bg-sidebar border-r border-border shrink-0">
      {/* Logo / Agency Selector */}
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
          {NAV_ITEMS.map((item) => {
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
        <button
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
        </button>
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