---
name: auditoria-producao
description: Roda a auditoria de votos/cobertura do IRIS contra o banco de PRODUÇÃO via MCP Supabase (somente leitura) e entrega o relatório interpretado — sem o usuário colar SQL. Use quando o usuário pedir "roda a auditoria", "como estão os votos/cobertura em produção" ou equivalente.
---

# Auditoria de produção — votos, roster, empresas e cobertura

O instrumento é `docs/auditoria-votos-cobertura.sql` (uma query só, `jsonb_pretty`, 9 blocos).
Esta skill o executa via MCP e interpreta o resultado no formato consolidado da Fase 13.

## Pré-requisito: o MCP `supabase-iris`

Procure entre as ferramentas disponíveis um servidor MCP do Supabase apontado ao projeto IRIS
(ex.: `mcp__supabase-iris__execute_sql`; use ToolSearch se necessário). **Se não existir**, PARE
e mostre ao usuário o passo a passo de configuração (uma vez só):

```bash
claude mcp add supabase-iris --scope project \
  -e SUPABASE_ACCESS_TOKEN=<token pessoal de supabase.com/dashboard/account/tokens> \
  -- npx -y @supabase/mcp-server-supabase@latest --read-only --project-ref=<ref do projeto IRIS>
```

O `--read-only` é inegociável: a auditoria é leitura, e este canal nunca deve escrever.
⚠️ O conector Supabase do claude.ai NÃO serve — está amarrado a outro projeto; é por isso que o
servidor local com token existe.

## Execução

1. Leia `docs/auditoria-votos-cobertura.sql` e execute o conteúdo INTEIRO como uma única query
   via `execute_sql`. O resultado é um JSON com os blocos `1_…` a `7_migrations`.
2. Se a query falhar por coluna inexistente, o bloco `7_migrations` (sondas) diz qual migration
   falta — reporte em vez de contornar.

## Interpretação (o contrato do relatório)

- **①/②** Votos por diretor SEMPRE separados por agência, com `votos/oportunidades` — janela de
  mandato explica desigualdade legítima; só o resíduo é suspeito. `parciais` do bloco ② podem
  ser ausência REAL (ver ②b: `quem_falta` + o PDF público) — a Fase 13 provou um caso de férias
  declarado na capa ("Ausência Justificada:"). Nunca declare "voto perdido" sem abrir o PDF.
- **Nomes que não são pessoas** no bloco ① (`mandato_confiavel: false` com votos nominais) são o
  sinal do lixo da ARTESP — se reaparecerem, o gate `fonteNominaVotos`/`isStrictPersonName`
  regrediu.
- **③** separa "sem empresa POR REGRA" (órgão interno) de falha — e a regex do SQL é mais
  estreita que a real (`ORGAO_INTERNO_RE` cobre "agência reguladora"); desconte antes de acusar.
- **④/④b** cobertura lado-banco + onde cada item parou. O lado-FONTE sai de
  `/api/v1/admin/cobertura-ao-vivo` (rota existente — verificada por grep; exige admin/cron).
- **⑤** as 9 amostras trazem `pdf_url` PÚBLICO — na ARTESP pode ser ZIP (baixe e extraia antes
  de ler). **⑥** sondas de causa; a de `dedupeItems` foi DERRUBADA na Fase 13 (processo nunca é
  nulo nos extratores) — não a ressuscite.

## O que esta skill NÃO faz

Não escreve no banco, não aplica migrations (SQL Editor do usuário, skill `iris-migrations`) e
não substitui o ritual de verificação do código.
