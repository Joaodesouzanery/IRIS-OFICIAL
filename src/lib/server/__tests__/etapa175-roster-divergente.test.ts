/**
 * Etapa 175 (Fase 31, Bloco 3) — o voto está no nome CERTO? A medição, antes de qualquer conserto.
 *
 * ═══ O caso que originou isto, e ele é literal no repo ═══
 * `roster-conferivel.ts:5-12`, escrito na Fase 20:
 *
 *   *"Na 79ª ROP (26/11/2025) o preâmbulo da ata nomeia Mauro + Tasso + Roger + José Fernando, e
 *   `getActiveDiretoresForVote` devolve Mauro + Caio Mário + José Fernando. Não é lacuna de
 *   cobertura — é **voto gravado no nome errado**."*
 *
 * A produção de 2026-09-24 mostrou, nessa reunião, **Caio Mário com 18 votos e Mauro com 18** —
 * dois diretores onde a ata nomeia quatro, e um deles não está na ata.
 *
 * A causa raiz é um campo que não é propagado: `buildRawExtractionDoItem`
 * (`ata-item-materializacao.ts`) monta o `raw_extraction` do FILHO de ata a partir do item, e
 * `nomes_presentes` é chave do PAI. Sem ela, `presentesRoster` sai vazio e todo caminho cai em
 * `getActiveDiretoresForVote`, que escolhe por MANDATO e nunca consulta o preâmbulo.
 *
 * ⚠️ Esta rota NÃO conserta nada. Ela responde a única pergunta que decide o conserto — **a 79ª é a
 * única?** — e mede os DOIS sentidos do erro, porque a metade invisível (diretor presente que
 * recebeu zero voto) não aparece em métrica nenhuma: um voto ausente não deixa rastro.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => globalThis.__rosterDb }));
vi.mock("@/lib/server/is-demo", () => ({ isDemo: () => false }));
vi.mock("@/lib/server/request-guards", () => ({
  isDemoRequest: () => false,
  requireAdmin: async () => null,
}));

declare global { var __rosterDb: unknown }

import { NextRequest } from "next/server";
import { GET } from "@/app/api/v1/admin/votos/roster-divergente/route";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

type Resultado = { data: unknown; error: unknown };

/** Builder encadeável que resolve no resultado configurado — mesmo molde do `etapa167`. */
function tabela(resultado: Resultado, espiao?: (m: string, a: unknown[]) => void) {
  const q: any = {};
  for (const m of ["select", "eq", "gte", "lte", "or", "order", "in", "not", "is", "neq", "limit", "range"]) {
    q[m] = (...a: unknown[]) => { espiao?.(m, a); return q; };
  }
  q.then = (ok: any, err: any) => Promise.resolve(resultado).then(ok, err);
  q.maybeSingle = async () => resultado;
  q.single = async () => resultado;
  return q;
}

/** Os cinco nomes da ANM que o repo conhece. Mauro/Caio/José têm mandato; Tasso/Roger não. */
const DIRETORES_ANM = [
  { id: "mauro", nome: "Mauro Henrique Moreira Sousa", nome_variantes: [], agencia_id: "anm" },
  { id: "caio", nome: "Caio Mário Trivellato Seabra Filho", nome_variantes: [], agencia_id: "anm" },
  { id: "jose", nome: "José Fernando Gomes Júnior", nome_variantes: ["José Fernando de Mendonça Gomes Júnior"], agencia_id: "anm" },
  { id: "tasso", nome: "Tasso Mendonça Júnior", nome_variantes: [], agencia_id: "anm" },
  { id: "roger", nome: "Roger Romão Cabral", nome_variantes: [], agencia_id: "anm" },
];

/** O preâmbulo REAL da 79ª ROP, como a `etapa24` o trava. */
const PRESENTES_79 = [
  "Mauro Henrique Moreira Sousa", "Tasso Mendonça Júnior",
  "Roger Romão Cabral", "José Fernando de Mendonça Gomes Júnior",
];

