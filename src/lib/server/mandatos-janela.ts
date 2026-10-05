/**
 * Os mandatos como o MOTOR de voto os enxerga — para quem precisa do roster de uma data fora do
 * placar (Fase 39: a janela `voto_antt` confere se o signatário tinha mandato na data proposta).
 *
 * ⚠️ OS MESMOS filtros de `getActiveDiretoresForVote` e do placar: sem `automatico` (mandato fabricado
 * a partir do próprio voto não amplia o roster), só diretor `aprovado`, e com a janela de afastamento
 * de `diretores.metadata`. Um filtro próprio aqui faria a correção de data discordar do motor.
 */

import { lerTudo } from "@/lib/server/select-all-paged";
import type { MandatoJanela } from "@/lib/server/colegiado-na-data";

export async function carregarMandatosJanela(
  db: { from: (t: string) => any },
  rotulo: string,
): Promise<{ mandatos: MandatoJanela[]; completa: boolean }> {
  const res = await lerTudo<any>(
    () => db.from("mandatos")
      .select("diretor_id, data_inicio, data_fim, diretores!inner(id, agencia_id, review_status, metadata)")
      .neq("fonte_dado", "automatico")
      .eq("diretores.review_status", "aprovado")
      .order("id"),
    rotulo);
  const mandatos: MandatoJanela[] = [];
  for (const m of (res.data ?? []) as any[]) {
    const dir = m.diretores;
    if (!dir?.id || !dir.agencia_id) continue;
    mandatos.push({
      diretor_id: dir.id, agencia_id: dir.agencia_id,
      data_inicio: m.data_inicio ?? null, data_fim: m.data_fim ?? null,
      afastado_desde: (dir.metadata?.afastado_desde as string | null) ?? null,
      afastado_ate: (dir.metadata?.afastado_ate as string | null) ?? null,
    });
  }
  return { mandatos, completa: !res.error && !res.truncated };
}
