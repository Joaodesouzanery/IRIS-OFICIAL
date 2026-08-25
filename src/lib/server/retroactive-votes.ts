/**
 * Votos retroativos: ao aprovar um diretor_candidato (match de baixa confiança que
 * o pipeline havia descartado), localiza as deliberações onde aquele nome aparece e
 * cria os votos faltantes — reusando a mesma classificação de `buildVotoRows`.
 */

import { findBestMatch } from "@/lib/server/name-matcher";
import { upsertVotosProtegido } from "@/lib/server/votos-write";
import {
  buildVotoRows,
  getActiveDiretoresForVote,
  isFinalVoteDocument,
  type DiretorVoteRecord,
  type VotoInsertRow,
} from "@/lib/server/vote-inference";

function arr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export interface CandidateDeliberacao {
  id: string;
  data_reuniao: string | null;
  numero_deliberacao: string | null;
  resultado: string | null;
  nomes: string[];
  nomesContra: string[];
  nomesAusente: string[];
  nomesAbstencao: string[];
  nomesImpedido: string[];
  /** Nomes com voto proferido em sessão ANTERIOR (etapa57). */
  nomesEmAutos: string[];
}

/**
 * Deliberações finais da agência cujo `raw_extraction` contém um nome que casa
 * (alta confiança) com `nome` — i.e., onde o diretor recém-aprovado deveria ter voto.
 */
export async function findDeliberacoesForCandidate(
  db: any,
  { agenciaId, nome }: { agenciaId: string; nome: string },
): Promise<CandidateDeliberacao[]> {
  const probe: DiretorVoteRecord = { id: "candidato", nome, nome_variantes: [] };
  const { data, error } = await db
    .from("deliberacoes")
    .select("id, data_reuniao, numero_deliberacao, resultado, tipo_documento, raw_extraction")
    .eq("agencia_id", agenciaId)
    .limit(2000);
  if (error || !data) return [];

  const matched: CandidateDeliberacao[] = [];
  for (const d of data as any[]) {
    if (!isFinalVoteDocument({ tipo_documento: d.tipo_documento })) continue;
    const raw = (d.raw_extraction ?? {}) as Record<string, unknown>;
    const nomes = arr(raw.nomes_votacao);
    const nomesContra = arr(raw.nomes_votacao_contra);
    const nomesAusente = arr(raw.nomes_votacao_ausente);
    const nomesAbstencao = arr(raw.nomes_votacao_abstencao);
    // O impedido foi removido de TODOS os outros baldes na extração; sem lê-lo aqui ele
    // simplesmente não teria linha. Ele entra para ser gravado como "Ausente" nominal — o
    // não-voto declarado pela ata é dado real, não lacuna.
    const nomesImpedido = arr(raw.impedimentos).length
      ? arr(raw.impedimentos)
      : arr(raw.nomes_votacao_impedido);
    // `votos_em_autos` é [{nome, sessao}] — só os nomes interessam aqui.
    const nomesEmAutos = Array.isArray(raw.votos_em_autos)
      ? (raw.votos_em_autos as Array<{ nome?: unknown }>)
          .map((v) => (typeof v?.nome === "string" ? v.nome : ""))
          .filter(Boolean)
      : [];
    // `nomesEmAutos` entra na busca: o ex-diretor cujo voto foi proferido em sessão anterior pode
    // aparecer SÓ como "então Diretor X" — sem ele aqui, a deliberação nem seria encontrada e a
    // exceção de mandato logo abaixo nunca teria chance de valer.
    const todos = [...nomes, ...nomesContra, ...nomesAusente, ...nomesAbstencao, ...nomesImpedido, ...nomesEmAutos];
    if (todos.length === 0) continue;
    const hit = todos.some((n) => {
      const m = findBestMatch(n, [probe]);
      return m.diretorId && !m.needsReview;
    });
    if (!hit) continue;
    matched.push({
      id: d.id,
      data_reuniao: d.data_reuniao,
      numero_deliberacao: d.numero_deliberacao,
      resultado: d.resultado,
      nomes, nomesContra, nomesAusente, nomesAbstencao, nomesImpedido, nomesEmAutos,
    });
  }
  return matched;
}

export interface RetroactiveVotesResult {
  deliberacoes: number;
  criados: number;
  ignorados_fora_mandato: number;
  /** 1ª data_reuniao em que o nome aparece — base do mandato automático. */
  primeira_data: string | null;
  /** Mensagens de falha do upsert, quando houve (etapa58). */
  falhas?: string[];
}

/**
 * Cria os votos retroativos do diretor recém-aprovado e grava auditoria.
 * Idempotente (upsert onConflict deliberacao_id,diretor_id). Pula deliberações
 * cuja data está fora do mandato conhecido do diretor.
 */
