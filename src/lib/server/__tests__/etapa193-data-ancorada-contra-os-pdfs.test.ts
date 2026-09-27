/**
 * Etapa 193 (Fase 33, Bloco A) — o caminho ANCORADO contra os PDFs reais, e as duas afirmações
 * minhas que ele derrubou.
 *
 * ═══ O que eu ia consertar, e não existia ═══
 * O QA da Fase 31 achou datas erradas no banco (81ª da ANM como 2025-03-26, 83ª como 2022-05-02,
 * 1177ª da ARTESP como 2025-01-13). Eu escrevi que havia DOIS defeitos vivos no extrator:
 *
 *  1. uma "âncora que mente": `realizada em` casando a data de OUTRA reunião citada no corpo;
 *  2. uma variante de preâmbulo da 80ª ROP (*"Aos dezessete de dezembro de dois mil e vinte e
 *     cinco"*, sem `do mês de` / `do ano de`) que a regex da ANM recusaria.
 *
 * ⚠️ **As duas caíram na medição.** Contra os PDFs reais do corpus, o caminho ancorado acerta todas.
 * E a afirmação 2 eu medi contra um preâmbulo que digitei à mão a partir de uma fixture de ROSTER
 * (`etapa24`): **a 80ª não está no corpus de datas** — `anm-ata-80-rop.pdf` não existe. Eu tratei um
 * trecho de teste de outra coisa como se fosse o documento.
 *
 * ═══ Por que este arquivo existe ═══
 * `vote-certification` já compara a data com o gabarito, mas pela CASCATA COMPLETA — que tem
 * fallbacks. O `redatar` não usa a cascata: ele usa **só o caminho ancorado**, de propósito (Fase 15).
 * Ninguém nunca exercitou esse caminho contra os PDFs reais, e é dele que depende todo veredito de
 * "a data gravada está errada". Um `redatar` que re-deriva errado reescreveria data CERTA por ERRADA,
 * em massa, e mudaria o roster de voto de cada linha.
 *
 * É este o teste que teria me impedido de escrever o conserto errado.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { extractPdfText } from "@/lib/server/pdf-extractor";
import { extractDataReuniaoAncorada } from "@/lib/server/nlp-extractor";
import { extractAnmMeetingMetadata } from "@/lib/server/regulatory-documents";
import { dataReuniaoPlausivel } from "@/lib/server/colegiado-sources";

const RAIZ = join(__dirname, "../../../..");
const DIR = join(__dirname, "fixtures/votos");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

type Doc = { file: string; fields?: { data_reuniao?: string | null }; data_reuniao?: string | null };
const gabarito = JSON.parse(readFileSync(join(DIR, "gabarito.json"), "utf-8")) as { docs: Doc[] };
const dataDo = (d: Doc) => d.fields?.data_reuniao ?? d.data_reuniao ?? null;

/** A MESMA derivação que o `redatar` faz — se divergir daqui, o teste mede outra coisa. */
function rederivarComoORedatar(texto: string, filename: string): string | null {
  const anm = extractAnmMeetingMetadata(texto, filename);
  return anm.data_reuniao ?? extractDataReuniaoAncorada(texto) ?? null;
}

const cache = new Map<string, string>();
async function texto(file: string): Promise<string> {
  const emCache = cache.get(file);
  if (emCache !== undefined) return emCache;
  const t = (await extractPdfText(readFileSync(join(DIR, file)))).text;
  cache.set(file, t);
  return t;
}

/** Só quem tem data certificada — a pauta da ARTESP não tem, e exigir dela seria inventar gabarito. */
const COM_DATA = gabarito.docs.filter((d) => dataDo(d));

/**
 * ⚠️ O RECORTE, e ele saiu de uma medição que quase deixou passar um acidente.
 *
 * A primeira versão deste teste exigia o acerto em TODO o corpus e falhou nos quatro documentos da
 * ANTT. Não foi o teste que estava errado: a data da ANTT sai do `antt-manual-parser`, que não está
 * na cascata ancorada. E a consequência era grave — a Janela C do `redatar`, se ligada, teria
 * reescrito a data CERTA da 264ª RDE pela ERRADA (`2025-10-08` no lugar de `2026-01-19`), em massa.
 *
 * O `redatar` passou a declarar `AGENCIAS_COM_ANCORA_CERTIFICADA = {ANM, ARTESP}`, e este conjunto
 * aqui é o espelho. Os dois têm de continuar iguais — é o que a última expectativa cobra.
 */
