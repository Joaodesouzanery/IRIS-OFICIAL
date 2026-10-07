# Validação de modal / tema / subtema (07/10/2026)
Método: **regras** (taxonomia do repo + novos níveis) classificam tudo; itens de **baixa confiança** (< 0,45) vão para **revisão por IA** (8 lotes de subagentes Claude, taxonomia fechada, todos os 309 resultados validados contra a lista). Depois **eu julguei à mão** amostras contra o texto da fonte.

## Resultado das amostras
| Amostra | Itens avaliáveis | Modal certo | Tema certo | Observação |
|---|---|---|---|---|
| 1 (40 itens, semente 2026) | 37 | 36 (97%) | 29 (78%) | abaixo da meta de 85% no tema → corrigi as causas |
| 2 (38 itens, **semente nova**, outros itens) | 35 | 33 (94%) | 33 (94%) | após as correções; 4 erros corrigidos depois de vistos |

3 itens por amostra são códigos de notificação ("NOT.DIN.0179/23", "NOT.DOP…") sem assunto legível: **indeterminados**, fora da conta; a IA recebeu ordem de dar confiança ≤ 0,3 neles.

## Erros achados e corrigidos
- `rodovia`/`viario` casavam dentro de "Rodoviários" (empresa de ônibus virava Rodovias); `obra` casava em "co**bra**nça".
- Perda de "ti" do PDF ("Adi vo") derrubava "termo aditivo"; a busca "achatada" criou falso positivo ("da Viação" → "aviação"); restrita a padrões com "ti".
- "ambiental" (EVTEA) e "atendimento" genéricos demais; "Sistema Nacional de Viação" casava como empresa de ônibus; "minuta" empurrava itens para Normas.
- Texto do dispositivo da ARTESP incluía o título da **próxima** seção (SUHAP) e contaminava o modal; agora termina em "PUBLIQUE-SE".
- IA sobrescrevia tema que a regra já tinha certo (só o modal era incerto): agora a IA só decide o campo incerto.
- Contratos da própria ARTESP (SUADI, "Termo de Aditamento…") viravam "Contratos de concessão"; "Ressarcimento ENEM" herdava a unidade errada.

## Limites (não escondidos)
- 2 amostras (~70 itens) de ~1.430: não é auditoria completa; a acurácia estimada tem margem de erro de alguns pontos.
- Itens só com código (NOT.DIN/NOT.DOP) ficam com classificação **aproximada** (IA, confiança baixa).
- 2 itens (1 ANTT, 1 ARTESP) ficaram "Outros / não identificado".
- Subtema é o nível mais frágil; use **Modal** e **Tema** para análises, subtema como apoio.
- A aba "Temas regra x IA" lista cada item revisado por IA e se concordou com a regra (a divergência é esperada: eram os itens difíceis).
- O texto de ANM para tema vem do assunto do grupo do item; 13 itens da ANM não têm assunto no texto (aprovação de ata e 5 deliberações).
