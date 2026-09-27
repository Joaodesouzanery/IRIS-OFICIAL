/**
 * Etapa 192 (Fase 33, Bloco C) — as nove reuniões da ANTT com "1 de 5", e o campo que a esteira
 * perdia no caminho.
 *
 * ═══ O que a produção mostrou ═══
 * Nove reuniões de mar–abr/2026 (RDE 271, 272, 273, 274, 276; Extraordinária 99; RD 1.028, 1.029,
 * 1.030) tinham UM diretor com voto de cinco. A consulta sobre o banco mostrou, em TODAS elas,
 * `tipo_documento='ata'` com `documento_pai_id` apontando para a ata-mãe, `votos: 1`,
 * `votos_nominais: 1` — e o único votante é a pessoa da coluna `relator`.
 *
 * ⚠️ Minha primeira hipótese era outra: que não fossem reuniões, e sim documentos de VOTO
 * INDIVIDUAL contados como reunião. Eu mesmo escrevi o critério de refutação — *"mostrar, para
 * algum dos nove, um filho de ata com `resultado` preenchido e 1 só voto"* — e a consulta mostrou
 * exatamente isso. Hipótese refutada pela medição; a causa real é pior.
 *
 * ═══ A cadeia, cada elo medido no fonte ═══
 *  1. `analyzeUploadPdf` devolve `documento_antt_tipo` e `documento_subtipo` como IRMÃOS de
 *     `fields`, não dentro dele. `previewToJson` faz `...analysis`, então ficam no TOPO do preview.
 *  2. `buildConfirmDelibFromDoc` — o payload da ESTEIRA — espalha só `preview.fields` e copia à mão
 *     `ata_items`, `import_counts_as_final`, `extraction_raw`, `tipo_documento`. Esqueceu os dois.
 *  3. Sem o campo, `isAnttAtaItem` é `false`, e o item vai com `nomes: itemVotingNames` em vez de
 *     `[]`. Numa ata da ANTT esse array é o RELATOR (`CAPACIDADE_NOMINAL['ANTT|ata'] = 'nenhum'`:
 *     a ata da ANTT não nomina voto por diretor).
 *  4. `buildVotoRows` casa um nome ⇒ 1 voto `is_nominal=true`. E `hasNominalNames === true` faz
 *     `shouldInferVotesFromMandate` devolver `false` ⇒ os outros quatro nunca entram.
 *
 * ⚠️ E foi INVISÍVEL porque `internalAnttDocumentPrefix` tinha o fallback para o `extraction_raw`:
 * a chave saía perfeita (`ATA-271-1.4.4`) e nada parecia errado. O upload manual manda os dois
 * campos, então o corpus certificado passava pelo caminho que funciona — caminho certificado ≠
 * caminho de produção, a mesma lição que a Fase 28 já tinha dado com o worker do pdf-parse.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildConfirmDelibFromDoc } from "../auto-confirm";
import { buildVotoRows, shouldInferVotesFromMandate } from "../vote-inference";
import { fonteNominaVotos, capacidadeNominal } from "../colegiado-sources";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

/** Os cinco nomes do preâmbulo das atas da ANTT, como o `gabarito.json` os trava. */
const DIRETORES_ANTT = [
  { id: "guilherme", nome: "Guilherme Sampaio", nome_variantes: [], agencia_id: "antt" },
  { id: "felipe", nome: "Felipe Queiroz", nome_variantes: [], agencia_id: "antt" },
  { id: "lucas", nome: "Lucas Asfor", nome_variantes: [], agencia_id: "antt" },
  { id: "alex", nome: "Alex Azevedo", nome_variantes: [], agencia_id: "antt" },
  { id: "severino", nome: "Severino Medeiros", nome_variantes: [], agencia_id: "antt" },
];

/**
 * ⚠️ O relator que o banco mostra e o gabarito não tem.
 *
 * Nas nove reuniões, o votante único mais frequente é `Alessandro Baumgartner`, que NÃO está entre
 * os cinco do preâmbulo. Ele existir em `diretores` é o que o dado PROVA: a linha do voto tem
 * `diretor_id`, logo o nome casou com alguém do cadastro. Se ele está ou não na janela de mandato da
 * data, o dado não diz — e é a pergunta que ficou para o usuário decidir.
 *
 * Aqui ele entra no CADASTRO (`diretoresList`, que é o que casa nome) e fica FORA da janela
 * (`activeDiretoresList`, que é o que a inferência usa). É a combinação que reproduz o retrato do
 * banco, e ela expõe um segundo achado, medido no teste abaixo.
 */
