/**
 * Etapa 79 (Fase 12) — dois vazamentos silenciosos de voto/empresa, achados na auditoria.
 *
 * ═══ Bug 1 · a inferência era desligada por qualquer nome extraído ═══
 * `shouldInferVotesFromMandate` tem um parâmetro `diretoresList` cujo docstring explica a
 * própria razão de existir: com o cadastro em mãos, "nomes extraídos" só bloqueiam a inferência
 * se algum CASA com alta confiança (vira voto nominal de fato). Sem o cadastro, o fallback é
 * `Boolean(nomes?.length)` — qualquer lixo extraído (signatário de rodapé, nome que não casa)
 * desliga a inferência E não gera voto nominal: item unânime nasce com MENOS votos que o
 * colegiado. Os dois sítios de `upload-analysis.ts` chamavam SEM o parâmetro, com o
 * `diretoresList` disponível no escopo. E o estrago era irreversível: `votos_sugeridos`
 * não-vazio faz o confirm pular o fallback (`confirm/route.ts`), e o backfill só repara
 * deliberação com ZERO voto — parcial fica parcial para sempre.
 *
 * ═══ Bug 2 · "INTERESSADOS:" plural saía null na ANTT ═══
 * Os extratores de item da ANTT usavam a regex SINGULAR (`Interessado:` seguido de espaços;
 * o próprio `*``/` da regex nem pode ser escrito neste comentário) — o plural, que existe nos
 * documentos reais, não casa (a etapa62 já tinha coberto o plural nos OUTROS dois parsers).
 * Resposta direta à pergunta do usuário sobre a extração de empresas.
 *
 * ═══ O que CAIU na verificação (registrado aqui de propósito) ═══
 * O terceiro conserto planejado — `dedupeItems` colidindo `"3.1|null"` — não se sustenta: os
 * dois extratores SEMPRE preenchem `processo` (a regex exige o número), então a chave nunca tem
 * processo nulo nesses sítios. Alegação de agente derrubada por leitura; nenhum código mudou.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { shouldInferVotesFromMandate } from "@/lib/server/vote-inference";
import { parseAnttManualDocument } from "@/lib/server/antt-manual-parser";

const RAIZ = join(__dirname, "../../../..");
const ANALYSIS = readFileSync(join(RAIZ, "src/lib/server/upload-analysis.ts"), "utf-8");
const CODIGO = ANALYSIS.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const CADASTRO = [
  { id: "d1", nome: "Guilherme Sampaio", nome_variantes: [] },
  { id: "d2", nome: "Lucas Asfor", nome_variantes: [] },
];

describe("etapa79 · bug 1: a inferência e o cadastro", () => {
  it("nome que NÃO casa com o cadastro não desliga a inferência (a semântica certa)", () => {
    const base = {
      resultado: "Aprovado",
      tipo_documento: "ata",
      import_counts_as_final: true,
      unanimidadeDetectada: true,
      nomes: ["Fulano Assinante Rodape"], // extraído, mas não é diretor
      dataReuniao: "2026-05-10",
    };
    // COM o cadastro: o nome não casa → não há voto nominal de fato → infere.
    expect(shouldInferVotesFromMandate({ ...base, diretoresList: CADASTRO })).toBe(true);
    // SEM o cadastro: o mesmo nome desliga a inferência — é o comportamento que os sítios
    // sem o parâmetro tinham, e o motivo de o item nascer com menos votos que o colegiado.
    expect(shouldInferVotesFromMandate(base)).toBe(false);
  });

  it("GUARDA DE FALSO POSITIVO: nome que CASA continua desligando a inferência", () => {
    // Voto nominal de verdade não pode ser substituído por inferência.
    expect(shouldInferVotesFromMandate({
      resultado: "Aprovado",
      tipo_documento: "ata",
      import_counts_as_final: true,
      unanimidadeDetectada: true,
      nomes: ["Guilherme Sampaio"],
      dataReuniao: "2026-05-10",
      diretoresList: CADASTRO,
    })).toBe(false);
  });

  it("os DOIS sítios de upload-analysis passam diretoresList", () => {
    // O parâmetro existia, o valor estava no escopo — só não era passado. Cada chamada tem de
    // carregar `diretoresList` dentro do objeto de argumentos.
    const chamadas = [...CODIGO.matchAll(/shouldInferVotesFromMandate\(\{([\s\S]*?)\}\)/g)];
    expect(chamadas.length).toBe(2);
    for (const [i, m] of chamadas.entries()) {
      expect(m[1], `chamada ${i + 1} sem diretoresList`).toMatch(/\bdiretoresList\b/);
    }
  });
});

describe("etapa79 · bug 2: INTERESSADOS plural na ANTT", () => {
  const ATA = `AGÊNCIA NACIONAL DE TRANSPORTES TERRESTRES - ANTT
Ata da 1040ª Reunião Ordinária da Diretoria Colegiada, realizada em 6 de agosto de 2026.
3.1 Processo nº 50500.123456/2026-11 Interessados: Transportadora Alfa S.A. Assunto: Autorização de serviço de fretamento. Decisão: Aprovado por unanimidade pela Diretoria.
3.2 Processo nº 50500.654321/2026-22 Interessado: Viação Beta Ltda. Assunto: Renovação de registro. Decisão: Aprovado por unanimidade pela Diretoria.`;

  it("o plural é capturado — antes saía null", () => {
    const r = parseAnttManualDocument(ATA, "Ata da 1040 Reuniao.pdf");
    expect(r.isAntt).toBe(true);
    const item = (r.ataItems ?? []).find((i) => i.processo?.includes("50500.123456"));
    expect(item, "item 3.1 não extraído").toBeTruthy();
    expect(item!.interessado).toMatch(/Transportadora Alfa/);
  });

  it("GUARDA DE FALSO POSITIVO: o singular continua funcionando", () => {
    const r = parseAnttManualDocument(ATA, "Ata da 1040 Reuniao.pdf");
    const item = (r.ataItems ?? []).find((i) => i.processo?.includes("50500.654321"));
    expect(item, "item 3.2 não extraído").toBeTruthy();
    expect(item!.interessado).toMatch(/Viação Beta|Viacao Beta/);
  });
});
