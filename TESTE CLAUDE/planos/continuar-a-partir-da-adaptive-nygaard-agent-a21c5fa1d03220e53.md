# Plano ANCINE (retomada)

Estado em disco (git limpo para ancine*, scripts/ancine*, manifesto_ancine.json; ancine.json 12:15 e parser 12:11 ja reprocessados e commitados em cc1983e):
- (1) RD969 DDC 1016-E: relator = Patricia Barcelos (relator_fonte = manifestacao propria), voto Patricia = RELATOR nominal. FEITO.
- (2) RD969 DDC 1007 e RD970 DDC 1098: Alex e Patricia = SEM VOTO (maioria sem nomes) REVISAR com motivo "restam so 2 votantes"; Paulo IMPEDIDO nominal. FEITO.
- (3) Circuitos CD1..CD8: data = decisao, data_abertura = abertura (CD1 03/03<-10/02, CD5 11/05<-17/04, CD6 14/08<-28/07) em reunioes, deliberacoes e votos. FEITO.

Falta (so execucao, bloqueada pelo plan mode):
1. Scratch dir: copiar os JSON (ancine.json, demais agencias) e rodar build_xlsx.py/build_html.py/qa_completude.py de la, sem editar scripts, para provar que `data_abertura` nao quebra a agregacao mensal.
2. `bash scripts/ancine_rodar.sh` (idempotente) e conferir varredura 100%.
3. Auditoria independente (script em scratchpad, python3 -I) dos 3 itens + 8 circuitos; relatorio antes x depois por rotulo/proveniencia.
Sem commit; sem editar build_xlsx/temas/taxonomia/qa_completude/agencias/rodar_tudo/README/MAPEAMENTO/dashboard.
