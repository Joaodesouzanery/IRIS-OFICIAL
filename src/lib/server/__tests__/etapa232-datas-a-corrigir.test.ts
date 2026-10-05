/**
 * Etapa 232 (Fase 39, passo 2) — datas a corrigir: Medir → Aplicar.
 *
 * O SQL A provou que os 81 votos "fora do roster" da ANTT eram DATA (282, 286, 1.035, 289) e que 53
 * votos individuais tinham data de 2001–2025 vinda do corpo do texto. Estes testes provam:
 *  · o voto individual só tem data por ÂNCORA — sem âncora é nulo, nunca a Lei 10.233 de 2001;
 *  · a referência só corrige dentro da ORDEM da série e atrás do portão do gabarito;
 *  · o voto só muda de data se o signatário tinha mandato na nova data;
 *  · a rota não grava sem o clique, não grava com leitura incompleta, e guarda a data antiga.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { dataDoVotoAntt, parseAnttManualDocument } from "../antt-manual-parser";
import {
  dataDaReferencia, planejarAtasAnm, planejarPelaReferencia, planejarVotosAntt,
  type DelibParaData, type ReuniaoComData,
} from "../datas-a-corrigir";
import type { MandatoJanela } from "../colegiado-na-data";

const RAIZ = join(__dirname, "../../../..");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("etapa232 · o voto individual da ANTT só tem data por ÂNCORA", () => {
  it("o fecho «Brasília, dd de mês de aaaa» vence, e o signatário vem da assinatura SEI do diretor", () => {
    const t = "Relatório… protocolado em 05/11/2025 …\nBrasília, 09 de março de 2026.\n" +
      "Documento assinado eletronicamente por ALESSANDRO BAUMGARTNER, Diretor, em 09/03/2026, às 11:47";
    expect(dataDoVotoAntt(t)).toEqual({ data: "2026-03-09", signatario: "ALESSANDRO BAUMGARTNER", ancora: "fecho" });
  });

  it("sem fecho, a assinatura SEI do diretor — com a quebra de linha antes da data, como sai do PDF", () => {
    const t = "x".repeat(3000) + "Documento assinado eletronicamente por Severino Medeiros Ramos Neto, Diretor, em\n20/01/2026, às 10:00";
    expect(dataDoVotoAntt(t)).toMatchObject({ data: "2026-01-20", ancora: "assinatura_diretor", signatario: "Severino Medeiros Ramos Neto" });
  });

  it("várias assinaturas: vale a ÚLTIMA do diretor (o rodapé pode vir depois de anexos)", () => {
    const t = "assinado eletronicamente por Fulano, Diretor, em 01/02/2026 … anexos … " +
      "assinado eletronicamente por Beltrano, Assessor, em 03/02/2026 … assinado eletronicamente por Ciclano, Diretor-Geral, em 05/02/2026";
    expect(dataDoVotoAntt(t)).toMatchObject({ data: "2026-02-05", signatario: "Ciclano" });
  });

  it("⚠️ só a Lei 10.233, «de 5 de junho de 2001», sem âncora → NULO (era 2001-06-05)", () => {
    const t = "VOTO DFQ 010/2026 … nos termos da Lei nº 10.233, de 5 de junho de 2001, e do processo 50500.000001/2024 de 12/03/2024 …";
    expect(dataDoVotoAntt(t)).toEqual({ data: null, signatario: null, ancora: null });
    expect(parseAnttManualDocument(t, "Voto DFQ 010-2026.pdf").fields.data_reuniao ?? null).toBeNull();
  });

  it("o PDF REAL do Voto DAB 002/2026 continua em 09/03/2026", async () => {
    const pdf = (await import("pdf-parse")).default as unknown as (b: Buffer) => Promise<{ text: string }>;
    const { text } = await pdf(readFileSync(join(__dirname, "fixtures/votos/antt-voto-dab-002.pdf")));
    expect(dataDoVotoAntt(text)).toMatchObject({ data: "2026-03-09", ancora: "fecho" });
  });
});

describe("etapa232 · a referência corrige só dentro da ORDEM da série", () => {
  const ref: ReuniaoComData[] = [
    { agencia: "ANTT", serie: "eletronica", numero: 287, data_reuniao: "2026-07-03" },
    { agencia: "ANTT", serie: "eletronica", numero: 289, data_reuniao: "2026-07-17" },
    { agencia: "ANTT", serie: "eletronica", numero: 291, data_reuniao: "2026-07-31" },
  ];

  it("a 289 entre a 287 e a 291 → a data do site", () => {
    expect(dataDaReferencia(ref, { agencia: "ANTT", serie: "eletronica", numero: 289 })).toEqual({ data: "2026-07-17", motivo: "ok" });
  });

  it("⚠️ data IGUAL à da vizinha é recusada — é o cabeçalho sem data herdando a da reunião seguinte", () => {
    const herdou = ref.map((r) => (r.numero === 289 ? { ...r, data_reuniao: "2026-07-31" } : r));
    expect(dataDaReferencia(herdou, { agencia: "ANTT", serie: "eletronica", numero: 289 }).motivo).toBe("fora_da_ordem_da_serie");
  });

  it("duas datas para o mesmo número na referência → ambígua, ninguém escreve", () => {
    const amb = [...ref, { agencia: "ANTT", serie: "eletronica", numero: 289, data_reuniao: "2026-07-18" }];
    expect(dataDaReferencia(amb, { agencia: "ANTT", serie: "eletronica", numero: 289 }).motivo).toBe("referencia_ambigua");
  });
});

const delib = (over: Partial<DelibParaData>): DelibParaData => ({
  id: Math.random().toString(36).slice(2), agencia: "ANTT", agencia_id: "antt", numero_reuniao: "289",
  serie: "eletronica", data_reuniao: "2024-04-29", documento_pai_id: null, ...over,
});
const GABARITO_ANTT = [
  { agencia: "ANTT", reuniao: "1.024ª", data_reuniao: "2026-01-19" },
  { agencia: "ANTT", reuniao: "264ª RDE", data_reuniao: "2026-01-19" },
];
const REF_COM_GABARITO: ReuniaoComData[] = [
  { agencia: "ANTT", serie: "ordinaria", numero: 1024, data_reuniao: "2026-01-19" },
  { agencia: "ANTT", serie: "eletronica", numero: 264, data_reuniao: "2026-01-19" },
  { agencia: "ANTT", serie: "eletronica", numero: 287, data_reuniao: "2026-07-03" },
  { agencia: "ANTT", serie: "eletronica", numero: 289, data_reuniao: "2026-07-17" },
  { agencia: "ANTT", serie: "eletronica", numero: 291, data_reuniao: "2026-07-31" },
  { agencia: "ARTESP", serie: "ordinaria", numero: 1186, data_reuniao: "2026-03-17" },
];

describe("etapa232 · o plano pela referência", () => {
  it("ANTT: o portão reproduz o gabarito → a 289 de 2024 vira proposta; a já certa conta como certa", () => {
    const p = planejarPelaReferencia({
      delibs: [delib({}), delib({ data_reuniao: "2026-07-17" })],
      referencia: REF_COM_GABARITO, atasDoGabarito: GABARITO_ANTT, agencias: ["ANTT", "ARTESP"],
    });
    expect(p.portoes.ANTT.aprovado).toBe(true);
    expect(p.propostas.map((x) => [x.numero_reuniao, x.de, x.para])).toEqual([["289", "2024-04-29", "2026-07-17"]]);
    expect(p.ja_certas).toBe(1);
  });

  it("⚠️ ARTESP sem ata no gabarito: a 1186ª fica BARRADA pelo portão — e aparece na lista do que ficou de fora", () => {
    const p = planejarPelaReferencia({
      delibs: [delib({ agencia: "ARTESP", agencia_id: "artesp", numero_reuniao: "1186", serie: null, data_reuniao: "2025-12-19" })],
      referencia: REF_COM_GABARITO, atasDoGabarito: GABARITO_ANTT, agencias: ["ANTT", "ARTESP"],
    });
    expect(p.propostas).toEqual([]);
    expect(p.recusas).toEqual({ portao_sem_ata_para_conferir: 1 });
    expect(p.barradas_pelo_portao[0]).toMatchObject({ numero_reuniao: "1186", para: "2026-03-17" });
  });

  it("referência que NÃO reproduz o gabarito reprova a agência inteira", () => {
    const errada = REF_COM_GABARITO.map((r) => (r.numero === 1024 ? { ...r, data_reuniao: "2025-12-26" } : r));
    const p = planejarPelaReferencia({ delibs: [delib({})], referencia: errada, atasDoGabarito: GABARITO_ANTT, agencias: ["ANTT"] });
    expect(p.portoes.ANTT).toMatchObject({ aprovado: false, motivo: "divergencia" });
    expect(p.propostas).toEqual([]);
  });

  it("o FILHO não é proposto por esta janela — segue a mãe na aplicação", () => {
    const p = planejarPelaReferencia({
      delibs: [delib({ documento_pai_id: "mae" })], referencia: REF_COM_GABARITO, atasDoGabarito: GABARITO_ANTT, agencias: ["ANTT"],
    });
    expect(p.propostas).toEqual([]);
  });
});

describe("etapa232 · o voto só muda de data se o signatário tinha MANDATO nela", () => {
  const mandatos: MandatoJanela[] = [
    { diretor_id: "sev", agencia_id: "antt", data_inicio: "2025-11-19", data_fim: "2026-02-18", afastado_desde: null, afastado_ate: null },
  ];
  const diretores = [{ id: "sev", nome: "Severino Medeiros Ramos Neto", nome_variantes: [] }];
  const voto = (data: string) => `${"relatório ".repeat(40)}\nBrasília, ${data}.\nDocumento assinado eletronicamente por Severino Medeiros Ramos Neto, Diretor, em 20/01/2026`;

  it("âncora dentro do mandato → proposta, com a fonte dita", () => {
    const d = delib({ numero_reuniao: null, data_reuniao: "2025-09-05" });
    const p = planejarVotosAntt({ delibs: [d], textos: new Map([[d.id, voto("20 de janeiro de 2026")]]), mandatos, diretores });
    expect(p.propostas).toMatchObject([{ de: "2025-09-05", para: "2026-01-20" }]);
    expect(p.propostas[0].fonte).toMatch(/fecho/);
  });

  it("⚠️ âncora ANTES da posse → recusada (a extração é que está errada; ninguém escreve)", () => {
    const d = delib({ numero_reuniao: null, data_reuniao: "2025-01-01" });
    const p = planejarVotosAntt({ delibs: [d], textos: new Map([[d.id, voto("05 de setembro de 2025")]]), mandatos, diretores });
    expect(p.propostas).toEqual([]);
    expect(p.recusas).toEqual({ signatario_sem_mandato_na_data: 1 });
  });

  it("sem âncora / sem texto / signatário desconhecido → recusas nomeadas, nunca proposta", () => {
    const a = delib({ numero_reuniao: null }); const b = delib({ numero_reuniao: null }); const c = delib({ numero_reuniao: null });
    const p = planejarVotosAntt({
      delibs: [a, b, c],
      textos: new Map([
        [a.id, "x".repeat(300) + " Lei 10.233, de 5 de junho de 2001"],
        [c.id, "x".repeat(300) + "\nBrasília, 20 de janeiro de 2026.\nassinado eletronicamente por Pessoa Estranha, Diretor, em 20/01/2026"],
      ]),
      mandatos, diretores,
    });
    expect(p.recusas).toEqual({ sem_ancora: 1, sem_texto: 1, signatario_nao_reconhecido: 1 });
  });
});

describe("etapa232 · a mãe da ANM pelo preâmbulo, atrás do gabarito", () => {
  const GAB = [
    { agencia: "ANM", reuniao: "79ª ROP", data_reuniao: "2025-11-26" },
    { agencia: "ANM", reuniao: "81ª ROP", data_reuniao: "2026-01-28" },
  ];
  const mae = (n: string, gravada: string, doTexto: string | null) =>
    ({ ...delib({ agencia: "ANM", agencia_id: "anm", numero_reuniao: n, serie: "ordinaria", data_reuniao: gravada }), dataDoTexto: doTexto });

  it("o texto reproduz a 79ª e a 81ª → a 81ª (gravada 2025-03-26) vira 2026-01-28", () => {
    const p = planejarAtasAnm({ maes: [mae("79", "2025-11-26", "2025-11-26"), mae("81", "2025-03-26", "2026-01-28")], atasDoGabarito: GAB });
    expect(p.portoes.ANM).toMatchObject({ aprovado: true, conferidas: 2, batem: 2 });
    expect(p.propostas).toMatchObject([{ numero_reuniao: "81", de: "2025-03-26", para: "2026-01-28" }]);
  });

  it("⚠️ se o texto der a data da 72ª para a 81ª (a armadilha «26/03/2025» do PDF), o portão FECHA", () => {
    const p = planejarAtasAnm({ maes: [mae("79", "2025-11-26", "2025-11-26"), mae("81", "2025-01-01", "2025-03-26")], atasDoGabarito: GAB });
    expect(p.portoes.ANM.aprovado).toBe(false);
    expect(p.propostas).toEqual([]);
  });

  it("sem nenhuma ata do gabarito entre as mães, o portão não abre (nada conferido = nada aprovado)", () => {
    const p = planejarAtasAnm({ maes: [mae("85", "2025-01-01", "2026-05-27")], atasDoGabarito: GAB });
    expect(p.portoes.ANM.motivo).toBe("sem_ata_para_conferir");
    expect(p.propostas).toEqual([]);
  });
});

describe("etapa232 · a rota: Medir → Aplicar, nunca sozinha", () => {
  const ROTA = semComentarios(readFileSync(join(RAIZ, "src/app/api/v1/admin/deliberacoes/datas-a-corrigir/route.ts"), "utf-8"));
  const RUN = readFileSync(join(RAIZ, "src/app/api/v1/pipeline/run/route.ts"), "utf-8");

  it("dry_run é o padrão, e só admin (não cron) aplica", () => {
    expect(ROTA).toMatch(/const dryRun = corpo\.dry_run !== false;/);
    expect(ROTA).toMatch(/const guard = await requireAdmin\(req\);/);
    expect(ROTA).not.toMatch(/requireAdminOrCron/);
  });

  it("⚠️ NÃO está no Rodar Tudo — a decisão do usuário foi o clique", () => {
    expect(RUN).not.toMatch(/datas-a-corrigir/);
  });

  it("leitura incompleta não aplica (409)", () => {
    expect(ROTA).toMatch(/if \(!leituraCompleta\) \{[\s\S]{0,200}status: 409/);
  });

  it("a data antiga fica guardada na linha, com a janela, a fonte e quando", () => {
    for (const campo of ["data_anterior: p.de", "data_corrigida_por: p.janela", "data_corrigida_fonte: p.fonte", "data_corrigida_em: agora"]) {
      expect(ROTA).toContain(campo);
    }
  });

  it("os filhos seguem a mãe, e a reunião órfã só sai com contagem ZERO conferida na hora", () => {
    expect(ROTA).toMatch(/\.eq\("documento_pai_id", p\.id\)/);
    expect(ROTA).toMatch(/if \(error \|\| \(count \?\? 1\) > 0\) continue;/);
  });
});
