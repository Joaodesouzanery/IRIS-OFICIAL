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

import { frasePorMotivo } from "@/lib/server/motivo-sem-voto";

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
  /**
   * ⚠️ Fase 35 — O REPARO DE VOTO ARTEFATO, que a Fase 34 publicou e ESTA FUNÇÃO descartava.
   *
   * `materializar-faltantes` emitia `artefatos_apagados`/`artefatos_candidatos`, mas `resumirBackfill`
   * monta um objeto explícito, chave por chave: o que não está aqui não chega a `etapas`, e portanto
   * nem a `contadores` nem à tela. Foi o defeito que o docblock deste arquivo existe para impedir —
   * "toda chave NUMÉRICA que o materializador publica tem de chegar à rodada por AQUI" — cometido
   * no commit seguinte ao que escreveu a frase.
   *
   * O custo foi concreto: o reparo apagou 51 votos em produção e o banner não tinha como dizer isso.
   * Os quatro números que o usuário viu (`votos`, `deliberacoes`, `pendentes`, `sem_data`) contavam a
   * história do reparo sem nomeá-lo.
   */
  "artefatos_apagados",
  "artefatos_candidatos",
  /**
   * ⚠️ Fase 36 — O PORTÃO. `cadastro_incompleto` é a camada 3 de `conferirRoster`: UM candidato
   * pendente faz a agência inteira ser recusada nos itens mudos. Sem este número na tela, ligar o
   * revoto seria apagar voto e descobrir depois que o materializador não pode reconstruir.
   */
  "bloqueados_por_cadastro_incompleto",
] as const;

