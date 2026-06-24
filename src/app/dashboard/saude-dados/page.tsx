"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Gauge, AlertTriangle, CheckCircle2, FileText, Gavel, Inbox, XCircle, UserCheck, Radar,
} from "lucide-react";

type AgenciaSaude = {
  agencia_id: string | null; sigla: string; nome: string;
  deliberacoes: number; deliberacoes_com_voto: number; votos: number;
  documentos_pendentes: number; documentos_falhos: number;
};

type ExecucaoRecente = {
  dominio: string | null; status: string | null; started_at: string | null;
  itens: number | null; novos: number | null; error_message: string | null;
};

type SaudeDados = {
  gerado_em: string;
  modo: "real" | "demo";
  totais: {
    deliberacoes: number; deliberacoes_com_voto: number; deliberacoes_sem_voto: number;
    votos: number; votos_nominais: number; votos_inferidos: number;
    pct_cobertura_votos: number; pct_nominal: number;
  };
  fila: {
    documentos_total: number; queued: number; processing: number; review_pending: number;
    confirmed: number; failed: number; ignored: number;
    candidatos_diretores_pendentes: number; itens_monitorados_novos: number;
  };
  confianca: { alta: number; media: number; baixa: number; sem: number };
  por_agencia: AgenciaSaude[];
  execucoes_recentes: ExecucaoRecente[];
  alertas: string[];
};

