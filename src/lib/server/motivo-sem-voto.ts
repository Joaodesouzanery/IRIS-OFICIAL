/**
 * POR QUE esta deliberação final não tem voto — um motivo, por `deliberacao_id` (Fase 31, Tarefa 4).
 *
 * ═══ O defeito ═══
 * O banner dizia "45 deliberação(ões) final(is) ainda sem voto" e, logo abaixo, quatro sub-motivos
 * que pareciam decompor as 45 — e não decompunham. Eles vêm de TRÊS populações diferentes:
 * `fora_da_janela_*` é estoque calculado sobre TODOS os candidatos e **subtraído antes de as 45
 * existirem** (`materializar-faltantes/route.ts:273` e `:289`); `roster_nao_conferivel` e
 * `sem_evidencia` são parciais do lote rotativo, recontados a cada reexame. Nenhum conjunto soma
 * 45, e nem deveria — mas a tela os justapunha como se somasse.
 *
 * E o motivo POR DELIBERAÇÃO era calculado, tipado e jogado fora: `route.ts:200` monta
 * `{deliberacao_id, motivo, nao_reconhecidos}`, trunca em 20, e o único consumidor
 * (`resumo-do-backfill.ts:72`) descarta o id e o motivo para ficar com cinco nomes.
 *
 * ⚠️ Este módulo não inventa vocabulário: ele REUSA `MotivoDoRoster` (`roster-conferivel.ts:32-39`)
 * e `MotivoForaDaJanela` (`janela-de-mandatos.ts:26`), que já existem e já são disciplinados.
 */

/**
 * As categorias, em PRECEDÊNCIA declarada e MUTUAMENTE EXCLUSIVAS.
 *
 * A ordem não é estética: ela decide o número que o usuário lê. Um item pode satisfazer várias
 * condições ao mesmo tempo (sem data E fora de escopo, por exemplo), e a categoria que vale é a
 * PRIMEIRA — a mais próxima da causa raiz, não a mais próxima do fim do laço.
 */
export const MOTIVOS_SEM_VOTO = [
  /** Não é decisão final: retirado de pauta, ou tipo que não gera voto. Nada a materializar. */
  "retirado_ou_nao_final",
  /** Agência sem colegiado — a deliberação não devia gerar voto nenhum. */
  "fora_de_escopo",
  /** A extração não achou a data. NÃO é fato de mandato: é falha de leitura. */
  "sem_data",
  /** Data conhecida, mas anterior ao primeiro mandato cadastrado. Fora do denominador. */
  "fora_da_janela_de_mandatos",
  /** A agência não tem diretor cadastrado para a data — não dá para saber quem votaria. */
  "roster_desconhecido",
  /**
   * ⚠️ O documento nomeia alguém que o cadastro não reconhece — INCLUSIVE o "Diretor" genérico
   * chegando como se fosse pessoa. Isso é EXTRAÇÃO INSUFICIENTE, não diretor desconhecido, e
   * confundir os dois mandaria alguém cadastrar uma pessoa que não existe.
   */
  "nome_nao_reconhecido",
  /** O texto tem sinal de contestação mas não nomeia ninguém: inferir fabricaria unanimidade. */
  "contestado_sem_nomes",
  /** Nem nome, nem unanimidade textual, nem sinal de decisão. Não há o que inferir. */
  "sem_evidencia_de_votacao",
  /** O payload não chegou (leitura truncada/erro). NÃO se classifica o que não se leu. */
  "falha_tecnica_de_leitura",
  /** Dá para materializar e a rodada ainda não chegou nela. É o único que some sozinho. */
  "materializavel_nao_processado",
] as const;

export type MotivoSemVoto = (typeof MOTIVOS_SEM_VOTO)[number];

/** O rótulo em pt-BR. A tela não reescreve a lista — ela traduz esta. */
export const ROTULO_DO_MOTIVO: Record<MotivoSemVoto, string> = {
  retirado_ou_nao_final: "retirado de pauta ou não-final",
  fora_de_escopo: "agência sem colegiado",
  sem_data: "sem data de reunião (falha de extração)",
  fora_da_janela_de_mandatos: "anterior ao 1º mandato conhecido",
  roster_desconhecido: "sem diretor cadastrado na data",
  nome_nao_reconhecido: "nome citado que o cadastro não reconhece",
  contestado_sem_nomes: "contestado, sem nomes para atribuir",
  sem_evidencia_de_votacao: "sem evidência de votação",
  falha_tecnica_de_leitura: "payload não lido nesta rodada",
  materializavel_nao_processado: "materializável, ainda não processado",
};

