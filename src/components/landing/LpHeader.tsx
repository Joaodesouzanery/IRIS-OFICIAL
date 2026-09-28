import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Cabeçalho público.
 *
 * ⚠️ Sem menu sanduíche, e isso é decisão. Um hambúrguer exigiria estado — logo, componente de
 * cliente e JavaScript numa página que é inteiramente estática. Com apenas quatro âncoras, esconder
 * a navegação no celular e manter o botão "Entrar" (que é a ação que importa) entrega o mesmo
 * resultado sem hidratar nada.
 *
 * ═══ ⚠️ O MENU ILEGÍVEL: a causa foi MEDIDA, e não era contraste fraco ═══
 * O usuário relatou que o menu está "escuro, difícil de ler". Minha hipótese era que o scrim da Hero
 * é mais fraco à direita, onde o menu mora. **Errado.** Os links usavam `text-white/72`, e a escala
 * de opacidade do Tailwind 3 anda de 5 em 5: `72` não está nela, e valor arbitrário exige colchetes
 * (`text-white/[0.72]`). Conferido no CSS CONSTRUÍDO — `text-white\/45`, `\/50`, `\/55` e `\/60`
 * existem no bundle; `\/72` **não existe**. A classe não gerava regra nenhuma, então o link herdava
 * a cor de texto do `body` do app, que é escura. Texto escuro sobre navy escuro.
 *
 * Duas mudanças, e as duas importam:
 *  1. `text-white/70`, que está na escala e de fato gera regra;
 *  2. uma FAIXA própria atrás do cabeçalho. O menu não pode depender do scrim da imagem da Hero,
 *     que muda a cada 5 segundos — um fundo que varia é um contraste que varia.
 */
const SECOES = [
  { href: "#radar", label: "Radar Regulatório" },
  { href: "#o-que-fazemos", label: "O que fazemos" },
  // Na MESMA ordem em que as seções aparecem na página — um menu que discorda da ordem do scroll
  // faz o leitor achar que clicou errado.
  { href: "#produtos", label: "Produtos" },
  { href: "#quem-somos", label: "Quem somos" },
  { href: "#eventos", label: "Eventos" },
] as const;

export function LpHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-20">
      {/* A faixa: gradiente do navy ao transparente, atrás de tudo. Não escurece a Hero inteira —
          só garante que a leitura do cabeçalho não dependa de qual imagem está passando. */}
      <div className="lp-header-faixa" aria-hidden />
      <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-6 sm:px-6">
        <Link href="/" aria-label="IRIS, página inicial" className="flex-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-iris.png"
            alt="IRIS — Instituto de Regulação, Inovação e Sustentabilidade"
            className="h-9 w-auto"
          />
        </Link>

        <nav aria-label="Seções" className="hidden items-center gap-8 md:flex">
          {SECOES.map((s) => (
            <a key={s.href} href={s.href} className="lp-nav-link text-sm">
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
