// Tipos principais da plataforma IRIS Regulação

export type Microtema =
  // ARTESP
  | "tarifa" | "obras" | "multa" | "contrato" | "reequilibrio"
  | "fiscalizacao" | "seguranca" | "ambiental" | "desapropriacao"
  | "adimplencia" | "pessoal" | "usuario"
  // ANM (mineração)
  | "lavra" | "pesquisa" | "licenciamento" | "servidao" | "cfem"
  | "disponibilidade" | "recursos"
  // Genérico
  | "outros";

export type TipoDocumento =
  | "deliberacao"
  | "ata"
  | "resolucao"
  | "portaria"
  | "pauta"
  | "voto_individual"
  | "documento_apoio";

export type AnttManualDocumentType =
  | "pauta"
  | "ata"
  | "voto_individual"
  | "reuniao_deliberativa_eletronica"
  | "reuniao_diretoria_publica"
  | "reuniao_extraordinaria"
  | "outro";

export type AreaRegulatoria =
  | "rodovia"
  | "ferrovia"
  | "rodoviario_passageiros"
  | "cargas_logistica"
  | "infraestrutura_geral"
  | "governanca_regulatoria"
  | "administrativo"
  | "outros";

export type Resultado =
  | "Deferido"
  | "Indeferido"
  | "Parcialmente Deferido"
  | "Retirado de Pauta"
  | "Ratificado"
  | "Aprovado"
  | "Aprovado com Ressalvas"
  | "Aprovado por Unanimidade"
  | "Recomendado"
  | "Determinado"
  | "Autorizado";

export interface Agencia {
  id: string;
  sigla: string;
  nome: string;
  nome_completo: string | null;
  tipo?: "federal" | "estadual" | null;
  esfera?: string | null;
  ministerio_vinculado?: string | null;
  url_institucional?: string | null;
  url_diretores?: string | null;
  estado?: string | null;
  status?: "ativa" | "inativa";
  dados_importados_em?: string | null;
  metadata?: Record<string, unknown>;
  ativo: boolean;
  created_at: string;
  updated_at?: string;
}

export interface Diretor {
  id: string;
  nome: string;
  agencia_id: string | null;
  cargo: string | null;
  ativo?: boolean;
  situacao?: "titular" | "substituto" | "interino" | "inativo" | "designado";
  data_posse?: string | null;
  data_fim_mandato?: string | null;
  data_saida?: string | null;
  ato_nomeacao?: string | null;
  publicacao_dou?: string | null;
  foto_url?: string | null;
  minibio?: string | null;
  curriculo_url?: string | null;
  email?: string | null;
  telefone?: string | null;
  percentual_mandato_concluido?: number | null;
  fonte_dado?: "automatico" | "manual" | "verificado";
  importado_em?: string | null;
  metadata?: Record<string, unknown>;
  needs_review: boolean;
  review_status?: ReviewStatus;
  source_url?: string | null;
  source_type?: FonteOficialTipo | null;
  source_confidence?: number | null;
  lgpd_basis?: string | null;
  last_verified_at?: string | null;
  created_at: string;
  mandatos?: Mandato[];
}

export interface Mandato {
  id: string;
  diretor_id: string;
  diretor_nome: string;
  agencia_id?: string;
  data_inicio: string;
  data_fim: string | null;
  cargo: string | null;
  ato_nomeacao?: string | null;
  publicacao_dou?: string | null;
  fonte_dado?: "automatico" | "manual" | "verificado";
  percentual_mandato_concluido?: number | null;
  metadata?: Record<string, unknown>;
  status: "Ativo" | "Inativo";
  review_status?: ReviewStatus;
  source_url?: string | null;
  source_type?: FonteOficialTipo | null;
  source_confidence?: number | null;
  lgpd_basis?: string | null;
  last_verified_at?: string | null;
  created_at?: string;
}

export interface VotoEmbutido {
  id: string;
  diretor_id: string;
  diretor_nome: string | null;
  tipo_voto: string;
  is_divergente: boolean;
  is_nominal: boolean;
}

export interface VotoSugerido {
  nome: string;
  diretor_id?: string | null;
  tipo_voto: "Favoravel" | "Desfavoravel" | "Ausente";
  origem: "nominal" | "inferido_mandato" | "contrario" | "ausente";
  is_nominal: boolean;
}

