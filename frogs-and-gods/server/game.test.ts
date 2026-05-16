import { describe, expect, it } from "vitest";
import { distributeXp, xpToNextLevel, type CombatantStats } from "./engine/xpDistributor";
import {
  GodInterventionSchema,
  PredatorSchema,
} from "../shared/game.schema";

// ─────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────

function makeFrog(overrides: Partial<CombatantStats> = {}): CombatantStats {
  return {
    id: 1,
    name: "Ribbit the Brave",
    hp: 100,
    maxHp: 100,
    mp: 50,
    maxMp: 50,
    attack: 20,
    defense: 10,
    speed: 10,
    level: 1,
    xp: 0,
    isDead: false,
    ...overrides,
  };
}

const baseEnemy = {
  id: "swamp-toad",
  name: "Swamp Toad",
  hp: 60,
  maxHp: 60,
  attack: 12,
  defense: 5,
  xpReward: 40,
  lootTier: 1,
};

// ─────────────────────────────────────────────
// XP DISTRIBUTOR
// ─────────────────────────────────────────────

describe("xpDistributor", () => {
  it("awards full XP to a solo frog", () => {
    const frog = makeFrog();
    const result = distributeXp([frog], 100);
    expect(result.xpAwarded[1]).toBe(100);
    expect(result.totalXpPool).toBe(100);
  });

  it("splits XP between two frogs with party bonus", () => {
    const frog1 = makeFrog({ id: 1 });
    const frog2 = makeFrog({ id: 2, name: "Hopsworth" });
    const result = distributeXp([frog1, frog2], 100);
    // 2-player bonus = 0.85, total = 85, split = 42 or 43 each (rounding)
    expect(result.totalXpPool).toBe(85);
    const perFrog = result.xpAwarded[1]!;
    expect(perFrog).toBeGreaterThanOrEqual(42);
    expect(perFrog).toBeLessThanOrEqual(43);
    expect(result.xpAwarded[2]).toBe(perFrog);
  });

  it("does not award XP to dead frogs", () => {
    const aliveFrog = makeFrog({ id: 1 });
    const deadFrog = makeFrog({ id: 2, isDead: true });
    const result = distributeXp([aliveFrog, deadFrog], 100);
    expect(result.xpAwarded[1]).toBeDefined();
    expect(result.xpAwarded[2]).toBeUndefined();
  });

  it("returns empty result when all frogs are dead", () => {
    const deadFrog = makeFrog({ isDead: true });
    const result = distributeXp([deadFrog], 100);
    expect(Object.keys(result.xpAwarded)).toHaveLength(0);
    expect(result.totalXpPool).toBe(0);
  });

  it("detects level up correctly", () => {
    const frog = makeFrog({ xp: 90 });
    const result = distributeXp([frog], 20); // 90 + 20 = 110 >= 100 (xpToNextLevel for level 1)
    expect(result.leveledUp[1]).toBe(true);
    expect(result.newLevel[1]).toBe(2);
  });

  it("xpToNextLevel scales with level", () => {
    expect(xpToNextLevel(1)).toBe(100);
    expect(xpToNextLevel(2)).toBeGreaterThan(xpToNextLevel(1));
    expect(xpToNextLevel(10)).toBeGreaterThan(xpToNextLevel(5));
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
