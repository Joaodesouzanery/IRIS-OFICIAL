import Image from "next/image";
import { PRODUTOS } from "@/lib/landing-content";

/**
 * Produtos — dois cartões largos, foto à esquerda e conteúdo à direita.
 *
 * ⚠️ DOIS cartões e não uma grade de três: com dois itens, uma grade de três colunas deixa um buraco
 * que o olho lê como "falta algo". Cartão largo alternando o lado da foto usa a largura inteira e a
 * lista não parece incompleta — o que importa porque ela É curta de propósito (só recebi as páginas 12
 * a 22 do deck, e os outros três produtos não estão nelas).
 *
 * ⚠️ E sem PREÇO, por decisão do usuário. O selo diz "exclusivo para associados", que é o que o deck
 * traz; quanto custa é conversa, não landing.
 */
export function LpProdutos() {
  return (
    <section id="produtos" className="relative py-20 sm:py-28" style={{ background: "var(--lp-paper)" }}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* ⚠️ `#8a6d1f` e não `--lp-gold`: no papel (#f4f1ea) o dourado claro fica em ~2,5:1.
            É a mesma escolha que o `LpEventos` já fez — dourado escurecido sobre papel. */}
        <p className="lp-eyebrow" style={{ color: "#8a6d1f" }}>Produtos</p>
        <h2 className="lp-h2 mt-5" style={{ color: "var(--lp-ink)" }}>
          O que o IRIS <span style={{ color: "#8a6d1f" }}>entrega</span>
        </h2>

        <div className="mt-12 space-y-8">
          {PRODUTOS.map((produto, i) => (
            <article
              key={produto.titulo}
              className="lp-produto grid gap-0 overflow-hidden rounded-2xl lg:grid-cols-5"
            >
              {/* A foto troca de lado entre os cartões — evita a leitura de "duas fileiras iguais". */}
              <div
                className={`relative min-h-56 lg:col-span-2 lg:min-h-full ${i % 2 === 1 ? "lg:order-2" : ""}`}
              >
                <Image
                  src={`/eventos/${produto.foto}`}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 40vw, 100vw"
                  className="object-cover"
                />
              </div>

              <div className="p-6 sm:p-8 lg:col-span-3">
                {produto.exclusivoParaAssociados ? (
                  <span className="lp-selo">Exclusivo para associados</span>
                ) : null}
                <h3
                  className="mt-3 font-semibold leading-tight"
                  style={{ color: "var(--lp-ink)", fontSize: "clamp(1.25rem, 2.2vw, 1.6rem)" }}
                >
                  {produto.titulo}
                </h3>
                <p className="mt-2 text-sm font-medium" style={{ color: "#8a6d1f" }}>
                  {produto.chamada}
                </p>
                <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--lp-muted-ink)" }}>
                  {produto.descricao}
                </p>
                <ul className="mt-5 space-y-2">
                  {produto.itens.map((item) => (
                    <li
                      key={item}
                      className="flex gap-2.5 text-sm leading-relaxed"
                      style={{ color: "var(--lp-muted-ink)" }}
                    >
                      <span aria-hidden style={{ color: "#8a6d1f" }}>
                        &#9656;
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
