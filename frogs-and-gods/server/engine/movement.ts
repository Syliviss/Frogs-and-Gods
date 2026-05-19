import { getFrogByOwnerId, getChunksByCoords, createPendingAction } from "../db";
import {
  chebyshevDistance,
  OPEN_WATER_TILES,
  type MoveType,
} from "../../shared/movement";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import type { TileChar } from "../../shared/game.schema";

export type MoveQueueResult =
  | { ok: true;  pendingActionId: number }
  | { ok: false; code: "NO_FROG" | "FROG_DEAD" | "OUT_OF_RANGE" | "INVALID_MOVE"; message: string };

function getTileChar(terrain: string[][], localX: number, localY: number): TileChar {
  return (terrain[localY]?.[localX] ?? "#") as TileChar;
}

async function loadTileChar(gridX: number, gridY: number): Promise<TileChar> {
  const chunkX = Math.floor(gridX / CHUNK_SIZE);
  const chunkY = Math.floor(gridY / CHUNK_SIZE);
  const chunks = await getChunksByCoords([{ chunkX, chunkY }]);
  const terrain: string[][] = chunks[0]?.terrainDataJson ? JSON.parse(chunks[0].terrainDataJson) : [];
  const localX = ((gridX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const localY = ((gridY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return getTileChar(terrain, localX, localY);
}

export async function validateAndQueueMovement(
  userId:      number,
  actionType:  MoveType,
  targetGridX: number,
  targetGridY: number,
): Promise<MoveQueueResult> {
  const frog = await getFrogByOwnerId(userId);
  if (!frog)       return { ok: false, code: "NO_FROG",   message: "No active Frog found." };
  if (frog.isDead) return { ok: false, code: "FROG_DEAD", message: "Dead Frogs cannot move." };

  const dist = chebyshevDistance(frog.gridX, frog.gridY, targetGridX, targetGridY);

  if (actionType === "STEP") {
    if (dist > 1) {
      return { ok: false, code: "OUT_OF_RANGE", message: "STEP max range is 1 tile." };
    }
  } else if (actionType === "HOP") {
    if (dist > 3) {
      return { ok: false, code: "OUT_OF_RANGE", message: "HOP max range is 3 tiles." };
    }
    // Breath check — fumble is enforced at resolution, but reject obviously invalid queues early.
    if ((frog.currentBreath ?? 0) < dist) {
      return { ok: false, code: "INVALID_MOVE", message: "Not enough breath to hop that far." };
    }
  } else if (actionType === "SWIM") {
    // Must be standing in open water.
    const standingChar = await loadTileChar(frog.gridX, frog.gridY);
    if (!OPEN_WATER_TILES.has(standingChar)) {
      return { ok: false, code: "INVALID_MOVE", message: "SWIM is only available from open water." };
    }
    if ((frog.currentBreath ?? 0) < dist) {
      return { ok: false, code: "INVALID_MOVE", message: "Not enough breath to swim that far." };
    }
  }

  const pending = await createPendingAction({
    actorId:      frog.id,
    actionType,
    targetGridX,
    targetGridY,
    resolveBucket: Math.floor(Date.now() / 500),
  });

  return { ok: true, pendingActionId: pending.id };
}