function montarDb(o: {
  votos?: unknown[];
  presentesDoPai?: string[] | null;
  erroVotos?: boolean;
  erroPresentes?: boolean;
  espiaoPresentes?: (m: string, a: unknown[]) => void;
}) {
  const votos = o.votos ?? [
    { deliberacao_id: "filho", diretor_id: "caio", proveniencia: "inferido_unanimidade", is_nominal: false },
    { deliberacao_id: "filho", diretor_id: "mauro", proveniencia: "inferido_unanimidade", is_nominal: false },
  ];
  return {
    from(t: string) {
      if (t === "votos") {
        return tabela(o.erroVotos ? { data: null, error: { message: "boom" } } : { data: votos, error: null });
      }
      if (t === "diretores") return tabela({ data: DIRETORES_ANM, error: null });
      if (t === "agencias") return tabela({ data: [{ id: "anm", sigla: "ANM" }], error: null });
      if (t === "deliberacoes") {
        // Duas leituras diferentes na mesma tabela; o SELECT as discrimina.
        let ehPesada = false;
        const q = tabela(
          { data: [], error: null },
          (m, a) => { if (m === "select" && String(a[0]).includes("raw_extraction")) ehPesada = true; },
        );
        // Reconstrói com o resultado certo depois de ver o select.
        const proxy: any = {};
        for (const m of ["select", "eq", "gte", "lte", "or", "order", "in", "not", "is", "neq", "limit", "range"]) {
          proxy[m] = (...a: unknown[]) => {
            if (m === "select" && String(a[0]).includes("raw_extraction")) ehPesada = true;
            o.espiaoPresentes?.(m, a);
            return proxy;
          };
        }
        const resolver = () => {
          if (!ehPesada) {
            return {
              data: [{
                id: "filho", agencia_id: "anm", tipo_documento: "deliberacao",
                documento_pai_id: "pai", data_reuniao: "2025-11-26", numero_reuniao: "79",
              }],
              error: null,
            };
          }
          if (o.erroPresentes) return { data: null, error: { message: "boom" } };
          const presentes = o.presentesDoPai === null ? undefined : (o.presentesDoPai ?? PRESENTES_79);
          return { data: [{ id: "pai", raw_extraction: presentes ? { nomes_presentes: presentes } : {} }], error: null };
        };
        proxy.then = (ok: any, err: any) => Promise.resolve(resolver()).then(ok, err);
        proxy.maybeSingle = async () => resolver();
        proxy.single = async () => resolver();
        void q;
        return proxy;
      }
      return tabela({ data: [], error: null });
    },
  };
}

const chamar = async (qs = "") => {
  const res = await GET(new NextRequest(`http://x/api/v1/admin/votos/roster-divergente${qs}`));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => { globalThis.__rosterDb = undefined; });

describe("etapa175 · a 79ª ROP, medida ponta a ponta", () => {
  it("⚠️ Caio Mário recebeu voto SEM estar no preâmbulo — e a rota diz isso", async () => {
    globalThis.__rosterDb = montarDb({});
    const { status, body } = await chamar();
    expect(status).toBe(200);
    expect(body.totais.reunioes_afetadas).toBe(1);
    const r = body.reunioes[0];
    expect(r.agencia).toBe("ANM");
    expect(r.numero_reuniao).toBe("79");
    expect(r.recebeu_voto_sem_estar_presente).toEqual(["Caio Mário Trivellato Seabra Filho"]);
  });

  it("⚠️ E A METADE INVISÍVEL: Tasso e Roger estavam na ata e receberam ZERO voto", async () => {
    // Esta é a metade que o banner nunca mostrou — um voto ausente não aparece em métrica nenhuma.
    globalThis.__rosterDb = montarDb({});
    const { body } = await chamar();
    const semVoto = body.reunioes[0].presente_sem_receber_voto;
    expect(semVoto).toContain("Tasso Mendonça Júnior");
    expect(semVoto).toContain("Roger Romão Cabral");
    // ⚠️ E o CONTADOR por agência, que é o que escala. A primeira versão deste teste checava só a
    // lista da amostra e SOBREVIVEU à mutação que apagava `acc.com_presente_sem_voto++` — a métrica
    // da metade invisível ficou, ela mesma, invisível ao teste.
    expect(body.por_agencia.ANM.com_presente_sem_voto, "o contador da metade invisível não é medido")
      .toBe(1);
    expect(body.por_agencia.ANM.com_voto_sem_presenca).toBe(1);
    expect(body.por_agencia.ANM.conferiveis).toBe(1);
    expect(body.por_agencia.ANM.limpas).toBe(0);
  });

  it("o José Fernando casa por VARIANTE de nome — a ata escreve o nome completo", async () => {
    // A ata diz "José Fernando de Mendonça Gomes Júnior"; o cadastro, "José Fernando Gomes Júnior".
    globalThis.__rosterDb = montarDb({});
    const { body } = await chamar();
    expect(body.amostra[0].presentes_nao_reconhecidos,
      "o nome da ata não casou com o cadastro").toEqual([]);
  });

  it("a proveniência viaja na resposta — é ela que separa inferência de nominal", async () => {
    globalThis.__rosterDb = montarDb({});
    const { body } = await chamar();
    expect(body.reunioes[0].proveniencia).toEqual(["inferido_unanimidade"]);
  });

  it("quando todo votante está no preâmbulo, a reunião NÃO entra", async () => {
    globalThis.__rosterDb = montarDb({
      votos: [{ deliberacao_id: "filho", diretor_id: "mauro", proveniencia: "nominal", is_nominal: true }],
      presentesDoPai: ["Mauro Henrique Moreira Sousa"],
    });
    const { body } = await chamar();
    expect(body.totais.reunioes_afetadas).toBe(0);
    expect(body.por_agencia.ANM.limpas).toBe(1);
  });
});

