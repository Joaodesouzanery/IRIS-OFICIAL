"use client";

import { isVotoNominal } from "@/lib/votos-nominal";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Agencia } from "@/types";
import { formatDate, getMicrotemaLabel, cn } from "@/lib/utils";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { DELIBERACOES_TABS } from "@/lib/module-tabs";
import { CalendarDays, ChevronDown, ChevronUp, Gavel } from "lucide-react";

type ReuniaoListItem = {
  slug: string; agencia_id: string | null; agencia_sigla: string | null;
  data_reuniao: string | null; numero_reuniao: string | null; tipo_reuniao: string | null;
  total_itens: number; total_votos: number; divergencias: number; pct_consenso: number | null;
};

type ReuniaoDetalhe = {
  cabecalho: { agencia_sigla: string | null; data_reuniao: string | null; numero_reuniao: string | null; tipo_reuniao: string | null };
  resumo: { total_itens: number; deferidos: number; indeferidos: number; divergencias: number; pct_consenso: number | null; itens_com_voto?: number; votos_nominais?: number; votos_inferidos?: number };
  itens: Array<{
    deliberacao_id: string; numero_deliberacao: string | null; interessado: string | null;
    microtema: string | null; resultado: string | null;
    votos: Array<{ diretor_id: string; diretor_nome: string | null; tipo_voto: string; is_divergente: boolean; is_nominal: boolean; proveniencia?: string | null }>;
  }>;
  diretores: Array<{ id: string; nome: string; favoravel: number; desfavoravel: number; divergente: number; nominais?: number; inferidos?: number }>;
};

const ANOS = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i);

