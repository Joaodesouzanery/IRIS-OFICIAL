/**
 * Etapa 149 (Fase 28, commit 3) — o materializador ENXERGA o acervo inteiro, e o laço o ALCANÇA.
 *
 * ═══ O buraco, medido no código ═══
 * `materializar-faltantes` lia `deliberacoes` com `.limit(4000)` — e `.limit(N)` grande não é
 * paginação: o PostgREST corta em ~1.000 e devolve sem aviso. Pior que isso: o filtro "sem voto"
 * era aplicado DEPOIS, em JS, sobre essa fatia. Então materializar uma deliberação NÃO liberava
 * vaga; a linha continuava ocupando seu lugar nas 1.000. Deliberação com `id` além da milésima
 * nunca era materializada, em run nenhuma. Isso não é número errado na tela — é voto que não
 * existe, em deliberação que existe.
 *
 * ═══ Por que paginar resolve só METADE ═══
 * `lerTudo` conserta o universo. O LAÇO continua quebrando por orçamento e a rodada seguinte
 * recomeça do princípio. Com `slice(0, K)`, os itens que SEMPRE falham (sem evidência de voto,
 * roster não conferível) se acumulam na cabeça e o laço passa a remoer os mesmos fracassos —
 * universo maior, laço que não alcança, aparência de progresso sem progresso. Daí a janela
 * rotativa: o que este teste prova é COBERTURA (uma volta cobre tudo), não forma do código.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { janelaRotativa } from "@/lib/server/varredura-rotativa";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

describe("etapa149 · uma volta da janela cobre o estoque INTEIRO", () => {
  it("500 itens em lotes de 10: 50 minutos consecutivos visitam os 500, sem sobra", () => {
    const vistos = new Set<number>();
    for (let minuto = 0; minuto < 50; minuto++) {
      const j = janelaRotativa(500, 10, minuto);
      for (let i = j.inicio; i < j.fim; i++) vistos.add(i);
    }
    expect(vistos.size).toBe(500);
  });

  it("…e o `slice(0, K)` de antes cobriria 10 e travaria — é esta a diferença", () => {
    // A mutação que este caso mata: `return { inicio: 0, fim: tamanho, ... }`.
    const vistos = new Set<number>();
    for (let minuto = 0; minuto < 50; minuto++) for (let i = 0; i < 10; i++) vistos.add(i);
    expect(vistos.size).toBe(10);
  });

  it("nenhuma janela repete o início da anterior enquanto houver bloco novo", () => {
    const inicios = Array.from({ length: 5 }, (_, m) => janelaRotativa(500, 10, m).inicio);
    expect(new Set(inicios).size).toBe(inicios.length);
  });

  it("é determinística DENTRO do minuto — retentativa cai na mesma janela", () => {
    expect(janelaRotativa(500, 10, 7)).toEqual(janelaRotativa(500, 10, 7));
  });

  it("minuto negativo não vira índice negativo (que faria `slice` contar do fim, sempre igual)", () => {
    const j = janelaRotativa(500, 10, -3);
    expect(j.inicio).toBeGreaterThanOrEqual(0);
    expect(j.fim).toBeGreaterThan(j.inicio);
  });

  it.each([
    [0, 10, 0, 0],    // estoque vazio: nada a examinar
    [5, 10, 0, 5],    // lote maior que o estoque: uma janela só, e ela não passa do fim
    [10, 10, 0, 10],
  ])("total=%i lote=%i → [%i, %i)", (total, lote, inicio, fim) => {
    const j = janelaRotativa(total, lote, 0);
    expect([j.inicio, j.fim]).toEqual([inicio, fim]);
  });

  it("publica em que bloco está, de quantos — número sem contexto é mistério", () => {
    const j = janelaRotativa(500, 60, 3);
    expect(j.blocos).toBe(9);
    expect(j.bloco).toBe(3);
  });
});

describe("etapa149 · a rota não regride para o laço que não anda", () => {
  const ROTA = ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts");

  it("a projeção paginada é LEVE — paginar o jsonb gastaria a fatia antes do laço", () => {
    // O passo `backfillVotos` tem 12s e o laço só roda com mais de 8s de saldo. Se a leitura
    // trouxesse `raw_extraction`, a preparação comeria a janela e `restantes` (setado só DENTRO
    // do laço) ficaria `false`: passo verde, zero trabalho, para sempre — pior que o bug original.
    const projecao = ROTA.slice(ROTA.indexOf("const candidatos = ()"), ROTA.indexOf("const levesRes"));
    expect(projecao).toMatch(/\.select\("id, agencia_id, tipo_documento, documento_pai_id, resultado, data_reuniao"\)/);
    expect(projecao).not.toMatch(/raw_extraction/);
  });

  it("o payload pesado é buscado SÓ do lote da rodada", () => {
    const pesado = ROTA.slice(ROTA.indexOf('"materializar/lote-pesado"') - 900, ROTA.indexOf('"materializar/lote-pesado"'));
    expect(pesado).toMatch(/\.in\("id", loteBruto\.map/);
    expect(pesado).toMatch(/raw_extraction/);
  });

  it("a rodada que NÃO coube é distinguível da rodada sem trabalho", () => {
    expect(ROTA).toMatch(/const preparacaoConsumiuAFatia = loteBruto\.length > 0 && !hasBudget\(/);
    expect(ROTA).toMatch(/preparacao_consumiu_a_fatia: true/);
  });

  it("⚠️ `restantes` NÃO pode ser `blocos > 1` — seria a fila que nunca esvazia", () => {
    expect(ROTA).toMatch(/restantes: restantes \|\| rodadaNaoExaminou \|\| \(!dryRun && votosCriados > 0\),/);
    expect(ROTA).not.toMatch(/restantes:[^\n]*janela\.blocos > 1/);
  });

  it("o estoque e o alcance são números SEPARADOS — senão não dá para ver a fila drenar", () => {
    for (const chave of ["sem_voto: semVotoTotal.length", "pendentes: semVoto.length", "examinados,", "leitura_completa: leituraCompleta"]) {
      expect(ROTA).toContain(chave);
    }
  });
});

describe("etapa149 · a cobertura ao vivo sabe dizer que NÃO leu o banco inteiro", () => {
  const ROTA = ler("src/app/api/v1/admin/cobertura-ao-vivo/route.ts");

  it("o lado do banco tem o gêmeo de `enumeracao_parcial`", () => {
    // A rota sempre soube dizer "não li o site inteiro" e não sabia dizer "não li o banco
    // inteiro" — e era o lado do banco que vinha truncado, na rota usada como PROVA de cobertura.
    expect(ROTA).toMatch(/leitura_do_banco_parcial: leituraDoBancoParcial/);
    expect(ROTA).toMatch(/a leitura do BANCO ficou incompleta/);
  });

  it("o `extra` deixa de morrer quando há `faltando` — eram `else if` encadeados", () => {
    expect(ROTA).toMatch(/if \(!a\.erro && !a\.enumeracao_parcial && a\.extra\.length > 0\) \{/);
    expect(ROTA).not.toMatch(/\} else if \(a\.extra\.length > 0 && a\.faltando\.length === 0\)/);
  });
});

/**
 * ═══ O que a REVISÃO ADVERSARIAL pegou neste commit, e que nenhum teste meu pegava ═══
 * Três céticos independentes confirmaram, lendo o código: uma falha na leitura do payload pesado
 * viraria VOTO FABRICADO. `lerTudo` devolve `{error}` em vez de lançar; com o erro ignorado,
 * `pesadoPorId` fica vazio, `d.raw_extraction` fica `undefined`, e o laço lê isso como "ninguém
 * nomeado, nada contestado" — que é exatamente a condição de inferir voto para o COLEGIADO
 * INTEIRO. O banner então diria "N voto(s) recuperado(s)". Uma falha de leitura gravando voto
 * inventado é o pior desfecho possível neste arquivo.
 */