const CADASTRO_ANTT = [
  ...DIRETORES_ANTT,
  { id: "alessandro", nome: "Alessandro Baumgartner", nome_variantes: [], agencia_id: "antt" },
];

/**
 * O documento como a ESTEIRA o guarda: o tipo da ANTT no TOPO do preview e dentro do
 * `extraction_raw`, JAMAIS dentro de `fields`. É a forma que `previewToJson` produz.
 */
function docDaEsteira(o: { anttTipo?: string; soNoRaw?: boolean } = {}) {
  const anttTipo = o.anttTipo ?? "ata";
  return {
    id: "doc-271",
    agencia_id: "antt",
    tipo_documento: "ata",
    extraction_confidence: 0.9,
    campos_detectados: {
      preview: {
        filename: "ata-271-rde.pdf",
        // ⚠️ `fields` NÃO tem o campo. É o ponto todo.
        fields: {
          tipo_documento: "ata",
          numero_reuniao: "271",
          data_reuniao: "2026-03-09",
          relator: "Alessandro Baumgartner",
          nomes_votacao: [],
        },
        ...(o.soNoRaw ? {} : { documento_antt_tipo: anttTipo, documento_subtipo: anttTipo }),
        extraction_raw: { documento_antt_tipo: anttTipo, documento_subtipo: anttTipo },
      },
    },
  } as unknown as Parameters<typeof buildConfirmDelibFromDoc>[0];
}

