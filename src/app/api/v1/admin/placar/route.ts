/**
 * GET /api/v1/admin/placar[?year=2026] — o denominador comum.
 *
 * ═══ A pergunta que esta rota responde ═══
 * *"Como sei que estamos chegando ao fim?"*. Até aqui cada fase consertava alguma coisa sem medir
 * avanço contra um número só, e isso dá a sensação de não sair do lugar mesmo quando sai. São três
 * números, um por pilar do objetivo final, e toda fase daqui para frente abre dizendo quanto cada um
 * mudou. Se não mexeu, não serviu.
 *
 *   (a) `buracos_de_numeracao` — a COLETA. Toda série de reunião é numerada em sequência; número
 *       que falta no meio é reunião que o banco não tem. ⚠️ Separado em três causas, porque elas
 *       pedem ações opostas: `ausentes` (recoletar), `fora_do_ano` (a reunião ESTÁ no banco, com
 *       data errada — recoletar não resolveria) e `duplicados` (o mesmo número em duas datas, que
 *       infla o denominador do ano).
 *   (b) `colegiado_por_reuniao` — o VOTO. ⚠️ Separa `defeito_nosso` (falta voto de quem tinha
 *       mandato: é trabalho meu) de `cadastro_pendente` (alguém votou sem mandato declarado: é dado
 *       que só o DOU tem). Um número só, somando os dois, diz "20 incompletas" e não diz o que
 *       fazer com elas.
 *   (c) `certificacao_no_banco` — a CONFIANÇA. O `vote-certification` roda com `db: null`: mede o
 *       parser, não o banco. Aqui as 16 deliberações certificadas são conferidas contra o que está
 *       gravado.
 *
 * ⚠️ SOMENTE LEITURA, e sem rede. Os três números são do BANCO; uma rota que dependesse de buscar o
 * portal ao vivo não poderia ser o placar, porque o WAF da ARTESP ou o portal da ANTT fora do ar
 * viraria "o placar caiu".
 *
 * ⚠️ E TODA leitura é paginada com `lerTudo`. `.limit(N)` grande NÃO é paginação no PostgREST — ele
 * corta em ~1.000 e devolve sem aviso. Um placar que subconta é pior que nenhum, porque ele sobe
 * quando o acervo cresce. `leitura_completa` viaja na resposta para o número nunca ser lido como
 * definitivo quando não é.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { lerTudo } from "@/lib/server/select-all-paged";
import { budgetFromRequest, hasBudget } from "@/lib/server/time-budget";
import { COLEGIADO_SIGLAS } from "@/lib/server/colegiado-sources";
import { isFinalDecisionRecord } from "@/lib/server/regulatory-documents";
import {
  buracosDaSerie, medirReuniao, resumirPorAgencia,
  type EntradaDeNumeracao, type ReuniaoParaPlacar,
} from "@/lib/server/placar";
import type { MandatoJanela } from "@/lib/server/colegiado-na-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Honra `budget_ms`; declarar 60 aqui pediria o kill da plataforma antes de o orçamento parar.
export const maxDuration = 120;

/** Saldo mínimo para a última etapa (agrupar e responder) depois das leituras. */
const RESERVA_DE_FECHO_MS = 3_000;
const RE_ANO = /^(20)\d{2}$/;

