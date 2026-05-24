import { chebyshevDistance, getLineTiles } from "../../shared/movement";
import { CHUNK_SIZE } from "../utils/worldGenerator";
import { pushActionLog } from "../engine/actionLog";
import type { PredatorActionContext, PredatorActionResult, PredatorActionHandler } from "./_predator_types";
import type { Predator } from "../../drizzle/schema";
import type { NotifyFn } from "./_types";
import type { SimulatedState, UpdateInstruction } from "../engine/types";
import { getEntitiesAt, applyDamage, distanceToGolem } from "./_utils";

// CRUSH — the golem brings its stone mass down across a wedge of tiles.
//
// Range:        Chebyshev ≤ 2 from the nearest golem tile to the target.
// Crush zone:   Lines from the 3 nearest golem tiles to the target (inclusive).
//               All unique frogs anywhere in the zone take 15 flat damage.
// Miss/fumble:  If no frog is on the primary target tile at resolution, FUMBLE
//               (turn consumed — the golem swung at empty air).
// On kill:      Golem's lastMealTick is updated; the golem repositions so the
//               nearest golem tile now occupies the dead frog's previous position.
// On survive:   Golem stays put; no follow-up action is queued.
//
// Payload:      { targetFrogId } stored by the golem brain for SimulatedState preload.

const CRUSH_DAMAGE = 15;

// Returns the 9 absolute tile positions that form the golem's 3×3 body.
function golemTiles(cx: number, cy: number): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      tiles.push({ x: cx + dx, y: cy + dy });
    }
  }
  return tiles;
}

// New golem center after repositioning so the nearest tile lands on (fx, fy).
function repositionedCenter(cx: number, cy: number, fx: number, fy: number): { x: number; y: number } {
  const nearestX = Math.max(cx - 1, Math.min(cx + 1, fx));
  const nearestY = Math.max(cy - 1, Math.min(cy + 1, fy));
  return { x: cx + (fx - nearestX), y: cy + (fy - nearestY) };
}

