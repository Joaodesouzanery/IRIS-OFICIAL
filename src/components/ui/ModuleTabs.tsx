"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { resolveActiveHref } from "@/lib/nav-active";

export interface ModuleTab {
  label: string;
  href: string;
}

export function ModuleTabs({ tabs }: { tabs: ModuleTab[] }) {
  const pathname = usePathname();

  // Etapa67 — MELHOR CASAMENTO VENCE (ver nav-active.ts). O prefixo cru deixava a aba
  // "Dashboard" da Qualidade Regulatória permanentemente ativa nas 8 abas do módulo, e
  // "Deliberações" acesa junto com "Votos dos Diretores". Exatamente uma aba acende.
  const activeHref = resolveActiveHref(pathname, tabs.map((t) => ({ href: t.href })));
  const isActive = (href: string) => href === activeHref;

  return (
    <div className="flex border-b border-border -mx-1 mb-2">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap",
            isActive(tab.href)
              ? "text-brand border-brand"
              : "text-text-muted border-transparent hover:text-text-secondary hover:border-border"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
