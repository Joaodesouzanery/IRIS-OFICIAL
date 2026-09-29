/**
 * Etapa 205 (Fase 35, Bloco B) — capacidade-sem-consumidor, agora medida sobre o CÓDIGO.
 *
 * ═══ A quarta ocorrência, e por que a terceira não bastou ═══
 * A `etapa123` (Fase 21) já cobrava leitor para as medições do materializador. Ela não pegou as
 * chaves da Fase 34 porque o universo dela é `CHAVES_NUMERICAS_DO_MATERIALIZADOR`, uma **constante
 * escrita à mão**: quem publica uma chave na rota e esquece de acrescentá-la à lista escapa do teste
 * que existe justamente para pegá-lo. A rede tinha o buraco do tamanho exato do peixe.
 *
 * Aconteceu três vezes antes (Fase 21: banner verde com escritas falhando; Fase 33:
 * `divergencias_gravadas` publicado e nunca lido) e duas de uma vez na Fase 34:
 *   · `artefatos_apagados`/`artefatos_candidatos` morriam em `resumirBackfill`;
 *   · `divergentes_medidas`/`divergentes_corrigidas` morriam no orquestrador.
 * A segunda dupla é a mais cara: `divergentes_corrigidas` conta a escrita DESTRUTIVA que o usuário
 * autorizou atrás de um gabarito — datas reescritas, que mudam o roster de voto da linha.
 *
 * ═══ A troca ═══
 * O universo passa a ser DERIVADO: toda chave que o orquestrador põe em `etapas.<passo> = anotar(…,
 * { … })`, mais toda chave que `resumirBackfill` produz. É o conjunto exato do que chega a `totais`
 * na tela. Quem não tem linha no banner precisa estar na lista de exceções, com o motivo escrito.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { agregarEtapas, naturezaDaChave } from "@/lib/server/agregar-rodadas";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const RUN = semComentarios(ler("src/app/api/v1/pipeline/run/route.ts"));
const RESUMO = semComentarios(ler("src/lib/server/resumo-do-backfill.ts"));
const TELA = semComentarios(ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx"));

/**
 * ⚠️ AS EXCEÇÕES, com motivo. Acrescentar aqui é uma decisão — e ela fica escrita ao lado.
 * Chave nova sem linha e sem exceção REPROVA, que é o ponto do arquivo inteiro.
 */
const SEM_LINHA_JUSTIFICADA: Record<string, string> = {
  fora_da_janela:
    "É a SOMA de `fora_da_janela_anterior_ao_1o_mandato` e `fora_da_janela_sem_data_de_reuniao`, e as " +
    "duas parcelas têm linha própria desde a Fase 28 — justamente porque o total juntava um fato de " +
    "mandato com uma falha de extração e fazia a segunda parecer a primeira. Exibir o total ao lado " +
    "das parcelas convidaria a somá-los.",
  itens_que_mudariam:
    "⚠️ DECISÃO ANTERIOR, e eu tentei desfazê-la sem perceber. A Fase 31 tirou este número da tela de " +
    "propósito: ele é, POR CONSTRUÇÃO, a união de `regex_divergente` e `regex_falso_positivo`, que já " +
    "têm linha. Exibir os três lado a lado era a «dupla narrativa» que a `etapa171` e a `etapa150` " +
    "vigiam — o leitor soma parcelas que se sobrepõem. Ao escrever a linha aqui, a pressão deste " +
    "próprio teste me fez recriar o defeito, e foram as duas etapas antigas que pegaram. Leitor sem " +
    "sentido é pior que medição sem leitor.",
};

/** Percorre `{` … `}` equilibrado a partir de uma posição. */
function corpoDoObjeto(fonte: string, inicioDaChave: number): string {
  const abre = fonte.indexOf("{", inicioDaChave);
  let profundidade = 0;
  for (let i = abre; i < fonte.length; i += 1) {
    if (fonte[i] === "{") profundidade += 1;
    else if (fonte[i] === "}") {
      profundidade -= 1;
      if (profundidade === 0) return fonte.slice(abre + 1, i);
    }
  }
  return "";
}

