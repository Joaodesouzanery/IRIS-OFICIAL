/**
 * POST /api/v1/upload/confirm
 * Recebe as deliberações revisadas pelo usuário e persiste no Supabase.
 * Escritas reais exigem admin; modo DEMO permanece somente leitura.
 */

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { RESULTADOS } from "@/lib/utils";
import { isAreaRegulatoria } from "@/lib/server/area-regulatoria";
import { findBestMatch, normalizeName, isLikelyPersonName } from "@/lib/server/name-matcher";
import { resolveEmpresaId, type EmpresaCache } from "@/lib/server/empresa-resolver";
import { requireAdminOrCron } from "@/lib/server/request-guards";
import { ensureReuniao } from "@/lib/server/reunioes";
import { enrichDeliberacaoExistente, findDeliberacaoExistente } from "@/lib/server/deliberacao-dedup";
import {
  buildVotoRows,
  buildVotoRowsFromSuggestions,
  getActiveDiretoresForVote,
  shouldInferVotesFromMandate,
  type DiretorVoteRecord,
  type VotoInsertRow,
} from "@/lib/server/vote-inference";
import type {
  ConfirmDelib,
  BatchConfirmResponse,
  ConfirmResult,
  Resultado,
  Deliberacao,
  VotoEmbutido,
} from "@/types";

const RESULTADOS_VALIDOS = new Set<string>(RESULTADOS);

/**
 * Upsert de votos que NÃO rebaixa um voto nominal (extraído do documento) para
 * um voto inferido por mandato ao reprocessar a mesma deliberação. Preserva a
 * fidelidade: o que foi lido do documento prevalece sobre a inferência.
 */
async function upsertVotosProtegido(db: any, votoRows: VotoInsertRow[]) {
  if (!votoRows.length) return;
  const delibIds = [...new Set(votoRows.map((r) => r.deliberacao_id))];
  const { data: existentes } = await db
    .from("votos")
    .select("deliberacao_id, diretor_id, is_nominal")
    .in("deliberacao_id", delibIds);
  const nominalExistente = new Set<string>(
    (existentes ?? [])
      .filter((v: any) => v.is_nominal)
      .map((v: any) => `${v.deliberacao_id}|${v.diretor_id}`),
  );
  const toUpsert = votoRows.filter(
    (r) => r.is_nominal || !nominalExistente.has(`${r.deliberacao_id}|${r.diretor_id}`),
  );
  if (toUpsert.length > 0) {
    await db.from("votos").upsert(toUpsert, { onConflict: "deliberacao_id,diretor_id" });
  }
}

const MICROTEMAS_VALIDOS = new Set<string>([
  "tarifa", "obras", "multa", "contrato", "reequilibrio",
  "fiscalizacao", "seguranca", "ambiental", "desapropriacao",
  "adimplencia", "pessoal", "usuario",
  "lavra", "pesquisa", "licenciamento", "servidao", "cfem",
  "disponibilidade", "recursos",
  "outros",
]);

const RE_ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS_REUNIAO_VALIDOS = new Set(["Ordinaria", "Extraordinaria"]);
const TIPOS_DOCUMENTO_VALIDOS = new Set([
  "deliberacao",
  "ata",
  "resolucao",
  "portaria",
  "pauta",
  "voto_individual",
  "documento_apoio",
]);

type ParsedConfirmBody = {
  body: { agencia_id?: unknown; deliberacoes?: unknown };
  filesByName: Map<string, File>;
};

