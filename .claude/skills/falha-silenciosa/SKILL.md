---
name: falha-silenciosa
description: Pega o padrão em que uma escrita no Supabase falha e ninguém percebe, porque supabase-js devolve {error} em vez de lançar. Use ao escrever ou revisar qualquer insert/update/upsert/delete, e sempre que um contador reportar sucesso.
---

# Falha silenciosa

`supabase-js` **não lança** em erro de banco: devolve `{ data, error }`. Quem escreve
`await db.from(...).update(...)` sem desestruturar conta como gravado o que não gravou — e o
`try/catch` em volta não vê nada, porque não houve exceção.

**Medido neste repo: ~47% das escritas não checam `{ error }`.**

## Os casos REAIS

- **Alarme de queda (Fase 18)** — o insert não mandava `item_id`, que é `NOT NULL`. Falhava com
  23502 a cada rodada, por um dia inteiro, sem uma linha de log. O alarme foi dado como pronto.
- **`dedupeItems` da ANTT** — descartes sem contagem: o número reportado não batia com o gravado.
- **Fase 5, upsert do backfill** — erro descartado; a rota reportava sucesso sobre linhas que
  nunca entraram.

## A regra

```ts
// ❌ conta como sucesso o que pode ter falhado
await db.from("tabela").update(patch).eq("id", id);
contador++;

// ✅ o contador reflete a realidade
const { error } = await db.from("tabela").update(patch).eq("id", id);
if (error) {
  falhas++;
  console.warn(`[modulo] escrita falhou em ${id}: ${error.message}`);
} else {
  contador++;
}
```

**Escrita em laço com contador é o caso crítico**: um contador que mente para cima envenena a
próxima medição, e a investigação seguinte parte de um número falso — foi o que quase custou uma
fase inteira quando `extracao_metodo` apareceu como "(não registrado)" em 1087/1087.

## Onde é aceitável ignorar

Só quando o write é **diagnóstico opcional** e a omissão está DECLARADA no comentário — por
exemplo, o insert de alerta que "degrada: diagnóstico nunca derruba a coleta". Mesmo aí, **logue**:
degradar não é emudecer.

## O grep

```bash
# escritas que não desestruturam { error } na mesma expressão
grep -rn --include=*.ts -E '(^|[^{])await (db|supabase)\.from\([^)]*\)\.(insert|update|upsert|delete)' src \
  | grep -v 'const {' | grep -v '__tests__'
```

## Teste que prova (não declara)

Não basta assertar que o código "checa o erro". O teste tem de **fazer uma escrita falhar** e
provar que o contador reflete: 3 escritas com 1 falha → 2 sucessos + 1 falha. A mutação que
remove a checagem tem de derrubar o teste. Ver `etapa115-re-resultar.test.ts`.
