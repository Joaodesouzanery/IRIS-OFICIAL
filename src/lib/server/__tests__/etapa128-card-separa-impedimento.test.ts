/**
 * Etapa 128 (Fase 22, commit 4) — o card do diretor separa impedimento de ausência.
 *
 * "+48 aus/abst" num diretor da ARTESP levantou a pergunta certa: 48 do quê? O dado
 * (`motivo_nao_voto`) existia desde a migration 20260824 e a rota não o selecionava. Agora a
 * agregação é pura, o card mostra "+N aus · +M abst · +K imp" e o título traz as palavras.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { agregarVoto, statVazio } from "@/lib/server/diretor-overview-stat";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");

describe("etapa128 · a agregação distingue os três não-votos", () => {
  it("1 ausência + 1 impedimento + 1 suspeição + 1 abstenção → {ausentes:1, impedidos:2, abstencoes:1}", () => {
    const s = statVazio();
    agregarVoto(s, { tipo_voto: "Ausente", motivo_nao_voto: "ausencia", nominal: true });
    agregarVoto(s, { tipo_voto: "Ausente", motivo_nao_voto: "impedimento", nominal: true });
    agregarVoto(s, { tipo_voto: "Ausente", motivo_nao_voto: "suspeicao", nominal: true });
    agregarVoto(s, { tipo_voto: "Abstencao", is_divergente: true, nominal: true });
    expect(s).toMatchObject({ total: 4, ausentes: 1, impedidos: 2, abstencoes: 1, divergente: 1, favoravel: 0 });
  });

  it("`Ausente` sem motivo (linha antiga, coluna nula) conta como ausência — nunca some", () => {
    const s = statVazio();
    agregarVoto(s, { tipo_voto: "Ausente", motivo_nao_voto: null, nominal: false });
    agregarVoto(s, { tipo_voto: "Ausente", nominal: false });
    expect(s.ausentes).toBe(2);
    expect(s.impedidos).toBe(0);
    expect(s.inferidos).toBe(2);
  });

  it("os efetivos continuam sendo só Favorável + Desfavorável", () => {
    const s = statVazio();
    agregarVoto(s, { tipo_voto: "Favoravel", nominal: false });
    agregarVoto(s, { tipo_voto: "Desfavoravel", is_divergente: true, nominal: true });
    agregarVoto(s, { tipo_voto: "Ausente", motivo_nao_voto: "impedimento", nominal: true });
    expect(s.favoravel + s.desfavoravel).toBe(2);
    expect(s.total).toBe(3);
  });
});

describe("etapa128 · a rota seleciona o motivo e a tela o mostra", () => {
  it("a rota do overview pede `motivo_nao_voto` e usa a agregação pura", () => {
    const rota = ler("src/app/api/v1/dashboard/diretores/overview/route.ts");
    expect(rota).toMatch(/\.select\([`"][^\n]*motivo_nao_voto/); // Fase 25: template literal com join opcional por ano
    expect(rota).toMatch(/agregarVoto\(/);
    expect(rota).toMatch(/impedidos: s\.impedidos,/);
  });

  it("o card mostra os três separados e explica no título", () => {
    const tela = ler("src/app/dashboard/page.tsx");
    expect(tela).toMatch(/d\.impedidos/);
    expect(tela).toMatch(/impedimento\(s\)/);
    expect(tela).not.toMatch(/aus\/abst/);
  });
});
