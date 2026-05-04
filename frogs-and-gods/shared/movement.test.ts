import { describe, it, expect } from "vitest";
import { calculateRemainingMove } from "./movement";

const defaultStats = { dex: 10 }; // budget = 5 + floor(10/2) = 10

describe("calculateRemainingMove", () => {
  it("rejects HOP onto Water (cost 5×3=15 > budget 10)", () => {
    const result = calculateRemainingMove("HOP", defaultStats, "#", "≈");
    expect(result.legal).toBe(false);
    expect(result.cost).toBe(15);
  });

  it("accepts HOP onto Lily Pad (cost 1×3=3 ≤ budget 10)", () => {
    const result = calculateRemainingMove("HOP", defaultStats, "#", "@");
    expect(result.legal).toBe(true);
    expect(result.cost).toBe(3);
    expect(result.remaining).toBe(7);
  });

  it("accepts STEP onto Land (cost 2×1=2 ≤ budget 10)", () => {
    const result = calculateRemainingMove("STEP", defaultStats, "#", "#");
    expect(result.legal).toBe(true);
    expect(result.cost).toBe(2);
  });

  it("accepts STEP onto Water (cost 5×1=5 ≤ budget 10) — frogs can wade", () => {
    const result = calculateRemainingMove("STEP", defaultStats, "#", "≈");
    expect(result.legal).toBe(true);
    expect(result.cost).toBe(5);
  });

  it("high-DEX frog (dex=30, budget=20) can HOP onto Water (15 ≤ 20)", () => {
    const result = calculateRemainingMove("HOP", { dex: 30 }, "#", "≈");
    expect(result.legal).toBe(true);
    expect(result.remaining).toBe(5);
  });
});
