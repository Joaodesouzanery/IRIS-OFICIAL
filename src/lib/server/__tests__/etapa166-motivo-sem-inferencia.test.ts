/**
 * Etapa 166 (Fase 31) — o classificador do "por que não inferiu", provado equivalente ao predicado.
 *
 * ═══ Por que este teste é o coração do módulo, e não um acessório ═══
 * `motivoSemInferencia` existe para MEDIR o que `shouldInferVotesFromMandate` decide. Um
 * classificador que reimplementa a regra vira uma SEGUNDA VERDADE, e este repo já pagou esse preço
 * duas vezes: a chave semântica ganhou duas implementações divergentes (a da ANTT tinha
 * precedência e ninguém sabia), e `RE_CONTESTADO` ganhou outras duas, com 10 falsos positivos
 * medidos. Um instrumento que diverge da coisa medida é pior que instrumento nenhum: ele produz
 * um número com cara de fato.
 *
 * A trava é a equivalência sobre o PRODUTO CARTESIANO das entradas, não sobre exemplos escolhidos.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { shouldInferVotesFromMandate, type DiretorVoteRecord } from "@/lib/server/vote-inference";
import {
  motivoSemInferencia, nomesQueBloqueiam, type EntradaDaInferencia,
} from "@/lib/server/motivo-sem-inferencia";

const ROSTER: DiretorVoteRecord[] = [
  { id: "d1", nome: "Mauro Henrique Moreira Sousa", nome_variantes: ["Mauro Sousa"] },
  { id: "d2", nome: "José Fernando de Mendonça Gomes Júnior", nome_variantes: ["José Fernando"] },
];

/** O espaço de entradas. Cada eixo existe porque muda de ramo no predicado. */
const EIXOS = {
  resultado: [null, "Retirado de Pauta", "Deferido", "Indeferido", "Aprovado por Unanimidade"],
  tipo_documento: ["ata", "pauta"],
  import_counts_as_final: [true, false],
  unanimidadeDetectada: [true, false],
  nomes: [[], ["José Fernando"], ["Fulano de Tal Advogado"]],
  nomesContra: [[], ["Mauro Sousa"]],
  nomesAbstencao: [[], ["Mauro Sousa"]],
  dataReuniao: [null, "2026-03-25"],
  diretoresList: [undefined, ROSTER],
  sinaisContestacao: [true, false, undefined],
} as const;

function* todasAsEntradas(): Generator<EntradaDaInferencia> {
  for (const resultado of EIXOS.resultado)
  for (const tipo_documento of EIXOS.tipo_documento)
  for (const import_counts_as_final of EIXOS.import_counts_as_final)
  for (const unanimidadeDetectada of EIXOS.unanimidadeDetectada)
  for (const nomes of EIXOS.nomes)
  for (const nomesContra of EIXOS.nomesContra)
  for (const nomesAbstencao of EIXOS.nomesAbstencao)
  for (const dataReuniao of EIXOS.dataReuniao)
  for (const diretoresList of EIXOS.diretoresList)
  for (const sinaisContestacao of EIXOS.sinaisContestacao)
    yield {
      resultado, tipo_documento, import_counts_as_final, unanimidadeDetectada,
      nomes: [...nomes], nomesContra: [...nomesContra], nomesAbstencao: [...nomesAbstencao],
      dataReuniao, diretoresList: diretoresList as DiretorVoteRecord[] | undefined, sinaisContestacao,
    };
}

describe("etapa166 · ⚠️ o classificador NÃO é uma segunda verdade", () => {
  it("«inferiria» vale exatamente quando o predicado devolve true — sobre TODO o espaço", () => {
    let total = 0;
    const divergiram: string[] = [];
    for (const e of todasAsEntradas()) {
      total++;
      const decide = shouldInferVotesFromMandate(e as never);
      const motivo = motivoSemInferencia(e);
      if (decide !== (motivo === "inferiria")) {
        divergiram.push(`${JSON.stringify(e)} → predicado=${decide} motivo=${motivo}`);
      }
    }
    expect(total, "o espaço encolheu — algum eixo deixou de variar").toBeGreaterThan(2_000);
    expect(divergiram.slice(0, 5).join("\n"), `${divergiram.length} de ${total} divergiram`).toBe("");
  });

  it("o espaço exercita TODOS os motivos — equivalência por vacuidade não vale", () => {
    const vistos = new Set<string>();
    for (const e of todasAsEntradas()) vistos.add(motivoSemInferencia(e));
    // Se um motivo nunca aparece, a equivalência acima não diz nada sobre ele.
    expect([...vistos].sort()).toEqual([
      "bloqueado_por_nome_de_diretor",
      "inferiria",
      "nao_e_documento_final",
      "sem_data_de_reuniao",
      "sem_resultado_ou_retirado",
      "sem_unanimidade_e_com_contestacao",
    ]);
  });
});

