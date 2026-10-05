/**
 * CERTIFICAÇÃO contra o gabarito contado à mão — e a SIMULAÇÃO que a precede.
 *
 * ═══ Por que são DUAS funções, e não uma ═══
 * O portão do revoto não pode ser "o banco bate com o gabarito": é justamente o revoto que faz bater.
 * Exigir isso antes seria um portão circular — ele nunca abriria.
 *
 *  · `simularColegiadoNaDataCerta` roda ANTES de escrever: pega o roster que o motor USARIA na data
 *    certa (em memória, sem tocar no banco) e pergunta se ele reproduz o colegiado do gabarito. É o
 *    PORTÃO — se a simulação não reproduz, corrigir a data e refazer o voto produziria outro erro.
 *  · `certificarContraGabarito` roda DEPOIS de aplicar: compara o que está no banco com o gabarito.
 *    É a VERIFICAÇÃO, e é ela que preenche `certificacao_no_banco`, hoje um zero fixo com
 *    `pendente: true` no placar.
 *
 * ═══ O gabarito é internamente consistente, e isso é exercitável ═══
 * `votos = itens_decididos − impedido_em.length` vale nas cinco atas (81ª: 64 − 1 = 63; 83ª Fábio:
 * 49 − 2 = 47; José Fernando: 49 − 5 = 44). A contagem de ITENS é outra: `itens_decididos +
 * itens_sem_decisao` (81ª = 68, 83ª = 55), porque "Retirado de Pauta" vira linha no banco e não gera
 * voto.
 *
 * ⚠️ O módulo é PURO e recebe o gabarito por parâmetro. Ele não lê arquivo, não consulta banco e não
 * conhece a esteira — é a única forma de exercer caso a caso o que, dentro de uma rota, só seria
 * conferível olhando produção.
 */

import { findBestMatch, MATCH_THRESHOLD } from "@/lib/server/name-matcher";

export interface DiretorDoGabarito {
  nome: string;
  variantes: string[];
  /** Quantos itens ele votou, contado à mão no PDF. */
  votos: number;
  /** Itens em que está declarado impedido — não geram voto dele. */
  impedido_em: string[];
}

export interface AtaDoGabarito {
  agencia: string;
  reuniao: string;
  data_reuniao: string;
  itens_decididos: number;
  itens_sem_decisao: number;
  colegiado: DiretorDoGabarito[];
}

/** O que o banco tem para a MESMA reunião. */
export interface ReuniaoNoBanco {
  /** Deliberações da reunião (inclusive as sem decisão: elas são linha). */
  itens: number;
  /** Votos por diretor, pelo nome cadastrado. */
  votosPorDiretor: Array<{ nome: string; votos: number }>;
}

export type TipoDeDivergencia =
  /** O banco tem menos linhas que a ata tem itens — é falha de COLETA/divisão, não de data. */
  | "itens_faltando"
  /** O banco tem mais linhas que a ata — duplicata. */
  | "itens_a_mais"
  /** Diretor do gabarito sem nenhum voto no banco. */
  | "diretor_sem_voto"
  /** Diretor do gabarito com contagem diferente. */
  | "contagem_de_votos"
  /** Votou no banco alguém que a ata não põe no colegiado. */
  | "diretor_a_mais";

export interface Divergencia {
  ata: string;
  tipo: TipoDeDivergencia;
  diretor?: string;
  esperado: number;
  encontrado: number;
}

export interface ResultadoDaCertificacao {
  conferidas: number;
  batem: number;
  divergem: Divergencia[];
}

/** Quantos votos o gabarito espera de um diretor: os itens decididos menos os que ele foi impedido. */
export function votosEsperadosDe(ata: AtaDoGabarito, diretor: DiretorDoGabarito): number {
  return ata.itens_decididos - diretor.impedido_em.length;
}

/** Itens que a ata tem ao todo — decididos e não decididos viram linha no banco. */
export function itensEsperadosDe(ata: AtaDoGabarito): number {
  return ata.itens_decididos + ata.itens_sem_decisao;
}

/**
 * Voto EFETIVO: o diretor se manifestou. `Ausente` (que é também como o impedimento é gravado) NÃO
 * conta — é a aritmética do gabarito (`votos = itens_decididos − impedido_em`), a mesma da etapa163.
 */
export const TIPOS_DE_VOTO_EFETIVO: ReadonlySet<string> = new Set(["Favoravel", "Desfavoravel", "Abstencao"]);

/**
 * O lado BANCO da certificação, com a MESMA régua do gabarito (Fase 39).
 *
 * ⚠️ A versão anterior, inline no placar, contava TODA linha de `votos` (Ausente e impedido
 * inclusos) e TODA deliberação com o número (a mãe-envelope e a pauta inclusas). O José Fernando,
 * impedido em 5 itens da 83ª, aparecia com 49 contra 44 esperados — divergência do INSTRUMENTO,
 * lida como defeito da esteira. Aqui: só registro FINAL vira item, só voto efetivo vira voto.
 */
export function reuniaoNoBancoParaCertificar(
  linhas: Array<{ id: string; final: boolean }>,
  votosPorDelib: Map<string, Array<{ diretor_id: string; tipo_voto: string | null }>>,
  nomeDe: (diretorId: string) => string,
): ReuniaoNoBanco {
  const finais = linhas.filter((l) => l.final);
  const porDiretor = new Map<string, number>();
  for (const l of finais) {
    const contados = new Set<string>();
    for (const v of votosPorDelib.get(l.id) ?? []) {
      if (!v.tipo_voto || !TIPOS_DE_VOTO_EFETIVO.has(v.tipo_voto) || contados.has(v.diretor_id)) continue;
      contados.add(v.diretor_id);
      porDiretor.set(v.diretor_id, (porDiretor.get(v.diretor_id) ?? 0) + 1);
    }
  }
  return {
    itens: finais.length,
    votosPorDiretor: [...porDiretor.entries()].map(([id, votos]) => ({ nome: nomeDe(id), votos })),
  };
}

