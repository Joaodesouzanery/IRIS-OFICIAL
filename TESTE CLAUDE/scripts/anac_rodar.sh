#!/bin/bash
# ANAC: pipeline (da raiz da pasta). Chromium em sessao unica (anac_fetch.cjs) passa o desafio JS do gov.br; captcha nunca e resolvido.
# 2026 so existe no APEX (departamental/santosdumont.anac.gov.br) e no calendario www.anac.gov.br: precisam estar na allowlist do egress.
set -e
python3 -I scripts/anac_inventario.py anac_inventario.json fonte/anac
python3 -I scripts/anac_baixar.py anac_inventario.json manifesto_anac.json fonte/anac texto_anac
python3 -I scripts/anac_parse.py manifesto_anac.json anac_inventario.json anac.json
python3 -I scripts/anac_auditoria.py anac.json 44 2026 > /dev/null
python3 -I scripts/anac_varredura.py anac.json anac_inventario.json fonte/anac
