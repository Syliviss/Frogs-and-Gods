import { Enemy, MoveType } from "../../shared/game.schema";
import { distributeXp, XpResult } from "./xpDistributor";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface CombatantStats {
  id: number;
  name: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  attack: number;
  defense: number;
  speed: number;
  level: number;
  xp: number;
  isDead: boolean;
}

export interface TurnResult {
  frogAction: ActionResult;
  enemyAction: ActionResult | null;
  updatedFrog: CombatantStats;
  updatedEnemy: Enemy;
  encounterStatus: "active" | "victory" | "defeat" | "fled";
  xpResult: XpResult | null;
  lootDropped: string | null;
  message: string;
  log: string[];
}

export interface ActionResult {
  actorName: string;
  moveType: MoveType | "ENEMY_ATTACK";
  damage: number;
  heal: number;
  mpCost: number;
  critical: boolean;
  missed: boolean;
  message: string;
}

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const MAGIC_MP_COST = 15;
const DEFEND_DEFENSE_MULTIPLIER = 1.5;
const CRITICAL_HIT_CHANCE = 0.15;
const MISS_CHANCE = 0.08;
const MAGIC_DAMAGE_MULTIPLIER = 1.6;

// ─────────────────────────────────────────────
// CORE DAMAGE FORMULA
// ─────────────────────────────────────────────

function rollCritical(): boolean {
  return Math.random() < CRITICAL_HIT_CHANCE;
}

function rollMiss(): boolean {
  return Math.random() < MISS_CHANCE;
}

function calcPhysicalDamage(
  attackerAtk: number,
  defenderDef: number,
  critical: boolean
): number {
  const base = Math.max(1, attackerAtk - defenderDef * 0.6);
  const variance = base * 0.2 * (Math.random() - 0.5);
  const raw = Math.round(base + variance);
  return critical ? Math.round(raw * 2) : raw;
}

function calcMagicDamage(
  attackerAtk: number,
  defenderDef: number,
  critical: boolean
): number {
  const base = Math.max(1, attackerAtk * MAGIC_DAMAGE_MULTIPLIER - defenderDef * 0.3);
  const variance = base * 0.15 * (Math.random() - 0.5);
  const raw = Math.round(base + variance);
  return critical ? Math.round(raw * 1.8) : raw;
}

// ─────────────────────────────────────────────
// FROG ACTION PROCESSOR
// ─────────────────────────────────────────────

function processFrogAction(
  frog: CombatantStats,
  enemy: Enemy,
  moveType: MoveType,
  isDefending: boolean
): { actionResult: ActionResult; updatedEnemy: Enemy; updatedFrog: CombatantStats } {
  let damage = 0;
  let heal = 0;
  let mpCost = 0;
  let critical = false;
  let missed = false;
  let message = "";
  let updatedEnemy = { ...enemy };
  let updatedFrog = { ...frog };

  switch (moveType) {
    case "ATTACK": {
      missed = rollMiss();
      if (!missed) {
        critical = rollCritical();
        damage = calcPhysicalDamage(frog.attack, enemy.defense, critical);
        updatedEnemy = { ...enemy, hp: Math.max(0, enemy.hp - damage) };
        message = critical
          ? `${frog.name} lands a CRITICAL STRIKE on ${enemy.name} for ${damage} damage!`
          : `${frog.name} attacks ${enemy.name} for ${damage} damage.`;
      } else {
        message = `${frog.name}'s attack misses ${enemy.name}!`;
      }
      break;
    }
    case "MAGIC": {
      if (frog.mp < MAGIC_MP_COST) {
        missed = true;
        message = `${frog.name} doesn't have enough MP to cast a spell!`;
      } else {
        mpCost = MAGIC_MP_COST;
        critical = rollCritical();
        damage = calcMagicDamage(frog.attack, enemy.defense, critical);
        updatedFrog = { ...frog, mp: frog.mp - mpCost };
        updatedEnemy = { ...enemy, hp: Math.max(0, enemy.hp - damage) };
        message = critical
          ? `${frog.name} unleashes a CRITICAL SPELL on ${enemy.name} for ${damage} damage!`
          : `${frog.name} casts a spell on ${enemy.name} for ${damage} damage.`;
      }
      break;
    }
    case "DEFEND": {
      // Defend: no damage, frog gains temporary defense boost (handled in enemy action)
      message = `${frog.name} takes a defensive stance.`;
      break;
    }
    case "FLEE": {
      const fleeChance = 0.4 + (frog.speed ?? 10) * 0.02;
      if (Math.random() < fleeChance) {
        message = `${frog.name} successfully flees from the battle!`;
      } else {
        missed = true;
        message = `${frog.name} tries to flee but fails!`;
      }
      break;
    }
    default:
      message = `${frog.name} hesitates and does nothing.`;
  }

  const actionResult: ActionResult = {
    actorName: frog.name,
    moveType,
    damage,
    heal,
    mpCost,
    critical,
    missed,
    message,
  };

  return { actionResult, updatedEnemy, updatedFrog };
}

// ─────────────────────────────────────────────
// ENEMY ACTION PROCESSOR
// ─────────────────────────────────────────────

