/**
 * Etapa 177 (Fase 31, Bloco 3) — o guard de roster entra na porta PRINCIPAL, e a promessa falsa sai.
 *
 * ═══ O que estava aberto ═══
 * `conferirRoster` — o guard de 3 camadas escrito na Fase 20 para impedir "voto gravado no nome
 * errado" — tinha **um único call-site em produção**: `materializar-faltantes:406`, o backfill
 * retroativo. `upload/confirm`, que é a porta por onde todo documento novo entra, calculava o roster
 * e gravava voto **sem conferir nada**.
 *
 * Então o guard protegia metade do caminho, e a metade desprotegida é a que recebe o acervo novo.
 *
 * ═══ E a promessa que não se cumpria ═══
 * `roster-conferivel.ts` dizia, no `return` do resíduo: *"o veredito viaja para a proveniência, para
 * quem lê a métrica saber que ninguém conferiu este roster"*. Dois fatos medidos desmentem:
 *
 * 1. `roster_nao_conferivel` não é valor de `ProvenienciaVoto`, e o CHECK da coluna só admite quatro
 *    (`20260824120000_votos_proveniencia.sql:42-44`). Precisaria migration.
 * 2. O único consumidor do veredito é o ramo `if (!confiavel)` do materializador — e aquele `return`
 *    é `confiavel: true`. **O veredito é descartado exatamente no caso sobre o qual o comentário
 *    falava.**
 *
 * Era `capacidade-sem-consumidor` escrita em prosa, no arquivo que existe para dar confiança.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  conferirRoster,
  GUARD_DE_ROSTER_NO_CONFIRM,
  type MotivoDoRoster,
} from "@/lib/server/roster-conferivel";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const CONFIRM = semComentarios(ler("src/app/api/v1/upload/confirm/route.ts"));
const GUARD_RAW = ler("src/lib/server/roster-conferivel.ts");

const ROSTER_ANM = [
  { id: "mauro", nome: "Mauro Henrique Moreira Sousa", nome_variantes: [] },
  { id: "caio", nome: "Caio Mário Trivellato Seabra Filho", nome_variantes: [] },
  { id: "jose", nome: "José Fernando Gomes Júnior", nome_variantes: [] },
];

describe("etapa177 · o guard chega ao caminho primário — medido, recusa desligada", () => {
  it("⚠️ `GUARD_DE_ROSTER_NO_CONFIRM` é false — remover voto é mudança de número público", () => {
    expect(GUARD_DE_ROSTER_NO_CONFIRM).toBe(false);
  });

  it("⚠️ `upload/confirm` agora CHAMA `conferirRoster` — antes era o único caminho sem guard", () => {
    expect(CONFIRM).toMatch(/conferirRoster\(\{/);
    expect(CONFIRM).toMatch(/roster: rosterBruto/);
    expect(CONFIRM).toMatch(/nomesPresentes: d\.nomes_presentes \?\? \[\]/);
  });

  it("a MEDIÇÃO roda sempre; só a RECUSA fica atrás da flag", () => {
    // Se a medição fosse gated, o número que decide nunca apareceria.
    expect(CONFIRM).toMatch(/if \(!vereditoRoster\.confiavel\) rosterRecusadoPeloGuard\+\+;/);
    expect(CONFIRM).toMatch(
      /const activeDiretoresList = GUARD_DE_ROSTER_NO_CONFIRM && !vereditoRoster\.confiavel\s*\?\s*\[\]\s*:\s*rosterBruto;/,
    );
  });

  it("e o número é PUBLICADO junto do estado da flag", () => {
    expect(CONFIRM).toMatch(/roster_recusado_pelo_guard: rosterRecusadoPeloGuard/);
    expect(CONFIRM).toMatch(/guard_de_roster_ativo: GUARD_DE_ROSTER_NO_CONFIRM/);
  });

  it("a contagem de candidatos pendentes é CACHEADA por agência", () => {
    // Um lote de 50 documentos da mesma agência faria 50 vezes o mesmo COUNT.
    expect(CONFIRM).toMatch(/candidatosPendentesCache/);
    const i = CONFIRM.indexOf("async function candidatosPendentesNoConfirm");
    expect(CONFIRM.slice(i, i + 400)).toMatch(/const hit = candidatosPendentesCache\.get\(agenciaId\);/);
  });

  it("⚠️ erro na contagem vira ZERO — e zero só desliga a camada 3, não afirma completude", () => {
    // Um erro não pode DECLARAR que o cadastro está incompleto (isso bloquearia voto legítimo), nem
    // que está completo. Zero deixa as camadas 1 e 2 decidirem, que é o comportamento neutro.
    expect(CONFIRM).toMatch(/const n = error \? 0 : count \?\? 0;/);
  });
});

describe("etapa177 · ⚠️ a camada 1 é a que pega o caso da 79ª ROP", () => {
  it("preâmbulo com nome que o cadastro não reconhece → NÃO confiável", () => {
    // O caso real: a ata da 79ª nomeia Tasso e Roger, que não estão no roster de mandato.
    const v = conferirRoster({
      roster: ROSTER_ANM,
      nomesPresentes: [
        "Mauro Henrique Moreira Sousa", "Tasso Mendonça Júnior",
        "Roger Romão Cabral", "José Fernando Gomes Júnior",
      ],
    });
    expect(v.confiavel).toBe(false);
    expect(v.motivo).toBe<MotivoDoRoster>("roster_diverge_da_presenca");
    expect(v.naoReconhecidos).toContain("Tasso Mendonça Júnior");
    expect(v.naoReconhecidos).toContain("Roger Romão Cabral");
  });

  it("preâmbulo que casa inteiro → confiável", () => {
    const v = conferirRoster({
      roster: ROSTER_ANM,
      nomesPresentes: ["Mauro Henrique Moreira Sousa", "José Fernando Gomes Júnior"],
    });
    expect(v.confiavel).toBe(true);
    expect(v.motivo).toBe<MotivoDoRoster>("roster_confere_com_presenca");
  });

  it("e a camada 1 CORTA a 3 — quem estava na sala é o preâmbulo, não o corpus", () => {
    const v = conferirRoster({
      roster: ROSTER_ANM,
      nomesPresentes: ["Mauro Henrique Moreira Sousa"],
      candidatosPendentes: 5,
    });
    expect(v.motivo).toBe<MotivoDoRoster>("roster_confere_com_presenca");
    expect(v.confiavel).toBe(true);
  });

  it("⚠️ a camada 2 é INALCANÇÁVEL no confirm — `signatarios` não chega no payload", () => {
    // Não é defeito desta rodada; é escopo que fica registrado. O guard tem 3 camadas e a porta
    // principal só pode usar 2.
    expect(CONFIRM, "signatarios passou a existir no confirm — ligue a camada 2")
      .not.toMatch(/signatarios/);
    const TIPOS = ler("src/types/index.ts");
    expect(TIPOS, "signatarios entrou no payload — ligue a camada 2 no confirm")
      .not.toMatch(/signatarios\?:/);
  });
});

describe("etapa177 · ⚠️ a promessa falsa saiu do comentário", () => {
  it("o `return` do resíduo não promete mais que o veredito vai à proveniência", () => {
    const i = GUARD_RAW.indexOf('motivo: "roster_nao_conferivel"');
    expect(i).toBeGreaterThan(-1);
    const antes = GUARD_RAW.slice(Math.max(0, i - 1800), i);
    expect(antes, "a promessa falsa voltou")
      .not.toMatch(/veredito\s*\n?\s*\*?\s*viaja para a proveniência, para quem lê a métrica/);
  });

  it("e o comentário diz POR QUE não viaja — os dois fatos medidos", () => {
    const i = GUARD_RAW.indexOf('motivo: "roster_nao_conferivel"');
    const antes = GUARD_RAW.slice(Math.max(0, i - 1800), i);
    expect(antes).toMatch(/não é valor de `ProvenienciaVoto`/);
    expect(antes).toMatch(/20260824120000_votos_proveniencia\.sql/);
    expect(antes).toMatch(/descartado/);
  });

  it("o fato 1 é verdade: `proveniencia` não admite o valor sem migration", () => {
    const MIG = ler("supabase/migrations/20260824120000_votos_proveniencia.sql");
    expect(MIG).toMatch(/votos_proveniencia_check/);
    expect(MIG, "o CHECK passou a admitir o valor — atualize o comentário do guard")
      .not.toMatch(/roster_nao_conferivel/);
    const INF = ler("src/lib/server/vote-inference.ts");
    expect(INF, "ProvenienciaVoto ganhou o valor — atualize o comentário do guard")
      .not.toMatch(/\|\s*"roster_nao_conferivel"/);
  });

  it("o fato 2 é verdade: TODO uso do veredito está dentro do ramo `!confiavel`", () => {
    const MOTOR = semComentarios(ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts"));
    const inicio = MOTOR.indexOf("if (!vereditoRoster.confiavel) {");
    expect(inicio, "o ramo do guard sumiu do materializador").toBeGreaterThan(-1);
    // O ramo termina no `continue;` que impede a escrita do voto.
    const fim = MOTOR.indexOf("continue;", inicio);
    expect(fim).toBeGreaterThan(inicio);

    // ⚠️ A primeira versão exigia UM uso e reprovou o código por estar certo: o motivo é lido duas
    // vezes, nas duas dentro do ramo (para `motivoSemVoto` e para `detalheRoster`). A propriedade
    // que sustenta o comentário não é "usado uma vez" — é "nenhum uso FORA do ramo", porque é isso
    // que faz o veredito ser descartado no caso `confiavel: true`.
    const usos: number[] = [];
    const re = /vereditoRoster\.motivo/g;
    for (let m = re.exec(MOTOR); m; m = re.exec(MOTOR)) usos.push(m.index);
    expect(usos.length, "o veredito deixou de ser lido").toBeGreaterThan(0);
    for (const u of usos) {
      expect(u, `uso do veredito FORA do ramo !confiavel (posição ${u}) — atualize o comentário`)
        .toBeGreaterThan(inicio);
      expect(u, `uso do veredito depois do ramo (posição ${u}) — atualize o comentário`)
        .toBeLessThan(fim);
    }
  });
});
