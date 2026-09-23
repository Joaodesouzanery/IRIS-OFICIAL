/**
 * Etapa 157 (Fase 29, commit 5) — uma linha por VOTO, com o PDF ao lado.
 *
 * ═══ O que faltava ═══
 * O operador pediu, com estas palavras: "eu não quero as deliberações em si, eu quero os votos de
 * cada diretor" e "seria possível visualizar de maneira simples qual foi o voto de X diretor
 * naquela deliberação?". Nada respondia isso: o relatório é agregado POR DIRETOR (só os
 * divergentes aparecem com nome), a amostra parte da deliberação e mostra 5 ao acaso, e o
 * drill-down do diretor não tem PDF nem rótulo lido/inferido.
 *
 * E a pergunta irmã — "os diretores não deveriam ter a mesma quantidade de votos?" — tem resposta
 * NÃO por causas legítimas (mandato, ausência, relatoria). O sintoma REAL é dentro da MESMA
 * deliberação: uns têm voto e outros não. É o que `colegiado-na-data.ts` torna visível.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  normalizarFiltros,
  janelaDeDatas,
  filtroOrigemPostgrest,
  LIMITE_PADRAO,
  LIMITE_MAXIMO,
} from "@/lib/server/auditoria-votos-filtros";
import { celulaCsv, linhaCsvDeVoto, montarCsv, CABECALHO_CSV, type LinhaDeVoto } from "@/lib/server/auditoria-votos-csv";
import { colegiadoNaData, esperadoVsPresente, type MandatoJanela } from "@/lib/server/colegiado-na-data";
import { isVotoNominal } from "@/lib/votos-nominal";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const filtros = (qs: string) => normalizarFiltros(new URLSearchParams(qs));

describe("etapa157 · os filtros não deixam valor livre chegar ao banco", () => {
  it.each([
    ["limit=abc", "limit", LIMITE_PADRAO],
    ["limit=99999", "limit", LIMITE_MAXIMO],
    ["limit=0", "limit", 1],
    ["page=0", "page", 1],
    ["page=-3", "page", 1],
    ["page=abc", "page", 1],
  ] as Array<[string, "limit" | "page", number]>)("%s → %s = %i", (qs, campo, esperado) => {
    const r = filtros(qs);
    expect(r.ok && r.filtros[campo]).toBe(esperado);
  });

  it.each([
    ["ano=1899", null],
    ["ano=20XX", null],
    ["ano=2026", "2026"],
  ] as Array<[string, string | null]>)("%s → ano %s (fora do formato é IGNORADO, não recusado)", (qs, esperado) => {
    const r = filtros(qs);
    expect(r.ok && r.filtros.ano).toBe(esperado);
  });

  it.each([
    "tipo_voto=favoravel",       // minúscula não é o valor do CHECK
    "tipo_voto=x' OR 1=1",       // valor livre nunca vai para `.eq()`
    "date_from=14/03/2026",      // pt-BR devolveria zero linhas sem dizer por quê
    "diretor_id=nao-e-uuid",
  ])("%s → 400 com motivo", (qs) => {
    const r = filtros(qs);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erro).toBeTruthy();
  });

  it("`tipo_voto` com espaços é normalizado, não recusado", () => {
    const r = filtros("tipo_voto=%20Favoravel%20");
    expect(r.ok && r.filtros.tipo_voto).toBe("Favoravel");
  });

  it("origem desconhecida vira SEM filtro — tratá-la como «inferido» inverteria a tela", () => {
    const desconhecida = filtros("origem=qualquer");
    expect(desconhecida.ok && desconhecida.filtros.origem).toBe(null);
    const lido = filtros("origem=lido");
    expect(lido.ok && lido.filtros.origem).toBe("lido");
  });

  it("`ano` é açúcar para a janela de datas, e o par explícito vence", () => {
    const so = filtros("ano=2026");
    expect(so.ok && janelaDeDatas(so.filtros)).toEqual({ de: "2026-01-01", ate: "2026-12-31" });
    const par = filtros("ano=2026&date_from=2026-03-01");
    expect(par.ok && janelaDeDatas(par.filtros)).toEqual({ de: "2026-03-01", ate: null });
  });
});

/**
 * O teste que vale mais: o predicado SQL classifica igual à função de domínio. São DUAS
 * implementações independentes (a estrutura do `or()` do PostgREST × `isVotoNominal`), não a
 * função comparada consigo mesma.
 */
