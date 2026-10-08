#!/bin/bash
# ANA (Diretoria Colegiada): pipeline completo, da raiz da pasta. Sem Chromium: as listagens sao HTML estatico (iframe www2/resolucoes).
# Os PDFs ficam em arquivos.ana.gov.br (host liberado no egress em 08/10/2026: 23 de 23 baixados); sem eles o ana.json sai SEM votos e com pendencias.
# Textos: pdftotext -layout (as 23 PDFs tem camada de texto; OCR nao foi preciso). Parser calibrado nas 11 atas; varredura 100% e auditoria independentes ao final.
set -e
export NODE_PATH=/opt/node-tools/node_modules
python3 -I scripts/ana_inventario.py ana_inventario.json fonte/ana
python3 -I scripts/ana_baixar.py ana_inventario.json manifesto_ana.json fonte/ana
mkdir -p texto_ana
for f in fonte/ana/pdf/*.pdf; do [ -f "$f" ] && pdftotext -layout "$f" "texto_ana/$(basename "${f%.pdf}").txt"; done || true
python3 -I scripts/ana_parse.py ana_inventario.json manifesto_ana.json ana.json
python3 -I scripts/ana_auditoria.py ana.json
python3 -I scripts/ana_varredura.py ana.json | head -1
