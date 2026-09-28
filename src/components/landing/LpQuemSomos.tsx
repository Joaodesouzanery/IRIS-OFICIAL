import Image from "next/image";
import { QUEM_SOMOS } from "@/lib/landing-content";

/**
 * Quem somos — texto sobre um mosaico de imagens em dissolve.
 *
 * ⚠️ AS FOTOS DOS EVENTOS CHEGARAM (Fase 35). O texto anterior deste bloco dizia: "enquanto as fotos
 * dos eventos não chegam, esta é a opção honesta… quando chegarem, a troca é mudar esta lista — o
 * componente não muda". Foi exatamente isso: o componente é o mesmo, só a lista mudou.
 *
 * ⚠️ E QUATRO, não nove. O mosaico tem quatro colunas e o scrim cobre 86–93% — acrescentar fotos aqui
 * não mostraria mais nada e custaria download. As nove vivem no `LpEventos`, onde cada uma aparece do
 * tamanho que merece, com o nome do evento ao lado.
 *
 * A escolha das quatro é por CONTRASTE de composição (plateia, painel, palco, bastidor), não por
 * importância do evento — a seção é sobre quem somos, e o fundo é textura.
 */
const FUNDO = [
  "1-forum-brasil-de-regulacao",
  "seminario-iris-do-setor-metroferroviario",
  "1-forum-iris-de-negocios-em-energia-e-mineracao",
  "novo-marco-legal-do-setor-portuario",
] as const;

export function LpQuemSomos() {
  return (
    <section
      id="quem-somos"
      className="relative isolate overflow-hidden py-20 sm:py-28"
      style={{ background: "var(--lp-navy)" }}
    >
      <div className="absolute inset-0" aria-hidden>
        <div className="grid h-full grid-cols-2 lg:grid-cols-4">
          {FUNDO.map((foto) => (
            <div key={foto} className="relative h-full">
              <Image src={`/eventos/${foto}.jpg`} alt="" fill sizes="25vw" className="object-cover" />
            </div>
          ))}
        </div>
      </div>
      {/* Scrim muito mais forte que o da Hero: aqui há PARÁGRAFO para ler, não só um título. */}
      <div
        className="absolute inset-0"
        aria-hidden
        /* ⚠️ Calibrado OLHANDO a página: a 0,93/0,97 as imagens sumiam por completo e a seção virava
            um retângulo navy chapado. A 0,86/0,93 a textura aparece e o parágrafo continua legível —
            contraste de texto branco sobre #0a0e2a a 86% ainda passa folgado de 4,5:1. */
        style={{ background: "linear-gradient(180deg, rgba(10,14,42,0.86), rgba(10,14,42,0.93))" }}
      />

      <div className="relative mx-auto max-w-4xl px-4 sm:px-6">
        <p className="lp-eyebrow">Quem somos</p>
        <h2 className="lp-h2 mt-5 text-white">
          Uma entidade privada, sem fins lucrativos,{" "}
          <span style={{ color: "var(--lp-gold)" }}>dedicada à regulação</span>
        </h2>
        <div className="mt-8 space-y-6">
          {QUEM_SOMOS.map((paragrafo) => (
            <p key={paragrafo.slice(0, 40)} className="lp-lead" style={{ color: "var(--lp-muted)" }}>
              {paragrafo}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
