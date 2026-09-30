/**
 * POST /api/v1/admin/deliberacoes/redatar[?dry_run=0]
 *
 * Re-deriva a `data_reuniao` das deliberações cuja data é IMPOSSÍVEL para a agência — anterior ao
 * ano em que ela foi criada.
 *
 * ═══ Por que existe ═══
 * Produção tinha 38 deliberações da ANM datadas de antes de 2017 (32 delas em 1996, numa única
 * "reunião"). A causa era um fallback sem âncora que pescava a data da LEI citada no preâmbulo
 * ("Lei nº 9.314, de 14 de novembro de 1996") — corrigido no commit anterior. Este passo cuida do
 * PASSIVO: o parser novo já não erra, mas as linhas erradas continuam lá.
 *
 * ═══ Por que RE-DERIVAR, e não anular ═══
 * O PDF continua no Storage e o texto extraído continua na coluna. Anular a data seria PIOR que
 * deixar 1996: `year-filter` conta deliberação sem data em TODOS os anos, então as 38 sairiam de
 * um limbo silencioso para inflar todo exercício. Re-derivar é a única opção que devolve dado
 * certo em vez de espalhar o erro. Só o resíduo irrecuperável vira NULL — e nunca NULL sozinho:
 * sempre com marcador de revisão.
 *
 * Read-mostly e idempotente: `dry_run` (padrão) só conta. Admin.
 */

import { exigirEscrita } from "@/lib/server/escrita-checada";
import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdminOrCron } from "@/lib/server/request-guards";
import { hasBudget, budgetFromRequest } from "@/lib/server/time-budget";
import { dataReuniaoPlausivel } from "@/lib/server/colegiado-sources";
import { extractAnmMeetingMetadata } from "@/lib/server/regulatory-documents";
import { extractDataReuniaoAncorada } from "@/lib/server/nlp-extractor";
import { ensureReuniao, serieDaReuniao } from "@/lib/server/reunioes";
import { GABARITO_POR_ARQUIVO } from "@/lib/server/gabarito";
import {
  dataDaListagem,
  portaoDaListagemAntt,
  type ReuniaoDaListagem,
  type VereditoDoPortao,
} from "@/lib/server/antt-data-da-listagem";
import { lerTudo } from "@/lib/server/select-all-paged";
import { lerEmLotes } from "@/lib/server/ler-em-lotes";
import { janelaRotativa } from "@/lib/server/varredura-rotativa";
import { lerAlvos, loteComAlvo } from "@/lib/server/alvo-de-redatar";

export const dynamic = "force-dynamic";
// Fase 12 — 60 → 120: esta rota honra `budget_ms`/HOBBY_BUDGET_MS (70s); declarar 60 aqui
// pediria o kill da plataforma ANTES de o próprio orçamento parar o trabalho. 120 é o valor
// que pipeline/run e o vercel.json já declaram e que os builds já provaram.
export const maxDuration = 120;

/** Saldo para tratar UMA deliberação (buscar texto, reparsear, gravar, reconciliar a reunião). */
const RESERVA_POR_LINHA_MS = 4_000;

/**
 * ⚠️ MEDIDO E DESLIGADO (Fase 33) — a data PLAUSÍVEL que discorda do documento.
 *
 * ═══ O que a produção mostrou, e o que a MEDIÇÃO desfez ═══
 * O QA da Fase 31 achou datas erradas no banco: a 81ª ROP da ANM (real 28/01/2026) gravada como
 * 2025-03-26, a 83ª (real 25/03/2026) como 2022-05-02, e a 1177ª da ARTESP como 2025-01-13 quando
 * os PDFs dizem 13/01/2026.
 *
 * ⚠️ Eu ia consertar o extrator, e escrevi que havia DOIS defeitos vivos nele: uma "âncora que
 * mente" (`realizada em` casando a data de outra reunião citada no corpo) e uma variante de
 * preâmbulo da 80ª que a regex da ANM não aceitaria. **Rodei o código de hoje contra os PDFs REAIS
 * do corpus e as duas afirmações caíram:**
 *   · 79ª → 2025-11-26 · 81ª → 2026-01-28 · 82ª → 2026-02-23 · 83ª → 2026-03-25 · ARTESP 22 →
 *     2026-01-13. Todas certas, e todas pelo caminho ANCORADO.
 *   · A "variante da 80ª" eu medi contra um preâmbulo que digitei à mão. **A 80ª não está no
 *     corpus** (`anm-ata-80-rop.pdf` não existe), então a afirmação não tinha base nenhuma.
 *
 * Logo as datas erradas são PASSIVO puro: linhas ingeridas antes do `dddf693` (24/08). E reingerir
 * não cura, porque `enrichDeliberacaoExistente` só preenche data NULA.
 *
 * ═══ Por que uma janela NOVA, e não `dataReuniaoPlausivel` ═══
 * A Janela A só pega data IMPOSSÍVEL — anterior ao ano de criação da agência. Para a ANM, qualquer
 * ano entre 2017 e 2027 passa, então `2022-05-02` e `2025-03-26` são invisíveis para ela. O detector
 * certo não é "é impossível?", é **"o documento concorda?"**: re-derivar pelo caminho ancorado e
 * comparar com o que está gravado. Se discordam, o gravado está errado — e a re-derivação já existe
 * nesta rota, é a mesma da Janela A.
 *
 * ═══ ⚠️ LIGADA na Fase 34, e o PORTÃO que a liberou ═══
 * Ela nasceu desligada porque trocar `data_reuniao` em massa muda o roster de voto de cada linha
 * afetada (`getActiveDiretoresForVote` seleciona por data). O portão era: **a re-derivação ancorada
 * tem de reproduzir o gabarito das 16 certificadas**, e é isso que o `etapa193` afirma, rodando a
 * MESMA função desta rota contra os PDFs reais. Ele está verde para ANM e ARTESP.
 *
 * ⚠️ E a ANTT continua FORA, agora com o preço medido: quatro reuniões (RDE 282, 286, 289 e RD
 * 1.035) ficam com a data errada porque `extractAnttDate` tem dois degraus **sem âncora nenhuma** —
 * a primeira data dd/mm/aaaa dos 2.500 primeiros caracteres —, que é o mecanismo exato que esta
 * rota existe para proibir. Entrar na ANTT exige tirar esses degraus antes, e o `etapa193` reprova
 * quem puser ANTT no recorte sem isso.
 *
 * O que ligar muda, medido nas dez reuniões que sumiram de 2026: a ARTESP recupera a 1177ª e a
 * 1186ª, e a ANM recupera as 80ª a 83ª — dobrando o denominador de 2026 dela.
 */
