"use client";

/**
 * Papel do usuário logado (ago/2026): admin (tudo) ou viewer (somente visualização).
 * Viewer = qualquer e-mail criado no Supabase Auth que NÃO está em ADMIN_EMAILS/
 * IRIS_OWNER_EMAIL nem em admin_users — vê todos os dados, não altera nada (as escritas
 * são barradas nos guards das rotas; a UI esconde as ações com este hook).
 *
 * ⚠️ FAIL-CLOSED quando há Supabase (Fase 35). A versão anterior fazia
 * `data ? Boolean(data.is_admin) : true` — qualquer falha de `/auth/me` (blip de rede, 401, 5xx)
 * fazia a UI tratar VIEWER como admin. O servidor continuava barrando, então não era escalada de
 * privilégio; o dano era oferecer ações que iam dar 403, e isso é parte do "achei a autenticação
 * estranha" que o usuário relatou.
 *
 * O `true` existia por um motivo real e ele foi PRESERVADO: sem Supabase configurado (demo local) não
 * há papel a consultar, e ali admin é o comportamento certo. O conserto é condicionar o fail-open
 * àquele caso em vez de a qualquer falha.
 *
 * ⚠️ E o texto antigo afirmava que `isViewer` começa `null` "para a UI não piscar botões". Não
 * começa: o tipo de retorno é `boolean`. Quem precisa evitar o piscar usa `carregando`.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useViewer(): { isViewer: boolean; isAdmin: boolean; carregando: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["auth-me-role"],
    queryFn: () => api.get<{ is_admin: boolean; role?: string }>("/auth/me").catch(() => null),
    staleTime: 5 * 60 * 1000,
  });
  // Sem Supabase configurado não existe papel a consultar — ali, e só ali, admin é o certo.
  const semSupabase = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const isAdmin = data ? Boolean(data.is_admin) : semSupabase;
  return { isViewer: !isAdmin, isAdmin, carregando: isLoading };
}
