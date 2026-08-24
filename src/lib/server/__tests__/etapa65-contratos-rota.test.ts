/**
 * Etapa 65 — CONTRATO DE FORMA das rotas de leitura.
 *
 * `api.get<T>` termina em `res.json() as Promise<T>`: o `T` do call-site é ASSERÇÃO, não
 * verificação. Se a rota mudar de forma — array vira envelope, campo some — o `tsc` fica VERDE e a
 * tela quebra em runtime. Foi assim que a Saúde dos Dados nunca renderizou: tipada como
 * `AgenciaGov[]` contra uma rota que devolve `{ por_agencia: [...] }`.
 *
 * Medido no repo: 179 call-sites de `api.*`, dos quais 69 declaram ARRAY; 128 rotas, das quais
 * apenas 6 têm qualquer amarração de compilação e UMA tinha teste de contrato.
 *
 * ⚠️ Este teste importa os HANDLERS REAIS. O teste da etapa64 não fazia isso — testava uma réplica
 * local da derivação do consumidor, então blindava o consumidor e não o contrato: se a rota
 * trocasse o envelope por array cru, ele continuaria verde. Aqui o ramo demo (que roda ANTES do
 * guard de auth e NÃO toca o banco) é o que torna isso barato.
 *
 * O snapshot de chaves é EXPLÍCITO, nunca `toMatchSnapshot`: mudar a forma tem de exigir editar
 * este arquivo e explicar por quê.
 */

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";

import { GET as overview } from "@/app/api/v1/dashboard/overview/route";
import { GET as microtemas } from "@/app/api/v1/dashboard/microtemas/route";
import { GET as governancaAgencias } from "@/app/api/v1/dashboard/governanca-agencias/route";
import { GET as consensoTimeline } from "@/app/api/v1/votacao/consenso-timeline/route";
import { GET as mandatosAnalytics } from "@/app/api/v1/mandatos/analytics/route";
import { GET as mandatosStats } from "@/app/api/v1/mandatos/stats/route";
import { GET as diretores } from "@/app/api/v1/diretores/route";
import { GET as empresas } from "@/app/api/v1/empresas/route";
import { GET as alertas } from "@/app/api/v1/alertas/route";
import { GET as reunioes } from "@/app/api/v1/reunioes/route";
import { GET as saudeDados } from "@/app/api/v1/admin/saude-dados/route";
import { GET as completude } from "@/app/api/v1/admin/completude-2026/route";
import { GET as naoEnfileirados } from "@/app/api/v1/admin/monitoramento/nao-enfileirados/route";
import { GET as pendenciasVoto } from "@/app/api/v1/admin/upload/pendencias-voto/route";

type Handler = (req: NextRequest) => Promise<Response>;

