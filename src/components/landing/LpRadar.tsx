import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ETAPAS_DO_RADAR } from "@/lib/landing-content";

/**
 * O Radar Regulatório — o nome público do Observatório da Regulação.
 *
 * ⚠️ As quatro etapas descrevem o que a plataforma FAZ, não o que ela pretende fazer. A etapa 03
 * declara a cobertura da esteira de votos (ANTT, ANM, ARTESP) em vez de deixar subentendido que as
 * 12 agências têm voto individual. Numa página que mostra 12 logos, o silêncio sobre isso não seria
 * neutro — seria uma afirmação.
 */
export function LpRadar() {
  return (
    <section id="radar" className="py-20 sm:py-28" style={{ background: "var(--lp-navy)" }}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="lp-eyebrow">Radar Regulatório</p>
        <h2 className="lp-h2 mt-5 max-w-3xl text-white">
          Da publicação oficial até{" "}
          <span style={{ color: "var(--lp-gold)" }}>o voto de cada diretor</span>
        </h2>
        <p className="lp-lead mt-5 max-w-2xl" style={{ color: "var(--lp-muted)" }}>
          O Radar acompanha as decisões das agências reguladoras e as transforma em dado auditável —
          com a evidência sempre a um clique do documento que a originou.
        </p>

        <ol className="mt-14 grid gap-5 md:grid-cols-2">
          {ETAPAS_DO_RADAR.map((etapa) => (
            <li key={etapa.numero} className="lp-card">
              {/* Numeração porque AQUI existe sequência de verdade: uma etapa depende da anterior.
                  Numerar o que não é sequência seria decoração fingindo de informação. */}
              <span
                className="font-mono text-sm font-semibold"
                style={{ color: "var(--lp-gold)" }}
                aria-hidden
              >
                {etapa.numero}
              </span>
              <h3 className="mt-3 text-lg font-semibold text-white">{etapa.titulo}</h3>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--lp-muted)" }}>
                {etapa.texto}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-12">
          <Link href="/login" className="lp-btn-gold">
            Entrar na plataforma
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
