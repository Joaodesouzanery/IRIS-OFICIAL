"use client";

/**
 * Etapa 64 — SAÚDE DOS DADOS.
 *
 * Todo painel do IRIS mostra o que a base SABE. Este mostra o que ela NÃO sabe: quanto do
 * denominador é decisão de mérito, quanto do consenso tem base nominal, e onde o limite é da FONTE
 * (a agência não nomina voto) em vez de falha da extração.
 *
 * A distinção importa: um diretor sem base nominal na ANTT não é lacuna do sistema — é o formato da
 * ata daquela agência. Confundir os dois faz o operador caçar um defeito que não existe, e ignorar
 * os que existem.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn, formatNumber } from "@/lib/utils";
import { Database, ShieldCheck, AlertTriangle, FileWarning, Scale, BookOpen } from "lucide-react";

type AgenciaGov = {
  agencia_id: string | null;
  sigla: string;
  nome: string;
  total: number;
  total_decidido: number;
  total_admissibilidade: number;
  total_retirado: number;
  total_sem_resultado: number;
  total_com_voto: number;
  consenso: number | null;
  cobertura_nominal: number;
  deferimento: number;
};

type SaudeDados = {
  totais?: {
    deliberacoes: number;
    deliberacoes_com_voto: number;
    deliberacoes_sem_voto: number;
    votos: number;
    votos_nominais: number;
    votos_inferidos: number;
    pct_nominal: number;
  };
  diretores_sem_mandato?: Array<{ diretor_id: string; nome: string; agencia_sigla: string | null }>;
  alertas?: string[];
};

/** O limite é da FONTE, não do sistema — e a frase precisa dizer isso. */
const LIMITE_DA_FONTE: Record<string, string> = {
  ANTT: "A ata da ANTT não nomina voto por diretor; os nominais vêm dos documentos de Voto, ingeridos à parte.",
  ARTESP: "A deliberação da ARTESP registra “aprovação dos presentes por unanimidade”, sem nomear votos.",
  ANM: "A ata da ANM nomina voto apenas em dissenso, vista, impedimento ou empate.",
};

function pctClass(v: number, bom: number, ruim: number) {
  if (v >= bom) return "text-success";
  if (v <= ruim) return "text-error";
  return "text-warning";
}

