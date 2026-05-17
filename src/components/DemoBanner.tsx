"use client";

import { FlaskConical, Database } from "lucide-react";
import { useDataSyncContext } from "@/components/DataSyncProvider";

export function DemoBanner() {
  const { mode, demoEnabled, userDemoEnabled, serverDemo, runtimeStatus, toggleDemo, localCount } = useDataSyncContext();

  if (!demoEnabled) return null;

  const isLocal = !demoEnabled && mode === "local";
  const activeDemo = demoEnabled;
  const reason = runtimeStatus.mode_reason;
  const description = reason === "missing_service_role"
    ? "- ambiente em DEMO por configuração incompleta: falta SUPABASE_SERVICE_ROLE_KEY no servidor."
    : reason === "missing_supabase_url"
      ? "- ambiente em DEMO por configuração incompleta: falta NEXT_PUBLIC_SUPABASE_URL."
      : reason === "user_demo"
        ? "- dados demonstrativos em modo somente leitura. Desligue o DEMO na sidebar para ver dados reais."
        : isLocal
          ? `- ${localCount} deliberação${localCount !== 1 ? "ões" : ""} via upload local.`
          : "- conectado aos dados reais.";

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2 border-b text-sm"
      style={{
        background: activeDemo ? "rgba(139,92,246,0.06)" : "rgba(249,115,22,0.06)",
        borderColor: activeDemo ? "rgba(139,92,246,0.15)" : "rgba(249,115,22,0.15)",
      }}
    >
      <div className="flex items-center gap-2">
        {activeDemo ? (
          <FlaskConical className="w-4 h-4 shrink-0 text-violet-400" />
        ) : (
          <Database className="w-4 h-4 shrink-0 text-brand" />
        )}
        <span className="font-medium" style={{ color: activeDemo ? "rgb(167,139,250)" : "var(--brand)" }}>
          {activeDemo ? "Modo DEMO" : "Dados Reais"}
        </span>
        <span className="text-text-muted font-normal">
          {description}
        </span>
      </div>

      <button
        onClick={toggleDemo}
        disabled={serverDemo && !userDemoEnabled}
        className="shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all"
        style={{
          background: activeDemo ? "rgba(249,115,22,0.1)" : "rgba(139,92,246,0.1)",
          color: activeDemo ? "var(--brand)" : "rgb(167,139,250)",
          border: `1px solid ${activeDemo ? "rgba(249,115,22,0.2)" : "rgba(139,92,246,0.2)"}`,
          opacity: serverDemo && !userDemoEnabled ? 0.55 : 1,
        }}
      >
        {userDemoEnabled ? (
          <>
            <Database className="w-3 h-3" />
            Ver dados reais
          </>
        ) : serverDemo ? (
          <>
            <FlaskConical className="w-3 h-3" />
            Configurar real
          </>
        ) : (
          <>
            <FlaskConical className="w-3 h-3" />
            Ver demo
          </>
        )}
      </button>
    </div>
  );
}
