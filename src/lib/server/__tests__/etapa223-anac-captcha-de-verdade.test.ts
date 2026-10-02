/**
 * Etapa 223 (Fase 36, continuação) — a ANAC, e por que "sem nenhuma notícia" era meia-verdade.
 *
 * ═══ MEDIDO ao vivo em 01/10/2026 ═══
 * `https://www.gov.br/anac/pt-br/noticias` devolveu HTTP 200, 43-44 KB, SEM `<title>`, com cookies
 * `TS...=` (marca de um produto F5 BIG-IP), e o CORPO é um CAPTCHA de imagem de verdade: "What code
 * is in the image?", botão `id="jar"`, campo `id="ans"`, rodapé "Your support ID is: <número>". A
 * MESMA URL, pedida de novo segundos depois, devolveu o MESMO desafio — e um artigo conhecido
 * (`anac-publica-4a-edicao-do-manual-de-obras-aeroportuarias`) também. **Não é um bug nosso.** É a
 * mesma forma do que a Fase 17 já viu (WAF) com um produto diferente — mas ali o marcador era um
 * SENSOR presente em toda página (falso positivo); aqui é o CONTEÚDO inteiro substituído por um
 * CAPTCHA (sinal real).
 *
 * ⚠️ O que isto NÃO autoriza: resolver o CAPTCHA programaticamente. A medida certa é DETECTAR e
 * REPORTAR com honestidade — não tentar vencer a verificação.
 *
 * ⚠️ E DUAS causas somadas explicavam o "sem nenhuma notícia", e só uma é esta:
 *  (a) o CAPTCHA zera `links_found` de verdade (este arquivo);
 *  (b) dois `.limit()` GLOBAIS no `/health` (`regulatory_news` e `regulatory_news_collection_runs`)
 *      ordenavam TODAS as agências juntas antes de cortar — uma fonte quieta tinha as próprias
 *      linhas empurradas para fora por volume de OUTRA agência, e `total`/`latestRun` liam o banco
 *      errado. É a MESMA forma de erro que a Fase 24b catalogou cinco vezes.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { looksLikeChallenge } from "../monitoring";
import { classificarFonte, erroCurto, type HealthSource } from "../../news-health";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const COLETOR = semComentarios(ler("src/lib/server/news-collector.ts"));
const ROTA_COLETAR = semComentarios(ler("src/app/api/v1/noticias/coletar/route.ts"));
const ROTA_HEALTH = semComentarios(ler("src/app/api/v1/noticias/health/route.ts"));
const TELA = semComentarios(ler("src/app/dashboard/noticias/page.tsx"));

/** O corpo REAL capturado da ANAC em 01/10/2026 (recortado; preserva os marcadores que casam). */
const CORPO_REAL_ANAC = `<!DOCTYPE html><html><head><meta http-equiv="Pragma" content="no-cache"/>
<script>window["bobcmn"]="101110111110102000000062000000052";</script></head>
<body><img alt="bottle" class="thumbnails"/><b>What code is in the image?</b>
<input type="text" id="ans" name="answer" value=""/><button id="jar" type="button">submit</button>
Your support ID is: 15532754753190659625.</body></html>`;

describe("etapa223 · o marcador do CAPTCHA, verificado contra o corpo REAL", () => {
  it("o corpo capturado da ANAC é reconhecido", () => {
    expect(looksLikeChallenge(CORPO_REAL_ANAC)).toBe(true);
  });

  it("⚠️ e não precisa de corroboração — ao contrário do sensor Incapsula da Fase 17", () => {
    // "Your support ID is:" só aparece na página de BLOQUEIO, nunca em conteúdo real — diferente do
    // `_Incapsula_Resource`, que roda em toda página do portal (bloqueada ou não).
    const soOMarcador = "<html><body>Your support ID is: 123.</body></html>";
    expect(looksLikeChallenge(soOMarcador)).toBe(true);
  });

  it("conteúdo real de notícia não casa", () => {
    const real = "<html><head><title>ANAC publica edição do manual</title></head><body>" +
      "<article><h2>ANAC publica 4ª edição do manual de obras aeroportuárias</h2>" +
      "<p>A Agência Nacional de Aviação Civil publicou...</p></article></body></html>";
    expect(looksLikeChallenge(real)).toBe(false);
  });

  it("html vazio não casa", () => {
    expect(looksLikeChallenge("")).toBe(false);
  });
});

