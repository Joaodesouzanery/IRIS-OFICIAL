import { calcularMandato } from "@/lib/mandatos";

export interface CuratedDiretorInput {
  nome: string;
  cargo: string;
  situacao: "titular" | "substituto" | "interino" | "inativo" | "designado";
  data_posse: string | null;
  data_fim_mandato: string | null;
  ato_nomeacao?: string | null;
  publicacao_dou?: string | null;
  minibio?: string | null;
  fonte_url?: string | null;
}

export interface CuratedListaTripliceInput {
  cargo_vaga: string;
  candidatos: Array<{ nome: string; situacao?: string }>;
  status: "em_analise" | "nomeado" | "arquivado";
  fonte: string;
  observacoes: string;
}

export interface CuratedAgenciaImport {
  sigla: string;
  nome: string;
  nome_completo: string;
  tipo: "federal" | "estadual";
  esfera: string;
  ministerio_vinculado: string;
  url_institucional: string;
  url_diretores: string;
  estado: string | null;
  alertas: string[];
  diretores: CuratedDiretorInput[];
  lista_triplice: CuratedListaTripliceInput[];
  fontes: string[];
}

const CURATED_IMPORTS: Record<string, CuratedAgenciaImport> = {
  ANTT: {
    sigla: "ANTT",
    nome: "ANTT",
    nome_completo: "Agência Nacional de Transportes Terrestres",
    tipo: "federal",
    esfera: "Transportes",
    ministerio_vinculado: "Ministério dos Transportes",
    url_institucional: "https://www.gov.br/antt",
    url_diretores: "https://www.gov.br/antt/pt-br/acesso-a-informacao/servidores/diretores",
    estado: null,
    alertas: ["Vaga permanente nº 5 ainda não nomeada pelo Presidente; Alessandro Baumgartner consta como diretor designado."],
    fontes: [
      "https://www.gov.br/antt/pt-br/acesso-a-informacao/servidores/diretores",
      "https://www.gov.br/antt/pt-br/composicao/diretoria-colegiada/quem-e-quem",
    ],
    diretores: [
      {
        nome: "Guilherme Theo Rodrigues da Rocha Sampaio",
        cargo: "Diretor-Geral",
        situacao: "titular",
        data_posse: "2025-08-29",
        data_fim_mandato: "2030-02-18",
        ato_nomeacao: "Decreto de 28/08/2025",
        publicacao_dou: "2025-08-29",
        fonte_url: "https://www.gov.br/antt/pt-br/acesso-a-informacao/servidores/diretores",
      },
      {
        nome: "Lucas Asfor Rocha Lima",
        cargo: "Diretor",
        situacao: "titular",
        data_posse: "2023-02-20",
        data_fim_mandato: "2028-02-18",
        ato_nomeacao: "Decreto de 06/12/2022",
        publicacao_dou: "2022-12-07",
        fonte_url: "https://www.gov.br/antt/pt-br/composicao/diretoria-colegiada/Lucas-Asfor-Rocha-Lima",
      },
      {
        nome: "Felipe Fernandes Queiroz",
        cargo: "Diretor",
        situacao: "titular",
        data_posse: "2022-12-23",
        data_fim_mandato: "2027-02-18",
        ato_nomeacao: "Decreto de 06/12/2022",
        publicacao_dou: "2022-12-07",
        fonte_url: "https://www.gov.br/antt/pt-br/acesso-a-informacao/servidores/diretores",
      },
      {
        nome: "Alex Antonio de Azevedo Cruz",
        cargo: "Diretor",
        situacao: "titular",
        data_posse: "2025-08-29",
        data_fim_mandato: "2030-02-18",
        ato_nomeacao: "Decreto de 28/08/2025",
        publicacao_dou: "2025-08-29",
        fonte_url: "https://www.gov.br/antt/pt-br/acesso-a-informacao/servidores/diretores",
      },
      {
        nome: "Alessandro Baumgartner",
        cargo: "Diretor",
        situacao: "designado",
        data_posse: "2026-02-23",
        data_fim_mandato: null,
        ato_nomeacao: "Portaria DG nº 35, de 20/02/2026",
        publicacao_dou: "2026-02-23",
        fonte_url: "https://www.gov.br/antt/pt-br/acesso-a-informacao/servidores/diretores",
      },
    ],
    lista_triplice: [
      {
        cargo_vaga: "Diretor Vaga 5",
        candidatos: [],
        status: "em_analise",
        fonte: "Curadoria IRIS com fonte oficial ANTT",
        observacoes: "Não há lista tríplice pública vigente para nomeação permanente. O processo federal é indicação presidencial e aprovação pelo Senado. Lista tríplice é usada para substitutos interinos.",
      },
    ],
  },
  ANM: {
    sigla: "ANM",
    nome: "ANM",
    nome_completo: "Agência Nacional de Mineração",
    tipo: "federal",
    esfera: "Mineração",
    ministerio_vinculado: "Ministério de Minas e Energia",
    url_institucional: "https://www.gov.br/anm",
    url_diretores: "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada",
    estado: null,
    alertas: ["Dois diretores substitutos vencem em junho de 2026; Diretor-Geral e Caio vencem em dezembro de 2026."],
    fontes: [
      "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada",
      "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/mauro-henrique-moreira-sousa",
      "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/caio-mario-trivellato-seabra-filho",
    ],
    diretores: [
      {
        nome: "Mauro Henrique Moreira Sousa",
        cargo: "Diretor-Geral",
        situacao: "titular",
        data_posse: "2022-12-05",
        data_fim_mandato: "2026-12-04",
        fonte_url: "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/mauro-henrique-moreira-sousa",
      },
      {
        nome: "Caio Mário Trivellato Seabra Filho",
        cargo: "Diretor",
        situacao: "titular",
        data_posse: "2023-12-27",
        data_fim_mandato: "2026-12-04",
        fonte_url: "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada/caio-mario-trivellato-seabra-filho",
      },
      {
        nome: "José Fernando Gomes Júnior",
        cargo: "Diretor",
        situacao: "titular",
        data_posse: "2025-09-01",
        data_fim_mandato: "2028-12-04",
        fonte_url: "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada",
      },
      {
        nome: "Luiz Paniago Neves",
        cargo: "Diretor Substituto",
        situacao: "interino",
        data_posse: "2025-12-05",
        data_fim_mandato: "2026-06-02",
        fonte_url: "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada",
      },
      {
        nome: "Fábio Fernando Borges",
        cargo: "Diretor Substituto",
        situacao: "interino",
        data_posse: "2025-12-05",
        data_fim_mandato: "2026-06-02",
        fonte_url: "https://www.gov.br/anm/pt-br/composicao/diretoria-colegiada",
      },
    ],
    lista_triplice: [
      {
        cargo_vaga: "Diretores substitutos",
        candidatos: [{ nome: "Luiz Paniago Neves" }, { nome: "Fábio Fernando Borges" }],
        status: "em_analise",
        fonte: "Curadoria IRIS com fonte oficial ANM",
        observacoes: "Paniago e Borges constam como substitutos em lista interna para cobrir vagas; vagas permanentes dependem de indicação presidencial.",
      },
    ],
  },
  ARTESP: {
    sigla: "ARTESP",
    nome: "ARTESP",
    nome_completo: "Agência de Transporte do Estado de São Paulo",
    tipo: "estadual",
    esfera: "Transportes",
    ministerio_vinculado: "Governo do Estado de São Paulo",
    url_institucional: "https://www.artesp.sp.gov.br",
    url_diretores: "https://www.artesp.sp.gov.br/artesp/institucional/relacao-de-autoridades",
    estado: "SP",
    alertas: ["Quinta cadeira vaga; datas exatas de Fernanda Esbízaro Rodrigues Rudnik ainda exigem confirmação no DOE-SP."],
    fontes: [
      "https://www.artesp.sp.gov.br/artesp/institucional/relacao-de-autoridades",
      "https://www.al.sp.gov.br/",
    ],
    diretores: [
      {
        nome: "André Isper Rodrigues Barnabé",
        cargo: "Diretor-Presidente",
        situacao: "titular",
        data_posse: "2024-10-07",
        data_fim_mandato: "2029-06-30",
        ato_nomeacao: "Decreto publicado no DOE-SP em 07/10/2024",
        fonte_url: "https://www.artesp.sp.gov.br/artesp/institucional/relacao-de-autoridades",
      },
      {
        nome: "Diego Albert Zanatto",
        cargo: "Diretor de Controle Econômico e Financeiro",
        situacao: "titular",
        data_posse: "2024-10-07",
        data_fim_mandato: "2030-06-30",
        ato_nomeacao: "Decreto publicado no DOE-SP em 07/10/2024",
        fonte_url: "https://www.artesp.sp.gov.br/artesp/institucional/relacao-de-autoridades",
      },
      {
        nome: "Raquel França Carneiro",
        cargo: "Diretora de Investimentos",
        situacao: "titular",
        data_posse: "2025-05-14",
        data_fim_mandato: "2029-05-14",
        ato_nomeacao: "Aprovada pela ALESP em 14/05/2025; mandato de 4 anos",
        fonte_url: "https://www.artesp.sp.gov.br/artesp/institucional/relacao-de-autoridades",
      },
      {
        nome: "Fernanda Esbízaro Rodrigues Rudnik",
        cargo: "Diretora",
        situacao: "titular",
        data_posse: null,
        data_fim_mandato: null,
        ato_nomeacao: "Datas exatas pendentes de confirmação no DOE-SP",
        fonte_url: "https://www.artesp.sp.gov.br/artesp/institucional/relacao-de-autoridades",
      },
    ],
    lista_triplice: [
      {
        cargo_vaga: "Conselho Diretor - 5ª cadeira",
        candidatos: [],
        status: "em_analise",
        fonte: "Curadoria IRIS com fonte oficial ARTESP/ALESP",
        observacoes: "Não existe lista tríplice. Processo estadual: Governador indica e ALESP aprova. Quinta cadeira está vaga.",
      },
    ],
  },
};

export function getCuratedAgenciaImport(sigla: string | null | undefined) {
  if (!sigla) return null;
  return CURATED_IMPORTS[sigla.trim().toUpperCase()] ?? null;
}

export function mandatoPercentual(dataPosse: string | null, dataFim: string | null) {
  return calcularMandato(dataPosse, dataFim).percentualConcluido;
}