describe("etapa157 · o filtro de origem concorda com `isVotoNominal`, linha a linha", () => {
  const PROVENIENCIAS = [null, "nominal", "revisao_humana", "inferido_unanimidade", "inferido_decisao"];

  /** Reproduz o predicado do PostgREST em JS, a partir da string que a rota envia. */
  function classificaPeloPredicado(proveniencia: string | null, isNominal: boolean): "lido" | "inferido" {
    const predicadoLido = filtroOrigemPostgrest("lido");
    const listaLido = predicadoLido.slice(predicadoLido.indexOf("(") + 1, predicadoLido.indexOf(")")).split(",");
    if (proveniencia !== null) return listaLido.includes(proveniencia) ? "lido" : "inferido";
    // O ramo `and(proveniencia.is.null, is_nominal.is.true)` — é ele que salva o acervo legado.
    return predicadoLido.includes("proveniencia.is.null,is_nominal.is.true") && isNominal ? "lido" : "inferido";
  }

  it.each(PROVENIENCIAS.flatMap((p) => [true, false].map((n) => [p, n] as [string | null, boolean])))(
    "proveniencia=%s is_nominal=%s", (proveniencia, isNominal) => {
      const doDominio = isVotoNominal({ proveniencia, is_nominal: isNominal }) ? "lido" : "inferido";
      expect(classificaPeloPredicado(proveniencia, isNominal)).toBe(doDominio);
    },
  );

  it("⚠️ o ramo do LEGADO não é opcional — `proveniencia` só existe desde 24/08/2026", () => {
    expect(filtroOrigemPostgrest("lido")).toContain("and(proveniencia.is.null,is_nominal.is.true)");
    expect(filtroOrigemPostgrest("inferido")).toContain("and(proveniencia.is.null,is_nominal.is.false)");
  });

  it("os dois baldes cobrem TODA proveniência — nenhuma escapa dos dois", () => {
    const lido = filtroOrigemPostgrest("lido");
    const inferido = filtroOrigemPostgrest("inferido");
    for (const p of ["nominal", "revisao_humana", "inferido_unanimidade", "inferido_decisao"]) {
      expect(lido.includes(p) || inferido.includes(p), `${p} não está em nenhum balde`).toBe(true);
    }
  });
});

