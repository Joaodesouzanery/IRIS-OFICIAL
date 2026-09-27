/**
 * Etapa 188 (Fase 32) — a landing page pública, e o que ela NÃO pode abrir junto.
 *
 * ═══ O risco central desta fase ═══
 * Tornar `/` público é mexer na superfície de autenticação. O modo de falhar não é a landing não
 * aparecer — é ela aparecer e levar o resto junto. Por isso a primeira expectativa aqui não é sobre
 * a página: é sobre `/dashboard` continuar fechado.
 *
 * ═══ E o risco de CONTEÚDO, que é específico deste produto ═══
 * A página mostra 12 logos de agências federais. A esteira de votos cobre TRÊS (ANTT, ANM, ARTESP —
 * e a ARTESP é estadual, nem está entre as 12). Deixar entender que monitoramos voto a voto nas 12
 * seria, para fora, exatamente o defeito que a Fase 31 inteira perseguiu por dentro: um número
 * afirmando o que o dado não sustenta. Aqui isso é travado por teste.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { AGENCIAS_FEDERAIS, SIGLAS_COM_ESTEIRA_DE_VOTOS } from "@/lib/agencias-federais";
import { COLEGIADO_SIGLAS } from "@/lib/server/colegiado-sources";
import { O_QUE_FAZEMOS, ETAPAS_DO_RADAR, QUEM_SOMOS, CANAIS } from "@/lib/landing-content";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const MW = semComentarios(ler("src/middleware.ts"));

describe("etapa188 · ⚠️ abrir `/` NÃO pode abrir o resto", () => {
  it("⚠️⚠️ `/dashboard` continua exigindo sessão — a regressão que importa", () => {
    /**
     * O jeito de errar aqui seria pôr `"/"` em `PUBLIC_APP_PREFIXES`. O helper testa
     * `pathname.startsWith(`${prefix}/`)`, e com prefixo `"/"` isso vira `startsWith("//")` — que
     * hoje não casa com nada, mas basta alguém normalizar o helper para o app inteiro abrir de uma
     * vez. Por isso `/` entrou num conjunto de IGUALDADE EXATA, que não tem como se generalizar.
     */
    expect(MW).toMatch(/const PUBLIC_APP_EXACT = new Set\(\["\/", "\/opengraph-image"\]\);/);
    const bloco = MW.slice(MW.indexOf("PUBLIC_APP_PREFIXES ="), MW.indexOf("]", MW.indexOf("PUBLIC_APP_PREFIXES =")));
    expect(bloco, "`/` NÃO pode entrar na lista de PREFIXOS — só na de igualdade exata")
      .not.toMatch(/"\/"[,\]]/);
    for (const proibido of ["/dashboard", "/api"]) {
      expect(bloco, `${proibido} virou público`).not.toContain(`"${proibido}"`);
      expect(MW.slice(MW.indexOf("PUBLIC_APP_EXACT"), MW.indexOf(")", MW.indexOf("PUBLIC_APP_EXACT"))))
        .not.toContain(proibido);
    }
  });

  it("⚠️ a imagem de compartilhamento é PÚBLICA — senão não há prévia em lugar nenhum", () => {
    /**
     * Achado da verificação, não da leitura: servindo o build, `/opengraph-image` devolvia **307
     * para /login**. O `matcher` do middleware é `/((?!.*\..*).*)` — ele só ignora caminhos COM
     * ponto, e a imagem do `next/og` é servida em `/opengraph-image?<hash>`, sem extensão.
     * WhatsApp, LinkedIn e Twitter buscam essa URL sem sessão: sem a isenção, o link do Instituto
     * seria compartilhado sem imagem nenhuma.
     */
    expect(MW).toMatch(/"\/opengraph-image"/);
    const PAGE_HTML_META = ler("src/app/opengraph-image.tsx");
    expect(PAGE_HTML_META).toMatch(/export const size = \{ width: 1200, height: 630 \}/);
    expect(PAGE_HTML_META).toMatch(/export const contentType = "image\/png"/);
  });

  it("a checagem exata vem ANTES da de prefixo, e as duas convivem", () => {
    expect(MW).toMatch(
      /function isPublicAppPath\(pathname: string\): boolean \{\s*if \(PUBLIC_APP_EXACT\.has\(pathname\)\) return true;\s*return PUBLIC_APP_PREFIXES\.some/,
    );
  });

  it("⚠️ e o resto do middleware não foi afrouxado de carona", () => {
    // O commit da landing é um alvo tentador para "aproveitar e liberar" outra coisa.
    expect(MW).toMatch(/return requireAuthenticatedApp\(req\);/);
    expect(MW).toMatch(/if \(!token\) \{/);
    expect(MW).toMatch(/if \(isDemoRequest && WRITE_METHODS\.has\(req\.method\)\)/);
  });
});

