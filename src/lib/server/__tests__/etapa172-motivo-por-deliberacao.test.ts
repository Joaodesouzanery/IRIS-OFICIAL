/**
 * Etapa 172 (Fase 31, Bloco 2) — UM motivo final por deliberação, para as 45 sem voto.
 *
 * ═══ O defeito ═══
 * O banner dizia "45 deliberação(ões) final(is) ainda sem voto" e, logo abaixo, quatro sub-motivos
 * que PARECIAM decompor as 45. Eles vinham de TRÊS populações diferentes, e **duas eram subtraídas
 * antes de as 45 existirem** (`materializar-faltantes/route.ts:273` e `:289`): `fora_da_janela_*`
 * é estoque sobre TODOS os candidatos; `roster_nao_conferivel` e `sem_evidencia` são parciais do
 * lote rotativo, recontados a cada reexame. Nenhum conjunto somava 45 — e nem deveria. A tela os
 * justapunha como se somasse.
 *
 * E o motivo POR DELIBERAÇÃO era calculado, tipado e descartado: `route.ts:200` monta
 * `{deliberacao_id, motivo, nao_reconhecidos}`, trunca em 20, e `resumo-do-backfill.ts:72` joga
 * fora o id e o motivo para ficar com cinco nomes.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  motivoSemVoto, contarPorMotivo, frasePorMotivo, MOTIVOS_SEM_VOTO, ROTULO_DO_MOTIVO,
  type EntradaDoMotivo, type MotivoSemVoto,
} from "@/lib/server/motivo-sem-voto";
import { resumirBackfill } from "@/lib/server/resumo-do-backfill";

const RAIZ = join(__dirname, "../../../..");
const ler = (p: string) => readFileSync(join(RAIZ, p), "utf-8");
const semComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

/** Uma deliberação que MATERIALIZA — o ponto de partida de cada caso é o caminho feliz. */
const ok = (o: Partial<EntradaDoMotivo> = {}): EntradaDoMotivo => ({
  resultado: "Deferido", agenciaColegiada: true, dataReuniao: "2026-03-25",
  motivoForaDaJanela: null, diretoresNoCadastro: 4, motivoDoRoster: null,
  naoReconhecidos: [], contestado: false, linhasConstruidas: 4, payloadChegou: true, ...o,
});

describe("etapa172 · as categorias são mutuamente exclusivas, em precedência declarada", () => {
  it("o caminho feliz não tem motivo — materializou", () => {
    expect(motivoSemVoto(ok())).toBeNull();
  });

  it.each([
    ["retirado_ou_nao_final", { resultado: "Retirado de Pauta" }],
    ["retirado_ou_nao_final", { resultado: null }],
    ["fora_de_escopo", { agenciaColegiada: false }],
    ["sem_data", { motivoForaDaJanela: "sem_data_de_reuniao" as const }],
    ["sem_data", { dataReuniao: null }],
    ["fora_da_janela_de_mandatos", { motivoForaDaJanela: "anterior_ao_primeiro_mandato" as const }],
    ["falha_tecnica_de_leitura", { payloadChegou: false }],
    ["roster_desconhecido", { diretoresNoCadastro: 0 }],
    ["nome_nao_reconhecido", { motivoDoRoster: "roster_diverge_da_presenca", naoReconhecidos: ["Diretor"] }],
    ["roster_desconhecido", { motivoDoRoster: "cadastro_incompleto", naoReconhecidos: [] }],
    ["contestado_sem_nomes", { linhasConstruidas: 0, contestado: true }],
    ["sem_evidencia_de_votacao", { linhasConstruidas: 0, contestado: false }],
  ] as Array<[MotivoSemVoto, Partial<EntradaDoMotivo>]>)("→ %s", (esperado, o) => {
    expect(motivoSemVoto(ok(o))).toBe(esperado);
  });

  it("⚠️ o «Diretor» GENÉRICO é falha de EXTRAÇÃO, não diretor desconhecido", () => {
    // Achatar os dois mandaria alguém cadastrar uma pessoa que não existe.
    expect(motivoSemVoto(ok({ motivoDoRoster: "roster_vazio", naoReconhecidos: ["Diretor"] })))
      .toBe("nome_nao_reconhecido");
    expect(motivoSemVoto(ok({ motivoDoRoster: "roster_vazio", naoReconhecidos: [] })))
      .toBe("roster_desconhecido");
  });

  it("⚠️ a PRECEDÊNCIA decide quando várias condições valem ao mesmo tempo", () => {
    // Sem data E fora de escopo E sem roster: vale a mais próxima da causa raiz.
    const tudoErrado = ok({
      resultado: "Retirado de Pauta", agenciaColegiada: false, dataReuniao: null,
      diretoresNoCadastro: 0, linhasConstruidas: 0,
    });
    expect(motivoSemVoto(tudoErrado)).toBe("retirado_ou_nao_final");
    expect(motivoSemVoto({ ...tudoErrado, resultado: "Deferido" })).toBe("fora_de_escopo");
    expect(motivoSemVoto({ ...tudoErrado, resultado: "Deferido", agenciaColegiada: true })).toBe("sem_data");
  });

  it("⚠️ `falha_tecnica_de_leitura` vem ANTES de qualquer juízo sobre o conteúdo", () => {
    // Classificar sem ter lido o documento é o erro que quase fez a Fase 28 inferir voto para um
    // colegiado inteiro: `raw_extraction` ausente lido como "ninguém nomeado, nada contestado".
    const semPayload = ok({ payloadChegou: false, diretoresNoCadastro: 0, linhasConstruidas: 0, contestado: true });
    expect(motivoSemVoto(semPayload)).toBe("falha_tecnica_de_leitura");
  });

  it("todo motivo do vocabulário tem rótulo em pt-BR, e nenhum repete", () => {
    for (const m of MOTIVOS_SEM_VOTO) {
      expect(ROTULO_DO_MOTIVO[m], m).toBeTruthy();
      expect(ROTULO_DO_MOTIVO[m].length).toBeGreaterThan(5);
    }
    expect(new Set(Object.values(ROTULO_DO_MOTIVO)).size).toBe(MOTIVOS_SEM_VOTO.length);
  });
});

