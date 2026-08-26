/**
 * Etapa 70 (Fase 9) — re-derivar as datas impossíveis, em vez de anulá-las.
 *
 * O commit anterior impede que novas datas erradas entrem. Esta rota cuida do PASSIVO: as 38
 * deliberações da ANM datadas de antes de 2017 (32 delas em 1996), que continuam no banco.
 *
 * ═══ A decisão que este arquivo protege ═══
 * Anular a data seria PIOR que deixar 1996. `year-filter` trata deliberação sem data como
 * "serve para qualquer filtro": as 38 sairiam de um limbo silencioso (fora de todo ano real) para
 * INFLAR todos os exercícios. Re-derivar é a única opção que devolve dado certo. Só o resíduo
 * irrecuperável vira NULL — e nunca NULL sozinho, sempre com marcador de revisão.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ROTA = readFileSync(join(RAIZ, "src/app/api/v1/admin/deliberacoes/redatar/route.ts"), "utf-8");

describe("etapa70 · a rota segue o contrato da casa", () => {
  it("é dry_run por padrão — escrita exige `?dry_run=0`", () => {
    expect(ROTA).toMatch(/dry_run"\) !== "0"/);
    expect(ROTA).toMatch(/if \(dryRun\)/);
  });

  it("tem gate de demo com TODAS as chaves do real (lição da etapa65)", () => {
    const demo = ROTA.slice(ROTA.indexOf('modo: "demo"'), ROTA.indexOf("const guard"));
    for (const chave of ["candidatas", "corrigidas", "sem_data_recuperavel", "reunioes_orfas_removidas", "restantes", "amostra"]) {
      expect(demo, `ramo demo sem \`${chave}\``).toContain(chave);
    }
  });

  it("honra o orçamento — não repete o erro do reprocess-ignorados", () => {
    // Aquela rota fixa 50s e ignora o `budget_ms` que o orquestrador manda.
    expect(ROTA).toMatch(/budgetFromRequest\(req\)/);
    expect(ROTA).not.toMatch(/Date\.now\(\) \+ 50_000/);
    expect(ROTA).toMatch(/hasBudget\(deadlineAt, RESERVA_POR_LINHA_MS\)/);
  });

  it("para graciosamente e DIZ que parou", () => {
    expect(ROTA).toMatch(/restantes = true; break;/);
    expect(ROTA).toMatch(/restantes,/);
  });
});

describe("etapa70 · a re-derivação usa SÓ o caminho ancorado", () => {
  it("não há segundo chute — seria reintroduzir o bug que estamos limpando", () => {
    expect(ROTA).toMatch(/extractAnmMeetingMetadata/);
    expect(ROTA).toMatch(/SÓ o caminho ancorado/);
  });

  it("a data re-derivada passa pelo MESMO guard", () => {
    // Sem isto, um texto que cite outra lei antiga produziria uma segunda data impossível — e a
    // rota gravaria com a convicção de ter consertado.
    expect(ROTA).toMatch(/if \(nova && !dataReuniaoPlausivel\(sigla, nova\)\.plausivel\) nova = null/);
  });

  it("busca o texto no documento primeiro, e só depois no que a deliberação guardou", () => {
    const i = ROTA.indexOf("texto_extraido");
    const j = ROTA.indexOf("raw.texto_trecho");
    expect(i).toBeGreaterThan(-1);
    expect(i, "o texto íntegro do documento é a fonte melhor").toBeLessThan(j);
  });
});

describe("etapa70 · NULL nunca vai sozinho", () => {
  it("invalidar a data grava o valor antigo, o motivo e o marcador de revisão", () => {
    const bloco = ROTA.slice(ROTA.indexOf("data_reuniao: null"));
    for (const campo of ["data_invalidada_valor", "data_invalidada_motivo", "precisa_revisao_data"]) {
      expect(bloco, `NULL sem \`${campo}\` é um erro silencioso novo`).toContain(campo);
    }
  });

  it("a rota explica por que anular seria pior", () => {
    expect(ROTA).toMatch(/contada em todos os anos|conta deliberação sem data em TODOS os anos/i);
  });
});

describe("etapa70 · o DELETE é só nas reuniões órfãs", () => {
  it("apaga apenas linhas de `reunioes`, nunca deliberações", () => {
    expect(ROTA).toMatch(/from\("reunioes"\)\.delete\(\)/);
    expect(ROTA).not.toMatch(/from\("deliberacoes"\)\.delete\(\)/);
  });

  it("confere que não há filho antes de apagar", () => {
    // Apagar uma reunião que ainda tem deliberação apontando para ela deixaria FK órfã — e o
    // dado primário é a deliberação, não o rollup.
    expect(ROTA).toMatch(/count \?\? 0\) > 0\) continue/);
  });

  it("roda DEPOIS de religar as deliberações", () => {
    expect(ROTA.indexOf("ensureReuniao(db")).toBeLessThan(ROTA.indexOf('from("reunioes").select'));
  });

  it("não apaga em dry_run", () => {
    expect(ROTA).toMatch(/if \(!dryRun && hasBudget\(deadlineAt, 3_000\)\)/);
  });
});
