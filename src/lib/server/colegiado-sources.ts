type SupabaseServerClient = ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>;

// Fontes oficiais das reunioes de diretoria colegiada (votos individuais dos diretores).
// Inicialmente ANTT, ANM e ARTESP, conforme os links fornecidos.
export const COLEGIADO_SOURCES = [
  {
    sigla: "ANTT",
    nome_completo: "Agencia Nacional de Transportes Terrestres",
    nome: "ANTT - Reunioes da Diretoria",
    url: "https://portal.antt.gov.br/web/guest/reunioes-da-diretoria",
    estrategia: "html-static",
  },
  {
    sigla: "ANM",
    nome_completo: "Agencia Nacional de Mineracao",
    nome: "ANM - Reunioes da Diretoria Colegiada",
    url: "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/reunioes-da-diretoria-colegiada",
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
      .select("id")
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
      seletor_links: "a[href]",
    };

    if (existing) {
      const { error } = await db.from("monitoramento_sites").update(shared).eq("id", existing.id);
      if (error) throw error;
      continue;
    }

    const { error } = await db.from("monitoramento_sites").insert({
      ...shared,
      url: source.url,
      metadata: {
        fonte_oficial: true,
        collector: "colegiado",
        escopo: "decisoes_colegiadas",
      },
    });
    if (error) throw error;
  }
}
