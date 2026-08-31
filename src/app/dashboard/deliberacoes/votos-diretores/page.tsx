"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, listaDe } from "@/lib/api";
import { cn, formatDateLong, formatNumber } from "@/lib/utils";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { DELIBERACOES_TABS } from "@/lib/module-tabs";
import { useDataSyncContext } from "@/components/DataSyncProvider";
import { useViewer } from "@/lib/use-viewer";
import { CAPACIDADE_POR_EIXO } from "@/lib/server/colegiado-sources";
import { destinoForaDaEsteira, podeVirarVoto } from "@/lib/esteira-tipos";
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
  Users,
  X,
} from "lucide-react";

const COLEGIADO_SIGLAS = ["ANTT", "ANM", "ARTESP"];

// Etapa67 — matriz de capacidade por eixo (módulo puro, importável no client).
const EIXO_LABEL: Record<string, string> = {
  presenca: "Presença",
  relatoria: "Relatoria",
  merito: "Sentido do mérito",
  impedimento: "Impedimento",
  dissenso: "Dissenso nominal",
};

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

type CoberturaAoVivoAgencia = {
  sigla: string;
  erro: string | null;
  /** A listagem do site foi lida só em parte — com isto `true`, "faltando: 0" NÃO prova cobertura. */
  enumeracao_parcial?: boolean;
  site_total: number;
  banco_total: number;
  faltando: number[];
  extra: number[];
};
type CoberturaAoVivoResponse = {
  ano: number;
  gerado_em?: string;
  por_agencia: CoberturaAoVivoAgencia[];
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
  // Viewer (ago/2026): somente visualização — esconde as ações de escrita (o servidor
  // também barra com 403; isto é só a UI honesta). Exports (GET) continuam visíveis.
  const { isViewer } = useViewer();
  const [agenciaId, setAgenciaId] = useState("");
  const [selectedDirector, setSelectedDirector] = useState<DiretorOverviewItem | null>(null);
  const [relatorioBusy, setRelatorioBusy] = useState<"" | "html" | "docx" | "csv">("");

  // Relatório precisa de Bearer (rota admin); um <a href> não manda o token → 401. Fazemos
  // fetch autenticado → abre (PDF via impressão) ou baixa (Word/CSV) por blob.
  async function gerarRelatorio(format: "html" | "docx" | "csv") {
    if (demoEnabled || relatorioBusy) return;
    const qs = new URLSearchParams();
    if (agenciaId) qs.set("agencia_id", agenciaId);
    if (format !== "html") qs.set("format", format);
    const url = `/api/v1/relatorios/votos-diretores${qs.toString() ? `?${qs.toString()}` : ""}`;
    const win = format === "html" ? window.open("", "_blank") : null;
    setRelatorioBusy(format);
    try {
      let token: string | null = null;
      try {
        const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
        const { data } = await createSupabaseBrowserClient().auth.getSession();
        token = data.session?.access_token ?? null;
      } catch { token = null; }
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`Falha ao gerar o relatório (${res.status}).`);
      if (format === "html") {
        const htmlText = await res.text();
        if (win) { win.document.open(); win.document.write(htmlText); win.document.close(); win.focus(); }
      } else {
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objUrl;
        a.download = format === "docx" ? "iris-votos-por-diretor.docx" : "iris-votos-por-diretor.csv";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
      }
    } catch {
      win?.close();
      window.alert("Não foi possível gerar o relatório agora. Tente de novo.");
    } finally {
      setRelatorioBusy("");
    }
  }

  const { data, isLoading } = useQuery({
    queryKey: ["votos-diretores", "fontes"],
    queryFn: () => api.get<VotosDiretoresResponse>("/deliberacoes/votos-diretores"),
  });

  const { data: agencias } = useQuery({
    queryKey: ["agencias"],
    queryFn: async () => listaDe<Agencia>(await api.get("/agencias")),
  });

  const { data: diretores } = useQuery({
    queryKey: ["dashboard", "diretores-overview", "votos", agenciaId],
    queryFn: async () => listaDe<DiretorOverviewItem>(await api.get(`/dashboard/diretores/overview${agenciaId ? `?agencia_id=${agenciaId}` : ""}`)),
  });

  const { data: drilldownVotos, isLoading: drilldownLoading } = useQuery({
    queryKey: ["diretor-votos", selectedDirector?.diretor_id, agenciaId],
    queryFn: async () =>
      listaDe<DiretorVotoItem>(await api.get(
        `/dashboard/diretores/${selectedDirector!.diretor_id}/votos${agenciaId ? `?agencia_id=${agenciaId}` : ""}`
      )),
    enabled: !!selectedDirector,
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
      // Encadeia a PIPELINE ao fim da varredura: "Buscar todas" descobre; a pipeline processa,
      // aprova e gera as métricas — 1 fluxo, sem descompasso "serão aprovadas no próximo".
      // (rodarTudoMutation é declarada abaixo; o closure só roda pós-render, sem TDZ.)
      if (!rodarTudoMutation.isPending) rodarTudoMutation.mutate();
    },
  });

  const { data: candidatos } = useQuery({
    queryKey: ["diretores-candidatos", "pendentes", agenciaId],
    queryFn: async () => listaDe<DiretorCandidato>(await api.get(`/diretores/candidatos?status=pendente${agenciaId ? `&agencia_id=${agenciaId}` : ""}`)),
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

  // Cobertura AO VIVO: conferência CONTRA o site (sob demanda — busca 3 sites, é pesado).
  const coberturaMutation = useMutation({
    mutationFn: () => api.get<CoberturaAoVivoResponse>("/admin/cobertura-ao-vivo?year=2026"),
  });

  // Fila de revisão — o fluxo é zero-toque; isto lista só o que genuinamente
  // precisa de olho humano (exceção, não regra), sem sair da tela.
  const { data: pendentesRevisao } = useQuery({
    queryKey: ["docs-review-pending-colegiado"],
    queryFn: () =>
      // Fase 7 — `signed_url` (URL assinada do PDF, 1h) SEMPRE veio nesta resposta; estava
      // invisível só porque o tipo inline aqui não a declarava. Declarada, "abrir o PDF" vira
      // um link direto, sem rota nova.
      api.get<{ total: number; data: Array<{ id: string; filename: string | null; tipo_documento: string | null; signed_url?: string | null; agencia?: { sigla?: string } | null }> }>(
        "/upload/documentos?status=review_pending&limit=50",
      ).catch(() => ({ total: 0, data: [] })),
  });

  // (A aprovação em lote virou passo interno da pipeline zero-toque — /pipeline/run.)

  // Elo coleta→fila (QA ago/2026): itens DETECTADOS que ainda não viraram documento
  // ("novo"), arquivados com motivo ("ignorado"/sem_pdf) e extrações que falharam —
  // era o buraco invisível dos "208 detectados / 0 processados".
  const { data: presosColeta } = useQuery({
    queryKey: ["nao-enfileirados"],
    queryFn: () =>
      api.get<{
        total_nao_enfileirados: number;
        grupos: Array<{ agencia: string; tipo: string; status: string; motivo?: string | null; total: number; amostra: Array<{ url: string; motivo: string | null }> }>;
        falhas_extracao: Array<{ documento_id: string; agencia: string; filename: string | null; status: string; erro: string | null }>;
        total_arquivados?: number;
        total_arquivados_recuperaveis?: number;
      }>("/admin/monitoramento/nao-enfileirados").catch(() => ({ total_nao_enfileirados: 0, grupos: [], falhas_extracao: [], total_arquivados: 0, total_arquivados_recuperaveis: 0 })),
  });

  // Diagnóstico: POR QUE os voto_individual estão parados no gate (agregado por motivo).
  // É o que orienta o operador — sem direção do voto / confiança baixa / relator ambíguo.
  const { data: pendenciasVoto } = useQuery({
    queryKey: ["pendencias-voto-diagnostico"],
    queryFn: () =>
      api.get<{
        total_pendentes: number; confirmaveis: number; motivos: Array<{ key: string; label: string; total: number }>;
        total_review_pending?: number; por_tipo?: Array<{ tipo: string; total: number; categoria: string }>;
      }>(
        "/admin/upload/pendencias-voto",
      ).catch(() => ({
        total_pendentes: 0,
        confirmaveis: 0,
        motivos: [] as Array<{ key: string; label: string; total: number }>,
        total_review_pending: 0,
        por_tipo: [] as Array<{ tipo: string; total: number; categoria: string }>,
      })),
  });

  // Etapa67 — as mutations de aprovar/rejeitar candidato saíram junto com o card: a rota
  // individual continua existindo, mas a decisão agora é do auto-resolver do "Rodar tudo".

  // "Rodar tudo": encadeia a esteira inteira num clique (o plano grátis não roda os
  // crons). Verificar novos → Processar atas/votos → Auto-confirmar (loop) → Recalcular
  // matches (auto-aprova + mescla duplicatas). Progresso textual na UI.
  const [rodarTudoProgresso, setRodarTudoProgresso] = useState<string | null>(null);
  // Fase 7 — a execução vive no SERVIDOR, não nesta aba. Ao montar, a tela pergunta o que está
  // acontecendo: se há execução em andamento (esta aba, outra aba, ou o cron), ela mostra o
  // andamento em vez de fingir que nada acontece; e o desfecho da ÚLTIMA execução aparece mesmo
  // que quem a disparou tenha fechado a aba — inclusive um disjuntor aberto, que ninguém pode
  // perder de vista.
  const [runIdAtivo, setRunIdAtivo] = useState<string | null>(null);
  type EsteiraStatus = {
    em_andamento: boolean;
    run: { id: string; rodadas: number; passos_erro: number; iniciado_em: string } | null;
    ultima: { status: string; rodadas: number; motivo_parada: string | null; concluido_em: string | null } | null;
  };
  const { data: esteiraStatus } = useQuery({
    queryKey: ["pipeline-status"],
    queryFn: () => api.get<EsteiraStatus>("/pipeline/status").catch(() => ({ em_andamento: false, run: null, ultima: null })),
    // Enquanto algo roda, pergunte de novo; parado, não fique batendo no servidor à toa.
    refetchInterval: (q) => ((q.state.data as EsteiraStatus | undefined)?.em_andamento ? 10_000 : false),
  });
  // ZERO-TOQUE: a esteira INTEIRA roda server-side em /pipeline/run (coleta → reclassificação →
  // extração → aprovação em camadas com dedup em 4 barreiras → diretores → dedup final). O cliente
  // só re-chama enquanto `restantes` (orçamento de tempo do Hobby). Nada exige aprovação manual.
  type PipelineEtapas = Record<string, Record<string, number | string | boolean>>;
  const rodarTudoMutation = useMutation({
    mutationFn: async () => {
      const totais: Record<string, number> = {};
      let ultimas: PipelineEtapas = {};
      // QA ago/2026: try/catch POR RODADA — um timeout (SIGKILL do Hobby) não aborta o
      // run inteiro nem perde o progresso já gravado no servidor; 2 falhas seguidas
      // encerram com o que temos. Teto 40 rodadas (fila grande de backfill).
      let falhasSeguidas = 0;
      // Fase 7 — o desfecho da esteira deixa de ser inventado pelo banner. Antes, 40 rodadas com
      // HTTP 500 terminavam em banner VERDE de "concluída" com totais zerados: o catch por rodada
      // engolia tudo e `onError` era inalcançável (a mutation nunca rejeitava). Agora o motivo
      // real da parada sobe junto com os números.
      let rodadasComErro = 0;
      let ultimoErro: string | null = null;
      let desfecho: "drenou" | "erros" | "teto" | "abortado" = "teto";
      let rodadasFeitas = 0;
      // Fase 7 — o `run_id` amarra as rodadas a UMA execução no servidor. É ele que faz "fechar a
      // aba" deixar de perder o acompanhamento (ao reabrir, a tela retoma este id) e que impede
      // duas abas de rodarem a esteira sobre as mesmas linhas: a segunda recebe 409.
      let runId: string | null = runIdAtivo;
      // Fase 14 — TRAVA DE RELÓGIO no lugar do contador (o resto da Fase 11 que nunca subiu).
      // 40 rodadas era um número arbitrário que não sabia se o trabalho acabou: com fila grande
      // parava cedo demais ("parou no teto — ainda há fila", a tela real de 31/08), e com fila
      // vazia o `deveContinuar` já encerra em segundos. O laço agora corre até drenar OU até o
      // teto de TEMPO — rede de segurança, não desfecho padrão. O teto de 300 rodadas é só o
      // anti-laço-infinito (o relógio dispara muito antes).
      const inicioLaco = Date.now();
      const TETO_LACO_MS = 25 * 60_000;
      for (let rodada = 1; rodada <= 300; rodada++) {
        rodadasFeitas = rodada;
        if (Date.now() - inicioLaco > TETO_LACO_MS) { desfecho = "teto"; break; }
        setRodarTudoProgresso(`Rodada ${rodada} · aprovação → métricas → coleta/extração…`);
        try {
          const res = await api.post<{
            etapas: PipelineEtapas;
            restantes: boolean;
            run_id?: string | null;
            abortado?: boolean;
            motivo_parada?: string;
          }>("/pipeline/run", runId ? { run_id: runId } : {});
          falhasSeguidas = 0;
          runId = res.run_id ?? runId;
          setRunIdAtivo(runId);
          ultimas = res.etapas ?? {};
          for (const etapa of Object.values(ultimas)) {
            for (const [k, v] of Object.entries(etapa)) {
              if (typeof v === "number") totais[k] = (totais[k] ?? 0) + v;
            }
          }
          if (res.abortado) {
            desfecho = "abortado";
            ultimoErro = res.motivo_parada ?? "disjuntor aberto";
            break;
          }
          if (!res.restantes) { desfecho = "drenou"; break; }
        } catch (err) {
          falhasSeguidas++;
          rodadasComErro++;
          ultimoErro = err instanceof Error ? err.message : "erro desconhecido na rodada";
          if (falhasSeguidas >= 2) { desfecho = "erros"; break; } // 2 falhas seguidas: para com o progresso feito
        }
      }
      // Fase 12 — AVISAR o servidor antes de limpar o estado local. Nos desfechos em que o
      // SERVIDOR já fechou a run ("drenou" fecha com concluído; "abortado" é o disjuntor), o
      // encerrar é no-op idempotente. Nos outros ("teto", "erros") era exatamente o buraco: a
      // run ficava `running` por 3min e virava "erro" fantasma — os dois banners contraditórios.
      if (runId && (desfecho === "teto" || desfecho === "erros")) {
        await api.post("/pipeline/run", {
          run_id: runId,
          encerrar: true,
          motivo: desfecho === "teto" ? "teto de rodadas do cliente" : `parou após erros: ${ultimoErro ?? "—"}`,
        }).catch(() => { /* o reaper de órfãs cobre se este aviso falhar */ });
      }
      setRunIdAtivo(null);
      return { totais, ultimas, rodadasComErro, ultimoErro, desfecho, rodadasFeitas };
    },
    onSuccess: ({ totais, rodadasComErro, ultimoErro, desfecho, rodadasFeitas }) => {
      setMatchError(null);
      setRodarTudoProgresso(null);
      const partes = [
        `${totais.processados ?? 0} PDF(s) extraído(s)`,
        `${(totais.confirmados ?? 0) + (totais.materializados ?? 0)} materializado(s)`,
        (totais.duplicatas_arquivadas ?? 0) + (totais.fundidos_semanticos ?? 0) > 0
          ? `${(totais.duplicatas_arquivadas ?? 0) + (totais.fundidos_semanticos ?? 0)} duplicata(s) resolvida(s)`
          : null,
        (totais.ignorados_pauta_apoio ?? 0) > 0 ? `${totais.ignorados_pauta_apoio} pauta(s)/apoio arquivado(s)` : null,
        (totais.aprovados ?? 0) > 0 ? `${totais.aprovados} diretor(es)/nome(s) resolvido(s)` : null,
        // Etapa67 — a medição do auto-resolver, visível: mandato/margem são os caminhos bons;
        // `sem margem` é o fallback carimbado com confianca_match (esperado: raro).
        (totais.rejeitados_lixo ?? 0) > 0 ? `${totais.rejeitados_lixo} nome(s)-lixo drenado(s)` : null,
        (totais.resolvidos_por_mandato ?? 0) > 0 ? `${totais.resolvidos_por_mandato} desambiguado(s) pelo mandato` : null,
        (totais.resolvidos_sem_margem ?? 0) > 0 ? `${totais.resolvidos_sem_margem} resolvido(s) SEM margem (auditáveis por confianca_match)` : null,
        // Fase 12 — dois números HONESTOS no lugar de um falso: `reenfileirados` era gravado
        // por DOIS passos (reclassificação e desarquivamento) e o banner somava tudo.
        (totais.reclassificados ?? 0) > 0 ? `${totais.reclassificados} reclassificado(s)` : null,
        (totais.desarquivados ?? 0) > 0 ? `${totais.desarquivados} desarquivado(s)` : null,
        (totais.votos ?? 0) > 0 ? `${totais.votos} voto(s) recuperado(s) em deliberações antigas` : null,
      ].filter(Boolean);
      // O desfecho é o que o servidor de fato produziu, não o fato de a mutation ter retornado.
      if (desfecho === "abortado") {
        // O disjuntor é a diferença entre uma rodada ruim e 300 documentos mal
        // processados: ele PARA a esteira, não só registra.
        setMatchFeedback(null);
        setMatchError(
          `A esteira foi ABORTADA pelo disjuntor de erros na rodada ${rodadasFeitas}. ${ultimoErro ?? ""} ` +
            `O que já havia sido gravado está no banco: ${partes.join(" · ")}.`,
        );
      } else if (desfecho === "erros") {
        setMatchFeedback(null);
        setMatchError(
          `A esteira PAROU após ${rodadasComErro} rodada(s) com erro (2 seguidas) na rodada ${rodadasFeitas}. ` +
            `O que já havia sido gravado está no banco: ${partes.join(" · ")}. Último erro: ${ultimoErro ?? "—"}.`,
        );
      } else {
        const cabecalho = desfecho === "drenou"
          ? "Esteira zero-toque concluída (fila drenada)"
          : `Esteira parou no teto de tempo (~25min, ${rodadasFeitas} rodadas) — ainda há fila; rode de novo para continuar`;
        const ressalva = rodadasComErro > 0
          ? ` · ⚠️ ${rodadasComErro} rodada(s) falharam pelo caminho (último erro: ${ultimoErro ?? "—"})`
          : "";
        setMatchFeedback(`${cabecalho}: ${partes.join(" · ")}${ressalva}.`);
      }
      for (const key of [
        ["dashboard"], ["votos-diretores"], ["completude-2026"], ["pendencias-voto-diagnostico"],
        ["docs-review-pending-colegiado"], ["deliberacoes"], ["diretores"], ["votacao"], ["empresas"],
        ["mandatos"], ["governanca-agencias"], ["deliberacoes-360"], ["deliberacoes-gov"],
        ["nao-enfileirados"], ["pipeline-status"],
      ]) queryClient.invalidateQueries({ queryKey: key });
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
          {!isViewer && <button
            onClick={() => rodarTudoMutation.mutate()}
            disabled={rodarTudoMutation.isPending || demoEnabled}
            className="btn-primary"
            title="Zero-toque: coleta → extração → aprovação automática (dedup em 4 barreiras) → métricas em todos os módulos. Um clique faz tudo."
          >
            {rodarTudoMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {rodarTudoProgresso ?? "Rodar tudo"}
          </button>}
          {!isViewer && <button
            onClick={() => backfillMutation.mutate()}
            disabled={backfillMutation.isPending || rodarTudoMutation.isPending || demoEnabled}
            className="btn-secondary"
            title="Varredura AMPLA: busca todas as reuniões/documentos de 2026 das 3 agências e, ao terminar, roda a esteira completa sozinho (processa, aprova e gera as métricas)"
          >
            {backfillMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Buscar todas de 2026
          </button>}
          <button
            type="button"
            onClick={() => gerarRelatorio("html")}
            disabled={demoEnabled || relatorioBusy !== ""}
            className="btn-secondary"
            title="Abre o relatório dos votos por diretor (identidade IRIS, com gráficos) — imprimir → salvar PDF"
          >
            {relatorioBusy === "html" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            Gerar relatório (PDF)
          </button>
          <button
            type="button"
            onClick={() => gerarRelatorio("docx")}
            disabled={demoEnabled || relatorioBusy !== ""}
            className="btn-secondary"
            title="Baixar o relatório em Word (.docx)"
          >
            {relatorioBusy === "docx" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            Word
          </button>
          <button
            type="button"
            onClick={() => gerarRelatorio("csv")}
            disabled={demoEnabled || relatorioBusy !== ""}
            className="btn-secondary"
            title="Baixar os dados por diretor em CSV (Excel)"
          >
            {relatorioBusy === "csv" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            CSV
          </button>
        </div>
      </div>

      {/* Fase 7 — a execução vive no SERVIDOR. Este painel é o que responde "eu fechei a aba, e
          daí?": ao voltar, a tela lê o andamento em vez de fingir que nada aconteceu. Ele também
          mostra a esteira rodando pelo CRON, que antes era completamente invisível. */}
      {esteiraStatus?.em_andamento && !rodarTudoMutation.isPending && esteiraStatus.run ? (
        <div className="border border-brand/30 bg-brand/10 rounded-card p-2.5 text-sm text-brand flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span>
            A esteira está rodando agora (rodada {esteiraStatus.run.rodadas}) — iniciada em{" "}
            {formatDateLong(esteiraStatus.run.iniciado_em)}. Pode fechar a aba: o progresso é gravado a cada rodada.
            {esteiraStatus.run.passos_erro > 0 && ` ⚠️ ${esteiraStatus.run.passos_erro} passo(s) falharam até aqui.`}
          </span>
        </div>
      ) : null}
      {!esteiraStatus?.em_andamento && esteiraStatus?.ultima?.status === "abortado" ? (
        <div className="border border-error/30 bg-error/10 rounded-card p-2.5 text-sm text-error">
          A última execução foi <span className="font-medium">abortada pelo disjuntor</span> após{" "}
          {esteiraStatus.ultima.rodadas} rodada(s). {esteiraStatus.ultima.motivo_parada}
        </div>
      ) : null}

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
      {/* ── Exceções (informativo): o pouco que o zero-toque não resolveu sozinho ── */}
      {((pendentesRevisao?.total ?? 0) > 0 || !demoEnabled) && (
        <section className="card space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand" />
              <div>
                <p className="section-label">Exceções {`(${pendentesRevisao?.total ?? 0})`}</p>
                <p className="text-[11px] text-text-muted">
                  A esteira é zero-toque (&ldquo;Rodar tudo&rdquo; coleta, extrai, aprova e gera as métricas). Aqui fica só o que o automático ainda não drenou — rode a esteira, ou revise 1-a-1 se quiser.
                </p>
              </div>
            </div>
          </div>
          {(pendenciasVoto?.total_pendentes ?? 0) > 0 && (
            <div className="rounded-card border border-border bg-surface-2/40 px-3 py-2.5 space-y-1.5">
              <p className="text-[11px] text-text-muted">
                {pendenciasVoto!.total_pendentes} voto(s) individual(is) na fila — por que o gate conservador não pegou primeiro:
                {(pendenciasVoto?.confirmaveis ?? 0) > 0 && (
                  <span className="text-success"> {pendenciasVoto!.confirmaveis} serão materializados no próximo &ldquo;Rodar tudo&rdquo;.</span>
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(pendenciasVoto?.motivos ?? []).map((m) => (
                  <span key={m.key} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-text-secondary" title={m.label}>
                    <span className="font-medium text-text-primary">{m.total}</span> {m.label}
                  </span>
                ))}
              </div>
              {(pendenciasVoto?.por_tipo ?? []).length > 0 && (() => {
                const pt = pendenciasVoto!.por_tipo!;
                const soma = (cat: string) => pt.filter((x) => x.categoria === cat).reduce((s, x) => s + x.total, 0);
                const residuo = soma("residuo_esperado");
                const aguardando = soma("aguardando_confirmacao");
                return (
                  <p className="text-[11px] text-text-muted">
                    Fila completa: {pendenciasVoto!.total_review_pending ?? 0} documento(s) —{" "}
                    {residuo > 0 && <span>{residuo} são pautas/apoio (serão arquivados pelo &ldquo;Rodar tudo&rdquo;; não viram deliberação por desenho)</span>}
                    {residuo > 0 && aguardando > 0 && " · "}
                    {aguardando > 0 && <span className="text-warning">{aguardando} atas/deliberações serão aprovadas no próximo &ldquo;Rodar tudo&rdquo;</span>}
                    .
                  </p>
                );
              })()}
            </div>
          )}
          {(presosColeta?.total_nao_enfileirados ?? 0) > 0 || (presosColeta?.falhas_extracao ?? []).length > 0 ? (
            <div className="rounded-card border border-border bg-surface-2/40 px-3 py-2.5 space-y-1.5">
              {(presosColeta?.total_nao_enfileirados ?? 0) > 0 && (() => {
                // Fase 7 — a legenda antiga prometia que "o próximo Rodar tudo baixa/enfileira em
                // rodadas". Era FALSO para 100% do que ela mostrava: os tipos exibidos (noticia,
                // politica_publica, consulta_publica, diretoria) estão fora do gate de
                // enfileiramento, então aqueles itens não sairiam de `novo` em rodada nenhuma.
                // Agora a tela usa a MESMA lista que o servidor (@/lib/esteira-tipos) e separa o
                // que a esteira vai processar do que ela nunca vai.
                const novos = (presosColeta?.grupos ?? []).filter((g) => g.status === "novo");
                const naEsteira = novos.filter((g) => podeVirarVoto(g.tipo));
                const foraDaEsteira = novos.filter((g) => !podeVirarVoto(g.tipo));
                const soma = (gs: typeof novos) => gs.reduce((s, g) => s + g.total, 0);
                return (
                  <>
                    <p className="text-[11px] text-text-muted">
                      <span className="text-warning font-medium">{presosColeta!.total_nao_enfileirados} detectado(s) ainda não processado(s)</span>
                      {" — "}
                      {soma(naEsteira) > 0
                        ? <>{soma(naEsteira)} entra(m) na esteira de votos (o próximo &ldquo;Rodar tudo&rdquo; baixa/enfileira; os sem PDF são arquivados com motivo)</>
                        : <>nenhum entra na esteira de votos</>}
                      {soma(foraDaEsteira) > 0 && (
                        <> · <span className="text-text-secondary">{soma(foraDaEsteira)} são de tipos que a esteira de votos não processa</span> — ficam em &ldquo;novo&rdquo; por desenho, alimentando outros módulos</>
                      )}
                      :
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {[...naEsteira, ...foraDaEsteira].slice(0, 8).map((g) => {
                        const fora = destinoForaDaEsteira(g.tipo);
                        return (
                          <span
                            key={`${g.agencia}-${g.tipo}`}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                              fora ? "border-border/60 text-text-label" : "border-border text-text-secondary",
                            )}
                            title={[fora ?? "entra na esteira de votos", "", ...g.amostra.map((a) => a.url)].join("\n")}
                          >
                            <span className={cn("font-medium", fora ? "text-text-muted" : "text-text-primary")}>{g.total}</span> {g.agencia} · {g.tipo}
                            {fora && <span className="opacity-60">·fora</span>}
                          </span>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
              {/* Fase 8 — os ARQUIVADOS deixam de ser invisíveis. A rota sempre os devolveu
                  (status `ignorado`) e a tela filtrava só `novo`: o motivo era gravado e ninguém
                  via. Separar por MOTIVO é o que importa — `download_falhou` é falha de rede (o
                  portal pode voltar), `sem_pdf` é decisão de conteúdo. */}
              {(presosColeta?.total_arquivados ?? 0) > 0 && (() => {
                const arquivados = (presosColeta?.grupos ?? []).filter((g) => g.status === "ignorado");
                const recuperaveis = presosColeta?.total_arquivados_recuperaveis ?? 0;
                return (
                  <div className="pt-1.5 border-t border-border/50 space-y-1.5">
                    <p className="text-[11px] text-text-muted">
                      <span className="text-text-secondary font-medium">{presosColeta!.total_arquivados} arquivado(s) com motivo</span>
                      {" — saíram da fila e "}
                      {recuperaveis > 0
                        ? <><span className="text-warning">{recuperaveis} por falha de download</span> (o portal pode ter voltado; serão retentados)</>
                        : <>nenhum por falha de rede</>}
                      {". O restante é conteúdo: a página não trazia PDF de decisão."}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {arquivados.slice(0, 8).map((g) => (
                        <span
                          key={`arq-${g.agencia}-${g.tipo}-${g.motivo ?? "-"}`}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                            g.motivo === "download_falhou" ? "border-warning/40 text-warning" : "border-border/60 text-text-label",
                          )}
                          title={g.amostra.map((a) => a.url).join("\n")}
                        >
                          <span className="font-medium">{g.total}</span> {g.agencia} · {g.tipo} · {g.motivo ?? "sem motivo"}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {(presosColeta?.falhas_extracao ?? []).length > 0 && (
                <p className="text-[11px] text-text-muted">
                  {presosColeta!.falhas_extracao.length} documento(s) com falha/fila de extração —{" "}
                  {/* Fase 7 — cada falha já trazia `documento_id` na resposta e não era clicável:
                      dava para ver QUE falhou, nunca O QUE falhou. */}
                  {presosColeta!.falhas_extracao.slice(0, 3).map((f, i) => (
                    <span key={f.documento_id ?? i}>
                      {i > 0 && " · "}
                      {f.documento_id ? (
                        <a
                          href={`/dashboard/upload?doc=${encodeURIComponent(f.documento_id)}`}
                          className="text-text-secondary hover:text-brand hover:underline"
                          title={f.filename ?? undefined}
                        >
                          {f.agencia}: {f.erro ?? f.status}
                        </a>
                      ) : (
                        <span className="text-text-secondary">{f.agencia}: {f.erro ?? f.status}</span>
                      )}
                    </span>
                  ))}
                  {presosColeta!.falhas_extracao.length > 3 ? " · …" : ""} — o &ldquo;Rodar tudo&rdquo; re-tenta os que estão presos em processamento ou com falha de extração (até 3 ciclos); os demais aguardam reenvio.
                </p>
              )}
            </div>
          ) : null}
          {(pendentesRevisao?.data ?? []).length > 0 ? (
            <div className="space-y-1.5">
              {(pendentesRevisao?.data ?? []).slice(0, 10).map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-3 text-sm border border-border rounded-card px-3 py-2">
                  <span className="truncate text-text-primary">
                    {doc.filename ?? doc.id}
                    <span className="text-text-muted"> · {doc.agencia?.sigla ?? "?"} · {doc.tipo_documento ?? "doc"}</span>
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    {doc.signed_url && (
                      <a
                        href={doc.signed_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-text-muted text-xs hover:text-text-primary hover:underline"
                        title="Abrir o PDF original numa aba nova"
                      >
                        PDF ↗
                      </a>
                    )}
                    {/* Fase 7 — o link levava para /dashboard/upload sem NENHUM dado do item:
                        caía na dropzone vazia e o usuário nunca via o documento que pediu para
                        revisar. Agora leva ao documento certo, já aberto na revisão. */}
                    <a href={`/dashboard/upload?doc=${encodeURIComponent(doc.id)}`} className="text-brand text-xs hover:underline">
                      Revisar →
                    </a>
                  </span>
                </div>
              ))}
              {(pendentesRevisao?.total ?? 0) > 10 && (
                <p className="text-xs text-text-muted">
                  + {(pendentesRevisao!.total) - 10} outro(s) — o próximo &ldquo;Rodar tudo&rdquo; drena a fila inteira automaticamente.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-text-muted">Nenhuma exceção — a esteira zero-toque está em dia.</p>
          )}
        </section>
      )}

      {/* Etapa67 — o card "Matches Pendentes" saiu da tela (decisão do usuário: nada espera
          humano). O "Rodar tudo" drena o lixo, resolve ambiguidade pelo MANDATO ativo na data,
          aprova por margem, e no fallback sem margem aprova o melhor score carimbando
          `confianca_match` no voto. A rota /diretores/candidatos segue existindo para
          diagnóstico; as contagens (resolvidos_por_mandato / por_margem / sem_margem /
          rejeitados_lixo) saem na resposta do aprovar-lote e do recompute. */}

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
                  disabled={mergeMutation.isPending || demoEnabled || isViewer}
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
        </section>
      )}

      {/* ── Cobertura AO VIVO: conferência CONTRA o site (a prova de completude) ── */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="section-label">Cobertura ao vivo (conferência contra o site)</p>
            <p className="text-xs text-text-muted">
              Enumera AO VIVO as reuniões que cada site publica e compara com o que temos — a prova de que não falta documento.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => coberturaMutation.mutate()}
            disabled={coberturaMutation.isPending || demoEnabled}
            title="Busca AO VIVO as reuniões de ANTT/ARTESP/ANM e compara com o banco por número de reunião."
          >
            {coberturaMutation.isPending ? "Conferindo os sites…" : "Conferir contra os sites"}
          </button>
        </div>
        {coberturaMutation.isError && (
          <p className="text-xs text-error">Falha ao conferir os sites agora. Tente de novo.</p>
        )}
        {coberturaMutation.data && (
          <>
            {(() => {
              const ags = coberturaMutation.data?.por_agencia ?? [];
              const totalFaltando = ags.reduce((s, a) => s + (a.erro ? 0 : a.faltando.length), 0);
              const comErro = ags.filter((a) => a.erro).length;
              if (totalFaltando > 0) {
                return (
                  <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm font-medium text-error">
                    ⚠ Faltam {totalFaltando} reunião(ões) publicada(s) nos sites e ausente(s) no banco — rode &ldquo;Rodar tudo&rdquo; e confira as agências abaixo.
                  </div>
                );
              }
              // Fase 7 — enumeração parcial NÃO pode virar "✓ completo". Se a listagem do site foi
              // cortada, "faltando: 0" só diz que nada do PEDAÇO lido está ausente.
              const parciais = ags.filter((a) => a.enumeracao_parcial);
              if (parciais.length > 0) {
                return (
                  <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                    Conferência <span className="font-medium">incompleta</span> em {parciais.map((a) => a.sigla).join(", ")} —
                    a listagem do site foi lida só em parte, então isto NÃO prova cobertura.
                  </div>
                );
              }
              if (comErro === 0) {
                return (
                  <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm font-medium text-success">
                    ✓ Cobertura completa — todas as reuniões publicadas nos sites estão no banco.
                  </div>
                );
              }
              return (
                <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  {comErro} agência(s) não puderam ser conferidas agora (o site não respondeu) — tente de novo.
                </div>
              );
            })()}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-muted border-b border-border">
                    <th className="py-1 pr-3 font-medium">Agência</th>
                    <th className="py-1 px-2 font-medium text-right">Reuniões no site</th>
                    <th className="py-1 px-2 font-medium text-right">Temos (c/ deliberação)</th>
                    <th className="py-1 pl-2 font-medium">Faltando (nº de reunião)</th>
                  </tr>
                </thead>
                <tbody>
                  {coberturaMutation.data.por_agencia.map((a) => (
                    <tr key={a.sigla} className="border-b border-border/50 align-top">
                      <td className="py-1.5 pr-3 font-medium text-text-primary">{a.sigla}</td>
                      <td className="py-1.5 px-2 text-right">{a.erro ? "—" : a.site_total}</td>
                      <td className="py-1.5 px-2 text-right">{a.erro ? "—" : a.banco_total}</td>
                      <td className="py-1.5 pl-2">
                        {a.erro ? (
                          <span className="text-warning">{a.erro}</span>
                        ) : a.enumeracao_parcial ? (
                          <span className="text-warning">enumeração parcial — não dá para afirmar completude</span>
                        ) : a.faltando.length === 0 ? (
                          <span className="text-success">nada — completo ✓</span>
                        ) : (
                          <span className="text-warning">{a.faltando.map((n) => `${n}ª`).join(", ")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(coberturaMutation.data.alertas ?? []).length > 0 && (
              <ul className="text-xs text-text-muted space-y-1 list-disc pl-4">
                {coberturaMutation.data.alertas.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            )}
            {coberturaMutation.data.gerado_em && (
              <p className="text-[11px] text-text-muted">
                Conferido ao vivo em {new Date(coberturaMutation.data.gerado_em).toLocaleString("pt-BR")}.
              </p>
            )}
          </>
        )}
      </section>

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
                  {/* Etapa67 — relatoria: nominal em 100% dos itens, o eixo que não depende do
                      dissenso. É a coluna que preenche o perfil do diretor da ANTT/ARTESP. */}
                  <th className="py-2 px-3 font-medium text-right" title="Matérias relatadas por este diretor — dado nominal em 100% dos itens">Relatorias</th>
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
                        {/* Fase 12 — sigla junto do nome: a tabela agrega as 3 agências. */}
                        {d.agencia_sigla && (
                          <span className="ml-1.5 text-[10px] font-mono text-text-muted uppercase">{d.agencia_sigla}</span>
                        )}
                        {(d.nominais ?? 0) + (d.inferidos ?? 0) > 0 && (
                          <span className="block text-[10px] font-normal text-text-muted">
                            {d.nominais ?? 0} lido{(d.nominais ?? 0) === 1 ? "" : "s"} · {d.inferidos ?? 0} inferido{(d.inferidos ?? 0) === 1 ? "" : "s"}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right text-brand">{formatNumber(d.relatorias ?? 0)}</td>
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
                        <td colSpan={8} className="pb-3 pt-1 px-0">
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

        {/* Etapa67 — matriz de capacidade POR EIXO, no lugar do aviso genérico de "base nominal".
            Só a linha do DISSENSO é escassa; presença, relatoria e mérito são densos em todas as
            agências. É o que explica por que o perfil de um diretor da ANTT não é "vazio". */}
        <div className="overflow-x-auto">
          <table className="text-[11px] text-text-muted">
            <thead>
              <tr className="text-left">
                <th className="pr-3 py-1 font-medium">O que a FONTE publica</th>
                {["ANM", "ANTT", "ARTESP"].map((sig) => (
                  <th key={sig} className="px-2 py-1 font-medium text-center">{sig}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.entries(CAPACIDADE_POR_EIXO) as Array<[string, Record<string, string>]>).map(([eixo, porAg]) => (
                <tr key={eixo} className="border-t border-border/40">
                  <td className="pr-3 py-1 capitalize">{EIXO_LABEL[eixo] ?? eixo}</td>
                  {["ANM", "ANTT", "ARTESP"].map((sig) => (
                    <td key={sig} className="px-2 py-1 text-center">
                      <span className={cn(
                        "inline-block px-1.5 rounded text-[10px] font-mono uppercase",
                        porAg[sig] === "nominal" && "bg-success/15 text-success",
                        porAg[sig] === "parcial" && "bg-warning/15 text-warning",
                        porAg[sig] === "nenhum" && "bg-bg-hover text-text-label",
                      )}>{porAg[sig] ?? "?"}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] text-text-label mt-1">
            &ldquo;Nenhum&rdquo; é limite da FONTE, não do sistema — o dissenso da ANTT vem dos documentos de
            Voto, ingeridos à parte.
          </p>
        </div>
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
