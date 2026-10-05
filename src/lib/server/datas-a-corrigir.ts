/**
 * DATAS A CORRIGIR — o planejamento puro das três janelas da Fase 39 (Medir → Aplicar).
 *
 * Decisão do usuário: nenhuma destas correções grava sozinha. Cada janela devolve o DE/PARA com a
 * fonte e o motivo; o painel mostra; o usuário confere uma amostra e clica Aplicar. Por isso aqui
 * não há I/O — só a decisão, exercitável caso a caso.
 *
 *  · `referencia`  — a data da REUNIÃO pela listagem do site (ANTT e ARTESP). A ANTT tinha a 282, 286,
 *                    1.035 e 289 gravadas em 2016–2024; a ARTESP tem números com duas datas (a data do
 *                    CABEÇALHO do ato, que é a de assinatura, ou de uma reunião citada).
 *  · `voto_antt`   — o voto individual da ANTT pela ÂNCORA (fecho ou assinatura SEI), nunca pela
 *                    primeira data do texto; só se o signatário tiver mandato na data proposta.
 *  · `ata_anm`     — a mãe da ata da ANM pelo preâmbulo por extenso (81ª: "vinte e oito … janeiro …
 *                    dois mil e vinte e seis"); os filhos seguem a mãe na aplicação.
 *
 * ⚠️ Cada janela tem um PORTÃO por agência que precisa reproduzir o gabarito conferido à mão antes de
 * propor qualquer coisa. Fonte que não reproduz as atas certificadas não é testemunha.
 */

import { findBestMatch, MATCH_THRESHOLD, type DiretorRecord } from "@/lib/server/name-matcher";
import { colegiadoNaData, type MandatoJanela } from "@/lib/server/colegiado-na-data";
import { portaoDaListagemAntt, type VereditoDoPortao } from "@/lib/server/antt-data-da-listagem";
import { ordinalDeTextoDeReuniao } from "@/lib/server/reunioes";
import { dataDoVotoAntt } from "@/lib/server/antt-manual-parser";

export type JanelaDeData = "referencia" | "voto_antt" | "ata_anm";

export interface DelibParaData {
  id: string;
  agencia: string;
  agencia_id: string;
  numero_reuniao: string | null;
  /** Série da reunião no banco (de `reunioes`), quando se sabe. */
  serie: string | null;
  data_reuniao: string | null;
  documento_pai_id: string | null;
}

export interface PropostaDeData {
  id: string;
  agencia: string;
  numero_reuniao: string | null;
  de: string | null;
  para: string;
  janela: JanelaDeData;
  /** De onde veio o "para" — mostrado ao lado do de/para para o usuário conferir. */
  fonte: string;
}

export interface PlanoDeDatas {
  janela: JanelaDeData;
  propostas: PropostaDeData[];
  /** Já estão com a data que a fonte dá — nada a fazer. */
  ja_certas: number;
  recusas: Record<string, number>;
  /** O portão de cada agência — publicado sempre, aprovado ou não. */
  portoes: Record<string, VereditoDoPortao>;
  /** Amostra do que o portão barrou (para o usuário ver o que ficaria de fora). */
  barradas_pelo_portao: PropostaDeData[];
}

const recusar = (r: Record<string, number>, motivo: string) => { r[motivo] = (r[motivo] ?? 0) + 1; };
const seriesCasam = (a: string | null, b: string | null) => !a || !b || a === b;

// ─── Janela `referencia` ────────────────────────────────────────────────────

export interface ReuniaoComData {
  agencia: string;
  serie: string | null;
  numero: number;
  data_reuniao: string | null;
}

/**
 * A data que a referência dá para (agência, série, número) — e se ela é CONFIÁVEL na ordem da série.
 *
 * ⚠️ MONOTONIA: a numeração da série é crescente no tempo, então a data proposta tem de ficar
 * ESTRITAMENTE entre a da vizinha anterior e a da posterior. Isso pega o defeito conhecido do parser
 * da ARTESP: cabeçalho sem data própria herda a data da reunião seguinte — e fica IGUAL à da vizinha.
 */
