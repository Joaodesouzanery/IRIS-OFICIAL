"use client";

import { usePathname } from "next/navigation";
import { Search, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AuthControls } from "@/components/AuthControls";

const ROUTE_LABELS: Record<string, string> = {
  "/dashboard": "Overview",
  "/dashboard/upload": "Upload de PDFs",
  "/dashboard/deliberacoes": "Deliberações",
  "/dashboard/analytics": "Analytics",
  "/dashboard/analytics/diretores": "Análise por Diretor",
  "/dashboard/analytics/temas": "Análise por Tema",
  "/dashboard/analytics/institucional": "Métricas Institucionais",
  "/dashboard/mandatos": "Mandatos",
  "/dashboard/votacao": "Votação",
  "/dashboard/insights": "Insights",
  "/dashboard/agencias": "Agências",
};

export function Topbar() {
  const pathname = usePathname();
  const label = ROUTE_LABELS[pathname] ?? "IRIS Regulação";

  // Breadcrumb
  const segments = pathname.replace("/dashboard", "").split("/").filter(Boolean);

  return (
    <header className="flex items-center justify-between h-14 px-6 border-b border-border bg-bg-base shrink-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm">
        <span className="text-text-muted">Dashboard</span>
        {segments.length > 0 && (
          <>
            <span className="text-text-label mx-0.5">›</span>
            <span className="text-brand font-medium">{label}</span>
          </>
        )}
        {segments.length === 0 && (
          <>
            <span className="text-text-label mx-0.5">›</span>
            <span className="text-brand font-medium">Overview</span>
          </>
        )}
      </div>

      {/* Ações direita */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-label" />
          <input
            type="search"
            placeholder="Buscar..."
            className="input pl-8 pr-4 py-1.5 w-48 text-xs"
            aria-label="Busca global"
          />
        </div>

        {/* Notificações */}
        <button
          className="relative w-8 h-8 flex items-center justify-center rounded-md hover:bg-bg-hover transition-colors"
          aria-label="Notificações"
        >
          <Bell className="w-4 h-4 text-text-secondary" />
        </button>

        {/* Tema claro/escuro */}
        <ThemeToggle />
        <AuthControls />
      </div>
    </header>
  );
}
