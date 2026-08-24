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

// ─── Etapa 61: capacidade NOMINAL por (órgão, tipo de documento) ─────────────
/**
 * O instrumento publica o voto de cada diretor NOMINALMENTE?
 *
 * Isto não é uma propriedade da agência, é do INSTRUMENTO — foi o erro que a revisão cruzada
 * pegou. A ata da ANTT nunca nomina voto ("a Diretoria Colegiada, por unanimidade, anuiu"), mas o
 * DOCUMENTO DE VOTO da ANTT é, por construção, o voto de um diretor. Um booleano por agência
 * rotularia esses votos na tela como "a ANTT não publica voto individual" — enquanto a esteira os
 * processa.
 *
 * Serve para a UI dizer a coisa CERTA quando um diretor aparece sem base nominal:
 *   · `nenhum`  → "a ata deste órgão não nomina voto" (limite da FONTE, não do nosso dado);
 *   · `parcial` → "nomina só em dissenso/vista/impedimento" (ANM);
 *   · `sempre`  → "cada documento é o voto de um diretor" (voto individual da ANTT).
 * Sem essa distinção, a tela de comportamento nasce vazia em 2 das 3 agências e o usuário lê isso
 * como falha do sistema.
 */
export type CapacidadeNominal = "sempre" | "parcial" | "nenhum";

const CAPACIDADE_NOMINAL: Record<string, CapacidadeNominal> = {
  // ANM: a ata nomina quando há dissenso, vista, impedimento ou empate — medido em ~7% dos itens.
  "ANM|ata": "parcial",
  "ANM|deliberacao": "parcial",
  // ANTT: a ata registra a decisão do colegiado, nunca o voto de cada um.
  "ANTT|ata": "nenhum",
  "ANTT|deliberacao": "nenhum",
  // …mas o documento de VOTO é o voto de UM diretor. É a linha que o booleano por agência perdia.
  "ANTT|voto_individual": "sempre",
  // ARTESP: "Houve aprovação dos presentes por unanimidade de votos" — sem nomes.
  "ARTESP|ata": "nenhum",
  "ARTESP|deliberacao": "nenhum",
};

export function capacidadeNominal(
  agenciaSigla: string | null | undefined,
  tipoDocumento: string | null | undefined,
): CapacidadeNominal {
  if (!agenciaSigla) return "parcial"; // desconhecido: não afirma limite que não medimos
  const chave = `${agenciaSigla}|${tipoDocumento ?? "ata"}`;
  return CAPACIDADE_NOMINAL[chave] ?? "parcial";
}

/** Frase pronta para a UI — o texto é parte da correção, não enfeite. */
export function explicacaoCapacidadeNominal(
  agenciaSigla: string | null | undefined,
  tipoDocumento: string | null | undefined,
): string | null {
  switch (capacidadeNominal(agenciaSigla, tipoDocumento)) {
    case "nenhum":
      return agenciaSigla === "ANTT"
        ? "A ata da ANTT não nomina voto por diretor; os votos nominais vêm dos documentos de Voto, ingeridos à parte."
        : `A ata da ${agenciaSigla} registra a decisão do colegiado sem nominar o voto de cada diretor.`;
    case "parcial":
      return `A ata da ${agenciaSigla} nomina voto apenas em dissenso, vista, impedimento ou empate.`;
    default:
      return null;
  }
}
