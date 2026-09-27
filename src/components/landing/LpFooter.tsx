import Link from "next/link";
import { Instagram, Linkedin, Mail, ArrowUpRight } from "lucide-react";
import { CANAIS } from "@/lib/landing-content";

/**
 * Rodapé — canais institucionais.
 *
 * ⚠️ Instagram e LinkedIn entram como BOTÕES, não como feed embutido, e a razão é de segurança:
 * a CSP do projeto tem `script-src 'self'` (`next.config.mjs`), o que bloqueia todo widget de
 * terceiro (Elfsight, LightWidget, Behold, Smash Balloon). Embutir o feed exigiria afrouxar a CSP
 * do app INTEIRO — inclusive do dashboard autenticado — para ganhar três fotos numa página
 * pública. Foi a decisão do usuário e é a troca certa.
 *
 * ⚠️ As URLs vêm de `landing-content.ts`, que repete as de `newsletter-document.ts`. Se um dia o
 * Instagram do Instituto mudar, os dois lugares precisam mudar juntos — e o `etapa188` cobra que
 * eles sejam iguais, para não haver duas verdades sobre o mesmo link.
 */
export function LpFooter() {
  const ano = new Date().getFullYear();
  return (
    <footer style={{ background: "var(--lp-navy)", borderTop: "1px solid var(--lp-line)" }}>
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/logo-iris.png"
              alt="IRIS — Instituto de Regulação, Inovação e Sustentabilidade"
              className="h-10 w-auto"
            />
            <p className="mt-5 text-sm leading-relaxed" style={{ color: "var(--lp-muted)" }}>
              Instituto de Regulação, Inovação e Sustentabilidade — entidade privada sem fins
              lucrativos dedicada ao estudo e ao aprimoramento da regulação no Brasil.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <p className="lp-eyebrow">Canais</p>
            <a
              href={CANAIS.instagram}
              target="_blank"
              rel="noopener noreferrer"
              className="lp-btn-ghost justify-start"
            >
              <Instagram className="h-4 w-4" />
              Instagram
              <ArrowUpRight className="h-3.5 w-3.5 opacity-60" />
            </a>
            <a
              href={CANAIS.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="lp-btn-ghost justify-start"
            >
              <Linkedin className="h-4 w-4" />
              LinkedIn
              <ArrowUpRight className="h-3.5 w-3.5 opacity-60" />
            </a>
            <a href={`mailto:${CANAIS.email}`} className="lp-btn-ghost justify-start">
              <Mail className="h-4 w-4" />
              {CANAIS.email}
            </a>
          </div>
        </div>

        <div
          className="mt-14 flex flex-col gap-3 pt-8 text-xs sm:flex-row sm:items-center sm:justify-between"
          style={{ borderTop: "1px solid var(--lp-line)", color: "var(--lp-muted)" }}
        >
          <p>© {ano} IRIS — Instituto de Regulação, Inovação e Sustentabilidade</p>
          <div className="flex flex-wrap items-center gap-5">
            <a
              href={CANAIS.site}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-white"
            >
              Site institucional
            </a>
            <Link href="/login" className="transition-colors hover:text-white">
              Entrar na plataforma
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
