# TESTE CLAUDE
Coleta independente de votos 2026 (ANM, ANTT, ARTESP). Entregáveis: `votos_2026.xlsx` e `ANALISE_MELHORIAS.md`.

## Status (06/10/2026)
- **ANM**: ROP 85–88 coletadas e lidas (1 por OCR). Atas 81–84 e 89 não estão no site.
- **ANTT**: 64 reuniões deliberativas de 2026 baixadas (406 documentos, hashes em `manifesto_antt.json`).
- **ARTESP**: **bloqueada** pelo Imperva/Incapsula; sem dados.
- Rede: os três hosts agora respondem HTTP 200 (o bloqueio do proxy anterior acabou).

## Reproduzir
`python3 -I scripts/antt_inventario.py antt_inventario.json` → `antt_baixar.py` → `pdftotext` → `antt_parse.py` / `anm_parse.py` → `build_xlsx.py`.
`fonte/` e `texto_antt/` não são versionados (122 MB); os hashes estão no manifesto.
