import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Cabeçalho público.
 *
 * ⚠️ Sem menu sanduíche, e isso é decisão. Um hambúrguer exigiria estado — logo, componente de
 * cliente e JavaScript numa página que é inteiramente estática. Com apenas quatro âncoras, esconder
 * a navegação no celular e manter o botão "Entrar" (que é a ação que importa) entrega o mesmo
 * resultado sem hidratar nada.
 */
const SECOES = [
  { href: "#radar", label: "Radar Regulatório" },
  { href: "#o-que-fazemos", label: "O que fazemos" },
  { href: "#quem-somos", label: "Quem somos" },
  { href: "#eventos", label: "Eventos" },
] as const;

export function LpHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-6 sm:px-6">
        <Link href="/" aria-label="IRIS — página inicial" className="flex-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-iris.png"
            alt="IRIS — Instituto de Regulação, Inovação e Sustentabilidade"
            className="h-9 w-auto"
          />
        </Link>

        <nav aria-label="Seções" className="hidden items-center gap-8 md:flex">
          {SECOES.map((s) => (
            <a
              key={s.href}
              href={s.href}
              className="text-sm text-white/72 transition-colors hover:text-white"
            >
              {s.label}
            </a>
          ))}
        </nav>

        <Link href="/login" className="lp-btn-ghost flex-none !px-4 !py-2">
          Entrar
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </header>
  );
}
