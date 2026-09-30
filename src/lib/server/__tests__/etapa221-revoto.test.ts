/**
 * Etapa 221 (Fase 36, B.4) — o REVOTO, e as guardas sem as quais ele apaga o dado certo.
 *
 * ═══ ⚠️ UMA CORREÇÃO DO QUE EU PROPUS NO PLANO ═══
 * O plano dizia: marcador `{data_redatada_de, data_redatada_em}` em `raw_extraction`, gravado por quem
 * troca a data. O sinal DERIVADO — "existe voto de quem não está no roster da data atual" — é melhor
 * por dois motivos concretos:
 *
 *  1. O marcador exigiria MESCLAR um jsonb pesado em CINCO lugares (Janelas A, B, C, D e a
 *     reconciliação), e a Janela C lê o universo inteiro justamente evitando carregar
 *     `raw_extraction`. O custo cairia no lugar mais caro da rota.
 *  2. **Linha nunca carimbada nunca seria revotada.** As ~200 já propagadas em fases anteriores não
 *     têm marcador: ficariam invisíveis para sempre — o defeito que o marcador existia para evitar.
 *
 * ═══ A guarda que importa mais ═══
 * `getActiveDiretoresForVote` devolve `[]` em QUALQUER erro de leitura. Sem a recusa por roster vazio,
 * uma falha transitória do banco viraria apagamento em massa — com rastro de aparência perfeita,
 * porque o rastro registraria fielmente o que saiu e nada sobre o motivo real.
 *
 * ═══ E a guarda que inverte a leitura ═══
 * Nominal FORA do roster não é voto errado: é notícia sobre o MANDATO. Se o documento nomeia alguém
 * votando e o cadastro diz que ela não tinha mandato, o suspeito é o cadastro. Apagar ali destruiria
 * a evidência que corrige o mandato.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  REVOTO_LIGADO,
  decidirRevoto,
  rastroDoRevoto,
  type VotoParaRevoto,
} from "../revoto";

const V = (id: string, over: Partial<VotoParaRevoto> = {}): VotoParaRevoto => ({
  diretor_id: id,
  is_nominal: false,
  proveniencia: "inferido_decisao",
  tipo_voto: "Favoravel",
  motivo_nao_voto: null,
  ...over,
});
const NOMINAL = (id: string, over: Partial<VotoParaRevoto> = {}) =>
  V(id, { is_nominal: true, proveniencia: "nominal", ...over });
const HUMANO = (id: string) =>
  V(id, { is_nominal: false, proveniencia: "revisao_humana" });

describe("etapa221 · ⚠️ A GUARDA DO ROSTER VAZIO", () => {
  it("roster vazio é RECUSA, e o conjunto a apagar é VAZIO", () => {
    const d = decidirRevoto({ roster: [], votos: [V("a"), V("b"), V("c")] });
    expect(d.recusa).toBe("roster_vazio");
    expect(d.apagar, "roster vazio autorizou apagamento — é o modo de falha mais caro daqui").toEqual([]);
    expect(d.faltando).toEqual([]);
    expect(d.roster_suspeito).toEqual([]);
  });

  it("e a recusa vale mesmo sem voto nenhum — não é 'não havia o que apagar'", () => {
    const d = decidirRevoto({ roster: [], votos: [] });
    expect(d.recusa).toBe("roster_vazio");
  });
});

describe("etapa221 · o que sai, o que fica, e o que virou notícia sobre o mandato", () => {
  const roster = ["mauro", "fabio", "jose"];

  it("voto INFERIDO de quem não está no roster sai", () => {
    const d = decidirRevoto({ roster, votos: [V("mauro"), V("caio")] });
    expect(d.apagar).toEqual(["caio"]);
    expect(d.recusa).toBeNull();
  });

  it("⚠️ voto inferido DENTRO do roster NÃO sai — apagar e recriar daria a mesma linha", () => {
    const d = decidirRevoto({ roster, votos: [V("mauro"), V("fabio"), V("jose")] });
    expect(d.apagar).toEqual([]);
    expect(d.recusa, "nada fora do roster e ninguém faltando").toBe("nada_a_fazer");
  });

  it("⚠️ NOMINAL fora do roster vira `roster_suspeito`, nunca apagamento", () => {
    // O documento nomeia alguém votando e o cadastro diz que ela não tinha mandato: o suspeito é o
    // cadastro. Apagar destruiria a evidência que corrige o mandato.
    const d = decidirRevoto({ roster, votos: [NOMINAL("caio"), V("tasso")] });
    expect(d.roster_suspeito).toEqual(["caio"]);
    expect(d.apagar).toEqual(["tasso"]);
  });

  it("⚠️ `revisao_humana` com is_nominal=false conta como NOMINAL — é a fonte única", () => {
    // Lido por `is_nominal` cru, este voto seria apagado. É a lição da Fase 21 (11 leitores).
    const d = decidirRevoto({ roster, votos: [HUMANO("caio")] });
    expect(d.apagar, "voto corrigido por uma pessoa foi tratado como inferido").toEqual([]);
    expect(d.roster_suspeito).toEqual(["caio"]);
  });

  it("nominal DENTRO do roster fica preservado", () => {
    const d = decidirRevoto({ roster, votos: [NOMINAL("mauro"), V("caio")] });
    expect(d.preservados).toEqual(["mauro"]);
    expect(d.apagar).toEqual(["caio"]);
  });
});

describe("etapa221 · `faltando` é o que mantém a deliberação viva depois do apagamento", () => {
  const roster = ["mauro", "fabio", "jose"];

  it("quem do roster não tem voto entra em `faltando`", () => {
    const d = decidirRevoto({ roster, votos: [V("mauro"), V("caio")] });
    // Caio sai; Mauro tem voto (inferido, dentro do roster, fica); Fábio e José nunca tiveram.
    expect(d.faltando.sort()).toEqual(["fabio", "jose"]);
  });

  it("⚠️ com um NOMINAL sobrando, a linha continua em `comVoto` — e `faltando` é como ela é alcançada", () => {
    // O materializador só visita quem tem ZERO voto. Sobrando um nominal, a deliberação nunca seria
    // refeita, e quem falta ficaria faltando para sempre.
    const d = decidirRevoto({ roster, votos: [NOMINAL("mauro"), V("caio")] });
    expect(d.preservados).toEqual(["mauro"]);
    expect(d.faltando.sort()).toEqual(["fabio", "jose"]);
    expect(d.recusa).toBeNull();
  });

  it("roster inteiro com voto e nada fora dele = nada a fazer", () => {
    const d = decidirRevoto({ roster, votos: roster.map((id) => NOMINAL(id)) });
    expect(d.recusa).toBe("nada_a_fazer");
    expect(d.faltando).toEqual([]);
  });

  it("⚠️ deliberação SEM voto nenhum: falta o roster inteiro, e isso não é 'nada a fazer'", () => {
    const d = decidirRevoto({ roster, votos: [] });
    expect(d.apagar).toEqual([]);
    expect(d.faltando.sort()).toEqual(["fabio", "jose", "mauro"]);
    expect(d.recusa).toBeNull();
  });
});

describe("etapa221 · o RASTRO, que é o que o usuário exigiu", () => {
  const votos = [V("caio"), NOMINAL("mauro"), V("tasso")];

  it("registra QUEM tinha o voto e QUAL era, só dos apagados", () => {
    const r = rastroDoRevoto({
      deliberacaoId: "d1", votos, apagar: ["caio", "tasso"],
      dataDaDeliberacao: "2026-01-28", agora: "2026-09-30T12:00:00.000Z",
    });
    expect(r.map((x) => x.diretor_id).sort()).toEqual(["caio", "tasso"]);
    expect(r[0].tipo_voto).toBe("Favoravel");
    expect(r[0].data_da_deliberacao).toBe("2026-01-28");
    expect(r[0].revotado_em).toBe("2026-09-30T12:00:00.000Z");
    expect(r[0].motivo).toMatch(/nao esta no roster/);
  });

  it("⚠️ quem NÃO foi apagado não entra no rastro — rastro é do que saiu", () => {
    const r = rastroDoRevoto({
      deliberacaoId: "d1", votos, apagar: ["caio"],
      dataDaDeliberacao: null, agora: "2026-09-30T12:00:00.000Z",
    });
    expect(r.length).toBe(1);
    expect(r[0].diretor_id).toBe("caio");
  });

  it("preserva o `motivo_nao_voto` da linha removida — senão a ausência perde a causa", () => {
    const ausente = V("caio", { tipo_voto: "Ausente", motivo_nao_voto: "ausencia" });
    const r = rastroDoRevoto({
      deliberacaoId: "d1", votos: [ausente], apagar: ["caio"],
      dataDaDeliberacao: "2026-01-28", agora: "2026-09-30T12:00:00.000Z",
    });
    expect(r[0].tipo_voto).toBe("Ausente");
    expect(r[0].motivo_nao_voto).toBe("ausencia");
  });

  it("lista vazia quando nada foi apagado", () => {
    expect(rastroDoRevoto({
      deliberacaoId: "d1", votos, apagar: [], dataDaDeliberacao: null, agora: "x",
    })).toEqual([]);
  });
});

describe("etapa221 · a escrita nasce DESLIGADA", () => {
  it("a constante é false", () => {
    expect(REVOTO_LIGADO).toBe(false);
  });
});

describe("etapa221 · o modo no materializador: exclusivo, auditado antes de apagar", () => {
  const MAT = readFileSync(
    join(__dirname, "../../../..", "src/app/api/v1/admin/votos/materializar-faltantes/route.ts"),
    "utf-8",
  ).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

  it("é EXCLUSIVO e troca a população — como adendo, `restantes` nunca drenaria", () => {
    expect(MAT).toMatch(/const modoRevoto = body\.revoto === true;/);
    expect(MAT).toMatch(/const semVotoTotal = modoRevoto/);
  });

  it("⚠️ nem o reparo de artefato nem o carimbo de diagnóstico rodam no revoto", () => {
    expect(MAT).toMatch(/if \(!completarParcial && !modoRevoto\) \{/);
    expect(MAT).toMatch(/completarParcial \|\| modoRevoto \? \[\] : semVoto/);
    expect(MAT).toMatch(/completarParcial \|\| modoRevoto \? \[\] : loteBruto/);
    expect(MAT).toMatch(/!dryRun && !completarParcial && !modoRevoto && patchPorDeliberacao\.size > 0/);
  });

  it("⚠️ o roster do revoto é o de MANDATO, não o de presentes", () => {
    // "Esta pessoa PODIA votar nesta data?" é mandato. Presença responde outra pergunta.
    expect(MAT).toMatch(/roster: rosterDeMandato\.map\(\(x\) => x\.id\)/);
  });

  it("⚠️ a AUDITORIA vem antes do apagamento, e sem ela nada é apagado", () => {
    const iAudit = MAT.indexOf('from("votos_retroativos_audit").insert({\n          nome_detectado: "(revoto');
    const iDelete = MAT.indexOf('revoto: voto inferido de ');
    expect(iAudit, "a auditoria do revoto desapareceu").toBeGreaterThan(-1);
    expect(iDelete).toBeGreaterThan(iAudit);
    expect(MAT).toMatch(/if \(!auditado\) continue;/);
  });

  it("apaga POR PAR, nunca a deliberação inteira", () => {
    expect(MAT).toMatch(/db\.from\("votos"\)\.delete\(\)\.eq\("deliberacao_id", d\.id\)\.eq\("diretor_id", diretorId\)/);
  });

  it("a constante e o dry_run guardam a escrita, e o rastro é montado de todo jeito", () => {
    expect(MAT).toMatch(/if \(!REVOTO_LIGADO \|\| dryRun \|\| decisao\.apagar\.length === 0\) continue;/);
    const iRastro = MAT.indexOf("revotoRastro.push(...rastroDoRevoto({");
    const iPortao = MAT.indexOf("if (!REVOTO_LIGADO || dryRun || decisao.apagar.length === 0) continue;");
    expect(iRastro, "o rastro passou a ser montado só quando escreve — e é ele que se confere antes")
      .toBeLessThan(iPortao);
  });

  it("⚠️ a leitura de votos traz `proveniencia` — sem ela `revisao_humana` seria apagado", () => {
    expect(MAT).toMatch(/\.select\("deliberacao_id, diretor_id, is_nominal, proveniencia, tipo_voto, motivo_nao_voto"\)/);
  });

  it("os números saem com o estado da constante ao lado", () => {
    expect(MAT).toMatch(/revoto_ligado: REVOTO_LIGADO/);
    expect(MAT).toMatch(/revoto_apagariam: revotoApagariam/);
    expect(MAT).toMatch(/revoto_apagados: revotoApagados/);
    expect(MAT).toMatch(/revoto_roster_suspeito: revotoRosterSuspeito/);
    expect(MAT).toMatch(/revoto_faltando: revotoFaltando/);
  });
});
