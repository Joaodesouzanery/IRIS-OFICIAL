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
import { AlertTriangle, Calendar, Download, FileText, FileType, Loader2, Pencil, Plus, Printer, Save, Sparkles, Trash2, X } from "lucide-react";
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
  const [vpFotoUrl, setVpFotoUrl] = useState("");
  const [vpMinibio, setVpMinibio] = useState("");
  const [listaTripliceManual, setListaTripliceManual] = useState("");
  const [observacoesCuradoria, setObservacoesCuradoria] = useState("");
  const [sumarioExecutivo, setSumarioExecutivo] = useState("");
  const [perfisInfluencias, setPerfisInfluencias] = useState("");
  const [correlacaoForcas, setCorrelacaoForcas] = useState("");
  const [agendasText, setAgendasText] = useState("");
  const [conclusao, setConclusao] = useState("");
  const [monitoramento, setMonitoramento] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statusRevisao, setStatusRevisao] = useState("rascunho");
  const [savedDocId, setSavedDocId] = useState<string | null>(null);

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

  function curadoriaPayload() {
    return {
      vp_paragrafos: vpParagraphs,
      vp_foto_url: vpFotoUrl || null,
      vp_minibio: vpMinibio || null,
      lista_triplice_manual: parseListaTripliceManual(listaTripliceManual),
      observacoes_curadoria: observacoesCuradoria,
      sumario_executivo: sumarioExecutivo || null,
      perfis_influencias: perfisInfluencias || null,
      correlacao_forcas: correlacaoForcas || null,
      agendas: agendasText.split(/\n+/).map((a) => a.trim()).filter(Boolean),
      conclusao: conclusao || null,
      monitoramento: monitoramento || null,
    };
  }

  const generateMutation = useMutation({
    mutationFn: () => api.post<DocumentoAssociadoPreview>("/associados/documentos", {
      associado_id: selectedAssociado?.id,
      tipo,
      periodo_inicio: periodoInicio,
      periodo_fim: periodoFim,
      save: !demoEnabled,
      ...curadoriaPayload(),
    }),
    onSuccess: (data) => {
      setPreview(data);
      setSavedDocId((data as { documento_id?: string }).documento_id ?? null);
      refetchHistorico();
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => api.patch<DocumentoAssociadoPreview>(`/associados/documentos/${editingId}`, {
      status_revisao: statusRevisao,
      ...curadoriaPayload(),
    }),
    onSuccess: (data) => {
      setPreview(data);
      setSavedDocId(editingId);
      refetchHistorico();
    },
  });

  function resetCuradoria() {
    setEditingId(null);
    setStatusRevisao("rascunho");
    setVpParagraphs(["", "", ""]);
    setVpFotoUrl("");
    setVpMinibio("");
    setListaTripliceManual("");
    setObservacoesCuradoria("");
    setSumarioExecutivo("");
    setPerfisInfluencias("");
    setCorrelacaoForcas("");
    setAgendasText("");
    setConclusao("");
    setMonitoramento("");
  }

  function startEditing(doc: DocumentoAssociado) {
    const inputs = (doc.qualidade as { inputs_manuais?: Record<string, any> } | undefined)?.inputs_manuais ?? {};
    setEditingId(doc.id);
    setStatusRevisao(doc.status_revisao ?? "rascunho");
    setTipo(doc.tipo);
    setPeriodoInicio(doc.periodo_inicio.slice(0, 10));
    setPeriodoFim(doc.periodo_fim.slice(0, 10));
    const paras = Array.isArray(inputs.vp_paragrafos) ? inputs.vp_paragrafos : [];
    setVpParagraphs([paras[0] ?? "", paras[1] ?? "", paras[2] ?? ""]);
    setVpFotoUrl(inputs.vp_foto_url ?? "");
    setVpMinibio(inputs.vp_minibio ?? "");
    setListaTripliceManual(
      Array.isArray(inputs.lista_triplice_manual)
        ? inputs.lista_triplice_manual.map((l: any) => [l.nome_candidato, l.cargo, l.fonte_url].filter(Boolean).join("; ")).join("\n")
        : "",
    );
    setObservacoesCuradoria(inputs.observacoes_curadoria ?? "");
    setSumarioExecutivo(inputs.sumario_executivo ?? "");
    setPerfisInfluencias(inputs.perfis_influencias ?? "");
    setCorrelacaoForcas(inputs.correlacao_forcas ?? "");
    setAgendasText(Array.isArray(inputs.agendas) ? inputs.agendas.join("\n") : "");
    setConclusao(inputs.conclusao ?? "");
    setMonitoramento(inputs.monitoramento ?? "");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const saveVpMutation = useMutation({
    mutationFn: () => api.patch(`/associados/${selectedAssociado?.id}`, {
      vp_foto_url: vpFotoUrl || null,
      vp_minibio: vpMinibio || null,
    }),
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

  const [pdfLoading, setPdfLoading] = useState(false);
  async function downloadPdf() {
    if (!preview) return;
    // Em DEMO o endpoint de PDF nativo é bloqueado: cai para a impressão do navegador.
    if (demoEnabled) {
      printPdf();
      return;
    }
    setPdfLoading(true);
    try {
      const slug = preview.titulo.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const blob = await api.postBlob("/associados/documentos/pdf", { html: preview.html, filename: slug });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Falha no headless (cold start/egress): impressão do navegador como alternativa.
      printPdf();
    } finally {
      setPdfLoading(false);
    }
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
            Gere o Relatório do Associado (Trimestral) e o Boletim Mensal (Deliberações) em HTML e PDF nativo.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {editingId && (
            <>
              <select className="input w-36 text-xs h-9 py-0" value={statusRevisao} onChange={(e) => setStatusRevisao(e.target.value)}>
                <option value="rascunho">Rascunho</option>
                <option value="revisado">Revisado</option>
                <option value="aprovado">Aprovado</option>
                <option value="arquivado">Arquivado</option>
              </select>
              <button onClick={resetCuradoria} className="btn-secondary text-xs" title="Cancelar edição e voltar a gerar novo">
                <X className="w-3.5 h-3.5" /> Cancelar edição
              </button>
            </>
          )}
          {editingId ? (
            <button
              onClick={() => updateMutation.mutate()}
              disabled={demoEnabled || updateMutation.isPending}
              className="btn-primary"
            >
              {updateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar rascunho (nova versão)
            </button>
          ) : (
            <button
              onClick={() => generateMutation.mutate()}
              disabled={!selectedAssociado || generateMutation.isPending}
              className="btn-primary"
            >
              {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {demoEnabled ? "Gerar preview" : "Gerar relatório"}
            </button>
          )}
        </div>
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
                className={cn("btn-secondary justify-center text-xs", tipo === "boletim_mensal" && "border-brand text-brand")}
              >
                Boletim Mensal (Deliberações)
              </button>
              <button
                onClick={() => changeTipo("relatorio_trimestral")}
                className={cn("btn-secondary justify-center text-xs", tipo === "relatorio_trimestral" && "border-brand text-brand")}
              >
                Relatório Trimestral
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
            <input
              className="input"
              value={vpFotoUrl}
              onChange={(event) => setVpFotoUrl(event.target.value)}
              placeholder="Foto do VP (URL https://...)"
            />
            <textarea
              className="input min-h-20"
              value={vpMinibio}
              onChange={(event) => setVpMinibio(event.target.value)}
              placeholder="Mini bio do VP (usada quando não houver os 3 parágrafos)"
            />
            <button
              type="button"
              onClick={() => saveVpMutation.mutate()}
              disabled={demoEnabled || !selectedAssociado || saveVpMutation.isPending}
              className="btn-secondary text-xs w-full justify-center"
            >
              {saveVpMutation.isPending ? "Salvando..." : saveVpMutation.isSuccess ? "Foto/mini bio salvas no cadastro ✓" : "Salvar foto/mini bio no cadastro do associado"}
            </button>
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
            <textarea className="input min-h-24" value={sumarioExecutivo} onChange={(e) => setSumarioExecutivo(e.target.value)} placeholder="Sumário executivo (parágrafos separados por linha em branco)" />
            <textarea className="input min-h-24" value={perfisInfluencias} onChange={(e) => setPerfisInfluencias(e.target.value)} placeholder="Mapeamento de perfis e influências (trimestral)" />
            <textarea className="input min-h-20" value={correlacaoForcas} onChange={(e) => setCorrelacaoForcas(e.target.value)} placeholder="Correlação de forças interna (trimestral)" />
            <textarea className="input min-h-20" value={agendasText} onChange={(e) => setAgendasText(e.target.value)} placeholder="Agendas regulatórias: uma por linha — Tema; Prioridade (Alta/Média/Baixa)" />
            <textarea className="input min-h-20" value={conclusao} onChange={(e) => setConclusao(e.target.value)} placeholder="Conclusão" />
            <textarea className="input min-h-20" value={monitoramento} onChange={(e) => setMonitoramento(e.target.value)} placeholder="Monitoramento regulatório e jurídico (opcional)" />
          </div>

          <div className="card space-y-3">
            <p className="section-label">Histórico de relatórios</p>
            {historico.length === 0 ? (
              <p className="text-sm text-text-muted">Nenhum relatório salvo ainda.</p>
            ) : (
              historico.map((doc) => (
                <div key={doc.id} className={cn("border rounded-card p-3", editingId === doc.id ? "border-brand" : "border-border")}>
                  <p className="text-sm text-text-primary font-medium">{doc.titulo}</p>
                  <p className="text-xs text-text-muted mt-1">
                    {doc.tipo} · {new Date(doc.created_at).toLocaleDateString("pt-BR")} · {doc.status_revisao}{doc.versao ? ` · v${doc.versao}` : ""}
                  </p>
                  <div className="flex items-center flex-wrap gap-2 mt-2">
                    <button className="btn-secondary text-xs" disabled={demoEnabled} onClick={() => startEditing(doc)}>
                      <Pencil className="w-3.5 h-3.5" />
                      Editar rascunho
                    </button>
                    <a className="btn-secondary text-xs" href={`/api/v1/associados/documentos/${doc.id}/html`}>
                      <Download className="w-3.5 h-3.5" /> HTML
                    </a>
                    <a className="btn-secondary text-xs" href={`/api/v1/associados/documentos/${doc.id}/pdf`}>
                      <Download className="w-3.5 h-3.5" /> PDF
                    </a>
                    <a className="btn-secondary text-xs" href={`/api/v1/associados/documentos/${doc.id}/word`}>
                      <FileText className="w-3.5 h-3.5" /> Word
                    </a>
                    <a className="btn-secondary text-xs" href={`/api/v1/associados/documentos/${doc.id}/docx`}>
                      <FileType className="w-3.5 h-3.5" /> DOCX
                    </a>
                  </div>
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
              <button onClick={printPdf} disabled={!preview} className="btn-secondary text-xs" title="Imprimir pelo navegador">
                <Printer className="w-3.5 h-3.5" />
                Imprimir
              </button>
              <button onClick={downloadPdf} disabled={!preview || pdfLoading} className="btn-secondary text-xs">
                {pdfLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                PDF
              </button>
              {savedDocId ? (
                <a className="btn-secondary text-xs" href={`/api/v1/associados/documentos/${savedDocId}/word`}>
                  <FileText className="w-3.5 h-3.5" /> Word
                </a>
              ) : (
                <button className="btn-secondary text-xs" disabled title="Salve o relatório para exportar Word"><FileText className="w-3.5 h-3.5" /> Word</button>
              )}
              {savedDocId ? (
                <a className="btn-primary text-xs" href={`/api/v1/associados/documentos/${savedDocId}/docx`}>
                  <FileType className="w-3.5 h-3.5" /> DOCX
                </a>
              ) : (
                <button className="btn-primary text-xs" disabled title="Salve o relatório para exportar DOCX"><FileType className="w-3.5 h-3.5" /> DOCX</button>
              )}
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
