import type { PreviewResult } from "@/types";
import { classifyAreaRegulatoria } from "@/lib/server/area-regulatoria";
import { detectDocumentType, extractAtaMetadata, splitAtaItemsWithStats } from "@/lib/server/ata-splitter";
import {
  avisoUnanimidadeContestada, avisoAtaItensFaltando,
  checarAncorasItens, checarCoerenciaUnanimidade, checarImpedidoComVoto,
  checarCardinalidadeVotos, checarInteressadoNoDispositivo, checarVotoQualidadeDuplo,
  checarAdmissibilidadeMalClassificada, checarLigaduraResidual,
  checarDataAnteriorAoProcesso, checarAnoProtocoloDaAta,
  formatarAchados, temBloqueio, type Achado,
} from "@/lib/server/consistency-checks";
import { classifyMicrotema, classifyPautaInterna, detectAgenciaSigla } from "@/lib/server/classifier";
import { extractFields, calcConfidence, extractItemVotes, buildRoleMap, extractRetirada, extractVotosEmAutos } from "@/lib/server/nlp-extractor";
import { parseAnttManualDocument, isAnttVotoFilename, setAnttDynamicInitials, buildAnttDirectorInitials, setAnttCargoMandatos, type AnttCargoMandato } from "@/lib/server/antt-manual-parser";
import { extractPdfText, isPdfBuffer, sha256Hex, SCANNED_CHARS_PER_PAGE_THRESHOLD, probeLigatureDefects } from "@/lib/server/pdf-extractor";
import { isOcrConfigured, MAX_OCR_BYTES } from "@/lib/server/ocr";

// Avisos INFORMATIVOS (não são problema de qualidade): não devem manter o preview
// eternamente em "low_confidence". Casam pelos trechos LIMPos das mensagens (que
// têm mojibake no restante). Usado para computar o status do preview.
export const INFO_WARNING_RE = /tratad[oa]\s+como\s+(?:pauta|ata|envelope|documento)|precisa de revis|confirme\s+somente|entra.{0,5}nos\s+dashboards|votos\s+n.{0,3}o\s+s.{0,3}o\s+criados/i;
import { classifyRegulatoryDocument, extractAnmMeetingMetadata, detectJuizo } from "@/lib/server/regulatory-documents";
import { dataReuniaoPlausivel } from "@/lib/server/colegiado-sources";
import {
  buildVoteSuggestions,
  getActiveDiretoresForVote,
  shouldInferVotesFromMandate,
  type DiretorVoteRecord,
} from "@/lib/server/vote-inference";
import { findBestMatch } from "@/lib/server/name-matcher";

export type UploadAnalysisAgency = { id: string; sigla: string };

export type UploadAnalysisDb = {
  from: (table: string) => {
    select: (columns: string) => any;
  };
};

export type UploadAnalysisInput = {
  name: string;
  buffer: Buffer;
  source_archive?: string | null;
  size: number;
};

