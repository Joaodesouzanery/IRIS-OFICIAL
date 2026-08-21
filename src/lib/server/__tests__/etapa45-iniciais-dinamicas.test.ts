import { describe, it, expect, afterEach } from "vitest";
import {
  buildAnttDirectorInitials,
  setAnttDynamicInitials,
  isAnttVotoFilename,
} from "@/lib/server/antt-manual-parser";

// Ago/2026: as iniciais dos votos ANTT ("Voto DFQ 035-2026") derivam do CADASTRO — na troca
// de diretoria, o código novo resolve sem deploy. Hardcode curado vence em conflito; código
// ambíguo (geraria 2 diretores) é descartado.

afterEach(() => setAnttDynamicInitials({}));

describe("buildAnttDirectorInitials [etapa45]", () => {
  it("deriva os códigos reais da diretoria atual a partir dos nomes completos", () => {
    const map = buildAnttDirectorInitials([
      { nome: "Lucas Asfor Rocha Lima" },
      { nome: "Felipe Fernandes Queiroz" },
      { nome: "Alessandro Baumgartner" },
      { nome: "Severino Medeiros Ramos Neto", nome_variantes: ["Severino Medeiros"] },
    ]);
    expect(map.DLA).toBe("Lucas Lima");        // D + L(ucas) + A(sfor)
    expect(map.DFQ).toBe("Felipe Queiroz");    // D + F + Q
    expect(map.DAB).toBe("Alessandro Baumgartner");
    expect(map.DSM).toBe("Severino Neto");     // via variante "Severino Medeiros"
  });

  it("código que casaria 2 diretores é descartado (ambíguo)", () => {
    const map = buildAnttDirectorInitials([
      { nome: "Ana Beatriz Souza" },  // DAB
      { nome: "Antonio Barbosa Melo" }, // DAB também
    ]);
    expect(map.DAB).toBeUndefined();
  });

  it("diretoria NOVA: 'Voto DXY' passa a ser reconhecido sem deploy", () => {
    expect(isAnttVotoFilename("Voto DXY 10-2026.pdf")).toBe(false); // fora do curado
    setAnttDynamicInitials(buildAnttDirectorInitials([{ nome: "Xavier Yamada Costa" }]));
    expect(isAnttVotoFilename("Voto DXY 10-2026.pdf")).toBe(true);  // cadastro resolve
  });

  it("hardcode curado VENCE o dinâmico em conflito (DFQ segue Felipe Queiroz)", () => {
    setAnttDynamicInitials({ DFQ: "Fulano Qualquer" });
    // isAnttVotoFilename continua aceitando DFQ (existe no mapa efetivo)
    expect(isAnttVotoFilename("Voto DFQ 035-2026.pdf")).toBe(true);
  });
});
