import { describe, it, expect } from "vitest";
import { msLeft, hasBudget, budgetRetries } from "@/lib/server/time-budget";

describe("time-budget", () => {
  it("sem deadline = orçamento infinito (comportamento legado)", () => {
    expect(msLeft(undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(hasBudget(undefined, 999_999)).toBe(true);
    expect(budgetRetries(undefined, 20_000)).toBe(2);
  });

  it("hasBudget respeita a reserva", () => {
    const daqui10s = Date.now() + 10_000;
    expect(hasBudget(daqui10s, 5_000)).toBe(true);
    expect(hasBudget(daqui10s, 15_000)).toBe(false);
  });

  it("deadline no passado = sem orçamento", () => {
    const passado = Date.now() - 1_000;
    expect(hasBudget(passado, 0)).toBe(false);
    expect(msLeft(passado)).toBeLessThan(0);
  });

  it("budgetRetries escala com o saldo (2 → 1 → 0)", () => {
    const attempt = 10_000;
    expect(budgetRetries(Date.now() + 40_000, attempt)).toBe(2); // > 3×
    expect(budgetRetries(Date.now() + 25_000, attempt)).toBe(1); // > 2×
    expect(budgetRetries(Date.now() + 15_000, attempt)).toBe(0); // apertado
    expect(budgetRetries(Date.now() - 1, attempt)).toBe(0);
  });
});