/** O ramo demo roda ANTES do guard de auth e não abre conexão — por isso o teste é barato. */
function reqDemo(path: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1${path}`, { headers: { "x-iris-demo": "1" } });
}

/**
 * `forma`:
 *   "array"    → o consumidor pode fazer `.map`/`.reduce` direto no payload;
 *   "envelope" → é objeto, e as chaves de topo estão travadas abaixo.
 */
const ROTAS: Array<{
  nome: string;
  path: string;
  handler: Handler;
  forma: "array" | "envelope";
  /** Chaves de topo obrigatórias (envelope). Presença, não valor. */
  chaves?: string[];
  /** Chaves de topo que TÊM de ser array — é onde o `.map` do consumidor mora. */
  arrays?: string[];
}> = [
  { nome: "dashboard/overview", path: "/dashboard/overview", handler: overview as Handler, forma: "envelope",
    chaves: ["total_deliberacoes", "deferidos", "indeferidos", "total_decidido", "taxa_deferimento"] },
  { nome: "dashboard/microtemas", path: "/dashboard/microtemas", handler: microtemas as Handler, forma: "array" },
  { nome: "dashboard/governanca-agencias", path: "/dashboard/governanca-agencias", handler: governancaAgencias as Handler,
    forma: "envelope", chaves: ["por_agencia"], arrays: ["por_agencia"] },
  { nome: "votacao/consenso-timeline", path: "/votacao/consenso-timeline", handler: consensoTimeline as Handler, forma: "array" },
  { nome: "mandatos/analytics", path: "/mandatos/analytics", handler: mandatosAnalytics as Handler, forma: "envelope",
    chaves: ["total_deliberacoes", "total_decidido", "total_com_voto", "taxa_litigio", "taxa_consenso", "taxa_sancao",
             "distribuicao_decisao", "evolucao_mensal"],
    arrays: ["distribuicao_decisao", "evolucao_mensal"] },
  { nome: "mandatos/stats", path: "/mandatos/stats", handler: mandatosStats as Handler, forma: "envelope" },
  { nome: "diretores", path: "/diretores", handler: diretores as Handler, forma: "array" },
  { nome: "empresas", path: "/empresas", handler: empresas as Handler, forma: "array" },
  { nome: "alertas", path: "/alertas", handler: alertas as Handler, forma: "array" },
  { nome: "reunioes", path: "/reunioes", handler: reunioes as Handler, forma: "array" },
  { nome: "admin/saude-dados", path: "/admin/saude-dados", handler: saudeDados as Handler, forma: "envelope",
    chaves: ["por_agencia"], arrays: ["por_agencia"] },
  { nome: "admin/completude-2026", path: "/admin/completude-2026", handler: completude as Handler, forma: "envelope",
    chaves: ["modo", "ano", "por_agencia", "totais", "alertas"], arrays: ["por_agencia", "alertas"] },
  { nome: "admin/monitoramento/nao-enfileirados", path: "/admin/monitoramento/nao-enfileirados", handler: naoEnfileirados as Handler,
    forma: "envelope", chaves: ["total_nao_enfileirados", "grupos", "falhas_extracao"],
    arrays: ["grupos", "falhas_extracao"] },
  { nome: "admin/upload/pendencias-voto", path: "/admin/upload/pendencias-voto", handler: pendenciasVoto as Handler,
    forma: "envelope", chaves: ["total_pendentes", "confirmaveis", "motivos", "amostras", "por_tipo"],
    arrays: ["motivos", "amostras", "por_tipo"] },
];

describe("etapa65 · contrato de forma (handlers REAIS, ramo demo)", () => {
  it.each(ROTAS)("$nome — a forma é a que o consumidor assume", async (r) => {
    const res = await r.handler(reqDemo(r.path));
    expect(res.status, `${r.nome} não respondeu 200 no ramo demo`).toBe(200);
    const body = await res.json();

    if (r.forma === "array") {
      // É este o caso que derruba tela: o consumidor faz `.reduce` direto. `?? []` NÃO protege —
      // testa `undefined`, não forma, e um objeto é truthy.
      expect(Array.isArray(body), `${r.nome} deveria ser ARRAY e veio ${typeof body}`).toBe(true);
      return;
    }

    expect(Array.isArray(body), `${r.nome} deveria ser ENVELOPE e veio array`).toBe(false);
    expect(body, `${r.nome} deveria ser objeto`).toBeTypeOf("object");
    for (const chave of r.chaves ?? []) {
      expect(Object.keys(body as object), `${r.nome} perdeu a chave "${chave}"`).toContain(chave);
    }
    for (const chave of r.arrays ?? []) {
      expect(Array.isArray((body as Record<string, unknown>)[chave]),
        `${r.nome}.${chave} tem de ser array — é onde o consumidor faz .map`).toBe(true);
    }
  }, 20_000);
});

describe("etapa65 · paridade demo × real", () => {
  it("os 4 ramos demo corrigidos publicam os campos que o real publica", async () => {
    // Cada um destes fazia um painel sumir em silêncio, porque o cast não checado entrega
    // `undefined` sem ninguém reclamar. E o ramo demo É alcançável em produção:
    // `attachRuntimeHeaders` injeta `x-iris-demo: 1` a partir do localStorage.
    const naoEnf = await (await naoEnfileirados(reqDemo("/admin/monitoramento/nao-enfileirados"))).json();
    expect(naoEnf.total_nao_enfileirados, "painel sumia sem este campo").toBe(0);

    const pend = await (await pendenciasVoto(reqDemo("/admin/upload/pendencias-voto"))).json();
    expect(pend.confirmaveis, "painel sumia sem este campo").toBe(0);

    const comp = await (await completude(reqDemo("/admin/completude-2026"))).json();
    // O consumidor lê `completude.totais.documentos_2026_detectados` ENCADEADO e sem guard.
    expect(comp.totais.documentos_2026_detectados).toBe(0);
    expect(Object.keys(comp.totais).length, "`totais: {}` deixava todo acesso encadeado undefined")
      .toBeGreaterThan(5);
  }, 20_000);
});

describe("etapa65 · listaDe — o guard que `?? []` não é", () => {
  it("envelope não vira array por acidente, e a chave certa devolve a lista", async () => {
    const { listaDe } = await import("@/lib/api");
    const envelope = { por_agencia: [{ id: 1 }] };
    expect(listaDe(envelope)).toEqual([]);                 // sem a chave: não adivinha
    expect(listaDe(envelope, "por_agencia")).toHaveLength(1);
    expect(listaDe([{ id: 1 }])).toHaveLength(1);          // array cru passa direto
    expect(listaDe(null)).toEqual([]);
    expect(listaDe(undefined)).toEqual([]);
    expect(listaDe({ por_agencia: null }, "por_agencia")).toEqual([]);
    // A demonstração do defeito: `?? []` deixa o objeto passar e o `.reduce` lança.
    const errado = (envelope as unknown as unknown[]) ?? [];
    expect(() => errado.reduce(() => 0, 0)).toThrow(TypeError);
  });
});
