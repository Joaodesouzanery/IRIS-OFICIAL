import { O_QUE_FAZEMOS } from "@/lib/landing-content";

/** Os 9 eixos de atuação do Instituto. Texto em `src/lib/landing-content.ts`. */
export function LpOQueFazemos() {
  return (
    <section id="o-que-fazemos" className="py-20 sm:py-24" style={{ background: "var(--lp-paper-2)" }}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="lp-eyebrow" style={{ color: "#8a6d1f" }}>
          O que fazemos
        </p>
        <h2 className="lp-h2 mt-5 max-w-3xl" style={{ color: "var(--lp-ink)" }}>
          Nove frentes de atuação
        </h2>

        <div className="mt-12 grid gap-x-10 gap-y-9 md:grid-cols-2 lg:grid-cols-3">
          {O_QUE_FAZEMOS.map((item) => (
            <article key={item.titulo}>
              {/* ⚠️ Sem numeração aqui, de propósito: os nove eixos são simultâneos, não uma
                  sequência. O filete dourado marca cada um sem sugerir ordem. */}
              <span className="block h-px w-10" style={{ background: "var(--lp-gold)" }} aria-hidden />
              <h3 className="mt-4 text-base font-semibold" style={{ color: "var(--lp-ink)" }}>
                {item.titulo}
              </h3>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--lp-muted-ink)" }}>
                {item.texto}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
