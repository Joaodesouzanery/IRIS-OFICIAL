/**
 * Etapa 234 (Fase 39, passo 3) — a simulação do revoto contra o gabarito, na data CERTIFICADA.
 *
 * O caso é o da produção (QA de 04/10): a 81ª ROP gravada em 2025-03-26, com votos INFERIDOS só de
 * Caio Mário e Mauro em todos os itens. O gabarito (contado à mão no PDF) diz: Mauro, Luiz e Fábio
 * com 64 votos, José Fernando com 63 (impedido no 2.1.1), 4 itens sem decisão.
 *
 * As propriedades:
 *  · na data CERTA, apagar (revoto) + acrescentar (completar-parcial) reproduz o gabarito exato;
 *  · na data GRAVADA, o portão fecha — o roster seria o inverso do gabarito;
 *  · voto nominal fora do mandato nunca é apagado, e impede o "reproduz";
 *  · item retirado de pauta não ganha voto inferido (regra do desfecho, a mesma do motor).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { simularRevotoDaAta, type ItemParaSimular } from "../simular-revoto";
import { GABARITO_POR_ARQUIVO } from "../gabarito";
import type { MandatoJanela } from "../colegiado-na-data";

const ANM = "anm";
const m = (id: string, ini: string, fim: string | null, afastado: string | null = null): MandatoJanela =>
  ({ diretor_id: id, agencia_id: ANM, data_inicio: ini, data_fim: fim, afastado_desde: afastado, afastado_ate: null });
/** O cadastro do SQL B (04/10), verificado contra o DOU. */
const MANDATOS: MandatoJanela[] = [
  m("mauro", "2022-12-05", "2026-12-04"),
  m("caio", "2023-12-27", "2026-12-04", "2025-09-17"),
  m("roger", "2022-05-24", "2025-12-04"),
  m("tasso", "2022-05-24", "2025-12-04"),
  m("jose", "2025-09-01", "2028-12-04"),
  m("luiz", "2025-12-05", "2026-06-02"), m("luiz", "2026-06-03", "2026-11-30"),
  m("fabio", "2025-12-05", "2026-06-02"), m("fabio", "2026-06-03", "2026-11-30"),
];
const DIRETORES = [
  { id: "mauro", nome: "Mauro Henrique Moreira Sousa" },
  { id: "caio", nome: "Caio Mário Trivellato Seabra Filho" },
  { id: "roger", nome: "Roger Romão Cabral" },
  { id: "tasso", nome: "Tasso Mendonça Junior" },
  { id: "jose", nome: "José Fernando de Mendonça Gomes Júnior" },
  { id: "luiz", nome: "Luiz Paniago Neves" },
  { id: "fabio", nome: "Fábio Fernando Borges" },
];
const ATA81 = GABARITO_POR_ARQUIVO["anm-ata-81-rop.pdf"];
const inferido = (id: string) => ({ diretor_id: id, is_nominal: false, proveniencia: "inferido", tipo_voto: "Favoravel", motivo_nao_voto: null });

/** A 81ª como está no banco: 64 decididos + 4 retirados; só Caio e Mauro, inferidos, nos decididos. */
function itensDa81(): ItemParaSimular[] {
  const decididos = Array.from({ length: 64 }, (_, i) => ({
    id: `d${i}`, item_numero: i === 0 ? "2.1.1" : `3.${i}`, tipo_documento: "ata", resultado: "Deferido",
    contestado: false, temPai: true, impedidos: i === 0 ? ["jose"] : [], votos: [inferido("caio"), inferido("mauro")],
  }));
  const retirados = Array.from({ length: 4 }, (_, i) => ({
    id: `r${i}`, item_numero: `9.${i}`, tipo_documento: "ata", resultado: "Retirado de Pauta",
    contestado: false, temPai: true, impedidos: [], votos: [],
  }));
  return [...decididos, ...retirados];
}
const simular = (dataCerta: string, itens = itensDa81()) => simularRevotoDaAta({
  arquivo: "anm-ata-81-rop.pdf", ata: ATA81, sigla: "ANM", agenciaId: ANM, dataCerta,
  mandatos: MANDATOS, diretores: DIRETORES, itens,
});

