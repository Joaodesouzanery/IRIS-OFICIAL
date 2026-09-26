/**
 * Etapa 183 (Fase 31, Bloco 4) — a aba Reuniões para de truncar em silêncio.
 *
 * ⚠️ É a tela onde o usuário foi procurar a 79ª ROP e concluiu "nem tem ANM reunião 79".
 *
 * As duas leituras da rota usavam `.limit(10000)` e `.limit(2000)`. **`.limit(N)` grande não é
 * paginação**: o PostgREST corta em ~1.000 e o teto grande é ignorado. Com filtro de ano o volume
 * de um ano fica sob o corte e o defeito não aparece; SEM filtro de ano a aba lista o acervo inteiro
 * e perde tudo depois da milésima linha, sem aviso.
 *
 * Terceira instância desta classe nesta fase, e a mesma que produziu os "537 órfãos" da Fase 24b.
 *
 * ⚠️ E aqui truncar é PIOR que errar: lista de reuniões faltando reuniões lê-se como "essa reunião
 * não existe". Como o contrato desta rota é um ARRAY (travado em `etapa65`), não há onde pendurar um
 * aviso — então truncagem vira 500 declarado.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const ROTA = semComentarios(ler("src/app/api/v1/reunioes/route.ts"));
const ROTA_BRUTA = ler("src/app/api/v1/reunioes/route.ts");

describe("etapa183 · as duas leituras paginam", () => {
  it("⚠️ nenhum `.limit(N)` grande sobrou — ele não é paginação", () => {
    // Mutação a matar: voltar qualquer um dos dois. O `tsc` fica verde, a tela funciona com filtro
    // de ano, e quebra em silêncio exatamente quando o operador tira o filtro para procurar algo.
    const limites = [...ROTA.matchAll(/\.limit\((\d+)\)/g)].map((m) => Number(m[1]));
    const grandes = limites.filter((n) => n > 1000);
    expect(grandes, `.limit() maior que o corte do PostgREST: ${grandes.join(", ")}`).toEqual([]);
  });

  it("as duas usam `lerTudo`, com rótulos distintos", () => {
    expect(ROTA).toMatch(/await lerTudo<any>\(delibsQuery, "reunioes\/deliberacoes"\)/);
    expect(ROTA).toMatch(/await lerTudo<any>\(reunioesQuery, "reunioes\/materializadas"\)/);
  });

  it("⚠️ `lerTudo` recebe FÁBRICA, não query montada — reusar acumularia os `.range()`", () => {
    expect(ROTA).toMatch(/const delibsQuery = \(\) => \{/);
    expect(ROTA).toMatch(/const reunioesQuery = \(\) => \{/);
  });

  it("⚠️ e as duas têm `.order` — sem ordem total o `.range()` repete e pula linhas", () => {
    const comOrder = (ROTA.match(/return q\.order\("id"\);/g) ?? []).length;
    expect(comOrder, "uma das fábricas perdeu a ordenação estável").toBe(2);
  });
});

describe("etapa183 · ⚠️ e a TELA não tinha saída pela interface", () => {
  const TELA = ler("src/app/dashboard/reunioes/page.tsx");
  const TELA_CODIGO = semComentarios(TELA);

  it("⚠️ a opção «Todos os anos» EXISTE — ela não existia", () => {
    /**
     * Este é o achado mais direto do relato do usuário. O seletor de ano desta aba listava só os
     * seis últimos anos, SEM opção de "todos" — e o estado nascia no ano corrente. Procurando a 79ª
     * ROP (2025-11-26) com a aba em 2026, NENHUMA combinação de cliques trazia a reunião à tela.
     * "Não tem 79" era a única conclusão que a interface permitia.
     */
    expect(TELA).toMatch(/<option value="">Todos os anos<\/option>/);
  });

  it("e o ano nasce vazio, como nas telas irmãs", () => {
    expect(TELA_CODIGO).toMatch(/const \[year, setYear\] = useState\(""\);/);
    expect(TELA_CODIGO, "voltou o ano corrente pré-selecionado")
      .not.toMatch(/const \[year, setYear\] = useState\(String\(new Date\(\)\.getFullYear\(\)\)\)/);
  });

  it("o vazio diz o RECORTE e oferece a saída", () => {
    expect(TELA_CODIGO).toMatch(/Nenhuma reunião em <span className="font-mono text-xs">\{recorte\}<\/span>/);
    expect(TELA_CODIGO).toMatch(/const recorte = \[/);
    expect(TELA_CODIGO).toMatch(/year \|\| "todos os anos",/);
    expect(TELA_CODIGO).toMatch(/onClick=\{\(\) => setYear\(""\)\}/);
  });

  it("⚠️ e o botão de saída só aparece quando HÁ ano — senão prometeria uma ação sem efeito", () => {
    expect(TELA_CODIGO).toMatch(/\{year \? \(\s*<button/);
  });
});

describe("etapa183 · truncar vira ERRO DECLARADO, não lista pela metade", () => {
  it("as duas truncagens devolvem 500 com a saída (filtrar por ano ou agência)", () => {
    const avisos = (ROTA.match(/A lista de reuniões não caberia inteira nesta resposta\. Filtre por ano ou agência\./g) ?? []).length;
    expect(avisos, "uma das duas leituras voltou a truncar em silêncio").toBe(2);
    expect((ROTA.match(/if \((?:delibsRes|matRes)\.truncated\)/g) ?? []).length).toBe(2);
  });

  it("⚠️ o erro da leitura principal continua sendo 500 — `?? []` aqui seria lista vazia plausível", () => {
    expect(ROTA).toMatch(/if \(delibsRes\.error\) return NextResponse\.json\(\{ error: "Erro ao buscar reuniões" \}, \{ status: 500 \}\);/);
  });

  it("⚠️ mas o `error` da tabela `reunioes` CONTINUA degradando — ali é desenho, não falha", () => {
    /**
     * `reunioes` pode não estar migrada (`CLAUDE.md`: degrade-gracioso é PROPOSITAL, para o deploy
     * ser seguro antes da migration). Transformar isso em 500 derrubaria a aba inteira num deploy
     * legítimo. O que NÃO pode degradar é `truncated`, que é reunião existente e não listada.
     */
    expect(ROTA).toMatch(/const reunioesError = matRes\.error;/);
    expect(ROTA).toMatch(/if \(!reunioesError && materializadas\) \{/);
    expect(ROTA_BRUTA).toMatch(/`error` continua degradando em silêncio/);
  });

  it("e o contrato de ARRAY do sucesso não mudou — `etapa65` o trava", () => {
    expect(ROTA).toMatch(/return NextResponse\.json\(computed\);/);
    const E65 = ler("src/lib/server/__tests__/etapa65-contratos-rota.test.ts");
    expect(E65).toMatch(/nome: "reunioes", path: "\/reunioes".*forma: "array"/);
  });

  it("o docblock nomeia a tela e o incidente — senão o próximo «otimiza» de volta", () => {
    expect(ROTA_BRUTA).toMatch(/79ª ROP/);
    expect(ROTA_BRUTA).toMatch(/`\.limit\(N\)` grande não é paginação/);
  });
});
