/**
 * Etapa 82 (Fase 13) — voto nominal com nome que não é gente: as três camadas.
 *
 * ═══ O caso real ═══
 * TODOS os votos nominais da ARTESP em produção eram lixo — e a conta fecha: "Função Confiança
 * Quantidadenível" (3), "Confiança Quantidadenível" (1), "Uma Vez Que" (1) = 5 votos, exatamente
 * os 2+3 nominais que a medição sempre mostrou (2025+2026). São cabeçalhos de TABELA de anexo de
 * resolução ("Função / Confiança / Quantidade / Nível") que passaram no isStrictPersonName,
 * viraram candidatos, o aprovar-lote os promoveu a diretores APROVADOS (apareciam em ≥2
 * documentos — cabeçalho de tabela reaparece!) e ganharam voto nominal retroativo.
 *
 * ═══ As camadas ═══
 * 1. SISTÊMICA: `capacidadeNominal` já sabia que ARTESP|deliberacao = "nenhum" (a fonte NUNCA
 *    nomina) — e ninguém consumia isso no caminho do voto. Fonte que não nomina não produz voto
 *    nominal de nomes extraídos, não gera candidato de diretor, não cria pessoa nova.
 * 2. `isStrictPersonName` endurecido com o vocabulário do lixo REAL + teto de tamanho de token
 *    (o "Quantidadenível", 15 chars — palavras coladas de tabela; nenhum sobrenome comum passa
 *    de 14).
 * 3. A inferência por presença/mandato CONTINUA — é ela que dá os votos verdadeiros da ARTESP.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fonteNominaVotos } from "@/lib/server/colegiado-sources";
import { isStrictPersonName } from "@/lib/server/name-matcher";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8")
  .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

describe("etapa82 · camada 1: a capacidade da fonte vira gate", () => {
  it("ARTESP nunca nomina em deliberação/ata; ANTT nomina no voto individual", () => {
    expect(fonteNominaVotos("ARTESP", "deliberacao")).toBe(false);
    expect(fonteNominaVotos("ARTESP", "ata")).toBe(false);
    expect(fonteNominaVotos("ANTT", "voto_individual")).toBe(true);
    // ANM é "parcial" (nomina em dissenso) — não pode ser cortada.
    expect(fonteNominaVotos("ANM", "ata")).toBe(true);
    // Agência desconhecida: não afirma limite que não medimos.
    expect(fonteNominaVotos(null, "ata")).toBe(true);
  });

  it("upload-analysis ZERA os baldes nominais quando a fonte não nomina — SÓ no caminho genérico", () => {
    const codigo = ler("src/lib/server/upload-analysis.ts");
    // ⚠️ O `!antt.isAntt` é parte da correção, não detalhe: a ANTT atribui voto de ata por
    // presença+unanimidade usando ESTES baldes de forma curada — cortá-la converteria centenas
    // de votos nominais reais em inferidos. Mutação que remove o guard tem de ficar vermelha.
    expect(codigo).toMatch(/if \(!antt\.isAntt && !fonteNominaVotos\(agencia_sigla_detected, tipo_documento\)\)/);
    // O aviso informativo acompanha — descarte silencioso é o anti-padrão da casa.
    expect(codigo).toMatch(/não nomina votos|nao nomina votos/i);
  });

  it("aprovar-lote não CRIA pessoa nova a partir de fonte que não nomina", () => {
    const codigo = ler("src/app/api/v1/diretores/candidatos/aprovar-lote/route.ts");
    expect(codigo).toMatch(/fonteNominaVotos\(/);
  });

  it("o confirm não gera CANDIDATO de diretor a partir de fonte que não nomina — nos TRÊS sítios", () => {
    // recordDirectorCandidates tem 3 chamadores (relator do voto, itens de ata, avulso).
    // Assertar só a presença deixava 2 deles desprotegidos (mutação provou).
    const codigo = ler("src/app/api/v1/upload/confirm/route.ts");
    const gates = codigo.match(/&& fonteNominaVotos\(siglaPorId\.get\(effectiveAgenciaId\)/g) ?? [];
    expect(gates.length).toBe(3);
  });
});

describe("etapa82 · camada 2: isStrictPersonName contra o lixo REAL de produção", () => {
  it.each([
    "Função Confiança Quantidadenível",
    "Confiança Quantidadenível",
    "Uma Vez Que",
    "Renovação De Frota",
  ])("«%s» é rejeitado", (nome) => {
    expect(isStrictPersonName(nome)).toBe(false);
  });

  it.each([
    // GUARDA DE FALSO NEGATIVO: gente de verdade, incluindo as armadilhas.
    "Fernanda Esbízaro Rodrigues Rudnik",
    "Tasso Mendonça Junior",
    "Guilherme Theo Rodrigues da Rocha Sampaio",
    "Maria da Assunção Vasconcellos", // sobrenome que parece substantivo abstrato + 12 chars
    "André Isper Rodrigues Barnabé",
  ])("«%s» continua aceito", (nome) => {
    expect(isStrictPersonName(nome)).toBe(true);
  });
});
