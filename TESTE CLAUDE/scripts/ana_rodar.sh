#!/bin/bash
# ANA (Diretoria Colegiada): pipeline completo, da raiz da pasta. Sem Chromium: as listagens sao HTML estatico (iframe www2/resolucoes).
# Os PDFs ficam em arquivos.ana.gov.br (exige liberar o host no egress); sem eles o ana.json sai SEM votos e com pendencias.
set -e
export NODE_PATH=/opt/node-tools/node_modules
python3 -I scripts/ana_inventario.py ana_inventario.json fonte/ana
python3 -I scripts/ana_baixar.py ana_inventario.json manifesto_ana.json fonte/ana
mkdir -p texto_ana
for f in fonte/ana/pdf/*.pdf; do [ -f "$f" ] && pdftotext -layout "$f" "texto_ana/$(basename "${f%.pdf}").txt"; done || true
python3 -I scripts/ana_parse.py ana_inventario.json manifesto_ana.json ana.json
python3 -I scripts/ana_auditoria.py ana.json
