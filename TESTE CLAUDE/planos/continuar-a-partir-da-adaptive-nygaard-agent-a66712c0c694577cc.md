# Plano: corrigir ANM D-1..D-8/R-1/R-2 e ARTESP D-9 (retomada)

## Estado em disco (verificado, somente leitura)
- scripts/anm_parse.py (modificado, nao commitado) ja contem: presentes() corta quem saiu (D-6); ausentes_ata (R-1);
  retirada por "Diretor-Geral/Revisor" (D-3); "voto contrario do X" (D-2); vista via primeiro nome (D-4); _dissidentes da narrativa (D-1/D-8);
  DIVERGIU do relator/revisor (D-2/D-7); ALIAS de nomes (R-2).
- anm.json ja regenerado: ROP85 1.4.1/1.5.1 Mauro = DIVERGIU; ROP86 1.1.1 Jose Fernando e Luiz = DIVERGIU, Mauro REVISOR;
  REP32 Luiz relator = AUSENTE (hospitalizado) em 11 votos; nenhum "ex-diretor" restante para Luiz.
- ARTESP (artesp_parse.py, artesp_final.json) NAO tocado: D-9 pendente.

## A fazer (apos sair do plan mode)
1. ANM: rerodar anm_parse.py, conferir via script invariantes (vencido nomeado => DIVERGIU; ausente => AUSENTE; retirados => SEM VOTO;
   Tasso vista REP32 3.3.1/1.3.1, REP33 3.4.1; REP34 2.7.1 vista so Jose Fernando; REP31 3.1.1 Roger DIVERGIU; REP32 7 itens retirados).
   Tabela antes x depois por rotulo/proveniencia (antes: git show HEAD:anm.json).
2. ARTESP D-9: em artesp_parse.py afrouxar regex `unid` (cabecalho sem ponto final, travessao, sem sigla, grafia "Superintendecia",
   DIR-RC), sem herdar unidade quando houver cabecalho nao reconhecido; validar contra ORD1182 121-125 (SUCOL), ORD1177 26-29,
   ORD1180 87-89, ORD1183 133-134, ORD1213 (sem SUPEP), ORD1193 342 (DIR-RC); medir 100 divergentes/72 vazios antes e depois no corpus.
   Regerar artesp.json -> artesp_ajustes.py -> artesp_final.json; checar que votos/resultados nao mudam (so `unidade`).
3. Efeito no xlsx: ler build_xlsx.py (sem editar) para ver uso de `unidade`/PROC_ART; comparar relator/proponente derivado (54 linhas) antes/depois
   por simulacao, sem regenerar o xlsx (nao permitido editar build; rodar build so se for rotina).
4. Rodar auditorias/varreduras existentes (anm/artesp auditoria, qa_completude como leitura) e conferencia cega dos itens alterados.
5. R-5: apenas documentar em nao_feito do JSON ARTESP (39 CANCELADA sem linhas de voto).
6. Sem commit; nao editar build_xlsx/temas/taxonomia/qa_completude/agencias/rodar_tudo/README/MAPEAMENTO/dashboard.
