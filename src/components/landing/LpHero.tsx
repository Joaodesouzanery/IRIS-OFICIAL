import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * A Hero — doze fotos setoriais em dissolve, uma por agência federal.
 *
 * ⚠️ ZERO JavaScript. O projeto não tem framer-motion nem biblioteca de carrossel, e instalar uma
 * para trocar imagem de fundo seria uma dependência nova numa página que precisa carregar rápido.
 * As doze ficam empilhadas e o ciclo é `animation` + `animation-delay` negativo escalonado
 * (`.lp-hero-img` em globals.css). Sem hidratação, sem estado, funciona com JS desligado.
 *
 * ⚠️ E o SCRIM é requisito de acessibilidade, não enfeite. O texto passa por cima de doze fotos
 * diferentes — céu claro de aeroporto, laboratório branco, mina escura. Sem uma camada opaca fixa,
 * o contraste dependeria de qual foto está na vez, e em algumas o título ficaria ilegível. O scrim
 * garante ≥ 4,5:1 independentemente da imagem.
 */
const FOTOS: ReadonlyArray<{ sigla: string; alt: string }> = [
  { sigla: "anm", alt: "Mina a céu aberto" },
  { sigla: "ana", alt: "Estação de tratamento de água vista de cima" },
  { sigla: "aneel", alt: "Torres de transmissão de energia elétrica" },
  { sigla: "antaq", alt: "Porto de contêineres com guindastes" },
  { sigla: "anac", alt: "Pista de aeroporto ao entardecer" },
  { sigla: "antt", alt: "Rodovia com tráfego vista de cima" },
  { sigla: "anp", alt: "Refinaria de petróleo à noite" },
  { sigla: "anatel", alt: "Torres de telecomunicação ao pôr do sol" },
  { sigla: "anvisa", alt: "Laboratório de análise com pipeta e tubos de ensaio" },
  { sigla: "ans", alt: "Corredor hospitalar" },
  { sigla: "anpd", alt: "Cabeamento de rede em data center" },
  { sigla: "ancine", alt: "Equipe de produção audiovisual em set de filmagem" },
];

export function LpHero() {
  return (
    <section className="relative isolate min-h-[86vh] overflow-hidden" style={{ background: "var(--lp-navy)" }}>
      <div className="absolute inset-0">
        {FOTOS.map((foto, i) => (
          <Image
            key={foto.sigla}
            src={`/hero/${foto.sigla}.jpg`}
            alt=""
            fill
            /* ⚠️ `alt=""` e `aria-hidden`: são imagens DECORATIVAS. O setor que cada uma ilustra já
               é dito em texto logo abaixo, na faixa das agências. Narrar doze fotos de fundo que se
               trocam sozinhas seria ruído para quem usa leitor de tela. */
            aria-hidden
            priority={i === 0}
            sizes="100vw"
            className="lp-hero-img"
            style={{ animationDelay: `${-i * 5}s` }}
          />
        ))}
      </div>

      {/* O scrim: forte à esquerda (onde o texto mora), leve à direita, para a foto respirar. */}
      <div
        className="absolute inset-0"
        aria-hidden
        style={{
          background:
            "linear-gradient(100deg, rgba(10,14,42,0.96) 0%, rgba(10,14,42,0.88) 42%, rgba(10,14,42,0.58) 100%)",
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-40"
        aria-hidden
        style={{ background: "linear-gradient(to top, var(--lp-navy), transparent)" }}
      />

      <div className="relative mx-auto flex min-h-[86vh] max-w-6xl flex-col justify-center px-4 py-28 sm:px-6">
        <p className="lp-eyebrow">Instituto de Regulação, Inovação e Sustentabilidade</p>
        <h1 className="lp-h1 mt-6 max-w-3xl text-white">
          A regulação brasileira,{" "}
          <span style={{ color: "var(--lp-gold)" }}>acompanhada de perto</span> e medida com método.
        </h1>
        <p className="lp-lead mt-6 max-w-2xl" style={{ color: "var(--lp-muted)" }}>
          Estudamos, analisamos e aprimoramos a regulação no Brasil, com transparência, participação
          social e evidência técnica. Acompanhamos as 12 agências reguladoras federais e levamos
          cada decisão colegiada até o voto de cada diretor.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="#radar" className="lp-btn-gold">
            Conheça o Radar Regulatório
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="#quem-somos" className="lp-btn-ghost">
            Quem somos
          </Link>
        </div>
      </div>
    </section>
  );
}