export async function analyzeUploadPdf(input: {
  file: UploadAnalysisInput;
  agencias: UploadAnalysisAgency[];
  db?: any | null;
  currentDocumentoId?: string | null;
  currentUploadJobId?: string | null;
}): Promise<PreviewResult> {
  const { file, agencias, db, currentDocumentoId = null, currentUploadJobId = null } = input;

  // Iniciais ANTT DINÂMICAS (ago/2026): deriva do cadastro (com cache de 10min por instância)
  // — na troca de diretoria, o "Voto DXY" novo resolve sem deploy. Sem db (preview demo),
  // segue só o mapa curado.
  await refreshAnttDynamicInitials(db, agencias);

  if (!isPdfBuffer(file.buffer)) {
    return {
      ...errorResult(file.name),
      error: file.source_archive
        ? `Entrada do ZIP ${file.source_archive} nao e um PDF valido`
        : "Arquivo invalido: nao e um PDF valido",
    };
  }

  const file_hash = await sha256Hex(file.buffer);
  let is_duplicate = false;
  let duplicate_job_id: string | null = null;

  if (db) {
    const { data: existingDoc } = await db
      .from("documentos_regulatorios")
      .select("id, upload_job_id, status")
      .eq("file_hash", file_hash)
      .maybeSingle();

    if (existingDoc && existingDoc.id !== currentDocumentoId && existingDoc.status === "confirmed") {
      is_duplicate = true;
      duplicate_job_id = (existingDoc.upload_job_id as string | null) ?? (existingDoc.id as string);
    } else {
      const { data: existingJob } = await db
        .from("upload_jobs")
        .select("id, status")
        .eq("file_hash", file_hash)
        .maybeSingle();
      if (existingJob && existingJob.id !== currentUploadJobId && existingJob.status === "done") {
        is_duplicate = true;
        duplicate_job_id = existingJob.id as string;
      }
    }
  }

  let extraction: Awaited<ReturnType<typeof extractPdfText>>;
  try {
    extraction = await extractPdfText(file.buffer);
  } catch {
    return {
      ...errorResult(file.name, file_hash),
      error: "Falha ao extrair texto do PDF",
    };
  }

  if (!extraction.text || extraction.text.length < 50) {
    // Provável documento ESCANEADO (sem camada de texto). Antes virava status "error" → o pipeline
    // marcava o doc/job como FAILED e ele sumia no balde "Falhou". Agora vai para REVISÃO
    // (low_confidence + confiança 0) — auditável e recuperável (o humano habilita OCR ou reenvia
    // um PDF pesquisável), em vez de parecer um erro de processamento. QA jul/2026, PR-M.
    // QA ago/2026: mesmo sem texto, o FILENAME pode identificar o doc ("Voto DFQ 035-2026.pdf" =
    // voto ANTT). Antes ficava "? · documento_apoio" (voto real invisível na fila); agora aparece
    // como "ANTT · voto_individual" para o revisor. Segue low_confidence/confiança 0 — o
    // auto-confirm continua barrando (nunca chuta); só melhora a triagem humana.
    const anttByName = isAnttVotoFilename(file.name);
    const scannedBase = errorResult(file.name, file_hash);
    if (anttByName) {
      const anttAgencia = agencias.find((a) => a.sigla === "ANTT");
      scannedBase.fields.tipo_documento = "voto_individual";
      scannedBase.fields.procedencia = "ANTT";
      scannedBase.agencia_sigla_detected = "ANTT";
      scannedBase.agencia_id_detected = anttAgencia?.id ?? null;
    }
    return {
      ...scannedBase,
      status: "low_confidence",
      page_count: extraction.pageCount,
      warnings: [
        `Provável documento digitalizado/escaneado (sem camada de texto). ${
          isOcrConfigured()
            ? (file.size > MAX_OCR_BYTES
                // QA ago/2026: >5MB o OCR nem tenta (teto do provedor) — sem este aviso, o
                // genérico "não recuperou texto" enganava o operador.
                ? `O PDF tem ${(file.size / (1024 * 1024)).toFixed(1)} MB e EXCEDE o limite do OCR (5 MB) — comprimir o PDF ou reenviar versão pesquisável.`
                : "O OCR não recuperou texto suficiente.")
            : "Habilite OCR_SPACE_API_KEY ou reenvie um PDF pesquisável."
        } Fica em revisão para conferência manual — não foi descartado.`,
        ...(anttByName ? ["Identificado pelo nome do arquivo como VOTO ANTT — confirme o conteúdo ao revisar."] : []),
      ],
    };
  }

  let tipo_documento = detectDocumentType(extraction.text);
  const fields = extractFields(extraction.text);
  const antt = parseAnttManualDocument(extraction.text, file.name);
  if (antt.isAntt) {
    Object.assign(fields, withoutUndefined(antt.fields as Record<string, unknown>));
    if (antt.fields.tipo_documento) tipo_documento = antt.fields.tipo_documento;
  }

  let { microtema } = classifyMicrotema(extraction.text);
  let area_regulatoria = classifyAreaRegulatoria(extraction.text);
  let confidence = calcConfidence(fields);
  if (antt.isAntt) confidence = Math.max(confidence, antt.confidenceBoost);

  // Filename conta na detecção de agência (uploads manuais "Voto DFQ..." não têm a sigla no texto).
  let agencia_sigla_detected = detectAgenciaSigla(`${file.name}\n${extraction.text}`, agencias.map((a) => a.sigla));
  if (antt.isAntt) agencia_sigla_detected = "ANTT";
  const agencia_id_detected = agencia_sigla_detected
    ? agencias.find((a) => a.sigla === agencia_sigla_detected)?.id ?? null
    : null;
  const diretoresList = await getDiretoresList(db, agencia_id_detected);

  const pauta_interna = antt.isAntt
    ? Boolean(antt.fields.pauta_interna)
    : fields.pauta_interna || classifyPautaInterna(extraction.text, fields.interessado, agencia_sigla_detected);

  const regulatoryClass = classifyRegulatoryDocument({
    text: extraction.text,
    filename: file.name,
    tipo_documento,
    agencia_sigla: agencia_sigla_detected,
    documento_antt_tipo: antt.documentType,
    numero_deliberacao: fields.numero_deliberacao,
    numero_reuniao: fields.numero_reuniao,
    data_reuniao: fields.data_reuniao,
    processo: fields.processo,
  });
  tipo_documento = regulatoryClass.tipo_documento;

  const documentWarnings = [
    ...(antt.isAntt ? antt.warnings : []),
    ...regulatoryClass.warnings,
  ];
  if (!regulatoryClass.import_counts_as_final) confidence = Math.min(confidence, 0.72);

  if (agencia_sigla_detected === "ANM" || regulatoryClass.documento_subtipo?.startsWith("anm_")) {
    const anmMeta = extractAnmMeetingMetadata(extraction.text, file.name);
    if (anmMeta.numero_reuniao && !fields.numero_reuniao) fields.numero_reuniao = anmMeta.numero_reuniao;
    if (anmMeta.tipo_reuniao && !fields.tipo_reuniao) fields.tipo_reuniao = anmMeta.tipo_reuniao;
    // Fase 9 — `&& !fields.data_reuniao`, igual às duas linhas acima. Sem isso, uma data que
    // `parseDataExtenso` já havia lido COM âncora de contexto era substituída pelo parser da ANM,
    // que até agora tinha um fallback mais fraco. As três linhas deste bloco enriquecem o que
    // falta; nenhuma delas deveria sobrescrever o que já foi lido com mais contexto.
    if (anmMeta.data_reuniao && !fields.data_reuniao) fields.data_reuniao = anmMeta.data_reuniao;
  }

  let semantic_duplicate = false;
  if (db && !is_duplicate) {
    if (fields.numero_deliberacao && agencia_id_detected) {
      const { data: existingDelib } = await db
        .from("deliberacoes")
        .select("id")
        .eq("numero_deliberacao", fields.numero_deliberacao)
        .eq("agencia_id", agencia_id_detected)
        .maybeSingle();
      if (existingDelib) semantic_duplicate = true;
    }

    if (!semantic_duplicate && fields.data_reuniao && agencia_id_detected && fields.interessado) {
      const { data: existingByDate } = await db
        .from("deliberacoes")
        .select("id")
        .eq("data_reuniao", fields.data_reuniao)
        .eq("agencia_id", agencia_id_detected)
        .eq("interessado", fields.interessado)
        .maybeSingle();
      if (existingByDate) semantic_duplicate = true;
    }

    // Também deduplica contra a FILA: outro PDF (hash diferente) da MESMA matéria
    // já em revisão/processamento. Sem isso, dois documentos da mesma deliberação
    // entram em paralelo e viram deliberações duplicadas ao confirmar.
    const semanticKeyForDedup = antt.raw.dedupe_semantic_key
      ? String(antt.raw.dedupe_semantic_key)
      : regulatoryClass.semantic_duplicate_key;
    if (!semantic_duplicate && semanticKeyForDedup) {
      let pendingQuery = db
        .from("documentos_regulatorios")
        .select("id")
        .eq("semantic_duplicate_key", semanticKeyForDedup)
        .in("status", ["queued", "processing", "review_pending"]);
      // Exclui a própria linha (no pipeline ela já está em 'processing').
      if (currentDocumentoId) pendingQuery = pendingQuery.neq("id", currentDocumentoId);
      const { data: pendingDup } = await pendingQuery.limit(1).maybeSingle();
      if (pendingDup) semantic_duplicate = true;
    }
  }

  let ata_items: PreviewResult["ata_items"] | undefined;
  let ataItemStats: { itens_pre_dedup: number; duplicatas_removidas: number } | null = null;
  // Achados da suíte de validação (etapa63). Os BLOQUEANTES recusam o confirm.
  const achados: Achado[] = [];
  const retirada = extractRetirada(extraction.text);
  const votosEmAutos = extractVotosEmAutos(extraction.text);
  // (c) Nome com voto em autos SEM diretor cadastrado → AVISO, nunca voto. Criar o diretor a
  // partir daqui seria fabricar cadastro a partir de uma citação histórica.
  for (const v of votosEmAutos) {
    const m = findBestMatch(v.nome, diretoresList);
    if (!m.diretorId || m.needsReview) {
      documentWarnings.push(
        `Voto proferido em sessão anterior por "${v.nome}"${v.sessao ? ` (${v.sessao})` : ""} — ` +
        "diretor não localizado no cadastro; o voto NÃO foi criado. Cadastrar/aprovar o diretor e reprocessar.",
      );
    }
  }
  if (tipo_documento === "ata") {
    const ataSplit = splitAtaItemsWithStats(extraction.text);
    const rawItems = ataSplit.items;
    ataItemStats = {
      itens_pre_dedup: ataSplit.itens_pre_dedup,
      duplicatas_removidas: ataSplit.duplicatas_removidas,
    };
    if (ataSplit.duplicatas_removidas > 0) {
      documentWarnings.push(
        `Ata com ${ataSplit.duplicatas_removidas} item(ns) repetido(s) no próprio documento — ` +
        `mantida a ocorrência com dispositivo. Conferir a divisão da ata.`,
      );
    }
    // F (ago/2026): item de ata que não parseou deixa de sumir em SILÊNCIO → aviso (revisão).
    const avisoItens = avisoAtaItensFaltando(extraction.text, rawItems.length);
    if (avisoItens) documentWarnings.push(avisoItens);
    // C03 (etapa63): reconciliação âncora × item, contra o número PRÉ-dedup. Comparar contra o
    // pós-dedup faria de uma dedup CORRETA um alarme permanente — e alarme que sempre dispara é
    // alarme que ninguém lê.
    achados.push(...checarAncorasItens({
      // MEDIDO nas 8 atas do corpus: a âncora de dispositivo tem TRÊS formas. `DELIBERAÇÃO:` é a
      // da ANM, `Decisão:` é a da ANTT (que não usa a primeira em nenhuma das duas atas), e o item
      // RETIRADO de pauta não tem linha de dispositivo nenhuma — mas é um item legítimo. Contar só
      // a primeira dava "itens excedem âncoras" em 8 de 8 atas.
      ancoras: (extraction.text.match(/DELIBERA[ÇC][ÃA]O\s*:|Decis[ãa]o\s*:|[Ii]tem retirado de pauta/g) ?? []).length,
      itens_pre_dedup: ataSplit.itens_pre_dedup,
      duplicatas_removidas: ataSplit.duplicatas_removidas,
    }));
    const ataMeta = extractAtaMetadata(extraction.text);
    // Cargo→nome do PREÂMBULO da ata inteira (o texto por item não tem "presidida pelo
    // Diretor-Geral, NOME") — resolve "divergência apresentada pelo Diretor-Geral" por item.
    const roleMap = buildRoleMap(extraction.text);
    ata_items = rawItems.map((item) => {
      // Votos EXPLÍCITOS por item (antes eram sempre [], o que fazia a inferência
      // por mandato inverter votos contrários reais).
      const itemVotes = extractItemVotes(item.raw_text, roleMap);
      return {
        item_numero: item.item_numero,
        processo: item.processo,
        assunto: item.assunto,
        interessado: item.interessado,
        relator: item.relator,
        decisao: item.decisao?.slice(0, 500) ?? null,
        resultado: item.resultado,
        microtema: classifyMicrotema(item.raw_text, agencia_sigla_detected).microtema,
        area_regulatoria: classifyAreaRegulatoria(item.raw_text),
        votos_detectados: itemVotes.favor,
        votos_contra_detectados: itemVotes.contra,
        votos_abstencao_detectados: itemVotes.abstencao,
        votos_ausentes_detectados: itemVotes.ausente,
        votos_impedidos_detectados: itemVotes.impedido,
        votos_em_autos_detectados: extractVotosEmAutos(item.raw_text).map((v) => v.nome),
        // JUÍZO POR ITEM (fecha a etapa54 para atas). O juízo do DOCUMENTO não serve a uma ata:
        // um item pode ser não-conhecido e os outros julgados no mérito — gravar o valor do
        // documento em todos seria pior que não gravar. Medido: 10 itens de admissibilidade só na
        // 83ª ROP, e nenhum deles era distinguível antes disto.
        juizo: detectJuizo(item.raw_text),
        // Avisos do item: os do splitter (que este map DESCARTAVA — o leitor em `documentWarnings`
        // nunca os via) mais o da etapa51, divergência declarada sem dissidente imputável.
        // Não casa INFO_WARNING_RE de propósito: é problema de QUALIDADE — há dissenso no texto e
        // ninguém a quem imputá-lo, exatamente o caso que exige olho humano.
        ...(((item as { warnings?: string[] }).warnings?.length ?? 0) + itemVotes.avisos.length > 0
          ? { warnings: [...((item as { warnings?: string[] }).warnings ?? []), ...itemVotes.avisos] }
          : {}),
        unanimidade_detectada: item.unanimidade,
      };
    });
    // A data da ABERTURA da ata (extenso oficial) tem prioridade sobre a genérica —
    // a genérica pescava datas de resoluções citadas no corpo (bug pego pelo corpus).
    if (ataMeta.data_reuniao) fields.data_reuniao = ataMeta.data_reuniao;
    const ataConf = calcAtaPreviewConfidence({
      numero_reuniao: fields.numero_reuniao,
      tipo_reuniao: fields.tipo_reuniao,
      data_reuniao: fields.data_reuniao,
      agencia_sigla_detected,
      ata_items,
    });
    // Mantém o teto de 0.72 quando não é decisão final (atas precisam de revisão dos itens):
    // o Math.max não pode desfazer o Math.min aplicado acima.
    confidence = Math.max(confidence, regulatoryClass.import_counts_as_final ? ataConf : Math.min(ataConf, 0.72));
  }

  if (antt.ataItems?.length) {
    ata_items = antt.ataItems.map((item) => ({
      ...item,
      microtema: item.microtema && item.microtema !== "outros"
        ? item.microtema
        : classifyMicrotema([item.assunto, item.interessado, item.decisao].filter(Boolean).join(" "), agencia_sigla_detected).microtema,
      area_regulatoria: item.area_regulatoria ?? classifyAreaRegulatoria([item.assunto, item.interessado, item.decisao].filter(Boolean).join(" ")),
      // Etapa66 — esta atribuição SOBRESCREVE `ata_items` inteiro, e o parser dedicado da ANTT
      // nunca produz `juizo`: sem esta linha, TODA ata da ANTT perdia o juízo por item (coluna e
      // JSON), enquanto o ramo genérico logo acima o detecta por item desde a etapa54.
      juizo: (item as { juizo?: "admissibilidade" | null }).juizo ?? detectJuizo(item.decisao ?? ""),
    }));
    microtema = ata_items[0]?.microtema ?? microtema;
    area_regulatoria = (ata_items[0]?.area_regulatoria ?? area_regulatoria) as typeof area_regulatoria;
  }

  const mandateRoster = db && agencia_id_detected
    ? await getActiveDiretoresForVote(db, agencia_id_detected, fields.data_reuniao, diretoresList)
    : [];
  // Roster de PRESENTES lido do documento precede o mandato (espelha o confirm,
  // confirm/route.ts:453-466). Para a ANM — que não tem bloco "Constituição:" e às
  // vezes não tem mandato na data — é a ÚNICA fonte de roster para os votos_sugeridos;
  // sem isto o auto-confirm de ata reprovava "ata sem nenhum voto sugerido". QA Etapa 19.
  const presentesRoster: DiretorVoteRecord[] = [];
  if (diretoresList.length && Array.isArray(fields.nomes_presentes) && fields.nomes_presentes.length) {
    const vistos = new Set<string>();
    for (const nome of fields.nomes_presentes) {
      const m = findBestMatch(String(nome), diretoresList);
      if (m.diretorId && !m.needsReview && !vistos.has(m.diretorId)) {
        const dir = diretoresList.find((d) => d.id === m.diretorId);
        if (dir) { presentesRoster.push(dir); vistos.add(dir.id); }
      }
    }
  }
  const activeDiretoresList = presentesRoster.length > 0 ? presentesRoster : mandateRoster;
  const mainInferFromMandate = shouldInferVotesFromMandate({
    resultado: fields.resultado,
    tipo_documento,
    import_counts_as_final: regulatoryClass.import_counts_as_final,
    unanimidadeDetectada: fields.unanimidade_detectada,
    nomes: fields.nomes_votacao,
    nomesContra: fields.nomes_votacao_contra,
    nomesAbstencao: fields.nomes_votacao_abstencao,
    dataReuniao: fields.data_reuniao,
    // Fase 12 — SEM o cadastro, `hasNominalNames` degrada para `Boolean(nomes?.length)`:
    // qualquer nome extraído (signatário de rodapé, nome que não casa) desligava a inferência
    // E não gerava voto nominal — item unânime nascia com MENOS votos que o colegiado. E o
    // parcial é permanente: o backfill só repara deliberação com ZERO voto. O parâmetro
    // existia para exatamente isto (ver o docstring da função); só não era passado.
    diretoresList,
  });
  const mainVotosSugeridos = buildVoteSuggestions({
    nomes: fields.nomes_votacao,
    nomesContra: fields.nomes_votacao_contra,
    nomesAbstencao: fields.nomes_votacao_abstencao,
    nomesAusente: fields.nomes_votacao_ausente,
    nomesImpedido: fields.nomes_votacao_impedido,
    nomesEmAutos: votosEmAutos.map((v) => v.nome),
    diretoresList,
    activeDiretoresList,
    inferFromMandate: mainInferFromMandate,
    resultado: fields.resultado,
  });

  if (ata_items?.length) {
    ata_items = ata_items.map((item) => {
      const inferFromMandate = shouldInferVotesFromMandate({
        resultado: item.resultado,
        tipo_documento: "ata",
        import_counts_as_final: Boolean(item.resultado),
        unanimidadeDetectada: item.unanimidade_detectada,
        nomes: item.votos_detectados ?? [],
        nomesContra: item.votos_contra_detectados ?? [],
        nomesAbstencao: item.votos_abstencao_detectados ?? [],
        dataReuniao: fields.data_reuniao,
        // Fase 12 — o sítio mais grave dos dois: para ata da ANTT, `votos_detectados` são os
        // PRESENTES, então presentes não-vazios desligavam a inferência do item inteiro — e
        // `votos_sugeridos` não-vazio faz o confirm pular o fallback do roster do pai.
        diretoresList,
      });
      return {
        ...item,
        votos_sugeridos: buildVoteSuggestions({
          nomes: item.votos_detectados ?? [],
          nomesContra: item.votos_contra_detectados ?? [],
          nomesAbstencao: item.votos_abstencao_detectados ?? [],
          nomesAusente: item.votos_ausentes_detectados ?? [],
          nomesImpedido: item.votos_impedidos_detectados ?? [],
          nomesEmAutos: item.votos_em_autos_detectados ?? [],
          diretoresList,
          activeDiretoresList,
          inferFromMandate,
          resultado: item.resultado,
        }),
      };
    });
  }

  // C5: PDF provavelmente escaneado (baixa densidade de texto) → sinaliza e rebaixa
  // a confiança SEM descartar o registro (sem OCR ainda). O descarte total (text<50)
  // já foi tratado acima; aqui é o caso intermediário. Sem o guard pageCount>1, pega também o
  // escaneado de 1 página (que antes passava batido como baixa confiança comum). QA jul/2026, PR-M.
  if (extraction.charsPerPage > 0 && extraction.charsPerPage < SCANNED_CHARS_PER_PAGE_THRESHOLD) {
    const semOcr = isOcrConfigured()
      ? "escaneado e o OCR não recuperou texto suficiente"
      : "provável documento escaneado (OCR não configurado — defina OCR_SPACE_API_KEY)";
    documentWarnings.push(`PDF com baixa densidade de texto (${semOcr}) — revisar manualmente.`);
    confidence = Math.min(confidence, 0.1);
  } else if (extraction.ocrApplied) {
    documentWarnings.push("Texto recuperado via OCR externo — confira os campos extraídos.");
  }

  // ── Checagens de CONSISTÊNCIA (Etapa 12): a confiança soma campos PRESENTES; estas
  // flags detectam "extraiu, mas contraditório" — cada uma é warning de QUALIDADE
  // (rebaixa status e bloqueia auto-confirmação; o humano decide).
  {
    const favorSet = new Set(fields.nomes_votacao_favor ?? []);
    const contraditorios = (fields.nomes_votacao_contra ?? []).filter((n) => favorSet.has(n));
    if (contraditorios.length > 0) {
      // Remove dos dois lados: sem certeza da direção, nenhum voto automático.
      fields.nomes_votacao_favor = (fields.nomes_votacao_favor ?? []).filter((n) => !contraditorios.includes(n));
      fields.nomes_votacao_contra = (fields.nomes_votacao_contra ?? []).filter((n) => !contraditorios.includes(n));
      fields.nomes_votacao = (fields.nomes_votacao ?? []).filter((n) => !contraditorios.includes(n));
      documentWarnings.push(`Contradição: ${contraditorios.join(", ")} apareceu como favorável E contrário — votos removidos; revisar direção.`);
    }
    if (fields.unanimidade_detectada && ((fields.nomes_votacao_contra?.length ?? 0) > 0 || (fields.nomes_votacao_abstencao?.length ?? 0) > 0)) {
      documentWarnings.push("Inconsistência: texto indica unanimidade, mas há votos contrários/abstenções extraídos — revisar.");
    }
    // F (ago/2026): "unanimidade" DECLARADA + sinais de contestação SEM dissidente nomeado →
    // aviso (revisão), em vez de fabricar "unânime favorável". Não purga (mandato desfaria).
    const avisoContestado = avisoUnanimidadeContestada(
      extraction.text,
      !!fields.unanimidade_detectada,
      fields.nomes_votacao_contra?.length ?? 0,
    );
    if (avisoContestado) documentWarnings.push(avisoContestado);
    // Suíte da etapa63 no caminho do documento.
    achados.push(
      // C07 só vale para documento de ITEM ÚNICO. Numa ata multi-item, "unanimidade" vem de um
      // item e o voto contrário de OUTRO — não há contradição alguma, e checar no documento
      // inteiro bloqueava 4 das 6 atas da ANM. A contradição real é dentro do mesmo item.
      ...((ata_items?.length ?? 0) > 1 ? [] : checarCoerenciaUnanimidade({
        unanimidade: !!fields.unanimidade_detectada,
        votosContra: fields.nomes_votacao_contra?.length ?? 0,
        votosAbstencao: fields.nomes_votacao_abstencao?.length ?? 0,
      })),
      // C16 alimentado pelos VOTOS SUGERIDOS, não pelos baldes de `extractFields`: a etapa50
      // REMOVE o impedido daqueles baldes antes de devolvê-los, então comparar contra eles nunca
      // acharia conflito — o check existiria e jamais dispararia. O conflito que interessa é o
      // que sobrevive até a linha de voto, depois do casamento com o cadastro.
      ...checarImpedidoComVoto({
        impedidos: fields.nomes_votacao_impedido ?? [],
        diretoresQueVotaram: mainVotosSugeridos
          .filter((v) => v.tipo_voto !== "Ausente")
          .map((v) => v.nome),
      }),
      ...checarAdmissibilidadeMalClassificada({
        juizo: fields.juizo, resultado: fields.resultado, texto: extraction.text,
      }),
      ...checarLigaduraResidual(probeLigatureDefects(extraction.text).lemasQuebrados),
      // C17/C18 (etapa65) — VALIDAÇÃO CRUZADA DE DATA. `data_reuniao` escolhe o roster em
      // `getActiveDiretoresForVote`: data errada não perde voto, infere voto para os diretores
      // ERRADOS. Ambos puros, e medidos contra as 16 fixtures com ZERO bloqueio antes de virarem
      // bloqueantes — os dois pegam sozinhos o bug real (ata de 25/03/2026 lida como 02/05/2022).
      ...checarDataAnteriorAoProcesso({ dataReuniao: fields.data_reuniao, texto: extraction.text }),
      ...checarAnoProtocoloDaAta({ dataReuniao: fields.data_reuniao, protocoloSei: extraction.protocoloSei }),
      // C20 (Fase 9) — a data cabe na EXISTÊNCIA da agência? É o terceiro sinal sobre
      // `data_reuniao`, e o único que conhece a agência. Produção tinha 38 deliberações da ANM
      // datadas de antes de 2017, sendo 32 de 1996 numa única "reunião": a data vinha de
      // "Lei nº 9.314, de 14 de novembro de 1996", citada no preâmbulo.
      //
      // BLOQUEANTE, e não anulação do campo, por duas razões. Anular destrói a evidência de que o
      // revisor precisa ("o parser leu 1996") — e, pior, converte "data errada" em "sem data", que
      // `year-filter` conta em TODOS os anos: trocaria um erro contido por um espalhado. O nível
      // bloqueante já percorre os dois gates sem código novo (auto-confirm recusa; confirm exige
      // `override_motivo`).
      ...(() => {
        const p = dataReuniaoPlausivel(agencia_sigla_detected, fields.data_reuniao);
        return p.plausivel ? [] : [{
          codigo: "C20_DATA_FORA_DA_EXISTENCIA_DA_AGENCIA",
          nivel: "bloqueante" as const,
          mensagem: `Data da reunião (${fields.data_reuniao}) incompatível: ${p.motivo}.`,
        }];
      })(),
      // C05/C06 e C08/C09 estavam DEFINIDOS e TESTADOS mas nunca chamados — código morto com
      // teste, que é pior que código morto sem: sugere cobertura que não existe.
      // Cardinalidade também é por ITEM: numa ata os nomes são a união de todos os itens e
      // excedem o colegiado por construção.
      ...((ata_items?.length ?? 0) > 1 ? [] : checarCardinalidadeVotos({
        votos: (fields.nomes_votacao_favor?.length ?? 0)
          + (fields.nomes_votacao_contra?.length ?? 0)
          + (fields.nomes_votacao_abstencao?.length ?? 0),
        cadeiras: (fields.nomes_presentes?.length ?? 0) || null,
        decidido: Boolean(fields.resultado) && fields.resultado !== "Retirado de Pauta",
      })),
      ...checarVotoQualidadeDuplo({
        votoQualidadePor: fields.voto_qualidade_por,
        diretoresComVoto: [...(fields.nomes_votacao_favor ?? []), ...(fields.nomes_votacao_contra ?? [])],
      }),
      ...checarInteressadoNoDispositivo({
        interessado: fields.interessado,
        dispositivo: fields.fundamento_decisao ?? fields.resumo_pleito,
      }),
    );
    // (Fase 9 — o aviso de piso fixo 2020 que existia aqui foi SUBSTITUÍDO pelo achado C20, que
    // conhece a agência e é bloqueante. Manter os dois seria ter dois sinais sobre a mesma coisa,
    // um deles inerte — o padrão que este projeto já combateu em outras telas. O antigo reprovava
    // qualquer data anterior a 2020 sem saber de que órgão era o documento, e por ser apenas
    // `documentWarnings.push` não anulava o campo nem impedia o confirm manual: em produção ele
    // esteve ligado o tempo todo e as 38 linhas erradas passaram assim mesmo.)
    const presentes = fields.nomes_presentes ?? [];
    if (presentes.length > 0 && (fields.nomes_votacao?.length ?? 0) > presentes.length) {
      documentWarnings.push(`Mais votantes (${fields.nomes_votacao?.length}) que presentes declarados (${presentes.length}) — revisar presença/votos.`);
    }
    for (const item of ata_items ?? []) {
      const itemVotes = (item.votos_detectados?.length ?? 0) + (item.votos_contra_detectados?.length ?? 0);
      if (itemVotes > 0 && !item.resultado) {
        documentWarnings.push(`Item ${item.item_numero}: votos extraídos sem resultado — revisar antes de confirmar.`);
      }
      // Propaga avisos do splitter (ex.: possível sangria de itens).
      for (const w of (item as { warnings?: string[] }).warnings ?? []) documentWarnings.push(w);
    }
  }

  // Achados da suíte (etapa63) entram nos avisos do documento com nível e código visíveis. O
  // formato `[BLOQUEANTE·C07_…]` é o que o revisor lê — sem o código ele não sabe o que conferir.
  const bloqueado = temBloqueio(achados);
  documentWarnings.push(...formatarAchados(achados));

  const warnings = documentWarnings;
  // C3: status ignora avisos informativos (ex.: "documento tratado como pauta/ata
  // revisável") — só avisos de QUALIDADE rebaixam para low_confidence.
  const qualityWarnings = warnings.filter((w) => !INFO_WARNING_RE.test(w));
  const semantic_duplicate_key = antt.raw.dedupe_semantic_key
    ? String(antt.raw.dedupe_semantic_key)
    : regulatoryClass.semantic_duplicate_key;

  return {
    filename: file.name,
    source_archive: file.source_archive ?? null,
    status: confidence >= 0.5 && qualityWarnings.length === 0 ? "ok" : "low_confidence",
    fields: {
      numero_deliberacao: fields.numero_deliberacao,
      numero_reuniao: fields.numero_reuniao,
      reuniao_ordinaria: fields.reuniao_ordinaria,
      tipo_reuniao: fields.tipo_reuniao,
      tipo_documento,
      data_reuniao: fields.data_reuniao,
      data_publicacao: fields.data_publicacao,
      interessado: fields.interessado,
      assunto: fields.assunto,
      procedencia: fields.procedencia,
      relator: (fields as { relator?: string | null }).relator ?? null,
      item_numero: (fields as { item_numero?: string | null }).item_numero ?? null,
      processo: fields.processo,
      resultado: fields.resultado,
      // Juízo do dispositivo (etapa54): "admissibilidade" sai dos DOIS lados da taxa de
      // deferimento na etapa60. Vive no JSON até a coluna existir — o CHECK de `resultado`
      // não comporta valor novo e o código tem de degradar sem a migration.
      juizo: fields.juizo,
      decisoes_todas: fields.decisoes_todas,
      microtema,
      area_regulatoria: (fields as { area_regulatoria?: string }).area_regulatoria ?? area_regulatoria,
      pauta_interna,
      resumo_pleito: fields.resumo_pleito,
      fundamento_decisao: fields.fundamento_decisao,
      diretores_detectados: fields.diretores_detectados,
      nomes_votacao: fields.nomes_votacao,
      nomes_votacao_contra: fields.nomes_votacao_contra,
      nomes_votacao_abstencao: fields.nomes_votacao_abstencao,
      nomes_votacao_ausente: fields.nomes_votacao_ausente,
      nomes_votacao_impedido: fields.nomes_votacao_impedido,
      nomes_presentes: fields.nomes_presentes,
      votos_sugeridos: mainVotosSugeridos,
    },
    confidence,
    page_count: extraction.pageCount,
    chars_per_page: extraction.charsPerPage,
    file_hash,
    is_duplicate: is_duplicate || semantic_duplicate,
    duplicate_job_id,
    agencia_id_detected,
    agencia_sigla_detected,
    documento_subtipo: regulatoryClass.documento_subtipo,
    import_counts_as_final: regulatoryClass.import_counts_as_final,
    semantic_duplicate_key,
    warnings,
    // Etapa63: o confirm RECUSA um documento bloqueado, salvo `override_motivo` explícito do
    // revisor. O override é parte do desenho — quem vê o documento sabe coisas que o parser não
    // sabe; o que não pode é essa decisão ser invisível.
    ...(bloqueado ? { bloqueado: true, achados_bloqueantes: achados.filter((a) => a.nivel === "bloqueante").map((a) => a.codigo) } : {}),
    ...(antt.isAntt ? { documento_antt_tipo: antt.documentType, warnings } : {}),
    ...(ata_items ? { ata_items } : {}),
    extraction_raw: {
      numero_deliberacao: fields.numero_deliberacao,
      reuniao_ordinaria: fields.reuniao_ordinaria,
      numero_reuniao: fields.numero_reuniao,
      tipo_reuniao: fields.tipo_reuniao,
      data_reuniao: fields.data_reuniao,
      interessado: fields.interessado,
      procedencia: fields.procedencia,
      processo: fields.processo,
      assunto: fields.assunto,
      resultado: fields.resultado,
      // Juízo do dispositivo (etapa54): "admissibilidade" sai dos DOIS lados da taxa de
      // deferimento na etapa60. Vive no JSON até a coluna existir — o CHECK de `resultado`
      // não comporta valor novo e o código tem de degradar sem a migration.
      juizo: fields.juizo,
      decisoes_todas: fields.decisoes_todas,
      microtema,
      area_regulatoria: (fields as { area_regulatoria?: string }).area_regulatoria ?? area_regulatoria,
      pauta_interna,
      resumo_pleito: fields.resumo_pleito,
      fundamento_decisao: fields.fundamento_decisao,
      diretores_detectados: fields.diretores_detectados,
      nomes_votacao: fields.nomes_votacao,
      nomes_votacao_favor: fields.nomes_votacao_favor,
      nomes_votacao_contra: fields.nomes_votacao_contra,
      nomes_votacao_abstencao: fields.nomes_votacao_abstencao,
      nomes_votacao_ausente: fields.nomes_votacao_ausente,
      // `impedimentos` é a chave DURÁVEL do motivo: a linha do voto vira "Ausente" (o CHECK não
      // comporta valor novo), e é daqui que a etapa59 promoverá `motivo_nao_voto='impedimento'`.
      impedimentos: fields.nomes_votacao_impedido,
      // Retirada de pauta/reunião (etapa56): QUEM retirou e COM QUE BASE. É o que separa uma
      // retirada regimental de uma sem justificativa — e nada disso era guardado.
      ...(retirada ? { retirada } : {}),
      // Voto em AUTOS (etapa57): proferido em sessão ANTERIOR e só REGISTRADO aqui. Continua
      // ligado à deliberação — é ele que forma a maioria — mas não é presença nesta sessão, e é
      // esta lista que impede o alarme de "voto fora do mandato" de disparar em toda ata com
      // voto vista. A coluna `voto_em_autos` chega na etapa59; até lá, vive no JSON.
      ...(votosEmAutos.length ? { votos_em_autos: votosEmAutos } : {}),
      // Dedup intra-ata (etapa53). `itens_pre_dedup` é o número que a reconciliação de âncoras
      // (etapa63) compara: comparar contra o pós-dedup transformaria uma dedup CORRETA em alarme
      // permanente. `duplicatas_removidas` é informativo e fica registrado, nunca silencioso.
      ...(ataItemStats ? ataItemStats : {}),
      nomes_presentes: fields.nomes_presentes,
      votos_sugeridos: mainVotosSugeridos,
      signatarios: fields.signatarios,
      unanimidade_detectada: fields.unanimidade_detectada,
      confidence,
      page_count: extraction.pageCount,
      chars_per_page: extraction.charsPerPage,
      // Fase 7 — COMO o texto foi lido. Isto era calculado (para rebaixar a confiança e emitir
      // warning) e descartado logo em seguida; sem ele não dá para responder "de onde veio este
      // campo" numa auditoria, porque texto de OCR erra de um jeito diferente do texto nativo.
      extracao_metodo: extraction.ocrApplied ? "ocr" : "pdf-parse",
      agencia_sigla_detected,
      source_archive: file.source_archive ?? null,
      documento_subtipo: regulatoryClass.documento_subtipo,
      import_counts_as_final: regulatoryClass.import_counts_as_final,
      semantic_duplicate,
      semantic_duplicate_key,
      warnings,
      raw_text: extraction.text.slice(0, 50000),
      ...(antt.isAntt ? {
        antt: antt.raw,
        documento_antt_tipo: antt.documentType,
      } : {}),
    },
  };
}

