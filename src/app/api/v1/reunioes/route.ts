/**
 * GET /api/v1/reunioes?agencia_id&year&date_from&date_to
 * Lista de reuniões de diretoria (agrupamento de deliberações por
 * agência + data + número), com consenso e contagens.
 *
 * ⚠️ Fase 31 — ESTA ROTA TRUNCAVA EM SILÊNCIO, e é a tela onde o usuário foi procurar a 79ª ROP.
 *
 * As duas leituras usavam `.limit(10000)` e `.limit(2000)`. **`.limit(N)` grande não é paginação**:
 * o PostgREST corta em ~1.000 e o teto grande é simplesmente ignorado. Com filtro de ano o volume
 * fica sob o corte e o defeito não aparece; **sem** filtro de ano a aba lista o acervo inteiro e
 * perde tudo depois da milésima linha — sem aviso. É a terceira instância desta classe nesta fase
 * (`e71126d` na cobertura, `lerTudo` na auditoria), e a mesma que produziu os "537 órfãos" da F24b.
 *
 * ⚠️ E aqui truncar é PIOR que errar: uma lista de reuniões faltando reuniões lê-se como "essa
 * reunião não existe" — exatamente a conclusão errada que o usuário tirou. Por isso truncagem vira
 * **500 declarado**, não lista pela metade: o contrato desta rota é um ARRAY (travado em
 * `etapa65`), e num array não há onde pendurar um aviso que a tela vá ler.
 *
 * A degradação da tabela `reunioes` ainda não migrada CONTINUA: aquilo é `error`, não `truncated`,
 * e segue no ramo de fallback silencioso — que ali é desenho, não falha.
 */

