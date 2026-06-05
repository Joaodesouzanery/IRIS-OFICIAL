type SupabaseServerClient = ReturnType<typeof import("@/lib/supabase/server").createSupabaseServerClient>;

const FEDERAL_AGENCIES = [
  ["ANA", "Agencia Nacional de Aguas e Saneamento Basico", "Recursos Hidricos", "Ministerio da Integracao e do Desenvolvimento Regional", "https://www.gov.br/ana"],
  ["ANAC", "Agencia Nacional de Aviacao Civil", "Aviacao Civil", "Ministerio de Portos e Aeroportos", "https://www.gov.br/anac"],
  ["ANATEL", "Agencia Nacional de Telecomunicacoes", "Telecomunicacoes", "Ministerio das Comunicacoes", "https://www.gov.br/anatel"],
  ["ANCINE", "Agencia Nacional do Cinema", "Audiovisual", "Ministerio da Cultura", "https://www.gov.br/ancine"],
  ["ANEEL", "Agencia Nacional de Energia Eletrica", "Energia Eletrica", "Ministerio de Minas e Energia", "https://www.gov.br/aneel"],
  ["ANP", "Agencia Nacional do Petroleo, Gas Natural e Biocombustiveis", "Petroleo, Gas e Biocombustiveis", "Ministerio de Minas e Energia", "https://www.gov.br/anp"],
  ["ANPD", "Agencia Nacional de Protecao de Dados", "Protecao de Dados", "Ministerio da Justica e Seguranca Publica", "https://www.gov.br/anpd"],
  ["ANS", "Agencia Nacional de Saude Suplementar", "Saude Suplementar", "Ministerio da Saude", "https://www.gov.br/ans"],
  ["ANTAQ", "Agencia Nacional de Transportes Aquaviarios", "Transportes Aquaviarios", "Ministerio de Portos e Aeroportos", "https://www.gov.br/antaq"],
  ["ANVISA", "Agencia Nacional de Vigilancia Sanitaria", "Vigilancia Sanitaria", "Ministerio da Saude", "https://www.gov.br/anvisa"],
] as const;

const NEWS_SOURCES = [
  ["ARTESP", "ARTESP - Noticias", "https://www.artesp.sp.gov.br/artesp/noticias", "html-static"],
  ["ANTT", "ANTT - Ultimas Noticias", "https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias", "govbr-news"],
  ["ANM", "ANM - Noticias", "https://www.gov.br/anm/pt-br/assuntos/noticias", "govbr-news"],
  ["ANA", "ANA - Noticias", "https://www.gov.br/ana/pt-br/assuntos/noticias-e-eventos/noticias", "govbr-news"],
  ["ANAC", "ANAC - Noticias", "https://www.gov.br/anac/pt-br/noticias", "govbr-news"],
  ["ANATEL", "ANATEL - Noticias", "https://www.gov.br/anatel/pt-br/assuntos/noticias", "govbr-news"],
  ["ANCINE", "ANCINE - Noticias", "https://www.gov.br/ancine/pt-br/assuntos/noticias", "govbr-news"],
  ["ANEEL", "ANEEL - Noticias", "https://www.gov.br/aneel/pt-br/assuntos/noticias", "govbr-news"],
  ["ANP", "ANP - Noticias e comunicados", "https://www.gov.br/anp/pt-br/canais_atendimento/imprensa/noticias-comunicados", "govbr-news"],
  ["ANPD", "ANPD - Noticias", "https://www.gov.br/anpd/pt-br/assuntos/noticias", "govbr-news"],
  ["ANS", "ANS - Noticias", "https://www.gov.br/ans/pt-br/assuntos/noticias", "govbr-news"],
  ["ANTAQ", "ANTAQ - Noticias", "https://www.gov.br/antaq/pt-br/noticias", "govbr-news"],
  ["ANVISA", "ANVISA - Noticias", "https://www.gov.br/anvisa/pt-br/assuntos/noticias-anvisa", "govbr-news"],
] as const;

type NewsTier = "core" | "expanded";

const CORE_NEWS_AGENCIES = new Set(["ARTESP", "ANTT", "ANM"]);

export async function ensureFederalNewsSources(db: SupabaseServerClient) {
  const { data: existingAgencies, error: agencyReadError } = await db
    .from("agencias")
    .select("id, sigla")
    .in("sigla", FEDERAL_AGENCIES.map(([sigla]) => sigla));
  if (agencyReadError) throw agencyReadError;

  const existingSiglas = new Set((existingAgencies ?? []).map((agency) => agency.sigla));
  const missingAgencies = FEDERAL_AGENCIES
    .filter(([sigla]) => !existingSiglas.has(sigla))
    .map(([sigla, fullName, esfera, ministry, institutionalUrl]) => ({
      sigla,
      nome: sigla,
      nome_completo: fullName,
      tipo: "federal",
      esfera,
      ministerio_vinculado: ministry,
      url_institucional: institutionalUrl,
      status: "ativa",
      ativo: true,
      dados_importados_em: new Date().toISOString(),
      metadata: { fonte_dado: "fonte_oficial", escopo_inicial: "noticias" },
    }));

  if (missingAgencies.length > 0) {
    const { error } = await db.from("agencias").insert(missingAgencies);
    if (error) throw error;
  }

  const { data: agencies, error: allAgencyError } = await db
    .from("agencias")
    .select("id, sigla")
    .in("sigla", NEWS_SOURCES.map(([sigla]) => sigla));
  if (allAgencyError) throw allAgencyError;
  const agencyIds = new Map((agencies ?? []).map((agency) => [agency.sigla, agency.id]));

  for (const [sigla, nome, sourceUrl, strategy] of NEWS_SOURCES) {
    const agenciaId = agencyIds.get(sigla);
    if (!agenciaId) continue;
    const newsTier = getNewsTier(sigla);
    const newsProfile = getNewsProfile(sigla);
    const { data: existing, error: sourceReadError } = await db
      .from("monitoramento_sites")
      .select("id, metadata")
      .eq("url", sourceUrl)
      .maybeSingle();
    if (sourceReadError) throw sourceReadError;

    const sharedValues = {
      agencia_id: agenciaId,
      nome,
      tipo_fonte: "noticias",
      auto_enfileirar_pdf: false,
      ativo: true,
    };
    if (existing) {
      const metadata = isRecord(existing.metadata) ? existing.metadata : {};
      const initialValues = {
        ...sharedValues,
        metadata: {
          ...metadata,
          fonte_oficial: true,
          collector: "noticias",
          news_module_configured: true,
          news_tier: newsTier,
          news_profile: newsProfile,
        },
      };
      const updateValues = sigla === "ARTESP" ? initialValues : { ...initialValues, estrategia: strategy };
      const { error } = await db.from("monitoramento_sites").update(updateValues).eq("id", existing.id);
      if (error) throw error;
      continue;
    }

    const { error } = await db.from("monitoramento_sites").insert({
      ...sharedValues,
      url: sourceUrl,
      estrategia: strategy,
      seletor_links: "a[href]",
      metadata: {
        fonte_oficial: true,
        collector: "noticias",
        news_module_configured: true,
        news_tier: newsTier,
        news_profile: newsProfile,
      },
    });
    if (error) throw error;
  }
}

export function getNewsTier(sigla: string): NewsTier {
  return CORE_NEWS_AGENCIES.has(sigla.toUpperCase()) ? "core" : "expanded";
}

export function getNewsProfile(sigla: string) {
  if (sigla.toUpperCase() === "ARTESP") return "artesp";
  return getNewsTier(sigla) === "core" ? "govbr-core" : "govbr-expanded";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