export function markBatchDuplicates(results: PreviewResult[]) {
  const byHash = new Map<string, PreviewResult[]>();
  const bySemantic = new Map<string, PreviewResult[]>();

  for (const result of results) {
    if (result.status === "error") continue;
    if (result.file_hash) {
      const items = byHash.get(result.file_hash) ?? [];
      items.push(result);
      byHash.set(result.file_hash, items);
    }
    const semanticKey = result.semantic_duplicate_key ?? result.extraction_raw?.semantic_duplicate_key;
    if (typeof semanticKey === "string" && semanticKey.length > 8) {
      const items = bySemantic.get(semanticKey) ?? [];
      items.push(result);
      bySemantic.set(semanticKey, items);
    }
  }

  for (const items of byHash.values()) {
    if (items.length <= 1) continue;
    items.forEach((item, index) => {
      if (index === 0) return;
      item.is_duplicate = true;
      item.duplicate_reason = `Duplicata binaria no lote: igual a ${items[0].filename}`;
    });
  }

  for (const items of bySemantic.values()) {
    if (items.length <= 1) continue;
    items.forEach((item, index) => {
      if (index === 0 || item.is_duplicate) return;
      item.is_duplicate = true;
      item.duplicate_reason = `Possivel duplicata semantica no lote: mesmo numero/processo de ${items[0].filename}`;
    });
  }
}

