import { describe, it, expect, vi, beforeEach } from "vitest";

// Isola o contrato da rota: mocka só o guard de auth. getRuntimeStatus roda de verdade
// (lê env; o teste só verifica presença/ausência das chaves has_*, não os valores).
vi.mock("@/lib/server/request-guards", () => ({
  getAuthenticatedUser: vi.fn(),
}));

import { NextRequest, NextResponse } from "next/server";
import { GET } from "@/app/api/v1/system/status/route";
import { getAuthenticatedUser } from "@/lib/server/request-guards";

const mockedGetUser = vi.mocked(getAuthenticatedUser);

function makeReq(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v1/system/status", { headers });
}

describe("GET /system/status — contrato 'sempre 200' + has_* gateado por auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("NUNCA vira 500 quando getAuthenticatedUser lança (estado degradado sem service_role)", async () => {
    // Regressão SEC-11: createSupabaseServerClient() lança quando falta a env; a rota
    // pública de diagnóstico não pode virar 500 — deve tratar como anônimo e devolver 200.
    mockedGetUser.mockRejectedValue(new Error("SUPABASE_SERVICE_ROLE_KEY ausente"));
    const res = await GET(makeReq({ authorization: "Bearer x" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.has_service_role_key).toBeUndefined();
    expect(body.has_cron_secret).toBeUndefined();
  });

  it("anônimo (guard devolve 401) → 200 sem os booleans de segredo", async () => {
    mockedGetUser.mockResolvedValue(NextResponse.json({ error: "x" }, { status: 401 }));
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.has_service_role_key).toBeUndefined();
    expect(body.has_cron_secret).toBeUndefined();
  });

  it("autenticado (guard devolve usuário) → 200 com os booleans presentes", async () => {
    mockedGetUser.mockResolvedValue({ id: "u1", email: "a@b.com" });
    const res = await GET(makeReq({ authorization: "Bearer valid" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("has_service_role_key");
    expect(body).toHaveProperty("has_cron_secret");
  });
});
