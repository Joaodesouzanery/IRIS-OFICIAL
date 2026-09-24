/**
 * Etapa 150 (Fase 28, commit 3) — retrato não se soma; evento sim.
 *
 * ═══ O número que o usuário leu e que o dado não sustentava ═══
 * O banner da esteira dizia "74 sem evidência de voto · 72 anterior(es) ao 1º mandato conhecido".
 * Nenhum dos dois era contagem de deliberações distintas: a tela somava CEGAMENTE todo valor
 * numérico de toda etapa de TODAS as rodadas (até 300), e o materializador recalcula esses
 * contadores do zero a cada rodada, sobre a mesma população. Três rodadas exibiam a mesma medição
 * três vezes. `pendentes_direcao` tinha o mesmo formato — um número que só CAI, sendo somado.
 *
 * A Fase 28 agrava o problema se não o consertar junto: a partição passou a computar
 * `fora_da_janela` sobre o acervo INTEIRO, então cada rodada publica o estoque completo. Somar
 * três estoques completos é três vezes o acervo.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  agregarEtapas,
  naturezaDaChave,
  CHAVES_DE_ESTOQUE,
} from "@/lib/server/agregar-rodadas";
import { CHAVES_NUMERICAS_DO_MATERIALIZADOR, resumirBackfill } from "@/lib/server/resumo-do-backfill";

const RAIZ = join(__dirname, "../../../..");

describe("etapa150 · três rodadas com o MESMO retrato dão o retrato, não o triplo", () => {
  it("o caso exato do banner: estoque fica, evento soma", () => {
    const totais: Record<string, number> = {};
    for (let rodada = 0; rodada < 3; rodada++) {
      agregarEtapas(totais, {
        backfill_votos: { fora_da_janela: 72, pendentes: 350, votos: 3, deliberacoes: 1 },
      });
    }
    expect(totais.fora_da_janela).toBe(72);   // era 216
    expect(totais.pendentes).toBe(350);       // era 1050
    expect(totais.votos).toBe(9);             // evento: 3 rodadas × 3 votos
    expect(totais.deliberacoes).toBe(3);
  });

  it("o estoque vale o ÚLTIMO valor — é ele que mostra a fila DRENANDO", () => {
    const totais: Record<string, number> = {};
    for (const pendentes of [350, 290, 230]) agregarEtapas(totais, { backfill_votos: { pendentes } });
    expect(totais.pendentes).toBe(230);
  });

  it("`pendentes_direcao` é retrato e estava sendo somado — um número que só cai, crescendo", () => {
    const totais: Record<string, number> = {};
    for (const n of [533, 233, 0]) agregarEtapas(totais, { derivadas: { pendentes_direcao: n } });
    expect(totais.pendentes_direcao).toBe(0);
  });

  it("chave DESCONHECIDA soma — o default é o comportamento de hoje, para nada sumir por omissão", () => {
    expect(naturezaDaChave("uma_chave_que_ninguem_viu")).toBe("evento");
    const totais: Record<string, number> = {};
    for (let i = 0; i < 3; i++) agregarEtapas(totais, { x: { uma_chave_que_ninguem_viu: 5 } });
    expect(totais.uma_chave_que_ninguem_viu).toBe(15);
  });

  it("valor não-numérico não entra nos totais (string precisa de leitor próprio)", () => {
    const totais: Record<string, number> = {};
    agregarEtapas(totais, { backfill_votos: { leitura_do_acervo: "INCOMPLETA", votos: 2 } as any });
    expect(totais.leitura_do_acervo).toBeUndefined();
    expect(totais.votos).toBe(2);
  });

  it("o PARCIAL soma — mas a tela é obrigada a mostrar o denominador junto", () => {
    expect(naturezaDaChave("sem_evidencia")).toBe("parcial");
    const tela = readFileSync(join(RAIZ, "src/app/dashboard/deliberacoes/votos-diretores/page.tsx"), "utf-8");
    const linha = tela.slice(tela.indexOf("totais.sem_evidencia ?? 0) > 0"), tela.indexOf("totais.sem_evidencia ?? 0) > 0") + 500);
    expect(linha).toMatch(/totais\.examinados/);
    // ⚠️ Fase 31 — o rótulo saiu do literal e virou `ROTULO_PARCIAL`, porque agora ele é
    // obrigatório em MAIS de uma linha (a regra do dispositivo também é parcial). Repetir a
    // frase em cada uma deixaria as duas divergirem com o tempo — e o rótulo é a coisa que não
    // pode divergir, já que é ele que diz ao leitor que o número repete.
    expect(linha).toMatch(/\$\{ROTULO_PARCIAL\}/);
    expect(tela).toMatch(/const ROTULO_PARCIAL = "ocorrências nos lotes, com repetição";/);
  });

  it("⚠️ TODA chave parcial exibida na tela carrega o rótulo — nenhuma escapa", () => {
    // Guard contra o esquecimento clássico: acrescentar uma chave parcial nova e exibi-la crua.
    const tela = readFileSync(join(RAIZ, "src/app/dashboard/deliberacoes/votos-diretores/page.tsx"), "utf-8");
    for (const chave of ["sem_evidencia", "regex_divergente"]) {
      const i = tela.indexOf(`totais.${chave} ?? 0`);
      expect(i, `${chave} não é exibido`).toBeGreaterThan(-1);
      expect(tela.slice(i, i + 700), `${chave} exibido sem o rótulo de repetição`)
        .toMatch(/ROTULO_PARCIAL/);
    }
  });

  it("⚠️ a DUPLA NARRATIVA morreu — `itens_que_mudariam` não é mais enunciado", () => {
    // Ele é, por construção, `regex_divergente + regex_falso_positivo` (A ∪ B, mutuamente
    // exclusivos, em materializar-faltantes:422-438). A frase dizia a mesma população duas vezes.
    const tela = readFileSync(join(RAIZ, "src/app/dashboard/deliberacoes/votos-diretores/page.tsx"), "utf-8");
    const i = tela.indexOf("regra do dispositivo (vigente)");
    expect(i).toBeGreaterThan(-1);
    expect(tela.slice(i, i + 400), "o total e a decomposição voltaram a conviver")
      .not.toMatch(/itens_que_mudariam/);
  });
});

describe("etapa150 · a tela usa o classificador, e as chaves novas têm leitor", () => {
  const tela = readFileSync(join(RAIZ, "src/app/dashboard/deliberacoes/votos-diretores/page.tsx"), "utf-8");

  it("o laço de soma cega foi substituído", () => {
    expect(tela).toMatch(/agregarEtapas\(totais, ultimas/);
    expect(tela).not.toMatch(/if \(typeof v === "number"\) totais\[k\] = \(totais\[k\] \?\? 0\) \+ v;/);
  });

  it("toda chave nova do resumo é LIDA — capacidade sem consumidor não conta como entregue", () => {
    for (const chave of ["pendentes", "examinados", "fora_de_escopo"]) {
      expect(CHAVES_NUMERICAS_DO_MATERIALIZADOR as readonly string[]).toContain(chave);
      expect(tela, `sem leitor para ${chave}`).toMatch(new RegExp(`totais\\.${chave}`));
    }
    // A string não passa por `agregarEtapas`: tem de ser lida direto da etapa.
    expect(tela).toMatch(/ultimas\.backfill_votos\?\.leitura_do_acervo/);
    expect(tela).toMatch(/leitura do acervo/);
  });

  it("a truncagem vira AVISO, não um zero somado", () => {
    // Booleano viraria 0 na soma e a tela nunca saberia que os números subcontam.
    expect(resumirBackfill({ leitura_completa: false }).leitura_do_acervo).toMatch(/INCOMPLETA/);
    expect(resumirBackfill({ leitura_completa: true }).leitura_do_acervo).toBeUndefined();
  });

  it("todo retrato publicado pelo materializador está declarado como estoque", () => {
    // Guard contra o esquecimento clássico: publicar um retrato novo e deixá-lo somar.
    for (const chave of ["pendentes", "fora_da_janela", "fora_de_escopo", "sem_voto"]) {
      expect(CHAVES_DE_ESTOQUE.has(chave), `${chave} deveria ser estoque`).toBe(true);
    }
    expect(CHAVES_DE_ESTOQUE.has("votos")).toBe(false);
    expect(CHAVES_DE_ESTOQUE.has("examinados")).toBe(false);
  });
});