const STATUS_TONE: Record<string, string> = {
  ok: "bg-emerald-500/10 text-emerald-400",
  error: "bg-red-500/10 text-red-400",
  needs_headless: "bg-amber-500/10 text-amber-400",
  running: "bg-sky-500/10 text-sky-400",
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export default function SaudeDadosPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["saude-dados"],
    queryFn: () => api.get<SaudeDados>("/admin/saude-dados"),
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-brand" />
            <h1 className="text-xl font-semibold text-text-primary">Saúde dos Dados</h1>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Cobertura e gargalos da esteira coleta → extração → votos. A base alimenta todos os módulos.
          </p>
        </div>
        {data && (
          <div className="text-right">
            <span className={cn(
              "text-xs px-2 py-0.5 rounded font-mono font-semibold border",
              data.modo === "real"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-400/25"
                : "bg-violet-500/10 text-violet-300 border-violet-400/25",
            )}>
              {data.modo === "real" ? "BASE REAL" : "DEMO"}
            </span>
            <p className="text-[11px] text-text-label mt-1">Atualizado {fmtDateTime(data.gerado_em)}</p>
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-text-muted">Carregando saúde dos dados...</p>
      ) : error || !data ? (
        <p className="text-sm text-red-400">Não foi possível carregar a saúde dos dados.</p>
      ) : (
        <>
          {/* Alertas */}
          {data.alertas.length > 0 ? (
            <div className="card border-amber-400/30 bg-amber-500/[0.03] space-y-2">
              <p className="text-xs text-amber-400 font-mono uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Onde a esteira está vazando
              </p>
              <ul className="space-y-1">
                {data.alertas.map((a, i) => (
                  <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                    <span className="text-amber-400 mt-0.5">•</span> {a}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="card border-emerald-400/30 bg-emerald-500/[0.03]">
              <p className="text-sm text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Nenhum gargalo aberto: fila vazia, sem falhas e todas as deliberações com voto.
              </p>
            </div>
          )}

          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Stat icon={FileText} label="Deliberações" value={data.totais.deliberacoes} />
            <Stat icon={Gavel} label="Cobertura de votos" value={`${data.totais.pct_cobertura_votos}%`}
              hint={`${data.totais.deliberacoes_com_voto}/${data.totais.deliberacoes} com voto`} />
            <Stat icon={UserCheck} label="Votos nominais" value={`${data.totais.pct_nominal}%`}
              hint={`${data.totais.votos_nominais} de ${data.totais.votos}`} />
            <Stat icon={Inbox} label="Fila de revisão" value={data.fila.review_pending}
              tone={data.fila.review_pending > 0 ? "warn" : undefined} />
            <Stat icon={XCircle} label="Falhas" value={data.fila.failed}
              tone={data.fila.failed > 0 ? "bad" : undefined} />
            <Stat icon={Radar} label="Itens novos" value={data.fila.itens_monitorados_novos}
              hint={`${data.fila.candidatos_diretores_pendentes} diretores p/ revisar`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Confiança da extração */}
            <div className="card space-y-3">
              <p className="text-xs text-text-muted font-mono uppercase tracking-wider">Confiança da extração (deliberações)</p>
              <ConfBar label="Alta (≥85%)" value={data.confianca.alta} total={data.totais.deliberacoes} tone="bg-emerald-400" />
              <ConfBar label="Revisão (60–85%)" value={data.confianca.media} total={data.totais.deliberacoes} tone="bg-amber-400" />
              <ConfBar label="Baixa (<60%)" value={data.confianca.baixa} total={data.totais.deliberacoes} tone="bg-red-400" />
              <ConfBar label="Sem confiança" value={data.confianca.sem} total={data.totais.deliberacoes} tone="bg-zinc-500" />
            </div>

            {/* Fila de documentos */}
            <div className="card space-y-2">
              <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-1">Fila de documentos ({data.fila.documentos_total})</p>
              {([
                ["Na fila", data.fila.queued],
                ["Processando", data.fila.processing],
                ["Aguardando revisão", data.fila.review_pending],
                ["Confirmados", data.fila.confirmed],
                ["Falharam", data.fila.failed],
                ["Ignorados", data.fila.ignored],
              ] as Array<[string, number]>).map(([label, v]) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">{label}</span>
                  <span className="font-mono text-text-primary">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Por agência */}
          <div className="card">
            <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-3">Por agência</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-text-muted text-left border-b border-border">
                    <th className="py-1.5 pr-3 font-medium">Agência</th>
                    <th className="py-1.5 px-3 font-medium text-right">Deliberações</th>
                    <th className="py-1.5 px-3 font-medium text-right">Com voto</th>
                    <th className="py-1.5 px-3 font-medium text-right">Votos</th>
                    <th className="py-1.5 px-3 font-medium text-right">Revisão</th>
                    <th className="py-1.5 pl-3 font-medium text-right">Falhas</th>
                  </tr>
                </thead>
                <tbody>
                  {data.por_agencia.length === 0 ? (
                    <tr><td colSpan={6} className="py-3 text-text-muted">Nenhuma agência ativa.</td></tr>
                  ) : data.por_agencia.map((a) => {
                    const cov = a.deliberacoes ? Math.round((a.deliberacoes_com_voto / a.deliberacoes) * 100) : 0;
                    return (
                      <tr key={a.agencia_id ?? a.sigla} className="border-b border-border/50 last:border-0">
                        <td className="py-2 pr-3">
                          <span className="text-xs px-2 py-0.5 rounded font-mono font-semibold bg-brand/15 text-brand border border-brand/25">{a.sigla}</span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-text-primary">{a.deliberacoes}</td>
                        <td className="py-2 px-3 text-right font-mono">
                          <span className={cn(cov >= 70 ? "text-emerald-400" : cov >= 40 ? "text-amber-400" : "text-red-400")}>
                            {a.deliberacoes_com_voto} <span className="text-text-label">({cov}%)</span>
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-text-secondary">{a.votos}</td>
                        <td className="py-2 px-3 text-right font-mono">{a.documentos_pendentes > 0 ? <span className="text-amber-400">{a.documentos_pendentes}</span> : <span className="text-text-label">0</span>}</td>
                        <td className="py-2 pl-3 text-right font-mono">{a.documentos_falhos > 0 ? <span className="text-red-400">{a.documentos_falhos}</span> : <span className="text-text-label">0</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Execuções recentes */}
          <div className="card">
            <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-3">Coletas recentes</p>
            {data.execucoes_recentes.length === 0 ? (
              <p className="text-sm text-text-muted">Nenhuma execução registrada.</p>
            ) : (
              <div className="space-y-1.5">
                {data.execucoes_recentes.map((ex, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-sm py-1 border-b border-border/40 last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-mono", STATUS_TONE[ex.status ?? ""] ?? "bg-zinc-500/10 text-zinc-400")}>
                        {ex.status ?? "—"}
                      </span>
                      <span className="text-text-secondary">{ex.dominio ?? "—"}</span>
                      {ex.error_message && <span className="text-xs text-red-400/80 truncate">{ex.error_message}</span>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-text-label font-mono text-xs">
                      <span>{ex.itens ?? 0} itens · {ex.novos ?? 0} novos</span>
                      <span>{fmtDateTime(ex.started_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, hint, tone }: {
  icon: React.ElementType; label: string; value: string | number; hint?: string;
  tone?: "warn" | "bad";
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-1.5 text-text-muted">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-[11px] font-mono uppercase tracking-wider truncate">{label}</span>
      </div>
      <p className={cn(
        "text-2xl font-semibold mt-1",
        tone === "warn" ? "text-amber-400" : tone === "bad" ? "text-red-400" : "text-text-primary",
      )}>{value}</p>
      {hint && <p className="text-[11px] text-text-label mt-0.5 truncate">{hint}</p>}
    </div>
  );
}

function ConfBar({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const w = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-text-secondary">{label}</span>
        <span className="font-mono text-text-muted">{value} ({w}%)</span>
      </div>
      <div className="h-2 rounded-full bg-bg-hover overflow-hidden">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}
