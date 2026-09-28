/**
 * Etapa 208 (Fase 35, Bloco E) — a correção de data funciona e é LENTA, e eu li a lentidão como
 * "pronto".
 *
 * ═══ O que o usuário corrigiu ═══
 * O commit `924e523` afirmou que dez reuniões voltariam para 2026. Ele conferiu uma por uma:
 *   · a 80ª da ANM **já estava certa** (2025-12-17 é a data do preâmbulo; antes estava em 2024) — o
 *     que ENFRAQUECE a hipótese "ata sem texto" e confirma que a Janela C funciona;
 *   · 81ª, 82ª e 83ª da ANM seguem erradas;
 *   · 1.035 e 289 da ANTT já têm linha em 2026 — o que existe é linha SOBRANDO com data antiga, o
 *     mesmo padrão da 1177ª da ARTESP (23 de 24 certas). É duplicata, não data errada.
 *
 * ═══ As duas causas, e cada uma tem instrumento próprio ═══
 *  (1) a janela ROTATIVA examina 120 linhas por chamada sobre milhares, e o passo é sorteado poucas
 *      vezes por run (medido: `tentou_redatar: 4` em 18 rodadas). Daí o `?alvo=`.
 *  (2) `if (!fonte?.texto) continue` pulava em SILÊNCIO. Sem texto extraído, mais rodadas nunca
 *      resolvem e o conserto é re-extração — diagnóstico oposto. Daí o contador.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { lerAlvos, loteComAlvo, numeroNormalizado } from "@/lib/server/alvo-de-redatar";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("etapa208 · o alvo lê o que o usuário digitaria", () => {
  it("aceita lista simples", () => {
    expect([...lerAlvos("81,82,83")]).toEqual(["81", "82", "83"]);
  });

  it("⚠️ normaliza o PONTO — `numero_reuniao` convive em dois formatos no banco", () => {
    // "1.035" e "1035" são a mesma reunião; comparar texto cru perderia metade das linhas em silêncio.
    expect([...lerAlvos("1.035")]).toEqual(["1035"]);
    expect(numeroNormalizado("1.035")).toBe("1035");
    expect(numeroNormalizado("1035")).toBe("1035");
    expect(numeroNormalizado("295ª")).toBe("295");
  });

  it("descarta lixo sem explodir, e nada vazio entra", () => {
    expect([...lerAlvos("")]).toEqual([]);
    expect([...lerAlvos(null)]).toEqual([]);
    expect([...lerAlvos(undefined)]).toEqual([]);
    expect([...lerAlvos(",,,")]).toEqual([]);
    expect([...lerAlvos("abc")]).toEqual([]);
    expect([...lerAlvos("81, ,82")]).toEqual(["81", "82"]);
  });

  it("⚠️ limita o tamanho — entrada absurda não vira filtro absurdo", () => {
    expect([...lerAlvos("123456789")], ).toEqual([]);
    expect([...lerAlvos("99999")]).toEqual(["99999"]);
  });
});

describe("etapa208 · o lote com alvo escolhe a ORDEM, não o critério", () => {
  const linha = (id: string, numero: string) => ({ id, numero_reuniao: numero });
  const universo = [
    linha("a", "80"), linha("b", "81"), linha("c", "82"), linha("d", "83"),
    linha("e", "84"), linha("f", "85"), linha("g", "86"), linha("h", "87"),
  ];
  const num = (d: { numero_reuniao: string }) => d.numero_reuniao;
  const id = (d: { id: string }) => d.id;

  it("sem alvo, é exatamente a janela rotativa — o comportamento antigo", () => {
    const r = loteComAlvo(universo, new Set(), { inicio: 2, fim: 5 }, 3, num, id);
    expect(r.lote.map(id)).toEqual(["c", "d", "e"]);
    expect(r.encontrados).toBe(0);
  });

  it("⚠️ com alvo, as alvejadas vêm PRIMEIRO e o bloco completa a fatia", () => {
    // O alvo não desliga o trabalho de fundo: a volta continua avançando na mesma chamada.
    const r = loteComAlvo(universo, new Set(["81", "83"]), { inicio: 5, fim: 7 }, 4, num, id);
    expect(r.lote.slice(0, 2).map(id)).toEqual(["b", "d"]);
    expect(r.encontrados).toBe(2);
    expect(r.lote.map(id), "o bloco rotativo completa depois do alvo").toEqual(["b", "d", "f", "g"]);
  });

  it("não repete linha que está no alvo E no bloco", () => {
    const r = loteComAlvo(universo, new Set(["82"]), { inicio: 2, fim: 4 }, 4, num, id);
    const ids = r.lote.map(id);
    expect(new Set(ids).size, "uma linha examinada duas vezes gastaria reserva à toa").toBe(ids.length);
    expect(ids).toEqual(["c", "d"]);
  });

  it("⚠️ alvo que não casa NADA degrada para o comportamento normal, não para fatia vazia", () => {
    /**
     * Este é o caso que importa: um alvo digitado errado fazendo a rodada examinar ZERO linhas seria o
     * "0 itens, status ok" que este projeto mediu repetidas vezes — trabalho que não acontece e não
     * denuncia.
     */
    const r = loteComAlvo(universo, new Set(["999"]), { inicio: 1, fim: 4 }, 3, num, id);
    expect(r.encontrados).toBe(0);
    expect(r.lote.map(id), "a volta tem de continuar mesmo com alvo inexistente").toEqual(["b", "c", "d"]);
  });

  it("respeita o TETO — alvo grande não estoura a fatia da rodada", () => {
    const r = loteComAlvo(universo, new Set(["80", "81", "82", "83", "84"]), { inicio: 6, fim: 8 }, 3, num, id);
    expect(r.lote.length).toBe(3);
    expect(r.encontrados, "o `encontrados` conta o que CASOU, não o que caberia").toBe(5);
  });

  it("casa o número em qualquer um dos dois formatos", () => {
    const comPonto = [{ id: "x", numero_reuniao: "1.035" }];
    const r = loteComAlvo(comPonto, lerAlvos("1035"), { inicio: 0, fim: 0 }, 5,
      (d) => d.numero_reuniao, (d) => d.id);
    expect(r.encontrados).toBe(1);
  });
});

