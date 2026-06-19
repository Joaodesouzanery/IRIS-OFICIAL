"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn, formatDate } from "@/lib/utils";
import type { Agencia } from "@/types";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { DIRETORES_TABS } from "@/lib/module-tabs";
import { Plus, Trash2, Save, X, UserPlus, Check, AlertTriangle } from "lucide-react";

type MandatoRow = { id: string; data_inicio: string; data_fim: string | null; cargo: string | null };
type DiretorRow = {
  id: string;
  nome: string;
  cargo: string | null;
  agencia_id: string;
  nome_variantes: string[] | null;
  situacao?: string | null;
  ativo: boolean;
  needs_review: boolean;
  mandatos?: MandatoRow[];
};
type CandidatoRow = {
  id: string;
  nome_detectado: string;
  cargo_detectado: string | null;
  confidence: number | null;
  review_status: string;
  agencia?: { sigla: string; nome: string } | null;
  diretor?: { id: string; nome: string } | null;
};

const SITUACOES = ["titular", "substituto", "interino", "inativo", "designado"];

export default function DiretoresAdminPage() {
  const [agenciaId, setAgenciaId] = useState<string>("");
  const qc = useQueryClient();

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });

  const { data: diretores, isLoading } = useQuery({
    queryKey: ["diretores-admin", agenciaId],
    queryFn: () => api.get<DiretorRow[]>(`/diretores${agenciaId ? `?agencia_id=${agenciaId}` : ""}`),
  });

  const { data: candidatos } = useQuery({
    queryKey: ["diretor-candidatos", agenciaId],
    queryFn: () => api.get<CandidatoRow[]>(`/diretores/candidatos?status=pendente${agenciaId ? `&agencia_id=${agenciaId}` : ""}`),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["diretores-admin"] });
    qc.invalidateQueries({ queryKey: ["diretor-candidatos"] });
  };

  const createDiretor = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post("/diretores", payload),
    onSuccess: invalidate,
  });

  const aprovarCandidato = useMutation({
    mutationFn: (id: string) => api.post(`/diretores/candidatos/${id}/aprovar`, {}),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-8 animate-fade-in">
      <ModuleTabs tabs={DIRETORES_TABS} />

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Cadastro de Diretores</h1>
          <p className="text-sm text-text-muted mt-1">
            Gerencie diretores, mandatos e variantes de nome usadas no match automático de votos.
          </p>
        </div>
        <select className="select w-56" value={agenciaId} onChange={(e) => setAgenciaId(e.target.value)}>
          <option value="">Todas as agências</option>
          {(agencias ?? []).map((a) => (
            <option key={a.id} value={a.id}>{a.sigla} — {a.nome}</option>
          ))}
        </select>
      </div>

      {/* Candidatos pendentes */}
      {(candidatos ?? []).length > 0 && (
        <section>
          <p className="section-label mb-3">Candidatos detectados (pendentes de revisão)</p>
          <div className="space-y-2">
            {(candidatos ?? []).map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-warning/5 border-warning/30 text-sm">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text-primary truncate">{c.nome_detectado}</p>
                  <p className="text-xs text-text-muted">
                    {c.agencia?.sigla ?? "—"}
                    {c.diretor ? ` · sugerido: ${c.diretor.nome}` : " · novo diretor"}
                    {c.confidence != null && ` · confiança ${(c.confidence * 100).toFixed(0)}%`}
                  </p>
                </div>
                <button
                  className="btn-primary text-xs px-2.5 py-1.5 shrink-0"
                  disabled={aprovarCandidato.isPending}
                  onClick={() => aprovarCandidato.mutate(c.id)}
                >
                  <Check className="w-3.5 h-3.5" /> Aprovar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Novo diretor */}
      <NewDiretorForm
        agenciaId={agenciaId}
        agencias={agencias ?? []}
        onCreate={(payload) => createDiretor.mutate(payload)}
        isPending={createDiretor.isPending}
      />

      {/* Lista de diretores */}
      <section>
        <p className="section-label mb-3">Diretores cadastrados</p>
        {isLoading ? (
          <div className="text-center py-10 text-text-muted text-sm">Carregando...</div>
        ) : (diretores ?? []).length === 0 ? (
          <div className="text-center py-10 text-text-muted text-sm">Nenhum diretor cadastrado.</div>
        ) : (
          <div className="space-y-3">
            {(diretores ?? []).map((d) => (
              <DiretorEditor key={d.id} diretor={d} onChanged={invalidate} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function NewDiretorForm({
  agenciaId,
  agencias,
  onCreate,
  isPending,
}: {
  agenciaId: string;
  agencias: Agencia[];
  onCreate: (payload: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const [nome, setNome] = useState("");
  const [cargo, setCargo] = useState("");
  const [ag, setAg] = useState(agenciaId);
  const effectiveAg = ag || agenciaId;

  return (
    <section className="card">
      <p className="section-label mb-3">Novo diretor</p>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <input className="input sm:col-span-1" placeholder="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} />
        <input className="input sm:col-span-1" placeholder="Cargo (opcional)" value={cargo} onChange={(e) => setCargo(e.target.value)} />
        <select className="select sm:col-span-1" value={effectiveAg} onChange={(e) => setAg(e.target.value)}>
          <option value="">Selecione a agência</option>
          {agencias.map((a) => (
            <option key={a.id} value={a.id}>{a.sigla}</option>
          ))}
        </select>
        <button
          className="btn-primary sm:col-span-1 justify-center"
          disabled={isPending || !nome.trim() || !effectiveAg}
          onClick={() => {
            onCreate({ nome: nome.trim(), cargo: cargo.trim() || null, agencia_id: effectiveAg, needs_review: true });
            setNome("");
            setCargo("");
          }}
        >
          <UserPlus className="w-4 h-4" /> Adicionar
        </button>
      </div>
      <p className="text-xs text-text-muted mt-2">Novos diretores entram com <code>needs_review</code> ativo.</p>
    </section>
  );
}

function DiretorEditor({ diretor, onChanged }: { diretor: DiretorRow; onChanged: () => void }) {
  const qc = useQueryClient();
  const [variantes, setVariantes] = useState<string[]>(diretor.nome_variantes ?? []);
  const [novaVariante, setNovaVariante] = useState("");
  const [situacao, setSituacao] = useState(diretor.situacao ?? "titular");
  const [ativo, setAtivo] = useState(diretor.ativo);
  const [needsReview, setNeedsReview] = useState(diretor.needs_review);

  const save = useMutation({
    mutationFn: () => api.patch(`/diretores/${diretor.id}`, {
      nome_variantes: variantes,
      situacao,
      ativo,
      needs_review: needsReview,
    }),
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/diretores/${diretor.id}`),
    onSuccess: onChanged,
  });

  const addMandato = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post("/mandatos", { ...payload, diretor_id: diretor.id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["diretores-admin"] }),
  });

  const delMandato = useMutation({
    mutationFn: (id: string) => api.delete(`/mandatos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["diretores-admin"] }),
  });

  const [mi, setMi] = useState("");
  const [mf, setMf] = useState("");

  function addVariante() {
    const v = novaVariante.trim();
    if (v && !variantes.includes(v)) setVariantes([...variantes, v]);
    setNovaVariante("");
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-text-primary">{diretor.nome}</p>
          <p className="text-xs text-text-muted">{diretor.cargo ?? "—"}</p>
        </div>
        <div className="flex items-center gap-2">
          {needsReview && <span className="badge badge-orange text-xs">needs_review</span>}
          <span className={cn("badge text-xs", ativo ? "badge-green" : "badge-gray")}>{ativo ? "ativo" : "inativo"}</span>
        </div>
      </div>

      {/* Variantes de nome */}
      <div className="mt-4">
        <p className="section-label mb-2">Variantes de nome (match)</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {variantes.length === 0 && <span className="text-xs text-text-muted">Nenhuma variante.</span>}
          {variantes.map((v) => (
            <span key={v} className="badge badge-gray text-xs inline-flex items-center gap-1">
              {v}
              <button onClick={() => setVariantes(variantes.filter((x) => x !== v))} className="hover:text-danger">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Adicionar variante de grafia (ex.: abreviação, sem acento)"
            value={novaVariante}
            onChange={(e) => setNovaVariante(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addVariante(); } }}
          />
          <button className="btn-secondary text-xs px-2.5 py-1.5" onClick={addVariante}><Plus className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* Atributos */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="text-xs text-text-muted">
          Situação
          <select className="select mt-1 w-full" value={situacao} onChange={(e) => setSituacao(e.target.value)}>
            {SITUACOES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-xs text-text-muted flex items-center gap-2 mt-5">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Ativo
        </label>
        <label className="text-xs text-text-muted flex items-center gap-2 mt-5">
          <input type="checkbox" checked={needsReview} onChange={(e) => setNeedsReview(e.target.checked)} /> Precisa de revisão
        </label>
      </div>

      {/* Mandatos */}
      <div className="mt-4">
        <p className="section-label mb-2">Mandatos</p>
        <div className="space-y-1 mb-2">
          {(diretor.mandatos ?? []).length === 0 && <span className="text-xs text-text-muted">Sem mandatos.</span>}
          {(diretor.mandatos ?? []).map((m) => (
            <div key={m.id} className="flex items-center gap-2 text-xs font-mono text-text-label">
              <span>{formatDate(m.data_inicio)} → {m.data_fim ? formatDate(m.data_fim) : "vigente"}</span>
              {m.cargo && <span className="text-text-muted">· {m.cargo}</span>}
              <button onClick={() => delMandato.mutate(m.id)} className="hover:text-danger ml-1"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <label className="text-[10px] text-text-muted">Início<input type="date" className="input mt-1 block" value={mi} onChange={(e) => setMi(e.target.value)} /></label>
          <label className="text-[10px] text-text-muted">Fim (opcional)<input type="date" className="input mt-1 block" value={mf} onChange={(e) => setMf(e.target.value)} /></label>
          <button
            className="btn-secondary text-xs px-2.5 py-1.5"
            disabled={!mi || addMandato.isPending}
            onClick={() => { addMandato.mutate({ data_inicio: mi, data_fim: mf || null }); setMi(""); setMf(""); }}
          >
            <Plus className="w-3.5 h-3.5" /> Mandato
          </button>
        </div>
      </div>

      {/* Ações */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <button className="btn-secondary text-xs px-2.5 py-1.5 text-danger" disabled={remove.isPending} onClick={() => { if (confirm(`Excluir ${diretor.nome}?`)) remove.mutate(); }}>
          <Trash2 className="w-3.5 h-3.5" /> Excluir
        </button>
        <button className="btn-primary text-xs px-2.5 py-1.5" disabled={save.isPending} onClick={() => save.mutate()}>
          <Save className="w-3.5 h-3.5" /> {save.isPending ? "Salvando..." : "Salvar"}
        </button>
      </div>
      {(save.isError || remove.isError) && (
        <p className="text-xs text-danger mt-2">{String((save.error ?? remove.error) instanceof Error ? (save.error ?? remove.error) : "Erro ao salvar")}</p>
      )}
    </div>
  );
}
