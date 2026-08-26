/**
 * Etapa 69 (Fase 8) — falha de download deixa de ser morte permanente.
 *
 * ═══ O furo ═══
 * Após 3 falhas o item virava `ignorado` e o re-crawl NUNCA o revisava: na colisão de `hash_item`
 * o coletor só atualiza `last_seen_at`. Portal fora do ar durante as tentativas = ata perdida
 * para sempre, mesmo com o portal de volta no dia seguinte.
 *
 * E as "3 tentativas" nunca foram 3 dias: entre elas o item ficava em `novo`, e a chamada seguinte
 * do MESMO laço o re-selecionava do topo da janela — as três queimavam em segundos, dentro de uma
 * rodada de 50s. O contador media rodadas de laço, não paciência.
 *
 * ═══ O que este arquivo protege ═══
 * A análise de risco listou quatro maneiras de o conserto sair pior que o problema. Cada uma delas
 * virou teste: head-of-line na janela, ping-pong de desarquivamento, relógio que nunca vence, e
 * retry eterno.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const ENQUEUE = ler("src/app/api/v1/deliberacoes/enqueue-pdfs/route.ts");
const MIGRATION = ler("supabase/migrations/20260826140000_monitoramento_itens_retry.sql");
/**
 * SQL sem comentários. Uma versão anterior deste arquivo casava o backfill ATRAVÉS do comentário
 * que o explica — comentar o `UPDATE` deixava o teste verde. Num arquivo cujo corpo é metade
 * comentário, asserção sobre SQL tem de olhar só o SQL.
 */
const MIGRATION_SQL = MIGRATION.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const UPLOAD_QUEUE = ler("src/lib/server/upload-queue.ts");

