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

/**
 * A fonte NOMINA votos? (Fase 13 — a camada que faltava.)
 *
 * `capacidadeNominal` sempre soube que ARTESP|deliberacao = "nenhum" ("Houve aprovação dos
 * presentes por unanimidade de votos" — sem nomes), mas NINGUÉM consumia isso no caminho do
 * voto. O resultado em produção: cabeçalhos de tabela ("Função Confiança Quantidadenível")
 * extraídos como "nomes de votação", promovidos a diretores e gravados como os ÚNICOS votos
 * nominais da agência.
 *
 * Fonte com capacidade "nenhum": nomes extraídos não viram voto nominal, não geram candidato de
 * diretor e não criam pessoa nova. A inferência por presença/mandato CONTINUA — é ela que dá os
 * votos verdadeiros. "parcial" e "sempre" seguem nominando (a ANM nomina em dissenso).
 */
export function fonteNominaVotos(
  agenciaSigla: string | null | undefined,
  tipoDocumento: string | null | undefined,
): boolean {
  return capacidadeNominal(agenciaSigla, tipoDocumento) !== "nenhum";
}

export function capacidadeNominal(
  agenciaSigla: string | null | undefined,
  tipoDocumento: string | null | undefined,
): CapacidadeNominal {
  if (!agenciaSigla) return "parcial"; // desconhecido: não afirma limite que não medimos
  const chave = `${agenciaSigla}|${tipoDocumento ?? "ata"}`;
  return CAPACIDADE_NOMINAL[chave] ?? "parcial";
}

// ─── Etapa 67: capacidade por EIXO — a matriz que finalmente tem leitor ──────
/**
 * O booleano "publica voto nominal?" era grosseiro demais, e a matriz por (órgão, documento)
 * acima nunca ganhou um consumidor — ficou código morto desde a etapa61. O corte certo é por
 * EIXO DE MÉTRICA: só a linha do dissenso é escassa; presença, relatoria e mérito são densos em
 * todas as agências. É esta tabela que a UI usa para dizer, ao lado de cada família de métrica,
 * qual é o limite DA FONTE — em vez do aviso genérico "base nominal X%".
 *
 *   · `nominal` — o documento nomeia; cobertura estrutural de ~100%;
 *   · `parcial` — nomeia só em parte dos casos (dissenso da ANM ~7%; procedência DIR-* da ARTESP);
 *   · `nenhum`  — a fonte não publica; o eixo depende de outra via (ex.: dissenso ANTT ← voto
 *                 individual, ingerido à parte).
 */
export type EixoMetrica = "presenca" | "relatoria" | "merito" | "impedimento" | "dissenso";

export const CAPACIDADE_POR_EIXO: Record<EixoMetrica, Record<string, CapacidadeNominal>> = {
  // Quem estava na sessão. ANM/ANTT: roster narrativo/lista; ARTESP: assinatura eletrônica.
  presenca: { ANM: "nominal" as CapacidadeNominal, ANTT: "nominal" as CapacidadeNominal, ARTESP: "parcial" as CapacidadeNominal },
  // O eixo denso que ninguém usava: ANM pelo bloco de relator, ANTT pela sigla do voto,
  // ARTESP parcial (procedência DIR-* nomeia diretoria, não pessoa).
  relatoria: { ANM: "nominal" as CapacidadeNominal, ANTT: "nominal" as CapacidadeNominal, ARTESP: "parcial" as CapacidadeNominal },
  // O sentido endossado é LITERAL no dispositivo, nas três.
  merito: { ANM: "nominal" as CapacidadeNominal, ANTT: "nominal" as CapacidadeNominal, ARTESP: "nominal" as CapacidadeNominal },
  // Só a ANM declara impedimento na ata (medido no corpus; nas outras não foi observado).
  impedimento: { ANM: "nominal" as CapacidadeNominal, ANTT: "nenhum" as CapacidadeNominal, ARTESP: "nenhum" as CapacidadeNominal },
  // A linha escassa — a única. ANM ~7%; ANTT 0% na ata mas nominal no documento de voto.
  dissenso: { ANM: "parcial" as CapacidadeNominal, ANTT: "parcial" as CapacidadeNominal, ARTESP: "nenhum" as CapacidadeNominal },
};

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


// ─── Fase 9: ano de criação da agência, e o guard de data implausível ────────
/**
 * Ano em que cada agência colegiada foi criada. Existe porque uma deliberação datada de ANTES da
 * agência existir é um erro de parse, não um dado — e até agora nada no projeto sabia disso.
 *
 * Medido em produção: 38 deliberações da ANM com data anterior a 2017 (32 delas em 1996). Os anos
 * batem, um a um, com LEIS citadas no preâmbulo dos próprios atos — a data vinha de
 * "Lei nº 9.314, de 14 de novembro de 1996".
 *
 * ⚠️ Por que um mapa NOVO, e não `QUALIDADE_AGENCIAS` (que já tem `ano_criacao`): aquela lista é
 * de agências FEDERAIS e a ARTESP é estadual. Acrescentá-la lá a faria aparecer na tela de
 * Qualidade com notas 35 FABRICADAS em todos os critérios — exatamente a classe de número
 * inventado que o projeto combate. Aqui o escopo é o colegiado, e o único uso é validar data.
 */
export const ANO_CRIACAO_AGENCIA: Record<string, number> = {
  ANTT: 2001,   // Lei 10.233/2001
  ANM: 2017,    // Lei 13.575/2017 (sucedeu o DNPM)
  ARTESP: 2002, // Lei Complementar Estadual SP 914/2002
};

/**
 * A data da reunião é PLAUSÍVEL para esta agência?
 *
 * Conservador de propósito: sigla desconhecida ou data ausente NÃO reprovam. O piso é o ano de
 * criação — nunca uma janela arbitrária —, e o teto é o futuro, porque uma reunião que ainda não
 * aconteceu também é sinal de parse errado (data de vigência, prazo de recurso).
 */
export function dataReuniaoPlausivel(
  siglaAgencia: string | null | undefined,
  dataIso: string | null | undefined,
  agora = new Date(),
): { plausivel: true } | { plausivel: false; motivo: string } {
  if (!dataIso || !siglaAgencia) return { plausivel: true };
  const ano = Number(dataIso.slice(0, 4));
  if (!Number.isFinite(ano)) return { plausivel: true };

  const criacao = ANO_CRIACAO_AGENCIA[siglaAgencia.toUpperCase()];
  if (criacao && ano < criacao) {
    return {
      plausivel: false,
      motivo: `a ${siglaAgencia} foi criada em ${criacao}; uma reunião datada de ${ano} não existe — a data provavelmente veio de uma lei ou processo citado no texto`,
    };
  }
  // Um ano à frente cobre publicação antecipada de calendário sem aceitar data de vigência futura.
  const tetoAno = agora.getFullYear() + 1;
  if (ano > tetoAno) {
    return { plausivel: false, motivo: `data no futuro (${ano}) — o limite aceito é ${tetoAno}` };
  }
  return { plausivel: true };
}
