# TESTE CLAUDE

Pasta de trabalho da coleta independente de votos 2026 (ANM, ANTT, ARTESP).

## Status (2026-10-06)
**BLOQUEADO NA COLETA.** A política de rede do ambiente (proxy de saída) negou com 403 no CONNECT os três hosts:

- `www.gov.br` (ANM — atas da ROP)
- `portal.antt.gov.br` (ANTT — reuniões da diretoria)
- `www.artesp.sp.gov.br` (ARTESP — reuniões da diretoria)

Nenhum documento foi baixado, então **não existe nenhum dado, voto ou Excel ainda**. Nada aqui afirma completude de 2026.

## Para destravar
Em *Network access* do ambiente (menu do ambiente no título da sessão → Edit), usar acesso mais amplo ou
`Custom` com estes domínios em *Allowed domains*, mantendo a lista padrão de gerenciadores de pacote:
`www.gov.br`, `portal.antt.gov.br`, `www.artesp.sp.gov.br`, e `admin.cms.sp.gov.br` (links DAM de PDF/ZIP da ARTESP).
Passos: https://code.claude.com/docs/en/cloud-environments#network-access

## Estrutura preparada
- `scripts/` — scripts de inventário, download e extração (a escrever após o desbloqueio)
- `fonte/{anm,antt,artesp}/` — destino dos documentos baixados
- saída prevista: `votos_2026.xlsx` e `ANALISE_MELHORIAS.md` (ver plano aprovado)
