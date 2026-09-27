import Image from "next/image";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { AGENCIAS_FEDERAIS, SIGLAS_COM_ESTEIRA_DE_VOTOS } from "@/lib/agencias-federais";

/**
 * As 12 agências federais numa ESTEIRA de uma linha — só a logo, clicável, sem card.
 *
 * ⚠️⚠️ O FUNDO: eu afirmei NAVY "por medição", e RENDERIZAR desmentiu. Duas vezes seguidas.
 *
 * Eu escrevi que o contraste sobre navy ficava "entre 3,9:1 e 9,1:1" e sobre o papel "entre 1,4:1 e
 * 3,4:1". Ao olhar a página renderizada, seis logos quase sumiam no navy. Fui medir de verdade, pela
 * luminância mediana dos pixels opacos de cada PNG (`public/agencias/CONTRASTE.json`, gerado do
 * próprio arquivo):
 *
 *   · sobre NAVY  → **6 de 12** abaixo de 3:1 (ANA, ANEEL, ANM, ANP, ANPD, ANTAQ). A ANPD dá 1,11:1.
 *   · sobre PAPEL → **1 de 12** (ANATEL, 1,19:1).
 *
 * E não existe fundo que sirva para as doze: varri do preto ao branco e o melhor neutro possível
 * (#a8a8a8) ainda deixa 6 abaixo de 3:1. Logo a escolha não é "qual fundo é bonito", é "qual fundo
 * erra menos" — papel, com UMA exceção.
 *
 * ⚠️ A EXCEÇÃO, com motivo: a ANATEL ganha uma pílula navy atrás da logo, porque sem ela a marca é
 * invisível. Isso desvia do "sem fundo" que o usuário pediu, e o desvio é declarado em vez de
 * silencioso. A lista sai do CONTRASTE.json, não de um nome escrito à mão: trocar um PNG e esquecer
 * de regenerar é pego pelo `etapa194`.
 *
 * ⚠️ MARQUEE EM CSS PURO. O projeto não tem framer-motion nem biblioteca de carrossel, e o
 * `etapa188` proíbe instalar uma. A rolagem é um `@keyframes` com `translateX`, e a trilha é
 * DUPLICADA para o laço não ter costura visível.
 *
 * ⚠️ A cópia duplicada leva `aria-hidden` e `tabIndex={-1}`: sem isso, o Tab percorreria 24 links
 * para 12 agências e o leitor de tela anunciaria cada nome duas vezes. Duplicar é truque visual, e
 * truque visual não pode virar conteúdo.
 *
 * ⚠️ E o fallback CONFERE O DISCO (`existsSync`), em tempo de render: logo ausente cai num monograma
 * desenhado em vez de virar ícone quebrado. As logos vieram do WordPress e uma delas falhou no
 * primeiro download — ícone quebrado numa página institucional é pior que não ter logo.
 *
 * ⚠️ O selo "voto a voto" SAIU da esteira (o pedido é logo sozinha), mas a honestidade não saiu: as
 * três agências com esteira de votos são NOMEADAS na legenda e no Radar. Doze logos em fila sem
 * ressalva sugerem cobertura uniforme, e a cobertura de voto individual é de três.
 */
function temLogo(sigla: string): boolean {
  return existsSync(join(process.cwd(), "public", "agencias", `${sigla.toLowerCase()}.png`));
}

/** O limite da WCAG para elemento gráfico não-textual. Abaixo disto a marca deixa de ser legível. */
const CONTRASTE_MINIMO = 3.0;

/**
 * As logos que somem no fundo claro, LIDAS DA MEDIÇÃO. Hoje é só a ANATEL.
 * ⚠️ Deriva do arquivo, nunca de uma lista escrita à mão: PNG trocado sem regenerar a medição vira
 * uma logo invisível que ninguém nota, e foi assim que o navy passou.
 */
type Contraste = { logos: Record<string, { contraste_no_papel: number }>; _limite_wcag: number };
const contraste: Contraste = JSON.parse(
  readFileSync(join(process.cwd(), "public", "agencias", "CONTRASTE.json"), "utf-8"),
);
function somNoClaro(sigla: string): boolean {
  const c = contraste.logos[sigla.toUpperCase()]?.contraste_no_papel;
  return typeof c === "number" && c < CONTRASTE_MINIMO;
}

function Logo({ sigla, nome, setor }: { sigla: string; nome: string; setor: string }) {
  return temLogo(sigla) ? (
    <Image
      src={`/agencias/${sigla.toLowerCase()}.png`}
      alt={`Logo da ${sigla}`}
      width={200}
      height={64}
      /* ⚠️ `max-w-[150px]`: os PNGs do WordPress têm muito respiro interno, e numa caixa menor a
         marca aparecia com ~25px. Medido olhando a página renderizada, não lendo o código. */
      className="max-h-14 w-auto max-w-[140px] object-contain"
      title={`${nome}, ${setor}`}
    />
  ) : (
    <span className="lp-esteira-monograma" aria-hidden>{sigla.slice(0, 4)}</span>
  );
}

/** Uma passada da trilha. `espelho` marca a cópia que existe só para o laço não ter costura. */
function Trilha({ espelho = false }: { espelho?: boolean }) {
  return (
    <ul className="lp-esteira-trilha" {...(espelho ? { "aria-hidden": true } : {})}>
      {AGENCIAS_FEDERAIS.map((a) => (
        <li key={`${espelho ? "m-" : ""}${a.sigla}`}>
          <a
            href={a.site_oficial}
            target="_blank"
            rel="noopener noreferrer"
            className={somNoClaro(a.sigla) ? "lp-esteira-link lp-esteira-link--pilula" : "lp-esteira-link"}
            {...(espelho ? { tabIndex: -1 } : { "aria-label": `${a.nome_completo}, abrir o site oficial` })}
          >
            <Logo sigla={a.sigla} nome={a.nome_completo} setor={a.setor_regulado} />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function LpAgencias() {
  const comVoto = [...SIGLAS_COM_ESTEIRA_DE_VOTOS].join(", ");

  return (
    <section id="agencias" className="py-16 sm:py-20" style={{ background: "var(--lp-paper)" }}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="lp-eyebrow" style={{ color: "#8a6d1f" }}>Agências acompanhadas</p>
        <h2 className="lp-h2 mt-5 max-w-2xl" style={{ color: "var(--lp-ink)" }}>
          As 12 agências reguladoras federais
        </h2>
        <p className="lp-lead mt-4 max-w-2xl" style={{ color: "var(--lp-muted-ink)" }}>
          Clique na logo para ir ao site oficial.
        </p>
      </div>

      {/* A esteira sangra até as bordas de propósito: é o que faz a fila parecer contínua. */}
      <div className="lp-esteira mt-10">
        <Trilha />
        <Trilha espelho />
      </div>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="mt-8 text-xs leading-relaxed" style={{ color: "var(--lp-muted-ink)" }}>
          A esteira de votos, que extrai o voto de cada diretor e o deixa auditável contra o documento
          oficial, está em operação em{" "}
          <strong style={{ color: "var(--lp-ink)" }}>{comVoto}</strong>. Nas demais, o IRIS faz
          acompanhamento regulatório e avaliação de qualidade normativa.
        </p>
      </div>
    </section>
  );
}
