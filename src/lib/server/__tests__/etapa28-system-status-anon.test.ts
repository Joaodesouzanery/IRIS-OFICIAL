import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRuntimeStatus } from "@/lib/server/runtime-status";

// PR-Q (segurança jul/2026, achado B4): /system/status é PÚBLICA (bypass do middleware). Os
// `warnings` NOMEIAM qual env var falta (SERVICE_ROLE_KEY/CRON_SECRET) — vazam a postura do deploy
// a anônimos, inclusive em modo REAL (warning de CRON). Para chamadas SEM auth
// (includeSecretsPosture=false) não devolvemos warnings nem a postura de segredo. O DemoBanner
// (poll anônimo do useDataSync, sem Bearer) usa só `mode_reason`, que é preservado; a página de
// monitoramento chama com Bearer (api.get) e recebe os warnings completos.

const ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"] as const;

describe("system/status — não vaza postura de env a anônimo [B4]", () => {
  const snapshot: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) snapshot[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  });

  function setEnv(url?: string, serviceRole?: string, cron?: string) {
    if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    if (serviceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRole;
    if (cron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = cron;
  }

  it("modo real sem CRON_SECRET: anônimo NÃO recebe o warning de CRON nem os has_*; autenticado recebe", () => {
    setEnv("https://x.supabase.co", "svc-key", undefined); // real; só falta o cron

    const anon = getRuntimeStatus(false, false);
    expect(anon.warnings).toEqual([]);
    expect(anon.has_service_role_key).toBeUndefined();
    expect(anon.has_cron_secret).toBeUndefined();

    const authed = getRuntimeStatus(false, true);
    expect(authed.warnings.some((w) => /CRON_SECRET/.test(w))).toBe(true);
    expect(authed.has_cron_secret).toBe(false);
    expect(authed.has_service_role_key).toBe(true);
  });

  it("demo por falta de SERVICE_ROLE_KEY: anônimo não lista a var, mas mode_reason é preservado (DemoBanner)", () => {
    setEnv("https://x.supabase.co", undefined, undefined); // demo: sem service role

    const anon = getRuntimeStatus(false, false);
    expect(anon.is_demo).toBe(true);
    expect(anon.persistence).toBe("demo");
    expect(anon.warnings).toEqual([]);
    expect(anon.warnings.some((w) => /SERVICE_ROLE_KEY/.test(w))).toBe(false);
    // O DemoBanner (poll anônimo, sem Bearer) usa mode_reason para explicar o motivo ao operador:
    expect(anon.mode_reason).toBe("missing_service_role");

    const authed = getRuntimeStatus(false, true);
    expect(authed.warnings.some((w) => /SERVICE_ROLE_KEY/.test(w))).toBe(true);
  });

  it("ambiente completo (real): sem warnings em ambos; mode_reason 'real'", () => {
    setEnv("https://x.supabase.co", "svc-key", "cron-secret");
    expect(getRuntimeStatus(false, false).warnings).toEqual([]);
    expect(getRuntimeStatus(false, true).warnings).toEqual([]);
    expect(getRuntimeStatus(false, true).mode_reason).toBe("real");
  });
});