export default function ReunioesPage() {
  const [agenciaId, setAgenciaId] = useState("");
  /**
   * ⚠️ O ano nasce VAZIO (= todos os anos). Esta é A TELA que o usuário abriu procurando a 79ª ROP
   * da ANM — "são 5 páginas e não tem 79" —, e ela não tinha como mostrar a 79ª: o ano nascia em
   * 2026, a reunião é de 2025-11-26, e o seletor **não oferecia** "Todos os anos". Não havia saída
   * pela interface: nenhuma combinação de cliques trazia a reunião à tela.
   *
   * As telas irmãs (`deliberacoes`, `360`, `governanca`) já nasciam em "todos os anos".
   */
  const [year, setYear] = useState("");
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });

  const qs = new URLSearchParams();
  if (agenciaId) qs.set("agencia_id", agenciaId);
  if (year) qs.set("year", year);

  const { data: reunioes, isLoading } = useQuery({
    queryKey: ["reunioes", agenciaId, year],
    queryFn: () => api.get<ReuniaoListItem[]>(`/reunioes?${qs.toString()}`),
  });

  /** O recorte aplicado, em palavras — a tela não o mostrava, e o ano estava sempre valendo. */
  const recorte = [
    agenciaId ? ((agencias ?? []).find((a) => a.id === agenciaId)?.sigla ?? "agência") : "todas as agências",
    year || "todos os anos",
  ].join(" · ");

  return (
    <div className="space-y-6 animate-fade-in">
      <ModuleTabs tabs={DELIBERACOES_TABS} />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-brand" />
            <h1 className="text-xl font-semibold text-text-primary">Reuniões de Diretoria</h1>
          </div>
          <p className="text-sm text-text-muted mt-1">Cada reunião com seus itens e como cada diretor votou.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="select w-36" value={agenciaId} onChange={(e) => setAgenciaId(e.target.value)}>
            <option value="">Todas as agências</option>
            {(agencias ?? []).map((a) => <option key={a.id} value={a.id}>{a.sigla}</option>)}
          </select>
          <select className="select w-28" value={year} onChange={(e) => setYear(e.target.value)}>
            {/* ⚠️ A opção que NÃO EXISTIA. Sem ela o filtro de ano não tinha saída: quem procurasse
                uma reunião de outro ano tinha de adivinhar o ano certo ou concluir que ela não
                existe — e foi a segunda conclusão que o operador tirou. */}
            <option value="">Todos os anos</option>
            {ANOS.map((a) => <option key={a} value={String(a)}>{a}</option>)}
          </select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-text-muted">Carregando reuniões...</p>
      ) : (reunioes ?? []).length === 0 ? (
        /* ⚠️ O vazio diz o RECORTE. "Nenhuma reunião encontrada no período" não dizia qual período,
           e com o ano pré-selecionado o operador não sabia que havia um período aplicado. */
        <div className="space-y-2">
          <p className="text-sm text-text-muted">
            Nenhuma reunião em <span className="font-mono text-xs">{recorte}</span>.
          </p>
          {year ? (
            <button type="button" className="btn-secondary text-xs" onClick={() => setYear("")}>
              Ver todos os anos
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          {(reunioes ?? []).map((r) => (
            <ReuniaoCard key={r.slug} r={r} open={openSlug === r.slug} onToggle={() => setOpenSlug(openSlug === r.slug ? null : r.slug)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReuniaoCard({ r, open, onToggle }: { r: ReuniaoListItem; open: boolean; onToggle: () => void }) {
  const dq = new URLSearchParams();
  if (r.agencia_id) dq.set("agencia_id", r.agencia_id);
  if (r.data_reuniao) dq.set("data_reuniao", r.data_reuniao);
  if (r.numero_reuniao) dq.set("numero_reuniao", r.numero_reuniao);

  const { data: detalhe } = useQuery({
    queryKey: ["reuniao-detalhe", r.slug],
    queryFn: () => api.get<ReuniaoDetalhe>(`/reunioes/detalhe?${dq.toString()}`),
    enabled: open,
  });

  return (
    <div className="card">
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-3 text-left">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs px-2 py-0.5 rounded font-mono font-semibold bg-brand/15 text-brand border border-brand/25">
            {r.agencia_sigla ?? "—"}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary">
              {r.numero_reuniao ? `${r.numero_reuniao}ª Reunião` : "Reunião"} · {formatDate(r.data_reuniao)}
            </p>
            <p className="text-xs text-text-muted">
              {r.total_itens} itens · {r.divergencias} com divergência ·{" "}
              {/* Sem base de voto o consenso é `—`, e a BASE vem junto: esconder o número
                  transformaria a correção em remoção de funcionalidade (etapa61/65). */}
              {r.pct_consenso == null ? "— consenso (0 itens com voto)" : `${r.pct_consenso}% consenso`}
            </p>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-text-muted shrink-0" /> : <ChevronDown className="w-4 h-4 text-text-muted shrink-0" />}
      </button>

      {open && (
        <div className="mt-4 pt-4 border-t border-border space-y-4">
          {!detalhe ? (
            <p className="text-sm text-text-muted">Carregando detalhe...</p>
          ) : (
            <>
              {/* Diretores na reunião */}
              {detalhe.diretores.length > 0 && (
                <div>
                  <p className="text-xs text-text-muted mb-2 font-mono uppercase tracking-wider">Diretores</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {detalhe.diretores.map((d) => (
                      <Link key={d.id} href={`/dashboard/diretores/${d.id}`} className="flex items-center justify-between gap-2 px-2 py-1 rounded border border-border/60 hover:bg-bg-hover">
                        <span className="text-xs text-text-secondary truncate">{d.nome}</span>
                        <span className="text-[10px] font-mono shrink-0 flex items-center gap-1.5">
                          <span className="text-emerald-400">{d.favoravel}✓</span>
                          {d.desfavoravel > 0 && <span className="text-red-400">{d.desfavoravel}✗</span>}
                          {d.divergente > 0 && <span className="text-amber-400">⚡{d.divergente}</span>}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Itens da reunião */}
              <div>
                <p className="text-xs text-text-muted mb-2 font-mono uppercase tracking-wider">
                  Itens deliberados
                  {(detalhe.resumo.votos_inferidos ?? 0) > 0 && (
                    <span className="ml-2 text-text-label normal-case tracking-normal">· <span className="font-mono">~inf</span> = inferido por mandato (não nominal no documento)</span>
                  )}
                </p>
                <div className="space-y-2">
                  {detalhe.itens.map((it) => (
                    <div key={it.deliberacao_id} className="border border-border/60 rounded-card p-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <Link href={`/dashboard/deliberacoes/${it.deliberacao_id}`} className="text-sm text-text-primary hover:text-brand font-medium">
                          {it.numero_deliberacao ?? "—"} — {it.interessado ?? "Sem interessado"}
                        </Link>
                        <div className="flex items-center gap-1.5">
                          {it.microtema && <span className="badge-orange text-[10px]">{getMicrotemaLabel(it.microtema)}</span>}
                          {it.resultado && <span className="badge badge-gray text-[10px]">{it.resultado}</span>}
                        </div>
                      </div>
                      {it.votos.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {it.votos.map((v, i) => (
                            <span key={`${v.diretor_id}-${i}`}
                              title={isVotoNominal(v) ? undefined : "Voto inferido por mandato — não consta nominalmente no documento"}
                              className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded font-mono inline-flex items-center gap-1",
                                v.tipo_voto === "Favoravel" && "bg-emerald-500/10 text-emerald-400",
                                v.tipo_voto === "Desfavoravel" && "bg-red-500/10 text-red-400",
                                v.is_divergente && "bg-amber-500/10 text-amber-400",
                                !["Favoravel", "Desfavoravel"].includes(v.tipo_voto) && "bg-zinc-500/10 text-zinc-400",
                                !isVotoNominal(v) && "border border-dashed border-current/40 opacity-70",
                              )}>
                              <Gavel className="w-2.5 h-2.5" /> {v.diretor_nome ?? "—"}: {v.tipo_voto}{!isVotoNominal(v) && <span className="ml-0.5">~inf</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
