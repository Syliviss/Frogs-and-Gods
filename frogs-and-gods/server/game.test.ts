import { describe, expect, it } from "vitest";
import {
  CombatMoveSchema,
  GodInterventionSchema,
  PartyInviteSchema,
  EnemySchema,
} from "../shared/game.schema";

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
