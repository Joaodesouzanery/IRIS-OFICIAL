import { describe, it, expect, vi, afterEach } from "vitest";
import { resilientFetch, FetchFailureError } from "@/lib/server/resilient-fetch";

function makeResponse(status: number, headers: Record<string, string> = {}, body = ""): Response {
  return new Response(body, { status, headers });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// SEC-8: o `fetch` default segue redirects automaticamente; um host público que
// responda 302 → IP interno/metadata vazaria dados internos. `resilientFetch` agora
// segue os redirects MANUALMENTE, revalidando cada destino com `assertPublicUrl`.
describe("resilientFetch — redirects revalidados (anti-SSRF por redirect)", () => {
  it("segue redirect para host público e retorna a resposta final", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(302, { location: "https://www.gov.br/anac/final" }))
      .mockResolvedValueOnce(makeResponse(200, {}, "ok"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await resilientFetch("https://www.gov.br/anac/inicio", { retries: 0 });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // cada hop é feito com redirect: "manual" (não deixa o runtime seguir sozinho)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("bloqueia redirect para IP de metadata de nuvem (169.254.169.254) sem segui-lo", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(302, { location: "http://169.254.169.254/latest/meta-data/" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resilientFetch("https://redirecionador.example.com/x", { retries: 0 })).rejects.toMatchObject({
      kind: "falha_conteudo", // definitivo: não adianta retentar um redirect malicioso
    });
    // NÃO fez o 2º fetch — não seguiu para o endereço interno
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bloqueia redirect para rede privada (RFC1918)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(301, { location: "http://10.0.0.5/admin" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resilientFetch("https://portal.example.com/x", { retries: 0 })).rejects.toBeInstanceOf(
      FetchFailureError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborta cadeia de redirects longa demais (loop) como falha definitiva", async () => {
    // Sempre 302 para outro host público → estoura o teto de hops (não trava).
    let n = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      n += 1;
      return makeResponse(302, { location: `https://hop-${n}.example.com/next` });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(resilientFetch("https://start.example.com/x", { retries: 0 })).rejects.toMatchObject({
      kind: "falha_conteudo",
    });
    // teto de 5 hops → no máximo 6 chamadas (inicial + 5), sem loop infinito
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
