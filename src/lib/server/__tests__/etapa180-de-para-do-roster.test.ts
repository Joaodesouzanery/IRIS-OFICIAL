/**
 * Etapa 180 (Fase 31, Bloco 4) — o de→para do roster: calculado pela ESTEIRA, lido pelo SQL.
 *
 * ═══ O desenho, e por que ele é do usuário ═══
 * Eu ia entregar DUAS listas no SQL (o roster gravado e os presentes da ata) para o operador
 * comparar na mão, justificando que comparar nome com nome em SQL exigiria reimplementar
 * `findBestMatch` — e isso criaria a segunda verdade que esta base já pagou duas vezes.
 *
 * O usuário apontou a saída certa: **a esteira compara, com o matcher real, grava o resultado, e o
 * SQL só lê.** Continua havendo uma verdade só, e ninguém compara nada a olho.
 *
 * ═══ O que se mede aqui ═══
 * 1. A comparação usa `resolverPresentesRoster` — a MESMA função que constrói o roster que vira
 *    voto. Um laço próprio faria o diagnóstico discordar do motor.
 * 2. ⚠️ Os DOIS SENTIDOS estão na direção certa. Esta é a expectativa que importa: um teste que só
 *    procurasse os nomes `recebeu_sem_estar`/`presente_sem_voto` no arquivo SOBREVIVERIA à troca
 *    dos dois — e o relatório inverteria a acusação (diria que a ata nomeia quem recebeu voto, e
 *    vice-versa). Aqui as expectativas fixam as EXPRESSÕES de filtro.
 * 3. A gravação é UM write por deliberação. Dois laços separados fariam duas escritas na mesma
 *    linha em parte dos casos, e a segunda mesclaria a partir de uma base já desatualizada.
 * 4. A regra segue DESLIGADA: isto grava DIAGNÓSTICO, não voto.
 * 5. O banner diz que a quebra por agência é da ÚLTIMA RODADA — porque o total é somado e ela não.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { CHAVES_PARCIAIS } from "../agregar-rodadas";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const MAT = semComentarios(ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts"));
const MAT_BRUTO = ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts");
const RESUMO = semComentarios(ler("src/lib/server/resumo-do-backfill.ts"));
const PAGE = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");
const QA31 = ler("docs/qa-fase31.sql");
const PENDENCIAS = ler("docs/PENDENCIAS.md");

/** Extensão de um bloco do QA: do seu rótulo até o rótulo do bloco seguinte (ou o fim). */
function blocoQa(rotulo: string): string {
  const i = QA31.indexOf(rotulo);
  expect(i, `bloco ${rotulo} não existe`).toBeGreaterThan(-1);
  const resto = QA31.slice(i + rotulo.length);
  const j = resto.search(/\n  '[0-9]_/);
  return j === -1 ? resto : resto.slice(0, j);
}

describe("etapa180 · a esteira compara com o matcher REAL, não com um laço próprio", () => {
  it("o de→para sai de `resolverPresentesRoster`, a mesma função do roster que vira voto", () => {
    expect(MAT).toMatch(/const comPai = resolverPresentesRoster\(presentesDoPai, diretoresList\)/);
  });

  it("⚠️ e o motor de voto continua usando a MESMA função — se divergirem, o diagnóstico mente", () => {
    /**
     * ⚠️ CORREÇÃO (Fase 36, Bloco A): a expectativa era `toBe(2)`. O portão do colegiado parcial
     * acrescentou um TERCEIRO uso — da mesma função, que é justamente o que se quer — e a contagem
     * exata reprovou. Contar é frágil nos dois sentidos: um 4º uso legítimo reprova, e trocar UM
     * dos dois por um laço próprio manteria a contagem se outro fosse acrescentado.
     *
     * Agora cada DECISÃO que vira roster é nomeada. É o que importa: são três lugares onde nome de
     * pessoa se transforma em id, e os três têm de passar pela mesma função, senão o diagnóstico
     * discorda do motor.
     */
    expect(MAT, "o roster que vira voto deixou de usar a função única")
      .toMatch(/const presentesRoster = resolverPresentesRoster\(presentes, diretoresList\)/);
    expect(MAT, "a medição do de→para deixou de usar a função única")
      .toMatch(/const comPai = resolverPresentesRoster\(presentesDoPai, diretoresList\)/);
    expect(MAT, "o portão do colegiado parcial deixou de usar a função única")
      .toMatch(/resolverPresentesRoster\(nomesParaPortao, diretoresList\)/);
    const usos = (MAT.match(/resolverPresentesRoster\(/g) ?? []).length;
    expect(usos, "algum lugar passou a casar nome com laço próprio").toBeGreaterThanOrEqual(3);
  });

  it("os nomes do preâmbulo sem cadastro saem de `findBestMatch`, com `needsReview` respeitado", () => {
    // `needsReview` é a faixa 0,6–0,85: casou mal demais para valer. Tratá-lo como reconhecido
    // esconderia justamente o nome que o operador precisa corrigir.
    expect(MAT).toMatch(/const m = findBestMatch\(nome, diretoresList\);\s*return !m\.diretorId \|\| m\.needsReview;/);
  });
});

describe("etapa180 · ⚠️ os DOIS SENTIDOS, na direção certa", () => {
  it("`recebeu_sem_estar` é quem tem voto HOJE e a ata NÃO nomeia", () => {
    // Mutação a matar: trocar `idsHoje`/`idsComPai` de lado. O relatório passaria a acusar o
    // contrário do que acontece — e o nome da chave sobreviveria intacto no arquivo.
    expect(MAT).toMatch(
      /recebeu_sem_estar: \[\.\.\.idsHoje\]\.filter\(\(id\) => !idsComPai\.has\(id\)\)/,
    );
  });

  it("`presente_sem_voto` é o inverso — a ata nomeia e não há voto (a metade invisível)", () => {
    expect(MAT).toMatch(
      /presente_sem_voto: \[\.\.\.idsComPai\]\.filter\(\(id\) => !idsHoje\.has\(id\)\)/,
    );
  });

  it("⚠️ e os dois lados são de conjuntos DIFERENTES — não pode haver `idsHoje` nos dois", () => {
    /**
     * Esta é a expectativa estrutural: se uma mutação puser `idsHoje` como origem das duas linhas,
     * as duas regex acima poderiam ser reescritas para passar, mas a propriedade "um sentido de
     * cada conjunto" cai. Conto a origem de cada um.
     */
    // ⚠️ Ancorar em `recebeu_sem_estar:` sozinho pega a DECLARAÇÃO DE TIPO do Map, 200 linhas
    // acima, onde nenhum dos dois conjuntos aparece — foi o vermelho que este teste deu primeiro.
    // A âncora tem de ser o `.set(...)`, que é onde a atribuição mora.
    const i = MAT.indexOf("divergenciaPorDeliberacao.set(");
    expect(i, "o de→para deixou de ser gravado por deliberação").toBeGreaterThan(-1);
    const bloco = MAT.slice(i, i + 500);
    expect(bloco).toContain("recebeu_sem_estar:");
    expect((bloco.match(/\[\.\.\.idsHoje\]\.filter/g) ?? []).length).toBe(1);
    expect((bloco.match(/\[\.\.\.idsComPai\]\.filter/g) ?? []).length).toBe(1);
  });

  it("a divergência só é registrada quando os rosters DE FATO diferem", () => {
    // `idsComPai.size > 0` impede que uma ata cujos nomes ninguém reconhece (roster vazio) seja
    // contada como divergência — ali o defeito é de cadastro, e ele sai em
    // `presentes_nao_reconhecidos`, não como "outro colegiado".
    expect(MAT).toMatch(
      /const difere = idsComPai\.size > 0\s*&& \(idsComPai\.size !== idsHoje\.size \|\| \[\.\.\.idsComPai\]\.some\(\(id\) => !idsHoje\.has\(id\)\)\)/,
    );
    expect(MAT).toMatch(/if \(difere\) \{/);
  });
});

describe("etapa180 · a quebra por agência responde \"é só a ANM?\"", () => {
  it("o contador por sigla sobe dentro do `if (difere)`, junto com o total", () => {
    const i = MAT.indexOf("if (difere) {");
    const bloco = MAT.slice(i, i + 900);
    expect(bloco).toMatch(/rosterMudariaComPresentesDoPai\+\+;/);
    expect(bloco).toMatch(/rosterMudariaPorAgencia\[sigla\] = \(rosterMudariaPorAgencia\[sigla\] \?\? 0\) \+ 1;/);
  });

  it("e é publicado na resposta, ao lado do total", () => {
    expect(MAT).toMatch(/roster_mudaria_com_presentes_do_pai: rosterMudariaComPresentesDoPai,/);
    expect(MAT).toMatch(/roster_mudaria_por_agencia: rosterMudariaPorAgencia,/);
  });

  it("o resumo converte o objeto em STRING — `agregarEtapas` descarta o que não é número", () => {
    expect(RESUMO).toMatch(/if \(porAg\) resumo\.roster_mudaria_por_agencia = porAg;/);
    expect(RESUMO).toMatch(/\.filter\(\(\[, n\]\) => \(n \?\? 0\) > 0\)/);
    const AGREGA = semComentarios(ler("src/lib/server/agregar-rodadas.ts"));
    expect(AGREGA, "se agregarEtapas passar a aceitar objeto, a conversão para string fica obsoleta")
      .toMatch(/if \(typeof valor !== "number"\) continue;/);
  });

  it("⚠️ o banner diz que a quebra é da ÚLTIMA RODADA — o total é somado e ela não", () => {
    /**
     * `roster_mudaria_com_presentes_do_pai` é chave PARCIAL (`agregar-rodadas.ts`), logo o total é
     * a soma das rodadas. A quebra vem de `ultimas`, que é só a última. Sem o rótulo,
     * "ANM 41 · ARTESP 18" se lê como decomposição do total — e em duas rodadas que mediram as
     * parcelas não fecham com a soma. É o defeito desta fase, pela minha própria mão.
     */
    expect(PAGE).toMatch(/por agência na última rodada: \$\{rosterPorAgencia\}/);
    expect(CHAVES_PARCIAIS.has("roster_mudaria_com_presentes_do_pai")).toBe(true);
  });
});

describe("etapa180 · ⚠️ UM write por deliberação — a mescla não pode partir de base velha", () => {
  it("os dois diagnósticos entram no MESMO patch antes de gravar", () => {
    expect(MAT).toMatch(/const patchPorDeliberacao = new Map<string, Record<string, unknown>>\(\);/);
    expect(MAT).toMatch(/patchPorDeliberacao\.set\(id, \{ \.\.\.\(patchPorDeliberacao\.get\(id\) \?\? \{\}\), motivo_sem_voto: motivo \}\);/);
    expect(MAT).toMatch(/patchPorDeliberacao\.set\(id, \{ \.\.\.\(patchPorDeliberacao\.get\(id\) \?\? \{\}\), roster_divergente: div \}\);/);
  });

  it("⚠️ e há UM só `update` de `raw_extraction` no caminho de diagnóstico", () => {
    /**
     * Mutação a matar: voltar a dois laços, cada um com seu `update`. O código roda, os testes de
     * presença passam, e em toda deliberação que cai nas duas populações a segunda escrita mescla
     * sobre um `raw_extraction` lido ANTES da primeira — apagando o que ela acabou de gravar.
     */
    /**
     * ⚠️ CORREÇÃO (Fase 36, Bloco A): a âncora era a linha LITERAL
     * `if (!dryRun && patchPorDeliberacao.size > 0)`. O modo parcial acrescentou `&& !completarParcial`
     * — uma mudança que PRESERVA a propriedade — e a expectativa reprovou por causa do texto. Travar
     * a forma em vez da propriedade é o erro que este projeto já catalogou em `etapa179`. A âncora
     * passa a ser o predicado do laço, que é o que identifica o caminho.
     */
    const i = MAT.indexOf("patchPorDeliberacao.size > 0");
    expect(i).toBeGreaterThan(-1);
    const bloco = MAT.slice(i, i + 2000);
    expect((bloco.match(/\.update\(\{ raw_extraction:/g) ?? []).length).toBe(1);
    expect(bloco).toMatch(/raw_extraction: \{ \.\.\.base, \.\.\.patch \}/);
  });

  it("sem o jsonb atual em mão, NÃO grava — mesclar exige ter o que mesclar", () => {
    expect(MAT).toMatch(/const base = jaEmMaos\.get\(id\);\s*if \(!base\) continue;/);
    expect(MAT).toMatch(/if \(!rawRes\.error\) \{/);
  });

  it("e a escrita passa por `exigirEscrita`, com recheck da reserva de ESCRITA", () => {
    /**
     * ⚠️ CORREÇÃO DE UM TESTE MEU (Fase 33). Este `expect` exigia a linha literal
     * `if (!hasBudget(deadlineAt, RESERVA_POR_ITEM_MS)) { restantes = true; break; }` — isto é,
     * canonizava como virtude exatamente a linha que impedia a gravação de acontecer. Ver o docblock
     * de `etapa172` para a medição.
     */
    const i = MAT.indexOf("for (const [id, patch] of filaDaRodada)");
    expect(i, "o laço de gravação deixou de iterar a fila priorizada").toBeGreaterThan(-1);
    const bloco = MAT.slice(i, i + 900);
    expect(bloco).toMatch(/if \(!hasBudget\(deadlineAt, RESERVA_POR_ESCRITA_MS\)\) \{ restantes = true; break; \}/);
    expect(bloco).toMatch(/const ok = await exigirEscrita\(/);
    expect(bloco).toMatch(/if \("roster_divergente" in patch\) divergenciasGravadas\+\+;/);
  });

  it("⚠️ a rota DELEGA a fila priorizada, o corte pelo orçamento e o skip", () => {
    /**
     * A propriedade — *"com orçamento para N escritas e uma divergência entre 300 postergáveis, a
     * divergência é escrita"* — é MEDIDA em `etapa191`, contra o módulo. Aqui só se exige que a rota
     * não tenha uma segunda implementação da mesma decisão: duas implementações divergentes do mesmo
     * conceito já custaram três fases a este projeto.
     */
    expect(MAT).toMatch(/from "@\/lib\/server\/fila-de-diagnostico"/);
    expect(MAT).toMatch(/const plano = planejarGravacaoDeDiagnostico\(\s*\[\.\.\.patchPorDeliberacao\.entries\(\)\], msLeft\(deadlineAt\),\s*\);/);
    expect(MAT).toMatch(/if \(plano\.restantes\) restantes = true;/);
    expect(MAT).toMatch(/if \(patchJaAplicado\(base, patch\)\) \{\s*diagnosticosJaIguais\+\+;/);
    // ⚠️ E a rota NÃO pode reimplementar a ordenação por conta própria.
    expect(MAT, "a rota voltou a ordenar a fila localmente")
      .not.toMatch(/\.sort\(\(a, b\) => prioridade\(/);
  });

  it("⚠️ e isto grava DIAGNÓSTICO, não voto: a regra segue DESLIGADA", () => {
    const ATA = semComentarios(ler("src/lib/server/ata-item-materializacao.ts"));
    expect(ATA).toMatch(/export const PRESENTES_DO_PAI_VALEM = false;/);
    // O roster que vira voto só usa os presentes do pai se a flag valer.
    expect(MAT).toMatch(/: \(PRESENTES_DO_PAI_VALEM \? presentesDoPai : \[\]\)/);
  });
});

describe("etapa180 · o bloco ⑧ do QA só LÊ o jsonb", () => {
  const B8 = blocoQa("'8_roster_divergente'");

  it("lê `raw_extraction->'roster_divergente'` e filtra pela presença da chave", () => {
    expect(B8).toMatch(/d\.raw_extraction \? 'roster_divergente'/);
    for (const chave of ["recebeu_sem_estar", "presente_sem_voto", "presentes_nao_reconhecidos"]) {
      expect(B8, `o bloco ⑧ deixou de ler ${chave}`).toContain(chave);
    }
  });

  it("⚠️ e NÃO faz matching de nome nenhum — a segunda verdade não volta por aqui", () => {
    for (const proibido of [/similarity\(/i, /levenshtein/i, /soundex/i, /unaccent\(/i]) {
      expect(B8, `o bloco ⑧ passou a comparar nomes em SQL: ${proibido}`).not.toMatch(proibido);
    }
  });

  it("conta itens por `DISTINCT id` — os LATERAL fazem produto cartesiano entre os três arrays", () => {
    // Um item com 1 `recebeu` e 2 `presente` vira 2 linhas. Sem o DISTINCT o número dobraria.
    expect(B8).toMatch(/COUNT\(DISTINCT z\.id\) AS itens/);
    expect((B8.match(/LEFT JOIN LATERAL jsonb_array_elements_text\(/g) ?? []).length).toBe(3);
  });

  it("e declara o que VAZIO significa, nomeando o campo que desempata", () => {
    const i = QA31.indexOf("'8_roster_divergente'");
    const antes = QA31.slice(Math.max(0, i - 1400), i);
    expect(antes).toMatch(/VAZIO significa/);
    expect(antes).toMatch(/divergencias_gravadas/);
  });
});

describe("etapa180 · o bloco ⑨ espelha os predicados do motor de voto", () => {
  const B9 = blocoQa("'9_colegiado_por_reuniao'");

  it("⚠️ os TRÊS predicados de `getActiveDiretoresForVote`, em toda subconsulta de mandato", () => {
    /**
     * Mutação a matar: apagar um predicado de UMA das subconsultas. O SQL roda, devolve número
     * plausível, e o "esperado" passa a incluir mandato automático (fabricado pelo próprio voto
     * inferido) ou diretor não-aprovado — exatamente os que o motor NÃO conta. O bloco diria que
     * faltam votos onde não faltam.
     */
    const comFonte = (B9.match(/m\.fonte_dado <> 'automatico'/g) ?? []).length;
    const comInicio = (B9.match(/m\.data_inicio <= r\.data_reuniao/g) ?? []).length;
    const comFim = (B9.match(/\(m\.data_fim IS NULL OR m\.data_fim >= r\.data_reuniao\)/g) ?? []).length;
    expect(comFonte, "uma subconsulta de mandato perdeu o filtro de fonte_dado").toBe(3);
    expect(comInicio).toBe(3);
    expect(comFim, "a janela deixou de ser inclusiva em alguma subconsulta").toBe(3);
    expect((B9.match(/dir\.review_status = 'aprovado'/g) ?? []).length).toBe(3);
  });

  it("os predicados casam com o motor — se `vote-inference` mudar, este teste cai", () => {
    const VOTE = ler("src/lib/server/vote-inference.ts");
    expect(VOTE).toMatch(/fonte_dado.*automatico/s);
    expect(VOTE).toMatch(/review_status.*aprovado/s);
  });

  it("⚠️ compara por ID de diretor, nos dois sentidos — `faltando` e `extra`", () => {
    // `extra` é a classe que ninguém mediu: recebeu voto SEM mandato ativo na data.
    expect(B9).toMatch(/AS faltando/);
    expect(B9).toMatch(/AS extra/);
    expect(B9).toMatch(/WHERE v2\.diretor_id = dir\.id/);
    expect(B9).toMatch(/WHERE m2\.diretor_id = dir\.id AND m2\.fonte_dado <> 'automatico'/);
  });

  it("a reunião é identificada por data E número — não só por data", () => {
    // Duas reuniões podem cair na mesma data (ROP + REP). Agrupar só por data misturaria as duas.
    expect((B9.match(/COALESCE\(d[23]\.numero_reuniao,''\) = COALESCE\(r\.numero_reuniao,''\)/g) ?? []).length)
      .toBeGreaterThanOrEqual(3);
  });

  it("e o universo são as reuniões QUE TÊM voto — é onde a pergunta existe", () => {
    expect(B9).toMatch(/FROM deliberacoes d JOIN votos v ON v\.deliberacao_id = d\.id/);
    expect(B9).toMatch(/WHERE d\.data_reuniao IS NOT NULL/);
  });

  it("⚠️ mas o universo CLASSIFICA — esta expectativa existia congelando a falta disso", () => {
    /**
     * ⚠️ CORREÇÃO DE UM TESTE MEU (Fase 33). A expectativa acima trava o universo e nada mais, e por
     * isso ela legitimava o falso positivo: sem filtro nenhum de tipo, QUALQUER linha com voto e data
     * virava "uma reunião" — documento sem `numero_reuniao` e documento de VOTO INDIVIDUAL da ANTT
     * inclusive, e o segundo tem 1 voto POR DESENHO. O bloco reportava "1 de 5, faltando 4" sobre
     * coisas que não são reunião.
     *
     * ⚠️ E a classificação lê o JSONB porque o filtro que o projeto usa em três lugares —
     * `tipo_documento NOT IN ('pauta','voto_individual',…)` — NÃO FILTRA NADA: nenhum caminho de
     * produção escreve `deliberacoes.tipo_documento = 'voto_individual'`.
     */
    expect(B9).toMatch(/WHEN d\.numero_reuniao IS NULL THEN 'documento_avulso'/);
    expect(B9).toMatch(/bool_and\(COALESCE\(d\.raw_extraction->>'documento_subtipo',/);
    expect(B9).toMatch(/= 'voto_individual'\) THEN 'voto_individual'/);
    expect(B9).toMatch(/ELSE 'reuniao'/);
    expect(B9).toMatch(/GROUP BY d\.agencia_id, d\.data_reuniao, d\.numero_reuniao/);
  });

  it("⚠️ e `faltando`/`esperado` são NULOS fora de `classe = 'reuniao'`", () => {
    // A conta "N de 5" não quer dizer nada num documento avulso, e era publicada como se quisesse.
    const guardas = (B9.match(/CASE WHEN r\.classe <> 'reuniao' THEN NULL ELSE/g) ?? []).length;
    expect(guardas, "esperado_total, esperado e faltando precisam dos três guardas").toBe(3);
    expect(B9).toMatch(/r\.classe,/);
  });

  it("⚠️ e o bloco NÃO atribui a isto as nove reuniões da ANTT — a hipótese foi refutada", () => {
    /**
     * Foi a minha hipótese, e a consulta do usuário a desfez: as nove (271, 272, 273, 274, 276, 99,
     * 1.028, 1.029, 1.030) são `classe = 'reuniao'`, com ata materializada e filhos com `resultado`.
     * O defeito estava no código e está consertado (`etapa192`). Se o comentário do SQL passar a
     * dizer que o bloco ⑨ explica as nove, esta expectativa cai.
     */
    expect(B9).toMatch(/REFUTOU/);
    expect(B9).toMatch(/falso positivo DIFERENTE/);
  });
});

describe("etapa180 · ⚠️ o arquivo de pendências para de mentir sobre o que já foi feito", () => {
  it("a migration do Luiz Paniago consta como APLICADA, não como ação pendente", () => {
    /**
     * Eu usei `PENDENCIAS.md:504` como evidência de que a migration estava pendente, e concluí daí
     * que o 5º mandato faltante da 84ª ROP era o do Luiz Paniago. O usuário corrigiu: ela foi
     * aplicada, e o QA da Fase 24 mostrou os 2 mandatos. Um arquivo de pendências desatualizado
     * faz o diagnóstico seguinte partir do lugar errado.
     */
    expect(PENDENCIAS).toMatch(/`20260909130000_reinserir_luiz_paniago_anm_v2\.sql` APLICADA/);
    expect(PENDENCIAS, "voltou a pedir uma migration que já foi aplicada")
      .not.toMatch(/\*\*aplicar `20260909130000_reinserir_luiz_paniago_anm_v2\.sql`\*\*/);
  });

  it("e a pendência de DADO (a data do afastamento de Caio Mário) está registrada", () => {
    expect(PENDENCIAS).toMatch(/PENDÊNCIA DE DADO, SUA — a data do afastamento de Caio Mário/);
    expect(PENDENCIAS).toMatch(/ato publicado/);
  });

  it("o Bloco 4 declara os dois canais, e que nenhuma aba nova foi criada", () => {
    const i = PENDENCIAS.indexOf("FASE 31 — BLOCO 4");
    const bloco = PENDENCIAS.slice(i, i + 2600);
    expect(bloco).toMatch(/Rodar tudo/);
    expect(bloco).toMatch(/qa-fase31\.sql/);
    expect(bloco).toMatch(/Nenhuma rota nova para você chamar/);
  });
});

describe("etapa180 · a leitura do pai é cacheada e não engole erro em silêncio", () => {
  it("uma leitura por ATA, não por item — o cache é por `documento_pai_id`", () => {
    expect(MAT).toMatch(/const presentesDoPaiCache = new Map<string, string\[\]>\(\);/);
    expect(MAT).toMatch(/const hit = presentesDoPaiCache\.get\(paiId\);\s*if \(hit !== undefined\) return hit;/);
    expect(MAT).toMatch(/presentesDoPaiCache\.set\(paiId, presentes\);/);
  });

  it("⚠️ `hit !== undefined`, não `hit` — pai com lista VAZIA é resposta cacheável", () => {
    // Com `if (hit)` um pai sem presentes seria relido a cada filho: N round-trips na fatia, que é
    // a família de defeito que a Fase 29 mediu (o "90s sem resposta").
    expect(MAT, "voltou o teste truthy, que não cacheia resposta vazia")
      .not.toMatch(/const hit = presentesDoPaiCache\.get\(paiId\);\s*if \(hit\) return hit;/);
  });

  it("e a subida ao pai só acontece quando o próprio item não tem presentes", () => {
    expect(MAT).toMatch(
      /const presentesDoPai = presentesDoProprio\.length === 0 && !isAnttAtaItem\s*\?\s*await presentesDoPaiDe\(d\)\s*:\s*\[\];/,
    );
  });

  it("o docblock nomeia a 79ª ROP como o caso medido", () => {
    expect(MAT_BRUTO).toMatch(/79ª ROP/);
  });
});
