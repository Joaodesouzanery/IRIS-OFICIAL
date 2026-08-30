/**
 * Etapa 67 — o item ativo da navegação é decidido por MELHOR CASAMENTO.
 *
 * A regra antiga (`pathname === href || pathname.startsWith(href + "/")`) acendia DOIS itens
 * sempre que um href era prefixo próprio de outro da mesma lista. As cinco colisões abaixo foram
 * observadas em PRODUÇÃO (prints do usuário) ou mapeadas na exploração. Cada uma é um caso deste
 * arquivo — e a mutação (voltar ao prefixo cru) deixa todos vermelhos.
 */

import { describe, it, expect } from "vitest";
import { resolveActiveHref, type NavItem } from "@/lib/nav-active";

// ─── Réplicas das listas REAIS (sincronizadas por teste de paridade abaixo) ──────────────────
const SIDEBAR: NavItem[] = [
  { href: "/dashboard/painel-regulatorio", paths: ["/dashboard/painel-regulatorio", "/dashboard/empresas", "/dashboard/documentos-associados"] },
  { href: "/dashboard/deliberacoes", paths: ["/dashboard", "/dashboard/upload", "/dashboard/deliberacoes", "/dashboard/reunioes", "/dashboard/boletim"] },
  { href: "/dashboard/noticias", paths: ["/dashboard/noticias"] },
  { href: "/dashboard/monitoramento", paths: ["/dashboard/monitoramento", "/dashboard/documentos-antt-2026"] },
  { href: "/dashboard/analytics/diretores", paths: ["/dashboard/analytics/diretores", "/dashboard/diretores", "/dashboard/mandatos", "/dashboard/votacao"] },
  { href: "/dashboard/analytics", paths: ["/dashboard/analytics", "/dashboard/analytics/temas", "/dashboard/analytics/institucional", "/dashboard/360", "/dashboard/insights", "/dashboard/governanca", "/dashboard/saude-dados"] },
  { href: "/dashboard/qualidade-regulatoria" },
  { href: "/dashboard/agencias" },
];

const QUALIDADE_TABS: NavItem[] = [
  { href: "/dashboard/qualidade-regulatoria" },
  { href: "/dashboard/qualidade-regulatoria/agencias" },
  { href: "/dashboard/qualidade-regulatoria/criterios" },
  { href: "/dashboard/qualidade-regulatoria/diagnostico" },
  { href: "/dashboard/qualidade-regulatoria/evidencias" },
  { href: "/dashboard/qualidade-regulatoria/coletas" },
  { href: "/dashboard/qualidade-regulatoria/premio" },
  { href: "/dashboard/qualidade-regulatoria/relatorios" },
];

const DELIBERACOES_TABS: NavItem[] = [
  { href: "/dashboard" },
  // Fase 12: a aba Upload saiu do menu (a página continua; ver module-tabs.ts).
  { href: "/dashboard/deliberacoes" },
  { href: "/dashboard/reunioes" },
  { href: "/dashboard/deliberacoes/votos-diretores" },
  { href: "/dashboard/boletim" },
];

describe("etapa67 · as cinco colisões do print — exatamente UM ativo", () => {
  it("colisão 1 (print): «Diretores» acende sozinho — «Análise» não engole a sub-rota", () => {
    expect(resolveActiveHref("/dashboard/analytics/diretores", SIDEBAR))
      .toBe("/dashboard/analytics/diretores");
  });

  it("colisão 2 (print): na aba Evidencias, «Dashboard» da Qualidade NÃO fica acesa junto", () => {
    expect(resolveActiveHref("/dashboard/qualidade-regulatoria/evidencias", QUALIDADE_TABS))
      .toBe("/dashboard/qualidade-regulatoria/evidencias");
  });

  it("colisão 3: «Votos dos Diretores» acende sozinha — «Deliberações» não acende junto", () => {
    expect(resolveActiveHref("/dashboard/deliberacoes/votos-diretores", DELIBERACOES_TABS))
      .toBe("/dashboard/deliberacoes/votos-diretores");
  });

  it("colisão 4: «Temas» vence «Analytics» na sidebar (ambos no mesmo dono aqui — dono único)", () => {
    // Na sidebar, temas pertence ao item Análise; o ponto é que só UM item vence.
    expect(resolveActiveHref("/dashboard/analytics/temas", SIDEBAR)).toBe("/dashboard/analytics");
  });

  it("colisão 5: «Associados» aciona o dono correto no Observatório", () => {
    expect(resolveActiveHref("/dashboard/empresas/associados", SIDEBAR))
      .toBe("/dashboard/painel-regulatorio");
  });
});

