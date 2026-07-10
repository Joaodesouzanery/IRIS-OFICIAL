"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn, formatDateLong, formatNumber } from "@/lib/utils";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { DELIBERACOES_TABS } from "@/lib/module-tabs";
import { useDataSyncContext } from "@/components/DataSyncProvider";
import type {
  Agencia,
  DeliberacoesBackfillResponse,
  DiretorCandidato,
  DiretorOverviewItem,
  DiretorVotoItem,
  MonitoramentoCheckResponse,
  MonitoramentoItem,
  MonitoramentoSite,
} from "@/types";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  FileDown,
  FileText,
  Gavel,
  Loader2,
  RefreshCw,
  Upload,
  Zap,
  UserCheck,
  Users,
  X,
} from "lucide-react";

const COLEGIADO_SIGLAS = ["ANTT", "ANM", "ARTESP"];

// O backfill roda em RODADAS: cada chamada cabe no orçamento do servidor (~90s)
// e responde parcial=true enquanto houver fontes/reuniões por cobrir; o skip-set
// no servidor faz cada rodada continuar de onde a anterior parou.
const BACKFILL_MAX_ROUNDS = 8;
const BACKFILL_ROUND_PAUSE_MS = 2_000;

type BackfillAggregate = {
  rodadas: number;
  novos_itens: number;
  documentos_enfileirados: number;
  fontes_processadas: number;
  parcial: boolean;
  erro_apos_progresso?: string;
};

type DuplicataPar = {
  agencia_id: string;
  agencia_sigla: string | null;
  score: number;
  keep: { id: string; nome: string; votos?: number };
  dup: { id: string; nome: string; votos?: number };
};

type CompletudeAgencia = {
  sigla: string;
  reunioes: { com_deliberacao: number };
  documentos_2026: { detectados: number };
  deliberacoes: { finais: number; sem_voto: number };
  votos: { total: number; nominais: number; inferidos: number };
  diretores: { aprovados: number; com_voto: number; candidatos_pendentes: number };
  ultima_captura?: { documento_em: string | null; deliberacao_em: string | null };
};

type CompletudeResponse = {
  ano: number;
  por_agencia: CompletudeAgencia[];
  totais: { documentos_2026_detectados: number; deliberacoes_finais: number; votos_total: number };
  alertas: string[];
};

type DedupResult = {
  dry_run: boolean;
  grupos_duplicados: number;
  deliberacoes_em_dobro: number;
  removidas: number;
};

type VotosDiretoresResponse = {
  sources: MonitoramentoSite[];
  itens: MonitoramentoItem[];
  demo?: boolean;
};

type EnqueueResponse = {
  candidates: number;
  queued: number;
  enqueued_jobs: number;
};

