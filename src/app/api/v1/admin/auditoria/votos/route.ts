/**
 * GET /api/v1/admin/auditoria/votos
 *
 * UMA LINHA POR VOTO: diretor · deliberação · tipo de voto · lido/inferido · PDF de origem.
 *
 * ═══ Por que esta rota existe ═══
 * O operador perguntou, com estas palavras: "eu não quero as deliberações em si, eu quero os votos
 * de cada diretor" e "seria possível visualizar de maneira simples qual foi o voto de X diretor
 * naquela deliberação?". Nada na plataforma respondia isso. O relatório em PDF/Word/CSV é agregado
 * POR DIRETOR (só os divergentes aparecem com nome), a amostra de auditoria parte da deliberação e
 * mostra cinco ao acaso, e o drill-down do diretor não tem PDF nem o rótulo lido/inferido.
 *
 * É esta tela, e não um número, que responde "como sei que são confiáveis": cada linha traz o PDF
 * ao lado para conferir.
 *
 * ═══ Decisões que não são óbvias ═══
 * · **Paginação no BANCO** (`.range()` + `count: "exact"`), não `lerTudo`. Esta é superfície de
 *   NAVEGAÇÃO: cada mudança de filtro e cada clique re-executa a consulta, e `lerTudo` leria todas
 *   as linhas casadas para jogar 98% fora. O CSV, que é um disparo só, usa `lerTudo`.
 * · **Ordem TOTAL** (`data_reuniao` + `id`). Sem o desempate, `.range()` repete e pula linhas
 *   entre páginas — e uma reunião rende dezenas de votos na mesma data.
 * · **`motivo_nao_voto` e `voto_em_autos` na linha.** São literalmente a resposta a "por que um
 *   diretor tem menos votos que outro": impedimento e vista saem do denominador dele, não do
 *   colegiado. Até aqui `buildVotoRows` gravava esses campos e NADA no dashboard os lia.
 * · **`colegiado_esperado` × `votos_na_deliberacao`.** Diferença de volume entre diretores é
 *   legítima (mandato, ausência, relatoria). O sintoma real é dentro da MESMA deliberação.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { isVotoNominal } from "@/lib/votos-nominal";
import { lerTudo } from "@/lib/server/select-all-paged";
import { assinarPdfsDasDeliberacoes } from "@/lib/server/pdf-da-deliberacao";
import { colegiadoNaData, esperadoVsPresente, type MandatoJanela } from "@/lib/server/colegiado-na-data";
import { normalizarFiltros, janelaDeDatas, filtroOrigemPostgrest } from "@/lib/server/auditoria-votos-filtros";
import { montarCsv, type LinhaDeVoto } from "@/lib/server/auditoria-votos-csv";
import { amostrarEstratificado } from "@/lib/server/amostra-estratificada";
import { lerEmLotes } from "@/lib/server/ler-em-lotes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SELECT_DO_VOTO = `
  id, tipo_voto, is_divergente, is_nominal, proveniencia, motivo_nao_voto, voto_em_autos,
  diretor:diretores!inner(id, nome, agencia_id),
  deliberacao:deliberacoes!inner(
    id, numero_deliberacao, numero_reuniao, tipo_reuniao, data_reuniao, resultado, microtema,
    tipo_documento, documento_pai_id, agencia_id, agencia:agencias(sigla))
`;

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ linhas: [], total: 0, page: 1, limit: 50, pages: 0, demo: true });
  }
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const normalizado = normalizarFiltros(req.nextUrl.searchParams);
  if (!normalizado.ok) return NextResponse.json({ error: normalizado.erro }, { status: 400 });
  const f = normalizado.filtros;
  const { de, ate } = janelaDeDatas(f);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const comFiltros = (q: any) => {
    if (f.diretor_id) q = q.eq("diretor_id", f.diretor_id);
    // A agência é a da DELIBERAÇÃO, não a do diretor: a pergunta é "que votos aconteceram nesta
    // agência". (Um voto cuja agência do diretor difere da da deliberação é erro de atribuição, e
    // o bloco de QA o procura.)
    if (f.agencia_id) q = q.eq("deliberacao.agencia_id", f.agencia_id);
    // ⚠️ Por `numero_reuniao`, não por `reuniao_id`: o vínculo só é gravado quando há data
    // (`reunioes.ts:75`), e filtrar pela FK esconderia as deliberações sem data — justo as que
    // mais precisam de auditoria. Ver o comentário no contrato dos filtros.
    if (f.numero_reuniao) q = q.eq("deliberacao.numero_reuniao", f.numero_reuniao);
    if (de) q = q.gte("deliberacao.data_reuniao", de);
    if (ate) q = q.lte("deliberacao.data_reuniao", ate);
    if (f.tipo_voto) q = q.eq("tipo_voto", f.tipo_voto);
    if (f.divergente) q = q.eq("is_divergente", true);
    if (f.origem) q = q.or(filtroOrigemPostgrest(f.origem));
    // ⚠️ `order("deliberacao(data_reuniao)")`, NÃO `{ referencedTable }`. O postgrest-js é
    // explícito: com `referencedTable` a ordenação vale DENTRO do embed e **não afeta a tabela
    // pai**; com `referenced_table(col)` ela ordena o pai. É o bug vivo de
    // `dashboard/diretores/[id]/votos`, cujo drill-down devolve 50 votos arbitrários achando que
    // são os 50 mais recentes.
    // E o `.order("id")` de desempate dá ORDEM TOTAL: sem ele o `.range()` repete e pula linhas
    // entre páginas, e uma reunião rende dezenas de votos na mesma data.
    return q.order("deliberacao(data_reuniao)", { ascending: false }).order("id", { ascending: false });
  };

  let brutos: any[] = [];
  let total = 0;
  let truncado = false;

  // ⚠️ A amostra estratificada precisa do UNIVERSO, não da página: escolher 5 entre os 50 da
  // página 1 devolveria os 5 mais recentes disfarçados de amostra. Como o CSV, é disparo único.
  const querAmostra = req.nextUrl.searchParams.get("amostra") === "1";
  if (querAmostra) {
    const r = await lerTudo<any>(() => comFiltros(db.from("votos").select(SELECT_DO_VOTO)), "auditoria-votos/amostra");
    if (r.error) return NextResponse.json({ error: "Falha ao montar a amostra." }, { status: 500 });
    brutos = r.data;
    truncado = r.truncated || Boolean(r.error);
    total = brutos.length;
  } else if (f.format === "csv") {
    // Disparo único: aqui `lerTudo` é o certo — e se truncar, o AVISO vai dentro do arquivo.
    const r = await lerTudo<any>(() => comFiltros(db.from("votos").select(SELECT_DO_VOTO)), "auditoria-votos/csv");
    if (r.error) return NextResponse.json({ error: "Falha ao listar votos." }, { status: 500 });
    brutos = r.data;
    truncado = r.truncated;
    total = brutos.length;
  } else {
    const desde = (f.page - 1) * f.limit;
    const { data, error, count } = await comFiltros(
      db.from("votos").select(SELECT_DO_VOTO, { count: "exact" }),
    ).range(desde, desde + f.limit - 1);
    if (error) return NextResponse.json({ error: "Falha ao listar votos." }, { status: 500 });
    brutos = (data ?? []) as any[];
    total = count ?? brutos.length;
  }

  // ═══ O colegiado esperado naquela data, e quem votou ═══════════════════════
  // Uma consulta de mandatos por requisição; a resolução por data é pura (`colegiado-na-data.ts`),
  // com EXATAMENTE os filtros de `getActiveDiretoresForVote`. Chamar o motor por linha custaria um
  // round-trip por par (agência, data).
  const idsDeDelib = [...new Set(brutos.map((v) => String(v.deliberacao?.id)))].filter(Boolean);
  // ⚠️ Fase 31 — este `.in()` era ÚNICO, sem lote e sem paginação, e foi ele que zerou a coluna
  // `VotosNaDeliberacao` em 100% das 2.726 linhas do CSV exportado. A tela nunca viu o defeito
  // porque 50 linhas dão ≤50 ids (2.057 chars de URL); o CSV lê o universo e deu 820 ids —
  // 32.087 chars, quatro vezes o `urlLengthLimit` default do postgrest-js. Ver `ler-em-lotes.ts`.
  const [mandatosRes, votantesRes] = await Promise.all([
    lerTudo<any>(() => db
      .from("mandatos")
      .select("diretor_id, data_inicio, data_fim, diretores!inner(agencia_id, review_status)")
      .neq("fonte_dado", "automatico")
      .eq("diretores.review_status", "aprovado")
      .order("id"), "auditoria-votos/mandatos"),
    lerEmLotes<{ deliberacao_id: string; diretor_id: string }>(db, {
      tabela: "votos", select: "deliberacao_id, diretor_id",
      coluna: "deliberacao_id", valores: idsDeDelib, label: "auditoria-votos/votantes",
    }),
  ]);
  // ⚠️ O erro PRECISA derrubar a resposta. Antes ele era descartado e o consumidor fazia
  // `(data ?? []).length` — falha total virava `0`, que é um número plausível e passa por dado.
  // Mesmo raciocínio já escrito em `materializar-faltantes:300-307`.
  if (votantesRes.error || mandatosRes.error) {
    return NextResponse.json(
      { error: "Falha ao ler os votantes ou os mandatos — a coluna de colegiado sairia zerada." },
      { status: 500 },
    );
  }
  const mandatos: MandatoJanela[] = ((mandatosRes.data ?? []) as any[]).map((m) => ({
    diretor_id: String(m.diretor_id),
    agencia_id: String(m.diretores?.agencia_id ?? ""),
    data_inicio: m.data_inicio ?? null,
    data_fim: m.data_fim ?? null,
  }));
  const votantesPorDelib = new Map<string, string[]>();
  for (const v of ((votantesRes.data ?? []) as any[])) {
    const k = String(v.deliberacao_id);
    votantesPorDelib.set(k, [...(votantesPorDelib.get(k) ?? []), String(v.diretor_id)]);
  }

  const pdfPorDelib = await assinarPdfsDasDeliberacoes(
    db,
    [...new Map(brutos.map((v) => [String(v.deliberacao?.id), {
      id: String(v.deliberacao?.id),
      documento_pai_id: v.deliberacao?.documento_pai_id ?? null,
    }])).values()],
  );

  const linhas: Array<LinhaDeVoto & { pdf_url: string | null; roster_conhecido: boolean; faltando: number; tipo_reuniao: string | null;
    tipo_documento_da_fonte: string | null }> =
    brutos.map((v) => {
      const d = v.deliberacao ?? {};
      const delibId = String(d.id ?? "");
      const roster = colegiadoNaData(mandatos, d.agencia_id ? String(d.agencia_id) : null, d.data_reuniao ?? null);
      const comparacao = esperadoVsPresente(roster, votantesPorDelib.get(delibId) ?? []);
      const pdf = pdfPorDelib.get(delibId);
      return {
        agencia: d.agencia?.sigla ?? null,
        numero_reuniao: d.numero_reuniao ?? null,
        tipo_reuniao: d.tipo_reuniao ?? null,
        numero_deliberacao: d.numero_deliberacao ?? null,
        data_reuniao: d.data_reuniao ?? null,
        microtema: d.microtema ?? null,
        resultado: d.resultado ?? null,
        diretor: v.diretor?.nome ?? null,
        tipo_voto: v.tipo_voto ?? null,
        // Fonte ÚNICA do rótulo. A tela não reimplementa a regra.
        origem: isVotoNominal(v) ? "lido" : "inferido",
        proveniencia: v.proveniencia ?? null,
        is_divergente: v.is_divergente ?? null,
        motivo_nao_voto: v.motivo_nao_voto ?? null,
        voto_em_autos: v.voto_em_autos ?? null,
        colegiado_esperado: comparacao.roster_conhecido ? comparacao.esperado : null,
        votos_na_deliberacao: (votantesPorDelib.get(delibId) ?? []).length,
        pdf_arquivo: pdf?.arquivo ?? null,
        pdf_url: pdf?.url ?? null,
        deliberacao_id: delibId,
        voto_id: String(v.id),
        roster_conhecido: comparacao.roster_conhecido,
        faltando: comparacao.faltando.length,
        // Item de ata chega com `tipo_documento: "ata"` e pai; deliberação solta e voto individual
        // vêm com o próprio tipo. É o que separa as três fontes na amostra.
        tipo_documento_da_fonte: (d.documento_pai_id ? "ata" : d.tipo_documento) ?? null,
      };
    });

  if (querAmostra) {
    const grupos = amostrarEstratificado(
      linhas.map((l) => ({
        voto_id: l.voto_id, agencia: l.agencia, origem: l.origem, resultado: l.resultado,
        motivo_nao_voto: l.motivo_nao_voto, is_divergente: l.is_divergente,
        // A fonte real da linha: item de ata tem pai; o resto é o próprio tipo do documento.
        tipo_documento: l.tipo_documento_da_fonte,
      })),
      {
        porAgencia: Math.max(1, Math.min(20, Number(req.nextUrl.searchParams.get("por_agencia")) || 5)),
        // Sem seed explícito, o DIA serve de semente: a mesma amostra o dia inteiro, e um seed na
        // URL reabre exatamente a que alguém conferiu. Mesmo contrato de `amostra-auditoria`.
        seed: req.nextUrl.searchParams.get("seed") ?? new Date().toISOString().slice(0, 10),
      },
    );
    const porId = new Map(linhas.map((l) => [l.voto_id, l]));
    return NextResponse.json({
      amostra: grupos.map((g) => ({
        ...g,
        linhas: g.linhas.map((l) => porId.get(l.voto_id)).filter(Boolean),
      })),
      universo_total: linhas.length,
      truncado,
      notice:
        "Amostra por COTAS, não uniforme: o raro entra antes do comum. `cotas_sem_exemplar` = a " +
        "agência não tem nenhum caso assim (é achado sobre o dado); `cotas_fora_do_tamanho` = " +
        "tem, mas não coube no tamanho pedido. Determinística pelo seed.",
    });
  }

  if (f.format === "csv") {
    return new NextResponse(montarCsv(linhas, req.nextUrl.origin, truncado), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="auditoria-votos-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({
    linhas,
    total,
    page: f.page,
    limit: f.limit,
    pages: Math.max(1, Math.ceil(total / f.limit)),
    filtros_aplicados: f,
    notice:
      'Uma linha por VOTO. "Inferido" = completado por unanimidade ou por mandato, não lido do ' +
      'documento. "N de M" compara quem votou com quem tinha mandato naquela data; sem mandato ' +
      "conhecido a coluna fica vazia, nunca «completo».",
  });
}
