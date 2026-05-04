import { eq } from "drizzle-orm";
import { getDb, getFrogById, getChunksByCoords } from "../db";
import { getPendingActionsToResolve } from "../db";
import { frogs, pendingActions } from "../../drizzle/schema";
import { calculateRemainingMove, type MoveType } from "../../shared/movement";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import type { TileChar } from "../../shared/game.schema";

export async function processMovementActions(
  notify: (userId: number, data: unknown) => void = () => {},
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const currentBucket = Math.floor(Date.now() / 500);
  const pending = await getPendingActionsToResolve(currentBucket);
  if (pending.length === 0) return;

  for (const action of pending) {
    if (action.actionType !== "STEP" && action.actionType !== "HOP" && action.actionType !== "DASH") {
      await db.update(pendingActions).set({ status: "resolved", resolvedAt: new Date() }).where(eq(pendingActions.id, action.id));
      continue;
    }
    if (action.targetGridX === null || action.targetGridY === null) {
      await db.update(pendingActions).set({ status: "cancelled", resolvedAt: new Date() }).where(eq(pendingActions.id, action.id));
      continue;
    }

    const frog = await getFrogById(action.actorId);
    if (!frog || frog.isDead) {
      await db.update(pendingActions).set({ status: "cancelled", resolvedAt: new Date() }).where(eq(pendingActions.id, action.id));
      continue;
    }

    // Re-validate tile cost (double-validation intentional)
    const chunkX  = Math.floor(action.targetGridX / CHUNK_SIZE);
    const chunkY  = Math.floor(action.targetGridY / CHUNK_SIZE);
    const chunks  = await getChunksByCoords([{ chunkX, chunkY }]);
    const terrain: string[][] = chunks[0]?.terrainDataJson ? JSON.parse(chunks[0].terrainDataJson) : [];
    const localX  = ((action.targetGridX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localY  = ((action.targetGridY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const targetChar = (terrain[localY]?.[localX] ?? "#") as TileChar;
    const moveResult = calculateRemainingMove(action.actionType as MoveType, frog.statsJson, "#" as TileChar, targetChar);

    // Atomic: update frog position + mark action resolved in one transaction
    await db.transaction(async (tx) => {
      if (moveResult.legal) {
        await tx.update(frogs)
          .set({ gridX: action.targetGridX!, gridY: action.targetGridY! })
          .where(eq(frogs.id, frog.id));
      }
      await tx.update(pendingActions)
        .set({ status: moveResult.legal ? "resolved" : "cancelled", resolvedAt: new Date() })
        .where(eq(pendingActions.id, action.id));
    });

    if (frog.ownerId !== null) {
      notify(frog.ownerId, {
        type:       "ACTION_RESOLVED",
        actionId:   action.id,
        legal:      moveResult.legal,
        actionType: action.actionType,
        targetGridX: action.targetGridX,
        targetGridY: action.targetGridY,
      });
    }
  }
}
