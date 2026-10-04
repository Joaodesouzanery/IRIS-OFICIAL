/**
 * O LIVRO-RAZÃO de um ano — uma linha por reunião, seis portões, e o critério de "pronto" (Fase 38).
 *
 * ═══ Por que existe ═══
 * Até a Fase 37 cada fase consertava alguma coisa sem um critério de FIM: o placar dizia "43% na
 * ANM" e não dizia QUAL reunião faltava, nem por QUÊ, nem se o que falta é trabalho nosso ou dado
 * que só o DOU tem. Aqui cada reunião do ano vira uma linha com seis perguntas, em ordem:
 *
 *   1. listada   — o site publica e o banco tem? (a referência é a LISTAGEM do site, não o banco)
 *   2. data      — o banco tem UMA data, no ano, e ela bate com o site quando o site a diz?
 *   3. itens     — o banco tem todos os itens que a FONTE tem? (contados na fonte, nunca pelo
 *                  splitter — comparar o splitter com ele mesmo seria circular)
 *   4. campos    — cada item tem resultado, processo, interessado e (onde a agência nomina) relator?
 *   5. colegiado — quem votou tinha mandato na data, e o colegiado da data é conhecido?
 *   6. votos     — cada par (item × diretor esperado) tem linha em `votos`?
 *
 * Uma reunião está PRONTA quando os seis estão verdes. A agência está PRONTA quando ≥95% das
 * reuniões estão prontas E toda reunião restante tem bloqueio NOMEADO de dado externo (site fora do
 * ar, PDF ilegível, ata ainda não publicada, mandato que só o DOU dá). "Y de Y" não é a meta: é o
 * critério que impede declarar fim com trabalho nosso por fazer.
 *
 * ⚠️ PURO. Sem rede e sem banco: quem chama (o placar) já leu tudo. Os portões 5 e 6 usam
 * `medirReuniao`, a MESMA régua do placar — um livro com régua própria daria um segundo veredito
 * sobre o mesmo conceito, e a Fase 21 mediu o preço disso.
 */

import { medirReuniao } from "@/lib/server/placar";
import type { MandatoJanela } from "@/lib/server/colegiado-na-data";
import type { SerieReuniao } from "@/lib/server/reunioes";

export const PORTOES = ["listada", "data", "itens", "campos", "colegiado", "votos"] as const;
export type Portao = (typeof PORTOES)[number];

export type EstadoDoPortao = "verde" | "vermelho" | "sem_medida";
/**
 * De quem é o bloqueio. ⚠️ É a metade do critério de fim: `externo` é o que nenhum código nosso
 * resolve (site fora do ar, PDF sem texto, ata não publicada, mandato sem DOU); `nosso` é trabalho.
 */
export type DonoDoBloqueio = "nosso" | "externo";

export interface VereditoDoPortao {
  portao: Portao;
  estado: EstadoDoPortao;
  motivo: string | null;
  dono: DonoDoBloqueio | null;
}

/** Meta de reuniões prontas por agência, em %. */
export const META_PRONTAS_PCT = 95;
/** Dias sem uma enumeração BOA do site até a referência ser marcada desatualizada. */
export const DIAS_ATE_DESATUALIZAR = 7;
/**
 * Folga entre âncoras de dispositivo do PDF e itens no banco. É a MESMA do C03
 * (`checarAncorasItens`): duplicata legítima dentro da ata e item retirado de pauta mexem na conta
 * em até dois. Só vale para a contagem por ÂNCORA; contagem de LISTAGEM é exata.
 */
export const FOLGA_DE_ANCORAS = 2;

// ─── Pertença ao ano ────────────────────────────────────────────────────────

/**
 * Âncora de série: o último número sabidamente do ano ANTERIOR e o primeiro sabidamente do ano.
 *
 * ⚠️ POR QUE ÂNCORA E NÃO A DATA DA PÁGINA. Medido ao vivo em 04/10: o ano que o portal da ANM
 * mostra ao lado de cada ata é o da PUBLICAÇÃO, não o da reunião. A 79ª ROP (26/11/2025) aparece
 * com 2026 no arquivo; a 34ª REP (19/11/2025) também. Filtrar pelo ano da página põe reunião de
 * 2025 no denominador de 2026. A numeração das séries é monotônica, então UM par conhecido de
 * datas (80ª = 17/12/2025, 81ª = 28/01/2026) decide todos os números da série.
 *
 * Entre `ultimo_do_anterior` e `primeiro_do_ano` (ou acima do último quando o primeiro não é
 * conhecido) a resposta é `incerto` — e incerto ENTRA na conta com o motivo, nunca some.
 */
