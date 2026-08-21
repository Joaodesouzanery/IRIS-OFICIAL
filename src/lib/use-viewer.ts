"use client";

/**
 * Papel do usuário logado (ago/2026): admin (tudo) ou viewer (somente visualização).
 * Viewer = qualquer e-mail criado no Supabase Auth que NÃO está em ADMIN_EMAILS/
 * IRIS_OWNER_EMAIL nem em admin_users — vê todos os dados, não altera nada (as escritas
 * são barradas nos guards das rotas; a UI esconde as ações com este hook).
 *
 * Fail-safe: enquanto carrega (ou em erro), assume viewer=false só para ADMIN JÁ CONHECIDO
 * ser o caso comum — mas `isViewer` começa `null` para a UI poder não piscar botões.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useViewer(): { isViewer: boolean; isAdmin: boolean; carregando: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["auth-me-role"],
    queryFn: () => api.get<{ is_admin: boolean; role?: string }>("/auth/me").catch(() => null),
    staleTime: 5 * 60 * 1000,
  });
  // Sem resposta (demo local/sem Supabase): trata como admin (comportamento antigo).
  const isAdmin = data ? Boolean(data.is_admin) : true;
  return { isViewer: !isAdmin, isAdmin, carregando: isLoading };
}
