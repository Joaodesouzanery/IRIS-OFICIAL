/**
 * Etapa 165 (Fase 31, Bloco 1) — o filtro por REUNIÃO, que faltava para conferir o gabarito.
 *
 * O gabarito de votos por diretor (`etapa163`) é conferível linha a linha no PDF, mas não era
 * conferível NA TELA: a aba de auditoria filtrava por agência, diretor, ano, tipo e origem — nunca
 * por reunião. Conferir "Fábio teve 47 votos na 83ª ROP" exigia paginar 2.726 votos à mão.
 *
 * ⚠️ E O ERRO ELEGANTE QUE ESTE ARQUIVO IMPEDE: filtrar por `reuniao_id`.
 * A FK existe (`20260705121000_reunioes_materializadas.sql:40`) e seria o caminho "certo" de
 * modelagem. Mas `ensureReuniao` só a grava quando há data (`reunioes.ts:75`), então o filtro
 * excluiria em SILÊNCIO exatamente as deliberações sem data — as 18 que a Tarefa 5 persegue, e a
 * população que mais precisa de auditoria. Por `numero_reuniao`, que é coluna própria da
 * deliberação e existe com ou sem data.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { normalizarFiltros } from "@/lib/server/auditoria-votos-filtros";
import { CABECALHO_CSV } from "@/lib/server/auditoria-votos-csv";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const ROTA = ler("src/app/api/v1/admin/auditoria/votos/route.ts");
const TELA = ler("src/app/dashboard/deliberacoes/auditoria-votos/page.tsx");

const filtros = (qs: string) => normalizarFiltros(new URLSearchParams(qs));

describe("etapa165 · o contrato do filtro de reunião", () => {
  it.each([
    ["1024", "número simples da ANTT"],
    ["83", "número curto da ANM"],
    ["79ª", "com ordinal, como a ANM escreve"],
    ["264-RDE", "com sufixo de série"],
    ["1.024", "com separador de milhar"],
  ])("aceita «%s» (%s)", (valor) => {
    const r = filtros(`numero_reuniao=${encodeURIComponent(valor)}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.filtros.numero_reuniao).toBe(valor);
  });

  it.each([
    ["83 ROP", "espaço — viraria entrada livre na consulta"],
    ["'; drop--", "pontuação fora do conjunto"],
    ["012345678901234567890", "21 caracteres, acima do VARCHAR(20)"],
  ])("recusa «%s» com 400 (%s)", (valor) => {
    const r = filtros(`numero_reuniao=${encodeURIComponent(valor)}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/numero_reuniao/);
  });

  it("ausente é null, e string vazia também — não vira filtro por vazio", () => {
    const a = filtros("");
    const b = filtros("numero_reuniao=");
    const c = filtros("numero_reuniao=%20%20");
    expect(a.ok && a.filtros.numero_reuniao).toBeNull();
    expect(b.ok && b.filtros.numero_reuniao).toBeNull();
    expect(c.ok && c.filtros.numero_reuniao).toBeNull();
  });

  it("⚠️ recusa é DIFERENTE de ignorar — e o ano continua sendo ignorado, de propósito", () => {
    // `ano` fora do formato é conveniência e não derruba a tela (contrato antigo, preservado).
    // `numero_reuniao` inválido RECUSA: ele restringe a população, e restringir errado em
    // silêncio devolveria "nenhum voto" com cara de fato sobre o dado.
    expect(filtros("ano=banana").ok).toBe(true);
    expect(filtros("numero_reuniao=banana banana").ok).toBe(false);
  });
});

describe("etapa165 · a rota filtra pela COLUNA, não pela FK", () => {
  const CODIGO = semComentarios(ROTA);

  it("⚠️ filtra por `numero_reuniao` e NUNCA por `reuniao_id`", () => {
    expect(CODIGO).toMatch(/\.eq\("deliberacao\.numero_reuniao", f\.numero_reuniao\)/);
    // A forma que esconderia as deliberações sem data não pode entrar.
    expect(CODIGO).not.toMatch(/\.eq\("deliberacao\.reuniao_id"/);
    expect(CODIGO).not.toMatch(/reuniao_id/);
  });

  it("a coluna é PROJETADA — antes ela existia no banco e não vinha na resposta", () => {
    expect(CODIGO).toMatch(/numero_reuniao, tipo_reuniao/);
    expect(CODIGO).toMatch(/numero_reuniao: d\.numero_reuniao/);
  });

  it("o CSV ganhou a coluna, e o cabeçalho continua casando com a linha", () => {
    expect(CABECALHO_CSV).toContain("NumeroReuniao");
    // A ordem importa: a coluna nova entra logo após a agência, antes da deliberação.
    expect(CABECALHO_CSV.indexOf("NumeroReuniao")).toBe(CABECALHO_CSV.indexOf("Agencia") + 1);
    expect(CABECALHO_CSV.indexOf("NumeroReuniao")).toBeLessThan(CABECALHO_CSV.indexOf("NumeroDeliberacao"));
  });

  it("a tela manda o parâmetro e mostra a coluna", () => {
    expect(TELA).toMatch(/qs\.set\("numero_reuniao", numeroReuniao\.trim\(\)\)/);
    expect(TELA).toMatch(/"REUNIÃO"/);
    // E o filtro novo entra na chave da query: sem isso, digitar a reunião não refaria a busca.
    expect(TELA).toMatch(/const filtrosDaBusca = \[[^\]]*numeroReuniao/);
  });
});

describe("etapa165 · a amostra estratificada sai do UNIVERSO, não da página", () => {
  const CODIGO = semComentarios(ROTA);

  it("⚠️ lê o universo com `lerTudo` — 5 entre os 50 visíveis não é amostra", () => {
    // ⚠️ Ancorar no RÓTULO da leitura, não num `lerTudo` qualquer: a primeira versão desta
    // asserção usava uma janela de 400 chars depois de `querAmostra` e casava com o `lerTudo` do
    // ramo do CSV logo abaixo — passava mesmo com a amostra lendo a página.
    expect(CODIGO).toMatch(/lerTudo<any>\([\s\S]{0,160}?"auditoria-votos\/amostra"\)/);
    expect(CODIGO).toMatch(/amostrarEstratificado\(/);
  });

  it("a bandeira de truncagem considera o ERRO, não só `truncated`", () => {
    // `selectAllPaged` devolve `truncated:false` no caminho de erro — olhar só a bandeira deixaria
    // a amostra parecer completa justo quando a leitura falhou (armadilha de cobertura-ao-vivo).
    expect(CODIGO).toMatch(/r\.truncated \|\| Boolean\(r\.error\)/);
  });

  it("o seed default é o DIA — mesma amostra o dia inteiro, e reabrível por URL", () => {
    expect(CODIGO).toMatch(/searchParams\.get\("seed"\) \?\? new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  });

  it("a tela respeita os filtros ao amostrar, e tira a paginação", () => {
    expect(TELA).toMatch(/qs\.delete\("page"\); qs\.delete\("limit"\);/);
    expect(TELA).toMatch(/qs\.set\("amostra", "1"\)/);
  });

  it("⚠️ a tela NÃO funde «não existe» com «não coube»", () => {
    expect(TELA).toMatch(/cotas_sem_exemplar/);
    expect(TELA).toMatch(/cotas_fora_do_tamanho/);
    expect(TELA).toMatch(/sem nenhum caso de/);
    expect(TELA).toMatch(/existe mas não coube/);
  });
});
