/**
 * Mojibake nos nomes de arquivo: medir (GET) e reparar (POST) — Fase 31.
 *
 * ═══ O que aconteceu ═══
 * 623 nomes (23% do acervo, 100% ARTESP) gravados como "DELIBERAÇO ARTESP N§ 646". A causa está
 * em `zip-extractor.ts` e foi corrigida no commit anterior: os nomes de entrada dos ZIPs da
 * ARTESP são **CP850** e eram lidos como Latin-1. Este arquivo cuida do ESTOQUE já gravado.
 *
 * ⚠️ O dano é REVERSÍVEL e não exige re-download: `latin1` no Node é identidade byte↔codepoint,
 * então o nome corrompido ainda CARREGA os bytes originais. (`docs/PENDENCIAS.md` diz
 * "irrecuperável sem re-download" — isso vale para o mojibake de U+FFFD da era pré-Fase-14, em
 * que o byte se perdeu de verdade, não para esta classe.)
 *
 * ⚠️ E o mesmo reparo aplicado a um nome SADIO o DESTRÓI: "DELIBERAÇÃO" viraria "DELIBERAÃ├O".
 * Por isso nada aqui decide por conta própria — quem decide é `reparoDoNome`, que só devolve
 * reparo quando a plausibilidade sobe ESTRITAMENTE.
 *
 * ═══ Dois verbos, dois contratos ═══
 * `GET`  — mede. Não existe caminho de escrita nele.
 * `POST` — repara, e **só com `?dry_run=0`**; o default é medir, como em `redatar/route.ts:54`.
 */

import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { isDemoRequest, requireAdmin } from "@/lib/server/request-guards";
import { lerTudo } from "@/lib/server/select-all-paged";
import { lerEmLotes } from "@/lib/server/ler-em-lotes";
import { exigirEscrita } from "@/lib/server/escrita-checada";
import { reparoDoNome, notaDePlausibilidade } from "@/lib/server/decodificar-nome-de-arquivo";
import { buildSemanticDuplicateKey } from "@/lib/server/regulatory-documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

interface Candidato {
  id: string;
  agencia: string;
  filename: string | null;
  filename_reparado: string | null;
  source_archive: string | null;
  source_archive_reparado: string | null;
  zip_entry: string | null;
  zip_entry_reparado: string | null;
  /** Veio de ZIP? É o escopo do reparo — ANM e ANTT recebem nome por outros caminhos. */
  de_zip: boolean;
  created_at: string | null;
  semantic_duplicate_key: string | null;
  tipo_documento: string | null;
  /** O jsonb inteiro — o patch precisa MESCLAR, nunca substituir. */
  metadata: Record<string, unknown>;
}

const texto = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Bytes altos do nome corrompido — é o histograma que decide a página de código pelo DADO. */
function contarBytesAltos(nome: string, acc: Record<string, number>): void {
  for (const ch of nome) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x80 && c <= 0xff) {
      const k = `0x${c.toString(16).toUpperCase().padStart(2, "0")}`;
      acc[k] = (acc[k] ?? 0) + 1;
    }
  }
}

