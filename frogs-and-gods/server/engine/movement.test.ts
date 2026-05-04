import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validateAndQueueMovement } from "./movement";
import { getFrogByOwnerId, getChunksByCoords, createPendingAction } from "../db";

vi.mock("../db", () => ({
  getFrogByOwnerId:    vi.fn(),
  getChunksByCoords:   vi.fn(),
  createPendingAction: vi.fn(),
}));

const mockFrog = {
  id: 1, ownerId: 42, isDead: false,
  gridX: 0, gridY: 0,
  statsJson: { dex: 10, maxHp: 10, maxMana: 5, str: 5, wis: 5, int: 5, cha: 5 },
};

function terrainWith(char: string, gridX: number, gridY: number) {
  const grid = Array.from({ length: 16 }, () => Array<string>(16).fill("#"));
  grid[((gridY % 16) + 16) % 16][((gridX % 16) + 16) % 16] = char;
  return [{ terrainDataJson: JSON.stringify(grid) }];
}

describe("validateAndQueueMovement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getFrogByOwnerId).mockResolvedValue(mockFrog as any);
    vi.mocked(createPendingAction).mockResolvedValue({ id: 99 } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("HOP 3 spaces onto Lily Pad (@, cost 1) — valid distance, affordable cost, queued in PendingActions", async () => {
    // Chebyshev: max(|3-0|, |0-0|) = 3 ≤ MOVE_MAX_RANGE["HOP"]=3 → valid
    // Cost: 1 × 3 = 3 ≤ budget 10 → legal
    vi.mocked(getChunksByCoords).mockResolvedValue(terrainWith("@", 3, 0) as any);

    const result = await validateAndQueueMovement(42, "HOP", 3, 0);

    expect(result.ok).toBe(true);
    expect(createPendingAction).toHaveBeenCalledOnce();
    expect(createPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "HOP", targetGridX: 3, targetGridY: 0 })
    );
  });

  it("HOP 3 spaces onto Water (≈, cost 5) — distance valid but cost 15 exceeds budget 10, rejected", async () => {
    // Chebyshev: max(|3-0|, |0-0|) = 3 ≤ 3 → valid
    // Cost: 5 × 3 = 15 > budget 10 → illegal
    vi.mocked(getChunksByCoords).mockResolvedValue(terrainWith("≈", 3, 0) as any);

    const result = await validateAndQueueMovement(42, "HOP", 3, 0);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("COST_EXCEEDED");
      expect(result.message).toContain("cost 15");
      expect(result.message).toContain("budget 10");
    }
    expect(createPendingAction).not.toHaveBeenCalled();
  });

  it("HOP attempted over max range (4 tiles) is rejected before tile lookup", async () => {
    // Chebyshev: max(|4-0|, |0-0|) = 4 > MOVE_MAX_RANGE["HOP"]=3 → rejected immediately
    const result = await validateAndQueueMovement(42, "HOP", 4, 0);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("OUT_OF_RANGE");
    expect(getChunksByCoords).not.toHaveBeenCalled();
    expect(createPendingAction).not.toHaveBeenCalled();
  });
});
