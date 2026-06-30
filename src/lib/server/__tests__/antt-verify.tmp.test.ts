import { describe, it, expect } from "vitest";
import { parseAnttManualDocument } from "@/lib/server/antt-manual-parser";

const text = `ANTT — 423ª Reunião Deliberativa Eletrônica. Período: 10/06 a 12/06/2026. Diretor-Geral Guilherme Theo Rodrigues da Rocha Sampaio. Diretor Lucas Asfor Rocha Lima. Diretor Felipe Fernandes Queiroz. Processo n° 50500.111222/2026-33 Interessado: Rumo Malha Paulista Assunto: Outorga ferroviária. Decisão: Aprovado por unanimidade pelos diretores presentes.`;

describe("ANTT RDE unanimidade verify", () => {
  it("dumps current behavior", () => {
    const r = parseAnttManualDocument(text, "423a-Reuniao-Deliberativa-Eletronica-ANTT.pdf");
    const item = r.ataItems?.[0];
    console.log("documentType:", r.documentType);
    console.log("item.decisao:", item?.decisao);
    console.log("item.resultado:", item?.resultado);
    console.log("item.unanimidade_detectada:", item?.unanimidade_detectada);
    console.log("item.votos_detectados:", JSON.stringify(item?.votos_detectados));
    console.log("fields.resultado:", r.fields.resultado);
    console.log("diretores_presentes:", JSON.stringify(r.raw.diretores_presentes));
    expect(r.documentType).toBeDefined();
  });
});