describe("etapa157 · o CSV não desalinha nem mente", () => {
  const base: LinhaDeVoto = {
    agencia: "ANM", numero_reuniao: "83", numero_deliberacao: "ROP 83 item 12", data_reuniao: "2026-03-25",
    microtema: "Outorga", resultado: "Deferido", diretor: "Mauro H. Sousa",
    tipo_voto: "Favoravel", origem: "lido", proveniencia: "nominal", is_divergente: false,
    motivo_nao_voto: null, voto_em_autos: null, colegiado_esperado: 5, votos_na_deliberacao: 3,
    pdf_arquivo: "ata-83-rop.pdf", deliberacao_id: "d-1", voto_id: "v-1",
  };
  const linha = (over: Partial<LinhaDeVoto> = {}) => linhaCsvDeVoto({ ...base, ...over }, "https://x.app");

  it("o separador dentro do dado é escapado — senão as colunas deslizam no Excel", () => {
    expect(linha({ diretor: "Silva; Júnior" })).toContain('"Silva; Júnior"');
  });

  it("aspas viram aspas duplicadas", () => {
    expect(celulaCsv('ele disse "sim"')).toBe('"ele disse ""sim"""');
  });

  it("`null` vira campo VAZIO, nunca a palavra «null»", () => {
    expect(celulaCsv(null)).toBe("");
    expect(linha({ motivo_nao_voto: null })).not.toContain("null");
  });

  /** Divide respeitando aspas — `split(";")` cru quebraria no próprio campo que o código escapa. */
  const campos = (s: string): string[] => {
    const out: string[] = [];
    let atual = "";
    let dentro = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') { if (dentro && s[i + 1] === '"') { atual += '"'; i++; } else dentro = !dentro; continue; }
      if (c === ";" && !dentro) { out.push(atual); atual = ""; continue; }
      atual += c;
    }
    out.push(atual);
    return out;
  };

  it("⚠️ `voto_em_autos` NULL ≠ false — NULL é legado, e achatar apaga a diferença", () => {
    const iAutos = CABECALHO_CSV.indexOf("VotoEmAutos");
    expect(campos(linha({ voto_em_autos: null }))[iAutos]).toBe("");
    expect(campos(linha({ voto_em_autos: false }))[iAutos]).toBe("Nao");
    expect(campos(linha({ voto_em_autos: true }))[iAutos]).toBe("Sim");
  });

  it("toda linha tem exatamente o número de colunas do cabeçalho", () => {
    // O bug real registrado em `deliberacoes/export`: 12 valores para 16 headers.
    for (const over of [{}, { diretor: "a;b" }, { microtema: null }, { colegiado_esperado: null }, { resultado: 'com "aspas"' }]) {
      expect(campos(linha(over)).length, JSON.stringify(over)).toBe(CABECALHO_CSV.length);
    }
  });

  it("o link é de caminho de APP — endereço de API no Excel devolve erro de login", () => {
    expect(linha()).toContain("https://x.app/dashboard/deliberacoes/auditoria-votos?deliberacao_id=d-1");
    expect(linha()).not.toContain("/api/v1/");
  });

  it("⚠️ nada de URL assinada no arquivo — ela expira em 1h e o link morto lê como «o PDF sumiu»", () => {
    const CSV = ler("src/lib/server/auditoria-votos-csv.ts");
    expect(CSV).not.toMatch(/pdf_url/);
    expect(CABECALHO_CSV).toContain("ArquivoPDF");
  });

  it("truncagem vira LINHA no arquivo — `console.warn` não chega a quem abre a planilha", () => {
    expect(montarCsv([base], "https://x.app", true)).toMatch(/# AVISO: exportacao TRUNCADA em 1 linha/);
    expect(montarCsv([base], "https://x.app", false)).not.toMatch(/AVISO/);
  });

  it("BOM e CRLF — o Excel pt-BR abre sem quebrar acento", () => {
    const csv = montarCsv([base], "https://x.app", false);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("\r\n");
  });
});

