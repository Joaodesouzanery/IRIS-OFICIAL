# Demo Toggle e Hardening Supabase

Este documento explica o que foi implementado para separar dados demo de dados reais e endurecer a entrada em producao.

## O que mudou

- A sidebar agora tem um botao `DEMO`.
- Quando `DEMO` esta ligado, o frontend envia `x-iris-demo: 1` nas chamadas de API.
- `GET` com demo ligado retorna dados demonstrativos.
- `POST`, `PATCH`, `PUT` e `DELETE` com demo ligado retornam `403`.
- Dados reais em `GET /api/v1/*` exigem login Supabase quando as variaveis reais estiverem configuradas.
- Escritas administrativas exigem usuario permitido em `admin_users` ou e-mail listado em `ADMIN_EMAILS`.
- Crons aceitam apenas `Authorization: Bearer <CRON_SECRET>`.

## Exemplos no codigo

### Estado global do DEMO

Arquivo: `src/hooks/useDataSync.ts`

```ts
const DEMO_KEY = "iris_demo_enabled";

const [demoEnabled, setDemoEnabledState] = useState<boolean>(readDemo);

const setDemoEnabled = useCallback((enabled: boolean) => {
  setDemoEnabledState(enabled);
  localStorage.setItem(DEMO_KEY, enabled ? "1" : "0");
  queryClient.invalidateQueries();
}, [queryClient]);
```

Em linguagem simples: o sistema guarda no navegador se o demo esta ligado e atualiza todas as consultas quando o usuario alterna.

### Header enviado para a API

Arquivo: `src/lib/api.ts`

```ts
if (typeof window !== "undefined" && localStorage.getItem("iris_demo_enabled") === "1") {
  headers.set("x-iris-demo", "1");
}
```

Em linguagem simples: cada request avisa ao backend quando o usuario quer ver dados demo.

### Bloqueio de escrita em modo demo

Arquivo: `src/lib/server/request-guards.ts`

```ts
export function isDemoWriteBlocked(req: NextRequest): NextResponse | null {
  if (!isDemoRequest(req)) return null;
  return NextResponse.json(
    { error: "Modo DEMO e somente leitura. Desligue o DEMO para gravar dados reais." },
    { status: 403 },
  );
}
```

Em linguagem simples: mesmo se alguem tentar burlar o botao pelo navegador, o servidor nao grava nada quando o header de demo esta presente.

### Protecao das leituras reais

Arquivo: `middleware.ts`

```ts
if (isDemoRequest || req.method !== "GET") return NextResponse.next();

const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
if (!token) {
  return NextResponse.json({ error: "Login obrigatorio para consultar dados reais" }, { status: 401 });
}
```

Em linguagem simples: consulta demo e publica; consulta real precisa de login. Depois o middleware valida o token no Supabase e confere se o usuario esta autorizado.

### Admins e RLS

Arquivo: `supabase/migrations/010_admin_auth_rls_hardening.sql`

```sql
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','viewer')),
  active BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
```

Em linguagem simples: existe uma tabela para dizer quais usuarios podem administrar o sistema. A RLS fica ligada e o acesso amplo fica restrito ao `service_role`.

## Pontos de producao

Deploy realizado:

- Producao: `https://iris-oficial.vercel.app`
- Smoke test em `GET /api/v1/system/status`: respondeu `is_demo: true`, ou seja, o Vercel ainda nao tem as variaveis Supabase reais configuradas.

Variaveis obrigatorias no Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_EMAILS`
- `CRON_SECRET`

Depois de configurar as variaveis e aplicar as migrations, `/api/v1/system/status` deve retornar `is_demo: false`.

## QA executado localmente

- `npm.cmd run type-check`: passou.
- `npm.cmd run build`: passou.
- `npm.cmd audit --omit=dev`: restou risco critico em `next@14.2.20`, cuja correcao indicada pelo npm e migrar para `next@16.2.6` com `npm audit fix --force`. Essa migracao e maior e deve ser tratada em um bloco separado com QA completo.

## O que ainda depende de ambiente externo

- Aplicar a migration `010_admin_auth_rls_hardening.sql` no Supabase real.
- Criar o primeiro usuario em `admin_users` ou preencher `ADMIN_EMAILS`.
- Configurar as variaveis no Vercel.
- Fazer deploy de producao.
- Rodar smoke test em `https://iris-oficial.vercel.app`.
