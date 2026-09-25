/**
 * GET /api/v1/admin/votos/roster-divergente — o voto está no nome CERTO?
 *
 * ═══ A pergunta, e por que ela precisa de base inteira ═══
 * O QA de produção mostrou, para a ANM / 79ª ROP / 2025-11-26, **dois** diretores com 18 votos cada
 * (Caio Mário e Mauro). O preâmbulo real daquela ata nomeia **outros quatro** — Mauro, Tasso, Roger
 * e José Fernando — e isso está travado em teste desde a `etapa24` (`PREAMBULO_79`).
 *
 * `roster-conferivel.ts:5-12` já descreveu esse caso exato na Fase 20 e o chamou pelo nome:
 * *"não é lacuna de cobertura — é voto gravado no nome errado. Um número ausente se vê; um voto
 * atribuído ao diretor errado se propaga por todas as métricas parecendo legítimo."*
 *
 * A causa: `getActiveDiretoresForVote` (`vote-inference.ts:119-137`) escolhe quem vota pela tabela
 * `mandatos` e **nunca consulta a lista de presentes do documento**. Para filho de ata a lista nem
 * chega: `buildRawExtractionDoItem` não propaga `nomes_presentes` do pai.
 *
 * Esta rota responde a ÚNICA pergunta que decide o conserto: **a 79ª é a única?**
 *
 * ⚠️ SOMENTE LEITURA, por construção. Não existe caminho de escrita aqui.
 *
 * ⚠️ E ELA MEDE OS DOIS SENTIDOS. O banner só sabe mostrar voto que existe, então a metade invisível
 * do erro — **diretor presente na ata que recebeu ZERO voto** (Tasso e Roger) — não aparece em
 * métrica nenhuma. Um voto ausente não deixa rastro. As duas contagens saem separadas.
 *
 * ⚠️ AUSÊNCIA DE DADO NÃO É DIVERGÊNCIA. Quando o pai não tem `nomes_presentes` extraído, a
 * deliberação sai em `nao_conferivel`, nunca em divergente — é a mesma disciplina de
 * `janela-de-mandatos.ts`: "uma agência sem mandato cadastrado não pode ter todo o acervo declarado
 * fora da janela; isso transformaria ausência de cadastro em afirmação sobre o período".
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { lerTudo } from "@/lib/server/select-all-paged";
import { lerEmLotes } from "@/lib/server/ler-em-lotes";
import { findBestMatch, MATCH_THRESHOLD } from "@/lib/server/name-matcher";
import { resolverPresentesRoster } from "@/lib/server/presentes-roster";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** Ata sem pai não é decisão final; pauta e apoio nunca são. Mesma regra da Completude. */
const NAO_FINAL = new Set(["pauta", "documento_apoio", "noticia", "consulta_publica"]);
const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];

