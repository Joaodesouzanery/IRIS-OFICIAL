/**
 * Etapa 78 (Fase 12) — os rankings de diretor DIZEM a agência.
 *
 * O caso real: o widget "Votos por Diretor" agrega as três agências colegiadas e mostrava só o
 * nome. O usuário leu os 5 primeiros (4 ARTESP + 1 ANTT) como um colegiado só e abriu uma
 * investigação de "votos desiguais na ANTT" — o número estava certo; a tela não dizia de quem
 * falava. A rota SEMPRE devolveu `agencia_sigla`; a tela é que descartava.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const DASH = readFileSync(join(RAIZ, "src/app/dashboard/page.tsx"), "utf-8");
const VOTOS = readFileSync(join(RAIZ, "src/app/dashboard/deliberacoes/votos-diretores/page.tsx"), "utf-8");

/** Sem comentários: as asserções não podem casar a prosa que explica o conserto. */
const semComentarios = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "");

describe("etapa78 · a sigla acompanha o nome em todo ranking agregado", () => {
  it("o widget 'Votos por Diretor' do dashboard renderiza d.agencia_sigla", () => {
    const codigo = semComentarios(DASH);
    // Dois widgets agregados na página; ambos têm de renderizar a sigla.
    const ocorrencias = codigo.match(/\{d\.agencia_sigla && \(/g) ?? [];
    expect(ocorrencias.length).toBe(2);
  });

  it("a tabela da tela Votos dos Diretores renderiza d.agencia_sigla junto do nome", () => {
    const codigo = semComentarios(VOTOS);
    expect(codigo).toMatch(/\{d\.diretor_nome\}[\s\S]{0,300}?\{d\.agencia_sigla && \(/);
  });

  it("a rota de origem entrega agencia_sigla por linha — o contrato do qual a tela depende", () => {
    const rota = readFileSync(
      join(RAIZ, "src/app/api/v1/dashboard/diretores/overview/route.ts"), "utf-8");
    expect(rota).toMatch(/agencia_sigla: /);
  });
});