export interface AncoraDeAno {
  agencia: string;
  serie: SerieReuniao;
  ano: number;
  ultimo_do_anterior: number;
  primeiro_do_ano: number | null;
  fonte: string;
}

export const ANCORAS_DE_ANO: AncoraDeAno[] = [
  {
    agencia: "ANM", serie: "ordinaria", ano: 2026, ultimo_do_anterior: 80, primeiro_do_ano: 81,
    fonte: "atas oficiais: 80ª ROP em 17/12/2025, 81ª ROP em 28/01/2026",
  },
  {
    // A 35ª REP ainda não existe na listagem (04/10/2026); quando aparecer, entra como «incerto»
    // até alguém pôr aqui a data dela — a 34ª é de 19/11/2025 e não prova nada sobre a próxima.
    agencia: "ANM", serie: "extraordinaria", ano: 2026, ultimo_do_anterior: 34, primeiro_do_ano: null,
    fonte: "ata oficial: 34ª REP em 19/11/2025",
  },
];

export type Pertenca = "sim" | "nao" | "incerto";

export function pertencaAoAno(
  ref: { agencia: string; serie: SerieReuniao | null; numero: number; data_reuniao: string | null },
  ano: number,
  ancoras: AncoraDeAno[] = ANCORAS_DE_ANO,
): Pertenca {
  if (ref.data_reuniao) return ref.data_reuniao.slice(0, 4) === String(ano) ? "sim" : "nao";
  const a = ancoras.find((x) => x.agencia === ref.agencia && x.serie === ref.serie && x.ano === ano);
  if (!a) return "incerto";
  if (ref.numero <= a.ultimo_do_anterior) return "nao";
  if (a.primeiro_do_ano !== null && ref.numero >= a.primeiro_do_ano) return "sim";
  return "incerto";
}

// ─── Entradas ───────────────────────────────────────────────────────────────

/** Uma reunião como a LISTAGEM do site a mostra. */
export interface ReuniaoDeReferencia {
  agencia: string;
  serie: SerieReuniao | null;
  numero: number;
  /** Data da reunião quando a listagem a dá (ANTT, ARTESP). A ANM não dá — só a de publicação. */
  data_reuniao: string | null;
  /** Itens que a FONTE mostra: processos da reunião (ANTT), deliberações listadas (ARTESP). */
  itens_na_fonte: number | null;
  /**
   * Há documento de DECISÃO publicado (ata na ANM; deliberação/ata/voto na ANTT; deliberação na
   * ARTESP)? `false` = só a pauta saiu — a reunião ainda não tem o que coletar, e isso é bloqueio
   * EXTERNO, não falta nossa. `null` = a fonte não permite distinguir.
   */
  decisao_publicada: boolean | null;
}

export interface ItemNoBanco {
  id: string;
  resultado: string | null;
  processo: string | null;
  interessado: string | null;
  relator: string | null;
  /** Diretores com linha em `votos` para este item (voto OU motivo de não voto). */
  respondido_por: string[];
}

/** Uma reunião como o BANCO a tem — itens finais agrupados por (agência, série, número). */
export interface ReuniaoDoAcervo {
  agencia: string;
  agencia_id: string;
  serie: string | null;
  numero: number;
  /** As datas distintas gravadas nos itens. Mais de uma é defeito: o mesmo número em dois dias. */
  datas: string[];
  itens: ItemNoBanco[];
  /** Âncoras de dispositivo contadas no TEXTO da ata (ANM). `null` = não medido. */
  ancoras_da_ata: number | null;
  /** O documento da ata existe e não tem texto — PDF escaneado/ilegível. */
  ata_sem_texto: boolean;
}

export interface EstadoDaReferencia {
  disponivel: boolean;
  ultima_boa_em: string | null;
  desatualizada: boolean;
  motivo: string | null;
}