describe("etapa157 · quantos DEVERIAM votar naquela data", () => {
  const m = (diretor: string, inicio: string | null, fim: string | null, ag = "ag1"): MandatoJanela =>
    ({ diretor_id: diretor, agencia_id: ag, data_inicio: inicio, data_fim: fim });

  it.each([
    ["mandato em curso (`data_fim` null) cobre hoje", [m("d1", "2024-01-01", null)], "2026-06-15", ["d1"]],
    ["borda de início é INCLUSIVA", [m("d1", "2026-06-15", null)], "2026-06-15", ["d1"]],
    ["borda de fim é INCLUSIVA", [m("d1", "2020-01-01", "2026-06-15")], "2026-06-15", ["d1"]],
    ["encerrado antes: fora", [m("d1", "2020-01-01", "2026-06-14")], "2026-06-15", []],
    ["começou depois: fora", [m("d1", "2026-06-16", null)], "2026-06-15", []],
    ["dois mandatos do MESMO diretor contam UM", [m("d1", "2020-01-01", "2025-01-01"), m("d1", "2025-01-02", null)], "2026-06-15", ["d1"]],
    ["outra agência não entra", [m("d1", "2020-01-01", null, "ag2")], "2026-06-15", []],
  ] as Array<[string, MandatoJanela[], string, string[]]>)("%s", (_n, mandatos, data, esperado) => {
    expect(colegiadoNaData(mandatos, "ag1", data).sort()).toEqual(esperado);
  });

  it("sem data de reunião não dá para saber — devolve vazio, não um palpite", () => {
    expect(colegiadoNaData([m("d1", "2020-01-01", null)], "ag1", null)).toEqual([]);
  });

  it("roster 5, votaram 3 → «3 de 5», com os dois que faltam nomeados", () => {
    const r = esperadoVsPresente(["a", "b", "c", "d", "e"], ["a", "b", "c"]);
    expect(r).toEqual({ esperado: 5, presente: 3, faltando: ["d", "e"], roster_conhecido: true });
  });

  it("⚠️ sem roster conhecido NÃO é «0 de 0, completo» — é roster desconhecido", () => {
    const r = esperadoVsPresente([], ["a", "b"]);
    expect(r.roster_conhecido).toBe(false);
    expect(r.faltando).toEqual([]);
  });

  it("os filtros do roster são os MESMOS do motor que cria os votos", () => {
    // Um selo que discorda de `getActiveDiretoresForVote` seria o pior desfecho possível numa
    // ferramenta feita para dar confiança.
    const rota = ler("src/app/api/v1/admin/auditoria/votos/route.ts");
    expect(rota).toMatch(/\.neq\("fonte_dado", "automatico"\)/);
    expect(rota).toMatch(/\.eq\("diretores\.review_status", "aprovado"\)/);
    const motor = ler("src/lib/server/vote-inference.ts");
    expect(motor).toMatch(/\.neq\("fonte_dado", "automatico"\)/);
    expect(motor).toMatch(/\.eq\("diretores\.review_status", "aprovado"\)/);
  });
});