/**
 * BANCO × GABARITO. É a verificação DEPOIS de aplicar, nunca o portão.
 *
 * ⚠️ Uma ata sem correspondência no banco (`undefined`) NÃO é "bate": ela é `conferidas` com
 * divergência de itens `0 de N`. Contar ausência como acerto é o formato de zero que este projeto
 * mede desde a Fase 17.
 */
export function certificarContraGabarito(
  gabarito: Record<string, AtaDoGabarito>,
  noBanco: Record<string, ReuniaoNoBanco | undefined>,
): ResultadoDaCertificacao {
  const divergem: Divergencia[] = [];
  let conferidas = 0;
  let batem = 0;

  for (const [arquivo, ata] of Object.entries(gabarito)) {
    conferidas += 1;
    const banco = noBanco[arquivo];
    const antes = divergem.length;

    const itensNoBanco = banco?.itens ?? 0;
    const itensEsperados = itensEsperadosDe(ata);
    if (itensNoBanco < itensEsperados) {
      divergem.push({ ata: arquivo, tipo: "itens_faltando", esperado: itensEsperados, encontrado: itensNoBanco });
    } else if (itensNoBanco > itensEsperados) {
      divergem.push({ ata: arquivo, tipo: "itens_a_mais", esperado: itensEsperados, encontrado: itensNoBanco });
    }

    const noBancoPorDiretor = banco?.votosPorDiretor ?? [];
    const casados = new Set<string>();
    for (const diretor of ata.colegiado) {
      const esperado = votosEsperadosDe(ata, diretor);
      // O gabarito traz variantes de propósito: o nome do cadastro raramente é o do PDF.
      const candidatos = [{ id: diretor.nome, nome: diretor.nome, nome_variantes: diretor.variantes }];
      const achado = noBancoPorDiretor.find((v) => findBestMatch(v.nome, candidatos).score >= MATCH_THRESHOLD);
      if (!achado) {
        divergem.push({ ata: arquivo, tipo: "diretor_sem_voto", diretor: diretor.nome, esperado, encontrado: 0 });
        continue;
      }
      casados.add(achado.nome);
      if (achado.votos !== esperado) {
        divergem.push({
          ata: arquivo, tipo: "contagem_de_votos", diretor: diretor.nome,
          esperado, encontrado: achado.votos,
        });
      }
    }

    for (const v of noBancoPorDiretor) {
      if (casados.has(v.nome)) continue;
      divergem.push({ ata: arquivo, tipo: "diretor_a_mais", diretor: v.nome, esperado: 0, encontrado: v.votos });
    }

    if (divergem.length === antes) batem += 1;
  }

  return { conferidas, batem, divergem };
}

export interface ResultadoDaSimulacao {
  /** A simulação reproduz o colegiado do gabarito? É o portão. */
  reproduz: boolean;
  /** Nomes do gabarito que o roster simulado NÃO contém — o revoto os deixaria de fora. */
  faltando: string[];
  /** Nomes do roster simulado que o gabarito não tem — o revoto inventaria voto para eles. */
  sobrando: string[];
}

/**
 * O PORTÃO: o roster que o motor usaria na data CERTA reproduz o colegiado do gabarito?
 *
 * ⚠️ Roster vazio NUNCA "reproduz". `getActiveDiretoresForVote` devolve `[]` também em ERRO de
 * leitura, e um portão que aceitasse vazio liberaria o revoto justo quando o banco não respondeu.
 *
 * ⚠️ E `sobrando` é tão grave quanto `faltando`: um nome a mais no roster simulado vira voto
 * INVENTADO para quem a ata não põe na sala — é o que aconteceu com o Caio Mário na 79ª.
 */
export function simularColegiadoNaDataCerta(
  ata: AtaDoGabarito,
  rosterSimulado: Array<{ nome: string; nome_variantes?: string[] }>,
): ResultadoDaSimulacao {
  /**
   * ⚠️ OS DOIS lados vazios, e o segundo foi achado por uma mutação que SOBREVIVEU.
   *
   * Roster vazio já daria `reproduz: false` pelo laço abaixo (todo o colegiado cairia em `faltando`),
   * então a guarda parecia redundante. Não é: se o colegiado do GABARITO também estivesse vazio,
   * `faltando` e `sobrando` sairiam vazios e a função devolveria **`reproduz: true`** — o portão do
   * revoto abriria com nada dos dois lados. É o mesmo "0 de 0 = 100%" que este projeto mede desde a
   * Fase 17, agora no lugar mais caro possível: liberando uma escrita que apaga.
   */
  if (rosterSimulado.length === 0 || ata.colegiado.length === 0) {
    return {
      reproduz: false,
      faltando: ata.colegiado.map((d) => d.nome),
      sobrando: rosterSimulado.map((r) => r.nome),
    };
  }

  const casados = new Set<string>();
  const faltando: string[] = [];
  for (const diretor of ata.colegiado) {
    const candidatos = [{ id: diretor.nome, nome: diretor.nome, nome_variantes: diretor.variantes }];
    const achado = rosterSimulado.find((r) => findBestMatch(r.nome, candidatos).score >= MATCH_THRESHOLD);
    if (achado) casados.add(achado.nome);
    else faltando.push(diretor.nome);
  }
  const sobrando = rosterSimulado.filter((r) => !casados.has(r.nome)).map((r) => r.nome);

  return { reproduz: faltando.length === 0 && sobrando.length === 0, faltando, sobrando };
}