const REDATAR_DATA_DIVERGENTE = true;

/** Quantas linhas plausíveis a janela rotativa examina por rodada. */
const LOTE_DIVERGENTE = 120;

/**
 * ⚠️⚠️ AS AGÊNCIAS CUJA RE-DERIVAÇÃO ANCORADA ESTÁ CERTIFICADA — e este recorte NASCEU de um quase
 * acidente meu, pego pela medição antes de a regra ser ligada.
 *
 * O `etapa193` roda a MESMA re-derivação desta rota contra os PDFs reais do corpus e compara com o
 * gabarito. ANM e ARTESP: acertam todas. **A ANTT não:**
 *   · `antt-ata-264-rde.pdf` → o ancorado devolve `2025-10-08`; a data certa é `2026-01-19`;
 *   · `antt-ata-1024.pdf`, `antt-pauta-1036.pdf`, `antt-voto-dab-002.pdf` → devolvem `null`.
 *
 * A causa é conhecida: a data da ANTT sai do `antt-manual-parser` (`extractMeeting` para ata, e a
 * data de ASSINATURA do fecho para o voto individual), que não está na cascata ancorada.
 *
 * ⚠️ Sem este recorte, ligar `REDATAR_DATA_DIVERGENTE` reescreveria a data CERTA da 264ª pela ERRADA,
 * em massa, e mudaria o roster de voto de cada linha da ANTT. A janela mediria "divergência" e o
 * divergente seria o MEU parser, não o banco. É o modo de falha mais caro possível numa rota de
 * reparo: consertar para o lado errado com número verde.
 *
 * Para incluir a ANTT: a re-derivação precisa consultar o parser dela, e o `etapa193` tem de passar
 * com a ANTT dentro deste conjunto. Enquanto não passar, a ANTT fica fora — e a exclusão é publicada
 * em `divergente_fora_de_escopo`, não silenciosa.
 */