async function medir(db: any) {
  const [docsRes, agRes] = await Promise.all([
    lerTudo<any>(() => db
      .from("documentos_regulatorios")
      .select("id, agencia_id, filename, source_archive, metadata, created_at, semantic_duplicate_key, tipo_documento")
      .order("id"), "mojibake/documentos"),
    db.from("agencias").select("id, sigla"),
  ]);
  // ⚠️ `lerTudo` devolve `{error}` em vez de lançar, e no caminho de erro `truncated` fica FALSE.
  // Medir sobre leitura parcial e chamar de "o acervo" é o erro que este diagnóstico não pode ter.
  if (docsRes.error) throw new Error("Falha ao ler os documentos.");

  const sigla = new Map(((agRes.data ?? []) as any[]).map((a) => [String(a.id), String(a.sigla)]));
  const candidatos: Candidato[] = [];
  const bytes: Record<string, number> = {};
  let comFffd = 0;
  /**
   * ⚠️ DOS IRREPARÁVEIS, quais têm via de recuperação — e a resposta corrige o que esta fase
   * afirmou antes.
   *
   * O commit `d9ac996` disse que os U+FFFD "só voltam do ZIP no Storage". **O ZIP nunca vai para o
   * Storage**: `enqueuePdfBuffer` sobe apenas os PDFs extraídos, em
   * `${agenciaId ?? "auto"}/${fileHash}.pdf` (`upload-queue.ts:192-195`). O ZIP é aberto em memória
   * (`zip-extractor`) e descartado.
   *
   * A única via real é o `metadata.source_url`, que a ESTEIRA grava (`enqueue-pdfs:478`): com a URL
   * do ZIP no portal da agência, os nomes de entrada podem ser lidos de novo. Upload MANUAL não tem
   * URL — `source_archive` ali é só o nome do arquivo que o operador escolheu (`batch/route.ts:70`).
   * Esses são PERDA DEFINITIVA, e o relatório tem de dizer isso em vez de prometer um reparo que não
   * existe.
   */
  let fffdComSourceUrl = 0;
  let fffdSemFonte = 0;

  for (const d of docsRes.data as any[]) {
    const meta = (d.metadata ?? {}) as Record<string, unknown>;
    const nomes = {
      filename: texto(d.filename),
      source_archive: texto(d.source_archive),
      zip_entry: texto(meta.source_zip_entry),
    };
    const reparos = {
      filename: nomes.filename ? reparoDoNome(nomes.filename) : null,
      source_archive: nomes.source_archive ? reparoDoNome(nomes.source_archive) : null,
      zip_entry: nomes.zip_entry ? reparoDoNome(nomes.zip_entry) : null,
    };
    // U+FFFD é a assinatura do mojibake PRÉ-Fase-14: ali o byte se perdeu e não há reparo.
    if (Object.values(nomes).some((n) => n?.includes("�"))) {
      comFffd++;
      if (texto(meta.source_url)) fffdComSourceUrl++;
      else fffdSemFonte++;
    }
    if (!reparos.filename && !reparos.source_archive && !reparos.zip_entry) continue;

    if (nomes.filename && reparos.filename) contarBytesAltos(nomes.filename, bytes);
    candidatos.push({
      id: String(d.id),
      agencia: sigla.get(String(d.agencia_id)) ?? "?",
      filename: nomes.filename,
      filename_reparado: reparos.filename?.reparado ?? null,
      source_archive: nomes.source_archive,
      source_archive_reparado: reparos.source_archive?.reparado ?? null,
      zip_entry: nomes.zip_entry,
      zip_entry_reparado: reparos.zip_entry?.reparado ?? null,
      de_zip: Boolean(nomes.source_archive || nomes.zip_entry || meta.source_archive),
      created_at: d.created_at ?? null,
      semantic_duplicate_key: texto(d.semantic_duplicate_key),
      tipo_documento: texto(d.tipo_documento),
      metadata: meta,
    });
  }

  return { candidatos, bytes, comFffd, fffdComSourceUrl, fffdSemFonte, truncado: docsRes.truncated, total: docsRes.data.length };
}

/**
 * A chave de dedup MUDARIA se o nome fosse reparado?
 *
 * ⚠️ Medida recomputando `buildSemanticDuplicateKey` com o nome atual e com o reparado, usando a
 * FUNÇÃO REAL. O `filename` só entra nela como desempatador de ÚLTIMO RECURSO
 * (`regulatory-documents.ts:411-424`): documento com número próprio — as Deliberações 646, 660 —
 * resolve no primeiro ramo e nunca chega lá. Sem recomputar, eu estaria adivinhando quantos.
 */
async function medirDependenciaDaChave(db: any, candidatos: Candidato[]) {
  const comFilename = candidatos.filter((c) => c.filename && c.filename_reparado);
  if (comFilename.length === 0) return { mediu: 0, mudaria: 0, nao_medido: 0 };

  const camposRes = await lerEmLotes<any>(db, {
    tabela: "documentos_regulatorios", select: "id, campos_detectados",
    coluna: "id", valores: comFilename.map((c) => c.id), label: "mojibake/campos",
  });
  if (camposRes.error) return { mediu: 0, mudaria: 0, nao_medido: comFilename.length };

  const porId = new Map(((camposRes.data ?? []) as any[]).map((r) => [String(r.id), r.campos_detectados]));
  let mudaria = 0;
  let naoMedido = 0;
  for (const c of comFilename) {
    const campos = porId.get(c.id) as any;
    const f = campos?.preview?.fields;
    if (!f) { naoMedido++; continue; } // sem payload não se adivinha — lição da Fase 28
    const base = {
      agencia_sigla: c.agencia, tipo_documento: c.tipo_documento,
      numero_deliberacao: f.numero_deliberacao ?? null, numero_reuniao: f.numero_reuniao ?? null,
      data_reuniao: f.data_reuniao ?? null, processo: f.processo ?? null,
    };
    const antes = buildSemanticDuplicateKey({ ...base, filename: c.filename });
    const depois = buildSemanticDuplicateKey({ ...base, filename: c.filename_reparado });
    if (antes !== depois) mudaria++;
  }
  return { mediu: comFilename.length - naoMedido, mudaria, nao_medido: naoMedido };
}

