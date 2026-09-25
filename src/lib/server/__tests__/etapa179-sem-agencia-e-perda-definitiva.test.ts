/**
 * Etapa 179 (Fase 31, Bloco 3) — o documento sem agência, e o que os 251 U+FFFD realmente custam.
 *
 * ═══ (a) A agência que o pipeline apagava ═══
 * `pipeline.ts` gravava `upload_jobs.agencia_id = analysis.agencia_id_detected` **sem fallback**.
 * `agencia_id_detected` é `null` quando a análise não resolve (PDF escaneado não tem texto), e o
 * `update` punha esse `null` por cima do valor que a ESTEIRA conhecia — o item de monitoramento sabe
 * de que site o documento veio. A linha do DOCUMENTO, logo acima, era salva pelo `?? job.agencia_id`;
 * a do JOB não era.
 *
 * E a perda não ficava no job: `upload-queue.ts:143` (`agenciaId ?? existingJob.agencia_id`) lê esse
 * campo quando um documento nasce de job já existente. Num reenvio do mesmo PDF sem escolher agência,
 * o documento novo nascia com `agencia_id` NULL.
 *
 * ⚠️ E documento sem agência é BECO SEM SAÍDA: `deliberacoes.agencia_id` é NOT NULL
 * (`001_initial_schema.sql:70`), então ele nunca vira deliberação — fica no acervo sem poder avançar
 * e sem aparecer em nenhuma contagem por agência.
 *
 * ═══ (b) ⚠️ UMA CORREÇÃO DO QUE ESTA FASE AFIRMOU ═══
 * O commit `d9ac996` disse que os 251 nomes com U+FFFD "só voltam do ZIP no Storage".
 * **O ZIP nunca vai para o Storage.** `enqueuePdfBuffer` sobe só os PDFs extraídos, em
 * `${agenciaId ?? "auto"}/${fileHash}.pdf`; o ZIP é aberto em memória e descartado.
 *
 * A única via real é `metadata.source_url`, que a esteira grava. Upload manual não tem URL — ali o
 * `source_archive` é só o nome do arquivo que o operador escolheu. Esses são **perda definitiva**, e
 * o relatório tem de dizer isso em vez de prometer um reparo que não existe.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const PIPE = semComentarios(ler("src/lib/server/pipeline.ts"));
const MOJIBAKE = semComentarios(ler("src/app/api/v1/admin/documentos/mojibake/route.ts"));
const QA31 = ler("docs/qa-fase31.sql");

describe("etapa179 · ⚠️ o pipeline para de apagar a agência do job", () => {
  it("o update do job tem o fallback, igual ao do documento", () => {
    expect(PIPE).toMatch(/agencia_id: analysis\.agencia_id_detected \?\? job\.agencia_id,\s*\n\s*updated_at/);
  });

  it("⚠️ o update SEM fallback não pode voltar", () => {
    expect(PIPE, "voltou o update que apaga a agência do job")
      .not.toMatch(/status: "done", agencia_id: analysis\.agencia_id_detected,/);
  });

  it("as DUAS linhas usam o mesmo fallback — a assimetria era o defeito", () => {
    // A do documento sempre teve; a do job não. Uma só das duas protegida é o que produziu o NULL.
    const comFallback = (PIPE.match(/analysis\.agencia_id_detected \?\? job\.agencia_id/g) ?? []).length;
    expect(comFallback, "as duas linhas deveriam ter o fallback").toBe(2);
  });

  it("e `upload-queue` continua lendo o campo do job — é por isso que apagá-lo propagava", () => {
    const QUEUE = semComentarios(ler("src/lib/server/upload-queue.ts"));
    expect(QUEUE).toMatch(/agencia_id: agenciaId \?\? \(existingJob\.agencia_id as string \| null\) \?\? null/);
  });
});

describe("etapa179 · ⚠️ os irreparáveis: o ZIP NÃO está no Storage", () => {
  it("só os PDFs extraídos são guardados, sob `auto/` quando não há agência", () => {
    const QUEUE = semComentarios(ler("src/lib/server/upload-queue.ts"));
    expect(QUEUE).toMatch(/const storagePath = `\$\{agenciaId \?\? "auto"\}\/\$\{fileHash\}\.pdf`/);
    // Se alguém passar a subir o ZIP, esta expectativa cai e o diagnóstico tem de ser revisto.
    expect(QUEUE, "o ZIP passou a ir para o Storage — reavalie a recuperabilidade dos U+FFFD")
      .not.toMatch(/\.upload\([^)]*\.zip/i);
  });

  it("a rota separa o que é RECUPERÁVEL por URL do que é PERDA DEFINITIVA", () => {
    expect(MOJIBAKE).toMatch(/u_fffd_recuperavel_por_url: m\.fffdComSourceUrl/);
    expect(MOJIBAKE).toMatch(/u_fffd_perda_definitiva: m\.fffdSemFonte/);
  });

  it("e a partição é pelo `source_url`, que só a esteira grava", () => {
    expect(MOJIBAKE).toMatch(/if \(texto\(meta\.source_url\)\) fffdComSourceUrl\+\+;/);
    expect(MOJIBAKE).toMatch(/else fffdSemFonte\+\+;/);
    const ESTEIRA = semComentarios(ler("src/app/api/v1/deliberacoes/enqueue-pdfs/route.ts"));
    expect(ESTEIRA, "a esteira parou de gravar source_url — a via de recuperação some")
      .toMatch(/source_url: pdf\.url/);
  });

  it("⚠️ a soma fecha: recuperável + perda definitiva = o total de U+FFFD", () => {
    // Todo documento com U+FFFD cai em exatamente um dos dois — o `if/else` garante.
    const i = MOJIBAKE.indexOf("comFffd++;");
    const bloco = MOJIBAKE.slice(i, i + 200);
    expect(bloco).toMatch(/if \(texto\(meta\.source_url\)\) fffdComSourceUrl\+\+;\s*else fffdSemFonte\+\+;/);
  });
});

describe("etapa179 · o bloco de QA do documento sem agência", () => {
  it("existe, e mede pelo `agencia_id IS NULL`", () => {
    expect(QA31).toMatch(/'7_documento_sem_agencia'/);
    expect(QA31).toMatch(/WHERE dr\.agencia_id IS NULL/);
  });

  it("⚠️ inclui a impressão digital do `storage_path` em `auto/`", () => {
    // Ela sobrevive mesmo que a agência seja preenchida depois, então aponta o caminho 1 (upload
    // manual de ZIP sem escolher agência) mesmo em documento já corrigido.
    expect(QA31).toMatch(/dr\.storage_path LIKE 'auto\/%'/);
  });

  it("e declara que documento sem agência NUNCA vira deliberação", () => {
    const i = QA31.indexOf("'7_documento_sem_agencia'");
    const antes = QA31.slice(Math.max(0, i - 2200), i);
    expect(antes).toMatch(/BECO SEM SAIDA/);
    expect(antes).toMatch(/NOT NULL/);
  });

  it("⚠️ CADA UM dos três caminhos tem estado declarado — dois abertos, um consertado", () => {
    /**
     * ⚠️ A contagem é o ponto. A primeira versão fazia `toMatch(/ABERTO/)` e **sobreviveu à mutação**
     * que apagava o marcador do caminho 1 — porque o caminho 2 também diz ABERTO, e um `toMatch`
     * acha qualquer um dos dois. O número no relatório não pode ser lido como "resolvido" enquanto
     * dois caminhos seguem abertos, e é essa a propriedade: os TRÊS têm estado, não "algum tem".
     *
     * Quinto caso desta forma nesta fase, sempre o mesmo: procurar texto em vez de medir a
     * propriedade.
     */
    const i = QA31.indexOf("'7_documento_sem_agencia'");
    const antes = QA31.slice(Math.max(0, i - 2200), i);
    expect((antes.match(/ABERTO\./g) ?? []).length, "faltou marcar um caminho como ABERTO").toBe(2);
    expect((antes.match(/CONSERTADO nesta fase/g) ?? []).length).toBe(1);
    // E os três estão numerados, para ninguém perder um pelo caminho.
    for (const n of ["1.", "2.", "3."]) {
      expect(antes, `o caminho ${n} sumiu da lista`).toContain(`--    ${n}`);
    }
  });

  it("`deliberacoes.agencia_id` é de fato NOT NULL — o beco sem saída é real", () => {
    const MIG = ler("supabase/migrations/001_initial_schema.sql");
    expect(MIG).toMatch(/agencia_id\s+UUID NOT NULL REFERENCES agencias\(id\)/);
  });
});
