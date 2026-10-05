/**
 * SIMULAR O REVOTO contra o gabarito — em memória, antes de qualquer escrita (Fase 39, passo 3).
 *
 * ═══ Por que simular, e por que na data CERTIFICADA ═══
 * O modo `revoto` do materializador usa a data GRAVADA da deliberação para escolher o roster. Na 81ª
 * ROP (gravada 2025-03-26, certa 2026-01-28) isso apagaria exatamente os votos certos (José
 * Fernando, Luiz, Fábio) e acusaria a falta de Caio, Roger e Tasso — o inverso do gabarito. Aqui o
 * roster vem SEMPRE da data conferida contra o PDF (`DATAS_CONFERIDAS` / gabarito), nunca de
 * `d.data_reuniao`.
 *
 * ═══ Uma régua só ═══
 * A simulação não reimplementa o motor: compõe as DUAS escritas que existem em produção, nas
 * funções puras delas —
 *   · `decidirRevoto`     — o que o revoto APAGARIA (inferido de quem não tem mandato na data);
 *   · `planejarCompletar` — o que o completar-parcial ACRESCENTARIA (quem tem mandato e não tem
 *                            linha), com as mesmas recusas (contestado, sem resultado, artefato).
 * e certifica o "depois" com a régua do gabarito (`reuniaoNoBancoParaCertificar`: só voto efetivo).
 * Impedido declarado no item recebe `Ausente` — não é voto, como o `buildVotoRows` faz.
 *
 * ⚠️ PURO: recebe tudo por parâmetro. A rota lê o banco; este módulo só decide.
 */

import { decidirRevoto, type VotoParaRevoto } from "@/lib/server/revoto";
import { planejarCompletar } from "@/lib/server/completar-colegiado";
import { colegiadoNaData, type MandatoJanela } from "@/lib/server/colegiado-na-data";
import {
  TIPOS_DE_VOTO_EFETIVO, certificarContraGabarito, simularColegiadoNaDataCerta, votosEsperadosDe,
  type AtaDoGabarito, type Divergencia, type ResultadoDaSimulacao,
} from "@/lib/server/certificacao-gabarito";
import { findBestMatch, MATCH_THRESHOLD, type DiretorRecord } from "@/lib/server/name-matcher";
import { ehVotoDeDirecao, isVotoNominal } from "@/lib/votos-nominal";
import { tipoVotoInferido } from "@/lib/server/vote-inference";

export interface ItemParaSimular {
  id: string;
  item_numero: string | null;
  tipo_documento: string | null;
  resultado: string | null;
  contestado: boolean;
  temPai: boolean;
  /** Ids impedidos NESTE item (lidos do raw e casados com o cadastro pelo chamador). */
  impedidos: string[];
  /** As linhas de `votos` que existem HOJE. */
  votos: VotoParaRevoto[];
}

export interface DiretorPorDiretor {
  nome: string;
  esperado: number;
  hoje: number;
  depois: number;
}

export interface ResultadoDoRevotoSimulado {
  ata: string;
  data_certa: string;
  /** O roster que o motor usaria na data CERTA. */
  roster: string[];
  /** O PORTÃO: esse roster reproduz o colegiado do gabarito? */
  portao: ResultadoDaSimulacao;
  itens_no_banco: number;
  itens_esperados: number;
  /** Votos inferidos que o revoto apagaria (fora do mandato na data certa). */
  apagaria: Array<{ item: string | null; diretor: string }>;
  /** Pares que o completar-parcial criaria. */
  acrescentaria: number;
  /** Nominais fora do mandato — nunca apagados; apontam cadastro errado. */
  roster_suspeito: Array<{ item: string | null; diretor: string }>;
  recusas_do_completar: Record<string, number>;
  por_diretor: DiretorPorDiretor[];
  /** A certificação do DEPOIS contra o gabarito. */
  divergencias_depois: Divergencia[];
  /** Portão aberto E depois batendo com o gabarito — a condição para ligar o revoto. */
  reproduz: boolean;
}

