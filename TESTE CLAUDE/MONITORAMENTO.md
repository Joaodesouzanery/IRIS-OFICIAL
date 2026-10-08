# Monitoramento de novos documentos e votos — desenho (nada implementado)

## Estado atual (medido no repo)
- Um único cron em `vercel.json` (`/api/v1/noticias/cron`); `monitoramento/check` é manual.
- Tabelas `monitoramento_sites / itens / alertas / runs` (migration 005): dedupe por `hash_item` (sha256), `UNIQUE(site_id, hash_item)`; alertas só na tela `/dashboard/monitoramento`; **sem notificação externa**.
- Coletores de documentos/votos só para ANTT, ANM e ARTESP (`src/lib/server/colegiado-sources.ts`, `monitoring.ts`). As demais agências têm só notícias (`news-sources.ts`).
- Esta pasta (`TESTE CLAUDE/`) roda `rodar_tudo.sh` à mão, de forma incremental (reaproveita `fonte/` e `texto*/`).

## Desenho proposto
1. **Módulo novo no IRIS ("Radar de decisões colegiadas")** reaproveitando `monitoramento_*`: um `site` por agência/fonte; novos tipos de alerta `documento_novo`, `ata_pendente_publicada`, `novos_votos`, `fonte_mudou` (estrutura da página).
2. **Execução fora do Vercel** (GitHub Action agendada ou runner próprio): ARTESP exige Chromium + token WAF; ANM tem ata em imagem (OCR); o Hobby tem teto de função de 60 s. O job roda `rodar_tudo.sh`, compara os manifestos (sha256) e produz o **diff**.
3. **O alerta já traz o conteúdo:** documentos novos, deliberações novas e os votos de cada diretor extraídos (com proveniência), mais `votos_2026.xlsx` e `votos_2026.html` atualizados. Enviado por e-mail/issue e gravado como alerta no módulo.
4. **Pendências vigiadas:** cada linha de `Controle > Pendência da fonte` (ANM 89ª, ANTT 299/300/301/1042/270, ARTESP 243ª) vira item vigiado; ao publicar, muda para "resolvida" e entra no diff.
5. **Frequência sugerida:** diária nos dias de reunião e na semana seguinte (atas saem com atraso); semanal fora disso. Agências futuras entram por conector (ver `MAPEAMENTO_AGENCIAS.md`).
6. **Salvaguardas:** validação da Qualidade (âncoras, presença independente, datas) bloqueia a publicação do diff se falhar; run preso > 10 min marcado como erro (já existe); nada de escrita em produção sem a revisão de itens `REVISAR`.

## Lacunas
Sem notificação externa hoje; defeso eleitoral (até 25/10/2026) afeta só notícias; produção do IRIS não foi auditada contra estes números.
