"use client";

/**
 * O LIVRO-RAZÃO 2026 — o critério de "pronto" (Fase 38).
 *
 * Uma linha por reunião do ano, seis portões (listada · data · itens · campos · colegiado · votos).
 * A agência está pronta com ≥95% das reuniões prontas E nenhuma aberta por trabalho nosso — o que
 * sobra tem de ter bloqueio NOMEADO de dado externo.
 *
 * ⚠️ O denominador é a REFERÊNCIA do site, gravada pela "Conferir ao vivo". Sem ela, o painel diz
 * "referência indisponível" em vermelho — nunca "0 de 0".
 */

import { useState } from "react";
import { api } from "@/lib/api";

type Portao = "listada" | "data" | "itens" | "campos" | "colegiado" | "votos";

type Veredito = { portao: Portao; estado: "verde" | "vermelho" | "sem_medida"; motivo: string | null; dono: "nosso" | "externo" | null };

type Linha = {
  agencia: string;
  serie: string | null;
  numero: number;
  data_reuniao: string | null;
  pertenca: "sim" | "nao" | "incerto";
  portoes: Veredito[];
  primeiro_portao_aberto: Portao | null;
  bloqueio_externo: boolean;
};

type Resumo = {
  total: number;
  prontas: number;
  pct: number;
  abertas_por_portao: Record<Portao, number>;
  bloqueio_externo: number;
  trabalho_nosso: number;
  referencia: { disponivel: boolean; nunca_tentada?: boolean; ultima_boa_em: string | null; desatualizada: boolean; motivo: string | null };
  pronto: boolean;
};

type RespostaPlacar = {
  livro_razao?: {
    meta_pct: number;
    portoes: Portao[];
    por_agencia: Record<string, Resumo>;
    abertas: Linha[];
    abertas_total?: number;
  };
  leitura_completa?: boolean;
};

const ROTULO: Record<Portao, string> = {
  listada: "1 · listada",
  data: "2 · data",
  itens: "3 · itens",
  campos: "4 · campos",
  colegiado: "5 · colegiado",
  votos: "6 · votos",
};

const SERIE_CURTA: Record<string, string> = {
  ordinaria: "ord.", extraordinaria: "extra.", eletronica: "eletr.", administrativa: "adm.",
};