describe("etapa172 · a contagem e a frase", () => {
  it("contar devolve TODOS os motivos, com zero explícito — nenhum some da lista", () => {
    const c = contarPorMotivo(["sem_data", "sem_data", "fora_de_escopo"]);
    expect(Object.keys(c).sort()).toEqual([...MOTIVOS_SEM_VOTO].sort());
    expect(c.sem_data).toBe(2);
    expect(c.roster_desconhecido).toBe(0);
  });

  it("⚠️ a frase omite os zeros — dez motivos com oito zeros esconderiam os dois que importam", () => {
    const f = frasePorMotivo(contarPorMotivo(["sem_data", "sem_data", "fora_de_escopo"]))!;
    expect(f).toContain("3 sem voto, por motivo");
    expect(f).toContain("2 sem data de reunião");
    expect(f).toContain("1 agência sem colegiado");
    expect(f, "listou motivo com zero").not.toContain("0 ");
  });

  it("do maior para o menor — o que domina aparece primeiro", () => {
    const f = frasePorMotivo({ sem_data: 1, roster_desconhecido: 9 })!;
    expect(f.indexOf("9 ")).toBeLessThan(f.indexOf("1 "));
  });

  it("sem ocorrência nenhuma, frase nenhuma — não se inventa linha vazia no banner", () => {
    expect(frasePorMotivo({})).toBeNull();
    expect(frasePorMotivo(contarPorMotivo([]))).toBeNull();
  });
});

describe("etapa172 · ⚠️ o motivo tem CONSUMIDOR — senão é capacidade sem consumidor de novo", () => {
  it("o resumo transforma o mapa em FRASE (objeto seria descartado em silêncio)", () => {
    // `registrarRodada` e `agregarEtapas` só entendem número e string.
    const r = resumirBackfill({ motivos_sem_voto: { sem_data: 13, roster_desconhecido: 5 } } as never);
    expect(typeof r.motivos_sem_voto).toBe("string");
    expect(String(r.motivos_sem_voto)).toContain("13 sem data de reunião");
  });

  it("sem motivos, a chave nem aparece — não publica string vazia", () => {
    expect(resumirBackfill({} as never).motivos_sem_voto).toBeUndefined();
  });

  it("⚠️ e a TELA lê — o cabo inteiro, do laço ao banner", () => {
    const TELA = ler("src/app/dashboard/deliberacoes/votos-diretores/page.tsx");
    expect(TELA).toMatch(/ultimas\.backfill_votos\?\.motivos_sem_voto/);
    expect(TELA).toMatch(/^\s*motivosSemVoto,$/m);
  });

  it("a rota publica a contagem e quantos gravou", () => {
    const ROTA = semComentarios(ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts"));
    expect(ROTA).toMatch(/motivos_sem_voto: motivosPorCategoria/);
    expect(ROTA).toMatch(/motivos_gravados: motivosGravados/);
  });
});

describe("etapa172 · a gravação não destrói nem classifica no escuro", () => {
  const ROTA = semComentarios(ler("src/app/api/v1/admin/votos/materializar-faltantes/route.ts"));

  it("⚠️⚠️ o `raw_extraction` é MESCLADO — substituí-lo apagaria os baldes de nome", () => {
    expect(ROTA).toMatch(/raw_extraction: \{ \.\.\.base, motivo_sem_voto: motivo \}/);
  });

  it("⚠️ sem o jsonb atual em mãos, NÃO grava — mesclar exige ter o que mesclar", () => {
    expect(ROTA).toMatch(/if \(!base\) continue;/);
  });

  it("a escrita passa por `exigirEscrita` — o caminho quente não engole `{error}`", () => {
    expect(ROTA).toMatch(/exigirEscrita\([\s\S]{0,200}?motivo_sem_voto de \$\{id\}/);
  });

  it("⚠️ tem recheck de orçamento por item, como o laço principal", () => {
    // Sem ele, uma rodada apertada gastaria a fatia carimbando motivo em vez de materializar voto.
    const bloco = ROTA.slice(ROTA.indexOf("let motivosGravados"), ROTA.indexOf("return NextResponse.json({", ROTA.indexOf("let motivosGravados")));
    expect(bloco).toMatch(/hasBudget\(deadlineAt, RESERVA_POR_ITEM_MS\)/);
    expect(bloco).toMatch(/restantes = true; break;/);
  });

  it("⚠️ a linha que o `etapa149` pina NÃO foi tocada — a passada do payload é separada", () => {
    // `if (!pesado) { semPayload++; continue; }` guarda a lição da Fase 28. Acrescentar um push ali
    // quebraria aquele teste sem ganho: o mesmo conjunto sai da passada separada.
    expect(ROTA).toMatch(/if \(!pesado\) \{ semPayload\+\+; continue; \}/);
    expect(ROTA).toMatch(/if \(!motivoPorDeliberacao\.has\(String\(d\.id\)\) && !d\.raw_extraction\)/);
  });

  it("o mapa NÃO tem cap — o cap de 20 existia para o payload HTTP, não para a gravação", () => {
    const bloco = ROTA.slice(ROTA.indexOf("const motivoPorDeliberacao"), ROTA.indexOf("const motivoPorDeliberacao") + 300);
    expect(bloco).not.toMatch(/length < 20/);
  });
});
