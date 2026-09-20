/**
 * O que o passo `backfillVotos` LEVA da resposta do materializador para a rodada (Fase 21).
 *
 * ═══ Por que este arquivo existe ═══
 * `materializar-faltantes` calculava, toda noite, `roster_nao_conferivel`, `fora_da_janela_de_mandatos`,
 * `upsert_falhas` e `delta_dispositivo` — e o único chamador (`pipeline/run`) lia TRÊS chaves:
 * `materializaveis`, `votos`, `restantes`. Todo o resto era descartado. Consequência concreta:
 * uma run em que TODAS as escritas de voto falharam mostrava o mesmo banner verde de uma run
 * sem nada a fazer, e o número que decide a regra do dispositivo era computado e jogado fora.
 * É a skill `capacidade-sem-consumidor`, no meu próprio commit da véspera.
 *
 * ═══ A regra ═══
 * Toda chave NUMÉRICA que o materializador publica tem de chegar à rodada por AQUI, com nome
 * próprio — `registrarRodada` soma qualquer número das etapas, e a tela agrega do mesmo jeito.
 * A etapa123 é transversal: cada chave desta lista precisa de um leitor fora da própria rota.
 */

/** As chaves numéricas do payload do materializador — a lista que a etapa123 cobra leitor. */
export const CHAVES_NUMERICAS_DO_MATERIALIZADOR = [
  "materializaveis",
  "votos",
  "sem_evidencia",
  "roster_nao_conferivel",
  "fora_da_janela_de_mandatos",
  "upsert_falhas",
  // Fase 28 — o estoque e o alcance. Sem eles não dá para ver a fila DRENAR: `deliberacoes` e
  // `votos` dizem o que a rodada fez, e nada dizia quanto ainda falta nem quanto ela olhou.
  "pendentes",
  "examinados",
  "fora_de_escopo",
  // Fase 28 — "fora da janela" tem DOIS motivos e só um deles fala de mandato.
  "fora_da_janela_anterior_ao_1o_mandato",
  "fora_da_janela_sem_data_de_reuniao",
] as const;

export interface PayloadDoMaterializador {
  materializaveis?: number;
  votos?: number;
  sem_evidencia?: number;
  roster_nao_conferivel?: number;
  fora_da_janela_de_mandatos?: number;
  upsert_falhas?: number;
  pendentes?: number;
  examinados?: number;
  fora_da_janela_anterior_ao_1o_mandato?: number;
  fora_da_janela_sem_data_de_reuniao?: number;
  sem_data_por_agencia?: Record<string, number>;
  fora_de_escopo?: number;
  leitura_completa?: boolean;
  detalhe_roster?: Array<{ nao_reconhecidos?: string[] }>;
  delta_dispositivo?: {
    itens_que_mudariam?: number;
    votos_a_menos?: number;
    por_regex_divergente?: Record<string, number>;
    por_regex_falso_positivo?: Record<string, number>;
  };
}

/**
 * O resumo da rodada. Só números e UMA string — o tipo da etapa no cliente é
 * `number | string | boolean`, e `registrarRodada` soma só os números.
 *
 * `nao_reconhecidos` vem como string (até 5 nomes) porque é o que o operador precisa ver para
 * consertar o cadastro; um array seria silenciosamente descartado pelos dois consumidores.
 */
export function resumirBackfill(body: PayloadDoMaterializador | null | undefined): Record<string, number | string> {
  const b = body ?? {};
  const delta = b.delta_dispositivo ?? {};
  const soma = (m?: Record<string, number>) => Object.values(m ?? {}).reduce((a, n) => a + (n ?? 0), 0);
  const regexDivergente = soma(delta.por_regex_divergente);
  const regexFalsoPositivo = soma(delta.por_regex_falso_positivo);
  const nomes = [...new Set((b.detalhe_roster ?? []).flatMap((d) => d.nao_reconhecidos ?? []))].slice(0, 5);

  const resumo: Record<string, number | string> = {
    deliberacoes: b.materializaveis ?? 0,
    votos: b.votos ?? 0,
    sem_evidencia: b.sem_evidencia ?? 0,
    roster_nao_conferivel: b.roster_nao_conferivel ?? 0,
    fora_da_janela: b.fora_da_janela_de_mandatos ?? 0,
    fora_da_janela_anterior_ao_1o_mandato: b.fora_da_janela_anterior_ao_1o_mandato ?? 0,
    fora_da_janela_sem_data_de_reuniao: b.fora_da_janela_sem_data_de_reuniao ?? 0,
    upsert_falhas: b.upsert_falhas ?? 0,
    // ⚠️ `pendentes` é ESTOQUE (ver `agregar-rodadas.ts`): a tela guarda o ÚLTIMO valor, não a
    // soma. Somá-lo por rodada produziria um número que cresce enquanto a fila encolhe.
    examinados: b.examinados ?? 0,
    // A regra do DISPOSITIVO (desligada, medida): o número que o usuário pediu para ver antes.
    votos_a_menos: delta.votos_a_menos ?? 0,
    itens_que_mudariam: delta.itens_que_mudariam ?? 0,
    regex_divergente: regexDivergente,
    regex_falso_positivo: regexFalsoPositivo,
  };
  // ⚠️ ESTOQUE não pode ter default 0. A tela ATRIBUI estoque (não soma), então um `pendentes: 0`
  // vindo de rodada que falhou — ou de um passo que nem chamou o materializador — APAGARIA da tela
  // o estoque real da rodada anterior. Só publica quem de fato mediu.
  // A agência vai como STRING: o tipo do valor é `number | string`, e um objeto seria descartado
  // em silêncio pelos dois consumidores — o mesmo motivo de `nao_reconhecidos` ser string.
  const porAgencia = Object.entries(b.sem_data_por_agencia ?? {})
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))
    .map(([sigla, n]) => `${sigla} ${n}`)
    .join(" · ");
  if (porAgencia) resumo.sem_data_por_agencia = porAgencia;
  if (typeof b.pendentes === "number") resumo.pendentes = b.pendentes;
  if (typeof b.fora_de_escopo === "number") resumo.fora_de_escopo = b.fora_de_escopo;
  // Leitura truncada faz TODO número acima subcontar. String e não booleano: `registrarRodada`
  // soma números, e um `false` viraria 0 somado — a tela nunca saberia.
  if (b.leitura_completa === false) resumo.leitura_do_acervo = "INCOMPLETA — os números abaixo subcontam";
  if (nomes.length > 0) resumo.nao_reconhecidos = nomes.join("; ");
  return resumo;
}
