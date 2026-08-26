import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSemanticDuplicateKey } from "@/lib/server/regulatory-documents";

/**
 * A CHAVE SEMÂNTICA não pode fundir documentos diferentes.
 *
 * `semantic_duplicate_key` é lida em dois pontos que ESCONDEM a linha perdedora — `pipeline.ts`
 * (marca `is_duplicate` contra os `confirmed`) e `upload-analysis.ts` (casa contra a própria fila).
 * Ela caía de `numero_deliberacao` para `numero_reuniao` em QUALQUER tipo, e o número da reunião é
 * dado do RECIPIENTE: os cinco votos da 1.036ª recebiam `antt|voto individual|1036` — a mesma
 * chave. Quatro sumiriam como "duplicata" do primeiro.
 *
 * A assimetria que estes testes travam: não fundir duas cópias gera uma linha repetida que o
 * revisor resolve; fundir dois documentos diferentes apaga um voto sem deixar rastro.
 */

const raiz = resolve(__dirname, "../../../..");

describe("etapa71 · chave semântica não funde documentos diferentes", () => {
  it("os cinco votos da MESMA reunião recebem cinco chaves distintas", () => {
    const arquivos = [
      "Voto DG 026-2026.pdf",
      "Voto DFQ 042-2026.pdf",
      "Voto DFQ 043-2026.pdf",
      "Voto DFQ 044-2026.pdf",
      "Voto DAB 030-2026.pdf",
    ];
    const chaves = arquivos.map((filename) =>
      buildSemanticDuplicateKey({
        agencia_sigla: "ANTT",
        tipo_documento: "voto_individual",
        numero_deliberacao: null,
        numero_reuniao: "1036",
        data_reuniao: "2026-07-02",
        filename,
      }),
    );

    expect(chaves.every((c) => typeof c === "string" && c.length > 0)).toBe(true);
    expect(new Set(chaves).size).toBe(arquivos.length);
  });

  it("votos da MESMA matéria, na mesma data, por diretores diferentes, não colidem", () => {
    const base = {
      agencia_sigla: "ARTESP",
      tipo_documento: "voto_individual",
      numero_deliberacao: null,
      numero_reuniao: null,
      data_reuniao: "2026-05-14",
      processo: "50500.123456/2026-11",
    };
    const a = buildSemanticDuplicateKey({ ...base, filename: "Voto Diretor A.pdf" });
    const b = buildSemanticDuplicateKey({ ...base, filename: "Voto Diretor B.pdf" });

    expect(a).not.toBe(b);
  });

  it("GUARDA DE FALSO POSITIVO: o MESMO voto re-baixado converge na MESMA chave", () => {
    const voto = {
      agencia_sigla: "ANTT",
      tipo_documento: "voto_individual",
      numero_deliberacao: null,
      numero_reuniao: "1036",
      data_reuniao: "2026-07-02",
    };
    const primeira = buildSemanticDuplicateKey({ ...voto, filename: "Voto DFQ 043-2026.pdf" });
    const reBaixado = buildSemanticDuplicateKey({ ...voto, filename: "Voto DFQ 043-2026 (1).pdf" });

    expect(primeira).toBe(reBaixado);
    // Se a dedup do caso legítimo morresse, o conserto teria trocado um bug por outro.
    expect(primeira).not.toBeNull();
  });

  it("ata e pauta CONTINUAM identificadas pelo número da reunião — há uma só por reunião", () => {
    const paraTipo = (tipo_documento: string) =>
      buildSemanticDuplicateKey({
        agencia_sigla: "ANTT",
        tipo_documento,
        numero_deliberacao: null,
        numero_reuniao: "1036",
        data_reuniao: "2026-07-02",
        filename: "Ata 1036.pdf",
      });

    expect(paraTipo("ata")).toBe("antt|ata|1036");
    expect(paraTipo("pauta")).toBe("antt|pauta|1036");
  });

  it("o número PRÓPRIO do documento continua sendo a identidade — chave inalterada", () => {
    // Mudar esta chave criaria um ponto cego contra tudo que já está gravado em produção.
    const chave = buildSemanticDuplicateKey({
      agencia_sigla: "ARTESP",
      tipo_documento: "deliberacao",
      numero_deliberacao: "123",
      numero_reuniao: "1177",
      data_reuniao: "2026-05-14",
      filename: "Deliberacao 123.pdf",
    });

    expect(chave).toBe("artesp|deliberacao|123");
  });

  it("deliberação sem número próprio é identificada pela MATÉRIA, não pelo nome do arquivo", () => {
    // Duas cópias da mesma deliberação, com nomes de arquivo diferentes, ainda deduplicam.
    const base = {
      agencia_sigla: "ARTESP",
      tipo_documento: "deliberacao",
      numero_deliberacao: null,
      numero_reuniao: null,
      data_reuniao: "2026-05-14",
      processo: "50500.123456/2026-11",
    };

    expect(buildSemanticDuplicateKey({ ...base, filename: "del-a.pdf" }))
      .toBe(buildSemanticDuplicateKey({ ...base, filename: "outro-nome.pdf" }));
  });

  it("tipo FORA do mapa não é presumido único por reunião", () => {
    // O default governa `documento_apoio`, `resolucao`, `outro` — e uma reunião tem VÁRIOS
    // documentos de apoio. Presumir "um por reunião" para quem não está no mapa recriaria a
    // colisão com outra roupa, agora sem ninguém olhando.
    const paraArquivo = (filename: string) =>
      buildSemanticDuplicateKey({
        agencia_sigla: "ANTT",
        tipo_documento: "documento_apoio",
        numero_deliberacao: null,
        numero_reuniao: "1036",
        data_reuniao: "2026-07-02",
        processo: null,
        filename,
      });

    expect(paraArquivo("nota tecnica 12.pdf")).not.toBe(paraArquivo("parecer juridico 9.pdf"));
  });

  it("o mesmo nome de arquivo em reuniões DIFERENTES não colide", () => {
    // Justifica manter o número da reunião na chave: ele estreita o escopo do desempatador.
    const paraReuniao = (numero_reuniao: string) =>
      buildSemanticDuplicateKey({
        agencia_sigla: "ARTESP",
        tipo_documento: "voto_individual",
        numero_deliberacao: null,
        numero_reuniao,
        data_reuniao: null,
        processo: null,
        filename: "voto.pdf",
      });

    expect(paraReuniao("1177")).not.toBe(paraReuniao("1178"));
  });

  it("sem NADA que varie por documento, devolve null em vez de uma chave que funde tudo", () => {
    const chave = buildSemanticDuplicateKey({
      agencia_sigla: "ARTESP",
      tipo_documento: "voto_individual",
      numero_deliberacao: null,
      numero_reuniao: null,
      data_reuniao: null,
      processo: null,
      filename: null,
    });

    // "artesp|voto individual" faria TODO voto da agência colidir com todo outro.
    expect(chave).toBeNull();
  });

  it("null desliga a dedup semântica — os dois consumidores checam a chave antes de casar", () => {
    const pipeline = readFileSync(resolve(raiz, "src/lib/server/pipeline.ts"), "utf-8");
    const analysis = readFileSync(resolve(raiz, "src/lib/server/upload-analysis.ts"), "utf-8");

    // Sem esta guarda, `null` viraria `.eq("semantic_duplicate_key", null)` e casaria linha errada.
    expect(pipeline).toMatch(/if\s*\(analysis\.semantic_duplicate_key\)/);
    expect(analysis).toMatch(/if\s*\(!semantic_duplicate\s*&&\s*semanticKeyForDedup\)/);
  });
});