function resumir(m: Awaited<ReturnType<typeof medir>>, chave: Awaited<ReturnType<typeof medirDependenciaDaChave>>, amostraN: number) {
  const porAgencia: Record<string, { candidatos: number; de_zip: number; fora_do_escopo: number }> = {};
  let maisAntigo: string | null = null;
  let maisRecente: string | null = null;
  for (const c of m.candidatos) {
    porAgencia[c.agencia] = porAgencia[c.agencia] ?? { candidatos: 0, de_zip: 0, fora_do_escopo: 0 };
    porAgencia[c.agencia].candidatos++;
    if (c.de_zip) porAgencia[c.agencia].de_zip++;
    else porAgencia[c.agencia].fora_do_escopo++;
    if (c.created_at) {
      if (!maisAntigo || c.created_at < maisAntigo) maisAntigo = c.created_at;
      if (!maisRecente || c.created_at > maisRecente) maisRecente = c.created_at;
    }
  }
  const histograma = Object.entries(m.bytes).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return {
    universo: { documentos_lidos: m.total, candidatos: m.candidatos.length, leitura_truncada: m.truncado },
    por_agencia: porAgencia,
    // ⚠️ Fora do escopo = candidato SEM procedência de ZIP. Ele é MOSTRADO e NÃO tocado: o
    // mojibake conhecido é 100% ARTESP/ZIP, e um candidato de outro caminho é achado novo.
    fora_do_escopo: m.candidatos.filter((c) => !c.de_zip).slice(0, amostraN)
      .map((c) => ({ id: c.id, agencia: c.agencia, filename: c.filename })),
    datas: { mais_antigo: maisAntigo, mais_recente: maisRecente },
    // ⚠️ `mais_recente` posterior ao deploy do decoder significa que o caminho NOVO ainda produz —
    // aí não é resíduo, é fluxo vivo.
    assinaturas: {
      // O histograma decide a página de código pelo DADO, sem depender de nenhum ZIP em fixture:
      // `latin1` preserva os bytes, então a coluna `filename` contém os originais.
      bytes_altos_mais_frequentes: Object.fromEntries(histograma),
      cp850_0x80_ou_0xB5: (m.bytes["0x80"] ?? 0) + (m.bytes["0xB5"] ?? 0),
      u_fffd_irreparavel: m.comFffd,
      // ⚠️ O ZIP NÃO está no Storage (só os PDFs extraídos estão). Destes, os que têm
      // `metadata.source_url` podem ter os nomes relidos do portal; os outros são perda definitiva.
      u_fffd_recuperavel_por_url: m.fffdComSourceUrl,
      u_fffd_perda_definitiva: m.fffdSemFonte,
    },
    chave_de_dedup: {
      ...chave,
      nota: "Recomputada com a função REAL, nome atual × reparado. `mudaria` é quem depende do " +
        "filename como desempatador de último recurso; documento com número próprio não depende. " +
        "NADA é recomputado por este endpoint — a decisão é sua.",
    },
    amostra: m.candidatos.slice(0, amostraN).map((c) => ({
      id: c.id, agencia: c.agencia, de_zip: c.de_zip, created_at: c.created_at,
      de: c.filename, para: c.filename_reparado,
      nota_antes: c.filename ? Number(notaDePlausibilidade(c.filename).toFixed(3)) : null,
      nota_depois: c.filename_reparado ? Number(notaDePlausibilidade(c.filename_reparado).toFixed(3)) : null,
    })),
  };
}

