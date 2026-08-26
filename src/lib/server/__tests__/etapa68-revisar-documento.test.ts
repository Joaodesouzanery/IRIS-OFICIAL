/**
 * Etapa 68 (Fase 7) — o "Revisar →" que abre o documento certo.
 *
 * A queixa: "ao clicar em Revisar, ele não mostra o documento correto, e vai para a aba Upload de
 * PDFs". Faltavam as DUAS pontas:
 *   · o link era um `<a href="/dashboard/upload">` LITERAL, que ignorava o `doc` do próprio `map`;
 *   · e mesmo com a URL certa não funcionaria — não existia `useSearchParams` em NENHUM arquivo de
 *     `src/app/dashboard/**`, então a tela de upload não tinha como saber qual documento abrir.
 *     Ela começa em `stage="queue"` (dropzone vazia), que é exatamente o que o usuário via.
 *
 * O carregamento por id já existia (usado pelo reprocessamento): o que faltava era a porta de
 * entrada. E a URL assinada do PDF já vinha na resposta — invisível só porque o tipo inline da
 * consulta não a declarava.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

const VOTOS = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");
const UPLOAD = ler("src/app/dashboard/upload/page.tsx");

describe("etapa68 · o link carrega o documento", () => {
  it("«Revisar» aponta para o documento da linha, não para a tela genérica", () => {
    expect(VOTOS).toMatch(/href=\{`\/dashboard\/upload\?doc=\$\{encodeURIComponent\(doc\.id\)\}`\}/);
  });

  it("TODO «Revisar» leva um documento junto", () => {
    // Duas armadilhas que este teste já pisou:
    //  1. proibir `href="/dashboard/upload"` no arquivo inteiro reprovava um link LEGÍTIMO — o
    //     "envie um PDF manualmente" do rodapé da seção, que não é um "Revisar";
    //  2. procurar "link de upload seguido de Revisar" casava também com o link CORRIGIDO.
    // A propriedade certa é sobre cada âncora que diz "Revisar": o href dela tem de carregar o id.
    const ancoras = [...VOTOS.matchAll(/<a\b([^>]*)>\s*(?:\{[^}]*\}\s*)?Revisar/g)].map((m) => m[1]);
    expect(ancoras.length, "sem nenhum link de Revisar, o teste não prova nada").toBeGreaterThan(0);
    for (const attrs of ancoras) {
      expect(attrs, `um "Revisar" sem documento: ${attrs.slice(0, 80)}`).toMatch(/doc=/);
    }
  });

  it("o id vai codificado — a URL não pode quebrar com o valor do id", () => {
    expect(VOTOS).toMatch(/encodeURIComponent\(doc\.id\)/);
  });
});

describe("etapa68 · a tela de upload passou a ler o deep link", () => {
  it("lê `?doc=` da query string", () => {
    expect(UPLOAD).toContain("useSearchParams");
    expect(UPLOAD).toMatch(/searchParams\.get\("doc"\)/);
  });

  it("carrega pelo caminho que JÁ existia — nenhuma rota nova", () => {
    expect(UPLOAD).toMatch(/\/upload\/documentos\?ids=\$\{encodeURIComponent\(docParam\)\}&limit=1/);
  });

  it("abre direto no estágio de revisão, não na dropzone", () => {
    expect(UPLOAD).toMatch(/setReviewItems\(\[documentToReviewItem\(doc, 0\)\]\)[\s\S]{0,80}?setStage\("review"\)/);
  });

  it("não recarrega em laço quando o componente re-renderiza", () => {
    // Sem a guarda, cada render dispararia um fetch novo — e um `setStage` a cada resposta
    // sequestraria a navegação do usuário para sempre.
    expect(UPLOAD).toMatch(/deepLinkCarregado\.current === docParam/);
  });

  it("documento inexistente EXPLICA — não devolve a dropzone muda", () => {
    expect(UPLOAD).toMatch(/setDeepLinkErro\(/);
    expect(UPLOAD).toMatch(/aprovado ou arquivado/);
    expect(UPLOAD).toMatch(/\{deepLinkErro && \(/);
  });

  it("cancela o efeito ao desmontar — sem setState em componente morto", () => {
    expect(UPLOAD).toMatch(/let cancelado = false/);
    expect(UPLOAD).toMatch(/return \(\) => \{ cancelado = true; \}/);
  });
});

describe("etapa68 · o que já vinha na resposta e estava escondido", () => {
  it("`signed_url` é declarada e vira link direto para o PDF", () => {
    expect(VOTOS).toMatch(/signed_url\?: string \| null/);
    expect(VOTOS).toMatch(/href=\{doc\.signed_url\}/);
  });

  it("as falhas de extração ficaram clicáveis pelo documento_id que já traziam", () => {
    expect(VOTOS).toMatch(/f\.documento_id \? \([\s\S]{0,200}?\/dashboard\/upload\?doc=\$\{encodeURIComponent\(f\.documento_id\)\}/);
  });

  it("falha sem documento_id degrada para texto — não vira link quebrado", () => {
    expect(VOTOS).toMatch(/\) : \(\s*<span className="text-text-secondary">\{f\.agencia\}/);
  });
});
