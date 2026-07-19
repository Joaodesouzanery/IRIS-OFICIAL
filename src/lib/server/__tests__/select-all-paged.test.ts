import { describe, it, expect, vi } from "vitest";
import { selectAllPaged } from "@/lib/server/select-all-paged";

// Factory que simula um builder PostgREST paginável por `.range(from, to)`.
function fakeQuery(all: unknown[]) {
  return () => ({
    range: (from: number, to: number) => Promise.resolve({ data: all.slice(from, to + 1), error: null }),
  });
}

describe("selectAllPaged — paginação anti-subcontagem (PERF-4)", () => {
  it("concatena múltiplas páginas até esgotar", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => ({ i }));
    const { rows, error, truncated } = await selectAllPaged<{ i: number }>(fakeQuery(all), { pageSize: 1000 });
    expect(error).toBeNull();
    expect(truncated).toBe(false);
    expect(rows).toHaveLength(2500);
    expect(rows[2499]).toEqual({ i: 2499 });
  });

  it("página única (< pageSize) retorna tudo sem outra chamada", async () => {
    const all = Array.from({ length: 42 }, (_, i) => ({ i }));
    const { rows, truncated } = await selectAllPaged(fakeQuery(all), { pageSize: 1000 });
    expect(rows).toHaveLength(42);
    expect(truncated).toBe(false);
  });

  it("respeita o teto maxRows e AVISA (truncated=true, nunca corta em silêncio)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const all = Array.from({ length: 5000 }, (_, i) => ({ i }));
    const { rows, truncated } = await selectAllPaged(fakeQuery(all), { pageSize: 1000, maxRows: 2000 });
    expect(truncated).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(2000);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("propaga erro da query e devolve o que já leu", async () => {
    const factory = () => ({ range: () => Promise.resolve({ data: null, error: { message: "boom" } }) });
    const { rows, error } = await selectAllPaged(factory);
    expect(error).toEqual({ message: "boom" });
    expect(rows).toHaveLength(0);
  });
});
