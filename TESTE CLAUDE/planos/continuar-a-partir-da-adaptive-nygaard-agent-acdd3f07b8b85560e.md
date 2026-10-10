# Plano de execucao: ARTESP D-9 + R-5 (ANM ja verificada)

Contexto: sessao em modo de plano (somente leitura), apesar de o pedido dizer "execucao". Nada foi editado.

## Fatos medidos (leitura)
- ANM: as correcoes D-1..D-8/R-1/R-2 ja estao COMMITADAS em HEAD (f5a9d82); working tree de anm.json/anm_parse.py esta limpo. "Antes" = 8eddf84:./anm.json.
- ANM verificada item a item contra texto/*.txt: todos os 14 itens OK (ver relatorio final).
- `unidade` da ARTESP NAO alimenta relator/proponente do xlsx: build_xlsx usa so artesp_procedencia.json (campo Procedencia dos PDFs, chave = n. da deliberacao). Unico consumidor de `unidade`: scripts/temas.py (alltxt e hash_item -> invalida cache de temas dos itens alterados).
- Prototipo (scratchpad/proto_unid.py) com cabecalho tolerante: 742 itens, 181-182 mudam de unidade, vazios 77 -> 1; contra o oraculo independente (Procedencia no PDF, 658 itens comparaveis): ata atual = PDF 483 (73,4%), proposta = PDF 630 (95,7%).

## Patch proposto em scripts/artesp_parse.py (linha 26 e 37)
1. Substituir `unid` por busca ancorada no fim do trecho que antecede cada bloco:
   HEAD = (Superintend\w*|Ger[êe]ncia|Diretoria|Assessoria|Ouvidoria|Corregedoria|Procuradoria|Presid[êe]ncia|Gabinete|DIR-\w\w)
   HRE  = (?:^|[.;)\d]\s+|PUBLIQUE-SE\.?\s*)(HEAD[^.]{0,110}?)\.?\s*$   (re.I), aplicada a t[m.start()-170:m.start()].
   Sem exigir ponto final, sigla nem travessao; aceita "Superintendecia", "DIRETORIA DIR-RC", "Presidencia", bare "DIR-RC".
   Limite `[.;)\d]\s+` evita falso positivo "para envio a Superintendencia ... SUROD." (corpo da retirada).
2. `limpa()`: tambem remover rodape `\d\d/\d\d/\d{4}, \d\d:\d\d SEI/GESP - \d+ - DOE: Retifica[çc][ãa]o \(Se[çc][ãa]o 1 - Normativo\)` (esconde cabecalho em ORD1187 211/230).
3. Heranca: manter unidade anterior SO quando nao ha texto nao-reconhecido entre o fim do item anterior e o cabecalho; senao ''.
4. Validacoes (ja passam no prototipo): ORD1182 121-125 SUCOL; ORD1177 26 SUROD, 27-28 Presidencia, 29 SUMEF; ORD1180 87-89 SUROD; ORD1183 133-134 SUINV; ORD1193 342 DIR-RC; ORD1213 SUPEP 36 -> 3.
5. Cadeia (sem rodar rodar_tudo.sh): python3 -I scripts/artesp_parse.py artesp_inventario.json texto_artesp artesp.json ; python3 -I scripts/artesp_ajustes.py artesp.json artesp_conciliacao.json texto_artesp_ocr artesp_final.json. (Nao rodar artesp_conciliar: precisa fonte/artesp.) Conferir diff: so `unidade` muda; votos/resultados identicos.

## R-5 (documentar)
artesp_final.json nao tem chave `nao_feito`. Adicionar em artesp_ajustes.py (ou pos-processo) `nao_feito` com a linha: 39 deliberacoes CANCELADA (nao votada) sem linhas de voto (decisao de desenho; os 2 RETIRADO DE PAUTA tem 4 SEM VOTO); acao: manter / decidir convencao.

## Fora do alcance
Nao editar build_xlsx.py, temas.py, taxonomia.py, qa_completude.py, agencias.py, rodar_tudo.sh, README, MAPEAMENTO, dashboard. Sem commit. Nao existem scripts de auditoria/varredura para ANM/ARTESP (so ana/anac/anatel/ancine/aneel/ans/antaq/antt).
