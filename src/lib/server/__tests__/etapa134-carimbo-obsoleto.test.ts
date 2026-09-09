/**
 * Etapa 134 (Fase 24, commit 3) — a trava de sentido único vira reavaliação.
 *
 * O auto-confirm carimba `auto_skip` e nunca mais olha o documento. Medido no qa-fase23: 68
 * "[AVISO·C06…]" e 31 "possível duplicata" carimbados pelo build antigo, invisíveis para o gate
 * novo. É o multiplicador: sem isto, nenhum conserto de gate alcança o passivo.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { desfechoDoCarimbo } from "@/lib/server/auto-skip-obsoleto";

describe("etapa134 · motivo → desfecho", () => {
  it.each([
    ["warning de qualidade: [AVISO·C06_DECIDIDO_SEM_VOTO] Item decidido sem nenhum voto", "reavaliar"],
    ["warning de qualidade: [INFO·C13_LIGADURA_RESIDUAL] …", "reavaliar"],
    ["possível duplicata", "reavaliar"],
    ["warning de qualidade: Sinais contraditórios: texto indica unanimidade E maioria…", "reanalisar"],
    ["warning de qualidade: Voto proferido em sessão anterior por \"Luiz Paniago Neves\"…", "reanalisar"],
    ["não conta como final", "reanalisar"],
    ["warning de qualidade: [BLOQUEANTE·C07_UNANIMIDADE_COM_DISSENSO] …", null],
    ["confiança 0.40 < 0.9", null],
    ["ata sem itens parseados (splitter=0) — abrir o PDF: ata real ou capa/anexo?", null],
    ["", null],
    [null, null],
  ] as Array<[string | null, string | null]>)("«%s» → %s", (motivo, esperado) => {
    expect(desfechoDoCarimbo(motivo)).toBe(esperado);
  });
});

describe("etapa134 · a passada existe, é guardada e chega ao banner", () => {
  const RAIZ = join(__dirname, "../../../..");
  const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
  it("a rota reavalia/reanalisa antes do gate, com guarda por motivo em metadata.reanalises", () => {
    const rota = ler("src/app/api/v1/upload/auto-confirm/route.ts");
    expect(rota).toMatch(/desfechoDoCarimbo\(motivo\)/);
    expect(rota).toMatch(/feitas\.includes\(motivo\)\) continue/);
    expect(rota).toMatch(/auto_skip_limpos: autoSkipLimpos/);
  });
  it("o pipeline carrega e a tela lê", () => {
    expect(ler("src/app/api/v1/pipeline/run/route.ts")).toMatch(/auto_skip_limpos: r\.body\?\.auto_skip_limpos/);
    expect(ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx")).toMatch(/totais\.reanalisados/);
  });
});
