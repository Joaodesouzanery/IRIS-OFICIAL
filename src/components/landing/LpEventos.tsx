import Image from "next/image";
import { existsSync } from "fs";
import { join } from "path";
import { CalendarDays, ArrowUpRight } from "lucide-react";
import { unstable_cache } from "next/cache";
import { fetchIrisEventos, type IrisEvento } from "@/lib/server/iris-eventos";
import { CANAIS } from "@/lib/landing-content";

/**
 * Eventos — lidos AO VIVO do calendário do próprio IRIS.
 *
 * ⚠️ Reusa `fetchIrisEventos`, que JÁ EXISTE (`src/lib/server/iris-eventos.ts`) e alimenta a
 * newsletter desde a Fase 12: faz parse do JSON-LD `Event` de irisregulacao.org/eventos/, filtra os
 * futuros e ordena. Reescrever um parser próprio aqui criaria duas leituras do mesmo calendário,
 * que divergiriam no primeiro evento cadastrado de um jeito diferente.
 *
 * ⚠️ E ele degrada para `[]` em qualquer falha — por desenho. Então a seção precisa saber a
 * diferença entre "não há eventos futuros" e "não consegui ler o calendário", e NÃO pode sumir em
 * silêncio: quando a lista vem vazia, mostra o convite para o calendário completo em vez de deixar
 * um buraco onde o leitor conclui que o Instituto não faz eventos.
 *
 * ⚠️ As FOTOS dos eventos ainda não existem (estão no deck institucional, que não está em disco).
 * Até chegarem em `public/eventos/<slug>.jpg`, cada card usa um placeholder desenhado — com o nome
 * e a data REAIS, que é o que o usuário pediu. `existsSync` confere o disco, então basta soltar os
 * arquivos lá que eles aparecem, sem tocar em código.
 */
function slugDoEvento(e: IrisEvento): string {
  return e.titulo
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function dataLonga(iso: string): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${String(dia).padStart(2, "0")} ${MESES[(mes ?? 1) - 1]} ${ano}`;
}

/**
 * ⚠️ O cache é EXPLÍCITO, e sem ele a landing inteira vira dinâmica.
 *
 * O Next 15 mudou o default do `fetch`: antes era `force-cache`, agora é `no-store`. Como
 * `resilientFetchText` não passa `cache`, cada visita à landing refazia a busca ao
 * irisregulacao.org — com timeout de 15s no caminho crítico de uma página pública. O build
 * confirmou: `/` saía como `ƒ (Dynamic)`.
 *
 * ⚠️ E o cache fica AQUI, não dentro de `resilientFetchText`: aquele helper é compartilhado com a
 * newsletter e com os coletores, que querem dado fresco. Cachear na origem serviria à landing e
 * mudaria o comportamento de quem não pediu.
 */
const eventosEmCache = unstable_cache(
  async () => fetchIrisEventos(6),
  ["landing-eventos-iris"],
  { revalidate: 3600, tags: ["iris-eventos"] },
);

export async function LpEventos() {
  const eventos = await eventosEmCache();

  return (
    <section id="eventos" className="py-20 sm:py-24" style={{ background: "var(--lp-paper)" }}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="lp-eyebrow" style={{ color: "#8a6d1f" }}>
              Agenda
            </p>
            <h2 className="lp-h2 mt-5 max-w-2xl" style={{ color: "var(--lp-ink)" }}>
              Painéis, fóruns e seminários
            </h2>
          </div>
          <a
            href={CANAIS.eventos}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium"
            style={{ color: "#8a6d1f" }}
          >
            Calendário completo
            <ArrowUpRight className="h-4 w-4" />
          </a>
        </div>

        {eventos.length === 0 ? (
          /* ⚠️ O vazio NÃO é um buraco. `fetchIrisEventos` devolve [] tanto quando não há evento
             futuro quanto quando o calendário não pôde ser lido — e das duas, sumir com a seção
             faria o leitor concluir que o Instituto não promove eventos. */
          <div
            className="mt-10 rounded-lg border p-8 text-center"
            style={{ borderColor: "rgba(28,28,33,0.12)", background: "#fff" }}
          >
            <CalendarDays className="mx-auto h-6 w-6" style={{ color: "#8a6d1f" }} />
            <p className="mt-3 text-sm" style={{ color: "var(--lp-muted-ink)" }}>
              A agenda dos próximos eventos está no calendário do IRIS.
            </p>
            <a
              href={CANAIS.eventos}
              target="_blank"
              rel="noopener noreferrer"
              className="lp-btn-gold mt-5"
            >
              Ver o calendário
            </a>
          </div>
        ) : (
          <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {eventos.map((e) => {
              const slug = slugDoEvento(e);
              const foto = existsSync(join(process.cwd(), "public", "eventos", `${slug}.jpg`))
                ? `/eventos/${slug}.jpg`
                : null;
              return (
                <li key={e.url || slug}>
                  <a
                    href={e.url || CANAIS.eventos}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex h-full flex-col overflow-hidden rounded-lg border bg-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                    style={{ borderColor: "rgba(28,28,33,0.10)" }}
                  >
                    <span className="relative block aspect-[16/9] overflow-hidden" style={{ background: "var(--lp-navy)" }}>
                      {foto ? (
                        <Image
                          src={foto}
                          alt=""
                          fill
                          sizes="(max-width: 640px) 100vw, 33vw"
                          className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                        />
                      ) : (
                        /* O placeholder: marca d'água dourada com a data. Some sozinho quando o
                           arquivo da foto aparecer em public/eventos/. */
                        <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
                          <span
                            className="absolute inset-0"
                            style={{
                              background:
                                "radial-gradient(120% 100% at 15% 0%, rgba(194,162,74,0.22), transparent 62%)",
                            }}
                          />
                          <span
                            className="relative font-mono text-xs uppercase tracking-[0.3em]"
                            style={{ color: "var(--lp-gold)" }}
                          >
                            IRIS
                          </span>
                        </span>
                      )}
                    </span>
                    <span className="flex flex-1 flex-col p-5">
                      <span
                        className="font-mono text-[11px] uppercase tracking-[0.16em]"
                        style={{ color: "#8a6d1f" }}
                      >
                        {dataLonga(e.data)}
                      </span>
                      <span
                        className="mt-2 text-base font-semibold leading-snug"
                        style={{ color: "var(--lp-ink)" }}
                      >
                        {e.titulo}
                      </span>
                      {e.local && (
                        <span className="mt-2 text-xs" style={{ color: "var(--lp-muted-ink)" }}>
                          {e.local}
                        </span>
                      )}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
