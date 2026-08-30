/**
 * Etapa 83 (Fase 13, passo 4) — "Ausência Justificada" vira ausência REGISTRADA, não omissão.
 *
 * O passo 4 da fase abriu o PDF real das 10 "divergentes" da ARTESP (reunião 1198ª, 09/06/2026)
 * e fechou a questão: não há bug — a capa declara, estruturado:
 *
 *   "Ausência Justificada: Raquel França Carneiro - Diretora - Afastamento em Férias."
 *
 * e só os 3 presentes assinam. Os 3-de-4 votos estavam CERTOS. Mas o extrator não conhecia o
 * rótulo ("Ausente:" sim; "Ausência Justificada:" não), então a diretora virava OMISSÃO — a
 * mesma aparência de um voto perdido, indistinguível na auditoria. Registrada como `Ausente`,
 * a deliberação fica COMPLETA (3 votos + 1 ausência) e a auditoria para de acusar divergência.
 */

import { describe, it, expect } from "vitest";
import { extractFields } from "@/lib/server/nlp-extractor";

/** Trecho REAL da Deliberação ARTESP nº 411 (verbatim do PDF baixado). */
const TRECHO = `DELIBERAÇÃO ARTESP Nº 411, DE 09 DE JUNHO DE 2026
1198ª Reunião Ordinária do Conselho Diretor.
Processo SEI! nº 134.00021183/2025-01.
Interessado: Agência Reguladora de Serviços Públicos Delegados de Transporte do Estado de São Paulo - ARTESP
Ausência Justificada: Raquel França Carneiro - Diretora - Afastamento em Férias.
Houve aprovação dos presentes por unanimidade de votos.`;

describe("etapa83 · o rótulo real da ARTESP", () => {
  it("«Ausência Justificada:» põe a diretora no balde de ausentes", () => {
    const f = extractFields(TRECHO);
    expect(f.nomes_votacao_ausente).toContain("Raquel França Carneiro");
  });

  it("a ausente NÃO aparece como votante a favor", () => {
    const f = extractFields(TRECHO);
    expect(f.nomes_votacao_favor ?? []).not.toContain("Raquel França Carneiro");
  });

  it("GUARDA: o rótulo antigo «Ausente:» continua funcionando", () => {
    const f = extractFields("Ata da reunião.\nAusente: Tasso Mendonça Junior.\nAprovado por unanimidade.");
    expect(f.nomes_votacao_ausente).toContain("Tasso Mendonça Junior");
  });

  it("GUARDA: prosa com a palavra «ausência» solta não fabrica ausente", () => {
    const f = extractFields("A ausência de impugnações permitiu a homologação do certame. Aprovado.");
    expect(f.nomes_votacao_ausente ?? []).toEqual([]);
  });
});