export default function VotosDiretoresPage() {
  const queryClient = useQueryClient();
  const { demoEnabled } = useDataSyncContext();
  const [agenciaId, setAgenciaId] = useState("");
  const [selectedDirector, setSelectedDirector] = useState<DiretorOverviewItem | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["votos-diretores", "fontes"],
    queryFn: () => api.get<VotosDiretoresResponse>("/deliberacoes/votos-diretores"),
  });

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: () => api.get<Agencia[]>("/agencias"),
  });

  const { data: diretores } = useQuery({
    queryKey: ["dashboard", "diretores-overview", "votos", agenciaId],
    queryFn: () => api.get<DiretorOverviewItem[]>(`/dashboard/diretores/overview${agenciaId ? `?agencia_id=${agenciaId}` : ""}`),
  });

  const { data: drilldownVotos, isLoading: drilldownLoading } = useQuery({
    queryKey: ["diretor-votos", selectedDirector?.diretor_id, agenciaId],
    queryFn: () =>
      api.get<DiretorVotoItem[]>(
        `/dashboard/diretores/${selectedDirector!.diretor_id}/votos${agenciaId ? `?agencia_id=${agenciaId}` : ""}`
      ),
    enabled: !!selectedDirector,
  });

  const checkMutation = useMutation({
    mutationFn: () => api.get<MonitoramentoCheckResponse>("/monitoramento/check"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["votos-diretores"] });
    },
  });

  const [backfillProgress, setBackfillProgress] = useState<BackfillAggregate | null>(null);

  const backfillMutation = useMutation({
    // Orquestra as rodadas no cliente: chama o endpoint até parcial=false (ou o
    // teto de rodadas), agregando os contadores. Uma rodada sem NENHUM progresso
    // duas vezes seguidas também encerra (anti-loop).
    mutationFn: async (): Promise<BackfillAggregate> => {
      const agg: BackfillAggregate = {
        rodadas: 0,
        novos_itens: 0,
        documentos_enfileirados: 0,
        fontes_processadas: 0,
        parcial: false,
      };
      let semProgresso = 0;
      for (let rodada = 1; rodada <= BACKFILL_MAX_ROUNDS; rodada++) {
        let res: DeliberacoesBackfillResponse;
        try {
          res = await api.post<DeliberacoesBackfillResponse>("/deliberacoes/votos-diretores/backfill");
        } catch (err) {
          if (agg.rodadas === 0) throw err; // 1ª rodada falhou → erro real
          agg.parcial = true;
          agg.erro_apos_progresso = err instanceof Error ? err.message : "erro na rodada";
          break;
        }
        agg.rodadas = rodada;
        agg.novos_itens += res.novos_itens ?? 0;
        agg.documentos_enfileirados += res.documentos_enfileirados ?? 0;
        agg.fontes_processadas = Math.max(agg.fontes_processadas, res.fontes_processadas ?? 0);
        agg.parcial = res.parcial === true;
        setBackfillProgress({ ...agg });
        if (!agg.parcial) break;
        const progrediu = (res.novos_itens ?? 0) + (res.documentos_enfileirados ?? 0) + (res.fontes_puladas ?? 0) > 0;
        semProgresso = progrediu ? 0 : semProgresso + 1;
        if (semProgresso >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, BACKFILL_ROUND_PAUSE_MS));
      }
      return agg;
    },
    onMutate: () => setBackfillProgress(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["votos-diretores"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "diretores-overview", "votos"] });
    },
  });

  const enqueueMutation = useMutation({
    mutationFn: () => api.post<EnqueueResponse>("/deliberacoes/enqueue-pdfs", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["votos-diretores"] });
    },
  });

  const { data: candidatos } = useQuery({
    queryKey: ["diretores-candidatos", "pendentes", agenciaId],
    queryFn: () => api.get<DiretorCandidato[]>(`/diretores/candidatos?status=pendente${agenciaId ? `&agencia_id=${agenciaId}` : ""}`),
  });

  const { data: duplicatas } = useQuery({
    queryKey: ["diretores-duplicatas", agenciaId],
    queryFn: () => api.get<{ pares: DuplicataPar[] }>(`/admin/diretores/duplicatas${agenciaId ? `?agencia_id=${agenciaId}` : ""}`),
  });

  const mergeMutation = useMutation({
    mutationFn: (par: DuplicataPar) =>
      api.post<{ votos_reapontados: number; votos_descartados: number }>("/diretores/merge", {
        keep_id: par.keep.id,
        merge_id: par.dup.id,
      }),
    onSuccess: (res) => {
      setMatchFeedback(`Diretores mesclados: ${res.votos_reapontados} voto(s) reapontado(s), ${res.votos_descartados} duplicado(s) descartado(s).`);
      queryClient.invalidateQueries({ queryKey: ["diretores-duplicatas"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "diretores-overview", "votos"] });
    },
    onError: (err) => setMatchError(err instanceof Error ? err.message : "Erro ao mesclar diretores"),
  });

  const [matchFeedback, setMatchFeedback] = useState<string | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);

  const { data: completude } = useQuery({
    queryKey: ["completude-2026"],
    queryFn: () => api.get<CompletudeResponse>("/admin/completude-2026?year=2026"),
  });

  // Limpeza retroativa: recalcula a confiança dos candidatos legados com o matcher
  // atual, colapsa cartões duplicados e AUTO-APROVA os que agora casam ≥0,85 →
  // um clique resolve os cartões antigos presos a 60% e destrava os votos.
  const recomputeMutation = useMutation({
    mutationFn: () =>
      api.post<{ grupos_auto_aprovados: number; cartoes_colapsados: number; votos_retroativos_criados: number }>(
        "/admin/diretores/candidatos/recompute?dry_run=0", {},
      ),
    onSuccess: (res) => {
      setMatchError(null);
      setMatchFeedback(
        `Recalculado: ${res.grupos_auto_aprovados} nome(s) auto-aprovado(s), ${res.cartoes_colapsados} cartão(ões) duplicado(s) removido(s), ${res.votos_retroativos_criados} voto(s) retroativo(s) criado(s).`,
      );
      queryClient.invalidateQueries({ queryKey: ["diretores-candidatos"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "diretores-overview", "votos"] });
      queryClient.invalidateQueries({ queryKey: ["diretor-votos"] });
    },
    onError: (err) => setMatchError(err instanceof Error ? err.message : "Erro ao recalcular candidatos"),
  });

  // Reprocesso em lote dos "Voto DXX" ANTT ignorados pelo confirm antigo: dry-run
  // conta; 2º clique re-enfileira (o cron processa e o auto-confirm materializa).
  const [reprocessPreview, setReprocessPreview] = useState<{ encontrados: number } | null>(null);
  const reprocessMutation = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.post<{ dry_run: boolean; encontrados: number; reenfileirados: number; falhas: number }>(
        `/admin/upload/reprocess-ignorados?dry_run=${dryRun ? "1" : "0"}`, {},
      ),
    onSuccess: (res) => {
      setMatchError(null);
      if (res.dry_run) {
        setReprocessPreview({ encontrados: res.encontrados });
      } else {
        setReprocessPreview(null);
        setMatchFeedback(`${res.reenfileirados} documento(s) re-enfileirado(s) para reprocessamento${res.falhas ? ` (${res.falhas} falha(s))` : ""}. Rode "Processar atas/votos" e depois "Auto-confirmar".`);
        queryClient.invalidateQueries({ queryKey: ["votos-diretores"] });
      }
    },
    onError: (err) => setMatchError(err instanceof Error ? err.message : "Erro no reprocessamento"),
  });

  // Fila de revisão — o fluxo é zero-toque; isto lista só o que genuinamente
  // precisa de olho humano (exceção, não regra), sem sair da tela.
  const { data: pendentesRevisao } = useQuery({
    queryKey: ["docs-review-pending-colegiado"],
    queryFn: () =>
      api.get<{ total: number; data: Array<{ id: string; filename: string | null; tipo_documento: string | null; agencia?: { sigla?: string } | null }> }>(
        "/upload/documentos?status=review_pending&limit=8",
      ).catch(() => ({ total: 0, data: [] })),
  });

  // Diagnóstico: POR QUE os voto_individual estão parados no gate (agregado por motivo).
  // É o que orienta o operador — sem direção do voto / confiança baixa / relator ambíguo.
  const { data: pendenciasVoto } = useQuery({
    queryKey: ["pendencias-voto-diagnostico"],
    queryFn: () =>
      api.get<{ total_pendentes: number; confirmaveis: number; motivos: Array<{ key: string; label: string; total: number }> }>(
        "/admin/upload/pendencias-voto",
      ).catch(() => ({ total_pendentes: 0, confirmaveis: 0, motivos: [] })),
  });

  // Limpeza de deliberações duplicadas (legado, antes do dedup estrutural). Dois
  // passos: primeiro verifica (dry-run) e mostra a contagem; só o 2º clique funde.
  const [dedupPreview, setDedupPreview] = useState<DedupResult | null>(null);
  const dedupMutation = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.post<DedupResult>(`/admin/deliberacoes/dedup?dry_run=${dryRun ? "1" : "0"}`, {}),
    onSuccess: (res) => {
      setMatchError(null);
      if (res.dry_run) {
        setDedupPreview(res);
      } else {
        setDedupPreview(null);
        setMatchFeedback(`Limpeza concluída: ${res.removidas} deliberação(ões) duplicada(s) removida(s), votos migrados.`);
        queryClient.invalidateQueries({ queryKey: ["completude-2026"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard", "diretores-overview", "votos"] });
      }
    },
    onError: (err) => setMatchError(err instanceof Error ? err.message : "Erro na limpeza de duplicatas"),
  });

  const aprovarMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<{ votos_retroativos?: { criados: number; deliberacoes: number } | null }>(
        `/diretores/candidatos/${id}/aprovar`, {},
      ),
    onSuccess: (res) => {
      setMatchError(null);
      const r = res.votos_retroativos;
      setMatchFeedback(
        r ? `Aprovado: ${r.criados} voto(s) retroativo(s) em ${r.deliberacoes} deliberação(ões).` : "Candidato aprovado.",
      );
      queryClient.invalidateQueries({ queryKey: ["diretores-candidatos"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "diretores-overview", "votos"] });
      queryClient.invalidateQueries({ queryKey: ["diretor-votos"] });
    },
    onError: (err) => {
      setMatchFeedback(null);
      setMatchError(err instanceof Error ? err.message : "Erro ao aprovar candidato.");
    },
  });

  const rejeitarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/diretores/candidatos/${id}/rejeitar`, {}),
    onSuccess: () => {
      setMatchError(null);
      setMatchFeedback("Candidato rejeitado.");
      queryClient.invalidateQueries({ queryKey: ["diretores-candidatos"] });
    },
    onError: (err) => {
      setMatchFeedback(null);
      setMatchError(err instanceof Error ? err.message : "Erro ao rejeitar candidato.");
    },
  });

  // Aprova EM LOTE os matches de alta confiança (≥0.8 a diretor já cadastrado);
  // novos nomes continuam 1-a-1. Destrava os votos retroativos de uma vez.
  const aprovarLoteMutation = useMutation({
    mutationFn: () =>
      api.post<{ aprovados: number; pulados: number }>("/diretores/candidatos/aprovar-lote", {
        min_confidence: 0.8,
        ...(agenciaId ? { agencia_id: agenciaId } : {}),
      }),
    onSuccess: (res) => {
      setMatchError(null);
      setMatchFeedback(`Lote: ${res.aprovados} candidato(s) aprovado(s), ${res.pulados} deixado(s) para revisão 1-a-1.`);
      queryClient.invalidateQueries({ queryKey: ["diretores-candidatos"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "diretores-overview", "votos"] });
      queryClient.invalidateQueries({ queryKey: ["diretor-votos"] });
    },
    onError: (err) => {
      setMatchFeedback(null);
      setMatchError(err instanceof Error ? err.message : "Erro na aprovação em lote.");
    },
  });

  // Auto-confirma documentos de ALTA confiança pendentes de revisão (gate conservador
  // no servidor; ambíguos permanecem na fila manual).
  const autoConfirmMutation = useMutation({
    // loop=true: materializa TUDO que passa no gate numa chamada (o cron não roda no
    // plano grátis); re-chama enquanto `restantes` (orçamento de tempo) for true.
    mutationFn: async () => {
      let confirmados = 0;
      for (let i = 0; i < 10; i++) {
        const res = await api.post<{ confirmados_total: number; restantes: boolean }>("/upload/auto-confirm", { limit: 50, loop: true });
        confirmados += res.confirmados_total ?? 0;
        if (!res.restantes) break;
      }
      return { confirmados };
    },
    onSuccess: (res) => {
      setMatchError(null);
      setMatchFeedback(`Auto-confirmação: ${res.confirmados} documento(s) materializados.`);
      queryClient.invalidateQueries({ queryKey: ["dashboard", "diretores-overview", "votos"] });
      queryClient.invalidateQueries({ queryKey: ["diretor-votos"] });
      queryClient.invalidateQueries({ queryKey: ["votos-diretores"] });
    },
    onError: (err) => {
      setMatchFeedback(null);
      setMatchError(err instanceof Error ? err.message : "Erro na auto-confirmação.");
    },
  });

  // "Rodar tudo": encadeia a esteira inteira num clique (o plano grátis não roda os
  // crons). Verificar novos → Processar atas/votos → Auto-confirmar (loop) → Recalcular
  // matches (auto-aprova + mescla duplicatas). Progresso textual na UI.
  const [rodarTudoProgresso, setRodarTudoProgresso] = useState<string | null>(null);
  const rodarTudoMutation = useMutation({
    mutationFn: async () => {
      setRodarTudoProgresso("1/4 · Verificando novos documentos…");
      await api.get<MonitoramentoCheckResponse>("/monitoramento/check").catch(() => null);
      setRodarTudoProgresso("2/4 · Processando atas/votos…");
      await api.post<EnqueueResponse>("/deliberacoes/enqueue-pdfs", {}).catch(() => null);
      setRodarTudoProgresso("3/4 · Auto-confirmando (loop)…");
      let confirmados = 0;
      for (let i = 0; i < 10; i++) {
        const res = await api.post<{ confirmados_total: number; restantes: boolean }>("/upload/auto-confirm", { limit: 50, loop: true }).catch(() => null);
        if (!res) break;
        confirmados += res.confirmados_total ?? 0;
        if (!res.restantes) break;
      }
      setRodarTudoProgresso("4/4 · Recalculando matches e mesclando duplicatas…");
      const rec = await api.post<{ grupos_auto_aprovados: number; diretores_mesclados: number; votos_retroativos_criados: number }>(
        "/admin/diretores/candidatos/recompute?dry_run=0", {},
      ).catch(() => null);
      return { confirmados, recompute: rec };
    },
    onSuccess: (res) => {
      setMatchError(null);
      setRodarTudoProgresso(null);
      const rec = res.recompute;
      setMatchFeedback(
        `Esteira concluída: ${res.confirmados} voto(s)/doc(s) materializados` +
        (rec ? ` · ${rec.grupos_auto_aprovados} nome(s) auto-aprovado(s) · ${rec.diretores_mesclados} duplicata(s) mesclada(s) · ${rec.votos_retroativos_criados} voto(s) retroativo(s)` : "") + ".",
      );
      queryClient.invalidateQueries({ queryKey: ["dashboard", "diretores-overview", "votos"] });
      queryClient.invalidateQueries({ queryKey: ["votos-diretores"] });
      queryClient.invalidateQueries({ queryKey: ["completude-2026"] });
      queryClient.invalidateQueries({ queryKey: ["pendencias-voto-diagnostico"] });
    },
    onError: (err) => {
      setRodarTudoProgresso(null);
      setMatchFeedback(null);
      setMatchError(err instanceof Error ? err.message : "Erro ao rodar a esteira.");
    },
  });

  const colegiadoAgencias = useMemo(
    () => (agencias ?? []).filter((a) => COLEGIADO_SIGLAS.includes(a.sigla)),
    [agencias],
  );

  const sources = data?.sources ?? [];
  const itens = data?.itens ?? [];

  function toggleDirector(d: DiretorOverviewItem) {
    setSelectedDirector((prev) => (prev?.diretor_id === d.diretor_id ? null : d));
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <ModuleTabs tabs={DELIBERACOES_TABS} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Gavel className="w-5 h-5 text-brand" />
            <h1 className="text-xl font-semibold text-text-primary">Votos dos Diretores</h1>
          </div>
          <p className="text-sm text-text-muted mt-1">
            Captura automática das decisões das reuniões colegiadas (ANTT, ANM e ARTESP) e métricas por diretor.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => rodarTudoMutation.mutate()}
            disabled={rodarTudoMutation.isPending || demoEnabled}
            className="btn-primary"
            title="Roda a esteira inteira num clique: verifica novos → processa atas/votos → auto-confirma (loop) → recalcula matches e mescla duplicatas. Útil no plano grátis, onde os crons não rodam."
          >
            {rodarTudoMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {rodarTudoProgresso ?? "Rodar tudo"}
          </button>
          <button
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending || checkMutation.isPending || demoEnabled}
            className="btn-secondary"
            title="Busca e processa todas as deliberações de 2026 das 3 agências"
          >
            {backfillMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Buscar todas de 2026
          </button>
          <button
            onClick={() => checkMutation.mutate()}
            disabled={checkMutation.isPending || backfillMutation.isPending || demoEnabled}
            className="btn-secondary"
          >
            {checkMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Verificar novos
          </button>
          <button
            onClick={() => enqueueMutation.mutate()}
            disabled={enqueueMutation.isPending || demoEnabled}
            className="btn-secondary"
            title="Baixa e enfileira os PDFs de atas/votos detectados para extração dos votos individuais"
          >
            {enqueueMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Processar atas/votos
          </button>
          <button
            onClick={() => autoConfirmMutation.mutate()}
            disabled={autoConfirmMutation.isPending || demoEnabled}
            className="btn-secondary"
            title="Confirma automaticamente documentos de ALTA confiança pendentes de revisão (gate conservador; ambíguos ficam na fila manual)"
          >
            {autoConfirmMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Auto-confirmar alta confiança
          </button>
          <a
            href={agenciaId ? `/api/v1/relatorios/votos-diretores?agencia_id=${agenciaId}` : "/api/v1/relatorios/votos-diretores"}
            target="_blank"
            rel="noreferrer"
            className={cn("btn-secondary", demoEnabled && "pointer-events-none opacity-50")}
            title="Abre o relatório imprimível dos votos de cada diretor das 3 agências (imprimir → PDF pelo navegador)"
          >
            <FileDown className="w-4 h-4" />
            Gerar relatório
          </a>
        </div>
      </div>

      {matchFeedback && (candidatos ?? []).length === 0 ? (
        <div className="border border-success/30 bg-success/10 rounded-card p-2.5 text-sm text-success">{matchFeedback}</div>
      ) : null}
      {matchError && (candidatos ?? []).length === 0 ? (
        <div className="border border-error/30 bg-error/10 rounded-card p-2.5 text-sm text-error">{matchError}</div>
      ) : null}

      {demoEnabled ? (
        <div className="border border-error/30 bg-error/10 rounded-card p-3 text-sm text-error">
          Modo DEMO ativo: a captura automática e a geração de métricas ficam bloqueadas em somente leitura.
        </div>
      ) : null}

      {backfillMutation.isPending && backfillProgress ? (
        <div className="border border-brand/30 bg-brand/10 rounded-card p-3 text-sm text-text-primary">
          Rodada {backfillProgress.rodadas} de até {BACKFILL_MAX_ROUNDS} — {backfillProgress.novos_itens} item(ns) novo(s) ·{" "}
          {backfillProgress.documentos_enfileirados} PDF(s) enfileirado(s) até agora. As rodadas continuam de onde a anterior parou…
        </div>
      ) : null}
      {!backfillMutation.isPending && backfillMutation.data ? (
        <div className={cn(
          "rounded-card p-3 text-sm",
          backfillMutation.data.parcial
            ? "border border-warning/30 bg-warning/10 text-text-primary"
            : "border border-success/30 bg-success/10 text-success",
        )}>
          Backfill 2026 ({backfillMutation.data.rodadas} rodada(s)): {backfillMutation.data.novos_itens} novo(s) item(ns) ·{" "}
          {backfillMutation.data.documentos_enfileirados} documento(s) enfileirado(s) para extração.{" "}
          {backfillMutation.data.parcial ? (
            <>Cobertura ainda parcial{backfillMutation.data.erro_apos_progresso ? ` (${backfillMutation.data.erro_apos_progresso})` : ""} —
            clique de novo para continuar (o cron semanal também completa sozinho). </>
          ) : (
            <><strong>Cobertura 2026 completa</strong> — todas as reuniões já coletadas foram varridas. </>
          )}
          Os documentos são processados e confirmados automaticamente; o que precisar de revisão aparece no card &ldquo;Revisão humana&rdquo;.
        </div>
      ) : null}
      {backfillMutation.error ? (
        <div className="border border-error/30 bg-error/10 rounded-card p-3 text-sm text-error">
          {backfillMutation.error instanceof Error ? backfillMutation.error.message : "Erro no backfill de 2026"}
        </div>
      ) : null}
      {checkMutation.data ? (
        <div className="border border-success/30 bg-success/10 rounded-card p-3 text-sm text-success">
          {checkMutation.data.checked} fonte(s) verificada(s) · {checkMutation.data.novos_detectados} novo(s) documento(s) detectado(s) e enfileirado(s) para extração.
        </div>
      ) : null}
      {checkMutation.error ? (
        <div className="border border-error/30 bg-error/10 rounded-card p-3 text-sm text-error">
          {checkMutation.error instanceof Error ? checkMutation.error.message : "Erro ao verificar documentos"}
        </div>
      ) : null}
      {enqueueMutation.data ? (
        <div className="border border-success/30 bg-success/10 rounded-card p-3 text-sm text-success">
          {enqueueMutation.data.candidates} PDF(s) de decisão encontrado(s) · {enqueueMutation.data.queued} enfileirado(s) para
          extração. Revise e confirme os votos individuais em{" "}
          <a href="/dashboard/upload" className="underline">Upload de PDFs</a>.
        </div>
      ) : null}
      {enqueueMutation.error ? (
        <div className="border border-error/30 bg-error/10 rounded-card p-3 text-sm text-error">
          {enqueueMutation.error instanceof Error ? enqueueMutation.error.message : "Erro ao processar atas/votos"}
        </div>
      ) : null}

      {/* ── Revisão humana (exceção do fluxo automático) + reentrada do legado ── */}
      {((pendentesRevisao?.total ?? 0) > 0 || reprocessPreview || !demoEnabled) && (
        <section className="card space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand" />
              <div>
                <p className="section-label">Revisão humana {`(${pendentesRevisao?.total ?? 0})`}</p>
                <p className="text-[11px] text-text-muted">
                  A esteira roda sozinha (coleta → extração → auto-confirmação). Aqui fica só o que o gate conservador não confirmou.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => (reprocessPreview ? reprocessMutation.mutate(false) : reprocessMutation.mutate(true))}
              disabled={reprocessMutation.isPending || demoEnabled}
              title="Reprocessa em lote os votos/atas da ANTT descartados pela versão antiga (1º clique conta; 2º confirma). Depois o cron processa e auto-confirma os inequívocos."
            >
              {reprocessMutation.isPending
                ? "Reprocessando…"
                : reprocessPreview
                  ? `Re-enfileirar ${reprocessPreview.encontrados} ignorado(s)`
                  : "Reprocessar votos ignorados"}
            </button>
          </div>
          {(pendenciasVoto?.total_pendentes ?? 0) > 0 && (
            <div className="rounded-card border border-border bg-surface-2/40 px-3 py-2.5 space-y-1.5">
              <p className="text-[11px] text-text-muted">
                {pendenciasVoto!.total_pendentes} voto(s) individual(is) em revisão — por que o gate não confirmou:
                {(pendenciasVoto?.confirmaveis ?? 0) > 0 && (
                  <span className="text-success"> {pendenciasVoto!.confirmaveis} já passariam agora (rode &ldquo;Auto-confirmar alta confiança&rdquo;).</span>
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(pendenciasVoto?.motivos ?? []).map((m) => (
                  <span key={m.key} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-secondary" title={m.label}>
                    <span className="font-medium text-text-primary">{m.total}</span> {m.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {(pendentesRevisao?.data ?? []).length > 0 ? (
            <div className="space-y-1.5">
              {(pendentesRevisao?.data ?? []).map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-3 text-sm border border-border rounded-card px-3 py-2">
                  <span className="truncate text-text-primary">
                    {doc.filename ?? doc.id}
                    <span className="text-text-muted"> · {doc.agencia?.sigla ?? "?"} · {doc.tipo_documento ?? "doc"}</span>
                  </span>
                  <a href="/dashboard/upload" className="text-brand text-xs hover:underline shrink-0">Revisar →</a>
                </div>
              ))}
              {(pendentesRevisao?.total ?? 0) > (pendentesRevisao?.data ?? []).length && (
                <p className="text-xs text-text-muted">
                  + {(pendentesRevisao!.total) - (pendentesRevisao!.data.length)} outro(s) em <a href="/dashboard/upload" className="text-brand hover:underline">Upload de PDFs</a>.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-text-muted">Nada aguardando revisão — a esteira automática está em dia.</p>
          )}
        </section>
      )}

      {/* ── Matches de diretor pendentes de revisão ──────────────────────── */}
      {(candidatos ?? []).length > 0 && (
        <section className="card space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-brand" />
              <p className="section-label">Matches pendentes ({(candidatos ?? []).length})</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => recomputeMutation.mutate()}
                disabled={recomputeMutation.isPending || demoEnabled}
                title="Recalcula a confiança dos cartões antigos com o matcher atual, junta os duplicados do mesmo nome e auto-aprova os que passam a casar ≥ 0,85 (destrava os votos presos)."
              >
                {recomputeMutation.isPending ? "Recalculando…" : "Recalcular matches"}
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => aprovarLoteMutation.mutate()}
                disabled={aprovarLoteMutation.isPending}
                title="Aprova em lote os matches ≥ 0,8 a diretores já cadastrados; novos nomes continuam 1-a-1."
              >
                {aprovarLoteMutation.isPending ? "Aprovando…" : "Aprovar lote (match ≥ 0,8)"}
              </button>
            </div>
          </div>
          <p className="text-xs text-text-muted">
            Nomes detectados em atas/votos cujo match com um diretor ficou ambíguo (confiança média) e não geraram voto.
            Ao aprovar, os votos faltantes são criados retroativamente para as deliberações daquele nome.
          </p>
          {matchFeedback && (
            <div className="border border-success/30 bg-success/10 rounded-card p-2.5 text-sm text-success">
              {matchFeedback}
            </div>
          )}
          {matchError && (
            <div className="border border-error/30 bg-error/10 rounded-card p-2.5 text-sm text-error">
              {matchError}
            </div>
          )}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {(candidatos ?? []).map((c) => {
              const pending = (aprovarMutation.isPending && aprovarMutation.variables === c.id) ||
                (rejeitarMutation.isPending && rejeitarMutation.variables === c.id);
              return (
                <div key={c.id} className="flex items-center justify-between gap-3 border border-border rounded-card p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {c.nome_detectado}
                      {c.diretor?.nome ? <span className="text-text-muted font-normal"> → possível match: {c.diretor.nome}</span> : null}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {c.agencia?.sigla ?? "Agência não definida"} · fonte: {c.source_type} · {Math.round(c.confidence * 100)}% de confiança
                      {(() => {
                        const ev = (c.evidence ?? {}) as Record<string, unknown>;
                        const partes = [
                          ev.numero_reuniao ? `reunião ${ev.numero_reuniao}ª` : null,
                          ev.numero_deliberacao ? `delib. ${ev.numero_deliberacao}` : null,
                          typeof ev.processo === "string" && ev.processo ? `proc. ${String(ev.processo).slice(0, 24)}` : null,
                          c.created_at ? new Date(c.created_at).toLocaleDateString("pt-BR") : null,
                        ].filter(Boolean);
                        return partes.length ? ` · ${partes.join(" · ")}` : "";
                      })()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => aprovarMutation.mutate(c.id)}
                      disabled={pending || demoEnabled}
                      className="btn-primary text-xs"
                    >
                      {pending && aprovarMutation.variables === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Aprovar
                    </button>
                    <button
                      onClick={() => rejeitarMutation.mutate(c.id)}
                      disabled={pending || demoEnabled}
                      className="btn-secondary text-xs text-error border-error/30 hover:bg-error/10"
                    >
                      <X className="w-3.5 h-3.5" />
                      Rejeitar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Diretores possivelmente duplicados (auditoria fuzzy) ─────────── */}
      {(duplicatas?.pares ?? []).length > 0 && (
        <section className="card space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-warning" />
            <p className="section-label">Diretores possivelmente duplicados ({(duplicatas?.pares ?? []).length})</p>
          </div>
          <p className="text-xs text-text-muted">
            O mesmo diretor pode ter entrado duas vezes no cadastro com grafias diferentes (antes da checagem automática).
            Mesclar move os votos e mandatos para o cadastro principal e remove o duplicado — ação irreversível.
          </p>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {(duplicatas?.pares ?? []).map((par) => (
              <div key={`${par.keep.id}-${par.dup.id}`} className="flex items-center justify-between gap-3 border border-warning/30 rounded-card p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">
                    &ldquo;{par.dup.nome}&rdquo; <span className="text-text-muted font-normal">parece ser</span> &ldquo;{par.keep.nome}&rdquo;
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {par.agencia_sigla ?? "?"} · similaridade {Math.round(par.score * 100)}% ·
                    mantém &ldquo;{par.keep.nome}&rdquo; ({par.keep.votos ?? 0} voto(s)) · remove duplicado ({par.dup.votos ?? 0} voto(s), migrados)
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (window.confirm(`Mesclar "${par.dup.nome}" em "${par.keep.nome}"? Votos e mandatos serão movidos e o duplicado removido.`)) {
                      mergeMutation.mutate(par);
                    }
                  }}
                  disabled={mergeMutation.isPending || demoEnabled}
                  className="btn-secondary text-xs shrink-0"
                >
                  {mergeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Mesclar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Completude 2026 (conferência de que temos tudo, por agência) ──── */}
      {completude && (completude.por_agencia ?? []).length > 0 && (
        <section className="card space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="section-label">Completude {completude.ano}</p>
            <p className="text-xs text-text-muted">
              {completude.totais.documentos_2026_detectados} docs · {completude.totais.deliberacoes_finais} deliberações · {completude.totais.votos_total} votos
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-muted border-b border-border">
                  <th className="py-1 pr-3 font-medium">Agência</th>
                  <th className="py-1 px-2 font-medium text-right">Reuniões</th>
                  <th className="py-1 px-2 font-medium text-right">Docs 2026</th>
                  <th className="py-1 px-2 font-medium text-right">Deliberações</th>
                  <th className="py-1 px-2 font-medium text-right">Votos (nom/inf)</th>
                  <th className="py-1 px-2 font-medium text-right">Diretores c/ voto</th>
                  <th className="py-1 px-2 font-medium text-right">Última captura</th>
                  <th className="py-1 pl-2 font-medium text-right">Pendentes</th>
                </tr>
              </thead>
              <tbody>
                {completude.por_agencia.map((a) => {
                  // Staleness: fonte com docs mas parada há >7 dias (mesmo sintoma da
                  // ANTT-notícias no defeso) fica visível de imediato.
                  const ultima = a.ultima_captura?.documento_em ?? a.ultima_captura?.deliberacao_em ?? null;
                  const diasParada = ultima ? Math.floor((Date.now() - new Date(ultima).getTime()) / 86_400_000) : null;
                  const parada = a.documentos_2026.detectados > 0 && diasParada != null && diasParada > 7;
                  return (
                  <tr key={a.sigla} className="border-b border-border/50">
                    <td className="py-1.5 pr-3 font-medium text-text-primary">{a.sigla}</td>
                    <td className="py-1.5 px-2 text-right">{a.reunioes.com_deliberacao}</td>
                    <td className="py-1.5 px-2 text-right">{a.documentos_2026.detectados}</td>
                    <td className="py-1.5 px-2 text-right">
                      {a.deliberacoes.finais}
                      {a.deliberacoes.sem_voto > 0 ? <span className="text-warning"> ({a.deliberacoes.sem_voto} s/ voto)</span> : null}
                    </td>
                    <td className="py-1.5 px-2 text-right">{a.votos.nominais}/{a.votos.inferidos}</td>
                    <td className="py-1.5 px-2 text-right">{a.diretores.com_voto}/{a.diretores.aprovados}</td>
                    <td className={cn("py-1.5 px-2 text-right", parada ? "text-warning" : "text-text-muted")}>
                      {ultima ? `${ultima.slice(8, 10)}/${ultima.slice(5, 7)}` : "—"}
                      {parada ? ` (${diasParada}d)` : ""}
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      {a.diretores.candidatos_pendentes > 0
                        ? <span className="text-warning">{a.diretores.candidatos_pendentes}</span>
                        : <span className="text-success">0</span>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(completude.alertas ?? []).length > 0 && (
            <ul className="text-xs text-text-muted space-y-1 list-disc pl-4">
              {completude.alertas.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}
          {/* Manutenção: limpar deliberações duplicadas (legado). Verifica antes de fundir. */}
          <div className="flex items-center gap-2 flex-wrap border-t border-border pt-2.5">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => dedupMutation.mutate(true)}
              disabled={dedupMutation.isPending || demoEnabled}
              title="Verifica quantas deliberações estão em dobro (mesmo número/processo). Não altera nada."
            >
              {dedupMutation.isPending && dedupMutation.variables === true ? "Verificando…" : "Verificar duplicatas de deliberação"}
            </button>
            {dedupPreview && (
              <>
                <span className="text-xs text-text-muted">
                  {dedupPreview.grupos_duplicados} grupo(s) · {dedupPreview.deliberacoes_em_dobro} em dobro.
                </span>
                {dedupPreview.deliberacoes_em_dobro > 0 && (
                  <button
                    type="button"
                    className="btn-secondary text-xs text-error border-error/30 hover:bg-error/10"
                    onClick={() => {
                      if (window.confirm(`Fundir ${dedupPreview.deliberacoes_em_dobro} deliberação(ões) em dobro? Mantém a mais antiga e migra os votos. Ação irreversível.`)) {
                        dedupMutation.mutate(false);
                      }
                    }}
                    disabled={dedupMutation.isPending}
                  >
                    {dedupMutation.isPending && dedupMutation.variables === false ? "Fundindo…" : `Fundir ${dedupPreview.deliberacoes_em_dobro} duplicata(s)`}
                  </button>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {/* ── Fontes monitoradas ───────────────────────────────────────────── */}
      <section className="card space-y-3">
        <p className="section-label">Fontes de reuniões colegiadas</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {isLoading ? (
            <p className="text-sm text-text-muted">Carregando fontes...</p>
          ) : sources.length === 0 ? (
            <p className="text-sm text-text-muted">Nenhuma fonte cadastrada ainda. Clique em &ldquo;Verificar novos documentos&rdquo;.</p>
          ) : sources.map((site) => (
            <div key={site.id} className="rounded-md border border-border bg-bg-hover p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-text-primary">{site.agencia?.sigla ?? site.nome}</p>
                <span className={cn(
                  "badge text-xs",
                  site.ultimo_status === "ok" && "badge-green",
                  site.ultimo_status === "error" && "badge-red",
                  (site.ultimo_status === "never" || site.ultimo_status === "needs_headless") && "badge-gray",
                )}>
                  {site.ultimo_status === "ok" ? "ok" : site.ultimo_status === "error" ? "falha" : site.ultimo_status === "needs_headless" ? "requer navegação" : "sem verificação"}
                </span>
              </div>
              <p className="text-xs text-text-muted mt-1 truncate">{site.nome}</p>
              <p className="text-xs text-text-label mt-1">
                Última verificação: {site.ultimo_check ? new Date(site.ultimo_check).toLocaleString("pt-BR") : "nunca"}
              </p>
              <a href={site.url} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline inline-flex items-center gap-1 mt-2">
                Abrir site <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* ── Documentos detectados ────────────────────────────────────────── */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="section-label">Documentos de decisão detectados (2026)</p>
          <span className="text-xs text-text-muted">{itens.length} itens</span>
        </div>
        {itens.length === 0 ? (
          <p className="text-sm text-text-muted">
            Nenhum documento detectado ainda. Os votos individuais e métricas são gerados automaticamente
            quando novos documentos colegiados forem encontrados e processados.
          </p>
        ) : (
          <div className="space-y-2">
            {itens.map((item) => (
              <div key={item.id} className="flex items-start gap-3 p-3 border border-border rounded-md hover:bg-bg-hover transition-colors">
                <FileText className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary font-medium line-clamp-2">{item.titulo}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {item.agencia?.sigla ?? "—"} · {item.tipo}
                    {item.data_reuniao ? ` · ${formatDateLong(item.data_reuniao)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {item.enfileirado_em ? (
                    <span className="badge badge-green text-xs inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> processado
                    </span>
                  ) : (
                    <span className="badge badge-gray text-xs">detectado</span>
                  )}
                  <a href={item.url_item} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Upload className="w-4 h-4 text-text-muted" />
          <p className="text-xs text-text-muted">
            Opção secundária: para enviar manualmente um PDF/ZIP que a coleta automática não alcançou, use o{" "}
            <a href="/dashboard/upload" className="text-brand hover:underline">Upload de PDFs</a>.
          </p>
        </div>
      </section>

      {/* ── Métricas por diretor ─────────────────────────────────────────── */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-brand" />
            <div>
              <p className="section-label">Métricas por diretor</p>
              <p className="text-[11px] text-text-muted">
                <strong>lido</strong> = voto extraído do documento · <strong>inferido</strong> = por unanimidade/mandato (proxy)
              </p>
            </div>
          </div>
          <select className="select w-44" value={agenciaId} onChange={(e) => { setAgenciaId(e.target.value); setSelectedDirector(null); }}>
            <option value="">Todas as agências</option>
            {colegiadoAgencias.map((a) => <option key={a.id} value={a.id}>{a.sigla}</option>)}
          </select>
        </div>
        {!diretores || diretores.length === 0 ? (
          <p className="text-sm text-text-muted">
            Sem métricas ainda. Elas aparecem aqui após o processamento dos documentos colegiados.
          </p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-muted border-b border-border">
                  <th className="py-2 pr-3 font-medium">Diretor</th>
                  <th className="py-2 px-3 font-medium text-right">Votos</th>
                  <th className="py-2 px-3 font-medium text-right">Favoráveis</th>
                  <th className="py-2 px-3 font-medium text-right">Desfavoráveis</th>
                  <th className="py-2 px-3 font-medium text-right">Divergentes</th>
                  <th className="py-2 pl-3 font-medium text-right">% Favorável</th>
                  <th className="py-2 pl-3 font-medium w-8" />
                </tr>
              </thead>
              <tbody>
                {diretores.map((d) => (
                  <>
                    <tr
                      key={d.diretor_id}
                      className={cn(
                        "border-b border-border/60 cursor-pointer hover:bg-bg-hover transition-colors",
                        selectedDirector?.diretor_id === d.diretor_id && "bg-bg-hover",
                      )}
                      onClick={() => toggleDirector(d)}
                    >
                      <td className="py-2 pr-3 text-text-primary font-medium">
                        {d.diretor_nome}
                        {(d.nominais ?? 0) + (d.inferidos ?? 0) > 0 && (
                          <span className="block text-[10px] font-normal text-text-muted">
                            {d.nominais ?? 0} lido{(d.nominais ?? 0) === 1 ? "" : "s"} · {d.inferidos ?? 0} inferido{(d.inferidos ?? 0) === 1 ? "" : "s"}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right text-text-secondary">{formatNumber(d.total)}</td>
                      <td className="py-2 px-3 text-right text-success">{formatNumber(d.favoravel)}</td>
                      <td className="py-2 px-3 text-right text-text-secondary">{formatNumber(d.desfavoravel)}</td>
                      <td className="py-2 px-3 text-right text-warning">{formatNumber(d.divergente)}</td>
                      <td className="py-2 pl-3 text-right text-text-primary">{d.pct_favor.toFixed(1)}%</td>
                      <td className="py-2 pl-3 text-right text-text-muted">
                        {selectedDirector?.diretor_id === d.diretor_id
                          ? <ChevronUp className="w-3.5 h-3.5 inline" />
                          : <ChevronDown className="w-3.5 h-3.5 inline" />}
                      </td>
                    </tr>
                    {selectedDirector?.diretor_id === d.diretor_id ? (
                      <tr key={`${d.diretor_id}-drilldown`}>
                        <td colSpan={7} className="pb-3 pt-1 px-0">
                          <DrilldownPanel
                            diretor={d}
                            votos={drilldownVotos ?? []}
                            isLoading={drilldownLoading}
                            onClose={() => setSelectedDirector(null)}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-text-label">
          As métricas (tipo de voto, tema/microtema, contagem e divergência) são calculadas pelo mesmo
          pipeline das deliberações, agora alimentado também pelos votos individuais de cada diretor.
          Clique em um diretor para ver o histórico de deliberações.
        </p>
      </section>
    </div>
  );
}

function DrilldownPanel({
  diretor,
  votos,
  isLoading,
  onClose,
}: {
  diretor: DiretorOverviewItem;
  votos: DiretorVotoItem[];
  isLoading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="mx-0 border border-brand/20 bg-bg-hover rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-text-primary">
          Deliberações de <span className="text-brand">{diretor.diretor_nome}</span>
        </p>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-3 text-text-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando deliberações...
        </div>
      ) : votos.length === 0 ? (
        <p className="text-sm text-text-muted py-2">Nenhuma deliberação registrada para este diretor.</p>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-text-label border-b border-border">
                <th className="py-1.5 pr-3 font-medium">Deliberação</th>
                <th className="py-1.5 px-2 font-medium">Agência</th>
                <th className="py-1.5 px-2 font-medium">Microtema</th>
                <th className="py-1.5 px-2 font-medium">Resultado</th>
                <th className="py-1.5 px-2 font-medium">Voto</th>
                <th className="py-1.5 pl-2 font-medium">Data</th>
              </tr>
            </thead>
            <tbody>
              {votos.map((v) => (
                <tr key={v.id} className="border-b border-border/40 hover:bg-bg-card transition-colors">
                  <td className="py-1.5 pr-3 text-text-secondary max-w-[200px] truncate">
                    {v.deliberacao?.numero_deliberacao ?? v.deliberacao?.assunto ?? "—"}
                  </td>
                  <td className="py-1.5 px-2 text-text-muted">{v.deliberacao?.agencia?.sigla ?? "—"}</td>
                  <td className="py-1.5 px-2 text-text-muted">
                    {v.deliberacao?.microtema ?? "—"}
                  </td>
                  <td className="py-1.5 px-2 text-text-secondary">{v.deliberacao?.resultado ?? "—"}</td>
                  <td className="py-1.5 px-2">
                    <span className={cn(
                      "badge text-[10px]",
                      v.tipo_voto === "Favoravel" && "badge-green",
                      v.tipo_voto === "Desfavoravel" && "badge-red",
                      v.is_divergente && "badge-orange",
                      !["Favoravel", "Desfavoravel"].includes(v.tipo_voto) && "badge-gray",
                    )}>
                      {v.tipo_voto}
                      {v.is_divergente ? " · div." : ""}
                    </span>
                  </td>
                  <td className="py-1.5 pl-2 text-text-muted whitespace-nowrap">
                    {v.deliberacao?.data_reuniao
                      ? new Date(v.deliberacao.data_reuniao).toLocaleDateString("pt-BR")
                      : v.created_at
                        ? new Date(v.created_at).toLocaleDateString("pt-BR")
                        : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
