import { chebyshevDistance } from "../../shared/movement";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import { pushActionLog } from "../engine/actionLog";
import {
  getChunksByCoords,
  getFrogsAtTile,
  updateFrog,
  updatePredator,
  createPendingAction,
} from "../db";
import type { PredatorActionContext, PredatorActionResult, PredatorActionHandler } from "./_predator_types";
import type { Predator, PredatorStats } from "../../drizzle/schema";
import type { TileChar } from "../../shared/game.schema";
import type { NotifyFn } from "./_types";

// STRIKE — the snake lunges at the target tile.
//
// Damage:     7 flat HP on whatever frog is standing on the tile at resolution time.
// Miss:       if no frog is on the tile when the action resolves, the attack misses (cancel).
// Deep water: if the target tile is ≈ the whole action is cancelled (snakes don't bite in water).
// On hit:     if the frog survives, WRAP is automatically queued for the next sub-tick bucket.
// On kill:    snake's lastMealTick is updated (hunger resets); no WRAP is queued.
//
// Double-validation: tile type and frog presence are re-checked at execution time.

const STRIKE_DAMAGE = 7;
const DEEP_WATER: TileChar = "≈";

async function getTileChar(gridX: number, gridY: number): Promise<TileChar> {
  const chunkX  = Math.floor(gridX / CHUNK_SIZE);
  const chunkY  = Math.floor(gridY / CHUNK_SIZE);
  const chunks  = await getChunksByCoords([{ chunkX, chunkY }]);
  const terrain: string[][] = chunks[0]?.terrainDataJson
    ? (JSON.parse(chunks[0].terrainDataJson) as string[][])
    : [];
  const localX = ((gridX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const localY = ((gridY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return (terrain[localY]?.[localX] ?? "#") as TileChar;
}

export const strikeHandler: PredatorActionHandler = {
  async validate(ctx: PredatorActionContext, predator: Predator): Promise<PredatorActionResult> {
    const stats = (predator.statsJson ?? {}) as PredatorStats;

    if (stats.wrapping) {
      return { success: false, error: "Snake is already wrapping a target." };
    }

    const dist = chebyshevDistance(predator.gridX, predator.gridY, ctx.targetGridX, ctx.targetGridY);
    if (dist > 1) {
      return { success: false, error: `STRIKE range is 1 tile (got ${dist}).` };
    }

    const tileChar = await getTileChar(ctx.targetGridX, ctx.targetGridY);
    if (tileChar === DEEP_WATER) {
      return { success: false, error: "Snake cannot strike targets in deep water." };
    }

    return { success: true };
  },

  async execute(ctx: PredatorActionContext, predator: Predator): Promise<PredatorActionResult> {
    // Double-validation: re-check tile and frog presence at resolution time
    const tileChar = await getTileChar(ctx.targetGridX, ctx.targetGridY);
    if (tileChar === DEEP_WATER) {
      return { success: false, error: "Target tile is deep water at resolution — strike cancelled." };
    }

    const frogsHere = await getFrogsAtTile(ctx.targetGridX, ctx.targetGridY);
    if (frogsHere.length === 0) {
      return { success: false, error: "Target frog moved — strike misses." };
    }

    const target = frogsHere[0]!;
    const newHp  = Math.max(0, target.currentHp - STRIKE_DAMAGE);
    const killed = newHp <= 0;
    const stats  = (predator.statsJson ?? {}) as PredatorStats;

    await updateFrog(target.id, { currentHp: newHp, isDead: killed });

    if (killed) {
      // Hunger resets only on a kill
      await updatePredator(predator.id, {
        lastMealTick: Math.floor(Date.now() / 10000),
      });
      return {
        success: true,
        data: { targetFrogId: target.id, targetName: target.name, damage: STRIKE_DAMAGE, newHp, killed },
      };
    }

    // Frog survived — queue WRAP for the next sub-tick bucket
    const currentBucket = Math.floor(Date.now() / 500);
    await createPendingAction({
      actorId:       predator.id,
      actionType:    "WRAP",
      targetGridX:   target.gridX,
      targetGridY:   target.gridY,
      resolveBucket: currentBucket + 1,
      payload:       { targetFrogId: target.id },
    });

    // Set status flags on both entities
    await updatePredator(predator.id, {
      statsJson: { ...stats, wrapping: { targetFrogId: target.id } },
    });
    await updateFrog(target.id, {
      statsJson: { ...target.statsJson, wrappedBy: predator.id },
    });

    return {
      success: true,
      data: { targetFrogId: target.id, targetName: target.name, damage: STRIKE_DAMAGE, newHp, killed },
    };
  },

  async broadcast(
    _ctx: PredatorActionContext,
    predator: Predator,
    result: PredatorActionResult,
    notify: NotifyFn,
  ): Promise<void> {
    if (!result.success) {
      pushActionLog({
        text:     `Snake strike: ${result.error ?? "missed"}`,
        x:        predator.gridX,
        y:        predator.gridY,
        chunk_id: `${Math.floor(predator.gridX / CHUNK_SIZE)}:${Math.floor(predator.gridY / CHUNK_SIZE)}`,
        category: "combat",
      });
      return;
    }

    const { targetName, damage, newHp, killed, targetFrogId } = result.data as {
      targetFrogId: number;
      targetName:   string;
      damage:       number;
      newHp:        number;
      killed:       boolean;
    };

    pushActionLog({
      text:     killed
        ? `Snake STRIKES ${targetName} for ${damage} dmg — ${targetName} is dead!`
        : `Snake STRIKES ${targetName} for ${damage} dmg (HP: ${newHp}) — coiling!`,
      x:        predator.gridX,
      y:        predator.gridY,
      chunk_id: `${Math.floor(predator.gridX / CHUNK_SIZE)}:${Math.floor(predator.gridY / CHUNK_SIZE)}`,
      category: "combat",
    });

    notify(targetFrogId, { type: "SNAKE_STRIKE", damage, newHp, killed });
  },
};
