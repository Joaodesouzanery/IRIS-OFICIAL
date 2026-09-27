/**
 * O interruptor do `/setup-owner` — Fase 32.
 *
 * ═══ Por que esta rota precisa nascer FECHADA ═══
 * `/api/v1/auth/*` faz bypass do middleware, então `setup-owner` é **público**. Suas defesas são
 * boas (e-mail válido com cap anti-ReDoS, senha ≥ 8, `IRIS_SETUP_TOKEN` comparado em tempo
 * constante, allowlist de e-mail, e 409 se já houver admin) — mas duas coisas se combinam mal:
 *
 * 1. **Não há rate-limit no projeto.** O próprio comentário da rota diz que sem isso "vira vetor de
 *    takeover". O gate efetivo é um único segredo, sob força bruta ilimitada.
 * 2. **O caminho `reusedExistingUser` RESETA A SENHA do owner existente.** E a trava que deveria
 *    impedir isso — `adminUsersCount() > 0` → 409 — se reabre se `admin_users` dessincronizar do
 *    Auth. Esse cenário é real: a migration `010` criou o CHECK sem `'owner'`, a `014` corrige, e o
 *    código tem fallback para quando a `014` não foi aplicada. Owner no Auth sem linha ativa na
 *    tabela = contagem zero = rota reaberta.
 *
 * O owner já existe. Então o padrão passa a ser FECHADO, e abrir é um ato deliberado: definir
 * `IRIS_SETUP_ENABLED=1` no ambiente, usar, e remover a variável.
 *
 * ⚠️ O código NÃO é apagado: ele é a saída de desastre (perder o acesso de owner). Apagar trocaria
 * um vetor por um beco sem saída.
 */
export function setupOwnerAberto(): boolean {
  return process.env.IRIS_SETUP_ENABLED?.trim() === "1";
}
