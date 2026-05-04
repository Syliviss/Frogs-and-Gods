import type { TileChar } from "./game.schema";
import { TILE_REGISTRY } from "./tileRegistry";

export type MoveType = "STEP" | "HOP" | "DASH";

export interface MoveResult {
  legal:     boolean;
  cost:      number;
  remaining: number;
}

const BASE_MOVEMENT = 5;

export const MOVE_DISTANCES: Record<MoveType, number> = {
  STEP: 1,
  HOP:  3,
  DASH: 5,
};

export const MOVE_MAX_RANGE: Record<MoveType, number> = {
  STEP: 1,
  HOP:  3,
  DASH: 5,
};

export function chebyshevDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(bx - ax), Math.abs(by - ay));
}

export function movementBudget(dex: number): number {
  return BASE_MOVEMENT + Math.floor(dex / 2);
}

export function calculateRemainingMove(
  moveType:     MoveType,
  frogStats:    { dex: number },
  _currentChar: TileChar,  // reserved for future exit-cost logic
  targetChar:   TileChar,
): MoveResult {
  const budget = movementBudget(frogStats.dex);
  const cost   = TILE_REGISTRY[targetChar].movementCost * MOVE_DISTANCES[moveType];
  return { legal: cost <= budget, cost, remaining: budget - cost };
}
