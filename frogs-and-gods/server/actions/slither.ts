import { chebyshevDistance } from "../../shared/movement";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import { pushActionLog } from "../engine/actionLog";
import type { PredatorActionContext, PredatorActionResult, PredatorActionHandler } from "./_predator_types";
import type { Predator, PredatorStats } from "../../drizzle/schema";
import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";

// SLITHER — move the snake's head to an adjacent tile and trail the body behind.
// The snake is exactly 3 tiles long:
//   [head] = predators.gridX / gridY
//   [body] = statsJson.segments[0], statsJson.segments[1]
// On each SLITHER the old head becomes segments[0], old segments[0] becomes segments[1],
// and the old tail (segments[1]) is dropped.

export const slitherHandler: PredatorActionHandler = {
  validate(ctx: PredatorActionContext, predator: Predator, state: SimulatedState): PredatorActionResult {
    const dist = chebyshevDistance(predator.gridX, predator.gridY, ctx.targetGridX, ctx.targetGridY);
    if (dist !== 1) {
      return { success: false, error: `SLITHER target must be exactly 1 tile away (got ${dist}).` };
    }
    return { success: true };
  },

  execute(ctx: PredatorActionContext, predator: Predator, state: SimulatedState, out: UpdateInstruction[]): PredatorActionResult {
    const stats   = (predator.statsJson ?? {}) as PredatorStats;
    const current = stats.segments ?? [];

    // Shift body: old head → new segments[0], old segments[0] → new segments[1]
    const newSegments: Array<{ x: number; y: number }> = [
      { x: predator.gridX, y: predator.gridY },
      current[0] ?? { x: predator.gridX, y: predator.gridY },
    ];

    const changes = {
      gridX:     ctx.targetGridX,
      gridY:     ctx.targetGridY,
      chunkX:    Math.floor(ctx.targetGridX / CHUNK_SIZE),
      chunkY:    Math.floor(ctx.targetGridY / CHUNK_SIZE),
      statsJson: { ...stats, segments: newSegments },
    };

    state.updatePredator(predator.id, changes);
    out.push({ type: "PREDATOR_UPDATE", id: predator.id, changes });

    return {
      success: true,
      data: {
        from: { x: predator.gridX, y: predator.gridY },
        to:   { x: ctx.targetGridX, y: ctx.targetGridY },
      },
    };
  },

  broadcast(
    _ctx: PredatorActionContext,
    _predator: Predator,
    result: PredatorActionResult,
    _notify: NotifyFn,
  ): void {
    if (!result.success) return;
    const { from, to } = result.data as { from: { x: number; y: number }; to: { x: number; y: number } };
    pushActionLog({
      text:     `Snake slithers from (${from.x},${from.y}) to (${to.x},${to.y})`,
      x:        to.x,
      y:        to.y,
      chunk_id: `${Math.floor(to.x / CHUNK_SIZE)}:${Math.floor(to.y / CHUNK_SIZE)}`,
      category: "movement",
    });
  },
};
