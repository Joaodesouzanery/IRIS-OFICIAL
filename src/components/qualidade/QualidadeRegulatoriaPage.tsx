"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Award,
  BarChart3,
  Check,
  CheckCircle,
  Database,
  Download,
  ExternalLink,
  FileSearch,
  Gavel,
  Loader2,
  Plus,
  Scale,
  Table2,
  X,
} from "lucide-react";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Tab = "dashboard" | "agencias" | "criterios" | "diagnostico" | "evidencias" | "coletas" | "premio" | "relatorios";

type DashboardNote = {
  criterio_id: number;
  nota: number;
  nivel: string;
  observacao: string;
  status_revisao: string;
  evidencias: string[];
};

type DashboardRanking = {
  agencia_sigla: string;
  score_geral: number;
  posicao_ranking: number | null;
  status_revisao: string;
  destaques_positivos: string[];
  areas_melhoria: string[];
  notas: DashboardNote[];
};

type DashboardAgency = {
  sigla: string;
  nome_completo: string;
  setor_regulado: string;
  ano_criacao: number;
  lei_criacao: string;
  site_oficial: string;
  portal_transparencia?: string | null;
  portal_dados_abertos?: string | null;
  portal_consultas_publicas?: string | null;
  portal_ouvidoria?: string | null;
  score_geral: number;
  posicao_ranking: number | null;
  destaques_positivos: string[];
  areas_melhoria: string[];
};

type DashboardCriterion = {
  id: number;
  nome: string;
  descricao: string;
  peso: number;
  nivel_prioridade: string;
  metodo_coleta: string;
  base_legal: string | null;
  fontes_coleta: string[];
  score_medio: number;
  ranking: Array<{ agencia_sigla: string; nota: number; nivel: string; posicao: number }>;
  distribuicao_niveis: Record<string, number>;
  fontes: Array<{ id: string; nome: string; url: string; formato?: string | null; atualizacao?: string | null }>;
};

type DashboardEvidence = {
  agencia_sigla: string;
  criterio_id: number;
  titulo: string;
  url: string;
  fonte: string;
  trecho_publico: string;
  data_referencia: string;
  status_revisao: string;
};

type EvidenceRow = {
  id: string;
  agencia_sigla: string;
  criterio_id: number;
  titulo: string;
  url: string | null;
  fonte: string | null;
  trecho_publico: string | null;
  status_revisao: string;
};

type ManualEvidenceInput = {
  agencia_sigla: string;
  criterio_id: number;
  titulo: string;
  url?: string | null;
  fonte?: string | null;
  trecho_publico?: string | null;
};

type QualityDashboard = {
  ano: number;
  ranking: DashboardRanking[];
  agencias: DashboardAgency[];
  criterios: DashboardCriterion[];
  fontes: Array<{ id: string; nome: string; url: string; criterios_relacionados: number[]; formato?: string | null; atualizacao?: string | null }>;
  categorias: Array<{ id: string; nome: string; descricao: string; criterios_avaliados: number[]; tipo: string }>;
  premio: Array<{ categoria: { id: string; nome: string }; vencedora: string | null; score: number | null; status: string }>;
  evidencias_resumo: DashboardEvidence[];
  legal: { guardrails: string[]; references: Array<{ label: string; url: string }>; disclaimer: string };
  metricas: {
    agencias: number;
    criterios: number;
    avaliacoes: number;
    evidencias: number;
    score_medio: number;
    diagnosticos_validados: number;
    diagnosticos_preliminares: number;
    pesos_total: number;
  };
  source: string;
};

type CollectionStatus = {
  data: Array<{ id: string; agencia_sigla: string; criterio_id: number | null; fonte_id: string | null; status: string; data_coleta: string; warnings: string[]; compliance_status: string }>;
  metricas: { total: number; sucesso: number; falha: number; restrito: number; pendente_revisao: number };
};

const TAB_TITLES: Record<Tab, string> = {
  dashboard: "Qualidade Regulatoria",
  agencias: "Agencias avaliadas",
  criterios: "Criterios e pesos",
  diagnostico: "Diagnostico institucional",
  evidencias: "Evidencias e revisao",
  coletas: "Coletas seguras",
  premio: "Premio Qualidade Regulatoria",
  relatorios: "Relatorios",
};