describe("etapa157 · a rota segue as convenções, e pagina no banco", () => {
  const ROTA = ler("src/app/api/v1/admin/auditoria/votos/route.ts");
  const SEM_COMENTARIO = ROTA.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

  it("gate de demo ANTES do client, e `requireAdmin`", () => {
    expect(SEM_COMENTARIO).toMatch(/isDemo\(\) \|\| isDemoRequest\(req\)/);
    expect(SEM_COMENTARIO).toMatch(/requireAdmin\(req\)/);
    expect(SEM_COMENTARIO.indexOf("isDemoRequest(req)")).toBeLessThan(SEM_COMENTARIO.indexOf("createSupabaseServerClient"));
  });

  it("a tela pagina no BANCO — `lerTudo` aqui leria tudo para jogar 98% fora", () => {
    expect(SEM_COMENTARIO).toMatch(/count: "exact"/);
    expect(SEM_COMENTARIO).toMatch(/\.range\(desde, desde \+ f\.limit - 1\)/);
    const grandes = [...SEM_COMENTARIO.matchAll(/\.limit\(\s*(\d[\d_]*)\s*\)/g)]
      .map((x) => Number(x[1].replace(/_/g, ""))).filter((n) => n >= 1000);
    expect(grandes).toEqual([]);
  });

  it("⚠️ ordena o PAI, não o embed — `referencedTable` é o bug vivo do outro drill-down", () => {
    expect(SEM_COMENTARIO).toMatch(/\.order\("deliberacao\(data_reuniao\)"/);
    expect(SEM_COMENTARIO).not.toMatch(/referencedTable: "deliberacao"/);
    // …e a ordem é TOTAL: sem o desempate o `.range()` repete e pula linhas entre páginas.
    expect(SEM_COMENTARIO).toMatch(/\.order\("id", \{ ascending: false \}\)/);
  });

  it("o CSV usa `lerTudo` — disparo único, e a truncagem vai DENTRO do arquivo", () => {
    expect(SEM_COMENTARIO).toMatch(/lerTudo<any>\(\(\) => comFiltros\(db\.from\("votos"\)/);
    expect(SEM_COMENTARIO).toMatch(/montarCsv\(linhas, req\.nextUrl\.origin, truncado\)/);
  });

  it("`motivo_nao_voto` e `voto_em_autos` viajam — é a resposta a «por que menos votos»", () => {
    expect(SEM_COMENTARIO).toMatch(/motivo_nao_voto/);
    expect(SEM_COMENTARIO).toMatch(/voto_em_autos/);
  });

  it("o rótulo lido/inferido vem de `isVotoNominal` — a tela não reimplementa a regra", () => {
    expect(SEM_COMENTARIO).toMatch(/origem: isVotoNominal\(v\) \? "lido" : "inferido"/);
  });

  it("o PDF usa o helper com o fallback de item de ata", () => {
    expect(SEM_COMENTARIO).toMatch(/assinarPdfsDasDeliberacoes\(/);
    expect(SEM_COMENTARIO).not.toMatch(/deliberacoes\/\[id\]\/download/);
  });

  it("sem roster conhecido, a coluna vem VAZIA — nunca «completo»", () => {
    expect(SEM_COMENTARIO).toMatch(/colegiado_esperado: comparacao\.roster_conhecido \? comparacao\.esperado : null/);
  });
});

describe("etapa157 · a aba existe, é encontrável e não repete o 401 conhecido", () => {
  const TELA = ler("src/app/dashboard/deliberacoes/auditoria-votos/page.tsx");
  const TABS = ler("src/lib/module-tabs.ts");

  it("a aba está no menu — senão a tela existe e ninguém a encontra", () => {
    expect(TABS).toMatch(/href: "\/dashboard\/deliberacoes\/auditoria-votos"/);
  });

  it("⚠️ o CSV baixa por fetch AUTENTICADO + blob, nunca `window.location.href`", () => {
    // O middleware exige header Bearer em toda rota de /api/v1: um link direto devolve
    // "Login obrigatório" em vez do arquivo. É o defeito vivo de `deliberacoes/page.tsx`.
    expect(TELA).toMatch(/Authorization: `Bearer \$\{token\}`/);
    expect(TELA).not.toMatch(/window\.location\.href\s*=\s*["'`]\/api\/v1/);
  });

  it("todo filtro volta para a página 1 — senão a tela mostra vazio que é a página 7", () => {
    expect(TELA).toMatch(/function aoFiltrar<T>\(setter: \(v: T\) => void\)/);
    expect(TELA).toMatch(/setter\(v\); setPage\(1\);/);
  });

  it("a tela e o CSV mandam os MESMOS filtros — uma função só monta os parâmetros", () => {
    // `deliberacoes/export` aceita 4 dos 9 filtros da tela e exporta um conjunto diferente, em
    // silêncio. Rota irmã ou montagem duplicada produziria a mesma deriva.
    expect(TELA).toMatch(/function parametros\(paraCsv = false\)/);
    expect(TELA).toMatch(/parametros\(true\)/);
  });

  it("⚠️ o estado VAZIO diz por quê — tabela em branco lê como «o sistema perdeu os votos»", () => {
    expect(TELA).toMatch(/Nenhum voto de \$\{nomeDoDiretor\}/);
    expect(TELA).toMatch(/confira o período em Mandatos/);
  });

  it("`motivo_nao_voto` aparece na linha — o campo existia e ninguém o lia", () => {
    expect(TELA).toMatch(/MOTIVO_LABEL/);
    expect(TELA).toMatch(/impedimento: "impedimento"/);
  });

  it("sem roster conhecido, a coluna diz isso — nunca «completo»", () => {
    expect(TELA).toMatch(/roster desconhecido/);
    expect(TELA).not.toMatch(/0 de 0/);
  });

  it("o PDF abre em aba nova e com `rel` seguro; sem PDF é dito, não escondido", () => {
    expect(TELA).toMatch(/target="_blank" rel="noopener noreferrer"/);
    expect(TELA).toMatch(/sem PDF/);
  });
});
