/**
 * A REFERÊNCIA do site — o que cada agência publica, em linhas, e o snapshot gravado (Fase 38).
 *
 * Os montadores são PUROS (recebem o que a conferência ao vivo já buscou). A gravação é a única
 * parte com I/O, e segue três regras que o usuário fixou:
 *   1. enumeração VAZIA ou com erro (WAF, fora do ar) NUNCA substitui a referência — só registra a
 *      tentativa e o erro em `referencia_fontes`;
 *   2. a referência é CUMULATIVA: reunião que some da listagem não é apagada;
 *   3. o carimbo `ultima_boa_em` só vale para enumeração COMPLETA — a ANTT truncada grava as linhas
 *      que viu (são verdadeiras), mas não se declara referência atualizada.
 */

import type { DiscoveredMonitoringItem } from "@/lib/server/monitoring";
import type { AnttMeeting } from "@/lib/server/antt-2026-collector";
import { lerPaginaDaAnm } from "@/lib/server/anm-cobertura";
import { ordinalDeTextoDeReuniao, serieDaReuniao, type SerieReuniao } from "@/lib/server/reunioes";
import type { ReuniaoDeReferencia } from "@/lib/server/livro-razao";

export interface LinhaDeReferencia extends ReuniaoDeReferencia {
  fonte: string;
  url: string | null;
  ano_publicacao: number | null;
}

/** Uma página da ANM e o que ela é — a série e o tipo de documento vêm do LUGAR, quando o item não diz. */
export interface PaginaDaAnm {
  url: string;
  html: string;
  /** `ata` = a página lista atas (decisão publicada); `pauta` = só pautas. */
  documento: "ata" | "pauta";
  /** O arquivo de atas ordinárias não escreve "ordinária" em cada item; a página inteira é ROP. */
  serie_padrao?: SerieReuniao;
}

const SERIE_DA_ANM: Record<string, SerieReuniao> = { ROP: "ordinaria", REP: "extraordinaria" };

/**
 * As reuniões da ANM em todas as páginas consultadas. ⚠️ SEM filtro de ano: o ano que a página
 * mostra é o da PUBLICAÇÃO (medido ao vivo em 04/10 — a 79ª ROP de 26/11/2025 aparece com 2026).
 * Quem decide o ano é `pertencaAoAno`, pela âncora da série.
 */
export function referenciaDaAnm(paginas: PaginaDaAnm[]): LinhaDeReferencia[] {
  const linhas: LinhaDeReferencia[] = [];
  for (const p of paginas) {
    if (!p.html) continue;
    for (const r of lerPaginaDaAnm(p.html).reunioes) {
      const serie = (r.serie ? SERIE_DA_ANM[r.serie] : null) ?? p.serie_padrao ?? null;
      linhas.push({
        agencia: "ANM", serie, numero: r.numero,
        data_reuniao: null, itens_na_fonte: null,
        decisao_publicada: p.documento === "ata" ? true : false,
        fonte: p.url, url: null, ano_publicacao: r.ano,
      });
    }
  }
  return fundirReferencia(linhas);
}

/** As reuniões da ARTESP: uma por cabeçalho, com as deliberações LISTADAS contadas. */
export function referenciaDaArtesp(itens: DiscoveredMonitoringItem[], fonte: string): LinhaDeReferencia[] {
  const porNumero = new Map<number, LinhaDeReferencia>();
  for (const it of itens) {
    const numero = ordinalDeTextoDeReuniao(it.reuniao ?? null);
    if (numero === null || numero <= 0) continue;
    const meta = (it.metadata ?? {}) as Record<string, unknown>;
    const atual = porNumero.get(numero) ?? {
      agencia: "ARTESP",
      // A faixa vence o rótulo na ARTESP (ela mesma retificou a 1177ª) — é a regra de `serieDaReuniao`.
      serie: serieDaReuniao({
        sigla: "ARTESP", titulo: null,
        tipoReuniao: typeof meta.meeting_type === "string" ? meta.meeting_type : null,
        numeroReuniao: String(numero),
      }).serie,
      numero,
      data_reuniao: it.data_reuniao ?? null,
      itens_na_fonte: 0,
      decisao_publicada: false,
      fonte, url: null, ano_publicacao: null,
    };
    if (it.tipo === "deliberacao") {
      atual.itens_na_fonte = (atual.itens_na_fonte ?? 0) + 1;
      atual.decisao_publicada = true;
    }
    if (!atual.data_reuniao && it.data_reuniao) atual.data_reuniao = it.data_reuniao;
    porNumero.set(numero, atual);
  }
  return [...porNumero.values()].sort((a, b) => a.numero - b.numero);
}

