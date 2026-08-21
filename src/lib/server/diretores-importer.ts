/**
 * Importador genérico de diretores: busca a página oficial de diretoria
 * (agencias.url_diretores), extrai nomes candidatos e grava em `diretor_candidatos`
 * para revisão humana (nunca cria diretor direto). Best-effort + seguro (SSRF guard).
 */

import crypto from "crypto";
import { resilientFetchText } from "@/lib/server/resilient-fetch";
import { isPublicUrl } from "@/lib/server/url-guard";
import { findBestMatch, normalizeName, isStrictPersonName } from "@/lib/server/name-matcher";

// Padrões conservadores de nome de diretor em páginas institucionais.
const RE_CARGO_NOME =
  /(Diretor(?:a)?(?:[- ]Presidente|[- ]Geral|[- ]Substitut[oa])?)\s*[:–-]?\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][a-záéíóúâêôãõçàü]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][a-záéíóúâêôãõçàü]+){1,4})/g;
const RE_NOME_CARGO =
  /([A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][a-záéíóúâêôãõçàü]+(?:\s+(?:d[aeo]s?\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇÀÜ][a-záéíóúâêôãõçàü]+){1,4})\s*[–-]\s*Diretor(?:a)?/g;

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

export interface ImportDiretoresResult {
  status: "ok" | "sem_url" | "url_invalida" | "falha_coleta" | "sem_nomes";
  candidatos: number;
  nomes_detectados: string[];
  message?: string;
}

export async function importDiretoresFromUrl(
  db: any,
  agencia: { id: string; sigla: string; url_diretores?: string | null },
): Promise<ImportDiretoresResult> {
  const url = agencia.url_diretores?.trim();
  if (!url) return { status: "sem_url", candidatos: 0, nomes_detectados: [], message: "Agência sem url_diretores cadastrada" };
  if (!isPublicUrl(url)) return { status: "url_invalida", candidatos: 0, nomes_detectados: [], message: "url_diretores inválida ou interna" };

  let text: string;
  try {
    const html = await resilientFetchText(url, { timeoutMs: 15_000 });
    text = stripTags(html);
  } catch (e) {
    return { status: "falha_coleta", candidatos: 0, nomes_detectados: [], message: e instanceof Error ? e.message : "falha ao coletar" };
  }

  const nomes = new Set<string>();
  for (const re of [RE_CARGO_NOME, RE_NOME_CARGO]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const bruto = String(re === RE_CARGO_NOME ? m[2] : m[1]).replace(/\s+/g, " ").trim();
      // Validação estrita ANTES do Title-Case (QA ago/2026: prosa capitalizada não vira candidato).
      if (!isStrictPersonName(bruto)) continue;
      const nome = normalizeName(bruto);
      if (nome.split(" ").length >= 2 && nome.length <= 80) nomes.add(nome);
    }
  }
  const nomesDetectados = [...nomes];
  if (nomesDetectados.length === 0) {
    return { status: "sem_nomes", candidatos: 0, nomes_detectados: [], message: "Nenhum nome de diretor reconhecido na página" };
  }

  // Diretores já cadastrados da agência (para evitar candidatos duplicados de quem já existe).
  const { data: diretores } = await db
    .from("diretores")
    .select("id, nome, nome_variantes")
    .eq("review_status", "aprovado")
    .eq("agencia_id", agencia.id);
  const diretoresList = (diretores ?? []).map((d: any) => ({
    id: d.id, nome: d.nome, nome_variantes: Array.isArray(d.nome_variantes) ? d.nome_variantes : [],
  }));

  // Dedup por (agencia_id, nome_detectado): já existe um candidato PENDENTE com
  // esse nome? Não cria um cartão paralelo (a unique real inclui source_hash, que
  // muda se a URL da página mudar — sem este filtro, reimportar duplicaria cartão).
  const { data: pendentes } = await db
    .from("diretor_candidatos")
    .select("nome_detectado")
    .eq("agencia_id", agencia.id)
    .eq("review_status", "pendente")
    .in("nome_detectado", nomesDetectados);
  const jaPendentes = new Set((pendentes ?? []).map((p: { nome_detectado: string }) => p.nome_detectado));

  const sourceHash = crypto.createHash("sha256").update(`${agencia.id}|${url}`).digest("hex");
  const rows = nomesDetectados
    .map((nome) => {
      if (jaPendentes.has(nome)) return null; // já há cartão pendente para este nome
      const match = findBestMatch(nome, diretoresList);
      // Já existe com alta confiança → não recria candidato.
      if (!match.needsReview && !match.isNew) return null;
      return {
        agencia_id: agencia.id,
        nome_detectado: nome,
        cargo_detectado: null,
        diretor_id: match.diretorId,
        source_type: "pagina_agencia" as const,
        source_url: url,
        source_hash: crypto.createHash("sha256").update(`${sourceHash}|${nome}`).digest("hex"),
        confidence: Math.max(0.35, Math.min(match.score || 0.5, 0.9)),
        review_status: "pendente" as const,
        evidence: {
          importador: "diretores-importer",
          source_url: url,
          match_score: match.score,
          lgpd_note: "Somente nome e função pública; sem CPF, contato ou endereço.",
        },
      };
    })
    .filter(Boolean);

  if (rows.length === 0) {
    return { status: "ok", candidatos: 0, nomes_detectados: nomesDetectados, message: "Todos os nomes já correspondem a diretores cadastrados" };
  }

  await db.from("diretor_candidatos").upsert(rows, {
    onConflict: "agencia_id,nome_detectado,source_hash",
    ignoreDuplicates: true,
  });

  return { status: "ok", candidatos: rows.length, nomes_detectados: nomesDetectados };
}