export function simularRevotoDaAta(entrada: {
  arquivo: string;
  ata: AtaDoGabarito;
  sigla: string;
  agenciaId: string;
  dataCerta: string;
  mandatos: readonly MandatoJanela[];
  diretores: ReadonlyArray<{ id: string; nome: string; nome_variantes?: string[] | null }>;
  itens: readonly ItemParaSimular[];
}): ResultadoDoRevotoSimulado {
  const { ata, itens } = entrada;
  const cadastro: DiretorRecord[] = entrada.diretores.map((d) => ({ id: d.id, nome: d.nome, nome_variantes: d.nome_variantes ?? [] }));
  const nomeDe = (id: string) => cadastro.find((d) => d.id === id)?.nome ?? id;

  const roster = colegiadoNaData([...entrada.mandatos], entrada.agenciaId, entrada.dataCerta);
  const portao = simularColegiadoNaDataCerta(ata, roster.map((id) => {
    const d = cadastro.find((x) => x.id === id);
    return { nome: d?.nome ?? id, nome_variantes: d?.nome_variantes ?? [] };
  }));

  const apagaria: ResultadoDoRevotoSimulado["apagaria"] = [];
  const rosterSuspeito: ResultadoDoRevotoSimulado["roster_suspeito"] = [];
  const efetivosHoje = new Map<string, Set<string>>();
  const efetivosDepois = new Map<string, Set<string>>();
  const marcar = (m: Map<string, Set<string>>, dir: string, item: string) => {
    const s = m.get(dir) ?? new Set<string>();
    s.add(item);
    m.set(dir, s);
  };

  const parciais = [];
  for (const it of itens) {
    for (const v of it.votos) if (v.tipo_voto && TIPOS_DE_VOTO_EFETIVO.has(v.tipo_voto)) marcar(efetivosHoje, v.diretor_id, it.id);

    const dec = decidirRevoto({ roster, votos: it.votos });
    for (const id of dec.apagar) apagaria.push({ item: it.item_numero, diretor: nomeDe(id) });
    for (const id of dec.roster_suspeito) rosterSuspeito.push({ item: it.item_numero, diretor: nomeDe(id) });
    const apagar = new Set(dec.apagar);
    const restantes = it.votos.filter((v) => !apagar.has(v.diretor_id));
    for (const v of restantes) if (v.tipo_voto && TIPOS_DE_VOTO_EFETIVO.has(v.tipo_voto)) marcar(efetivosDepois, v.diretor_id, it.id);

    parciais.push({
      id: it.id, sigla: entrada.sigla, tipo_documento: it.tipo_documento, resultado: it.resultado,
      contestado: it.contestado, roster, jaResponderam: [...new Set(restantes.map((v) => v.diretor_id))],
      // A MESMA leitura do placar: voto nominal de direção existente pode ser artefato (recusa a).
      temVotoNominalDeDirecao: restantes.some((v) => isVotoNominal(v) && ehVotoDeDirecao(v.tipo_voto)),
      temPai: it.temPai,
    });
  }

  const plano = planejarCompletar(parciais);
  const impedidosPorItem = new Map(itens.map((it) => [it.id, new Set(it.impedidos)]));
  const resultadoPorItem = new Map(itens.map((it) => [it.id, it.resultado]));
  for (const par of plano.pares) {
    // Impedido declarado vira `Ausente` (não é voto) — o mesmo que `buildVotoRows` grava.
    if (impedidosPorItem.get(par.deliberacao_id)?.has(par.diretor_id)) continue;
    // ⚠️ O voto inferido SEGUE O DESFECHO (Fase 26), pela MESMA função do motor: item retirado de
    // pauta não gera voto. `planejarCompletar` é teto e o planejaria; contar aqui inflaria o depois.
    if (!tipoVotoInferido(resultadoPorItem.get(par.deliberacao_id) ?? null)) continue;
    marcar(efetivosDepois, par.diretor_id, par.deliberacao_id);
  }

  // O depois, na régua do gabarito.
  const votosPorDiretor = [...efetivosDepois.entries()].map(([id, s]) => ({ nome: nomeDe(id), votos: s.size }));
  const cert = certificarContraGabarito({ [entrada.arquivo]: ata }, {
    [entrada.arquivo]: { itens: itens.length, votosPorDiretor },
  });

  const idDoNome = (nome: string, variantes: string[]) => {
    const casado = cadastro.find((d) =>
      findBestMatch(d.nome, [{ id: nome, nome, nome_variantes: variantes }]).score >= MATCH_THRESHOLD);
    return casado?.id ?? null;
  };
  const porDiretor: DiretorPorDiretor[] = ata.colegiado.map((g) => {
    const id = idDoNome(g.nome, g.variantes);
    return {
      nome: g.nome,
      esperado: votosEsperadosDe(ata, g),
      hoje: id ? efetivosHoje.get(id)?.size ?? 0 : 0,
      depois: id ? efetivosDepois.get(id)?.size ?? 0 : 0,
    };
  });

  return {
    ata: `${ata.agencia} ${ata.reuniao}`,
    data_certa: entrada.dataCerta,
    roster: roster.map(nomeDe),
    portao,
    itens_no_banco: itens.length,
    itens_esperados: ata.itens_decididos + ata.itens_sem_decisao,
    apagaria,
    acrescentaria: plano.pares.length,
    roster_suspeito: rosterSuspeito,
    recusas_do_completar: plano.porMotivo,
    por_diretor: porDiretor,
    divergencias_depois: cert.divergem,
    reproduz: portao.reproduz && cert.divergem.length === 0,
  };
}
