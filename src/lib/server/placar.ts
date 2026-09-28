/**
 * O PLACAR — o denominador comum que faltava (Fase 34).
 *
 * ═══ A pergunta que isto responde ═══
 * *"Como sei que estamos chegando ao fim?"*. Até agora cada fase consertava alguma coisa sem medir
 * avanço contra um número só, e por isso dava a sensação de não sair do lugar mesmo quando saía.
 *
 * São três números, e cada um mede um pilar diferente do objetivo final:
 *
 *  (a) **BURACOS na numeração**, por (agência, série). Toda série de reunião é numerada em
 *      sequência: um número que falta no meio é uma reunião que o banco não tem. É o pilar da
 *      COLETA — "coletei tudo o que foi publicado?".
 *  (b) **REUNIÕES COM COLEGIADO COMPLETO**. É o pilar do VOTO — "cada diretor que estava lá tem
 *      voto, ou tem motivo?".
 *  (c) A certificação batendo no BANCO, não só no código. É o pilar da CONFIANÇA.
 *
 * ⚠️ POR QUE ISTO É UM MÓDULO PURO, e não SQL nem lógica dentro da rota: a álgebra do placar precisa
 * ser exercida com dado montado à mão, caso a caso. Num bloco de SQL colado no editor ela só é
 * conferível olhando o resultado em produção, e foi assim que o bloco ⑨ passou fases inteiras
 * chamando documento avulso de reunião incompleta sem ninguém notar.
 */

import { colegiadoNaData, esperadoVsPresente, type MandatoJanela } from "@/lib/server/colegiado-na-data";
import { ordinalDeTextoDeReuniao } from "@/lib/server/reunioes";

/**
 * Por que uma reunião não está completa. ⚠️ A distinção entre as duas do meio é a que torna o
 * placar ACIONÁVEL: uma é trabalho meu, a outra é dado que só o DOU tem. Um número só, somando as
 * duas, diz "20 incompletas" e não diz o que fazer com elas.
 */
export type ClasseDaReuniao =
  /** Todo diretor com mandato na data tem voto, e ninguém votou de fora do mandato. */
  | "completa"
  /** Falta voto de quem tinha mandato. É defeito NOSSO: a esteira não produziu o voto. */
  | "defeito_nosso"
  /** Alguém votou sem mandato declarado na data. É falta de CADASTRO — depende do DOU. */
  | "cadastro_pendente"
  /** Não se sabe quem estava lá. Reportar completude aqui seria a mentira oposta. */
  | "roster_desconhecido";

export interface ClassificacaoInput {
  faltando: string[];
  extra: string[];
  roster_conhecido: boolean;
}

/**
 * ⚠️ A PRECEDÊNCIA é decisão, não acaso: quando os dois aparecem, vale `defeito_nosso`. Uma reunião
 * em que falta voto E alguém votou sem mandato tem as duas coisas, mas só uma delas eu consigo
 * consertar sozinho — e o placar existe para dizer o que fazer em seguida. As duas bandeiras
 * continuam publicadas ao lado da classe, para a outra não sumir.
 */
export function classificarReuniao(i: ClassificacaoInput): ClasseDaReuniao {
  if (!i.roster_conhecido) return "roster_desconhecido";
  if (i.faltando.length > 0) return "defeito_nosso";
  if (i.extra.length > 0) return "cadastro_pendente";
  return "completa";
}

export interface ReuniaoParaPlacar {
  agencia: string;
  serie: string | null;
  numero_reuniao: string | null;
  data_reuniao: string;
  /** Ids de diretor que têm voto em alguma deliberação desta reunião. */
  votantes: string[];
}

export interface ReuniaoMedida extends ReuniaoParaPlacar {
  ordinal: number | null;
  esperado: number;
  com_voto: number;
  faltando: string[];
  extra: string[];
  roster_conhecido: boolean;
  classe: ClasseDaReuniao;
}

/**
 * Mede uma reunião contra o colegiado da data.
 *
 * Reusa `colegiadoNaData`/`esperadoVsPresente`, que são os MESMOS filtros de
 * `getActiveDiretoresForVote` — o motor que cria os votos. Um placar com filtro próprio produziria
 * um selo que discorda do motor, que é o pior desfecho possível numa ferramenta feita para dar
 * confiança.
 */
export function medirReuniao(
  r: ReuniaoParaPlacar,
  agenciaId: string,
  mandatos: MandatoJanela[],
): ReuniaoMedida {
  const roster = colegiadoNaData(mandatos, agenciaId, r.data_reuniao);
  const cmp = esperadoVsPresente(roster, r.votantes);
  const noRoster = new Set(roster);
  // ⚠️ `extra` só faz sentido quando o roster é conhecido: sem roster, TODO votante seria "extra".
  const extra = cmp.roster_conhecido ? r.votantes.filter((id) => !noRoster.has(id)) : [];
  return {
    ...r,
    ordinal: ordinalDeTextoDeReuniao(r.numero_reuniao),
    esperado: cmp.esperado,
    com_voto: cmp.presente,
    faltando: cmp.faltando,
    extra,
    roster_conhecido: cmp.roster_conhecido,
    classe: classificarReuniao({ faltando: cmp.faltando, extra, roster_conhecido: cmp.roster_conhecido }),
  };
}

export interface OcorrenciaDeNumero {
  ordinal: number;
  datas: string[];
}