export interface Deliberacao {
  id: string;
  numero_deliberacao: string | null;
  numero_reuniao: string | null;
  reuniao_ordinaria: string | null;
  tipo_reuniao: "Ordinaria" | "Extraordinaria" | null;
  tipo_documento: TipoDocumento;
  processo: string | null;
  interessado: string | null;
  assunto?: string | null;
  procedencia: string | null;
  relator: string | null;
  item_numero: string | null;
  documento_pai_id: string | null;
  microtema: string | null;
  area_regulatoria?: AreaRegulatoria | string | null;
  resultado: Resultado | null;
  decisoes_todas: string[] | null;
  pauta_interna: boolean;
  data_reuniao: string | null;
  agencia_id: string | null;
  agencia?: { sigla: string; nome: string } | null;
  auto_classified: boolean;
  extraction_confidence: number | null;
  created_at: string;
  resumo_pleito?: string | null;
  fundamento_decisao?: string | null;
  votos?: VotoEmbutido[];
  raw_extraction?: Record<string, unknown> | null;
  upload_job_id?: string | null;
}

export interface DeliberacaoPaginada {
  data: Deliberacao[];
  total: number;
  page: number;
  pages: number;
  limit: number;
}

// ─── Upload ──────────────────────────────────────────────────────────────

export interface UploadJobResult {
  filename: string;
  job_id: string | null;
  document_id?: string | null;
  status: "queued" | "done" | "duplicate" | "rejected" | "error";
  message?: string;
}

export interface BatchUploadResponse {
  total: number;
  queued: number;
  rejected: number;
  duplicate?: number;
  results: UploadJobResult[];
}

export type JobStatusType =
  | "pending"
  | "processing"
  | "done"
  | "failed"
  | "retry"
  | "done_with_warnings";

