# TESTE Claude — IMQN: Qualidade Regulatória das 12 agências (rascunho)

> **Status: RASCUNHO / METODOLOGIA.** Nenhuma agência foi avaliada, nenhuma nota foi atribuída e **nada aqui é lido pelo app**
> (sem migration, sem rota, sem tela). Serve para revisão humana antes de virar módulo/aba.

## O que tem aqui
| Arquivo | O que é |
|---|---|
| `IMQN_agencias_workbook.xlsx` | Fonte de trabalho (16 abas): dimensões, 10 critérios, 73 condições (com a célula de origem na planilha oficial), 12 agências, **Fontes / Sinais / Mapa / Monitor / Achados**, Avaliação (876 linhas em branco), Cálculo (fórmulas vivas), Ranking, Auditoria da planilha original. |
| `IMQN_agencias_prototipo.html` | Protótipo autocontido da futura aba (ranking, ficha com checklist, fontes & monitoramento). Respostas ficam só no navegador. |
| `fontes-monitoramento.json` | Registro legível por máquina: 16 fontes nacionais, 34 sinais, 73 condições→sinais, 120 linhas agência×critério. |
| `gerador/` | Scripts que regeneram tudo (Python 3 + `openpyxl`). |
| `AMBIENTE.md` | Variáveis de ambiente relevantes (**só nomes, nunca valores**). |

## Regras que valem para quem continuar (humano ou outro Claude)
1. **Não inventar nota.** Resposta em branco = "sem avaliação", não "não atende". Toda coleta automática nasce `pendente`.
2. **Avalia a instituição, nunca pessoas.** Sem CPF/telefone/e-mail pessoal; capacitação só como % agregado.
3. **Origem dos critérios:** as 73 condições vêm da planilha INFRA rev2022 (`docs/metodologia/Matriz Qualidade Normativa_rev2022.xlsx`).
   Perguntas, classificação pública/interna, sinais e termos de busca são **proposta** deste rascunho.
4. **URLs:** "encontrada em busca (2026-10-09)" ≠ verificada em navegador. 8 de 12 portais falharam no acesso direto no ambiente de geração.
5. **Base legal a conferir:** Estoque cita o Decreto 10.139/2019, que segundo Anatel/ANAC foi substituído pelo Decreto 12.002/2024.
6. O motor oficial já existe no app (`src/lib/server/imqn.ts`, `src/lib/server/imqn/rev2022.json`, migration `20261004120000_qualidade_imqn_rev2022.sql`,
   ainda **não aplicada**). Este rascunho foi feito de forma independente; a regra de cascata do workbook equivale à documentada em `imqn.ts`
   (ex.: Inicial completo + 2/4 do Gerenciado = 0,525). Conferir antes de integrar.

## Regenerar
```bash
pip install openpyxl
cd docs/metodologia/teste-claude/gerador
python3 extract.py       # lê a planilha oficial -> matriz.json
python3 registry.py      # -> ../fontes-monitoramento.json
python3 build_xlsx.py    # -> ../IMQN_agencias_workbook.xlsx   (arg2 "demo" = respostas sintéticas de teste, NÃO commitar)
python3 build_html.py    # -> ../IMQN_agencias_prototipo.html
```
Verificação feita: recálculo no LibreOffice sem erros de fórmula; casos sintéticos (Inicial completo = 35; tudo atendido = 100;
Inicial + 2/4 Gerenciado = 0,525) idênticos no XLSX e no HTML.

## Caminho de promoção (sugerido, por etapas, cada uma com aval)
1. Revisar fontes/URLs/classificação (você é o portão do dado).
2. Registro de fontes vira dado do módulo (`qualidade_fontes`, `qualidade_sinais`) — migration manual e idempotente.
3. Aba somente-leitura "Fontes & Monitoramento" no módulo Qualidade Regulatória.
4. Checklist por condição na aba Diagnóstico — só depois de aplicar a migration da Fase 37.
Limites a respeitar: Vercel Hobby (1 cron, orçamento de 70 s por rodada — ver `CLAUDE.md`).
