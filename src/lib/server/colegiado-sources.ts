type SupabaseServerClient = ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>;

// Fontes oficiais das reunioes de diretoria colegiada (votos individuais dos diretores).
// Inicialmente ANTT, ANM e ARTESP, conforme os links fornecidos.
export const COLEGIADO_SOURCES = [
  {
    sigla: "ANTT",
    nome_completo: "Agencia Nacional de Transportes Terrestres",
    nome: "ANTT - Reunioes da Diretoria",
    url: "https://portal.antt.gov.br/web/guest/reunioes-da-diretoria",
    estrategia: "antt-2026",
  },
  {
    // A página-ÍNDICE (reunioes-da-diretoria-colegiada) só tem manuais no HTML estático; as ATAS
    // reais (sei_*_ata_85_*.pdf) ficam na sub-página atas-da-rop (VERIFICADO ao vivo 22/07/2026).
    // As pautas-da-rop/pautas/atas ficam no seed 20260518160356 e são coletadas junto (PR-L).
    sigla: "ANM",
    nome_completo: "Agencia Nacional de Mineracao",
    nome: "ANM - Atas da Diretoria Colegiada (ROP)",
    url: "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada/atas-da-rop",
    estrategia: "html-static",
  },
  {
    sigla: "ARTESP",
    nome_completo: "Agencia Reguladora de Servicos Publicos Delegados de Transporte do Estado de Sao Paulo",
    nome: "ARTESP - Reunioes da Diretoria",
    url: "https://www.artesp.sp.gov.br/artesp/transparencia/reunioes-diretoria",
    estrategia: "html-static",
  },
] as const;

export const COLEGIADO_SOURCE_URLS = COLEGIADO_SOURCES.map((source) => source.url);

// Siglas das agências cuja esteira de VOTOS está configurada. Fora desta lista a agência é
// escopo notícias/qualidade: não cria diretor, não infere voto, não entra na Completude de
// votos (QA ago/2026 — ANS/ANA apareciam com "diretores votando" por artefato de classificação).
export const COLEGIADO_SIGLAS = new Set<string>(COLEGIADO_SOURCES.map((s) => s.sigla));

/**
 * Garante que as agencias ANTT/ANM/ARTESP e suas fontes de reunioes colegiadas
 * estejam cadastradas em monitoramento_sites com auto-enfileiramento de PDFs ligado.
 * Reusa o pipeline de monitoramento + upload existente (que extrai votos e metricas).
 */
export async function ensureColegiadoSources(db: SupabaseServerClient) {
  const siglas = COLEGIADO_SOURCES.map((source) => source.sigla);
  const { data: existingAgencies, error: agencyReadError } = await db
    .from("agencias")
    .select("id, sigla")
    .in("sigla", siglas);
  if (agencyReadError) throw agencyReadError;

  const existingSiglas = new Set((existingAgencies ?? []).map((agency) => agency.sigla));
  const missingAgencies = COLEGIADO_SOURCES
    .filter((source) => !existingSiglas.has(source.sigla))
    .map((source) => ({
      sigla: source.sigla,
      nome: source.sigla,
      nome_completo: source.nome_completo,
      status: "ativa",
      ativo: true,
      metadata: { fonte_dado: "fonte_oficial", escopo_inicial: "deliberacoes" },
    }));

  if (missingAgencies.length > 0) {
    const { error } = await db.from("agencias").insert(missingAgencies);
    if (error) throw error;
  }

  const { data: agencies, error: allAgencyError } = await db
    .from("agencias")
    .select("id, sigla")
    .in("sigla", siglas);
  if (allAgencyError) throw allAgencyError;
  const agencyIds = new Map((agencies ?? []).map((agency) => [agency.sigla, agency.id]));

  for (const source of COLEGIADO_SOURCES) {
    const agenciaId = agencyIds.get(source.sigla) ?? null;
    const { data: existing, error: readError } = await db
      .from("monitoramento_sites")
      .select("id, seletor_links")
      .eq("url", source.url)
      .maybeSingle();
    if (readError) throw readError;

    const shared = {
      agencia_id: agenciaId,
      nome: source.nome,
      tipo_fonte: "documentos_regulatorios",
      auto_enfileirar_pdf: true,
      ativo: true,
      estrategia: source.estrategia,
    };

    if (existing) {
      // Preserva um seletor_links customizado pelo admin; só (re)define o default
      // quando ainda não há valor não-padrão.
      const hasCustom = existing.seletor_links && existing.seletor_links !== "a[href]";
      const updateValues = hasCustom ? shared : { ...shared, seletor_links: "a[href]" };
      const { error } = await db.from("monitoramento_sites").update(updateValues).eq("id", existing.id);
      if (error) throw error;
      continue;
    }

    const { error } = await db.from("monitoramento_sites").insert({
      ...shared,
      url: source.url,
      seletor_links: "a[href]",
      metadata: {
        fonte_oficial: true,
        collector: "colegiado",
        escopo: "decisoes_colegiadas",
      },
    });
    if (error) throw error;
  }
}