export function dataDaReferencia(
  referencia: readonly ReuniaoComData[],
  alvo: { agencia: string; serie: string | null; numero: number },
): { data: string | null; motivo: "ok" | "sem_referencia" | "referencia_ambigua" | "fora_da_ordem_da_serie" } {
  const mesmas = referencia.filter((r) =>
    r.agencia === alvo.agencia && r.numero === alvo.numero && seriesCasam(r.serie, alvo.serie) && r.data_reuniao);
  const datas = new Set(mesmas.map((r) => String(r.data_reuniao).slice(0, 10)));
  if (datas.size === 0) return { data: null, motivo: "sem_referencia" };
  if (datas.size > 1) return { data: null, motivo: "referencia_ambigua" };
  const data = [...datas][0];
  const serie = mesmas.find((r) => r.serie)?.serie ?? alvo.serie;
  const daSerie = referencia.filter((r) =>
    r.agencia === alvo.agencia && r.data_reuniao && (serie ? r.serie === serie : true) && r.numero !== alvo.numero);
  const anteriores = daSerie.filter((r) => r.numero < alvo.numero).sort((a, b) => b.numero - a.numero);
  const posteriores = daSerie.filter((r) => r.numero > alvo.numero).sort((a, b) => a.numero - b.numero);
  const ant = anteriores[0]?.data_reuniao?.slice(0, 10);
  const pos = posteriores[0]?.data_reuniao?.slice(0, 10);
  if ((ant && !(ant < data)) || (pos && !(data < pos))) return { data: null, motivo: "fora_da_ordem_da_serie" };
  return { data, motivo: "ok" };
}

/**
 * O portão da referência por agência: ela reproduz as atas do gabarito daquela agência? Reusa o
 * portão da ANTT (mesma regra: listagem vazia ou sem ata para conferir REPROVA).
 */
export function portaoDaReferencia(
  referencia: readonly ReuniaoComData[],
  atasDoGabarito: ReadonlyArray<{ agencia: string; reuniao: string; data_reuniao: string }>,
  sigla: string,
): VereditoDoPortao {
  return portaoDaListagemAntt(
    referencia.filter((r) => r.agencia === sigla)
      .map((r) => ({ numero: String(r.numero), tipo: r.serie, data_inicio: r.data_reuniao })),
    atasDoGabarito.filter((a) => String(a.agencia).trim().toUpperCase() === sigla)
      .map((a) => ({ reuniao: a.reuniao, data_reuniao: a.data_reuniao })),
  );
}

export function planejarPelaReferencia(entrada: {
  delibs: readonly DelibParaData[];
  referencia: readonly ReuniaoComData[];
  atasDoGabarito: ReadonlyArray<{ agencia: string; reuniao: string; data_reuniao: string }>;
  agencias: readonly string[];
}): PlanoDeDatas {
  const portoes: Record<string, VereditoDoPortao> = {};
  for (const sigla of entrada.agencias) portoes[sigla] = portaoDaReferencia(entrada.referencia, entrada.atasDoGabarito, sigla);

  const plano: PlanoDeDatas = { janela: "referencia", propostas: [], ja_certas: 0, recusas: {}, portoes, barradas_pelo_portao: [] };
  for (const d of entrada.delibs) {
    if (!entrada.agencias.includes(d.agencia)) continue;
    // ⚠️ Filho segue a mãe na aplicação. Corrigir o filho por outra fonte faria duas fontes
    // escreverem a mesma linha (Fase 21: "uma fonte por conceito").
    if (d.documento_pai_id) continue;
    const numero = ordinalDeTextoDeReuniao(d.numero_reuniao);
    if (numero === null || numero <= 0) continue;
    const r = dataDaReferencia(entrada.referencia, { agencia: d.agencia, serie: d.serie, numero });
    if (!r.data) { if (r.motivo !== "sem_referencia") recusar(plano.recusas, r.motivo); continue; }
    if (r.data === String(d.data_reuniao ?? "").slice(0, 10)) { plano.ja_certas++; continue; }
    const proposta: PropostaDeData = {
      id: d.id, agencia: d.agencia, numero_reuniao: d.numero_reuniao,
      de: d.data_reuniao, para: r.data, janela: "referencia",
      fonte: `listagem do site (${d.agencia} ${numero}ª)`,
    };
    if (!portoes[d.agencia]?.aprovado) {
      recusar(plano.recusas, `portao_${portoes[d.agencia]?.motivo ?? "ausente"}`);
      if (plano.barradas_pelo_portao.length < 30) plano.barradas_pelo_portao.push(proposta);
      continue;
    }
    plano.propostas.push(proposta);
  }
  return plano;
}

// ─── Janela `voto_antt` ─────────────────────────────────────────────────────

export interface DiretorParaCasar {
  id: string;
  nome: string;
  nome_variantes?: string[] | null;
}

/**
 * Voto individual da ANTT pela âncora. ⚠️ O portão é o MANDATO: só se propõe a data se o signatário
 * casar com um diretor que tinha mandato nela. Severino "votando" em 05/09/2025 (posse em 19/11/2025)
 * é exatamente o que este portão recusa — se a âncora também desse uma data fora do mandato, a
 * extração é que está errada e ninguém escreve.
 */