export const crushHandler: PredatorActionHandler = {
  validate(ctx: PredatorActionContext, predator: Predator, _state: SimulatedState): PredatorActionResult {
    const dist = distanceToGolem(predator.gridX, predator.gridY, ctx.targetGridX, ctx.targetGridY);
    if (dist > 2) {
      return { success: false, error: `CRUSH range is 2 tiles from golem edge (got ${dist}).` };
    }
    return { success: true };
  },

  execute(
    ctx: PredatorActionContext,
    predator: Predator,
    state: SimulatedState,
    out: UpdateInstruction[],
  ): PredatorActionResult {
    const cx = predator.gridX;
    const cy = predator.gridY;
    const fx = ctx.targetGridX;
    const fy = ctx.targetGridY;

    // Double-validation: primary target tile must still have a frog.
    const primaryFrogs = getEntitiesAt(state, fx, fy).frogs;
    if (primaryFrogs.length === 0) {
      return { success: false, fumble: true, error: "Target frog moved — crush misses!" };
    }
    const primaryFrog = primaryFrogs[0]!;

    // Build the crush zone: lines from the 3 nearest golem tiles to (fx, fy).
    const tiles = golemTiles(cx, cy);
    tiles.sort((a, b) =>
      chebyshevDistance(a.x, a.y, fx, fy) - chebyshevDistance(b.x, b.y, fx, fy)
    );
    const nearest3 = tiles.slice(0, 3);

    const zoneTileKeys = new Set<string>();
    for (const origin of nearest3) {
      // getLineTiles excludes origin, includes destination
      const path = getLineTiles(origin.x, origin.y, fx, fy);
      for (const t of path) {
        zoneTileKeys.add(`${t.x},${t.y}`);
      }
      // Include the destination itself (already in path), but also include the
      // origin's adjacent tile toward the target in case path starts from edge.
    }

    // Collect all unique frogs across zone tiles.
    const hitFrogIds = new Set<number>();
    for (const key of Array.from(zoneTileKeys)) {
      const [tx, ty] = key.split(",").map(Number) as [number, number];
      for (const frog of getEntitiesAt(state, tx, ty).frogs) {
        hitFrogIds.add(frog.id);
      }
    }
    // Ensure primary target is always included.
    hitFrogIds.add(primaryFrog.id);

    // Apply damage to every unique frog in the zone.
    for (const frogId of Array.from(hitFrogIds)) {
      applyDamage(state, out, "FROG", frogId, CRUSH_DAMAGE);
    }

    // Build hit report for broadcast.
    const hits: Array<{ frogId: number; frogName: string; newHp: number; killed: boolean }> = [];
    for (const frogId of Array.from(hitFrogIds)) {
      const updated = state.getFrog(frogId);
      if (updated) {
        hits.push({ frogId, frogName: updated.name, newHp: updated.currentHp, killed: updated.isDead });
      }
    }

    const primaryUpdated = state.getFrog(primaryFrog.id);
    const primaryKilled = primaryUpdated?.isDead ?? false;

    if (primaryKilled) {
      const newCenter = repositionedCenter(cx, cy, fx, fy);
      const newChunkX = Math.floor(newCenter.x / CHUNK_SIZE);
      const newChunkY = Math.floor(newCenter.y / CHUNK_SIZE);
      const predChanges = {
        lastMealTick: Math.floor(Date.now() / 10_000),
        gridX:  newCenter.x,
        gridY:  newCenter.y,
        chunkX: newChunkX,
        chunkY: newChunkY,
      };
      state.updatePredator(predator.id, predChanges);
      out.push({ type: "PREDATOR_UPDATE", id: predator.id, changes: predChanges });

      return {
        success: true,
        data: { hits, primaryFrogId: primaryFrog.id, primaryFrogName: primaryFrog.name, primaryKilled, newGolemX: newCenter.x, newGolemY: newCenter.y },
      };
    }

    return {
      success: true,
      data: { hits, primaryFrogId: primaryFrog.id, primaryFrogName: primaryFrog.name, primaryKilled },
    };
  },

  broadcast(
    _ctx: PredatorActionContext,
    predator: Predator,
    result: PredatorActionResult,
    notify: NotifyFn,
  ): void {
    const chunkKey = `${Math.floor(predator.gridX / CHUNK_SIZE)}:${Math.floor(predator.gridY / CHUNK_SIZE)}`;

    if (!result.success) {
      pushActionLog({
        text:     `Golem CRUSHES — ${result.error ?? "missed"}`,
        x:        predator.gridX,
        y:        predator.gridY,
        chunk_id: chunkKey,
        category: "combat",
      });
      return;
    }

    const { hits, primaryFrogName, primaryKilled, newGolemX, newGolemY } = result.data as {
      hits:            Array<{ frogId: number; frogName: string; newHp: number; killed: boolean }>;
      primaryFrogId:   number;
      primaryFrogName: string;
      primaryKilled:   boolean;
      newGolemX?:      number;
      newGolemY?:      number;
    };

    // Log each hit frog separately so the action log captures the full zone damage.
    for (const hit of hits) {
      pushActionLog({
        text: hit.killed
          ? `Golem CRUSHES ${hit.frogName} for ${CRUSH_DAMAGE} dmg — ${hit.frogName} is dead!`
          : `Golem CRUSHES ${hit.frogName} for ${CRUSH_DAMAGE} dmg (HP: ${hit.newHp})`,
        x:        predator.gridX,
        y:        predator.gridY,
        chunk_id: chunkKey,
        category: "combat",
      });
      notify(hit.frogId, { type: "GOLEM_CRUSH", damage: CRUSH_DAMAGE, newHp: hit.newHp, killed: hit.killed });
    }

    if (primaryKilled && newGolemX !== undefined && newGolemY !== undefined) {
      pushActionLog({
        text:     `The golem advances onto the remains of ${primaryFrogName}.`,
        x:        newGolemX,
        y:        newGolemY,
        chunk_id: `${Math.floor(newGolemX / CHUNK_SIZE)}:${Math.floor(newGolemY / CHUNK_SIZE)}`,
        category: "combat",
      });
    }
  },
};