describe("etapa149 · falha de LEITURA nunca pode virar voto", () => {
  const ROTA = ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts");

  it("erro no lote pesado impede a rodada de examinar — não se processa com payload vazio", () => {
    expect(ROTA).toMatch(/if \(pesadosRes\.error\) \{\s*\n\s*lotePesadoFalhou = true;/);
    expect(ROTA).toMatch(/const rodadaNaoExaminou = preparacaoConsumiuAFatia \|\| lotePesadoFalhou;/);
    expect(ROTA).toMatch(/for \(const d of \(rodadaNaoExaminou \? \[\] : lote\)/);
    expect(ROTA).toMatch(/lote_pesado_falhou: true/);
  });

  it("item que o `.in()` não devolveu é DESCARTADO, nunca processado com o campo vazio", () => {
    expect(ROTA).toMatch(/if \(!pesado\) \{ semPayload\+\+; continue; \}/);
    expect(ROTA).toMatch(/sem_payload_descartados: semPayload/);
    // `Object.assign(d, ... ?? {})` era o caminho do defeito: mesclava NADA e seguia.
    expect(ROTA).not.toMatch(/Object\.assign\(d, pesadoPorId\.get\(d\.id\) \?\? \{\}\)/);
  });

  it("erro ao ler `votos` para o laço — ignorar re-materializaria quem já tem voto", () => {
    expect(ROTA).toMatch(/if \(votosRes\.error\) \{/);
    expect(ROTA).toMatch(/Falha ao listar votos existentes/);
  });

  it("`restantes` mede voto GRAVADO, não voto tentado — upsert que falha não repete a rodada", () => {
    expect(ROTA).toMatch(/\(!dryRun && votosCriados > 0\)/);
    expect(ROTA).not.toMatch(/restantes:[^\n]*materializaveis > 0/);
  });
});

describe("etapa149 · a bandeira de leitura parcial cobre o ERRO, não só a truncagem", () => {
  it("`selectAllPaged` devolve `truncated: false` no caminho de erro — olhar só truncated engana", () => {
    const paginador = ler("src/lib/server/select-all-paged.ts");
    expect(paginador).toMatch(/if \(error\) return \{ rows, error, truncated: false \}/);
  });

  it("a cobertura ao vivo marca parcial quando a leitura ERRA", () => {
    const COB = ler("src/app/api/v1/admin/cobertura-ao-vivo/route.ts");
    expect(COB).toMatch(/delibsRes\.truncated \|\| Boolean\(delibsRes\.error\)/);
  });

  it("estoque não tem default zero — o zero de uma rodada falha APAGARIA o estoque da tela", () => {
    const RESUMO = ler("src/lib/server/resumo-do-backfill.ts");
    expect(RESUMO).toMatch(/if \(typeof b\.pendentes === "number"\) resumo\.pendentes = b\.pendentes;/);
    expect(RESUMO).not.toMatch(/pendentes: b\.pendentes \?\? 0/);
  });
});