export function planejarVotosAntt(entrada: {
  delibs: readonly DelibParaData[];
  textos: ReadonlyMap<string, string>;
  mandatos: readonly MandatoJanela[];
  diretores: readonly DiretorParaCasar[];
}): PlanoDeDatas {
  const plano: PlanoDeDatas = { janela: "voto_antt", propostas: [], ja_certas: 0, recusas: {}, portoes: {}, barradas_pelo_portao: [] };
  const candidatos: DiretorRecord[] = entrada.diretores.map((x) => ({ id: x.id, nome: x.nome, nome_variantes: x.nome_variantes ?? [] }));
  for (const d of entrada.delibs) {
    if (d.agencia !== "ANTT" || d.numero_reuniao) continue;
    const texto = entrada.textos.get(d.id);
    if (!texto || texto.trim().length < 200) { recusar(plano.recusas, "sem_texto"); continue; }
    const v = dataDoVotoAntt(texto);
    if (!v.data) { recusar(plano.recusas, "sem_ancora"); continue; }
    if (!v.signatario) { recusar(plano.recusas, "sem_signatario"); continue; }
    const casado = findBestMatch(v.signatario, candidatos);
    if (!casado.diretorId || casado.score < MATCH_THRESHOLD) { recusar(plano.recusas, "signatario_nao_reconhecido"); continue; }
    if (!colegiadoNaData([...entrada.mandatos], d.agencia_id, v.data).includes(casado.diretorId)) {
      recusar(plano.recusas, "signatario_sem_mandato_na_data");
      continue;
    }
    if (v.data === String(d.data_reuniao ?? "").slice(0, 10)) { plano.ja_certas++; continue; }
    plano.propostas.push({
      id: d.id, agencia: d.agencia, numero_reuniao: null, de: d.data_reuniao, para: v.data, janela: "voto_antt",
      fonte: `${v.ancora === "fecho" ? "fecho «Brasília, …»" : "assinatura SEI"} de ${v.signatario}`,
    });
  }
  return plano;
}

// ─── Janela `ata_anm` ───────────────────────────────────────────────────────

/**
 * A mãe da ata da ANM pelo preâmbulo. O "para" é calculado por quem chama (com
 * `extractAnmMeetingMetadata`/`extractDataReuniaoAncorada`, os MESMOS do `redatar`) e chega aqui em
 * `dataDoTexto`. ⚠️ O portão: para cada ata do gabarito da ANM que estiver entre as mães, o texto
 * tem de dar exatamente a data conferida à mão. Uma regra que erra a 81ª não corrige nada.
 */
export function planejarAtasAnm(entrada: {
  maes: ReadonlyArray<DelibParaData & { dataDoTexto: string | null }>;
  atasDoGabarito: ReadonlyArray<{ agencia: string; reuniao: string; data_reuniao: string; serie?: string | null }>;
}): PlanoDeDatas {
  const atas = entrada.atasDoGabarito.filter((a) => String(a.agencia).trim().toUpperCase() === "ANM");
  const divergem: VereditoDoPortao["divergem"] = [];
  let batem = 0;
  let conferidas = 0;
  for (const ata of atas) {
    const n = ordinalDeTextoDeReuniao(ata.reuniao);
    const serieDaAta = (ata as { serie?: string | null }).serie ?? null;
    const mae = entrada.maes.find((m) => m.agencia === "ANM" && ordinalDeTextoDeReuniao(m.numero_reuniao) === n
      && seriesCasam(m.serie, serieDaAta) && m.dataDoTexto);
    if (!mae) continue;
    conferidas++;
    if (mae.dataDoTexto === ata.data_reuniao) batem++;
    else divergem.push({ reuniao: ata.reuniao, no_gabarito: ata.data_reuniao, na_listagem: mae.dataDoTexto });
  }
  const portao: VereditoDoPortao = conferidas === 0
    ? { aprovado: false, conferidas: 0, batem: 0, divergem: [], motivo: "sem_ata_para_conferir" }
    : { aprovado: divergem.length === 0, conferidas, batem, divergem, motivo: divergem.length === 0 ? "aprovado" : "divergencia" };

  const plano: PlanoDeDatas = { janela: "ata_anm", propostas: [], ja_certas: 0, recusas: {}, portoes: { ANM: portao }, barradas_pelo_portao: [] };
  for (const m of entrada.maes) {
    if (m.agencia !== "ANM") continue;
    if (!m.dataDoTexto) { recusar(plano.recusas, "preambulo_sem_data"); continue; }
    if (m.dataDoTexto === String(m.data_reuniao ?? "").slice(0, 10)) { plano.ja_certas++; continue; }
    const proposta: PropostaDeData = {
      id: m.id, agencia: "ANM", numero_reuniao: m.numero_reuniao, de: m.data_reuniao, para: m.dataDoTexto,
      janela: "ata_anm", fonte: "preâmbulo da ata (data por extenso)",
    };
    if (!portao.aprovado) {
      recusar(plano.recusas, `portao_${portao.motivo}`);
      if (plano.barradas_pelo_portao.length < 30) plano.barradas_pelo_portao.push(proposta);
      continue;
    }
    plano.propostas.push(proposta);
  }
  return plano;
}