export interface LinhaDoLivro {
  agencia: string;
  serie: string | null;
  numero: number;
  data_reuniao: string | null;
  pertenca: Pertenca;
  portoes: VereditoDoPortao[];
  pronta: boolean;
  /** O primeiro portão que não está verde — é por onde se começa a trabalhar a reunião. */
  primeiro_portao_aberto: Portao | null;
  /** Todos os portões abertos são de dado externo: a reunião tem bloqueio NOMEADO. */
  bloqueio_externo: boolean;
}

export interface ResumoDoLivro {
  total: number;
  prontas: number;
  pct: number;
  /** Reuniões abertas por PRIMEIRO portão aberto. */
  abertas_por_portao: Record<Portao, number>;
  bloqueio_externo: number;
  /** Abertas com pelo menos um portão nosso: o trabalho que falta. */
  trabalho_nosso: number;
  referencia: EstadoDaReferencia;
  /** A meta: ≥95% prontas e nenhuma aberta por trabalho nosso. */
  pronto: boolean;
}

// ─── Os portões ─────────────────────────────────────────────────────────────

const verde = (portao: Portao, motivo: string | null = null): VereditoDoPortao =>
  ({ portao, estado: "verde", motivo, dono: null });
const vermelho = (portao: Portao, motivo: string, dono: DonoDoBloqueio): VereditoDoPortao =>
  ({ portao, estado: "vermelho", motivo, dono });
/** Falta a MEDIDA deste portão (ex.: sem contagem na fonte) — é trabalho, então tem dono. */
const semMedida = (portao: Portao, motivo: string, dono: DonoDoBloqueio = "nosso"): VereditoDoPortao =>
  ({ portao, estado: "sem_medida", motivo, dono });
/**
 * O portão não pode ser medido porque um ANTERIOR está aberto. ⚠️ Sem dono, de propósito: o dono é
 * de quem bloqueia. Dar "nosso" aqui transformava toda reunião com só a pauta publicada (bloqueio
 * externo no portão 1) em "trabalho nosso" nos portões 2–6 — e o critério de fim nunca fecharia.
 */
const depende = (portao: Portao, motivo: string): VereditoDoPortao =>
  ({ portao, estado: "sem_medida", motivo, dono: null });

function juntarBanco(grupos: ReuniaoDoAcervo[]): ReuniaoDoAcervo | null {
  if (grupos.length === 0) return null;
  if (grupos.length === 1) return grupos[0];
  const base = grupos[0];
  const ancoras = grupos.map((g) => g.ancoras_da_ata).filter((n): n is number => n !== null);
  return {
    ...base,
    serie: grupos.find((g) => g.serie)?.serie ?? null,
    datas: [...new Set(grupos.flatMap((g) => g.datas))].sort(),
    itens: grupos.flatMap((g) => g.itens),
    ancoras_da_ata: ancoras.length > 0 ? Math.max(...ancoras) : null,
    ata_sem_texto: grupos.some((g) => g.ata_sem_texto),
  };
}

export interface ContextoDoLivro {
  ano: number;
  mandatos: MandatoJanela[];
  /** Por sigla: a agência nomina o relator? (`CAPACIDADE_POR_EIXO.relatoria === "nominal"`) */
  exigeRelator: Record<string, boolean>;
  nomeDe?: (diretorId: string) => string;
}