/** As reuniões da ANTT, pela página de cada reunião (a discovery já a busca): processos = itens. */
export function referenciaDaAntt(reunioes: AnttMeeting[], fonte: string): LinhaDeReferencia[] {
  const linhas: LinhaDeReferencia[] = [];
  for (const m of reunioes) {
    const numero = ordinalDeTextoDeReuniao(m.numero);
    if (numero === null || numero <= 0) continue;
    linhas.push({
      agencia: "ANTT",
      serie: m.tipo,
      numero,
      data_reuniao: m.data_inicio ?? null,
      itens_na_fonte: m.processos.length > 0 ? m.processos.length : null,
      decisao_publicada: m.documentos.length === 0
        ? null
        : m.documentos.some((d) => d.tipo === "deliberacao" || d.tipo === "ata" || d.tipo === "voto"),
      fonte, url: m.url_reuniao, ano_publicacao: null,
    });
  }
  return fundirReferencia(linhas);
}

/**
 * Funde linhas da MESMA reunião (ata e pauta da ANM; enumeração nova × gravada). O dado conhecido
 * vence o desconhecido; "decisão publicada" é OU (uma vez publicada, não despublica); itens é o
 * MAIOR visto (uma listagem que encolheu não pode reduzir o que a fonte já mostrou).
 */
export function fundirReferencia(linhas: LinhaDeReferencia[]): LinhaDeReferencia[] {
  const porChave = new Map<string, LinhaDeReferencia>();
  for (const l of linhas) {
    const k = `${l.agencia}|${l.serie ?? ""}|${l.numero}`;
    const a = porChave.get(k);
    if (!a) { porChave.set(k, { ...l }); continue; }
    a.data_reuniao = a.data_reuniao ?? l.data_reuniao;
    a.ano_publicacao = a.ano_publicacao ?? l.ano_publicacao;
    a.url = a.url ?? l.url;
    a.itens_na_fonte = a.itens_na_fonte === null ? l.itens_na_fonte
      : l.itens_na_fonte === null ? a.itens_na_fonte : Math.max(a.itens_na_fonte, l.itens_na_fonte);
    a.decisao_publicada = a.decisao_publicada === true || l.decisao_publicada === true ? true
      : a.decisao_publicada === false || l.decisao_publicada === false ? false : null;
  }
  return [...porChave.values()].sort((x, y) => x.numero - y.numero);
}

// ─── Gravação ───────────────────────────────────────────────────────────────

export interface TentativaDeFonte {
  fonte: string;
  /** `null` = a enumeração desta fonte foi boa. */
  erro: string | null;
  /** Enumeração cortada (orçamento/paginação): grava linhas, não carimba `ultima_boa_em`. */
  parcial: boolean;
  itens: number;
}

export type ResultadoDaGravacao =
  | { gravada: true; linhas: number; fontes_boas: number }
  | { gravada: false; motivo: string };

/**
 * Grava a referência de UMA agência. Degrada sem a migration (devolve o motivo, nunca lança).
 *
 * ⚠️ A decisão "substitui ou não" é POR FONTE: a fonte com erro, vazia ou parcial nunca carimba
 * `ultima_boa_em`. E as linhas de uma fonte com erro não entram — a página de desafio do WAF pode
 * ter "números" que não são reuniões.
 */