export function LivroRazaoPanel({ demoEnabled }: { demoEnabled: boolean }) {
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [dados, setDados] = useState<RespostaPlacar | null>(null);
  const [filtro, setFiltro] = useState<string>("todas");

  async function abrir() {
    if (carregando || demoEnabled) return;
    setErro(null);
    setCarregando(true);
    try {
      setDados(await api.get<RespostaPlacar>("/admin/placar?year=2026"));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao montar o livro-razão.");
    } finally {
      setCarregando(false);
    }
  }

  const livro = dados?.livro_razao;
  const abertas = (livro?.abertas ?? []).filter((l) => filtro === "todas" || l.agencia === filtro);

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Livro-razão 2026 — quando está pronto</h2>
          <p className="text-xs text-text-muted mt-1 max-w-3xl">
            Cada reunião que o site publica passa por seis portões. Pronta = os seis verdes. A meta é
            {" "}{livro?.meta_pct ?? 95}% das reuniões prontas e todas as outras com um bloqueio externo
            nomeado (site fora do ar, PDF ilegível, ata não publicada, mandato sem DOU). A referência vem
            da &ldquo;Conferir ao vivo&rdquo; — rode-a antes se ela estiver desatualizada.
          </p>
        </div>
        <button type="button" className="btn-secondary text-xs" disabled={carregando || demoEnabled} onClick={abrir}>
          {carregando ? "Montando…" : dados ? "Atualizar" : "Abrir o livro-razão"}
        </button>
      </div>
      {erro ? <p className="text-xs text-error">{erro}</p> : null}
      {dados && dados.leitura_completa === false ? (
        <p className="text-xs text-warning">⚠️ O acervo foi lido de forma INCOMPLETA — os números abaixo subcontam.</p>
      ) : null}

      {livro ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            {Object.entries(livro.por_agencia).map(([sigla, r]) => (
              <div key={sigla} className="rounded-md border border-border p-3 text-xs space-y-1">
                <p className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-text-primary">{sigla}</span>
                  <span className={r.pronto ? "text-success font-semibold" : "text-text-muted"}>
                    {r.pronto ? "PRONTO" : r.referencia.disponivel ? `${r.pct}%` : r.referencia.nunca_tentada ? "referência pendente" : "sem referência"}
                  </span>
                </p>
                {r.referencia.disponivel ? (
                  <>
                    <p className="tabular-nums">
                      <strong>{r.prontas}</strong> de <strong>{r.total}</strong> reuniões prontas
                    </p>
                    <p className="text-text-muted tabular-nums">
                      {r.trabalho_nosso} com trabalho nosso · {r.bloqueio_externo} com bloqueio externo
                    </p>
                    <p className="text-text-muted">
                      Parada em:{" "}
                      {(Object.entries(r.abertas_por_portao) as Array<[Portao, number]>)
                        .filter(([, n]) => n > 0)
                        .map(([p, n]) => `${ROTULO[p]} (${n})`)
                        .join(" · ") || "—"}
                    </p>
                    <p className={r.referencia.desatualizada ? "text-warning" : "text-text-muted"}>
                      Referência de {r.referencia.ultima_boa_em ? r.referencia.ultima_boa_em.slice(0, 10) : "?"}
                      {r.referencia.desatualizada ? " — DESATUALIZADA" : ""}
                      {r.referencia.motivo && !r.referencia.desatualizada ? ` (${r.referencia.motivo})` : ""}
                    </p>
                  </>
                ) : (
                  r.referencia.nunca_tentada ? (
                    <p className="text-warning">
                      Referência pendente: {r.referencia.motivo}. Rode o Rodar Tudo (ou &ldquo;Conferir ao vivo&rdquo;) — até
                      lá nenhuma reunião conta como pronta. {r.total} reunião(ões) no banco esperando o denominador.
                    </p>
                  ) : (
                    <p className="text-error">Referência do site indisponível: {r.referencia.motivo}</p>
                  )
                )}
              </div>
            ))}
          </div>

          {(livro.abertas_total ?? abertas.length) > 0 ? (
            <details>
              <summary className="cursor-pointer text-xs">
                Reuniões abertas ({livro.abertas_total ?? livro.abertas.length}
                {livro.abertas_total && livro.abertas_total > livro.abertas.length ? `, mostrando ${livro.abertas.length}` : ""})
                — o primeiro portão aberto é por onde se começa
              </summary>
              <div className="mt-2 flex flex-wrap gap-1 text-xs">
                {["todas", ...Object.keys(livro.por_agencia)].map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={filtro === f ? "btn-primary text-xs" : "btn-secondary text-xs"}
                    onClick={() => setFiltro(f)}
                  >
                    {f === "todas" ? "Todas" : f}
                  </button>
                ))}
              </div>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-text-muted">
                      <th className="py-1 pr-2">Reunião</th>
                      <th className="py-1 pr-2">Data</th>
                      <th className="py-1 pr-2">Portões</th>
                      <th className="py-1">Primeiro aberto — motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {abertas.map((l) => {
                      const aberto = l.portoes.find((p) => p.portao === l.primeiro_portao_aberto);
                      return (
                        <tr key={`${l.agencia}-${l.serie}-${l.numero}`} className="border-t border-border align-top">
                          <td className="py-1 pr-2 whitespace-nowrap">
                            {l.agencia} {l.numero}ª {l.serie ? SERIE_CURTA[l.serie] ?? l.serie : ""}
                            {l.pertenca === "incerto" ? <span className="text-warning"> (ano incerto)</span> : null}
                          </td>
                          <td className="py-1 pr-2 whitespace-nowrap tabular-nums">{l.data_reuniao ?? "—"}</td>
                          <td className="py-1 pr-2 whitespace-nowrap font-mono" aria-label="estado dos seis portões">
                            {l.portoes.map((p) => (
                              <span
                                key={p.portao}
                                title={`${ROTULO[p.portao]}: ${p.estado}${p.motivo ? ` — ${p.motivo}` : ""}`}
                                className={p.estado === "verde" ? "text-success" : p.estado === "vermelho" ? "text-error" : "text-text-muted"}
                              >
                                {p.estado === "verde" ? "●" : p.estado === "vermelho" ? "✕" : "○"}
                              </span>
                            ))}
                          </td>
                          <td className="py-1">
                            <span className="font-semibold">{aberto ? ROTULO[aberto.portao] : "—"}</span>
                            {aberto?.dono === "externo" ? <span className="text-text-muted"> [externo]</span> : null}
                            {aberto?.motivo ? ` — ${aberto.motivo}` : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-text-muted">● verde · ✕ vermelho · ○ sem medida (depende de um portão anterior ou falta a contagem na fonte). Passe o mouse para o motivo de cada portão.</p>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