const vazio = {
  buracos_de_numeracao: [] as unknown[],
  colegiado_por_reuniao: {} as Record<string, unknown>,
  reunioes_incompletas: [] as unknown[],
  certificacao_no_banco: { conferidas: 0, batem: 0, divergem: [] as unknown[] },
  leitura_completa: true,
  alertas: [] as string[],
};

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    // Etapa65 — o ramo demo carrega TODAS as chaves do real; consumidor que lê `undefined` some.
    return NextResponse.json({ modo: "demo", year: "2026", gerado_em: new Date().toISOString(), ...vazio });
  }
  const guard = await requireAdminOrCron(req, "placar");
  if (guard) return guard;

  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam && RE_ANO.test(yearParam) ? yearParam : String(new Date().getFullYear());
  const de = `${year}-01-01`;
  const ate = `${year}-12-31`;
  const deadlineAt = Date.now() + budgetFromRequest(req);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const alertas: string[] = [];
  const { data: agRows, error: agErr } = await db.from("agencias").select("id, sigla");
  if (agErr) {
    return NextResponse.json({ error: `Falha ao listar agências: ${agErr.message}` }, { status: 500 });
  }
  const siglaPorId = new Map<string, string>();
  const idsColegiados = new Set<string>();
  for (const a of (agRows ?? []) as Array<{ id: string; sigla: string }>) {
    siglaPorId.set(a.id, a.sigla);
    if (COLEGIADO_SIGLAS.has(a.sigla)) idsColegiados.add(a.id);
  }

  // ─── As três leituras, todas paginadas ────────────────────────────────────
  const [delibsRes, votosRes, mandatosRes] = await Promise.all([
    lerTudo<any>(
      () => db.from("deliberacoes")
        .select("id, agencia_id, numero_reuniao, data_reuniao, tipo_documento, documento_pai_id, resultado, reuniao_id, raw_extraction")
        .order("id"),
      "placar/deliberacoes"),
    lerTudo<{ deliberacao_id: string; diretor_id: string }>(
      () => db.from("votos").select("deliberacao_id, diretor_id").order("id"), "placar/votos"),
    lerTudo<any>(
      () => db.from("mandatos")
        // Os MESMOS filtros do motor de voto (`getActiveDiretoresForVote`): mandato fabricado a
        // partir do próprio voto não pode ampliar o roster, e diretor rejeitado não entra.
        .select("diretor_id, data_inicio, data_fim, diretores!inner(id, agencia_id, review_status)")
        .neq("fonte_dado", "automatico")
        .eq("diretores.review_status", "aprovado")
        .order("id"),
      "placar/mandatos"),
  ]);

  // ⚠️ `truncated` NÃO basta: no caminho de erro, `selectAllPaged` devolve `truncated: false` com as
  // linhas que já tinha. Olhar só `truncated` deixaria a bandeira falsa justamente quando falhou.
  const parcial = (r: { error: unknown; truncated: boolean }) => r.truncated || Boolean(r.error);
  const leituraCompleta = ![delibsRes, votosRes, mandatosRes].some(parcial);
  if (!leituraCompleta) {
    alertas.unshift("⚠️ LEITURA INCOMPLETA — os números abaixo SUBCONTAM. Não use como placar.");
  }

  const mandatos: MandatoJanela[] = [];
  for (const m of (mandatosRes.data ?? []) as any[]) {
    const dir = m.diretores;
    if (!dir?.id || !dir.agencia_id) continue;
    mandatos.push({
      diretor_id: dir.id, agencia_id: dir.agencia_id,
      data_inicio: m.data_inicio ?? null, data_fim: m.data_fim ?? null,
    });
  }

  const votantesPorDelib = new Map<string, Set<string>>();
  for (const v of votosRes.data ?? []) {
    if (!v.deliberacao_id || !v.diretor_id) continue;
    const s = votantesPorDelib.get(v.deliberacao_id) ?? new Set<string>();
    s.add(v.diretor_id);
    votantesPorDelib.set(v.deliberacao_id, s);
  }

  // ─── (a) A numeração, por (agência, série) ────────────────────────────────
  //
  // ⚠️ A série vem de `reunioes`, não do documento: a MESMA data pode ter a 1.024ª Reunião de
  // Diretoria e a 264ª Deliberativa Eletrônica (medido no corpus). Sem série, 264 e 1.024 entrariam
  // na mesma sequência e o cálculo enumeraria 760 "ausentes" que não existem.
  const reunioesRes = await lerTudo<any>(
    () => db.from("reunioes").select("agencia_id, numero_reuniao, data_reuniao, serie").order("id"),
    "placar/reunioes");
  const serieParcial = parcial(reunioesRes);
  if (serieParcial) alertas.push("⚠️ leitura de `reunioes` incompleta — a série pode faltar em parte das linhas.");
  const seriePorChave = new Map<string, string | null>();
  for (const r of (reunioesRes.data ?? []) as any[]) {
    if (!r.agencia_id || !r.data_reuniao) continue;
    seriePorChave.set(`${r.agencia_id}|${r.data_reuniao}|${r.numero_reuniao ?? ""}`, r.serie ?? null);
  }

  const entradas: EntradaDeNumeracao[] = [];
  /** Chave da REUNIÃO: agência + data + número. É a mesma chave natural de `reunioes`. */
  const porReuniao = new Map<string, ReuniaoParaPlacar & { agencia_id: string }>();
  let finaisNoAno = 0;

  for (const d of (delibsRes.data ?? []) as any[]) {
    if (!d.agencia_id || !idsColegiados.has(d.agencia_id)) continue;
    if (!d.data_reuniao) continue;
    const sigla = siglaPorId.get(d.agencia_id) ?? "?";
    const serie = seriePorChave.get(`${d.agencia_id}|${d.data_reuniao}|${d.numero_reuniao ?? ""}`) ?? null;

    // ⚠️ A numeração olha TODO o acervo, não só o ano: é justamente o que permite dizer
    // "o número existe, mas com data de outro ano" em vez de "faltando coletar".
    if (d.numero_reuniao) {
      entradas.push({ agencia: sigla, serie, numero_reuniao: d.numero_reuniao, data_reuniao: d.data_reuniao });
    }

    if (d.data_reuniao < de || d.data_reuniao > ate) continue;
    // Só DECISÃO conta para o colegiado: pauta, envelope de sessão e voto individual não são reunião
    // com colegiado a conferir. É o predicado canônico, não uma segunda verdade em SQL.
    if (!isFinalDecisionRecord(d)) continue;
    // Documento sem número de reunião é avulso — não tem colegiado a conferir, e contá-lo como
    // reunião incompleta foi o falso positivo que o bloco ⑨ produzia.
    if (!d.numero_reuniao) continue;
    finaisNoAno++;

    const chave = `${d.agencia_id}|${d.data_reuniao}|${d.numero_reuniao}`;
    const atual = porReuniao.get(chave) ?? {
      agencia: sigla, agencia_id: d.agencia_id, serie,
      numero_reuniao: d.numero_reuniao, data_reuniao: d.data_reuniao, votantes: [] as string[],
    };
    const vs = votantesPorDelib.get(d.id);
    if (vs) for (const id of vs) if (!atual.votantes.includes(id)) atual.votantes.push(id);
    porReuniao.set(chave, atual);
  }

  const buracos = buracosDaSerie(entradas, de, ate);

  // ─── (b) O colegiado por reunião ──────────────────────────────────────────
  const medidas = [...porReuniao.values()].map((r) => medirReuniao(r, r.agencia_id, mandatos));
  const resumo = resumirPorAgencia(medidas);

  // As incompletas, nomeadas — um placar que só dá o número não diz o que fazer em seguida.
  const nomePorDiretor = new Map<string, string>();
  if (hasBudget(deadlineAt, RESERVA_DE_FECHO_MS)) {
    const { data: dirs } = await db.from("diretores").select("id, nome");
    for (const d of (dirs ?? []) as Array<{ id: string; nome: string }>) nomePorDiretor.set(d.id, d.nome);
  }
  const nomeDe = (id: string) => nomePorDiretor.get(id) ?? id;
  const incompletas = medidas
    .filter((m) => m.classe !== "completa")
    .sort((a, b) => b.data_reuniao.localeCompare(a.data_reuniao))
    .slice(0, 80)
    .map((m) => ({
      agencia: m.agencia, serie: m.serie, numero_reuniao: m.numero_reuniao,
      data_reuniao: m.data_reuniao, classe: m.classe,
      esperado: m.esperado, com_voto: m.com_voto,
      faltando: m.faltando.map(nomeDe), extra: m.extra.map(nomeDe),
    }));

  for (const [sigla, r] of Object.entries(resumo)) {
    if (r.defeito_nosso > 0) alertas.push(`${sigla}: ${r.defeito_nosso} reunião(ões) com voto FALTANDO — é defeito nosso.`);
    if (r.cadastro_pendente > 0) alertas.push(`${sigla}: ${r.cadastro_pendente} reunião(ões) com voto de quem não tem mandato declarado — depende do DOU.`);
  }
  for (const b of buracos) {
    if (b.fora_do_ano.length > 0) {
      alertas.push(`${b.agencia}/${b.serie ?? "?"}: ${b.fora_do_ano.length} reunião(ões) EXISTEM com data fora de ${year} — o passo «redatar» é quem conserta, não a coleta.`);
    }
    if (b.duplicados.length > 0) {
      alertas.push(`${b.agencia}/${b.serie ?? "?"}: ${b.duplicados.length} número(s) repetido(s) em datas diferentes — o denominador de ${year} está inflado.`);
    }
  }

  return NextResponse.json({
    modo: "real",
    year,
    gerado_em: new Date().toISOString(),
    buracos_de_numeracao: buracos,
    colegiado_por_reuniao: resumo,
    reunioes_incompletas: incompletas,
    /**
     * ⚠️ (c) ainda NÃO está aqui, e o campo existe zerado de propósito: consumidor que lê
     * `undefined` some da tela, e um placar com um pilar invisível diz que ele não existe. A
     * subtração banco × gabarito entra na sequência desta fase.
     */
    certificacao_no_banco: { conferidas: 0, batem: 0, divergem: [], pendente: true },
    finais_no_ano: finaisNoAno,
    leitura_completa: leituraCompleta && !serieParcial,
    alertas,
  });
}