export async function gravarReferencia(
  db: { from: (t: string) => any },
  entrada: { agenciaId: string; linhas: LinhaDeReferencia[]; tentativas: TentativaDeFonte[]; agora?: Date },
): Promise<ResultadoDaGravacao> {
  const agora = (entrada.agora ?? new Date()).toISOString();
  const fontesValidas = new Set(entrada.tentativas.filter((t) => !t.erro && t.itens > 0).map((t) => t.fonte));
  const novas = entrada.linhas.filter((l) => fontesValidas.has(l.fonte));

  try {
    if (novas.length > 0) {
      // Funde com o que já está gravado: o dado conhecido não pode ser apagado por uma leitura que
      // não o trouxe (item contado ontem, data que a página de hoje não mostra).
      const { data: gravadas, error: errLeitura } = await db
        .from("reunioes_referencia")
        .select("serie, numero, data_reuniao, ano_publicacao, itens_na_fonte, decisao_publicada, fonte, url")
        .eq("agencia_id", entrada.agenciaId)
        .in("numero", [...new Set(novas.map((l) => l.numero))]);
      if (errLeitura) return { gravada: false, motivo: motivoDoErro(errLeitura) };
      const antigas: LinhaDeReferencia[] = ((gravadas ?? []) as any[]).map((g) => ({
        agencia: novas[0].agencia,
        serie: (g.serie || null) as SerieReuniao | null,
        numero: Number(g.numero),
        data_reuniao: g.data_reuniao ?? null,
        itens_na_fonte: g.itens_na_fonte ?? null,
        decisao_publicada: g.decisao_publicada ?? null,
        fonte: String(g.fonte), url: g.url ?? null, ano_publicacao: g.ano_publicacao ?? null,
      }));
      // As novas vêm PRIMEIRO: em `fundirReferencia` o primeiro dado conhecido vence, e a fonte e a
      // URL de hoje são as que valem; o que só a antiga sabia (data, itens maiores) é preservado.
      const fundidas = fundirReferencia([...novas, ...antigas])
        .filter((l) => novas.some((n) => n.numero === l.numero && (n.serie ?? "") === (l.serie ?? "")));
      const { error } = await db.from("reunioes_referencia").upsert(
        fundidas.map((l) => ({
          agencia_id: entrada.agenciaId,
          serie: l.serie ?? "",
          numero: l.numero,
          data_reuniao: l.data_reuniao,
          ano_publicacao: l.ano_publicacao,
          itens_na_fonte: l.itens_na_fonte,
          decisao_publicada: l.decisao_publicada,
          fonte: l.fonte,
          url: l.url,
          visto_em: agora,
        })),
        { onConflict: "agencia_id,serie,numero" },
      );
      if (error) return { gravada: false, motivo: motivoDoErro(error) };
    }

    let fontesBoas = 0;
    for (const t of entrada.tentativas) {
      const boa = !t.erro && !t.parcial && t.itens > 0;
      if (boa) fontesBoas++;
      const linha: Record<string, unknown> = {
        fonte: t.fonte, agencia_id: entrada.agenciaId, ultima_tentativa_em: agora,
        ultimo_erro: t.erro ?? (t.itens === 0 ? "a listagem não devolveu reunião nenhuma" : t.parcial ? "enumeração parcial" : null),
      };
      // ⚠️ Só a enumeração boa carimba. Upsert sem estas duas chaves PRESERVA o carimbo anterior.
      if (boa) { linha.ultima_boa_em = agora; linha.itens_na_ultima_boa = t.itens; }
      const { error } = await db.from("referencia_fontes").upsert(linha, { onConflict: "fonte" });
      if (error) return { gravada: false, motivo: motivoDoErro(error) };
    }
    return { gravada: true, linhas: novas.length, fontes_boas: fontesBoas };
  } catch (e) {
    return { gravada: false, motivo: motivoDoErro(e) };
  }
}

function motivoDoErro(e: unknown): string {
  const err = e as { code?: string; message?: string };
  // 42P01 = tabela inexistente (PostgREST devolve PGRST205 quando não acha no cache do schema).
  if (err?.code === "42P01" || err?.code === "PGRST205") {
    return "tabela da referência ausente — aplique a migration 20261004130000_reunioes_referencia.sql";
  }
  return err?.message ? String(err.message).slice(0, 200) : "falha ao gravar a referência";
}