const AGENCIAS_COM_ANCORA_CERTIFICADA = new Set(["ANM", "ARTESP"]);

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    // Etapa65 — o ramo demo carrega TODAS as chaves do real; consumidor que lê `undefined` some.
    return NextResponse.json({
      modo: "demo", dry_run: true, candidatas: 0, corrigidas: 0,
      sem_data_recuperavel: 0, reunioes_orfas_removidas: 0, restantes: false, amostra: [],
      nulas_candidatas: 0, nulas_corrigidas: 0, nulas_marcadas_revisao: 0,
      // Etapa65 continua valendo: chave nova no real tem de existir no demo, senão o consumidor
      // que a lê recebe `undefined` e a tela mostra buraco em vez de zero.
      divergentes_medidas: 0, divergentes_corrigidas: 0, divergentes_por_agencia: {},
      divergentes_regra_ligada: REDATAR_DATA_DIVERGENTE, divergente_examinadas: 0,
      divergente_bloco: 0, divergente_blocos: 0, divergente_leitura_completa: true,
      divergente_fora_de_escopo: 0, divergente_sem_texto: 0,
      divergente_alvo_pedido: 0, divergente_alvo_encontrado: 0,
      divergente_agencias_no_escopo: [...AGENCIAS_COM_ANCORA_CERTIFICADA],
      amostra_divergente: [],
    });
  }
  const guard = await requireAdminOrCron(req, "redatar");
  if (guard) return guard;

  const dryRun = req.nextUrl.searchParams.get("dry_run") !== "0";
  const deadlineAt = Date.now() + budgetFromRequest(req);

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  const { data: agencias } = await db.from("agencias").select("id, sigla");
  const siglaPorId = new Map(((agencias ?? []) as Array<{ id: string; sigla: string }>).map((a) => [a.id, a.sigla]));

  // A janela é pequena por construção — data implausível é exceção, não regra.
  const { data: linhas, error } = await db
    .from("deliberacoes")
    .select("id, agencia_id, numero_reuniao, reuniao_ordinaria, tipo_reuniao, data_reuniao, raw_extraction")
    .not("data_reuniao", "is", null)
    .order("data_reuniao", { ascending: true })
    .limit(500);
  if (error) {
    return NextResponse.json({ error: `Falha ao listar deliberações: ${error.message}` }, { status: 500 });
  }

  const candidatas = ((linhas ?? []) as any[]).filter((d) => {
    const sigla = d.agencia_id ? siglaPorId.get(d.agencia_id) ?? null : null;
    return !dataReuniaoPlausivel(sigla, d.data_reuniao).plausivel;
  });

  let corrigidas = 0;
  let semDataRecuperavel = 0;
  let restantes = false;
  const amostra: Array<{ id: string; agencia: string | null; de: string; para: string | null }> = [];

  for (const d of candidatas) {
    if (!hasBudget(deadlineAt, RESERVA_POR_LINHA_MS)) { restantes = true; break; }
    const sigla = d.agencia_id ? siglaPorId.get(d.agencia_id) ?? null : null;

    // Fonte do texto, em ordem de qualidade: o documento (texto íntegro) e, se ele não existir
    // mais, o que a própria deliberação guardou.
    let texto = "";
    const { data: doc } = await db
      .from("documentos_regulatorios")
      .select("texto_extraido, filename")
      .eq("deliberacao_id", d.id)
      .maybeSingle();
    if (doc?.texto_extraido) texto = String(doc.texto_extraido);
    if (!texto) {
      const raw = (d.raw_extraction ?? {}) as Record<string, unknown>;
      texto = String(raw.raw_text ?? raw.texto_trecho ?? "");
    }

    // SÓ o caminho ancorado — DE VERDADE (Fase 15). A primeira versão dizia isso e chamava
    // `extractFields`, cujos parsers têm fallback "primeira data do documento": o mecanismo
    // exato do 1996, e `dataReuniaoPlausivel` não segura uma lei de 2019 citada num ato de 2026.
    let nova: string | null = null;
    if (texto) {
      const anm = extractAnmMeetingMetadata(texto, String(doc?.filename ?? ""));
      nova = anm.data_reuniao ?? extractDataReuniaoAncorada(texto) ?? null;
      // A data re-derivada passa pelo MESMO guard: se ela também for impossível, não serve.
      if (nova && !dataReuniaoPlausivel(sigla, nova).plausivel) nova = null;
    }

    if (amostra.length < 20) {
      amostra.push({ id: d.id as string, agencia: sigla, de: String(d.data_reuniao), para: nova });
    }
    if (dryRun) { nova ? corrigidas++ : semDataRecuperavel++; continue; }

    if (nova) {
      const reuniaoId = await ensureReuniao(db, {
        agenciaId: (d.agencia_id as string | null) ?? "",
        numeroReuniao: (d.numero_reuniao as string | null) ?? null,
        dataReuniao: nova,
        tipoReuniao: (d.tipo_reuniao as string | null) ?? null,
        // ⚠️ TÍTULO e SÉRIE. Sem eles, `ensureReuniao` cai no ramo sem filtro de série, e com o
        // índice único `COALESCE(serie,'')` isso pode religar a deliberação à linha da série ERRADA
        // (a 271ª RDE e a 1.028ª de Diretoria convivem na mesma data) ou criar uma linha com
        // `serie NULL`. Corrigir a data e errar a reunião seria trocar um defeito por outro.
        titulo: (d.reuniao_ordinaria as string | null) ?? null,
        // ⚠️ Mesma razão do confirm: fora da ANTT o título é só o número, e `deriveSerie` daria null —
        // corrigir a data com a série divergente religa a reunião à linha errada (o índice único
        // inclui `COALESCE(serie,'')`) ou cria duplicata.
        serie: serieDaReuniao({
          sigla: d.agencia_id ? siglaPorId.get(d.agencia_id) ?? null : null,
          titulo: (d.reuniao_ordinaria as string | null) ?? null,
          tipoReuniao: (d.tipo_reuniao as string | null) ?? null,
          numeroReuniao: (d.numero_reuniao as string | null) ?? null,
        }).serie,
      });
      if (await exigirEscrita(db.from("deliberacoes").update({
        data_reuniao: nova,
        ...(reuniaoId ? { reuniao_id: reuniaoId } : {}),
      }).eq("id", d.id), `redatar ${d.id}`)) corrigidas++;
    } else {
      // NULL nunca sozinho: sem o marcador, a linha entraria silenciosamente em TODOS os anos
      // (`year-filter` trata data ausente como "serve para qualquer filtro").
      const raw = (d.raw_extraction ?? {}) as Record<string, unknown>;
      await exigirEscrita(db.from("deliberacoes").update({
        data_reuniao: null,
        raw_extraction: {
          ...raw,
          data_invalidada_em: new Date().toISOString(),
          data_invalidada_valor: d.data_reuniao,
          data_invalidada_motivo: "anterior à criação da agência; texto não permitiu re-derivar",
          precisa_revisao_data: true,
        },
      }).eq("id", d.id), "redatar: marcador de data ausente");
      semDataRecuperavel++;
    }
  }

  // ═══ Fase 15 — a SEGUNDA janela: `data_reuniao` NULL ═══════════════════════
  // O QA da Fase 14 mediu 74 (66 ANTT + 8 ARTESP). Elas estavam fora desta rota POR CONSTRUÇÃO
  // (o `.not(...is null)` acima) — e são o pior dos dois mundos na tela: somem da listagem e
  // das reuniões, e INFLAM as agregações de todo ano (year-filter deixa passar quem não tem
  // data nenhuma). Fontes ANCORADAS, em ordem de confiança: a reunião já vinculada → a data que
  // o crawl leu na PÁGINA de listagem (monitoramento_itens, mantida fresca pelo auto-reparador)
  // → o texto do documento pelo caminho ancorado. Nada de fallback; quem continuar sem data
  // ganha `precisa_revisao_data` UMA vez e sai da janela (idempotência).
  let nulasCandidatas = 0;
  let nulasCorrigidas = 0;
  let nulasMarcadas = 0;
  {
    const { data: nulasRaw } = await db
      .from("deliberacoes")
      .select("id, agencia_id, numero_reuniao, reuniao_ordinaria, tipo_reuniao, reuniao_id, raw_extraction")
      .is("data_reuniao", null)
      .limit(300);
    const nulas = ((nulasRaw ?? []) as any[]).filter(
      (d) => !((d.raw_extraction ?? {}) as Record<string, unknown>).precisa_revisao_data,
    );
    nulasCandidatas = nulas.length;

    for (const d of nulas) {
      if (!hasBudget(deadlineAt, RESERVA_POR_LINHA_MS)) { restantes = true; break; }
      const sigla = d.agencia_id ? siglaPorId.get(d.agencia_id) ?? null : null;
      let nova: string | null = null;

      // (a) A reunião já vinculada — se o vínculo existe, a data dele é a melhor evidência.
      if (d.reuniao_id) {
        const { data: r } = await db.from("reunioes").select("data_reuniao").eq("id", d.reuniao_id).maybeSingle();
        nova = (r?.data_reuniao as string | null) ?? null;
      }

      // (b) O item de monitoramento que originou o documento — a data veio do parse da página.
      const { data: doc } = await db
        .from("documentos_regulatorios")
        .select("id, texto_extraido, filename")
        .eq("deliberacao_id", d.id)
        .maybeSingle();
      if (!nova && doc?.id) {
        const { data: itens } = await db
          .from("monitoramento_itens")
          .select("data_reuniao")
          .eq("documento_id", doc.id)
          .not("data_reuniao", "is", null)
          .limit(1);
        nova = ((itens ?? [])[0]?.data_reuniao as string | null) ?? null;
      }

      // (c) O texto, SÓ pelo caminho ancorado — mesmo contrato da janela de implausíveis.
      if (!nova) {
        let texto = doc?.texto_extraido ? String(doc.texto_extraido) : "";
        if (!texto) {
          const raw = (d.raw_extraction ?? {}) as Record<string, unknown>;
          texto = String(raw.raw_text ?? raw.texto_trecho ?? "");
        }
        if (texto) {
          const anm = extractAnmMeetingMetadata(texto, String(doc?.filename ?? ""));
          nova = anm.data_reuniao ?? extractDataReuniaoAncorada(texto) ?? null;
        }
      }

      if (nova && !dataReuniaoPlausivel(sigla, nova).plausivel) nova = null;

      if (amostra.length < 20) {
        amostra.push({ id: d.id as string, agencia: sigla, de: "(sem data)", para: nova });
      }
      if (dryRun) { nova ? nulasCorrigidas++ : nulasMarcadas++; continue; }

      if (nova) {
        const reuniaoId = await ensureReuniao(db, {
          agenciaId: (d.agencia_id as string | null) ?? "",
          numeroReuniao: (d.numero_reuniao as string | null) ?? null,
          dataReuniao: nova,
          tipoReuniao: (d.tipo_reuniao as string | null) ?? null,
          titulo: (d.reuniao_ordinaria as string | null) ?? null,
          // ⚠️ Mesma razão do confirm: fora da ANTT o título é só o número, e `deriveSerie` daria null —
        // corrigir a data com a série divergente religa a reunião à linha errada (o índice único
        // inclui `COALESCE(serie,'')`) ou cria duplicata.
        serie: serieDaReuniao({
          sigla: d.agencia_id ? siglaPorId.get(d.agencia_id) ?? null : null,
          titulo: (d.reuniao_ordinaria as string | null) ?? null,
          tipoReuniao: (d.tipo_reuniao as string | null) ?? null,
          numeroReuniao: (d.numero_reuniao as string | null) ?? null,
        }).serie,
        });
        if (await exigirEscrita(db.from("deliberacoes").update({
          data_reuniao: nova,
          ...(reuniaoId ? { reuniao_id: reuniaoId } : {}),
        }).eq("id", d.id), `redatar nula ${d.id}`)) nulasCorrigidas++;
      } else {
        // Marcador UMA vez: sem ele a linha voltaria a esta janela em toda rodada da esteira.
        const raw = (d.raw_extraction ?? {}) as Record<string, unknown>;
        await exigirEscrita(db.from("deliberacoes").update({
          raw_extraction: {
            ...raw,
            data_ausente_motivo: "sem data na origem; nenhuma fonte ancorada permitiu derivar",
            precisa_revisao_data: true,
          },
        }).eq("id", d.id), "redatar: marcador de data ausente");
        nulasMarcadas++;
      }
    }
  }

  // As linhas de `reunioes` com data impossível nunca foram reunião: são artefato do mesmo parse,
  // e são o que faz a tela de Reuniões listar "reunião da ANM em 1996". É tabela de rollup
  // derivada, não dado primário — aqui o DELETE é o certo, e só depois de as deliberações terem
  // sido religadas (acima) para nenhuma ficar apontando para o que vai sumir.
  // ═══ Fase 33 — a TERCEIRA janela: data PLAUSÍVEL que o DOCUMENTO desmente ═════
  //
  // ⚠️ MEDIDA e, por ora, DESLIGADA — ver o docblock de `REDATAR_DATA_DIVERGENTE`. A Janela A só vê
  // data impossível (anterior à criação da agência); a 81ª da ANM gravada como 2025-03-26 e a 83ª
  // como 2022-05-02 passam por ela sem tocar em nada. O detector certo é "o documento concorda?".
  let divergentesMedidas = 0;
  let divergentesCorrigidas = 0;
  const divergentesPorAgencia: Record<string, number> = {};
  const amostraDivergente: Array<{ id: string; agencia: string | null; de: string; para: string }> = [];
  let divergenteExaminadas = 0;
  let divergenteForaDeEscopo = 0;
  /**
   * ⚠️ O PULO SILENCIOSO, que agora tem número.
   *
   * `if (!fonte?.texto) continue` é correto — sem texto não se INVENTA divergência —, mas ele
   * era invisível, e a diferença que ele esconde muda o conserto: se a linha não tem texto
   * extraído, mais rodadas de esteira NUNCA resolvem, e o que falta é re-extração. Foi por não
   * ter este número que eu não pude descartar «ata sem texto» como causa das datas da ANM.
   */
  /** ⚠️ B.2 — filhos de ata excluídos da janela: eles NÃO têm texto próprio, por construção. */
  let divergenteFilhosFora = 0;
  /**
   * B.1 — as mães cuja data o PRÓPRIO documento confirma: as únicas de quem se propaga.
   *
   * ⚠️ Vive no escopo da função, e não dentro da Janela C, porque a reconciliação roda DEPOIS do laço
   * — em lote, para não pagar um round-trip por mãe (o N+1 que a Fase 29 mediu como causa do "90s").
   */
  const maesParaReconciliar: Array<{
    id: string; data: string; reuniaoId: string | null; sigla: string;
    /** QUEM validou a data desta mãe. A ANTT só entra por `listagem_antt`, e só se o portão passar. */
    validadaPor: "documento" | "listagem_antt";
  }> = [];
  /** B.1 — a reconciliação mãe → filhos, que é independente de a mãe receber escrita. */
  let maesValidadas = 0;
  let filhosDesalinhados = 0;
  let filhosAlinhados = 0;
  const amostraFilhos: Array<{ pai: string; filho: string; de: string | null; para: string | null; reuniao_mudou: boolean }> = [];
  let divergenteSemTexto = 0;
  /** Quantos números o `?alvo=` pediu, e quantas linhas casaram — zero e zero é o modo normal. */
  let divergenteAlvoPedido = 0;
  let divergenteAlvoEncontrado = 0;
  let divergenteBloco = 0;
  let divergenteBlocos = 0;
  let divergenteLeituraCompleta = true;
  if (hasBudget(deadlineAt, RESERVA_POR_LINHA_MS * 2)) {
    /**
     * ⚠️ `lerTudo`, não `.limit(N)`. A Janela A pode usar `.limit(500)` porque ordena por
     * `data_reuniao` ASC e data impossível é sempre a MENOR — as candidatas caem nas primeiras
     * linhas por construção. Aqui o universo é toda deliberação COM data, e `.limit()` do PostgREST
     * não pagina: seria a mesma subcontagem que a Fase 25 mediu em cinco telas.
     */
    const universo = await lerTudo<any>(
      () => db.from("deliberacoes")
        .select("id, agencia_id, numero_reuniao, reuniao_ordinaria, tipo_reuniao, data_reuniao, reuniao_id, documento_pai_id")
        .not("data_reuniao", "is", null)
        .order("id", { ascending: true }),
      "redatar/janela-divergente",
    );
    divergenteLeituraCompleta = !universo.error && !universo.truncated;
    // Fora as que a Janela A já trata — ali a decisão é outra (impossível ⇒ corrige ou anula).
    const jaTratadas = new Set(candidatas.map((d: any) => String(d.id)));
    const semAsTratadas = ((universo.data ?? []) as any[]).filter((d) => !jaTratadas.has(String(d.id)));
    /**
     * ═══ B.2 — ⚠️ FILHO DE ATA NÃO PODE SER CORRIGIDO AQUI, E ISSO É ESTRUTURAL ═══
     *
     * Um ITEM de ata não tem `documentos_regulatorios` próprio: a linha é por PDF (`UNIQUE(file_hash)`)
     * e o único escritor de `deliberacao_id` é `markDocumentReviewed`, que no ramo de ata recebe
     * `ataPai.id`. Esta janela busca o texto POR `deliberacao_id` — então todo filho cai em
     * `divergenteSemTexto`, sempre, por construção.
     *
     * O custo era real: o lote tem 120 linhas por chamada e o passo é sorteado ~4 vezes em 18
     * rodadas. Enchê-lo de filhos que serão pulados gasta a janela inteira em linhas que nunca podem
     * mudar. A "1 corrigida" da 80ª era a MÃE.
     *
     * ⚠️ E o cabeçalho da minha `etapa208` leu isto AO CONTRÁRIO. Os filhos se alinham por
     * RECONCILIAÇÃO com a mãe (B.1, logo abaixo), não por re-derivação própria.
     */
    const plausiveis = semAsTratadas.filter((d) => !d.documento_pai_id);
    divergenteFilhosFora = semAsTratadas.length - plausiveis.length;

    /**
     * ⚠️ MODO COM ALVO (`?alvo=81,82,83`), e por que ele era necessário.
     *
     * A janela rotativa examina `LOTE_DIVERGENTE` (120) linhas por chamada, sobre TODA deliberação com
     * data — milhares. E o passo `redatar` é sorteado poucas vezes por run: no QA de produção,
     * `tentou_redatar: 4` em 18 rodadas, ou seja ~480 linhas de milhares. A correção FUNCIONA e é
     * lenta, e eu li a lentidão como "pronto": o commit `924e523` afirmou que dez reuniões voltariam
     * para 2026 quando só parte delas tinha sido examinada. Três da ANM (81ª, 82ª, 83ª) seguem
     * erradas, e a 80ª já estava certa — o usuário conferiu uma por uma.
     *
     * Com alvo, "dez reuniões voltam para 2026" passa a ser verificável numa rodada, em vez de uma
     * promessa estatística. É o mesmo desenho que o recálculo de direção ganhou na Fase 27.
     *
     * ⚠️ O alvo NÃO afrouxa nenhum critério: a linha alvejada passa pelas MESMAS checagens (âncora
     * plausível, recorte certificado, texto presente). Ele só escolhe QUEM é examinado primeiro.
     */
    /**
     * ⚠️ MODO COM ALVO (`?alvo=81,82,83`) — ver `src/lib/server/alvo-de-redatar.ts` para o porquê.
     * Em resumo: a janela rotativa examina 120 de milhares e o passo é sorteado poucas vezes por run
     * (medido: 4 em 18 rodadas), então "dez reuniões voltam para 2026" era promessa estatística. O
     * alvo escolhe a ORDEM, nunca o critério.
     */
    const alvos = lerAlvos(req.nextUrl.searchParams.get("alvo"));

    // Janela rotativa: a rodada examina um bloco, e `blocos` diz em quantos minutos fecha a volta.
    const janela = janelaRotativa(plausiveis.length, LOTE_DIVERGENTE, Math.floor(Date.now() / 60_000));
    divergenteBloco = janela.bloco;
    divergenteBlocos = janela.blocos;
    const escolhido = loteComAlvo(
      plausiveis, alvos, janela, LOTE_DIVERGENTE,
      (d: any) => d.numero_reuniao, (d: any) => d.id,
    );
    const lote = escolhido.lote;
    divergenteAlvoPedido = alvos.size;
    divergenteAlvoEncontrado = escolhido.encontrados;

    /**
     * ⚠️ O texto vem em LOTES, não uma consulta por linha. Um `maybeSingle` por deliberação é o N+1
     * que a Fase 29 mediu como causa do "90s sem resposta" — 33 a 58 round-trips comendo a fatia.
     */
    const textos = new Map<string, { texto: string; filename: string }>();
    if (lote.length > 0) {
      const r = await lerEmLotes<any>(db, {
        tabela: "documentos_regulatorios",
        select: "deliberacao_id, texto_extraido, filename",
        coluna: "deliberacao_id",
        valores: lote.map((d) => String(d.id)),
        label: "redatar/textos-da-janela-divergente",
      });
      if (r.error) divergenteLeituraCompleta = false;
      for (const row of (r.data ?? []) as any[]) {
        if (!row.deliberacao_id) continue;
        textos.set(String(row.deliberacao_id), {
          texto: String(row.texto_extraido ?? ""), filename: String(row.filename ?? ""),
        });
      }
    }

    for (const d of lote) {
      if (!hasBudget(deadlineAt, RESERVA_POR_LINHA_MS)) { restantes = true; break; }
      const siglaDaLinha = d.agencia_id ? siglaPorId.get(d.agencia_id) ?? null : null;
      // ⚠️ Fora do recorte certificado a rota NÃO opina — ver `AGENCIAS_COM_ANCORA_CERTIFICADA`.
      if (!siglaDaLinha || !AGENCIAS_COM_ANCORA_CERTIFICADA.has(siglaDaLinha.toUpperCase())) {
        divergenteForaDeEscopo++;
        continue;
      }
      divergenteExaminadas++;
      const fonte = textos.get(String(d.id));
      if (!fonte?.texto) { divergenteSemTexto++; continue; } // sem texto não se INVENTA divergência
      const sigla = siglaDaLinha;
      const anm = extractAnmMeetingMetadata(fonte.texto, fonte.filename);
      const rederivada = anm.data_reuniao ?? extractDataReuniaoAncorada(fonte.texto) ?? null;
      // Sem âncora não há veredito. E a re-derivada passa pelo MESMO guard da Janela A.
      if (!rederivada || !dataReuniaoPlausivel(sigla, rederivada).plausivel) continue;
      if (rederivada === String(d.data_reuniao)) {
        /**
         * ═══ B.1 — A MÃE VALIDADA ═══
         *
         * Chegar aqui significa que o DOCUMENTO ancora exatamente a data que a mãe já tem: ela não
         * precisa de conserto, e é justamente por isso que ela é a referência boa. Era a 80ª da ANM
         * — certa desde sempre, com 28 linhas em 2024-06-25 e os 27 filhos desalinhados.
         *
         * ⚠️ E é por isto que a propagação é RECONCILIAÇÃO e não evento de escrita. O desenho inicial
         * disparava "após escrita de data da mãe"; a 80ª NUNCA recebe escrita (a re-derivação vê igual
         * e segue), então os 27 filhos ficariam desalinhados para sempre.
         *
         * A data de um item de ata não é uma inferência: ela É a data da ata. Alinhar é restaurar um
         * invariante estrutural, não opinar sobre o documento.
         */
        maesValidadas++;
        maesParaReconciliar.push({
          id: String(d.id),
          data: String(d.data_reuniao),
          reuniaoId: (d.reuniao_id as string | null) ?? null,
          sigla,
          validadaPor: "documento",
        });
        continue;
      }

      divergentesMedidas++;
      divergentesPorAgencia[sigla ?? "?"] = (divergentesPorAgencia[sigla ?? "?"] ?? 0) + 1;
      if (amostraDivergente.length < 20) {
        amostraDivergente.push({
          id: String(d.id), agencia: sigla, de: String(d.data_reuniao), para: rederivada,
        });
      }

      // ⚠️ O PORTÃO. Enquanto a constante for `false`, isto MEDE e não escreve — trocar a data muda
      // o roster de voto da linha, e o usuário vê o número antes.
      if (!REDATAR_DATA_DIVERGENTE || dryRun) continue;
      const reuniaoId = await ensureReuniao(db, {
        agenciaId: (d.agencia_id as string | null) ?? "",
        numeroReuniao: (d.numero_reuniao as string | null) ?? null,
        dataReuniao: rederivada,
        tipoReuniao: (d.tipo_reuniao as string | null) ?? null,
        // ⚠️ TÍTULO e SÉRIE. Sem eles, `ensureReuniao` cai no ramo sem filtro de série, e com o
        // índice único `COALESCE(serie,'')` isso pode religar a deliberação à linha da série ERRADA
        // (a 271ª RDE e a 1.028ª de Diretoria convivem na mesma data) ou criar uma linha com
        // `serie NULL`. Corrigir a data e errar a reunião seria trocar um defeito por outro.
        titulo: (d.reuniao_ordinaria as string | null) ?? null,
        // ⚠️ Mesma razão do confirm: fora da ANTT o título é só o número, e `deriveSerie` daria null —
        // corrigir a data com a série divergente religa a reunião à linha errada (o índice único
        // inclui `COALESCE(serie,'')`) ou cria duplicata.
        serie: serieDaReuniao({
          sigla: d.agencia_id ? siglaPorId.get(d.agencia_id) ?? null : null,
          titulo: (d.reuniao_ordinaria as string | null) ?? null,
          tipoReuniao: (d.tipo_reuniao as string | null) ?? null,
          numeroReuniao: (d.numero_reuniao as string | null) ?? null,
        }).serie,
      });
      if (await exigirEscrita(db.from("deliberacoes").update({
        data_reuniao: rederivada,
        ...(reuniaoId ? { reuniao_id: reuniaoId } : {}),
      }).eq("id", d.id), `redatar divergente ${d.id}`)) divergentesCorrigidas++;
    }
  }

  /**
   * ═══ B.3 — JANELA D: a data da ANTT pela LISTAGEM, atrás de um portão ═══
   *
   * A ANTT está fora de `AGENCIAS_COM_ANCORA_CERTIFICADA`: o preâmbulo dela não foi conferido contra
   * os PDFs, então a Janela C não opina. Mas a ANTT tem o que as outras não têm — a listagem do
   * próprio site, em `antt_reunioes_coletadas`, com `numero` e `data_inicio`.
   *
   * ⚠️ O PORTÃO não é opcional. Trocar uma data que eu não sei se está certa por outra que eu também
   * não sei não é conserto. O gabarito tem DUAS atas da ANTT conferidas à mão, a 1.024ª e a 264ª RDE,
   * ambas de 2026-01-19: se a listagem reproduz as duas, ela é testemunha; se não reproduz, o erro
   * está nela e aplicá-la espalharia o defeito por centenas de linhas. **Reprovado, não aplico e
   * declaro** — é o que o usuário pediu.
   *
   * ⚠️ E o veredito sai publicado COM o número de atas conferidas: "aprovado" sobre duas atas não
   * pode ser lido como "a listagem está certa".
   */
  let anttPortao: VereditoDoPortao | null = null;
  let anttDivergentes = 0;
  let anttCorrigidas = 0;
  const anttAmostra: Array<{ id: string; numero: string | null; de: string | null; para: string }> = [];
  if (hasBudget(deadlineAt, 5_000)) {
    const listagemRes = await lerTudo<ReuniaoDaListagem>(
      () => db.from("antt_reunioes_coletadas").select("numero, tipo, data_inicio").order("id"),
      "redatar/antt-listagem");
    // Leitura truncada = o portão veria uma listagem PARCIAL e poderia aprovar por acidente
    // (a ata conferida pode estar justamente no pedaço que faltou).
    if (listagemRes.error || listagemRes.truncated) {
      divergenteLeituraCompleta = false;
      anttPortao = { aprovado: false, conferidas: 0, batem: 0, divergem: [], motivo: "listagem_vazia" };
    } else {
      const listagem = listagemRes.data ?? [];
      const atasAntt = Object.values(GABARITO_POR_ARQUIVO)
        .filter((a) => String(a.agencia).trim().toUpperCase() === "ANTT")
        .map((a) => ({ reuniao: a.reuniao, data_reuniao: a.data_reuniao }));
      anttPortao = portaoDaListagemAntt(listagem, atasAntt);

      if (anttPortao.aprovado) {
        const anttId = [...siglaPorId.entries()].find(([, sig]) => sig?.toUpperCase() === "ANTT")?.[0] ?? null;
        if (anttId) {
          const delibsAntt = await lerTudo<any>(
            () => db.from("deliberacoes")
              .select("id, numero_reuniao, data_reuniao, tipo_reuniao, reuniao_ordinaria, reuniao_id, documento_pai_id")
              .eq("agencia_id", anttId).order("id"),
            "redatar/antt-deliberacoes");
          if (delibsAntt.error || delibsAntt.truncated) divergenteLeituraCompleta = false;
          for (const d of (delibsAntt.data ?? []) as any[]) {
            if (!hasBudget(deadlineAt, RESERVA_POR_LINHA_MS)) { restantes = true; break; }
            // ⚠️ Só MÃE/avulso. O filho segue a mãe pela reconciliação (B.1) — corrigi-lo aqui pela
            // listagem faria duas fontes escreverem a mesma linha, e a Fase 21 mediu o preço disso.
            if (d.documento_pai_id) continue;
            const daListagem = dataDaListagem(listagem, (d.numero_reuniao as string | null) ?? null);
            if (!daListagem) continue;
            if (daListagem === String(d.data_reuniao ?? "")) {
              // Já está certa: a mãe fica VALIDADA pela listagem e seus filhos podem ser alinhados.
              maesParaReconciliar.push({
                id: String(d.id), data: daListagem,
                reuniaoId: (d.reuniao_id as string | null) ?? null,
                sigla: "ANTT", validadaPor: "listagem_antt",
              });
              continue;
            }
            anttDivergentes++;
            if (anttAmostra.length < 20) {
              anttAmostra.push({
                id: String(d.id), numero: (d.numero_reuniao as string | null) ?? null,
                de: (d.data_reuniao as string | null) ?? null, para: daListagem,
              });
            }
            if (dryRun) continue;
            const reuniaoId = await ensureReuniao(db, {
              agenciaId: anttId,
              numeroReuniao: (d.numero_reuniao as string | null) ?? null,
              dataReuniao: daListagem,
              tipoReuniao: (d.tipo_reuniao as string | null) ?? null,
              titulo: (d.reuniao_ordinaria as string | null) ?? null,
              // ⚠️ Na ANTT a série vem do TÍTULO ou de nada — NUNCA da faixa numérica: a série
              // Administrativa ocupa 193-199 intercalada em 2026, e número lido errado também cai
              // abaixo de 200. `serieDaReuniao` já garante isso; aqui é só não contorná-lo.
              serie: serieDaReuniao({
                sigla: "ANTT",
                titulo: (d.reuniao_ordinaria as string | null) ?? null,
                tipoReuniao: (d.tipo_reuniao as string | null) ?? null,
                numeroReuniao: (d.numero_reuniao as string | null) ?? null,
              }).serie,
            });
            if (await exigirEscrita(db.from("deliberacoes").update({
              data_reuniao: daListagem,
              ...(reuniaoId ? { reuniao_id: reuniaoId } : {}),
            }).eq("id", d.id), `redatar ANTT pela listagem ${d.id}`)) {
              anttCorrigidas++;
              maesParaReconciliar.push({
                id: String(d.id), data: daListagem, reuniaoId: reuniaoId ?? null,
                sigla: "ANTT", validadaPor: "listagem_antt",
              });
            }
          }
        }
      }
    }
  }

  /**
   * ═══ B.1 — A RECONCILIAÇÃO, em lote e independente de escrita ═══
   *
   * ⚠️ ANTT fica FORA até o portão B.3. A âncora da ANTT não está certificada
   * (`AGENCIAS_COM_ANCORA_CERTIFICADA` já a exclui da Janela C), e a data dela vem de
   * `antt_reunioes_coletadas` — propagar de uma mãe cuja própria data ainda não foi validada
   * espalharia o erro para os filhos em vez de consertá-lo.
   */
  if (maesParaReconciliar.length > 0 && hasBudget(deadlineAt, 4_000)) {
    /**
     * ⚠️ ANTT só entra quando quem validou a data dela foi a LISTAGEM, e a listagem só vale se o
     * portão B.3 passou. Antes a regra era a sigla; expressa assim ela diz o que realmente importa —
     * propagar de mãe NÃO validada espalharia o erro para os filhos em vez de consertá-lo.
     */
    const maes = maesParaReconciliar.filter(
      (m) => m.sigla.toUpperCase() !== "ANTT" || m.validadaPor === "listagem_antt");
    const porId = new Map(maes.map((m) => [m.id, m]));
    if (maes.length > 0) {
      const r = await lerEmLotes<any>(db, {
        tabela: "deliberacoes",
        select: "id, documento_pai_id, data_reuniao, reuniao_id",
        coluna: "documento_pai_id",
        valores: maes.map((m) => m.id),
        label: "redatar/filhos-para-reconciliar",
      });
      // Leitura incompleta não vira escrita cega: sem saber quais filhos existem, alinhar parte
      // deles deixaria a ata metade num ano e metade noutro — pior que o desalinho inteiro.
      if (r.error) divergenteLeituraCompleta = false;
      else {
        for (const filho of (r.data ?? []) as any[]) {
          if (!hasBudget(deadlineAt, 1_500)) { restantes = true; break; }
          const mae = porId.get(String(filho.documento_pai_id));
          if (!mae) continue;
          const dataDifere = String(filho.data_reuniao ?? "") !== mae.data;
          const reuniaoDifere = mae.reuniaoId !== null
            && String(filho.reuniao_id ?? "") !== String(mae.reuniaoId);
          if (!dataDifere && !reuniaoDifere) continue;
          filhosDesalinhados++;
          if (amostraFilhos.length < 20) {
            amostraFilhos.push({
              pai: mae.id, filho: String(filho.id),
              de: (filho.data_reuniao as string | null) ?? null, para: mae.data,
              reuniao_mudou: reuniaoDifere,
            });
          }
          if (dryRun) continue;
          const ok = await exigirEscrita(db.from("deliberacoes").update({
            ...(dataDifere ? { data_reuniao: mae.data } : {}),
            ...(reuniaoDifere ? { reuniao_id: mae.reuniaoId } : {}),
          }).eq("id", filho.id), `reconciliar filho ${filho.id} com a mãe ${mae.id}`);
          if (ok) filhosAlinhados++;
        }
      }
    }
  }

  /**
   * ═══ B.5 — A REUNIÃO ÓRFÃ: contar e LISTAR antes de apagar ═══
   *
   * ⚠️ Três defeitos estavam aqui, e o pior era o silêncio.
   *
   *  1. **Apagava sem dry-run e sem rastro.** `dryRun` só impedia a entrada no bloco, então em modo
   *     de simulação o número era ZERO — quem quisesse conferir antes não tinha o que conferir. Agora
   *     a lista sai nos dois modos e o apagamento é o passo final.
   *  2. **`.limit(2000)` não pagina.** O PostgREST corta em ~1000 e devolve isso em silêncio: era a
   *     subcontagem que a Fase 24b mediu em cinco telas.
   *  3. **N+1 de contagem.** Uma consulta `count` por reunião candidata. As deliberações que apontam
   *     para cada reunião saem de UMA leitura paginada.
   *
   * O critério segue sendo data IMPOSSÍVEL para a agência — a órfã "plausível" de 2024-06-25 não é
   * alcançada aqui de propósito: apagá-la exigiria afirmar que a data está errada, e é o Bloco B que
   * decide isso pelo documento.
   */
  let reunioesOrfas = 0;
  let orfasCandidatas = 0;
  const orfasListadas: Array<{ id: string; agencia: string | null; data_reuniao: string; deliberacoes: number }> = [];
  if (hasBudget(deadlineAt, 3_000)) {
    const rs = await lerTudo<any>(
      () => db.from("reunioes").select("id, agencia_id, data_reuniao").order("id"),
      "redatar/reunioes-orfas");
    if (rs.error || rs.truncated) divergenteLeituraCompleta = false;
    const impossiveis = ((rs.data ?? []) as any[]).filter((r) => {
      const sigla = r.agencia_id ? siglaPorId.get(r.agencia_id) ?? null : null;
      return r.data_reuniao && !dataReuniaoPlausivel(sigla, r.data_reuniao).plausivel;
    });
    if (impossiveis.length > 0) {
      const vinculos = await lerTudo<{ reuniao_id: string | null }>(
        () => db.from("deliberacoes").select("reuniao_id").not("reuniao_id", "is", null).order("id"),
        "redatar/vinculos-de-reuniao");
      // Sem a lista COMPLETA de vínculos, "zero filhos" não é verificável — e apagar reunião que
      // ainda tem filho deixaria a deliberação apontando para o nada.
      if (vinculos.error || vinculos.truncated) {
        divergenteLeituraCompleta = false;
      } else {
        const filhosPorReuniao = new Map<string, number>();
        for (const v of vinculos.data ?? []) {
          if (!v.reuniao_id) continue;
          filhosPorReuniao.set(String(v.reuniao_id), (filhosPorReuniao.get(String(v.reuniao_id)) ?? 0) + 1);
        }
        for (const r of impossiveis) {
          const filhos = filhosPorReuniao.get(String(r.id)) ?? 0;
          if (filhos > 0) continue; // ainda tem filho: não é órfã, não se apaga
          orfasCandidatas++;
          if (orfasListadas.length < 50) {
            orfasListadas.push({
              id: String(r.id),
              agencia: r.agencia_id ? siglaPorId.get(r.agencia_id) ?? null : null,
              data_reuniao: String(r.data_reuniao),
              deliberacoes: filhos,
            });
          }
          if (dryRun) continue;
          if (await exigirEscrita(
            db.from("reunioes").delete().eq("id", r.id),
            `reunião órfã ${r.id} (${r.data_reuniao}, 0 deliberações)`,
          )) reunioesOrfas++;
        }
      }
    }
  }

  return NextResponse.json({
    dry_run: dryRun,
    candidatas: candidatas.length,
    corrigidas,
    sem_data_recuperavel: semDataRecuperavel,
    /**
     * ⚠️ B.5 — os TRÊS números da órfã, e eles viajam juntos. `removidas: 0` sozinho não distingue
     * "não havia órfã" de "não apagou porque era simulação" nem de "a leitura veio truncada".
     */
    reunioes_orfas_removidas: reunioesOrfas,
    reunioes_orfas_candidatas: orfasCandidatas,
    reunioes_orfas_listadas: orfasListadas,
    /**
     * ═══ B.1 — a reconciliação mãe → filhos ═══
     * `maes_validadas` são as mães cuja data o PRÓPRIO documento confirma (é delas, e só delas, que
     * se propaga). `filhos_desalinhados` é o estoque medido; `filhos_alinhados` o que esta rodada
     * escreveu — os dois juntos porque "0 alinhados" com "27 desalinhados" é simulação, e "0 e 0" é
     * trabalho concluído.
     */
    /**
     * ═══ B.3 — o portão da ANTT, e ele viaja INTEIRO ═══
     * `antt_portao.conferidas` é o que impede "aprovado" de ser lido como "a listagem está certa":
     * ele aprovou sobre DUAS atas. `antt_divergentes` é o estoque; `antt_corrigidas` o que esta
     * rodada escreveu.
     */
    antt_portao: anttPortao,
    antt_divergentes: anttDivergentes,
    antt_corrigidas: anttCorrigidas,
    antt_amostra: anttAmostra,
    maes_validadas: maesValidadas,
    filhos_desalinhados: filhosDesalinhados,
    filhos_alinhados: filhosAlinhados,
    amostra_filhos: amostraFilhos,
    /**
     * ⚠️ B.2 — quantos filhos de ata a Janela C EXCLUIU do universo. Eles não têm
     * `documentos_regulatorios` próprio (a linha é por PDF, e o `deliberacao_id` dela aponta para a
     * MÃE), então cairiam em `divergente_sem_texto` sempre, gastando a janela de 120 linhas em
     * candidatos que nunca podem mudar. Quem os alinha é a reconciliação acima.
     */
    divergente_filhos_fora: divergenteFilhosFora,
    nulas_candidatas: nulasCandidatas,
    nulas_corrigidas: nulasCorrigidas,
    nulas_marcadas_revisao: nulasMarcadas,
    /**
     * ⚠️ A Janela C — MEDIDA, e escrevendo nada enquanto `REDATAR_DATA_DIVERGENTE` for `false`.
     * `divergentes_regra_ligada` viaja junto para o número não depender de o leitor saber o valor da
     * constante: `divergentes_medidas: 44` com `regra_ligada: false` é medição, não conserto.
     */
    divergentes_medidas: divergentesMedidas,
    divergentes_corrigidas: divergentesCorrigidas,
    divergentes_por_agencia: divergentesPorAgencia,
    divergentes_regra_ligada: REDATAR_DATA_DIVERGENTE,
    divergente_examinadas: divergenteExaminadas,
    // ⚠️ Quantas a rodada PULOU porque a âncora da agência não está certificada (hoje, a ANTT).
    // Publicado para a exclusão ser um número na tela, e não uma omissão no código.
    divergente_fora_de_escopo: divergenteForaDeEscopo,
    divergente_sem_texto: divergenteSemTexto,
    divergente_alvo_pedido: divergenteAlvoPedido,
    divergente_alvo_encontrado: divergenteAlvoEncontrado,
    divergente_agencias_no_escopo: [...AGENCIAS_COM_ANCORA_CERTIFICADA],
    divergente_bloco: divergenteBloco,
    divergente_blocos: divergenteBlocos,
    // Leitura truncada = os números acima SUBCONTAM. Nunca deixar isso implícito.
    divergente_leitura_completa: divergenteLeituraCompleta,
    amostra_divergente: amostraDivergente,
    restantes,
    amostra,
    notice:
      "Re-deriva a data SÓ pelo caminho ancorado. Data não recuperável vira NULL com marcador de revisão — nunca NULL silencioso, porque deliberação sem data é contada em todos os anos.",
  });
}