export async function GET(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) return NextResponse.json({ modo: "demo", universo: null });
  const guard = await requireAdmin(req);
  if (guard) return guard;

  const amostraN = Math.max(1, Math.min(50, Number(req.nextUrl.searchParams.get("amostra")) || 10));
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  try {
    const m = await medir(db);
    const chave = await medirDependenciaDaChave(db, m.candidatos);
    return NextResponse.json({
      modo: "medicao",
      ...resumir(m, chave, amostraN),
      notice: "SOMENTE LEITURA — nada é gravado. Para aplicar: POST neste mesmo caminho com ?dry_run=0.",
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Falha ao medir." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (isDemo() || isDemoRequest(req)) {
    return NextResponse.json({ error: "Escrita bloqueada em demo." }, { status: 403 });
  }
  const guard = await requireAdmin(req);
  if (guard) return guard;

  // Default é MEDIR. Só `dry_run=0` escreve — mesmo contrato de `redatar/route.ts:54`.
  const dryRun = req.nextUrl.searchParams.get("dry_run") !== "0";
  const amostraN = Math.max(1, Math.min(50, Number(req.nextUrl.searchParams.get("amostra")) || 10));
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const db = createSupabaseServerClient();

  let m: Awaited<ReturnType<typeof medir>>;
  try {
    m = await medir(db);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Falha ao medir." }, { status: 500 });
  }
  const chave = await medirDependenciaDaChave(db, m.candidatos);

  // ⚠️ O ESCOPO: só quem veio de ZIP. O mojibake conhecido é 100% ARTESP/ZIP; ANM e ANTT recebem
  // nome por outros caminhos (File.name do browser, título do coletor), e varrer as três com o
  // mesmo detector arriscaria "reparar" um nome legítimo. Candidato fora do escopo é reportado.
  const noEscopo = m.candidatos.filter((c) => c.de_zip);

  let reparados = 0;
  let jobsReparados = 0;
  const falhas: string[] = [];
  if (!dryRun) {
    for (const c of noEscopo) {
      const patch: Record<string, unknown> = {};
      if (c.filename_reparado) patch.filename = c.filename_reparado;
      if (c.source_archive_reparado) patch.source_archive = c.source_archive_reparado;
      if (c.zip_entry_reparado || c.source_archive_reparado) {
        // ⚠️ MESCLA, nunca substitui. `metadata` é jsonb e um patch com só a sub-chave APAGARIA
        // todo o resto do objeto — `uploaded_via`, `source_url`, `source_archive`. Foi assim que
        // a primeira versão deste laço quase trocou um mojibake cosmético por perda de dado.
        patch.metadata = {
          ...c.metadata,
          ...(c.zip_entry_reparado ? { source_zip_entry: c.zip_entry_reparado } : {}),
          ...(c.source_archive_reparado && texto(c.metadata.source_archive)
            ? { source_archive: c.source_archive_reparado } : {}),
        };
      }
      if (Object.keys(patch).length === 0) continue;
      patch.updated_at = new Date().toISOString();
      const ok = await exigirEscrita(
        db.from("documentos_regulatorios").update(patch).eq("id", c.id),
        `reparar nome de ${c.id}`,
      );
      if (ok) reparados++;
      else falhas.push(c.id);
    }
    // `upload_jobs.filename` carrega o mesmo nome e é o que a tela de Upload mostra.
    for (const c of noEscopo) {
      if (!c.filename || !c.filename_reparado) continue;
      const ok = await exigirEscrita(
        db.from("upload_jobs").update({ filename: c.filename_reparado, updated_at: new Date().toISOString() })
          .eq("documento_id", c.id).eq("filename", c.filename),
        `reparar nome do job de ${c.id}`,
      );
      if (ok) jobsReparados++;
    }
  }

  return NextResponse.json({
    modo: dryRun ? "dry_run" : "aplicado",
    ...resumir(m, chave, amostraN),
    escopo: { no_escopo_zip: noEscopo.length, fora_do_escopo_nao_tocado: m.candidatos.length - noEscopo.length },
    aplicado: dryRun ? null : { documentos: reparados, jobs: jobsReparados, falhas: falhas.slice(0, 20) },
    notice: dryRun
      ? "DRY-RUN: nada foi gravado. Para aplicar, repita com ?dry_run=0."
      : "Nomes reparados. `semantic_duplicate_key` NÃO foi recomputada — veja `chave_de_dedup`.",
  });
}
