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
# ANPD (circuitos deliberativos; ata + votos)
python3 -I scripts/anpd_baixar.py anpd_inventario.json manifesto_anpd.json fonte/anpd
for f in fonte/anpd/*-ata.pdf; do pdftotext -layout "$f" "texto_anpd/$(basename "$f" .pdf).txt"; done   # cd-02/cd-04 sao imagem: python3 -I scripts/ocr_pdf.py <pdf> texto_anpd_ocr/<nome>.txt
python3 -I scripts/anpd_parse.py manifesto_anpd.json anpd.json
# ANVISA (atas das ROP/REP; listagem Volto com JSON embutido)
python3 -I scripts/anvisa_baixar.py anvisa_inventario.json manifesto_anvisa.json fonte/anvisa
for f in fonte/anvisa/*_ata.pdf; do pdftotext -layout "$f" "texto_anvisa/$(basename "$f" .pdf).txt"; done
python3 -I scripts/anvisa_parse.py manifesto_anvisa.json anvisa.json
# ANVISA Circuitos Deliberativos: extratos com tabela NOMINAL de votos (API Volto devolve os 940 de uma vez; a listagem do site pagina de 25 em 25)
python3 -I scripts/anvisa_cd_baixar.py anvisa_cd_inventario.json manifesto_anvisa_cd.json fonte/anvisa_cd
python3 -I scripts/anvisa_cd_parse.py manifesto_anvisa_cd.json anvisa_cd.json
python3 -I scripts/anvisa_unir.py anvisa.json anvisa_cd.json anvisa_final.json   # item de ROP decidido por CD usa a tabela nominal do extrato
# ANP (atas PDF da Diretoria Colegiada)
python3 -I scripts/anp_baixar.py anp_inventario.json manifesto_anp.json fonte/anp texto_anp
python3 -I scripts/anp_parse.py manifesto_anp.json anp.json
# ANTAQ (acervo Sophia + SEI público via Chromium; gov.br só tem ROD610 e ROD615)
python3 -I scripts/antaq_baixar.py antaq_inventario.json manifesto_antaq.json fonte/antaq
python3 -I scripts/antaq_parse.py manifesto_antaq.json antaq.json
# ANATEL (SEI Publicações via Chromium; pipeline completo em scripts/anatel_rodar.sh)
bash scripts/anatel_rodar.sh
# ANEEL (Dados Abertos CKAN + calendário gov.br; atas em PDF bloqueadas pelo Cloudflare)
python3 -I scripts/aneel_baixar.py
python3 -I scripts/aneel_parse.py manifesto_aneel.json aneel.json
# Temas: regras (taxonomia do repo) + revisão por IA só nos itens de baixa confiança
python3 -I scripts/temas.py            # grava temas.json e temas_revisao_pendente.json (itens que ainda precisam de IA)
# Se temas_revisao_pendente.json não estiver vazio: classificar esses itens (subagentes Claude, taxonomia_fechada.json),
# salvar em temas_ia/resultado_N.json e rodar:  python3 -I scripts/temas.py --importar-ia temas_ia && python3 -I scripts/temas.py
python3 -I scripts/build_xlsx.py       # também atualiza a aba 'Pendências da fonte' e pendencias_historico.json
python3 -I scripts/build_html.py       # dashboard votos_2026.html (+_artifact); falha se o HTML divergir do xlsx
python3 -I scripts/qa_completude.py --online   # QA de completude (ANPD, ANVISA): sai com erro se algo divergir sem pendência explicada
