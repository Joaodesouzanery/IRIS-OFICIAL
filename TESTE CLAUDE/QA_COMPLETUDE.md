# QA de completude 2026 — ANPD e ANVISA

Gerado por `scripts/qa_completude.py`. Esperado = denominador independente (listagem oficial, numeração, texto das atas); Coletado = o que está na planilha.

| Agência | Verificação | Esperado | Coletado | Status | Nota |
|---|---|---|---|---|---|
| ANVISA | Atas ROP/REP 2026: listadas × baixadas com PDF válido | 13 | 13 | OK |  |
| ANVISA | Atas ROP/REP 2026: baixadas × reuniões lidas | 13 | 13 | OK |  |
| ANVISA | Extratos de CD 2026: listados × (lidos + repetidos idênticos) | 940 | 940 | OK |  |
| ANVISA | ROP 1..18: com ata lida + realizada sem ata + sem registro = todas | 18 | 18 | OK | com ata [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13]; sem ata (realizadas) [14, 15, 16, 17, 18]; sem registro em nenhuma fonte [11] |
| ANVISA | Numeração ROP sem buraco explicado | 0 | 1 | OK | ROP [11]: sem pauta, voto nem ata; perguntar à ANVISA |
| ANVISA | Itens (ROP + CD avulsos) × itens com ao menos 1 voto | 1166 | 1166 | OK |  |
| ANVISA | Votos duplicados (item, diretor) | 0 | 0 | OK |  |
| ANVISA | Votos: nominal + inferido + REVISAR = total | 5795 | 5795 | OK | {'nominal': 5329, 'inferido': 466} |
| ANVISA | Itens de ROP que a ata diz terem passado por CD (extrato publicado) × itens com a tabela nominal do extrato aplicada | 209 | 209 | OK |  |
| ANVISA | CDs citados nas atas sem extrato publicado (pendência da fonte) | 0 | 37 | OK | 37 CDs: [61, 109, 112, 113, 119, 120, 122, 123, 168, 240, 244, 245, 246, 253, 298, 300, 301, 355, 356, 358, 364, 365, 458, 460, 461] |
| ANVISA | CD 1..1057: números sem extrato publicado (pendência da fonte) | 0 | 123 | OK | 123 números; 42 deles têm só o PDF do voto escrito do relator (CD [112, 113, 119, 120, 122, 123, 168, 244, 245, 246, 298, 300, 301, 643, 646]) |
| ANPD | Circuitos 1..29 sem buraco | 29 | 29 | OK |  |
| ANPD | Circuitos: listados × baixados (PDFs válidos) | 57 | 57 | OK |  |
| ANPD | Circuitos com ata lida + sem ata (só voto) = todos | 29 | 29 | OK | sem ata publicada: ['CD07', 'CD23'] |
| ANPD | 4 votos (1 por membro do Conselho Diretor) em cada circuito com ata | 27 | 27 | OK |  |
| ANPD | Presença: assinante da ata é diretor do colegiado | 25 | 25 | OK | conferido no parser (27/27) |
| ANPD | Circuitos com "não acompanha o relator" > 0 ou levados à reunião | 0 | 0 | OK |  |
| ANP | atas baixadas válidas × reuniões lidas | 13 | 13 | OK |  |
| ANP | 5 votos (1 por diretor) em cada item | 139 | 139 | OK |  |
| ANP | Votos duplicados (item, diretor) | 0 | 0 | OK |  |
| ANP | Documentos pendentes do JSON × linhas da aba "Faltam na fonte" | 13 | 13 | OK |  |
| ANTAQ | Itens com ao menos 1 voto registrado | 682 | 682 | OK | 3 itens têm conjunto de votantes diferente dos presentes da reunião (item decidido com subconjunto de diretores, ou diretor com Declaração de Voto no SEI que a ata não lista como presente, ROD605); conferidos na auditoria |
| ANTAQ | Votos duplicados (item, diretor) | 0 | 0 | OK |  |
| ANTAQ | Votos: nominal + inferido + REVISAR = total | 3413 | 3413 | OK | {'nominal': 1458, 'inferido': 1955} |
| ANTAQ | Verificações da aba qualidade do parser sem DIVERGE | 0 | 0 | OK | 8 exceções explicadas, todas em Faltam na fonte quando for documento |
| ANTAQ | Documentos pendentes do JSON × linhas da aba "Faltam na fonte" | 56 | 56 | OK |  |
| ANATEL | Itens com ao menos 1 voto registrado | 584 | 584 | OK |  |
| ANATEL | Votos duplicados (item, diretor) | 0 | 0 | OK |  |
| ANATEL | Votos: nominal + inferido + REVISAR = total | 2922 | 2922 | OK | {'inferido': 949, 'nominal': 1973} |
| ANATEL | Verificações da aba qualidade do parser sem DIVERGE não explicada em pendências | 0 | 0 | OK | 0 DIVERGE de fonte, todas em pendencias/Faltam na fonte |
| ANATEL | Documentos pendentes do JSON × linhas da aba "Faltam na fonte" | 22 | 22 | OK |  |
| ANEEL | Itens com ao menos 1 voto registrado | 1001 | 1001 | OK |  |
| ANEEL | Votos duplicados (item, diretor) | 0 | 0 | OK |  |
| ANEEL | Votos: nominal + inferido + REVISAR = total | 5023 | 5023 | OK | {'inferido': 3423, 'nominal': 1588, 'REVISAR': 12} |
| ANEEL | Verificações da aba qualidade do parser sem DIVERGE não explicada em pendências (divergência de data, buraco, truncad, sem pedinte) | 0 | 0 | OK | 4 DIVERGE de fonte, todas em pendencias/Faltam na fonte |
| ANEEL | Documentos pendentes do JSON × linhas da aba "Faltam na fonte" | 87 | 87 | OK |  |
| ANA | Itens com ao menos 1 voto registrado | 0 | 0 | OK |  |
| ANA | Votos duplicados (item, diretor) | 0 | 0 | OK |  |
| ANA | Votos: nominal + inferido + REVISAR = total | 0 | 0 | OK | {} |
| ANA | Verificações da aba qualidade do parser sem DIVERGE não explicada em pendências (NÃO baixado, bloqueado pela fonte) | 0 | 0 | OK | 1 DIVERGE de fonte, todas em pendencias/Faltam na fonte |
| ANA | Documentos pendentes do JSON × linhas da aba "Faltam na fonte" | 29 | 29 | OK |  |
| ANVISA | Votos no JSON final × linhas na aba Votos | 5795 | 5795 | OK |  |
| ANPD | Votos no JSON × linhas na aba Votos | 110 | 110 | OK |  |
| ANP | Votos no JSON × linhas na aba Votos | 695 | 695 | OK |  |
| ANTAQ | Votos no JSON × linhas na aba Votos | 3413 | 3413 | OK |  |
| ANATEL | Votos no JSON × linhas na aba Votos (inclui quem saiu do colegiado, fora dos totais) | 2922 | 2922 | OK |  |
| ANEEL | Votos no JSON × linhas na aba Votos (inclui quem saiu do colegiado, fora dos totais) | 5023 | 5023 | OK |  |
| ANA | Votos no JSON × linhas na aba Votos | 0 | 0 | OK |  |
| ANVISA | Documentos pendentes do JSON × linhas da aba "Faltam na fonte" | 133 | 133 | OK | ausentes da aba: [] |
| ANPD | Documentos pendentes do JSON × linhas da aba "Faltam na fonte" | 2 | 2 | OK | ausentes da aba: [] |
| TODAS | Linhas da aba "Faltam na fonte" com URL da página-fonte | 499 | 499 | OK | sem URL: [] |