export function avaliarReuniao(
  ref: ReuniaoDeReferencia | null,
  banco: ReuniaoDoAcervo | null,
  referencia: EstadoDaReferencia,
  ctx: ContextoDoLivro,
): VereditoDoPortao[] {
  const nomeDe = ctx.nomeDe ?? ((id: string) => id);
  const out: VereditoDoPortao[] = [];

  // ── 1. listada ──
  if (!referencia.disponivel) {
    // ⚠️ Fonte cega é VERMELHO com motivo, nunca "0 reuniões": uma listagem vazia por WAF tornaria
    // a conferência mais verde quanto menos enxergasse (Fase 17).
    out.push(vermelho("listada", `referência do site indisponível — ${referencia.motivo ?? "nenhuma enumeração boa gravada"}`, "externo"));
  } else if (ref && !banco) {
    out.push(ref.decisao_publicada === false
      ? vermelho("listada", "só a pauta foi publicada — nenhum documento de decisão saiu ainda", "externo")
      : vermelho("listada", "o site publica esta reunião e o banco não tem nenhum item final dela", "nosso"));
  } else if (!ref && banco) {
    out.push(vermelho("listada",
      "o banco tem esta reunião e a listagem do site não mostra — número lido errado ou listagem que encolheu",
      "nosso"));
  } else {
    out.push(verde("listada"));
  }

  // ── 2. data ──
  if (!banco) {
    out.push(depende("data", "depende do portão 1 — o banco não tem a reunião"));
  } else if (banco.datas.length > 1) {
    out.push(vermelho("data", `${banco.datas.length} datas para o mesmo número (${banco.datas.join(", ")})`, "nosso"));
  } else if (banco.datas.length === 0) {
    out.push(vermelho("data", "nenhum item tem data gravada", "nosso"));
  } else if (banco.datas[0].slice(0, 4) !== String(ctx.ano)) {
    out.push(vermelho("data", `gravada em ${banco.datas[0]}, fora de ${ctx.ano} — é o passo «redatar», não a coleta`, "nosso"));
  } else if (ref?.data_reuniao && ref.data_reuniao !== banco.datas[0]) {
    out.push(vermelho("data", `o site diz ${ref.data_reuniao}, o banco tem ${banco.datas[0]}`, "nosso"));
  } else {
    out.push(verde("data"));
  }

  // ── 3. itens ──
  if (!banco) {
    out.push(depende("itens", "depende do portão 1"));
  } else if (banco.itens.length === 0) {
    out.push(vermelho("itens", "a reunião não tem nenhum item final no banco", "nosso"));
  } else {
    const n = banco.itens.length;
    if (ref?.itens_na_fonte != null && ref.itens_na_fonte > 0) {
      out.push(n < ref.itens_na_fonte
        ? vermelho("itens", `faltam ${ref.itens_na_fonte - n} item(ns): a listagem do site tem ${ref.itens_na_fonte}, o banco ${n}`, "nosso")
        : verde("itens", n > ref.itens_na_fonte ? `o banco tem ${n - ref.itens_na_fonte} a mais que a listagem (${ref.itens_na_fonte})` : null));
    } else if (banco.ancoras_da_ata !== null && banco.ancoras_da_ata > 0) {
      const a = banco.ancoras_da_ata;
      out.push(n < a - FOLGA_DE_ANCORAS
        ? vermelho("itens", `faltam ~${a - n} item(ns): a ata tem ${a} âncoras de dispositivo, o banco ${n}`, "nosso")
        : verde("itens"));
    } else if (banco.ata_sem_texto) {
      out.push(vermelho("itens", "o PDF da ata não tem texto (escaneado/ilegível) — não há como contar os itens", "externo"));
    } else {
      out.push(semMedida("itens", "sem contagem na fonte (nem listagem com itens, nem texto da ata)"));
    }
  }

  // ── 4. campos ──
  if (!banco || banco.itens.length === 0) {
    out.push(depende("campos", "depende dos itens"));
  } else {
    const exigeRelator = ctx.exigeRelator[banco.agencia] === true;
    const vazio = (v: string | null) => !v || !String(v).trim();
    const faltas: Array<[string, number]> = [
      ["resultado", banco.itens.filter((i) => vazio(i.resultado)).length],
      ["processo", banco.itens.filter((i) => vazio(i.processo)).length],
      ["interessado", banco.itens.filter((i) => vazio(i.interessado)).length],
      ...(exigeRelator ? [["relator", banco.itens.filter((i) => vazio(i.relator)).length] as [string, number]] : []),
    ];
    const abertas = faltas.filter(([, k]) => k > 0);
    out.push(abertas.length === 0
      ? verde("campos")
      : vermelho("campos", `de ${banco.itens.length} itens: ${abertas.map(([c, k]) => `sem ${c} em ${k}`).join(", ")}`, "nosso"));
  }

  // ── 5 e 6. colegiado e votos — dependem da DATA, porque o colegiado é o da data ──
  const dataVerde = out[1].estado === "verde";
  if (!banco || !dataVerde) {
    out.push(depende("colegiado", "depende da data (portão 2) — o colegiado é o da data da reunião"));
    out.push(depende("votos", "depende da data (portão 2)"));
    return out;
  }
  const votantes = [...new Set(banco.itens.flatMap((i) => i.respondido_por))];
  const medida = medirReuniao(
    {
      agencia: banco.agencia, serie: banco.serie, numero_reuniao: String(banco.numero),
      data_reuniao: banco.datas[0], votantes,
      itens: banco.itens.map((i) => ({ id: i.id, respondido_por: i.respondido_por })),
    },
    banco.agencia_id,
    ctx.mandatos,
  );
  if (!medida.roster_conhecido) {
    out.push(vermelho("colegiado", `nenhum mandato cadastrado em ${banco.datas[0]} — depende do DOU`, "externo"));
    out.push(depende("votos", "depende do colegiado (portão 5)"));
    return out;
  }
  out.push(medida.extra.length > 0
    ? vermelho("colegiado",
        `${medida.extra.length} votante(s) sem mandato na data (${medida.extra.map(nomeDe).join(", ")}) — cadastro/DOU`,
        "externo")
    : verde("colegiado"));

  if (medida.classe_estrita === "completa") {
    out.push(verde("votos"));
  } else {
    const sem = medida.cobertura
      .filter((c) => c.respondidos < c.de)
      .sort((x, y) => x.respondidos - y.respondidos)
      .slice(0, 4)
      .map((c) => `${nomeDe(c.diretor_id)} sem voto em ${c.de - c.respondidos} de ${c.de}`);
    out.push(vermelho("votos",
      `${medida.pares_esperados - medida.pares_respondidos} de ${medida.pares_esperados} pares sem voto — ${sem.join("; ")}`,
      "nosso"));
  }
  return out;
}

