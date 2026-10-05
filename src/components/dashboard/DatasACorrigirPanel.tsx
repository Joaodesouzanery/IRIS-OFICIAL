"use client";

/**
 * DATAS A CORRIGIR — Medir → Aplicar (Fase 39).
 *
 * Decisão do usuário: nenhuma correção de data grava sozinha. Cada janela mede (de/para, fonte,
 * recusas e o portão contra o gabarito); o usuário confere a amostra contra o PDF/site e clica
 * Aplicar. Aplicar guarda a data antiga em `raw_extraction.data_anterior`, alinha os filhos e apaga a
 * reunião que ficou sem nenhuma deliberação.
 */

import { useRef, useState } from "react";
import { api } from "@/lib/api";

type Janela = "referencia" | "ata_anm" | "voto_antt";

type Proposta = { id: string; agencia: string; numero_reuniao: string | null; de: string | null; para: string; fonte: string };
type Portao = { aprovado: boolean; conferidas: number; batem: number; divergem: Array<{ reuniao: string; no_gabarito: string; na_listagem: string | null }>; motivo: string };

type Resposta = {
  janela: Janela | null;
  propostas_total: number;
  propostas: Proposta[];
  ja_certas: number;
  recusas: Record<string, number>;
  portoes: Record<string, Portao>;
  barradas_pelo_portao: Proposta[];
  leitura_completa?: boolean;
  aplicadas?: number;
  filhos_alinhados?: number;
  falhas?: number;
  restantes?: number;
  reunioes_orfas_removidas?: number;
  erro?: string;
};

const JANELAS: Array<{ id: Janela; titulo: string; explica: string }> = [
  {
    id: "referencia",
    titulo: "Reuniões pela listagem do site (ANTT e ARTESP)",
    explica: "A data que o site dá para a reunião. Só vale para a agência cuja listagem reproduz as atas do gabarito, e só quando a data fica entre as das reuniões vizinhas da série.",
  },
  {
    id: "ata_anm",
    titulo: "Atas da ANM pelo preâmbulo",
    explica: "A data por extenso da abertura da ata («Aos vinte e oito … de janeiro …»). Só vale se a regra reproduz a 79ª, a 81ª e a 83ª do gabarito. Os itens da ata seguem a mãe.",
  },
  {
    id: "voto_antt",
    titulo: "Votos individuais da ANTT pela assinatura",
    explica: "O fecho «Brasília, dd de mês» ou a assinatura SEI do diretor — nunca a primeira data do texto. Só vale se o signatário tinha mandato na data proposta.",
  },
];

const TETO_CHAMADAS = 20;
const motivoDoPortao: Record<string, string> = {
  aprovado: "aprovado",
  listagem_vazia: "sem referência gravada (rode o Rodar Tudo)",
  sem_ata_para_conferir: "sem ata do gabarito para conferir",
  divergencia: "NÃO reproduz o gabarito",
};