/** Toda chave que CHEGA a `totais`: as anotadas pelo orquestrador + as que o resumo produz. */
function chavesQueChegamAosTotais(): Set<string> {
  const chaves = new Set<string>();
  for (const m of RUN.matchAll(/etapas\.\w+\s*=\s*anotar\([^,]+,[^,]+,\s*\{/g)) {
    const corpo = corpoDoObjeto(RUN, (m.index ?? 0) + m[0].length - 1);
    for (const c of corpo.matchAll(/(?:^|[,{]\s*)([a-z_][a-z0-9_]*)\s*:/g)) chaves.add(c[1]);
  }
  for (const c of RESUMO.matchAll(/^\s{4}([a-z_][a-z0-9_]*):/gm)) chaves.add(c[1]);
  for (const c of RESUMO.matchAll(/resumo\.([a-z_][a-z0-9_]*)\s*=/g)) chaves.add(c[1]);
  return chaves;
}

const CHAVES = chavesQueChegamAosTotais();

describe("etapa205 · o universo é DERIVADO do código, não de uma lista à mão", () => {
  it("a varredura acha as chaves (o teste não pode passar por não achar nada)", () => {
    // Guarda contra o pior falso verde: a extração quebrar e o teste "passar" vazio.
    expect(CHAVES.size, "a extração de chaves quebrou").toBeGreaterThan(40);
  });

  it("e acha as quatro que a Fase 34 publicou sem leitor — a prova de que a rede pega o peixe", () => {
    for (const chave of [
      "artefatos_apagados",
      "artefatos_candidatos",
      "divergentes_medidas",
      "divergentes_corrigidas",
    ]) {
      expect([...CHAVES], `${chave} não chega mais aos totais — a camada intermediária voltou a comê-la`)
        .toContain(chave);
    }
  });
});

describe("etapa205 · ⚠️ toda chave que chega a `totais` tem LINHA no banner", () => {
  it("nenhuma chave sem leitor fora da lista de exceções", () => {
    const orfas = [...CHAVES]
      .filter((c) => !new RegExp(`\\b${c}\\b`).test(TELA))
      .filter((c) => !(c in SEM_LINHA_JUSTIFICADA))
      .sort();
    expect(
      orfas,
      "estas chaves são calculadas, gravadas em esteira_runs.contadores e NUNCA exibidas. " +
        "Acrescente a linha no banner, ou declare a exceção com o motivo em SEM_LINHA_JUSTIFICADA.",
    ).toEqual([]);
  });

  it("cada exceção tem motivo ESCRITO — exceção sem porquê vira exceção esquecida", () => {
    for (const [chave, motivo] of Object.entries(SEM_LINHA_JUSTIFICADA)) {
      expect(motivo.length, `a exceção «${chave}» não explica por quê`).toBeGreaterThan(80);
    }
  });

  it("e a exceção declarada AINDA é uma chave real — exceção para chave morta é lixo", () => {
    for (const chave of Object.keys(SEM_LINHA_JUSTIFICADA)) {
      expect([...CHAVES], `«${chave}» não chega mais aos totais: tire a exceção`).toContain(chave);
    }
  });
});

describe("etapa205 · a NATUREZA de cada chave nova está declarada", () => {
  const AGREGAR = semComentarios(ler("src/lib/server/agregar-rodadas.ts"));

  it("⚠️ `artefatos_candidatos` é ESTOQUE — retrato que CAI conforme o reparo funciona", () => {
    // Somá-lo diria "51 · 44 · 38 …" num acervo que tem 38 — e inverteria a leitura do progresso.
    const i = AGREGAR.indexOf("CHAVES_DE_ESTOQUE");
    const bloco = AGREGAR.slice(i, AGREGAR.indexOf("]);", i));
    expect(bloco).toMatch(/"artefatos_candidatos"/);
    expect(bloco, "`artefatos_apagados` é EVENTO (o que a rodada fez) e não pode virar estoque")
      .not.toMatch(/"artefatos_apagados"/);
  });

  it("⚠️ `divergente_bloco`/`divergente_blocos` são POSIÇÃO, não contagem", () => {
    // Somá-los produziria "bloco 47 de 300" numa volta de 25 — número sem significado, com cara de
    // informação. É o pior tipo de número numa tela de operação.
    const i = AGREGAR.indexOf("CHAVES_DE_ESTOQUE");
    const bloco = AGREGAR.slice(i, AGREGAR.indexOf("]);", i));
    expect(bloco).toMatch(/"divergente_bloco"/);
    expect(bloco).toMatch(/"divergente_blocos"/);
  });

  it("`divergentes_medidas` é PARCIAL — a janela rotativa repassa pelo mesmo bloco", () => {
    const i = AGREGAR.indexOf("CHAVES_PARCIAIS");
    const bloco = AGREGAR.slice(i, AGREGAR.indexOf("]);", i));
    expect(bloco).toMatch(/"divergentes_medidas"/);
  });
});

describe("etapa205 · as linhas novas dizem o que o número significa", () => {
  it("o placar NUNCA aparece sem denominador", () => {
    const i = TELA.indexOf("reunioes_completas");
    expect(i, "a linha do placar desapareceu").toBeGreaterThan(-1);
    const linha = TELA.slice(Math.max(0, i - 400), i + 600);
    expect(linha, "`reunioes_completas` sem `reunioes_no_ano` é um número sem escala").toMatch(
      /reunioes_no_ano/,
    );
  });

  it("⚠️ e ele se declara TETO — a régua por reunião conta ≥1 voto por diretor", () => {
    const i = TELA.indexOf("reunioes_completas");
    const linha = TELA.slice(i, i + 900);
    expect(linha, "sem o rótulo, 84% se lê como cobertura de voto e não é").toMatch(/teto/i);
  });

  it("a linha do artefato explica por que `pendentes` SOBE quando o reparo age", () => {
    const i = TELA.indexOf("artefatos_apagados");
    expect(i).toBeGreaterThan(-1);
    const linha = TELA.slice(i, i + 500);
    expect(linha).toMatch(/devolve a deliberação ao estoque/);
  });

  it("a linha das datas mostra o ponto da VOLTA, senão parece pronta quando mal começou", () => {
    const i = TELA.indexOf("divergentes_corrigidas");
    expect(i).toBeGreaterThan(-1);
    const linha = TELA.slice(Math.max(0, i - 300), i + 700);
    expect(linha).toMatch(/divergente_blocos/);
  });
});

describe("etapa205 · ⚠️ toda medida do PLACAR é RETRATO — nenhuma pode ser somada", () => {
  /**
   * A auditoria adversarial da Fase 35 achou o que eu tinha deixado passar: acrescentei oito chaves ao
   * passo `placar` e declarei a natureza de nenhuma. Medido, com três rodadas do MESMO retrato:
   *
   *   cobertura_pct               240      (é um PERCENTUAL somado)
   *   reunioes_completas_estrito  120      (de 80 reuniões no ano)
   *   pares_esperados          18 000
   *
   * ⚠️ A `etapa205` acima cobra LEITOR para cada chave, e todas tinham. Ter leitor e estar certa são
   * coisas diferentes — o número chegava à tela, e chegava errado. Este bloco cobra a outra metade.
   *
   * A regra é derivada da NATUREZA da rota: `/admin/placar` recalcula do acervo inteiro a cada
   * chamada; ela não conta o que a rodada fez, ela fotografa o estado. Logo TODA chave numérica que
   * ela publica é estoque, sem exceção — e é por isso que dá para cobrar isso automaticamente em vez
   * de manter mais uma lista à mão.
   */
  const chavesDoPassoPlacar = (): string[] => {
    const i = RUN.indexOf('etapas.placar = anotar(');
    expect(i, "o passo do placar desapareceu do orquestrador").toBeGreaterThan(-1);
    const corpo = corpoDoObjeto(RUN, i);
    return [...corpo.matchAll(/(?:^|[,{]\s*)([a-z_][a-z0-9_]*)\s*:/g)].map((m) => m[1]);
  };

  it("a extração acha as chaves do passo (não pode passar por vazio)", () => {
    expect(chavesDoPassoPlacar().length, "a extração do passo quebrou").toBeGreaterThanOrEqual(8);
  });

  it("⚠️ CADA uma delas é `estoque` — somar retrato dá número impossível na tela", () => {
    const naoEstoque = chavesDoPassoPlacar()
      .filter((c) => naturezaDaChave(c) !== "estoque")
      .sort();
    expect(
      naoEstoque,
      "o passo `placar` fotografa o acervo inteiro a cada rodada. Chave dele que não seja `estoque` é " +
        "SOMADA entre rodadas e vira número impossível (cobertura de 240%, 120 de 80 reuniões). " +
        "Acrescente em CHAVES_DE_ESTOQUE.",
    ).toEqual([]);
  });

  it("⚠️ e o efeito é medido, não deduzido: três retratos iguais dão o retrato", () => {
    const totais: Record<string, number> = {};
    const retrato = {
      reunioes_no_ano: 80, reunioes_completas: 67, reunioes_completas_estrito: 40,
      itens_no_ano: 1200, pares_esperados: 6000, pares_respondidos: 4800, cobertura_pct: 80,
      diretores_com_voto_parcial: 12, faltando_contra_a_listagem: 5, completaveis_parciais: 9,
    };
    for (let i = 0; i < 3; i += 1) agregarEtapas(totais, { placar: { ...retrato } });
    for (const [chave, valor] of Object.entries(retrato)) {
      expect(totais[chave], `«${chave}» foi somada entre rodadas`).toBe(valor);
    }
    // E o caso que mais denuncia: percentual somado não tem nem significado aritmético.
    expect(totais.cobertura_pct, "80% + 80% + 80% não é 240% de coisa nenhuma").toBe(80);
  });

  it("`divergente_sem_texto` acompanha o irmão do MESMO laço", () => {
    // Os dois são contados sobre a janela rotativa de 120 linhas, e aparecem na mesma região do
    // banner: naturezas diferentes fariam os dois crescerem em ritmos diferentes.
    expect(naturezaDaChave("divergente_sem_texto")).toBe(naturezaDaChave("divergentes_medidas"));
  });
});