describe("etapa192 · ⚠️ o payload da esteira carrega o tipo da ANTT", () => {
  it("do TOPO do preview — onde `previewToJson` o deixa", () => {
    const p = buildConfirmDelibFromDoc(docDaEsteira());
    expect(p.documento_antt_tipo).toBe("ata");
    expect(p.documento_subtipo).toBe("ata");
  });

  it("⚠️ e do `extraction_raw` quando é só lá que ele está", () => {
    // É de onde o `internalAnttDocumentPrefix` já o lia — por isso a CHAVE saía certa.
    const p = buildConfirmDelibFromDoc(docDaEsteira({ soNoRaw: true }));
    expect(p.documento_antt_tipo).toBe("ata");
  });

  it("para pauta e RDE também, não só para ata", () => {
    for (const t of ["pauta", "reuniao_deliberativa_eletronica", "reuniao_extraordinaria", "reuniao_diretoria_publica"]) {
      expect(buildConfirmDelibFromDoc(docDaEsteira({ anttTipo: t })).documento_antt_tipo, t).toBe(t);
    }
  });

  it("documento que NÃO é da ANTT segue sem o campo — nada é inventado", () => {
    const doc = {
      id: "d", agencia_id: "anm", tipo_documento: "ata",
      campos_detectados: { preview: { fields: { tipo_documento: "ata" }, extraction_raw: {} } },
    } as unknown as Parameters<typeof buildConfirmDelibFromDoc>[0];
    expect(buildConfirmDelibFromDoc(doc).documento_antt_tipo).toBeNull();
    expect(buildConfirmDelibFromDoc(doc).documento_subtipo).toBeNull();
  });

  it("⚠️ e os campos NÃO estão em `fields` — se um dia entrarem, este teste avisa", () => {
    /**
     * A expectativa parece redundante com as de cima, mas é ela que amarra o DIAGNÓSTICO: se
     * `upload-analysis` passar a pôr os dois dentro de `fields`, o `...fields` já os carregaria e o
     * código explícito viraria redundância — e alguém o removeria sem saber que era o conserto.
     */
    const ANALISE = semComentarios(ler("src/lib/server/upload-analysis.ts"));
    const i = ANALISE.indexOf("    fields: {", ANALISE.indexOf("  return {"));
    const fimFields = ANALISE.indexOf("\n    confidence,", i);
    const blocoFields = ANALISE.slice(i, fimFields);
    expect(blocoFields).not.toMatch(/documento_antt_tipo/);
    // E eles existem, como irmãos, atrás do gate `antt.isAntt`.
    expect(ANALISE).toMatch(/\.\.\.\(antt\.isAntt \? \{ documento_antt_tipo: antt\.documentType/);
  });
});

describe("etapa192 · ⚠️ e é por isso que quatro votos de cinco se perdiam", () => {
  /**
   * Os argumentos do item de ata, ESPELHANDO `confirm/route.ts`.
   *
   * ⚠️ Correção de um erro meu ao escrever este arquivo: a primeira versão passava
   * `inferFromMandate: true` nos DOIS ramos e falhou, devolvendo 5 votos onde eu esperava 1. Estava
   * certo em falhar — na rota o `inferFromMandate` é CALCULADO por ramo, e é justamente o ramo
   * não-ANTT que consulta `shouldInferVotesFromMandate`, que por sua vez recusa por causa do nome
   * nominal. Testar com o valor fixo media um caminho que a rota não tem, e escondia o segundo elo
   * da cadeia — que é onde os quatro votos morrem.
   */
  function votarItem(isAnttAtaItem: boolean) {
    const itemVotingNames = ["Alessandro Baumgartner"]; // o relator, e é só ele que a ata nomeia
    return buildVotoRows({
      deliberacao_id: "item-1.4.4",
      nomes: isAnttAtaItem ? [] : itemVotingNames,
      nomesContra: [],
      diretoresList: CADASTRO_ANTT,
      activeDiretoresList: DIRETORES_ANTT,
      resultado: "Aprovado",
      unanime: true,
      inferFromMandate: isAnttAtaItem
        // O ramo da ANTT: decisão + unanimidade bastam, sem consultar nomes extraídos.
        ? true
        // O ramo genérico, que a perda do campo fazia rodar. Ele recusa por `hasNominalNames`.
        : shouldInferVotesFromMandate({
          resultado: "Aprovado", tipo_documento: "ata", import_counts_as_final: true,
          unanimidadeDetectada: true, nomes: itemVotingNames, nomesContra: [],
          dataReuniao: "2026-03-09", diretoresList: CADASTRO_ANTT,
        }),
    });
  }

  it("com o campo perdido, o item recebe UM voto — nominal, e é o do relator", () => {
    // Exatamente o retrato do banco: votos=1, votos_nominais=1, e o votante é o relator.
    const rows = votarItem(false);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nominal).toBe(true);
    expect(rows[0].diretor_id).toBe("alessandro");
  });

  it("⚠️⚠️ e o voto nominal IGNORA a janela de mandato — segundo achado, medido aqui", () => {
    /**
     * `alessandro` está no CADASTRO e fora da `activeDiretoresList` (a janela de mandato da data), e
     * ainda assim recebe o voto. O casamento nominal não consulta a janela: quem casa, vota.
     *
     * Para as nove reuniões isso quer dizer que o "1 de 5" pode não ser nem 1 DOS 5 — é um voto de
     * alguém de fora da janela, mais zero dos cinco esperados. Não é um defeito novo desta fase e
     * nem sempre é errado (voto em autos, substituto empossado sem mandato cadastrado), mas muda o
     * que o número significa, e por isso está medido e não suposto.
     */
    const rows = votarItem(false);
    expect(DIRETORES_ANTT.some((d) => d.id === rows[0].diretor_id)).toBe(false);
  });

  it("⚠️ com o campo no lugar, o item recebe os CINCO — e nenhum é nominal", () => {
    /**
     * Nenhum nominal porque a ata da ANTT não nomina voto por diretor: são votos INFERIDOS da
     * decisão unânime sobre o colegiado. Marcar qualquer um como nominal seria afirmar uma leitura
     * que o documento não tem.
     */
    const rows = votarItem(true);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.is_nominal === false)).toBe(true);
    expect(new Set(rows.map((r) => r.diretor_id))).toEqual(new Set(DIRETORES_ANTT.map((d) => d.id)));
  });

  it("⚠️ o nome nominal é o que BLOQUEIA a inferência — é o segundo elo, não um efeito colateral", () => {
    const base = {
      resultado: "Aprovado", tipo_documento: "ata" as const, import_counts_as_final: true,
      unanimidadeDetectada: true, dataReuniao: "2026-03-09", diretoresList: CADASTRO_ANTT,
    };
    // Com o relator entrando como nome extraído, a inferência desliga.
    expect(shouldInferVotesFromMandate({ ...base, nomes: ["Lucas Asfor"] })).toBe(false);
    // Sem nome extraído, liga.
    expect(shouldInferVotesFromMandate({ ...base, nomes: [] })).toBe(true);
  });

  it("⚠️ e a premissa do conserto: a ata da ANTT NÃO nomina voto por diretor", () => {
    /**
     * Se ela nominasse, ler o relator como votante seria correto e o conserto estaria errado. O
     * repositório já declara que não: a capacidade é por (órgão, instrumento), e o documento de VOTO
     * da ANTT nomina, a ATA não.
     */
    expect(capacidadeNominal("ANTT", "ata")).toBe("nenhum");
    expect(fonteNominaVotos("ANTT", "ata")).toBe(false);
    expect(capacidadeNominal("ANTT", "voto_individual")).toBe("sempre");
  });

  it("⚠️ o relator contaminado com o cabeçalho é um defeito SEPARADO — e eu tinha lido errado", () => {
    /**
     * ⚠️ CORREÇÃO DE UMA AFIRMAÇÃO MINHA, desfeita pela medição. Em 3 das nove reuniões a coluna
     * `relator` vem suja: `"Lucas Asfor Ata DA Reunião Deliberativa Eletr"`, `"Alex Azevedo Pauta DA
     * Reunião DE Diretoria"`, `"Felipe Queiroz Ata DA Reunião Deliberativa Eletr"` — texto de
     * cabeçalho grudado no nome, truncado no limite da coluna. Eu afirmei que "o nome sujo ainda
     * casava e virava voto". **Não casa.**
     *
     * E a consequência é o oposto da que eu disse: nome que não casa NÃO bloqueia a inferência,
     * então um item cujo `votos_detectados` trouxesse só o nome sujo receberia o colegiado INTEIRO.
     * Como o banco mostra 1 voto, o que estava em `votos_detectados` era um nome LIMPO — a sujeira
     * está na coluna `relator`, que é outro campo. Um defeito real, e não este.
     */
    const sujo = ["Lucas Asfor Ata DA Reunião Deliberativa Eletr"];
    const args = {
      resultado: "Aprovado", tipo_documento: "ata" as const, import_counts_as_final: true,
      unanimidadeDetectada: true, nomesContra: [], dataReuniao: "2026-03-09",
      diretoresList: CADASTRO_ANTT,
    };
    expect(shouldInferVotesFromMandate({ ...args, nomes: sujo }), "o nome sujo casou").toBe(true);
    expect(shouldInferVotesFromMandate({ ...args, nomes: ["Lucas Asfor"] })).toBe(false);
  });
});