function processEnemyAction(
  enemy: Enemy,
  frog: CombatantStats,
  frogIsDefending: boolean
): { actionResult: ActionResult; updatedFrog: CombatantStats } {
  const effectiveDef = frogIsDefending
    ? Math.round(frog.defense * DEFEND_DEFENSE_MULTIPLIER)
    : frog.defense;

  const missed = rollMiss();
  const critical = rollCritical();
  const damage = missed ? 0 : calcPhysicalDamage(enemy.attack, effectiveDef, critical);
  const updatedFrog: CombatantStats = { ...frog, hp: Math.max(0, frog.hp - damage) };

  let message = "";
  if (missed) {
    message = `${enemy.name}'s attack misses ${frog.name}!`;
  } else if (critical) {
    message = `${enemy.name} delivers a CRUSHING BLOW to ${frog.name} for ${damage} damage!`;
  } else {
    message = `${enemy.name} strikes ${frog.name} for ${damage} damage.`;
  }

  return {
    actionResult: {
      actorName: enemy.name,
      moveType: "ENEMY_ATTACK",
      damage,
      heal: 0,
      mpCost: 0,
      critical,
      missed,
      message,
    },
    updatedFrog,
  };
}

// ─────────────────────────────────────────────
// PERMADEATH CHECK
// ─────────────────────────────────────────────

function checkPermadeath(frog: CombatantStats): CombatantStats {
  if (frog.hp <= 0) {
    return { ...frog, hp: 0, isDead: true };
  }
  return frog;
}

// ─────────────────────────────────────────────
// LOOT DROP
// ─────────────────────────────────────────────

const RARITY_LABELS: Record<number, string> = {
  1: "Common",
  2: "Uncommon",
  3: "Rare",
  4: "Epic",
  5: "Legendary",
  6: "Mythic",
  7: "Celestial",
  8: "Abyssal",
  9: "Divine",
  10: "Transcendent",
  11: "Primordial",
  12: "Mythic Transcendent",
};

function rollLootDrop(enemyLootTier: number): string | null {
  const dropChance = 0.3 + enemyLootTier * 0.05;
  if (Math.random() > dropChance) return null;
  const tier = Math.min(12, Math.max(1, enemyLootTier + Math.floor(Math.random() * 3) - 1));
  return `${RARITY_LABELS[tier]} item (Tier ${tier})`;
}

// ─────────────────────────────────────────────
// MAIN TURN PROCESSOR
// ─────────────────────────────────────────────

export function processTurn(
  frog: CombatantStats,
  enemy: Enemy,
  moveType: MoveType
): TurnResult {
  const log: string[] = [];

  if (frog.isDead) {
    throw new Error(`${frog.name} is dead and cannot act.`);
  }

  const isDefending = moveType === "DEFEND";
  const isFleeing = moveType === "FLEE";

  // ── Frog acts first ──
  const {
    actionResult: frogAction,
    updatedEnemy: enemyAfterFrog,
    updatedFrog: frogAfterAction,
  } = processFrogAction(frog, enemy, moveType, false);
  log.push(frogAction.message);

  // ── Check if enemy is defeated ──
  if (enemyAfterFrog.hp <= 0) {
    const xpResult = distributeXp([frog], enemy.xpReward);
    const lootDropped = rollLootDrop(enemy.lootTier);
    const victoryMsg = `${enemy.name} has been defeated! Victory!`;
    log.push(victoryMsg);
    if (lootDropped) log.push(`Loot dropped: ${lootDropped}`);

    return {
      frogAction,
      enemyAction: null,
      updatedFrog: { ...frogAfterAction, xp: frogAfterAction.xp + xpResult.xpAwarded[frog.id] },
      updatedEnemy: enemyAfterFrog,
      encounterStatus: "victory",
      xpResult,
      lootDropped,
      message: victoryMsg,
      log,
    };
  }

  // ── Check if frog fled successfully ──
  if (isFleeing && !frogAction.missed) {
    return {
      frogAction,
      enemyAction: null,
      updatedFrog: frogAfterAction,
      updatedEnemy: enemyAfterFrog,
      encounterStatus: "fled",
      xpResult: null,
      lootDropped: null,
      message: frogAction.message,
      log,
    };
  }

  // ── Enemy counter-attacks ──
  const { actionResult: enemyAction, updatedFrog: frogAfterEnemy } = processEnemyAction(
    enemyAfterFrog,
    frogAfterAction,
    isDefending
  );
  log.push(enemyAction.message);

  // ── Permadeath check ──
  const finalFrog = checkPermadeath(frogAfterEnemy);
  if (finalFrog.isDead) {
    const deathMsg = `${finalFrog.name} has fallen in battle. Their soul joins the swamp eternal.`;
    log.push(deathMsg);
    return {
      frogAction,
      enemyAction,
      updatedFrog: finalFrog,
      updatedEnemy: enemyAfterFrog,
      encounterStatus: "defeat",
      xpResult: null,
      lootDropped: null,
      message: deathMsg,
      log,
    };
  }

  return {
    frogAction,
    enemyAction,
    updatedFrog: finalFrog,
    updatedEnemy: enemyAfterFrog,
    encounterStatus: "active",
    xpResult: null,
    lootDropped: null,
    message: log.join(" "),
    log,
  };
}
