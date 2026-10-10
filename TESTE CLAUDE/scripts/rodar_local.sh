#!/bin/bash
# Roda scripts/<sg>_rodar.sh nesta maquina: sem poppler (usa scripts/bin/pdftotext, PyMuPDF) e com os pacotes do usuario
# (python3 -I os esconde). Uso, da raiz da pasta: bash scripts/rodar_local.sh ans
set -e
sg="$1"; export PATH="$PWD/scripts/bin:$PATH"
sed 's/python3 -I /python3 /g' "scripts/${sg}_rodar.sh" | bash
