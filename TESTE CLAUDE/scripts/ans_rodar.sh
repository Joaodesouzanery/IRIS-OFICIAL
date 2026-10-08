#!/bin/bash
# ANS (Diretoria Colegiada/DICOL): pipeline completo (da raiz da pasta). Sem Chromium: as fontes abertas sao HTML estatico + PDF.
# 1) inventario (listagem paginada de noticias + sementes testadas ao vivo) 2) download + sha256 + pdftotext 3) parser -> ans.json 4) auditoria (cartoes)
# A pasta oficial de atas (reunioes-da-diretoria-da-ans) e restrita e componentes-portal.ans.gov.br/www.ans.gov.br estao fora da allowlist:
# se forem liberados/publicados, acrescente os PDFs de ata em seeds_pdf de ans_inventario.py e rode de novo.
set -e
python3 -I scripts/ans_inventario.py ans_inventario.json fonte/ans
python3 -I scripts/ans_baixar.py ans_inventario.json manifesto_ans.json fonte/ans texto_ans
python3 -I scripts/ans_parse.py manifesto_ans.json ans_inventario.json ans.json
python3 -I scripts/ans_auditoria.py ans.json 44 2026 > /dev/null
