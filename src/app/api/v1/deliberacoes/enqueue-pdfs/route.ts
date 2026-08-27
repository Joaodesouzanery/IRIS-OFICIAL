/**
 * POST /api/v1/deliberacoes/enqueue-pdfs
 *
 * Conecta o módulo de Monitoramento ao pipeline de Deliberações: busca itens
 * monitorados que apontam para PDFs de decisão (ata/voto/deliberação), baixa
 * cada PDF e o enfileira em upload_jobs via enqueuePdfBuffer (mesmo caminho do
 * upload manual). O processamento real (extração de texto + sugestão de votos)
 * acontece em /api/v1/upload/process; a confirmação dos votos individuais
 * continua sendo feita por revisão humana em /api/v1/upload/confirm.
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { hasBudget, budgetFromRequest } from "@/lib/server/time-budget";
import { RESERVA } from "@/lib/server/esteira-reservas";
import { resolvePdfLinks, sniffIsDocx, sniffIsHtml, sniffIsPdf, sniffIsZip } from "@/lib/server/pdf-link-resolver";
import { TIPOS_ESTEIRA_VOTOS } from "@/lib/esteira-tipos";
import { mapComConcorrencia, criarReservaAdaptativa } from "@/lib/server/concorrencia";
import { resilientFetch } from "@/lib/server/resilient-fetch";

export const dynamic = "force-dynamic";

// Tipos de item que representam (ou CONTÊM) decisões. QA ago/2026: "documento" é o
// fallback do classificador e "reuniao" é a página-mãe do coletor ANTT-2026 — ambos
// ficavam de fora e apodreciam em status 'novo' para sempre.
// Fase 7: a lista saiu daqui para `@/lib/esteira-tipos` porque a TELA precisa dela — enquanto era
// local, a UI prometia enfileirar tipos que este gate nunca aceitou.
const DECISION_TIPOS = TIPOS_ESTEIRA_VOTOS;
// Heurística de PRIORIZAÇÃO apenas (não é mais gate): URL com cara de PDF vai primeiro.
const PDF_RE = /\.pdf(?:$|[/?#])|\/@@download\/file(?:$|[/?#])/i;
// Teto por chamada é a JANELA (60): o freio real é o orçamento (reserva 22s/item).
// Antes era 10 fixo — com saldo sobrando, a rodada parava cedo à toa (QA ago/2026).
const MAX_PER_RUN = 60;
// (MAX_TENTATIVAS morreu na Fase 8: as 3 tentativas queimavam na mesma rodada, sem
// espera nenhuma entre elas. O ciclo agora é medido em DIAS — ver MAX_CICLOS_RETRY.)
// Downloads simultâneos. 5 é conservador de propósito: o ganho vem de usar a espera de rede,
// não de martelar o portal da agência — que é um serviço público e pode ter rate limit.
const CONCORRENCIA_DOWNLOAD = 5;
// Quantos PDFs tirar de UMA página. Uma reunião publica pauta + ata + N votos: a maior medida no
// corpus real é 7 (a 1036ª da ANTT). 12 espelha o teto do próprio `resolvePdfLinksFromHtml`, então
// não há um segundo corte escondido aqui. Uma página de DOCUMENTO (Plone /view) é um documento só.
const MAX_FILHOS_REUNIAO = 12;
const MAX_FILHOS_DOCUMENTO = 1;
// Quantos PDFs tirar de UM arquivo ZIP. O maior medido no acervo da ARTESP tem 58 entradas; 60 da
// folga e e redondo. NAO reusar MAX_FILHOS_DOCUMENTO: aquele numero descreve "uma pagina de
// documento rende um documento", e continua verdadeiro.
// ⚠️ Precisa ser MENOR que TETO_ENQUEUE_POR_RODADA, senao um ZIP grande nunca cabe numa rodada e
// o item nunca sai de 'novo' — re-baixando e re-hasheando as mesmas entradas para sempre.
const MAX_PDFS_POR_ZIP = 60;
// Teto por documento. O guard do `enqueuePdfBuffer` (50 MB) só roda DEPOIS do download
// inteiro em memória; aqui o corte acontece antes de o buffer entrar na colheita.
const MAX_BYTES_POR_DOCUMENTO = 50 * 1024 * 1024;
// Saldo mínimo para gravar MAIS UM filho (upload no Storage + inserts + update). Medido com folga:
// o custo real é de centenas de ms, mas parar cedo custa uma rodada e parar tarde custa a função.
const RESERVA_GRAVACAO_MS = 6_000;
// Vagas que o RETRY pode ocupar por chamada. Pequeno de propósito: o trabalho novo tem prioridade
// absoluta, e o caso que este conserto atende (o portal voltou) drena em poucas rodadas.
const COTA_RETRY_POR_CHAMADA = 5;
// Ciclos de retry antes de desistir de vez. Com o backoff em DIAS, isto é ~2 semanas de espera —
// tempo de sobra para um portal fora do ar voltar. Passar disso é insistir num link que mudou.
const MAX_CICLOS_RETRY = 4;
/** Backoff em DIAS: o cron roda 1x/dia, então qualquer coisa em horas seria o mesmo que nada. */
function proximaTentativaEm(ciclo: number): string {
  const dias = [1, 3, 7, 14][Math.min(ciclo, 3)];
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString();
}

