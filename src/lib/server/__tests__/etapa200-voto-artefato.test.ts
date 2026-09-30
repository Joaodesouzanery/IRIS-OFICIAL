/**
 * Etapa 200 (Fase 34, Bloco 3) — o voto que a FONTE não podia ter produzido.
 *
 * ═══ O caso, medido em nove reuniões da ANTT ═══
 * RDE 271, 272, 273, 274, 276, Extraordinária 99 e RD 1.028, 1.029, 1.030 (mar–abr/2026) têm, em
 * cada item de ata, **um voto só** — o do RELATOR, gravado como `is_nominal`.
 *
 * ⚠️ É impossível pela própria declaração do projeto: `CAPACIDADE_NOMINAL['ANTT|ata'] = 'nenhum'` —
 * *"a ata da ANTT registra a decisão do colegiado, nunca o voto de cada um"*. Uma fonte que não
 * nomina ninguém não pode ter produzido um voto nominal. O voto não é leitura: é ARTEFATO do defeito
 * que o `a4cd15f` consertou.
 *
 * ═══ Os DOIS bloqueios que impediam o reparo ═══
 *  1. `materializar-faltantes` só toca deliberação com ZERO voto — as nossas têm 1.
 *  2. E mesmo liberando, `isAnttAtaItem` exigia `raw.documento_antt_tipo`, que no passivo é NULO —
 *     era exatamente o campo perdido. O relator voltaria a ser lido como votante nominal, e o
 *     reparo refaria o defeito.
 * O (2) é o que torna o predicado por CAPACIDADE necessário: ele é uma afirmação sobre a FONTE, não
 * sobre o que a esteira gravou.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { votoNominalImpossivel, rastroDoApagamento } from "../voto-artefato";
import { capacidadeNominal } from "../colegiado-sources";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const MAT = semComentarios(ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts"));

const umNominal = [{ diretor_id: "alessandro", is_nominal: true }];

describe("etapa200 · ⚠️ o predicado é ESTREITO, e cada condição é necessária", () => {
  it("o retrato exato das nove: ANTT, item de ata, UM voto, nominal", () => {
    expect(votoNominalImpossivel({
      sigla: "ANTT", tipo_documento: "ata", tem_pai: true, votos: umNominal,
    })).toBe(true);
  });

  it("⚠️ fonte que NOMINA não entra — a ANM nomina parcialmente, e lá o voto pode ser leitura", () => {
    expect(capacidadeNominal("ANM", "ata")).toBe("parcial");
    expect(votoNominalImpossivel({
      sigla: "ANM", tipo_documento: "ata", tem_pai: true, votos: umNominal,
    })).toBe(false);
  });

  it("⚠️ com DOIS votos não entra — o padrão deixa de ser «o relator virou o colegiado»", () => {
    /**
     * Apagar voto por hipótese larga é o modo de falha mais caro que existe nesta base. Com dois ou
     * mais, pode ser qualquer outra coisa, e o reparo não tem o direito de adivinhar.
     */
    expect(votoNominalImpossivel({
      sigla: "ANTT", tipo_documento: "ata", tem_pai: true,
      votos: [...umNominal, { diretor_id: "lucas", is_nominal: true }],
    })).toBe(false);
  });

  it("⚠️ voto INFERIDO não é artefato — é leitura legítima do colegiado", () => {
    expect(votoNominalImpossivel({
      sigla: "ANTT", tipo_documento: "ata", tem_pai: true,
      votos: [{ diretor_id: "alessandro", is_nominal: false }],
    })).toBe(false);
  });

  it("a MÃE da ata não entra — só o ITEM tem voto a conferir", () => {
    expect(votoNominalImpossivel({
      sigla: "ANTT", tipo_documento: "ata", tem_pai: false, votos: umNominal,
    })).toBe(false);
  });

  it("⚠️ o VOTO INDIVIDUAL da ANTT não entra — lá a fonte nomina SEMPRE, e 1 voto é o desenho", () => {
    expect(capacidadeNominal("ANTT", "voto_individual")).toBe("sempre");
    expect(votoNominalImpossivel({
      sigla: "ANTT", tipo_documento: "voto_individual", tem_pai: true, votos: umNominal,
    })).toBe(false);
  });

  it("sigla desconhecida não entra — `capacidadeNominal` devolve «parcial», que não afirma limite", () => {
    expect(votoNominalImpossivel({
      sigla: null, tipo_documento: "ata", tem_pai: true, votos: umNominal,
    })).toBe(false);
    expect(votoNominalImpossivel({
      sigla: "XPTO", tipo_documento: "ata", tem_pai: true, votos: umNominal,
    })).toBe(false);
  });

  it("e a ARTESP entra pelo mesmo motivo — a ata dela também não nomina", () => {
    expect(capacidadeNominal("ARTESP", "ata")).toBe("nenhum");
    expect(votoNominalImpossivel({
      sigla: "ARTESP", tipo_documento: "ata", tem_pai: true, votos: umNominal,
    })).toBe(true);
  });
});

