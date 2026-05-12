import { chebyshevDistance } from "../../shared/movement";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import { pushActionLog } from "../engine/actionLog";
import type { PredatorActionContext, PredatorActionResult, PredatorActionHandler } from "./_predator_types";
import type { Predator, PredatorStats } from "../../drizzle/schema";
import type { TileChar } from "../../shared/game.schema";
import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import { getEntitiesAt, applyDamage } from "./_utils";

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

function getTileChar(gridX: number, gridY: number, state: SimulatedState): TileChar {
  const chunkX  = Math.floor(gridX / CHUNK_SIZE);
  const chunkY  = Math.floor(gridY / CHUNK_SIZE);
  const chunk = state.chunks.get(`${chunkX},${chunkY}`);
  const terrain: string[][] = chunk?.terrainDataJson
    ? (JSON.parse(chunk.terrainDataJson) as string[][])
    : [];
  const localX = ((gridX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const localY = ((gridY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return (terrain[localY]?.[localX] ?? "#") as TileChar;
}

export const strikeHandler: PredatorActionHandler = {
  validate(ctx: PredatorActionContext, predator: Predator, state: SimulatedState): PredatorActionResult {
    const stats = (predator.statsJson ?? {}) as PredatorStats;

    if (stats.wrapping) {
      return { success: false, error: "Snake is already wrapping a target." };
    }

    const dist = chebyshevDistance(predator.gridX, predator.gridY, ctx.targetGridX, ctx.targetGridY);
    if (dist > 1) {
      return { success: false, error: `STRIKE range is 1 tile (got ${dist}).` };
    }

    const tileChar = getTileChar(ctx.targetGridX, ctx.targetGridY, state);
    if (tileChar === DEEP_WATER) {
      return { success: false, error: "Snake cannot strike targets in deep water." };
    }

    return { success: true };
  },

  execute(ctx: PredatorActionContext, predator: Predator, state: SimulatedState, out: UpdateInstruction[]): PredatorActionResult {
    const tileChar = getTileChar(ctx.targetGridX, ctx.targetGridY, state);
    if (tileChar === DEEP_WATER) {
      return { success: false, error: "Target tile is deep water at resolution — strike cancelled." };
    }

    const frogsHere = getEntitiesAt(state, ctx.targetGridX, ctx.targetGridY).frogs;
    if (frogsHere.length === 0) {
      return { success: false, error: "Target frog moved — strike misses." };
    }

    const target = frogsHere[0]!;
    applyDamage(state, out, "FROG", target.id, STRIKE_DAMAGE);
    
    const updatedTarget = state.frogs.get(target.id)!;
    const killed = updatedTarget.isDead;
    const newHp = updatedTarget.currentHp;
    const stats  = (predator.statsJson ?? {}) as PredatorStats;

    if (killed) {
      const predChanges = { lastMealTick: Math.floor(Date.now() / 10000) };
      state.updatePredator(predator.id, predChanges);
      out.push({ type: "PREDATOR_UPDATE", id: predator.id, changes: predChanges });
      return {
        success: true,
        data: { targetFrogId: target.id, targetName: target.name, damage: STRIKE_DAMAGE, newHp, killed },
      };
    }

    const currentBucket = Math.floor(Date.now() / 500);
    out.push({
      type: "ACTION_INSERT",
      data: {
        actorId:       predator.id,
        actorType:     "PREDATOR",
        actionType:    "WRAP",
        targetGridX:   target.gridX,
        targetGridY:   target.gridY,
        resolveBucket: currentBucket + 1,
        payload:       { targetFrogId: target.id },
      }
    });

    const predChanges = { statsJson: { ...stats, wrapping: { targetFrogId: target.id } } };
    state.updatePredator(predator.id, predChanges);
    out.push({ type: "PREDATOR_UPDATE", id: predator.id, changes: predChanges });

    const frogChanges = { statsJson: { ...updatedTarget.statsJson, wrappedBy: predator.id } };
    state.updateFrog(target.id, frogChanges);
    out.push({ type: "FROG_UPDATE", id: target.id, changes: frogChanges });

    return {
      success: true,
      data: { targetFrogId: target.id, targetName: target.name, damage: STRIKE_DAMAGE, newHp, killed },
    };
  },

  broadcast(
    _ctx: PredatorActionContext,
    predator: Predator,
    result: PredatorActionResult,
    notify: NotifyFn,
  ): void {
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