export default function SaudeDadosPage() {
  const { data: agencias, isLoading: loadingAg } = useQuery({
    queryKey: ["governanca-agencias-saude"],
    queryFn: () => api.get<AgenciaGov[]>("/dashboard/governanca-agencias"),
  });
  const { data: saude, isLoading: loadingSaude } = useQuery({
    queryKey: ["admin-saude-dados"],
    queryFn: () => api.get<SaudeDados>("/admin/saude-dados"),
  });

  const linhas = agencias ?? [];
  const totalPautado = linhas.reduce((s, a) => s + a.total, 0);
  const totalDecidido = linhas.reduce((s, a) => s + (a.total_decidido ?? 0), 0);
  const totalAdmis = linhas.reduce((s, a) => s + (a.total_admissibilidade ?? 0), 0);
  const totalRetirado = linhas.reduce((s, a) => s + (a.total_retirado ?? 0), 0);
  const totalSemRes = linhas.reduce((s, a) => s + (a.total_sem_resultado ?? 0), 0);
  const totalComVoto = linhas.reduce((s, a) => s + (a.total_com_voto ?? 0), 0);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-brand" />
          Saúde dos dados
        </h1>
        <p className="text-sm text-text-secondary max-w-3xl">
          Os outros painéis mostram o que a base sabe. Este mostra <strong>sobre o que</strong> cada
          número é calculado — e onde o limite é da fonte, não da extração.
        </p>
        <a
          href="https://github.com/Joaodesouzanery/IRIS-OFICIAL/blob/main/docs/METODOLOGIA-METRICAS.md"
          target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline font-mono"
        >
          <BookOpen className="w-3.5 h-3.5" />
          Metodologia das métricas
        </a>
      </header>

      {/* ─── Denominadores ─────────────────────────────────────────────── */}
      <section className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Scale className="w-4 h-4 text-brand" />
          Denominadores: pautado × decidido
        </h2>
        <p className="text-xs text-text-secondary max-w-3xl">
          A taxa de deferimento divide pelos itens <strong>julgados no mérito</strong>. Itens
          retirados de pauta, sem resultado extraído e de <strong>admissibilidade</strong> (não
          conhecidos) saem do divisor — eles nunca foram julgados, e contá-los puxava a taxa para
          baixo como se fossem indeferimentos.
        </p>

        {loadingAg ? (
          <p className="text-sm text-text-muted">Carregando…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: "Pautado", valor: totalPautado, hint: "tudo que entrou em pauta" },
                { label: "Decidido", valor: totalDecidido, hint: "julgado no mérito", destaque: true },
                { label: "Admissibilidade", valor: totalAdmis, hint: "não conhecido" },
                { label: "Retirado", valor: totalRetirado, hint: "saiu de pauta" },
                { label: "Sem resultado", valor: totalSemRes, hint: "nada extraído" },
              ].map((k) => (
                <div key={k.label} className={cn("rounded-lg p-3 border", k.destaque ? "border-brand/40 bg-brand/5" : "border-border bg-bg-hover/40")}>
                  <p className="text-[10px] uppercase tracking-wider text-text-label font-mono">{k.label}</p>
                  <p className="text-xl font-mono font-bold tabular-nums">{formatNumber(k.valor)}</p>
                  <p className="text-[10px] text-text-muted mt-0.5">{k.hint}</p>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-text-label font-mono border-b border-border">
                    <th className="text-left py-2">Agência</th>
                    <th className="text-right py-2">Pautado</th>
                    <th className="text-right py-2">Decidido</th>
                    <th className="text-right py-2">Com voto</th>
                    <th className="text-right py-2">Consenso</th>
                    <th className="text-right py-2">Cobertura nominal</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {linhas.map((a) => (
                    <tr key={a.agencia_id ?? a.sigla} className="border-b border-border/50">
                      <td className="py-2 font-mono font-semibold">{a.sigla}</td>
                      <td className="text-right">{formatNumber(a.total)}</td>
                      <td className="text-right text-brand font-semibold">{formatNumber(a.total_decidido ?? 0)}</td>
                      <td className="text-right">{formatNumber(a.total_com_voto ?? 0)}</td>
                      <td className={cn("text-right font-mono", (a.total_com_voto ?? 0) === 0 ? "text-text-muted" : "")}>
                        {a.consenso === null ? "—" : `${a.consenso}%`}
                      </td>
                      <td className={cn("text-right font-mono", pctClass(a.cobertura_nominal, 60, 20))}>
                        {a.cobertura_nominal}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalComVoto === 0 && linhas.length > 0 && (
              <p className="text-xs text-warning">
                Nenhuma deliberação com voto registrado: as taxas de consenso aparecem como “—”
                porque não há base — e não porque houve concordância.
              </p>
            )}
          </>
        )}
      </section>

      {/* ─── Capacidade nominal ────────────────────────────────────────── */}
      <section className="card p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <FileWarning className="w-4 h-4 text-brand" />
          Cobertura nominal — o que é limite da FONTE
        </h2>
        <p className="text-xs text-text-secondary max-w-3xl">
          Cobertura nominal baixa nem sempre é falha da extração. Em dois dos três órgãos, o
          instrumento simplesmente <strong>não nomina</strong> o voto de cada diretor. Tratar isso
          como lacuna faria o operador caçar um defeito que não existe.
        </p>
        <div className="space-y-2">
          {linhas.map((a) => (
            <div key={a.sigla} className="flex items-start gap-3 text-xs">
              <span className="font-mono font-semibold w-16 shrink-0">{a.sigla}</span>
              <span className={cn("font-mono w-14 shrink-0 text-right", pctClass(a.cobertura_nominal, 60, 20))}>
                {a.cobertura_nominal}%
              </span>
              <span className="text-text-secondary">{LIMITE_DA_FONTE[a.sigla] ?? "—"}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Base de votos ─────────────────────────────────────────────── */}
      <section className="card p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Database className="w-4 h-4 text-brand" />
          Base de votos
        </h2>
        {loadingSaude ? (
          <p className="text-sm text-text-muted">Carregando…</p>
        ) : saude?.totais ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Votos", valor: saude.totais.votos },
                { label: "Nominais", valor: saude.totais.votos_nominais, destaque: true },
                { label: "Inferidos", valor: saude.totais.votos_inferidos },
                { label: "Delib. sem voto", valor: saude.totais.deliberacoes_sem_voto },
              ].map((k) => (
                <div key={k.label} className={cn("rounded-lg p-3 border", k.destaque ? "border-brand/40 bg-brand/5" : "border-border bg-bg-hover/40")}>
                  <p className="text-[10px] uppercase tracking-wider text-text-label font-mono">{k.label}</p>
                  <p className="text-xl font-mono font-bold tabular-nums">{formatNumber(k.valor)}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-text-secondary max-w-3xl">
              Voto <strong>inferido</strong> é deduzido da decisão que prevaleceu e, por construção,
              nunca diverge. Por isso as métricas de <em>comportamento</em> usam apenas votos lidos
              do documento ou corrigidos por um revisor — medir divergência sobre voto inferido é
              tautologia, não medida.
            </p>
          </>
        ) : (
          <p className="text-sm text-text-muted">Indisponível.</p>
        )}
      </section>

      {/* ─── Bloqueios de inferência ───────────────────────────────────── */}
      {(saude?.diretores_sem_mandato?.length ?? 0) > 0 && (
        <section className="card p-5 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-warning" />
            Diretores sem mandato cadastrado
          </h2>
          <p className="text-xs text-text-secondary max-w-3xl">
            Sem mandato, o diretor não entra no roster da data e a inferência de voto fica desligada
            para ele. É a causa mais comum de deliberação final sem voto nenhum.
          </p>
          <ul className="text-xs space-y-1 font-mono">
            {saude!.diretores_sem_mandato!.slice(0, 20).map((d) => (
              <li key={d.diretor_id} className="text-text-secondary">
                <span className="text-text-label">{d.agencia_sigla ?? "—"}</span> · {d.nome}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(saude?.alertas?.length ?? 0) > 0 && (
        <section className="card p-5 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-warning" />
            Alertas
          </h2>
          <ul className="text-xs space-y-1.5">
            {saude!.alertas!.map((a, i) => (
              <li key={i} className="text-warning flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
