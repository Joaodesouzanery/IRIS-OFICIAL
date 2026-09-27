import Image from "next/image";
import { existsSync } from "fs";
import { join } from "path";
import { AGENCIAS_FEDERAIS, SIGLAS_COM_ESTEIRA_DE_VOTOS } from "@/lib/agencias-federais";

/**
 * As 12 agências federais — cada logo linka para o site oficial.
 *
 * ⚠️ O fallback CONFERE O DISCO, não confia numa lista. `existsSync` roda no servidor, em tempo de
 * render: se a logo de uma agência não estiver em `public/agencias/`, aquele card cai num monograma
 * com a sigla — desenhado, não quebrado. Isso importa porque as logos foram baixadas do WordPress e
 * uma delas falhou na primeira tentativa: `<img>` apontando para arquivo ausente vira ícone
 * quebrado, e ícone quebrado numa página institucional é pior que não ter logo nenhuma.
 *
 * ⚠️ Fundo CLARO de propósito: as logos das agências têm fundos variados (algumas com branco
 * chapado, outras transparentes). Sobre navy, as de fundo branco viravam retângulos brancos. Card
 * claro é o tratamento que funciona para todas sem editar arquivo nenhum.
 */
function temLogo(sigla: string): boolean {
  return existsSync(join(process.cwd(), "public", "agencias", `${sigla.toLowerCase()}.png`));
}

export function LpAgencias() {
  const comVoto = new Set<string>(SIGLAS_COM_ESTEIRA_DE_VOTOS);

  return (
    <section id="agencias" className="py-20 sm:py-24" style={{ background: "var(--lp-paper)" }}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="lp-eyebrow" style={{ color: "#8a6d1f" }}>
          Agências acompanhadas
        </p>
        <h2 className="lp-h2 mt-5 max-w-2xl" style={{ color: "var(--lp-ink)" }}>
          As 12 agências reguladoras federais
        </h2>
        <p className="lp-lead mt-4 max-w-2xl" style={{ color: "var(--lp-muted-ink)" }}>
          Clique para ir ao site oficial de cada uma.
        </p>

        <ul className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {AGENCIAS_FEDERAIS.map((a) => (
            <li key={a.sigla}>
              <a
                href={a.site_oficial}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex h-full flex-col items-center gap-3 rounded-lg border bg-white p-5 text-center transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                style={{ borderColor: "rgba(28,28,33,0.10)" }}
                title={`${a.nome_completo} — ${a.setor_regulado}`}
              >
                <span className="flex h-20 w-full items-center justify-center">
                  {temLogo(a.sigla) ? (
                    <Image
                      src={`/agencias/${a.sigla.toLowerCase()}.png`}
                      alt={`Logo da ${a.sigla}`}
                      width={200}
                      height={80}
                      /* ⚠️ `h-20` + `max-w-[170px]`: os PNGs vêm do WordPress com bastante respiro interno, então
                         uma caixa de 56px deixava a marca visível em ~25px — as logos ficavam perdidas no card.
                         Medido olhando a página renderizada, não lendo o código. */
                      className="max-h-20 w-auto max-w-[170px] object-contain opacity-85 transition-opacity duration-200 group-hover:opacity-100"
                    />
                  ) : (
                    /* Monograma: some quando o arquivo chegar, sem tocar em código. */
                    <span
                      className="flex h-16 w-16 items-center justify-center rounded-full text-sm font-semibold tracking-wide"
                      style={{ background: "#0a0e2a", color: "var(--lp-gold)" }}
                      aria-hidden
                    >
                      {a.sigla.slice(0, 4)}
                    </span>
                  )}
                </span>
                <span className="text-sm font-semibold" style={{ color: "var(--lp-ink)" }}>
                  {a.sigla}
                </span>
                <span className="text-xs leading-snug" style={{ color: "var(--lp-muted-ink)" }}>
                  {a.setor_regulado}
                </span>
                {comVoto.has(a.sigla) && (
                  /* ⚠️ O selo existe para a página NÃO deixar entender que as 12 têm voto individual.
                     Sem ele, doze logos lado a lado sob o texto do Radar sugerem cobertura uniforme —
                     e a esteira de votos cobre três. */
                  <span
                    className="mt-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                    style={{ background: "rgba(194,162,74,0.16)", color: "#8a6d1f" }}
                  >
                    voto a voto
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-xs leading-relaxed" style={{ color: "var(--lp-muted-ink)" }}>
          <strong>Voto a voto</strong> indica as agências cuja esteira de votos está em operação, com
          o voto de cada diretor extraído e auditável contra o documento oficial. Nas demais, o IRIS
          faz acompanhamento regulatório e avaliação de qualidade normativa.
        </p>
      </div>
    </section>
  );
}
