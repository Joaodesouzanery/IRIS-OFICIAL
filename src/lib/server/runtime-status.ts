export interface RuntimeStatus {
  is_demo: boolean;
  has_supabase_url: boolean;
  has_service_role_key: boolean;
  persistence: "supabase" | "demo";
  mode_reason: "missing_supabase_url" | "missing_service_role" | "user_demo" | "real";
  warnings: string[];
}

export function getRuntimeStatus(userDemo = false): RuntimeStatus {
  const hasSupabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const warnings: string[] = [];

  if (!hasSupabaseUrl) {
    warnings.push("NEXT_PUBLIC_SUPABASE_URL ausente; a aplicação opera em modo DEMO/local.");
  }
  if (hasSupabaseUrl && !hasServiceRoleKey) {
    warnings.push("SUPABASE_SERVICE_ROLE_KEY ausente; APIs servidoras com persistência Supabase falharão.");
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

  return {
    is_demo: isDemo,
    has_supabase_url: hasSupabaseUrl,
    has_service_role_key: hasServiceRoleKey,
    persistence: serverDemo ? "demo" : "supabase",
    mode_reason: modeReason,
    warnings,
  };
}
