"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Deliberacao } from "@/types";
import { AREAS_REGULATORIAS, RESULTADOS, formatDate, getAreaRegulatoriaLabel, getMicrotemaLabel, cn, isResultadoPositivo } from "@/lib/utils";
import {
  ArrowLeft, CheckCircle, XCircle, Pencil, Save, X,
  ChevronDown, ChevronUp, Users, FileText, ShieldCheck, Award, Download,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getLocalDelibs, updateLocalDelib } from "@/lib/local-store";
import { HelpTooltip } from "@/components/ui/HelpTooltip";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { DELIBERACOES_TABS } from "@/lib/module-tabs";
import { useDataSyncContext } from "@/components/DataSyncProvider";

const MICROTEMAS = [
  // ARTESP
  "tarifa", "obras", "multa", "contrato", "reequilibrio",
  "fiscalizacao", "seguranca", "ambiental", "desapropriacao",
  "adimplencia", "pessoal", "usuario",
  // ANM
  "lavra", "pesquisa", "licenciamento", "servidao", "cfem",
  "disponibilidade", "recursos",
  // Genérico
  "outros",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-text-muted font-mono uppercase tracking-wider mb-0.5">{label}</p>
      {children}
    </div>
  );
}

function voteBadgeClass(tipo: string) {
  if (tipo === "Favoravel") return "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30";
  if (tipo === "Desfavoravel" || tipo === "Contra") return "bg-red-500/15 text-red-400 border border-red-500/30";
  if (tipo === "Abstencao") return "bg-zinc-500/15 text-zinc-400 border border-zinc-500/30";
  return "bg-orange-500/15 text-orange-400 border border-orange-500/30";
}

function voteLabel(tipo: string) {
  if (tipo === "Favoravel") return "Favorável";
  if (tipo === "Desfavoravel") return "Desfavorável";
  if (tipo === "Abstencao") return "Abstenção";
  return tipo;
}