// ─── O livro ────────────────────────────────────────────────────────────────

const chaveNum = (agencia: string, numero: number) => `${agencia}|${numero}`;

/** Série compatível: iguais, ou um dos lados não sabe (o banco tem passivo de série nula). */
const seriesCasam = (a: string | null, b: string | null) => a === null || b === null || a === b;

export function montarLivroRazao(entrada: {
  referencia: ReuniaoDeReferencia[];
  banco: ReuniaoDoAcervo[];
  estadoDaReferencia: Record<string, EstadoDaReferencia>;
  agencias: string[];
  ctx: ContextoDoLivro;
}): { linhas: LinhaDoLivro[]; por_agencia: Record<string, ResumoDoLivro> } {
  const { ctx } = entrada;
  const indisponivel: EstadoDaReferencia = {
    disponivel: false, ultima_boa_em: null, desatualizada: true, motivo: "nenhuma enumeração boa gravada",
  };

  const bancoPorNumero = new Map<string, ReuniaoDoAcervo[]>();
  for (const b of entrada.banco) {
    const k = chaveNum(b.agencia, b.numero);
    bancoPorNumero.set(k, [...(bancoPorNumero.get(k) ?? []), b]);
  }
  const usados = new Set<ReuniaoDoAcervo>();
  const linhas: LinhaDoLivro[] = [];

  const fechar = (
    agencia: string, serie: string | null, numero: number, pertenca: Pertenca,
    ref: ReuniaoDeReferencia | null, banco: ReuniaoDoAcervo | null,
  ) => {
    const est = entrada.estadoDaReferencia[agencia] ?? indisponivel;
    const portoes = avaliarReuniao(ref, banco, est, ctx);
    if (pertenca === "incerto" && portoes[0].estado === "verde" && !banco?.datas.some((d) => d.startsWith(String(ctx.ano)))) {
      portoes[0] = vermelho("listada", "ano incerto: o site não dá a data e o número está fora das âncoras", "nosso");
    }
    const abertos = portoes.filter((p) => p.estado !== "verde");
    linhas.push({
      agencia, serie, numero,
      data_reuniao: ref?.data_reuniao ?? (banco?.datas.length === 1 ? banco.datas[0] : null),
      pertenca, portoes,
      pronta: abertos.length === 0,
      primeiro_portao_aberto: abertos[0]?.portao ?? null,
      // Externo = há bloqueio externo e NENHUM portão com trabalho nosso (dependência não tem dono).
      bloqueio_externo: abertos.some((p) => p.dono === "externo") && !abertos.some((p) => p.dono === "nosso"),
    });
  };

  // (a) A partir da referência: o denominador é o que o SITE publica.
  for (const ref of entrada.referencia) {
    const pertenca = pertencaAoAno(ref, ctx.ano);
    if (pertenca === "nao") continue;
    const candidatos = (bancoPorNumero.get(chaveNum(ref.agencia, ref.numero)) ?? [])
      .filter((b) => seriesCasam(ref.serie, b.serie));
    for (const c of candidatos) usados.add(c);
    fechar(ref.agencia, ref.serie, ref.numero, pertenca, ref, juntarBanco(candidatos));
  }

  // (b) O que o banco tem no ano e a referência não mostra. ⚠️ Entra no denominador: deixá-lo de
  // fora faria uma listagem que encolheu parecer cobertura completa.
  for (const b of entrada.banco) {
    if (usados.has(b)) continue;
    if (!b.datas.some((d) => d.startsWith(String(ctx.ano)))) continue;
    const irmaos = entrada.banco.filter((x) => !usados.has(x) && x.agencia === b.agencia && x.numero === b.numero && seriesCasam(x.serie, b.serie));
    for (const x of irmaos) usados.add(x);
    fechar(b.agencia, b.serie, b.numero, "sim", null, juntarBanco(irmaos));
  }

  linhas.sort((x, y) => x.agencia.localeCompare(y.agencia) || String(x.serie).localeCompare(String(y.serie)) || x.numero - y.numero);

  const por_agencia: Record<string, ResumoDoLivro> = {};
  for (const sigla of entrada.agencias) {
    const minhas = linhas.filter((l) => l.agencia === sigla);
    const prontas = minhas.filter((l) => l.pronta).length;
    const abertas_por_portao = Object.fromEntries(PORTOES.map((p) => [p, 0])) as Record<Portao, number>;
    for (const l of minhas) if (l.primeiro_portao_aberto) abertas_por_portao[l.primeiro_portao_aberto]++;
    const bloqueioExterno = minhas.filter((l) => l.bloqueio_externo).length;
    const trabalhoNosso = minhas.filter((l) => !l.pronta && !l.bloqueio_externo).length;
    const pct = minhas.length > 0 ? Math.round((prontas / minhas.length) * 1000) / 10 : 0;
    const referencia = entrada.estadoDaReferencia[sigla] ?? indisponivel;
    por_agencia[sigla] = {
      total: minhas.length,
      prontas,
      pct,
      abertas_por_portao,
      bloqueio_externo: bloqueioExterno,
      trabalho_nosso: trabalhoNosso,
      referencia,
      // ⚠️ Sem referência não há denominador, e sem denominador não há "pronto" — por mais verde que
      // o banco esteja. É o mesmo princípio da Fase 17: o instrumento não pode ficar mais verde
      // quanto menos enxerga.
      pronto: referencia.disponivel && minhas.length > 0 && pct >= META_PRONTAS_PCT && trabalhoNosso === 0,
    };
  }
  return { linhas, por_agencia };
}

