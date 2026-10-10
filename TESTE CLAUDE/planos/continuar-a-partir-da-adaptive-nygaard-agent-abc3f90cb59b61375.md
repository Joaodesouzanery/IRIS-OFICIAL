# ANAC: retomada (plano)

Pasta: /home/user/IRIS-OFICIAL/TESTE CLAUDE. Python sempre `python3 -I`. Sem commit. Nao editar: build_xlsx, temas, taxonomia, qa_completude, agencias, rodar_tudo.sh, README, MAPEAMENTO, dashboard.

## Estado medido em disco (antes de qualquer acao nova)
- Download concluido: manifesto_anac.json tem 629 entradas, todas valido=True; 454 documentos SEI/pergamum com sha256 (402 SEI, 52 pergamum). 41 reunioes, 41 pautas.
- Lidos: 362 de 454 (34 atas, 79 certidoes, 79 votos, 2 PDFs-imagem por OCR). Nao lidos: 52 ementas pergamum (SPA React, API autenticada) e 40 pesquisas publicas SEI ("Processo nao encontrado").
- anac.json (mtime 12:17): 41 reunioes, 95 itens, 428 votos = 114 nominal + 314 inferido + 0 REVISAR. Presenca real (ata) em 34 reunioes; inferida em RD5, REX2, RD6, RE30 (ata "em breve"); RD7, RE31, RE32 sem resultado/nao realizada = os 9 itens sem desfecho (sem ata, vao para `pendencias`).
- Por diretor (nominal/inferido): Faierstein 11/75, Mesquita 32/54, Mathias Moreira 19/67, Honorato 11/51, Ianelli 11/42, L.R. Nascimento 11/13, Altoe 6/12, Tiago Sousa Pereira 13/0 (so AUSENTE).
- So 1 "por maioria" resolvido (RE9 item 1: Relator Rui Mesquita vencido, Voto-Vista de Luiz Ricardo). RE6 item 1 e RE7 item 1 sao Vistas (pedido por Rui Mesquita e por Luiz Ricardo; votos antes da vista a conferir). Janelas de mandato ja revistas nas atas (Nascimento ate 22/03, Altoe 12/02-24/04, Honorato 23/03, Ianelli 25/04), com fim de Nascimento e Altoe ainda "INFERIDO".
- anac_auditoria.py e anac_varredura.py foram editados (12:16-12:18) DEPOIS do ultimo anac.json e nao ha saida de auditoria em disco: varredura e auditoria nao foram rodadas sobre o estado final. Isso e o que falta medir.

## Passos (execucao)
1. Reabrir a fonte: re-crawl incremental (anac_baixar.py) para ver se RD5/REX2/RD6/RE30/RD7/RE31 ganharam ata; F5 rejeita ~50%, usar cookie jar + retry.
2. `anac_parse.py --autoteste`, depois parse completo; conferir nos textos reais: vencidos nomeados, abstencoes, impedimentos, ressalvas, partes/voto_por_parte, votos antes da vista (RE6 item 1, RE7 item 1), ad referendum; zerar casos `SEM VOTO (maioria sem vencidos)` lendo a certidao.
3. Janelas de mandato: confirmar nas atas as datas ainda marcadas INFERIDO (fim de Nascimento, fim de Altoe) e a evidencia de Honorato/Ianelli.
4. Itens sem desfecho: preencher so se houver ata nova; senao pendencias com URL.
5. Medicao: `anac_varredura.py` (meta 100%), `anac_auditoria.py anac.json 44 2026` (>=40 itens, semente fixa, texto antes do JSON) ate >=95%; corrigir e repetir.
6. Relatorio final com antes x depois (428 votos, 114/314/0) por proveniencia e por diretor, completude (454/454 baixados, lidos X/454), taxas da varredura/auditoria, pendencias restantes (40 pesquisas SEI, 52 ementas SPA, atas ausentes, link errado RE16 item 3) e o que nao tem solucao. Nada de "feito" sem numero.
