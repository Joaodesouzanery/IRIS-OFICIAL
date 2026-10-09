#!/bin/bash
# ANAC: pipeline (da raiz da pasta). Hosts liberados no egress: departamental./santosdumont./www.anac.gov.br (curl com retry: o F5 rejeita ~50%).
# sei.anac.gov.br (atas/votos/certidoes) e pergamum.anac.gov.br seguem bloqueados (CONNECT 403): tentados e registrados em pendencias. CAPTCHA nunca e resolvido.
# anac_fetch.cjs (Chromium em sessao unica) fica como alternativa para as paginas gov.br; nao e necessario para o APEX.
set -e
python3 -I scripts/anac_inventario.py anac_inventario.json fonte/anac
python3 -I scripts/anac_baixar.py anac_inventario.json manifesto_anac.json fonte/anac texto_anac
python3 -I scripts/anac_parse.py --autoteste
python3 -I scripts/anac_parse.py manifesto_anac.json anac_inventario.json anac.json
python3 -I scripts/anac_auditoria.py anac.json 44 2026 > /dev/null
python3 -I scripts/anac_varredura.py anac.json anac_inventario.json fonte/anac manifesto_anac.json