export function DatasACorrigirPanel({ demoEnabled }: { demoEnabled: boolean }) {
  const [rodando, setRodando] = useState<Janela | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [medidas, setMedidas] = useState<Partial<Record<Janela, Resposta>>>({});
  const [aplicado, setAplicado] = useState<Partial<Record<Janela, string>>>({});
  const parar = useRef(false);

  async function medir(janela: Janela) {
    if (rodando || demoEnabled) return;
    setErro(null);
    setRodando(janela);
    try {
      const r = await api.post<Resposta>("/admin/deliberacoes/datas-a-corrigir", { janela, dry_run: true });
      setMedidas((m) => ({ ...m, [janela]: r }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao medir.");
    } finally {
      setRodando(null);
    }
  }

  async function aplicar(janela: Janela) {
    const m = medidas[janela];
    if (!m || rodando || demoEnabled) return;
    const ok = typeof window !== "undefined" && window.confirm(
      `Aplicar ${m.propostas_total} correção(ões) de data («${JANELAS.find((j) => j.id === janela)?.titulo}»)?\n\n` +
      "A data antiga fica guardada em cada linha (raw_extraction.data_anterior). Os itens da ata seguem a mãe. " +
      "Os votos NÃO mudam aqui — o revoto vem depois, simulado contra o gabarito.\n\n" +
      "Confirme que conferiu a amostra contra o site/PDF.",
    );
    if (!ok) return;
    parar.current = false;
    setErro(null);
    setRodando(janela);
    let total = 0; let filhos = 0; let orfas = 0; let falhas = 0;
    try {
      for (let i = 0; i < TETO_CHAMADAS && !parar.current; i += 1) {
        const r = await api.post<Resposta>("/admin/deliberacoes/datas-a-corrigir", { janela, dry_run: false });
        total += r.aplicadas ?? 0; filhos += r.filhos_alinhados ?? 0; orfas += r.reunioes_orfas_removidas ?? 0; falhas += r.falhas ?? 0;
        setAplicado((a) => ({ ...a, [janela]: `${total} corrigida(s) · ${filhos} item(ns) da ata alinhado(s) · ${orfas} reunião(ões) órfã(s) removida(s)${falhas ? ` · ${falhas} falha(s)` : ""}…` }));
        // Cada chamada recalcula o plano: o que já foi gravado vira "já certa". Para quando não
        // sobra nada por orçamento, ou quando a rodada não conseguiu gravar nada (não gira em vão).
        if (!(r.restantes ?? 0) || (r.aplicadas ?? 0) === 0) break;
      }
      setAplicado((a) => ({ ...a, [janela]: `${total} corrigida(s) · ${filhos} item(ns) da ata alinhado(s) · ${orfas} reunião(ões) órfã(s) removida(s)${falhas ? ` · ${falhas} falha(s)` : ""}. Meça de novo para conferir.` }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao aplicar.");
    } finally {
      setRodando(null);
    }
  }

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Datas a corrigir — medir, conferir, aplicar</h2>
        <p className="text-xs text-text-muted mt-1 max-w-3xl">
          Data errada tira a reunião do ano e põe no colegiado errado quem votou. Medir não grava nada.
          Aplicar só grava o que passou no portão (a fonte reproduz as atas conferidas à mão), e guarda
          a data antiga em cada linha.
        </p>
      </div>
      {erro ? <p className="text-xs text-error">{erro}</p> : null}

      <div className="space-y-2">
        {JANELAS.map((j) => {
          const m = medidas[j.id];
          return (
            <div key={j.id} className="rounded-md border border-border p-3 text-xs space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="max-w-2xl">
                  <p className="font-semibold text-text-primary">{j.titulo}</p>
                  <p className="text-text-muted">{j.explica}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary text-xs" disabled={Boolean(rodando) || demoEnabled} onClick={() => medir(j.id)}>
                    {rodando === j.id ? "…" : "Medir"}
                  </button>
                  {m && m.propostas_total > 0 ? (
                    <button type="button" className="btn-primary text-xs" disabled={Boolean(rodando) || demoEnabled} onClick={() => aplicar(j.id)}>
                      Aplicar {m.propostas_total}
                    </button>
                  ) : null}
                  {rodando === j.id ? (
                    <button type="button" className="btn-secondary text-xs" onClick={() => { parar.current = true; }}>Parar</button>
                  ) : null}
                </div>
              </div>

              {m ? (
                <>
                  {m.leitura_completa === false ? (
                    <p className="text-warning">⚠️ Leitura incompleta — o número subconta e Aplicar recusa até a leitura fechar.</p>
                  ) : null}
                  <p className="tabular-nums">
                    <strong>{m.propostas_total}</strong> a corrigir · {m.ja_certas} já certa(s)
                    {Object.keys(m.recusas).length
                      ? ` · recusadas: ${Object.entries(m.recusas).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ")}`
                      : ""}
                  </p>
                  {Object.entries(m.portoes).map(([sigla, p]) => (
                    <p key={sigla} className={p.aprovado ? "text-success" : "text-warning"}>
                      Portão {sigla}: {motivoDoPortao[p.motivo] ?? p.motivo}
                      {p.conferidas ? ` — ${p.batem} de ${p.conferidas} ata(s) do gabarito` : ""}
                      {p.divergem.length ? ` (${p.divergem.map((d) => `${d.reuniao}: gabarito ${d.no_gabarito}, fonte ${d.na_listagem ?? "nenhuma"}`).join("; ")})` : ""}
                    </p>
                  ))}
                  {m.propostas.length ? (
                    <details>
                      <summary className="cursor-pointer">Conferir o de/para ({m.propostas.length}{m.propostas_total > m.propostas.length ? ` de ${m.propostas_total}` : ""})</summary>
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead><tr className="text-left text-text-muted"><th className="py-1 pr-2">Reunião</th><th className="py-1 pr-2">De</th><th className="py-1 pr-2">Para</th><th className="py-1">Fonte</th></tr></thead>
                          <tbody>
                            {m.propostas.map((p) => (
                              <tr key={p.id} className="border-t border-border">
                                <td className="py-1 pr-2 whitespace-nowrap">{p.agencia} {p.numero_reuniao ? `${p.numero_reuniao}ª` : "(voto avulso)"}</td>
                                <td className="py-1 pr-2 tabular-nums whitespace-nowrap">{p.de ?? "—"}</td>
                                <td className="py-1 pr-2 tabular-nums whitespace-nowrap font-semibold">{p.para}</td>
                                <td className="py-1">{p.fonte}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  ) : null}
                  {m.barradas_pelo_portao.length ? (
                    <details>
                      <summary className="cursor-pointer text-warning">O portão barrou {m.barradas_pelo_portao.length}{m.barradas_pelo_portao.length >= 30 ? "+" : ""} — o que ficaria de fora</summary>
                      <ul className="mt-1 space-y-0.5">
                        {m.barradas_pelo_portao.map((p) => (
                          <li key={p.id}>{p.agencia} {p.numero_reuniao ?? "?"}ª: {p.de ?? "—"} → {p.para}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </>
              ) : null}
              {aplicado[j.id] ? <p className="text-text-primary">{aplicado[j.id]}</p> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
