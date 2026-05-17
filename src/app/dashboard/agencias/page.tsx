"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Agencia } from "@/types";
import { formatDate, cn } from "@/lib/utils";
import { Building2, Plus, Check } from "lucide-react";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { CONFIG_TABS } from "@/lib/module-tabs";
import { useDataSyncContext } from "@/components/DataSyncProvider";

export default function AgenciasPage() {
  const qc = useQueryClient();
  const { demoEnabled } = useDataSyncContext();
  const [nova, setNova] = useState({ sigla: "", nome: "", nome_completo: "" });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  const { data: agencias, isLoading } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof nova) => api.post<Agencia>("/agencias", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agencias"] });
      setNova({ sigla: "", nome: "", nome_completo: "" });
      setShowForm(false);
      setError("");
    },
    onError: (e: any) => setError(e.message),
  });

  return (
    <div className="max-w-2xl space-y-6 animate-fade-in">
      <ModuleTabs tabs={CONFIG_TABS} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Agências Reguladoras</h1>
          <p className="text-sm text-text-muted mt-1">
            Gerencie as agências cadastradas na plataforma
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm((v) => !v)} disabled={demoEnabled}>
          <Plus className="w-3.5 h-3.5" />
          Nova Agência
        </button>
      </div>

      {demoEnabled && (
        <div className="card border-warning/30 bg-warning/10 py-2 px-3 text-sm text-warning">
          Modo DEMO ativo: cadastro de agencias fica bloqueado em somente leitura.
        </div>
      )}

      {/* Formulário de nova agência */}
      {showForm && (
        <div className="card space-y-3">
          <p className="section-label">Nova Agência</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-muted mb-1 block">Sigla *</label>
              <input
                className="input"
                placeholder="ARTESP"
                value={nova.sigla}
                onChange={(e) => setNova((v) => ({ ...v, sigla: e.target.value.toUpperCase() }))}
                maxLength={20}
              />
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">Nome *</label>
              <input
                className="input"
                placeholder="Nome da agência"
                value={nova.nome}
                onChange={(e) => setNova((v) => ({ ...v, nome: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1 block">Nome completo</label>
            <input
              className="input"
              placeholder="Nome completo (opcional)"
              value={nova.nome_completo}
              onChange={(e) => setNova((v) => ({ ...v, nome_completo: e.target.value }))}
            />
          </div>
          {error && <p className="text-xs text-error">{error}</p>}
          <div className="flex gap-2">
            <button
              className="btn-primary"
              onClick={() => createMutation.mutate(nova)}
              disabled={demoEnabled || !nova.sigla || !nova.nome || createMutation.isPending}
            >
              {createMutation.isPending ? "Salvando..." : "Salvar"}
            </button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      <div className="space-y-2">
        {isLoading ? (
          <p className="text-text-muted text-sm">Carregando...</p>
        ) : (agencias ?? []).length === 0 ? (
          <div className="card text-center py-12">
            <Building2 className="w-8 h-8 text-text-label mx-auto mb-3" />
            <p className="text-text-muted text-sm">Nenhuma agência cadastrada</p>
            <p className="text-xs text-text-label mt-1">Clique em &quot;Nova Agência&quot; para começar</p>
          </div>
        ) : (
          (agencias ?? []).map((a) => (
            <div key={a.id} className="card-hover flex items-center gap-4">
              <div className="w-10 h-10 rounded-md bg-brand/10 border border-brand/20 flex items-center justify-center shrink-0">
                <span className="font-mono text-xs font-bold text-brand">{a.sigla.slice(0, 2)}</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-text-primary">{a.sigla}</p>
                  <span className={cn("badge text-xs", a.ativo ? "badge-green" : "badge-gray")}>
                    {a.ativo ? "Ativa" : "Inativa"}
                  </span>
                </div>
                <p className="text-xs text-text-muted">{a.nome_completo ?? a.nome}</p>
              </div>
              <p className="text-xs text-text-label font-mono">{formatDate(a.created_at)}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
