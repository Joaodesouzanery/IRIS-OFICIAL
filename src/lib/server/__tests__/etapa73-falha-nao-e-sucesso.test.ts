/**
 * Etapa 73 (Fase 10, commit 2) — o passo que falha deixa de ser contabilizado como sucesso.
 *
 * ═══ O bug ═══
 * `call()` terminava em `return await res.json()`. O **status HTTP nunca era olhado**: uma
 * sub-rota que respondia 403 virava `{}`, o passo era gravado sem a chave `erro`, e
 * `contarPassos` — que só reconhece falha por essa chave — o somava como acerto. O disjuntor,
 * que existe para PARAR uma esteira que está falhando, não via nada.
 *
 * Isso não era hipotético. Sob o cron diário, TRÊS passos respondiam 403 porque usavam
 * `requireAdmin` em vez de `requireAdminOrCron` — `confirm-lote` (o único que transforma
 * documento em deliberação em massa), `dedup` e `recompute`. O cron rodava todo dia, não
 * materializava uma linha, e reportava sucesso.
 *
 * ═══ A guarda que este arquivo protege ═══
 * O conserto tem um falso positivo óbvio à espreita: a rodada agora é PLANEJADA, então nem todos
 * os doze passos são oferecidos sempre. Se "não foi tentado" virasse "falhou", o disjuntor
 * abriria numa esteira saudável — pior que o bug original. Passo não-tentado não entra na conta,
 * nem como acerto nem como falha.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { contarPassos, deveAbrirDisjuntor } from "@/lib/server/esteira-run";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const RUN = ler("src/app/api/v1/pipeline/run/route.ts");

describe("etapa73 · o desfecho HTTP passa a existir", () => {
  it("call() olha o status — 2xx é sucesso, o resto não é", () => {
    expect(RUN).toMatch(/ok: res\.status >= 200 && res\.status < 300/);
    // A linha que engolia tudo.
    expect(RUN).not.toMatch(/return await res\.json\(\)\.catch/);
  });

  it("a falha de HTTP vira a chave `erro`, que é o que o disjuntor conta", () => {
    expect(RUN).toMatch(/if \(!r\.ok\) return \{ \.\.\.campos, erro: /);
  });

  it.each([
    ["/api/v1/deliberacoes/enqueue-pdfs", "enfileiramento"],
    ["/api/v1/upload/process?limit=20", "extração"],
  ])("o laço de «%s» (%s) checa o desfecho antes de ler o corpo", (rota) => {
    // Os dois laços não têm try/catch: sem isto, um 500 sairia como "0 enfileirados" ou
    // "0 processados", indistinguível de "não havia nada a fazer".
    // Amarrado a CADA laço: asserção genérica por `falhaIngestao` passava mesmo removendo o
    // check de um deles, porque o símbolo continuava aparecendo no outro.
    const codigo = RUN.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ").replace(/\s+/g, " ");
    // Ancorar no PATH e não no handler: `processPOST` serve DOIS sítios (o reaper barato e o laço
    // de extração), e o nome solto ainda casaria antes na linha de import.
    const m = new RegExp(`await call\\( ?[A-Za-z]+, ?"${rota.replace(/[/?=]/g, (c) => `\\${c}`)}"`).exec(codigo);
    expect(m, `chamada a ${rota} não encontrada`).not.toBeNull();
    expect(codigo.slice(m!.index, m!.index + 320)).toMatch(/if \(!r\.ok && !r\.pulado\)/);
  });

  it("a falha do laço sobrevive ao laço e vira `erro` na etapa", () => {
    expect(RUN).toMatch(/erro: `ingestão\/extração respondeu HTTP \$\{falhaIngestao\.status\}`/);
  });
});

describe("etapa73 · GUARDA DE FALSO POSITIVO: não-tentado não é falha", () => {
  it("passo pulado por falta de fatia não recebe a chave `erro`", () => {
    expect(RUN).toMatch(/if \(r\.pulado\) return \{ pulado: /);
  });

  it("passo fora do plano da rodada é registrado, e não como erro", () => {
    expect(RUN).toMatch(/fora_do_plano: /);
    // Antes o `else` só fazia `restantes = true` — o passo sumia do relatório em silêncio, e é
    // por isso que 26 rodadas sem extrair nada pareceram normais.
    expect(RUN).not.toMatch(/\} else restantes = true;/);
  });

  it("contarPassos IGNORA o não-tentado — nem acerto, nem falha", () => {
    expect(contarPassos({ a: { pulado: "sem fatia" } })).toEqual({ ok: 0, erro: 0 });
    expect(contarPassos({ a: { fora_do_plano: "próxima rodada" } })).toEqual({ ok: 0, erro: 0 });
  });

  it("uma rodada inteira de passos não-tentados NÃO abre o disjuntor", () => {
    // O cenário exato do falso positivo: orçamento apertado, plano pequeno, nada falhou.
    const etapas = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`p${i}`, { fora_do_plano: "próxima rodada" }]),
    );
    const { ok, erro } = contarPassos(etapas);
    expect(erro).toBe(0);
    expect(deveAbrirDisjuntor(ok, erro)).toBe(false);
  });

  it("mas falha DE VERDADE continua contando — e abre o disjuntor", () => {
    // O disjuntor exige DISJUNTOR_MIN_PASSOS (8) para não disparar com ruído. Como `passos_ok` e
    // `passos_erro` ACUMULAM entre rodadas em `registrarRodada`, ignorar os não-tentados não
    // impede o disjuntor de abrir: só faz a amostra crescer mais devagar, com dados honestos.
    const etapas: Record<string, Record<string, unknown>> = {
      x: { ok: true }, y: { ok: true }, z: { pulado: "sem fatia" },
    };
    for (let i = 0; i < 7; i++) etapas[`f${i}`] = { erro: "HTTP 403" };
    const { ok, erro } = contarPassos(etapas);
    expect({ ok, erro }).toEqual({ ok: 2, erro: 7 });
    expect(deveAbrirDisjuntor(ok, erro)).toBe(true);
  });

  it("passo que rodou e não achou trabalho continua sendo sucesso", () => {
    // "0 confirmados" numa fila vazia é o desfecho correto, não uma falha.
    expect(contarPassos({ a: { confirmados: 0, restantes: false } })).toEqual({ ok: 1, erro: 0 });
  });
});

describe("etapa73 · o cron deixa de bater em porta fechada", () => {
  it.each([
    ["src/app/api/v1/upload/confirm-lote/route.ts", "upload/confirm-lote"],
    ["src/app/api/v1/admin/deliberacoes/dedup/route.ts", "admin/deliberacoes/dedup"],
    ["src/app/api/v1/admin/diretores/candidatos/recompute/route.ts", "admin/diretores/candidatos/recompute"],
  ])("%s aceita o cron", (arquivo) => {
    const fonte = ler(arquivo);
    expect(fonte).toMatch(/const guard = await requireAdminOrCron\(req/);
    expect(fonte).not.toMatch(/await requireAdmin\(req\)/);
  });

  it("TODA sub-rota chamada pelo orquestrador aceita o cron", () => {
    // Tabular de propósito: consertar as três de hoje não impediria a quarta. O orquestrador
    // encaminha o MESMO Authorization para as sub-rotas, então qualquer uma que exija sessão
    // quebra a esteira inteira sob o cron — em silêncio, porque o status era ignorado.
    const rotas = [...RUN.matchAll(/await call\(\s*[A-Za-z]+,\s*"(\/api\/v1\/[^"?]+)/g)].map((m) => m[1]);
    expect(rotas.length).toBeGreaterThan(8);
    for (const rota of new Set(rotas)) {
      const fonte = ler(`src/app${rota}/route.ts`);
      expect(fonte, `«${rota}» não aceita o cron`).not.toMatch(/const guard = await requireAdmin\(req\)/);
    }
  });
});

describe("etapa73 · a medição dos reapers para de ser jogada fora", () => {
  it("`religados` e `reaped` sobem do processPendingDocuments até a etapa", () => {
    // Eram devolvidos pela rota e descartados: "0 extraídos" e "0 presos soltos" liam igual.
    expect(RUN).toMatch(/religados \+= Number\(r\.body\?\.religados \?\? 0\)/);
    expect(RUN).toMatch(/reapados \+= Number\(r\.body\?\.reaped \?\? 0\)/);
    expect(RUN).toMatch(/presos_religados: religados/);
  });
});
