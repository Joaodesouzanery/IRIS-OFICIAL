"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, Plus, Search, Users } from "lucide-react";
import { api } from "@/lib/api";
import type { Agencia, Associado } from "@/types";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { REGULATORIO_TABS } from "@/lib/module-tabs";
import { useDataSyncContext } from "@/components/DataSyncProvider";

type AssociadoComPlataforma = Associado & {
  plataforma?: {
    deliberacoes_relacionadas: number;
    ultima_deliberacao: string | null;
    microtemas_detectados: string[];
    processos: string[];
  };
};

const MICROTEMAS = [
  "tarifa", "obras", "multa", "contrato", "reequilibrio",
  "fiscalizacao", "seguranca", "ambiental", "desapropriacao",
  "adimplencia", "pessoal", "usuario", "lavra", "pesquisa",
  "licenciamento", "servidao", "cfem", "disponibilidade", "recursos",
];

export default function AssociadosEmpresasPage() {
  const queryClient = useQueryClient();
  const { demoEnabled } = useDataSyncContext();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    nome: "",
    setor: "",
    descricao: "",
    agencia_siglas: [] as string[],
    microtemas: [] as string[],
    palavras_chave: "",
  });

  const { data: agencias = [] } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });

  const { data: associados = [], isLoading } = useQuery({
    queryKey: ["empresas-associados", search],
    queryFn: () => api.get<AssociadoComPlataforma[]>(`/empresas/associados${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post<Associado>("/empresas/associados", {
      ...form,
      palavras_chave: splitList(form.palavras_chave),
      ministerios: [],
      ministerio_urls: [],
    }),
    onSuccess: () => {
      setShowForm(false);
      setForm({ nome: "", setor: "", descricao: "", agencia_siglas: [], microtemas: [], palavras_chave: "" });
      queryClient.invalidateQueries({ queryKey: ["empresas-associados"] });
      queryClient.invalidateQueries({ queryKey: ["associados"] });
    },
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <ModuleTabs tabs={REGULATORIO_TABS} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Empresas e Associados</h1>
          <p className="text-sm text-text-muted mt-1">
            Cadastre associados, vincule temas de interesse e veja sinais vindos das deliberações.
          </p>
        </div>
        <button
          onClick={() => setShowForm((value) => !value)}
          disabled={demoEnabled}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          Novo associado
        </button>
      </div>

      <div className="card flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            className="input pl-8 text-xs"
            placeholder="Buscar associado..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {showForm && (
        <div className="card space-y-4">
          <p className="section-label">Cadastro de associado</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-text-label font-mono uppercase">Nome</span>
              <input className="input" value={form.nome} onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value }))} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-text-label font-mono uppercase">Setor</span>
              <input className="input" value={form.setor} onChange={(e) => setForm((prev) => ({ ...prev, setor: e.target.value }))} />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs text-text-label font-mono uppercase">Descrição</span>
              <textarea className="input min-h-20" value={form.descricao} onChange={(e) => setForm((prev) => ({ ...prev, descricao: e.target.value }))} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-text-label font-mono uppercase">Agências</span>
              <select
                className="input min-h-28"
                multiple
                value={form.agencia_siglas}
                onChange={(event) => setForm((prev) => ({
                  ...prev,
                  agencia_siglas: Array.from(event.target.selectedOptions).map((option) => option.value),
                }))}
              >
                {agencias.map((agencia) => (
                  <option key={agencia.id} value={agencia.sigla}>{agencia.sigla}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-text-label font-mono uppercase">Microtemas</span>
              <select
                className="input min-h-28"
                multiple
                value={form.microtemas}
                onChange={(event) => setForm((prev) => ({
                  ...prev,
                  microtemas: Array.from(event.target.selectedOptions).map((option) => option.value),
                }))}
              >
                {MICROTEMAS.map((microtema) => (
                  <option key={microtema} value={microtema}>{microtema}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-xs text-text-label font-mono uppercase">Palavras-chave</span>
              <input
                className="input"
                value={form.palavras_chave}
                onChange={(e) => setForm((prev) => ({ ...prev, palavras_chave: e.target.value }))}
                placeholder="metro, trilhos, concessão..."
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => createMutation.mutate()}
              disabled={!form.nome || !form.setor || createMutation.isPending}
              className="btn-primary"
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Salvar associado
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="card py-16 text-center text-sm text-text-muted">Carregando associados...</div>
      ) : associados.length === 0 ? (
        <div className="card py-16 text-center">
          <Users className="w-8 h-8 text-text-muted mx-auto mb-2" />
          <p className="text-sm text-text-muted">Nenhum associado cadastrado.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {associados.map((associado) => (
            <div key={associado.id} className="card space-y-4">
              <div className="flex items-start gap-3">
                <Building2 className="w-5 h-5 text-brand mt-0.5" />
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-text-primary">{associado.nome}</h2>
                  <p className="text-sm text-text-muted">{associado.setor}</p>
                </div>
              </div>
              {associado.descricao && <p className="text-sm text-text-secondary">{associado.descricao}</p>}
              <TagList label="Agências" values={associado.agencia_siglas} />
              <TagList label="Temas" values={associado.microtemas.slice(0, 8)} />
              <TagList label="Palavras-chave" values={associado.palavras_chave.slice(0, 8)} />
              <div className="grid grid-cols-3 gap-2 border-t border-border pt-3">
                <Metric label="Deliberações" value={associado.plataforma?.deliberacoes_relacionadas ?? 0} />
                <Metric label="Processos" value={associado.plataforma?.processos.length ?? 0} />
                <Metric label="Última" value={formatDate(associado.plataforma?.ultima_deliberacao)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TagList({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <div>
      <p className="text-xs text-text-label font-mono uppercase mb-1">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => <span key={value} className="badge badge-gray text-xs">{value}</span>)}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-bg-hover p-2">
      <p className="text-[10px] text-text-label font-mono uppercase">{label}</p>
      <p className="text-sm text-text-primary font-semibold truncate">{value}</p>
    </div>
  );
}

function splitList(value: string) {
  return value.split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const [year, month, day] = value.slice(0, 10).split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}
