# TESTE CLAUDE
Coleta independente de votos 2026 (ANM, ANTT, ARTESP). Entregáveis: `votos_2026.xlsx` e `ANALISE_MELHORIAS.md`.

## Status (06/10/2026)
- **ANM**: ROP 81–88 lidas (87 por OCR). Ata da 89ª ainda não publicada.
- **ANTT**: 64 reuniões deliberativas de 2026 baixadas (406 documentos, hashes em `manifesto_antt.json`).
- **ARTESP**: 56 de 56 atas lidas; conciliadas com 708 PDFs de Deliberação (erros da fonte registrados). Rede liberada para `admin.cms.sp.gov.br` e `*.token.awswaf.com`.
- Rede: os três hosts agora respondem HTTP 200 (o bloqueio do proxy anterior acabou).

## Reproduzir
`python3 -I scripts/antt_inventario.py antt_inventario.json` → `antt_baixar.py` → `pdftotext` → `antt_parse.py` / `anm_parse.py` → `build_xlsx.py`.
`fonte/` e `texto_antt/` não são versionados (122 MB); os hashes estão no manifesto.
`scripts/artesp_fetch.cjs` → `artesp_inventario.py`; `anm_parse.py` lê `texto/*.txt` (atas via subpágina `atas-reunioes-ordinarias`).

Reprodução: `./rodar_tudo.sh`. Conferência manual: `AMOSTRA.md`. Resultado e lacunas: `ANALISE_MELHORIAS.md`.

Temas: `scripts/taxonomia.py`, `scripts/temas.py`, `temas_ia/` (revisão por IA validada), `AMOSTRA_TEMAS.md`. Pendências da fonte: aba "Pendências da fonte".
