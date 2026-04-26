import { CombatantStats } from "./combatLoop";

// ─────────────────────────────────────────────
// XP DISTRIBUTION — isolated for easy balancing
// ─────────────────────────────────────────────

export interface XpResult {
  /** Map of frogId → xp awarded */
  xpAwarded: Record<number, number>;
  /** Map of frogId → whether they leveled up */
  leveledUp: Record<number, boolean>;
  /** Map of frogId → new level after XP (if leveled up) */
  newLevel: Record<number, number>;
  totalXpPool: number;
}

/** XP required to reach the next level from a given level. */
export function xpToNextLevel(level: number): number {
  // Quadratic curve: balanceable by adjusting BASE and SCALE
  const BASE = 100;
  const SCALE = 1.5;
  return Math.round(BASE * Math.pow(level, SCALE));
}

/** Bonus XP multiplier for party play (more members = slightly less per person, but more total). */
function partyBonus(memberCount: number): number {
  if (memberCount <= 1) return 1.0;
  if (memberCount === 2) return 0.85;
  if (memberCount === 3) return 0.75;
  return 0.65; // 4-player parties
}

/**
 * Distribute XP from a defeated enemy to one or more Frogs.
 * XP is split equally among living party members with a party bonus applied.
 * Dead frogs receive no XP.
 */
export function distributeXp(
  frogs: CombatantStats[],
  baseXpReward: number
): XpResult {
  const livingFrogs = frogs.filter((f) => !f.isDead);
  const memberCount = livingFrogs.length;

  if (memberCount === 0) {
    return {
      xpAwarded: {},
      leveledUp: {},
      newLevel: {},
      totalXpPool: 0,
    };
  }

  const bonus = partyBonus(memberCount);
  const totalXpPool = Math.round(baseXpReward * bonus);
  const xpPerFrog = Math.round(totalXpPool / memberCount);

  const xpAwarded: Record<number, number> = {};
  const leveledUp: Record<number, boolean> = {};
  const newLevel: Record<number, number> = {};

  for (const frog of livingFrogs) {
    xpAwarded[frog.id] = xpPerFrog;
    const newXp = frog.xp + xpPerFrog;
    const threshold = xpToNextLevel(frog.level);

    if (newXp >= threshold) {
      leveledUp[frog.id] = true;
      newLevel[frog.id] = frog.level + 1;
    } else {
      leveledUp[frog.id] = false;
      newLevel[frog.id] = frog.level;
    }
  }

  return { xpAwarded, leveledUp, newLevel, totalXpPool };
}
