/**
 * Etapa 184 (Fase 31, Bloco 4) — "Completude 2026" para de afirmar o que não mediu.
 *
 * O usuário perguntou: *"Veja a Completude 2026 … acho que está errado / pode dizer algo. Tem todos
 * os documentos relevantes, tem tudo necessário?"* A resposta é **não**, e os motivos são
 * estruturais — não de dado. Seis, todos medidos no código:
 *
 * 1. ⚠️ `leitura_completa` só olhava `truncated`, e `selectAllPaged` devolve `truncated: false` no
 *    caminho de ERRO. Falha total produzia `leitura_completa: true` — o painel afirmando que viu
 *    tudo justamente quando não viu nada. E das oito leituras, CINCO nunca tinham `.error` olhado.
 * 2. ⚠️ O recorte por agência era um SUMIDOURO MUDO: `if (!e) continue;` engolia três populações
 *    (sem agência, agência inativa, sigla não-colegiada) sem contador e sem alerta. O cabeçalho é
 *    `reduce` das três linhas, então o que não tem agência não existia no painel.
 * 3. ⚠️ Deliberação SEM `data_reuniao` sumia do painel INTEIRO, e os votos dela também.
 * 4. ⚠️ "Pendentes: 0" verde era candidato a DIRETOR, na mesma linha de números de documento — e
 *    contava só `pendente`, enquanto o materializador bloqueia voto com `pendente` OU `conflito`.
 *    Cadastro em disputa, impedindo voto AGORA, aparecia como `0` verde.
 * 5. ⚠️ "Última captura" era `MAX(data_reuniao)`. Eu li essa coluna e disse ao usuário "ANM 32 dias
 *    sem captura" — estava errado. `last_seen_at` existe e nunca era lido.
 * 6. ⚠️ O aviso que INVALIDA os números entrava no FIM da lista, depois deles.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const ROTA = semComentarios(ler("src/app/api/v1/admin/completude-2026/route.ts"));
const ROTA_BRUTA = ler("src/app/api/v1/admin/completude-2026/route.ts");
const TELA = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");
const TELA_CODIGO = semComentarios(TELA);

describe("etapa184 · ⚠️ leitura que falha deixa de virar «completa»", () => {
  it("as OITO leituras entram na conferência, com nome", () => {
    const lista = ROTA.slice(ROTA.indexOf("const LEITURAS:"), ROTA.indexOf("const leiturasComErro"));
    for (const nome of ["agencias", "deliberacoes", "monitoramento_itens", "documentos_regulatorios",
                        "votos", "diretores", "mandatos", "diretor_candidatos"]) {
      expect(lista, `a leitura «${nome}» ficou fora`).toContain(`"${nome}"`);
    }
  });

  it("⚠️ e `error` conta junto com `truncated` — era só truncagem, e o erro não trunca", () => {
    expect(ROTA).toMatch(/const leiturasComErro = LEITURAS\.filter\(\(\[, r\]\) => Boolean\(r\.error\)\)/);
    expect(ROTA).toMatch(/const leiturasTruncadas = LEITURAS\.filter\(\(\[, r\]\) => Boolean\(r\.truncated\)\)/);
    expect(ROTA).toMatch(/const leituraCompleta = leiturasComErro\.length === 0 && leiturasTruncadas\.length === 0/);
    expect(ROTA, "voltou a medir completude só por truncagem")
      .not.toMatch(/const leituraCompleta = !delibsAllRes\.truncated && !votosTruncados/);
  });

  it("⚠️ `selectAllPaged` DE FATO devolve `truncated: false` no erro — a premissa é verificada", () => {
    // Se isso mudar, a justificativa deste conserto muda, e o teste tem de ser revisto em vez de
    // ficar protegendo um raciocínio obsoleto.
    const SAP = semComentarios(ler("src/lib/server/select-all-paged.ts"));
    expect(SAP, "o caminho de erro de selectAllPaged mudou — reveja a justificativa deste conserto")
      .toMatch(/if \(error\) return \{ rows, error, truncated: false \};/);
  });

  it("a rota publica QUAIS leituras falharam — `leitura_completa` sozinha não diz onde", () => {
    expect(ROTA).toMatch(/leituras_com_erro: leiturasComErro,/);
    expect(ROTA).toMatch(/leituras_truncadas: leiturasTruncadas,/);
  });
});

describe("etapa184 · ⚠️ o sumidouro mudo do recorte por agência ganha número", () => {
  it("os cinco laços contam o que descartam, em vez de `continue` seco", () => {
    // SEIS chamadas: deliberações, itens, documentos, votos, diretores e candidatos. A definição
    // usa `contarDescarte = (`, então não entra nesta contagem — conferi antes de fixar o número.
    const contagens = (ROTA.match(/contarDescarte\(/g) ?? []).length;
    expect(contagens, "um laço voltou ao `if (!e) continue;` sem contador").toBe(6);
    expect(ROTA).toMatch(/const contarDescarte = \(id: string \| null, onde: keyof typeof descartadosSemAgencia\)/);
    // E cada balde é usado por pelo menos um laço — um balde morto seria contador que nunca sobe.
    for (const balde of ["deliberacoes", "itens", "documentos", "votos", "diretores"]) {
      expect(ROTA, `nenhum laço alimenta o balde «${balde}»`).toContain(`, "${balde}");`);
    }
    /**
     * ⚠️ A asserção é sobre o laço que MONTA `delibs2026` — o primeiro. Há um `if (!e) continue;`
     * sem contador mais abaixo, e ele está CORRETO: aquele laço reitera `delibs2026`, cujo descarte
     * por agência já foi contado aqui. Contar de novo dobraria o número, e contador que dobra é pior
     * que contador nenhum porque parece medição. O código declara isso no lugar.
     */
    const laco1 = ROTA.slice(ROTA.indexOf("for (const d of (delibsAllRes.data"), ROTA.indexOf("for (const chave of reunioesComDelib)"));
    expect(laco1, "voltou o descarte silencioso no laço que monta delibs2026")
      .toMatch(/if \(!e\) \{ contarDescarte\(d\.agencia_id, "deliberacoes"\); continue; \}/);
    expect(ROTA_BRUTA, "o `continue` sem contador do 2º laço perdeu a justificativa")
      .toMatch(/Contar de novo dobraria o número/);
  });

  it("⚠️ e separa «sem agência» de «fora do recorte» — são causas diferentes", () => {
    /**
     * `agencia_id IS NULL` é lacuna de dado (há 19 em produção, e `deliberacoes.agencia_id` é NOT
     * NULL, então eles nunca viram deliberação). "Fora do recorte" é agência inativa ou sigla
     * não-colegiada — decisão da tela. Fundir os dois esconderia a lacuna dentro do desenho.
     */
    expect(ROTA).toMatch(/if \(id\) descartadosForaDoRecorte\[onde\] \+= 1;\s*else descartadosSemAgencia\[onde\] \+= 1;/);
    expect(ROTA).toMatch(/sem_agencia: descartadosSemAgencia,/);
    expect(ROTA).toMatch(/fora_do_recorte_de_agencia: descartadosForaDoRecorte,/);
  });

  it("e o alerta do sem-agência diz por que ele não aparece em total nenhum", () => {
    expect(ROTA_BRUTA).toMatch(/o cabeçalho é a soma das linhas/);
  });
});

