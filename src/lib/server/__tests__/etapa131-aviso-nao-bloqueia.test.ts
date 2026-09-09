/**
 * Etapa 131 (Fase 23, commit 2) — "aviso" não bloqueia o auto-confirm; "bloqueante" bloqueia.
 *
 * Medido no qa-fase22 ④: 85 deliberações da ARTESP em "Revisar" por `[AVISO·C06_DECIDIDO_SEM_VOTO]`,
 * cuja própria mensagem diz "normal em órgão que não nomina voto". O nível era `aviso` na origem
 * e viajava só como texto; o gate re-derivava severidade por uma regex de prosa que não conhece o
 * prefixo. Um aviso virava bloqueio por acidente de implementação. Aprovado pelo usuário: as 85
 * passam a confirmar e a gerar voto inferido (o único tipo que a ARTESP produz).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { canAutoConfirm } from "@/lib/server/auto-confirm";
import { isWarningInformativo } from "@/lib/server/upload-analysis";
import { formatarAchados } from "@/lib/server/consistency-checks";

const RAIZ = join(__dirname, "../../../..");

function docBase(warnings: string[]) {
  return {
    id: "d1", status: "review_pending", tipo_documento: "deliberacao", agencia_id: "ag",
    extraction_confidence: 0.95, chars_per_page: 900, is_duplicate: false, warnings,
    campos_detectados: { preview: { fields: {
      tipo_documento: "deliberacao", resultado: "Aprovado", import_counts_as_final: true,
      votos_sugeridos: [{ diretor_id: "dir1", needs_review: false }],
    } } },
  } as any;
}

describe("etapa131 · a tabela: nível → bloqueia?", () => {
  const casos: Array<[string, boolean]> = [
    [formatarAchados([{ codigo: "C06_DECIDIDO_SEM_VOTO", nivel: "aviso", mensagem: "Item decidido sem nenhum voto registrado — normal em órgão que não nomina voto." }])[0], false],
    [formatarAchados([{ codigo: "C09_INTERESSADO_DIVERGENTE", nivel: "aviso", mensagem: "interessado diverge" }])[0], false],
    [formatarAchados([{ codigo: "C13_LIGADURA_RESIDUAL", nivel: "info" as any, mensagem: "ligadura" }])[0], false],
    [formatarAchados([{ codigo: "C07_UNANIMIDADE_COM_DISSENSO", nivel: "bloqueante", mensagem: "unanimidade com dissenso" }])[0], true],
    [formatarAchados([{ codigo: "C05_VOTOS_ACIMA_DO_COLEGIADO", nivel: "bloqueante", mensagem: "votos acima" }])[0], true],
    ["Sinais contraditórios: texto indica unanimidade E maioria/voto de qualidade/voto vencido sem dissidente nomeado — revisar direção antes de confirmar.", true],
    ['Voto proferido em sessão anterior por "Luiz Paniago Neves" — diretor não localizado no cadastro; o voto NÃO foi criado.', true],
    ["Documento tratado como pauta (agenda) — votos não são criados a partir dele.", false],
  ];
  it.each(casos)("«%s» bloqueia=%s", (w, bloqueia) => {
    expect(isWarningInformativo(w)).toBe(!bloqueia);
    expect(canAutoConfirm(docBase([w])).ok).toBe(!bloqueia);
  });

  it("sem warnings o doc-base passa (o teste não prova por vacuidade)", () => {
    expect(canAutoConfirm(docBase([])).ok).toBe(true);
  });
});

describe("etapa131 · uma fonte para 'informativo'", () => {
  it("nenhuma cópia da regex INFO_WARNING_RE fora do upload-analysis", () => {
    const out: string[] = [];
    (function walk(dir: string) {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) { if (n !== "__tests__") walk(p); }
        else if (/\.tsx?$/.test(n) && !p.endsWith("upload-analysis.ts") && /tratad\[oa\]\\s\+como/.test(readFileSync(p, "utf-8"))) out.push(p.slice(RAIZ.length + 1));
      }
    })(join(RAIZ, "src"));
    expect(out).toEqual([]);
  });
});
