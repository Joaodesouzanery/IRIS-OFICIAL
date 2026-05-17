"use client";

/**
 * useDataSync — bridges client localStorage with server-side API routes.
 * On mount and after changes, pushes deliberações + mode to POST /api/v1/sync.
 * API routes then use the synced data instead of hardcoded demoData.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getLocalDelibs } from "@/lib/local-store";
import type { RuntimeStatus } from "@/types";

const MODE_KEY = "iris_data_mode";
const DEMO_KEY = "iris_demo_enabled";
type DataMode = "demo" | "local";

function readMode(): DataMode {
  if (typeof window === "undefined") return "local";
  return (localStorage.getItem(MODE_KEY) as DataMode) ?? "local";
}

function readDemoEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(DEMO_KEY) === "1";
}

const DEFAULT_RUNTIME_STATUS: RuntimeStatus = {
  is_demo: true,
  has_supabase_url: false,
  has_service_role_key: false,
  persistence: "demo",
  mode_reason: "missing_supabase_url",
  warnings: ["Verificando configuração do ambiente."],
};

export function useDataSync() {
  const queryClient = useQueryClient();
  const [mode, setModeState] = useState<DataMode>(readMode);
  const [userDemoEnabled, setDemoEnabledState] = useState<boolean>(readDemoEnabled);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>(DEFAULT_RUNTIME_STATUS);
  const [synced, setSynced] = useState(false);
  const [localCount, setLocalCount] = useState(0);
  const lastHash = useRef("");

  const refreshRuntimeStatus = useCallback(async (userDemo = readDemoEnabled()) => {
    try {
      const headers = new Headers({ Accept: "application/json" });
      if (userDemo) headers.set("x-iris-demo", "1");
      const res = await fetch("/api/v1/system/status", { headers });
      if (!res.ok) throw new Error(res.statusText);
      setRuntimeStatus(await res.json());
    } catch {
      setRuntimeStatus(DEFAULT_RUNTIME_STATUS);
    }
  }, []);

  const doSync = useCallback(async (newMode?: DataMode) => {
    const m = newMode ?? readMode();
    const delibs = m === "local" ? getLocalDelibs() : [];
    setLocalCount(delibs.length);

    // Hash-based change detection
    const hash = `${m}:${delibs.length}:${delibs.map((d) => d.id).join(",")}`;
    if (hash === lastHash.current) {
      setSynced(true);
      return;
    }

    try {
      await fetch("/api/v1/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliberacoes: delibs, mode: m }),
      });
      lastHash.current = hash;
      setSynced(true);
      // Invalidate all cached queries so pages refetch with new data
      queryClient.invalidateQueries();
    } catch {
      // Non-critical; pages will fall back to demo data
      setSynced(true);
    }
  }, [queryClient]);

  const toggleMode = useCallback(() => {
    const next: DataMode = readMode() === "demo" ? "local" : "demo";
    localStorage.setItem(MODE_KEY, next);
    setModeState(next);
    lastHash.current = ""; // Force re-sync
    doSync(next);
  }, [doSync]);

  const setDemoEnabled = useCallback((enabled: boolean) => {
    localStorage.setItem(DEMO_KEY, enabled ? "1" : "0");
    localStorage.setItem(MODE_KEY, enabled ? "demo" : "local");
    setModeState(enabled ? "demo" : "local");
    setDemoEnabledState(enabled);
    lastHash.current = "";
    doSync(enabled ? "demo" : "local");
    refreshRuntimeStatus(enabled);
    queryClient.invalidateQueries();
  }, [doSync, queryClient, refreshRuntimeStatus]);

  const toggleDemo = useCallback(() => {
    setDemoEnabled(!readDemoEnabled());
  }, [setDemoEnabled]);

  // Sync on mount
  useEffect(() => {
    refreshRuntimeStatus();
    doSync();
  }, [doSync, refreshRuntimeStatus]);

  // Listen for cross-tab storage changes
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "iris_local_deliberacoes" || e.key === MODE_KEY) {
        if (e.key === MODE_KEY) setModeState(readMode());
        setDemoEnabledState(readDemoEnabled());
        lastHash.current = ""; // Force re-sync
        refreshRuntimeStatus(readDemoEnabled());
        doSync();
      } else if (e.key === DEMO_KEY) {
        setDemoEnabledState(readDemoEnabled());
        refreshRuntimeStatus(readDemoEnabled());
        queryClient.invalidateQueries();
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [doSync, queryClient, refreshRuntimeStatus]);

  const demoEnabled = runtimeStatus.is_demo || userDemoEnabled;

  return {
    mode,
    toggleMode,
    demoEnabled,
    userDemoEnabled,
    serverDemo: runtimeStatus.persistence === "demo",
    runtimeStatus,
    toggleDemo,
    setDemoEnabled,
    synced,
    localCount,
    sync: doSync,
  };
}