describe("etapa200 · o rastro, que é a condição do usuário", () => {
  it("uma linha por voto, com quem tinha o voto e por quê", () => {
    const r = rastroDoApagamento("delib-1", umNominal, "ANTT");
    expect(r).toEqual([{
      deliberacao_id: "delib-1", diretor_id: "alessandro", is_nominal: true,
      motivo: "fonte ANTT|ata nao nomina voto (CAPACIDADE_NOMINAL='nenhum')",
    }]);
  });

  it("⚠️⚠️ o RASTRO é gravado ANTES do apagamento — e a ordem é a regra, não estilo", () => {
    /**
     * Não há transação aqui. Apagando primeiro, uma falha da auditoria deixaria o voto sumido SEM
     * registro, que é exatamente o que o usuário proibiu: *"não apague os votos antigos sem rastro"*.
     * Gravando antes, a falha ABORTA o apagamento e nada se perde.
     */
    const iAudit = MAT.indexOf('db.from("votos_retroativos_audit").insert(');
    const iDelete = MAT.indexOf('db.from("votos").delete()');
    expect(iAudit).toBeGreaterThan(-1);
    expect(iDelete).toBeGreaterThan(iAudit);
    // E o apagamento só acontece se a auditoria CONFIRMOU a escrita.
    expect(MAT).toMatch(/const podeApagar = REPARAR_VOTO_ARTEFATO && !dryRun && paraApagar\.length > 0/);
    expect(MAT).toMatch(/&& await exigirEscrita\(/);
    expect(MAT).toMatch(/if \(podeApagar\) \{/);
  });

  it("⚠️ e o rastro que vai para a auditoria é o COMPLETO, não a amostra", () => {
    // A amostra é para a resposta HTTP; a auditoria precisa de todas as linhas ou não serve.
    expect(MAT).toMatch(/linhas: rastroCompleto,/);
    expect(MAT).toMatch(/artefato_amostra: amostraArtefato\.slice\(0, 10\)/);
  });
});

describe("etapa200 · os dois bloqueios que impediam o reparo", () => {
  it("⚠️ o passo roda ANTES de `semVotoTotal` — a liberada é refeita na MESMA rodada", () => {
    /**
     * ⚠️ CORREÇÃO (Fase 36, Bloco A): a âncora era `const semVotoTotal = finais.filter`. O modo
     * parcial TROCA a população (`completarParcial ? … : finais.filter(…)`), então o texto mudou
     * sem que a propriedade — o reparo vem ANTES do cálculo da população — mudasse.
     */
    const iPasso = MAT.indexOf("const candidatasArtefato");
    const iPop = MAT.indexOf("const semVotoTotal =");
    expect(iPasso).toBeGreaterThan(-1);
    expect(iPop).toBeGreaterThan(iPasso);
    // E o `finais.filter` continua sendo a população do modo normal.
    expect(MAT).toMatch(/: finais\.filter\(\(d: any\) => !comVoto\.has\(d\.id\)\)/);
    // E ela sai de `comVoto`, que é o conjunto do qual `semVotoTotal` é derivado.
    expect(MAT).toMatch(/comVoto\.delete\(alvo\.id\);/);
  });

  it("⚠️⚠️ o gate do item passa a sair da CAPACIDADE, não do campo que a esteira perdia", () => {
    /**
     * `documento_antt_tipo` está NULO no passivo — é exatamente o campo que faltava. Um gate que
     * dependesse dele daria `false` justamente nas linhas a reparar, e o relator voltaria a ser
     * votante nominal: o reparo refaria o defeito.
     */
    expect(MAT).toMatch(/const fonteNaoNomina = !fonteNominaVotos\(siglaDaDelib, "ata"\);/);
    expect(MAT).toMatch(/\(fonteNaoNomina && Boolean\(d\.documento_pai_id\)\)/);
  });

  it("os votos das candidatas vêm em LOTES — um `select` por linha é o N+1 da Fase 29", () => {
    expect(MAT).toMatch(/tabela: "votos", select: "deliberacao_id, diretor_id, is_nominal"/);
    expect(MAT).toMatch(/coluna: "deliberacao_id"/);
  });

  it("⚠️ e o número diz se a regra está ligada — senão «44 candidatos» seria lido como conserto", () => {
    expect(MAT).toMatch(/artefato_regra_ligada: REPARAR_VOTO_ARTEFATO/);
    expect(MAT).toMatch(/artefatos_candidatos: artefatosCandidatos/);
    expect(MAT).toMatch(/artefatos_apagados: artefatosApagados/);
  });
});
