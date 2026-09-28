"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, listaDe, ApiError } from "@/lib/api";
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
import { agregarEtapas } from "@/lib/server/agregar-rodadas";
import { decidirAposCerca } from "@/lib/server/cerca-do-cliente";
import { classificarFila, cabecalhoDoEstadoDaFila, type ContagensDaFila } from "@/lib/server/estado-da-fila";

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
  diretores: { aprovados: number; com_voto: number; candidatos_pendentes: number; candidatos_em_conflito?: number };
  ultima_captura?: {
    reuniao_mais_recente_no_monitoramento: string | null;
    reuniao_mais_recente_com_deliberacao: string | null;
    /** ⚠️ ESTE é captura de verdade (`last_seen_at`); os dois acima são data de REUNIÃO. */
    capturado_em: string | null;
  };
};

type CompletudeResponse = {
  ano: number;
  por_agencia: CompletudeAgencia[];
  totais: {
    documentos_2026_detectados: number; deliberacoes_finais: number; votos_total: number;
    /**
     * ⚠️ Opcionais porque a rota pode estar num deploy anterior — e o `??` no consumo é o default
     * HONESTO aqui: campo ausente = não medido, então não há aviso a dar. Diferente de `?? 0` sobre
     * um número que a rota mediu e devolveu, que é o engolidor que esta fase persegue.
     */
    deliberacoes_sem_data_de_reuniao?: number;
    leituras_com_erro?: string[];
    leituras_truncadas?: string[];
  };
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
  // Fase 25 — o período do card "Métricas por diretor". "" = todo o histórico (era o único
  // modo, sem rótulo, ao lado de uma Completude que é só 2026).
  const [anoVotos, setAnoVotos] = useState("");
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
    queryKey: ["dashboard", "diretores-overview", "votos", agenciaId, anoVotos],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (agenciaId) params.set("agencia_id", agenciaId);
      if (anoVotos) params.set("ano", anoVotos);
      const qs = params.toString();
      return listaDe<DiretorOverviewItem>(await api.get(`/dashboard/diretores/overview${qs ? `?${qs}` : ""}`));
    },
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

  // Fase 26 — a amostra de auditoria (reproduzível por dia; "outra amostra" troca o seed).
  const [amostraSeed, setAmostraSeed] = useState("");
  type Amostra = { ano: string; seed: string; agencias: Array<{ sigla: string; universo: number; itens: Array<{ id: string; numero: string | null; tipo: string | null; data: string | null; relator: string | null; resultado: string | null; interessado: string | null; processo: string | null; pdf: string | null; arquivo: string | null; votos: Array<{ diretor: string; tipo: string; origem: string }> }> }> };
  const { data: amostra } = useQuery({
    queryKey: ["auditoria-amostra", amostraSeed],
    queryFn: () => api.get<Amostra>(`/admin/auditoria/amostra?n=5&ano=2026${amostraSeed ? `&seed=${amostraSeed}` : ""}`).catch(() => ({ ano: "2026", seed: "", agencias: [] } as Amostra)),
  });

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
      // Fase 22 — `campos_detectados.auto_skip` é o MOTIVO que o auto-confirm gravou ao pular o
      // documento. Sempre veio na resposta; a tela descartava, e "146 para revisar" não dizia
      // por quê. Sem o motivo, a única resposta era revisar 1-a-1 — o oposto do zero-toque.
      api.get<{ total: number; data: Array<{ id: string; filename: string | null; tipo_documento: string | null; signed_url?: string | null; agencia?: { sigla?: string } | null; campos_detectados?: { auto_skip?: string | null } | null }> }>(
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
        falhas_extracao: Array<{ documento_id: string; agencia: string; filename: string | null; status: string; erro: string | null; ciclos_reprocesso?: number }>;
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
  /**
   * ⚠️ O rótulo que as chaves PARCIAIS são obrigadas a carregar.
   *
   * Elas são medidas sobre a janela ROTATIVA do materializador, que gira com o relógio: o mesmo
   * item é reexaminado em rodadas diferentes da mesma run e cada reexame reincrementa. Carregar a
   * contagem por entidade distinta entre rodadas exigiria persistir o conjunto de ids, e
   * `contadores` é um mapa de números. Então a saída honesta é a que o usuário pediu: dizer
   * explicitamente que o número NÃO é contagem de entidades distintas.
   */
  const ROTULO_PARCIAL = "ocorrências nos lotes, com repetição";
  const rodarTudoMutation = useMutation({
    mutationFn: async () => {
      const totais: Record<string, number> = {};
      let ultimas: PipelineEtapas = {};
      // QA ago/2026: try/catch POR RODADA — um timeout (SIGKILL do Hobby) não aborta o
      // run inteiro nem perde o progresso já gravado no servidor; 2 falhas seguidas
      // encerram com o que temos. Teto 40 rodadas (fila grande de backfill).
      let falhasSeguidas = 0;
      /** O token da cerca da run — vem da resposta e volta no corpo da chamada seguinte. */
      let rodadasVistas: number | null = null;
      // Fase 30 — os dois contadores da cerca, SEPARADOS: esperar é caro em tempo e barato em
      // requisições; adotar é o inverso. Um só faria a adoção consumir uma espera.
      let esperasDaCerca = 0;
      let adocoesDaCerca = 0;
      // Fase 7 — o desfecho da esteira deixa de ser inventado pelo banner. Antes, 40 rodadas com
      // HTTP 500 terminavam em banner VERDE de "concluída" com totais zerados: o catch por rodada
      // engolia tudo e `onError` era inalcançável (a mutation nunca rejeitava). Agora o motivo
      // real da parada sobe junto com os números.
      let rodadasComErro = 0;
      let ultimoErro: string | null = null;
      let desfecho: "drenou" | "erros" | "teto" | "abortado" = "teto";
      let rodadasFeitas = 0;
      let filaFinal: ContagensDaFila | null = null;
      // Fase 7 — o `run_id` amarra as rodadas a UMA execução no servidor. É ele que faz "fechar a
      // aba" deixar de perder o acompanhamento (ao reabrir, a tela retoma este id) e que impede
      // duas abas de rodarem a esteira sobre as mesmas linhas: a segunda recebe 409.
      // ⚠️ Fase 30 — A METADE-CLIENTE DA PORTA. `runIdAtivo` é `useState(null)` e nunca foi
      // semeado do `/pipeline/status`: TODA aba nova mandava corpo vazio. Com o servidor adotando
      // por omissão (até o commit anterior), isso era roubo de run; com a porta fechada, seria
      // 409 e o usuário sem como retomar. O status já traz `id` e `rodadas` — é só usá-los.
      let runId: string | null = runIdAtivo ?? esteiraStatus?.run?.id ?? null;
      if (!runIdAtivo && esteiraStatus?.run) rodadasVistas = esteiraStatus.run.rodadas;
      // Fase 14 — TRAVA DE RELÓGIO no lugar do contador (o resto da Fase 11 que nunca subiu).
      // 40 rodadas era um número arbitrário que não sabia se o trabalho acabou: com fila grande
      // parava cedo demais ("parou no teto — ainda há fila", a tela real de 31/08), e com fila
      // vazia o `deveContinuar` já encerra em segundos. O laço agora corre até drenar OU até o
      // teto de TEMPO — rede de segurança, não desfecho padrão. O teto de 300 rodadas é só o
      // anti-laço-infinito (o relógio dispara muito antes).
      const inicioLaco = Date.now();
      const TETO_LACO_MS = 25 * 60_000;
      // ⚠️ Fase 30 — o `for` conta TENTATIVAS e é monotônico; `rodadasFeitas` conta rodadas que
      // ACONTECERAM. Antes eram a mesma variável, e o `rodada--` do ramo do 409 anulava o
      // `rodada++`: o teto de 300 deixava de ser teto, e o banner contava tentativas como rodadas.
      for (let tentativa = 1; tentativa <= 300; tentativa++) {
        if (Date.now() - inicioLaco > TETO_LACO_MS) { desfecho = "teto"; break; }
        setRodarTudoProgresso(`Rodada ${rodadasFeitas + 1} · aprovação → métricas → coleta/extração…`);
        const corpoDaRodada: Record<string, unknown> = {
          ...(runId ? { run_id: runId } : {}),
          ...(rodadasVistas !== null ? { rodadas_vistas: rodadasVistas } : {}),
        };
        try {
          const res = await api.post<{
            etapas: PipelineEtapas;
            restantes: boolean;
            run_id?: string | null;
            rodadas?: number | null;
            abortado?: boolean;
            motivo_parada?: string;
            // Fase 30 — a rodada trabalhou mas o registro não gravou. Sem esta chave o cliente
            // leria `restantes: false` como "drenou" e pintaria o banner VERDE de uma execução
            // que parou sem saber o que fez.
            registro_da_rodada_falhou?: boolean;
            // Tarefa 1 — o estado REAL da fila, medido no banco. Sem ele o banner só sabe o que o
            // PLANO da rodada disse, e foi assim que ele afirmou "drenada" com 8 em processing.
            fila_final?: (ContagensDaFila & { estado: string }) | null;
            // Fase 29 — o TOKEN da cerca: devolvê-lo é o que faz a invocação seguinte ser aceita.
            // Sem ele, o abort do cliente re-disparava sobre a MESMA run com o mesmo `run_id`, o
            // guard de id não via diferença e duas invocações escreviam nas mesmas linhas.
          }>("/pipeline/run", corpoDaRodada);
          falhasSeguidas = 0;
          // ⚠️ Fase 30 — o crédito da cerca era VITALÍCIO: `tentativasDeCerca` só zerava num
          // HTTP 500, então uma rodada boa não o limpava e três 409 espalhados por 20 minutos
          // fechavam a esteira. Ele zera onde `falhasSeguidas` zera: no sucesso.
          esperasDaCerca = 0;
          adocoesDaCerca = 0;
          rodadasFeitas++;
          rodadasVistas = typeof res.rodadas === "number" ? res.rodadas : rodadasVistas;
          runId = res.run_id ?? runId;
          setRunIdAtivo(runId);
          ultimas = res.etapas ?? {};
          // Fase 28 — somar EVENTO está certo; somar RETRATO não. `fora_da_janela`, `pendentes`
          // e `pendentes_direcao` são recalculados do zero a cada rodada, sobre a mesma população:
          // somá-los exibia a mesma medição N vezes ("74 sem evidência · 72 anteriores ao 1º
          // mandato" não eram deliberações distintas). `agregarEtapas` decide por chave.
          agregarEtapas(totais, ultimas as Record<string, Record<string, unknown>>);
          if (res.registro_da_rodada_falhou) {
            desfecho = "erros";
            ultimoErro = res.motivo_parada ?? "o registro da rodada não gravou";
            break;
          }
          if (res.abortado) {
            desfecho = "abortado";
            ultimoErro = res.motivo_parada ?? "disjuntor aberto";
            break;
          }
          if (!res.restantes) {
            desfecho = "drenou";
            filaFinal = res.fila_final ?? null;
            break;
          }
        } catch (err) {
          // Fase 29 — 409 NÃO é falha: é a cerca dizendo que outra invocação desta run ainda está
          // em andamento (tipicamente a rodada anterior, que o abort do cliente deu por perdida e
          // o servidor continuou executando). Contar como erro fecharia a esteira justamente
          // quando ela está trabalhando.
          if (err instanceof ApiError && err.status === 409) {
            // Fase 30 — cada 409 pede uma ação DIFERENTE, e o servidor agora diz qual é o caso
            // (`codigo`). Antes o laço repetia o MESMO token, que é monotônico e por isso nunca
            // mais bateria: o retry era estruturalmente inútil. A decisão é pura e testável.
            const acao = decidirAposCerca({
              status: err.status,
              codigo: err.body.codigo,
              runId: err.body.run_id,
              rodadas: err.body.rodadas,
              esperasFeitas: esperasDaCerca,
              adocoesFeitas: adocoesDaCerca,
            });
            if (acao.tipo === "repetir") {
              if (acao.adotar) {
                adocoesDaCerca++;
                runId = acao.adotar.runId;
                rodadasVistas = acao.adotar.rodadasVistas;
                setRunIdAtivo(runId);
              } else {
                esperasDaCerca++;
              }
              setRodarTudoProgresso(`Rodada ${rodadasFeitas + 1} · ${acao.motivo}…`);
              if (acao.esperaMs > 0) await new Promise((r) => setTimeout(r, acao.esperaMs));
              continue; // a rodada não aconteceu: `rodadasFeitas` não sobe, mas a tentativa conta
            }
            if (acao.tipo === "desistir") {
              desfecho = "erros";
              ultimoErro = `${acao.motivo} — ${err.message}`;
              break;
            }
            // `falha_real`: segue para o caminho comum abaixo e conta como falha de verdade.
          }
          esperasDaCerca = 0;
          adocoesDaCerca = 0;
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
      return { totais, ultimas, rodadasComErro, ultimoErro, desfecho, rodadasFeitas, filaFinal };
    },
    onSuccess: ({ totais, ultimas, rodadasComErro, ultimoErro, desfecho, rodadasFeitas, filaFinal }) => {
      setMatchError(null);
      setRodarTudoProgresso(null);
      // ⚠️ `agregarEtapas` só agrega NÚMEROS; string tem de ser lida direto da etapa, como o
      // `naoReconhecidos` abaixo. Escrever `totais.leitura_do_acervo` seria letra morta.
      // A frase por motivo é STRING: `agregarEtapas` só soma números, então ela é lida direto da
      // etapa, como `leitura_do_acervo` e `nao_reconhecidos`.
      const motivosSemVoto = typeof ultimas.backfill_votos?.motivos_sem_voto === "string"
        ? (ultimas.backfill_votos.motivos_sem_voto as string)
        : null;
      const rosterPorAgencia = typeof ultimas.backfill_votos?.roster_mudaria_por_agencia === "string"
        ? (ultimas.backfill_votos.roster_mudaria_por_agencia as string)
        : null;
      const leituraDoAcervo = typeof ultimas.backfill_votos?.leitura_do_acervo === "string"
        ? (ultimas.backfill_votos.leitura_do_acervo as string)
        : null;
      const semDataPorAgencia = typeof ultimas.backfill_votos?.sem_data_por_agencia === "string"
        ? (ultimas.backfill_votos.sem_data_por_agencia as string)
        : "";
      const naoReconhecidos = typeof ultimas.backfill_votos?.nao_reconhecidos === "string"
        ? ultimas.backfill_votos.nao_reconhecidos
        : "";
      /**
       * ⚠️ Vem de `ultimas`, como as outras STRINGS — `agregarEtapas` descarta valor não-numérico em
       * silêncio, então uma fração como "7/312" nunca chegaria a `totais`. É a fração que torna o
       * zero legível: `motivos_gravados: 0` não distingue "não havia o que gravar" de "a fila inteira
       * ficou sem orçamento".
       */
      const gravacaoDoDiagnostico = typeof ultimas.backfill_votos?.gravacao_do_diagnostico === "string"
        ? (ultimas.backfill_votos.gravacao_do_diagnostico as string)
        : null;
      const partes = [
        `${totais.processados ?? 0} PDF(s) extraído(s)`,
        `${(totais.confirmados ?? 0) + (totais.materializados ?? 0)} materializado(s)`,
        // Fase 25 — "resolvida" é só a ARQUIVADA. `fundidos_semanticos` conta documentos que apenas
        // SEGUIRAM para o confirm (reuso da deliberação existente); somá-los inflava o banner.
        (totais.duplicatas_arquivadas ?? 0) > 0 ? `${totais.duplicatas_arquivadas} duplicata(s) arquivada(s)` : null,
        (totais.fundidos_semanticos ?? 0) > 0 ? `${totais.fundidos_semanticos} duplicata(s) semântica(s) seguiram para o confirm (reuso da deliberação existente)` : null,
        (totais.duplicatas_liberadas ?? 0) > 0 ? `${totais.duplicatas_liberadas} duplicata(s) da fila liberada(s) (primeiro da dupla)` : null,
        // Fase 26 — abandonado após 3 ciclos deixa de ser silêncio: a lista de presos mostra "(ciclo 3/3)".
        (totais.direcao_corrigida ?? 0) > 0 ? `${totais.direcao_corrigida} voto(s) inferido(s) corrigido(s) para seguir o desfecho` : null,
        (totais.pendentes_direcao ?? 0) > 0 ? `⏳ ${totais.pendentes_direcao} deliberação(ões) ainda com voto inferido na direção antiga — próximas rodadas continuam` : null,
        (totais.pautas_fora_do_ano ?? 0) > 0 ? `${totais.pautas_fora_do_ano} pauta(s) de ano encerrado arquivada(s) sem baixar` : null,
        (totais.arquivados_parser_travou ?? 0) > 0 ? `${totais.arquivados_parser_travou} pauta(s)/apoio arquivado(s): parser travou 3×` : null,
        (totais.reprocessos_encerrados ?? 0) > 0 ? `⚠️ ${totais.reprocessos_encerrados} documento(s) de decisão com parser travado — reenviar convertido/dividido` : null,
        (totais.auto_skip_limpos ?? 0) > 0 ? `${totais.auto_skip_limpos} carimbo(s) obsoleto(s) apagado(s) — reavaliados pelo gate atual` : null,
        (totais.reanalisados ?? 0) > 0 ? `${totais.reanalisados} documento(s) reanalisado(s) (extração mudou)` : null,
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
        (totais.votos ?? 0) > 0
          ? `${totais.votos} voto(s) recuperado(s) em ${totais.deliberacoes ?? 0} deliberação(ões) antiga(s)`
          : null,
        // Fase 28 — o número PARCIAL vem com o denominador colado. `sem_evidencia` é contado só
        // sobre o lote que a rodada examinou; sem `examinados` ao lado ele parece uma contagem de
        // deliberações distintas, e não é.
        // ⚠️ Fase 31 — e o denominador REPETE tanto quanto o numerador: a janela é ROTATIVA
        // (`janelaRotativa(..., Date.now()/60_000)`), então o mesmo item é reexaminado em rodadas
        // diferentes da MESMA run. Os dois números são ocorrências nos lotes, com repetição —
        // dizer isso é o que o usuário pediu quando a contagem por entidade distinta não é
        // carregável entre rodadas.
        (totais.sem_evidencia ?? 0) > 0
          ? `${totais.sem_evidencia} sem evidência de voto` +
            ((totais.examinados ?? 0) > 0 ? ` em ${totais.examinados} item(ns) examinado(s)` : "") +
            ` — ${ROTULO_PARCIAL}`
          : null,
        // Fase 28 — o ESTOQUE: é este número que tem de CAIR a cada rodada. Antes a tela só dizia
        // o que a rodada fez, e nunca quanto ainda faltava.
        (totais.pendentes ?? 0) > 0 ? `${totais.pendentes} deliberação(ões) final(is) ainda sem voto (estoque de agora)` : null,
        // ⚠️ Tarefa 4 — UM motivo por deliberação, categorias mutuamente exclusivas.
        // Antes, os sub-motivos exibidos logo abaixo das "45 sem voto" vinham de TRÊS populações
        // diferentes, e DUAS delas eram subtraídas ANTES de as 45 existirem (`route.ts:273` e
        // `:289`). A tela os justapunha como se decompusessem o número — e nenhum conjunto somava
        // 45. Esta linha é sobre a MESMA população, e é ela que dá leitor ao motivo persistido.
        motivosSemVoto,
        // ⚠️ Fase 31, Bloco 3 — MEDIDO E DESLIGADO. `nomes_presentes` do pai da ata não chega ao
        // filho, então o roster cai no MANDATO e pode gravar voto no nome errado (a 79ª ROP da ANM:
        // Caio Mário com 18 votos que a ata não lhe dá). Este número diz quantos itens mudariam de
        // dono se o preâmbulo valesse — e ele aparece ANTES de a mudança valer, porque mudar QUEM
        // votou não é mudar um total.
        (totais.roster_mudaria_com_presentes_do_pai ?? 0) > 0
          ? `⚠️ ${totais.roster_mudaria_com_presentes_do_pai} item(ns) teriam OUTRO colegiado se a ` +
            `lista de presentes da ata valesse (regra DESLIGADA — mede quem receberia voto)` +
            // ⚠️ A quebra por agência responde "é só a ANM?" — e é ela que decide a prioridade de
            // ligar a regra. Sem isso o total não diz onde o problema mora.
            //
            // ⚠️ E o rótulo "última rodada" NÃO é enfeite: o total à esquerda é SOMADO entre rodadas
            // (chave `parcial`, `agregar-rodadas.ts:66`), enquanto a quebra vem de `ultimas`, que é a
            // ÚLTIMA rodada apenas — `agregarEtapas` descarta valor não-numérico, e esta é uma string.
            // Sem o rótulo, "ANM 41 · ARTESP 18" se lê como decomposição do total e não é: em duas
            // rodadas que mediram, as parcelas não fecham com a soma. Este é exatamente o defeito que
            // a fase persegue — um número afirmando o que o dado não sustenta —, e ele quase entrou
            // pela minha própria mão.
            (rosterPorAgencia ? ` · por agência na última rodada: ${rosterPorAgencia}` : "") +
            ` — ${ROTULO_PARCIAL}`
          : null,
        (totais.fora_de_escopo ?? 0) > 0
          ? `${totais.fora_de_escopo} de agência não-colegiada — fora do escopo da esteira de votos, não é falta de evidência`
          : null,
        /**
         * Fase 31, Bloco 4 — o reparo dos nomes com mojibake, drenando.
         *
         * ⚠️ As duas naturezas são DIFERENTES e a linha diz as duas: `nomes_reparados` é EVENTO
         * (soma o que as rodadas fizeram) e `nomes_candidatos` é ESTOQUE (retrato do passivo, o
         * ÚLTIMO valor visto). Somar o estoque daria "287 · 247 · 207…" num acervo de 287.
         *
         * ⚠️ E o "restam" é o sinal de aceite: ele tem de CAIR entre cliques e chegar a zero. Se
         * `reparados > 0` e `restam` não cai, o reparo está gravando e voltando a achar o mesmo —
         * o que significaria que `reparoDoNome` não é idempotente, e aí a linha denuncia.
         */
        (totais.nomes_reparados ?? 0) > 0 || (totais.nomes_candidatos ?? 0) > 0
          ? `${totais.nomes_reparados ?? 0} nome(s) de arquivo reparados` +
            ((totais.jobs_reparados ?? 0) > 0 ? ` (+${totais.jobs_reparados} na fila de upload)` : "") +
            ` — restam ${totais.nomes_candidatos ?? 0} candidato(s) de ZIP no acervo`
          : null,
        /**
         * ⚠️ O PLACAR, e a lição de que ele estava aqui faltando.
         *
         * A rota `/admin/placar` roda desde a Fase 34 — `esteira_runs.contadores` prova (`placar_rodou:
         * true` nas três runs medidas). As chaves chegavam a `totais`. O que faltava era ESTA LINHA, e
         * sem ela o instrumento construído para responder "como sei que estamos quase acabando?" era
         * invisível. Quarta ocorrência de capacidade-sem-consumidor (Fases 21, 33 e duas aqui).
         *
         * ⚠️ `reunioes_completas` NUNCA aparece sozinho. Sem o denominador, "67" é um número sem
         * escala — e a fração é a única forma de ver progresso entre runs.
         *
         * ⚠️ E ele é rotulado como TETO, porque é o que ele é: "completa" aqui significa que cada
         * diretor esperado tem PELO MENOS UM voto na reunião. Um diretor que votou uma vez numa
         * reunião de 39 itens conta como presente. A régua por deliberação é o Bloco C.
         */
        /**
         * ⚠️ A COBERTURA vem primeiro, e o teto vem ao lado com o nome de teto.
         *
         * A régua antiga ("cada diretor esperado tem ≥1 voto na reunião") é um TETO, e o usuário
         * apontou o furo: o José Fernando tem 1 voto em todo 2026 e a 84ª da ANM o contava como
         * votante. O número que guia o trabalho é `pares_respondidos / pares_esperados` — cada
         * deliberação final com voto ou motivo de cada diretor com mandato na data.
         *
         * Os dois convivem porque `reunioes_completas` foi gravado com a semântica antiga em
         * `esteira_runs.contadores`: trocar o significado apagaria a comparabilidade do histórico.
         */
        (totais.pares_esperados ?? 0) > 0
          ? `cobertura de voto: ${totais.cobertura_pct ?? 0}% — ${totais.pares_respondidos ?? 0} de ` +
            `${totais.pares_esperados} pares (deliberação × diretor esperado) com voto ou motivo` +
            ((totais.itens_no_ano ?? 0) > 0 ? `, em ${totais.itens_no_ano} deliberação(ões) do ano` : "")
          : null,
        (totais.reunioes_no_ano ?? 0) > 0
          ? `reuniões do ano: ${totais.reunioes_completas_estrito ?? 0} de ${totais.reunioes_no_ano} com voto em TODOS os itens` +
            ` (pelo teto de ≥1 voto por diretor seriam ${totais.reunioes_completas ?? 0})` +
            ((totais.reunioes_com_voto_faltando ?? 0) > 0
              ? ` — ${totais.reunioes_com_voto_faltando} com voto faltando (trabalho nosso)`
              : "") +
            ((totais.reunioes_esperando_cadastro ?? 0) > 0
              ? ` · ${totais.reunioes_esperando_cadastro} esperando cadastro de mandato`
              : "")
          : null,
        /**
         * ⚠️ O caso que a régua do teto NÃO VÊ, e que é onde mora o trabalho: diretor com voto em
         * parte dos itens. Sem esta linha, "84% completas" e "um diretor votou uma vez em 39 itens"
         * conviveriam na mesma tela sem se contradizer visivelmente.
         */
        /**
         * ⚠️ MEDIDO E SEM ESCRITA. `completaveis_parciais` é quantos pares (deliberação × diretor)
         * receberiam voto inferido se o passo existisse — e ele NÃO existe. A frase diz isso, porque um
         * número na tela sem dizer que nada foi feito se lê como trabalho realizado.
         *
         * A escrita entra com o seu aval sobre este número: afirmar que alguém votou é a escrita mais
         * cara desta esteira, e a Fase 28 pegou um erro de leitura que produzia voto FABRICADO para o
         * colegiado inteiro.
         */
        (totais.completaveis_parciais ?? 0) > 0
          ? `${totais.completaveis_parciais} par(es) (deliberação × diretor) poderiam receber voto inferido` +
            " — a ESCRITA NÃO EXISTE ainda; os alertas do placar trazem a quebra por agência e as recusas"
          : null,
        (totais.diretores_com_voto_parcial ?? 0) > 0
          ? `⚠️ ${totais.diretores_com_voto_parcial} caso(s) de diretor com voto em PARTE dos itens de uma reunião` +
            " — invisível na régua por reunião; a aba de reuniões nomeia quem e em quantos itens"
          : null,
        (totais.placar_leitura_incompleta ?? 0) > 0
          ? "⚠️ o placar leu o acervo de forma INCOMPLETA — os números dele subcontam"
          : null,
        // Buracos de numeração. ⚠️ Enquanto a série eletrônica da ANTT estiver gravada como
        // "ordinaria" no passivo, as duas séries caem no mesmo balde e o salto 270→1038 passa do
        // teto de 400 — a detecção se CALA e este número sai pequeno demais. É o Bloco D.
        /**
         * ⚠️ A medição FORTE da coleta, e ela responde ao que o `numeros_ausentes` não alcança.
         *
         * `numeros_ausentes` infere buraco ENTRE o menor e o maior número do acervo, com teto de salto
         * de 400 — então se cala quando a série está suja e não vê nada DEPOIS do último número. Esta
         * linha é diferença de conjuntos contra a listagem da fonte: sem inferência, sem teto, e
         * alcança o fim da série. Hoje só a ANTT tem a listagem no banco.
         */
        (totais.faltando_contra_a_listagem ?? 0) > 0
          ? `⚠️ ${totais.faltando_contra_a_listagem} reunião(ões) que a LISTAGEM da fonte tem e o acervo não` +
            " — é coleta faltando, não data errada (ver os alertas do placar para a lista)"
          : null,
        (totais.numeros_ausentes ?? 0) > 0 ||
        (totais.numeros_duplicados ?? 0) > 0 ||
        (totais.numeros_com_data_fora_do_ano ?? 0) > 0
          ? `numeração: ${totais.numeros_ausentes ?? 0} ausente(s), ${totais.numeros_duplicados ?? 0} duplicado(s), ` +
            `${totais.numeros_com_data_fora_do_ano ?? 0} com data fora do ano`
          : null,
        leituraDoAcervo ? `⚠️ leitura do acervo ${leituraDoAcervo}` : null,
        // Fase 21 — o que o materializador RECUSOU ou não conseguiu, visível. Antes esses números
        // eram calculados toda noite e descartados: uma run em que todas as escritas falharam
        // mostrava o mesmo banner verde de uma run vazia.
        (totais.roster_nao_conferivel ?? 0) > 0
          ? `${totais.roster_nao_conferivel} item(ns) sem voto por roster não conferível` +
            ((totais.examinados ?? 0) > 0 ? ` de ${totais.examinados} examinado(s)` : "") +
            (naoReconhecidos ? ` (não reconhecidos: ${naoReconhecidos})` : "")
          : null,
        // Fase 28 — a linha única virou DUAS. "Fora da janela" tem dois motivos e só um deles fala
        // de mandato: 2026 é posterior a todos os primeiros mandatos conhecidos, então "anterior ao
        // 1º mandato" é praticamente impossível para o acervo corrente. O que estava ali é
        // deliberação sem data extraída — problema de EXTRAÇÃO exibido como fato de mandato.
        (totais.fora_da_janela_anterior_ao_1o_mandato ?? 0) > 0
          ? `${totais.fora_da_janela_anterior_ao_1o_mandato} anterior(es) ao 1º mandato conhecido (fora do denominador de votação)`
          : null,
        (totais.fora_da_janela_sem_data_de_reuniao ?? 0) > 0
          ? `${totais.fora_da_janela_sem_data_de_reuniao} sem data de reunião — NÃO é fato de mandato: a extração não achou a data` +
            (semDataPorAgencia ? ` (${semDataPorAgencia})` : "") +
            ". O passo «redatar» é quem conserta."
          : null,
        /**
         * ⚠️ A JANELA C do `redatar` — medida, corrigida, e em que ponto da VOLTA ela está.
         *
         * Nada disso tinha leitor. `divergentes_corrigidas` é a escrita destrutiva ligada atrás do
         * gabarito da Fase 34: ela REESCREVE a data de uma deliberação, o que muda o roster de voto
         * da linha. Uma escrita dessas sem número na tela é exatamente o que o projeto não aceita.
         *
         * E o par bloco/blocos é o que impede a leitura errada que eu mesmo fiz: a janela examina 120
         * linhas por chamada sobre TODA deliberação com data, e o passo é sorteado poucas vezes por
         * run. Sem ver "bloco 4 de 25", parece pronto quando mal começou.
         */
        (totais.divergentes_medidas ?? 0) > 0 || (totais.divergentes_corrigidas ?? 0) > 0
          ? `datas divergentes: ${totais.divergentes_medidas ?? 0} medida(s), ${totais.divergentes_corrigidas ?? 0} corrigida(s)` +
            ((totais.divergente_blocos ?? 0) > 0
              ? ` (janela rotativa no bloco ${totais.divergente_bloco ?? 0} de ${totais.divergente_blocos} — a volta ainda não fechou)`
              : "")
          : null,
        /**
         * ⚠️ DIAGNÓSTICO OPOSTO, e é por isso que ele precisa de linha própria. Uma linha sem texto
         * extraído nunca será resolvida por mais rodadas de esteira: o conserto é re-extrair o PDF.
         * Enquanto este número era invisível, "a data não voltou" e "a data não pode voltar" pareciam
         * o mesmo problema.
         */
        (totais.divergente_sem_texto ?? 0) > 0
          ? `⚠️ ${totais.divergente_sem_texto} linha(s) sem texto extraído na janela de datas` +
            " — para essas, mais rodadas não resolvem: falta RE-EXTRAIR o PDF"
          : null,
        (totais.redatadas ?? 0) > 0 || (totais.datas_para_revisao ?? 0) > 0
          ? `${totais.redatadas ?? 0} data(s) re-derivadas` +
            ((totais.datas_para_revisao ?? 0) > 0
              ? ` · ⚠️ ${totais.datas_para_revisao} marcada(s) para revisão (a data foi ANULADA por não ser re-derivável)`
              : "")
          : null,
        /**
         * ⚠️ O REPARO DE VOTO ARTEFATO, que apagou 51 votos em produção sem que o banner dissesse.
         *
         * Ele remove o voto ÚNICO e nominal de deliberação cuja fonte não nomina ninguém
         * (`CAPACIDADE_NOMINAL = "nenhum"`), devolve a deliberação ao estoque, e o materializador a
         * refaz com o colegiado inteiro na MESMA rodada. É por isso que `pendentes` SOBE quando o
         * reparo age — 45 → 68 foi o reparo funcionando, não regressão. Sem esta linha, os quatro
         * números do banner contavam a história do reparo sem nomeá-lo.
         *
         * `candidatos` é retrato (estoque) e tem de CAIR entre runs; `apagados` é o que a rodada fez.
         */
        (totais.artefatos_apagados ?? 0) > 0 || (totais.artefatos_candidatos ?? 0) > 0
          ? `${totais.artefatos_apagados ?? 0} voto(s)-artefato removidos (fonte que não nomina)` +
            ` — restam ${totais.artefatos_candidatos ?? 0} candidato(s); cada um devolve a deliberação ao estoque`
          : null,
        (totais.upsert_falhas ?? 0) > 0 ? `⚠️ ${totais.upsert_falhas} escrita(s) de voto FALHARAM` : null,
        // A regra do dispositivo está DESLIGADA e medida: esta é a linha que o usuário lê antes de
        // decidir se ela passa a valer.
        // Fase 22 — a regra VALE (08/09/2026). A linha agora mede a regra ANTIGA contra a vigente:
        // o que voltaria a ser fabricado ou suprimido se alguém revertesse.
        // ⚠️ Fase 31 — a DUPLA NARRATIVA morreu. `itens_que_mudariam` é, POR CONSTRUÇÃO, a união
        // dos dois subgrupos: `materializar-faltantes:422-431` conta A e B mutuamente exclusivos e
        // `:435` conta `A ∪ B`. A frase enunciava a mesma população duas vezes — uma como total e
        // outra decomposta —, e quem lia somava mentalmente 35 + 35.
        //
        // ⚠️ E o denominador estava ERRADO: `votos_a_menos` só cresce num subconjunto restrito de A
        // (`:479`, com `!inferFromMandate && rows.length === 0` por cima), então "120 votos em 35
        // itens" usava como base uma população maior do que a que produziu os 120. O denominador
        // honesto é `regex_divergente`.
        (totais.votos_a_menos ?? 0) + (totais.regex_divergente ?? 0) + (totais.regex_falso_positivo ?? 0) > 0
          ? `regra do dispositivo (vigente): ${totais.regex_divergente ?? 0} item(ns) com divergência que a regra antiga não via` +
            ` (${totais.votos_a_menos ?? 0} voto(s) fabricado(s) evitado(s) neles)` +
            `; ${totais.regex_falso_positivo ?? 0} item(ns) unânime(s) recuperado(s) da "taxa vencida"` +
            ` — ${ROTULO_PARCIAL}`
          : null,
        /**
         * ⚠️ AS QUE FALTAVAM (Fase 35, Bloco B.4). O teste novo varre as chaves que CHEGAM a `totais`
         * e exige leitor para cada uma; estas quinze não tinham. Não são enfeite: `reparo_falhas` e
         * os `arquivados` dizem que a esteira DESCARTOU coisa, e descarte sem número é o formato de
         * zero que este projeto passou fases inteiras aprendendo a não aceitar.
         */
        (totais.ilegiveis_arquivados ?? 0) +
          (totais.sem_agencia_arquivados ?? 0) +
          (totais.nao_deliberativos_arquivados ?? 0) >
        0
          ? `arquivados na triagem: ${totais.ilegiveis_arquivados ?? 0} ilegível(is), ` +
            `${totais.sem_agencia_arquivados ?? 0} sem agência, ` +
            `${totais.nao_deliberativos_arquivados ?? 0} não-deliberativo(s)`
          : null,
        (totais.jobs_orfaos_recuperados ?? 0) +
          (totais.reconciliados_novo ?? 0) +
          (totais.reconciliados_de_volta ?? 0) +
          (totais.reconciliados_importado ?? 0) +
          (totais.reconciliados_ignorado ?? 0) >
        0
          ? `reaper: ${totais.jobs_orfaos_recuperados ?? 0} job(s) órfão(s) recuperado(s)` +
            ` · reconciliação em_revisao — ${totais.reconciliados_novo ?? 0} de volta à fila, ` +
            `${totais.reconciliados_de_volta ?? 0} restaurado(s), ` +
            `${totais.reconciliados_importado ?? 0} importado(s), ` +
            `${totais.reconciliados_ignorado ?? 0} ignorado(s)`
          : null,
        (totais.reparo_falhas ?? 0) > 0 || (totais.reparo_sem_fonte ?? 0) > 0
          ? `⚠️ reparo de resultado: ${totais.reparo_falhas ?? 0} falha(s) de escrita` +
            ` · ${totais.reparo_sem_fonte ?? 0} sem fonte para decidir`
          : null,
        (totais.motivos_gravados ?? 0) > 0 || gravacaoDoDiagnostico
          ? `diagnóstico gravado em ${gravacaoDoDiagnostico ?? String(totais.motivos_gravados ?? 0)} deliberação(ões)` +
            " — é o motivo que explica cada «sem voto»"
          : null,
        (totais.divergencias_gravadas ?? 0) > 0
          ? `${totais.divergencias_gravadas} divergência(s) de roster gravadas (a lista de presentes do pai ` +
            "discorda do mandato — registrado, não aplicado)"
          : null,
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
        // ⚠️ Tarefa 1 — "drenada" deixa de ser transcrição de um booleano sobre o PLANO.
        // O texto agora sai do estado MEDIDO da fila (os quatro contadores), e a frase original só
        // volta quando os quatro são zero de verdade. Sem `fila_final` (servidor anterior a esta
        // fase), o texto é o antigo — degradar para a frase honesta exigiria um dado que não veio.
        const cabecalho = desfecho !== "drenou"
          ? `Esteira parou no teto de tempo (~25min, ${rodadasFeitas} rodadas) — ainda há fila; rode de novo para continuar`
          : filaFinal
            ? cabecalhoDoEstadoDaFila(classificarFila(filaFinal), filaFinal)
            : "Esteira zero-toque concluída (fila drenada)";
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
                      {arquivados.length > 8 && (
                        <span className="inline-flex items-center rounded-full border border-dashed px-2 py-0.5 text-[11px] text-text-muted">
                          {/* Fase 17 — a cauda era cortada em silêncio: 371 arquivados e só 334
                              apareciam. Um número que não diz que está incompleto é pior que
                              nenhum número. */}
                          +{arquivados.length - 8} grupo(s) não exibido(s)
                        </span>
                      )}
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
                          {f.agencia}: {f.erro ?? f.status}{f.status === "failed" ? ` (ciclo ${f.ciclos_reprocesso ?? 0}/3)` : ""}
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
              {/* Fase 22 — as CAUSAS antes dos documentos: 146 linhas viram 5-6 motivos, e cada
                  motivo é um conserto de extração, não 146 cliques. */}
              {(() => {
                const porMotivo = new Map<string, number>();
                for (const doc of pendentesRevisao?.data ?? []) {
                  const m = doc.campos_detectados?.auto_skip?.trim() || "sem motivo gravado (ainda não passou pelo auto-confirm)";
                  porMotivo.set(m, (porMotivo.get(m) ?? 0) + 1);
                }
                const causas = [...porMotivo.entries()].sort((a, b) => b[1] - a[1]);
                return causas.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pb-1" data-testid="excecoes-por-motivo">
                    {causas.map(([motivo, n]) => (
                      <span key={motivo} className="text-[11px] px-2 py-0.5 rounded-full border border-border text-text-secondary" title={motivo}>
                        <span className="font-medium text-text-primary">{n}</span> · {motivo.length > 70 ? `${motivo.slice(0, 70)}…` : motivo}
                      </span>
                    ))}
                  </div>
                ) : null;
              })()}
              {(pendentesRevisao?.data ?? []).slice(0, 10).map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-3 text-sm border border-border rounded-card px-3 py-2">
                  <span className="truncate text-text-primary">
                    {doc.filename ?? doc.id}
                    <span className="text-text-muted"> · {doc.agencia?.sigla ?? "?"} · {doc.tipo_documento ?? "doc"}</span>
                    {doc.campos_detectados?.auto_skip && (
                      <span className="block text-[11px] text-amber-700 dark:text-amber-400 truncate" title={doc.campos_detectados.auto_skip}>
                        ↳ {doc.campos_detectados.auto_skip}
                      </span>
                    )}
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
          {/**
            * ⚠️ O RECORTE, na própria linha — e é ele que explica o «40 ≠ 45».
            *
            * "40 deliberações finais sem nenhum voto" (aqui) e "45 ainda sem voto" (banner da
            * esteira) parecem a mesma frase e são populações diferentes por TRÊS eixos: o ano (aqui
            * só um; a esteira, todos), o `resultado` (aqui exigido só de `ata`; a esteira, de todos
            * os tipos) e `agencias.ativo` (aqui filtra; a esteira, não). Quem lê os dois sem saber
            * disso conclui que um está errado. Nenhum está.
            */}
          <p className="text-xs text-text-muted">
            Recorte: <span className="font-mono">{completude.ano}</span> · só agências colegiadas
            ativas · `resultado` exigido apenas de <span className="font-mono">ata</span>.
            {(completude.totais.deliberacoes_sem_data_de_reuniao ?? 0) > 0 ? (
              <>
                {" "}⚠️ <span className="text-warning">
                  {completude.totais.deliberacoes_sem_data_de_reuniao} deliberação(ões) sem data de
                  reunião ficam FORA deste painel
                </span> (e os votos delas também).
              </>
            ) : null}
            {" "}O banner da esteira usa outro recorte — os números divergem sem que nenhum esteja errado.
          </p>
          {/* ⚠️ O que INVALIDA a tabela vem ANTES dela, não no pé: um aviso embaixo se lê depois de
              já ter acreditado nos números. Mesmo motivo do `unshift` na rota. */}
          {(completude.totais.leituras_com_erro ?? []).length > 0 ? (
            <div className="rounded-card border border-error/30 bg-error/10 px-3 py-2 text-xs text-text-primary">
              ⚠️ {completude.totais.leituras_com_erro!.length} leitura(s) FALHARAM
              ({completude.totais.leituras_com_erro!.join(", ")}) — os números abaixo estão
              incompletos. Leitura que falha vira lista vazia, e lista vazia vira zero.
            </div>
          ) : (completude.totais.leituras_truncadas ?? []).length > 0 ? (
            <div className="rounded-card border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-text-primary">
              ⚠️ {completude.totais.leituras_truncadas!.length} leitura(s) truncada(s)
              ({completude.totais.leituras_truncadas!.join(", ")}) — os totais podem subcontar.
            </div>
          ) : null}
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
                  {/* ⚠️ Os dois rótulos que MENTIAM.
                      "Última captura" mostrava `MAX(data_reuniao)` — foi daí que eu disse "ANM 32
                      dias sem captura", que estava errado. Agora a coluna se chama pelo que mede, e
                      a captura de verdade (`last_seen_at`) vai no title.
                      "Pendentes" era candidato a DIRETOR, na mesma linha de números de documento:
                      grandezas diferentes com o mesmo rótulo. */}
                  <th className="py-1 px-2 font-medium text-right" title="MAX(data_reuniao): a reunião mais recente que temos, NÃO quando a coleta rodou.">
                    Reunião + recente
                  </th>
                  <th className="py-1 pl-2 font-medium text-right" title="Candidatos a DIRETOR aguardando aprovação (pendente ou em conflito) — não é documento.">
                    Cand. diretor
                  </th>
                </tr>
              </thead>
              <tbody>
                {completude.por_agencia.map((a) => {
                  // Staleness: fonte com docs mas parada há >7 dias (mesmo sintoma da
                  // ANTT-notícias no defeso) fica visível de imediato.
                  /**
                   * ⚠️ O staleness passa a sair da CAPTURA (`capturado_em` = `last_seen_at`), com
                   * fallback para a data de reunião quando a coluna não vem. Antes usava só
                   * `MAX(data_reuniao)`, e por isso "parada há N dias" nunca mediu o que dizia:
                   * uma PAUTA com data futura rejuvenescia o indicador sem nada ter sido processado.
                   */
                  const reuniaoRecente = a.ultima_captura?.reuniao_mais_recente_no_monitoramento
                    ?? a.ultima_captura?.reuniao_mais_recente_com_deliberacao ?? null;
                  const capturado = a.ultima_captura?.capturado_em ?? null;
                  const baseStaleness = capturado ?? reuniaoRecente;
                  const diasParada = baseStaleness
                    ? Math.floor((Date.now() - new Date(baseStaleness).getTime()) / 86_400_000) : null;
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
                    <td className={cn("py-1.5 px-2 text-right", parada ? "text-warning" : "text-text-muted")}
                        title={capturado
                          ? `Coletado por último em ${capturado.slice(0, 10)}${parada ? ` — ${diasParada} dia(s)` : ""}`
                          : "Sem `last_seen_at` nesta agência: o (Nd) sai da data de REUNIÃO, que é um piso"}>
                      {reuniaoRecente ? `${reuniaoRecente.slice(8, 10)}/${reuniaoRecente.slice(5, 7)}` : "—"}
                      {parada ? ` (${diasParada}d${capturado ? "" : "*"})` : ""}
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      {a.diretores.candidatos_pendentes > 0
                        ? (
                          <span className="text-warning"
                                title={(a.diretores.candidatos_em_conflito ?? 0) > 0
                                  ? `${a.diretores.candidatos_em_conflito} em CONFLITO — cadastro em disputa também bloqueia voto`
                                  : "Aguardando aprovação"}>
                            {a.diretores.candidatos_pendentes}
                            {(a.diretores.candidatos_em_conflito ?? 0) > 0 ? `⚠` : ""}
                          </span>
                        )
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

      {/* ── Fase 26 — "São os corretos?": 5 ao acaso por agência, contra o PDF ── */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="section-label">Conferir 5 ao acaso (contra o PDF)</p>
            <p className="text-xs text-text-muted">
              Certificação e cobertura dizem que extração e coleta funcionam; isto diz se o que está no banco bate com o original. Abra o PDF e confira relator, resultado e votos.
            </p>
          </div>
          <button type="button" className="btn-secondary text-xs" onClick={() => setAmostraSeed(String(Date.now()))}>
            Outra amostra
          </button>
        </div>
        {!amostra || amostra.agencias.length === 0 ? (
          <p className="text-xs text-text-muted">Sem deliberações finais de 2026 para amostrar (ou carregando).</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {amostra.agencias.map((ag) => (
              <div key={ag.sigla} className="space-y-1.5">
                <p className="text-xs font-medium text-text-primary">{ag.sigla} <span className="text-text-muted font-normal">· {ag.itens.length} de {ag.universo}</span></p>
                {ag.itens.map((it) => (
                  <div key={it.id} className="border border-border rounded-card px-2 py-1.5 text-[11px] space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{it.numero ?? it.tipo} · {it.data ?? "s/ data"}</span>
                      {it.pdf ? <a href={it.pdf} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline shrink-0">PDF ↗</a> : <span className="text-text-muted shrink-0">sem PDF</span>}
                    </div>
                    <div className="text-text-secondary truncate" title={it.interessado ?? undefined}>{it.resultado ?? "sem resultado"} · relator: {it.relator ?? "—"} · processo: {it.processo ?? "—"}</div>
                    <div className="text-text-muted">
                      {it.votos.length === 0 ? "sem voto" : it.votos.map((v) => `${v.diretor.split(" ")[0]}: ${v.tipo}${v.origem === "inferido" ? "~" : ""}`).join(" · ")}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

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
              <p className="section-label">Métricas por diretor · {anoVotos ? anoVotos : "todo o histórico"}</p>
              <p className="text-[11px] text-text-muted">
                <strong>lido</strong> = voto extraído do documento · <strong>inferido</strong> = por unanimidade/mandato (proxy)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Fase 25 — a Completude logo acima é só 2026; este card era todo o histórico sem dizer. */}
            <select className="select w-40" value={anoVotos} onChange={(e) => { setAnoVotos(e.target.value); setSelectedDirector(null); }} title="Período dos votos contados neste card">
              <option value="">Todo o histórico</option>
              <option value="2026">Só 2026</option>
              <option value="2025">Só 2025</option>
            </select>
            <select className="select w-44" value={agenciaId} onChange={(e) => { setAgenciaId(e.target.value); setSelectedDirector(null); }}>
              <option value="">Todas as agências</option>
              {colegiadoAgencias.map((a) => <option key={a.id} value={a.id}>{a.sigla}</option>)}
            </select>
          </div>
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
                  {/* Fase 25 — "divergente" = votou contra o DESFECHO registrado; não é dissenso entre colegas.
                      Num diretor só com voto inferido, mede indeferimentos não unânimes, não comportamento. */}
                  <th className="py-2 px-3 font-medium text-right" title="Votou contra o desfecho registrado (Favorável em Indeferido, Desfavorável em Aprovado). Não é dissenso entre colegas; para diretor só com voto inferido, conta indeferimentos não unânimes.">Divergentes</th>
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
