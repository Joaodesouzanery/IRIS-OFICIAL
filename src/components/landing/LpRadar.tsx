import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { ETAPAS_DO_RADAR, BENEFICIOS_DO_RADAR, METODO_DO_RADAR } from "@/lib/landing-content";

/**
 * O Radar Regulatório, o nome público do Observatório da Regulação.
 *
 * ═══ O que mudou nesta versão, e por quê ═══
 * A versão anterior tinha quatro cartões em grade de 2×2 e nada mais. Três problemas:
 *  1. **Grade não é sequência.** As quatro etapas dependem uma da outra, e uma grade 2×2 faz a 03
 *     parecer irmã da 01, não consequência dela. Agora é uma TRILHA vertical, com um filete ligando
 *     os marcadores: o layout passa a dizer a mesma coisa que a numeração.
 *  2. **Não respondia "e daí?".** As etapas dizem o que o sistema FAZ; nenhuma dizia o que o leitor
 *     GANHA. Entrou um bloco de seis benefícios concretos, e nenhum promete o que não existe.
 *  3. **Faltava o método.** Um comprador técnico pergunta primeiro o que acontece quando a leitura
 *     falha. O bloco de método responde, e é um compromisso: se ele mudar, o sistema mudou.
 *
 * ⚠️ E o texto foi reescrito SEM TRAVESSÃO, a pedido do usuário. A verificação é do `etapa194`, que
 * varre o conteúdo visível da LP inteira, não só o Radar, porque meia página sem travessão e meia
 * com fica pior que nenhuma.
 *
 * ⚠️ A etapa 03 continua NOMEANDO ANTT, ANM e ARTESP. Numa página que mostra 12 logos, o silêncio
 * sobre a cobertura não seria neutro, seria uma afirmação: doze logos em fila sugerem cobertura
 * uniforme, e a esteira de votos cobre três.
 */
export function LpRadar() {
  return (
    <section id="radar" className="py-20 sm:py-28" style={{ background: "var(--lp-navy-2)" }}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="lp-eyebrow">Radar Regulatório</p>
        <h2 className="lp-h2 mt-5 max-w-3xl text-white">
          Da publicação oficial até{" "}
          <span style={{ color: "var(--lp-gold)" }}>o voto de cada diretor</span>
        </h2>
        <p className="lp-lead mt-5 max-w-2xl" style={{ color: "var(--lp-muted)" }}>
          O Radar acompanha as decisões das agências reguladoras e as transforma em dado auditável,
          com a evidência sempre a um clique do documento que a originou.
        </p>

        {/* ── A TRILHA: quatro etapas em sequência, porque uma depende da anterior ───────────── */}
        <ol className="lp-trilha mt-14">
          {ETAPAS_DO_RADAR.map((etapa) => (
            <li key={etapa.numero} className="lp-trilha-item">
              <span className="lp-trilha-marcador" aria-hidden>{etapa.numero}</span>
              <div className="lp-trilha-corpo">
                <h3 className="text-lg font-semibold text-white">{etapa.titulo}</h3>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--lp-muted)" }}>
                  {etapa.texto}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* ── O QUE VOCÊ GANHA: fundo mais claro para separar "o que faz" de "para que serve" ──── */}
      <div className="mt-20 py-16 sm:py-20" style={{ background: "var(--lp-navy-3)" }}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="lp-eyebrow">O que você ganha</p>
          <h2 className="lp-h2 mt-5 max-w-2xl text-white">
            Seis coisas que a plataforma entrega
          </h2>
          <ul className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFICIOS_DO_RADAR.map((b) => (
              <li key={b.titulo} className="lp-beneficio">
                <h3 className="text-base font-semibold text-white">{b.titulo}</h3>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--lp-muted)" }}>
                  {b.texto}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── O MÉTODO: a pergunta que um comprador técnico faz primeiro ───────────────────────── */}
      <div className="mx-auto mt-20 max-w-6xl px-4 sm:px-6">
        <div className="lp-card">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 flex-none" style={{ color: "var(--lp-gold)" }} aria-hidden />
            <h3 className="text-base font-semibold text-white">
              O que acontece quando a leitura falha
            </h3>
          </div>
          <ul className="mt-5 space-y-4">
            {METODO_DO_RADAR.map((linha) => (
              <li key={linha.slice(0, 32)} className="flex gap-3 text-sm leading-relaxed">
                <span className="lp-bolinha" aria-hidden />
                <span style={{ color: "var(--lp-muted)" }}>{linha}</span>
              </li>
            ))}
          </ul>
        </div>

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