describe("etapa166 · ⚠️ o balde «bloqueado» é EXATAMENTE o que o conserto destravaria", () => {
  /**
   * A hipótese em avaliação: remover `!hasNominalNames` de
   * `shouldInferVotesFromMandate:111`. Escrita aqui, no teste, porque é um E-SE — não entra em
   * `src/` enquanto o usuário não decidir com o número na mão.
   */
  const comConserto = (e: EntradaDaInferencia): boolean => {
    if (!e.resultado || e.resultado === "Retirado de Pauta") return false;
    if (!e.dataReuniao) return false;
    if (e.tipo_documento === "pauta" && !e.import_counts_as_final) return false;
    const isUnanimous = Boolean(e.unanimidadeDetectada) || e.resultado === "Aprovado por Unanimidade";
    const hasDivergence = Boolean(e.nomesContra?.length) || Boolean(e.nomesAbstencao?.length);
    return hasDivergence || isUnanimous || e.sinaisContestacao === false;
  };

  it("motivo «bloqueado» ⟺ hoje não infere E com o conserto inferiria", () => {
    let bloqueados = 0;
    const falhas: string[] = [];
    for (const e of todasAsEntradas()) {
      const hoje = shouldInferVotesFromMandate(e as never);
      // A hipótese só é comparável onde ela e o predicado concordam nas guardas de entrada.
      if (hoje) continue;
      const motivo = motivoSemInferencia(e);
      if (motivo === "nao_e_documento_final") continue; // guarda própria, fora do escopo do e-se
      const destravaria = comConserto(e);
      if (motivo === "bloqueado_por_nome_de_diretor") bloqueados++;
      if ((motivo === "bloqueado_por_nome_de_diretor") !== destravaria) {
        falhas.push(`${JSON.stringify(e)} → motivo=${motivo} destravaria=${destravaria}`);
      }
    }
    expect(bloqueados, "nenhum caso bloqueado no espaço — o teste não mede nada").toBeGreaterThan(0);
    expect(falhas.slice(0, 5).join("\n"), `${falhas.length} caso(s) fora da equivalência`).toBe("");
  });

  it("⚠️ item CONTESTADO e com nome não entra no balde — o conserto não o alcança", () => {
    // Inverter a ordem das duas últimas guardas inflaria o "ganho" do conserto com itens que ele
    // não destrava. O número que o usuário vai ler depende desta ordem.
    const contestadoComNome: EntradaDaInferencia = {
      resultado: "Deferido", tipo_documento: "ata", import_counts_as_final: true,
      unanimidadeDetectada: false, nomes: ["José Fernando"], nomesContra: [], nomesAbstencao: [],
      dataReuniao: "2026-03-25", diretoresList: ROSTER, sinaisContestacao: true,
    };
    expect(motivoSemInferencia(contestadoComNome)).toBe("sem_unanimidade_e_com_contestacao");
    expect(comConserto(contestadoComNome)).toBe(false);
  });

  it("…e o item UNÂNIME com nome entra — é o caso vivo da 81ª ROP, item 2.2.1", () => {
    const unanimeComNome: EntradaDaInferencia = {
      resultado: "Deferido", tipo_documento: "ata", import_counts_as_final: true,
      unanimidadeDetectada: true, nomes: ["José Fernando"], nomesContra: [], nomesAbstencao: [],
      dataReuniao: "2026-01-28", diretoresList: ROSTER, sinaisContestacao: true,
    };
    expect(motivoSemInferencia(unanimeComNome)).toBe("bloqueado_por_nome_de_diretor");
    expect(shouldInferVotesFromMandate(unanimeComNome as never)).toBe(false);
    expect(comConserto(unanimeComNome)).toBe(true);
  });
});

describe("etapa166 · quem bloqueia: votante ou terceiro?", () => {
  it("⚠️ nome que NÃO casa com o cadastro não bloqueia — a regra já distingue papel", () => {
    // É o que ela foi criada para fazer: os signatários do rodapé da ARTESP desligavam a
    // inferência e deixavam 35 finais sem voto. Advogado e interessado não casam com diretor.
    const r = nomesQueBloqueiam(["Dr. Fulano de Tal, advogado", "José Fernando"], ROSTER);
    expect(r.find((x) => x.nome_no_documento.includes("advogado"))?.diretor_casado).toBeNull();
    expect(r.find((x) => x.nome_no_documento === "José Fernando")?.diretor_casado)
      .toBe("José Fernando de Mendonça Gomes Júnior");
  });

  it("casa por VARIANTE, como o cadastro real guarda", () => {
    expect(nomesQueBloqueiam(["Mauro Sousa"], ROSTER)[0].diretor_casado)
      .toBe("Mauro Henrique Moreira Sousa");
  });

  it("devolve uma entrada por nome, na ordem do documento — nada é omitido em silêncio", () => {
    const nomes = ["Zé Ninguém", "Mauro Sousa", "Outro Qualquer"];
    const r = nomesQueBloqueiam(nomes, ROSTER);
    expect(r.map((x) => x.nome_no_documento)).toEqual(nomes);
  });

  it("cadastro vazio não bloqueia ninguém — e não quebra", () => {
    expect(nomesQueBloqueiam(["Mauro Sousa"], [])).toEqual([
      { nome_no_documento: "Mauro Sousa", diretor_casado: null },
    ]);
  });
});