export async function POST(req: NextRequest) {
  const guard = await requireAdminOrCron(req);
  if (guard) return guard;

  if (isDemo()) {
    return NextResponse.json({ error: "Indisponível em modo DEMO." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    agencia_sigla?: string;
    limit?: number;
    process?: boolean;
    /**
     * Fase 8 — teto de VAZÃO em PDFs. O orquestrador tem `TETO_ENQUEUE_POR_RODADA` (60), mas o
     * que ele passava era `limit`, que conta ITENS. Enquanto um item rendia 1-6 PDFs isso
     * funcionava por acaso; com o teto de filhos em 12, uma chamada de 20 itens poderia gravar
     * 240 PDFs contra um teto de 60. O teto tem de ser contado na unidade que ele limita.
     */
    max_pdfs?: number;
  };
  const limit = Math.min(MAX_PER_RUN, Math.max(1, Number(body.limit ?? MAX_PER_RUN)));
  const maxPdfs = Number.isFinite(Number(body.max_pdfs)) && Number(body.max_pdfs) > 0
    ? Number(body.max_pdfs)
    : Number.POSITIVE_INFINITY;

  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const { enqueuePdfBuffer, ensurePdfStorageBucket } = await import("@/lib/server/upload-queue");
  const { processQueue } = await import("@/lib/server/pipeline");

  const db = createSupabaseServerClient();
  const bucketErr = await ensurePdfStorageBucket(db);
  if (bucketErr) return NextResponse.json({ error: bucketErr }, { status: 500 });

  // Busca candidatos: itens "novo" de tipo decisão. Filtramos PDFs em memória
  // porque url_item pode terminar em /@@download/file ou .pdf.
  let query = db
    .from("monitoramento_itens")
    .select("id, agencia_id, tipo, titulo, url_item, status, metadata")
    .eq("status", "novo")
    .in("tipo", DECISION_TIPOS as unknown as string[])
    .order("data_reuniao", { ascending: false, nullsFirst: false })
    .limit(60);

  if (body.agencia_sigla?.trim()) {
    const { data: agencia } = await db
      .from("agencias")
      .select("id")
      .eq("sigla", body.agencia_sigla.trim().toUpperCase())
      .maybeSingle();
    if (agencia?.id) query = query.eq("agencia_id", agencia.id);
  }

  const { data: itens, error } = await query;
  if (error) {
    return NextResponse.json({ error: `Falha ao listar itens monitorados: ${error.message}` }, { status: 500 });
  }

  // ═══ Fase 8 — RETRY, numa consulta SEPARADA e com COTA PRÓPRIA ═══════════════
  //
  // Um item arquivado por `download_falhou` é um item que o portal não entregou naquela hora —
  // não é um item sem valor. O re-crawl nunca o ressuscitava (na colisão de hash só se atualiza
  // `last_seen_at`), então portal fora do ar por três tentativas = ata perdida para sempre.
  //
  // Por que uma consulta À PARTE, e não `.in("status", ["novo","ignorado"])`: os itens que falham
  // são, por construção, os mais RECENTES (página publicada antes dos PDFs, PDF que deu 403), e a
  // janela é ordenada por `data_reuniao DESC`. Misturá-los os colocaria no TOPO, ocupando as 60
  // vagas antes dos itens realmente novos — que é exatamente o head-of-line de "208 detectados /
  // 0 na fila" que a esteira já pagou uma vez. Com cota separada e pequena, o retry nunca rouba a
  // vez do trabalho novo.
  let retentar: any[] = [];
  if (!body.agencia_sigla?.trim()) {
    const agora = new Date().toISOString();
    const { data: elegiveis } = await db
      .from("monitoramento_itens")
      .select("id, agencia_id, tipo, titulo, url_item, status, metadata, tentativas")
      .eq("status", "ignorado")
      .in("tipo", DECISION_TIPOS as unknown as string[])
      .lt("tentativas", MAX_CICLOS_RETRY)
      .lte("proxima_tentativa_em", agora)
      .order("proxima_tentativa_em", { ascending: true })
      .limit(COTA_RETRY_POR_CHAMADA);
    // Sem a migration `20260826140000` a consulta falha (coluna inexistente) e `elegiveis` vem
    // undefined: o retry simplesmente não acontece, e a esteira segue como antes.
    retentar = (elegiveis ?? []).filter((it: any) => {
      const meta = (it.metadata ?? {}) as Record<string, unknown>;
      // Falha de REDE volta sempre (o portal pode ter voltado). `sem_pdf` volta APENAS quando
      // alguém carimbou `proxima_tentativa_em` de propósito — e o carimbo É o opt-in: o caminho
      // que grava `sem_pdf` limpa a coluna (logo abaixo, na gravação), então item novo nunca
      // reentra sozinho. Quem carimba é a migration da Fase 9, e só para o que foi arquivado por
      // um gate que ainda não sabia ler ZIP.
      //
      // Sem essa assimetria, retentar `sem_pdf` seria um moinho: a página institucional que não
      // tem documento nenhum seria relida a cada ciclo, consumindo o teto de vazão da rodada.
      return meta.enqueue_motivo === "download_falhou" || meta.enqueue_motivo === "sem_pdf";
    });
  }

  // QA ago/2026: o gate por regex de URL matava ARTESP (DAM sem .pdf) e ANM (/view) e,
  // como o rejeitado nunca mudava de status, os mesmos 60 bloqueavam a janela para
  // sempre (208 detectados / 0 na fila). Agora TODO item da janela é tentado — o
  // critério é o CONTEÚDO (sniff) — e quem não tem PDF ganha status terminal (drena).
  const novosCandidatos = (itens ?? [])
    .sort((a, b) => Number(PDF_RE.test(String(b.url_item ?? ""))) - Number(PDF_RE.test(String(a.url_item ?? ""))))
    .slice(0, limit);
  // Os novos SEMPRE primeiro; o retry ocupa só o que sobrar da fatia desta chamada.
  const candidates = [...novosCandidatos, ...retentar.slice(0, Math.max(0, limit - novosCandidatos.length))];
  const idsEmRetry = new Set(retentar.map((r: any) => String(r.id)));

  const results: Array<{
    monitoramento_item_id: string;
    titulo: string;
    url: string;
    status: string;
    job_id: string | null;
    message?: string;
  }> = [];
  const jobsToProcess: Array<{ jobId: string; agenciaId: string | null }> = [];

  // Orçamento Hobby (60s SIGKILL): 10 PDFs × 20s de timeout estouraria o limite. Para
  // graciosamente; itens não processados continuam "novo" e entram no próximo clique.
  const deadlineAt = Date.now() + budgetFromRequest(req);
  let restantes = 0;
  let semPdf = 0;
  // Filhos que a página tinha e o teto descartou. Teto silencioso foi exatamente o que
  // escondeu a perda de um voto por reunião — se voltar a truncar, tem de aparecer.
  let filhosTruncados = 0;

  // ═══ Fase 7 — DOWNLOAD EM PARALELO, GRAVAÇÃO EM SÉRIE ═══════════════════════
  // Era tudo em série com reserva FIXA de 22s (o timeout de rede) contra uma fatia de 25s: só o
  // primeiro item cabia, e a rodada enfileirava 1 a 3 PDFs. O gargalo é REDE — o processo passava
  // a janela ociosa esperando o portal. Baixar em paralelo usa essa espera; a reserva adaptativa
  // para de assumir o pior caso quando as respostas reais chegam em 1-3s. As ESCRITAS continuam
  // em série logo abaixo: o ganho é de rede, e serializar o banco mantém o comportamento
  // (contadores, status terminal, ordem dos `results`) idêntico ao que os testes já travam.
  const adaptativa = criarReservaAdaptativa(RESERVA.enqueue);

  type Colhido =
    | { ok: true; pdfs: Array<{ url: string; buffer: Buffer; filename?: string; sourceArchive?: string }>; motivo?: string }
    | { ok: false; erro: unknown };

  const colheita = await mapComConcorrencia(
    candidates,
    { concorrencia: CONCORRENCIA_DOWNLOAD, deadlineAt, reservaMs: () => adaptativa.reserva() },
    async (item): Promise<Colhido> => {
      const url = String(item.url_item);
      const iniciado = Date.now();
      try {
        const fetched = await fetchUrl(url);
        // Gate por CONTEÚDO: PDF direto (mesmo sem .pdf na URL — ARTESP/DAM), ou página
        // HTML de onde extraímos os PDFs de dentro (reunião ANTT, documento Plone ANM).
        const pdfs: Array<{ url: string; buffer: Buffer; filename?: string; sourceArchive?: string }> = [];
        // Quantos PDFs a PÁGINA tinha (antes de qualquer teto) — 0 quando a URL já é o PDF.
        let pdfsNaPagina = 0;
        if (sniffIsPdf(fetched.contentType, fetched.buffer)) {
          pdfs.push({ url, buffer: fetched.buffer });
        } else if (sniffIsZip(fetched.buffer)) {
          // ═══ Fase 9 — o terceiro ramo: ZIP ═══════════════════════════════════════
          // Medido ao vivo na pagina de reunioes da ARTESP: das 256 URLs de documento, 76 sao ZIP
          // e 88% de tudo que ela rotula "Deliberacao" e ZIP. O gate conhecia dois estados — "e
          // PDF" ou "e HTML com links de PDF" — e o ZIP caia no vao, virando `sem_pdf` terminal:
          // 133 deliberacoes da ARTESP arquivadas como se a pagina estivesse vazia. Amostra de 11
          // ZIPs: 207 PDFs dentro, media 18,8. O `zip-extractor` ja existia desde julho, ligado so
          // ao upload MANUAL — o upload comia o mesmo ZIP que a esteira jogava fora.
          //
          // A ordem importa: este ramo vem ANTES do HTML porque `PK\x03\x04` e exato e
          // `sniffIsHtml` casa `<head` em qualquer lugar dos primeiros 512 bytes.
          if (sniffIsDocx(fetched.contentType, url, fetched.buffer)) {
            // ⚠️ DOCX E ZIP. Sem este teste, os 32 .docx da ARTESP entrariam aqui, sairiam com
            // zero entradas .pdf e voltariam a ser arquivados como "sem PDF" — o mesmo diagnostico
            // errado por um caminho novo. O projeto nao LE docx (so gera); o que se pode fazer de
            // honesto e dar a eles um motivo proprio, que diz o que de fato aconteceu.
            return { ok: true, pdfs: [], motivo: "formato_nao_suportado:docx" };
          }
          try {
            const { extractPdfEntriesFromZip } = await import("@/lib/server/zip-extractor");
            const entradas = extractPdfEntriesFromZip(fetched.buffer, {
              // 100 e o default do extrator: ele LANCA ao exceder, e o corte tem de ser NOSSO,
              // para ser reportado em vez de virar erro. O maior ZIP medido tem 58 entradas.
              maxFiles: 100,
              // Guard de MEMORIA, nao de conteudo: a colheita segura todos os buffers vivos ate a
              // gravacao terminar, e sao ate 5 downloads simultaneos.
              maxTotalUncompressedBytes: 60 * 1024 * 1024,
            });
            if (entradas.length === 0) {
              return { ok: true, pdfs: [], motivo: "zip_sem_pdf" };
            }
            pdfsNaPagina = entradas.length;
            for (const entrada of entradas.slice(0, MAX_PDFS_POR_ZIP)) {
              // `entrada.name`, NUNCA `deriveFilename`: a URL do ZIP nao tem segmento .pdf, entao
              // os 19 documentos receberiam o mesmo nome — o bug que a Fase 8 matou, voltando pelo
              // ZIP. E o nome de dentro do arquivo e o bom ("DELIBERACAO ARTESP Nº 620_...pdf").
              pdfs.push({ url, buffer: entrada.buffer, filename: entrada.name, sourceArchive: url.split("/").pop()?.slice(0, 180) });
            }
          } catch (erroZip) {
            // try/catch PROPRIO: o extrator lanca em ZIP corrompido, ZIP64 e deflate64. Deixar
            // cair no catch externo classificaria isso como falha de REDE — e a Fase 8 daria a ele
            // 4 ciclos de retry ao longo de ~25 dias por um arquivo que nunca vai mudar.
            const msg = erroZip instanceof Error ? erroZip.message : "ZIP ilegivel";
            return { ok: true, pdfs: [], motivo: `zip_invalido:${msg.slice(0, 60)}` };
          }
        } else if (sniffIsHtml(fetched.contentType, fetched.buffer)) {
          const { links, totalEncontrado } = resolvePdfLinks(fetched.buffer.toString("utf8"), url);
          pdfsNaPagina = totalEncontrado;
          // Fase 8 — o teto era 6 e a 1036ª Reunião de Diretoria da ANTT tem SETE PDFs. Medido
          // contra a fixture real: pauta, ata e CINCO votos individuais, nessa ordem no DOM. Como
          // pauta e ata vêm primeiro, o corte caía sempre sobre a última peça da lista — e essa
          // peça é um VOTO DE DIRETOR, o documento mais valioso da esteira. Um por reunião.
          // 12 cobre com folga o maior caso medido (7). O resolvedor tem teto próprio (30) e
          // devolve `totalEncontrado`, então o que for cortado pelos DOIS tetos é reportado em
          // vez de sumir — descarte silencioso foi exatamente o que escondeu esta perda.
          const maxFilhos = item.tipo === "reuniao" ? MAX_FILHOS_REUNIAO : MAX_FILHOS_DOCUMENTO;
          for (const link of links) {
            if (pdfs.length >= maxFilhos) break;
            if (!hasBudget(deadlineAt, adaptativa.reserva())) break;
            try {
              const filho = await fetchUrl(link);
              if (sniffIsPdf(filho.contentType, filho.buffer)) pdfs.push({ url: link, buffer: filho.buffer });
            } catch { /* tenta o próximo link da página */ }
          }
        }
        // O truncamento soma os DOIS tetos: o do resolvedor (MAX_LINKS) e o daqui. Medir só
        // `links.length - pdfs.length` reportaria zero numa página de 40 documentos, porque o
        // resolvedor já teria cortado antes de nós vermos.
        if (pdfsNaPagina > pdfs.length && pdfs.length > 0) {
          filhosTruncados += pdfsNaPagina - pdfs.length;
        }
        return { ok: true, pdfs };
      } catch (erro) {
        return { ok: false, erro };
      } finally {
        adaptativa.registrar(Date.now() - iniciado);
      }
    },
  );
  restantes += colheita.naoIniciados.length;

  // ═══ Fase 8 — o laço de GRAVAÇÃO passa a ter freio ═══════════════════════════
  // A colheita respeitava o orçamento; a gravação, NENHUMA vez. Cada filho é um upload no Storage
  // + inserts + update, em série. Com 1-6 filhos isso cabia; ao subir o teto para 12, o SIGKILL
  // dos 60s passa a alcançar o meio do laço — e aí os PDFs já gravados FICAM enquanto o item
  // continua "novo", que é a receita de trabalho duplicado na rodada seguinte. Além disso o teto
  // de vazão da rodada é contado em PDFs, não em itens.
  let pdfsGravados = 0;
  for (const { item, valor } of colheita.concluidos) {
    if (!hasBudget(deadlineAt, RESERVA_GRAVACAO_MS)) { restantes++; continue; }
    if (pdfsGravados >= maxPdfs) { restantes++; continue; }
    const url = String(item.url_item);
    const itemMeta = (item.metadata && typeof item.metadata === "object" ? item.metadata : {}) as Record<string, unknown>;
    try {
      if (!valor.ok) throw valor.erro;
      const pdfs = valor.pdfs;

      const pdfsAntes = pdfsGravados;
      if (pdfs.length === 0) {
        // TERMINAL: sai da janela com MOTIVO (antes ficava 'novo' para sempre bloqueando os itens
        // atrás — head-of-line). Fase 9: o motivo deixa de ser sempre `sem_pdf`. Um .docx, um ZIP
        // corrompido e uma página institucional vazia são três coisas diferentes, e somá-las num
        // motivo só foi o que escondeu 198 documentos da ARTESP atrás de "a página não tinha PDF".
        const motivoTerminal = valor.motivo ?? "sem_pdf";
        await db
          .from("monitoramento_itens")
          .update({
            status: "ignorado",
            metadata: { ...itemMeta, enqueue_motivo: motivoTerminal },
            // Limpar o carimbo é o que faz o retry de `sem_pdf` ser de UM TIRO. Um item que a
            // migration reabriu e que voltou a não render documento sai daqui sem prazo — e sem
            // prazo a consulta de retry não o alcança (NULL não satisfaz `<=`). Sem esta linha, o
            // prazo vencido de ontem continuaria vencido amanhã: moinho.
            proxima_tentativa_em: null,
            last_seen_at: new Date().toISOString(),
          })
          .eq("id", item.id);
        semPdf++;
        results.push({
          monitoramento_item_id: item.id as string,
          titulo: String(item.titulo ?? url),
          url,
          status: "sem_pdf",
          job_id: null,
          message: motivoTerminal === "sem_pdf"
            ? "Nenhum PDF encontrado na URL/página — item arquivado com motivo."
            : `Arquivado: ${motivoTerminal}.`,
        });
        continue;
      }

      let algumOk = false;
      let algumErro = false;
      let filhosAdiados = 0;
      for (const pdf of pdfs) {
        // Parar ENTRE filhos, nunca no meio de um: `enqueuePdfBuffer` é atômico por documento.
        // O item só é marcado `importado` se nada ficou de fora — senão ele volta na próxima
        // rodada e o `file_hash` UNIQUE evita regravar o que já entrou.
        //
        // ⚠️ Fase 9 — o TETO (`maxPdfs`) saiu daqui, e ficou só na entrada do item (acima). Um ZIP
        // da ARTESP tem até 58 entradas contra um teto de rodada de 60: cortando no meio dele, o
        // item NUNCA completava, voltava na rodada seguinte, re-baixava o mesmo ZIP, re-hasheava
        // as mesmas entradas (todas duplicatas) e adiava de novo — livelock, com o item preso em
        // 'novo' para sempre. Com o corte só entre itens, o item vira atômico: ou entra inteiro,
        // ou nem começa. A rodada pode passar do teto em no máximo MAX_PDFS_POR_ZIP - 1.
        if (!hasBudget(deadlineAt, RESERVA_GRAVACAO_MS)) {
          filhosAdiados = pdfs.length - (pdfsGravados - pdfsAntes);
          restantes++;
          break;
        }
        // `pdf.filename` vem das entradas do ZIP (o nome de dentro do arquivo, que é o bom);
        // `deriveFilename` só entra para PDF direto e para filho de página HTML.
        const filename = pdf.filename ?? deriveFilename(item.titulo as string, pdf.url);
        const enqueued = await enqueuePdfBuffer({
          db,
          filename,
          buffer: pdf.buffer,
          agenciaId: (item.agencia_id as string | null) ?? null,
          sourceArchive: pdf.sourceArchive ?? null,
          metadata: {
            uploaded_via: "monitoramento_deliberacoes",
            monitoramento_item_id: item.id,
            source_url: pdf.url,
            item_tipo: item.tipo,
            ...(pdf.sourceArchive ? { source_zip_entry: pdf.filename } : {}),
          },
        });

        // `existing_archived` fica FORA daqui de propósito: o documento já foi arquivado por
        // decisão (pauta/apoio/duplicata/ilegível) e reprocessá-lo seria desfazer a decisão —
        // o ping-pong da Fase 7 voltando pela porta do enfileiramento.
        if (
          (enqueued.status === "queued" || enqueued.status === "existing_failed") &&
          enqueued.job_id
        ) {
          jobsToProcess.push({ jobId: enqueued.job_id, agenciaId: (item.agencia_id as string | null) ?? null });
        }
        pdfsGravados++;
        if (enqueued.status === "error" || enqueued.status === "rejected") algumErro = true;
        else algumOk = true;

        results.push({
          monitoramento_item_id: item.id as string,
          titulo: String(item.titulo ?? filename),
          url: pdf.url,
          status: enqueued.status,
          job_id: enqueued.job_id,
          message: enqueued.message,
        });
      }

      // Marca o item como importado para não reprocessar (exceto erro real em tudo).
      // Fase 8: com filhos adiados por orçamento/teto, o item NÃO pode ser dado por importado —
      // senão os filhos que sobraram nunca mais seriam buscados.
      if (filhosAdiados === 0 && (algumOk || !algumErro)) {
        await db
          .from("monitoramento_itens")
          .update({
            status: "importado",
            // Fase 8: o item entrou. Zera o ciclo e apaga o prazo — se um dia ele voltar à fila
            // por outro caminho, começa limpo em vez de herdar o histórico de um portal que caiu.
            tentativas: 0,
            proxima_tentativa_em: null,
            last_seen_at: new Date().toISOString(),
          })
          .eq("id", item.id);
      }
    } catch (err) {
      // ═══ Falha de download — Fase 8: arquivar deixou de significar MORRER ═══
      //
      // Antes: 3 falhas → 'ignorado' para sempre, e o re-crawl nunca revisava o status. Só que as
      // "3 tentativas" nunca foram 3 dias: enquanto o item ficava em 'novo' entre elas, a chamada
      // seguinte do MESMO laço o re-selecionava do topo da janela — as três queimavam em segundos,
      // dentro de uma única rodada de 50s. Um portal com um soluço de um minuto perdia a ata.
      //
      // Agora o item continua sendo arquivado (para sair da janela e não bloquear a fila), mas com
      // um PRAZO: `proxima_tentativa_em` em 1, 3, 7 e 14 dias. Ele volta sozinho quando o prazo
      // vence, pela consulta de retry — que tem cota própria e não disputa vaga com o trabalho novo.
      // O relógio é uma COLUNA porque `last_seen_at` é bumpado pelo crawl diário e `metadata` é
      // sobrescrito inteiro pelo auto-enfileiramento: nenhum dos dois serve de relógio.
      const cicloAnterior = Number((item as any).tentativas) || 0;
      const ciclo = cicloAnterior + 1;
      const msg = err instanceof Error ? err.message : "Falha ao baixar PDF";
      const desistiu = ciclo >= MAX_CICLOS_RETRY;
      await db
        .from("monitoramento_itens")
        .update({
          status: "ignorado",
          tentativas: ciclo,
          // Sem prazo = não volta mais. É a desistência explícita, depois de ~25 dias de espera.
          proxima_tentativa_em: desistiu ? null : proximaTentativaEm(cicloAnterior),
          metadata: {
            ...itemMeta,
            captura_erro: msg.slice(0, 300),
            enqueue_motivo: desistiu ? "download_falhou_desistido" : "download_falhou",
          },
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      results.push({
        monitoramento_item_id: item.id as string,
        titulo: String(item.titulo ?? url),
        url,
        status: "error",
        job_id: null,
        message: desistiu
          ? `${msg} (arquivado em definitivo após ${MAX_CICLOS_RETRY} ciclos de retry)`
          : `${msg} (ciclo ${ciclo}/${MAX_CICLOS_RETRY} — volta a ser tentado depois do prazo)`,
      });
    }
  }

  // Processa em background (ou aguarda quando solicitado por cron/teste).
  //
  // ⚠️ Fase 10 — o `waitUntil` rodava com `deadlineAt` UNDEFINED: até `MAX_PER_RUN` PDFs eram
  // extraídos (pdf-parse é CPU síncrono, às vezes OCR) na MESMA invocação, fora de QUALQUER
  // orçamento. O `deadlineAt` desta rota já existia e não era repassado — era o candidato
  // mecânico mais forte para a rodada que "passou de 90s sem resposta". O background agora
  // respeita o mesmo relógio de quem o disparou.
  let processed = 0;
  if (jobsToProcess.length > 0) {
    if (body.process) {
      await processQueue(jobsToProcess.slice(0, MAX_PER_RUN), 2, deadlineAt);
      processed = jobsToProcess.length;
    } else {
      waitUntil(processQueue(jobsToProcess.slice(0, MAX_PER_RUN), 2, deadlineAt));
    }
  }

  const queued = results.filter((r) => r.status === "queued").length;
  return NextResponse.json({
    candidates: candidates.length,
    queued,
    processed,
    enqueued_jobs: jobsToProcess.length,
    sem_pdf: semPdf,
    ...(filhosTruncados > 0 ? { filhos_truncados: filhosTruncados } : {}),
    // Quantos desta chamada eram RETENTATIVAS (itens que o portal não entregou antes e cujo prazo
    // venceu). Sem reportar, uma rodada que só retentou pareceria uma rodada que não achou nada.
    ...(idsEmRetry.size > 0
      ? {
          retentados: candidates.filter((c) => idsEmRetry.has(String(c.id))).length,
          retentados_com_sucesso: results.filter(
            (r) => idsEmRetry.has(r.monitoramento_item_id) && r.status === "queued",
          ).length,
        }
      : {}),
    parcial: restantes > 0,
    restantes,
    results,
    notice:
      "Votos individuais são sugeridos automaticamente (mandato + texto da ata) e só são gravados após confirmação humana em Revisão.",
  });
}

/**
 * Fase 8 — passou a usar `resilientFetch`.
 *
 * Era `fetch` cru: um soluço de um segundo no portal (503, reset de conexão, 429) queimava um
 * ciclo inteiro de retry, e o item só voltaria a ser tentado DIAS depois. O projeto já tinha a
 * peça certa — backoff exponencial com jitter, `Retry-After` em 429, classificação
 * rede×conteúdo — usada pelo coletor de monitoramento e ignorada exatamente aqui, onde os PDFs
 * são baixados.
 *
 * Parâmetros apertados de propósito: UMA tentativa extra e timeout de 10s (pior caso ~20,4s,
 * dentro da reserva de 22s do passo). O retry longo, em dias, é a rede de segurança — este aqui
 * só existe para o blip que não merece esperar até amanhã. O throttle por host fica no padrão
 * (0, salvo `COLLECTOR_HOST_THROTTLE_MS`) para não serializar os downloads concorrentes.
 */
async function fetchUrl(url: string): Promise<{ buffer: Buffer; contentType: string | null }> {
  const res = await resilientFetch(url, {
    retries: 1,
    timeoutMs: 10_000,
    backoffMs: 400,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/pdf,text/html,*/*",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar PDF`);
  const buffer = Buffer.from(await res.arrayBuffer());
  // Guard de TAMANHO antes de acumular: o teto de 50 MB do `enqueuePdfBuffer` só é checado depois
  // que o arquivo já está inteiro em memória, e a colheita segura todos os buffers vivos até a
  // gravação terminar. Cortar aqui evita levar a função por OOM por causa de um PDF gigante.
  if (buffer.length > MAX_BYTES_POR_DOCUMENTO) {
    throw new Error(`Documento acima de ${Math.round(MAX_BYTES_POR_DOCUMENTO / 1024 / 1024)} MB — não baixado`);
  }
  return { buffer, contentType: res.headers.get("content-type") };
}

/**
 * Nome do arquivo a partir da URL — e por que o PENÚLTIMO segmento importa (Fase 8).
 *
 * As URLs de documento do Liferay da ANTT terminam em UUID:
 *   .../documents/498202/0/Voto+DFQ+043-2026.pdf/60f8733d-104b-1549-...
 * O último segmento não casa `/\.pdf$/`, então TODOS os documentos de uma reunião caíam no slug
 * do título do item — que é o título da REUNIÃO, igual para todos. Medido contra as 7 URLs reais
 * da 1.036ª: os SETE viravam `1-036-Reuniao-de-Diretoria.pdf`, um único nome.
 *
 * Isso não é cosmético. O resgate de votos mal classificados da esteira procura
 * `voto[ _-]+(vista[ _-]+)?d[a-z]{1,2}[ _-]*[0-9]` NO FILENAME (pipeline/run) — com o nome da
 * reunião no lugar de "Voto DFQ 043-2026", esse resgate nunca casava. E, na tela de revisão, sete
 * documentos diferentes apareciam com o mesmo rótulo.
 */
export function deriveFilename(titulo: string, url: string): string {
  const partes = url.split(/[?#]/)[0].split("/").filter(Boolean);
  for (const bruto of [partes.at(-1), partes.at(-2)]) {
    if (!bruto) continue;
    let seg: string;
    try {
      seg = decodeURIComponent(bruto);
    } catch {
      seg = bruto; // sequência de escape inválida: usa o cru em vez de estourar
    }
    // `+` é espaço codificado nessas URLs; sem trocar, o nome sai "Voto+DFQ+043-2026.pdf".
    seg = seg.replace(/\+/g, " ").trim();
    if (seg && /\.pdf$/i.test(seg)) return seg.slice(0, 180);
  }
  const slug = (titulo || "documento")
    .normalize("NFD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return `${slug || "documento"}.pdf`;
}