describe("etapa184 · ⚠️ deliberação sem data de reunião deixa de sumir sem rastro", () => {
  it("as duas razões do descarte são contadas SEPARADAS", () => {
    // "de outro ano" é recorte; "sem data" é lacuna. Somar as duas apagaria a segunda.
    expect(ROTA).toMatch(/if \(!temData\) semDataDeReuniao \+= 1;\s*else foraDoAno \+= 1;/);
    expect(ROTA).toMatch(/deliberacoes_sem_data_de_reuniao: semDataDeReuniao,/);
    expect(ROTA).toMatch(/deliberacoes_de_outro_ano: foraDoAno,/);
  });

  it("e a TELA mostra o número junto da tabela", () => {
    expect(TELA_CODIGO).toMatch(/\(completude\.totais\.deliberacoes_sem_data_de_reuniao \?\? 0\) > 0/);
    expect(TELA).toMatch(/ficam FORA deste painel/);
  });

  it("é a MESMA população que o materializador nomeia — o painel só não sabia dizer", () => {
    const MAT = semComentarios(ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts"));
    expect(MAT).toMatch(/fora_da_janela_sem_data_de_reuniao/);
  });
});

describe("etapa184 · ⚠️ «Pendentes» diz o que é, e conta o que bloqueia voto", () => {
  it("conta `pendente` E `conflito` — o motor bloqueia voto com os dois", () => {
    expect(ROTA).toMatch(/\.in\("review_status", \["pendente", "conflito"\]\)/);
    expect(ROTA, "voltou a contar só pendente — cadastro em disputa vira 0 verde")
      .not.toMatch(/from\("diretor_candidatos"\)[\s\S]{0,120}?\.eq\("review_status", "pendente"\)/);
  });

  it("o mesmo predicado do materializador, que é quem recusa materializar", () => {
    const MAT = semComentarios(ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts"));
    expect(MAT).toMatch(/\["pendente", "conflito"\]|"pendente".*"conflito"/s);
  });

  it("e o conflito tem contador PRÓPRIO — as duas situações pedem ações diferentes", () => {
    expect(ROTA).toMatch(/candidatos_em_conflito \+= 1;/);
    expect(ROTA).toMatch(/candidatos_em_conflito: soma\(\(a\) => a\.diretores\.candidatos_em_conflito\),/);
  });

  it("⚠️ a coluna deixa de se chamar «Pendentes» — grandeza diferente, mesmo rótulo", () => {
    expect(TELA).toMatch(/Cand\. diretor/);
    expect(TELA, "voltou o rótulo «Pendentes» ao lado de números de documento")
      .not.toMatch(/font-medium text-right">Pendentes<\/th>/);
    expect(TELA).toMatch(/Candidatos a DIRETOR aguardando aprovação/);
  });
});

describe("etapa184 · ⚠️ «última captura» era data de REUNIÃO — e eu errei lendo isso", () => {
  it("os campos passam a se chamar pelo que medem", () => {
    expect(ROTA).toMatch(/reuniao_mais_recente_no_monitoramento: string \| null;/);
    expect(ROTA).toMatch(/reuniao_mais_recente_com_deliberacao: string \| null;/);
    expect(ROTA, "voltou o nome que sugere captura sobre um MAX(data_reuniao)")
      .not.toMatch(/documento_em: string \| null; deliberacao_em: string \| null/);
  });

  it("⚠️ e `last_seen_at` passa a ser LIDO — ele existia e ninguém lia", () => {
    expect(ROTA).toMatch(/\.select\("id, agencia_id, status, data_reuniao, last_seen_at"\)/);
    expect(ROTA).toMatch(/e\.ultima_captura\.capturado_em = visto;/);
    expect(ROTA).toMatch(/capturado_em: string \| null;/);
  });

  it("a coluna da tela diz o que mostra, e o staleness sai da CAPTURA", () => {
    expect(TELA).toMatch(/Reunião \+ recente/);
    expect(TELA_CODIGO).toMatch(/const baseStaleness = capturado \?\? reuniaoRecente;/);
  });

  it("⚠️ e marca com `*` quando o «Nd» saiu da data de reunião, que é um PISO", () => {
    // Sem a marca, dois números com significados diferentes apareceriam idênticos na mesma coluna.
    expect(TELA_CODIGO).toMatch(/\$\{capturado \? "" : "\*"\}/);
  });

  it("a migration confirma que as colunas existem — a premissa é verificada", () => {
    const MIG = ler("supabase/migrations/005_monitoramento_multiagency.sql");
    expect(MIG).toMatch(/last_seen_at/);
  });
});

describe("etapa184 · ⚠️ o aviso que INVALIDA vem ANTES dos números", () => {
  it("a rota usa `unshift` para os quatro avisos invalidantes", () => {
    const unshifts = (ROTA.match(/alertas\.unshift\(/g) ?? []).length;
    expect(unshifts, "um aviso invalidante voltou para o fim da lista").toBe(4);
  });

  it("e é `push` para o que NÃO invalida — a distinção é o ponto", () => {
    // Se tudo fosse `unshift`, a ordem voltaria a não significar nada.
    expect((ROTA.match(/alertas\.push\(/g) ?? []).length).toBeGreaterThan(3);
  });

  it("a TELA mostra a faixa de invalidação ACIMA da tabela", () => {
    const faixa = TELA_CODIGO.indexOf("leitura(s) FALHARAM");
    const tabela = TELA_CODIGO.indexOf('<th className="py-1 pr-3 font-medium">Agência</th>');
    expect(faixa).toBeGreaterThan(-1);
    expect(faixa, "a faixa desceu para depois da tabela").toBeLessThan(tabela);
  });

  it("⚠️ e distingue FALHA de truncagem — uma diz «incompletos», a outra «podem subcontar»", () => {
    expect(TELA).toMatch(/os números abaixo estão\s*\n?\s*incompletos/);
    expect(TELA).toMatch(/os totais podem subcontar/);
  });

  it("o precedente é nomeado: `cobertura-documentos` já usava `unshift`", () => {
    const COB = ler("src/app/api/v1/admin/cobertura-documentos/route.ts");
    expect(COB).toMatch(/alertas\.unshift\(/);
  });
});

describe("etapa184 · o recorte declarado, que explica o 40 ≠ 45", () => {
  it("a rota declara os três eixos e por que diverge do backfill", () => {
    expect(ROTA).toMatch(/resultado_exigido_de:/);
    expect(ROTA).toMatch(/agencias: "só colegiadas e ativas",/);
    expect(ROTA).toMatch(/por_que_difere_do_backfill:/);
  });

  it("e a tela diz, em texto, que os dois números divergem sem nenhum estar errado", () => {
    expect(TELA).toMatch(/os números divergem sem que nenhum esteja errado/);
  });
});
