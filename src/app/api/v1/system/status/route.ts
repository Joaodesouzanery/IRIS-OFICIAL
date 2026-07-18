import { NextRequest, NextResponse } from "next/server";
import { getRuntimeStatus } from "@/lib/server/runtime-status";
import { getAuthenticatedUser } from "@/lib/server/request-guards";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userDemo =
    req.headers.get("x-iris-demo") === "1" ||
    req.nextUrl.searchParams.get("demo") === "1";

  // A postura de segredos (has_service_role_key/has_cron_secret) só vai para chamadas
  // AUTENTICADAS — esta rota é pública (bypass do middleware) e não deve revelar a config
  // do deploy a anônimos. Sem Bearer, `getAuthenticatedUser` retorna 401 SEM tocar o DB
  // (short-circuit), então o poll anônimo do useDataSync não paga custo extra; a página de
  // monitoramento chama com Bearer (via api.get) e recebe os campos completos.
  //
  // try/catch OBRIGATÓRIO: em estado degradado (sem SUPABASE_SERVICE_ROLE_KEY/URL), com um
  // Bearer presente, `createSupabaseServerClient()` LANÇA. Este endpoint público existe
  // justamente para DIAGNOSTICAR esses estados, então NUNCA pode virar 500 — o throw é
  // tratado como "não autenticado" (omite os has_*) e o contrato "sempre 200 com o runtime
  // status" é preservado.
  let authenticated = false;
  try {
    const auth = await getAuthenticatedUser(req);
    authenticated = !(auth instanceof NextResponse);
  } catch {
    authenticated = false;
  }
  return NextResponse.json(getRuntimeStatus(userDemo, authenticated));
}
