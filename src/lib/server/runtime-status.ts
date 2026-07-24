export interface RuntimeStatus {
  is_demo: boolean;
  has_supabase_url: boolean;
  // Postura de segredos: só incluída para chamadas AUTENTICADAS. A rota /system/status
  // é pública (bypass do middleware), então não revela a config do deploy a anônimos.
  has_service_role_key?: boolean;
  has_cron_secret?: boolean;
  persistence: "supabase" | "demo";
  mode_reason: "missing_supabase_url" | "missing_service_role" | "user_demo" | "real";
  warnings: string[];
}

export function getRuntimeStatus(userDemo = false, includeSecretsPosture = true): RuntimeStatus {
  const hasSupabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const hasCronSecret = Boolean(process.env.CRON_SECRET);
  const warnings: string[] = [];

  if (!hasSupabaseUrl) {
    warnings.push("NEXT_PUBLIC_SUPABASE_URL ausente; a aplicação opera em modo DEMO/local.");
  }
  if (hasSupabaseUrl && !hasServiceRoleKey) {
    warnings.push("SUPABASE_SERVICE_ROLE_KEY ausente; APIs servidoras com persistência Supabase falharão.");
  }
  if (hasSupabaseUrl && hasServiceRoleKey && !hasCronSecret) {
    warnings.push("CRON_SECRET ausente; os crons de coleta não conseguem autenticar.");
  }
  if (userDemo && hasSupabaseUrl && hasServiceRoleKey) {
    warnings.push("Modo DEMO ativado manualmente pelo usuário.");
  }

  const serverDemo = !hasSupabaseUrl || !hasServiceRoleKey;
  const isDemo = serverDemo || userDemo;
  const modeReason = !hasSupabaseUrl
    ? "missing_supabase_url"
    : !hasServiceRoleKey
      ? "missing_service_role"
      : userDemo
        ? "user_demo"
        : "real";

  const status: RuntimeStatus = {
    is_demo: isDemo,
    has_supabase_url: hasSupabaseUrl,
    persistence: serverDemo ? "demo" : "supabase",
    mode_reason: modeReason,
    // Os `warnings` NOMEIAM qual env var falta (SERVICE_ROLE_KEY/CRON_SECRET) — revelam a
    // postura do deploy. /system/status é pública (bypass do middleware), então só devolvemos
    // os warnings a chamadas AUTENTICADAS (mesmo gate dos has_*). O DemoBanner (poll anônimo do
    // useDataSync, sem Bearer) usa só `mode_reason`; a página de monitoramento chama com Bearer
    // (api.get) e recebe os warnings completos.
    warnings: includeSecretsPosture ? warnings : [],
  };
  if (includeSecretsPosture) {
    status.has_service_role_key = hasServiceRoleKey;
    status.has_cron_secret = hasCronSecret;
  }
  return status;
}
