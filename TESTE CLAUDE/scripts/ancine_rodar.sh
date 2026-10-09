#!/bin/bash
# ANCINE (Diretoria Colegiada): pipeline completo (da raiz da pasta). Sem Chromium: a fonte e o SEI Publicacoes (HTML estatico, sem captcha, com contador oficial).
# 1) inventario (listagem paginada por serie, com prova contador oficial x percorrido x soma mensal) 2) download + sha256 + texto
# 3) parser -> ancine.json 4) auditoria (cartoes, texto antes do JSON) 5) varredura 100% independente (nao importa o parser; sai com erro se divergir)
# Incremental: o download pula o que ja existe em fonte/ancine/doc. gov.br/ancine (Volto) so tem links para o SEI e a ultima/proxima reuniao.
set -e
python3 -I scripts/ancine_inventario.py ancine_inventario.json fonte/ancine
python3 -I scripts/ancine_baixar.py ancine_inventario.json manifesto_ancine.json fonte/ancine texto_ancine
python3 -I scripts/ancine_parse.py manifesto_ancine.json ancine_inventario.json ancine.json
python3 -I scripts/ancine_auditoria.py ancine.json 44 2026 > /dev/null
python3 -I scripts/ancine_varredura.py ancine.json ancine_inventario.json
