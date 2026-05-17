"use client";

/**
 * DataSyncProvider — wraps dashboard children.
 * Ensures localStorage data is synced to server before any API queries fire.
 */

import { createContext, useContext } from "react";
import { useDataSync } from "@/hooks/useDataSync";
import type { RuntimeStatus } from "@/types";

type DataSyncCtx = {
  mode: "demo" | "local";
  toggleMode: () => void;
  demoEnabled: boolean;
  userDemoEnabled: boolean;
  serverDemo: boolean;
  runtimeStatus: RuntimeStatus;
  toggleDemo: () => void;
  setDemoEnabled: (enabled: boolean) => void;
  synced: boolean;
  localCount: number;
  sync: (m?: "demo" | "local") => Promise<void>;
};

const Ctx = createContext<DataSyncCtx>({
  mode: "local",
  toggleMode: () => {},
  demoEnabled: false,
  userDemoEnabled: false,
  serverDemo: true,
  runtimeStatus: {
    is_demo: true,
    has_supabase_url: false,
    has_service_role_key: false,
    persistence: "demo",
    mode_reason: "missing_supabase_url",
    warnings: [],
  },
  toggleDemo: () => {},
  setDemoEnabled: () => {},
  synced: false,
  localCount: 0,
  sync: async () => {},
});

export function useDataSyncContext() {
  return useContext(Ctx);
}

export function DataSyncProvider({ children }: { children: React.ReactNode }) {
  const data = useDataSync();

  if (!data.synced) {
    return (
      <div className="flex items-center justify-center h-screen text-text-muted text-sm">
        Sincronizando dados...
      </div>
    );
  }

  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}
