/**
 * Etapa 215 (Fase 36, Bloco C) — o portão que impede o revoto de virar PERDA de voto, e o carimbo
 * que eu quase "consertei" com um no-op.
 *
 * ═══ ① O portão ═══
 * `conferirRoster` tem uma camada 3: se a agência tem `diretor_candidatos` pendente, TODO item MUDO
 * dela é recusado como `cadastro_incompleto` — mesmo que ESTA ata não nomeie ninguém. Num revoto isso
 * é **perda líquida**: a deliberação perde os votos inferidos da data errada e o materializador se
 * recusa a reconstruir. O desenho adversarial estimou ~340 votos na ANM.
 *
 * O número existia agregado dentro de `roster_nao_conferivel`, que junta QUATRO causas muito
 * diferentes. Agora sai separado, por agência e **com os nomes a resolver** — porque "a ANM está
 * bloqueada" sem dizer por quem é uma frase que não gera ação.
 *
 * ═══ ② O carimbo, e por que o conserto óbvio é um NO-OP ═══
 * `semVoto` é calculado ANTES do laço, e a deliberação que acabou de receber voto **continua nele**.
 * O laço final carimbava `materializavel_nao_processado` em todo `semVoto` sem motivo — ou seja, o
 * carimbo de "sem voto" era escrito na MESMA rodada em que o voto nasceu, e depois o item alternava
 * entre a causa real e o efêmero a cada rodada.
 *
 * ⚠️ E limpar o carimbo ANTES de `patchPorDeliberacao` ser montado não funciona: ele é montado a
 * partir de `motivoPorDeliberacao`, então o efêmero sobrescreveria a limpeza. A ordem é a correção.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { naturezaDaChave } from "@/lib/server/agregar-rodadas";
import { resumirBackfill, CHAVES_NUMERICAS_DO_MATERIALIZADOR } from "@/lib/server/resumo-do-backfill";
import { conferirRoster } from "@/lib/server/roster-conferivel";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const M = semComentarios(ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts"));

describe("etapa215 · ⚠️ o portão: UM candidato pendente recusa a agência inteira", () => {
  it("a camada 3 é real — ata muda + candidato pendente = `cadastro_incompleto`", () => {
    const roster = [{ id: "a", nome: "Mauro", nome_variantes: [] }];
    expect(conferirRoster({ roster, candidatosPendentes: 1 })).toEqual({
      confiavel: false, motivo: "cadastro_incompleto", naoReconhecidos: [],
    });
  });

  it("e sem candidato pendente a MESMA ata muda passa — é o candidato que bloqueia, não a ata", () => {
    const roster = [{ id: "a", nome: "Mauro", nome_variantes: [] }];
    expect(conferirRoster({ roster, candidatosPendentes: 0 }).confiavel).toBe(true);
  });

  it("⚠️ a ata que NOMEIA presentes não é bloqueada pelo candidato — a camada 1 vem antes", () => {
    // Importa para o diagnóstico: se fosse bloqueada, o número misturaria duas populações e o
    // operador não saberia se resolver o candidato adianta.
    const roster = [{ id: "a", nome: "Mauro Henrique Moreira Sousa", nome_variantes: ["Mauro Sousa"] }];
    const v = conferirRoster({ roster, nomesPresentes: ["Mauro Sousa"], candidatosPendentes: 5 });
    expect(v.confiavel).toBe(true);
    expect(v.motivo).toBe("roster_confere_com_presenca");
  });
});

describe("etapa215 · o número sai por AGÊNCIA e com os NOMES", () => {
  it("a rota publica a quebra por motivo e por agência", () => {
    expect(M).toMatch(/roster_por_motivo: rosterPorMotivo/);
    expect(M).toMatch(/bloqueados_por_cadastro_por_agencia: bloqueadosPorCadastroPorAgencia/);
    expect(M).toMatch(/candidatos_pendentes_por_agencia: candidatosPendentesPorAgencia/);
  });

  it("⚠️ só o motivo `cadastro_incompleto` alimenta a quebra — os outros três não pedem ação sua", () => {
    const i = M.indexOf('vereditoRoster.motivo === "cadastro_incompleto"');
    expect(i, "a quebra deixou de ser condicionada ao motivo").toBeGreaterThan(-1);
  });

  it("a string por agência CARREGA OS NOMES, senão o número não gera ação", () => {
    const r = resumirBackfill({
      bloqueados_por_cadastro_incompleto: 27,
      bloqueados_por_cadastro_por_agencia: { ANTT: 27 },
      candidatos_pendentes_por_agencia: { ANTT: ["Fulano de Tal", "Sicrano Silva"] },
    });
    expect(r.bloqueados_por_cadastro_incompleto).toBe(27);
    expect(String(r.bloqueio_por_cadastro)).toContain("ANTT 27");
    expect(String(r.bloqueio_por_cadastro), "sem os nomes, ninguém sabe o que aprovar")
      .toContain("Fulano de Tal");
  });

  it("⚠️ a quebra viaja como STRING — `agregarEtapas` descarta objeto em silêncio", () => {
    const r = resumirBackfill({
      bloqueados_por_cadastro_por_agencia: { ANM: 3 },
      candidatos_pendentes_por_agencia: { ANM: ["X"] },
    });
    expect(typeof r.bloqueio_por_cadastro).toBe("string");
  });

  it("sem bloqueio, a chave da string nem aparece — zero não vira linha na tela", () => {
    const r = resumirBackfill({ bloqueados_por_cadastro_por_agencia: {} });
    expect("bloqueio_por_cadastro" in r).toBe(false);
    expect(r.bloqueados_por_cadastro_incompleto).toBe(0);
  });

  it("a chave numérica tem leitor e natureza PARCIAL, como o irmão do mesmo laço", () => {
    expect([...CHAVES_NUMERICAS_DO_MATERIALIZADOR]).toContain("bloqueados_por_cadastro_incompleto");
    expect(naturezaDaChave("bloqueados_por_cadastro_incompleto"))
      .toBe(naturezaDaChave("roster_nao_conferivel"));
    expect(semComentarios(ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx")))
      .toMatch(/totais\.bloqueados_por_cadastro_incompleto/);
  });
});

describe("etapa215 · ⚠️ o carimbo não é escrito na mesma rodada em que o voto nasce", () => {
  it("o ramo de SUCESSO do upsert registra a deliberação como votada", () => {
    const i = M.indexOf("votosCriados += rows.length;\n        votadasNestaRodada.add");
    expect(i, "o registro saiu do ramo de sucesso").toBeGreaterThan(-1);
  });

  it("⚠️ e o ramo de FALHA do upsert NÃO registra — senão a escrita que falhou some do diagnóstico", () => {
    /**
     * Esta expectativa existe porque a mutação que a exige SOBREVIVEU ao teste anterior: conferir
     * que o sucesso registra não diz nada sobre a falha. Se a falha registrasse, a deliberação teria
     * o carimbo LIMPO e seria pulada pelo laço final — uma escrita que falhou viraria indistinguível
     * de uma que deu certo, que é exatamente o formato de zero que `upsert_falhas` existe para
     * denunciar.
     */
    const iFalha = M.indexOf("upsertFalhas++;");
    expect(iFalha, "o contador de falha de upsert desapareceu").toBeGreaterThan(-1);
    const fimDoRamo = M.indexOf("} else {", iFalha);
    expect(fimDoRamo).toBeGreaterThan(iFalha);
    expect(M.slice(iFalha, fimDoRamo), "o ramo de falha passou a registrar a deliberação como votada")
      .not.toMatch(/votadasNestaRodada\.add/);
  });

  it("o laço final PULA quem votou nesta rodada", () => {
    expect(M).toMatch(/if \(votadasNestaRodada\.has\(String\(d\.id\)\)\) continue;/);
  });

  it("⚠️ a limpeza vem DEPOIS de `patchPorDeliberacao` ser montado — antes, seria NO-OP", () => {
    /**
     * `patchPorDeliberacao` nasce de `motivoPorDeliberacao`. Um `set(id, {motivo_sem_voto: null})`
     * feito antes desse ponto é sobrescrito pelo motivo efêmero na linha seguinte. A ORDEM é o
     * conserto; sem ela o código parece certo e não faz nada.
     */
    const iMonta = M.indexOf("for (const [id, motivo] of motivoPorDeliberacao)");
    const iLimpa = M.indexOf("for (const id of carimboASair)");
    expect(iMonta, "a montagem do patch sumiu").toBeGreaterThan(-1);
    expect(iLimpa, "a limpeza do carimbo sumiu").toBeGreaterThan(-1);
    expect(iLimpa, "a limpeza voltou para ANTES da montagem: vira no-op").toBeGreaterThan(iMonta);
  });

  it("⚠️ só limpa quem TINHA carimbo — senão toda votada gera escrita à toa", () => {
    // `patchJaAplicado` compara por JSON canônico, e `undefined` não é igual a `null`: sem esta
    // guarda, cada deliberação votada consumiria a reserva de 400 ms para apagar o que não existe.
    expect(M).toMatch(/motivo_sem_voto === "string"[\s\S]{0,80}carimboASair\.add/);
  });

  it("e a limpeza é `null`, não remoção — a gravação MESCLA o jsonb", () => {
    // `{...raw, ...patch}`: uma chave `undefined` sumiria do patch e não apagaria nada.
    expect(M).toMatch(/carimboASair\)[\s\S]{0,160}motivo_sem_voto: null/);
  });
});