describe("etapa175 · ⚠️ ausência de dado NÃO é divergência", () => {
  it("pai sem `nomes_presentes` → nao_conferivel, e ZERO reunião afetada", async () => {
    // É a disciplina de `janela-de-mandatos.ts`: transformar ausência de cadastro em afirmação
    // sobre o período é a mentira oposta, e igualmente grave.
    globalThis.__rosterDb = montarDb({ presentesDoPai: null });
    const { body } = await chamar();
    expect(body.por_agencia.ANM.nao_conferivel_sem_presentes).toBe(1);
    expect(body.por_agencia.ANM.conferiveis).toBe(0);
    expect(body.totais.reunioes_afetadas).toBe(0);
  });

  it("lista de presentes VAZIA também é não-conferível, não «ninguém estava lá»", async () => {
    globalThis.__rosterDb = montarDb({ presentesDoPai: [] });
    const { body } = await chamar();
    expect(body.por_agencia.ANM.nao_conferivel_sem_presentes).toBe(1);
    expect(body.totais.reunioes_afetadas).toBe(0);
  });
});

describe("etapa175 · ⚠️ erro de leitura vira 500, nunca um zero plausível", () => {
  it("falha ao ler votos → 500", async () => {
    globalThis.__rosterDb = montarDb({ erroVotos: true });
    const { status } = await chamar();
    expect(status).toBe(500);
  });

  it("falha ao ler os presentes → 500", async () => {
    globalThis.__rosterDb = montarDb({ erroPresentes: true });
    const { status } = await chamar();
    expect(status).toBe(500);
  });

  it("e a leitura parcial é DECLARADA no corpo", async () => {
    globalThis.__rosterDb = montarDb({});
    const { body } = await chamar();
    expect(body).toHaveProperty("leitura_completa");
  });
});

