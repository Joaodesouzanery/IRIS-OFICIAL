/**
 * Etapa 81 (Fase 13) — documento sem SINAL de deliberação não vira deliberação.
 *
 * ═══ O caso real ═══
 * A auditoria de produção achou manuais do site institucional da ANM gravados como
 * `tipo_documento: "deliberacao"` e contados como decisão final:
 *   · manual-da-agenda-regulatoria-da-anm_2a-versao.pdf  (data 2024-07-25, resultado "Aprovado")
 *   · manual-de-sistema-dipem.pdf                        (interessado: "desejada para cadastrar
 *                                                         os colaboradores.", data 2013-11-28)
 *   · sistema-de-dados-minerarios-sdm-instrucoes-de-uso.pdf (tudo null)
 * 36 "deliberações finais" da ANM eram isso — e a agência tem ZERO de 2026 de verdade.
 *
 * É o falso positivo da reordenação do classifyLinkType (Fase 7), do lado que a certificação NÃO
 * protege (ela valida extração, não quantos documentos entram) — o usuário tinha antecipado.
 *
 * ═══ A regra (especificada pelo usuário) ═══
 * Deliberação sem numero_deliberacao, sem processo, sem relator, sem numero_reuniao e sem itens
 * de ata NÃO é deliberação. Bloqueante (C21) nos dois gates; no confirm-lote, arquiva com motivo
 * próprio `nao_deliberativo` — manual de sistema não é "revisável para deliberação".
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { checarSinalDeDeliberacao } from "@/lib/server/consistency-checks";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

/** Os três manuais REAIS, com os campos exatos que a produção gravou. */
const MANUAIS = [
  { nome: "manual-da-agenda-regulatoria", numeroDeliberacao: null, processo: null, relator: null,
    numeroReuniao: null, ataItemsCount: 0, resultado: "Aprovado", dataReuniao: "2024-07-25" },
  { nome: "manual-de-sistema-dipem", numeroDeliberacao: null, processo: null, relator: null,
    numeroReuniao: null, ataItemsCount: 0, resultado: null, dataReuniao: "2013-11-28" },
  { nome: "sdm-instrucoes-de-uso", numeroDeliberacao: null, processo: null, relator: null,
    numeroReuniao: null, ataItemsCount: 0, resultado: null, dataReuniao: null },
];

const base = { tipoDocumento: "deliberacao" as string | null };

describe("etapa81 · C21: os manuais reais são BLOQUEADOS", () => {
  it.each(MANUAIS)("«$nome» recebe C21 bloqueante", (m) => {
    const achados = checarSinalDeDeliberacao({ ...base, ...m });
    expect(achados).toHaveLength(1);
    expect(achados[0].codigo).toBe("C21_SEM_SINAL_DE_DELIBERACAO");
    expect(achados[0].nivel).toBe("bloqueante");
  });
});

describe("etapa81 · GUARDA DE FALSO POSITIVO: cada sinal, sozinho, libera", () => {
  const semNada = { ...base, numeroDeliberacao: null, processo: null, relator: null,
    numeroReuniao: null, ataItemsCount: 0 };

  it.each([
    ["numero_deliberacao", { numeroDeliberacao: "127" }],
    ["processo", { processo: "134.00031360/2024-78" }],
    ["relator", { relator: "Lucas Asfor" }],
    ["numero_reuniao", { numeroReuniao: "1182" }],
    ["itens de ata", { ataItemsCount: 3 }],
  ] as const)("com %s presente, não bloqueia", (_rotulo, extra) => {
    expect(checarSinalDeDeliberacao({ ...semNada, ...extra })).toEqual([]);
  });

  it("tipo que NÃO é deliberação nunca é alcançado pelo check", () => {
    // Ata, pauta e voto_individual têm regras próprias — o C21 é sobre o rótulo "deliberacao".
    for (const tipo of ["ata", "pauta", "voto_individual", "documento_apoio", null]) {
      expect(checarSinalDeDeliberacao({ ...semNada, tipoDocumento: tipo })).toEqual([]);
    }
  });
});

describe("etapa81 · o check está LIGADO nos dois lugares", () => {
  it("upload-analysis empurra o C21 na suíte de achados", () => {
    const codigo = ler("src/lib/server/upload-analysis.ts")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(codigo).toMatch(/checarSinalDeDeliberacao\(\{/);
  });

  it("confirm-lote arquiva com motivo próprio `nao_deliberativo` — não fica em revisão eterna", () => {
    const codigo = ler("src/app/api/v1/upload/confirm-lote/route.ts")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(codigo).toMatch(/arquivar\(doc, "nao_deliberativo"\)/);
    // e o número sobe na resposta — arquivamento invisível é o anti-padrão da casa.
    expect(codigo).toMatch(/arquivados_nao_deliberativos/);
  });

  it("o orquestrador propaga o contador novo", () => {
    const codigo = ler("src/app/api/v1/pipeline/run/route.ts")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    expect(codigo).toMatch(/arquivados_nao_deliberativos/);
  });
});
