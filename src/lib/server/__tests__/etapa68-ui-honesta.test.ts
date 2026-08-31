/**
 * Etapa 68 (Fase 7) — parar de mentir.
 *
 * Quatro afirmações que a plataforma fazia com convicção e que eram falsas em produção:
 *
 *  1. "o próximo Rodar tudo baixa/enfileira em rodadas", embaixo de 676 itens cujos TIPOS o gate
 *     de enfileiramento nunca aceitou — falso para 100% do que a legenda mostrava;
 *  2. banner VERDE de "esteira concluída" depois de 40 rodadas com HTTP 500 e totais zerados
 *     (o catch por rodada engolia tudo e `onError` era inalcançável);
 *  3. "✓ Cobertura completa" calculada contra uma enumeração do site cortada no meio;
 *  4. `CLAUDE.md` afirmando `maxDuration 120s` enquanto 14 rotas declaram 60 no próprio arquivo e
 *     o Hobby mata aos 60 de qualquer jeito.
 *
 * O que estes testes protegem não é o texto: é a PROPRIEDADE de que a tela não afirma o que não
 * sabe. Por isso a checagem central é a fonte única de tipos — enquanto a lista viver em dois
 * lugares, servidor e UI podem divergir de novo sem ninguém perceber.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { TIPOS_ESTEIRA_VOTOS, destinoForaDaEsteira, podeVirarVoto } from "@/lib/esteira-tipos";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

describe("etapa68 · a fonte única de 'o que a esteira processa'", () => {
  it.each(["voto", "ata", "deliberacao", "pauta", "documento", "reuniao"])(
    "«%s» entra na esteira de votos",
    (tipo) => {
      expect(podeVirarVoto(tipo)).toBe(true);
      expect(destinoForaDaEsteira(tipo)).toBeNull();
    },
  );

  it.each(["noticia", "politica_publica", "consulta_publica", "diretoria", "ato_nomeacao", "mandato"])(
    "«%s» NÃO entra — e a tela sabe dizer para onde ele vai",
    (tipo) => {
      expect(podeVirarVoto(tipo)).toBe(false);
      expect(destinoForaDaEsteira(tipo), "sem motivo, a UI volta a mentir por omissão").toBeTruthy();
    },
  );

  it("`diretoria` continua FORA — foi ele que prendeu 326 atas da ANM", () => {
    // A correção certa é a ata ser classificada como `ata` (Commit 4), nunca admitir a página
    // institucional aqui: isso encheria a esteira de "Composição da Diretoria".
    expect(podeVirarVoto("diretoria")).toBe(false);
  });

  it("o gate do servidor lê a MESMA lista que a tela — não pode haver duas verdades", () => {
    const enqueue = ler("src/app/api/v1/deliberacoes/enqueue-pdfs/route.ts");
    expect(enqueue).toContain("TIPOS_ESTEIRA_VOTOS");
    expect(enqueue).toContain("@/lib/esteira-tipos");
    // A lista literal não pode reaparecer aqui: era exatamente essa cópia local que deixava a UI
    // prometer o que o gate não cumpria.
    expect(enqueue).not.toMatch(/const DECISION_TIPOS\s*=\s*\[/);
    expect(TIPOS_ESTEIRA_VOTOS.length).toBeGreaterThan(0);
  });

  it("a tela usa a lista compartilhada em vez de reimplementar o critério", () => {
    const page = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");
    expect(page).toContain("@/lib/esteira-tipos");
    expect(page).toMatch(/podeVirarVoto\(g\.tipo\)/);
  });
});

describe("etapa68 · a promessa falsa saiu da legenda", () => {
  const page = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");

  it("a legenda não promete mais que TUDO será enfileirado", () => {
    // A frase antiga aparecia sem nenhuma ressalva logo após o total de detectados.
    expect(page).not.toMatch(/detectado\(s\) ainda não processado\(s\)<\/span> — o próximo/);
  });

  it("a legenda distingue o que entra do que nunca entrará", () => {
    expect(page).toMatch(/não processa/);
    expect(page).toMatch(/naEsteira|foraDaEsteira/);
  });
});

describe("etapa68 · o desfecho da esteira é medido, não presumido", () => {
  const page = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");

  it("as rodadas com erro são contadas e o motivo da parada sobe do laço", () => {
    expect(page).toMatch(/rodadasComErro/);
    expect(page).toMatch(/desfecho/);
    expect(page).toMatch(/ultimoErro/);
  });

  it("parar por 2 falhas seguidas vira ERRO na tela, não banner de sucesso", () => {
    expect(page).toMatch(/desfecho === "erros"[\s\S]{0,320}setMatchError/);
  });

  it("parar no teto não é anunciado como 'concluída'", () => {
    // Fase 14 — o teto passou de CONTADOR (40 rodadas) para RELÓGIO (~25min); a propriedade
    // vigiada é a mesma: parada por teto tem mensagem própria com "ainda há fila", nunca o
    // banner de sucesso.
    expect(page).toMatch(/teto de tempo \(~25min, \$\{rodadasFeitas\} rodadas\)/);
    expect(page).toMatch(/ainda há fila/);
  });
});

describe("etapa68 · enumeração parcial nunca vira prova de cobertura", () => {
  const rota = ler("src/app/api/v1/admin/cobertura-ao-vivo/route.ts");
  const page = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");

  it("o flag `truncated` do coletor deixa de ser descartado", () => {
    expect(rota).toMatch(/disc\.truncated/);
    expect(rota).toMatch(/enumeracao_parcial/);
  });

  it("a rota alerta quando a enumeração ficou incompleta", () => {
    expect(rota).toMatch(/enumeracao_parcial[\s\S]{0,400}?INCOMPLETA/);
  });

  it("a tela não pinta '✓ Cobertura completa' sobre enumeração parcial", () => {
    // O ramo do parcial tem de ser avaliado ANTES do ramo de sucesso.
    const iParcial = page.indexOf("enumeracao_parcial");
    const iCompleta = page.indexOf("✓ Cobertura completa");
    expect(iParcial, "o guard de parcial precisa existir").toBeGreaterThan(-1);
    expect(iParcial, "e precisa ser avaliado antes do ✓").toBeLessThan(iCompleta);
  });
});

describe("etapa68 · o cliente não espera para sempre por uma função morta", () => {
  const api = ler("src/lib/api.ts");

  it("o fetch tem AbortController com teto ACIMA do SIGKILL de 60s", () => {
    expect(api).toContain("AbortController");
    const m = api.match(/REQUEST_TIMEOUT_MS\s*=\s*([\d_]+)/);
    expect(m, "o teto precisa ser uma constante nomeada").toBeTruthy();
    const ms = Number(m![1].replace(/_/g, ""));
    expect(ms, "abaixo de 60s cortaria rodadas legítimas da esteira").toBeGreaterThan(60_000);
  });

  it("o timeout vira um erro legível, não uma promessa pendurada", () => {
    expect(api).toMatch(/controller\.signal\.aborted[\s\S]{0,240}ApiError/);
  });
});

describe("etapa68 · a documentação para de afirmar 120s", () => {
  const claude = ler("CLAUDE.md");

  it("o CLAUDE.md registra o número operacional (60s) e a regra de orçamento", () => {
    expect(claude).toMatch(/60s/);
    expect(claude).toMatch(/FATIA menor que a RESERVA|fatia menor que a reserva/i);
  });
});
