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
  currentBreath: 5,
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

  it("STEP 1 tile — queued in PendingActions", async () => {
    const result = await validateAndQueueMovement(42, "STEP", 1, 0);
    expect(result.ok).toBe(true);
    expect(createPendingAction).toHaveBeenCalledOnce();
    expect(createPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: "STEP", targetGridX: 1, targetGridY: 0 })
    );
  });

  it("STEP over max range (2 tiles) is rejected", async () => {
    const result = await validateAndQueueMovement(42, "STEP", 2, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("OUT_OF_RANGE");
    expect(createPendingAction).not.toHaveBeenCalled();
  });

  it("HOP 3 tiles — has breath (5 ≥ 3), queued", async () => {
    const result = await validateAndQueueMovement(42, "HOP", 3, 0);
    expect(result.ok).toBe(true);
    expect(createPendingAction).toHaveBeenCalledOnce();
  });

  it("HOP 4 tiles over max range — rejected", async () => {
    const result = await validateAndQueueMovement(42, "HOP", 4, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("OUT_OF_RANGE");
    expect(createPendingAction).not.toHaveBeenCalled();
  });

  it("HOP 3 tiles without enough breath — rejected early", async () => {
    vi.mocked(getFrogByOwnerId).mockResolvedValue({ ...mockFrog, currentBreath: 1 } as any);
    const result = await validateAndQueueMovement(42, "HOP", 3, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_MOVE");
    expect(createPendingAction).not.toHaveBeenCalled();
  });

  it("SWIM from open water — straight line, enough breath, queued", async () => {
    // Frog is standing on a river tile
    vi.mocked(getFrogByOwnerId).mockResolvedValue({ ...mockFrog, gridX: 0, gridY: 0 } as any);
    // terrainWith sets target tile, but loadTileChar queries frog's position (0,0)
    // We need the chunk for frog position to be water.
    vi.mocked(getChunksByCoords).mockResolvedValue(terrainWith("~", 0, 0) as any);
    const result = await validateAndQueueMovement(42, "SWIM", 3, 0);
    expect(result.ok).toBe(true);
    expect(createPendingAction).toHaveBeenCalledOnce();
  });

  it("SWIM from land — rejected", async () => {
    vi.mocked(getChunksByCoords).mockResolvedValue(terrainWith("#", 0, 0) as any);
    const result = await validateAndQueueMovement(42, "SWIM", 3, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_MOVE");
    expect(createPendingAction).not.toHaveBeenCalled();
  });

  it("SWIM arbitrary angle — queued if frog is in water and has breath", async () => {
    vi.mocked(getChunksByCoords).mockResolvedValue(terrainWith("~", 0, 0) as any);
    // (0,0) → (2,1): not a cardinal/diagonal direction, but valid for swim
    const result = await validateAndQueueMovement(42, "SWIM", 2, 1);
    expect(result.ok).toBe(true);
    expect(createPendingAction).toHaveBeenCalledOnce();
  });
});
