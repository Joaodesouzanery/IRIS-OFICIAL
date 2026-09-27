/**
 * As 12 agências reguladoras federais — fonte ÚNICA, sem dependência de servidor.
 *
 * ═══ Por que este arquivo existe (Fase 32) ═══
 * Esta lista morava dentro de `src/lib/server/qualidade-regulatoria.ts`. Isso funcionava enquanto só
 * o servidor a usava; com a landing page pública precisando das mesmas 12 (logo + link para o site
 * oficial), importar de `lib/server/` arrastaria código de servidor para o bundle caso algum
 * componente de cliente viesse a precisar dela.
 *
 * ⚠️ A saída NÃO foi copiar a lista. Foi MOVÊ-LA para cá e fazer `qualidade-regulatoria.ts`
 * importar daqui. Duas listas das mesmas 12 agências divergiriam no primeiro dia em que uma agência
 * mudasse de nome — e "duas implementações da mesma verdade" é o defeito que este projeto já pagou
 * várias vezes.
 *
 * ═══ ⚠️ O que estas 12 SÃO e o que NÃO são ═══
 * São as agências **federais** que o IRIS acompanha — o mesmo recorte do site institucional.
 *
 * NÃO são o conjunto que tem esteira de votos. Essa é `COLEGIADO_SIGLAS` = { ANTT, ANM, ARTESP },
 * e a ARTESP **é estadual** (São Paulo), logo nem aparece aqui. Confundir os dois recortes numa
 * página pública seria afirmar que monitoramos voto a voto em 12 agências quando são 3 — o defeito
 * que a Fase 31 inteira perseguiu, agora em forma de marketing.
 */

export interface AgenciaFederal {
  sigla: string;
  nome_completo: string;
  setor_regulado: string;
  ano_criacao: number;
  lei_criacao: string;
  site_oficial: string;
}

/** Ordem alfabética por sigla — a mesma em que a landing as apresenta. */
export const AGENCIAS_FEDERAIS: readonly AgenciaFederal[] = [
  { sigla: "ANA", nome_completo: "Agência Nacional de Águas e Saneamento Básico", setor_regulado: "Recursos hídricos e saneamento", ano_criacao: 2000, lei_criacao: "Lei 9.984/2000", site_oficial: "https://www.gov.br/ana" },
  { sigla: "ANAC", nome_completo: "Agência Nacional de Aviação Civil", setor_regulado: "Aviação civil", ano_criacao: 2005, lei_criacao: "Lei 11.182/2005", site_oficial: "https://www.gov.br/anac" },
  { sigla: "ANATEL", nome_completo: "Agência Nacional de Telecomunicações", setor_regulado: "Telecomunicações", ano_criacao: 1997, lei_criacao: "Lei 9.472/1997", site_oficial: "https://www.gov.br/anatel" },
  { sigla: "ANCINE", nome_completo: "Agência Nacional do Cinema", setor_regulado: "Setor cinematográfico e audiovisual", ano_criacao: 2001, lei_criacao: "MP 2.228-1/2001", site_oficial: "https://www.ancine.gov.br" },
  { sigla: "ANEEL", nome_completo: "Agência Nacional de Energia Elétrica", setor_regulado: "Energia elétrica", ano_criacao: 1996, lei_criacao: "Lei 9.427/1996", site_oficial: "https://www.gov.br/aneel" },
  { sigla: "ANM", nome_completo: "Agência Nacional de Mineração", setor_regulado: "Mineração", ano_criacao: 2017, lei_criacao: "Lei 13.575/2017", site_oficial: "https://www.gov.br/anm" },
  { sigla: "ANP", nome_completo: "Agência Nacional do Petróleo, Gás Natural e Biocombustíveis", setor_regulado: "Petróleo, gás natural e biocombustíveis", ano_criacao: 1997, lei_criacao: "Lei 9.478/1997", site_oficial: "https://www.gov.br/anp" },
  { sigla: "ANPD", nome_completo: "Agência Nacional de Proteção de Dados", setor_regulado: "Proteção de dados pessoais", ano_criacao: 2026, lei_criacao: "Lei 15.352/2026", site_oficial: "https://www.gov.br/anpd" },
  { sigla: "ANS", nome_completo: "Agência Nacional de Saúde Suplementar", setor_regulado: "Planos e seguros de saúde", ano_criacao: 2000, lei_criacao: "Lei 9.961/2000", site_oficial: "https://www.gov.br/ans" },
  { sigla: "ANTAQ", nome_completo: "Agência Nacional de Transportes Aquaviários", setor_regulado: "Transportes aquaviários e portos", ano_criacao: 2001, lei_criacao: "Lei 10.233/2001", site_oficial: "https://www.gov.br/antaq" },
  { sigla: "ANTT", nome_completo: "Agência Nacional de Transportes Terrestres", setor_regulado: "Transportes terrestres", ano_criacao: 2001, lei_criacao: "Lei 10.233/2001", site_oficial: "https://www.gov.br/antt" },
  { sigla: "ANVISA", nome_completo: "Agência Nacional de Vigilância Sanitária", setor_regulado: "Vigilância sanitária", ano_criacao: 1999, lei_criacao: "Lei 9.782/1999", site_oficial: "https://www.gov.br/anvisa" },
] as const;

/**
 * As agências cuja esteira de VOTOS está configurada — declarado aqui para a landing poder ser
 * honesta sem importar `lib/server/`.
 *
 * ⚠️ Espelha `COLEGIADO_SIGLAS` (`src/lib/server/colegiado-sources.ts`), e o `etapa188` cobra que
 * os dois conjuntos continuem iguais. Se divergirem, a página pública passaria a prometer cobertura
 * que a esteira não tem — que é exatamente o erro que não pode acontecer para fora.
 */
export const SIGLAS_COM_ESTEIRA_DE_VOTOS = ["ANTT", "ANM", "ARTESP"] as const;

/** ARTESP é estadual (SP) e por isso não está entre as 12 federais — mas TEM esteira de votos. */
export const SIGLAS_COM_VOTO_ENTRE_AS_FEDERAIS = AGENCIAS_FEDERAIS
  .filter((a) => (SIGLAS_COM_ESTEIRA_DE_VOTOS as readonly string[]).includes(a.sigla))
  .map((a) => a.sigla);
