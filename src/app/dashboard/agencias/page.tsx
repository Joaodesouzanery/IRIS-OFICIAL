"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Building2, Check, DatabaseZap, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { calcularMandato } from "@/lib/mandatos";
import { cn } from "@/lib/utils";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { CONFIG_TABS } from "@/lib/module-tabs";
import { useDataSyncContext } from "@/components/DataSyncProvider";
import type { Agencia, Diretor } from "@/types";

type AgenciaForm = {
  sigla: string;
  nome: string;
  nome_completo: string;
  tipo: "federal" | "estadual";
  esfera: string;
  ministerio_vinculado: string;
  url_institucional: string;
  url_diretores: string;
  estado: string;
};

const EMPTY_FORM: AgenciaForm = {
  sigla: "",
  nome: "",
  nome_completo: "",
  tipo: "federal",
  esfera: "",
  ministerio_vinculado: "",
  url_institucional: "",
  url_diretores: "",
  estado: "",
};

export default function AgenciasPage() {
  const qc = useQueryClient();
  const { demoEnabled } = useDataSyncContext();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AgenciaForm>(EMPTY_FORM);
  const [error, setError] = useState("");

  const { data: agencias, isLoading } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });

  const { data: diretores } = useQuery({
    queryKey: ["diretores", "all"],
    queryFn: () => api.get<Diretor[]>("/diretores"),
  });

  const createMutation = useMutation({
    mutationFn: (body: AgenciaForm) => api.post<Agencia>("/agencias", {
      ...body,
      nome: body.nome || body.sigla,
      estado: body.tipo === "estadual" ? body.estado : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agencias"] });
      setForm(EMPTY_FORM);
      setShowForm(false);
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const cards = useMemo(() => {
    const byAgencia = new Map<string, Diretor[]>();
    for (const diretor of diretores ?? []) {
      if (!diretor.agencia_id) continue;
      byAgencia.set(diretor.agencia_id, [...(byAgencia.get(diretor.agencia_id) ?? []), diretor]);
    }
    return (agencias ?? []).map((agencia) => {
      const dirs = byAgencia.get(agencia.id) ?? [];
      const ativos = dirs.filter((dir) => dir.ativo !== false && dir.situacao !== "inativo");
      const dg = ativos.find((dir) => /diretor[- ]geral|diretor[- ]presidente/i.test(dir.cargo ?? "")) ?? ativos[0] ?? null;
      const mandato = calcularMandato(dg?.data_posse, dg?.data_fim_mandato);
      const alertas = Array.isArray(agencia.metadata?.alertas) ? agencia.metadata.alertas as string[] : [];
      return { agencia, ativos, dg, mandato, alertas };
    });
  }, [agencias, diretores]);

  return (
    <div className="space-y-6 animate-fade-in">
      <ModuleTabs tabs={CONFIG_TABS} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Agências Reguladoras</h1>
          <p className="text-sm text-text-muted mt-1">
            Cadastro institucional, diretoria, mandatos e lista tríplice.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)} disabled={demoEnabled}>
          <Plus className="w-4 h-4" />
          Nova Agência
        </button>
      </div>

      {demoEnabled ? (
        <div className="card border-warning/30 bg-warning/10 py-2 px-3 text-sm text-warning">
          Modo DEMO ativo: cadastro, importação e edição ficam bloqueados.
        </div>
      ) : null}

      {showForm ? (
        <section className="card space-y-4">
          <div className="flex items-center justify-between">
            <p className="section-label">Nova Agência</p>
            <button className="icon-btn" onClick={() => setShowForm(false)} aria-label="Fechar">
              <X className="w-4 h-4" />
            </button>
          </div>
          <AgenciaFields form={form} setForm={setForm} />
          {error ? <p className="text-xs text-error">{error}</p> : null}
          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={demoEnabled || !form.sigla || createMutation.isPending}
              onClick={() => createMutation.mutate(form)}
            >
              {createMutation.isPending ? "Salvando..." : "Salvar"}
            </button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancelar</button>
          </div>
        </section>
      ) : null}

      {isLoading ? (
        <div className="card text-sm text-text-muted">Carregando agências...</div>
      ) : cards.length === 0 ? (
        <div className="card text-center py-12">
          <Building2 className="w-8 h-8 text-text-label mx-auto mb-3" />
          <p className="text-text-muted text-sm">Nenhuma agência cadastrada</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards.map(({ agencia, ativos, dg, mandato, alertas }) => (
            <Link key={agencia.id} href={`/dashboard/agencias/${agencia.id}`} className="card-hover p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-md bg-brand/10 border border-brand/20 flex items-center justify-center shrink-0">
                    <span className="font-mono text-xs font-bold text-brand">{agencia.sigla.slice(0, 4)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">{agencia.sigla}</p>
                    <p className="text-xs text-text-muted truncate">{agencia.nome_completo ?? agencia.nome}</p>
                  </div>
                </div>
                <span className={cn("badge text-xs", agencia.tipo === "estadual" ? "bg-info/10 text-info" : "badge-green")}>
                  {agencia.tipo ?? "federal"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <Metric label="Diretores ativos" value={ativos.length} />
                <Metric label="Diretor-Geral" value={dg?.nome?.split(" ").slice(0, 2).join(" ") ?? "-"} />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-text-muted">Mandato principal</span>
                  <span className="font-mono text-text-secondary">{mandato.percentualConcluido ?? 0}%</span>
                </div>
                <div className="h-2 rounded-full bg-bg-hover overflow-hidden">
                  <div className="h-full bg-brand" style={{ width: `${mandato.percentualConcluido ?? 0}%` }} />
                </div>
                <p className="text-[11px] text-text-label mt-1">{mandato.texto}</p>
              </div>

              {alertas.length ? (
                <div className="flex items-start gap-2 text-xs text-warning">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="line-clamp-2">{alertas[0]}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-success">
                  <Check className="w-4 h-4" />
                  Sem alerta institucional cadastrado
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function AgenciaFields({ form, setForm }: { form: AgenciaForm; setForm: (next: AgenciaForm) => void }) {
  const update = <K extends keyof AgenciaForm>(key: K, value: AgenciaForm[K]) => setForm({ ...form, [key]: value });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Field label="Sigla *" value={form.sigla} onChange={(v) => update("sigla", v.toUpperCase())} placeholder="ANTT" />
      <Field label="Nome curto" value={form.nome} onChange={(v) => update("nome", v)} placeholder="ANTT" />
      <div className="md:col-span-2">
        <Field label="Nome completo *" value={form.nome_completo} onChange={(v) => update("nome_completo", v)} placeholder="Agência Nacional de Transportes Terrestres" />
      </div>
      <label className="block">
        <span className="text-xs text-text-muted mb-1 block">Tipo</span>
        <select className="select w-full" value={form.tipo} onChange={(e) => update("tipo", e.target.value as AgenciaForm["tipo"])}>
          <option value="federal">Federal</option>
          <option value="estadual">Estadual</option>
        </select>
      </label>
      {form.tipo === "estadual" ? <Field label="Estado" value={form.estado} onChange={(v) => update("estado", v.toUpperCase())} placeholder="SP" /> : <div />}
      <Field label="Esfera" value={form.esfera} onChange={(v) => update("esfera", v)} placeholder="Transportes" />
      <Field label="Ministério/Governo vinculado" value={form.ministerio_vinculado} onChange={(v) => update("ministerio_vinculado", v)} placeholder="Ministério dos Transportes" />
      <Field label="URL institucional" value={form.url_institucional} onChange={(v) => update("url_institucional", v)} placeholder="https://..." />
      <Field label="URL da página de diretores" value={form.url_diretores} onChange={(v) => update("url_diretores", v)} placeholder="https://..." />
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-text-muted mb-1 block">{label}</span>
      <input className="input w-full" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-bg-hover/40 p-3">
      <p className="section-label mb-1">{label}</p>
      <p className="text-sm font-semibold text-text-primary truncate">{value}</p>
    </div>
  );
}