export function errorResult(filename: string, file_hash = ""): PreviewResult {
  return {
    filename,
    status: "error",
    fields: {
      numero_deliberacao: null,
      numero_reuniao: null,
      reuniao_ordinaria: null,
      tipo_reuniao: null,
      tipo_documento: "documento_apoio",
      data_reuniao: null,
      data_publicacao: null,
      interessado: null,
      assunto: null,
      procedencia: null,
      relator: null,
      item_numero: null,
      processo: null,
      resultado: null,
      decisoes_todas: [],
      microtema: "outros",
      area_regulatoria: "outros",
      pauta_interna: false,
      resumo_pleito: null,
      fundamento_decisao: null,
      diretores_detectados: [],
      nomes_votacao: [],
      nomes_votacao_contra: [],
      nomes_votacao_abstencao: [],
      nomes_votacao_ausente: [],
      nomes_votacao_impedido: [],
      votos_sugeridos: [],
    },
    confidence: 0,
    page_count: 0,
    chars_per_page: 0,
    file_hash,
    is_duplicate: false,
    duplicate_job_id: null,
    agencia_id_detected: null,
    agencia_sigla_detected: null,
    import_counts_as_final: false,
  };
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

function calcAtaPreviewConfidence(input: {
  numero_reuniao: string | null;
  tipo_reuniao: string | null;
  data_reuniao: string | null;
  agencia_sigla_detected: string | null;
  ata_items: NonNullable<PreviewResult["ata_items"]>;
}): number {
  const itemCount = input.ata_items.length;
  const withProcess = input.ata_items.filter((item) => item.processo).length;
  const withSubject = input.ata_items.filter((item) => item.assunto).length;
  const withInterested = input.ata_items.filter((item) => item.interessado).length;
  const itemQuality = itemCount > 0
    ? Math.min(0.35, ((withProcess + withSubject + withInterested) / (itemCount * 3)) * 0.35)
    : 0;

  return [
    input.numero_reuniao ? 0.18 : 0,
    input.tipo_reuniao ? 0.08 : 0,
    input.data_reuniao ? 0.14 : 0,
    input.agencia_sigla_detected ? 0.10 : 0,
    itemCount > 0 ? 0.15 : 0,
    itemQuality,
  ].reduce((sum, value) => sum + value, 0);
}

let anttInitialsCacheAt = 0;
async function refreshAnttDynamicInitials(db: any | null | undefined, agencias: UploadAnalysisAgency[]) {
  if (!db) return;
  const agora = Date.now();
  if (agora - anttInitialsCacheAt < 10 * 60 * 1000) return;
  const antt = agencias.find((a) => a.sigla === "ANTT");
  if (!antt?.id) return;
  try {
    const lista = await getDiretoresList(db, antt.id);
    setAnttDynamicInitials(buildAnttDirectorInitials(lista));
    setAnttCargoMandatos(await buildAnttCargoMandatos(db, antt.id));
    anttInitialsCacheAt = agora;
  } catch { /* fica no mapa curado */ }
}

/**
 * Mandatos por CARGO (etapa55) — último recurso para resolver "Voto DG", que identifica a FUNÇÃO
 * e não a pessoa. Aplica os mesmos filtros antirrecontaminação do roster de votos: mandato
 * FABRICADO (`fonte_dado='automatico'`, derivado de voto) nunca vira base para atribuir mais voto,
 * e diretor não aprovado não entra. Sem eles, um voto mal-atribuído geraria o mandato que
 * confirmaria a própria má atribuição.
 */
async function buildAnttCargoMandatos(db: any, agenciaId: string): Promise<Record<string, AnttCargoMandato[]>> {
  const { data, error } = await db
    .from("mandatos")
    .select("cargo, data_inicio, data_fim, fonte_dado, diretores!inner(nome, agencia_id, review_status)")
    .eq("diretores.agencia_id", agenciaId)
    .eq("diretores.review_status", "aprovado")
    .neq("fonte_dado", "automatico");
  if (error || !data) return {};
  const mapa: Record<string, AnttCargoMandato[]> = {};
  for (const row of data as any[]) {
    const cargo = String(row.cargo ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    const nome = row.diretores?.nome;
    if (!cargo || !nome || !row.data_inicio) continue;
    (mapa[cargo] ??= []).push({ nome, inicio: row.data_inicio, fim: row.data_fim ?? null });
  }
  return mapa;
}

async function getDiretoresList(db: any | null | undefined, agenciaId: string | null): Promise<DiretorVoteRecord[]> {
  if (!db || !agenciaId) return [];
  const { data } = await db
    .from("diretores")
    .select("id, nome, nome_variantes")
    .eq("review_status", "aprovado") // antirrecontaminação (ago/2026): rejeitado não casa
    .eq("agencia_id", agenciaId);

  return (data ?? []).map((dir: any) => ({
    id: dir.id,
    nome: dir.nome,
    nome_variantes: Array.isArray(dir.nome_variantes) ? dir.nome_variantes : [],
  }));
}