/** Estado da referência de uma agência a partir das fontes gravadas. */
export function estadoDaReferencia(
  fontes: Array<{ ultima_boa_em: string | null; ultima_tentativa_em: string | null; ultimo_erro: string | null }>,
  agora: Date,
  dias = DIAS_ATE_DESATUALIZAR,
): EstadoDaReferencia {
  const boas = fontes.map((f) => f.ultima_boa_em).filter((d): d is string => Boolean(d)).sort();
  if (boas.length === 0) {
    const erro = fontes.map((f) => f.ultimo_erro).find(Boolean) ?? null;
    return { disponivel: false, ultima_boa_em: null, desatualizada: true, motivo: erro ?? "nenhuma enumeração boa gravada" };
  }
  // A referência vale pela fonte MAIS ANTIGA: uma fonte boa hoje não atualiza a outra, parada há um mês.
  const maisAntiga = boas[0];
  const idadeDias = (agora.getTime() - new Date(maisAntiga).getTime()) / 86_400_000;
  const desatualizada = idadeDias > dias;
  const erroRecente = fontes.find((f) => f.ultimo_erro && f.ultima_tentativa_em && (!f.ultima_boa_em || f.ultima_tentativa_em > f.ultima_boa_em));
  return {
    disponivel: true,
    ultima_boa_em: maisAntiga,
    desatualizada,
    motivo: desatualizada
      ? `última enumeração boa em ${maisAntiga.slice(0, 10)} (há ${Math.floor(idadeDias)} dias)`
      : erroRecente ? `a última tentativa falhou (${erroRecente.ultimo_erro}) — vale a de ${maisAntiga.slice(0, 10)}` : null,
  };
}
