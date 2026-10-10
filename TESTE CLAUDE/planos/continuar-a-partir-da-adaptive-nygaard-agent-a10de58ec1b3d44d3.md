# Execução ANVISA D1-D8 + reprocessamento ANPD — pendente de saída do modo de plano

Bloqueio: a sessão chegou com o modo de plano ativo (somente leitura), contrariando o pedido de "run de execução".
Nada foi editado em scripts ou dados. O plano de referência continua válido:
/root/.claude/plans/continuar-a-partir-da-adaptive-nygaard-agent-a439fed409ccd206b.md

Ordem ao liberar a execução:
1. Baseline: copiar anpd.json, anvisa.json, anvisa_cd.json, anvisa_final.json para o scratchpad.
2. anpd_parse (confirmar idempotência: 116 votos = ACOMP 75 / RELATOR 29 / SEM VOTO 12).
3. anvisa_cd_parse.py: D1 (nome quebrado), CD573 Thiago em ausentes, QA 940/940 via pdftotext, chave CD 386/2026 única.
4. anvisa_parse.py: varredura dos 441 itens de ROP (D2/D3), D5 ROP2 3.5.7.2, D8 ROP13 3.4.10.4, D4 ROP5 4.1.2.1 / ROP6 3.4.1.1 / ROP9 3.4.3.1.
5. anvisa_unir.py: manter extrato do CD quando existir.
6. Conferência cega (esperado escrito antes de abrir o JSON) e antes×depois por rótulo/proveniência.