describe("etapa188 · ⚠️ o SEO que o layout raiz bloqueava", () => {
  it("`noindex` SAIU do layout raiz", () => {
    /**
     * Ele estava em `src/app/layout.tsx` e era herdado por TODA rota. Enquanto `/` era um redirect
     * isso não custava nada; com uma landing lá, significaria construir uma página para ser
     * encontrada e marcá-la para não ser.
     */
    // ⚠️ A asserção mede o CÓDIGO, sem comentários. O docblock que explica a mudança CITA
    // `robots: "noindex, nofollow"` para dizer por que ele saiu — e um `not.toMatch` sobre o
    // arquivo cru acusaria a própria explicação. Décima primeira vez nesta série que procurei
    // texto onde precisava medir o código.
    const RAIZ_LAYOUT = semComentarios(ler("src/app/layout.tsx"));
    expect(RAIZ_LAYOUT, "o noindex voltou para o layout raiz").not.toMatch(/robots:\s*"noindex/);
    expect(RAIZ_LAYOUT).toMatch(/metadataBase: new URL\(SITE\)/);
    expect(RAIZ_LAYOUT).toMatch(/openGraph:/);
  });

  it("⚠️ e DESCEU para o dashboard — a plataforma continua fora do índice", () => {
    // Tirar de um lugar sem pôr no outro deixaria o dashboard autenticado indexável.
    expect(ler("src/app/dashboard/layout.tsx")).toMatch(/robots: \{ index: false, follow: false \}/);
  });

  it("a landing se declara indexável, e canônica", () => {
    const PAGE = ler("src/app/page.tsx");
    expect(PAGE).toMatch(/robots: \{ index: true, follow: true \}/);
    expect(PAGE).toMatch(/alternates: \{ canonical: "\/" \}/);
  });

  it("`robots.txt` e `sitemap.xml` existem e não convidam robô para porta fechada", () => {
    const ROBOTS = ler("src/app/robots.ts");
    expect(ROBOTS).toMatch(/disallow: \["\/dashboard", "\/api\/", "\/login", "\/setup-owner"\]/);
    // Mesma armadilha: o comentário do sitemap explica por que `/dashboard` NÃO entra.
    const SITEMAP = semComentarios(ler("src/app/sitemap.ts"));
    expect(SITEMAP, "o sitemap listou rota autenticada").not.toMatch(/dashboard|api/);
    expect(SITEMAP, "o sitemap deveria listar a raiz").toMatch(/url: SITE/);
  });
});

describe("etapa188 · ⚠️ a página não promete cobertura que a esteira não tem", () => {
  it("são 12 agências federais, e a ARTESP não está entre elas", () => {
    expect(AGENCIAS_FEDERAIS).toHaveLength(12);
    expect(AGENCIAS_FEDERAIS.map((a) => a.sigla)).not.toContain("ARTESP");
  });

  it("⚠️⚠️ `SIGLAS_COM_ESTEIRA_DE_VOTOS` é IGUAL a `COLEGIADO_SIGLAS` — a verdade é uma só", () => {
    /**
     * A landing não pode importar `lib/server/colegiado-sources` (arrastaria código de servidor), e
     * por isso repete as siglas. Repetição sem trava vira divergência: bastaria a esteira ganhar
     * uma agência para a página pública passar a mentir por omissão — ou perder uma para passar a
     * mentir por excesso, que é pior.
     */
    expect([...SIGLAS_COM_ESTEIRA_DE_VOTOS].sort()).toEqual([...COLEGIADO_SIGLAS].sort());
  });

  it("só as agências com esteira ganham o selo «voto a voto»", () => {
    const AG = semComentarios(ler("src/components/landing/LpAgencias.tsx"));
    expect(AG).toMatch(/const comVoto = new Set<string>\(SIGLAS_COM_ESTEIRA_DE_VOTOS\);/);
    expect(AG).toMatch(/comVoto\.has\(a\.sigla\) &&/);
    expect(ler("src/components/landing/LpAgencias.tsx")).toMatch(/voto a voto/);
  });

  it("⚠️ e a legenda EXPLICA o selo — selo sem legenda é jargão", () => {
    const AG = ler("src/components/landing/LpAgencias.tsx");
    expect(AG).toMatch(/Nas demais, o IRIS\s*\n?\s*faz acompanhamento regulatório/);
  });

  it("⚠️ a etapa 03 do Radar NOMEIA as três agências, em vez de deixar subentendido", () => {
    const etapa = ETAPAS_DO_RADAR.find((e) => e.numero === "03");
    expect(etapa).toBeDefined();
    for (const sigla of ["ANTT", "ANM", "ARTESP"]) {
      expect(etapa!.texto, `a etapa 03 não cita ${sigla}`).toContain(sigla);
    }
  });

  it("e o Radar não chama de auditada a nota de qualidade, que é preliminar", () => {
    const todos = ETAPAS_DO_RADAR.map((e) => `${e.titulo} ${e.texto}`).join(" ");
    expect(todos).not.toMatch(/auditad[ao]|certificad[ao]|validad[ao] por/i);
  });
});

describe("etapa188 · o conteúdo institucional está completo", () => {
  it("são exatamente 9 eixos em «O que fazemos»", () => {
    // Uma seção institucional que perde um item em silêncio só é notada quando um associado pergunta.
    expect(O_QUE_FAZEMOS).toHaveLength(9);
    for (const item of O_QUE_FAZEMOS) {
      expect(item.titulo.length).toBeGreaterThan(3);
      expect(item.texto.length, `«${item.titulo}» está sem texto`).toBeGreaterThan(80);
    }
  });

  it("«Quem somos» tem os dois parágrafos, incluindo o final sobre capacitação", () => {
    expect(QUEM_SOMOS).toHaveLength(2);
    expect(QUEM_SOMOS.join(" ")).toMatch(/programas de capacitação e cooperação institucional/);
  });

  it("as 4 etapas do Radar estão numeradas em sequência", () => {
    expect(ETAPAS_DO_RADAR.map((e) => e.numero)).toEqual(["01", "02", "03", "04"]);
  });

  it("⚠️ os canais batem com os da newsletter — sem duas verdades sobre o mesmo link", () => {
    const NL = ler("src/lib/newsletter-document.ts");
    expect(NL).toContain(CANAIS.instagram);
    expect(NL).toContain(CANAIS.linkedin);
    expect(NL).toContain(CANAIS.email);
  });
});

describe("etapa188 · ⚠️ a Hero é CSS puro, e legível sobre QUALQUER uma das fotos", () => {
  const HERO = ler("src/components/landing/LpHero.tsx");
  const CSS = ler("src/app/globals.css");

  it("as 12 fotos existem em disco — uma por agência", () => {
    for (const a of AGENCIAS_FEDERAIS) {
      const arq = join(RAIZ, "public", "hero", `${a.sigla.toLowerCase()}.jpg`);
      expect(existsSync(arq), `falta a foto de ${a.sigla} em public/hero/`).toBe(true);
    }
  });

  it("e a procedência de cada uma está registrada", () => {
    // Imagem de terceiro sem procedência registrada é dívida jurídica esperando alguém perguntar.
    const cred = JSON.parse(ler("public/hero/CREDITOS.json")) as Array<{ licenca: string }>;
    expect(cred).toHaveLength(12);
    for (const c of cred) expect(c.licenca).toMatch(/Unsplash License/);
  });

  it("⚠️ o dissolve é `animation-delay` NEGATIVO escalonado — sem estado, sem JS", () => {
    expect(HERO).toMatch(/animationDelay: `\$\{-i \* 5\}s`/);
    expect(CSS).toMatch(/animation: lpHeroFade 60s linear infinite/);
    expect(HERO, "a Hero virou componente de cliente").not.toMatch(/^"use client"/m);
  });

  it("⚠️⚠️ há SCRIM fixo — o contraste não pode depender de qual foto está na vez", () => {
    /**
     * O título passa sobre doze fotos diferentes: céu claro de aeroporto, laboratório branco, mina
     * escura. Sem uma camada opaca fixa, a legibilidade viraria sorteio.
     */
    expect(HERO).toMatch(/linear-gradient\(100deg, rgba\(10,14,42,0\.96\)/);
  });

  it("⚠️ `prefers-reduced-motion` CONGELA, não só desacelera", () => {
    const i = CSS.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(i).toBeGreaterThan(-1);
    const bloco = CSS.slice(i, i + 260);
    expect(bloco).toMatch(/animation: none/);
    expect(bloco, "sem isto a tela fica preta para quem pediu menos movimento")
      .toMatch(/\.lp-hero-img:first-of-type \{ opacity: 1; \}/);
  });

  it("as fotos são decorativas e não narradas — o setor já é dito em texto", () => {
    expect(HERO).toMatch(/alt=""/);
    expect(HERO).toMatch(/aria-hidden/);
  });
});

describe("etapa188 · ⚠️ nada da landing roda no cliente", () => {
  it("nenhum componente da landing é `use client`", () => {
    const dir = join(RAIZ, "src/components/landing");
    for (const arq of require("fs").readdirSync(dir) as string[]) {
      expect(ler(`src/components/landing/${arq}`), `${arq} virou componente de cliente`)
        .not.toMatch(/^"use client"/m);
    }
  });

  it("e a página não instalou biblioteca de animação nem de carrossel", () => {
    const PKG = JSON.parse(ler("package.json")) as { dependencies: Record<string, string> };
    for (const proibida of ["framer-motion", "motion", "embla-carousel-react", "swiper", "react-slick", "keen-slider", "gsap"]) {
      expect(PKG.dependencies[proibida], `${proibida} foi instalada`).toBeUndefined();
    }
  });

  it("⚠️ e o calendário é cacheado — senão a landing vira dinâmica e busca a cada visita", () => {
    /**
     * O Next 15 trocou o default do `fetch` de `force-cache` para `no-store`. Sem o
     * `unstable_cache`, cada visita refazia a busca ao irisregulacao.org com timeout de 15s no
     * caminho crítico — e o build mostrava `/` como dinâmica.
     */
    const EV = semComentarios(ler("src/components/landing/LpEventos.tsx"));
    expect(EV).toMatch(/unstable_cache\(/);
    expect(EV).toMatch(/\{ revalidate: 3600, tags: \["iris-eventos"\] \}/);
    /**
     * ⚠️ E o componente tem de CHAMAR o wrapper, não só defini-lo. A primeira versão desta
     * expectativa conferia que `unstable_cache(` aparecia no arquivo — e SOBREVIVEU à mutação que
     * trocava a chamada por `fetchIrisEventos(6)` direto: a const continuava declarada, sem uso, e
     * a página voltava a ser dinâmica. Wrapper de cache não usado é decoração.
     */
    expect(EV, "o componente define o cache mas não o usa — a página volta a ser dinâmica")
      .toMatch(/const eventos = await eventosEmCache\(\);/);
    expect(EV, "voltou a buscar sem cache no corpo do componente")
      .not.toMatch(/const eventos = await fetchIrisEventos\(/);
    expect(ler("src/app/page.tsx")).toMatch(/export const revalidate = 3600;/);
  });

  it("⚠️ e reusa `fetchIrisEventos` em vez de um parser próprio", () => {
    const EV = semComentarios(ler("src/components/landing/LpEventos.tsx"));
    expect(EV).toMatch(/from "@\/lib\/server\/iris-eventos"/);
    expect(EV, "apareceu um segundo parser do mesmo calendário").not.toMatch(/JSON\.parse|node-html-parser/);
  });

  it("⚠️ o vazio dos eventos NÃO some a seção — degradar não pode virar desaparecer", () => {
    // `fetchIrisEventos` devolve [] tanto sem evento futuro quanto sem conseguir ler. Sumir faria o
    // leitor concluir que o Instituto não promove eventos.
    const EV = ler("src/components/landing/LpEventos.tsx");
    expect(EV).toMatch(/eventos\.length === 0 \?/);
    expect(EV).toMatch(/Ver o calendário/);
  });
});

describe("etapa188 · as logos e o fallback", () => {
  it("as 12 logos estão em disco", () => {
    for (const a of AGENCIAS_FEDERAIS) {
      expect(existsSync(join(RAIZ, "public", "agencias", `${a.sigla.toLowerCase()}.png`)),
        `falta a logo de ${a.sigla}`).toBe(true);
    }
  });

  it("⚠️ mas o componente CONFERE O DISCO, e não confia na lista", () => {
    // Uma das logos falhou no primeiro download. `<img>` para arquivo ausente vira ícone quebrado,
    // e ícone quebrado numa página institucional é pior que não ter logo.
    const AG = semComentarios(ler("src/components/landing/LpAgencias.tsx"));
    expect(AG).toMatch(/existsSync\(join\(process\.cwd\(\), "public", "agencias"/);
    expect(AG).toMatch(/temLogo\(a\.sigla\) \?/);
  });

  it("cada logo linka para o site oficial da agência, com rel de segurança", () => {
    const AG = semComentarios(ler("src/components/landing/LpAgencias.tsx"));
    expect(AG).toMatch(/href=\{a\.site_oficial\}/);
    expect(AG).toMatch(/rel="noopener noreferrer"/);
    for (const a of AGENCIAS_FEDERAIS) expect(a.site_oficial).toMatch(/^https:\/\//);
  });
});

describe("etapa188 · o rótulo virou Radar, e a rota não", () => {
  it("Sidebar, Topbar e o h1 dizem «Radar Regulatório»", () => {
    expect(ler("src/components/layout/Sidebar.tsx")).toMatch(/label: "Radar Regulatório"/);
    expect(ler("src/components/layout/Topbar.tsx")).toMatch(/"Radar Regulatório"/);
    expect(ler("src/app/dashboard/painel-regulatorio/page.tsx")).toMatch(/>Radar Regulatório</);
  });

  it("⚠️ e a ROTA continua `/dashboard/painel-regulatorio` — link salvo não pode quebrar", () => {
    expect(existsSync(join(RAIZ, "src/app/dashboard/painel-regulatorio/page.tsx"))).toBe(true);
    expect(ler("src/components/layout/Sidebar.tsx")).toMatch(/href: "\/dashboard\/painel-regulatorio"/);
    // O login e o callback ainda mandam para lá depois de autenticar.
    expect(ler("src/app/login/page.tsx")).toMatch(/\/dashboard\/painel-regulatorio/);
  });
});