export async function applyRetroactiveVotes(
  db: any,
  { candidato, diretorId, reviewedBy, confiancaMatch }: {
    candidato: { id: string; agencia_id: string; nome_detectado: string };
    diretorId: string;
    reviewedBy: string | null;
    /** Etapa67 — resolução automática SEM margem: o score fica carimbado em cada voto criado. */
    confiancaMatch?: number | null;
  },
): Promise<RetroactiveVotesResult> {
  const thisDir: DiretorVoteRecord = { id: diretorId, nome: candidato.nome_detectado, nome_variantes: [] };
  const delibs = await findDeliberacoesForCandidate(db, {
    agenciaId: candidato.agencia_id,
    nome: candidato.nome_detectado,
  });

  let ignorados = 0;
  const allRows: VotoInsertRow[] = [];

  for (const del of delibs) {
    // Checagem de mandato: se há mandatos reais na data e o diretor não está entre
    // eles, pula. Sem NENHUM mandato na data (active vazio — caso típico do diretor
    // recém-aprovado, que ainda não tem mandato), não dá para excluir → grava.
    // (QA ago/2026: o guard antigo exigia "estar no active", que sem mandato era [],
    // e pulava TUDO — aprovar candidato nunca criava voto retroativo.)
    // VOTO EM AUTOS (etapa57) neutraliza essa checagem: o voto foi proferido em sessão ANTERIOR e
    // esta ata apenas o registra. A data da deliberação é a da sessão de REGISTRO, fora do mandato
    // do diretor — mas o voto é real e foi dado dentro dele. Sem esta exceção, todo ex-diretor com
    // voto vista era descartado aqui, silenciosamente, como se nunca tivesse votado.
    const emAutos = del.nomesEmAutos.some((n) => {
      const m = findBestMatch(n, [thisDir]);
      return m.diretorId && !m.needsReview;
    });
    if (!emAutos) {
      const active = await getActiveDiretoresForVote(db, candidato.agencia_id, del.data_reuniao, [thisDir]);
      const inActive = active.some((d) => d.id === diretorId);
      if (active.length > 0 && !inActive) { ignorados++; continue; }
    }

    const rows = buildVotoRows({
      deliberacao_id: del.id,
      nomes: del.nomes,
      nomesContra: del.nomesContra,
      nomesAusente: del.nomesAusente,
      nomesAbstencao: del.nomesAbstencao,
      nomesImpedido: del.nomesImpedido,
      diretoresList: [thisDir],
      activeDiretoresList: [],
      inferFromMandate: false,
    });
    // Etapa67 — carimbo de baixa certeza do auto-resolver (só quando informado).
    if (confiancaMatch != null) {
      for (const r of rows) r.confianca_match = Math.round(confiancaMatch * 1000) / 1000;
    }
    allRows.push(...rows);
  }

  let criados = 0;
  const falhas: string[] = [];
  if (allRows.length > 0) {
    // Lotes de 200 para caber no orçamento da função.
    for (let i = 0; i < allRows.length; i += 200) {
      const batch = allRows.slice(i, i + 200);
      // Etapa58: passa pelo write-path COMPARTILHADO. Antes era upsert cru — sem a proteção do
      // voto nominal, o backfill podia REBAIXAR para inferido um voto lido do documento, e sem a
      // sonda de capacidade quebraria ao gravar `proveniencia` antes da migration.
      const r = await upsertVotosProtegido(db, batch);
      if (r.error) {
        falhas.push(r.error.message);
        console.error("[retroactive-votes] upsert falhou:", r.error.code, r.error.message);
      } else {
        criados += r.gravados;
      }
    }
  }

  await db.from("votos_retroativos_audit").insert({
    candidato_id: candidato.id,
    diretor_id: diretorId,
    agencia_id: candidato.agencia_id,
    nome_detectado: candidato.nome_detectado,
    deliberacoes_afetadas: delibs.length,
    votos_criados: criados,
    votos_ignorados_fora_mandato: ignorados,
    reviewed_by: reviewedBy,
  });

  const primeiraData = delibs
    .map((d) => d.data_reuniao)
    .filter((d): d is string => typeof d === "string" && d.length >= 10)
    .sort()[0] ?? null;

  return {
    deliberacoes: delibs.length,
    criados,
    ignorados_fora_mandato: ignorados,
    primeira_data: primeiraData,
    // O erro deixa de morrer no console: quem chamou precisa poder dizer ao usuário que o
    // backfill NÃO gravou (etapa58).
    ...(falhas.length ? { falhas } : {}),
  };
}
