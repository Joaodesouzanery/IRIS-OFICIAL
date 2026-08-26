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
import { resolvePdfLinksFromHtml, sniffIsHtml, sniffIsPdf } from "@/lib/server/pdf-link-resolver";
import { TIPOS_ESTEIRA_VOTOS } from "@/lib/esteira-tipos";
import { mapComConcorrencia, criarReservaAdaptativa } from "@/lib/server/concorrencia";

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
const MAX_TENTATIVAS = 3;
// Downloads simultâneos. 5 é conservador de propósito: o ganho vem de usar a espera de rede,
// não de martelar o portal da agência — que é um serviço público e pode ter rate limit.
const CONCORRENCIA_DOWNLOAD = 5;
const FETCH_TIMEOUT_MS = 20_000;

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
  };
  const limit = Math.min(MAX_PER_RUN, Math.max(1, Number(body.limit ?? MAX_PER_RUN)));

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

  // QA ago/2026: o gate por regex de URL matava ARTESP (DAM sem .pdf) e ANM (/view) e,
  // como o rejeitado nunca mudava de status, os mesmos 60 bloqueavam a janela para
  // sempre (208 detectados / 0 na fila). Agora TODO item da janela é tentado — o
  // critério é o CONTEÚDO (sniff) — e quem não tem PDF ganha status terminal (drena).
  const candidates = (itens ?? [])
    .sort((a, b) => Number(PDF_RE.test(String(b.url_item ?? ""))) - Number(PDF_RE.test(String(a.url_item ?? ""))))
    .slice(0, limit);

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

  // ═══ Fase 7 — DOWNLOAD EM PARALELO, GRAVAÇÃO EM SÉRIE ═══════════════════════
  // Era tudo em série com reserva FIXA de 22s (o timeout de rede) contra uma fatia de 25s: só o
  // primeiro item cabia, e a rodada enfileirava 1 a 3 PDFs. O gargalo é REDE — o processo passava
  // a janela ociosa esperando o portal. Baixar em paralelo usa essa espera; a reserva adaptativa
  // para de assumir o pior caso quando as respostas reais chegam em 1-3s. As ESCRITAS continuam
  // em série logo abaixo: o ganho é de rede, e serializar o banco mantém o comportamento
  // (contadores, status terminal, ordem dos `results`) idêntico ao que os testes já travam.
  const adaptativa = criarReservaAdaptativa(RESERVA.enqueue);

  type Colhido =
    | { ok: true; pdfs: Array<{ url: string; buffer: Buffer }> }
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
        const pdfs: Array<{ url: string; buffer: Buffer }> = [];
        if (sniffIsPdf(fetched.contentType, fetched.buffer)) {
          pdfs.push({ url, buffer: fetched.buffer });
        } else if (sniffIsHtml(fetched.contentType, fetched.buffer)) {
          const links = resolvePdfLinksFromHtml(fetched.buffer.toString("utf8"), url);
          const maxFilhos = item.tipo === "reuniao" ? 6 : 1; // página de reunião tem N docs
          for (const link of links) {
            if (pdfs.length >= maxFilhos) break;
            if (!hasBudget(deadlineAt, adaptativa.reserva())) break;
            try {
              const filho = await fetchUrl(link);
              if (sniffIsPdf(filho.contentType, filho.buffer)) pdfs.push({ url: link, buffer: filho.buffer });
            } catch { /* tenta o próximo link da página */ }
          }
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

  for (const { item, valor } of colheita.concluidos) {
    const url = String(item.url_item);
    const itemMeta = (item.metadata && typeof item.metadata === "object" ? item.metadata : {}) as Record<string, unknown>;
    try {
      if (!valor.ok) throw valor.erro;
      const pdfs = valor.pdfs;

      if (pdfs.length === 0) {
        // TERMINAL: nem PDF nem página com PDF de decisão → sai da janela com motivo
        // (antes ficava 'novo' para sempre bloqueando os itens atrás — head-of-line).
        await db
          .from("monitoramento_itens")
          .update({
            status: "ignorado",
            metadata: { ...itemMeta, enqueue_motivo: "sem_pdf" },
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
          message: "Nenhum PDF encontrado na URL/página — item arquivado com motivo.",
        });
        continue;
      }

      let algumOk = false;
      let algumErro = false;
      for (const pdf of pdfs) {
        const filename = deriveFilename(item.titulo as string, pdf.url);
        const enqueued = await enqueuePdfBuffer({
          db,
          filename,
          buffer: pdf.buffer,
          agenciaId: (item.agencia_id as string | null) ?? null,
          metadata: {
            uploaded_via: "monitoramento_deliberacoes",
            monitoramento_item_id: item.id,
            source_url: pdf.url,
            item_tipo: item.tipo,
          },
        });

        if (
          (enqueued.status === "queued" || enqueued.status === "existing_failed") &&
          enqueued.job_id
        ) {
          jobsToProcess.push({ jobId: enqueued.job_id, agenciaId: (item.agencia_id as string | null) ?? null });
        }
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
      if (algumOk || !algumErro) {
        await db
          .from("monitoramento_itens")
          .update({ status: "importado", last_seen_at: new Date().toISOString() })
          .eq("id", item.id);
      }
    } catch (err) {
      // Erro transitório (403/timeout): registra tentativa + motivo (antes sumia — o
      // item era retentado para sempre sem rastro). Após MAX_TENTATIVAS vira terminal.
      const tentativas = (Number(itemMeta.tentativas) || 0) + 1;
      const msg = err instanceof Error ? err.message : "Falha ao baixar PDF";
      const terminal = tentativas >= MAX_TENTATIVAS;
      await db
        .from("monitoramento_itens")
        .update({
          ...(terminal ? { status: "ignorado" } : {}),
          metadata: {
            ...itemMeta,
            tentativas,
            captura_erro: msg.slice(0, 300),
            ...(terminal ? { enqueue_motivo: "download_falhou" } : {}),
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
        message: `${msg}${terminal ? " (arquivado após 3 tentativas)" : ` (tentativa ${tentativas}/${MAX_TENTATIVAS})`}`,
      });
    }
  }

  // Processa em background (ou aguarda quando solicitado por cron/teste).
  let processed = 0;
  if (jobsToProcess.length > 0) {
    if (body.process) {
      await processQueue(jobsToProcess.slice(0, MAX_PER_RUN), 2);
      processed = jobsToProcess.length;
    } else {
      waitUntil(processQueue(jobsToProcess.slice(0, MAX_PER_RUN), 2));
    }
  }

  const queued = results.filter((r) => r.status === "queued").length;
  return NextResponse.json({
    candidates: candidates.length,
    queued,
    processed,
    enqueued_jobs: jobsToProcess.length,
    sem_pdf: semPdf,
    parcial: restantes > 0,
    restantes,
    results,
    notice:
      "Votos individuais são sugeridos automaticamente (mandato + texto da ata) e só são gravados após confirmação humana em Revisão.",
  });
}

async function fetchUrl(url: string): Promise<{ buffer: Buffer; contentType: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/pdf,text/html,*/*",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar PDF`);
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") };
  } finally {
    clearTimeout(timer);
  }
}

function deriveFilename(titulo: string, url: string): string {
  const fromUrl = decodeURIComponent(url.split(/[?#]/)[0].split("/").filter(Boolean).at(-1) ?? "");
  if (fromUrl && /\.pdf$/i.test(fromUrl)) return fromUrl.slice(0, 180);
  const slug = (titulo || "documento")
    .normalize("NFD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return `${slug || "documento"}.pdf`;
}
