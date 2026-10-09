#!/bin/bash
# ANTT (Diretoria Colegiada): pipeline completo, da raiz da pasta. Incremental (baixa só o que falta; OCR só dos PDFs-imagem ainda sem texto).
# Passos: listagem paginada -> download (sha256) -> pdftotext -> OCR dos votos em imagem (RapidOCR) -> parse das atas (+ revisão curada, cruzamento com os votos em PDF,
# pendências com URL) -> auditoria independente. O antt_parse.py já chama antt_votos_pdf + antt_finalizar quando antt_revisao.json existe, então o
# rodar_tudo.sh (que só chama antt_parse) produz o mesmo antt.json; o OCR é o único passo que o rodar_tudo.sh não faz (usa o que já está em texto_antt_ocr/).
set -e
python3 -I scripts/antt_inventario.py antt_inventario.json
python3 -I scripts/antt_baixar.py antt_inventario.json manifesto_antt.json fonte/antt
python3 -I scripts/antt_extrair.py manifesto_antt.json texto_antt
python3 -I scripts/antt_ocr_lote.py manifesto_antt.json 3 150
python3 -I scripts/antt_parse.py manifesto_antt.json antt.json
python3 -I scripts/antt_auditoria.py antt.json antt_antes_ocr.json manifesto_antt.json antt_votos_pdf.json antt_revisao.json | head -4