export interface EntradaDoMotivo {
  resultado: string | null;
  /** `false` quando a agência não é colegiada. */
  agenciaColegiada: boolean;
  dataReuniao: string | null;
  /** O que `foraDaJanelaDeMandatos` devolveu: `null` = dentro da janela. */
  motivoForaDaJanela: "anterior_ao_primeiro_mandato" | "sem_data_de_reuniao" | null;
  /** Quantos diretores o cadastro tem para a agência. */
  diretoresNoCadastro: number;
  /** O veredito de `conferirRoster`: `null` = confiável. */
  motivoDoRoster: string | null;
  /** Nomes citados no documento que não casaram com o cadastro. */
  naoReconhecidos: string[];
  /** O texto tem sinal de contestação medido? */
  contestado: boolean;
  /** Quantas linhas de voto `buildVotoRows` conseguiu construir. */
  linhasConstruidas: number;
  /** O payload pesado (`raw_extraction`) chegou? */
  payloadChegou: boolean;
}

/**
 * O motivo, ou `null` quando a deliberação NÃO está sem voto (ela materializou).
 *
 * ⚠️ `falha_tecnica_de_leitura` vem cedo, logo depois das condições que não dependem do payload:
 * classificar sem ter lido o documento é exatamente o erro que quase fez a Fase 28 inferir voto
 * para um colegiado inteiro — `raw_extraction` ausente lido como "ninguém nomeado, nada contestado".
 */
export function motivoSemVoto(e: EntradaDoMotivo): MotivoSemVoto | null {
  if (!e.resultado || e.resultado === "Retirado de Pauta") return "retirado_ou_nao_final";
  if (!e.agenciaColegiada) return "fora_de_escopo";
  // Estes dois vêm da partição, que roda ANTES de qualquer leitura de payload.
  if (e.motivoForaDaJanela === "sem_data_de_reuniao" || !e.dataReuniao) return "sem_data";
  if (e.motivoForaDaJanela === "anterior_ao_primeiro_mandato") return "fora_da_janela_de_mandatos";
  if (!e.payloadChegou) return "falha_tecnica_de_leitura";
  if (e.diretoresNoCadastro <= 0) return "roster_desconhecido";
  if (e.motivoDoRoster) {
    // ⚠️ Roster não conferível tem duas causas MUITO diferentes, e achatá-las mandaria alguém
    // cadastrar uma pessoa inexistente: nome citado que não casa é falha de EXTRAÇÃO (inclusive o
    // "Diretor" genérico); sem nome citado, é o cadastro que está incompleto.
    return e.naoReconhecidos.length > 0 ? "nome_nao_reconhecido" : "roster_desconhecido";
  }
  if (e.linhasConstruidas > 0) return null; // materializou: não está sem voto
  if (e.contestado) return "contestado_sem_nomes";
  return "sem_evidencia_de_votacao";
}

/** Conta por motivo, para o banner. Motivo ausente vira zero explícito, não some da lista. */
export function contarPorMotivo(motivos: Iterable<MotivoSemVoto>): Record<MotivoSemVoto, number> {
  const out = Object.fromEntries(MOTIVOS_SEM_VOTO.map((m) => [m, 0])) as Record<MotivoSemVoto, number>;
  for (const m of motivos) out[m] = (out[m] ?? 0) + 1;
  return out;
}

/**
 * A frase do banner: os motivos que TÊM ocorrência, do maior para o menor.
 *
 * ⚠️ Zero é omitido do TEXTO mas não do dado — a contagem completa vai na resposta. Listar dez
 * motivos com oito zeros esconderia os dois que importam.
 */
export function frasePorMotivo(contagem: Record<string, number>): string | null {
  const comOcorrencia = MOTIVOS_SEM_VOTO
    .map((m) => [m, contagem[m] ?? 0] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (comOcorrencia.length === 0) return null;
  const total = comOcorrencia.reduce((s, [, n]) => s + n, 0);
  return `${total} sem voto, por motivo: ` +
    comOcorrencia.map(([m, n]) => `${n} ${ROTULO_DO_MOTIVO[m]}`).join(" · ");
}
