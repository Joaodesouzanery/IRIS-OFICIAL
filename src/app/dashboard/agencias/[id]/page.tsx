"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, DatabaseZap, Edit2, Plus, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { calcularMandato } from "@/lib/mandatos";
import { cn, formatDate } from "@/lib/utils";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { CONFIG_TABS } from "@/lib/module-tabs";
import { useDataSyncContext } from "@/components/DataSyncProvider";
import type { Agencia, Diretor, ListaTripliceItem } from "@/types";

type DiretorForm = {
  id?: string;
  nome: string;
  cargo: string;
  situacao: "titular" | "substituto" | "interino" | "inativo" | "designado";
  data_posse: string;
  data_fim_mandato: string;
  ato_nomeacao: string;
  publicacao_dou: string;
  foto_url: string;
  minibio: string;
  curriculo_url: string;
  email: string;
  telefone: string;
  fonte_dado: "automatico" | "manual" | "verificado";
};

type ListaForm = {
  id?: string;
  cargo_vaga: string;
  candidatos_texto: string;
  status: "em_analise" | "nomeado" | "arquivado";
  data_publicacao: string;
  fonte: string;
  observacoes: string;
};

const EMPTY_DIRETOR: DiretorForm = {
  nome: "",
  cargo: "",
  situacao: "titular",
  data_posse: "",
  data_fim_mandato: "",
  ato_nomeacao: "",
  publicacao_dou: "",
  foto_url: "",
  minibio: "",
  curriculo_url: "",
  email: "",
  telefone: "",
  fonte_dado: "manual",
};

const EMPTY_LISTA: ListaForm = {
  cargo_vaga: "",
  candidatos_texto: "",
  status: "em_analise",
  data_publicacao: "",
  fonte: "",
  observacoes: "",
};

