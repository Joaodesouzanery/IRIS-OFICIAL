/**
 * O roster de mandato pode ser CONFERIDO contra o documento? (Fase 20)
 *
 * ═══ Por que existe ═══
 * Medido em produção: os diretores da ANM Roger Romão Cabral e Tasso Mendonça Júnior aparecem nos
 * documentos e em allow-list de nomes, mas **nenhuma migration lhes dá mandato verificado**. Na
 * 79ª ROP (26/11/2025) o preâmbulo da ata nomeia Mauro + Tasso + Roger + José Fernando, e
 * `getActiveDiretoresForVote` devolve Mauro + Caio Mário + José Fernando.
 *
 * Não é lacuna de cobertura — é **voto gravado no nome errado**. Numa plataforma de inteligência
 * regulatória isso é pior que não ter o voto: um número ausente se vê; um voto atribuído ao
 * diretor errado se propaga por todas as métricas parecendo legítimo.
 *
 * ═══ Por que TRÊS camadas ═══
 * O guard óbvio — comparar o preâmbulo com o roster — resolve a 79ª ROP e falha em SILÊNCIO nas
 * atas que não nomeiam ninguém, que é exatamente onde o mesmo erro sobreviveria sem ninguém ver.
 * A terceira camada não depende do documento: ela pergunta ao CORPUS se aquele cadastro está
 * completo. Roger e Tasso são, literalmente, `diretor_candidatos` pendentes.
 */

import { findBestMatch } from "@/lib/server/name-matcher";

/** O mesmo piso que o gate de voto usa para aceitar um nome como sendo de um diretor. */
const CONFIANCA_MINIMA = 0.85;

export interface DiretorDoRoster {
  id: string;
  nome: string;
  nome_variantes?: string[];
}

export type MotivoDoRoster =
  | "roster_confere_com_presenca"
  | "roster_confere_com_assinatura"
  | "roster_diverge_da_presenca"
  | "roster_diverge_da_assinatura"
  | "cadastro_incompleto"
  | "roster_vazio"
  | "roster_nao_conferivel";

export interface VereditoDoRoster {
  /** Pode inferir voto com este roster? */
  confiavel: boolean;
  motivo: MotivoDoRoster;
  /** Nomes que o documento traz e o cadastro não reconhece — é o que o operador precisa corrigir. */
  naoReconhecidos: string[];
}

function naoReconhecidos(nomes: string[], roster: DiretorDoRoster[]): string[] {
  // Mesma forma que o gate de voto usa — `findBestMatch` já compara nome principal, variantes
  // cadastradas E formas derivadas (name-matcher.ts:138), então grafia diferente não vira
  // divergência falsa.
  const candidatos = roster.map((d) => ({
    id: d.id,
    nome: d.nome,
    nome_variantes: Array.isArray(d.nome_variantes) ? d.nome_variantes : [],
  }));
  return nomes.filter((nome) => findBestMatch(nome, candidatos).score < CONFIANCA_MINIMA);
}

/**
 * Confere o roster contra o que o documento (e o corpus) sabem.
 *
 * A ordem das camadas é deliberada: quem estava na sala é o PREÂMBULO; a assinatura vem depois
 * (um diretor pode assinar ata de sessão em que não votou); e o sinal do corpus é o último,
 * porque é o mais indireto.
 */
export function conferirRoster(input: {
  roster: DiretorDoRoster[];
  nomesPresentes?: string[];
  signatarios?: string[];
  /** Quantos `diretor_candidatos` pendentes a agência tem na janela desta reunião. */
  candidatosPendentes?: number;
}): VereditoDoRoster {
  if (input.roster.length === 0) {
    return { confiavel: false, motivo: "roster_vazio", naoReconhecidos: [] };
  }

  // Camada 1 — a ata NOMEIA os presentes.
  const presentes = (input.nomesPresentes ?? []).filter(Boolean);
  if (presentes.length > 0) {
    const orfaos = naoReconhecidos(presentes, input.roster);
    return orfaos.length > 0
      ? { confiavel: false, motivo: "roster_diverge_da_presenca", naoReconhecidos: orfaos }
      : { confiavel: true, motivo: "roster_confere_com_presenca", naoReconhecidos: [] };
  }

  // Camada 2 — não nomeia, mas ASSINA. `signatarios` já é extraído (nlp-extractor.ts:989).
  const assinaram = (input.signatarios ?? []).filter(Boolean);
  if (assinaram.length > 0) {
    const orfaos = naoReconhecidos(assinaram, input.roster);
    return orfaos.length > 0
      ? { confiavel: false, motivo: "roster_diverge_da_assinatura", naoReconhecidos: orfaos }
      : { confiavel: true, motivo: "roster_confere_com_assinatura", naoReconhecidos: [] };
  }

  // Camada 3 — a ata é muda; pergunta ao CORPUS. Candidato pendente é um nome que os documentos
  // conhecem e o cadastro não: com ele em aberto, o roster daquela agência é sabidamente
  // incompleto, mesmo que ESTA ata não nomeie ninguém.
  if ((input.candidatosPendentes ?? 0) > 0) {
    return { confiavel: false, motivo: "cadastro_incompleto", naoReconhecidos: [] };
  }

  // O resíduo irredutível: sem nomes e sem candidato pendente, não há como conferir. Continua
  // inferindo — bloquear aqui mataria a ARTESP, que por desenho nunca nomina — mas o veredito
  // viaja para a proveniência, para quem lê a métrica saber que ninguém conferiu este roster.
  return { confiavel: true, motivo: "roster_nao_conferivel", naoReconhecidos: [] };
}