describe("etapa223 · o coletor distingue BLOQUEIO das outras duas causas de zero", () => {
  it("a listagem é checada pelo desafio ANTES de tentar extrair paginação dela", () => {
    const i = COLETOR.indexOf("async function fetchListingPages");
    const j = COLETOR.indexOf("if (bloqueios && looksLikeChallenge(firstHtml))");
    expect(i).toBeGreaterThan(-1);
    expect(j, "a checagem de desafio sumiu de fetchListingPages").toBeGreaterThan(i);
  });

  it("⚠️ detectado o bloqueio, NÃO tenta mais páginas da mesma listagem", () => {
    const i = COLETOR.indexOf("if (bloqueios && looksLikeChallenge(firstHtml))");
    const bloco = COLETOR.slice(i, i + 300);
    expect(bloco).toMatch(/return \[\{ url: source\.url, html: firstHtml \}\];/);
  });

  it("e o retry por 'página degradada' NÃO roda quando já é bloqueio confirmado", () => {
    expect(COLETOR).toMatch(/links\.length === 0 && source\.strategy === "govbr" && bloqueios\.length === 0/);
  });

  it("⚠️ BLOQUEIO tem prioridade sobre o erro de rede genérico ao decidir a causa do zero", () => {
    const i = COLETOR.indexOf("if (links.length === 0) {");
    const ultimo = COLETOR.lastIndexOf("if (links.length === 0) {");
    const bloco = COLETOR.slice(ultimo, ultimo + 400);
    expect(bloco).toMatch(/if \(bloqueios\.length > 0\) throw new Error\(BLOQUEIO_ANTIRROBO_MSG\);/);
    const posBloqueio = bloco.indexOf("BLOQUEIO_ANTIRROBO_MSG");
    const posPrimaryError = bloco.indexOf("if (primaryError) throw primaryError;");
    expect(posBloqueio).toBeLessThan(posPrimaryError);
  });

  it("o relatório marca `blocked: true`, mas o STATUS continua 'empty' — não dispara o alarme vermelho", () => {
    expect(COLETOR).toMatch(/const blocked = error instanceof Error && error\.message === BLOQUEIO_ANTIRROBO_MSG;/);
    expect(COLETOR).toMatch(/status: emptyListing \|\| blocked \? "empty" : "error",/);
    expect(COLETOR).toMatch(/\.\.\.\(blocked \? \{ blocked: true \} : \{\}\),/);
  });

  it("e o bloqueio também é propagado para as variantes e seções, não só a listagem principal", () => {
    expect(COLETOR).toMatch(/fetchSourceLinks\(variant, discoveryLimit, secoesVistas, bloqueios\)/);
    expect(COLETOR).toMatch(/fetchSourceLinks\(defeso, Math\.min\(discoveryLimit, 24\), undefined, bloqueios\)/);
    expect(COLETOR).toMatch(/fetchSourceLinks\(secao, discoveryLimit, undefined, bloqueios\)/);
  });
});

