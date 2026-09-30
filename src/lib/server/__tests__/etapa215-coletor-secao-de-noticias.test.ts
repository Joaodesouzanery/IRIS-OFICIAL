/**
 * Etapa 215 — "a fonte simplesmente não publicou" era FALSO, e a medição diz por quê.
 *
 * ═══ O que o painel afirmava em 30/09/2026 ═══
 *   "Sem publicação nova (coletor OK): ANS (89d) · ANA (29d) · ANCINE (12d) · ANPD (8d)
 *    — provável recesso/defeso eleitoral; a fonte simplesmente não publicou."
 *
 * ═══ O que a medição ao vivo mostrou ═══
 *   ANS  publicou em 28/09 · ANA publicou em 30/09 (o próprio dia do aviso).
 *   ANCINE (18/09) e ANPD (22/09) de fato não publicaram — ali o aviso estava CERTO.
 *
 * Três defeitos somados produziam a frase errada:
 *
 *  1. **A seção entrava como artigo.** `isNewsDetailUrl` conhecia três nomes de listagem e um
 *     `/defeso-eleitoral$/`; a seção da ANS chama-se `periodo-eleitoral` e não casava com nenhum.
 *
 *  2. **E, entrando, matava as notícias.** Sendo ANCESTRAL das 30 matérias, `pruneNewsLinks` as
 *     descartava como "sub-recursos" dela. Restava **1 link**.
 *
 *  3. **`1 !== 0` bastava para o aviso.** O laço de fallback saía na primeira irmã com qualquer
 *     coisa acima de zero, e `classificarFonte` só sabia testar `links_found === 0`.
 *
 * ⚠️ É a forma de erro da Fase 17 com o sinal trocado: lá um marcador que SEMPRE casa provava
 * "bloqueado pelo WAF"; aqui um número que quase nunca é zero provava "a fonte está quieta".
 *
 * MEDIDO DEPOIS DO CONSERTO, pelo pipeline real:
 *   ANS  → 71 links, 47 itens, mais nova 2026-09-28, listagem efetiva `.../noticias-1`
 *   ANA  → 121 links, 60 itens, mais nova 2026-09-30, efetiva `.../noticias-periodo-eleitoral-2026`
 *   ANTT → 149 links, status ok, efetiva `.../noticias-defeso-eleitoral`
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { pareceSecaoDeNoticias, pruneNewsLinks, siblingListingVariants } from "../news-collector";
import { classificarFonte, quietudeConferida, type HealthSource } from "../../news-health";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const COLETOR = semComentarios(ler("src/lib/server/news-collector.ts"));
const TELA = semComentarios(ler("src/app/dashboard/noticias/page.tsx"));

const link = (url: string) => ({ url, title: "t".repeat(20), imageUrl: null, imageSource: null, publishedAt: null });

describe("etapa215 · o predicado de SEÇÃO reconhece as formas vistas ao vivo", () => {
  it("as listagens", () => {
    for (const slug of ["noticias", "noticias-1", "noticias-2", "ultimas-noticias", "noticias-anteriores", "noticias-e-eventos", "noticias-comunicados"]) {
      expect(pareceSecaoDeNoticias(slug), slug).toBe(true);
    }
  });

  it("⚠️ e as do blackout eleitoral — inclusive a da ANS, que não casava com nada", () => {
    for (const slug of ["periodo-eleitoral", "defeso-eleitoral", "noticias-defeso-eleitoral", "noticias-periodo-eleitoral-2026", "2026-defeso-eleitoral"]) {
      expect(pareceSecaoDeNoticias(slug), slug).toBe(true);
    }
  });

  it("⚠️ e NÃO casa artigo — artigo descartado é notícia perdida em silêncio", () => {
    for (const slug of [
      "diretoria-colegiada-da-ans-tem-nova-composicao",
      "cosaude-analisa-inclusao-de-tecnologias-no-rol",
      "ana-promove-webinar-sobre-estruturacao-da-drenagem-urbana",
      "assinatura-do-contrato-da-rota-dos-sertoes-marca-novo-ciclo",
      "anac-publica-4a-edicao-do-manual-de-obras",
      "noticias-sobre-o-rol-de-procedimentos-tem-nova-consulta-publica",
      "",
    ]) {
      expect(pareceSecaoDeNoticias(slug), slug || "(vazio)").toBe(false);
    }
  });
});

describe("etapa215 · ⚠️ o prune deixa de matar as notícias pela seção que as contém", () => {
  const SECAO = "https://www.gov.br/ans/pt-br/assuntos/noticias-1/periodo-eleitoral";
  const artigos = [
    `${SECAO}/diretoria-colegiada-da-ans-tem-nova-composicao`,
    `${SECAO}/cosaude-analisa-inclusao-de-tecnologias-no-rol`,
    `${SECAO}/ans-abre-consulta-publica-sobre-o-rol`,
    `${SECAO}/reajuste-de-planos-individuais-tem-novo-limite`,
    `${SECAO}/ans-publica-painel-de-reclamacoes`,
  ];

  it("o caso REAL da ANS: 1 seção + 5 artigos devolve os 5 artigos, não a seção", () => {
    const sobrevivem = pruneNewsLinks([link(SECAO), ...artigos.map(link)]).map((l) => l.url);
    expect(sobrevivem.sort()).toEqual([...artigos].sort());
  });

  it("⚠️ e sobrevive mesmo com um nome de seção DESCONHECIDO — é a contagem que salva", () => {
    // Uma seção futura que a enumeração não conhece: a rede é "tem muitos descendentes".
    const desconhecida = "https://www.gov.br/xx/pt-br/assuntos/materias-2027";
    const filhos = Array.from({ length: 6 }, (_, i) => `${desconhecida}/materia-numero-${i}-com-slug-longo`);
    const sobrevivem = pruneNewsLinks([link(desconhecida), ...filhos.map(link)]).map((l) => l.url);
    expect(sobrevivem.sort()).toEqual([...filhos].sort());
  });

  it("o propósito ORIGINAL do prune continua valendo: sub-recurso de ARTIGO sai", () => {
    const artigo = "https://www.gov.br/anm/pt-br/assuntos/noticias/anm-aprova-novo-marco-da-mineracao";
    const sobrevivem = pruneNewsLinks([link(artigo), link(`${artigo}/anexo-tecnico`)]).map((l) => l.url);
    expect(sobrevivem).toEqual([artigo]);
  });

  it("e o artigo com poucos sub-recursos não é confundido com listagem", () => {
    const artigo = "https://www.gov.br/anm/pt-br/assuntos/noticias/anm-aprova-novo-marco-da-mineracao";
    const subs = ["anexo-tecnico", "galeria-de-fotos", "versao-em-libras"].map((n) => `${artigo}/${n}`);
    const sobrevivem = pruneNewsLinks([link(artigo), ...subs.map(link)]).map((l) => l.url);
    expect(sobrevivem, "3 sub-recursos ainda é artigo — o limiar é 4").toEqual([artigo]);
  });

  it("artigos irmãos passam todos — nenhum é ancestral de ninguém", () => {
    expect(pruneNewsLinks(artigos.map(link)).length).toBe(artigos.length);
  });
});

describe("etapa215 · o fallback deixa de aceitar 'qualquer coisa maior que zero'", () => {
  it("o laço guarda a MELHOR colheita em vez de sair na primeira", () => {
    expect(COLETOR, "voltou a sair na primeira irmã com qualquer link")
      .not.toMatch(/if \(variantLinks\.length > 0\) \{ effectiveSource = variant; links = variantLinks; break; \}/);
    expect(COLETOR).toMatch(/if \(!melhor \|\| variantLinks\.length > melhor\.links\.length\) melhor = \{ src: variant, links: variantLinks \}/);
  });

  it("e a saída antecipada exige o PISO, que é declarado e explicado", () => {
    expect(COLETOR).toMatch(/if \(variantLinks\.length >= PISO_DE_LISTAGEM\) break;/);
    expect(COLETOR).toMatch(/const PISO_DE_LISTAGEM = 10;/);
  });

  it("a descoberta de seção só corre quando a colheita é POBRE, e com orçamento", () => {
    const i = COLETOR.indexOf("if (links.length < PISO_DE_LISTAGEM && secoesVistas.length > 0)");
    expect(i, "a descoberta de seção passou a correr sempre (ou saiu)").toBeGreaterThan(-1);
    const bloco = COLETOR.slice(i, i + 900);
    expect(bloco, "sondagem de seção sem guarda de orçamento").toMatch(/hasBudget\(deep\?\.deadlineAt, 15_000\)/);
    expect(bloco, "a seção só vence se trouxer MAIS que o que já temos").toMatch(/if \(secaoLinks\.length > links\.length\)/);
    expect(bloco, "re-sondaria a listagem que já foi tentada").toMatch(/jaTentadas/);
  });

  it("⚠️ e ela roda ANTES de a fonte ser declarada vazia — depois seria inútil", () => {
    const descoberta = COLETOR.indexOf("if (links.length < PISO_DE_LISTAGEM && secoesVistas.length > 0)");
    const lanca = COLETOR.indexOf("throw new Error(EMPTY_LISTING_MSG)");
    expect(descoberta).toBeLessThan(lanca);
  });

  it("as irmãs conhecidas continuam sendo tentadas — ANTT depende delas", () => {
    const variantes = siblingListingVariants({
      agencia_sigla: "ANTT",
      fonte: "ANTT",
      url: "https://www.gov.br/antt/pt-br/assuntos/ultimas-noticias",
      strategy: "govbr",
    }).map((v) => v.url);
    expect(variantes[0], "a irmã do defeso deixou de ser a primeira tentativa")
      .toBe("https://www.gov.br/antt/pt-br/assuntos/noticias-defeso-eleitoral");
  });
});

describe("etapa215 · o aviso para de afirmar o que não mediu", () => {
  const fonte = (over: Partial<HealthSource> = {}): HealthSource => ({
    agencia_sigla: "ANS",
    total: 120,
    dias_sem_publicar: 89,
    ...over,
  });

  it("⚠️ o caso ANS/ANA: a fonte publicou e nós não temos → 'atrasada', não 'quieta'", () => {
    expect(classificarFonte(fonte({ is_stale: true, latest_links_found: 1 }))).toBe("atrasada");
    expect(classificarFonte(fonte({ is_stale: true, latest_links_found: 7 }))).toBe("atrasada");
  });

  it("e o que a FONTE mostra vence a contagem de links — inclusive com 0 links", () => {
    expect(classificarFonte(fonte({ is_stale: true, latest_links_found: 0 }))).toBe("atrasada");
  });

  it("⚠️ o caso ANCINE/ANPD: sem evidência de publicação nova, 'quieta' — e ali o aviso ESTAVA certo", () => {
    expect(classificarFonte(fonte({ dias_sem_publicar: 12, is_stale: false, latest_links_found: 48 }))).toBe("quieta");
    expect(classificarFonte(fonte({ dias_sem_publicar: 8, is_stale: false, latest_links_found: 44 }))).toBe("quieta");
  });

  it("o erro técnico continua vencendo tudo", () => {
    expect(classificarFonte(fonte({ active_error: true, is_stale: true }))).toBe("erro");
  });

  it("0 links comprovado segue sendo 'sem_itens'", () => {
    expect(classificarFonte(fonte({ latest_links_found: 0 }))).toBe("sem_itens");
  });

  it("⚠️ o caso ANAC: nada no acervo COM links achados é 'não gravou', não 'nunca'", () => {
    expect(classificarFonte(fonte({ total: 0, latest_links_found: 71 }))).toBe("nao_gravou");
    expect(classificarFonte(fonte({ total: 0, latest_links_found: 0 }))).toBe("nunca");
    expect(classificarFonte(fonte({ total: 0, latest_links_found: null }))).toBe("nunca");
  });

  it("dentro dos 7 dias nada é aviso", () => {
    expect(classificarFonte(fonte({ dias_sem_publicar: 3, latest_links_found: 0 }))).toBe("ok");
  });

  it("a quietude só é 'conferida' quando existe o que a fonte mostra", () => {
    expect(quietudeConferida(fonte({ latest_official_publicado_em: "2026-09-18T12:00:00Z" }))).toBe(true);
    expect(quietudeConferida(fonte({ latest_official_publicado_em: null }))).toBe(false);
    expect(quietudeConferida(fonte())).toBe(false);
  });
});

describe("etapa215 · e a tela diz a verdade em palavras", () => {
  it("⚠️ a frase que afirmava sobre a AGÊNCIA sem medir a agência saiu", () => {
    expect(TELA, "a tela voltou a afirmar que a fonte não publicou")
      .not.toMatch(/a fonte simplesmente não publicou/);
  });

  it("os dois estados novos têm consumidor — não é capacidade sem leitor", () => {
    for (const estado of ["atrasada", "nao_gravou"]) {
      expect(TELA, `o estado ${estado} nasceu sem consumidor na tela`).toContain(`=== "${estado}"`);
    }
    expect(TELA).toMatch(/fontesSaude\.atrasada\.length > 0/);
    expect(TELA).toMatch(/fontesSaude\.naoGravou\.length > 0/);
  });

  it("o aviso de atraso mostra as DUAS datas — a nossa e a da fonte", () => {
    const i = TELA.indexOf("A fonte publicou e nós não temos");
    expect(i).toBeGreaterThan(-1);
    const bloco = TELA.slice(i, i + 700);
    expect(bloco).toMatch(/s\.latest_publicado_em/);
    expect(bloco).toMatch(/s\.latest_official_publicado_em/);
  });

  it("e 'quieta' declara se foi conferida contra a fonte ou não", () => {
    const i = TELA.indexOf("Sem publicação nova");
    const bloco = TELA.slice(i, i + 900);
    expect(bloco).toMatch(/quietudeConferida\(s\)/);
    expect(bloco).toMatch(/Não conferido contra a fonte/);
  });
});
