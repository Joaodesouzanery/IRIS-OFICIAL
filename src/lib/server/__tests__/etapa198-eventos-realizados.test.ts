/**
 * Etapa 198 (Fase 34, Bloco 6) — os eventos realizados na LP, e as fotos que eu dei por perdidas.
 *
 * ═══ ⚠️ UMA AFIRMAÇÃO MINHA, DESFEITA ═══
 * Eu disse ao usuário que tinha perdido as fotos do deck na compactação do contexto e pedi que ele
 * as mandasse de novo. **A perda não era irreversível**: as onze imagens continuavam no transcript
 * da sessão, em base64, na mesma mensagem em que ele escreveu "Te mandei as fotos dos eventos e
 * seus nomes também". Recuperadas, classificadas olhando uma a uma, e recortadas.
 *
 * ═══ O que a classificação mostrou, e que eu não sabia ═══
 * Das onze páginas, **nove são evento realizado** e **duas são PRODUTO** ("Acesso aos Painéis
 * Temáticos" e "Organização de Missão Internacional", com eyebrow "PRODUTOS EXCLUSIVOS", texto de
 * oferta e selo de desconto para associados). Pô-las na seção de eventos faria a página vender
 * serviço no lugar de mostrar o que o Instituto fez.
 *
 * ⚠️ E o eyebrow do deck NÃO é o classificador: a página do "Painel IRIS PL 733/25" também diz
 * "PRODUTOS EXCLUSIVOS" e é um painel realizado, com data e foto. O que separa é o TÍTULO nomear um
 * evento específico e a página trazer "realizado dia DD/MM/AA".
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { EVENTOS_REALIZADOS } from "@/lib/landing-content";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const EVENTOS = semComentarios(ler("src/components/landing/LpEventos.tsx"));

describe("etapa198 · as nove fotos existem em disco e cabem na página", () => {
  it("são nove eventos realizados, e cada um tem a foto no lugar", () => {
    expect(EVENTOS_REALIZADOS).toHaveLength(9);
    for (const e of EVENTOS_REALIZADOS) {
      const caminho = join(RAIZ, "public", "eventos", e.foto);
      expect(existsSync(caminho), `falta a foto de "${e.titulo}"`).toBe(true);
    }
  });

  it("⚠️ e nenhuma passa de 200 KB — são nove numa grade, e o peso soma", () => {
    for (const e of EVENTOS_REALIZADOS) {
      const kb = statSync(join(RAIZ, "public", "eventos", e.foto)).size / 1024;
      expect(kb, `${e.foto} tem ${Math.round(kb)} KB`).toBeLessThan(200);
    }
  });

  it("as datas são ISO e do passado — «realizado» é uma afirmação de tempo", () => {
    const hoje = "2026-09-27"; // a data em que o deck foi recebido; nenhum realizado é posterior
    for (const e of EVENTOS_REALIZADOS) {
      expect(e.data, `${e.titulo} com data fora do formato`).toMatch(/^20\d{2}-\d{2}-\d{2}$/);
      expect(e.data <= hoje, `${e.titulo} está no futuro`).toBe(true);
    }
  });

  it("nenhum título repete, e nenhuma foto é usada duas vezes", () => {
    expect(new Set(EVENTOS_REALIZADOS.map((e) => e.titulo)).size).toBe(9);
    expect(new Set(EVENTOS_REALIZADOS.map((e) => e.foto)).size).toBe(9);
  });

  it("⚠️ as duas páginas de PRODUTO ficaram de fora", () => {
    // "Acesso aos Painéis Temáticos" e "Organização de Missão Internacional" são oferta, não evento.
    const titulos = EVENTOS_REALIZADOS.map((e) => e.titulo).join(" | ");
    expect(titulos).not.toMatch(/Acesso aos Painéis|Miss[ãa]o Internacional/);
  });

  it("⚠️ e as divergências entre o deck e o calendário estão ESCRITAS, não escolhidas em silêncio", () => {
    // Quatro eventos têm nome ou data diferente no calendário ao vivo. Vale o deck (foi o que o
    // usuário mandou), e a divergência fica registrada para ele decidir.
    const CONTEUDO = ler("src/lib/landing-content.ts");
    for (const pista of ["28/02/2026", "Seminário Iris Free Flow", "Energia e Judiciário", "Brasil-China"]) {
      expect(CONTEUDO, `a divergência "${pista}" sumiu do registro`).toContain(pista);
    }
  });
});

describe("etapa198 · a seção: realizados ANTES da agenda", () => {
  it("⚠️ a ordem é a que o usuário pediu, e o teste a trava", () => {
    // "precisa ter uma parte dos que já tiveram, e depois a agenda" — inverter é fácil num refactor.
    const iRealizados = EVENTOS.indexOf("Eventos realizados");
    const iAgenda = EVENTOS.indexOf("Próximos");
    expect(iRealizados).toBeGreaterThan(-1);
    expect(iAgenda).toBeGreaterThan(iRealizados);
  });

  it("os realizados vêm da lista CURADA; a agenda, do calendário ao vivo", () => {
    expect(EVENTOS).toMatch(/EVENTOS_REALIZADOS\.map/);
    // ⚠️ A agenda continua sendo `fetchIrisEventos` com cache — ela é a única fonte dos futuros, e
    // trocar isso por lista curada faria a página envelhecer sozinha.
    expect(EVENTOS).toMatch(/const eventos = await eventosEmCache\(\);/);
    expect(EVENTOS).toMatch(/from "@\/lib\/server\/iris-eventos"/);
  });

  it("⚠️ a foto confere o DISCO — ausente vira bloco desenhado, não ícone quebrado", () => {
    expect(EVENTOS).toMatch(/existsSync\(join\(process\.cwd\(\), "public", "eventos", e\.foto\)\)/);
    expect(EVENTOS).toMatch(/temFoto \? \(/);
  });

  it("e o vazio da agenda continua NÃO sumindo com a seção", () => {
    // Degradar não pode virar desaparecer: `fetchIrisEventos` devolve [] tanto sem evento futuro
    // quanto quando o calendário não pôde ser lido.
    expect(EVENTOS).toMatch(/eventos\.length === 0 \?/);
  });

  it("⚠️ o número do título sai do array — «9» escrito à mão viraria mentira no décimo", () => {
    expect(EVENTOS).toMatch(/\{EVENTOS_REALIZADOS\.length\} painéis, fóruns e seminários/);
  });

  it("nada da seção virou componente de cliente", () => {
    expect(ler("src/components/landing/LpEventos.tsx")).not.toMatch(/^"use client"/m);
  });
});