describe("etapa234 · a 81ª na data CERTA reproduz o gabarito", () => {
  const r = simular("2026-01-28");

  it("o portão abre: o roster da data certa é o colegiado do gabarito", () => {
    expect(r.portao).toMatchObject({ reproduz: true, faltando: [], sobrando: [] });
  });

  it("o revoto apagaria o Caio (afastado na data) em todos os 64 itens decididos — e só ele", () => {
    expect(r.apagaria).toHaveLength(64);
    expect(new Set(r.apagaria.map((a) => a.diretor))).toEqual(new Set(["Caio Mário Trivellato Seabra Filho"]));
  });

  it("e depois do completar-parcial cada diretor bate com o gabarito (José 63: impedido no 2.1.1)", () => {
    expect(r.por_diretor.map((d) => [d.nome.split(" ")[0], d.esperado, d.depois])).toEqual([
      ["Mauro", 64, 64], ["Luiz", 64, 64], ["Fábio", 64, 64], ["José", 63, 63],
    ]);
    expect(r.divergencias_depois).toEqual([]);
    expect(r.reproduz).toBe(true);
  });

  it("⚠️ item retirado de pauta não ganha voto inferido — senão seriam 68, não 64", () => {
    expect(r.por_diretor.every((d) => d.depois <= 64)).toBe(true);
  });
});

describe("etapa234 · na data GRAVADA (2025-03-26) o portão FECHA", () => {
  it("o roster seria Mauro, Caio, Roger e Tasso — o inverso do gabarito", () => {
    const r = simular("2025-03-26");
    expect(r.portao.reproduz).toBe(false);
    expect(r.portao.faltando.sort()).toEqual(["Fábio Fernando Borges", "José Fernando de Mendonça Gomes Júnior", "Luiz Paniago Neves"]);
    expect(r.reproduz).toBe(false);
  });
});

describe("etapa234 · nominal fora do mandato nunca some — e impede o 'reproduz'", () => {
  it("um voto NOMINAL do Roger na 81ª fica, aparece como suspeito e como diretor a mais", () => {
    const itens = itensDa81();
    itens[5].votos.push({ diretor_id: "roger", is_nominal: true, proveniencia: "nominal", tipo_voto: "Favoravel", motivo_nao_voto: null });
    const r = simular("2026-01-28", itens);
    expect(r.roster_suspeito).toEqual([{ item: "3.5", diretor: "Roger Romão Cabral" }]);
    expect(r.apagaria.some((a) => a.diretor.startsWith("Roger"))).toBe(false);
    expect(r.divergencias_depois.some((d) => d.tipo === "diretor_a_mais")).toBe(true);
    expect(r.reproduz).toBe(false);
  });
});

describe("etapa234 · a rota é só leitura e usa a data CERTIFICADA", () => {
  const ROTA = readFileSync(join(__dirname, "../../../app/api/v1/admin/votos/simular-revoto/route.ts"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

  it("nenhuma escrita", () => {
    expect(ROTA).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("a data vem de DATAS_CONFERIDAS (o PDF), nunca de d.data_reuniao", () => {
    expect(ROTA).toMatch(/DATAS_CONFERIDAS\.find\(/);
    expect(ROTA).not.toMatch(/dataCerta = [^;]*d\.data_reuniao/);
  });
});

describe("etapa234 · o botão de aplicar só aparece quando é seguro", () => {
  const PAINEL = readFileSync(join(__dirname, "../../../components/dashboard/RevotoSimuladoPanel.tsx"), "utf-8");

  it("exige: a simulação reproduz, a data GRAVADA já é a certa, e a leitura foi completa", () => {
    expect(PAINEL).toMatch(/const datasCertas = atas\.every\(\(a\) => a\.datas_gravadas\.length === 1 && a\.datas_gravadas\[0\] === a\.data_certa\);/);
    expect(PAINEL).toMatch(/\{reproduz && datasCertas && sim\?\.leitura_completa \? \(/);
  });

  it("aplica POR AGÊNCIA, com aplicar:true e dry_run:false explícitos, bloco a bloco", () => {
    expect(PAINEL).toMatch(/\[modo\]: true, aplicar: true, dry_run: false, agencia_id: agenciaId, bloco,/);
  });

  it("revoto só na ANM; nas outras, só completar", () => {
    expect(PAINEL).toMatch(/const comRevoto = sigla === "ANM";/);
    expect(PAINEL).toMatch(/const apagados = comRevoto \? await varrer\("revoto"/);
  });
});