export default function AgenciaDetalhePage({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const { demoEnabled } = useDataSyncContext();
  const [diretorForm, setDiretorForm] = useState<DiretorForm | null>(null);
  const [listaForm, setListaForm] = useState<ListaForm | null>(null);
  const [editingAgencia, setEditingAgencia] = useState(false);

  const { data: agencia } = useQuery({
    queryKey: ["agencia", params.id],
    queryFn: () => api.get<Agencia>(`/agencias/${params.id}`),
  });
  const { data: diretores } = useQuery({
    queryKey: ["agencia", params.id, "diretores"],
    queryFn: () => api.get<Diretor[]>(`/agencias/${params.id}/diretores`),
  });
  const { data: listaTriplice } = useQuery({
    queryKey: ["agencia", params.id, "lista-triplice"],
    queryFn: () => api.get<ListaTripliceItem[]>(`/agencias/${params.id}/lista-triplice`),
  });

  const importMutation = useMutation({
    mutationFn: () => api.post<{ diretores: unknown[]; lista_triplice: unknown[] }>(`/agencias/${params.id}/importar`),
    onSuccess: () => invalidateAll(qc, params.id),
  });

  const saveAgenciaMutation = useMutation({
    mutationFn: (body: Partial<Agencia>) => api.patch<Agencia>(`/agencias/${params.id}`, body),
    onSuccess: () => {
      invalidateAll(qc, params.id);
      setEditingAgencia(false);
    },
  });

  const saveDiretorMutation = useMutation({
    mutationFn: (body: DiretorForm) => {
      const payload = diretorPayload(body);
      return body.id
        ? api.patch<Diretor>(`/agencias/diretores/${body.id}`, payload)
        : api.post<Diretor>(`/agencias/${params.id}/diretores`, payload);
    },
    onSuccess: () => {
      invalidateAll(qc, params.id);
      setDiretorForm(null);
    },
  });

  const deleteDiretorMutation = useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/agencias/diretores/${id}`),
    onSuccess: () => invalidateAll(qc, params.id),
  });

  const saveListaMutation = useMutation({
    mutationFn: (body: ListaForm) => {
      const payload = listaPayload(body);
      return body.id
        ? api.patch<ListaTripliceItem>(`/agencias/lista-triplice/${body.id}`, payload)
        : api.post<ListaTripliceItem>(`/agencias/${params.id}/lista-triplice`, payload);
    },
    onSuccess: () => {
      invalidateAll(qc, params.id);
      setListaForm(null);
    },
  });

  const deleteListaMutation = useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/agencias/lista-triplice/${id}`),
    onSuccess: () => invalidateAll(qc, params.id),
  });

  const ativos = useMemo(() => (diretores ?? []).filter((dir) => dir.ativo !== false && dir.situacao !== "inativo"), [diretores]);
  const inativos = useMemo(() => (diretores ?? []).filter((dir) => dir.ativo === false || dir.situacao === "inativo"), [diretores]);
  const alertas = Array.isArray(agencia?.metadata?.alertas) ? agencia?.metadata?.alertas as string[] : [];

  if (!agencia) return <div className="card text-sm text-text-muted">Carregando agência...</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <ModuleTabs tabs={CONFIG_TABS} />
      <Link href="/dashboard/agencias" className="btn-secondary w-fit">
        <ArrowLeft className="w-4 h-4" />
        Voltar
      </Link>

      <section className="card space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-text-primary">{agencia.sigla}</h1>
              <span className={cn("badge text-xs", agencia.tipo === "estadual" ? "bg-info/10 text-info" : "badge-green")}>
                {agencia.tipo ?? "federal"}
              </span>
              <span className="badge text-xs">{agencia.status ?? (agencia.ativo ? "ativa" : "inativa")}</span>
            </div>
            <p className="text-sm text-text-muted mt-1">{agencia.nome_completo ?? agencia.nome}</p>
            <p className="text-xs text-text-label mt-1">{agencia.esfera ?? "-"} · {agencia.ministerio_vinculado ?? "-"}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn-secondary" onClick={() => setEditingAgencia(true)} disabled={demoEnabled}>
              <Edit2 className="w-4 h-4" />
              Editar agência
            </button>
            <button className="btn-primary" onClick={() => importMutation.mutate()} disabled={demoEnabled || importMutation.isPending}>
              <DatabaseZap className="w-4 h-4" />
              {importMutation.isPending ? "Importando..." : "Importar Dados"}
            </button>
          </div>
        </div>
        {importMutation.error ? <p className="text-xs text-error">{importMutation.error instanceof Error ? importMutation.error.message : "Erro ao importar"}</p> : null}
      </section>

      {alertas.length ? (
        <section className="card border-warning/30 bg-warning/10">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-text-primary">Alertas da agência</p>
              <ul className="mt-2 space-y-1">
                {alertas.map((alerta, index) => <li key={index} className="text-sm text-warning">{alerta}</li>)}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="section-label">Diretores ativos</p>
          <button className="btn-secondary text-xs" onClick={() => setDiretorForm(EMPTY_DIRETOR)} disabled={demoEnabled}>
            <Plus className="w-4 h-4" />
            Adicionar Diretor
          </button>
        </div>
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-hover text-text-muted">
                <tr>
                  <Th>Nome</Th>
                  <Th>Cargo</Th>
                  <Th>Posse</Th>
                  <Th>Fim</Th>
                  <Th>% Mandato</Th>
                  <Th>Situação</Th>
                  <Th>Ações</Th>
                </tr>
              </thead>
              <tbody>
                {ativos.map((diretor) => <DiretorRow key={diretor.id} diretor={diretor} onEdit={setDiretorForm} onDelete={(id) => deleteDiretorMutation.mutate(id)} disabled={demoEnabled} />)}
                {ativos.length === 0 ? <tr><td colSpan={7} className="p-5 text-center text-text-muted">Nenhum diretor ativo cadastrado.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="section-label">Lista Tríplice / Indicações</p>
          <button className="btn-secondary text-xs" onClick={() => setListaForm(EMPTY_LISTA)} disabled={demoEnabled}>
            <Plus className="w-4 h-4" />
            Adicionar
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {(listaTriplice ?? []).map((item) => (
            <div key={item.id} className="card space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-text-primary">{item.cargo_vaga ?? item.cargo}</p>
                  <p className="text-xs text-text-muted">{item.status ?? item.etapa}</p>
                </div>
                <div className="flex gap-1">
                  <button className="icon-btn" onClick={() => setListaForm(listaToForm(item))} disabled={demoEnabled} aria-label="Editar">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button className="icon-btn text-error" onClick={() => deleteListaMutation.mutate(item.id)} disabled={demoEnabled} aria-label="Excluir">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-text-muted">{item.observacoes ?? "Sem observações."}</p>
              <p className="text-[11px] text-text-label">{item.fonte ?? item.fonte_url ?? "Fonte não informada"}</p>
            </div>
          ))}
          {(listaTriplice ?? []).length === 0 ? <div className="card text-sm text-text-muted">Nenhum item cadastrado.</div> : null}
        </div>
      </section>

      {inativos.length ? (
        <section className="space-y-3">
          <p className="section-label">Histórico de diretores</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {inativos.map((diretor) => (
              <div key={diretor.id} className="card flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-text-primary">{diretor.nome}</p>
                  <p className="text-xs text-text-muted">{diretor.cargo ?? "Diretor"} · {formatDate(diretor.data_posse)} → {formatDate(diretor.data_fim_mandato)}</p>
                </div>
                <button className="icon-btn" onClick={() => setDiretorForm(diretorToForm(diretor))} disabled={demoEnabled} aria-label="Editar">
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {editingAgencia ? (
        <AgenciaModal
          agencia={agencia}
          onClose={() => setEditingAgencia(false)}
          onSave={(body) => saveAgenciaMutation.mutate(body)}
          pending={saveAgenciaMutation.isPending}
        />
      ) : null}
      {diretorForm ? (
        <DiretorModal
          form={diretorForm}
          setForm={setDiretorForm}
          onClose={() => setDiretorForm(null)}
          onSave={() => saveDiretorMutation.mutate(diretorForm)}
          pending={saveDiretorMutation.isPending}
        />
      ) : null}
      {listaForm ? (
        <ListaModal
          form={listaForm}
          setForm={setListaForm}
          onClose={() => setListaForm(null)}
          onSave={() => saveListaMutation.mutate(listaForm)}
          pending={saveListaMutation.isPending}
        />
      ) : null}
    </div>
  );
}

function DiretorRow({ diretor, onEdit, onDelete, disabled }: { diretor: Diretor; onEdit: (form: DiretorForm) => void; onDelete: (id: string) => void; disabled: boolean }) {
  const mandato = calcularMandato(diretor.data_posse, diretor.data_fim_mandato);
  const badge = mandato.status === "vencido" ? "bg-error/10 text-error" : mandato.status === "vencendo_em_breve" ? "bg-warning/10 text-warning" : diretor.situacao === "interino" ? "bg-warning/10 text-warning" : "badge-green";
  return (
    <tr className="border-t border-border">
      <Td>{diretor.nome}</Td>
      <Td>{diretor.cargo ?? "-"}</Td>
      <Td>{formatDate(diretor.data_posse)}</Td>
      <Td>{formatDate(diretor.data_fim_mandato)}</Td>
      <Td>
        <div className="min-w-32">
          <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
            <div className="h-full bg-brand" style={{ width: `${mandato.percentualConcluido ?? 0}%` }} />
          </div>
          <p className="text-[11px] text-text-label mt-1">{mandato.texto}</p>
        </div>
      </Td>
      <Td><span className={cn("badge text-xs", badge)}>{diretor.situacao ?? "titular"}</span></Td>
      <Td>
        <div className="flex gap-1">
          <button className="icon-btn" onClick={() => onEdit(diretorToForm(diretor))} disabled={disabled} aria-label="Editar">
            <Edit2 className="w-4 h-4" />
          </button>
          <button className="icon-btn text-error" onClick={() => onDelete(diretor.id)} disabled={disabled} aria-label="Excluir">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </Td>
    </tr>
  );
}

function AgenciaModal({ agencia, onClose, onSave, pending }: { agencia: Agencia; onClose: () => void; onSave: (body: Partial<Agencia>) => void; pending: boolean }) {
  const [form, setForm] = useState({
    sigla: agencia.sigla,
    nome: agencia.nome,
    nome_completo: agencia.nome_completo ?? "",
    tipo: agencia.tipo ?? "federal",
    esfera: agencia.esfera ?? "",
    ministerio_vinculado: agencia.ministerio_vinculado ?? "",
    url_institucional: agencia.url_institucional ?? "",
    url_diretores: agencia.url_diretores ?? "",
    estado: agencia.estado ?? "",
    status: agencia.status ?? "ativa",
  });
  return (
    <Modal title="Editar agência" onClose={onClose}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Object.entries(form).map(([key, value]) => (
          <label key={key} className="block">
            <span className="text-xs text-text-muted mb-1 block">{labelize(key)}</span>
            <input className="input w-full" value={String(value ?? "")} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
          </label>
        ))}
      </div>
      <ModalActions onClose={onClose} onSave={() => onSave(form as Partial<Agencia>)} pending={pending} />
    </Modal>
  );
}

function DiretorModal({ form, setForm, onClose, onSave, pending }: { form: DiretorForm; setForm: (form: DiretorForm) => void; onClose: () => void; onSave: () => void; pending: boolean }) {
  const update = <K extends keyof DiretorForm>(key: K, value: DiretorForm[K]) => setForm({ ...form, [key]: value });
  return (
    <Modal title={form.id ? "Editar diretor" : "Adicionar diretor"} onClose={onClose}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="Nome completo" value={form.nome} onChange={(v) => update("nome", v)} />
        <Input label="Cargo" value={form.cargo} onChange={(v) => update("cargo", v)} />
        <Select label="Situação" value={form.situacao} onChange={(v) => update("situacao", v as DiretorForm["situacao"])} options={["titular", "substituto", "interino", "inativo", "designado"]} />
        <Select label="Fonte do dado" value={form.fonte_dado} onChange={(v) => update("fonte_dado", v as DiretorForm["fonte_dado"])} options={["manual", "verificado", "automatico"]} />
        <Input label="Data de posse" type="date" value={form.data_posse} onChange={(v) => update("data_posse", v)} />
        <Input label="Fim do mandato" type="date" value={form.data_fim_mandato} onChange={(v) => update("data_fim_mandato", v)} />
        <Input label="Ato de nomeação" value={form.ato_nomeacao} onChange={(v) => update("ato_nomeacao", v)} />
        <Input label="Publicação DOU/DOE" type="date" value={form.publicacao_dou} onChange={(v) => update("publicacao_dou", v)} />
        <Input label="Foto URL" value={form.foto_url} onChange={(v) => update("foto_url", v)} />
        <Input label="Currículo URL" value={form.curriculo_url} onChange={(v) => update("curriculo_url", v)} />
        <Input label="Email" value={form.email} onChange={(v) => update("email", v)} />
        <Input label="Telefone" value={form.telefone} onChange={(v) => update("telefone", v)} />
        <label className="block md:col-span-2">
          <span className="text-xs text-text-muted mb-1 block">Minibio</span>
          <textarea className="input w-full min-h-24" value={form.minibio} onChange={(e) => update("minibio", e.target.value)} />
        </label>
      </div>
      <ModalActions onClose={onClose} onSave={onSave} pending={pending} disabled={!form.nome} />
    </Modal>
  );
}

function ListaModal({ form, setForm, onClose, onSave, pending }: { form: ListaForm; setForm: (form: ListaForm) => void; onClose: () => void; onSave: () => void; pending: boolean }) {
  const update = <K extends keyof ListaForm>(key: K, value: ListaForm[K]) => setForm({ ...form, [key]: value });
  return (
    <Modal title={form.id ? "Editar lista tríplice" : "Adicionar lista tríplice"} onClose={onClose}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="Cargo/vaga" value={form.cargo_vaga} onChange={(v) => update("cargo_vaga", v)} />
        <Select label="Status" value={form.status} onChange={(v) => update("status", v as ListaForm["status"])} options={["em_analise", "nomeado", "arquivado"]} />
        <Input label="Data de publicação" type="date" value={form.data_publicacao} onChange={(v) => update("data_publicacao", v)} />
        <Input label="Fonte" value={form.fonte} onChange={(v) => update("fonte", v)} />
        <label className="block md:col-span-2">
          <span className="text-xs text-text-muted mb-1 block">Candidatos, um por linha</span>
          <textarea className="input w-full min-h-20" value={form.candidatos_texto} onChange={(e) => update("candidatos_texto", e.target.value)} />
        </label>
        <label className="block md:col-span-2">
          <span className="text-xs text-text-muted mb-1 block">Observações</span>
          <textarea className="input w-full min-h-24" value={form.observacoes} onChange={(e) => update("observacoes", e.target.value)} />
        </label>
      </div>
      <ModalActions onClose={onClose} onSave={onSave} pending={pending} disabled={!form.cargo_vaga} />
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="card w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ onClose, onSave, pending, disabled }: { onClose: () => void; onSave: () => void; pending: boolean; disabled?: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button className="btn-secondary" onClick={onClose}>Cancelar</button>
      <button className="btn-primary" onClick={onSave} disabled={pending || disabled}>{pending ? "Salvando..." : "Salvar"}</button>
    </div>
  );
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-text-muted mb-1 block">{label}</span>
      <input className="input w-full" type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-text-muted mb-1 block">{label}</span>
      <select className="select w-full" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-4 py-3 font-medium whitespace-nowrap">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-top text-text-secondary">{children}</td>;
}

function diretorToForm(diretor: Diretor): DiretorForm {
  return {
    id: diretor.id,
    nome: diretor.nome,
    cargo: diretor.cargo ?? "",
    situacao: diretor.situacao ?? "titular",
    data_posse: diretor.data_posse ?? "",
    data_fim_mandato: diretor.data_fim_mandato ?? "",
    ato_nomeacao: diretor.ato_nomeacao ?? "",
    publicacao_dou: diretor.publicacao_dou ?? "",
    foto_url: diretor.foto_url ?? "",
    minibio: diretor.minibio ?? "",
    curriculo_url: diretor.curriculo_url ?? "",
    email: diretor.email ?? "",
    telefone: diretor.telefone ?? "",
    fonte_dado: diretor.fonte_dado ?? "manual",
  };
}

function listaToForm(item: ListaTripliceItem): ListaForm {
  const candidatos = Array.isArray(item.candidatos)
    ? item.candidatos.map((candidate: any) => typeof candidate === "string" ? candidate : candidate?.nome).filter(Boolean).join("\n")
    : "";
  return {
    id: item.id,
    cargo_vaga: item.cargo_vaga ?? item.cargo,
    candidatos_texto: candidatos,
    status: item.status ?? "em_analise",
    data_publicacao: item.data_publicacao ?? item.data_evento ?? "",
    fonte: item.fonte ?? item.fonte_url ?? "",
    observacoes: item.observacoes ?? "",
  };
}

function diretorPayload(form: DiretorForm) {
  const { id: _id, ...payload } = form;
  return payload;
}

function listaPayload(form: ListaForm) {
  const { id: _id, candidatos_texto, ...payload } = form;
  return {
    ...payload,
    candidatos: candidatos_texto.split("\n").map((nome) => nome.trim()).filter(Boolean).map((nome) => ({ nome })),
  };
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>, agenciaId: string) {
  qc.invalidateQueries({ queryKey: ["agencia", agenciaId] });
  qc.invalidateQueries({ queryKey: ["agencias"] });
  qc.invalidateQueries({ queryKey: ["diretores"] });
  qc.invalidateQueries({ queryKey: ["mandatos"] });
}

function labelize(value: string) {
  return value.replace(/_/g, " ");
}
