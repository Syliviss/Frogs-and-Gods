// ─────────────────────────────────────────────
// XP SYSTEM — isolated for easy balancing
// ─────────────────────────────────────────────

import type { Predator } from "../../drizzle/schema";

/** XP awarded to each chunk-mate frog when a predator of this enemyType dies. */
export const XP_REWARD_BY_ENEMY_TYPE: Record<Predator["enemyType"], number> = {
  SNAKE: 25,
  GOLEM: 75,
  FLY:    5,
};

/** XP required to reach the next level from a given level. */
export function xpToNextLevel(level: number): number {
  // Quadratic curve: balanceable by adjusting BASE and SCALE
  const BASE = 100;
  const SCALE = 1.5;
  return Math.round(BASE * Math.pow(level, SCALE));
}

export interface XpApplyResult {
  newCurrentXp:     number;
  newLevel:         number;
  newXpToNextLevel: number;
  leveled:          boolean;
}

/**
 * Apply an XP gain to a frog's current XP/level, rolling over thresholds.
 * Pure function — caller is responsible for writing the resulting fields to
 * the DB (or queueing a FROG_UPDATE instruction).
 */
export function applyXpToFrog(
  currentXp: number,
  currentLevel: number,
  amount: number
): XpApplyResult {
  let newXp    = currentXp + amount;
  let newLevel = currentLevel;
  let leveled  = false;
  while (newXp >= xpToNextLevel(newLevel)) {
    newXp -= xpToNextLevel(newLevel);
    newLevel++;
    leveled = true;
  }
  return {
    newCurrentXp:     newXp,
    newLevel,
    newXpToNextLevel: xpToNextLevel(newLevel),
    leveled,
  };
}