function initials(nome: string) {
  return nome
    .split(" ")
    .filter((p) => p.length > 2)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

function resultadoColor(r: string | null) {
  if (!r) return "text-text-muted";
  if (r === "Parcialmente Deferido") return "text-amber-400";
  if (isResultadoPositivo(r)) return "text-success"; // fonte única (utils)
  if (r === "Indeferido") return "text-error";
  return "text-text-secondary";
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function DeliberacaoDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { demoEnabled } = useDataSyncContext();
  const [editing, setEditing]         = useState(false);
  const [form, setForm]               = useState<Partial<Deliberacao>>({});
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState<string | null>(null);
  const [showRaw, setShowRaw]         = useState(false);

  const isLocal = params.id.startsWith("local-");

  const { data: deliberacao, isLoading } = useQuery({
    queryKey: ["deliberacao", params.id],
    queryFn: () => {
      if (isLocal) {
        const found = getLocalDelibs().find((d) => d.id === params.id) ?? null;
        return Promise.resolve(found as Deliberacao | null);
      }
      return api.get<Deliberacao>(`/deliberacoes/${params.id}`);
    },
  });

  const startEdit = () => {
    if (!deliberacao || demoEnabled) return;
    setForm({ ...deliberacao });
    setSaveError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!deliberacao) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (isLocal) {
        updateLocalDelib(params.id, form);
        await queryClient.invalidateQueries({ queryKey: ["deliberacao", params.id] });
      } else {
        const allowed = {
          numero_deliberacao: form.numero_deliberacao,
          reuniao_ordinaria:  form.reuniao_ordinaria,
          data_reuniao:       form.data_reuniao,
          data_publicacao:    form.data_publicacao,
          interessado:        form.interessado,
          processo:           form.processo,
          microtema:          form.microtema,
          area_regulatoria:   form.area_regulatoria,
          resultado:          form.resultado,
          pauta_interna:      form.pauta_interna,
          resumo_pleito:      form.resumo_pleito,
          fundamento_decisao: form.fundamento_decisao,
        };
        await api.patch(`/deliberacoes/${params.id}`, allowed);
        await queryClient.invalidateQueries({ queryKey: ["deliberacao", params.id] });
      }
      setEditing(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg.includes("403") ? "Edição disponível apenas com Supabase configurado." : msg);
    } finally {
      setSaving(false);
    }
  };

  const set = (field: keyof Deliberacao, value: unknown) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  async function downloadAttachment() {
    if (!deliberacao?.upload_job_id || demoEnabled || isLocal) return;
    const signed = await api.get<{ url: string }>(`/deliberacoes/${params.id}/download`);
    window.open(signed.url, "_blank", "noopener,noreferrer");
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-text-muted text-sm">
        Carregando...
      </div>
    );
  }

  if (!deliberacao) {
    return (
      <div className="text-center py-24">
        <p className="text-text-muted">Deliberação não encontrada</p>
        <Link href="/dashboard/deliberacoes" className="text-brand text-sm hover:underline mt-2 block">
          Voltar à lista
        </Link>
      </div>
    );
  }

  const confidence = deliberacao.extraction_confidence ?? 0;

  return (
    <div className="max-w-3xl space-y-5 animate-fade-in">
      <ModuleTabs tabs={DELIBERACOES_TABS} />

      {demoEnabled && (
        <div className="card border-warning/30 bg-warning/10 py-2 px-3 text-sm text-warning">
          Modo DEMO ativo: edicao de deliberacoes fica bloqueada em somente leitura.
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 flex-wrap">
        <Link href="/dashboard/deliberacoes" className="btn-secondary py-1 px-2 mt-0.5">
          <ArrowLeft className="w-4 h-4" />
        </Link>

        <div className="flex-1 min-w-0">
          <p className="text-xs text-text-muted font-mono">Deliberação</p>
          {editing ? (
            <input
              className="input text-xl font-semibold w-56 mt-0.5"
              value={form.numero_deliberacao ?? ""}
              onChange={(e) => set("numero_deliberacao", e.target.value || null)}
              placeholder="Número da deliberação"
            />
          ) : (
            <h1 className="text-xl font-semibold text-text-primary">
              {deliberacao.numero_deliberacao ?? deliberacao.id.slice(0, 8)}
            </h1>
          )}

          {/* Assunto — manchete da deliberação */}
          {deliberacao.assunto && (
            <p className="text-sm text-text-secondary mt-1 leading-snug">
              {deliberacao.assunto}
            </p>
          )}

          {/* Sub-header: agência + reunião + resultado + pauta */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {/* Agência badge */}
            {deliberacao.agencia && (
              <span className="text-xs px-2 py-0.5 rounded font-mono font-semibold bg-brand/15 text-brand border border-brand/25">
                {deliberacao.agencia.sigla}
              </span>
            )}
            {deliberacao.reuniao_ordinaria && (
              <span className="text-xs text-text-muted font-mono">
                {deliberacao.reuniao_ordinaria}
              </span>
            )}
            {deliberacao.resultado && (
              <>
                <span className="text-text-muted text-xs">·</span>
                <span className={cn("text-xs font-medium", resultadoColor(deliberacao.resultado))}>
                  {deliberacao.resultado}
                </span>
              </>
            )}
            {/* Pauta badge */}
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full font-mono border",
              deliberacao.pauta_interna
                ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                : "bg-brand/10 text-brand border-brand/20"
            )}>
              {deliberacao.pauta_interna ? "Pauta Interna" : "Pauta Pública"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!editing && deliberacao.resultado && (
            isResultadoPositivo(deliberacao.resultado) ? (
              <CheckCircle className="w-5 h-5 text-success" />
            ) : deliberacao.resultado === "Indeferido" ? (
              <XCircle className="w-5 h-5 text-error" />
            ) : null
          )}

          {editing ? (
            <>
              <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={cancelEdit} disabled={saving}>
                <X className="w-3.5 h-3.5" /> Cancelar
              </button>
              <button className="btn-primary text-xs flex items-center gap-1.5" onClick={handleSave} disabled={saving}>
                <Save className="w-3.5 h-3.5" />
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </>
          ) : (
            <>
              <button
                className="btn-secondary text-xs flex items-center gap-1.5"
                onClick={downloadAttachment}
                disabled={!deliberacao.upload_job_id || demoEnabled || isLocal}
                title={deliberacao.upload_job_id ? "Baixar PDF original por URL assinada" : "Sem PDF anexado"}
              >
                <Download className="w-3.5 h-3.5" /> PDF
              </button>
              <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={startEdit} disabled={demoEnabled}>
                <Pencil className="w-3.5 h-3.5" /> Editar
              </button>
            </>
          )}
        </div>
      </div>

      {saveError && (
        <div className="card border-error/30 py-2 px-3 text-sm text-error">{saveError}</div>
      )}

      {/* ── Informações da Reunião ──────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-4 h-4 text-brand" />
          <p className="section-label">Informações da Reunião</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Data da Reunião">
            {editing ? (
              <input type="date" className="input text-sm w-full font-mono"
                value={form.data_reuniao ?? ""}
                onChange={(e) => set("data_reuniao", e.target.value || null)}
              />
            ) : (
              <p className="text-sm text-text-primary">{formatDate(deliberacao.data_reuniao)}</p>
            )}
          </Field>

          <Field label="Data de Publicação">
            {editing ? (
              <input type="date" className="input text-sm w-full font-mono"
                value={form.data_publicacao ?? ""}
                onChange={(e) => set("data_publicacao", e.target.value || null)}
              />
            ) : (
              <p className="text-sm text-text-primary">{formatDate(deliberacao.data_publicacao)}</p>
            )}
          </Field>

          <Field label="Reunião Ordinária">
            {editing ? (
              <input className="input text-sm w-full"
                value={form.reuniao_ordinaria ?? ""}
                onChange={(e) => set("reuniao_ordinaria", e.target.value || null)}
                placeholder="Ex: 321ª Reunião Ordinária"
              />
            ) : (
              <p className="text-sm text-text-primary">{deliberacao.reuniao_ordinaria ?? "—"}</p>
            )}
          </Field>

          <Field label="Processo">
            {editing ? (
              <input className="input text-sm w-full"
                value={form.processo ?? ""}
                onChange={(e) => set("processo", e.target.value || null)}
                placeholder="Número do processo"
              />
            ) : (
              <p className="text-sm text-text-primary font-mono text-xs">{deliberacao.processo ?? "—"}</p>
            )}
          </Field>

          <Field label="Interessado">
            {editing ? (
              <input className="input text-sm w-full"
                value={form.interessado ?? ""}
                onChange={(e) => set("interessado", e.target.value || null)}
                placeholder="Nome do interessado"
              />
            ) : (
              <p className="text-sm text-text-primary">{deliberacao.interessado ?? "—"}</p>
            )}
          </Field>

          <Field label="Assunto">
            {editing ? (
              <input className="input text-sm w-full"
                value={(form as Deliberacao).assunto ?? ""}
                onChange={(e) => set("assunto" as keyof Deliberacao, e.target.value || null)}
                placeholder="Assunto / tema da deliberação"
              />
            ) : (
              <p className="text-sm text-text-primary">{deliberacao.assunto ?? "—"}</p>
            )}
          </Field>

          <Field label="Microtema">
            {editing ? (
              <select className="select w-full text-sm" value={form.microtema ?? ""}
                onChange={(e) => set("microtema", e.target.value || null)}>
                <option value="">— Selecione —</option>
                {MICROTEMAS.map((m) => (
                  <option key={m} value={m}>{getMicrotemaLabel(m)}</option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-text-primary">
                {deliberacao.microtema ? getMicrotemaLabel(deliberacao.microtema) : "—"}
              </p>
            )}
          </Field>

          <Field label="Área regulatória">
            {editing ? (
              <select className="select w-full text-sm" value={form.area_regulatoria ?? "outros"}
                onChange={(e) => set("area_regulatoria", e.target.value || null)}>
                {AREAS_REGULATORIAS.map((area) => (
                  <option key={area} value={area}>{getAreaRegulatoriaLabel(area)}</option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-text-primary">
                {getAreaRegulatoriaLabel(deliberacao.area_regulatoria)}
              </p>
            )}
          </Field>

          <Field label="Resultado">
            {editing ? (
              <select className="select w-full text-sm" value={form.resultado ?? ""}
                onChange={(e) => set("resultado", (e.target.value || null) as Deliberacao["resultado"])}>
                <option value="">— Selecione —</option>
                {RESULTADOS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            ) : (
              <p className={cn("text-sm font-medium", resultadoColor(deliberacao.resultado))}>
                {deliberacao.resultado ?? "—"}
              </p>
            )}
          </Field>

          <Field label="Tipo de Pauta">
            {editing ? (
              <label className="flex items-center gap-2 cursor-pointer mt-1">
                <input type="checkbox" className="w-4 h-4 accent-brand"
                  checked={form.pauta_interna ?? false}
                  onChange={(e) => set("pauta_interna", e.target.checked)}
                />
                <span className="text-sm text-text-primary">Pauta Interna</span>
              </label>
            ) : (
              <p className="text-sm text-text-primary">
                {deliberacao.pauta_interna ? "Pauta Interna" : "Pauta Pública"}
              </p>
            )}
          </Field>

          <Field label="Confiança IA">
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    confidence >= 0.75 ? "bg-success" :
                    confidence >= 0.5  ? "bg-amber-400" : "bg-error"
                  )}
                  style={{ width: `${Math.round(confidence * 100)}%` }}
                />
              </div>
              <span className="text-xs text-text-muted font-mono">
                {Math.round(confidence * 100)}%
              </span>
            </div>
          </Field>
        </div>
      </div>

      {/* ── Votação Individual ─────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-brand" />
          <p className="section-label">Votação Individual</p>
          <HelpTooltip text="Votos registrados de cada diretor. Quando aprovado por unanimidade, todos os diretores da agência são contados individualmente." />
          {deliberacao.votos && deliberacao.votos.length > 0 && (
            <span className="ml-auto text-xs text-text-muted font-mono">
              {deliberacao.votos.length} {deliberacao.votos.length === 1 ? "voto" : "votos"}
            </span>
          )}
        </div>

        {/* Banner de unanimidade */}
        {deliberacao.votos && deliberacao.votos.length > 0 &&
          deliberacao.votos.every((v) => v.tipo_voto === "Favoravel") && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Award className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-xs font-medium text-emerald-400">
              Aprovado por unanimidade — todos os {deliberacao.votos.length} diretores votaram a favor
            </span>
          </div>
        )}

        {deliberacao.votos && deliberacao.votos.length > 0 ? (
          <div className="space-y-2">
            {deliberacao.votos.map((v) => {
              const nome = v.diretor_nome ?? v.diretor_id;
              return (
                <div
                  key={v.id}
                  className="flex items-center gap-3 py-2 px-3 rounded-lg bg-bg-hover/50 border border-border/40"
                >
                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-full bg-brand/15 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-brand font-mono">
                      {initials(nome)}
                    </span>
                  </div>

                  {/* Nome */}
                  <span className="text-sm text-text-primary flex-1 min-w-0 truncate">
                    {nome}
                  </span>

                  {/* Badges */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {v.is_divergente && (
                      <span className="text-xs px-1.5 py-0.5 rounded font-mono bg-orange-500/15 text-orange-400 border border-orange-500/25">
                        Divergente
                      </span>
                    )}
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded font-mono",
                      voteBadgeClass(v.tipo_voto)
                    )}>
                      {voteLabel(v.tipo_voto)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-text-muted italic">Votação não registrada para esta deliberação.</p>
        )}
      </div>

      {/* ── Resumo do Pleito ─────────────────────────────────────────────── */}
      <div className="card">
        <p className="section-label mb-3">Resumo do Pleito</p>
        {editing ? (
          <textarea
            className="input text-sm w-full leading-relaxed"
            rows={4}
            value={form.resumo_pleito ?? ""}
            onChange={(e) => set("resumo_pleito", e.target.value || null)}
            placeholder="Descreva o resumo do pleito..."
          />
        ) : deliberacao.resumo_pleito ? (
          <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
            {deliberacao.resumo_pleito}
          </p>
        ) : (
          <p className="text-sm text-text-muted italic">Não informado.</p>
        )}
      </div>

      {/* ── Fundamento da Decisão ────────────────────────────────────────── */}
      <div className="card">
        <p className="section-label mb-3">Fundamento da Decisão</p>
        {editing ? (
          <textarea
            className="input text-sm w-full leading-relaxed"
            rows={5}
            value={form.fundamento_decisao ?? ""}
            onChange={(e) => set("fundamento_decisao", e.target.value || null)}
            placeholder="Descreva o fundamento da decisão..."
          />
        ) : deliberacao.fundamento_decisao ? (
          <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
            {deliberacao.fundamento_decisao}
          </p>
        ) : (
          <p className="text-sm text-text-muted italic">Não informado.</p>
        )}
      </div>

      {/* ── Dados Brutos de Extração (IA) ─────────────────────────────────── */}
      {deliberacao.raw_extraction && (
        <div className="card">
          <button
            className="w-full flex items-center justify-between text-left"
            onClick={() => setShowRaw((v) => !v)}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-text-muted" />
              <p className="section-label">Dados Brutos de Extração (IA)</p>
            </div>
            {showRaw ? (
              <ChevronUp className="w-4 h-4 text-text-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-text-muted" />
            )}
          </button>

          {showRaw && (
            <pre className="mt-4 p-3 rounded-lg bg-bg-base border border-border text-xs font-mono text-text-muted overflow-x-auto leading-relaxed">
              {JSON.stringify(deliberacao.raw_extraction, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
