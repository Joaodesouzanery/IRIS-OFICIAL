import { notFound } from "next/navigation";
import { setupOwnerAberto } from "@/lib/server/setup-aberto";

/**
 * Gate do `/setup-owner` — Fase 32.
 *
 * ⚠️ O gate mora num LAYOUT, e não dentro da página, por um motivo prático: `page.tsx` é
 * `"use client"`, e componente de cliente não lê variável de ambiente de servidor. Fatiar a página
 * em wrapper-servidor + form-cliente daria o mesmo efeito com muito mais remexida num arquivo que
 * não tem teste. O layout envolve a rota inteira e é servidor por padrão.
 *
 * ⚠️ E o gate da PÁGINA não é o que protege: quem protege é o 404 da ROTA de API. Esconder a tela
 * sem fechar o endpoint seria segurança por obscuridade — a página só não fica prometendo uma ação
 * que o servidor recusa.
 */
export default function SetupOwnerLayout({ children }: { children: React.ReactNode }) {
  if (!setupOwnerAberto()) notFound();
  return <>{children}</>;
}
