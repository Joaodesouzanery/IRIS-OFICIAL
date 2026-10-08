#!/usr/bin/env bash
# Reproduz toda a coleta/extracao 2026. Incremental: reaproveita arquivos ja baixados (fonte/ e texto*/).
# Requer: pdftotext, python3 (openpyxl, rapidocr-onnxruntime, pymupdf), node + playwright (Chromium) e rede liberada
# para www.gov.br, portal.antt.gov.br, www.artesp.sp.gov.br, admin.cms.sp.gov.br e *.token.awswaf.com.
set -euo pipefail; cd "$(dirname "$0")"
# ANTT
python3 -I scripts/antt_inventario.py antt_inventario.json
python3 -I scripts/antt_baixar.py antt_inventario.json manifesto_antt.json fonte/antt
python3 -I scripts/antt_extrair.py manifesto_antt.json texto_antt
python3 -I scripts/antt_parse.py manifesto_antt.json antt.json
# ANM: atas em https://www.gov.br/anm/.../atas-da-rop/atas-reunioes-ordinarias (baixar PDFs novos para fonte/anm, pdftotext -> texto/)
python3 -I scripts/anm_parse.py texto anm.json
# ARTESP
node scripts/artesp_fetch.cjs artesp_lista.html
python3 -I scripts/artesp_inventario.py artesp_lista.html artesp_inventario.json
node scripts/artesp_baixar.cjs artesp_inventario.json manifesto_artesp_ata_pauta.json fonte/artesp ata,pauta
node scripts/artesp_baixar.cjs artesp_inventario.json manifesto_artesp_delib.json fonte/artesp delib
for f in fonte/artesp/*/ata.pdf; do t=$(basename "$(dirname "$f")"); pdftotext -layout "$f" "texto_artesp/$t.txt"; done
python3 -I scripts/artesp_parse.py artesp_inventario.json texto_artesp artesp.json
python3 -I scripts/artesp_conciliar.py artesp.json fonte/artesp artesp_conciliacao.json
python3 -I scripts/artesp_ajustes.py artesp.json artesp_conciliacao.json texto_artesp_ocr artesp_final.json
# Temas: regras (taxonomia do repo) + revisão por IA só nos itens de baixa confiança
python3 -I scripts/temas.py            # grava temas.json e temas_revisao_pendente.json (itens que ainda precisam de IA)
# Se temas_revisao_pendente.json não estiver vazio: classificar esses itens (subagentes Claude, taxonomia_fechada.json),
# salvar em temas_ia/resultado_N.json e rodar:  python3 -I scripts/temas.py --importar-ia temas_ia && python3 -I scripts/temas.py
python3 -I scripts/build_xlsx.py       # também atualiza a aba 'Pendências da fonte' e pendencias_historico.json
python3 -I scripts/build_html.py     # gera votos_2026.html (e _artifact.html) a partir do xlsx