interface Diretor {
  id: string;
  nome: string;
  nome_variantes: string[];
  agencia_id: string;
}

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ modo: "demo", totais: {}, por_agencia: {}, amostra: [] });
  }
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const ano = req.nextUrl.searchParams.get("ano");
  const tamanhoDaAmostra = Math.max(1, Math.min(40, Number(req.nextUrl.searchParams.get("amostra")) || 12));

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  // ── 1. Votos, diretores, agências ────────────────────────────────────────
  const [votosRes, diretoresRes, agRes] = await Promise.all([
    lerTudo<any>(() => db.from("votos")
      .select("deliberacao_id, diretor_id, proveniencia, is_nominal").order("id"), "roster-divergente/votos"),
    lerTudo<any>(() => db.from("diretores")
      .select("id, nome, nome_variantes, agencia_id").eq("review_status", "aprovado").order("id"),
      "roster-divergente/diretores"),
    db.from("agencias").select("id, sigla"),
  ]);
  // ⚠️ `lerTudo` devolve `{error}` em vez de lançar, e no caminho de erro `truncated` fica FALSE com
  // as linhas que já tinha. Medir sobre leitura parcial e chamar de "base inteira" produziria
  // exatamente o número que esta rota existe para não produzir.
  if (votosRes.error || diretoresRes.error) {
    return NextResponse.json({ error: "Falha ao ler votos ou diretores." }, { status: 500 });
  }

  const votantesPor = new Map<string, Set<string>>();
  const provenienciaPor = new Map<string, Set<string>>();
  for (const v of votosRes.data as any[]) {
    const del = String(v.deliberacao_id);
    if (!votantesPor.has(del)) votantesPor.set(del, new Set());
    votantesPor.get(del)!.add(String(v.diretor_id));
    if (!provenienciaPor.has(del)) provenienciaPor.set(del, new Set());
    provenienciaPor.get(del)!.add(String(v.proveniencia ?? "sem_proveniencia"));
  }
  if (votantesPor.size === 0) {
    return NextResponse.json({ nota: "Nenhum voto no acervo.", totais: {}, por_agencia: {}, amostra: [] });
  }

  const diretores: Diretor[] = (diretoresRes.data as any[]).map((d) => ({
    id: String(d.id), nome: String(d.nome ?? ""),
    nome_variantes: arr(d.nome_variantes), agencia_id: String(d.agencia_id ?? ""),
  }));
  const diretorPorId = new Map(diretores.map((d) => [d.id, d]));
  const porAgencia = new Map<string, Diretor[]>();
  for (const d of diretores) {
    if (!porAgencia.has(d.agencia_id)) porAgencia.set(d.agencia_id, []);
    porAgencia.get(d.agencia_id)!.push(d);
  }
  // ⚠️ Nome mais LONGO primeiro, igual ao motor (`materializar-faltantes:102`). `findBestMatch` usa
  // `>` estrito: em empate vence o primeiro iterado, então a ordem muda o resultado. Ordenar
  // diferente daqui faria esta rota acusar divergência onde o motor não veria nenhuma.
  for (const lista of porAgencia.values()) lista.sort((x, y) => y.nome.length - x.nome.length);
  const sigla = new Map(((agRes.data ?? []) as any[]).map((a) => [String(a.id), String(a.sigla)]));

  // ── 2. As deliberações que TÊM voto, em projeção leve ────────────────────
  const levesRes = await lerTudo<any>(() => {
    let q = db.from("deliberacoes")
      .select("id, agencia_id, tipo_documento, documento_pai_id, data_reuniao, numero_reuniao")
      .not("resultado", "is", null)
      .order("id", { ascending: true });
    if (ano) q = q.gte("data_reuniao", `${ano}-01-01`).lte("data_reuniao", `${ano}-12-31`);
    return q;
  }, "roster-divergente/leves");
  if (levesRes.error) return NextResponse.json({ error: "Falha ao listar deliberações." }, { status: 500 });

  const comVoto = (levesRes.data as any[]).filter((d) => {
    if (NAO_FINAL.has(String(d.tipo_documento))) return false;
    return votantesPor.has(String(d.id));
  });
  if (comVoto.length === 0) {
    return NextResponse.json({ nota: "Nenhuma deliberação final com voto no recorte.", parametros: { ano } });
  }

  // ── 3. Os presentes: do PAI quando há pai, do próprio quando não há ──────
  // ⚠️ `lerEmLotes`, não `.in()` cru: `raw_extraction` é payload pesado e a lista de ids é do
  // tamanho do acervo. Foi um `.in()` com 820 ids que zerou `VotosNaDeliberacao` em 100% do CSV
  // (Commit A desta fase) — a URL passou de 32 KB contra um teto de 8 KB.
  const idsDePresenca = [...new Set(comVoto.map((d) => String(d.documento_pai_id ?? d.id)))];
  const rawRes = await lerEmLotes<any>(db, {
    tabela: "deliberacoes", select: "id, raw_extraction",
    coluna: "id", valores: idsDePresenca, label: "roster-divergente/presentes",
  });
  if (rawRes.error) return NextResponse.json({ error: "Falha ao ler os presentes." }, { status: 500 });
  const presentesDe = new Map<string, string[]>();
  for (const r of rawRes.data as any[]) {
    presentesDe.set(String(r.id), arr((r.raw_extraction ?? {}).nomes_presentes));
  }

  // ── 4. A comparação, nos DOIS sentidos ───────────────────────────────────
  const zero = () => ({
    conferiveis: 0, nao_conferivel_sem_presentes: 0,
    com_voto_sem_presenca: 0, com_presente_sem_voto: 0, limpas: 0,
  });
  const agregado = new Map<string, ReturnType<typeof zero>>();
  const porReuniao = new Map<string, {
    agencia: string; numero_reuniao: string | null; data_reuniao: string | null;
    itens: number; votos_sem_presenca: Set<string>; presentes_sem_voto: Set<string>;
    proveniencias: Set<string>;
  }>();
  const amostra: any[] = [];

  for (const d of comVoto) {
    const ag = sigla.get(String(d.agencia_id)) ?? "?";
    if (!agregado.has(ag)) agregado.set(ag, zero());
    const acc = agregado.get(ag)!;

    const presentes = presentesDe.get(String(d.documento_pai_id ?? d.id)) ?? [];
    if (presentes.length === 0) { acc.nao_conferivel_sem_presentes++; continue; }
    acc.conferiveis++;

    const candidatos = porAgencia.get(String(d.agencia_id)) ?? [];
    /**
     * ⚠️ Quem o PREÂMBULO nomeia, resolvido pela MESMA função que o motor de voto usa —
     * `resolverPresentesRoster`, não um laço próprio. Um selo que discorde do motor é o pior
     * desfecho possível numa ferramenta feita para dar confiança (`colegiado-na-data.ts:11-19`).
     *
     * E a ORDEM importa: `findBestMatch` usa `>` estrito, então em empate vence o primeiro iterado.
     * O motor ordena por nome mais longo primeiro (`materializar-faltantes:102`); ordenar diferente
     * aqui produziria match diferente do que virou voto. `porAgencia` já vem ordenado assim.
     */
    const idsPresentes = new Set(resolverPresentesRoster(presentes, candidatos).map((r) => String(r.id)));
    // Só para o relatório: quais nomes do preâmbulo não chegaram ao cadastro. É o que o operador
    // corrige, e não entra em nenhuma decisão desta rota.
    const presentesNaoReconhecidos = presentes.filter((nome) => {
      const m = findBestMatch(nome, candidatos);
      return !m.diretorId || m.needsReview;
    });

    const votantes = votantesPor.get(String(d.id)) ?? new Set<string>();
    const votoSemPresenca = [...votantes].filter((id) => !idsPresentes.has(id));
    const presenteSemVoto = [...idsPresentes].filter((id) => !votantes.has(id));
    if (votoSemPresenca.length > 0) acc.com_voto_sem_presenca++;
    if (presenteSemVoto.length > 0) acc.com_presente_sem_voto++;
    if (votoSemPresenca.length === 0 && presenteSemVoto.length === 0) { acc.limpas++; continue; }

    const chave = `${ag}|${d.numero_reuniao ?? "sem-numero"}|${d.data_reuniao ?? "sem-data"}`;
    if (!porReuniao.has(chave)) {
      porReuniao.set(chave, {
        agencia: ag, numero_reuniao: d.numero_reuniao ?? null, data_reuniao: d.data_reuniao ?? null,
        itens: 0, votos_sem_presenca: new Set(), presentes_sem_voto: new Set(), proveniencias: new Set(),
      });
    }
    const r = porReuniao.get(chave)!;
    r.itens++;
    for (const id of votoSemPresenca) r.votos_sem_presenca.add(diretorPorId.get(id)?.nome ?? id);
    for (const id of presenteSemVoto) r.presentes_sem_voto.add(diretorPorId.get(id)?.nome ?? id);
    for (const p of provenienciaPor.get(String(d.id)) ?? []) r.proveniencias.add(p);

    if (amostra.length < tamanhoDaAmostra) {
      amostra.push({
        deliberacao_id: d.id, agencia: ag,
        numero_reuniao: d.numero_reuniao ?? null, data_reuniao: d.data_reuniao ?? null,
        presentes_no_documento: presentes,
        // ⚠️ `confirm/route.ts:151` corta `nomes_presentes` em 20 nomes (e 100 chars cada). Num
        // colegiado grande a lista pode ter sido truncada NA ORIGEM, e aí "presente sem voto" pode
        // ser falta de nome, não falta de voto. Com 20 exatos, não conclua sem olhar o PDF.
        lista_possivelmente_truncada_na_origem: presentes.length >= 20,
        presentes_nao_reconhecidos: presentesNaoReconhecidos,
        recebeu_voto_sem_estar_presente: votoSemPresenca.map((id) => diretorPorId.get(id)?.nome ?? id),
        presente_sem_receber_voto: presenteSemVoto.map((id) => diretorPorId.get(id)?.nome ?? id),
        proveniencia: [...(provenienciaPor.get(String(d.id)) ?? [])],
      });
    }
  }

  const reunioes = [...porReuniao.values()]
    .map((r) => ({
      agencia: r.agencia, numero_reuniao: r.numero_reuniao, data_reuniao: r.data_reuniao,
      itens_afetados: r.itens,
      recebeu_voto_sem_estar_presente: [...r.votos_sem_presenca],
      presente_sem_receber_voto: [...r.presentes_sem_voto],
      proveniencia: [...r.proveniencias],
    }))
    .sort((a, b) => b.itens_afetados - a.itens_afetados);

  return NextResponse.json({
    parametros: { ano: ano ?? "todos", amostra: tamanhoDaAmostra, limiar_de_nome: MATCH_THRESHOLD },
    // ⚠️ Leitura parcial faz TODO número abaixo subcontar. Nunca deixar isso implícito.
    leitura_completa: !votosRes.truncated && !diretoresRes.truncated && !levesRes.truncated && !rawRes.truncated,
    totais: {
      deliberacoes_finais_com_voto: comVoto.length,
      reunioes_afetadas: reunioes.length,
      itens_afetados: reunioes.reduce((s, r) => s + r.itens_afetados, 0),
    },
    /**
     * `nao_conferivel_sem_presentes` é o tamanho do ponto cego, não um resultado limpo: são as
     * deliberações cujo pai não tem preâmbulo extraído. Para filho de ata isso é hoje a REGRA, não a
     * exceção — `buildRawExtractionDoItem` não propaga `nomes_presentes`. O número tem de aparecer
     * grande até o Commit J entrar; se ele vier pequeno, a suposição está errada e eu quero saber.
     */
    por_agencia: Object.fromEntries(agregado),
    /**
     * ⚠️ `votos.fonte_presenca` existe no schema (`20260824120000_votos_proveniencia.sql:23`) com
     * CHECK em `('documento','mandato')` — é EXATAMENTE o campo que responderia esta rota inteira
     * com um GROUP BY. E nada em produção o escreve: ele aparece só em `COLUNAS_VOTOS_OPCIONAIS`
     * (`votos-write.ts:30`), a lista de strip-and-retry. Coluna criada, nunca preenchida.
     * Enquanto for assim, a comparação tem de ser feita por nome, como aqui.
     */
    fonte_presenca_nao_e_populada: true,
    reunioes,
    amostra,
  });
}
