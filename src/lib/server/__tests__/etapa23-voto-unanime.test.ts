import { describe, it, expect } from "vitest";
import { buildVotoRows, isDivergentVote, type DiretorVoteRecord } from "@/lib/server/vote-inference";

// Regressão do bug de divergência-falsa no INDEFERE-por-unanimidade, exposto pelos 58
// PDFs oficiais de deliberações ARTESP (reuniões 1177ª/1178ª/1185ª de 2026). A maioria
// INDEFERE pleitos de desequilíbrio, mas TODAS trazem "Houve aprovação dos presentes por
// unanimidade de votos". O `resultado="Indeferido"` é o desfecho do PLEITO da concessionária,
// não uma divisão do colegiado — os 4 diretores aprovaram o indeferimento por UNANIMIDADE.
const ARTESP_DIRETORES: DiretorVoteRecord[] = [
  { id: "d-andre", nome: "André Isper Rodrigues Barnabé", nome_variantes: [] },
  { id: "d-diego", nome: "Diego Albert Zanatto", nome_variantes: [] },
  { id: "d-fernanda", nome: "Fernanda Esbízaro Rodrigues Rudnik", nome_variantes: [] },
  { id: "d-raquel", nome: "Raquel França Carneiro", nome_variantes: [] },
];

describe("voto unânime — divergência só existe quando há dissidência real", () => {
  it("INDEFERE por unanimidade (ex.: Deliberação ARTESP Nº 15): 4 favoráveis, NENHUM divergente", () => {
    const rows = buildVotoRows({
      deliberacao_id: "delib-indefere",
      nomes: [],
      nomesContra: [],
      nomesAusente: [],
      nomesAbstencao: [],
      diretoresList: ARTESP_DIRETORES,
      activeDiretoresList: ARTESP_DIRETORES, // roster de 4 (1 cadeira vaga)
      inferFromMandate: true,
      resultado: "Indeferido", // desfecho do pleito da concessionária
      unanime: true,
    });

    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.tipo_voto === "Favoravel")).toBe(true);
    expect(rows.every((r) => r.is_nominal === false)).toBe(true); // inferido por unanimidade
    // O CORAÇÃO do fix: aprovar um indeferimento por unanimidade NÃO é divergência.
    expect(rows.every((r) => r.is_divergente === false)).toBe(true);
  });

  it("APROVA/HOMOLOGA por unanimidade (ex.: Nº 10 APROVA): 4 favoráveis não-divergentes", () => {
    const rows = buildVotoRows({
      deliberacao_id: "delib-aprova",
      nomes: [],
      nomesContra: [],
      diretoresList: ARTESP_DIRETORES,
      activeDiretoresList: ARTESP_DIRETORES,
      inferFromMandate: true,
      resultado: "Aprovado",
      unanime: true,
    });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.tipo_voto === "Favoravel" && r.is_divergente === false)).toBe(true);
  });

  it("isDivergentVote: preserva a polaridade no caso NÃO-unânime (relator vencido ANTT/ANM)", () => {
    // Sem unanimidade, um Favorável quando o resultado é Indeferido É divergente (relator
    // vencido): esse comportamento NÃO pode regredir.
    expect(isDivergentVote("Favoravel", "Indeferido")).toBe(true);
    expect(isDivergentVote("Favoravel", "Indeferido", false)).toBe(true);
    // Com unanimidade, nunca é divergente, independentemente do resultado.
    expect(isDivergentVote("Favoravel", "Indeferido", true)).toBe(false);
    expect(isDivergentVote("Favoravel", "Aprovado", true)).toBe(false);
    // Desfavorável contra um resultado positivo continua divergente.
    expect(isDivergentVote("Desfavoravel", "Aprovado")).toBe(true);
  });

  it("guarda: 'unanimidade' textual + contrário NOMEADO (inconsistência) → contrário segue divergente", () => {
    // Se o texto diz unanimidade mas há um contrário extraído, é inconsistência (sinalizada
    // no upload-analysis). buildVotoRows NÃO suprime divergência nesse caso.
    const rows = buildVotoRows({
      deliberacao_id: "delib-inconsistente",
      nomes: [],
      nomesContra: ["Diego Albert Zanatto"],
      diretoresList: ARTESP_DIRETORES,
      activeDiretoresList: ARTESP_DIRETORES,
      inferFromMandate: true,
      resultado: "Aprovado",
      unanime: true, // efetivamente ignorado porque há dissidência nomeada
    });
    const diego = rows.find((r) => r.diretor_id === "d-diego");
    expect(diego?.tipo_voto).toBe("Desfavoravel");
    expect(diego?.is_divergente).toBe(true);
    // Os demais (inferidos favoráveis) alinham-se ao resultado positivo — não divergentes.
    const outros = rows.filter((r) => r.diretor_id !== "d-diego");
    expect(outros.every((r) => r.tipo_voto === "Favoravel" && r.is_divergente === false)).toBe(true);
  });
});
