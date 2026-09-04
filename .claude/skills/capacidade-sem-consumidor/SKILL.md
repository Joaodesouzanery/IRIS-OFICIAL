---
name: capacidade-sem-consumidor
description: Impede o padrão que mais reincidiu no IRIS — campo calculado, persistido, e que nenhuma rota/tela/consulta lê. Use ao adicionar coluna, campo em jsonb, contador, alerta ou métrica; e ao revisar qualquer commit que GRAVE algo novo.
---

# Capacidade sem consumidor

O defeito mais reincidente deste repo. Não é bug de lógica: o código roda, o teste passa, o dado
é gravado — e **ninguém nunca lê**. Some em silêncio até alguém perguntar "por que este número
não muda?", meses depois.

## Os casos REAIS (todos daqui)

| Campo | O que aconteceu |
|---|---|
| `juizo` | calculado por item de ata e persistido; nenhuma tela ou agregação consultava |
| `relator` | eixo nominal em 100% dos itens, gravado desde sempre — virou métrica só na Fase 6 |
| `CAPACIDADE_NOMINAL` | tabela de capacidade da fonte construída e não consumida no gate |
| **alarme de queda (Fase 18)** | pior caso: o insert **falhava** (`item_id NOT NULL`) e o erro era descartado. Alarme perfeitamente calibrado que nunca gravou uma linha |
| `ultimo_hash` | gravado em `monitoramento_sites` a cada crawl; **zero leituras** no repo inteiro |
| `extra` (cobertura-ao-vivo) | banco−site calculado e morto no payload até a Fase 17 |
| `extracao_metodo` | gravado certo, mas a CONSULTA lia o caminho errado — o consumidor existia e mirava no lugar errado |

## A pergunta obrigatória

Ao introduzir qualquer campo novo:

1. **Quem consome?** Nomeie a rota, a tela ou a consulta — com caminho de arquivo. "Vai ser útil
   depois" é a assinatura do defeito.
2. **Existe teste que ficaria vermelho se ninguém consumisse?** Se o único teste é "o campo é
   gravado", o campo está sozinho.
3. **O consumidor é alcançável?** O alarme da Fase 18 tinha consumidor (o Dashboard já exibia
   `monitoramento_alertas`) e mesmo assim ficou mudo, porque a escrita falhava em silêncio. Ver a
   skill `falha-silenciosa`.

## O grep que encontra os órfãos

```bash
# 1. campos gravados em insert/update (jsonb inclusive)
grep -rhoE '^\s+[a-z_]+:' src/lib/server src/app/api --include=*.ts \
  | tr -d ' :' | sort -u > /tmp/gravados.txt

# 2. para cada um, quantas vezes aparece em LEITURA (select, ->>, acesso a propriedade)
while read campo; do
  n=$(grep -rl --include=*.ts -e "$campo" src | wc -l)
  [ "$n" -le 1 ] && echo "ÓRFÃO PROVÁVEL: $campo (aparece em $n arquivo)"
done < /tmp/gravados.txt
```

Um campo que aparece em **um** arquivo só — o que o grava — é bandeira vermelha automática.

## O que NÃO é este defeito

Campo gravado de propósito para **auditoria futura** (proveniência, `arquivado_motivo`,
`enqueue_motivo_origem`) tem consumidor legítimo: a consulta de diagnóstico. A diferença é que
esse consumidor **existe e está escrito** — num `docs/qa-*.sql` versionado, não na intenção.
