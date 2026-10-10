# Variáveis de ambiente (somente NOMES — nenhum valor é versionado)

Valores ficam no Vercel/Supabase. Modelo completo: `/.env.example` na raiz. **Nunca commitar `.env.local` ou segredos.**

Relevantes para o módulo Qualidade Regulatória / futuro monitoramento:

| Variável | Uso | Obrigatória hoje p/ este rascunho? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | cliente Supabase | não (rascunho não lê o app) |
| `SUPABASE_SERVICE_ROLE_KEY` | escrita server-side (nunca `NEXT_PUBLIC_`) | não |
| `CRON_SECRET` | Bearer das rotas que rodam como cron (`requireAdminOrCron`) | só na fase de coleta |
| `COLLECTOR_HOST_THROTTLE_MS` | intervalo mínimo por host nos coletores (padrão 900) | só na fase de coleta |
| `IRIS_OWNER_EMAIL`, `ADMIN_EMAILS` | quem é admin | não |

Os scripts de `gerador/` **não usam variável de ambiente** nem acessam o banco.