export interface BuracosDaSerie {
  agencia: string;
  serie: string | null;
  min: number | null;
  max: number | null;
  /** Números que o banco NÃO tem, em nenhuma data. É o que pode faltar coletar. */
  ausentes: number[];
  /** Números que o banco TEM, mas com data fora do ano medido. Quase sempre data errada. */
  fora_do_ano: OcorrenciaDeNumero[];
  /** O MESMO número em datas diferentes. Ou a reunião está duplicada, ou o número foi lido errado. */
  duplicados: OcorrenciaDeNumero[];
}

export interface EntradaDeNumeracao {
  agencia: string;
  serie: string | null;
  numero_reuniao: string | null;
  data_reuniao: string;
}

/** Teto de segurança: uma série com salto absurdo denuncia número lido errado, não coleta faltando. */
export const SALTO_MAXIMO_DA_SERIE = 400;

/**
 * Os buracos de uma série, separados em três causas — e a separação é o ponto.
 *
 * ⚠️ Medido no corpus de produção: vários números que "faltam" em 2026 **estão no banco**, com data
 * de outro ano. ANTT RDE 282 gravada em 2016-06-08, 286 em 2022-11-03, 289 em 2024-04-29, RD 1.035
 * em 2023-12-21, ARTESP 1186 em 2025-12-19, ANM 81 em 2025-03-26. **São dez reuniões que sumiram do
 * ano por causa da data, e não por falta de coleta.** Um detector que só dissesse "faltando: 282"
 * mandaria recoletar o que já está lá, e o defeito de data ficaria invisível.
 *
 * ⚠️ E o terceiro caso saiu de uma conferência que ninguém tinha feito: na ARTESP o mesmo número
 * aparece em datas diferentes (239 em 23/06 e 25/06; 1192 em 23/04 e 28/04; 1178 em 20/01 e 26/03,
 * e mais nove pares). Enquanto isso existir, o denominador "reuniões do ano" está inflado, e uma
 * meta medida contra ele mede a duplicata junto.
 */
export function buracosDaSerie(
  entradas: EntradaDeNumeracao[],
  deAno: string,
  ateAno: string,
): BuracosDaSerie[] {
  const porSerie = new Map<string, EntradaDeNumeracao[]>();
  for (const e of entradas) {
    const k = `${e.agencia}\u0000${e.serie ?? ""}`;
    const lista = porSerie.get(k);
    if (lista) lista.push(e);
    else porSerie.set(k, [e]);
  }

  const saida: BuracosDaSerie[] = [];
  for (const [k, lista] of porSerie) {
    const [agencia, serieCrua] = k.split("\u0000");
    const serie = serieCrua === "" ? null : serieCrua;

    // Datas por ordinal, de TODO o acervo — é o que permite dizer "existe, mas fora do ano".
    const datasPorOrdinal = new Map<number, Set<string>>();
    for (const e of lista) {
      const n = ordinalDeTextoDeReuniao(e.numero_reuniao);
      if (n === null) continue;
      const s = datasPorOrdinal.get(n) ?? new Set<string>();
      s.add(e.data_reuniao);
      datasPorOrdinal.set(n, s);
    }

    const dentroDoAno = new Set<number>();
    for (const [n, datas] of datasPorOrdinal) {
      if ([...datas].some((d) => d >= deAno && d <= ateAno)) dentroDoAno.add(n);
    }
    if (dentroDoAno.size === 0) continue;

    const min = Math.min(...dentroDoAno);
    const max = Math.max(...dentroDoAno);
    // ⚠️ Salto absurdo não é buraco de coleta: é número lido errado. Enumerar 400 "ausentes"
    // afogaria o sinal real, que é o que aconteceu com o detector por `numero_deliberacao`.
    const faixaConfiavel = max - min <= SALTO_MAXIMO_DA_SERIE;

    const ausentes: number[] = [];
    const foraDoAno: OcorrenciaDeNumero[] = [];
    if (faixaConfiavel) {
      for (let n = min; n <= max; n++) {
        if (dentroDoAno.has(n)) continue;
        const datas = datasPorOrdinal.get(n);
        if (datas) foraDoAno.push({ ordinal: n, datas: [...datas].sort() });
        else ausentes.push(n);
      }
    }

    const duplicados: OcorrenciaDeNumero[] = [];
    for (const [n, datas] of datasPorOrdinal) {
      const noAno = [...datas].filter((d) => d >= deAno && d <= ateAno).sort();
      if (noAno.length > 1) duplicados.push({ ordinal: n, datas: noAno });
    }
    duplicados.sort((a, b) => a.ordinal - b.ordinal);

    saida.push({ agencia, serie, min, max, ausentes, fora_do_ano: foraDoAno, duplicados });
  }
  saida.sort((a, b) => a.agencia.localeCompare(b.agencia) || String(a.serie).localeCompare(String(b.serie)));
  return saida;
}

export interface ResumoDoPlacar {
  total: number;
  completas: number;
  defeito_nosso: number;
  cadastro_pendente: number;
  roster_desconhecido: number;
}

/** O resumo por agência. `completas / total` é o número que toda fase tem de mover. */
export function resumirPorAgencia(medidas: ReuniaoMedida[]): Record<string, ResumoDoPlacar> {
  const out: Record<string, ResumoDoPlacar> = {};
  for (const m of medidas) {
    const r = out[m.agencia] ?? (out[m.agencia] = {
      total: 0, completas: 0, defeito_nosso: 0, cadastro_pendente: 0, roster_desconhecido: 0,
    });
    r.total++;
    r[m.classe === "completa" ? "completas" : m.classe]++;
  }
  return out;
}