describe("etapa166 · a rota do diagnóstico é DRY-RUN por construção", () => {
  const ROTA = readFileSync(
    join(__dirname, "../../../app/api/v1/admin/votos/diagnostico-inferencia/route.ts"), "utf-8");
  const CODIGO = ROTA.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

  it("⚠️ não existe caminho de ESCRITA — dry-run não é um parâmetro, é a ausência do código", () => {
    // Um `dry_run` que precisa ser passado é um botão que alguém esquece de apertar. Aqui a
    // garantia é estrutural: o verbo de escrita não está no arquivo.
    for (const verbo of [".update(", ".insert(", ".upsert(", ".delete(", ".rpc("]) {
      expect(CODIGO, `a rota de diagnóstico contém ${verbo}`).not.toContain(verbo);
    }
    expect(CODIGO).toMatch(/export async function GET/);
    expect(CODIGO).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
  });

  it("respeita os dois portões do projeto: demo e admin", () => {
    expect(CODIGO).toMatch(/isDemo\(\) \|\| isDemoRequest\(req\)/);
    expect(CODIGO).toMatch(/const guard = await requireAdmin\(req\);/);
    // O guard vem ANTES de qualquer leitura de banco.
    expect(CODIGO.indexOf("requireAdmin")).toBeLessThan(CODIGO.indexOf("createSupabaseServerClient"));
  });

  it("⚠️ deliberação SEM payload não é classificada — é a lição da Fase 28", () => {
    // `raw_extraction` ausente lido como "ninguém nomeado, nada contestado" quase fez a Fase 28
    // inferir voto para o colegiado inteiro. Aqui ela sai da conta, com contador próprio.
    expect(CODIGO).toMatch(/if \(!pesado\) \{ semPayload\+\+; continue; \}/);
    expect(CODIGO).toMatch(/sem_payload: semPayload/);
  });

  it("⚠️ mede colegiado INCOMPLETO, não só «sem voto»", () => {
    // Os itens 2.3.1/2.4.1/2.7.2 da 83ª TÊM voto (a linha de impedimento) e mesmo assim faltam
    // três diretores. Medir só "sem voto" perderia exatamente o caso que motivou o diagnóstico.
    expect(CODIGO).toMatch(/colegiadoNaData\(/);
    expect(CODIGO).toMatch(/< esperado\.length/);
  });

  it("toda leitura pagina e tem o erro CHECADO", () => {
    // `lerTudo` devolve {error} em vez de lançar, e no caminho de erro `truncated` fica false.
    //
    // ⚠️ Fase 31, Bloco 3 — a contagem passou a somar `lerEmLotes`, e isso NÃO afrouxa a guarda.
    // O payload pesado desta rota usava `.in("id", ids)` com a lista inteira: `lerTudo` pagina as
    // LINHAS, mas a URL carrega todos os ids de uma vez, e `incompletas` é do tamanho do acervo.
    // Foi um `.in()` com 820 ids (32 KB contra teto de 8 KB no postgrest-js) que zerou
    // `VotosNaDeliberacao` em 100% do CSV. `lerEmLotes` corta em lotes de 100 e PARA no primeiro
    // lote que falha — pagina e checa erro, que são as duas propriedades que este caso afere. Ele
    // não precisa de `.order`: o resultado é indexado por id num Map, não consumido em ordem.
    expect(CODIGO, "voltou o .in() com a lista inteira de ids").not.toMatch(/\.in\("id", ids\)/);
    const leiturasPaginadas =
      (CODIGO.match(/lerTudo</g) ?? []).length + (CODIGO.match(/lerEmLotes</g) ?? []).length;
    expect(leiturasPaginadas, "alguma leitura deixou de paginar").toBeGreaterThanOrEqual(5);
    expect(CODIGO).toMatch(/levesRes\.error/);
    expect(CODIGO).toMatch(/votosRes\.error \|\| mandatosRes\.error/);
    expect(CODIGO).toMatch(/pesadosRes\.error/);
    // E a truncagem é publicada, não engolida.
    expect(CODIGO).toMatch(/leitura_truncada:/);
  });

  it("usa o classificador, não uma terceira cópia da regra", () => {
    expect(CODIGO).toMatch(/motivoSemInferencia\(/);
    expect(CODIGO).toMatch(/nomesQueBloqueiam\(/);
    expect(CODIGO).toMatch(/RE_CONTESTADO_AMPLO/);
    // Nada de reimplementar o predicado dentro da rota. A checagem é sobre o CÁLCULO — a palavra
    // `hasNominalNames` aparece na `notice`, que é a prosa que explica o número a quem o lê, e
    // proibir a palavra proibiria a explicação.
    expect(CODIGO).not.toMatch(/matchIds\(/);
    expect(CODIGO).not.toMatch(/isFinalVoteDocument\(/);
    expect(CODIGO).not.toMatch(/const hasNominalNames/);
  });
});