function sanitizeDelib(d: ConfirmDelib): ConfirmDelib {
  return {
    filename: String(d.filename ?? "").slice(0, 255),
    documento_id: d.documento_id ? String(d.documento_id).slice(0, 80) : null,
    upload_job_id: d.upload_job_id ? String(d.upload_job_id).slice(0, 80) : null,
    agencia_id: d.agencia_id ? String(d.agencia_id).slice(0, 80) : null,
    numero_deliberacao: d.numero_deliberacao ? String(d.numero_deliberacao).slice(0, 50) : null,
    numero_reuniao: d.numero_reuniao ? String(d.numero_reuniao).slice(0, 10) : null,
    reuniao_ordinaria: d.reuniao_ordinaria ? String(d.reuniao_ordinaria).slice(0, 100) : null,
    tipo_reuniao: d.tipo_reuniao && TIPOS_REUNIAO_VALIDOS.has(d.tipo_reuniao) ? d.tipo_reuniao : null,
    tipo_documento: d.tipo_documento && TIPOS_DOCUMENTO_VALIDOS.has(d.tipo_documento)
      ? d.tipo_documento : "deliberacao",
    data_reuniao: d.data_reuniao && RE_ISO_DATE.test(d.data_reuniao) ? d.data_reuniao : null,
    data_publicacao: d.data_publicacao && RE_ISO_DATE.test(d.data_publicacao) ? d.data_publicacao : null,
    interessado: d.interessado ? String(d.interessado).slice(0, 255) : null,
    assunto: d.assunto ? String(d.assunto).slice(0, 500) : null,
    procedencia: d.procedencia ? String(d.procedencia).slice(0, 200) : null,
    relator: d.relator ? String(d.relator).slice(0, 200) : null,
    item_numero: d.item_numero ? String(d.item_numero).slice(0, 20) : null,
    processo: d.processo ? String(d.processo).slice(0, 100) : null,
    resultado: d.resultado && RESULTADOS_VALIDOS.has(d.resultado)
      ? (d.resultado as Resultado)
      : null,
    decisoes_todas: Array.isArray(d.decisoes_todas)
      ? d.decisoes_todas.filter((v) => RESULTADOS_VALIDOS.has(v)).slice(0, 10)
      : [],
    microtema: d.microtema && MICROTEMAS_VALIDOS.has(d.microtema) ? d.microtema : "outros",
    area_regulatoria: isAreaRegulatoria(d.area_regulatoria) ? d.area_regulatoria : "outros",
    pauta_interna: Boolean(d.pauta_interna),
    resumo_pleito: d.resumo_pleito ? String(d.resumo_pleito).slice(0, 2000) : null,
    fundamento_decisao: d.fundamento_decisao ? String(d.fundamento_decisao).slice(0, 2000) : null,
    nomes_votacao: Array.isArray(d.nomes_votacao)
      ? d.nomes_votacao.slice(0, 20).map((n) => String(n).slice(0, 100))
      : [],
    nomes_votacao_contra: Array.isArray(d.nomes_votacao_contra)
      ? d.nomes_votacao_contra.slice(0, 20).map((n) => String(n).slice(0, 100))
      : [],
    nomes_votacao_abstencao: Array.isArray(d.nomes_votacao_abstencao)
      ? d.nomes_votacao_abstencao.slice(0, 20).map((n) => String(n).slice(0, 100))
      : [],
    nomes_votacao_ausente: Array.isArray(d.nomes_votacao_ausente)
      ? d.nomes_votacao_ausente.slice(0, 20).map((n) => String(n).slice(0, 100))
      : [],
    nomes_presentes: Array.isArray(d.nomes_presentes)
      ? d.nomes_presentes.slice(0, 20).map((n) => String(n).slice(0, 100))
      : [],
    votos_sugeridos: Array.isArray(d.votos_sugeridos) ? d.votos_sugeridos.slice(0, 30) : [],
    extraction_confidence:
      typeof d.extraction_confidence === "number" &&
      d.extraction_confidence >= 0 &&
      d.extraction_confidence <= 1
        ? d.extraction_confidence
        : 0,
    documento_antt_tipo: d.documento_antt_tipo ?? null,
    documento_subtipo: d.documento_subtipo ?? null,
    import_counts_as_final: d.import_counts_as_final === false ? false : true,
    semantic_duplicate_key: d.semantic_duplicate_key ?? null,
    warnings: Array.isArray(d.warnings) ? d.warnings.map(String).slice(0, 20) : [],
    extraction_raw: d.extraction_raw && typeof d.extraction_raw === "object" ? d.extraction_raw : undefined,
    ata_items: Array.isArray(d.ata_items) ? d.ata_items : undefined,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Admin OU cron: o auto-confirm agendado (Vercel Cron, Bearer CRON_SECRET) reusa
  // este handler — mesmo modelo de confiança dos demais crons que escrevem dados.
  const guard = await requireAdminOrCron(req, "upload/confirm");
  if (guard) return guard;

  let parsed: ParsedConfirmBody;
  try {
    parsed = await parseConfirmRequest(req);
  } catch {
    return NextResponse.json({ error: "Payload JSON inválido" }, { status: 400 });
  }

  const { body, filesByName } = parsed;
  const { agencia_id, deliberacoes } = body;

  if (!Array.isArray(deliberacoes) || deliberacoes.length === 0) {
    return NextResponse.json(
      { error: "deliberacoes deve ser um array não vazio" },
      { status: 400 },
    );
  }

  if (deliberacoes.length > 1000) {
    return NextResponse.json(
      { error: "Máximo de 1000 deliberações por envio" },
      { status: 400 },
    );
  }

  const globalAgenciaId = typeof agencia_id === "string" && agencia_id ? agencia_id : null;
  const missingAgency = deliberacoes.some((raw) => {
    const itemAgency = (raw as { agencia_id?: unknown }).agencia_id;
    return !(typeof itemAgency === "string" && itemAgency) && !globalAgenciaId;
  });

  if (missingAgency) {
    return NextResponse.json(
      { error: "agencia_id é obrigatório para cada deliberação sem agência detectada" },
      { status: 400 },
    );
  }

  if (isDemo()) {
    const { demoData } = await import("@/lib/demo-data");
    const createdDelibs: Deliberacao[] = [];
    const results: ConfirmResult[] = [];

    for (const raw of deliberacoes) {
      const d = sanitizeDelib(raw as ConfirmDelib);
      const rawConfirm = raw as ConfirmDelib;
      const effectiveAgenciaId = d.agencia_id || globalAgenciaId!;
      const diretoresList = demoData.mandatos()
        .filter((m) => m.agencia_id === effectiveAgenciaId)
        .map((m) => ({ id: m.diretor_id, nome: m.diretor_nome, nome_variantes: [] as string[] }));

      function buildVotos(
        nomes: string[],
        contra: string[] = [],
        ausente: string[] = [],
        abstencao: string[] = [],
        inferFromMandate = false,
        unanime = false,
      ): VotoEmbutido[] {
        return buildVotoRows({
          deliberacao_id: "local",
          nomes,
          nomesContra: contra,
          nomesAusente: ausente,
          nomesAbstencao: abstencao,
          diretoresList,
          activeDiretoresList: diretoresList,
          inferFromMandate,
          unanime,
        }).map((row) => {
          const diretor = diretoresList.find((dir) => dir.id === row.diretor_id);
          return {
            id: `local-v-${Math.random().toString(36).slice(2, 9)}`,
            diretor_id: row.diretor_id,
            diretor_nome: diretor?.nome ?? row.diretor_id,
            tipo_voto: row.tipo_voto,
            is_divergente: row.is_divergente,
            is_nominal: row.is_nominal,
          };
        });
      }

      if (d.tipo_documento === "ata" && rawConfirm.ata_items && rawConfirm.ata_items.length > 0) {
        const paiId = `local-ata-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const documentPrefix = internalAnttDocumentPrefix(d);
        const documentLabel = documentPrefix === "ATA" ? "Ata" : "Pauta";

        createdDelibs.push({
          id: paiId,
          agencia_id: effectiveAgenciaId,
          numero_deliberacao: d.numero_reuniao ? `${documentPrefix}-${d.numero_reuniao}` : d.numero_deliberacao,
          numero_reuniao: d.numero_reuniao,
          reuniao_ordinaria: d.reuniao_ordinaria,
          tipo_reuniao: d.tipo_reuniao as "Ordinaria" | "Extraordinaria" | null,
          tipo_documento: "ata",
          data_reuniao: d.data_reuniao,
          data_publicacao: d.data_publicacao,
          interessado: null,
          assunto: `${documentLabel} da ${d.numero_reuniao ?? ""}ª Reunião - ${rawConfirm.ata_items.length} processos`,
          procedencia: d.procedencia,
          relator: null,
          item_numero: null,
          documento_pai_id: null,
          processo: null,
          resultado: null,
          decisoes_todas: [],
          microtema: null,
          area_regulatoria: d.area_regulatoria,
          pauta_interna: false,
          resumo_pleito: null,
          fundamento_decisao: null,
          auto_classified: true,
          extraction_confidence: 1,
          created_at: new Date().toISOString(),
          votos: [],
          raw_extraction: d.extraction_raw ?? null,
        });

        for (const item of rawConfirm.ata_items) {
          const childId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          createdDelibs.push({
            id: childId,
            agencia_id: effectiveAgenciaId,
            numero_deliberacao: d.numero_reuniao ? `${documentPrefix}-${d.numero_reuniao}-${item.item_numero}` : null,
            numero_reuniao: d.numero_reuniao,
            reuniao_ordinaria: d.reuniao_ordinaria,
            tipo_reuniao: d.tipo_reuniao as "Ordinaria" | "Extraordinaria" | null,
            tipo_documento: "ata",
            data_reuniao: d.data_reuniao,
            data_publicacao: d.data_publicacao,
            interessado: item.interessado,
            assunto: item.assunto,
            procedencia: null,
            relator: item.relator,
            item_numero: item.item_numero,
            documento_pai_id: paiId,
            processo: item.processo,
            resultado: item.resultado as Resultado | null,
            decisoes_todas: [],
            microtema: item.microtema,
            area_regulatoria: item.area_regulatoria ?? d.area_regulatoria,
            pauta_interna: false,
            resumo_pleito: item.decisao?.slice(0, 2000) ?? null,
            fundamento_decisao: null,
            auto_classified: true,
            extraction_confidence: item.processo ? 0.8 : 0.4,
            created_at: new Date().toISOString(),
            votos: buildVotos(
              item.votos_detectados ?? [],
              item.votos_contra_detectados ?? [],
              item.votos_ausentes_detectados ?? [],
              item.votos_abstencao_detectados ?? [],
              shouldInferVotesFromMandate({
                resultado: item.resultado,
                tipo_documento: "ata",
                import_counts_as_final: Boolean(item.resultado),
                unanimidadeDetectada: item.unanimidade_detectada,
                nomes: item.votos_detectados ?? [],
                nomesContra: item.votos_contra_detectados ?? [],
              }),
              Boolean(item.unanimidade_detectada),
            ),
            raw_extraction: null,
          });
        }

        results.push({ filename: d.filename, status: "created", deliberacao_id: paiId });
        continue;
      }

      const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const votos = buildVotos(
        d.nomes_votacao,
        d.nomes_votacao_contra,
        d.nomes_votacao_ausente ?? [],
        d.nomes_votacao_abstencao ?? [],
        shouldInferVotesFromMandate({
          resultado: d.resultado,
          tipo_documento: d.tipo_documento,
          import_counts_as_final: d.import_counts_as_final,
          unanimidadeDetectada: Boolean(d.extraction_raw?.unanimidade_detectada),
          nomes: d.nomes_votacao,
          nomesContra: d.nomes_votacao_contra,
        }),
        Boolean(d.extraction_raw?.unanimidade_detectada),
      );

      createdDelibs.push({
        id,
        agencia_id: effectiveAgenciaId,
        numero_deliberacao: d.numero_deliberacao,
        numero_reuniao: d.numero_reuniao,
        reuniao_ordinaria: d.reuniao_ordinaria,
        tipo_reuniao: d.tipo_reuniao as "Ordinaria" | "Extraordinaria" | null,
        tipo_documento: d.tipo_documento ?? "deliberacao",
        data_reuniao: d.data_reuniao,
        data_publicacao: d.data_publicacao,
        interessado: d.interessado,
        assunto: d.assunto,
        procedencia: d.procedencia,
        relator: d.relator ?? null,
        item_numero: d.item_numero ?? null,
        documento_pai_id: null,
        processo: d.processo,
        resultado: d.resultado as Resultado | null,
        decisoes_todas: d.decisoes_todas,
        microtema: d.microtema,
        area_regulatoria: d.area_regulatoria,
        pauta_interna: d.pauta_interna,
        resumo_pleito: d.resumo_pleito,
        fundamento_decisao: d.fundamento_decisao,
        auto_classified: true,
        extraction_confidence: d.extraction_confidence,
        created_at: new Date().toISOString(),
        votos,
        raw_extraction: d.extraction_raw ?? null,
      });

      results.push({ filename: d.filename, status: "created", deliberacao_id: id });
    }

    const response: BatchConfirmResponse = {
      created: createdDelibs.length,
      errors: 0,
      results,
      deliberacoes: createdDelibs,
    };
    return NextResponse.json(response, { status: 201 });
  }

  try {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const db = createSupabaseServerClient();
    const results: ConfirmResult[] = [];
    const empresaCache: EmpresaCache = new Map();

    for (const raw of deliberacoes) {
      const d = sanitizeDelib(raw as ConfirmDelib);
      const rawConfirm = raw as ConfirmDelib;
      const effectiveAgenciaId = d.agencia_id || globalAgenciaId!;

      try {
        const { data: agencia } = await db
          .from("agencias")
          .select("id")
          .eq("id", effectiveAgenciaId)
          .single();

        if (!agencia) {
          results.push({ filename: d.filename, status: "error", error: "Agência não encontrada" });
          continue;
        }

        const attachment = d.documento_id
          ? await getDocumentAttachment(db, d.documento_id)
          : await ensureUploadAttachment(db, filesByName.get(d.filename), effectiveAgenciaId);
        if (attachment.error) {
          results.push({ filename: d.filename, status: "error", error: attachment.error });
          continue;
        }

        // Ata com ITENS extraídos é importável: o ramo de ata abaixo materializa a
        // ata-mãe + itens + votos (cada item só conta como final se tiver resultado).
        // Sem isso, TODA ata (ANM/ANTT, classificadas import_counts_as_final=false)
        // era "mantida como apoio" e os votos das atas nunca entravam.
        const isImportableAta = d.tipo_documento === "ata" && Boolean(rawConfirm.ata_items?.length);
        // ANTT: o "Voto DXX" é o voto NOMINAL real do relator. Só descartar como apoio
        // ANTES perdia o dado mais valioso. Se tem relator + direção do voto, captura
        // (ramo dedicado abaixo) em vez de ignorar.
        const isAnttVotoCapturavel = d.tipo_documento === "voto_individual"
          && Boolean(d.resultado)
          && (Boolean(d.relator) || d.nomes_votacao.length > 0);
        if (
          ((!d.import_counts_as_final && !isImportableAta) || ["pauta", "voto_individual", "documento_apoio"].includes(d.tipo_documento))
          && !isAnttVotoCapturavel
        ) {
          await markDocumentReviewed(db, d.documento_id, "ignored");
          results.push({
            filename: d.filename,
            status: "document_saved",
            documento_id: d.documento_id ?? null,
            message: "Documento mantido como apoio; nao entrou nos dashboards.",
          });
          continue;
        }

        const { data: diretores } = await db
          .from("diretores")
          .select("id, nome, nome_variantes")
          .eq("agencia_id", effectiveAgenciaId);

        const diretoresList = (diretores ?? []).map((dir) => ({
          id: dir.id,
          nome: dir.nome,
          nome_variantes: Array.isArray((dir as { nome_variantes?: unknown }).nome_variantes)
            ? (dir as { nome_variantes: string[] }).nome_variantes
            : [],
        }))
          // DETERMINISMO: nome mais LONGO primeiro. findBestMatch usa `>` estrito, então
          // em empate (relator "Felipe Queiroz" casa 1.0 tanto o duplicado curto quanto o
          // seed "Felipe Fernandes Queiroz") vence o iterado primeiro → sempre o oficial
          // completo. Sem isto o voto caía num cadastro arbitrário (ordem do Postgres).
          .sort((x, y) => y.nome.length - x.nome.length);
        // Roster de inferência: PREFERE os presentes declarados no próprio documento
        // ("Constituição:"/"Presentes:" — quem de fato estava na reunião), casados com
        // match ≥0.85 a diretores cadastrados; mandatos são o fallback. Presente sem
        // match confiável NÃO entra (segue o contrato: sem certeza → sem voto).
        const presentesRoster = (d.nomes_presentes ?? [])
          .map((nome) => {
            const match = findBestMatch(nome, diretoresList);
            return match.diretorId && !match.needsReview
              ? diretoresList.find((dir) => dir.id === match.diretorId) ?? null
              : null;
          })
          .filter((dir): dir is DiretorVoteRecord => Boolean(dir));
        const activeDiretoresList = presentesRoster.length > 0
          ? presentesRoster
          : await getActiveDiretoresForVote(
            db,
            effectiveAgenciaId,
            d.data_reuniao,
            diretoresList,
          );

        // Reunião materializada: garante a linha canônica e liga as deliberações
        // (degrada para null enquanto a migration não for aplicada).
        const reuniaoId = await ensureReuniao(db, {
          agenciaId: effectiveAgenciaId,
          dataReuniao: d.data_reuniao,
          numeroReuniao: d.numero_reuniao,
          tipoReuniao: d.tipo_reuniao,
          source: "upload-confirm",
        });

        // ── ANTT: voto individual do relator — grava SÓ o voto NOMINAL do relator ──
        // O "Voto DXX" é a fonte do voto LIDO do relator. O colegiado completo vem da
        // ATA (via de ata com roster + backfill); inferir presentes a partir do texto
        // do voto inventava presença (QA D3). Anti-duplicação (QA D4): sem chave de
        // dedup (nem processo, nem data) NÃO materializa — fica em revisão.
        if (isAnttVotoCapturavel) {
          const relatorNome = (d.relator || d.nomes_votacao[0])!;
          if (!d.processo && !d.data_reuniao) {
            results.push({
              filename: d.filename,
              status: "document_saved",
              documento_id: d.documento_id ?? null,
              message: "Voto ANTT sem processo e sem data — mantido em revisão para evitar duplicata.",
            });
            continue;
          }
          const empresaIdV = await resolveEmpresaId(db, d.interessado, effectiveAgenciaId, { cache: empresaCache, setor: d.microtema });
          const existenteV = await findDeliberacaoExistente(db, {
            agenciaId: effectiveAgenciaId, numeroDeliberacao: d.numero_deliberacao,
            processo: d.processo, dataReuniao: d.data_reuniao, numeroReuniao: d.numero_reuniao,
          });
          if (existenteV) {
            await enrichDeliberacaoExistente(db, existenteV, { resultado: d.resultado, dataReuniao: d.data_reuniao, reuniaoId });
          }
          const { data: delibV, error: errV } = existenteV
            ? { data: { id: existenteV.id }, error: null }
            : await db.from("deliberacoes").insert({
                numero_deliberacao: d.numero_deliberacao, numero_reuniao: d.numero_reuniao,
                reuniao_ordinaria: d.reuniao_ordinaria, tipo_reuniao: d.tipo_reuniao,
                tipo_documento: "deliberacao", processo: d.processo, interessado: d.interessado,
                empresa_id: empresaIdV, assunto: d.assunto, procedencia: d.procedencia, relator: relatorNome,
                item_numero: d.item_numero, microtema: d.microtema, area_regulatoria: d.area_regulatoria ?? null, resultado: d.resultado,
                pauta_interna: false, data_reuniao: d.data_reuniao, data_publicacao: d.data_publicacao,
                agencia_id: effectiveAgenciaId, ...(reuniaoId ? { reuniao_id: reuniaoId } : {}),
                auto_classified: true, extraction_confidence: d.extraction_confidence,
                resumo_pleito: d.resumo_pleito, fundamento_decisao: d.fundamento_decisao,
                upload_job_id: attachment.upload_job_id,
                raw_extraction: withAttachmentRaw({
                  ...(d.extraction_raw ?? {}),
                  documento_antt_tipo: "voto_individual",
                  diretor_autor_voto: relatorNome,
                  // Persistir o nome p/ backfill retroativo (applyRetroactiveVotes).
                  nomes_votacao: [relatorNome],
                }, attachment),
              }).select("id").single();

          if (errV || !delibV) {
            results.push({ filename: d.filename, status: "error", error: "Erro ao materializar voto ANTT" });
            continue;
          }

          // Candidato do relator (para backfill se ainda não casar no cadastro).
          await recordDirectorCandidates(db, [relatorNome], diretoresList, {
            agencia_id: effectiveAgenciaId, filename: d.filename, source_type: "deliberacao",
            source_url: extractSourceUrl(d.extraction_raw),
            source_hash: hashEvidence(`${d.filename}|${d.numero_deliberacao ?? ""}|${d.processo ?? ""}`),
            deliberacao_id: delibV.id as string, numero_deliberacao: d.numero_deliberacao, processo: d.processo, tipo_documento: "deliberacao",
          });

          const relatorMatch = findBestMatch(relatorNome, diretoresList);
          const relatorId = relatorMatch.diretorId && !relatorMatch.needsReview ? relatorMatch.diretorId : null;
          const nominalRelator = relatorId
            ? buildVotoRows({
                deliberacao_id: delibV.id as string, nomes: [relatorNome], nomesContra: [], diretoresList,
                activeDiretoresList: [], resultado: d.resultado, inferFromMandate: false,
              })
            : [];
          if (nominalRelator.length > 0) await upsertVotosProtegido(db, nominalRelator);

          await markDocumentReviewed(db, d.documento_id, "confirmed", delibV.id as string);
          results.push({
            filename: d.filename, status: "created", deliberacao_id: delibV.id as string, documento_id: d.documento_id ?? null,
            message: relatorId
              ? "Voto ANTT capturado: relator (lido)."
              : "Voto ANTT materializado; relator pendente de aprovação (voto entra por backfill ao aprovar).",
          });
          continue;
        }

        if (d.tipo_documento === "ata" && rawConfirm.ata_items && rawConfirm.ata_items.length > 0) {
          const documentPrefix = internalAnttDocumentPrefix(d);
          const documentLabel = documentPrefix === "ATA" ? "Ata" : "Pauta";
          const ataNumero = d.numero_reuniao ? `${documentPrefix}-${d.numero_reuniao}` : d.numero_deliberacao;

          // Dedup: a MESMA ata confirmada 2× reusa a ata-mãe (e os itens abaixo),
          // em vez de duplicar tudo e contar em dobro nas métricas.
          const ataExistente = await findDeliberacaoExistente(db, {
            agenciaId: effectiveAgenciaId,
            numeroDeliberacao: ataNumero,
            dataReuniao: d.data_reuniao,
          });
          let ataPai: { id: string } | null = ataExistente ? { id: ataExistente.id } : null;
          if (ataExistente) {
            await enrichDeliberacaoExistente(db, ataExistente, {
              dataReuniao: d.data_reuniao,
              reuniaoId,
            });
          } else {
            const { data: inserted, error: ataErr } = await db
              .from("deliberacoes")
              .insert({
                numero_deliberacao: ataNumero,
                numero_reuniao: d.numero_reuniao,
                reuniao_ordinaria: d.reuniao_ordinaria,
                tipo_reuniao: d.tipo_reuniao,
                tipo_documento: "ata",
                assunto: `${documentLabel} da ${d.numero_reuniao ?? ""}ª Reunião - ${rawConfirm.ata_items.length} processos`,
                procedencia: d.procedencia,
                area_regulatoria: d.area_regulatoria ?? null,
                pauta_interna: false,
                data_reuniao: d.data_reuniao,
                data_publicacao: d.data_publicacao,
                agencia_id: effectiveAgenciaId,
                ...(reuniaoId ? { reuniao_id: reuniaoId } : {}),
                auto_classified: true,
                extraction_confidence: d.extraction_confidence,
                upload_job_id: attachment.upload_job_id,
                raw_extraction: withAttachmentRaw(d.extraction_raw, attachment),
              })
              .select("id")
              .single();
            if (ataErr || !inserted) {
              results.push({ filename: d.filename, status: "error", error: "Erro ao inserir ata/pauta" });
              continue;
            }
            ataPai = inserted as { id: string };
          }

          if (!ataPai) {
            results.push({ filename: d.filename, status: "error", error: "Erro ao inserir ata/pauta" });
            continue;
          }

          const ataVotingNames = uniqueNamesFromItems(rawConfirm.ata_items);
          await recordDirectorCandidates(db, ataVotingNames, diretoresList, {
            agencia_id: effectiveAgenciaId,
            filename: d.filename,
            source_type: "ata",
            source_url: extractSourceUrl(d.extraction_raw),
            source_hash: hashEvidence(`${d.filename}|${d.numero_reuniao ?? ""}|${documentPrefix.toLowerCase()}`),
            deliberacao_id: ataPai.id as string,
            numero_reuniao: d.numero_reuniao,
            tipo_documento: d.tipo_documento,
          });

          for (const item of rawConfirm.ata_items) {
            const itemEmpresaId = await resolveEmpresaId(db, item.interessado, effectiveAgenciaId, {
              cache: empresaCache,
              setor: item.microtema,
            });
            // Dedup por item: reimportação reusa a deliberação (votos upsertam idempotente).
            const itemNumero = d.numero_reuniao ? `${documentPrefix}-${d.numero_reuniao}-${item.item_numero}` : null;
            const itemExistente = await findDeliberacaoExistente(db, {
              agenciaId: effectiveAgenciaId,
              numeroDeliberacao: itemNumero,
              processo: item.processo,
              dataReuniao: d.data_reuniao,
              // Fecha o furo voto×ata: casa o item da ata com a deliberação do voto
              // individual (mesmo processo, MESMA reunião) quando a data diverge —
              // a data do voto é a de assinatura. Antes só o ramo do voto passava isto.
              numeroReuniao: d.numero_reuniao,
            });
            if (itemExistente) {
              await enrichDeliberacaoExistente(db, itemExistente, {
                resultado: item.resultado,
                dataReuniao: d.data_reuniao,
                reuniaoId,
              });
            }
            const { data: child } = itemExistente
              ? { data: { id: itemExistente.id } }
              : await db
              .from("deliberacoes")
              .insert({
                numero_deliberacao: itemNumero,
                numero_reuniao: d.numero_reuniao,
                reuniao_ordinaria: d.reuniao_ordinaria,
                tipo_reuniao: d.tipo_reuniao,
                tipo_documento: "ata",
                item_numero: item.item_numero,
                documento_pai_id: ataPai.id,
                processo: item.processo,
                interessado: item.interessado,
                empresa_id: itemEmpresaId,
                assunto: item.assunto,
                relator: item.relator,
                microtema: item.microtema,
                area_regulatoria: d.area_regulatoria ?? null,
                resultado: item.resultado,
                pauta_interna: false,
                data_reuniao: d.data_reuniao,
                data_publicacao: d.data_publicacao,
                agencia_id: effectiveAgenciaId,
                ...(reuniaoId ? { reuniao_id: reuniaoId } : {}),
                auto_classified: true,
                extraction_confidence: item.processo ? 0.8 : 0.4,
                resumo_pleito: item.decisao?.slice(0, 2000) ?? null,
                upload_job_id: attachment.upload_job_id,
                raw_extraction: withAttachmentRaw({
                  documento_antt_tipo: d.documento_antt_tipo,
                  documento_subtipo: d.documento_subtipo,
                  import_counts_as_final: Boolean(item.resultado),
                  item_numero: item.item_numero,
                  // Persistir os NOMES no filho (QA L1): sem isto, aprovar um
                  // candidato depois não backfillava (applyRetroactiveVotes lê
                  // exatamente raw.nomes_votacao/_contra/_ausente/_abstencao).
                  nomes_votacao: item.votos_detectados ?? [],
                  nomes_votacao_contra: item.votos_contra_detectados ?? [],
                  nomes_votacao_abstencao: item.votos_abstencao_detectados ?? [],
                  nomes_votacao_ausente: item.votos_ausentes_detectados ?? [],
                  unanimidade_detectada: Boolean(item.unanimidade_detectada),
                  votos_inferidos_por_mandato: shouldInferVotesFromMandate({
                    resultado: item.resultado,
                    tipo_documento: "ata",
                    import_counts_as_final: Boolean(item.resultado),
                    unanimidadeDetectada: item.unanimidade_detectada,
                    nomes: item.votos_detectados ?? [],
                    nomesContra: item.votos_contra_detectados ?? [],
                    nomesAbstencao: item.votos_abstencao_detectados ?? [],
                    dataReuniao: d.data_reuniao,
                  }),
                  warnings: item.warnings ?? [],
                }, attachment),
              })
              .select("id")
              .single();

            const itemVotingNames = item.votos_detectados ?? [];
            if (child) {
              // ANTT (QA B3): em ata, votos_detectados são os PRESENTES (presença,
              // não voto lido por diretor). Antes iam como pseudo-nominais e
              // BLOQUEAVAM a inferência → só quem casava (Alessandro) virava voto.
              // Agora: presentes casados formam o ROSTER de inferência do item
              // (todos ganham "Favorável" is_nominal=false em unanimidade);
              // divergentes/abstenções/ausentes continuam nominais com precedência.
              const isAnttAtaItem = Boolean(d.documento_antt_tipo);
              const rosterItem = isAnttAtaItem
                ? itemVotingNames
                    .map((nome) => {
                      const m = findBestMatch(nome, diretoresList);
                      return m.diretorId && !m.needsReview
                        ? diretoresList.find((x) => x.id === m.diretorId) ?? null
                        : null;
                    })
                    .filter((x): x is DiretorVoteRecord => Boolean(x))
                : [];
              const votoRows = item.votos_sugeridos?.length
                ? buildVotoRowsFromSuggestions({
                  deliberacao_id: child.id as string,
                  votosSugeridos: item.votos_sugeridos,
                  resultado: item.resultado,
                  unanime: Boolean(item.unanimidade_detectada),
                })
                : buildVotoRows({
                  deliberacao_id: child.id as string,
                  nomes: isAnttAtaItem ? [] : itemVotingNames,
                  nomesContra: item.votos_contra_detectados ?? [],
                  nomesAbstencao: item.votos_abstencao_detectados ?? [],
                  nomesAusente: item.votos_ausentes_detectados ?? [],
                  diretoresList,
                  activeDiretoresList: isAnttAtaItem && rosterItem.length > 0 ? rosterItem : activeDiretoresList,
                  resultado: item.resultado,
                  unanime: Boolean(item.unanimidade_detectada),
                  inferFromMandate: isAnttAtaItem
                    ? Boolean(item.unanimidade_detectada && item.resultado && rosterItem.length > 0)
                    : shouldInferVotesFromMandate({
                      resultado: item.resultado,
                      tipo_documento: "ata",
                      import_counts_as_final: Boolean(item.resultado),
                      unanimidadeDetectada: item.unanimidade_detectada,
                      nomes: itemVotingNames,
                      nomesContra: item.votos_contra_detectados ?? [],
                      nomesAbstencao: item.votos_abstencao_detectados ?? [],
                      dataReuniao: d.data_reuniao,
                    }),
                });

              if (votoRows.length > 0) await upsertVotosProtegido(db, votoRows);
            }
          }

          await markDocumentReviewed(db, d.documento_id, "confirmed", ataPai.id as string);
          results.push({ filename: d.filename, status: "created", deliberacao_id: ataPai.id as string, documento_id: d.documento_id ?? null });
          continue;
        }

        const empresaId = await resolveEmpresaId(db, d.interessado, effectiveAgenciaId, {
          cache: empresaCache,
          setor: d.microtema,
        });

        // Dedup: a MESMA deliberação (mesmo número no mesmo ano, ou mesmo
        // processo na mesma data) vinda de outro documento REUSA a existente.
        const delibExistente = await findDeliberacaoExistente(db, {
          agenciaId: effectiveAgenciaId,
          numeroDeliberacao: d.numero_deliberacao,
          processo: d.processo,
          dataReuniao: d.data_reuniao,
        });
        if (delibExistente) {
          await enrichDeliberacaoExistente(db, delibExistente, {
            resultado: d.resultado,
            dataReuniao: d.data_reuniao,
            reuniaoId,
          });
        }
        const { data: delib, error: deliberacaoErr } = delibExistente
          ? { data: { id: delibExistente.id }, error: null }
          : await db
          .from("deliberacoes")
          .insert({
            numero_deliberacao: d.numero_deliberacao,
            numero_reuniao: d.numero_reuniao,
            reuniao_ordinaria: d.reuniao_ordinaria,
            tipo_reuniao: d.tipo_reuniao,
            tipo_documento: d.tipo_documento ?? "deliberacao",
            processo: d.processo,
            interessado: d.interessado,
            empresa_id: empresaId,
            assunto: d.assunto,
            procedencia: d.procedencia,
            relator: d.relator,
            item_numero: d.item_numero,
            microtema: d.microtema,
            area_regulatoria: d.area_regulatoria ?? null,
            resultado: d.resultado,
            decisoes_todas: d.decisoes_todas.length > 0 ? d.decisoes_todas : null,
            pauta_interna: d.pauta_interna,
            data_reuniao: d.data_reuniao,
            data_publicacao: d.data_publicacao,
            agencia_id: effectiveAgenciaId,
            ...(reuniaoId ? { reuniao_id: reuniaoId } : {}),
            auto_classified: true,
            extraction_confidence: d.extraction_confidence,
            resumo_pleito: d.resumo_pleito,
            fundamento_decisao: d.fundamento_decisao,
            upload_job_id: attachment.upload_job_id,
            raw_extraction: withAttachmentRaw({
              ...(d.extraction_raw ?? {}),
              votos_inferidos_por_mandato: shouldInferVotesFromMandate({
                resultado: d.resultado,
                tipo_documento: d.tipo_documento,
                import_counts_as_final: d.import_counts_as_final,
                unanimidadeDetectada: Boolean(d.extraction_raw?.unanimidade_detectada),
                nomes: d.nomes_votacao,
                nomesContra: d.nomes_votacao_contra,
                nomesAbstencao: d.nomes_votacao_abstencao ?? [],
                dataReuniao: d.data_reuniao,
              }),
            }, attachment),
          })
          .select("id")
          .single();

        if (deliberacaoErr || !delib) {
          console.error("[upload/confirm] Erro ao inserir deliberação:", deliberacaoErr);
          results.push({ filename: d.filename, status: "error", error: "Erro ao inserir deliberação" });
          continue;
        }

        const votingNames = d.nomes_votacao;
        if (votingNames.length > 0) {
          await recordDirectorCandidates(db, votingNames, diretoresList, {
            agencia_id: effectiveAgenciaId,
            filename: d.filename,
            source_type: d.tipo_documento === "ata" ? "ata" : "deliberacao",
            source_url: extractSourceUrl(d.extraction_raw),
            source_hash: hashEvidence(`${d.filename}|${d.numero_deliberacao ?? ""}|${d.processo ?? ""}`),
            deliberacao_id: delib.id as string,
            numero_deliberacao: d.numero_deliberacao,
            processo: d.processo,
            tipo_documento: d.tipo_documento,
          });

        }

        const votoRows = (d.votos_sugeridos ?? []).length
          ? buildVotoRowsFromSuggestions({
            deliberacao_id: delib.id as string,
            votosSugeridos: d.votos_sugeridos ?? [],
            resultado: d.resultado,
            unanime: Boolean(d.extraction_raw?.unanimidade_detectada),
          })
          : buildVotoRows({
            deliberacao_id: delib.id as string,
            nomes: votingNames,
            nomesContra: d.nomes_votacao_contra,
            nomesAbstencao: d.nomes_votacao_abstencao ?? [],
            nomesAusente: d.nomes_votacao_ausente ?? [],
            diretoresList,
            activeDiretoresList,
            resultado: d.resultado,
            unanime: Boolean(d.extraction_raw?.unanimidade_detectada),
            inferFromMandate: shouldInferVotesFromMandate({
              resultado: d.resultado,
              tipo_documento: d.tipo_documento,
              import_counts_as_final: d.import_counts_as_final,
              unanimidadeDetectada: Boolean(d.extraction_raw?.unanimidade_detectada),
              nomes: votingNames,
              nomesContra: d.nomes_votacao_contra,
              nomesAbstencao: d.nomes_votacao_abstencao ?? [],
              dataReuniao: d.data_reuniao,
            }),
          });
        if (votoRows.length > 0) await upsertVotosProtegido(db, votoRows);

        await markDocumentReviewed(db, d.documento_id, "confirmed", delib.id as string);
        results.push({
          filename: d.filename,
          status: "created",
          deliberacao_id: delib.id as string,
          documento_id: d.documento_id ?? null,
          ...(delibExistente ? { message: "Deliberação já existia — reaproveitada (dedup); votos atualizados sem dupla contagem." } : {}),
        });
      } catch (err) {
        console.error("[upload/confirm] Erro inesperado ao processar deliberação:", err);
        results.push({ filename: d.filename, status: "error", error: "Erro interno ao processar deliberação" });
      }
    }

    const created = results.filter((r) => r.status === "created" || r.status === "document_saved").length;
    const errors = results.filter((r) => r.status === "error").length;

    const response: BatchConfirmResponse = { created, errors, results };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("[upload/confirm] Erro inesperado:", error);
    return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 });
  }
}

async function recordDirectorCandidates(
  db: any,
  nomes: string[],
  diretoresList: Array<{ id: string; nome: string; nome_variantes: string[] }>,
  evidence: {
    agencia_id: string;
    filename: string;
    source_type: "deliberacao" | "ata";
    source_url: string | null;
    source_hash: string;
    deliberacao_id?: string;
    numero_deliberacao?: string | null;
    numero_reuniao?: string | null;
    processo?: string | null;
    tipo_documento?: string | null;
  },
) {
  // Só cria candidato para o que PARECE nome de pessoa — bloqueia palavra-função
  // ("Diretor", "Presidente", "Diretor-Geral") que gerava match-lixo de 35%.
  const uniqueNames = [...new Set(
    nomes.map((n) => normalizeName(String(n))).filter((n) => n.length >= 3 && isLikelyPersonName(n)),
  )];
  if (uniqueNames.length === 0) return;

  const rows = uniqueNames
    .map((nome) => {
      const match = findBestMatch(nome, diretoresList);
      if (!match.needsReview && !match.isNew) return null;
      return {
        agencia_id: evidence.agencia_id,
        nome_detectado: nome,
        cargo_detectado: null,
        diretor_id: match.diretorId,
        source_type: evidence.source_type,
        source_url: evidence.source_url,
        source_hash: evidence.source_hash,
        confidence: Math.max(0.35, Math.min(match.score || 0.5, 0.94)),
        review_status: "pendente",
        evidence: {
          filename: evidence.filename,
          deliberacao_id: evidence.deliberacao_id,
          numero_deliberacao: evidence.numero_deliberacao,
          numero_reuniao: evidence.numero_reuniao,
          processo: evidence.processo,
          tipo_documento: evidence.tipo_documento,
          match_score: match.score,
          match_kind: match.isNew ? "new_director" : "weak_match",
          lgpd_note: "Dados limitados a função pública; sem CPF, contato ou endereço.",
        },
      };
    })
    .filter(Boolean);

  if (rows.length === 0) return;

  // DEDUP por (agência, nome): a chave única inclui source_hash (por documento), então
  // o MESMO nome em 6 documentos virava 6 cartões pendentes idênticos. Se já existe
  // candidato pendente do nome, só atualiza (confidence máxima + evidência mais recente).
  const { data: pendentes } = await db
    .from("diretor_candidatos")
    .select("id, nome_detectado, confidence")
    .eq("agencia_id", evidence.agencia_id)
    .eq("review_status", "pendente")
    .in("nome_detectado", rows.map((r: any) => r.nome_detectado));
  const pendenteByNome = new Map<string, { id: string; confidence: number }>(
    (pendentes ?? []).map((p: any) => [p.nome_detectado, { id: p.id, confidence: Number(p.confidence) || 0 }]),
  );

  const toInsert: typeof rows = [];
  for (const row of rows as any[]) {
    const existente = pendenteByNome.get(row.nome_detectado);
    if (existente) {
      await db
        .from("diretor_candidatos")
        .update({
          confidence: Math.max(existente.confidence, row.confidence),
          diretor_id: row.diretor_id ?? undefined,
          evidence: row.evidence,
          source_url: row.source_url,
        })
        .eq("id", existente.id);
    } else {
      toInsert.push(row);
    }
  }

  if (toInsert.length === 0) return;
  const { error } = await db
    .from("diretor_candidatos")
    .upsert(toInsert, { onConflict: "agencia_id,nome_detectado,source_hash", ignoreDuplicates: true });

  if (error) {
    console.warn("[upload/confirm] Não foi possível registrar candidatos de diretores:", error.message);
  }
}

function extractSourceUrl(raw: Record<string, unknown> | undefined): string | null {
  const value = raw?.source_url ?? raw?.url ?? raw?.monitoramento_url;
  return typeof value === "string" && value.startsWith("http") ? value.slice(0, 1000) : null;
}

function hashEvidence(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function uniqueNamesFromItems(items: Array<{ votos_detectados?: string[] }> | undefined) {
  return [...new Set((items ?? []).flatMap((item) => item.votos_detectados ?? []))];
}

function internalAnttDocumentPrefix(d: ConfirmDelib) {
  const anttType = d.documento_antt_tipo ?? d.extraction_raw?.documento_antt_tipo;
  return anttType === "ata" ? "ATA" : anttType ? "PAUTA" : "ATA";
}

async function parseConfirmRequest(req: NextRequest): Promise<ParsedConfirmBody> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const payload = formData.get("payload");
    if (typeof payload !== "string") throw new Error("payload ausente");
    const filesByName = new Map<string, File>();
    const { isPdfBuffer } = await import("@/lib/server/pdf-extractor");
    const { isZipBuffer, extractPdfEntriesFromZip } = await import("@/lib/server/zip-extractor");
    for (const entry of formData.getAll("files")) {
      if (!(entry instanceof File)) continue;
      const buffer = Buffer.from(await entry.arrayBuffer());
      if (isPdfBuffer(buffer)) {
        filesByName.set(entry.name, entry);
      } else if (isZipBuffer(buffer)) {
        const pdfs = extractPdfEntriesFromZip(buffer, {
          maxFiles: 500,
          maxTotalUncompressedBytes: 150 * 1024 * 1024,
        });
        for (const pdf of pdfs) {
          filesByName.set(pdf.name, new File([new Uint8Array(pdf.buffer)], pdf.name, { type: "application/pdf" }));
        }
      }
    }
    return { body: JSON.parse(payload), filesByName };
  }

  return {
    body: await req.json(),
    filesByName: new Map(),
  };
}

async function ensureUploadAttachment(
  db: any,
  file: File | undefined,
  agenciaId: string,
): Promise<{ upload_job_id: string | null; file_hash: string | null; storage_path: string | null; error?: string }> {
  if (!file) return { upload_job_id: null, file_hash: null, storage_path: null };

  const { isPdfBuffer, sha256Hex } = await import("@/lib/server/pdf-extractor");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!isPdfBuffer(buffer)) return { upload_job_id: null, file_hash: null, storage_path: null, error: "Arquivo anexado não é PDF válido" };

  const fileHash = await sha256Hex(buffer);
  const { data: existing } = await db
    .from("upload_jobs")
    .select("id, storage_path, file_hash")
    .eq("file_hash", fileHash)
    .maybeSingle();

  if (existing) {
    return {
      upload_job_id: existing.id as string,
      file_hash: (existing.file_hash as string | null) ?? fileHash,
      storage_path: (existing.storage_path as string | null) ?? null,
    };
  }

  const storagePath = `${agenciaId}/${fileHash}.pdf`;
  const bucketErr = await ensurePdfStorageBucket(db);
  if (bucketErr) {
    return { upload_job_id: null, file_hash: fileHash, storage_path: storagePath, error: bucketErr };
  }

  const { error: uploadErr } = await db.storage
    .from("pdfs")
    .upload(storagePath, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadErr) {
    return { upload_job_id: null, file_hash: fileHash, storage_path: storagePath, error: `Falha ao salvar PDF: ${uploadErr.message}` };
  }

  const { data: job, error: jobErr } = await db
    .from("upload_jobs")
    .insert({
      filename: file.name,
      file_hash: fileHash,
      status: "done",
      agencia_id: agenciaId,
      storage_path: storagePath,
    })
    .select("id")
    .single();

  if (jobErr || !job) {
    return { upload_job_id: null, file_hash: fileHash, storage_path: storagePath, error: "Falha ao registrar anexo no banco" };
  }

  return { upload_job_id: job.id as string, file_hash: fileHash, storage_path: storagePath };
}

async function getDocumentAttachment(
  db: any,
  documentoId: string,
): Promise<{ upload_job_id: string | null; file_hash: string | null; storage_path: string | null; error?: string }> {
  const { data: doc, error } = await db
    .from("documentos_regulatorios")
    .select("id, upload_job_id, file_hash, storage_path, storage_bucket")
    .eq("id", documentoId)
    .maybeSingle();

  if (error || !doc) {
    return { upload_job_id: null, file_hash: null, storage_path: null, error: "Documento bruto nao encontrado" };
  }

  return {
    upload_job_id: (doc.upload_job_id as string | null) ?? null,
    file_hash: (doc.file_hash as string | null) ?? null,
    storage_path: (doc.storage_path as string | null) ?? null,
  };
}

async function markDocumentReviewed(
  db: any,
  documentoId: string | null | undefined,
  status: "confirmed" | "ignored",
  deliberacaoId?: string | null,
) {
  if (!documentoId) return;
  const { error } = await db
    .from("documentos_regulatorios")
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentoId);
  if (error) console.warn("[upload/confirm] Falha ao atualizar documento bruto:", error.message);

  // Back-link regulatório→deliberação como UPDATE separado e tolerante: se a
  // coluna ainda não existir (migration não aplicada), não derruba a confirmação.
  if (status === "confirmed" && deliberacaoId) {
    const { error: linkErr } = await db
      .from("documentos_regulatorios")
      .update({ deliberacao_id: deliberacaoId })
      .eq("id", documentoId);
    if (linkErr && !/column .*deliberacao_id/i.test(linkErr.message ?? "")) {
      console.warn("[upload/confirm] Falha ao gravar deliberacao_id:", linkErr.message);
    }
  }
}

async function ensurePdfStorageBucket(db: any): Promise<string | null> {
  const { data: bucket } = await db.storage.getBucket("pdfs");
  if (bucket) return null;

  const { error } = await db.storage.createBucket("pdfs", {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: ["application/pdf"],
  });

  if (!error) return null;
  if (/already exists|duplicate/i.test(error.message ?? "")) return null;
  return `Bucket de PDFs ausente e nao foi possivel cria-lo automaticamente: ${error.message}`;
}

function withAttachmentRaw(raw: Record<string, unknown> | undefined, attachment: { upload_job_id: string | null; file_hash: string | null; storage_path: string | null }) {
  return {
    ...(raw ?? {}),
    upload_job_id: attachment.upload_job_id,
    file_hash: attachment.file_hash,
    storage_path: attachment.storage_path,
  };
}