describe("etapa192 · ⚠️ UMA fonte para o conceito", () => {
  const CONFIRM = semComentarios(ler("src/app/api/v1/upload/confirm/route.ts"));

  it("o fallback vive na NORMALIZAÇÃO, não espalhado pelos leitores", () => {
    expect(CONFIRM).toMatch(/documento_antt_tipo: d\.documento_antt_tipo\s*\n?\s*\?\? \(d\.extraction_raw\?\.documento_antt_tipo/);
    expect(CONFIRM).toMatch(/documento_subtipo: d\.documento_subtipo\s*\n?\s*\?\?/);
  });

  it("⚠️ e o leitor do PREFIXO deixou de ter um fallback PRÓPRIO", () => {
    // Era a assimetria: este tinha, o gate de voto não — e a chave certa escondia o voto errado.
    const i = CONFIRM.indexOf("function internalAnttDocumentPrefix");
    const bloco = CONFIRM.slice(i, i + 260);
    expect(bloco).toMatch(/const anttType = d\.documento_antt_tipo;/);
    expect(bloco, "voltou a ter um segundo fallback, e a assimetria com ele")
      .not.toMatch(/d\.extraction_raw\?\.documento_antt_tipo/);
  });

  it("o gate de voto do item segue lendo o campo normalizado", () => {
    expect(CONFIRM).toMatch(/const isAnttAtaItem = Boolean\(d\.documento_antt_tipo\);/);
  });
});
