import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/server/is-demo";
import { requireAdmin } from "@/lib/server/request-guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCuratedAgenciaImport, mandatoPercentual } from "@/lib/server/agencias-curated-import";
import { findBestMatch } from "@/lib/server/name-matcher";

export async function POST(
  req: NextRequest,
  { params }: any
) {
  const guard = await requireAdmin(req);
  if (guard) return guard;
  if (isDemo()) return NextResponse.json({ error: "Importação indisponível em modo demo" }, { status: 403 });

  const db = createSupabaseServerClient();
  const { data: agencia, error: agenciaError } = await db
    .from("agencias")
    .select("*")
    .eq("id", params.id)
    .single();

  if (agenciaError || !agencia) {
    return NextResponse.json({ error: "Agência não encontrada" }, { status: 404 });
  }

  const curated = getCuratedAgenciaImport(agencia.sigla);
  if (!curated) {
    // Sem pacote curado: tenta importar diretores genericamente da página oficial
    // (url_diretores) para a fila de revisão (diretor_candidatos).
    if (agencia.url_diretores) {
      const { importDiretoresFromUrl } = await import("@/lib/server/diretores-importer");
      const result = await importDiretoresFromUrl(db, agencia);
      const ok = result.status === "ok";
      return NextResponse.json({
        modo: "importacao_generica",
        ...result,
        message: ok
          ? `${result.candidatos} candidato(s) de diretor enviados para revisão. Aprove em Votos dos Diretores → Matches pendentes.`
          : (result.message ?? "Não foi possível importar diretores automaticamente."),
      }, { status: ok ? 200 : 422 });
    }
    return NextResponse.json({
      error: "Sem pacote curado e sem url_diretores cadastrada. Cadastre a URL de diretores ou edite manualmente.",
      supported: ["ANTT", "ANM", "ARTESP"],
    }, { status: 422 });
  }

  await db
    .from("agencias")
    .update({
      nome: curated.nome,
      nome_completo: curated.nome_completo,
      tipo: curated.tipo,
      esfera: curated.esfera,
      ministerio_vinculado: curated.ministerio_vinculado,
      url_institucional: curated.url_institucional,
      url_diretores: curated.url_diretores,
      estado: curated.estado,
      status: "ativa",
      ativo: true,
      dados_importados_em: new Date().toISOString(),
      metadata: {
        ...(agencia.metadata ?? {}),
        alertas: curated.alertas,
        fontes: curated.fontes,
        importador: "curadoria_codex_iris",
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id);

  const savedDiretores: Array<{ id: string; nome: string; status: string }> = [];
  for (const diretor of curated.diretores) {
    const percentual = mandatoPercentual(diretor.data_posse, diretor.data_fim_mandato);
    const payload = {
      agencia_id: params.id,
      nome: diretor.nome,
      cargo: diretor.cargo,
      situacao: diretor.situacao,
      ativo: diretor.situacao !== "inativo",
      data_posse: diretor.data_posse,
      data_fim_mandato: diretor.data_fim_mandato,
      ato_nomeacao: diretor.ato_nomeacao ?? null,
      publicacao_dou: diretor.publicacao_dou ?? null,
      minibio: diretor.minibio ?? null,
      percentual_mandato_concluido: percentual,
      fonte_dado: "verificado",
      importado_em: new Date().toISOString(),
      metadata: {
        fonte_url: diretor.fonte_url,
        importador: "curadoria_codex_iris",
      },
      updated_at: new Date().toISOString(),
    };

    // Dedup FUZZY (não só ILIKE exato): "José Fernando Gomes Júnior" e "José
    // Fernando de Mendonça Gomes Júnior", ou variações de acento, são o MESMO
    // diretor. Sem isto, a importação curada criava duplicata (bug real visto em
    // prod). Casa >=0.85 contra o cadastro da agência antes de decidir criar.
    const { data: existentesAgencia } = await db
      .from("diretores")
      .select("id, nome, nome_variantes")
      .eq("agencia_id", params.id);
    const listaExistentes = (existentesAgencia ?? []).map((d: { id: string; nome: string; nome_variantes?: unknown }) => ({
      id: d.id,
      nome: d.nome,
      nome_variantes: Array.isArray(d.nome_variantes) ? (d.nome_variantes as string[]) : [],
    }));
    const matchExistente = findBestMatch(diretor.nome, listaExistentes);
    const existing = matchExistente.diretorId && !matchExistente.needsReview
      ? { id: matchExistente.diretorId }
      : null;

    const write = existing?.id
      ? db.from("diretores").update(payload).eq("id", existing.id).select().single()
      : db.from("diretores").insert(payload).select().single();
    const { data: saved, error } = await write;
    if (error || !saved) continue;

    if (diretor.data_posse) {
      const mandatoPayload = {
        diretor_id: saved.id,
        data_inicio: diretor.data_posse,
        data_fim: diretor.data_fim_mandato,
        cargo: diretor.cargo,
        ato_nomeacao: diretor.ato_nomeacao ?? null,
        publicacao_dou: diretor.publicacao_dou ?? null,
        fonte_dado: "verificado",
        percentual_mandato_concluido: percentual,
        metadata: { fonte_url: diretor.fonte_url, importador: "curadoria_codex_iris" },
        updated_at: new Date().toISOString(),
      };

      const { data: existingMandato } = await db
        .from("mandatos")
        .select("id")
        .eq("diretor_id", saved.id)
        .eq("data_inicio", diretor.data_posse)
        .maybeSingle();

      if (existingMandato?.id) {
        await db.from("mandatos").update(mandatoPayload).eq("id", existingMandato.id);
      } else {
        await db.from("mandatos").insert(mandatoPayload);
      }
    }

    savedDiretores.push({ id: saved.id, nome: saved.nome, status: existing?.id ? "updated" : "created" });
  }

  const savedLista: Array<{ id: string; cargo_vaga: string; status: string }> = [];
  for (const item of curated.lista_triplice) {
    const payload = {
      agencia_id: params.id,
      cargo: item.cargo_vaga,
      cargo_vaga: item.cargo_vaga,
      nome_candidato: item.candidatos[0]?.nome ?? "A definir",
      candidatos: item.candidatos,
      etapa: "mapeamento",
      status: item.status,
      fonte: item.fonte,
      observacoes: item.observacoes,
      confidence: 1,
      review_status: "aprovado",
      metadata: { importador: "curadoria_codex_iris" },
      updated_at: new Date().toISOString(),
    };
    const { data: existing } = await db
      .from("lista_triplice")
      .select("id")
      .eq("agencia_id", params.id)
      .eq("cargo_vaga", item.cargo_vaga)
      .maybeSingle();
    const write = existing?.id
      ? db.from("lista_triplice").update(payload).eq("id", existing.id).select().single()
      : db.from("lista_triplice").insert(payload).select().single();
    const { data: saved } = await write;
    if (saved) savedLista.push({ id: saved.id, cargo_vaga: saved.cargo_vaga, status: existing?.id ? "updated" : "created" });
  }

  return NextResponse.json({
    agencia: curated.sigla,
    diretores: savedDiretores,
    lista_triplice: savedLista,
    alertas: curated.alertas,
    fontes: curated.fontes,
  });
}