import { NextRequest, NextResponse } from "next/server";
import { isLocalMode, getSyncedDelibs } from "@/lib/server/local-data-store";
import { computeReunioesList } from "@/lib/server/analytics-engine";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest } from "@/lib/server/request-guards";
import { mapDeliberacaoRows, DELIB_SELECT } from "@/lib/server/deliberacao-fetch";
import { lerTudo } from "@/lib/server/select-all-paged";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_RE = /^(19|20)\d{2}$/;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const agenciaId = searchParams.get("agencia_id");

  if (isDemo() || isDemoRequest(req)) {
    if (isLocalMode()) return NextResponse.json(computeReunioesList(getSyncedDelibs(), agenciaId));
    return NextResponse.json([]);
  }

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();
  const year = searchParams.get("year");
  const dateFrom = searchParams.get("date_from");
  const dateTo = searchParams.get("date_to");

  /**
   * ⚠️ `lerTudo` recebe uma FÁBRICA, não uma query já montada: ele chama de novo a cada página, e
   * reusar o mesmo builder acumularia os `.range()` anteriores.
   *
   * E o `.order("id")` não é enfeite — sem ordem total o `.range()` repete e pula linhas entre as
   * páginas, porque o Postgres não garante ordem estável entre consultas.
   */
  const delibsQuery = () => {
    let q = db.from("deliberacoes").select(DELIB_SELECT).not("data_reuniao", "is", null);
    if (agenciaId) q = q.eq("agencia_id", agenciaId);
    if (year && YEAR_RE.test(year)) q = q.gte("data_reuniao", `${year}-01-01`).lte("data_reuniao", `${year}-12-31`);
    if (dateFrom && ISO_DATE_RE.test(dateFrom)) q = q.gte("data_reuniao", dateFrom);
    if (dateTo && ISO_DATE_RE.test(dateTo)) q = q.lte("data_reuniao", dateTo);
    return q.order("id");
  };
  const delibsRes = await lerTudo<any>(delibsQuery, "reunioes/deliberacoes");
  if (delibsRes.error) return NextResponse.json({ error: "Erro ao buscar reuniões" }, { status: 500 });
  if (delibsRes.truncated) {
    // Lista incompleta numa tela de cobertura se lê como "não existe". Erro declarado é melhor.
    return NextResponse.json(
      { error: "A lista de reuniões não caberia inteira nesta resposta. Filtre por ano ou agência." },
      { status: 500 },
    );
  }

  const computed = computeReunioesList(mapDeliberacaoRows(delibsRes.data ?? []), agenciaId);

  // Entidade materializada (Etapa 14): reuniões DESCOBERTAS pela coleta que ainda
  // não têm deliberação processada entram na lista (cobertura honesta) e as
  // demais ganham url_fonte/tipo. Fallback silencioso se a migration não foi aplicada.
  try {
    const reunioesQuery = () => {
      let q = db
        .from("reunioes")
        .select("agencia_id, numero_reuniao, tipo_reuniao, data_reuniao, url_fonte, source, agencia:agencias(sigla)")
        .not("data_reuniao", "is", null);
      if (agenciaId) q = q.eq("agencia_id", agenciaId);
      if (year && YEAR_RE.test(year)) q = q.gte("data_reuniao", `${year}-01-01`).lte("data_reuniao", `${year}-12-31`);
      if (dateFrom && ISO_DATE_RE.test(dateFrom)) q = q.gte("data_reuniao", dateFrom);
      if (dateTo && ISO_DATE_RE.test(dateTo)) q = q.lte("data_reuniao", dateTo);
      return q.order("id");
    };
    const matRes = await lerTudo<any>(reunioesQuery, "reunioes/materializadas");
    const materializadas = matRes.data;
    // ⚠️ `error` continua degradando em silêncio — é a tabela possivelmente não migrada, e isso é
    // desenho (`CLAUDE.md`: degrade-gracioso é PROPOSITAL). Mas `truncated` NÃO degrada: reunião
    // descoberta e não listada é justamente o que faz a tela dizer "não existe".
    const reunioesError = matRes.error;
    if (matRes.truncated) {
      return NextResponse.json(
        { error: "A lista de reuniões não caberia inteira nesta resposta. Filtre por ano ou agência." },
        { status: 500 },
      );
    }

    if (!reunioesError && materializadas) {
      const byKey = new Map(computed.map((r) => [`${r.agencia_id ?? "-"}__${r.data_reuniao ?? "-"}__${r.numero_reuniao ?? "-"}`, r]));
      for (const r of materializadas) {
        const key = `${r.agencia_id ?? "-"}__${r.data_reuniao ?? "-"}__${r.numero_reuniao ?? "-"}`;
        const match = byKey.get(key) as (typeof computed[number] & { url_fonte?: string | null }) | undefined;
        const agenciaRel = (r as { agencia?: { sigla?: string } | { sigla?: string }[] }).agencia;
        const sigla = Array.isArray(agenciaRel) ? agenciaRel[0]?.sigla ?? null : agenciaRel?.sigla ?? null;
        if (match) {
          if (r.url_fonte) match.url_fonte = r.url_fonte;
          if (!match.tipo_reuniao && r.tipo_reuniao) match.tipo_reuniao = r.tipo_reuniao;
        } else {
          computed.push({
            slug: key,
            agencia_id: r.agencia_id ?? null,
            agencia_sigla: sigla,
            data_reuniao: r.data_reuniao,
            numero_reuniao: r.numero_reuniao ?? null,
            tipo_reuniao: r.tipo_reuniao ?? null,
            total_itens: 0,
            total_votos: 0,
            votos_nominais: 0,
            votos_inferidos: 0,
            divergencias: 0,
            // Reunião ainda sem documento: não há base de consenso — `null`, não 0 (etapa65).
            pct_consenso: null,
            url_fonte: r.url_fonte ?? null,
            aguardando_documentos: true,
          } as typeof computed[number] & { url_fonte: string | null; aguardando_documentos: boolean });
        }
      }
      computed.sort((a, b) => (b.data_reuniao ?? "").localeCompare(a.data_reuniao ?? ""));
    }
  } catch {
    // Tabela reunioes ainda não migrada — lista derivada continua valendo.
  }

  return NextResponse.json(computed);
}
