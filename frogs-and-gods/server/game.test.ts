import { describe, expect, it } from "vitest";
import { applyXpToFrog, xpToNextLevel, XP_REWARD_BY_ENEMY_TYPE } from "./engine/xpDistributor";
import {
  GodInterventionSchema,
  PredatorSchema,
} from "../shared/game.schema";

// ─────────────────────────────────────────────
// XP SYSTEM
// ─────────────────────────────────────────────

describe("applyXpToFrog", () => {
  it("adds XP below threshold without leveling", () => {
    const result = applyXpToFrog(0, 1, 25);
    expect(result.newCurrentXp).toBe(25);
    expect(result.newLevel).toBe(1);
    expect(result.leveled).toBe(false);
    expect(result.newXpToNextLevel).toBe(xpToNextLevel(1));
  });

  it("levels up exactly at the threshold and rolls overflow", () => {
    // level 1 needs 100 xp; 90 + 20 = 110 → level 2, 10 carry
    const result = applyXpToFrog(90, 1, 20);
    expect(result.leveled).toBe(true);
    expect(result.newLevel).toBe(2);
    expect(result.newCurrentXp).toBe(10);
    expect(result.newXpToNextLevel).toBe(xpToNextLevel(2));
  });

  it("rolls through multiple levels on a large XP dump", () => {
    // Massive grant: should keep leveling until below the next threshold.
    const result = applyXpToFrog(0, 1, 100_000);
    expect(result.leveled).toBe(true);
    expect(result.newLevel).toBeGreaterThan(5);
    expect(result.newCurrentXp).toBeLessThan(result.newXpToNextLevel);
  });

  it("treats negative/zero amount as a no-op for level", () => {
    const result = applyXpToFrog(50, 3, 0);
    expect(result.newLevel).toBe(3);
    expect(result.newCurrentXp).toBe(50);
    expect(result.leveled).toBe(false);
  });

  it("xpToNextLevel scales with level", () => {
    expect(xpToNextLevel(1)).toBe(100);
    expect(xpToNextLevel(2)).toBeGreaterThan(xpToNextLevel(1));
    expect(xpToNextLevel(10)).toBeGreaterThan(xpToNextLevel(5));
  });
});

describe("XP_REWARD_BY_ENEMY_TYPE", () => {
  it("has an entry for every enemyType", () => {
    expect(XP_REWARD_BY_ENEMY_TYPE.SNAKE).toBeGreaterThan(0);
    expect(XP_REWARD_BY_ENEMY_TYPE.GOLEM).toBeGreaterThan(0);
    expect(XP_REWARD_BY_ENEMY_TYPE.FLY).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────
// ZOD SCHEMAS
// ─────────────────────────────────────────────

describe("game.schema — GodInterventionSchema", () => {
  it("accepts HEAL_FROG intervention", () => {
    const result = GodInterventionSchema.safeParse({
      chunkX: 0,
      chunkY: 0,
      interventionType: "HEAL_FROG",
      targetFrogId: 3,
      magnitude: 25,
    });
    expect(result.success).toBe(true);
  });

  it("accepts SMITE_ENEMY intervention", () => {
    const result = GodInterventionSchema.safeParse({
      chunkX: 1,
      chunkY: -2,
      interventionType: "SMITE_ENEMY",
      magnitude: 50,
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown intervention type", () => {
    const result = GodInterventionSchema.safeParse({
      chunkX: 0,
      chunkY: 0,
      interventionType: "GRANT_IMMORTALITY",
      magnitude: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects magnitude above 100", () => {
    const result = GodInterventionSchema.safeParse({
      chunkX: 0,
      chunkY: 0,
      interventionType: "SMITE_ENEMY",
      magnitude: 999,
    });
    expect(result.success).toBe(false);
  });
});

describe("game.schema — PredatorSchema", () => {
  const basePredator = {
    enemyType: "SNAKE",
    aiType:    "HUNTER",
    gridX:     32,
    gridY:     16,
    currentHp: 60,
  };

  it("accepts valid predator data", () => {
    const result = PredatorSchema.safeParse(basePredator);
    expect(result.success).toBe(true);
  });

  it("rejects unknown enemy type", () => {
    const result = PredatorSchema.safeParse({ ...basePredator, enemyType: "DRAGON" });
    expect(result.success).toBe(false);
  });

  it("rejects non-positive currentHp", () => {
    const result = PredatorSchema.safeParse({ ...basePredator, currentHp: 0 });
    expect(result.success).toBe(false);
  });
});
