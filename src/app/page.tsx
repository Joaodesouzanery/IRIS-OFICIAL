import type { Metadata } from "next";
import { LpHeader } from "@/components/landing/LpHeader";
import { LpHero } from "@/components/landing/LpHero";
import { LpAgencias } from "@/components/landing/LpAgencias";
import { LpRadar } from "@/components/landing/LpRadar";
import { LpOQueFazemos } from "@/components/landing/LpOQueFazemos";
import { LpProdutos } from "@/components/landing/LpProdutos";
import { LpQuemSomos } from "@/components/landing/LpQuemSomos";
import { LpEventos } from "@/components/landing/LpEventos";
import { LpFooter } from "@/components/landing/LpFooter";

/**
 * Landing page pública do IRIS — Fase 32.
 *
 * ⚠️ Esta rota era um `redirect("/dashboard/painel-regulatorio")` de 5 linhas. Trocá-la por uma
 * página exigiu três coisas fora daqui, e as três são fáceis de esquecer:
 *   1. `/` entrou em `PUBLIC_APP_EXACT` no `src/middleware.ts` — sem isso, a landing redirecionaria
 *      para `/login`, que é o comportamento que ela existe para substituir;
 *   2. o `robots: "noindex, nofollow"` DESCEU do layout raiz para `src/app/dashboard/layout.tsx` —
 *      no raiz, ele marcava como não-indexável justamente a página feita para ser encontrada;
 *   3. `/dashboard` continua exigindo sessão. Abrir a raiz não pode abrir o resto — é o portão que
 *      o `etapa188` cobra.
 *
 * ⚠️ Server Component puro: nenhuma seção é `"use client"`, nenhuma usa React Query, e o crossfade
 * da Hero é CSS. A página funciona com JavaScript desligado.
 */
export const revalidate = 3600; // o calendário de eventos muda em dias, não em segundos

export const metadata: Metadata = {
  title: "IRIS — Instituto de Regulação, Inovação e Sustentabilidade",
  description:
    "Entidade privada sem fins lucrativos dedicada ao estudo, à análise e ao aprimoramento da " +
    "regulação no Brasil. Acompanhamos as 12 agências reguladoras federais.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

export default function LandingPage() {
  return (
    /* `.lp` carrega os tokens navy+dourado. Escopado aqui para o tema claro/escuro do app não
       alcançar a landing — ela tem identidade fixa, como a tela de login. */
    <div className="lp min-h-screen" style={{ background: "var(--lp-navy)" }}>
      <LpHeader />
      <main>
        <LpHero />
        <LpAgencias />
        <LpRadar />
        <LpOQueFazemos />
        {/* Produtos vem DEPOIS do que fazemos: primeiro o que é, depois o que se compra. */}
        <LpProdutos />
        <LpQuemSomos />
        <LpEventos />
      </main>
      <LpFooter />
    </div>
  );
}