const SIGLAS_CERTIFICADAS = ["ANM", "ARTESP"];
const siglaDoArquivo = (file: string) => file.split("-")[0].toUpperCase();
const NO_ESCOPO = COM_DATA.filter((d) => SIGLAS_CERTIFICADAS.includes(siglaDoArquivo(d.file)));
const FORA_DO_ESCOPO = COM_DATA.filter((d) => !SIGLAS_CERTIFICADAS.includes(siglaDoArquivo(d.file)));

describe("etapa193 · ⚠️ o caminho ancorado acerta os PDFs reais — as duas hipóteses caíram", () => {
  it("ANM e ARTESP: todo documento com data certificada é re-derivado CORRETAMENTE", async () => {
    const erros: string[] = [];
    for (const d of NO_ESCOPO) {
      const t = await texto(d.file);
      const nova = rederivarComoORedatar(t, d.file);
      if (nova !== dataDo(d)) erros.push(`${d.file}: ancorada=${nova} · gabarito=${dataDo(d)}`);
    }
    expect(erros, `o caminho ancorado divergiu do gabarito:\n${erros.join("\n")}`).toEqual([]);
    expect(NO_ESCOPO.length, "o recorte ficou vazio — o teste não mediria nada").toBeGreaterThanOrEqual(8);
  }, 120_000);

  it("⚠️⚠️ e a ANTT NÃO é re-derivável pela âncora — é ISTO que justifica o recorte", async () => {
    /**
     * A data da ANTT sai do `antt-manual-parser` (`extractMeeting` na ata, data de ASSINATURA do
     * fecho no voto individual), que não está na cascata ancorada. Medido: a 264ª RDE devolve
     * `2025-10-08` contra `2026-01-19` certo, e os outros três devolvem `null`.
     *
     * ⚠️ Esta expectativa é o FREIO. Se alguém puser ANTT em `AGENCIAS_COM_ANCORA_CERTIFICADA` sem
     * antes ensinar a re-derivação a consultar o parser da ANTT, a Janela C reescreveria data certa
     * por errada, em massa, com número verde. O teste tem de cair ANTES disso.
     */
    const resultados: Array<{ file: string; ancorada: string | null; gabarito: string | null }> = [];
    for (const d of FORA_DO_ESCOPO) {
      resultados.push({
        file: d.file, ancorada: rederivarComoORedatar(await texto(d.file), d.file), gabarito: dataDo(d),
      });
    }
    expect(resultados.length, "o corpus perdeu os documentos da ANTT").toBeGreaterThanOrEqual(4);
    // Nenhum deles é re-derivável corretamente hoje — se um passar a ser, este teste pede revisão.
    const acertaram = resultados.filter((r) => r.ancorada === r.gabarito);
    expect(acertaram, `passou a acertar: ${JSON.stringify(acertaram)} — reavalie o recorte`).toEqual([]);
    // E pelo menos um devolve data ERRADA (não só `null`), que é o caso perigoso.
    expect(resultados.some((r) => r.ancorada !== null && r.ancorada !== r.gabarito)).toBe(true);
  }, 120_000);

  it("⚠️ a 81ª NÃO cai na data da 72ª citada no corpo — a 'âncora que mente' não existe", async () => {
    /**
     * Minha hipótese: `"MANTER in totum a decisão prolatada na 72ª Reunião Ordinária Pública,
     * realizada em 26/03/2025"` seria pescada como data da reunião. O PDF real tem essa frase e a
     * data sai 2026-01-28.
     */
    const t = await texto("anm-ata-81-rop.pdf");
    expect(t).toMatch(/26\/03\/2025/); // a data-armadilha ESTÁ no documento
    expect(rederivarComoORedatar(t, "anm-ata-81-rop.pdf")).toBe("2026-01-28");
  }, 60_000);

  it("⚠️ a 83ª não cai no Voto de 2022 citado no corpo — o `dddf693` está de pé", async () => {
    const t = await texto("anm-ata-83-rop.pdf");
    expect(rederivarComoORedatar(t, "anm-ata-83-rop.pdf")).toBe("2026-03-25");
  }, 60_000);

  it("⚠️ a ARTESP 22 dá 2026-01-13 — logo o 2025-01-13 do banco não veio deste parser", async () => {
    const t = await texto("artesp-delib-22.pdf");
    expect(rederivarComoORedatar(t, "artesp-delib-22.pdf")).toBe("2026-01-13");
  }, 60_000);

  it("⚠️ e a 80ª ROP NÃO está no corpus — minha afirmação sobre ela não tinha base", () => {
    /**
     * Eu medi a "variante da 80ª" contra um preâmbulo digitado à mão, copiado de uma fixture de
     * ROSTER (`etapa24-anm-roster-composicao`). Trecho de teste de outra coisa não é o documento.
     * Esta expectativa fica como registro: se a 80ª entrar no corpus, ela cai e a hipótese volta a
     * ser testável DE VERDADE, contra o PDF.
     */
    expect(existsSync(join(DIR, "anm-ata-80-rop.pdf"))).toBe(false);
    const pdfs = readdirSync(DIR).filter((f) => f.endsWith(".pdf"));
    expect(pdfs.filter((f) => /anm-ata-8/.test(f)).sort()).toEqual(
      ["anm-ata-81-rop.pdf", "anm-ata-82-ordinaria.pdf", "anm-ata-83-rop.pdf"],
    );
  });

  it("a data re-derivada passa pelo guard de plausibilidade, no recorte", async () => {
    // Se a re-derivação produzisse ano impossível, o `redatar` a descartaria e a linha viraria NULL.
    for (const d of NO_ESCOPO) {
      const nova = rederivarComoORedatar(await texto(d.file), d.file);
      if (!nova) continue;
      expect(dataReuniaoPlausivel(siglaDoArquivo(d.file), nova).plausivel, `${d.file} → ${nova}`).toBe(true);
    }
  }, 120_000);
});

