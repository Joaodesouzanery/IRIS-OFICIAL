/**
 * Etapa 228 — o que faltava do Bloco A (e do B): o NÚMERO, sem `curl`.
 *
 * A escrita do colegiado parcial existe desde a Fase 36, medida e desligada — mas a medição só
 * existia atrás de um `POST` com corpo JSON. E ela mede UM bloco de 60 por chamada, escolhido pelo
 * MINUTO: duas chamadas no mesmo minuto medem o mesmo bloco. Somar ingenuamente contaria em dobro.
 *
 * E o Bloco B que já ESCREVE (o "Rodar tudo" chama o redatar com dry_run=0) publicava seus números
 * — filhos alinhados, portão da ANTT, órfãs — e a esteira não lia nenhum.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  AUSENCIAS_VAZIO,
  PARCIAL_VAZIO,
  REVOTO_VAZIO,
  TETO_DETALHE,
  acumularAusencias,
  acumularParcial,
  acumularRevoto,
  continuarAusencias,
  somarPorAgencia,
  textoPorAgencia,
} from "../../medicoes-varredura";
import { naturezaDaChave } from "../agregar-rodadas";

const RAIZ = join(__dirname, "../../../..");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const ler = (p: string) => semComentarios(readFileSync(join(RAIZ, p), "utf-8"));
const MAT = ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts");
const AUS = ler("src/app/api/v1/admin/votos/ausencias-artesp/route.ts");
const RUN = ler("src/app/api/v1/pipeline/run/route.ts");
const PAINEL = ler("src/components/dashboard/EscritasMedidasPanel.tsx");
const TELA = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");

describe("etapa228 · a varredura soma cada pedaço UMA vez", () => {
  it("⚠️ o mesmo bloco duas vezes NÃO soma de novo", () => {
    const r = { janela_bloco: 0, janela_blocos: 3, parcial_pares_autorizados: 10, parcial_por_agencia: { ANM: 10 } };
    const uma = acumularParcial(PARCIAL_VAZIO, r);
    const duas = acumularParcial(uma, r);
    expect(duas.autorizados).toBe(10);
    expect(duas.blocos_medidos).toBe(1);
    expect(duas.por_agencia).toEqual({ ANM: 10 });
  });

  it("blocos distintos somam, e a soma por agência fecha", () => {
    let a = acumularParcial(PARCIAL_VAZIO, { janela_bloco: 0, janela_blocos: 2, parcial_pares_autorizados: 4, parcial_por_agencia: { ANM: 4 } });
    a = acumularParcial(a, { janela_bloco: 1, janela_blocos: 2, parcial_pares_autorizados: 6, parcial_por_agencia: { ANM: 1, ANTT: 5 } });
    expect(a).toMatchObject({ autorizados: 10, blocos_medidos: 2, blocos_total: 2, por_agencia: { ANM: 5, ANTT: 5 } });
  });

  it("revoto: mesmo princípio, e o roster suspeito é somado à parte", () => {
    let a = acumularRevoto(REVOTO_VAZIO, { janela_bloco: 0, janela_blocos: 2, revoto_apagariam: 3, revoto_roster_suspeito: 1 });
    a = acumularRevoto(a, { janela_bloco: 0, janela_blocos: 2, revoto_apagariam: 3, revoto_roster_suspeito: 1 });
    a = acumularRevoto(a, { janela_bloco: 1, janela_blocos: 2, revoto_apagariam: 2 });
    expect(a).toMatchObject({ apagariam: 5, roster_suspeito: 1, blocos_medidos: 2 });
  });

  it("ausências: soma, guarda amostra limitada e avança o offset", () => {
    let a = acumularAusencias(AUSENCIAS_VAZIO, { proximo_offset: 120, deliberacoes_candidatas: 300, deliberacoes_examinadas: 120, linhas_a_inserir: 7, restantes: true, detalhe: Array.from({ length: 50 }, (_, i) => ({ deliberacao_id: `a${i}`, numero_reuniao: "1198", inserir: [], promover: [], nominal_preservada: [] })) });
    a = acumularAusencias(a, { proximo_offset: 240, deliberacoes_examinadas: 120, linhas_a_inserir: 3, restantes: true, detalhe: Array.from({ length: 50 }, (_, i) => ({ deliberacao_id: `b${i}`, numero_reuniao: "1191", inserir: [], promover: [], nominal_preservada: [] })) });
    expect(a).toMatchObject({ a_inserir: 10, examinadas: 240, proximo_offset: 240, candidatas: 300, concluido: false });
    expect(a.detalhe).toHaveLength(TETO_DETALHE);
  });

  it("⚠️ sem progresso NÃO é 'concluído' — e o laço para em vez de girar em falso", () => {
    const antes = { ...AUSENCIAS_VAZIO, proximo_offset: 120 };
    const r = { proximo_offset: 120, deliberacoes_examinadas: 0, restantes: true };
    const depois = acumularAusencias(antes, r);
    expect(depois.concluido).toBe(false);
    expect(continuarAusencias(antes, depois, r)).toBe(false);
  });

  it("⚠️ sem progresso mesmo com 'restantes: false' NÃO é concluído — o orçamento pode ter cortado", () => {
    // Nenhuma linha examinada não prova nada sobre o fim: a mutação que trocava a regra por
    // `restantes !== true` sobreviveu até este caso existir.
    const antes = { ...AUSENCIAS_VAZIO, proximo_offset: 120 };
    expect(acumularAusencias(antes, { proximo_offset: 120, deliberacoes_examinadas: 0, restantes: false }).concluido).toBe(false);
  });

  it("concluído só quando avançou E a rota disse que não há mais", () => {
    const r = { proximo_offset: 50, deliberacoes_examinadas: 50, restantes: false };
    expect(acumularAusencias(AUSENCIAS_VAZIO, r).concluido).toBe(true);
  });

  it("somarPorAgencia ignora lixo; textoPorAgencia ordena e diz 'nenhum'", () => {
    expect(somarPorAgencia({ A: 1 }, { A: 2, B: Number.NaN } as never)).toEqual({ A: 3 });
    expect(textoPorAgencia({ A: 1, B: 5, C: 0 })).toBe("B 5 · A 1");
    expect(textoPorAgencia({})).toBe("nenhum");
  });
});

describe("etapa228 · as rotas aceitam o pedaço explícito", () => {
  it("materializar: `bloco` só nos modos de MEDIÇÃO — a esteira segue pelo relógio", () => {
    expect(MAT).toMatch(/const blocoPedido = \(completarParcial \|\| modoRevoto\) && Number\.isInteger\(body\.bloco\)/);
    expect(MAT).toMatch(/janelaRotativa\(semVoto\.length, LOTE_POR_RODADA, blocoPedido \?\? Math\.floor\(Date\.now\(\) \/ 60_000\)\)/);
  });

  it("⚠️ ausências: `offset` — antes toda chamada examinava as MESMAS 120", () => {
    expect(AUS).toMatch(/const lote = candidatas\.slice\(offset, offset \+ limite\);/);
    expect(AUS).toMatch(/proximo_offset: offset \+ examinadas,/);
    expect(AUS).toMatch(/restantes: candidatas\.length > offset \+ examinadas,/);
  });
});

describe("etapa228 · o painel mede sem escrever", () => {
  it("as duas medições DESLIGADAS vão com dry_run: true e bloco explícito", () => {
    expect(PAINEL).toMatch(/api\.post<R>\("\/admin\/votos\/materializar-faltantes", \{ \.\.\.corpo, dry_run: true, bloco \}\)/);
  });

  it("⚠️ só 'Aplicar' das ausências grava — e pede confirmação antes", () => {
    expect(PAINEL).toMatch(/dry_run: !aplicar/);
    expect(PAINEL).toMatch(/window\.confirm\(/);
    const i = PAINEL.indexOf("window.confirm(");
    const fim = PAINEL.indexOf("if (!ok) return;", i);
    expect(fim, "a confirmação deixou de bloquear a escrita").toBeGreaterThan(i);
  });

  it("um número parcial vem marcado como PARCIAL", () => {
    expect(PAINEL).toMatch(/PARCIAL — \$\{a\.blocos_medidos\} de \$\{a\.blocos_total\} blocos/);
  });

  it("a varredura tem teto e pode ser parada", () => {
    expect(PAINEL).toMatch(/const TETO_CHAMADAS = 80;/);
    expect(PAINEL).toMatch(/parar\.current = true/);
  });

  it("o painel está na tela de votos", () => {
    expect(TELA).toMatch(/<EscritasMedidasPanel demoEnabled=\{demoEnabled\} \/>/);
  });
});

describe("etapa228 · a esteira lê o BLOCO B que já escreve", () => {
  it("os números de B.1/B.2/B.3/B.5 entram em etapas.redatar", () => {
    for (const k of ["maes_validadas", "filhos_desalinhados", "filhos_alinhados", "divergente_filhos_fora",
      "antt_portao_aprovado", "antt_portao_conferidas", "antt_divergentes", "antt_corrigidas",
      "reunioes_orfas_candidatas", "reunioes_orfas_removidas"]) {
      expect(RUN, k).toContain(`${k}:`);
    }
  });

  it("⚠️ o portão (objeto) vira NÚMEROS — objeto não atravessa agregarEtapas", () => {
    expect(RUN).toMatch(/antt_portao_aprovado: \(r\.body\?\.antt_portao as \{ aprovado\?: boolean \} \| null \| undefined\)\?\.aprovado \? 1 : 0,/);
  });

  it("natureza declarada: retrato é estoque, escrita é evento, janela é parcial", () => {
    for (const k of ["divergente_filhos_fora", "antt_portao_aprovado", "antt_portao_conferidas", "antt_divergentes", "reunioes_orfas_candidatas"]) {
      expect(naturezaDaChave(k), k).toBe("estoque");
    }
    for (const k of ["filhos_alinhados", "antt_corrigidas", "reunioes_orfas_removidas"]) expect(naturezaDaChave(k), k).toBe("evento");
    for (const k of ["maes_validadas", "filhos_desalinhados"]) expect(naturezaDaChave(k), k).toBe("parcial");
  });

  it("e o banner tem as linhas — com o aviso de que data corrigida NÃO refaz o voto", () => {
    expect(TELA).toMatch(/itens de ata alinhados à data da mãe/);
    expect(TELA).toMatch(/o voto deles só é refeito quando o revoto for ligado/);
    expect(TELA).toMatch(/o portão recusou/);
    expect(TELA).toMatch(/reuniões órfãs \(data impossível, zero deliberação\)/);
  });
});
