/**
 * Etapa 70 (Fase 9) — a data vinha da lei citada no preâmbulo.
 *
 * ═══ O que produção mostrou ═══
 * 38 deliberações da ANM com data ANTERIOR à criação da agência (Lei 13.575/2017): 1996 (32 delas,
 * numa única "reunião"), 2003 (3), 2013 (1), 2016 (2). Os anos batem, um a um, com LEIS citadas no
 * preâmbulo dos próprios atos — 1996 é a Lei 9.314, "de 14 de novembro de 1996".
 *
 * ═══ A cadeia, com três defeitos empilhados ═══
 * 1. `extractAnmMeetingMetadata` tinha, como último recurso, a PRIMEIRA data em extenso de 8.000
 *    caracteres, SEM âncora. Num ato da ANM isso é sempre a citação legal.
 * 2. `upload-analysis` sobrescrevia INCONDICIONALMENTE uma data já lida com âncora de contexto —
 *    as duas linhas vizinhas usam `&& !fields.x`, essa não usava.
 * 3. O confirm propaga a data do documento PAI para cada filho da ata: um parse errado vira N
 *    deliberações erradas. Daí "1996: 32 deliberações, 1 reunião".
 *
 * ═══ Por que BLOQUEAR e não anular ═══
 * `year-filter` conta deliberação sem data em TODOS os anos. Anular converteria um erro contido
 * (38 linhas silenciosamente fora de 2026) num erro espalhado (38 linhas inflando todo ano).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { dataReuniaoPlausivel, ANO_CRIACAO_AGENCIA } from "@/lib/server/colegiado-sources";
import { extractAnmMeetingMetadata } from "@/lib/server/regulatory-documents";
import { INFO_WARNING_RE } from "@/lib/server/upload-analysis";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

describe("etapa70 · o fallback sem âncora morreu", () => {
  it("o preâmbulo com a Lei 9.314/1996 NÃO vira mais data de reunião", () => {
    // É literalmente o caso das 32 deliberações de 1996.
    const preambulo =
      "AGÊNCIA NACIONAL DE MINERAÇÃO\nO DIRETOR-GERAL, no uso das atribuições que lhe confere a " +
      "Lei nº 13.575, de 26 de dezembro de 2017, e a Lei nº 9.314, de 14 de novembro de 1996, " +
      "resolve aprovar os itens da pauta.";
    expect(extractAnmMeetingMetadata(preambulo, "ata.pdf").data_reuniao).toBeNull();
  });

  it("mas a data ANCORADA continua sendo lida", () => {
    // O parser só age em documento com contexto ANM (o guard no topo da função) — por isso o
    // texto precisa trazer a agência, como o documento real traz.
    const comAncora = "AGÊNCIA NACIONAL DE MINERAÇÃO\nATA DA 85ª ROP\nrealizada em 16 de julho de 2026.";
    expect(extractAnmMeetingMetadata(comAncora, "ata.pdf").data_reuniao).toBe("2026-07-16");
  });

  it("o guard de contexto ANM continua valendo — documento de outra agência não entra aqui", () => {
    expect(extractAnmMeetingMetadata("realizada em 16 de julho de 2026", "x.pdf")).toEqual({});
  });

  it("o regex sem âncora não existe mais no arquivo", () => {
    const fonte = ler("src/lib/server/regulatory-documents.ts");
    const bloco = fonte.slice(fonte.indexOf("const dataExtenso = parseDataExtensoANM(head)"));
    const ateOReturn = bloco.slice(0, bloco.indexOf("return {"));
    // Deve restar UM regex de data, o ancorado (`data:`/`realizada em`/`dia`).
    expect((ateOReturn.match(/de\\\\s\+\(\[a-zçãéêíóôõú\]\+\)/g) ?? []).length).toBeLessThanOrEqual(1);
    expect(ateOReturn).toMatch(/data\|realizada\?\\s\+em\|dia/);
  });

  it("a sobrescrita incondicional virou condicional", () => {
    const fonte = ler("src/lib/server/upload-analysis.ts");
    expect(fonte).toMatch(/if \(anmMeta\.data_reuniao && !fields\.data_reuniao\)/);
    expect(fonte).not.toMatch(/if \(anmMeta\.data_reuniao\) fields\.data_reuniao/);
  });
});

describe("etapa70 · o guard conhece a agência", () => {
  it("reprova reunião da ANM anterior a 2017", () => {
    const r = dataReuniaoPlausivel("ANM", "1996-11-14");
    expect(r.plausivel).toBe(false);
    if (!r.plausivel) expect(r.motivo).toContain("2017");
  });

  it("aceita a MESMA data para uma agência que já existia", () => {
    // 1996 é impossível para a ANM (2017) e para a ANTT (2001) — mas o motivo tem de ser o ano de
    // criação de CADA uma, não um piso genérico. É o que o aviso antigo (piso fixo 2020) não fazia.
    expect(dataReuniaoPlausivel("ANM", "2018-03-01").plausivel).toBe(true);
    expect(dataReuniaoPlausivel("ANTT", "2018-03-01").plausivel).toBe(true);
    expect(dataReuniaoPlausivel("ANTT", "1999-03-01").plausivel).toBe(false);
  });

  it("as três colegiadas estão cadastradas", () => {
    for (const s of ["ANTT", "ANM", "ARTESP"]) {
      expect(ANO_CRIACAO_AGENCIA[s], `${s} sem ano de criação`).toBeGreaterThan(1990);
    }
  });

  it("é CONSERVADOR: sigla desconhecida, data ausente e formato inválido não reprovam", () => {
    // Nunca bloquear por falta de cadastro — seria transformar uma lacuna nossa em erro do dado.
    expect(dataReuniaoPlausivel("ANEEL", "1996-01-01").plausivel).toBe(true);
    expect(dataReuniaoPlausivel("ANM", null).plausivel).toBe(true);
    expect(dataReuniaoPlausivel(null, "1996-01-01").plausivel).toBe(true);
    expect(dataReuniaoPlausivel("ANM", "sem-data").plausivel).toBe(true);
  });

  it("data no futuro também é parse errado", () => {
    const agora = new Date("2026-08-26T12:00:00Z");
    expect(dataReuniaoPlausivel("ANTT", "2029-01-01", agora).plausivel).toBe(false);
    // …mas o ano seguinte passa: calendário publicado com antecedência é legítimo.
    expect(dataReuniaoPlausivel("ANTT", "2027-01-01", agora).plausivel).toBe(true);
  });
});

describe("etapa70 · o guard está ligado nos DOIS gates", () => {
  it("é achado BLOQUEANTE na análise — não anula o campo", () => {
    // Anular destruiria a evidência de que o revisor precisa e converteria "data errada" em "sem
    // data", que `year-filter` conta em TODOS os anos.
    const fonte = ler("src/lib/server/upload-analysis.ts");
    expect(fonte).toMatch(/C20_DATA_FORA_DA_EXISTENCIA_DA_AGENCIA/);
    expect(fonte).toMatch(/nivel: "bloqueante" as const/);
    expect(fonte).toMatch(/dataReuniaoPlausivel\(agencia_sigla_detected, fields\.data_reuniao\)/);
  });

  it("e é CINTO no confirm — o gargalo único de escrita", () => {
    const fonte = ler("src/app/api/v1/upload/confirm/route.ts");
    expect(fonte).toMatch(/C20_DATA_FORA_DA_EXISTENCIA_DA_AGENCIA/);
    // A CHAMADA, não só a presença do código: a primeira versão deste teste passava com o guard
    // trocado por uma constante `{ plausivel: true }` — o achado ficava no arquivo e nunca disparava.
    expect(fonte).toMatch(/dataReuniaoPlausivel\(sigla, d\.data_reuniao \?\? null\)/);
    expect(fonte).toMatch(/siglaPorId\.get\(effectiveAgenciaId\)/);
  });

  it("o aviso morto de piso fixo 2020 foi REMOVIDO, não deixado ao lado", () => {
    // Dois sinais sobre a mesma coisa, um inerte, é o padrão que o projeto já combateu.
    const fonte = ler("src/lib/server/upload-analysis.ts");
    expect(fonte).not.toMatch(/Data da reunião implausível \(\$\{fields\.data_reuniao\}\)/);
    expect(fonte).not.toMatch(/Date\.parse\("2020-01-01"\)/);
  });

  it("a mensagem não pode casar INFO_WARNING_RE — senão vira aviso informativo", () => {
    const msg = "Data da reunião (1996-11-14) incompatível: a ANM foi criada em 2017; uma reunião datada de 1996 não existe — a data provavelmente veio de uma lei ou processo citado no texto.";
    expect(INFO_WARNING_RE.test(msg)).toBe(false);
  });
});