describe("etapa67 · o que NÃO pode regredir", () => {
  it("«/dashboard» estrito: acende a aba Dashboard sem vazar para rotas fundas", () => {
    expect(resolveActiveHref("/dashboard", DELIBERACOES_TABS)).toBe("/dashboard");
    // Rota órfã NÃO herda o dono de "/dashboard" por prefixo — nenhum aceso é o sinal certo
    // de mapeamento faltando; item errado aceso seria mentira.
    expect(resolveActiveHref("/dashboard/rota-futura-sem-dono", SIDEBAR)).toBeNull();
  });

  it("detalhe de deliberação acende «Deliberações» (aba pai por prefixo é legítimo)", () => {
    expect(resolveActiveHref("/dashboard/deliberacoes/abc-123", DELIBERACOES_TABS))
      .toBe("/dashboard/deliberacoes");
  });

  it("as rotas ÓRFÃS adotadas: perfil do diretor → «Diretores»; reuniões → «Deliberações»", () => {
    expect(resolveActiveHref("/dashboard/diretores/d1", SIDEBAR)).toBe("/dashboard/analytics/diretores");
    expect(resolveActiveHref("/dashboard/reunioes", SIDEBAR)).toBe("/dashboard/deliberacoes");
  });

  it("mandatos e votação continuam com «Diretores»; governança e 360 com «Análise»", () => {
    expect(resolveActiveHref("/dashboard/mandatos", SIDEBAR)).toBe("/dashboard/analytics/diretores");
    expect(resolveActiveHref("/dashboard/votacao", SIDEBAR)).toBe("/dashboard/analytics/diretores");
    expect(resolveActiveHref("/dashboard/governanca", SIDEBAR)).toBe("/dashboard/analytics");
    expect(resolveActiveHref("/dashboard/360", SIDEBAR)).toBe("/dashboard/analytics");
  });

  it("prefixo de NOME não confunde: /dashboard/agencias-x não casa /dashboard/agencias", () => {
    expect(resolveActiveHref("/dashboard/agencias-outra", SIDEBAR)).toBeNull();
  });

  it("empate de path (erro de config) resolve pelo primeiro — nunca acende dois", () => {
    const duplicado: NavItem[] = [{ href: "/a", paths: ["/x"] }, { href: "/b", paths: ["/x"] }];
    expect(resolveActiveHref("/x/y", duplicado)).toBe("/a");
  });
});

describe("etapa67 · paridade — as réplicas deste teste não podem divergir do código real", () => {
  // Mesma técnica dos testes de paridade da etapa65: se alguém mudar MODULE_PATHS ou as listas de
  // abas sem atualizar este arquivo, o teste passa a validar um mapa que não existe mais.
  it("MODULE_PATHS do Sidebar contém os paths que este teste assume", async () => {
    const { readFileSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const src = readFileSync(join(raiz, "src/components/layout/Sidebar.tsx"), "utf-8");
    for (const item of SIDEBAR) {
      for (const p of item.paths ?? [item.href]) {
        expect(src, `Sidebar perdeu o path ${p}`).toContain(`"${p}"`);
      }
    }
    expect(src, "Sidebar deixou de usar o resolver").toContain("resolveActiveHref");
  });

  // ─── Fase 12 — a aba "Upload de PDFs" saiu do MENU; a página fica ─────────────────────────
  it("module-tabs NÃO tem mais a aba de Upload — e /dashboard/upload não acende aba nenhuma", async () => {
    const { readFileSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const tabs = readFileSync(join(raiz, "src/lib/module-tabs.ts"), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(tabs).not.toContain('href: "/dashboard/upload"');
    // Nenhuma aba acesa em /dashboard/upload é o comportamento certo (não é a raiz nem tem dono).
    expect(resolveActiveHref("/dashboard/upload", DELIBERACOES_TABS)).toBeNull();
  });

  it("a PÁGINA continua alcançável: o Sidebar mantém o path e o «Revisar» mantém o deep link", async () => {
    // Sem o path no Sidebar, a sidebar inteira apaga ao chegar via "Revisar" (bug já vivido na
    // etapa67); e o deep link ?doc= é o único caminho de revisão 1-a-1 que restou.
    const { readFileSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");
    const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const sidebar = readFileSync(join(raiz, "src/components/layout/Sidebar.tsx"), "utf-8");
    expect(sidebar).toContain('"/dashboard/upload"');
    const votos = readFileSync(
      join(raiz, "src/app/dashboard/deliberacoes/votos-diretores/page.tsx"), "utf-8");
    // Contagem exata: são DOIS sítios ("Revisar" da fila e o das falhas de extração) —
    // asserção de presença passava com um deles quebrado.
    const deepLinks = votos.match(/\/dashboard\/upload\?doc=/g) ?? [];
    expect(deepLinks.length).toBe(2);
  });
});
