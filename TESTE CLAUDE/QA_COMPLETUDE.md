# QA de completude 2026 — ANPD e ANVISA

Gerado por `scripts/qa_completude.py --online`. Esperado = denominador independente (listagem oficial, numeração, texto das atas); Coletado = o que está na planilha.

| Agência | Verificação | Esperado | Coletado | Status | Nota |
|---|---|---|---|---|---|
| ANVISA | listagem oficial ao vivo: atas/2026 (items_total do site × itens devolvidos pela API com b_size grande) | 13 | 13 | OK |  |
| ANVISA | listagem oficial ao vivo: pautas/2026 (items_total do site × itens devolvidos pela API com b_size grande) | 19 | 19 | OK |  |
| ANVISA | listagem oficial ao vivo: votos/2026 (items_total do site × itens devolvidos pela API com b_size grande) | 18 | 18 | OK |  |
| ANVISA | listagem oficial ao vivo: extratos-dos-circuitos-deliberativos-1/2026 (items_total do site × itens devolvidos pela API com b_size grande) | 940 | 940 | OK |  |
| ANVISA | listagem oficial ao vivo: votos-dos-circuitos-deliberativos-1/2026-1 (items_total do site × itens devolvidos pela API com b_size grande) | 698 | 698 | OK |  |
| ANVISA | Atas ROP/REP 2026: listadas × baixadas com PDF válido | 13 | 13 | OK |  |
| ANVISA | Atas ROP/REP 2026: baixadas × reuniões lidas | 13 | 13 | OK |  |
| ANVISA | Extratos de CD 2026: listados × (lidos + repetidos idênticos) | 940 | 940 | OK |  |
| ANVISA | ROP 1..18: com ata lida + realizada sem ata + sem registro = todas | 18 | 18 | OK | com ata [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13]; sem ata (realizadas) [14, 15, 16, 17, 18]; sem registro em nenhuma fonte [11] |
| ANVISA | Numeração ROP sem buraco explicado | 0 | 1 | OK | ROP [11]: sem pauta, voto nem ata; perguntar à ANVISA |
| ANVISA | Itens (ROP + CD avulsos) × itens com ao menos 1 voto | 1166 | 1166 | OK |  |
| ANVISA | Votos duplicados (item, diretor) | 0 | 0 | OK |  |
| ANVISA | Votos: nominal + inferido + REVISAR = total | 5795 | 5795 | OK | {'nominal': 5294, 'inferido': 501} |
| ANVISA | Itens de ROP que a ata diz terem passado por CD (extrato publicado) × itens com a tabela nominal do extrato aplicada | 174 | 174 | OK |  |
| ANVISA | CDs citados nas atas sem extrato publicado (pendência da fonte) | 0 | 32 | OK | 32 CDs: [61, 109, 122, 123, 240, 244, 245, 246, 253, 298, 300, 301, 355, 356, 358, 364, 365, 458, 460, 461, 643, 646, 648, 651, 652] |
| ANVISA | CD 1..1057: números sem extrato publicado (pendência da fonte) | 0 | 123 | OK | 123 números; 42 deles têm só o PDF do voto escrito do relator (CD [112, 113, 119, 120, 122, 123, 168, 244, 245, 246, 298, 300, 301, 643, 646]) |
| ANPD | circuitos 2026 na página oficial (ao vivo) × circuitos coletados | 29 | 29 | OK |  |
| ANPD | reuniões deliberativas de 2026 canceladas por falta de processo (página de avisos ao vivo) | 9 | 9 | OK | nenhuma reunião deliberativa realizada: toda decisão é por circuito |
| ANPD | Circuitos 1..29 sem buraco | 29 | 29 | OK |  |
| ANPD | Circuitos: listados × baixados (PDFs válidos) | 57 | 57 | OK |  |
| ANPD | Circuitos com ata lida + sem ata (só voto) = todos | 29 | 29 | OK | sem ata publicada: ['CD07', 'CD23'] |
| ANPD | 4 votos (1 por membro do Conselho Diretor) em cada circuito com ata | 27 | 27 | OK |  |
| ANPD | Presença: assinante da ata é diretor do colegiado | 25 | 25 | OK | conferido no parser (27/27) |
| ANPD | Circuitos com "não acompanha o relator" > 0 ou levados à reunião | 0 | 0 | OK |  |
| ANVISA | Votos no JSON final × linhas na aba Votos | 5795 | 5795 | OK |  |
| ANPD | Votos no JSON × linhas na aba Votos | 110 | 110 | OK |  |