describe("etapa175 · ⚠️ a rota é SÓ LEITURA, e lê em lotes", () => {
  const ROTA = semComentarios(ler("src/app/api/v1/admin/votos/roster-divergente/route.ts"));

  it("não existe caminho de escrita — nem insert, nem update, nem upsert, nem delete", async () => {
    for (const verbo of ["insert(", "update(", "upsert(", "delete(", "rpc("]) {
      expect(ROTA, `a rota ganhou um caminho de escrita: ${verbo}`).not.toContain(`.${verbo}`);
    }
  });

  it("⚠️ o payload pesado usa `lerEmLotes`, não `.in()` cru", async () => {
    // `lerTudo` pagina as LINHAS; a URL carrega todos os ids de uma vez. Foi um `.in()` com 820 ids
    // (32 KB contra teto de 8 KB) que zerou `VotosNaDeliberacao` em 100% do CSV.
    expect(ROTA).toMatch(/lerEmLotes<any>\(db, \{[\s\S]{0,200}?tabela: "deliberacoes"/);
    expect(ROTA, "voltou o .in() cru").not.toMatch(/\.in\("id", ids\)/);
  });

  it("⚠️ e a rota IRMÃ também — ela nasceu nesta fase com o mesmo defeito", async () => {
    const IRMA = semComentarios(ler("src/app/api/v1/admin/votos/diagnostico-inferencia/route.ts"));
    expect(IRMA).toMatch(/lerEmLotes<any>\(db, \{/);
    expect(IRMA, "diagnostico-inferencia voltou ao .in() cru").not.toMatch(/\.in\("id", ids\)/);
  });

  it("o limiar de nome é o COMPARTILHADO, não um literal local", async () => {
    // `MATCH_THRESHOLD` já é fonte única (etapa125); um 0.85 solto aqui criaria a segunda verdade.
    expect(ROTA).toMatch(/MATCH_THRESHOLD/);
    expect(ROTA, "literal de limiar solto na rota").not.toMatch(/>=\s*0\.85/);
  });
});

/**
 * ⚠️ Este bloco existe porque as correções de PARIDADE com o motor passaram sem que nenhum teste
 * notasse — os 14 casos acima ficaram verdes antes e depois delas. Um conserto que nenhum teste
 * percebe é um conserto que a próxima refatoração desfaz em silêncio.
 */
describe("etapa175 · ⚠️ o selo não pode DISCORDAR do motor", () => {
  const ROTA = semComentarios(ler("src/app/api/v1/admin/votos/roster-divergente/route.ts"));

  it("usa `resolverPresentesRoster` — a MESMA função que constrói o roster que vira voto", () => {
    // Um laço próprio de match aqui seria a segunda verdade: a rota acusaria divergência onde o
    // motor não vê nenhuma, e vice-versa.
    expect(ROTA).toMatch(/resolverPresentesRoster\(presentes, candidatos\)/);
  });

  it("⚠️ ordena por nome mais LONGO primeiro, como o motor", () => {
    // `findBestMatch` usa `>` estrito: em empate vence o primeiro iterado. O motor ordena assim em
    // `materializar-faltantes:102`; ordem diferente = match diferente = acusação falsa.
    expect(ROTA).toMatch(/sort\(\(x, y\) => y\.nome\.length - x\.nome\.length\)/);
    const MOTOR = semComentarios(ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts"));
    expect(MOTOR, "o motor mudou de ordenação e a rota ficou para trás")
      .toMatch(/sort\(\([\s\S]{0,80}?\) => y\.nome\.length - x\.nome\.length\)/);
  });

  it("rejeita match na faixa de REVISÃO — sem certeza, sem afirmação", () => {
    // `resolverPresentesRoster` descarta `needsReview` (0.6–0.85). O relatório de não-reconhecidos
    // tem de usar o mesmo critério, senão um nome entraria nas duas listas ao mesmo tempo.
    expect(ROTA).toMatch(/!m\.diretorId \|\| m\.needsReview/);
  });

  it("⚠️ declara o teto de 20 nomes da origem — senão «presente sem voto» pode ser falta de NOME", () => {
    expect(ROTA).toMatch(/lista_possivelmente_truncada_na_origem: presentes\.length >= 20/);
  });

  it("e a lista truncada é sinalizada quando bate no teto", async () => {
    globalThis.__rosterDb = montarDb({
      presentesDoPai: Array.from({ length: 20 }, (_, i) => `Diretor Numero ${i} Da Silva`),
    });
    const { body } = await chamar();
    expect(body.amostra[0]?.lista_possivelmente_truncada_na_origem).toBe(true);
  });

  it("⚠️ declara que `fonte_presenca` existe e NÃO é populada", () => {
    // A coluna com CHECK ('documento','mandato') responderia esta rota com um GROUP BY, e nada a
    // escreve: ela só aparece em `COLUNAS_VOTOS_OPCIONAIS`. Capacidade sem consumidor, invertida.
    expect(ROTA).toMatch(/fonte_presenca_nao_e_populada: true/);
    const WRITE = ler("src/lib/server/votos-write.ts");
    expect(WRITE, "fonte_presenca saiu das colunas opcionais").toMatch(/"fonte_presenca"/);
    const escritores = semComentarios(WRITE).match(/fonte_presenca\s*:/g) ?? [];
    expect(escritores.length, "alguém passou a ESCREVER fonte_presenca — atualize a nota da rota")
      .toBe(0);
  });
});
