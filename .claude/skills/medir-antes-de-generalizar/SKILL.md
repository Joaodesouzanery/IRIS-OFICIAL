---
name: medir-antes-de-generalizar
description: Antes de criar regex, limiar ou regra a partir de uma amostra pequena — e antes de concluir que "o sistema quebrou" a partir de uma consulta — rodar contra o corpus real. Use ao definir qualquer threshold/heurística e ao interpretar QUALQUER métrica.
---

# Medir antes de generalizar

Duas metades. A primeira é conhecida: não generalizar de amostra pequena. A segunda custou três
fases seguidas e é a mais importante.

## Metade 1 — a amostra pequena mente

| Caso | O que a medição mostrou |
|---|---|
| `"≥1594 chars/página"` | número tirado das 16 fixtures de certificação. Estava errado (mínimo real: 1210) — e, pior, a amostra é **estruturalmente enviesada**: foi escolhida para certificar EXTRAÇÃO, então tem camada de texto por construção. A população onde o OCR decide tinha representação ZERO nela. |
| Limiar do gate de ilegível | eu afirmei 80; o código corta em **50**. Ninguém tinha lido. |
| `"pauta" nos 300 primeiros chars` | passou nas 16 fixtures e **reprovou dois testes existentes**: um voto que diz "voto pela retirada de pauta" tem a palavra logo no começo. A regra virou "linha que COMEÇA com pauta", medida contra os cabeçalhos reais. |
| Detector de WAF | `_Incapsula_Resource` tratado como prova de bloqueio. É o script **sensor**, presente em TODA página do portal. A fixture antiga (1,6 KB recortada à mão) não o continha, então o falso positivo atravessou três fases. |

**Regra:** toda regex/limiar novo roda contra **todas** as fixtures oficiais e contra os testes
existentes antes de virar commit. E a fixture tem de ser o arquivo REAL, não um recorte.

## Metade 2 — a INVERSÃO DE PRIORIDADE (a que custou três fases)

Quando uma métrica sai **extrema — 0% ou 100% —, a primeira hipótese tem de ser "minha consulta
está lendo o caminho errado", e só depois "o sistema está quebrado".**

Foi essa ordem invertida que produziu três repetições seguidas:

| Métrica | O que eu concluí | O que era |
|---|---|---|
| `extracao_metodo` = "(não registrado)" em **1087/1087** | "o campo nunca foi persistido" | caminho errado no jsonb: era `campos_detectados→preview→extraction_raw` |
| `chars_per_page = 0` nos 44 votos | "medição de densidade" | constante hardcoded do `errorResult` |
| `tem_decisao_no_raw = 0` em **100%** dos 267 | "regressão de extração" | `decisao` é **omissão DECLARADA** do raw; o dispositivo mora na coluna `resumo_pleito`. Uma fase inteira de conserto quase foi escrita em cima disso. |

**O passo mecânico, antes de investigar o sistema:** provar que o campo EXISTE naquele caminho.

```sql
-- o campo existe onde eu acho que existe?
SELECT COUNT(*) FILTER (WHERE jsonb_exists(raw_extraction, 'decisao')) AS tem_a_chave,
       COUNT(*) AS total
  FROM deliberacoes WHERE tipo_documento = 'ata';
```

```bash
# ou, no código: quem GRAVA esse campo, e em que coluna?
grep -rn --include=*.ts "nome_do_campo" src | grep -v __tests__
```

Se `tem_a_chave = 0`, a conclusão não é "o sistema não grava" — é "eu estou lendo o lugar
errado, e preciso achar o ponto de escrita antes de continuar".
