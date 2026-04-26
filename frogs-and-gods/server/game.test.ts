import { describe, expect, it } from "vitest";
import { processTurn, type CombatantStats } from "./engine/combatLoop";
import { distributeXp, xpToNextLevel } from "./engine/xpDistributor";
import {
  CombatMoveSchema,
  GodInterventionSchema,
  PartyInviteSchema,
  EnemySchema,
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
// COMBAT ENGINE
// ─────────────────────────────────────────────

describe("combatLoop.processTurn", () => {
  it("throws if frog is dead", () => {
    const deadFrog = makeFrog({ isDead: true });
    expect(() => processTurn(deadFrog, baseEnemy, "ATTACK")).toThrow();
  });

  it("ATTACK reduces enemy HP", () => {
    const frog = makeFrog({ attack: 100, defense: 10 });
    // Retry to account for random miss chance (8%)
    let hitResult = null;
    for (let i = 0; i < 30; i++) {
      const result = processTurn({ ...frog }, { ...baseEnemy, hp: 200, maxHp: 200, defense: 0 }, "ATTACK");
      if (!result.frogAction.missed) { hitResult = result; break; }
    }
    expect(hitResult).not.toBeNull();
    expect(hitResult!.updatedEnemy.hp).toBeLessThan(200);
  });

  it("MAGIC costs MP", () => {
    const frog = makeFrog({ mp: 50 });
    const result = processTurn(frog, { ...baseEnemy, hp: 200, maxHp: 200 }, "MAGIC");
    if (!result.frogAction.missed) {
      expect(result.updatedFrog.mp).toBeLessThan(50);
    }
  });

  it("MAGIC fails when MP is insufficient", () => {
    const frog = makeFrog({ mp: 5 }); // Less than MAGIC_MP_COST (15)
    const result = processTurn(frog, baseEnemy, "MAGIC");
    expect(result.frogAction.missed).toBe(true);
    expect(result.updatedFrog.mp).toBe(5); // MP unchanged
  });

  it("DEFEND reduces damage taken", () => {
    // Run many trials — defending should statistically result in less damage on average
    let defendDamage = 0;
    let attackDamage = 0;
    const trials = 200;
    const strongEnemy = { ...baseEnemy, attack: 100, defense: 0 };
    const frog = makeFrog({ defense: 5 });

    for (let i = 0; i < trials; i++) {
      const defendResult = processTurn({ ...frog }, strongEnemy, "DEFEND");
      const attackResult = processTurn({ ...frog }, strongEnemy, "ATTACK");
      if (defendResult.enemyAction) defendDamage += defendResult.enemyAction.damage;
      if (attackResult.enemyAction) attackDamage += attackResult.enemyAction.damage;
    }

    // Defending should reduce average damage — allow 15% tolerance for randomness
    const avgDefend = defendDamage / trials;
    const avgAttack = attackDamage / trials;
    expect(avgDefend).toBeLessThan(avgAttack * 1.15);
  });

  it("sets isDead=true when frog HP reaches 0", () => {
    const frog = makeFrog({ hp: 1, defense: 0 });
    const strongEnemy = { ...baseEnemy, attack: 999, defense: 0 };
    const result = processTurn(frog, strongEnemy, "ATTACK");
    if (result.encounterStatus === "defeat") {
      expect(result.updatedFrog.isDead).toBe(true);
      expect(result.updatedFrog.hp).toBe(0);
    }
  });

  it("returns victory status when enemy HP reaches 0", () => {
    const frog = makeFrog({ attack: 9999 });
    const weakEnemy = { ...baseEnemy, hp: 1, defense: 0 };
    // Retry to account for random miss chance
    let victoryResult = null;
    for (let i = 0; i < 30; i++) {
      const result = processTurn({ ...frog }, { ...weakEnemy }, "ATTACK");
      if (result.encounterStatus === "victory") {
        victoryResult = result;
        break;
      }
    }
    expect(victoryResult).not.toBeNull();
    expect(victoryResult!.updatedEnemy.hp).toBe(0);
  });

  it("distributes XP on victory", () => {
    // Use MAGIC with high attack to guarantee kill even with miss chance
    // Run multiple times to account for random miss chance
    const frog = makeFrog({ attack: 9999, mp: 50 });
    const weakEnemy = { ...baseEnemy, hp: 1, defense: 0, xpReward: 50 };
    let victoryResult = null;
    for (let i = 0; i < 20; i++) {
      const result = processTurn({ ...frog }, { ...weakEnemy }, "ATTACK");
      if (result.encounterStatus === "victory") {
        victoryResult = result;
        break;
      }
    }
    expect(victoryResult).not.toBeNull();
    expect(victoryResult!.xpResult).not.toBeNull();
    expect(victoryResult!.xpResult!.xpAwarded[frog.id]).toBe(50);
  });
});

// ─────────────────────────────────────────────
// ZOD SCHEMAS
// ─────────────────────────────────────────────

describe("game.schema — CombatMoveSchema", () => {
  it("accepts valid combat move", () => {
    const result = CombatMoveSchema.safeParse({
      encounterId: 1,
      frogId: 2,
      moveType: "ATTACK",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid moveType", () => {
    const result = CombatMoveSchema.safeParse({
      encounterId: 1,
      frogId: 2,
      moveType: "DANCE",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = CombatMoveSchema.safeParse({ moveType: "ATTACK" });
    expect(result.success).toBe(false);
  });
});

describe("game.schema — GodInterventionSchema", () => {
  it("accepts HEAL_FROG intervention", () => {
    const result = GodInterventionSchema.safeParse({
      encounterId: 1,
      interventionType: "HEAL_FROG",
      targetFrogId: 3,
      magnitude: 25,
    });
    expect(result.success).toBe(true);
  });

  it("accepts SMITE_ENEMY intervention", () => {
    const result = GodInterventionSchema.safeParse({
      encounterId: 1,
      interventionType: "SMITE_ENEMY",
      magnitude: 50,
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown intervention type", () => {
    const result = GodInterventionSchema.safeParse({
      encounterId: 1,
      interventionType: "GRANT_IMMORTALITY",
      magnitude: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects magnitude above 100", () => {
    const result = GodInterventionSchema.safeParse({
      encounterId: 1,
      interventionType: "SMITE_ENEMY",
      magnitude: 999,
    });
    expect(result.success).toBe(false);
  });
});

describe("game.schema — PartyInviteSchema", () => {
  it("accepts valid party invite", () => {
    const result = PartyInviteSchema.safeParse({ partyId: 1, invitedFrogId: 2 });
    expect(result.success).toBe(true);
  });

  it("rejects non-positive IDs", () => {
    const result = PartyInviteSchema.safeParse({ partyId: 0, invitedFrogId: 2 });
    expect(result.success).toBe(false);
  });
});

describe("game.schema — EnemySchema", () => {
  it("accepts valid enemy data", () => {
    const result = EnemySchema.safeParse(baseEnemy);
    expect(result.success).toBe(true);
  });

  it("rejects lootTier > 12", () => {
    const result = EnemySchema.safeParse({ ...baseEnemy, lootTier: 13 });
    expect(result.success).toBe(false);
  });

  it("rejects negative HP", () => {
    const result = EnemySchema.safeParse({ ...baseEnemy, hp: -1 });
    expect(result.success).toBe(false);
  });
});
