import { chebyshevDistance } from "../../shared/movement";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import { pushActionLog } from "../engine/actionLog";
import { getTerrainAt } from "./_utils";
import type { PredatorActionContext, PredatorActionResult, PredatorActionHandler } from "./_predator_types";
import type { Predator, PredatorStats } from "../../drizzle/schema";
import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";

// SLITHER — move the snake 2 tiles in a unit direction and trail the body behind.
//
// The snake is exactly 3 tiles long:
//   [head]     = predators.gridX / gridY
//   [seg0]     = statsJson.segments[0]  (middle)
//   [seg1]     = statsJson.segments[1]  (tail)
//
// On each SLITHER the body shifts like a queue:
//   new head     = destination (head + 2·dir)
//   new seg[0]   = intermediate (head + 1·dir)
//   new seg[1]   = old head        ← "tail ends up where head was"
//
// Terrain: both the intermediate tile and the destination must be '#' (land).
// Peaks (^), water tiles, lily pads, and doors are all blocked.
//
// The direction vector is derived from the target coords:
//   dx = (targetX - gridX) / 2,  dy = (targetY - gridY) / 2
// Both must be in {-1, 0, 1} — only pure unit-direction × 2 moves are legal.

export const slitherHandler: PredatorActionHandler = {
  validate(ctx: PredatorActionContext, predator: Predator, state: SimulatedState): PredatorActionResult {
    const dist = chebyshevDistance(predator.gridX, predator.gridY, ctx.targetGridX, ctx.targetGridY);
    if (dist !== 2) {
      return { success: false, error: `SLITHER target must be exactly 2 tiles away (got ${dist}).` };
    }

    const rawDx = ctx.targetGridX - predator.gridX;
    const rawDy = ctx.targetGridY - predator.gridY;

    // Must be a pure unit direction scaled by 2 (e.g. (2,0), (2,2), (0,-2))
    if (rawDx % 2 !== 0 || rawDy % 2 !== 0) {
      return { success: false, error: "SLITHER target must be a unit-direction × 2 (no L-shapes)." };
    }
    const dx = rawDx / 2;
    const dy = rawDy / 2;
    if (dx < -1 || dx > 1 || dy < -1 || dy > 1) {
      return { success: false, error: "SLITHER direction components must be in {-1, 0, 1}." };
    }

    const intermX = predator.gridX + dx;
    const intermY = predator.gridY + dy;

    const intermChar = getTerrainAt(state, intermX, intermY);
    if (intermChar !== "#" && intermChar !== "o" && intermChar !== "T") {
      return { success: false, error: `SLITHER intermediate tile (${intermX},${intermY}) is not land (got '${intermChar}').` };
    }

    const destChar = getTerrainAt(state, ctx.targetGridX, ctx.targetGridY);
    if (destChar !== "#" && destChar !== "o" && destChar !== "T") {
      return { success: false, error: `SLITHER destination tile (${ctx.targetGridX},${ctx.targetGridY}) is not land (got '${destChar}').` };
    }

    return { success: true };
  },

  execute(ctx: PredatorActionContext, predator: Predator, state: SimulatedState, out: UpdateInstruction[]): PredatorActionResult {
    const stats = (predator.statsJson ?? {}) as PredatorStats;

    const rawDx = ctx.targetGridX - predator.gridX;
    const rawDy = ctx.targetGridY - predator.gridY;
    const dx    = rawDx / 2;
    const dy    = rawDy / 2;

    const intermediate: { x: number; y: number } = {
      x: predator.gridX + dx,
      y: predator.gridY + dy,
    };

    // On a turn: keep old seg0 as new tail so the bend stays visible (L-shape).
    // On a straight move: tail becomes old head (collinear body).
    const oldFacing = stats.facing;
    const isTurn = oldFacing != null && (oldFacing.dx !== dx || oldFacing.dy !== dy);
    const oldSeg0 = stats.segments?.[0];
    const newSeg1 = (isTurn && oldSeg0)
      ? oldSeg0
      : { x: predator.gridX, y: predator.gridY };

    const newSegments: Array<{ x: number; y: number }> = [intermediate, newSeg1];

    const changes = {
      gridX:     ctx.targetGridX,
      gridY:     ctx.targetGridY,
      chunkX:    Math.floor(ctx.targetGridX / CHUNK_SIZE),
      chunkY:    Math.floor(ctx.targetGridY / CHUNK_SIZE),
      statsJson: { ...stats, segments: newSegments, facing: { dx, dy } },
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
