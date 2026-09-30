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
import { RE_CONTESTADO_AMPLO } from "@/lib/server/consistency-checks";
import {
  buracosDaSerie, faltandoContraListagem, medirReuniao, resumirPorAgencia,
  type EntradaDeNumeracao, type ItemDaListagem, type ReuniaoParaPlacar,
} from "@/lib/server/placar";
import {
  planejarCompletar, paresPorAgencia, type DeliberacaoParcial,
} from "@/lib/server/completar-colegiado";
import { colegiadoNaData, type MandatoJanela } from "@/lib/server/colegiado-na-data";
import { certificarContraGabarito, type ReuniaoNoBanco } from "@/lib/server/certificacao-gabarito";
import { GABARITO_POR_ARQUIVO, numeroDaReuniao } from "@/lib/server/gabarito";
import { ehVotoDeDirecao, isVotoNominal } from "@/lib/votos-nominal";

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
        // ⚠️ `fundamento_decisao`, `decisoes_todas` e `resumo_pleito` entram porque a RECUSA por
        // contestação usa a MESMA regex do materializador sobre o MESMO texto. Ler um campo
        // diferente produziria um segundo veredito sobre o mesmo conceito — e a Fase 21 mediu o
        // preço disso ("uma fonte por conceito").
        .select("id, agencia_id, numero_reuniao, data_reuniao, tipo_documento, documento_pai_id, " +
                "resultado, reuniao_id, raw_extraction, fundamento_decisao, decisoes_todas, resumo_pleito")
        .order("id"),
      "placar/deliberacoes"),
    /**
     * ⚠️ `is_nominal` entra na MESMA consulta (custo zero) porque ele decide uma RECUSA: fonte que
     * não nomina ninguém com voto nominal presente é o VOTO ARTEFATO da Fase 34, e completar em
     * volta dele multiplicaria o artefato por cinco em vez de apagá-lo.
     */
    lerTudo<{ deliberacao_id: string; diretor_id: string; is_nominal: boolean | null; proveniencia: string | null; tipo_voto: string | null }>(
      /**
       * ⚠️ `tipo_voto` e `proveniencia` entram no select, e custam ZERO (mesma página):
       *  · `proveniencia` porque `isVotoNominal` é a ÚNICA fonte da verdade sobre nominalidade — um
       *    voto `revisao_humana` com `is_nominal=false` era lido aqui como inferido;
       *  · `tipo_voto` porque `Ausente`/`Impedido` nominais não são artefato (a fonte diz quem
       *    faltou sem dizer quem votou como), e bloquear por causa deles deixava a deliberação
       *    parcial para sempre.
       */
      () => db.from("votos").select("deliberacao_id, diretor_id, is_nominal, proveniencia, tipo_voto").order("id"),
      "placar/votos"),
    lerTudo<any>(
      () => db.from("mandatos")
        // Os MESMOS filtros do motor de voto (`getActiveDiretoresForVote`): mandato fabricado a
        // partir do próprio voto não pode ampliar o roster, e diretor rejeitado não entra.
        // ⚠️ `situacao` e `metadata` JÁ EXISTEM — o afastamento vive em `metadata->>'afastado_desde'`
        // justamente para este select não depender de migration (ver `vote-inference.ts`).
        .select("diretor_id, data_inicio, data_fim, diretores!inner(id, agencia_id, review_status, situacao, metadata)")
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
      /**
       * ⚠️ A janela de AFASTAMENTO propagada, e ela é o que impede o placar de discordar do motor de
       * voto. Sem isto, `colegiadoNaData` contaria um diretor afastado como esperado enquanto
       * `getActiveDiretoresForVote` não criaria voto para ele — e a reunião apareceria eternamente
       * incompleta por um motivo que não é defeito nosso nem cadastro pendente.
       */
      afastado_desde: (dir.metadata?.afastado_desde as string | null) ?? null,
      afastado_ate: (dir.metadata?.afastado_ate as string | null) ?? null,
    });
  }

  const votantesPorDelib = new Map<string, Set<string>>();
  const temNominalPorDelib = new Set<string>();
  const temNominalDeDirecaoPorDelib = new Set<string>();
  for (const v of votosRes.data ?? []) {
    if (!v.deliberacao_id || !v.diretor_id) continue;
    const s = votantesPorDelib.get(v.deliberacao_id) ?? new Set<string>();
    s.add(v.diretor_id);
    votantesPorDelib.set(v.deliberacao_id, s);
    if (isVotoNominal(v)) {
      temNominalPorDelib.add(v.deliberacao_id);
      if (ehVotoDeDirecao(v.tipo_voto)) temNominalDeDirecaoPorDelib.add(v.deliberacao_id);
    }
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
    const atual: ReuniaoParaPlacar & { agencia_id: string } = porReuniao.get(chave) ?? {
      agencia: sigla, agencia_id: d.agencia_id, serie,
      numero_reuniao: d.numero_reuniao, data_reuniao: d.data_reuniao,
      votantes: [] as string[], itens: [],
    };
    const vs = votantesPorDelib.get(d.id);
    if (vs) for (const id of vs) if (!atual.votantes.includes(id)) atual.votantes.push(id);
    /**
     * ⚠️ UMA ENTRADA POR DELIBERAÇÃO, e é isso que a régua estrita consome. `votantes` (acima) é a
     * UNIÃO — o numerador do teto, que não distingue quem votou em 1 de 39 itens de quem votou nos
     * 39. Os dois convivem de propósito: o teto mantém o histórico comparável, os itens dão a
     * cobertura de verdade.
     */
    atual.itens.push({ id: String(d.id), respondido_por: vs ? [...vs] : [] });
    porReuniao.set(chave, atual);
  }

  const buracos = buracosDaSerie(entradas, de, ate);

  /**
   * ⚠️ O QUE FALTA DEPOIS DO ÚLTIMO NÚMERO — invisível para `buracosDaSerie` por construção.
   *
   * Aquela função infere ausência ENTRE o menor e o maior do acervo, então uma reunião nova que
   * ninguém coletou não aparece como buraco: aparece como se não existisse. Contra a LISTAGEM da
   * fonte não há inferência, é diferença de conjuntos — e ela alcança o fim da série.
   *
   * Hoje só a ANTT tem a listagem no banco (`antt_reunioes_coletadas`, com `numero` e `tipo`, que são
   * as três séries). Para ANM e ARTESP o campo sai vazio e o alerta diz isso, em vez de o silêncio
   * passar por "nada falta".
   */
  let contraListagem: ReturnType<typeof faltandoContraListagem> = [];
  if (hasBudget(deadlineAt, RESERVA_DE_FECHO_MS)) {
    const listagemRes = await lerTudo<any>(
      () => db.from("antt_reunioes_coletadas").select("agencia_id, numero, tipo").order("id"),
      "placar/listagem-antt");
    if (parcial(listagemRes)) {
      alertas.push("⚠️ leitura de `antt_reunioes_coletadas` incompleta — o que falta no FIM da série pode subcontar.");
    }
    const listagem: ItemDaListagem[] = [];
    for (const l of (listagemRes.data ?? []) as any[]) {
      if (!l.agencia_id || !idsColegiados.has(l.agencia_id)) continue;
      listagem.push({
        agencia: siglaPorId.get(l.agencia_id) ?? "?",
        serie: (l.tipo as string | null) ?? null,
        numero_reuniao: (l.numero as string | null) ?? null,
      });
    }
    contraListagem = faltandoContraListagem(entradas, listagem);
    for (const f of contraListagem) {
      if (f.ausentes.length > 0) {
        alertas.push(
          `${f.agencia}/${f.serie ?? "?"}: a listagem da fonte tem ${f.ausentes.length} reunião(ões) que o ` +
            `acervo NÃO tem (${f.ausentes.slice(0, 12).join(", ")}${f.ausentes.length > 12 ? "…" : ""}). ` +
            `Último no acervo: ${f.ultimo_no_acervo ?? "nenhum"}; na listagem: ${f.ultimo_na_listagem ?? "nenhum"}.`,
        );
      }
      /**
       * ⚠️ Série que a listagem tem e o acervo não tem NENHUM número é quase sempre casamento de
       * SÉRIE, não coleta faltando: é o passivo do mojibake que gravou toda RDE como "ordinaria".
       * Dizer "faltam 26 reuniões" nesse caso seria mandar recoletar o que já está no banco.
       */
      if (f.ultimo_no_acervo === null && f.ausentes.length > 0) {
        alertas.push(
          `${f.agencia}/${f.serie ?? "?"}: o acervo não tem NENHUM número desta série. Antes de tratar como ` +
            "coleta faltando, confira `reunioes.serie` — o passivo do mojibake gravou RDE como «ordinaria».",
        );
      }
    }
  } else {
    alertas.push("⚠️ sem orçamento para conferir contra a listagem da fonte — o fim da série não foi medido nesta rodada.");
  }

  // ─── (b) O colegiado por reunião ──────────────────────────────────────────
  const medidas = [...porReuniao.values()].map((r) => medirReuniao(r, r.agencia_id, mandatos));
  const resumo = resumirPorAgencia(medidas);

  /**
   * ═══ COMPLETAR COLEGIADO PARCIAL — a MEDIÇÃO, e a escrita NÃO existe ═══
   *
   * O materializador só visita deliberação com ZERO voto; uma com 3 de 5 é pulada para sempre. É por
   * isso que o José Fernando tem 1 voto em todo 2026 depois da migration que o restaurou. Aqui sai o
   * número do que SERIA criado — e, mais importante, o que é RECUSADO e por quê
   * (`src/lib/server/completar-colegiado.ts`).
   *
   * ⚠️ NÃO HÁ ESCRITA NESTE CAMINHO, e isso é deliberado: afirmar que alguém votou é a escrita mais
   * cara desta esteira (a Fase 28 pegou um erro de leitura que produzia voto FABRICADO para o
   * colegiado inteiro). O número vai à tela primeiro, com as recusas ao lado, e a escrita entra na
   * fase seguinte com o aval do usuário sobre este número. Um passo de escrita que ainda não foi
   * medido é exatamente o que este projeto aprendeu a não aceitar.
   *
   * Custo: ZERO consulta nova — tudo isto já foi lido para o placar.
   */
  const paraCompletar: DeliberacaoParcial[] = [];
  const siglaPorDelib = new Map<string, string>();
  for (const d of (delibsRes.data ?? []) as any[]) {
    if (!d.agencia_id || !idsColegiados.has(d.agencia_id)) continue;
    if (!d.data_reuniao || d.data_reuniao < de || d.data_reuniao > ate) continue;
    if (!isFinalDecisionRecord(d)) continue;
    const responderam = votantesPorDelib.get(d.id);
    // Sem NENHUM voto é trabalho do materializador, que já a visita. O caso novo é o PARCIAL.
    if (!responderam || responderam.size === 0) continue;
    const raw = (d.raw_extraction ?? {}) as Record<string, unknown>;
    const sigla = siglaPorId.get(d.agencia_id) ?? "?";
    siglaPorDelib.set(String(d.id), sigla);
    paraCompletar.push({
      id: String(d.id),
      sigla,
      tipo_documento: (d.tipo_documento as string | null) ?? null,
      resultado: (d.resultado as string | null) ?? null,
      /**
       * ⚠️ A MESMA regex e o MESMO texto do materializador — `RE_CONTESTADO_AMPLO` sobre decisão +
       * dispositivo (`fundamento_decisao`, `decisoes_todas`, `raw.assunto`, `raw.decisao`,
       * `resumo_pleito`). Eu ia ler uma flag `raw_extraction->>'sinais_contestacao'`, e conferi: ela
       * NÃO é gravada — o materializador re-deriva do texto. A flag daria `false` sempre, a recusa
       * por contestação nunca dispararia, e o número publicado seria maior do que o real. Um
       * diagnóstico otimista sobre uma escrita que afirma voto é o pior tipo de erro aqui.
       */
      contestado: RE_CONTESTADO_AMPLO.test(
        [
          (d as { fundamento_decisao?: string | null }).fundamento_decisao,
          ...(((d as { decisoes_todas?: string[] | null }).decisoes_todas) ?? []),
          raw.assunto as string | undefined,
          raw.decisao as string | undefined,
          (d as { resumo_pleito?: string | null }).resumo_pleito,
        ].filter(Boolean).join(" "),
      ),
      roster: colegiadoNaData(mandatos, d.agencia_id, d.data_reuniao),
      jaResponderam: [...responderam],
      temVotoNominalDeDirecao: temNominalDeDirecaoPorDelib.has(String(d.id)),
      temPai: Boolean(d.documento_pai_id),
    });
  }
  const plano = planejarCompletar(paraCompletar);
  const completavelPorAgencia = paresPorAgencia(plano, (id) => siglaPorDelib.get(id) ?? "?");
  if (plano.pares.length > 0) {
    /**
     * ⚠️ ESTE NÚMERO É TETO, e dizer isso é parte do número.
     *
     * Aqui o roster sai de `colegiadoNaData` — MANDATO. O motor que escreveria usa os PRESENTES do
     * documento (`resolverPresentesRoster`) e ainda passa por `conferirRoster`; o portão por item
     * exige que o preâmbulo nomeie a pessoa. Logo o motor planeja MENOS, nunca mais.
     *
     * O número do motor sai de `POST /api/v1/admin/votos/materializar-faltantes` com
     * `{ completar_parcial: true, dry_run: true }`. Publicar só este, sem o rótulo, seria prometer
     * uma cobertura que a escrita não entrega.
     */
    alertas.push(
      `${plano.pares.length} par(es) (deliberação × diretor) poderiam receber voto inferido — ` +
        `${Object.entries(completavelPorAgencia).map(([k, v]) => `${k} ${v}`).join(" · ")}. ` +
        "⚠️ É TETO (roster de MANDATO): o motor usa os PRESENTES do documento e planeja menos — " +
        "o número dele sai em materializar-faltantes com completar_parcial+dry_run. " +
        "A ESCRITA está DESLIGADA: este número existe para você decidir antes.",
    );
  }
  for (const [motivo, n] of Object.entries(plano.porMotivo)) {
    alertas.push(`${n} deliberação(ões) RECUSADAS para completar, motivo «${motivo}».`);
  }

  // As incompletas, nomeadas — um placar que só dá o número não diz o que fazer em seguida.
  const nomePorDiretor = new Map<string, string>();
  if (hasBudget(deadlineAt, RESERVA_DE_FECHO_MS)) {
    const { data: dirs } = await db.from("diretores").select("id, nome");
    for (const d of (dirs ?? []) as Array<{ id: string; nome: string }>) nomePorDiretor.set(d.id, d.nome);
  }
  const nomeDe = (id: string) => nomePorDiretor.get(id) ?? id;

  /**
   * ═══ B.0 → (c) A CERTIFICAÇÃO NO BANCO, que era zero fixo com `pendente: true` ═══
   *
   * A subtração banco × gabarito, para as cinco atas conferidas à mão contra os PDFs oficiais. É a
   * VERIFICAÇÃO depois de aplicar — nunca o portão. (O portão do revoto é a SIMULAÇÃO do roster na
   * data certa, em memória: o banco de uma reunião com data errada não pode bater com o gabarito
   * ANTES do revoto, e exigir que batesse seria um portão circular.)
   *
   * ⚠️ O casamento é por (agência, NÚMERO), nunca por data: a data é exatamente o que o Bloco B está
   * consertando, e casar por ela faria o gabarito deixar de reconhecer as reuniões cuja data está
   * errada — as que mais precisam ser conferidas.
   *
   * ⚠️ E quando mais de uma série casa o mesmo número (ANM tem ROP e REP), as linhas são SOMADAS e a
   * divergência aparece como `itens_a_mais`, com um alerta dizendo que o casamento foi ambíguo. Somar
   * e denunciar é honesto; escolher uma das duas em silêncio seria adivinhar.
   */
  const noBanco: Record<string, ReuniaoNoBanco | undefined> = {};
  const ambiguidades: string[] = [];
  for (const [arquivo, ata] of Object.entries(GABARITO_POR_ARQUIVO)) {
    const numeroAlvo = numeroDaReuniao(ata.reuniao);
    const siglaAlvo = String(ata.agencia).trim().toUpperCase();
    const linhas = (delibsRes.data ?? []).filter((d: any) => {
      if (!d.agencia_id) return false;
      if ((siglaPorId.get(d.agencia_id) ?? "").toUpperCase() !== siglaAlvo) return false;
      return numeroDaReuniao(d.numero_reuniao) === numeroAlvo;
    });
    if (linhas.length === 0) { noBanco[arquivo] = undefined; continue; }
    const datas = new Set(linhas.map((d: any) => String(d.data_reuniao ?? "").slice(0, 10)).filter(Boolean));
    if (datas.size > 1) {
      ambiguidades.push(`${siglaAlvo} ${ata.reuniao}: ${datas.size} datas distintas no banco para o mesmo número (${[...datas].sort().join(", ")}) — as linhas foram somadas`);
    }
    const porDiretor = new Map<string, number>();
    for (const d of linhas) {
      for (const dirId of votantesPorDelib.get(String(d.id)) ?? []) {
        porDiretor.set(dirId, (porDiretor.get(dirId) ?? 0) + 1);
      }
    }
    noBanco[arquivo] = {
      itens: linhas.length,
      votosPorDiretor: [...porDiretor.entries()].map(([id, votos]) => ({ nome: nomeDe(id), votos })),
    };
  }
  const certificacao = certificarContraGabarito(GABARITO_POR_ARQUIVO, noBanco);
  for (const a of ambiguidades) alertas.push(`⚠️ certificação ambígua — ${a}.`);
  if (certificacao.divergem.length > 0) {
    alertas.push(
      `Certificação contra o gabarito: ${certificacao.batem} de ${certificacao.conferidas} atas batem. ` +
        `${certificacao.divergem.length} divergência(s) — a primeira: ${certificacao.divergem[0].tipo} em ` +
        `${certificacao.divergem[0].ata}${certificacao.divergem[0].diretor ? ` (${certificacao.divergem[0].diretor})` : ""}, ` +
        `esperado ${certificacao.divergem[0].esperado}, encontrado ${certificacao.divergem[0].encontrado}.`,
    );
  }
  /**
   * ⚠️ O FILTRO É PELA RÉGUA ESTRITA. Pelo teto, uma reunião em que um diretor votou em 1 de 39
   * itens é "completa" e sairia desta lista — foi exatamente o caso do José Fernando na 84ª da ANM.
   * A lista de trabalho tem de mostrar o que falta trabalhar.
   */
  const incompletas = medidas
    .filter((m) => m.classe_estrita !== "completa")
    .sort((a, b) => b.data_reuniao.localeCompare(a.data_reuniao))
    .slice(0, 80)
    .map((m) => ({
      agencia: m.agencia, serie: m.serie, numero_reuniao: m.numero_reuniao,
      data_reuniao: m.data_reuniao, classe: m.classe, classe_estrita: m.classe_estrita,
      esperado: m.esperado, com_voto: m.com_voto,
      itens: m.itens_total,
      pares_esperados: m.pares_esperados, pares_respondidos: m.pares_respondidos,
      faltando: m.faltando.map(nomeDe), extra: m.extra.map(nomeDe),
      /**
       * A frase que o usuário pediu: "José Fernando sem voto em 38 de 39 itens da 84ª". Sem isto a
       * lista diz apenas "faltam nomes", e não distingue quem faltou em tudo de quem faltou em quase
       * tudo — que é a diferença entre um diretor ausente e um diretor que a esteira perdeu.
       */
      sem_voto_por_diretor: m.cobertura
        .filter((c) => c.respondidos < c.de)
        .sort((a, b) => a.respondidos - b.respondidos)
        .map((c) => ({ diretor: nomeDe(c.diretor_id), sem_voto_em: c.de - c.respondidos, de: c.de })),
    }));

  for (const [sigla, r] of Object.entries(resumo)) {
    if (r.defeito_nosso > 0) alertas.push(`${sigla}: ${r.defeito_nosso} reunião(ões) com voto FALTANDO — é defeito nosso.`);
    if (r.cadastro_pendente > 0) alertas.push(`${sigla}: ${r.cadastro_pendente} reunião(ões) com voto de quem não tem mandato declarado — depende do DOU.`);
    /**
     * ⚠️ A DISTÂNCIA entre as duas réguas, dita em voz alta. Sem este alerta, quem lê
     * `completas/total` acha que está em 84% quando a cobertura por item é outra — e o número maior é
     * justamente o que não deve guiar o trabalho.
     */
    if (r.completas > r.completas_estrito) {
      alertas.push(
        `${sigla}: ${r.completas} reunião(ões) parecem completas pelo TETO (≥1 voto por diretor), mas só ` +
          `${r.completas_estrito} têm voto ou motivo em TODOS os itens. Cobertura real: ${r.cobertura_pct}% ` +
          `(${r.pares_respondidos} de ${r.pares_esperados} pares deliberação×diretor).`,
      );
    }
    if (r.diretores_parciais > 0) {
      alertas.push(
        `${sigla}: ${r.diretores_parciais} caso(s) de diretor com voto em PARTE dos itens da reunião — ` +
          "invisível na régua do teto, e é onde mora o trabalho que falta.",
      );
    }
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
    faltando_contra_listagem: contraListagem,
    colegiado_por_reuniao: resumo,
    reunioes_incompletas: incompletas,
    completar_parcial: {
      pares: plano.pares.length,
      por_agencia: completavelPorAgencia,
      recusas_por_motivo: plano.porMotivo,
      escrita_existe: false,
    },
    /**
     * (c) AGORA MEDIDO. Era `{0, 0, [], pendente: true}` — um pilar declarado e invisível.
     * `conferidas` são as atas do gabarito; `batem` as que fecham item a item e voto a voto.
     */
    certificacao_no_banco: {
      conferidas: certificacao.conferidas,
      batem: certificacao.batem,
      divergem: certificacao.divergem,
      /** As atas que o gabarito cobre, nomeadas — para ninguém ler `conferidas: 5` como "tudo". */
      atas: Object.values(GABARITO_POR_ARQUIVO).map((a) => `${a.agencia} ${a.reuniao}`),
      casamento: "por (agência, número) — NUNCA por data, que é o que o Bloco B está consertando",
      ambiguidades,
    },
    finais_no_ano: finaisNoAno,
    leitura_completa: leituraCompleta && !serieParcial,
    alertas,
  });
}