const QUALIDADE_TABS = [
  { label: "Dashboard", href: "/dashboard/qualidade-regulatoria" },
  { label: "Agencias", href: "/dashboard/qualidade-regulatoria/agencias" },
  { label: "Criterios", href: "/dashboard/qualidade-regulatoria/criterios" },
  { label: "Diagnostico", href: "/dashboard/qualidade-regulatoria/diagnostico" },
  { label: "Evidencias", href: "/dashboard/qualidade-regulatoria/evidencias" },
  { label: "Coletas", href: "/dashboard/qualidade-regulatoria/coletas" },
  { label: "Premio", href: "/dashboard/qualidade-regulatoria/premio" },
  { label: "Relatorios", href: "/dashboard/qualidade-regulatoria/relatorios" },
];

export function QualidadeRegulatoriaPage({ tab }: { tab: Tab }) {
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [collectionOffset, setCollectionOffset] = useState(0);
  const [selectedAgencySigla, setSelectedAgencySigla] = useState("ANATEL");
  const [selectedCriterionId, setSelectedCriterionId] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["qualidade-regulatoria", "dashboard", currentYear],
    queryFn: () => api.get<QualityDashboard>(`/qualidade-regulatoria/dashboard?ano=${currentYear}`),
  });
  const { data: collectionStatus } = useQuery({
    queryKey: ["qualidade-regulatoria", "coletas", "status"],
    queryFn: () => api.get<CollectionStatus>("/qualidade-regulatoria/coletas/status"),
    enabled: tab === "coletas" || tab === "dashboard",
  });

  const runCollection = useMutation({
    mutationFn: () => api.post<{ processed: number; total: number; next_offset: number | null; results: unknown[] }>("/qualidade-regulatoria/coletas/run", {
      offset: collectionOffset,
      limit: 24,
    }),
    onSuccess: (result) => {
      setCollectionOffset(result.next_offset ?? 0);
      queryClient.invalidateQueries({ queryKey: ["qualidade-regulatoria"] });
    },
  });

  // Coleta completa: encadeia lotes ate cobrir todas as agencias x fontes.
  const runFullCollection = useMutation({
    mutationFn: async () => {
      let offset = 0;
      let lotes = 0;
      let total = 0;
      // Limite de seguranca para evitar loop infinito (cobre QUALIDADE_AGENCIAS x QUALIDADE_FONTES).
      for (let i = 0; i < 60; i++) {
        const result = await api.post<{ processed: number; total: number; next_offset: number | null }>(
          "/qualidade-regulatoria/coletas/run",
          { offset, limit: 24 },
        );
        lotes++;
        total = result.total;
        if (result.next_offset === null) break;
        offset = result.next_offset;
      }
      return { lotes, total };
    },
    onSuccess: () => {
      setCollectionOffset(0);
      queryClient.invalidateQueries({ queryKey: ["qualidade-regulatoria"] });
    },
  });

  // Evidencias reais do banco (com id) para revisao humana e entrada manual.
  const { data: evidenceRows } = useQuery({
    queryKey: ["qualidade-regulatoria", "evidencias", selectedAgencySigla, selectedCriterionId],
    queryFn: () => api.get<{ data: EvidenceRow[] }>(
      `/qualidade-regulatoria/evidencias?agencia_sigla=${selectedAgencySigla}&criterio_id=${selectedCriterionId}`,
    ),
    enabled: tab === "evidencias",
  });

  const addEvidence = useMutation({
    mutationFn: (payload: ManualEvidenceInput) => api.post("/qualidade-regulatoria/evidencias", payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["qualidade-regulatoria", "evidencias"] }),
  });

  const reviewEvidence = useMutation({
    mutationFn: (payload: { id: string; status_revisao: string }) => api.patch("/qualidade-regulatoria/evidencias", payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["qualidade-regulatoria", "evidencias"] }),
  });

  const ranking = useMemo(() => data?.ranking ?? [], [data?.ranking]);
  const criteria = useMemo(() => data?.criterios ?? [], [data?.criterios]);
  const agencies = useMemo(() => data?.agencias ?? [], [data?.agencias]);
  const selectedAgency = ranking.find((item) => item.agencia_sigla === selectedAgencySigla) ?? ranking[0];
  const selectedAgencyProfile = agencies.find((item) => item.sigla === selectedAgency?.agencia_sigla);
  const selectedCriterion = criteria.find((item) => item.id === selectedCriterionId) ?? criteria[0];
  const selectedEvidence = (data?.evidencias_resumo ?? [])
    .filter((item) => !selectedAgency || item.agencia_sigla === selectedAgency.agencia_sigla)
    .filter((item) => !selectedCriterion || item.criterio_id === selectedCriterion.id);

  return (
    <div className="space-y-6 animate-fade-in">
      <ModuleTabs tabs={QUALIDADE_TABS} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">{TAB_TITLES[tab]}</h1>
          <p className="text-sm text-text-muted mt-1 max-w-3xl">
            Ranking institucional de agencias reguladoras federais com notas por criterio, fontes publicas, evidencias e revisao humana.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge badge-gray">Ano-base {data?.ano ?? currentYear}</span>
          <span className="badge badge-gray">{data?.source === "database" ? "Supabase" : "Fallback curado"}</span>
        </div>
      </div>

      <LegalNotice data={data} />

      {isLoading ? (
        <div className="card h-64 flex items-center justify-center text-text-muted">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          Carregando Qualidade Regulatoria...
        </div>
      ) : null}

      {!isLoading && data ? (
        <>
          {tab === "dashboard" ? (
            <DashboardView data={data} ranking={ranking} criteria={criteria} />
          ) : null}

          {tab === "agencias" ? (
            <AgenciesView agencies={agencies} onSelect={setSelectedAgencySigla} />
          ) : null}

          {tab === "criterios" ? (
            <CriteriaView criteria={criteria} selectedCriterionId={selectedCriterionId} onSelect={setSelectedCriterionId} />
          ) : null}

          {tab === "diagnostico" ? (
            <DiagnosticView
              ranking={ranking}
              criteria={criteria}
              agencies={agencies}
              selectedAgency={selectedAgency}
              selectedAgencyProfile={selectedAgencyProfile}
              selectedAgencySigla={selectedAgency?.agencia_sigla ?? ""}
              onSelectAgency={setSelectedAgencySigla}
            />
          ) : null}

          {tab === "evidencias" ? (
            <EvidenceView
              agencies={agencies}
              criteria={criteria}
              selectedAgencySigla={selectedAgency?.agencia_sigla ?? ""}
              selectedCriterionId={selectedCriterion?.id ?? 1}
              onSelectAgency={setSelectedAgencySigla}
              onSelectCriterion={setSelectedCriterionId}
              evidences={selectedEvidence}
              allEvidence={data.evidencias_resumo}
              evidenceRows={evidenceRows?.data ?? []}
              onAddEvidence={(payload) => addEvidence.mutate(payload)}
              onReviewEvidence={(payload) => reviewEvidence.mutate(payload)}
              isSavingEvidence={addEvidence.isPending}
              isReviewing={reviewEvidence.isPending}
            />
          ) : null}

          {tab === "coletas" ? (
            <CollectionsView
              collectionStatus={collectionStatus}
              runCollection={() => runCollection.mutate()}
              isPending={runCollection.isPending}
              runFullCollection={() => runFullCollection.mutate()}
              isRunningFull={runFullCollection.isPending}
              fullResult={runFullCollection.data}
            />
          ) : null}

          {tab === "premio" ? (
            <PrizeView data={data} />
          ) : null}

          {tab === "relatorios" ? (
            <ReportsView currentYear={currentYear} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function DashboardView({ data, ranking, criteria }: { data: QualityDashboard; ranking: DashboardRanking[]; criteria: DashboardCriterion[] }) {
  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Metric label="Agencias" value={data.metricas.agencias} />
        <Metric label="Criterios" value={data.metricas.criterios} />
        <Metric label="Avaliacoes" value={data.metricas.avaliacoes} />
        <Metric label="Evidencias" value={data.metricas.evidencias} />
        <Metric label="Score medio" value={data.metricas.score_medio} />
        <Metric label="Peso total" value={data.metricas.pesos_total.toFixed(2)} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-4">
        <RankingPanel ranking={ranking} />
        <MatrixPanel ranking={ranking} criteria={criteria} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-4">
        <CriterionLeaders criteria={criteria} />
        <SourceCoverage data={data} />
      </div>
    </section>
  );
}

function AgenciesView({ agencies, onSelect }: { agencies: DashboardAgency[]; onSelect: (sigla: string) => void }) {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {agencies.sort((a, b) => (a.posicao_ranking ?? 99) - (b.posicao_ranking ?? 99)).map((agency) => (
        <button key={agency.sigla} className="card text-left hover:border-brand/50 transition-colors" onClick={() => onSelect(agency.sigla)}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-text-muted">#{agency.posicao_ranking ?? "-"} no ranking</p>
              <h2 className="text-sm font-semibold text-text-primary mt-1">{agency.sigla} - {agency.nome_completo}</h2>
              <p className="text-sm text-text-secondary mt-1">{agency.setor_regulado}</p>
            </div>
            <span className="font-mono text-lg text-brand">{agency.score_geral.toFixed(1)}</span>
          </div>
          <p className="text-xs text-text-muted mt-3">{agency.lei_criacao} - {agency.ano_criacao}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {agency.destaques_positivos.slice(0, 2).map((item) => <span key={item} className="badge badge-gray">{item}</span>)}
          </div>
          <a className="text-xs text-brand mt-3 inline-flex items-center gap-1" href={agency.site_oficial} target="_blank" rel="noreferrer">
            Fonte oficial <ExternalLink className="w-3 h-3" />
          </a>
        </button>
      ))}
    </section>
  );
}

function CriteriaView({ criteria, selectedCriterionId, onSelect }: { criteria: DashboardCriterion[]; selectedCriterionId: number; onSelect: (id: number) => void }) {
  const selected = criteria.find((item) => item.id === selectedCriterionId) ?? criteria[0];
  return (
    <section className="grid grid-cols-1 xl:grid-cols-[0.8fr_1.2fr] gap-4">
      <div className="space-y-2">
        {criteria.map((criterion) => (
          <button key={criterion.id} className={cn("card w-full text-left hover:border-brand/50 transition-colors", selected?.id === criterion.id && "border-brand/60")} onClick={() => onSelect(criterion.id)}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-text-primary">{criterion.id}. {criterion.nome}</h2>
              <span className="font-mono text-sm text-brand">{criterion.score_medio.toFixed(1)}</span>
            </div>
            <p className="text-xs text-text-muted mt-1">{Math.round(Number(criterion.peso) * 100)}% - {criterion.metodo_coleta} - prioridade {criterion.nivel_prioridade}</p>
          </button>
        ))}
      </div>
      {selected ? <CriterionDetail criterion={selected} /> : null}
    </section>
  );
}

function DiagnosticView(props: {
  ranking: DashboardRanking[];
  criteria: DashboardCriterion[];
  agencies: DashboardAgency[];
  selectedAgency?: DashboardRanking;
  selectedAgencyProfile?: DashboardAgency;
  selectedAgencySigla: string;
  onSelectAgency: (sigla: string) => void;
}) {
  const { ranking, criteria, agencies, selectedAgency, selectedAgencyProfile, selectedAgencySigla, onSelectAgency } = props;
  return (
    <section className="space-y-4">
      <Filters agencies={agencies} criteria={criteria} selectedAgencySigla={selectedAgencySigla} selectedCriterionId={criteria[0]?.id ?? 1} onSelectAgency={onSelectAgency} onSelectCriterion={() => undefined} hideCriterion />
      <div className="grid grid-cols-1 xl:grid-cols-[0.8fr_1.2fr] gap-4">
        <RankingPanel ranking={ranking} compact />
        <div className="space-y-4">
          <AgencySummary agency={selectedAgency} profile={selectedAgencyProfile} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(selectedAgency?.notas ?? []).map((note) => {
              const criterion = criteria.find((item) => item.id === note.criterio_id);
              return <NoteCard key={note.criterio_id} note={note} criterionName={criterion?.nome ?? `Criterio ${note.criterio_id}`} />;
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function EvidenceView(props: {
  agencies: DashboardAgency[];
  criteria: DashboardCriterion[];
  selectedAgencySigla: string;
  selectedCriterionId: number;
  onSelectAgency: (sigla: string) => void;
  onSelectCriterion: (id: number) => void;
  evidences: DashboardEvidence[];
  allEvidence: DashboardEvidence[];
  evidenceRows: EvidenceRow[];
  onAddEvidence: (payload: ManualEvidenceInput) => void;
  onReviewEvidence: (payload: { id: string; status_revisao: string }) => void;
  isSavingEvidence: boolean;
  isReviewing: boolean;
}) {
  return (
    <section className="space-y-4">
      <Filters {...props} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Metric label="Total" value={props.allEvidence.length} />
        <Metric label="Filtro atual" value={props.evidences.length} />
        <Metric label="Pendentes" value={props.allEvidence.filter((item) => item.status_revisao === "pendente").length} />
        <Metric label="Fontes" value={new Set(props.allEvidence.map((item) => item.fonte)).size} />
      </div>

      <ManualEvidenceForm
        agencySigla={props.selectedAgencySigla}
        criterionId={props.selectedCriterionId}
        onAdd={props.onAddEvidence}
        isSaving={props.isSavingEvidence}
      />

      {props.evidenceRows.length > 0 ? (
        <div className="card space-y-3">
          <h2 className="text-sm font-semibold text-text-primary">Revisao de evidencias ({props.selectedAgencySigla})</h2>
          <p className="text-xs text-text-muted">Apenas evidencias validadas alimentam a pontuacao do premio.</p>
          <div className="space-y-2">
            {props.evidenceRows.map((row) => (
              <div key={row.id} className="flex items-start gap-3 p-3 border border-border rounded-md">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary font-medium line-clamp-2">{row.titulo}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {row.fonte ?? "manual"}
                    {row.url ? <> · <a href={row.url} target="_blank" rel="noreferrer" className="text-brand hover:underline inline-flex items-center gap-1">link <ExternalLink className="w-3 h-3" /></a></> : null}
                  </p>
                  {row.trecho_publico ? <p className="text-xs text-text-secondary mt-1 line-clamp-2">{row.trecho_publico}</p> : null}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn(
                    "badge text-xs",
                    row.status_revisao === "validado" && "badge-green",
                    row.status_revisao === "rejeitado" && "badge-red",
                    (row.status_revisao === "pendente" || row.status_revisao === "em_revisao") && "badge-gray",
                  )}>{row.status_revisao}</span>
                  <button
                    className="btn-secondary text-xs"
                    disabled={props.isReviewing || row.status_revisao === "validado"}
                    onClick={() => props.onReviewEvidence({ id: row.id, status_revisao: "validado" })}
                    title="Validar"
                  >
                    <Check className="w-3.5 h-3.5" /> Validar
                  </button>
                  <button
                    className="btn-secondary text-xs"
                    disabled={props.isReviewing || row.status_revisao === "rejeitado"}
                    onClick={() => props.onReviewEvidence({ id: row.id, status_revisao: "rejeitado" })}
                    title="Rejeitar"
                  >
                    <X className="w-3.5 h-3.5" /> Rejeitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {props.evidences.map((evidence) => <EvidenceCard key={`${evidence.agencia_sigla}-${evidence.criterio_id}-${evidence.fonte}`} evidence={evidence} />)}
      </section>
    </section>
  );
}

function ManualEvidenceForm({ agencySigla, criterionId, onAdd, isSaving }: {
  agencySigla: string;
  criterionId: number;
  onAdd: (payload: ManualEvidenceInput) => void;
  isSaving: boolean;
}) {
  const [titulo, setTitulo] = useState("");
  const [url, setUrl] = useState("");
  const [trecho, setTrecho] = useState("");

  function submit() {
    if (!titulo.trim()) return;
    onAdd({
      agencia_sigla: agencySigla,
      criterio_id: criterionId,
      titulo: titulo.trim(),
      url: url.trim() || null,
      fonte: "manual",
      trecho_publico: trecho.trim() || null,
    });
    setTitulo("");
    setUrl("");
    setTrecho("");
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <Plus className="w-4 h-4 text-brand" />
        <h2 className="text-sm font-semibold text-text-primary">Adicionar evidencia manual</h2>
      </div>
      <p className="text-xs text-text-muted">
        Vinculada a {agencySigla} · criterio {criterionId}. Entra como &quot;pendente&quot; ate revisao humana.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input className="input" placeholder="Titulo da evidencia" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        <input className="input" placeholder="URL (opcional)" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      <textarea className="input min-h-20" placeholder="Trecho publico / observacao (opcional)" value={trecho} onChange={(e) => setTrecho(e.target.value)} />
      <button className="btn-primary w-fit" onClick={submit} disabled={isSaving || !titulo.trim()}>
        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        Adicionar evidencia
      </button>
    </div>
  );
}

function CollectionsView({ collectionStatus, runCollection, isPending, runFullCollection, isRunningFull, fullResult }: {
  collectionStatus?: CollectionStatus;
  runCollection: () => void;
  isPending: boolean;
  runFullCollection: () => void;
  isRunningFull: boolean;
  fullResult?: { lotes: number; total: number };
}) {
  return (
    <section className="space-y-4">
      <div className="card flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Rodada de coleta segura</h2>
          <p className="text-sm text-text-muted mt-1">Processa fontes em lotes, registra status e mantem revisao humana de evidencias.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={runFullCollection} disabled={isRunningFull || isPending}>
            {isRunningFull ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            Coletar todas as agencias
          </button>
          <button className="btn-secondary" onClick={runCollection} disabled={isPending || isRunningFull}>
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
            Rodar lote
          </button>
        </div>
      </div>
      {fullResult ? (
        <div className="border border-success/30 bg-success/10 rounded-card p-3 text-sm text-success">
          Coleta completa: {fullResult.lotes} lote(s) processado(s) cobrindo {fullResult.total} tarefa(s). Evidencias registradas como pendentes para revisao.
        </div>
      ) : null}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Metric label="Total" value={collectionStatus?.metricas.total ?? 0} />
        <Metric label="Sucesso" value={collectionStatus?.metricas.sucesso ?? 0} />
        <Metric label="Falha" value={collectionStatus?.metricas.falha ?? 0} />
        <Metric label="Restrito" value={collectionStatus?.metricas.restrito ?? 0} />
        <Metric label="Revisao" value={collectionStatus?.metricas.pendente_revisao ?? 0} />
      </div>
      <CollectionTable rows={(collectionStatus?.data ?? []).slice(0, 80)} />
    </section>
  );
}

function PrizeView({ data }: { data: QualityDashboard }) {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {data.premio.map((item) => (
        <div key={item.categoria.id} className="card">
          <Gavel className="w-4 h-4 text-brand mb-3" />
          <h2 className="text-sm font-semibold text-text-primary">{item.categoria.nome}</h2>
          <p className="text-sm text-text-secondary mt-2">{item.vencedora ? `Vencedora preliminar: ${item.vencedora}` : "Sem vencedora definida"}</p>
          <p className="font-mono text-2xl text-brand mt-3">{item.score !== null ? item.score : "-"}</p>
          <p className="text-xs text-text-muted mt-2">Resultado preliminar com base nas avaliacoes institucionais do ano.</p>
        </div>
      ))}
    </section>
  );
}

function ReportsView({ currentYear }: { currentYear: number }) {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <ReportCard title="Ranking JSON completo" href={`/api/v1/qualidade-regulatoria/relatorios/ranking?ano=${currentYear}`} />
      <ReportCard title="Ranking CSV com criterios" href={`/api/v1/qualidade-regulatoria/relatorios/ranking?ano=${currentYear}&format=csv`} />
    </section>
  );
}

function MatrixPanel({ ranking, criteria }: { ranking: DashboardRanking[]; criteria: DashboardCriterion[] }) {
  return (
    <div className="card overflow-x-auto">
      <div className="flex items-center gap-2 mb-4">
        <Table2 className="w-4 h-4 text-brand" />
        <h2 className="text-sm font-semibold text-text-primary">Matriz agencia x criterio</h2>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-text-muted border-b border-border">
            <th className="py-2 pr-3">Agencia</th>
            {criteria.map((criterion) => <th key={criterion.id} className="py-2 px-2 text-right whitespace-nowrap">C{criterion.id}</th>)}
            <th className="py-2 pl-3 text-right">Score</th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((agency) => (
            <tr key={agency.agencia_sigla} className="border-b border-border last:border-0">
              <td className="py-2 pr-3 font-semibold text-text-primary">{agency.agencia_sigla}</td>
              {criteria.map((criterion) => {
                const note = agency.notas.find((item) => item.criterio_id === criterion.id);
                return <td key={criterion.id} className={cn("py-2 px-2 text-right font-mono", scoreClass(note?.nota ?? 0))}>{note?.nota.toFixed(0) ?? "-"}</td>;
              })}
              <td className="py-2 pl-3 text-right font-mono text-brand">{agency.score_geral.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CriterionLeaders({ criteria }: { criteria: DashboardCriterion[] }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="w-4 h-4 text-brand" />
        <h2 className="text-sm font-semibold text-text-primary">Lideres por criterio</h2>
      </div>
      <div className="space-y-3">
        {criteria.map((criterion) => {
          const leader = criterion.ranking[0];
          return (
            <div key={criterion.id} className="grid grid-cols-[1fr_70px_60px] gap-3 items-center">
              <p className="text-sm text-text-primary truncate">{criterion.nome}</p>
              <span className="text-sm font-semibold text-text-primary">{leader?.agencia_sigla ?? "-"}</span>
              <span className="text-sm font-mono text-brand text-right">{leader?.nota.toFixed(1) ?? "-"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SourceCoverage({ data }: { data: QualityDashboard }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <FileSearch className="w-4 h-4 text-brand" />
        <h2 className="text-sm font-semibold text-text-primary">Fontes e cobertura</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {data.fontes.slice(0, 10).map((fonte) => (
          <a key={fonte.id} href={fonte.url} target="_blank" rel="noreferrer" className="rounded-md border border-border p-3 hover:border-brand/50 transition-colors">
            <p className="text-sm font-medium text-text-primary">{fonte.nome}</p>
            <p className="text-xs text-text-muted mt-1">{fonte.formato ?? "fonte publica"} - {fonte.atualizacao ?? "atualizacao variavel"}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

function CriterionDetail({ criterion }: { criterion: DashboardCriterion }) {
  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-sm font-semibold text-text-primary">{criterion.nome}</h2>
        <p className="text-sm text-text-secondary mt-2">{criterion.descricao}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <Metric label="Peso" value={`${Math.round(Number(criterion.peso) * 100)}%`} />
          <Metric label="Media" value={criterion.score_medio.toFixed(1)} />
          <Metric label="Avancado" value={criterion.distribuicao_niveis.avancado ?? 0} />
          <Metric label="Inicial" value={criterion.distribuicao_niveis.inicial ?? 0} />
        </div>
      </div>
      <div className="card">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Ranking do criterio</h3>
        <div className="space-y-2">
          {criterion.ranking.map((item) => (
            <div key={item.agencia_sigla} className="grid grid-cols-[36px_80px_1fr_64px] gap-3 items-center">
              <span className="text-xs font-mono text-text-muted">{item.posicao}</span>
              <span className="text-sm font-semibold text-text-primary">{item.agencia_sigla}</span>
              <div className="h-2 rounded-full bg-bg-hover overflow-hidden">
                <div className={cn("h-full", item.nivel === "avancado" ? "bg-success" : "bg-brand")} style={{ width: `${Math.min(100, item.nota)}%` }} />
              </div>
              <span className="text-sm font-mono text-text-primary text-right">{item.nota.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {criterion.fontes.map((fonte) => (
          <a key={fonte.id} href={fonte.url} target="_blank" rel="noreferrer" className="card hover:border-brand/50 transition-colors">
            <p className="text-sm font-semibold text-text-primary">{fonte.nome}</p>
            <p className="text-xs text-text-muted mt-1">{fonte.formato ?? "fonte publica"} - {fonte.atualizacao ?? "variavel"}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

function AgencySummary({ agency, profile }: { agency?: DashboardRanking; profile?: DashboardAgency }) {
  if (!agency) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="card md:col-span-1">
        <p className="text-xs text-text-muted">#{agency.posicao_ranking} no ranking</p>
        <h2 className="text-xl font-semibold text-text-primary mt-1">{agency.agencia_sigla}</h2>
        <p className="font-mono text-3xl text-brand mt-3">{agency.score_geral.toFixed(1)}</p>
        <p className="text-xs text-text-muted mt-2">{profile?.nome_completo}</p>
      </div>
      <div className="card">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Destaques</h3>
        <List items={agency.destaques_positivos} positive />
      </div>
      <div className="card">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Areas de melhoria</h3>
        <List items={agency.areas_melhoria} />
      </div>
    </div>
  );
}

function NoteCard({ note, criterionName }: { note: DashboardNote; criterionName: string }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-primary">{criterionName}</h3>
        <span className={cn("font-mono text-lg", scoreClass(note.nota))}>{note.nota.toFixed(1)}</span>
      </div>
      <p className="text-xs text-text-secondary mt-2">{note.observacao}</p>
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <span className="badge badge-gray">{note.nivel}</span>
        <span className="badge badge-gray">{note.status_revisao}</span>
        <span className="badge badge-gray">{note.evidencias.length} evidencias</span>
      </div>
    </div>
  );
}

function EvidenceCard({ evidence }: { evidence: DashboardEvidence }) {
  return (
    <a href={evidence.url} target="_blank" rel="noreferrer" className="card hover:border-brand/50 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-text-muted">{evidence.agencia_sigla} - C{evidence.criterio_id} - {evidence.fonte}</p>
          <h2 className="text-sm font-semibold text-text-primary mt-1">{evidence.titulo}</h2>
        </div>
        <ExternalLink className="w-4 h-4 text-brand shrink-0" />
      </div>
      <p className="text-sm text-text-secondary mt-3">{evidence.trecho_publico}</p>
      <span className="badge badge-gray mt-3">{evidence.status_revisao}</span>
    </a>
  );
}

function Filters(props: {
  agencies: DashboardAgency[];
  criteria: DashboardCriterion[];
  selectedAgencySigla: string;
  selectedCriterionId: number;
  onSelectAgency: (sigla: string) => void;
  onSelectCriterion: (id: number) => void;
  hideCriterion?: boolean;
}) {
  return (
    <div className="card flex items-center gap-3 flex-wrap">
      <Scale className="w-4 h-4 text-brand" />
      <select className="input max-w-xs" value={props.selectedAgencySigla} onChange={(event) => props.onSelectAgency(event.target.value)}>
        {props.agencies.map((agency) => <option key={agency.sigla} value={agency.sigla}>{agency.sigla} - {agency.nome_completo}</option>)}
      </select>
      {!props.hideCriterion ? (
        <select className="input max-w-xs" value={props.selectedCriterionId} onChange={(event) => props.onSelectCriterion(Number(event.target.value))}>
          {props.criteria.map((criterion) => <option key={criterion.id} value={criterion.id}>C{criterion.id} - {criterion.nome}</option>)}
        </select>
      ) : null}
    </div>
  );
}

function RankingPanel({ ranking, compact = false }: { ranking: DashboardRanking[]; compact?: boolean }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Award className="w-4 h-4 text-brand" />
        <h2 className="text-sm font-semibold text-text-primary">Ranking institucional</h2>
      </div>
      <div className="space-y-2">
        {ranking.slice(0, compact ? 12 : 8).map((item) => (
          <div key={item.agencia_sigla} className="grid grid-cols-[36px_80px_1fr_64px] gap-3 items-center">
            <span className="text-xs font-mono text-text-muted">{item.posicao_ranking}</span>
            <span className="text-sm font-semibold text-text-primary">{item.agencia_sigla}</span>
            <div className="h-2 rounded-full bg-bg-hover overflow-hidden">
              <div className={cn("h-full", item.status_revisao === "validado" ? "bg-success" : "bg-brand")} style={{ width: `${Math.min(100, item.score_geral)}%` }} />
            </div>
            <span className="text-sm font-mono text-text-primary text-right">{item.score_geral.toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LegalNotice({ data }: { data?: QualityDashboard }) {
  return (
    <div className="rounded-md border border-warning/30 bg-warning/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-warning mt-0.5" />
        <div>
          <p className="text-sm font-medium text-text-primary">LGPD/LAI by design</p>
          <p className="text-sm text-text-secondary mt-1">
            {data?.legal.disclaimer ?? "Ranking institucional baseado em fontes publicas e revisao humana, sem score individual de agentes publicos."}
          </p>
        </div>
      </div>
    </div>
  );
}

function List({ items, positive = false }: { items: string[]; positive?: boolean }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="text-sm text-text-secondary flex gap-2">
          <CheckCircle className={cn("w-4 h-4 mt-0.5 shrink-0", positive ? "text-success" : "text-brand")} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function CollectionTable({ rows }: { rows: CollectionStatus["data"] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-text-muted border-b border-border">
            <th className="py-2">Agencia</th>
            <th className="py-2">Criterio</th>
            <th className="py-2">Fonte</th>
            <th className="py-2">Status</th>
            <th className="py-2">Compliance</th>
            <th className="py-2">Data</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row) => (
            <tr key={row.id} className="border-b border-border last:border-0">
              <td className="py-2 font-mono">{row.agencia_sigla}</td>
              <td className="py-2">{row.criterio_id ? `C${row.criterio_id}` : "-"}</td>
              <td className="py-2">{row.fonte_id}</td>
              <td className="py-2">{row.status}</td>
              <td className="py-2">{row.compliance_status}</td>
              <td className="py-2">{new Date(row.data_coleta).toLocaleDateString("pt-BR")}</td>
            </tr>
          )) : (
            <tr><td colSpan={6} className="py-8 text-center text-text-muted">Nenhuma coleta registrada ainda.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ReportCard({ title, href }: { title: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="card hover:border-brand/50 transition-colors">
      <Download className="w-5 h-5 text-brand mb-3" />
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      <p className="text-sm text-text-muted mt-1">Inclui ranking, notas por criterio, evidencias e referencias legais.</p>
    </a>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <p className="section-label mb-1">{label}</p>
      <p className="font-mono text-2xl text-text-primary">{value}</p>
    </div>
  );
}

function scoreClass(score: number) {
  if (score >= 76) return "text-success";
  if (score >= 45) return "text-brand";
  return "text-warning";
}