describe("etapa208 · o pulo silencioso passou a ter número", () => {
  const ROTA = semComentarios(ler("src/app/api/v1/admin/deliberacoes/redatar/route.ts"));

  it("`sem texto` incrementa antes de pular", () => {
    expect(ROTA).toMatch(/if \(!fonte\?\.texto\) \{ divergenteSemTexto\+\+; continue; \}/);
  });

  it("e o número é PUBLICADO — contador que não sai da rota não diagnostica nada", () => {
    expect(ROTA).toMatch(/divergente_sem_texto: divergenteSemTexto/);
  });

  it("⚠️ o alvo também é publicado, pedido E encontrado", () => {
    // Os dois juntos: `pedido: 3, encontrado: 0` é um diagnóstico ("o alvo não existe no universo"),
    // e `encontrado` sozinho não distingue isso de "não pedi alvo".
    expect(ROTA).toMatch(/divergente_alvo_pedido: divergenteAlvoPedido/);
    expect(ROTA).toMatch(/divergente_alvo_encontrado: divergenteAlvoEncontrado/);
  });

  it("a rota usa o módulo puro, não uma cópia inline da seleção", () => {
    expect(ROTA).toMatch(/lerAlvos\(req\.nextUrl\.searchParams\.get\("alvo"\)\)/);
    expect(ROTA).toMatch(/loteComAlvo\(/);
  });

  it("⚠️ e o alvo NÃO pula nenhuma checagem — as guardas seguem no laço", () => {
    /**
     * A propriedade que importa: alvejar muda a ORDEM, não o critério. Se o alvo passasse a permitir
     * escrever data sem âncora plausível, isto deixaria de ser diagnóstico e viraria uma porta para a
     * escrita mais cara desta esteira.
     */
    expect(ROTA, "a guarda de âncora plausível saiu do laço").toMatch(
      /if \(!rederivada \|\| !dataReuniaoPlausivel\(sigla, rederivada\)\.plausivel\) continue;/,
    );
    expect(ROTA, "o recorte de agência certificada saiu do laço").toMatch(
      /AGENCIAS_COM_ANCORA_CERTIFICADA\.has\(siglaDaLinha\.toUpperCase\(\)\)/,
    );
    expect(ROTA, "o portão da constante saiu").toMatch(/if \(!REDATAR_DATA_DIVERGENTE \|\| dryRun\) continue;/);
  });
});