export interface JobStatus {
  id: string;
  filename: string;
  status: JobStatusType;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Dashboard ───────────────────────────────────────────────────────────

export interface DashboardOverview {
  total_deliberacoes: number;
  deferidos: number;
  indeferidos: number;
  sem_resultado: number;
  taxa_deferimento: string;
  reunioes_unicas: number;
  avg_confidence: number;
  top_microtema: string | null;
  auto_classified_pct: number;
  pauta_externa: number;
  pauta_interna_count: number;
}

export interface MicrotemaStats {
  microtema: string;
  total: number;
  deferido: number;
  indeferido: number;
  pct_deferido: number;
  pct_indeferido: number;
}

// ─── Votação ─────────────────────────────────────────────────────────────

export interface MandatosStats {
  diretores_ativos: number;
  participacoes_colegiadas: number;
  taxa_consenso: string;
  total_deliberacoes: number;
}

export interface VotoSector {
  microtema: string;
  count: number;
}

export interface VotoMatrixRow {
  diretor_id: string;
  diretor_nome: string;
  favoravel: number;
  desfavoravel: number;
  abstencao: number;
  divergente: number;
  total: number;
}

export interface VotoDistribution {
  tipo_voto: string;
  count: number;
  pct: string;
}

// ─── Perfil de Diretor ────────────────────────────────────────────────────

export interface DiretorProfile {
  id: string;
  nome: string;
  cargo: string | null;
  agencia_id: string | null;
  agencia_sigla: string | null;
  mandato: {
    data_inicio: string;
    data_fim: string | null;
    status: "Ativo" | "Inativo";
    dias_restantes: number | null;
  };
  stats: {
    total_votos: number;
    favoravel: number;
    desfavoravel: number;
    abstencao: number;
    divergente: number;
    pct_favoravel: number;
    pct_divergente: number;
  };
  por_microtema: Array<{ microtema: string; total: number }>;
  historico: Array<{
    deliberacao_id: string;
    numero_deliberacao: string | null;
    data_reuniao: string | null;
    interessado: string | null;
    microtema: string | null;
    area_regulatoria?: AreaRegulatoria | string | null;
    resultado: string | null;
    tipo_voto: string;
    is_divergente: boolean;
  }>;
  tendencias: {
    perfil: "Consensual" | "Moderadamente divergente" | "Divergente";
    microtema_dominante: string | null;
    taxa_aprovacao: string;
    descricao: string;
  };
}

export interface DecisaoTipo {
  resultado: string;
  count: number;
  pct: number;
}

export interface MandatosAnalytics {
  total_deliberacoes: number;
  taxa_litigio: string;
  taxa_consenso: string;
  taxa_sancao: string;
  distribuicao_decisao: DecisaoTipo[];
  evolucao_mensal: Array<{
    period: string;
    total: number;
    deferido: number;
    indeferido: number;
  }>;
}

export interface DiretorOverviewItem {
  diretor_id: string;
  diretor_nome: string;
  total: number;
  favoravel: number;
  desfavoravel: number;
  divergente: number;
  pct_favor: number;
}

export interface EmpresaStats {
  nome: string;
  total_deliberacoes: number;
  deferidos: number;
  indeferidos: number;
  pct_deferido: number;
  ultima_deliberacao: string | null;
  microtemas: string[];
  microtema_principal: string | null;
  agencia_id: string | null;
  risco_regulatorio?: "alto" | "medio" | "baixo";
  tendencia_direcao?: "melhorando" | "estavel" | "piorando";
}

export interface EmpresaDetalhe {
  nome: string;
  total_deliberacoes: number;
  deferidos: number;
  indeferidos: number;
  pct_deferido: number;
  ultima_deliberacao: string | null;
  agencia_id: string | null;
  risco_regulatorio: "alto" | "medio" | "baixo";
  tendencia: {
    pct_anterior: number;
    pct_recente: number;
    direcao: "melhorando" | "estavel" | "piorando";
  };
  evolucao_mensal: Array<{
    period: string;
    total: number;
    positivo: number;
    negativo: number;
  }>;
  microtemas_breakdown: Array<{ microtema: string; count: number }>;
  diretores: Array<{
    id: string;
    nome: string;
    total: number;
    favoravel: number;
    pct_favoravel: number;
  }>;
  historico: Deliberacao[];
  alertas: string[];
}

export interface Alerta {
  id: string;
  tipo: "empresa_risco" | "tema_emergente" | "diretor_divergente";
  severity: "high" | "medium" | "low";
  titulo: string;
  mensagem: string;
  entidade: string;
  created_at: string;
}

// ─── Upload Preview / Confirm ─────────────────────────────────────────────

export interface PreviewResultFields {
  numero_deliberacao: string | null;
  numero_reuniao: string | null;
  reuniao_ordinaria: string | null;
  tipo_reuniao: string | null;
  tipo_documento: TipoDocumento;
  data_reuniao: string | null;
  interessado: string | null;
  assunto: string | null;
  procedencia: string | null;
  relator: string | null;
  item_numero: string | null;
  processo: string | null;
  resultado: string | null;
  decisoes_todas: string[];
  microtema: string;
  area_regulatoria: AreaRegulatoria | string;
  pauta_interna: boolean;
  resumo_pleito: string | null;
  fundamento_decisao: string | null;
  diretores_detectados: string[];
  nomes_votacao: string[];
  nomes_votacao_contra: string[];
  nomes_votacao_ausente: string[];
  votos_sugeridos?: VotoSugerido[];
}

/** Para atas: uma PreviewResult pode conter múltiplos items */
export interface AtaPreviewItem {
  item_numero: string;
  processo: string | null;
  assunto: string | null;
  interessado: string | null;
  relator: string | null;
  decisao: string | null;
  resultado: string | null;
  microtema: string;
  area_regulatoria?: AreaRegulatoria | string;
  votos_detectados?: string[];
  votos_contra_detectados?: string[];
  votos_ausentes_detectados?: string[];
  votos_sugeridos?: VotoSugerido[];
  unanimidade_detectada?: boolean;
  needs_review?: boolean;
  warnings?: string[];
}

export interface PreviewResultAta extends PreviewResult {
  ata_items: AtaPreviewItem[];
}

export interface PreviewResult {
  filename: string;
  source_archive?: string | null;
  status: "ok" | "low_confidence" | "error";
  error?: string;
  fields: PreviewResultFields;
  confidence: number;
  page_count: number;
  chars_per_page: number;
  file_hash: string;
  is_duplicate: boolean;
  duplicate_reason?: string;
  duplicate_job_id: string | null;
  agencia_id_detected: string | null;
  agencia_sigla_detected: string | null;
  documento_antt_tipo?: AnttManualDocumentType;
  documento_subtipo?: string | null;
  import_counts_as_final?: boolean;
  semantic_duplicate_key?: string | null;
  warnings?: string[];
  extraction_raw?: Record<string, unknown>;
  ata_items?: AtaPreviewItem[];
}

export interface BatchPreviewResponse {
  results: PreviewResult[];
}

export interface ConfirmDelib {
  filename: string;
  documento_id?: string | null;
  upload_job_id?: string | null;
  agencia_id?: string | null;
  numero_deliberacao: string | null;
  numero_reuniao: string | null;
  reuniao_ordinaria: string | null;
  tipo_reuniao: string | null;
  tipo_documento: TipoDocumento;
  data_reuniao: string | null;
  interessado: string | null;
  assunto: string | null;
  procedencia: string | null;
  relator: string | null;
  item_numero: string | null;
  processo: string | null;
  resultado: string | null;
  decisoes_todas: string[];
  microtema: string | null;
  area_regulatoria?: AreaRegulatoria | string | null;
  pauta_interna: boolean;
  resumo_pleito: string | null;
  fundamento_decisao: string | null;
  nomes_votacao: string[];
  nomes_votacao_contra: string[];
  nomes_votacao_ausente?: string[];
  votos_sugeridos?: VotoSugerido[];
  extraction_confidence: number;
  documento_antt_tipo?: AnttManualDocumentType | null;
  documento_subtipo?: string | null;
  import_counts_as_final?: boolean;
  semantic_duplicate_key?: string | null;
  warnings?: string[];
  extraction_raw?: Record<string, unknown>;
  ata_items?: AtaPreviewItem[];
}

export interface ConfirmResult {
  filename: string;
  status: "created" | "document_saved" | "error";
  deliberacao_id?: string;
  documento_id?: string | null;
  message?: string;
  error?: string;
}

export interface BatchConfirmResponse {
  created: number;
  errors: number;
  results: ConfirmResult[];
  deliberacoes?: Deliberacao[];
}

export type DocumentoRegulatorioStatus =
  | "queued"
  | "processing"
  | "review_pending"
  | "confirmed"
  | "ignored"
  | "failed";

export interface DocumentoRegulatorio {
  id: string;
  upload_job_id: string | null;
  agencia_id: string | null;
  agencia_sigla_detected: string | null;
  filename: string;
  source_archive: string | null;
  storage_bucket: string;
  storage_path: string;
  file_hash: string;
  size_bytes: number | null;
  status: DocumentoRegulatorioStatus;
  tipo_documento: TipoDocumento | string | null;
  documento_subtipo: string | null;
  semantic_duplicate_key: string | null;
  is_duplicate: boolean;
  duplicate_documento_id: string | null;
  duplicate_deliberacao_id: string | null;
  extraction_confidence: number | null;
  page_count: number | null;
  chars_per_page: number | null;
  texto_extraido: string | null;
  campos_detectados: Record<string, unknown>;
  ata_items: AtaPreviewItem[] | null;
  warnings: string[];
  error_message: string | null;
  metadata: Record<string, unknown>;
  signed_url: string | null;
  preview: PreviewResult | null;
  agencia?: { sigla: string; nome: string } | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentoRegulatorioListResponse {
  data: DocumentoRegulatorio[];
  total: number;
}

// ─── Monitoramento ───────────────────────────────────────────────────────

export type MonitoramentoEstrategia =
  | "html-static"
  | "govbr-news"
  | "antt-2026"
  | "needs-headless"
  | "headless"
  | "manual";

export type MonitoramentoTipoItem =
  | "reuniao"
  | "pauta"
  | "voto"
  | "ata"
  | "deliberacao"
  | "diretoria"
  | "mandato"
  | "ato_nomeacao"
  | "noticia"
  | "politica_publica"
  | "consulta_publica"
  | "documento";

export type MonitoramentoItemStatus =
  | "novo"
  | "em_revisao"
  | "importado"
  | "ignorado";

export interface MonitoramentoSite {
  id: string;
  agencia_id: string | null;
  agencia?: { sigla: string; nome: string } | null;
  nome: string;
  url: string;
  estrategia: MonitoramentoEstrategia;
  seletor_links: string;
  ativo: boolean;
  ultimo_check: string | null;
  ultimo_hash: string | null;
  ultimo_status: "never" | "ok" | "error" | "needs_headless";
  ultimo_erro: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonitoramentoItem {
  id: string;
  site_id: string;
  agencia_id: string | null;
  agencia?: { sigla: string; nome: string } | null;
  tipo: MonitoramentoTipoItem;
  titulo: string;
  url_item: string;
  reuniao: string | null;
  data_reuniao: string | null;
  status: MonitoramentoItemStatus;
  first_seen_at: string;
  last_seen_at: string;
  metadata?: Record<string, unknown>;
  site?: { nome: string; url: string } | null;
}

export interface MonitoramentoAlerta {
  id: string;
  item_id: string;
  site_id: string;
  agencia_id: string | null;
  tipo: string;
  titulo: string;
  url_item: string;
  lido: boolean;
  resolvido: boolean;
  created_at: string;
  item?: MonitoramentoItem | null;
  site?: { nome: string; url: string } | null;
  agencia?: { sigla: string; nome: string } | null;
}

export interface MonitoramentoRun {
  id: string;
  site_id: string | null;
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "error" | "needs_headless";
  itens_encontrados: number;
  novos_itens: number;
  error_message: string | null;
  site?: { nome: string } | null;
}

export interface MonitoramentoCheckResponse {
  checked: number;
  novos_detectados: number;
  runs: Array<{
    site_id: string;
    site_nome: string;
    status: "ok" | "error" | "needs_headless";
    itens_encontrados: number;
    novos_itens: number;
    error?: string;
  }>;
}

// Notícias regulatórias / Newsletter
export type RegulatoryNewsStatus = "novo" | "selecionado" | "ignorado" | "arquivado";

export interface RegulatoryNews {
  id: string;
  agencia_id: string | null;
  agencia_sigla: string | null;
  agencia?: { sigla: string; nome: string } | null;
  titulo: string;
  url: string;
  fonte: string;
  imagem_url: string | null;
  resumo: string | null;
  conteudo: string | null;
  publicado_em: string | null;
  status_curadoria: RegulatoryNewsStatus;
  hash_item: string;
  metadata: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
}

export interface RegulatoryNewsListResponse {
  data: RegulatoryNews[];
  total: number;
}

export interface RegulatoryNewsCollectResponse {
  found: number;
  upserted: number;
  items: RegulatoryNews[];
  source_reports?: RegulatoryNewsSourceReport[];
}

export interface RegulatoryNewsSourceReport {
  agencia_sigla: string;
  fonte: string;
  source_url: string;
  status: "ok" | "error";
  links_found: number;
  items_collected: number;
  latest_urls: string[];
  error?: string;
}

export interface RegulatoryNewsletterSchedule {
  id: string;
  nome: string;
  dia_semana: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  hora_envio: string;
  destinatarios: string[];
  ativo: boolean;
  proximo_envio: string | null;
  ultimo_aviso_em: string | null;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegulatoryNewsletterEdition {
  id: string;
  assunto: string;
  descricao: string | null;
  destinatarios: string[];
  temas: string[];
  noticia_ids: string[];
  status: "rascunho" | "revisado" | "aprovado" | "enviado" | "arquivado";
  html: string;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegulatoryNewsletterEditionCreateResponse {
  edition: RegulatoryNewsletterEdition;
}

// Diretor/mandato provenance. Store only public-office data, never CPF/contact fields.
export type ReviewStatus = "pendente" | "aprovado" | "rejeitado" | "conflito";

export type FonteOficialTipo =
  | "diario_oficial"
  | "pagina_agencia"
  | "portal_transparencia"
  | "deliberacao"
  | "ata"
  | "outro";

export interface FonteOficial {
  id: string;
  agencia_id: string | null;
  tipo: FonteOficialTipo;
  titulo: string;
  url: string;
  hash_conteudo: string | null;
  coletado_em: string;
  confianca: number;
  metadata: Record<string, unknown>;
  agencia?: { sigla: string; nome: string } | null;
}

export interface DiretorCandidato {
  id: string;
  agencia_id: string | null;
  nome_detectado: string;
  cargo_detectado: string | null;
  diretor_id: string | null;
  source_type: FonteOficialTipo;
  source_url: string | null;
  source_hash: string | null;
  evidence: Record<string, unknown>;
  confidence: number;
  review_status: ReviewStatus;
  created_at: string;
  reviewed_at: string | null;
  agencia?: { sigla: string; nome: string } | null;
  diretor?: { id: string; nome: string } | null;
}

export interface RuntimeStatus {
  is_demo: boolean;
  has_supabase_url: boolean;
  has_service_role_key: boolean;
  persistence: "supabase" | "demo";
  mode_reason: "missing_supabase_url" | "missing_service_role" | "user_demo" | "real";
  warnings: string[];
}

// Coleta segura ANTT 2026
export type AnttReuniaoTipo = "ordinaria" | "extraordinaria" | "eletronica";
export type DocumentoColetadoTipo = "pauta" | "voto" | "deliberacao" | "outro";
export type DocumentoColetadoStatus =
  | "coletado"
  | "validado"
  | "em_revisao"
  | "importado"
  | "ignorado"
  | "erro";

export interface AnttReuniaoColetada {
  id: string;
  agencia_id: string | null;
  ano: number;
  numero: string;
  titulo: string;
  tipo: AnttReuniaoTipo;
  data_inicio: string | null;
  data_fim: string | null;
  hora_inicio: string | null;
  hora_fim: string | null;
  url_reuniao: string;
  source_url: string;
  status: "coletada" | "parcial" | "erro" | "ignorada";
  metadata: Record<string, unknown>;
  coletado_em: string;
}

export interface AnttProcessoColetado {
  id: string;
  reuniao_id: string;
  item_numero: string | null;
  processo: string | null;
  interessado: string | null;
  relator: string | null;
  assunto: string | null;
  decisao: string | null;
  metadata: Record<string, unknown>;
}

export interface DocumentoColetado {
  id: string;
  agencia_id: string | null;
  reuniao_id: string | null;
  processo_id: string | null;
  tipo: DocumentoColetadoTipo;
  titulo: string;
  url_original: string;
  storage_bucket: string;
  storage_path: string | null;
  file_hash: string | null;
  content_type: string | null;
  tamanho_bytes: number | null;
  status: DocumentoColetadoStatus;
  validation_status: "pendente" | "ok" | "rejeitado" | "erro";
  error_message: string | null;
  metadata: Record<string, unknown>;
  coletado_em: string;
  reuniao?: Pick<AnttReuniaoColetada, "titulo" | "tipo" | "data_inicio" | "url_reuniao"> | null;
  processo?: Pick<AnttProcessoColetado, "processo" | "interessado" | "relator" | "assunto" | "decisao"> | null;
}

export interface AnttCollectResponse {
  reunioes_encontradas: number;
  reunioes_salvas: number;
  processos_salvos: number;
  documentos_encontrados: number;
  documentos_baixados: number;
  documentos_duplicados: number;
  documentos_rejeitados: number;
  errors: string[];
}

export interface AnttPreviewDocumento {
  tipo: DocumentoColetadoTipo;
  titulo: string;
  url: string;
  processo: string | null;
  interessado: string | null;
  relator: string | null;
  assunto: string | null;
}

export interface AnttPreviewProcesso {
  item_numero: string | null;
  processo: string | null;
  interessado: string | null;
  relator: string | null;
  assunto: string | null;
  decisao: string | null;
  documentos: AnttPreviewDocumento[];
}

export interface AnttPreviewReuniao {
  numero: string;
  titulo: string;
  tipo: AnttReuniaoTipo;
  data_inicio: string | null;
  data_fim: string | null;
  hora_inicio: string | null;
  hora_fim: string | null;
  url_reuniao: string;
  documentos: AnttPreviewDocumento[];
  processos: AnttPreviewProcesso[];
}

export interface AnttPreviewResponse extends AnttCollectResponse {
  dry_run: true;
  source_url: string;
  max_pages: number;
  max_meetings: number;
  collected_at: string;
  reunioes: AnttPreviewReuniao[];
}

// ─── Associados / Documentos ──────────────────────────────────────────────

export type DocumentoAssociadoTipo = "relatorio_trimestral" | "boletim_mensal";
export type DocumentoReviewStatus = "rascunho" | "revisado" | "aprovado" | "arquivado";

export interface Associado {
  id: string;
  nome: string;
  setor: string;
  descricao: string | null;
  agencia_siglas: string[];
  ministerios: string[];
  ministerio_urls: string[];
  microtemas: string[];
  palavras_chave: string[];
  vp_nome: string | null;
  vp_cargo: string | null;
  vp_minibio: string | null;
  vp_foto_url: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface ListaTripliceItem {
  id: string;
  agencia_id: string | null;
  cargo: string;
  cargo_vaga?: string | null;
  candidatos?: string[] | Array<Record<string, unknown>>;
  status?: "em_analise" | "nomeado" | "arquivado";
  data_publicacao?: string | null;
  fonte?: string | null;
  observacoes?: string | null;
  etapa: "mapeamento" | "indicacao" | "sabatinado" | "aprovado" | "nomeado" | "arquivado";
  nome_candidato: string;
  fonte_url: string | null;
  fonte_tipo: string | null;
  confidence: number;
  review_status: ReviewStatus;
  data_evento: string | null;
  agencia?: { sigla: string; nome: string } | null;
}

export interface DocumentoAssociado {
  id: string;
  associado_id: string;
  tipo: DocumentoAssociadoTipo;
  periodo_inicio: string;
  periodo_fim: string;
  titulo: string;
  html: string;
  fontes: Array<{ tipo: string; titulo: string; url?: string | null }>;
  metricas?: DocumentoAssociadoPreview["metricas"];
  qualidade?: DocumentoQualidade;
  gerado_por?: "manual" | "agendamento" | string;
  agendamento_id?: string | null;
  status_revisao: DocumentoReviewStatus;
  versao: number;
  created_at: string;
  associado?: Pick<Associado, "nome" | "setor"> | null;
}

export interface DocumentoQualidade {
  score: number;
  status: "pronto" | "revisar" | "bloqueado";
  pendencias: string[];
}

export interface DocumentoAssociadoPreview {
  associado: Associado;
  tipo: DocumentoAssociadoTipo;
  periodo_inicio: string;
  periodo_fim: string;
  titulo: string;
  html: string;
  fontes: Array<{ tipo: string; titulo: string; url?: string | null }>;
  metricas: {
    deliberacoes: number;
    noticias: number;
    mandatos: number;
    lista_triplice: number;
    confianca_cenarios: number;
  };
  qualidade: DocumentoQualidade;
  documento_id?: string;
}

export interface AssociadoDocumentoAgendamento {
  id: string;
  associado_id: string;
  tipo: DocumentoAssociadoTipo;
  frequencia: "mensal" | "trimestral";
  dia_mes: number;
  destinatarios: string[];
  ativo: boolean;
  proximo_envio: string;
  ultimo_envio: string | null;
  secoes: string[];
  observacoes: string | null;
  created_at: string;
  updated_at: string;
  associado?: Pick<Associado, "nome" | "setor"> | null;
}

export interface DocumentoEnvio {
  id: string;
  documento_id: string;
  agendamento_id: string | null;
  destinatarios: string[];
  status: "pendente" | "enviado" | "erro" | "cancelado";
  provider: string | null;
  provider_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ─── Boletim ──────────────────────────────────────────────────────────────

export interface BoletimSchedule {
  id: string;
  frequencia: "semanal" | "quinzenal" | "mensal" | "personalizado";
  dia_semana?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  dia_mes?: number;
  proximo_envio: string;
  destinatarios: string[];
  secoes: string[];
  agencia_id: string | null;
  ativo: boolean;
  criado_em: string;
}

// ─── Governança ───────────────────────────────────────────────────────────

export interface GovernancaIndicadores {
  agencia_id: string;
  agencia_sigla: string;
  score: number;
  taxa_consenso: number;
  taxa_deferimento: number;
  qualidade_ia: number;
  taxa_sancao: number;
  cobertura_documental: number;
  periodo: string;
}