describe("etapa69 · o relógio do backoff é uma COLUNA, não metadata", () => {
  it("a migration cria as colunas dedicadas", () => {
    expect(MIGRATION_SQL).toMatch(/ADD COLUMN IF NOT EXISTS tentativas INTEGER/);
    expect(MIGRATION_SQL).toMatch(/ADD COLUMN IF NOT EXISTS proxima_tentativa_em TIMESTAMPTZ/);
  });

  it("o backoff NÃO é derivado de last_seen_at", () => {
    // `last_seen_at` é bumpado a cada re-crawl que vê o link — e o crawl diário vê. Um backoff
    // baseado nele nunca venceria justamente no caso que importa.
    // (A primeira versão deste teste proibia as duas colunas de aparecerem perto uma da outra e
    // reprovava o `update` legítimo, onde ambas convivem. A propriedade real é sobre o que a
    // ELEGIBILIDADE consulta e sobre como o prazo é CALCULADO.)
    expect(ENQUEUE).toMatch(/\.lte\("proxima_tentativa_em", agora\)/);
    expect(ENQUEUE).not.toMatch(/\.(lte|lt|gt|gte)\("last_seen_at"/);
    expect(ENQUEUE).toMatch(/function proximaTentativaEm[\s\S]{0,200}?Date\.now\(\)/);
    expect(ENQUEUE).toMatch(/proxima_tentativa_em: desistiu \? null : proximaTentativaEm/);
  });

  it("o contador NÃO vive só em metadata — que é sobrescrito inteiro pelo auto-enfileiramento", () => {
    expect(ENQUEUE).toMatch(/tentativas: ciclo/);
    // O ciclo é lido da COLUNA do item, não do jsonb.
    expect(ENQUEUE).toMatch(/Number\(\(item as any\)\.tentativas\)/);
  });

  it("o PASSIVO já arquivado entra no retry — senão o conserto nasce sem efeito", () => {
    // Um predicado `proxima_tentativa_em <= agora` avalia NULL nas linhas antigas, e NULL não
    // satisfaz `<=`: sem backfill, exatamente os itens que motivaram o conserto ficariam de fora.
    expect(MIGRATION_SQL).toMatch(/UPDATE monitoramento_itens[\s\S]{0,400}?proxima_tentativa_em = NOW\(\)/);
    expect(MIGRATION_SQL).toMatch(/enqueue_motivo' = 'download_falhou'/);
  });

  it("o backoff é em DIAS — o cron roda 1x/dia, horas seria o mesmo que nada", () => {
    const m = ENQUEUE.match(/const dias = \[([\d, ]+)\]/);
    expect(m, "a progressão precisa ser explícita").toBeTruthy();
    const dias = m![1].split(",").map((n) => Number(n.trim()));
    expect(dias[0]).toBeGreaterThanOrEqual(1);
    expect(dias[dias.length - 1], "a última espera precisa ser longa o bastante").toBeGreaterThanOrEqual(7);
    expect(dias.every((d, i) => i === 0 || d > dias[i - 1]), "tem de ser crescente").toBe(true);
  });
});

describe("etapa69 · o retry NÃO rouba a vez do trabalho novo", () => {
  it("é uma consulta SEPARADA, não um `.in(status, [novo, ignorado])`", () => {
    // Misturar colocaria os itens que falharam no TOPO (são os mais recentes, e a janela ordena
    // por data_reuniao DESC), ocupando as 60 vagas antes dos itens realmente novos — o
    // head-of-line de "208 detectados / 0 na fila" que a esteira já pagou uma vez.
    expect(ENQUEUE).not.toMatch(/\.in\("status", \["novo", "ignorado"\]\)/);
    expect(ENQUEUE).toMatch(/\.eq\("status", "ignorado"\)[\s\S]{0,300}?COTA_RETRY_POR_CHAMADA/);
  });

  it("tem cota própria e pequena", () => {
    const m = ENQUEUE.match(/COTA_RETRY_POR_CHAMADA = (\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(Number(m![1]), "cota grande devolve o head-of-line por outro nome").toBeLessThanOrEqual(10);
  });

  it("os NOVOS entram primeiro na lista de candidatos", () => {
    expect(ENQUEUE).toMatch(/const candidates = \[\.\.\.novosCandidatos, \.\.\.retentar\.slice/);
  });

  it("o retry só ocupa o que sobra da fatia — nunca amplia a janela", () => {
    expect(ENQUEUE).toMatch(/Math\.max\(0, limit - novosCandidatos\.length\)/);
  });
});

describe("etapa69 · só falha de REDE volta", () => {
  it("`download_falhou` é elegível; `sem_pdf` não", () => {
    // `sem_pdf` é decisão de CONTEÚDO: a página foi lida e não tinha documento de decisão.
    // Retentá-la é gastar a rodada relendo a mesma página institucional — e, pior, ela seria
    // RE-arquivada, voltando a consumir o teto de vazão da rodada.
    expect(ENQUEUE).toMatch(/meta\.enqueue_motivo === "download_falhou"/);
    expect(ENQUEUE).not.toMatch(/enqueue_motivo === "sem_pdf"[\s\S]{0,60}retentar/);
  });
});

describe("etapa69 · o retry não vira eterno", () => {
  it("há teto de ciclos", () => {
    const m = ENQUEUE.match(/MAX_CICLOS_RETRY = (\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(2);
    expect(Number(m![1])).toBeLessThanOrEqual(8);
  });

  it("a consulta filtra pelo teto — não só o código de escrita", () => {
    expect(ENQUEUE).toMatch(/\.lt\("tentativas", MAX_CICLOS_RETRY\)/);
  });

  it("desistir apaga o prazo e DIZ que desistiu", () => {
    expect(ENQUEUE).toMatch(/desistiu \? null :/);
    expect(ENQUEUE).toMatch(/download_falhou_desistido/);
  });

  it("sucesso zera o ciclo e limpa o prazo", () => {
    expect(ENQUEUE).toMatch(/status: "importado",[\s\S]{0,400}?tentativas: 0,[\s\S]{0,120}?proxima_tentativa_em: null/);
  });
});

describe("etapa69 · o retry não reabre o ping-pong pela porta dos fundos", () => {
  it("documento arquivado por DECISÃO não é mais desarquivado no enfileiramento", () => {
    // `ignored` é o status que o confirm-lote grava ao arquivar pauta/apoio/duplicata/ilegível.
    // Mapeá-lo para `existing_failed` fazia `enqueuePdfBuffer` chamar `requeueDocument`, que o
    // devolve para 'queued' e apaga o texto extraído — desfazendo a decisão. Com o item indo a
    // terminal no primeiro tropeço isso quase nunca acontecia; com retry, seria a regra.
    expect(UPLOAD_QUEUE).toMatch(/if \(status === "ignored"\) return "existing_archived";/);
    expect(UPLOAD_QUEUE).toMatch(/if \(status === "failed"\) return "existing_failed";/);
    expect(UPLOAD_QUEUE).not.toMatch(/status === "failed" \|\| status === "ignored"\) return "existing_failed"/);
  });

  it("`existing_archived` não entra na fila de processamento", () => {
    expect(ENQUEUE).toMatch(/enqueued\.status === "queued" \|\| enqueued\.status === "existing_failed"/);
    expect(ENQUEUE).not.toMatch(/enqueued\.status === "existing_archived"[\s\S]{0,80}jobsToProcess\.push/);
  });

  it("`failed` continua sendo reprocessado — ali a extração quebrou de verdade", () => {
    expect(UPLOAD_QUEUE).toMatch(/existing_failed" && existingDoc\.upload_job_id/);
  });
});

describe("etapa69 · o blip de um segundo não custa um dia", () => {
  it("o download passou a usar `resilientFetch` em vez de fetch cru", () => {
    expect(ENQUEUE).toMatch(/resilientFetch\(url, \{/);
    expect(ENQUEUE).toContain("@/lib/server/resilient-fetch");
  });

  it("os parâmetros cabem na reserva do passo — retry curto, não heroico", () => {
    const m = ENQUEUE.match(/retries: (\d+),\s*\n\s*timeoutMs: ([\d_]+)/);
    expect(m, "retries e timeout precisam ser explícitos").toBeTruthy();
    const retries = Number(m![1]);
    const timeout = Number(m![2].replace(/_/g, ""));
    // (retries + 1) tentativas × timeout + backoff tem de caber na reserva de 22s do enqueue.
    expect((retries + 1) * timeout).toBeLessThanOrEqual(22_000);
  });

  it("o guard de tamanho corta ANTES de o buffer entrar na colheita", () => {
    expect(ENQUEUE).toMatch(/MAX_BYTES_POR_DOCUMENTO/);
    expect(ENQUEUE).toMatch(/buffer\.length > MAX_BYTES_POR_DOCUMENTO/);
  });
});

describe("etapa69 · a retentativa é reportada", () => {
  it("a resposta diz quantos foram retentados e quantos deram certo", () => {
    // Sem isso, uma rodada que só retentou pareceria uma rodada que não achou nada — e a Fase 7
    // já estabeleceu que teto/adiamento silencioso é uma forma de mentir.
    expect(ENQUEUE).toMatch(/retentados: candidates\.filter/);
    expect(ENQUEUE).toMatch(/retentados_com_sucesso/);
  });
});
