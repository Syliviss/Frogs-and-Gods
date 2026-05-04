import { getFrogByOwnerId, getChunksByCoords, createPendingAction } from "../db";
import {
  calculateRemainingMove,
  chebyshevDistance,
  MOVE_MAX_RANGE,
  type MoveType,
} from "../../shared/movement";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import type { TileChar } from "../../shared/game.schema";

export type MoveQueueResult =
  | { ok: true;  pendingActionId: number }
  | { ok: false; code: "NO_FROG" | "FROG_DEAD" | "OUT_OF_RANGE" | "COST_EXCEEDED"; message: string };

export async function validateAndQueueMovement(
  userId:      number,
  actionType:  MoveType,
  targetGridX: number,
  targetGridY: number,
): Promise<MoveQueueResult> {
  const frog = await getFrogByOwnerId(userId);
  if (!frog)       return { ok: false, code: "NO_FROG",   message: "No active Frog found." };
  if (frog.isDead) return { ok: false, code: "FROG_DEAD", message: "Dead Frogs cannot move." };

  // 1. Chebyshev distance gate
  const dist     = chebyshevDistance(frog.gridX, frog.gridY, targetGridX, targetGridY);
  const maxRange = MOVE_MAX_RANGE[actionType];
  if (dist > maxRange) {
    return {
      ok: false,
      code: "OUT_OF_RANGE",
      message: `${actionType} max range is ${maxRange} tiles (attempted ${dist}).`,
    };
  }

  // 2. Target tile lookup
  const chunkX  = Math.floor(targetGridX / CHUNK_SIZE);
  const chunkY  = Math.floor(targetGridY / CHUNK_SIZE);
  const chunks  = await getChunksByCoords([{ chunkX, chunkY }]);
  const terrain: string[][] = chunks[0]?.terrainDataJson
    ? JSON.parse(chunks[0].terrainDataJson)
    : [];
  const localX = ((targetGridX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const localY = ((targetGridY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  // Default to Land ('#') if venturing into ungenerated chunks (Black Void).
  const targetChar = (terrain[localY]?.[localX] ?? "#") as TileChar;

  // 3. Movement cost gate
  const moveResult = calculateRemainingMove(actionType, frog.statsJson, "#" as TileChar, targetChar);
  if (!moveResult.legal) {
    return {
      ok: false,
      code: "COST_EXCEEDED",
      message: `Not enough movement points (cost ${moveResult.cost}, budget ${moveResult.cost + moveResult.remaining}).`,
    };
  }

  // 4. Write intent to DB — 500ms engine loop picks it up via resolveBucket
  const pending = await createPendingAction({
    actorId:      frog.id,
    actionType,
    targetGridX,
    targetGridY,
    resolveBucket: Math.floor(Date.now() / 500),
  });

  return { ok: true, pendingActionId: pending.id };
}