describe("etapa193 · a JANELA C do redatar: seleciona por DISCORDÂNCIA, não por impossibilidade", () => {
  const R = semComentarios(ler("src/app/api/v1/admin/deliberacoes/redatar/route.ts"));

  it("⚠️ a regra está DESLIGADA, e o número diz isso junto", () => {
    expect(R).toMatch(/const REDATAR_DATA_DIVERGENTE = false;/);
    /**
     * Sem esta chave, `divergentes_medidas: 44` seria lido como "44 consertadas".
     *
     * ⚠️ E a contagem é o ponto, não o `toMatch`: uma mutação SOBREVIVEU trocando o valor do ramo
     * DEMO por `true` literal, porque o `toMatch` achava a ocorrência do ramo real e se dava por
     * satisfeito. Os DOIS ramos têm de derivar do mesmo constante — um demo que diz "ligada" com a
     * regra desligada é a mesma mentira, só num lugar em que ninguém olha.
     */
    const publicadas = (R.match(/divergentes_regra_ligada: REDATAR_DATA_DIVERGENTE/g) ?? []).length;
    expect(publicadas, "o ramo real e o demo precisam publicar o valor da CONSTANTE").toBe(2);
    expect(R, "algum ramo passou a afirmar um literal em vez do estado real")
      .not.toMatch(/divergentes_regra_ligada: (?:true|false)/);
    expect(R).toMatch(/if \(!REDATAR_DATA_DIVERGENTE \|\| dryRun\) continue;/);
  });

  it("o veredito é a COMPARAÇÃO com a re-derivação ancorada, não `dataReuniaoPlausivel`", () => {
    expect(R).toMatch(/const rederivada = anm\.data_reuniao \?\? extractDataReuniaoAncorada\(fonte\.texto\) \?\? null;/);
    expect(R).toMatch(/if \(rederivada === String\(d\.data_reuniao\)\) continue;/);
    // ⚠️ Sem âncora não há veredito: data ausente nunca vira "divergente".
    expect(R).toMatch(/if \(!rederivada \|\| !dataReuniaoPlausivel\(sigla, rederivada\)\.plausivel\) continue;/);
    // E sem texto também não: não se inventa divergência a partir de ausência de evidência.
    expect(R).toMatch(/if \(!fonte\?\.texto\) continue;/);
  });

  it("⚠️ o universo usa `lerTudo` — `.limit(N)` do PostgREST NÃO pagina", () => {
    /**
     * A Janela A pode usar `.limit(500)`: ela ordena por `data_reuniao` ASC e data impossível é
     * sempre a menor, então as candidatas caem nas primeiras linhas por construção. Aqui o universo é
     * toda deliberação COM data, e `.limit()` daria a mesma subcontagem que a Fase 25 mediu em cinco
     * telas ("537 órfãos" que eram o resto da fatia).
     */
    const i = R.indexOf("redatar/janela-divergente");
    expect(i, "a janela divergente sumiu").toBeGreaterThan(-1);
    const bloco = R.slice(Math.max(0, i - 700), i + 200);
    expect(bloco).toMatch(/lerTudo<any>\(/);
    expect(bloco).not.toMatch(/\.limit\(/);
    // E truncamento é declarado: leitura incompleta significa que o número SUBCONTA.
    expect(R).toMatch(/divergente_leitura_completa: divergenteLeituraCompleta/);
  });

  it("⚠️ o texto vem em LOTES — um `maybeSingle` por linha é o N+1 da Fase 29", () => {
    expect(R).toMatch(/tabela: "documentos_regulatorios",\s*select: "deliberacao_id, texto_extraido, filename",/);
    expect(R).toMatch(/coluna: "deliberacao_id",/);
  });

  it("e a janela é ROTATIVA, com bloco e total publicados", () => {
    expect(R).toMatch(/janelaRotativa\(plausiveis\.length, LOTE_DIVERGENTE, Math\.floor\(Date\.now\(\) \/ 60_000\)\)/);
    expect(R).toMatch(/divergente_bloco: divergenteBloco/);
    expect(R).toMatch(/divergente_blocos: divergenteBlocos/);
  });

  it("não reprocessa o que a Janela A já trata — as duas decisões são diferentes", () => {
    expect(R).toMatch(/const jaTratadas = new Set\(candidatas\.map\(\(d: any\) => String\(d\.id\)\)\);/);
  });

  it("⚠️⚠️ o recorte de agências é o MESMO que este teste certifica", () => {
    // Duas listas da mesma verdade divergiriam no primeiro dia — e aqui a divergência reescreveria
    // data certa por errada. O conjunto do fonte tem de bater com o que o teste mediu.
    const m = R.match(/AGENCIAS_COM_ANCORA_CERTIFICADA = new Set\(\[([^\]]*)\]\)/);
    expect(m, "o recorte sumiu do redatar").toBeTruthy();
    const noFonte = [...m![1].matchAll(/"([A-Z]+)"/g)].map((x) => x[1]).sort();
    expect(noFonte).toEqual([...SIGLAS_CERTIFICADAS].sort());
    // E a linha fora do escopo é PULADA, com contador próprio — exclusão silenciosa, nunca.
    expect(R).toMatch(/if \(!siglaDaLinha \|\| !AGENCIAS_COM_ANCORA_CERTIFICADA\.has\(siglaDaLinha\.toUpperCase\(\)\)\)/);
    expect(R).toMatch(/divergente_fora_de_escopo: divergenteForaDeEscopo/);
  });

  it("⚠️ e o ramo DEMO carrega as chaves novas — chave ausente vira buraco na tela", () => {
    const i = R.indexOf('modo: "demo"');
    const bloco = R.slice(i, i + 900);
    for (const k of ["divergentes_medidas", "divergentes_regra_ligada", "amostra_divergente",
      "divergente_leitura_completa"]) {
      expect(bloco, `${k} falta no ramo demo`).toContain(k);
    }
  });
});
