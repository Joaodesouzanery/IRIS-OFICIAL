"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  AssociadoDocumentoAgendamento,
  Associado,
  DocumentoAssociado,
  DocumentoAssociadoPreview,
  DocumentoAssociadoTipo,
} from "@/types";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { REGULATORIO_TABS } from "@/lib/module-tabs";
import { cn } from "@/lib/utils";
import { AlertTriangle, Calendar, Download, FileText, Loader2, Plus, Printer, Sparkles, Trash2, X } from "lucide-react";
import { useDataSyncContext } from "@/components/DataSyncProvider";

export default function DocumentosAssociadosPage() {
  const { demoEnabled } = useDataSyncContext();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date();
  monthAgo.setMonth(monthAgo.getMonth() - 1);
  const quarterAgo = new Date();
  quarterAgo.setMonth(quarterAgo.getMonth() - 3);

  const [associadoId, setAssociadoId] = useState("");
  const [tipo, setTipo] = useState<DocumentoAssociadoTipo>("boletim_mensal");
  const [periodoInicio, setPeriodoInicio] = useState(monthAgo.toISOString().slice(0, 10));
  const [periodoFim, setPeriodoFim] = useState(today);
  const [preview, setPreview] = useState<DocumentoAssociadoPreview | null>(null);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleEmailInput, setScheduleEmailInput] = useState("");
  const [scheduleEmails, setScheduleEmails] = useState<string[]>([]);
  const [scheduleDay, setScheduleDay] = useState(5);
  const [scheduleError, setScheduleError] = useState("");
  const [vpParagraphs, setVpParagraphs] = useState(["", "", ""]);
  const [listaTripliceManual, setListaTripliceManual] = useState("");
  const [observacoesCuradoria, setObservacoesCuradoria] = useState("");

  const { data: associados = [] } = useQuery({
    queryKey: ["associados"],
    queryFn: () => api.get<Associado[]>("/associados"),
  });

  const selectedAssociado = useMemo(
    () => associados.find((a) => a.id === associadoId) ?? associados[0],
    [associadoId, associados],
  );

  const { data: historico = [], refetch: refetchHistorico } = useQuery({
    queryKey: ["documentos-associado", selectedAssociado?.id],
    queryFn: () => api.get<DocumentoAssociado[]>(`/associados/documentos${selectedAssociado?.id ? `?associado_id=${selectedAssociado.id}` : ""}`),
    enabled: Boolean(selectedAssociado),
  });

  const { data: schedulesData, refetch: refetchSchedules } = useQuery({
    queryKey: ["documentos-associado-schedules", selectedAssociado?.id],
    queryFn: () => api.get<{ schedules: AssociadoDocumentoAgendamento[] }>(`/associados/documentos/schedule${selectedAssociado?.id ? `?associado_id=${selectedAssociado.id}` : ""}`),
    enabled: Boolean(selectedAssociado),
  });
  const schedules = schedulesData?.schedules ?? [];

  const generateMutation = useMutation({
    mutationFn: () => api.post<DocumentoAssociadoPreview>("/associados/documentos", {
      associado_id: selectedAssociado?.id,
      tipo,
      periodo_inicio: periodoInicio,
      periodo_fim: periodoFim,
      save: !demoEnabled,
      vp_paragrafos: vpParagraphs,
      lista_triplice_manual: parseListaTripliceManual(listaTripliceManual),
      observacoes_curadoria: observacoesCuradoria,
    }),
    onSuccess: (data) => {
      setPreview(data);
      refetchHistorico();
    },
  });

  const createScheduleMutation = useMutation({
    mutationFn: () => api.post<{ schedule: AssociadoDocumentoAgendamento }>("/associados/documentos/schedule", {
      associado_id: selectedAssociado?.id,
      tipo,
      dia_mes: scheduleDay,
      destinatarios: scheduleEmails,
    }),
    onSuccess: () => {
      setShowScheduleForm(false);
      setScheduleEmails([]);
      setScheduleEmailInput("");
      setScheduleError("");
      refetchSchedules();
    },
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/associados/documentos/schedule?id=${id}`),
    onSuccess: () => refetchSchedules(),
  });

  function changeTipo(next: DocumentoAssociadoTipo) {
    setTipo(next);
    const start = next === "relatorio_trimestral" ? quarterAgo : monthAgo;
    setPeriodoInicio(start.toISOString().slice(0, 10));
  }

  function downloadHtml() {
    if (!preview) return;
    const blob = new Blob([preview.html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${preview.titulo.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printPdf() {
    if (!preview) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(preview.html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }

  function addScheduleEmail() {
    const email = scheduleEmailInput.trim();
    if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email)) {
      setScheduleError("E-mail inválido");
      return;
    }
    if (scheduleEmails.includes(email)) {
      setScheduleError("E-mail já adicionado");
      return;
    }
    setScheduleEmails((prev) => [...prev, email]);
    setScheduleEmailInput("");
    setScheduleError("");
  }

  function submitSchedule() {
    if (!scheduleEmails.length) {
      setScheduleError("Adicione ao menos um destinatário");
      return;
    }
    createScheduleMutation.mutate();
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <ModuleTabs tabs={REGULATORIO_TABS} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Relatórios do Observatório</h1>
          <p className="text-sm text-text-muted mt-1">
            Gere o Relatório do Associado trimestral e o Relatório Mensal regulatório em HTML e PDF pela impressão do navegador.
          </p>
        </div>
        <button
          onClick={() => generateMutation.mutate()}
          disabled={!selectedAssociado || generateMutation.isPending}
          className="btn-primary"
        >
          {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {demoEnabled ? "Gerar preview" : "Gerar relatório"}
        </button>
      </div>

      {demoEnabled && (
        <div className="card border-warning/30 bg-warning/10 py-2 px-3 text-sm text-warning">
          Modo DEMO ativo: geração e agendamento de relatórios ficam bloqueados em somente leitura.
        </div>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
        <div className="space-y-4">
          <div className="card space-y-3">
            <p className="section-label">Filtros do relatório</p>
            <label className="space-y-1 block">
              <span className="text-xs text-text-label font-mono uppercase">Associado</span>
              <select className="input" value={selectedAssociado?.id ?? ""} onChange={(e) => setAssociadoId(e.target.value)}>
                {associados.map((a) => (
                  <option key={a.id} value={a.id}>{a.nome}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => changeTipo("boletim_mensal")}
                className={cn("btn-secondary justify-center", tipo === "boletim_mensal" && "border-brand text-brand")}
              >
                Mensal regulatorio
              </button>
              <button
                onClick={() => changeTipo("relatorio_trimestral")}
                className={cn("btn-secondary justify-center", tipo === "relatorio_trimestral" && "border-brand text-brand")}
              >
                Associado trimestral
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 block">
                <span className="text-xs text-text-label font-mono uppercase">Início</span>
                <input className="input" type="date" value={periodoInicio} onChange={(e) => setPeriodoInicio(e.target.value)} />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs text-text-label font-mono uppercase">Fim</span>
                <input className="input" type="date" value={periodoFim} onChange={(e) => setPeriodoFim(e.target.value)} />
              </label>
            </div>
          </div>

          {selectedAssociado && (
            <div className="card space-y-3">
              <p className="section-label">Recorte</p>
              <p className="text-sm font-medium text-text-primary">{selectedAssociado.setor}</p>
              <p className="text-xs text-text-muted">{selectedAssociado.descricao}</p>
              <TagList label="Agencias" values={selectedAssociado.agencia_siglas} />
              <TagList label="Ministérios" values={selectedAssociado.ministerios} />
              <TagList label="Palavras-chave" values={selectedAssociado.palavras_chave.slice(0, 8)} />
            </div>
          )}

          <div className="card space-y-3">
            <p className="section-label">Curadoria manual da edição</p>
            <p className="text-xs text-text-muted">
              Estes campos ficam salvos somente no relatório gerado.
            </p>
            {vpParagraphs.map((value, index) => (
              <textarea
                key={index}
                className="input min-h-20"
                value={value}
                onChange={(event) => setVpParagraphs((prev) => prev.map((item, i) => i === index ? event.target.value : item))}
                placeholder={`Visão VP - parágrafo ${index + 1}`}
              />
            ))}
            <textarea
              className="input min-h-24"
              value={listaTripliceManual}
              onChange={(event) => setListaTripliceManual(event.target.value)}
              placeholder="Lista tríplice manual: Nome; Cargo; Fonte URL (uma linha por candidato)"
            />
            <textarea
              className="input min-h-20"
              value={observacoesCuradoria}
              onChange={(event) => setObservacoesCuradoria(event.target.value)}
              placeholder="Observações de curadoria para o relatório"
            />
          </div>

          <div className="card space-y-3">
            <p className="section-label">Histórico de relatórios</p>
            {historico.length === 0 ? (
              <p className="text-sm text-text-muted">Nenhum relatório salvo ainda.</p>
            ) : (
              historico.map((doc) => (
                <div key={doc.id} className="border border-border rounded-card p-3">
                  <p className="text-sm text-text-primary font-medium">{doc.titulo}</p>
                  <p className="text-xs text-text-muted mt-1">
                    {doc.tipo} · {new Date(doc.created_at).toLocaleDateString("pt-BR")} · {doc.status_revisao}
                  </p>
                  <a className="btn-secondary text-xs mt-2" href={`/api/v1/associados/documentos/${doc.id}/html`}>
                    <Download className="w-3.5 h-3.5" />
                    HTML salvo
                  </a>
                </div>
              ))
            )}
          </div>

          <div className="card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="section-label">Agendamentos</p>
              <button onClick={() => setShowScheduleForm((v) => !v)} className="btn-secondary text-xs" disabled={demoEnabled}>
                <Plus className="w-3.5 h-3.5" />
                Novo
              </button>
            </div>

            {showScheduleForm && (
              <div className="space-y-3 border border-border rounded-card p-3 bg-bg-hover">
                <label className="space-y-1 block">
                  <span className="text-xs text-text-label font-mono uppercase">Dia do mes</span>
                  <select className="input" value={scheduleDay} onChange={(e) => setScheduleDay(Number(e.target.value))}>
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>
                <div className="space-y-2">
                  <span className="text-xs text-text-label font-mono uppercase">Destinatários</span>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1"
                      type="email"
                      placeholder="email@exemplo.com"
                      value={scheduleEmailInput}
                      onChange={(e) => { setScheduleEmailInput(e.target.value); setScheduleError(""); }}
                      onKeyDown={(e) => e.key === "Enter" && addScheduleEmail()}
                    />
                    <button onClick={addScheduleEmail} className="btn-secondary text-xs">Add</button>
                  </div>
                  {scheduleError && <p className="text-xs text-error">{scheduleError}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    {scheduleEmails.map((email) => (
                      <span key={email} className="badge badge-gray text-xs flex items-center gap-1">
                        {email}
                        <button onClick={() => setScheduleEmails((prev) => prev.filter((item) => item !== email))}>
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={submitSchedule}
                  disabled={demoEnabled || createScheduleMutation.isPending}
                  className="btn-primary w-full justify-center text-xs"
                >
                  {createScheduleMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Salvar agendamento
                </button>
              </div>
            )}

            {schedules.length === 0 ? (
              <p className="text-sm text-text-muted">Nenhum agendamento para este associado.</p>
            ) : schedules.map((schedule) => (
              <div key={schedule.id} className="border border-border rounded-card p-3 flex items-start gap-3">
                <Calendar className="w-4 h-4 text-brand mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary font-medium">
                    {schedule.tipo === "relatorio_trimestral" ? "Trimestral" : "Mensal"} dia {schedule.dia_mes}
                  </p>
                  <p className="text-xs text-text-muted truncate">
                    Próximo: {new Date(schedule.proximo_envio).toLocaleDateString("pt-BR")} · {schedule.destinatarios.join(", ")}
                  </p>
                </div>
                <button
                  onClick={() => deleteScheduleMutation.mutate(schedule.id)}
                  disabled={demoEnabled || deleteScheduleMutation.isPending}
                  className="w-7 h-7 flex items-center justify-center rounded text-text-label hover:text-error hover:bg-error/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-bg-hover">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand" />
              <p className="text-xs text-text-muted font-mono uppercase tracking-wider">Preview</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={downloadHtml} disabled={!preview} className="btn-secondary text-xs">
                <Download className="w-3.5 h-3.5" />
                HTML
              </button>
              <button onClick={printPdf} disabled={!preview} className="btn-primary text-xs">
                <Printer className="w-3.5 h-3.5" />
                PDF
              </button>
            </div>
          </div>
          {preview ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 p-4 border-b border-border">
                <Metric label="Decisões" value={preview.metricas.deliberacoes} />
                <Metric label="Notícias" value={preview.metricas.noticias} />
                <Metric label="Mandatos" value={preview.metricas.mandatos} />
                <Metric label="Lista" value={preview.metricas.lista_triplice} />
                <Metric label="IA" value={`${Math.round(preview.metricas.confianca_cenarios * 100)}%`} />
              </div>
              {preview.qualidade.pendencias.length > 0 && (
                <div className="m-4 border border-warning/30 bg-warning/10 rounded-card p-3">
                  <div className="flex items-center gap-2 text-warning mb-2">
                    <AlertTriangle className="w-4 h-4" />
                    <p className="text-sm font-medium">Pendências antes de circular · {preview.qualidade.score}/100</p>
                  </div>
                  <ul className="space-y-1">
                    {preview.qualidade.pendencias.map((pendencia) => (
                      <li key={pendencia} className="text-xs text-text-secondary">{pendencia}</li>
                    ))}
                  </ul>
                </div>
              )}
              <iframe
                srcDoc={preview.html}
                className="w-full border-0 bg-white"
                style={{ height: "72vh" }}
                title="Documento do associado"
                sandbox="allow-same-origin allow-popups"
              />
            </>
          ) : (
            <div className="h-[72vh] flex items-center justify-center text-center p-8">
              <div>
                <FileText className="w-10 h-10 mx-auto text-text-muted mb-3" />
                <p className="text-sm text-text-primary font-medium">Gere um relatório para visualizar o preview.</p>
                <p className="text-xs text-text-muted mt-1">A primeira versão salva rascunho, permite HTML e PDF via impressão.</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function TagList({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <p className="text-xs text-text-label font-mono uppercase mb-1">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => <span key={v} className="badge badge-gray text-xs">{v}</span>)}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-border rounded-card p-2">
      <p className="text-[10px] text-text-label font-mono uppercase">{label}</p>
      <p className="text-lg text-text-primary font-semibold">{value}</p>
    </div>
  );
}

function parseListaTripliceManual(value: string) {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [nome = "", cargo = "Diretoria", fonte_url = ""] = line.split(";").map((part) => part.trim());
      return {
        nome_candidato: nome,
        cargo: cargo || "Diretoria",
        fonte_url: fonte_url || null,
      };
    })
    .filter((item) => item.nome_candidato);
}
