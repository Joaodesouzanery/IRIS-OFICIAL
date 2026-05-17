/**
 * local-data-store.ts
 * Server-side in-memory store for synced localStorage data.
 * Bridges the gap between client-side localStorage and server-side API routes.
 * Data is pushed here via POST /api/v1/sync from the client's useDataSync hook.
 */

import type { Deliberacao } from "@/types";

export type DataMode = "demo" | "local";

let syncedDelibs: Deliberacao[] = [];
let dataMode: DataMode = "local";
let lastSyncAt = 0;

export function getSyncedDelibs(): Deliberacao[] {
  return syncedDelibs;
}

export function setSyncedDelibs(delibs: Deliberacao[]): void {
  syncedDelibs = delibs;
  lastSyncAt = Date.now();
}

export function getDataMode(): DataMode {
  return dataMode;
}

export function setDataMode(mode: DataMode): void {
  dataMode = mode;
}

export function getLastSyncAt(): number {
  return lastSyncAt;
}

/** Shorthand: true when the user explicitly chose local test data, even if it is empty. */
export function isLocalMode(): boolean {
  return dataMode === "local";
}
