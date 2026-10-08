#!/bin/bash
# ANATEL: pipeline completo (da raiz da pasta). Chromium so e necessario no passo 1 (formulario JS do SEI Publicacoes).
set -e
export NODE_PATH=/opt/node-tools/node_modules
D=${1:-08/10/2026}
python3 -I scripts/anatel_inventario.py anatel_inventario.json fonte/anatel
mkdir -p fonte/anatel/listas
node scripts/anatel_sei.cjs fonte/anatel/listas/sei_listas.json 01/01/2026 "$D" 8:Acordao 229:AtaReuniao 432:PautaReuniao 187:AtaCircuito 188:PautaCircuito 94:Voto
node scripts/anatel_sei.cjs fonte/anatel/listas/sei_analise.json 01/01/2026 "$D" 7:Analise
python3 -I scripts/anatel_baixar.py fonte/anatel/listas/sei_listas.json manifesto_anatel.json fonte/anatel
python3 -I scripts/anatel_baixar.py fonte/anatel/listas/sei_analise.json manifesto_anatel.json fonte/anatel
python3 -I scripts/anatel_txt.py manifesto_anatel.json texto_anatel
python3 -I scripts/anatel_parse.py manifesto_anatel.json anatel.json
