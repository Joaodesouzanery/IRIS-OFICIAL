# ANAC 2026: plano de execucao (plan mode ativo; nada editado/rodado alem de leitura)

Bloqueio: o harness esta em plan mode, que proibe edicoes e comandos de escrita. O pedido diz "run de execucao".
Nao executei nada; o plano anterior (agent-abc3f90cb59b61375.md) continua valido. Aprovar a saida do plan mode para executar.

## Achado de leitura
- "Tiago Sousa Pereira" aparece nas atas como "ausente justificadamente o Diretor Tiago Sousa Pereira" (13 atas), ao lado do
  Diretor-Presidente Tiago Chagas Faierstein. Verificar nas atas se e quarto nome de colegiado real ou variacao/erro de
  nome; e a unica linha so-AUSENTE (13/0). Conferir contra a lista oficial de diretores antes de manter.
- anac.json.diretores lista 5 nomes (sem Nascimento, Altoe, Tiago Sousa Pereira); pendencia RE16 item 3 ja registrada com URL
  (certidao da 14a RDE ligada no lugar da RE16).

## Execucao (apos sair do plan mode)
1. anac_baixar.py incremental (cookie jar + retry) para RD5, REX2, RD6, RE30, RD7, RE31, RE32.
2. anac_parse.py --autoteste e parse completo; conferir vencidos, abstencoes, impedimentos, ressalvas, partes, vistas (RE6/RE7 item 1).
3. Fins de mandato Nascimento (22/03?) e Altoe (24/04?) nas atas; resolver Tiago Sousa Pereira.
4. RE16 item 3: corrigir link se houver certidao correta; senao manter pendencia.
5. anac_varredura.py (100%) e anac_auditoria.py anac.json 44 2026 (>=95%), corrigir e repetir.
6. Relatorio antes x depois (428 votos: 114/314/0) por proveniencia e diretor, taxas, pendencias com URL.