describe("etapa223 · o prefixo de erro tem PRECEDÊNCIA declarada, e o metadata persiste o sinal", () => {
  it("`[bloqueado_antirobo]` vence `[transitorio]` no mesmo ponto de decisão", () => {
    expect(ROTA_COLETAR).toMatch(/report\.blocked \? `\[bloqueado_antirobo\] \$\{report\.error\}` : report\.transient \? `\[transitorio\]/);
  });

  it("⚠️ o sinal vai para `metadata`, não para `ultimo_erro` — que só é escrito em status==='error'", () => {
    expect(ROTA_COLETAR).toMatch(/const blocked = reports\.some\(\(report\) => report\.blocked === true\);/);
    expect(ROTA_COLETAR).toMatch(/news_last_blocked_at: blocked \? new Date\(\)\.toISOString\(\) : currentMetadata\.news_last_blocked_at,/);
  });
});

describe("etapa223 · ⚠️ a SEGUNDA truncagem global do mesmo arquivo — os RUNS também eram globais", () => {
  it("os runs passam a ser lidos POR SITE, não num `.limit` cruzando todas as agências", () => {
    expect(ROTA_HEALTH, "voltou o .limit(100) global sobre todos os sites")
      .not.toMatch(/\.order\("created_at", \{ ascending: false \}\)\s*\.limit\(100\),/);
    expect(ROTA_HEALTH).toMatch(/sources\.map\(async \(source\) => \{/);
    expect(ROTA_HEALTH).toMatch(/\.eq\("site_id", source\.site_id\)/);
  });

  it("o total de runs usado downstream é a UNIÃO dos runs por site", () => {
    expect(ROTA_HEALTH).toMatch(/const runs = runsPorSite\.flat\(\);/);
  });

  it("o health publica os dois sinais de bloqueio, lidos do metadata e do run mais recente", () => {
    expect(ROTA_HEALTH).toMatch(/latest_blocked_at: readString\(source\.metadata, "news_last_blocked_at"\),/);
    expect(ROTA_HEALTH).toMatch(/blocked_now: \/\^\\\[bloqueado_antirobo\\\]\/i\.test\(latestRun\?\.error_message \?\? ""\),/);
  });
});

describe("etapa223 · `classificarFonte` — 'bloqueada' tem a prioridade mais alta", () => {
  const fonte = (over: Partial<HealthSource> = {}): HealthSource => ({
    agencia_sigla: "ANAC", total: 0, dias_sem_publicar: null, ...over,
  });

  it("qualquer um dos dois sinais basta", () => {
    expect(classificarFonte(fonte({ blocked_now: true }))).toBe("bloqueada");
    expect(classificarFonte(fonte({ latest_blocked_at: "2026-10-01T10:00:00Z" }))).toBe("bloqueada");
  });

  it("⚠️ e vence mesmo com erro ativo e total zero ao mesmo tempo", () => {
    expect(classificarFonte(fonte({ blocked_now: true, active_error: true }))).toBe("bloqueada");
  });

  it("sem os sinais, o caso 'nunca' (total=0, sem links) continua intacto", () => {
    expect(classificarFonte(fonte())).toBe("nunca");
  });

  it("erroCurto tira o prefixo novo também, sem perder o texto real", () => {
    expect(erroCurto("[bloqueado_antirobo] Pagina de verificacao anti-robo (CAPTCHA/WAF)"))
      .toBe("Pagina de verificacao anti-robo (CAPTCHA/WAF)");
  });
});

describe("etapa223 · a tela tem a mensagem, e ela é a PRIMEIRA (nem erro nem 'rode Coletar' cabem)", () => {
  it("o banner existe, com os agências nomeadas", () => {
    expect(TELA).toMatch(/fontesSaude\.bloqueada\.length > 0/);
    expect(TELA).toMatch(/verificação humana \(CAPTCHA\)/);
    expect(TELA).toMatch(/fontesSaude\.bloqueada\.map\(\(s\) => s\.agencia_sigla\)/);
  });

  it("e o bucket existe na classificação da tela, com consumidor — não é capacidade sem leitor", () => {
    expect(TELA).toMatch(/bloqueada: src\.filter\(\(s\) => classificarFonte\(s\) === "bloqueada"\)/);
  });
});