export interface PayloadDoMaterializador {
  /** Fase 35 — votos removidos por serem artefato de fonte que não nomina (EVENTO: soma por rodada). */
  artefatos_apagados?: number | null;
  /** Fase 36 — itens recusados por `cadastro_incompleto` (candidato pendente na agência). */
  bloqueados_por_cadastro_incompleto?: number | null;
  /** Quebra por agência do acima, e os nomes a resolver. */
  bloqueados_por_cadastro_por_agencia?: Record<string, number> | null;
  candidatos_pendentes_por_agencia?: Record<string, string[]> | null;
  /** Fase 35 — quantos a regra ALCANÇARIA agora (ESTOQUE: retrato, recalculado a cada rodada). */
  artefatos_candidatos?: number | null;
  /** Tarefa 4 — contagem por motivo, sobre a MESMA população das "sem voto". */
  motivos_sem_voto?: Record<string, number> | null;
  motivos_gravados?: number | null;
  /**
   * ⚠️ Fase 33 — o que EU prometi e nunca entreguei.
   *
   * `divergencias_gravadas` era publicado pela rota e não tinha UM leitor: nem aqui, nem na tela.
   * E dois documentos meus (`docs/qa-fase31.sql` e `docs/PENDENCIAS.md`) afirmavam que ele aparecia
   * no banner. Sem consumidor, o bloco ⑧ do QA podia sair vazio por rodadas sem que nada na tela
   * mudasse — que foi exatamente o que aconteceu.
   */
  divergencias_gravadas?: number | null;
  /** O denominador da gravação: a fila inteira, e o quanto dela o skip dispensou por já estar igual. */
  diagnosticos_candidatos?: number | null;
  diagnosticos_ja_iguais?: number | null;
  /** Fase 31 — quantos itens teriam roster DIFERENTE se o preâmbulo do pai valesse. */
  roster_mudaria_com_presentes_do_pai?: number | null;
  /** A mesma medida, por agência — responde "é só a ANM?". */
  roster_mudaria_por_agencia?: Record<string, number> | null;
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
    artefatos_apagados: b.artefatos_apagados ?? 0,
    bloqueados_por_cadastro_incompleto: b.bloqueados_por_cadastro_incompleto ?? 0,
    artefatos_candidatos: b.artefatos_candidatos ?? 0,
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
  /**
   * ⚠️ STRING, como `sem_data_por_agencia` — `agregarEtapas` descarta valor não-numérico em
   * silêncio, então um objeto nunca chegaria a `totais`. E ela traz os NOMES: "a ANM está bloqueada"
   * sem dizer por quem é uma frase que não gera ação.
   */
  const bloqueio = Object.entries(b.bloqueados_por_cadastro_por_agencia ?? {})
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))
    .map(([sigla, n]) => {
      const nomes = (b.candidatos_pendentes_por_agencia ?? {})[sigla] ?? [];
      return `${sigla} ${n}${nomes.length > 0 ? ` (resolver: ${nomes.slice(0, 4).join(", ")}${nomes.length > 4 ? "…" : ""})` : ""}`;
    })
    .join(" · ");
  if (bloqueio) resumo.bloqueio_por_cadastro = bloqueio;
  if (typeof b.pendentes === "number") resumo.pendentes = b.pendentes;
  if (typeof b.fora_de_escopo === "number") resumo.fora_de_escopo = b.fora_de_escopo;
  // Leitura truncada faz TODO número acima subcontar. String e não booleano: `registrarRodada`
  // soma números, e um `false` viraria 0 somado — a tela nunca saberia.
  if (b.leitura_completa === false) resumo.leitura_do_acervo = "INCOMPLETA — os números abaixo subcontam";
  if (nomes.length > 0) resumo.nao_reconhecidos = nomes.join("; ");
  // ⚠️ Tarefa 4 — o motivo por deliberação chega aqui como FRASE, não como objeto.
  //
  // `registrarRodada` e `agregarEtapas` só entendem número e string; um objeto seria descartado em
  // silêncio pelos dois — o mesmo motivo de `nao_reconhecidos` e `sem_data_por_agencia` serem
  // string. E é esta linha que dá CONSUMIDOR ao mapa: sem ela, o motivo seria calculado, gravado e
  // nunca lido, que é exatamente o defeito que a tarefa conserta.
  const frase = frasePorMotivo((b.motivos_sem_voto ?? {}) as Record<string, number>);
  if (frase) resumo.motivos_sem_voto = frase;
  /**
   * ⚠️ O NÚMERO segue número, e a FRAÇÃO vai numa chave própria. Motivo medido ao escrever isto:
   * `agregarEtapas` e `registrarRodada` só entendem número e texto, e **descartam texto na soma**
   * (é por isso que `motivos_sem_voto` e `roster_mudaria_por_agencia` são strings de propósito).
   * Transformar `motivos_gravados` em `"7/312"` tiraria ele dos TOTAIS da run — a soma entre rodadas
   * desapareceria em silêncio. Então o contador continua somável e o denominador viaja ao lado.
   */
  if (typeof b.motivos_gravados === "number") resumo.motivos_gravados = b.motivos_gravados;
  /**
   * ⚠️ A FRAÇÃO, que é o que faltava para o zero ser legível. `motivos_gravados: 0` não distingue
   * "convergido, nada a fazer" de "a gravação não alcançou a fila" — e era exatamente essa
   * ambiguidade que deixava o bloco ⑧ do QA vazio sem alarme nenhum. `0/312 · 312 já iguais` é o
   * primeiro; `0/312` sozinho é o segundo.
   */
  if (typeof b.diagnosticos_candidatos === "number" && b.diagnosticos_candidatos > 0) {
    const iguais = typeof b.diagnosticos_ja_iguais === "number" ? b.diagnosticos_ja_iguais : 0;
    resumo.gravacao_do_diagnostico =
      `${b.motivos_gravados ?? 0}/${b.diagnosticos_candidatos}${iguais > 0 ? ` · ${iguais} já iguais` : ""}`;
  }
  /**
   * ⚠️ E o desempatador que eu PROMETI e não entreguei: `divergencias_gravadas` era publicado pela
   * rota e não tinha um leitor — nem aqui, nem na tela — enquanto `docs/qa-fase31.sql` e
   * `docs/PENDENCIAS.md` afirmavam que ele aparecia no banner.
   *
   * Publica MESMO EM ZERO quando houve divergência medida: um zero aqui, ao lado de um
   * `roster_mudaria_com_presentes_do_pai` positivo, é o sinal de que a gravação não chegou à frente
   * da fila. Número, para somar entre rodadas; a fração fica em `gravacao_do_diagnostico`.
   */
  if (typeof b.divergencias_gravadas === "number"
    && ((b.roster_mudaria_com_presentes_do_pai ?? 0) > 0 || b.divergencias_gravadas > 0)) {
    resumo.divergencias_gravadas = b.divergencias_gravadas;
  }
  // ⚠️ Só publica quando MEDIU algo. Um zero vindo de rodada que não chamou o materializador
  // apagaria da tela a medição da rodada anterior — `pendentes` já paga esse preço logo acima.
  if (typeof b.roster_mudaria_com_presentes_do_pai === "number" && b.roster_mudaria_com_presentes_do_pai > 0) {
    resumo.roster_mudaria_com_presentes_do_pai = b.roster_mudaria_com_presentes_do_pai;
  }
  // ⚠️ Como STRING: `agregarEtapas` e `registrarRodada` só entendem número e texto, e um objeto seria
  // descartado em silêncio pelos dois — mesmo motivo de `nao_reconhecidos` e `motivos_sem_voto`.
  const porAg = Object.entries(b.roster_mudaria_por_agencia ?? {})
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))
    .map(([sigla, n]) => `${sigla} ${n}`)
    .join(" · ");
  if (porAg) resumo.roster_mudaria_por_agencia = porAg;
  return resumo;
}
